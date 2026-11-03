/* ============================================================
   xlsx.js — 纯前端读取 .xlsx（零依赖）
   · inflate (RFC1951) 解压 raw deflate
   · zip 中央目录解析
   · sharedStrings / 工作表 XML 解析为二维表格
   兼容 Chrome / Safari(iOS) / Android WebView 全版本
   ============================================================ */
(function (w) {
  'use strict';

  /* ---------------- inflate ---------------- */
  var LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59,
    67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
    1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  var CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  function inflateRaw(src) {
    var pos = 0, bitBuf = 0, bitCnt = 0;
    var dst = new Uint8Array(Math.max(4096, src.length * 6));
    var dpos = 0;

    function grow(n) {
      if (dpos + n <= dst.length) return;
      var size = dst.length;
      while (size < dpos + n) size *= 2;
      var nd = new Uint8Array(size);
      nd.set(dst.subarray(0, dpos));
      dst = nd;
    }
    function put(b) {
      grow(1);
      dst[dpos++] = b & 0xFF;
    }
    function need(n) {
      while (bitCnt < n) {
        if (pos >= src.length) throw new Error('压缩数据不完整');
        bitBuf = (bitBuf | (src[pos++] << bitCnt)) >>> 0;
        bitCnt += 8;
      }
    }
    function get(n) {
      if (n === 0) return 0;
      need(n);
      var v = bitBuf & ((1 << n) - 1);
      bitBuf >>>= n;
      bitCnt -= n;
      return v;
    }
    function alignToByte() {
      var drop = bitCnt & 7;
      bitBuf >>>= drop;
      bitCnt -= drop;
    }
    function alignedByte() {
      if (bitCnt >= 8) {
        var b = bitBuf & 0xFF;
        bitBuf >>>= 8;
        bitCnt -= 8;
        return b;
      }
      if (pos >= src.length) throw new Error('压缩数据不完整');
      return src[pos++];
    }

    function buildHuff(lengths) {
      var counts = new Uint16Array(16), offs = new Uint16Array(16);
      var symbols = new Uint16Array(lengths.length);
      var i, len, total = 0;
      for (i = 0; i < lengths.length; i++) counts[lengths[i]]++;
      counts[0] = 0;
      for (len = 1; len < 16; len++) { offs[len] = total; total += counts[len]; }
      for (i = 0; i < lengths.length; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i;
      return { counts: counts, symbols: symbols };
    }
    function decodeSym(h) {
      var code = 0, first = 0, index = 0;
      for (var len = 1; len < 16; len++) {
        code |= get(1);
        var count = h.counts[len];
        if (code - first < count) return h.symbols[index + code - first];
        index += count;
        first = (first + count) << 1;
        code <<= 1;
      }
      throw new Error('哈夫曼编码无效');
    }

    var fixedLit = null, fixedDist = null;
    function ensureFixed() {
      if (fixedLit) return;
      var l = new Uint8Array(288), i;
      for (i = 0; i < 144; i++) l[i] = 8;
      for (; i < 256; i++) l[i] = 9;
      for (; i < 280; i++) l[i] = 7;
      for (; i < 288; i++) l[i] = 8;
      fixedLit = buildHuff(l);
      var d = new Uint8Array(30);
      for (i = 0; i < 30; i++) d[i] = 5;
      fixedDist = buildHuff(d);
    }

    function dynamicTables() {
      var hlit = get(5) + 257, hdist = get(5) + 1, hclen = get(4) + 4;
      var clLens = new Uint8Array(19);
      for (var i = 0; i < hclen; i++) clLens[CLORDER[i]] = get(3);
      var clHuff = buildHuff(clLens);
      var lens = new Uint8Array(hlit + hdist);
      var n = 0, sym, rep;
      while (n < lens.length) {
        sym = decodeSym(clHuff);
        if (sym < 16) { lens[n++] = sym; }
        else if (sym === 16) {
          if (n === 0) throw new Error('码长重复无效');
          rep = 3 + get(2);
          var prev = lens[n - 1];
          while (rep-- > 0 && n < lens.length) lens[n++] = prev;
        } else if (sym === 17) {
          rep = 3 + get(3);
          while (rep-- > 0 && n < lens.length) lens[n++] = 0;
        } else {
          rep = 11 + get(7);
          while (rep-- > 0 && n < lens.length) lens[n++] = 0;
        }
      }
      return { lit: buildHuff(lens.subarray(0, hlit)), dist: buildHuff(lens.subarray(hlit)) };
    }

    var last = 0;
    while (!last) {
      last = get(1);
      var type = get(2);
      if (type === 0) {
        alignToByte();
        var len = alignedByte() | (alignedByte() << 8);
        var nlen = alignedByte() | (alignedByte() << 8);
        if ((len ^ 0xFFFF) !== nlen) throw new Error('数据长度校验失败');
        for (var k = 0; k < len; k++) put(alignedByte());
      } else if (type === 1 || type === 2) {
        var lit, dist;
        if (type === 1) { ensureFixed(); lit = fixedLit; dist = fixedDist; }
        else { var tb = dynamicTables(); lit = tb.lit; dist = tb.dist; }
        for (;;) {
          var sym = decodeSym(lit);
          if (sym < 256) { put(sym); continue; }
          if (sym === 256) break;
          sym -= 257;
          if (sym >= 29) throw new Error('长度码无效');
          var copyLen = LBASE[sym] + get(LEXT[sym]);
          var ds = decodeSym(dist);
          if (ds >= 30) throw new Error('距离码无效');
          var copyDist = DBASE[ds] + get(DEXT[ds]);
          if (copyDist > dpos) throw new Error('回溯距离越界');
          for (var c = 0; c < copyLen; c++) {
            var b = dst[dpos - copyDist];
            put(b);
          }
        }
      } else {
        throw new Error('数据块类型无效');
      }
    }
    return dst.subarray(0, dpos);
  }

  /* ---------------- 文本 / zip ---------------- */
  var TD = (typeof TextDecoder !== 'undefined') ? new TextDecoder('utf-8') : null;
  function utf8(bytes) {
    if (TD) return TD.decode(bytes);
    var s = '', i;
    for (i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  function unzip(buf) {
    var u8 = (buf instanceof Uint8Array) ? buf : new Uint8Array(buf);
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var eocd = -1, i;
    var floor = Math.max(0, u8.length - 66000);
    for (i = u8.length - 22; i >= floor; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 xlsx 文件');
    var count = dv.getUint16(eocd + 10, true);
    var p = dv.getUint32(eocd + 16, true);
    var files = {};
    for (var n = 0; n < count; n++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true);
      var csize = dv.getUint32(p + 20, true);
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var cmtLen = dv.getUint16(p + 32, true);
      var lho = dv.getUint32(p + 42, true);
      var name = utf8(u8.subarray(p + 46, p + 46 + nameLen));
      var lNameLen = dv.getUint16(lho + 26, true);
      var lExtraLen = dv.getUint16(lho + 28, true);
      var start = lho + 30 + lNameLen + lExtraLen;
      var raw = u8.subarray(start, start + csize);
      if (name.slice(-1) !== '/') {
        if (method === 0) files[name] = raw;
        else if (method === 8) files[name] = inflateRaw(raw);
        else throw new Error('不支持的压缩方式');
      }
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return files;
  }

  function findFile(files, path) {
    if (files[path]) return files[path];
    var lower = path.toLowerCase();
    var keys = Object.keys(files);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === lower) return files[keys[i]];
    }
    return null;
  }

  /* ---------------- xml ---------------- */
  function unescapeXml(s) {
    return String(s).replace(/&(lt|gt|amp|quot|apos|#x[0-9A-Fa-f]+|#[0-9]+);/g, function (m, e) {
      if (e === 'lt') return '<';
      if (e === 'gt') return '>';
      if (e === 'amp') return '&';
      if (e === 'quot') return '"';
      if (e === 'apos') return "'";
      if (e.charAt(0) === '#') {
        var code = e.charAt(1) === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        try { return String.fromCodePoint(code); } catch (err) { return ''; }
      }
      return m;
    });
  }

  function textNodes(xml) {
    var out = '', re = /<t\b[^>]*>([\s\S]*?)<\/t>/g, m;
    while ((m = re.exec(xml))) out += m[1];
    return unescapeXml(out);
  }

  function parseStrings(xml) {
    var arr = [], re = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g, m;
    while ((m = re.exec(xml))) arr.push(m[1] ? textNodes(m[1]) : '');
    return arr;
  }

  function colIndex(ref) {
    var m = /^([A-Za-z]+)/.exec(ref || '');
    if (!m) return -1;
    var s = m[1].toUpperCase(), n = 0;
    for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n - 1;
  }

  function parseSheet(xml, strings) {
    var rows = [], rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, m;
    while ((m = rowRe.exec(xml))) {
      var attrs = m[1] || '', body = m[2] || '';
      var rAttr = /(?:^|\s)r=("|')(\d+)\1/.exec(attrs);
      var ri = rAttr ? (+rAttr[2] - 1) : rows.length;
      if (ri < 0) ri = rows.length;
      var row = rows[ri] || (rows[ri] = []);
      var cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, cm, auto = 0;
      while ((cm = cellRe.exec(body))) {
        var cAttr = cm[1] || '', cVal = cm[2] || '';
        var refM = /(?:^|\s)r=("|')([A-Za-z]+\d+)\1/.exec(cAttr);
        var ci = refM ? colIndex(refM[2]) : auto;
        if (ci < 0) ci = 0;
        auto = ci + 1;
        var tM = /(?:^|\s)t=("|')([^"']*)\1/.exec(cAttr);
        var type = tM ? tM[2] : 'n';
        var value = '';
        if (type === 'inlineStr') {
          var isM = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(cVal);
          value = isM ? textNodes(isM[1]) : '';
        } else {
          var vM = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cVal);
          var raw = vM ? unescapeXml(vM[1]) : '';
          if (type === 's') {
            var idx = parseInt(raw, 10);
            value = (idx >= 0 && strings[idx] !== undefined) ? strings[idx] : '';
          } else if (type === 'str') {
            value = raw;
          } else if (type === 'e') {
            value = '';
          } else {
            value = raw;
          }
        }
        row[ci] = value;
      }
    }
    return rows;
  }

  function normPath(p) {
    p = String(p || '').replace(/\\/g, '/');
    if (p.charAt(0) === '/') p = p.slice(1);
    if (p.indexOf('xl/') !== 0) p = 'xl/' + p.replace(/^\.\//, '');
    return p;
  }

  function listSheets(files) {
    var out = [];
    var wb = findFile(files, 'xl/workbook.xml');
    var rels = findFile(files, 'xl/_rels/workbook.xml.rels');
    if (wb && rels) {
      var relXml = utf8(rels), relMap = {}, rm;
      var relRe = /<Relationship\b[^>]*>/g;
      while ((rm = relRe.exec(relXml))) {
        var idM = /Id=("|')([^"']+)\1/.exec(rm[0]);
        var tM = /Target=("|')([^"']+)\1/.exec(rm[0]);
        if (idM && tM) relMap[idM[2]] = normPath(tM[2]);
      }
      var xml = utf8(wb), sm;
      var sheetRe = /<sheet\b[^>]*>/g;
      while ((sm = sheetRe.exec(xml))) {
        var ridM = /r:id=("|')([^"']+)\1/.exec(sm[0]);
        var nameM = /name=("|')([^"']*)\1/.exec(sm[0]);
        var path = ridM ? relMap[ridM[2]] : null;
        if (path && findFile(files, path)) {
          out.push({ name: nameM ? nameM[2] : '', path: path });
        }
      }
    }
    if (!out.length) {
      Object.keys(files).filter(function (k) {
        return /^xl\/worksheets\/[^/]+\.xml$/i.test(k);
      }).sort().forEach(function (k) { out.push({ name: k, path: k }); });
    }
    return out;
  }

  function trimRow(r) {
    if (!r) return [];
    var out = [];
    for (var i = 0; i < r.length; i++) out[i] = (r[i] === undefined || r[i] === null) ? '' : r[i];
    return out;
  }

  /* ---------------- 对外：读成二维表格 ---------------- */
  function readSheets(input) {
    var files = unzip(input);
    var ssFile = findFile(files, 'xl/sharedStrings.xml');
    var strings = ssFile ? parseStrings(utf8(ssFile)) : [];
    var sheets = listSheets(files);
    if (!sheets.length) throw new Error('文件中没有工作表');
    return sheets.map(function (s) {
      var f = findFile(files, s.path);
      return {
        name: s.name,
        rows: f ? parseSheet(utf8(f), strings).map(trimRow) : []
      };
    });
  }

  function read(input) {
    return readSheets(input)[0].rows;
  }

  w.XLSX = { read: read, readSheets: readSheets, inflateRaw: inflateRaw, unzip: unzip };
})(window);

/* ============================================================
   export.js — 导出 xlsx / csv / json，导入 csv / json
   ============================================================ */
(function (w) {
  'use strict';

  var U = w.Oil.util;

  /* ---------- CRC32 ---------- */
  var crcTable = (function () {
    var table = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c >>> 0;
    }
    return table;
  })();
  function crc32(buf) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------- 最小化 zip（store，无压缩） ---------- */
  function zip(files) {
    var enc = new TextEncoder();
    var parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var nameBytes = enc.encode(f.name);
      var data = f.data;
      var crc = crc32(data);
      var local = new Uint8Array(30 + nameBytes.length);
      var dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0, true);
      dv.setUint16(8, 0, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, 0x2100, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      parts.push(local, data);

      var cd = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0x2100, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      cd.set(nameBytes, 46);
      central.push(cd);

      offset += local.length + data.length;
    });

    var cdSize = central.reduce(function (a, b) { return a + b.length; }, 0);
    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    var all = parts.concat(central, [end]);
    return new Blob(all, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /* ---------- xlsx ---------- */
  function xmlEsc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
  }
  function colName(i) {
    var s = '';
    i = i + 1;
    while (i > 0) {
      var m = (i - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  }
  function buildSheet(rows) {
    var body = rows.map(function (row, ri) {
      var cells = row.map(function (val, ci) {
        var ref = colName(ci) + (ri + 1);
        if (typeof val === 'number' && isFinite(val)) {
          return '<c r="' + ref + '"><v>' + val + '</v></c>';
        }
        if (val === null || val === undefined || val === '') return '';
        return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(val) + '</t></is></c>';
      }).join('');
      return '<row r="' + (ri + 1) + '">' + cells + '</row>';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<cols><col min="1" max="1" width="13"/><col min="2" max="2" width="9"/>' +
      '<col min="3" max="9" width="14"/><col min="10" max="11" width="10"/>' +
      '<col min="12" max="14" width="18"/><col min="15" max="15" width="16"/></cols>' +
      '<sheetData>' + body + '</sheetData></worksheet>';
  }

  function xlsxBlob(rows) {
    var enc = new TextEncoder();
    var files = [
      {
        name: '[Content_Types].xml',
        data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '</Types>')
      },
      {
        name: '_rels/.rels',
        data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>')
      },
      {
        name: 'xl/workbook.xml',
        data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets><sheet name="加油记录" sheetId="1" r:id="rId1"/></sheets></workbook>')
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '</Relationships>')
      },
      { name: 'xl/worksheets/sheet1.xml', data: enc.encode(buildSheet(rows)) }
    ];
    return zip(files);
  }

  /* ---------- download ---------- */
  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1500);
  }
  function stamp() {
    var d = new Date();
    return '' + d.getFullYear() + U.pad2(d.getMonth() + 1) + U.pad2(d.getDate());
  }

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    var rows = [], row = [], cell = '', inQuote = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQuote) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else inQuote = false;
        } else cell += ch;
      } else if (ch === '"') {
        inQuote = true;
      } else if (ch === ',') {
        row.push(cell); cell = '';
      } else if (ch === '\n') {
        row.push(cell); rows.push(row); row = []; cell = '';
      } else if (ch === '\r') {
        /* skip */
      } else {
        cell += ch;
      }
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  }

  /* 表头识别（顺序敏感：先匹配更具体的列名） */
  var HEADER_RULES = [
    [/日期时间|日期和时间|时间日期|datetime|date\s*time/i, 'datetime'],
    [/加油时间|时间|time/i, 'time'],
    [/日期|date/i, 'date'],
    [/总里程|当前里程|里程表|里程|odometer|mileage/i, 'odometer'],
    [/油耗|百公里|consumption/i, 'cons'],
    [/机显单价|单价|油价|price/i, 'unitPrice'],
    [/加油量|油量|升数|volume|litre|liter/i, 'volume'],
    [/实付|pay\s*amount|paid/i, 'payAmount'],
    [/优惠|减免|折扣|discount/i, 'discount'],
    [/机显金额|金额|费用|花费|amount|total/i, 'amount'],
    [/加油站|station/i, 'station'],
    [/油号|标号|油品|燃油|fuel/i, 'fuelType'],
    [/加满|跳枪|full/i, 'fullTank'],
    [/亮灯|油灯|warn|low\s*fuel/i, 'warnLight'],
    [/漏记|没记录|miss|skip/i, 'lastRecorded'],
    [/备注|note|remark|memo/i, 'note']
  ];

  function mapHeader(h) {
    var s = String(h === null || h === undefined ? '' : h).replace(/\s+/g, ' ').trim();
    if (!s || s.length > 24) return null;
    for (var i = 0; i < HEADER_RULES.length; i++) {
      if (HEADER_RULES[i][0].test(s)) return HEADER_RULES[i][1];
    }
    return null;
  }

  function normalizeDate(v) {
    var s = String(v === null || v === undefined ? '' : v).trim();
    if (!s) return '';
    var m = s.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) {
      return m[1] + '-' + U.pad2(+m[2]) + '-' + U.pad2(+m[3]);
    }
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) {
      return m[1] + '-' + m[2] + '-' + m[3];
    }
    var n = Number(s);
    if (isFinite(n) && n > 20000 && n < 80000) {
      // Excel 序列号（1899-12-30 起算）
      var d = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000));
      return d.getUTCFullYear() + '-' + U.pad2(d.getUTCMonth() + 1) + '-' + U.pad2(d.getUTCDate());
    }
    return '';
  }

  function normalizeTime(v) {
    var s = String(v === null || v === undefined ? '' : v).trim();
    if (!s) return '';
    var m = s.match(/(\d{1,2}):(\d{2})/);
    if (m && +m[1] < 24 && +m[2] < 60) return U.pad2(+m[1]) + ':' + U.pad2(+m[2]);
    var n = Number(s);
    if (isFinite(n) && n > 0 && n < 1) {
      var mins = Math.round(n * 1440) % 1440;
      return U.pad2(Math.floor(mins / 60)) + ':' + U.pad2(mins % 60);
    }
    // Excel 日期序列号的小数部分即时间：46027.3958 → 09:30
    if (isFinite(n) && n > 20000 && n < 80000) {
      var frac = n - Math.floor(n);
      if (frac > 0.0007) {
        var mi = Math.round(frac * 1440) % 1440;
        return U.pad2(Math.floor(mi / 60)) + ':' + U.pad2(mi % 60);
      }
    }
    return '';
  }

  function truthy(v, def) {
    var s = String(v === null || v === undefined ? '' : v).trim().toLowerCase();
    if (!s) return def;
    if (/没有|没记录|未|否|^无|false|^0(\.0+)?$|^n$|^no$|^[×x-]$/.test(s)) return false;
    if (/是|有|亮|已|跳枪|满|true|^1(\.0+)?$|^y$|^yes$|^[√✓v]$/.test(s)) return true;
    return def;
  }

  function normalizeFuel(v) {
    var s = String(v === null || v === undefined ? '' : v).trim().replace(/\s+/g, '').replace(/号/g, '#');
    if (!s) return '95#汽油';
    var fuels = (w.Oil && w.Oil.FUELS) || [];
    for (var i = 0; i < fuels.length; i++) if (fuels[i] === s) return s;
    if (/汽油|柴油/.test(s)) return s;
    if (/^-?10#?/.test(s)) return '-10#柴油';
    if (/^0#?$/.test(s)) return '0#柴油';
    var m = s.match(/(92|95|98)/);
    if (m) return m[1] + '#汽油';
    return s;
  }

  function cellOf(row, i) {
    if (!row || i === undefined || i === null || i < 0) return '';
    var v = row[i];
    return (v === undefined || v === null) ? '' : v;
  }

  /* 把二维表格（CSV 或 xlsx）转成记录数组；无法识别表头时返回 null */
  function rowsToRecords(rows) {
    if (!rows || !rows.length) return [];
    var headerAt = -1, idx = null, i, c;
    var limit = Math.min(rows.length, 15);
    for (i = 0; i < limit; i++) {
      var row = rows[i] || [];
      var map = {};
      for (c = 0; c < row.length; c++) {
        var key = mapHeader(row[c]);
        if (key && map[key] === undefined) map[key] = c;
      }
      if (map.odometer !== undefined && (map.date !== undefined || map.datetime !== undefined)) {
        headerAt = i; idx = map; break;
      }
    }
    if (headerAt < 0) return null;

    var out = [];
    for (var r = headerAt + 1; r < rows.length; r++) {
      var line = rows[r] || [];
      var rawDate = idx.datetime !== undefined ? cellOf(line, idx.datetime) : cellOf(line, idx.date);
      var date = normalizeDate(rawDate);
      if (!date && idx.date !== undefined) date = normalizeDate(cellOf(line, idx.date));
      if (!date) continue;
      var time = normalizeTime(rawDate) || normalizeTime(cellOf(line, idx.time));
      var odo = U.num(cellOf(line, idx.odometer));
      if (!odo) continue;

      var volume = U.num(cellOf(line, idx.volume));
      var unitPrice = U.num(cellOf(line, idx.unitPrice));
      var amount = U.num(cellOf(line, idx.amount));
      var pay = U.num(cellOf(line, idx.payAmount));
      if (!amount) amount = U.round(volume * unitPrice, 2) || pay;
      if (!pay) pay = amount;
      if (!unitPrice && volume) unitPrice = U.round(amount / volume, 2);
      if (!volume && amount && unitPrice) volume = U.round(amount / unitPrice, 2);

      var discount = idx.discount !== undefined ? U.num(cellOf(line, idx.discount)) : 0;
      if (!discount && amount > pay) discount = U.round(amount - pay, 2);

      out.push({
        id: U.uid(),
        date: date,
        time: time || '08:00',
        odometer: odo,
        volume: volume,
        unitPrice: unitPrice,
        amount: U.round(amount, 2),
        discount: U.round(discount, 2),
        payPrice: volume ? U.round(pay / volume, 2) : unitPrice,
        payAmount: U.round(pay, 2),
        fullTank: idx.fullTank !== undefined ? truthy(cellOf(line, idx.fullTank), true) : true,
        warnLight: idx.warnLight !== undefined ? truthy(cellOf(line, idx.warnLight), false) : false,
        lastRecorded: idx.lastRecorded !== undefined ? !truthy(cellOf(line, idx.lastRecorded), false) : true,
        station: String(cellOf(line, idx.station) || ''),
        fuelType: normalizeFuel(cellOf(line, idx.fuelType)),
        note: String(cellOf(line, idx.note) || ''),
        photo: '',
        createdAt: new Date(date + 'T00:00:00').getTime() + out.length
      });
    }
    return out;
  }

  function csvToRecords(text) {
    return rowsToRecords(parseCSV(text));
  }

  /* ---------- 对外方法 ---------- */
  var Export = {
    excel: function (store) {
      var veh = store.vehicle();
      var items = w.Oil.Calc.index(store.records());
      var head = ['加油日期', '加油时间', '当前里程(公里)', '机显单价(元/升)', '加油量(升)', '机显金额(元)',
        '实付金额(元)', '优惠(元)', '是否加满', '油灯亮', '加油站', '燃油标号', '油耗(升/百公里)', '备注'];
      var rows = [head];
      items.forEach(function (r) {
        rows.push([
          r.date, r.time, r.odometer, r.unitPrice, r.volume, r.amount, r.payAmount, r.discount,
          r.fullTank ? '已跳枪' : '未跳枪', r.warnLight ? '油灯亮' : '没有亮',
          r.station || '', r.fuelType || '', r.cons === null ? '' : r.cons, r.note || ''
        ]);
      });
      var s = w.Oil.Calc.summarize(items, { type: 'all' });
      rows.push([]);
      rows.push(['车辆', veh ? veh.name : '默认车辆']);
      rows.push(['统计里程(公里)', s.distance]);
      rows.push(['累计油费(元)', s.cost]);
      rows.push(['累计油量(升)', s.fuel]);
      rows.push(['平均油耗(升/百公里)', s.avgCons === null ? '' : s.avgCons]);
      rows.push(['加油次数', s.count]);
      rows.push(['导出时间', new Date().toLocaleString('zh-CN')]);
      download(xlsxBlob(rows), '油耗记录_' + (veh ? veh.name : '') + '_' + stamp() + '.xlsx');
    },

    csv: function (store) {
      var veh = store.vehicle();
      var items = w.Oil.Calc.index(store.records());
      var lines = ['加油日期,加油时间,当前里程(公里),机显单价(元/升),加油量(升),机显金额(元),实付金额(元),优惠(元),是否加满,加油站,燃油标号,油耗(升/百公里),备注'];
      items.forEach(function (r) {
        lines.push([r.date, r.time, r.odometer, r.unitPrice, r.volume, r.amount, r.payAmount, r.discount,
          r.fullTank ? '已跳枪' : '未跳枪', '"' + (r.station || '') + '"', r.fuelType || '',
          r.cons === null ? '' : r.cons, '"' + String(r.note || '').replace(/"/g, '""') + '"'].join(','));
      });
      download(new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }),
        '油耗记录_' + (veh ? veh.name : '') + '_' + stamp() + '.csv');
    },

    json: function (store) {
      var veh = store.vehicle();
      download(new Blob([store.exportJSON()], { type: 'application/json' }),
        '油耗备份_' + (veh ? veh.name : '') + '_' + stamp() + '.json');
    },

    readFile: function (file, done) {
      var name = (file.name || '').toLowerCase();

      /* Excel：二进制解析（unzip + inflate + sheet xml） */
      if (/\.(xlsx|xlsm|xltx)$/.test(name)) {
        var fr = new FileReader();
        fr.onload = function () {
          var recs = null, firstOk = null;
          try {
            if (!w.XLSX) throw new Error('解析组件未加载');
            var sheets = w.XLSX.readSheets(new Uint8Array(fr.result));
            for (var i = 0; i < sheets.length; i++) {
              var cand = rowsToRecords(sheets[i].rows);
              if (cand === null) continue;
              if (firstOk === null) firstOk = cand;
              if (cand.length) { recs = cand; break; }
            }
            if (recs === null) recs = firstOk;
          } catch (err) {
            return done({ error: 'Excel 解析失败：' + ((err && err.message) || '文件可能已损坏') });
          }
          if (recs === null) return done({ error: 'Excel 中未找到“日期”和“里程”列' });
          if (!recs.length) return done({ error: 'Excel 中没有可导入的记录' });
          done({ records: recs, source: 'xlsx' });
        };
        fr.onerror = function () { done({ error: '文件读取失败' }); };
        fr.readAsArrayBuffer(file);
        return;
      }
      if (/\.xls$/.test(name)) {
        return done({ error: '不支持旧版 .xls，请另存为 .xlsx 或 .csv' });
      }

      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result || '');
        if (/\.json$/.test(name)) {
          try {
            var obj = JSON.parse(text);
            var list = obj.records || obj;
            if (!Array.isArray(list)) return done({ error: 'JSON 中未找到记录数组' });
            return done({ records: list });
          } catch (e) {
            return done({ error: 'JSON 解析失败，请检查文件' });
          }
        }
        var recs = csvToRecords(text);
        if (recs === null) return done({ error: '未识别到“日期”和“里程”列，请检查表头' });
        if (!recs.length) return done({ error: '文件中没有可导入的记录' });
        done({ records: recs });
      };
      reader.onerror = function () { done({ error: '文件读取失败' }); };
      reader.readAsText(file, 'utf-8');
    },

    download: download
  };

  w.Export = Export;
})(window);

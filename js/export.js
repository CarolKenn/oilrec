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

  function mapHeader(h) {
    h = String(h || '').trim();
    var rules = [
      [/日期|时间|date/i, 'date'],
      [/当前里程|总里程|里程|odometer|mileage/i, 'odometer'],
      [/油耗|百公里|consumption/i, 'cons'],
      [/单价|price/i, 'unitPrice'],
      [/加油量|油量|升|volume|litre|liter/i, 'volume'],
      [/实付金额|实付|payAmount/i, 'payAmount'],
      [/优惠|discount/i, 'discount'],
      [/金额|amount|费用|花费/i, 'amount'],
      [/加油站|station/i, 'station'],
      [/标号|油品|燃油|fuel/i, 'fuelType'],
      [/备注|note|remark/i, 'note']
    ];
    for (var i = 0; i < rules.length; i++) if (rules[i][0].test(h)) return rules[i][1];
    return null;
  }

  function normalizeDate(v) {
    v = String(v || '').trim();
    var m = v.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    if (m) return m[1] + '-' + U.pad2(+m[2]) + '-' + U.pad2(+m[3]);
    if (/^\d{5}$/.test(v)) {
      // excel 序列号
      var d = new Date(Date.UTC(1899, 11, 30) + (+v) * 86400000);
      return d.getUTCFullYear() + '-' + U.pad2(d.getUTCMonth() + 1) + '-' + U.pad2(d.getUTCDate());
    }
    return '';
  }

  function csvToRecords(text) {
    var rows = parseCSV(text);
    if (rows.length < 2) return [];
    var header = rows[0].map(mapHeader);
    var idx = {};
    header.forEach(function (key, i) { if (key && idx[key] === undefined) idx[key] = i; });
    if (idx.date === undefined || idx.odometer === undefined) return null;
    var out = [];
    rows.slice(1).forEach(function (r) {
      var date = normalizeDate(r[idx.date]);
      if (!date) return;
      var odo = U.num(r[idx.odometer]);
      if (!odo) return;
      var volume = idx.volume !== undefined ? U.num(r[idx.volume]) : 0;
      var unitPrice = idx.unitPrice !== undefined ? U.num(r[idx.unitPrice]) : 0;
      var amount = idx.amount !== undefined ? U.num(r[idx.amount]) : 0;
      var pay = idx.payAmount !== undefined && U.num(r[idx.payAmount]) ? U.num(r[idx.payAmount]) : (amount || U.round(volume * unitPrice, 2));
      if (!amount) amount = U.round(volume * unitPrice, 2) || pay;
      if (!unitPrice && volume) unitPrice = U.round(pay / volume, 2);
      out.push({
        id: U.uid(),
        date: date,
        time: '08:00',
        odometer: odo,
        volume: volume,
        unitPrice: unitPrice,
        amount: U.round(amount, 2),
        discount: idx.discount !== undefined ? U.num(r[idx.discount]) : 0,
        payPrice: volume ? U.round(pay / volume, 2) : 0,
        payAmount: U.round(pay, 2),
        fullTank: true,
        warnLight: false,
        lastRecorded: true,
        station: idx.station !== undefined ? String(r[idx.station] || '') : '',
        fuelType: idx.fuelType !== undefined ? String(r[idx.fuelType] || '95#汽油') : '95#汽油',
        note: idx.note !== undefined ? String(r[idx.note] || '') : '',
        photo: '',
        createdAt: Date.now()
      });
    });
    return out;
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
        if (/\.xlsx?$/.test(name)) {
          return done({ error: '暂不支持直接读取 Excel，请在 Excel/WPS 中“另存为 CSV”后导入' });
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

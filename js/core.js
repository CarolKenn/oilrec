/* ============================================================
   core.js — 工具函数 / 本地存储 / 油耗计算
   ============================================================ */
(function (w) {
  'use strict';

  var KEY = 'oilrec.v1';
  var FUELS = ['95#汽油', '92#汽油', '98#汽油', '0#柴油', '-10#柴油'];

  /* ---------------- utils ---------------- */
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function todayStr(d) { d = d || new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function nowTime(d) { d = d || new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function num(v) {
    if (v === null || v === undefined) return 0;
    var n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
    return isFinite(n) ? n : 0;
  }
  function round(n, d) {
    d = d === undefined ? 2 : d;
    var p = Math.pow(10, d);
    return Math.round((n + 1e-9) * p) / p;
  }
  function fmt(n, d) {
    d = d === undefined ? 2 : d;
    if (n === null || n === undefined || !isFinite(n)) return '--';
    return Number(n).toFixed(d);
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function parseDate(str) {
    var p = String(str || '').split('-');
    if (p.length < 3) return null;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return isNaN(d.getTime()) ? null : d;
  }
  function daysBetween(a, b) {
    var d1 = parseDate(a), d2 = parseDate(b);
    if (!d1 || !d2) return 0;
    return Math.round((d2 - d1) / 86400000);
  }
  function shortDate(str) {
    var p = String(str || '').split('-');
    return p.length >= 3 ? p[1] + '-' + p[2] : str;
  }
  function slashDate(str) {
    return String(str || '').replace(/-/g, '/');
  }

  /* ---------------- 演示数据 ---------------- */
  /* ---------------- 参考油耗：按排量 + 进气形式估算 ----------------
     数值为该排量车型在顺畅路况下的「低位」实测油耗（升/百公里），
     同排量涡轮机进气量更大，低位值比自吸高 0.5～1.0 升。 */
  var REF_DISPS = [1.0, 1.2, 1.4, 1.5, 1.6, 1.8, 2.0, 2.4, 2.5, 3.0, 3.5, 4.0];
  var REF_TABLE = {
    na: [5.3, 5.6, 5.9, 6.2, 6.5, 7.0, 7.5, 8.6, 8.9, 10.2, 11.5, 12.6],
    turbo: [5.6, 6.1, 6.7, 7.0, 7.3, 7.8, 8.4, 9.4, 9.6, 10.8, 11.9, 12.9]
  };

  /* 查表得到基础参考值（不含手动微调） */
  function refBase(disp, turbo) {
    var table = REF_TABLE[turbo ? 'turbo' : 'na'];
    disp = num(disp) || 2.0;
    if (disp <= REF_DISPS[0]) return table[0];
    var last = REF_DISPS.length - 1;
    if (disp >= REF_DISPS[last]) return table[last];
    for (var i = 0; i < last; i++) {
      var a = REF_DISPS[i], b = REF_DISPS[i + 1];
      if (disp >= a && disp <= b) {
        var t = (disp - a) / (b - a);
        return round(table[i] + (table[i + 1] - table[i]) * t, 1);
      }
    }
    return table[last];
  }

  function clampOffset(v) {
    v = num(v) || 0;
    v = Math.round(v * 2) / 2;           // 只保留 0.5 的整数倍
    if (v > 2) v = 2;
    if (v < -2) v = -2;
    return v;
  }

  /* 实际参考值 = 查表值 + 手动微调 */
  function refLowOf(veh) {
    var e = (veh && veh.engine) || {};
    return round(refBase(e.disp, e.turbo) + clampOffset(e.offset), 1);
  }

  function seedDB() {
    var vehicle = { id: 'v1', name: '默认车辆', plate: '', model: '', engine: { disp: 2.0, turbo: false, offset: 0 } };
    var consPlan = [
      10.9, 10.4, 7.8, 7.8, 7.8, 7.8, 8.4, 8.4, 8.4, 7.5,
      7.5, 7.5, 7.5, 7.5, 10.5, 10.5, 7.4, 8.2, 8.3, 7.8,
      8.2, 7.6, 7.7, 7.8, 7.8, 7.9, 8.1, 7.6, 7.6, 7.5,
      7.4, 7.1, 7.9, 7.9, 7.9, 7.9, 6.5, 6.47
    ];
    var n = consPlan.length;
    var raw = [], totalRaw = 0, i;
    for (i = 0; i < n; i++) {
      var base = 500 + ((i * 37) % 60);
      if (consPlan[i] > 10) base = 330 + ((i * 13) % 40);
      raw.push(base);
      totalRaw += base;
    }
    var scale = 19702 / (totalRaw - raw[0]);
    var startOdo = 1280;
    var startDate = new Date(2023, 2, 21);
    var plan = [];
    var odo = startOdo, totalCost = 0, totalDiscount = 0;
    for (i = 0; i < n; i++) {
      var dist = Math.round(raw[i] * scale * 10) / 10;
      odo = Math.round((odo + dist) * 10) / 10;
      var vol = Math.round(dist * consPlan[i] / 100 * 100) / 100;
      var price = round(7.55 + ((i * 11) % 100) / 100, 2);
      var discount = round(8 + ((i * 7) % 44), 2);
      plan.push({ dist: dist, odo: odo, vol: vol, price: price, discount: discount });
      totalCost += vol * price;
      totalDiscount += discount;
    }
    // 校准价格，使累计油费贴近真实量级（≈ 11968 元）
    var k = (11968 + totalDiscount) / totalCost;
    var records = [];
    for (i = 0; i < n; i++) {
      var p = plan[i];
      var unitPrice = round(p.price * k, 2);
      var amount = round(p.vol * unitPrice, 2);
      var pay = round(amount - p.discount, 2);
      var d = new Date(startDate.getTime() + i * 35 * 86400000);
      records.push({
        id: 'seed' + i,
        vehicleId: vehicle.id,
        date: todayStr(d),
        time: pad2(7 + (i % 10)) + ':' + pad2((i * 7) % 60),
        odometer: p.odo,
        unitPrice: unitPrice,
        volume: p.vol,
        amount: amount,
        discount: p.discount,
        payPrice: round(pay / p.vol, 2),
        payAmount: pay,
        fullTank: true,
        warnLight: i % 3 === 0,
        lastRecorded: true,
        station: ['中石化·建设路站', '中石油·城南站', '壳牌·高新站'][i % 3],
        fuelType: '95#汽油',
        note: '',
        photo: '',
        createdAt: d.getTime()
      });
    }
    return {
      version: 1,
      settings: { theme: 'light', accent: 'green' },
      vehicles: [vehicle],
      currentVehicleId: vehicle.id,
      records: records
    };
  }

  /* ---------------- store ---------------- */
  var Store = {
    db: null,

    init: function () {
      var raw = null;
      try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
      if (raw) {
        try { this.db = JSON.parse(raw); } catch (e) { this.db = null; }
      }
      if (!this.db || !this.db.records || !this.db.vehicles) {
        this.db = seedDB();
        this.persist();
      }
      this.migrate();
      return this;
    },

    migrate: function () {
      var db = this.db;
      db.settings = Object.assign({ theme: 'light', accent: 'green' }, db.settings || {});
      if (!db.vehicles.length) db.vehicles.push({ id: 'v1', name: '默认车辆', plate: '', model: '' });
      db.vehicles.forEach(function (v) {
        var e = v.engine || {};
        v.engine = {
          disp: num(e.disp) || 2.0,
          turbo: !!e.turbo,
          offset: clampOffset(e.offset)
        };
      });
      if (!this.vehicle()) db.currentVehicleId = db.vehicles[0].id;
      db.records = db.records.filter(function (r) { return r && r.date; }).map(function (r) {
        r.volume = num(r.volume);
        r.amount = num(r.amount);
        r.payAmount = num(r.payAmount) || r.amount;
        r.unitPrice = num(r.unitPrice);
        r.discount = num(r.discount);
        r.odometer = num(r.odometer);
        r.fullTank = r.fullTank !== false;
        r.vehicleId = r.vehicleId || db.currentVehicleId;
        return r;
      });
    },

    persist: function () {
      try {
        localStorage.setItem(KEY, JSON.stringify(this.db));
        return true;
      } catch (e) {
        if (w.App && w.App.toast) w.App.toast('本地存储空间不足，建议先导出备份并清理照片');
        return false;
      }
    },

    settings: function () { return this.db.settings; },

    vehicle: function (id) {
      id = id || this.db.currentVehicleId;
      var list = this.db.vehicles;
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return list[0] || null;
    },

    setVehicle: function (id) {
      this.db.currentVehicleId = id;
      this.persist();
    },

    addVehicle: function (name) {
      var v = { id: uid(), name: name || ('车辆 ' + (this.db.vehicles.length + 1)), plate: '', model: '',
        engine: { disp: 2.0, turbo: false, offset: 0 } };
      this.db.vehicles.push(v);
      this.db.currentVehicleId = v.id;
      this.persist();
      return v;
    },

    updateVehicle: function (id, patch) {
      var v = this.vehicle(id);
      if (!v) return;
      Object.assign(v, patch);
      this.persist();
    },

    removeVehicle: function (id) {
      if (this.db.vehicles.length <= 1) return false;
      this.db.vehicles = this.db.vehicles.filter(function (v) { return v.id !== id; });
      this.db.records = this.db.records.filter(function (r) { return r.vehicleId !== id; });
      if (this.db.currentVehicleId === id) this.db.currentVehicleId = this.db.vehicles[0].id;
      this.persist();
      return true;
    },

    records: function (vehicleId) {
      var vid = vehicleId || this.db.currentVehicleId;
      return this.db.records.filter(function (r) { return r.vehicleId === vid; });
    },

    record: function (id) {
      var list = this.db.records;
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    },

    saveRecord: function (rec) {
      var idx = -1;
      for (var i = 0; i < this.db.records.length; i++) {
        if (this.db.records[i].id === rec.id) { idx = i; break; }
      }
      if (idx >= 0) this.db.records[idx] = rec;
      else this.db.records.push(rec);
      return this.persist();
    },

    deleteRecord: function (id) {
      this.db.records = this.db.records.filter(function (r) { return r.id !== id; });
      this.persist();
    },

    clearRecords: function () {
      var vid = this.db.currentVehicleId;
      this.db.records = this.db.records.filter(function (r) { return r.vehicleId !== vid; });
      this.persist();
    },

    replaceRecords: function (records) {
      var vid = this.db.currentVehicleId;
      this.db.records = this.db.records.filter(function (r) { return r.vehicleId !== vid; }).concat(records);
      this.persist();
    },

    exportJSON: function () {
      return JSON.stringify({
        app: 'oilrec',
        version: 1,
        exportedAt: new Date().toISOString(),
        settings: this.db.settings,
        vehicles: this.db.vehicles,
        currentVehicleId: this.db.currentVehicleId,
        records: this.db.records
      }, null, 2);
    },

    importJSON: function (obj) {
      if (!obj) return false;
      var list = obj.records || (Array.isArray(obj) ? obj : null);
      if (!list) return false;
      var vid = this.db.currentVehicleId;
      var cleaned = list.filter(function (r) { return r && r.date; }).map(function (r) {
        return {
          id: r.id || uid(),
          vehicleId: vid,
          date: r.date,
          time: r.time || '08:00',
          odometer: num(r.odometer),
          unitPrice: num(r.unitPrice),
          volume: num(r.volume),
          amount: num(r.amount),
          discount: num(r.discount),
          payPrice: num(r.payPrice),
          payAmount: num(r.payAmount) || num(r.amount),
          fullTank: r.fullTank !== false,
          warnLight: !!r.warnLight,
          lastRecorded: r.lastRecorded !== false,
          station: r.station || '',
          fuelType: r.fuelType || '95#汽油',
          note: r.note || '',
          photo: r.photo || '',
          createdAt: r.createdAt || Date.now()
        };
      });
      if (!cleaned.length) return false;
      this.replaceRecords(cleaned);
      return true;
    }
  };

  /* ---------------- 油耗计算 ---------------- */
  var Calc = {
    // 按里程升序，计算每条记录的行驶距离、油耗
    index: function (records) {
      var list = records.slice().sort(function (a, b) {
        return (a.odometer - b.odometer) || String(a.date).localeCompare(String(b.date));
      });
      var accFuel = 0, accDist = 0;
      return list.map(function (r, i) {
        var prev = i ? list[i - 1] : null;
        var dist = prev ? round(r.odometer - prev.odometer, 1) : null;
        if (dist !== null && dist > 0) {
          accDist += dist;
          accFuel += num(r.volume);
        }
        var cons = null, segFuel = null, segDist = null;
        if (r.fullTank && accDist > 0) {
          segFuel = round(accFuel, 2);
          segDist = round(accDist, 1);
          cons = round(accFuel / accDist * 100, 2);
          accFuel = 0;
          accDist = 0;
        }
        return Object.assign({}, r, {
          dist: dist,
          cons: cons,
          segFuel: segFuel,
          segDist: segDist,
          costPerKm: (dist !== null && dist > 0) ? round(num(r.payAmount) / dist, 2) : null
        });
      });
    },

    inRange: function (r, range) {
      if (!range || range.type === 'all') return true;
      if (range.type === 'year') return String(r.date).slice(0, 4) === String(range.year);
      if (range.type === 'custom') {
        var from = range.from || '0000-00-00';
        var to = range.to || '9999-99-99';
        return r.date >= from && r.date <= to;
      }
      return true;
    },

    summarize: function (items, range) {
      var rows = items.filter(function (r) { return Calc.inRange(r, range); });
      var out = {
        count: rows.length, cost: 0, fuel: 0, discount: 0,
        distance: 0, avgCons: null, perKm: null, perDay: null
      };
      if (!rows.length) return out;
      var segD = 0, segF = 0;
      rows.forEach(function (r) {
        out.cost += num(r.payAmount) || num(r.amount);
        out.fuel += num(r.volume);
        out.discount += Math.max(0, num(r.amount) - (num(r.payAmount) || num(r.amount)));
        if (r.dist !== null && r.dist > 0) out.distance += r.dist;
        if (r.cons !== null) { segD += r.segDist; segF += r.segFuel; }
      });
      if (segD > 0) out.avgCons = round(segF / segD * 100, 2);
      if (out.distance > 0) out.perKm = round(out.cost / out.distance, 2);
      var days = daysBetween(rows[0].date, rows[rows.length - 1].date);
      if (days > 0) out.perDay = round(out.distance / days, 2);
      out.cost = round(out.cost, 2);
      out.discount = round(out.discount, 2);
      out.fuel = round(out.fuel, 2);
      out.distance = round(out.distance, 1);
      return out;
    },

    // 区间内油耗曲线
    trend: function (items, range) {
      return items
        .filter(function (r) { return r.cons !== null && Calc.inRange(r, range); })
        .map(function (r) { return { date: r.date, value: r.cons, id: r.id }; });
    },

    // 月度油费
    monthly: function (items, year) {
      var arr = [];
      for (var m = 1; m <= 12; m++) arr.push({ month: m, value: 0, count: 0 });
      items.forEach(function (r) {
        if (String(r.date).slice(0, 4) !== String(year)) return;
        var m = parseInt(String(r.date).slice(5, 7), 10);
        if (m >= 1 && m <= 12) {
          arr[m - 1].value += num(r.payAmount) || num(r.amount);
          arr[m - 1].count++;
        }
      });
      arr.forEach(function (o) { o.value = round(o.value, 2); });
      return arr;
    },

    years: function (items) {
      var set = {};
      items.forEach(function (r) { set[String(r.date).slice(0, 4)] = 1; });
      var list = Object.keys(set).sort().reverse();
      var cy = String(new Date().getFullYear());
      if (list.indexOf(cy) < 0) list.unshift(cy);
      return list;
    },

    latest: function (items) {
      for (var i = items.length - 1; i >= 0; i--) {
        if (items[i].cons !== null) return items[i];
      }
      return null;
    },

    rangeLabel: function (range) {
      if (!range || range.type === 'all') return '全部';
      if (range.type === 'year') return range.year + '年';
      if (range.type === 'custom') return '自定义';
      return '全部';
    },

    rating: function (cons, count, refLow) {
      if (cons === null || count < 3) return '暂不能评级';
      if (cons <= refLow) return '表现优秀';
      if (cons <= refLow + 1.2) return '表现良好';
      return '油耗偏高';
    },

    refLow: function (veh) { return refLowOf(veh || Store.vehicle()); },

    refBase: function (disp, turbo) { return refBase(disp, turbo); },

    clampOffset: clampOffset,

    MAX_OFFSET: 2,

    REF_DISPS: REF_DISPS
  };

  w.Oil = {
    KEY: KEY,
    FUELS: FUELS,
    Store: Store,
    Calc: Calc,
    util: {
      pad2: pad2, todayStr: todayStr, nowTime: nowTime, uid: uid, num: num,
      round: round, fmt: fmt, esc: esc, parseDate: parseDate,
      daysBetween: daysBetween, shortDate: shortDate, slashDate: slashDate
    }
  };
})(window);

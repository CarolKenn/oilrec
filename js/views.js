/* ============================================================
   views.js — 各页面渲染
   ============================================================ */
(function (w) {
  'use strict';

  var U = w.Oil.util;
  var Store = w.Oil.Store;
  var Calc = w.Oil.Calc;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function v0(x) { return x === null || x === undefined ? '--' : String(Math.round(x)); }
  function v1(x) { return x === null || x === undefined ? '--' : String(U.round(x, 1)); }
  function v2(x) { return x === null || x === undefined ? '--' : String(U.round(x, 2)); }
  function v11(x) { return x === null || x === undefined ? '--' : Number(x).toFixed(1); }

  function statItem(label, value, unit, opts) {
    opts = opts || {};
    return '<div class="stat-item">' +
      '<div class="stat-label">' + label +
      (opts.hint ? '<button class="q" data-action="hint" data-hint="' + U.esc(opts.hint) + '">?</button>' : '') +
      '</div>' +
      '<div class="stat-value' + (opts.acc ? ' is-acc' : '') + '">' + value + '</div>' +
      '<div class="stat-unit">' + unit + '</div>' +
      '</div>';
  }

  var Views = {
    /* ---------------- 首页 ---------------- */
    home: function () {
      var veh = Store.vehicle();
      $('#vehName').textContent = veh ? veh.name : '默认车辆';

      var items = Calc.index(Store.records());
      var range = w.App.state.ranges.home;
      var label = Calc.rangeLabel(range);
      $$('[data-range-label="home"]').forEach(function (el) { el.textContent = label; });

      var s = Calc.summarize(items, range);
      var settings = Store.settings();

      // 最新油耗
      var last = Calc.latest(items);
      $('#latestValue').textContent = last ? v2(last.cons) : '--';
      $('#latestRate').textContent = last ? Calc.rating(last.cons, items.length, settings.refLow) : '暂不能评级';

      // 统计
      $('#statGrid').innerHTML =
        statItem('平均油耗', v11(s.avgCons), '升/百公里', { acc: true, hint: '两次加满之间的加油量 ÷ 行驶里程 × 100' }) +
        statItem('平均行程', v2(s.perDay), '公里/天', { hint: '区间内总行驶里程 ÷ 天数' }) +
        statItem('平均油费', v11(s.perKm), '元/公里', { acc: true }) +
        statItem('统计里程', v0(s.distance), '公里') +
        statItem('累计油费', v0(s.cost), '元') +
        statItem('总计优惠', v0(s.discount), '元');

      // 参考线
      var refLow = settings.refLow;
      $('#refLegend').textContent = (settings.region || '内江市') + '油耗参考-低位';

      w.Chart.line($('#trendChart'), {
        points: Calc.trend(items, range),
        refLow: refLow
      });

      var barYear = w.App.state.ranges.bar.year || String(new Date().getFullYear());
      $$('[data-range-label="bar"]').forEach(function (el) { el.textContent = barYear; });
      w.Chart.bar($('#barChart'), {
        data: Calc.monthly(items, barYear),
        year: barYear
      });
    },

    /* ---------------- 详单 ---------------- */
    list: function () {
      var items = Calc.index(Store.records());
      var asc = items;
      var desc = items.slice().reverse();
      var range = w.App.state.ranges.list;
      var label = Calc.rangeLabel(range);
      $$('[data-range-label="list"]').forEach(function (el) { el.textContent = label; });

      var s = Calc.summarize(asc, range);
      var strip = [
        { k: '累计花费', v: v0(s.cost), u: '元', acc: true },
        { k: '平均油耗', v: v2(s.avgCons), u: '升/百公里', acc: true },
        { k: '累计行程', v: v0(s.distance), u: '公里' },
        { k: '加油次数', v: String(s.count), u: '次' },
        { k: '加油量', v: v0(s.fuel), u: '升' }
      ];
      $('#summaryStrip').innerHTML = strip.map(function (it) {
        return '<div class="strip-item"><div class="k">' + it.k + '</div>' +
          '<div class="v' + (it.acc ? ' is-acc' : '') + '">' + it.v + '</div>' +
          '<div class="u">' + it.u + '</div></div>';
      }).join('');

      var rows = desc.filter(function (r) { return Calc.inRange(r, range); });
      if (!rows.length) {
        $('#recList').innerHTML = '<div class="empty"><b>这个区间还没有记录</b>点击底部 ＋ 记一笔加油</div>';
        return;
      }
      var expanded = w.App.state.expanded;
      var avg = s.avgCons;

      $('#recList').innerHTML = rows.map(function (r) {
        var open = expanded[r.id];
        var high = (r.cons !== null && avg !== null && r.cons > avg + 0.9);
        return '<article class="rec' + (open ? ' open' : '') + '" data-id="' + r.id + '">' +
          '<button class="rec-head" data-action="toggle-rec" data-id="' + r.id + '">' +
            '<span class="rec-bar"></span>' +
            '<span class="rec-date">' + U.slashDate(r.date) + '</span>' +
            '<span class="rec-cons' + (high ? ' high' : '') + '">' + (r.cons === null ? '--' : v2(r.cons)) +
            '<em>' + (r.cons === null && !r.fullTank ? '未加满' : '升/百公里') + '</em></span>' +
            '<span class="rec-odo">' + v1(r.odometer) + '<em>公里</em></span>' +
            '<svg class="ico ico-xs chev"><use href="#i-chevron-down"/></svg>' +
          '</button>' +
          '<div class="rec-body">' +
            '<div class="rec-detail">' +
              '<div class="d-col"><b>' + v2(r.payAmount || r.amount) + '元</b>' +
                '<span>' + (r.volume ? v2(U.round((r.payAmount || r.amount) / r.volume, 2)) : '--') + '元/升</span>' +
                '<i>' + U.esc(r.fuelType || '95#汽油') + (r.station ? ' · ' + U.esc(r.station) : '') + '</i>' +
              '</div>' +
              '<div class="d-col" style="text-align:center"><b>+' + v2(r.volume) + '升</b>' +
                '<span>' + (r.amount ? v2(r.amount) + '元机显' : '--') + '</span>' +
              '</div>' +
              '<div class="d-col" style="text-align:right"><b>' + (r.dist === null ? '--' : '+' + v1(r.dist)) + '公里</b>' +
                '<span>' + (r.fullTank ? '已跳枪' : '未跳枪') + '</span>' +
              '</div>' +
              '<button class="rec-edit" data-action="edit-rec" data-id="' + r.id + '" aria-label="编辑">' +
                '<svg class="ico"><use href="#i-edit"/></svg></button>' +
            '</div>' +
            '<div class="rec-sum" data-action="edit-rec" data-id="' + r.id + '">' +
              '<span>' + (r.costPerKm === null ? '--' : v2(r.costPerKm)) + '元/公里</span>' +
              '<span>' + (r.volume ? v2(r.volume) + '升' : '--') + '</span>' +
              '<span>' + (r.dist === null ? '--' : '+' + v2(r.dist) + '公里') + '</span>' +
              '<svg class="ico ico-xs"><use href="#i-chevron-right"/></svg>' +
            '</div>' +
          '</div>' +
        '</article>';
      }).join('');
    },

    /* ---------------- 我的 ---------------- */
    me: function () {
      var db = Store.db;
      var veh = Store.vehicle();
      var items = Calc.index(Store.records());
      $('#meVehName').textContent = veh ? veh.name : '默认车辆';
      $('#meSub').textContent = '共 ' + items.length + ' 条加油记录 · ' +
        (items.length ? v0(items[items.length - 1].odometer) + ' 公里' : '还没有记录');

      // 主题 / 强调色
      $$('#segTheme button').forEach(function (b) {
        b.classList.toggle('on', b.dataset.val === db.settings.theme);
      });
      $$('#accentList .accent-item').forEach(function (b) {
        b.classList.toggle('on', b.dataset.val === db.settings.accent);
      });

      $('#regionText').textContent = db.settings.region || '内江市';
      $('#refText').textContent = v1(db.settings.refLow) + ' 升/百公里';

      // 车辆
      $('#vehicleRows').innerHTML = db.vehicles.map(function (v) {        var cur = v.id === db.currentVehicleId;
        return '<button class="row" data-action="switch-vehicle" data-id="' + v.id + '">' +
          '<div class="row-main"><b>' + U.esc(v.name) + (cur ? ' · 当前' : '') + '</b>' +
          '<span>' + (cur ? '正在使用' : '点击切换') + '</span></div>' +
          (cur ? '<svg class="ico ico-xs" style="color:var(--acc)"><use href="#i-target"/></svg>' : '') +
          '</button>';
      }).join('');
    },

    /* ---------------- 记账 ---------------- */
    entry: function (rec) {
      var veh = Store.vehicle();
      var title = $('#entryTitle');
      title.textContent = veh ? veh.name : '默认车辆';
      $('#saveBtn').textContent = rec ? '保存修改' : '保存';

      var items = Calc.index(Store.records());
      var prev = null;
      if (rec) {
        for (var i = 0; i < items.length; i++) {
          if (items[i].id === rec.id) { prev = i > 0 ? items[i - 1] : null; break; }
        }
      } else if (items.length) {
        prev = items[items.length - 1];
      }

      $('#prevHint').textContent = prev
        ? '上一条 ' + U.shortDate(prev.date) + '：' + v1(prev.odometer) + ' 公里'
        : '还没有历史记录，这是第一条';

      var last = items.length ? items[items.length - 1] : null;
      $('#fDate').value = rec ? rec.date : U.todayStr();
      $('#fTime').value = rec ? (rec.time || '08:00') : U.nowTime();
      $('#fOdo').value = rec ? rec.odometer : '';
      $('#fPrice').value = rec ? rec.unitPrice : (last ? last.unitPrice : '');
      $('#fVolume').value = rec ? rec.volume : '';
      $('#fAmount').value = rec ? rec.amount : '';
      $('#fPayPrice').value = rec ? (rec.payPrice || '') : '';
      $('#fDiscount').value = rec ? (rec.discount || '') : '';
      $('#fPayAmount').value = rec ? (rec.payAmount || '') : '';
      $('#fStation').value = rec ? (rec.station || '') : '';
      $('#fNote').value = rec ? (rec.note || '') : '';

      var fuelSel = $('#fFuel');
      fuelSel.innerHTML = w.Oil.FUELS.map(function (f) {
        return '<option value="' + f + '">' + f + '</option>';
      }).join('');
      fuelSel.value = (rec && rec.fuelType) || (last && last.fuelType) || '95#汽油';

      setSeg('#segFull', rec ? (rec.fullTank ? '1' : '0') : '1');
      setSeg('#segWarn', rec ? (rec.warnLight ? '1' : '0') : '0');
      setSeg('#segLast', rec ? (rec.lastRecorded === false ? '0' : '1') : '1');

      var box = $('#photoBox');
      if (rec && rec.photo) {
        box.classList.add('has-photo');
        box.style.backgroundImage = 'url(' + rec.photo + ')';
        box.innerHTML = '';
      } else {
        box.classList.remove('has-photo');
        box.style.backgroundImage = '';
        box.innerHTML = '<svg class="ico"><use href="#i-plus"/></svg>';
      }

      w.App.state.entryTouched = {
        amount: rec ? Math.abs(rec.amount - rec.unitPrice * rec.volume) > 0.02 : false,
        pay: rec ? Math.abs(rec.payAmount - (rec.amount - (rec.discount || 0))) > 0.02 : false
      };
      $('#entryScroll').scrollTop = 0;
    }
  };

  function setSeg(sel, val) {
    $$(sel + ' button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.val === val);
    });
  }

  w.Views = Views;
  w.$ = $;
  w.$$ = $$;
})(window);

/* ============================================================
   app.js — 路由 / 交互 / 弹窗
   ============================================================ */
(function (w) {
  'use strict';

  var U = w.Oil.util;
  var Store = w.Oil.Store;
  var Calc = w.Oil.Calc;
  var $ = w.$;
  var $$ = w.$$;

  // 记账表单里参与联动的六个数字项
  var NUM_FIELDS = ['fPrice', 'fVolume', 'fAmount', 'fPayPrice', 'fDiscount', 'fPayAmount'];

  var App = {
    state: {
      view: 'home',
      ranges: {
        home: { type: 'all' },
        list: { type: 'year', year: String(new Date().getFullYear()) },
        bar: { type: 'year', year: String(new Date().getFullYear()) }
      },
      stats: { mode: 'month', ym: '', year: '', from: '', to: '' },
      engineCtx: null,
      expanded: {},
      editing: null,
      photo: '',
      entryAuto: {},
      entrySeq: {},
      entryTick: 0,
      rangeCtx: null,
      confirmCb: null
    },

    /* ---------------- 启动 ---------------- */
    init: function () {
      Store.init();
      this.applyTheme();
      this.initRanges();
      this.initStats();
      this.bind();
      try { history.replaceState({ view: 'home' }, ''); } catch (e) { /* noop */ }
      this.go('home');
      var self = this;
      w.addEventListener('popstate', function (e) {
        var v = (e.state && e.state.view) || 'home';
        self.state.editing = null;
        self.go(v, { fromHistory: true });
      });
      var timer = null;
      w.addEventListener('resize', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          if (self.state.view === 'home') w.Views.home();
        }, 180);
      });
      w.addEventListener('orientationchange', function () {
        setTimeout(function () { if (self.state.view === 'home') w.Views.home(); }, 320);
      });
    },

    initRanges: function () {
      var items = Calc.index(Store.records());
      var years = Calc.years(items);
      var y = years[0] || String(new Date().getFullYear());
      this.state.ranges.list = { type: 'year', year: y };
      this.state.ranges.bar = { type: 'year', year: y };
    },

    initStats: function () {
      var items = Calc.index(Store.records());
      var last = items.length ? items[items.length - 1] : null;
      var now = new Date();
      var ym = last ? String(last.date).slice(0, 7) : (now.getFullYear() + '-' + U.pad2(now.getMonth() + 1));
      var st = this.state.stats;
      st.ym = ym;
      st.year = ym.slice(0, 4);
      if (!st.from || !st.to) {
        st.from = ym + '-01';
        st.to = U.todayStr();
      }
      if (st.from > st.to) { var t = st.from; st.from = st.to; st.to = t; }
    },

    shiftStats: function (dir) {
      var st = this.state.stats;
      if (st.mode === 'month') {
        var y = +String(st.ym).slice(0, 4), m = +String(st.ym).slice(5, 7) - 1 + dir;
        var d = new Date(y, m, 1);
        st.ym = d.getFullYear() + '-' + U.pad2(d.getMonth() + 1);
      } else if (st.mode === 'year') {
        st.year = String(+st.year + dir);
      }
      w.Views.stats();
    },

    applyTheme: function () {
      var s = Store.settings();
      document.documentElement.dataset.theme = s.theme || 'light';
      document.documentElement.dataset.accent = s.accent || 'green';
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', (s.theme === 'dark') ? '#161a1f' : '#95bfdd');
    },

    /* ---------------- 路由 ---------------- */
    go: function (view, opts) {
      opts = opts || {};
      var changed = this.state.view !== view;
      if (changed && this.state.view) this.state.prevView = this.state.view;
      if (view === 'entry' && !this.state.editing && changed) {
        /* 从底部“加油”进入 = 新增；已经在记录页时点同一个 tab 不清空表单 */
        this.state.photo = '';
        w.Views.entry(null);
      }
      this.state.view = view;
      $$('.view').forEach(function (v) {
        v.classList.toggle('active', v.dataset.view === view);
      });
      $$('.tab').forEach(function (t) {
        var on = t.dataset.view === view || (view === 'stats' && t.dataset.view === 'me');
        t.classList.toggle('active', on);
      });
      this.render(view);
      var sc = $('.view.active');
      if (sc && view !== 'entry') sc.scrollTop = 0;
      if (changed && !opts.fromHistory) {
        try { history.pushState({ view: view }, ''); } catch (e) { /* noop */ }
      }
    },

    render: function (view) {
      view = view || this.state.view;
      if (view === 'home') w.Views.home();
      else if (view === 'list') w.Views.list();
      else if (view === 'me') w.Views.me();
      else if (view === 'stats') w.Views.stats();
    },

    toast: function (msg) {
      var el = $('#toast');
      el.textContent = msg;
      el.classList.add('show');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1900);
    },

    /* ---------------- 事件 ---------------- */
    bind: function () {
      var self = this;
      document.addEventListener('click', function (e) {
        var el = e.target.closest ? e.target.closest('[data-action]') : null;
        if (!el) return;
        var act = el.dataset.action;
        if (act === 'go') {
          self.state.editing = null;
          if (el.dataset.view === 'entry') self.state.photo = '';
          self.go(el.dataset.view);
          return;
        }
        if (act === 'new-record') {
          self.state.editing = null;
          self.state.photo = '';
          w.Views.entry(null);
          self.go('entry');
          return;
        }
        if (act === 'entry-back') {
          self.state.editing = null;
          self.go(self.state.prevView === 'entry' ? 'list' : (self.state.prevView || 'list'));
          return;
        }
        if (act === 'pick-vehicle') { self.openVehicles(); return; }
        if (act === 'switch-vehicle') { self.switchVehicle(el.dataset.id); return; }
        if (act === 'add-vehicle') { self.prompt('添加车辆', '', function (name) { self.addVehicle(name); }); return; }
        if (act === 'rename-vehicle') { self.renameVehicle(el.dataset.id); return; }
        if (act === 'pick-range') { self.openRange(el.dataset.scope); return; }
        if (act === 'range-cancel' || act === 'modal-close') { self.closeAll(); return; }
        if (act === 'range-ok') { self.applyRange(); return; }
        if (act === 'toggle-rec') { self.toggleRec(el.dataset.id); return; }
        if (act === 'edit-rec') { self.editRec(el.dataset.id); return; }
        if (act === 'save-record') { self.saveRecord(); return; }
        if (act === 'open-menu') { self.openMenu(false); return; }
        if (act === 'record-menu') { self.openMenu(true); return; }
        if (act === 'export-xlsx') { self.closeAll(); w.Export.excel(Store); self.toast('已生成 Excel 文件'); return; }
        if (act === 'export-json') { self.closeAll(); w.Export.json(Store); self.toast('已导出 JSON 备份'); return; }
        if (act === 'import-file') { self.closeAll(); $('#importInput').click(); return; }
        if (act === 'clear-all') { self.closeAll(); self.clearAll(); return; }
        if (act === 'pick-photo') { $('#photoInput').click(); return; }
        if (act === 'hint') { self.toast(el.dataset.hint || ''); return; }
        if (act === 'edit-engine') { self.openEngine(); return; }
        if (act === 'engine-cancel') { $('#engineModal').hidden = true; return; }
        if (act === 'engine-ok') { self.applyEngine(); return; }
        if (act === 'stats-back') { self.go('me'); return; }
        if (act === 'stats-prev') { self.shiftStats(-1); return; }
        if (act === 'stats-next') { self.shiftStats(1); return; }
        if (act === 'strip') {
          var box = $('#summaryStrip');
          box.scrollLeft += (+el.dataset.dir) * 150;
          return;
        }
        if (act === 'cancel-confirm') { self.hideConfirm(); return; }
        if (act === 'ok-confirm') {
          var cb = self.state.confirmCb;
          self.hideConfirm();
          if (cb) cb();
          return;
        }
      });

      /* 分段按钮 */
      document.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('.seg button') : null;
        if (!b) return;
        $$('button', b.parentNode).forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        if (b.parentNode.id === 'segFull') w.Views.fullHint(b.dataset.val === '1');
      });

      /* 主题 / 强调色 */
      $('#segTheme').addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        Store.settings().theme = b.dataset.val;
        Store.persist();
        self.applyTheme();
        self.render();
      });
      $('#accentList').addEventListener('click', function (e) {
        var b = e.target.closest('.accent-item');
        if (!b) return;
        Store.settings().accent = b.dataset.val;
        Store.persist();
        self.applyTheme();
        w.Views.me();
        self.toast('强调色已切换');
      });

      /* 车辆参数弹窗：进气形式 & 微调（事件委托，只绑定一次） */
      var engineModal = $('#engineModal');
      if (engineModal) {
        engineModal.addEventListener('click', function (e) {
          var ctx = self.state.engineCtx;
          if (!ctx) return;
          var step = e.target.closest('.offset-btn');
          if (step) {
            if (step.disabled) return;
            ctx.offset = Calc.clampOffset(ctx.offset + (+step.dataset.step));
            self.syncEngine();
            return;
          }
          var asp = e.target.closest('#segAsp button');
          if (asp) {
            ctx.turbo = asp.dataset.val === 'turbo';
            self.syncEngine();
          }
        });
      }

      /* 我的统计：模式切换 & 自定义区间 */
      var segStats = $('#segStats');
      if (segStats) {
        segStats.addEventListener('click', function (e) {
          var b = e.target.closest('button');
          if (!b || !b.dataset.val) return;
          var st = self.state.stats;
          st.mode = b.dataset.val;
          if (st.mode === 'custom' && (!st.from || !st.to)) {
            st.from = st.ym + '-01';
            st.to = U.todayStr();
          }
          w.Views.stats();
        });
      }
      ['#statsFrom', '#statsTo'].forEach(function (sel) {
        var el = $(sel);
        if (!el) return;
        el.addEventListener('change', function () {
          var st = self.state.stats;
          st.from = $('#statsFrom').value || st.from;
          st.to = $('#statsTo').value || st.to;
          if (st.from > st.to) self.toast('开始日期不能晚于结束日期');
          w.Views.stats();
        });
      });

      /* 记账表单联动：任意一项改动，其余项自动补全 */
      var scroll = $('#entryScroll');
      scroll.addEventListener('input', function (e) {
        var id = e.target.id;
        if (NUM_FIELDS.indexOf(id) >= 0) self.linkEntry(id);
      });
      scroll.addEventListener('focusin', function (e) {
        var el = e.target;
        if (el.tagName === 'INPUT' && el.type === 'text') {
          // 程序算出来的数字，点进去就全选，直接输入即可覆盖
          if (self.state.entryAuto[el.id] && el.value) {
            try { el.select(); } catch (err) { /* noop */ }
          }
          setTimeout(function () {
            try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (err) { /* noop */ }
          }, 260);
        }
      });

      /* 图片 */
      $('#photoInput').addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        self.compressImage(file, 900, 0.62).then(function (data) {
          if (!data) { self.toast('图片处理失败'); return; }
          self.state.photo = data;
          var box = $('#photoBox');
          box.classList.add('has-photo');
          box.style.backgroundImage = 'url(' + data + ')';
          box.innerHTML = '';
        });
        e.target.value = '';
      });

      /* 导入 */
      $('#importInput').addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        w.Export.readFile(file, function (res) {
          if (res.error) { self.toast(res.error); return; }
          var n = res.records.length;
          self.confirm('恢复数据', '将导入 ' + n + ' 条记录并替换当前车辆的全部记录，车辆与设置保留。', function () {
            var ok = Store.importJSON(res.records);
            if (!ok) { self.toast('文件中没有可用记录'); return; }
            self.initRanges();
            self.initStats();
            self.render();
            self.toast('已导入 ' + n + ' 条记录');
          });
        });
        e.target.value = '';
      });

      /* 弹窗遮罩 & esc */
      $$('.modal-mask, .sheet-mask').forEach(function (m) {
        m.addEventListener('click', function () { self.closeAll(); });
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') self.closeAll();
      });
    },

    /* ---------------- 记账数值联动 ----------------
       三条关系：单价 × 加油量 = 金额；金额 − 优惠 = 实付金额；实付金额 ÷ 加油量 = 实付单价。
       规则：以用户亲手输入的那两项为准，剩下的一项自动补齐；
       程序填的数每轮重新推算，推算不出来就清空，不会把中间过程留下的数字当成事实。 */
    linkEntry: function (anchor) {
      var st = this.state;
      var auto = st.entryAuto;
      var seq = st.entrySeq;
      var v = function (id) { return U.num($('#' + id).value); };
      var has = function (id) { return v(id) > 0; };
      var wrote = {};
      var keep = {};

      // 记住“这一项是人填的、第几个填的”；清空则取消标记
      if ($('#' + anchor).value.trim() !== '') seq[anchor] = ++st.entryTick;
      else delete seq[anchor];

      var write = function (id, x) {
        if (id === anchor || !isFinite(x) || !(x > 0)) return false;
        $('#' + id).value = x.toFixed(2);
        auto[id] = true;
        wrote[id] = true;
        return true;
      };

      /* 一、单价 / 加油量 / 金额：知道任意两个就补第三个 */
      var G1 = ['fPrice', 'fVolume', 'fAmount'];
      var inG1 = G1.indexOf(anchor) >= 0;

      if (inG1) {
        // 优先拿另一个“人填的”当已知量，其次才是程序填的，避免半截数字带偏
        var cand = G1.filter(function (id) { return id !== anchor && has(id); });
        var users1 = cand.filter(function (id) { return seq[id]; })
          .sort(function (a, b) { return seq[b] - seq[a]; });
        var partner = users1[0] || null;
        if (!partner) {
          var pref = ['fVolume', 'fPrice'].filter(function (id) { return cand.indexOf(id) >= 0; });
          partner = pref[0] || cand[0] || null;
        }
        if (partner) {
          keep[partner] = true;
          var target = G1.filter(function (id) { return id !== anchor && id !== partner; })[0];
          var out = target === 'fAmount' ? v('fPrice') * v('fVolume')
            : target === 'fVolume' ? v('fAmount') / v('fPrice')
              : v('fAmount') / v('fVolume');
          // 算不出来就地清掉，别让下游拿上一轮的过期数字继续推
          if (!write(target, out) && auto[target]) {
            $('#' + target).value = '';
            delete auto[target];
          }
        }
      } else {
        // 改的是实付侧：机显三项原样保留，只在缺一项时补齐
        if (!has('fAmount') && has('fPrice') && has('fVolume')) write('fAmount', v('fPrice') * v('fVolume'));
        else if (!has('fVolume') && has('fPrice') && has('fAmount')) write('fVolume', v('fAmount') / v('fPrice'));
        else if (!has('fPrice') && has('fVolume') && has('fAmount')) write('fPrice', v('fAmount') / v('fVolume'));
        G1.forEach(function (id) { if (has(id)) keep[id] = true; });
      }

      var V = v('fVolume');
      var A = v('fAmount');

      /* 二、实付：以最近一次亲手输入的那项为准（实付单价 / 优惠 / 实付金额） */
      var pick = null;
      ['fPayPrice', 'fDiscount', 'fPayAmount'].forEach(function (id) {
        if (seq[id] && has(id) && (pick === null || seq[id] > seq[pick])) pick = id;
      });

      if (A > 0) {
        if (pick === 'fPayPrice') {
          if (V > 0) {
            var pa1 = v('fPayPrice') * V;
            if (write('fPayAmount', pa1)) write('fDiscount', A - pa1);
          }
        } else if (pick === 'fDiscount') {
          var pa2 = A - v('fDiscount');
          if (write('fPayAmount', pa2) && V > 0) write('fPayPrice', pa2 / V);
        } else if (pick === 'fPayAmount') {
          var pa3 = v('fPayAmount');
          write('fDiscount', A - pa3);
          if (V > 0) write('fPayPrice', pa3 / V);
        } else {
          // 实付侧一个字都没填：默认按原价付款，用户改实付金额后优惠会自动出来
          write('fPayAmount', A);
          if (V > 0) write('fPayPrice', A / V);
        }
      }

      /* 三、上一轮自动填、这一轮已经算不出来的项，清空避免留下过期数字 */
      NUM_FIELDS.forEach(function (id) {
        if (id === anchor || wrote[id] || keep[id]) return;
        if (auto[id]) { $('#' + id).value = ''; delete auto[id]; delete seq[id]; }
      });

      delete auto[anchor];
    },

    /* ---------------- 记录操作 ---------------- */
    toggleRec: function (id) {
      var ex = this.state.expanded;
      if (ex[id]) delete ex[id];
      else ex[id] = true;
      w.Views.list();
    },

    editRec: function (id) {
      var rec = Store.record(id);
      if (!rec) return;
      this.state.editing = rec;
      this.state.photo = rec.photo || '';
      w.Views.entry(rec);
      this.go('entry');
    },

    saveRecord: function () {
      var self = this;
      var date = $('#fDate').value;
      var time = $('#fTime').value || '08:00';
      var odo = U.num($('#fOdo').value);
      var volume = U.num($('#fVolume').value);
      var price = U.num($('#fPrice').value);
      var amount = U.num($('#fAmount').value);
      var discount = U.num($('#fDiscount').value);
      var payAmount = U.num($('#fPayAmount').value);
      var payPrice = U.num($('#fPayPrice').value);

      if (!date) { self.toast('请选择加油日期'); return; }
      if (!odo) { self.toast('请填写当前里程'); return; }
      if (!volume) { self.toast('请填写加油量'); return; }

      var others = Store.records().filter(function (r) {
        return !self.state.editing || r.id !== self.state.editing.id;
      }).sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
      var prev = null;
      others.forEach(function (r) { if (r.date <= date) prev = r; });
      if (prev && odo <= prev.odometer) {
        self.toast('里程需大于 ' + U.shortDate(prev.date) + ' 的 ' + Math.round(prev.odometer) + ' 公里');
        return;
      }
      var dup = others.filter(function (r) { return Math.abs(r.odometer - odo) < 0.05; });
      if (dup.length) { self.toast('该里程已存在一条记录'); return; }

      if (!amount) amount = U.round(price * volume, 2);
      if (!amount && payAmount) amount = U.round(payAmount + discount, 2);
      if (discount > amount) discount = U.round(amount, 2);   // 优惠不可能超过机显金额
      if (!payAmount) payAmount = U.round(amount - discount, 2);
      if (!payAmount) payAmount = amount;
      if (!amount) amount = payAmount;
      if (!payPrice && volume && payAmount) payPrice = U.round(payAmount / volume, 2);
      if (!price && volume && amount) price = U.round(amount / volume, 2);
      if (!price) price = payPrice;

      var rec = {
        id: self.state.editing ? self.state.editing.id : U.uid(),
        vehicleId: Store.db.currentVehicleId,
        date: date,
        time: time,
        odometer: U.round(odo, 1),
        unitPrice: price,
        volume: volume,
        amount: U.round(amount, 2),
        discount: U.round(discount, 2),
        payPrice: payPrice,
        payAmount: U.round(payAmount, 2),
        fullTank: $('#segFull').querySelector('.on').dataset.val === '1',
        warnLight: $('#segWarn').querySelector('.on').dataset.val === '1',
        lastRecorded: $('#segLast').querySelector('.on').dataset.val === '1',
        station: $('#fStation').value.trim(),
        fuelType: $('#fFuel').value,
        note: $('#fNote').value.trim(),
        photo: self.state.photo || (self.state.editing ? self.state.editing.photo : '') || '',
        createdAt: self.state.editing ? self.state.editing.createdAt : Date.now()
      };

      Store.saveRecord(rec);
      self.state.editing = null;
      self.state.photo = '';
      self.state.expanded[rec.id] = true;
      var r = self.state.ranges.list;
      if (r.type === 'year' && r.year !== date.slice(0, 4)) r.year = date.slice(0, 4);
      self.toast('已保存');
      self.go('list');
    },

    /* ---------------- 车辆 ---------------- */
    openVehicles: function () {
      var db = Store.db;
      $('#vehicleList').innerHTML = db.vehicles.map(function (v) {
        var cur = v.id === db.currentVehicleId;
        return '<div class="vsheet-item">' +
          '<button class="vsheet-pick" data-action="switch-vehicle" data-id="' + v.id + '">' +
          '<b>' + U.esc(v.name) + '</b>' +
          (cur ? '<span>当前</span><svg class="ico"><use href="#i-target"/></svg>' : '') +
          '</button>' +
          '<button class="vsheet-edit" data-action="rename-vehicle" data-id="' + v.id + '" aria-label="重命名">' +
          '<svg class="ico ico-xs"><use href="#i-edit"/></svg></button>' +
          '</div>';
      }).join('');
      $('#vehicleSheet').hidden = false;
    },

    renameVehicle: function (id) {
      var self = this;
      var v = Store.vehicle(id);
      if (!v) return;
      this.prompt('车辆名称', v.name, function (name) {
        Store.updateVehicle(id, { name: name });
        self.closeAll();
        self.render();
        self.toast('已重命名');
      });
    },

    switchVehicle: function (id) {
      Store.setVehicle(id);
      this.closeAll();
      this.state.editing = null;
      this.state.expanded = {};
      this.initRanges();
      this.initStats();
      this.render();
      this.toast('已切换到 ' + (Store.vehicle() || {}).name);
    },

    addVehicle: function (name) {
      Store.addVehicle(name || '新车辆');
      this.initRanges();
      this.render();
      this.toast('已添加车辆');
    },

    /* ---------------- 车辆参数（排量 / 进气形式 / 微调） ---------------- */
    openEngine: function () {
      this.closeAll();
      var veh = Store.vehicle() || {};
      var eng = veh.engine || { disp: 2.0, turbo: false, offset: 0 };
      var ctx = this.state.engineCtx = {
        disp: Number(eng.disp).toFixed(1),
        turbo: !!eng.turbo,
        offset: Calc.clampOffset(eng.offset)
      };

      $('#dispChips').innerHTML = Calc.REF_DISPS.map(function (d) {
        return '<button type="button" class="chip" data-disp="' + d.toFixed(1) + '">' + d.toFixed(1) + ' L</button>';
      }).join('');

      var self = this;
      $$('#dispChips .chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
          ctx.disp = chip.dataset.disp;
          self.syncEngine();
        });
      });

      this.syncEngine();
      $('#engineModal').hidden = false;
    },

    syncEngine: function () {
      var ctx = this.state.engineCtx;
      if (!ctx) return;
      var max = Calc.MAX_OFFSET;

      $$('#dispChips .chip').forEach(function (c) {
        c.classList.toggle('on', c.dataset.disp === String(ctx.disp));
      });
      $$('#segAsp button').forEach(function (b) {
        b.classList.toggle('on', (b.dataset.val === 'turbo') === ctx.turbo);
      });

      var base = Calc.refBase(ctx.disp, ctx.turbo);
      var off = Calc.clampOffset(ctx.offset);
      var val = Math.round((base + off) * 10) / 10;

      var ov = $('#offsetVal');
      ov.textContent = off === 0 ? '0' : (off > 0 ? '+' : '−') + Math.abs(off).toFixed(1);
      ov.classList.toggle('off-zero', off === 0);

      $$('#engineModal .offset-btn').forEach(function (b) {
        var step = +b.dataset.step;
        b.disabled = (step > 0 && off >= max) || (step < 0 && off <= -max);
      });

      $('#enginePreview').textContent = val.toFixed(1);

      var hint = $('#engineHint');
      hint.hidden = off === 0;
      if (off !== 0) {
        hint.textContent = '基础值 ' + Number(base).toFixed(1) + '，微调 ' +
          (off > 0 ? '+' : '−') + Math.abs(off).toFixed(1) + ' → ' + val.toFixed(1) + ' 升/百公里';
      }
    },

    applyEngine: function () {
      var ctx = this.state.engineCtx;
      if (!ctx) return;
      var veh = Store.vehicle();
      if (!veh) return;
      Store.updateVehicle(veh.id, {
        engine: { disp: ctx.disp, turbo: ctx.turbo, offset: Calc.clampOffset(ctx.offset) }
      });
      $('#engineModal').hidden = true;
      this.render();
      this.toast('参考低位油耗已更新为 ' + Number(Calc.refLow(veh)).toFixed(1) + ' 升/百公里');
    },

    /* ---------------- 区间选择 ---------------- */
    openRange: function (scope) {
      this.closeAll();
      var items = Calc.index(Store.records());
      var years = Calc.years(items).slice(0, 4);
      var cur = this.state.ranges[scope] || { type: 'all' };
      this.state.rangeCtx = {
        scope: scope,
        type: cur.type || 'all',
        year: cur.year || years[0],
        from: cur.from || '',
        to: cur.to || ''
      };
      var ctx = this.state.rangeCtx;

      var html = years.map(function (y) {
        return '<button class="chip" data-year="' + y + '">' + y + '年</button>';
      }).join('');
      if (scope !== 'bar') {
        html += '<button class="chip" data-custom="1">自定义<span class="vip">VIP</span></button>';
        html += '<button class="chip" data-all="1">全部</button>';
      } else if (ctx.type !== 'year') {
        ctx.type = 'year';
        ctx.year = years[0];
      }
      $('#rangeChips').innerHTML = html;

      $('#rangeFrom').value = ctx.from || '';
      $('#rangeTo').value = ctx.to || '';
      $('#customRange').hidden = ctx.type !== 'custom';

      var self = this;
      $$('#rangeChips .chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
          $$('#rangeChips .chip').forEach(function (c) { c.classList.remove('on'); });
          chip.classList.add('on');
          if (chip.dataset.year) { ctx.type = 'year'; ctx.year = chip.dataset.year; }
          else if (chip.dataset.custom) { ctx.type = 'custom'; }
          else { ctx.type = 'all'; }
          $('#customRange').hidden = ctx.type !== 'custom';
        });
      });

      var target = null;
      $$('#rangeChips .chip').forEach(function (chip) {
        var on = (ctx.type === 'year' && chip.dataset.year === String(ctx.year)) ||
          (ctx.type === 'custom' && chip.dataset.custom) ||
          (ctx.type === 'all' && chip.dataset.all);
        if (on) { chip.classList.add('on'); target = chip; }
      });
      if (!target) {
        var first = $('#rangeChips .chip');
        if (first) { first.classList.add('on'); ctx.type = 'year'; ctx.year = first.dataset.year; }
      }
      $('#rangeTitle').textContent = '请选择';
      $('#rangeModal').hidden = false;
    },

    applyRange: function () {
      var ctx = this.state.rangeCtx;
      if (!ctx) return;
      var range;
      if (ctx.type === 'custom') {
        var from = $('#rangeFrom').value;
        var to = $('#rangeTo').value;
        if (!from || !to) { this.toast('请选择起止日期'); return; }
        if (from > to) { this.toast('开始日期不能晚于结束日期'); return; }
        range = { type: 'custom', from: from, to: to };
      } else if (ctx.type === 'year') {
        range = { type: 'year', year: String(ctx.year) };
      } else {
        range = { type: 'all' };
      }
      this.state.ranges[ctx.scope] = range;
      this.closeAll();
      this.render();
    },

    /* ---------------- 菜单 / 确认 ---------------- */
    openMenu: function (withDelete) {
      var sheet = $('#menuSheet');
      var body = sheet.querySelector('.sheet-body');
      if (withDelete) {
        var extra = document.createElement('button');
        extra.dataset.action = 'delete-record';
        extra.className = 'danger';
        extra.textContent = '删除本条记录';
        if (!body.querySelector('[data-action="delete-record"]')) body.insertBefore(extra, body.firstChild);
      } else {
        var old = body.querySelector('[data-action="delete-record"]');
        if (old) old.remove();
      }
      sheet.hidden = false;
    },

    deleteCurrent: function () {
      var self = this;
      if (!this.state.editing) return;
      var id = this.state.editing.id;
      this.closeAll();
      this.confirm('删除记录', '删除后无法恢复，确定删除这条加油记录吗？', function () {
        Store.deleteRecord(id);
        self.state.editing = null;
        self.toast('已删除');
        self.go('list');
      });
    },

    clearAll: function () {
      var self = this;
      this.confirm('清空所有记录', '将删除当前车辆的全部加油记录，且无法恢复。建议先导出备份。', function () {
        Store.clearRecords();
        self.state.expanded = {};
        self.initRanges();
        self.render();
        self.toast('已清空当前车辆的记录');
      });
    },

    confirm: function (title, desc, cb) {
      this.state.confirmCb = cb;
      $('#confirmTitle').textContent = title;
      $('#confirmDesc').textContent = desc;
      $('#confirmModal').hidden = false;
    },

    hideConfirm: function () {
      $('#confirmModal').hidden = true;
      this.state.confirmCb = null;
    },

    closeAll: function () {
      $('#rangeModal').hidden = true;
      $('#engineModal').hidden = true;
      $('#vehicleSheet').hidden = true;
      $('#menuSheet').hidden = true;
      if (!this.state.confirmCb) $('#confirmModal').hidden = true;
    },

    /* ---------------- 文本输入弹窗 ---------------- */
    prompt: function (title, value, cb) {
      var self = this;
      var modal = document.createElement('div');
      modal.className = 'modal';
      modal.innerHTML =
        '<div class="modal-mask"></div>' +
        '<div class="modal-card">' +
        '<h3 class="modal-title">' + U.esc(title) + '</h3>' +
        '<input type="text" class="prompt-input" value="' + U.esc(value || '') + '" placeholder="请输入名称" />' +
        '<div class="modal-actions">' +
        '<button class="btn-ghost" data-x="cancel">取消</button>' +
        '<button class="btn-primary" data-x="ok">确定</button>' +
        '</div></div>';
      $('#phone').appendChild(modal);

      var input = modal.querySelector('.prompt-input');
      var style = document.createElement('style');
      style.textContent = '.prompt-input{width:100%;height:44px;border:1px solid var(--line-2);border-radius:10px;' +
        'padding:0 12px;font-size:16px;background:var(--card-2);outline:0;color:var(--text)}' +
        '.prompt-input:focus{border-color:var(--acc)}';
      modal.appendChild(style);

      setTimeout(function () { input.focus(); input.select(); }, 60);

      function close() { modal.remove(); }
      modal.addEventListener('click', function (e) {
        if (e.target.classList.contains('modal-mask')) return close();
        var b = e.target.closest('[data-x]');
        if (!b) return;
        if (b.dataset.x === 'ok') {
          var v = input.value.trim();
          if (!v) { self.toast('请输入名称'); return; }
          close();
          cb(v);
        } else close();
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          var v = input.value.trim();
          if (!v) { self.toast('请输入名称'); return; }
          close();
          cb(v);
        }
      });
    },

    /* ---------------- 图片压缩 ---------------- */
    compressImage: function (file, max, quality) {
      return new Promise(function (resolve) {
        var img = new Image();
        var url = URL.createObjectURL(file);
        img.onload = function () {
          var scale = Math.min(1, max / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          var ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          try { resolve(c.toDataURL('image/jpeg', quality)); } catch (e) { resolve(''); }
        };
        img.onerror = function () { URL.revokeObjectURL(url); resolve(''); };
        img.src = url;
      });
    }
  };

  /* 删除记录挂在点击代理里 */
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-action="delete-record"]') : null;
    if (b) App.deleteCurrent();
  });

  w.App = App;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { App.init(); });
  } else {
    App.init();
  }
})(window);

/* ============================================================
   charts.js — 轻量 SVG 图表（折线 / 柱状）
   ============================================================ */
(function (w) {
  'use strict';

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    v = (v || '').trim();
    return v || fallback;
  }
  function niceStep(range, target) {
    var raw = range / target;
    var pow = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / pow;
    var step;
    if (norm <= 1) step = 1;
    else if (norm <= 2) step = 2;
    else if (norm <= 2.5) step = 2.5;
    else if (norm <= 5) step = 5;
    else step = 10;
    return step * pow;
  }
  function money(v) {
    if (!isFinite(v)) return '';
    return Math.abs(v % 1) < 0.005 ? String(Math.round(v)) : v.toFixed(2);
  }
  function axisNum(v) {
    if (!isFinite(v)) return '';
    return Math.abs(v % 1) < 0.05 ? String(Math.round(v)) : v.toFixed(1);
  }
  function txt(x, y, str, opts) {
    opts = opts || {};
    return '<text x="' + x + '" y="' + y + '" fill="' + (opts.fill || '#9ca3af') +
      '" font-size="' + (opts.size || 10) + '" text-anchor="' + (opts.anchor || 'middle') +
      '" font-family="-apple-system,PingFang SC,sans-serif"' +
      (opts.weight ? ' font-weight="' + opts.weight + '"' : '') + '>' + str + '</text>';
  }

  var Chart = {
    line: function (el, opts) {
      if (!el) return;
      var points = opts.points || [];
      var W = Math.max(240, Math.round(el.clientWidth || 320));
      var H = Math.round(el.clientHeight || 200);
      if (!points.length) {
        el.innerHTML = '<div class="chart-empty">' + (opts.empty || '暂无油耗数据') + '</div>';
        return;
      }
      var acc = cssVar('--acc', '#45b97c');
      var gridColor = cssVar('--line-2', '#e4e7eb');
      var refLow = opts.refLow;
      var padL = 38, padR = 12, padT = 14, padB = 26;
      var iw = W - padL - padR;
      var ih = H - padT - padB;

      var vals = points.map(function (p) { return p.value; });
      var mn = Math.min.apply(null, vals);
      var mx = Math.max.apply(null, vals);
      if (typeof refLow === 'number') { mn = Math.min(mn, refLow); mx = Math.max(mx, refLow); }
      if (mx - mn < 0.8) { mx += 0.5; mn -= 0.5; }
      var step = niceStep(mx - mn, 4);
      var yMin = Math.floor(mn / step) * step;
      var yMax = Math.ceil(mx / step) * step;
      if (yMax - yMin < step * 2) yMax = yMin + step * 2;

      function xAt(i) {
        if (points.length === 1) return padL + iw / 2;
        return padL + (iw * i) / (points.length - 1);
      }
      function yAt(v) {
        return padT + ih - ((v - yMin) / (yMax - yMin)) * ih;
      }

      var svg = [];
      svg.push('<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="油耗变化趋势">');

      // 横向网格 + y 轴刻度
      var ticks = Math.round((yMax - yMin) / step);
      for (var t = 0; t <= ticks; t++) {
        var v = yMin + step * t;
        var y = yAt(v);
        svg.push('<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y +
          '" stroke="' + gridColor + '" stroke-width="1" stroke-dasharray="5 6"/>');
        svg.push(txt(padL - 6, y + 3.5, v.toFixed(2), { anchor: 'end', fill: cssVar('--text-3', '#9ca3af') }));
      }

      // 参考线
      if (typeof refLow === 'number' && refLow >= yMin && refLow <= yMax) {
        var ry = yAt(refLow);
        svg.push('<line x1="' + padL + '" y1="' + ry + '" x2="' + (W - padR) + '" y2="' + ry +
          '" stroke="' + cssVar('--ref-line', '#cbd0d8') + '" stroke-width="1.4" stroke-dasharray="7 6"/>');
      }

      // 折线
      var d = points.map(function (p, i) {
        return (i === 0 ? 'M' : 'L') + xAt(i).toFixed(1) + ' ' + yAt(p.value).toFixed(1);
      }).join(' ');
      svg.push('<path d="' + d + '" fill="none" stroke="' + acc + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>');

      // 数据点
      points.forEach(function (p, i) {
        svg.push('<circle cx="' + xAt(i).toFixed(1) + '" cy="' + yAt(p.value).toFixed(1) +
          '" r="3.2" fill="' + acc + '"/>');
      });

      // x 轴标签
      var idxs = points.length === 1 ? [0] : [0, Math.floor((points.length - 1) / 2), points.length - 1];
      var used = {};
      idxs.forEach(function (i, k) {
        if (used[i]) return;
        used[i] = 1;
        var anchor = k === 0 ? 'start' : (k === idxs.length - 1 ? 'end' : 'middle');
        var x = xAt(i) + (k === 0 ? 0 : 0);
        svg.push(txt(x, H - 8, escText(points[i].date), {
          anchor: anchor, size: 10, fill: cssVar('--text-3', '#9ca3af')
        }));
      });

      svg.push('</svg>');
      el.innerHTML = svg.join('');
    },

    bar: function (el, opts) {
      if (!el) return;
      var data = opts.data || [];
      var W = Math.max(240, Math.round(el.clientWidth || 320));
      var H = Math.round(el.clientHeight || 200);
      var total = data.reduce(function (a, b) { return a + b.value; }, 0);
      if (!total) {
        el.innerHTML = '<div class="chart-empty">' + (opts.year || '') + ' 年暂无支出数据</div>';
        return;
      }
      var acc = cssVar('--blue', '#4a90d9');
      var gridColor = cssVar('--line-2', '#e4e7eb');
      var padL = 42, padR = 10, padT = 20, padB = 26;
      var iw = W - padL - padR;
      var ih = H - padT - padB;

      var mx = Math.max.apply(null, data.map(function (d) { return d.value; }));
      var step = niceStep(mx * 1.08, 4);
      var yMax = Math.ceil((mx * 1.08) / step) * step;
      if (yMax <= 0) yMax = step * 2;

      function yAt(v) { return padT + ih - (v / yMax) * ih; }

      var svg = [];
      svg.push('<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="月度油费统计">');

      var ticks = Math.round(yMax / step);
      for (var t = 0; t <= ticks; t++) {
        var v = step * t;
        var y = yAt(v);
        svg.push('<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y +
          '" stroke="' + gridColor + '" stroke-width="1" stroke-dasharray="5 6"/>');
        svg.push(txt(padL - 6, y + 3.5, axisNum(v), { anchor: 'end', fill: cssVar('--text-3', '#9ca3af') }));
      }

      var slot = iw / 12;
      var barW = Math.min(20, slot * 0.56);
      var labels = [];
      data.forEach(function (d, i) {
        var cx = padL + slot * i + slot / 2;
        if (d.value > 0) {
          var h = Math.max(2, (d.value / yMax) * ih);
          var x = cx - barW / 2;
          var y = padT + ih - h;
          var r = Math.min(2.5, barW / 3);
          var path = 'M' + x + ' ' + (y + r) + 'q0 -' + r + ' ' + r + ' -' + r +
            'h' + (barW - 2 * r) + 'q' + r + ' 0 ' + r + ' ' + r +
            'v' + (h - r) + 'h-' + barW + 'z';
          svg.push('<path d="' + path + '" fill="' + acc + '"/>');
          labels.push({ cx: cx, y: y - 5, text: String(Math.round(d.value)), value: d.value });
        }
        svg.push(txt(cx, H - 8, d.month + '月', { size: 9.5, fill: cssVar('--text-3', '#9ca3af') }));
      });

      /* 数值标签：按月顺序排，挤不下就往上叠一层，保证每个有数据的月份都能显示 */
      labels.sort(function (a, b) { return a.cx - b.cx; });
      var rows = [[], [], []];
      var textColor = cssVar('--text-2', '#6b7280');
      labels.forEach(function (lb) {
        var w = lb.text.length * 5 + 2;
        var l = lb.cx - w / 2, r = l + w;
        var row = 2;
        for (var k = 0; k < rows.length; k++) {
          var hit = false;
          for (var i = 0; i < rows[k].length; i++) {
            if (!(r < rows[k][i][0] || l > rows[k][i][1])) { hit = true; break; }
          }
          if (!hit) { row = k; break; }
        }
        rows[row].push([l, r]);
        var ty = Math.max(9, lb.y - row * 10.5);
        svg.push(txt(lb.cx, ty, lb.text, { size: 9, fill: textColor }));
      });

      svg.push('</svg>');
      el.innerHTML = svg.join('');
    }
  };

  function escText(s) {
    return String(s || '').replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }

  w.Chart = Chart;
})(window);

/**
 * TrendChart —— 统计页共用的多系列折线图组件
 *
 * 设计约束(遵循 dataviz 规范):
 *  - 分类色板按固定槽位分配,不循环;超过 8 条折叠为「其他」
 *  - 一条十字准线定位 X,一个 tooltip 列出该日期下所有可见系列(值在前、名在后)
 *  - 图例常驻且可点击开关;Top3 末端直接标注
 *  - 表格视图始终可达(色板对白底有 3 个槽位低于 3:1,规范要求提供 relief)
 *  - 网格/坐标轴为实线细线(不用虚线),容器高度包含 X 轴标签带
 *  - 系列颜色跟随实体(key),筛选后不重新着色
 *
 * 用法:
 *   TrendChart.render(document.getElementById('x'), {
 *     dates: ['2026-09-01', ...],           // 升序日期字符串
 *     series: [{ key, label, values: [n, n, ...] }],  // values 与 dates 等长
 *     valueLabel: '篇',
 *   });
 */
(function (global) {
  'use strict';

  var t = I18n.t;   // 不用全局 t:compromise.js 会覆盖它

  var MAX_SERIES = 8;

  /* 颜色一律从 CSS 变量读,不写死 —— 深色模式用的是同一组色相的另一档步进
     (见 css/theme.css,两套都过了 validate_palette.js)。每次绘制时重新读,
     所以切主题只要重画就会自动跟上。 */
  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function palette() {
    return ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8']
      .map(function (n, i) { return cssVar(n, ['#2a78d6','#eb6834','#1baf7a','#eda100',
                                               '#e87ba4','#008300','#4a3aa7','#e34948'][i]); });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;   // 标签是不可信数据,一律 textContent
    return n;
  }

  /** 超出 MAX_SERIES 的系列合并为「其他」,并为每个系列固定分配颜色槽位。 */
  function foldSeries(series) {
    var ranked = series.slice().sort(function (a, b) { return total(b) - total(a); });
    var kept = ranked.slice(0, MAX_SERIES);
    var rest = ranked.slice(MAX_SERIES);
    var PAL = palette();
    kept.forEach(function (s, i) { s.color = PAL[i]; s.slot = i; });
    if (rest.length) {
      var n = kept.length ? kept[0].values.length : 0;
      var merged = { key: '__other__', label: t('chart.other', { n: rest.length }), color: cssVar('--c-other', '#8a8f98'),
                     slot: MAX_SERIES, isOther: true, members: rest.map(function (s) { return s.label; }),
                     values: new Array(n).fill(0) };
      rest.forEach(function (s) {
        s.values.forEach(function (v, i) { merged.values[i] += v; });
      });
      kept.push(merged);
    }
    return kept;
  }

  function total(s) {
    return s.values.reduce(function (a, b) { return a + b; }, 0);
  }

  function tickFormatFor(dates) {
    var a = dates[0], b = dates[dates.length - 1];
    if (a.slice(0, 4) !== b.slice(0, 4)) return function (d) { return d; };
    if (a.slice(5, 7) !== b.slice(5, 7)) return function (d) { return d.slice(5); };
    return function (d) { return d.slice(8); };
  }

  function render(host, cfg) {
    if (!host) return;
    var dates = (cfg.dates || []).slice();
    var raw = (cfg.series || []).filter(function (s) { return s && total(s) > 0; });
    var unit = cfg.valueLabel || '';

    host.innerHTML = '';
    host.classList.add('tc-host');

    if (!dates.length || !raw.length) {
      host.appendChild(el('p', 'tc-empty', cfg.emptyText || t('chart.empty')));
      return;
    }
    if (dates.length === 1) {
      host.appendChild(el('p', 'tc-empty', t('chart.needTwoDays')));
      return;
    }

    var series = foldSeries(raw);
    var hidden = Object.create(null);          // key -> true 表示被图例关掉
    if (cfg.collapseOtherByDefault) hidden['__other__'] = true;

    // ---- DOM 骨架 ----
    var toolbar = el('div', 'tc-toolbar');
    var viewBtn = el('button', 'tc-viewbtn', t('chart.table'));
    viewBtn.type = 'button';
    viewBtn.setAttribute('aria-pressed', 'false');
    toolbar.appendChild(viewBtn);

    var plot = el('div', 'tc-plot');
    plot.tabIndex = 0;
    plot.setAttribute('role', 'img');
    plot.setAttribute('aria-label', t('chart.aria', {
      title: cfg.title || '', n: series.length,
      from: dates[0], to: dates[dates.length - 1]
    }));
    var tableWrap = el('div', 'tc-table-wrap');
    tableWrap.hidden = true;
    var legend = el('div', 'tc-legend');

    host.appendChild(toolbar);
    host.appendChild(plot);
    host.appendChild(tableWrap);
    host.appendChild(legend);

    var tip = el('div', 'tc-tip');
    tip.hidden = true;
    plot.appendChild(tip);

    // ---- 图例(常驻,可点击开关) ----
    series.forEach(function (s) {
      var item = el('button', 'tc-legend-item');
      item.type = 'button';
      item.setAttribute('aria-pressed', 'true');
      var key = el('span', 'tc-key');
      key.style.background = s.color;
      item.appendChild(key);
      item.appendChild(el('span', 'tc-legend-label', s.label));
      item.appendChild(el('span', 'tc-legend-total', String(total(s))));
      if (s.isOther) item.title = s.members.join('、');
      if (hidden[s.key]) {
        item.classList.add('is-off');
        item.setAttribute('aria-pressed', 'false');
      }
      item.addEventListener('click', function () {
        var visible = series.filter(function (x) { return !hidden[x.key]; });
        if (!hidden[s.key] && visible.length === 1) return;   // 至少留一条
        hidden[s.key] = !hidden[s.key];
        item.classList.toggle('is-off', !!hidden[s.key]);
        item.setAttribute('aria-pressed', hidden[s.key] ? 'false' : 'true');
        draw();
      });
      item.addEventListener('mouseenter', function () { focusKey = s.key; paintEmphasis(); });
      item.addEventListener('mouseleave', function () { focusKey = null; paintEmphasis(); });
      legend.appendChild(item);
    });

    // ---- 表格视图(tooltip 之外的第二条读数路径) ----
    (function buildTable() {
      var t = el('table', 'tc-table');
      var thead = el('thead');
      var hr = el('tr');
      hr.appendChild(el('th', 'tc-th-date', t('chart.date')));
      series.forEach(function (s) {
        var th = el('th');
        var k = el('span', 'tc-key');
        k.style.background = s.color;
        th.appendChild(k);
        th.appendChild(document.createTextNode(s.label));
        hr.appendChild(th);
      });
      thead.appendChild(hr);
      t.appendChild(thead);
      var tb = el('tbody');
      dates.forEach(function (d, i) {
        var tr = el('tr');
        tr.appendChild(el('th', 'tc-th-date', d));
        series.forEach(function (s) { tr.appendChild(el('td', null, String(s.values[i] || 0))); });
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      tableWrap.appendChild(t);
    })();

    viewBtn.addEventListener('click', function () {
      var showTable = plot.hidden === false;
      plot.hidden = showTable;
      tableWrap.hidden = !showTable;
      viewBtn.textContent = showTable ? t('chart.chart') : t('chart.table');
      viewBtn.setAttribute('aria-pressed', showTable ? 'true' : 'false');
      if (!showTable) draw();
    });

    // ---- 绘制 ----
    var focusKey = null;      // 图例 hover 强调
    var activeIdx = -1;       // 十字准线所在日期索引
    var svg = null, geom = null;

    function visibleSeries() {
      return series.filter(function (s) { return !hidden[s.key]; });
    }

    function paintEmphasis() {
      if (!svg) return;
      svg.selectAll('.tc-line')
        .style('opacity', function (d) { return (!focusKey || d.key === focusKey) ? 1 : 0.18; })
        .style('stroke-width', function (d) { return (focusKey && d.key === focusKey) ? 3 : 2; });
      svg.selectAll('.tc-endlabel')
        .style('opacity', function (d) { return (!focusKey || d.key === focusKey) ? 1 : 0.18; });
    }

    function draw() {
      if (plot.hidden) return;
      var width = plot.clientWidth;
      if (!width) return;

      var vis = visibleSeries();
      var narrow = width < 620;
      // 右侧留白给末端直标;窄屏不标注,只留 12px
      var m = { top: 14, right: narrow ? 14 : 108, bottom: 34, left: 44 };
      var innerW = Math.max(80, width - m.left - m.right);
      var innerH = 260;
      var height = innerH + m.top + m.bottom;   // 容器高度包含 X 轴标签带

      plot.style.height = height + 'px';
      d3.select(plot).selectAll('svg').remove();

      var root = d3.select(plot).append('svg')
        .attr('width', width).attr('height', height)
        .attr('class', 'tc-svg');
      svg = root.append('g').attr('transform', 'translate(' + m.left + ',' + m.top + ')');

      var x = d3.scalePoint().domain(dates).range([0, innerW]);
      var maxV = d3.max(vis, function (s) { return d3.max(s.values); }) || 1;
      var y = d3.scaleLinear().domain([0, maxV]).nice(4).range([innerH, 0]);

      // 水平网格:实线细线,比表面深一档
      svg.append('g').attr('class', 'tc-grid')
        .call(d3.axisLeft(y).ticks(4).tickSize(-innerW).tickFormat(''))
        .call(function (g) {
          g.select('.domain').remove();
          g.selectAll('line').attr('stroke', cssVar('--chart-grid', '#eceff4'));
        });

      // 坐标轴
      var fmt = tickFormatFor(dates);
      var maxTicks = Math.max(2, Math.floor(innerW / (narrow ? 46 : 62)));
      var step = Math.ceil(dates.length / maxTicks);
      var shown = dates.filter(function (d, i) { return i % step === 0 || i === dates.length - 1; });

      svg.append('g').attr('class', 'tc-axis')
        .attr('transform', 'translate(0,' + innerH + ')')
        .call(d3.axisBottom(x).tickValues(shown).tickFormat(fmt).tickSize(0).tickPadding(9))
        .call(function (g) { g.select('.domain').attr('stroke', cssVar('--chart-grid', '#eceff4')); });

      svg.append('g').attr('class', 'tc-axis')
        .call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(8))
        .call(function (g) { g.select('.domain').remove(); });

      var line = d3.line()
        .x(function (d, i) { return x(dates[i]); })
        .y(function (d) { return y(d); })
        .curve(d3.curveMonotoneX);    // 单调插值:曲线必过数据点,不会凭空造出峰谷

      svg.selectAll('.tc-line').data(vis, function (d) { return d.key; })
        .enter().append('path')
        .attr('class', 'tc-line')
        .attr('d', function (d) { return line(d.values); })
        .style('fill', 'none')
        .style('stroke', function (d) { return d.color; })
        .style('stroke-width', 2)
        .style('stroke-linecap', 'round')
        .style('stroke-linejoin', 'round');

      // 末端直标:只标 Top3,避免「每个点都有数字」
      if (!narrow) {
        var labeled = vis.slice().sort(function (a, b) { return total(b) - total(a); }).slice(0, 3);
        var placed = [];
        labeled.forEach(function (s) {
          var yy = y(s.values[s.values.length - 1]);
          while (placed.some(function (p) { return Math.abs(p - yy) < 13; })) yy += 13;
          placed.push(yy);
          svg.append('text')
            .datum(s)
            .attr('class', 'tc-endlabel')
            .attr('x', innerW + 8)
            .attr('y', Math.min(innerH, Math.max(8, yy)))
            .attr('dy', '0.32em')
            .text(s.label.length > 11 ? s.label.slice(0, 10) + '…' : s.label);
        });
      }

      // ---- 十字准线 + 统一 tooltip ----
      var hair = svg.append('line').attr('class', 'tc-hair')
        .attr('y1', 0).attr('y2', innerH).style('opacity', 0);
      var dotsG = svg.append('g');

      geom = { x: x, y: y, m: m, innerW: innerW, innerH: innerH, vis: vis, hair: hair, dotsG: dotsG };

      var hit = root.append('rect')
        .attr('x', m.left).attr('y', m.top)
        .attr('width', innerW).attr('height', innerH)
        .style('fill', 'transparent').style('cursor', 'crosshair');

      hit.on('pointermove', function (event) {
        var px = d3.pointer(event, svg.node())[0];
        var i = Math.round((px / innerW) * (dates.length - 1));
        setActive(Math.max(0, Math.min(dates.length - 1, i)));
      }).on('pointerleave', function () { setActive(-1); });

      paintEmphasis();
      if (activeIdx >= 0) setActive(activeIdx);
    }

    /** 移动十字准线到第 i 天;i<0 表示隐藏。键盘与指针共用同一路径。 */
    function setActive(i) {
      activeIdx = i;
      if (!geom) return;
      if (i < 0) {
        geom.hair.style('opacity', 0);
        geom.dotsG.selectAll('*').remove();
        tip.hidden = true;
        return;
      }
      var xp = geom.x(dates[i]);
      geom.hair.attr('x1', xp).attr('x2', xp).style('opacity', 1);

      // 命中点:8px 标记 + 2px 表面色描边(重叠时仍可分辨)
      var pts = geom.vis.map(function (s) { return { s: s, v: s.values[i] || 0 }; });
      var sel = geom.dotsG.selectAll('circle').data(pts, function (d) { return d.s.key; });
      sel.enter().append('circle').merge(sel)
        .attr('cx', xp).attr('cy', function (d) { return geom.y(d.v); })
        .attr('r', 4)
        .style('fill', function (d) { return d.s.color; })
        .style('stroke', cssVar('--surface', '#ffffff')).style('stroke-width', 2);
      sel.exit().remove();

      // tooltip:值在前,系列名在后;系列用短线条作键(不用色块)
      tip.innerHTML = '';
      tip.appendChild(el('div', 'tc-tip-date', dates[i]));
      pts.slice().sort(function (a, b) { return b.v - a.v; }).forEach(function (p) {
        var row = el('div', 'tc-tip-row');
        var k = el('span', 'tc-tip-key');
        k.style.background = p.s.color;
        row.appendChild(k);
        row.appendChild(el('span', 'tc-tip-val', String(p.v) + (unit ? ' ' + unit : '')));
        row.appendChild(el('span', 'tc-tip-name', p.s.label));
        tip.appendChild(row);
      });
      tip.hidden = false;

      // 靠右时把 tooltip 翻到准线左侧,避免溢出卡片
      var left = geom.m.left + xp + 14;
      if (left + tip.offsetWidth > plot.clientWidth - 4) left = geom.m.left + xp - tip.offsetWidth - 14;
      tip.style.left = Math.max(4, left) + 'px';
      tip.style.top = geom.m.top + 'px';
    }

    plot.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        var next = activeIdx < 0 ? 0 : activeIdx + (e.key === 'ArrowRight' ? 1 : -1);
        setActive(Math.max(0, Math.min(dates.length - 1, next)));
      } else if (e.key === 'Escape') {
        setActive(-1);
      }
    });
    plot.addEventListener('blur', function () { setActive(-1); });

    draw();

    if (global.ResizeObserver) {
      var ro = new ResizeObserver(function () { draw(); });
      ro.observe(plot);
      host.__tcObserver = ro;
    }
  }

  global.TrendChart = { render: render, palette: palette, MAX_SERIES: MAX_SERIES };
})(window);

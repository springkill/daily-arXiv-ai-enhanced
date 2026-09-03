/**
 * 统计视图 —— 概览数字 + 主方向/子方向/关键词三张趋势图 + 关键词榜
 *
 * 日期范围由外壳(Store)统一提供;jsonl 原文走 Store 缓存,
 * 从论文页切过来不会重新下载。绘图统一交给 js/trend-chart.js。
 */
(function (global) {
  'use strict';

  var t = I18n.t;   // 不用全局 t:compromise.js 会覆盖它

  // 主方向显示名由 js/i18n.js 提供(随语言切换)


  var STOP = new Set(['the','is','at','which','and','or','in','to','for','of','with','by','on',
    'this','that','our','method','based','towards','via','multi','text','using','aware','data',
    'from','paper','propose','proposed','approach','model','system','framework','results','show',
    'demonstrates','experimental','experiments','evaluation','performance','state','art','sota',
    'dataset','datasets','task','tasks','learning','neural','network','networks','deep','machine',
    'artificial','intelligence','ai','ml','dl']);

  var taxonomy = null;
  var renderedRange = null;
  var papers = [];        // {date, primary, tags[], score, deep, title, summary, url, authors}

  function primaryLabel(c) { return I18n.category(c); }

  function subLabel(id) {
    if (taxonomy && Array.isArray(taxonomy.sub)) {
      var hit = taxonomy.sub.find(function (s) { return s && s.id === id; });
      if (hit && hit.label) return hit.label;
    }
    return id;   // 标签库还没到位就先显示 id,总比空着强
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ------------------------------------------------------- 关键词抽取 --- */

  function extractKeywords(text) {
    var clean = text.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    var doc = nlp(clean);
    var terms = new Set();

    doc.match('#Noun+').forEach(function (m) {
      var p = m.text().toLowerCase();
      if (p.split(' ').length <= 3) terms.add(p);
    });
    doc.match('(#Adjective+ #Noun+)').forEach(function (m) {
      var p = m.text().toLowerCase();
      if (p.split(' ').length <= 3) terms.add(p);
    });

    var freq = {};
    Array.from(terms).forEach(function (term) {
      var words = term.split(' ');
      if (!words.every(function (w) { return w.length > 2; })) return;
      if (words.every(function (w) { return STOP.has(w); })) return;
      freq[term] = (freq[term] || 0) + (term.indexOf(' ') >= 0 ? 1.5 : 1);   // 多词短语加权
    });

    return Object.keys(freq)
      .sort(function (a, b) { return freq[b] - freq[a]; })
      .slice(0, 10);
  }

  /* ------------------------------------------------------------ 取数 --- */

  async function loadTaxonomy() {
    if (taxonomy) return taxonomy;
    // 活的标签库是各人自己跑出来的(gitignore);还没跑过就退回仓库自带的种子,
    // 否则图例会显示 t162007 这种内部 id。
    var urls = ['assets/trend-taxonomy.json', 'assets/trend-taxonomy.seed.json'];
    for (var i = 0; i < urls.length; i++) {
      try {
        var res = await fetch(DATA_CONFIG.getDataUrl(urls[i]), { cache: 'no-store' });
        if (res.ok) { taxonomy = await res.json(); return taxonomy; }
      } catch (e) { /* 试下一个 */ }
    }
    console.warn('[stats] taxonomy unavailable; sub-directions will show raw ids');
    return taxonomy;
  }

  function parse(text, date) {
    var out = [];
    text.trim().split('\n').forEach(function (line) {
      if (!line) return;
      try {
        var p = JSON.parse(line);
        if (!p.categories) return;
        var cats = Array.isArray(p.categories) ? p.categories : [p.categories];
        out.push({
          date: date,
          primary: cats[0],
          tags: Array.isArray(p.trend_tags) ? p.trend_tags : [],
          score: typeof p.relevance_score === 'number' ? p.relevance_score : null,
          deep: p.deep === true,
          title: p.title || '',
          summary: (p.AI && p.AI.tldr) ? p.AI.tldr : (p.summary || ''),
          authors: Array.isArray(p.authors) ? p.authors.join(', ') : (p.authors || ''),
          url: p.abs || ('https://arxiv.org/abs/' + p.id)
        });
      } catch (e) { /* 跳过坏行 */ }
    });
    return out;
  }

  /* ------------------------------------------------------------ 渲染 --- */

  function build(dates) {
    var catCount = new Map(), dateCat = new Map();
    var subCount = new Map(), dateSub = new Map();
    var kwCount = new Map(), dateKw = new Map();
    dates.forEach(function (d) {
      dateCat.set(d, new Map()); dateSub.set(d, new Map()); dateKw.set(d, new Map());
    });

    papers.forEach(function (p) {
      catCount.set(p.primary, (catCount.get(p.primary) || 0) + 1);
      var dc = dateCat.get(p.date);
      if (dc) dc.set(p.primary, (dc.get(p.primary) || 0) + 1);

      p.tags.forEach(function (tag) {
        subCount.set(tag, (subCount.get(tag) || 0) + 1);
        var ds = dateSub.get(p.date);
        if (ds) ds.set(tag, (ds.get(tag) || 0) + 1);
      });

      // 关键词按论文自己的日期归属。旧版用「下标 ÷ 平均每日篇数」反推日期,
      // 各日篇数不等(278~830)且数组是按类别拼的,画出来是噪声。
      extractKeywords(p.title).forEach(function (k) {
        kwCount.set(k, (kwCount.get(k) || 0) + 1);
        var dk = dateKw.get(p.date);
        if (dk) dk.set(k, (dk.get(k) || 0) + 1);
      });
    });

    return { catCount: catCount, dateCat: dateCat, subCount: subCount,
             dateSub: dateSub, kwCount: kwCount, dateKw: dateKw };
  }

  function series(countMap, dateMap, dates, labelFn) {
    return Array.from(countMap.entries())
      .filter(function (e) { return e[1] > 0; })
      .map(function (e) {
        return {
          key: e[0],
          label: labelFn ? labelFn(e[0]) : e[0],
          values: dates.map(function (d) { return (dateMap.get(d) || new Map()).get(e[0]) || 0; })
        };
      });
  }

  function render() {
    var dates = Store.datesInRange();
    var agg = build(dates);
    var host = document.getElementById('papersList');

    var scored = papers.filter(function (p) { return p.score !== null; });
    var hit = scored.filter(function (p) { return p.score >= 6; }).length;
    var deep = papers.filter(function (p) { return p.deep; }).length;
    var topCat = Array.from(agg.catCount.entries()).sort(function (a, b) { return b[1] - a[1]; })[0];
    var perDay = dates.length ? Math.round(papers.length / dates.length) : 0;

    var tiles = [
      { label: t('stats.total'), value: papers.length.toLocaleString(),
        hint: t('stats.totalHint', { days: dates.length, perDay: perDay }) },
      { label: t('stats.hit'), value: hit.toLocaleString(),
        hint: scored.length ? t('stats.hitHint', { pct: Math.round(hit / scored.length * 100) })
                            : t('stats.noScore') },
      { label: t('stats.deep'), value: deep.toLocaleString(),
        hint: hit > deep ? t('stats.deepHint', { n: hit - deep }) : t('stats.deepAll') },
      { label: t('stats.topCat'), value: topCat ? primaryLabel(topCat[0]) : '—',
        hint: topCat ? t('stats.topCatHint', { n: topCat[1],
              pct: Math.round(topCat[1] / papers.length * 100) }) : '' }
    ];

    var kwTop = Array.from(agg.kwCount.entries())
      .filter(function (e) { return e[1] > 1; })
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, 24);

    host.innerHTML =
      '<div class="stats-shell">' +
        '<div class="stat-tiles">' + tiles.map(function (tile) {
          return '<div class="stat-tile"><div class="stat-tile-label">' + esc(tile.label) + '</div>' +
                 '<div class="stat-tile-value">' + esc(tile.value) + '</div>' +
                 '<div class="stat-tile-hint">' + esc(tile.hint) + '</div></div>';
        }).join('') + '</div>' +

        card(t('stats.primaryTitle'), t('stats.primaryDesc'), 'primaryTrendChart') +
        card(t('stats.subTitle'), t('stats.subDesc'), 'subTrendChart') +
        card(t('stats.kwTitle'), t('stats.kwDesc'), 'trendChart') +

        '<section class="chart-card"><div class="chart-head"><h2>' + esc(t('stats.kwListTitle')) + '</h2>' +
        '<p>' + esc(t('stats.kwListDesc')) + '</p></div>' +
        '<div class="keyword-list" id="kwList">' + kwTop.map(function (k, i) {
          return '<button type="button" class="keyword-item" data-kw="' + esc(k[0]) + '">' +
                 '<span class="keyword-rank">' + (i + 1) + '</span>' +
                 '<span class="keyword-text">' + esc(k[0]) + '</span>' +
                 '<span class="keyword-count">' + k[1] + '</span></button>';
        }).join('') + '</div></section>' +
      '</div>';

    document.getElementById('kwList').addEventListener('click', function (e) {
      var b = e.target.closest('.keyword-item');
      if (b) showRelated(b.dataset.kw);
    });

    TrendChart.render(document.getElementById('primaryTrendChart'), {
      dates: dates, valueLabel: t('stats.unitPapers'), title: t('stats.primaryTitle'),
      series: series(agg.catCount, agg.dateCat, dates, primaryLabel)
    });
    TrendChart.render(document.getElementById('subTrendChart'), {
      dates: dates, valueLabel: t('stats.unitPapers'), title: t('stats.subTitle'),
      // 子方向是长尾(现有 87 个标签),「其他」的合计会把真实系列压成贴地直线。
      // 默认收起,图例上仍带计数可随时点开。
      collapseOtherByDefault: true,
      emptyText: t('stats.subEmpty'),
      series: series(agg.subCount, agg.dateSub, dates, subLabel)
    });
    TrendChart.render(document.getElementById('trendChart'), {
      dates: dates, valueLabel: t('stats.unitTimes'), title: t('stats.kwTitle'),
      series: series(agg.kwCount, agg.dateKw, dates).sort(function (a, b) {
        return b.values.reduce(add, 0) - a.values.reduce(add, 0);
      }).slice(0, 8)
    });
  }

  function add(a, b) { return a + b; }

  function card(title, desc, id) {
    return '<section class="chart-card"><div class="chart-head"><h2>' + title + '</h2>' +
           '<p>' + desc + '</p></div><div id="' + id + '"></div></section>';
  }

  function showRelated(kw) {
    var q = kw.toLowerCase();
    var hits = papers.filter(function (p) {
      return (p.title + ' ' + p.summary).toLowerCase().indexOf(q) >= 0;
    }).slice(0, 100);

    document.getElementById('selectedKeyword').textContent = kw + ' · ' + t('papers.count', { n: hits.length });
    document.getElementById('relatedPapers').innerHTML = hits.length
      ? hits.map(function (p) {
          return '<article class="paper-ref">' +
                 '<a class="paper-ref-title" href="' + esc(p.url) + '" target="_blank" rel="noopener">' +
                 esc(p.title) + '</a>' +
                 '<div class="paper-ref-meta">' + esc(p.date) + ' · ' + esc(p.primary) + '</div>' +
                 '<div class="paper-ref-summary">' + esc(p.summary) + '</div></article>';
        }).join('')
      : '<div class="empty-state"><p>' + esc(t('stats.noRelated')) + '</p></div>';
    document.getElementById('paperSidebar').classList.add('is-open');
  }

  /* ------------------------------------------------------------ 视图 --- */

  async function load() {
    var dates = Store.datesInRange();
    var host = document.getElementById('papersList');
    if (!dates.length) {
      host.innerHTML = '<div class="empty-state"><p>' + esc(t('stats.noData')) + '</p></div>';
      return;
    }
    if (!host.innerHTML) {
      host.innerHTML = '<div class="loading-container"><div class="loading-spinner"></div><p>' + esc(t('stats.computing')) + '</p></div>';
    } else {
      host.classList.add('is-refetching');
    }

    var files = await Store.fetchRange(dates);
    papers = [];
    files.forEach(function (f) { papers = papers.concat(parse(f.text, f.date)); });

    host.classList.remove('is-refetching');
    renderedRange = Store.state.start + '~' + Store.state.end;
    render();
  }

  var autoWidened = false;

  async function init() {
    await loadTaxonomy();

    // 统计页默认落在「最新一天」上时三张趋势图全是空的 —— 一天画不出趋势。
    // 首次进来自动放宽到近 14 天;只做一次,之后完全听用户的。
    if (!autoWidened && Store.state.start === Store.state.end) {
      autoWidened = true;
      var r = Store.presetRange(14);
      if (r && r.start !== r.end) {
        Store.setRange(r.start, r.end);
        if (global.Shell) Shell.syncPickerTo(r);
        return;   // setRange 触发的 rangechange 会调 load(),不用再走一遍
      }
    }

    Store.on('rangechange', function () {
      if (Router.current === 'stats') load();
      else renderedRange = null;
    });

    // 主题变了要重画:线条颜色和网格都来自 CSS 变量
    window.addEventListener('themechange', function () {
      if (Router.current === 'stats' && papers.length) render();
    });

    await load();
  }

  async function show() {
    if (renderedRange !== Store.state.start + '~' + Store.state.end) await load();
  }

  /** 换语言后重画(数据不用重取,标签和文案全变)。 */
  function rerender() { if (papers.length) render(); }

  global.StatsView = { init: init, show: show, rerender: rerender };
})(window);

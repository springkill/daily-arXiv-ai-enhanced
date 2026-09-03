/**
 * 统计视图 —— 概览数字 + 主方向/子方向/关键词三张趋势图 + 关键词榜
 *
 * 日期范围由外壳(Store)统一提供;jsonl 原文走 Store 缓存,
 * 从论文页切过来不会重新下载。绘图统一交给 js/trend-chart.js。
 */
(function (global) {
  'use strict';

  var PRIMARY_LABELS = {
    'cs.CR': '安全与漏洞', 'cs.SE': '软件工程', 'cs.CL': '自然语言处理', 'cs.AI': 'AI',
    'cs.LG': '机器学习', 'cs.DC': '分布式与并行计算', 'cs.AR': '硬件架构',
    'cs.CV': '计算机视觉', 'cs.GR': '图形学', 'cs.DB': '数据库',
    'cs.HC': '人机交互', 'cs.IT': '信息论', 'cs.NE': '神经计算', 'cs.PL': '编程语言',
    'cs.CE': '计算工程', 'cs.RO': '机器人', 'cs.GT': '博弈论', 'cs.CY': '计算机与社会',
    'cs.MA': '多智能体系统'
  };

  var STOP = new Set(['the','is','at','which','and','or','in','to','for','of','with','by','on',
    'this','that','our','method','based','towards','via','multi','text','using','aware','data',
    'from','paper','propose','proposed','approach','model','system','framework','results','show',
    'demonstrates','experimental','experiments','evaluation','performance','state','art','sota',
    'dataset','datasets','task','tasks','learning','neural','network','networks','deep','machine',
    'artificial','intelligence','ai','ml','dl']);

  var taxonomy = null;
  var renderedRange = null;
  var papers = [];        // {date, primary, tags[], score, deep, title, summary, url, authors}

  function primaryLabel(c) { return PRIMARY_LABELS[c] || c; }

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
    Array.from(terms).forEach(function (t) {
      var words = t.split(' ');
      if (!words.every(function (w) { return w.length > 2; })) return;
      if (words.every(function (w) { return STOP.has(w); })) return;
      freq[t] = (freq[t] || 0) + (t.indexOf(' ') >= 0 ? 1.5 : 1);   // 多词短语加权
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
    console.warn('[stats] 标签库都取不到,子方向将显示 id');
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

      p.tags.forEach(function (t) {
        subCount.set(t, (subCount.get(t) || 0) + 1);
        var ds = dateSub.get(p.date);
        if (ds) ds.set(t, (ds.get(t) || 0) + 1);
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
      { label: '论文总数', value: papers.length.toLocaleString(),
        hint: dates.length + ' 天 · 日均 ' + perDay + ' 篇' },
      { label: '高相关 (≥6分)', value: hit.toLocaleString(),
        hint: scored.length ? Math.round(hit / scored.length * 100) + '% 的论文过线' : '本区间无评分' },
      { label: '深度精读', value: deep.toLocaleString(),
        hint: hit > deep ? ('有 ' + (hit - deep) + ' 篇过线但未入选') : '过线论文已全部精读' },
      { label: '最活跃方向', value: topCat ? primaryLabel(topCat[0]) : '—',
        hint: topCat ? (topCat[1] + ' 篇 · 占 ' + Math.round(topCat[1] / papers.length * 100) + '%') : '' }
    ];

    var kwTop = Array.from(agg.kwCount.entries())
      .filter(function (e) { return e[1] > 1; })
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, 24);

    host.innerHTML =
      '<div class="stats-shell">' +
        '<div class="stat-tiles">' + tiles.map(function (t) {
          return '<div class="stat-tile"><div class="stat-tile-label">' + esc(t.label) + '</div>' +
                 '<div class="stat-tile-value">' + esc(t.value) + '</div>' +
                 '<div class="stat-tile-hint">' + esc(t.hint) + '</div></div>';
        }).join('') + '</div>' +

        card('主方向趋势', '按论文首要 arXiv 类别统计每日篇数', 'primaryTrendChart') +
        card('子方向趋势', '按自举标签库打的研究子方向统计;未打标的历史数据不计入', 'subTrendChart') +
        card('关键词趋势', '标题中高频名词短语的每日出现次数', 'trendChart') +

        '<section class="chart-card"><div class="chart-head"><h2>热门关键词</h2>' +
        '<p>点击任意关键词,在侧栏查看包含它的论文</p></div>' +
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
      dates: dates, valueLabel: '篇', title: '主方向趋势',
      series: series(agg.catCount, agg.dateCat, dates, primaryLabel)
    });
    TrendChart.render(document.getElementById('subTrendChart'), {
      dates: dates, valueLabel: '篇', title: '子方向趋势',
      // 子方向是长尾(现有 87 个标签),「其他」的合计会把真实系列压成贴地直线。
      // 默认收起,图例上仍带计数可随时点开。
      collapseOtherByDefault: true,
      emptyText: '所选范围内的论文还没有子方向标签(ai/trend_tagger.py 打标后才有)',
      series: series(agg.subCount, agg.dateSub, dates, subLabel)
    });
    TrendChart.render(document.getElementById('trendChart'), {
      dates: dates, valueLabel: '次', title: '关键词趋势',
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

    document.getElementById('selectedKeyword').textContent = kw + ' · ' + hits.length + ' 篇';
    document.getElementById('relatedPapers').innerHTML = hits.length
      ? hits.map(function (p) {
          return '<article class="paper-ref">' +
                 '<a class="paper-ref-title" href="' + esc(p.url) + '" target="_blank" rel="noopener">' +
                 esc(p.title) + '</a>' +
                 '<div class="paper-ref-meta">' + esc(p.date) + ' · ' + esc(p.primary) + '</div>' +
                 '<div class="paper-ref-summary">' + esc(p.summary) + '</div></article>';
        }).join('')
      : '<div class="empty-state"><p>没有找到相关论文</p></div>';
    document.getElementById('paperSidebar').classList.add('is-open');
  }

  /* ------------------------------------------------------------ 视图 --- */

  async function load() {
    var dates = Store.datesInRange();
    var host = document.getElementById('papersList');
    if (!dates.length) {
      host.innerHTML = '<div class="empty-state"><p>这个日期范围内没有数据</p></div>';
      return;
    }
    if (!host.innerHTML) {
      host.innerHTML = '<div class="loading-container"><div class="loading-spinner"></div><p>统计中…</p></div>';
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

  global.StatsView = { init: init, show: show };
})(window);

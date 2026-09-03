/**
 * 论文视图 —— SPA 的默认视图
 *
 * 与旧版的区别:
 *  - 不再自己管日期。可用日期、当前范围、jsonl 原文缓存都归 Store,
 *    换视图再换回来不会重新下载。
 *  - 不再自举(没有 DOMContentLoaded),由 Router 在首次进入时调用 init()。
 *  - 筛选行移到顶栏下方的 subbar,搜索框常驻(旧版藏在放大镜后面,
 *    多一次点击才能搜,而搜索是这个页面最高频的动作)。
 */
(function (global) {
  'use strict';

  var state = {
    papersByCategory: {},   // 类别 -> 论文数组
    allPapers: [],
    category: 'all',
    sort: 'relevance',      // 'relevance' | 'date'
    search: '',
    userKeywords: [],
    activeKeywords: [],
    userAuthors: [],
    activeAuthors: [],
    visible: [],            // 当前排序后的完整列表,详情页左右翻页依赖它
    shown: 0,               // 已经渲染进 DOM 的条数
    index: 0,
    current: null,      // 详情弹层当前展示的论文,一键审稿用它取 id/date
    renderedRange: null
  };

  var PAGE = 60;            // 一屏批次。日期范围拉到 14 天就是 5000+ 篇,
                            // 一次性建 DOM 会让搜索每敲一个键都卡住

  var el = {};

  /* ================================================================ 工具 */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /** 先转义再插高亮标签,顺序反了就是 XSS。 */
  function highlight(text, terms, cls) {
    var out = esc(text);
    if (!terms || !terms.length) return out;
    terms.filter(Boolean).forEach(function (t) {
      var re = new RegExp('(' + escRe(esc(t)) + ')', 'gi');
      out = out.replace(re, '<mark class="' + (cls || 'highlight-match') + '">$1</mark>');
    });
    return out;
  }

  function fmtDate(d) { return d || ''; }

  function haystack(p) {
    return [p.title, p.authors, (p.category || []).join(' '), p.summary, p.details,
            p.motivation, p.method, p.result, p.conclusion].join(' ').toLowerCase();
  }

  function score(p) {
    return typeof p.relevance_score === 'number' ? p.relevance_score : -1;
  }

  /* ============================================================ 数据解析 */

  function parseJsonl(text, date) {
    var out = [];
    text.trim().split('\n').forEach(function (line) {
      if (!line) return;
      try {
        var p = JSON.parse(line);
        if (!p.categories) return;
        var cats = Array.isArray(p.categories) ? p.categories : [p.categories];
        out.push({
          id: p.id,
          title: p.title || '',
          url: p.abs || p.pdf || ('https://arxiv.org/abs/' + p.id),
          authors: Array.isArray(p.authors) ? p.authors.join(', ') : (p.authors || ''),
          category: cats,
          primary: cats[0],
          summary: (p.AI && p.AI.tldr) ? p.AI.tldr : (p.summary || ''),
          details: p.summary || '',
          motivation: (p.AI && p.AI.motivation) || '',
          method: (p.AI && p.AI.method) || '',
          result: (p.AI && p.AI.result) || '',
          conclusion: (p.AI && p.AI.conclusion) || '',
          relevance_score: typeof p.relevance_score === 'number' ? p.relevance_score : undefined,
          relevance_reason: p.relevance_reason || '',
          topic: p.topic || '',
          deep: p.deep === true,
          date: date
        });
      } catch (e) { /* 单行坏了不影响整天 */ }
    });
    return out;
  }

  /* ============================================================ 筛选渲染 */

  function loadPrefs() {
    try {
      state.userKeywords = JSON.parse(localStorage.getItem('preferredKeywords') || '[]');
      state.userAuthors = JSON.parse(localStorage.getItem('preferredAuthors') || '[]');
    } catch (e) {
      state.userKeywords = []; state.userAuthors = [];
    }
    // 默认全部激活:用户既然在设置里填了,就是想让它们生效
    state.activeKeywords = state.userKeywords.slice();
    state.activeAuthors = state.userAuthors.slice();
  }

  function renderFilterChips() {
    var box = el.filterTags;
    box.innerHTML = '';
    var slot = document.querySelector('.subbar-slot[data-for="papers-filters"]');
    var has = state.userKeywords.length || state.userAuthors.length;
    if (slot) slot.hidden = !has;
    if (!has) return;

    var label = document.createElement('span');
    label.className = 'subbar-label';
    label.textContent = '我的关注';
    box.appendChild(label);

    state.userKeywords.forEach(function (k) {
      box.appendChild(chip(k, state.activeKeywords.indexOf(k) >= 0, function () {
        toggleIn(state.activeKeywords, k); renderFilterChips(); render();
      }));
    });
    state.userAuthors.forEach(function (a) {
      box.appendChild(chip(a, state.activeAuthors.indexOf(a) >= 0, function () {
        toggleIn(state.activeAuthors, a); renderFilterChips(); render();
      }, 'chip-author'));
    });
  }

  function chip(text, on, onClick, extra) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (on ? ' is-on' : '') + (extra ? ' ' + extra : '');
    b.textContent = text;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.addEventListener('click', onClick);
    return b;
  }

  function toggleIn(arr, v) {
    var i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1); else arr.push(v);
  }

  function renderCategoryChips() {
    var counts = {};
    state.allPapers.forEach(function (p) {
      counts[p.primary] = (counts[p.primary] || 0) + 1;
    });
    var cats = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });

    el.categoryFilter.innerHTML = '';
    el.categoryFilter.appendChild(mkCat('all', '全部', state.allPapers.length));
    cats.forEach(function (c) { el.categoryFilter.appendChild(mkCat(c, c, counts[c])); });
  }

  function mkCat(key, label, count) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (state.category === key ? ' is-on' : '');
    b.dataset.category = key;
    b.appendChild(document.createTextNode(label));
    var n = document.createElement('span');
    n.className = 'chip-count';
    n.textContent = count;
    b.appendChild(n);
    b.addEventListener('click', function () {
      state.category = key;
      renderCategoryChips();
      render();
    });
    return b;
  }

  /* ============================================================ 列表渲染 */

  function render() {
    var papers = state.category === 'all'
      ? state.allPapers.slice()
      : state.allPapers.filter(function (p) { return p.primary === state.category; });

    papers.forEach(function (p) { p.isMatched = false; });

    // 基准序:相关度或日期。后面的「匹配优先」是稳定排序,
    // 所以基准序会在各分组内部保留下来。
    if (state.sort === 'date') {
      papers.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : score(b) - score(a)); });
    } else {
      papers.sort(function (a, b) { return score(b) - score(a); });
    }

    var q = state.search.trim().toLowerCase();
    if (q) {
      papers.forEach(function (p) { p.isMatched = haystack(p).indexOf(q) >= 0; });
    } else if (state.activeKeywords.length || state.activeAuthors.length) {
      papers.forEach(function (p) {
        var t = (p.title + ' ' + p.summary).toLowerCase();
        var au = p.authors.toLowerCase();
        p.isMatched =
          state.activeKeywords.some(function (k) { return t.indexOf(k.toLowerCase()) >= 0; }) ||
          state.activeAuthors.some(function (a) { return au.indexOf(a.toLowerCase()) >= 0; });
      });
    }
    // 匹配的排前面,但不隐藏其余的 —— 隐藏会让人以为当天就这么点论文
    papers.sort(function (a, b) { return (b.isMatched ? 1 : 0) - (a.isMatched ? 1 : 0); });

    state.visible = papers;
    state.shown = 0;

    var c = el.container;
    c.innerHTML = '';
    if (!papers.length) {
      c.innerHTML = '<div class="empty-state"><p>这个范围内没有论文</p></div>';
      updateCount();
      return;
    }
    appendPage();
    updateCount();
  }

  /** 追加下一批卡片。滚动到底部时由 IntersectionObserver 触发。 */
  function appendPage() {
    var q = state.search.trim().toLowerCase();
    var kwTerms = q ? [q] : state.activeKeywords;
    var auTerms = q ? [q] : state.activeAuthors;

    var end = Math.min(state.shown + PAGE, state.visible.length);
    var frag = document.createDocumentFragment();
    for (var i = state.shown; i < end; i++) {
      frag.appendChild(card(state.visible[i], i, kwTerms, auTerms));
    }
    state.shown = end;

    var sentinel = document.getElementById('loadMoreSentinel');
    if (sentinel) sentinel.remove();

    el.container.appendChild(frag);

    if (state.shown < state.visible.length) {
      var s = document.createElement('div');
      s.id = 'loadMoreSentinel';
      s.className = 'load-more';
      s.textContent = '已显示 ' + state.shown + ' / ' + state.visible.length + ' 篇,继续滚动加载…';
      el.container.appendChild(s);
      observer.observe(s);
    }
    if (global.Marks) refreshMarks();
  }

  function updateCount() {
    var n = document.getElementById('paperCount');
    if (n) n.textContent = state.visible.length + ' 篇';
  }

  // rootMargin 提前 600px 触发,滚到底之前下一批就已经就位
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { observer.unobserve(e.target); appendPage(); }
    });
  }, { rootMargin: '600px' });

  function card(p, i, kwTerms, auTerms) {
    var d = document.createElement('article');
    d.className = 'paper-card';

    var badge = '';
    if (typeof p.relevance_score === 'number') {
      var s = p.relevance_score;
      var cls = s >= 8 ? 'rel-high' : (s >= 6 ? 'rel-mid' : 'rel-low');
      badge = '<span class="relevance-badge ' + cls + '" title="' + esc(p.relevance_reason || '相关性评分') + '">'
            + '相关 ' + s + '/10' + (p.deep ? ' ★' : '')
            + (p.topic ? ' · ' + esc(p.topic) : '') + '</span>';
    }

    d.innerHTML =
      (p.isMatched ? '<div class="match-badge" title="匹配当前筛选"></div>' : '') +
      '<div class="paper-card-index">' + (i + 1) + '</div>' +
      '<div class="paper-card-header">' +
        '<h3 class="paper-card-title">' + highlight(p.title, kwTerms) + '</h3>' +
        '<p class="paper-card-authors" title="' + esc(p.authors) + '">' + highlight(p.authors, auTerms) + '</p>' +
        '<div class="paper-card-categories">' + badge +
          p.category.slice(0, 4).map(function (c) { return '<span class="category-tag">' + esc(c) + '</span>'; }).join('') +
        '</div>' +
      '</div>' +
      '<div class="paper-card-body">' +
        '<p class="paper-card-summary">' + highlight(p.summary, kwTerms) + '</p>' +
        '<div class="paper-card-footer">' +
          '<div class="footer-left">' + markBtnHtml(p) +
            '<span class="paper-card-date">' + fmtDate(p.date) + '</span>' +
          '</div>' +
          '<span class="paper-card-link">详情 →</span>' +
        '</div>' +
      '</div>';

    d.addEventListener('click', function (e) {
      if (e.target.closest('.mark-btn')) return;
      state.index = i;
      openDetail(p, i);
    });
    wireMark(d.querySelector('.mark-btn'), p);
    return d;
  }

  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';

  function markBtnHtml(p) {
    var on = global.Marks && Marks.isMarked(p.id);
    return '<button class="mark-btn' + (on ? ' is-marked' : '') + '" data-id="' + esc(p.id) +
           '" type="button" title="标记/取消标记" aria-label="标记">' + STAR + '</button>';
  }

  function wireMark(btn, p) {
    if (!btn || !global.Marks) return;
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      Marks.toggle(p.id, { title: p.title, url: p.url, authors: p.authors, date: p.date, summary: p.summary });
    });
  }

  function refreshMarks() {
    document.querySelectorAll('.mark-btn').forEach(function (b) {
      b.classList.toggle('is-marked', Marks.isMarked(b.getAttribute('data-id')));
    });
    var c = document.getElementById('markedCount');
    if (c) {
      var n = Marks.count();
      c.textContent = n;
      c.setAttribute('data-zero', n === 0 ? 'true' : 'false');
    }
  }

  /* ============================================================ 详情弹层 */

  function openDetail(p, i) {
    state.index = i;
    var q = state.search.trim();
    var kw = q ? [q] : state.activeKeywords;
    var au = q ? [q] : state.activeAuthors;

    document.getElementById('modalTitle').innerHTML = highlight(p.title, kw);

    var sections = [
      ['研究动机', p.motivation], ['核心方法', p.method],
      ['主要结果', p.result], ['结论与意义', p.conclusion]
    ].filter(function (s) { return s[1]; })
     .map(function (s) {
       return '<div class="paper-section"><h4>' + s[0] + '</h4><p>' + highlight(s[1], kw) + '</p></div>';
     }).join('');

    var meta = '<p class="hint">' + highlight(p.authors, au) + '</p>' +
               '<div class="paper-card-categories" style="margin:10px 0 16px">' +
               p.category.map(function (c) { return '<span class="category-tag">' + esc(c) + '</span>'; }).join('') +
               '<span class="category-tag">' + fmtDate(p.date) + '</span></div>';

    document.getElementById('modalBody').innerHTML =
      meta +
      '<div class="paper-section"><h4>TL;DR</h4><p>' + highlight(p.summary, kw) + '</p></div>' +
      '<div class="paper-sections" style="margin-top:16px">' + sections + '</div>' +
      (p.details ? '<div class="paper-section" style="margin-top:16px"><h4>英文原摘要</h4>' +
                   '<p class="original-abstract">' + highlight(p.details, kw) + '</p></div>' : '');

    document.getElementById('paperLink').href = p.url;
    document.getElementById('pdfLink').href = p.url.replace('/abs/', '/pdf/');
    document.getElementById('htmlLink').href = p.url.replace('/abs/', '/html/');
    document.getElementById('paperPosition').textContent = (i + 1) + ' / ' + state.visible.length;

    state.current = p;
    resetReviewPanel();
    restoreReview(p);

    var m = document.getElementById('paperModal');
    m.hidden = false;
    document.body.style.overflow = 'hidden';
    document.getElementById('modalBody').scrollTop = 0;
  }

  function closeDetail() {
    document.getElementById('paperModal').hidden = true;
    document.body.style.overflow = '';
  }

  function step(delta) {
    if (!state.visible.length) return;
    var n = state.visible.length;
    state.index = (state.index + delta + n) % n;
    openDetail(state.visible[state.index], state.index);
  }

  function randomPaper() {
    if (!state.visible.length) return;
    var i = Math.floor(Math.random() * state.visible.length);
    openDetail(state.visible[i], i);
  }

  /* ============================================================ 一键审稿 */

  var MODE_NAME = { quick: '快速', normal: '正常', deep: '深度' };
  var MODE_RANK = { quick: 1, normal: 2, deep: 3 };   // 同一篇有多份时,显示最深的那份
  var reviewBusy = false;
  var reviewCache = {};        // id -> { quick|normal|deep: 结果 }
  var reviewToken = 0;         // 防竞态:快速连点切换论文时,晚到的响应不能覆盖新论文

  /**
   * 打开详情时恢复已有的审稿结果。
   * 先用内存缓存立即渲染(切来切去不闪),再向后端要一次只读缓存 ——
   * 后者让结果能跨刷新、跨设备保留(审稿结果本来就落在服务端磁盘上)。
   */
  function restoreReview(p) {
    var token = ++reviewToken;

    var local = reviewCache[p.id];
    if (local) showBest(local);

    fetch('/api/review?id=' + encodeURIComponent(p.id))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || token !== reviewToken) return;      // 已经切到别的论文了
        if (!d.results || !Object.keys(d.results).length) return;
        reviewCache[p.id] = d.results;
        showBest(d.results);
      })
      .catch(function () { /* 后端不可用就只用内存缓存,不打扰用户 */ });
  }

  function showBest(byMode) {
    var modes = Object.keys(byMode);
    if (!modes.length) return;
    modes.sort(function (a, b) { return MODE_RANK[b] - MODE_RANK[a]; });
    var best = byMode[modes[0]];
    renderReview(reviewPanel(), best);
    setReviewButtons(false, best.mode);
  }

  function reviewPanel() {
    var body = document.getElementById('modalBody');
    var el = document.getElementById('reviewPanel');
    if (!el) {
      el = document.createElement('div');
      el.id = 'reviewPanel';
      el.className = 'review-panel';
      body.appendChild(el);
    }
    return el;
  }

  function resetReviewPanel() {
    var el = document.getElementById('reviewPanel');
    if (el) el.remove();
    setReviewButtons(false, null);
  }

  function setReviewButtons(disabled, activeMode) {
    document.querySelectorAll('[data-review-mode]').forEach(function (b) {
      b.disabled = disabled;
      if (activeMode !== undefined) b.classList.toggle('is-on', b.dataset.reviewMode === activeMode);
    });
  }

  async function runReview(mode) {
    if (reviewBusy || !state.current) return;
    var p = state.current;
    var token = reviewToken;      // 记下发起时的论文,响应回来要比对
    reviewBusy = true;
    setReviewButtons(true);

    var panel = reviewPanel();
    panel.innerHTML = '';
    var status = document.createElement('div');
    status.className = 'review-status';
    status.innerHTML = '<span class="loading-spinner"></span>';
    status.appendChild(document.createTextNode(
      MODE_NAME[mode] + '审稿中…先让 Haiku 判定投稿会议,再按模式选模型出意见' +
      (mode === 'deep' ? '。深度模式走 Opus,可能要几分钟。' : '')));
    panel.appendChild(status);
    panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    try {
      // 只发 id / date / mode —— 标题和摘要由后端从本机数据里查,
      // 不从这里传,免得把 prompt 的控制权交到前端(乃至任何能构造请求的人)手上。
      var res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, date: p.date, mode: mode })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      if (token !== reviewToken) {           // 审稿期间用户切走了:结果入缓存但不渲染
        if (!reviewCache[p.id]) reviewCache[p.id] = {};
        reviewCache[p.id][mode] = data;
        return;
      }
      if (!reviewCache[p.id]) reviewCache[p.id] = {};
      reviewCache[p.id][mode] = data;
      renderReview(panel, data);
      setReviewButtons(false, mode);
    } catch (e) {
      panel.innerHTML = '';
      var err = document.createElement('div');
      err.className = 'review-status is-error';
      err.textContent = '审稿失败:' + e.message;
      panel.appendChild(err);
    } finally {
      reviewBusy = false;
      document.querySelectorAll('[data-review-mode]').forEach(function (b) { b.disabled = false; });
    }
  }

  /** 后端只回结构化字段,这里负责转成 HTML。文本一律走 textContent,不拼 innerHTML。 */
  function renderReview(panel, d) {
    var s = d.sections || {};
    panel.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'review-head';
    var venue = document.createElement('span');
    venue.className = 'review-venue';
    venue.textContent = d.venue || '未知会议';
    head.appendChild(venue);
    var meta = document.createElement('span');
    meta.className = 'review-meta';
    meta.textContent = MODE_NAME[d.mode] + ' · ' + (d.model || '') +
                       (d.cached ? ' · 缓存结果' : (d.elapsed ? ' · ' + d.elapsed + 's' : ''));
    head.appendChild(meta);
    panel.appendChild(head);

    var verdict = document.createElement('div');
    verdict.className = 'review-verdict';
    verdict.appendChild(box('推荐', s.recommend || '—', recClass(s.recommend)));
    verdict.appendChild(box('评分', s.rating != null ? s.rating + ' / 10' : '—', ''));
    verdict.appendChild(box('置信度', s.confidence != null ? s.confidence + ' / 5' : '—', ''));
    panel.appendChild(verdict);

    if (s.summary) panel.appendChild(para('总体评价', s.summary));
    panel.appendChild(list('优点', s.strengths));
    panel.appendChild(list('不足', s.weaknesses, true));
    panel.appendChild(list('详细意见', s.detailed));
    panel.appendChild(list('给作者的问题', s.questions));
  }

  function recClass(r) {
    if (r === '接收') return 'v-accept';
    if (r === '拒稿') return 'v-reject';
    if (r === '小修' || r === '大修') return 'v-revise';
    return '';
  }

  function box(label, value, cls) {
    var d = document.createElement('div');
    d.className = 'verdict-box';
    var l = document.createElement('div'); l.className = 'verdict-label'; l.textContent = label;
    var v = document.createElement('div'); v.className = 'verdict-value ' + (cls || ''); v.textContent = value;
    d.appendChild(l); d.appendChild(v);
    return d;
  }

  function para(title, text) {
    var sec = document.createElement('div');
    sec.className = 'review-section';
    var h = document.createElement('h4'); h.textContent = title;
    var p = document.createElement('p'); p.textContent = text;
    sec.appendChild(h); sec.appendChild(p);
    return sec;
  }

  function list(title, items, weak) {
    var sec = document.createElement('div');
    sec.className = 'review-section' + (weak ? ' is-weak' : '');
    if (!items || !items.length) { sec.hidden = true; return sec; }
    var h = document.createElement('h4'); h.textContent = title;
    var ul = document.createElement('ul');
    items.forEach(function (t) {
      var li = document.createElement('li');
      li.textContent = t;
      ul.appendChild(li);
    });
    sec.appendChild(h); sec.appendChild(ul);
    return sec;
  }

  /* ================================================================ 加载 */

  async function loadRange() {
    var dates = Store.datesInRange();
    if (!dates.length) {
      el.container.innerHTML = '<div class="empty-state"><p>这个日期范围内没有数据</p></div>';
      return;
    }
    // 保留上一屏并降透明度,不用骨架屏 —— 骨架屏会让布局跳一下
    el.container.classList.add('is-refetching');
    var files = await Store.fetchRange(dates);
    var all = [];
    files.forEach(function (f) { all = all.concat(parseJsonl(f.text, f.date)); });

    state.allPapers = all;
    state.papersByCategory = {};
    all.forEach(function (p) {
      (state.papersByCategory[p.primary] || (state.papersByCategory[p.primary] = [])).push(p);
    });
    if (state.category !== 'all' && !state.papersByCategory[state.category]) state.category = 'all';

    state.renderedRange = Store.state.start + '~' + Store.state.end;
    el.container.classList.remove('is-refetching');
    renderCategoryChips();
    render();
  }

  /* ================================================================ 视图 */

  async function init() {
    el.container = document.getElementById('paperContainer');
    el.categoryFilter = document.getElementById('categoryFilter');
    el.filterTags = document.getElementById('filterTags');
    el.search = document.getElementById('textSearchInput');
    el.searchClear = document.getElementById('textSearchClear');
    el.sortToggle = document.getElementById('sortToggle');

    loadPrefs();
    renderFilterChips();

    var t = null;
    el.search.addEventListener('input', function () {
      state.search = el.search.value;
      el.searchClear.hidden = !state.search;
      clearTimeout(t);
      t = setTimeout(render, 140);   // 打字时不要每个键都全量重排
    });
    el.searchClear.addEventListener('click', function () {
      el.search.value = ''; state.search = '';
      el.searchClear.hidden = true; render(); el.search.focus();
    });

    el.sortToggle.addEventListener('click', function () {
      state.sort = state.sort === 'relevance' ? 'date' : 'relevance';
      el.sortToggle.textContent = state.sort === 'relevance' ? '相关度' : '日期';
      render();
    });

    document.querySelectorAll('[data-review-mode]').forEach(function (b) {
      b.addEventListener('click', function () { runReview(b.dataset.reviewMode); });
    });

    document.getElementById('closeModal').addEventListener('click', closeDetail);
    document.getElementById('paperModal').addEventListener('click', function (e) {
      if (e.target.id === 'paperModal') closeDetail();
    });

    document.addEventListener('keydown', function (e) {
      var open = !document.getElementById('paperModal').hidden;
      var typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName) ||
                   document.activeElement.isContentEditable;
      if (e.key === 'Escape' && open) { closeDetail(); return; }
      if (!open || typing) {
        // 列表页按 / 直接聚焦搜索,这是列表页最高频的动作
        if (e.key === '/' && !typing && Router.current === 'papers') {
          e.preventDefault(); el.search.focus();
        }
        if (!open) return;
      }
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === ' ') { e.preventDefault(); randomPaper(); }
    });

    if (global.Marks) {
      Marks.onChange(refreshMarks);
      Marks.load();
    }

    Store.on('rangechange', function () {
      if (Router.current === 'papers') loadRange();
      else state.renderedRange = null;   // 不在前台就标脏,回来再补
    });

    await loadRange();
  }

  async function show() {
    // 设置页可能改过关键词/作者,回到列表要跟着变
    var before = state.userKeywords.join('|') + '#' + state.userAuthors.join('|');
    loadPrefs();
    var after = state.userKeywords.join('|') + '#' + state.userAuthors.join('|');
    if (before !== after) { renderFilterChips(); render(); }

    if (state.renderedRange !== Store.state.start + '~' + Store.state.end) await loadRange();
  }

  global.PapersView = { init: init, show: show, render: render };
})(window);

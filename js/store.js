/**
 * Store —— SPA 的共享数据层
 *
 * 解决两件事:
 *  1. 视图之间共享「可用日期」和「当前日期范围」,切换视图不再各算各的。
 *  2. jsonl 原文只 fetch 一次。内存缓存 + sessionStorage 兜底,
 *     从论文页切到统计页再切回来不会重新下载。
 *
 * 各视图的解析结果形状不同(论文页要作者/摘要,统计页要打分/标签),
 * 所以这里只缓存原始文本,解析仍归各视图自己做。
 */
(function (global) {
  'use strict';

  var listeners = {};                 // event -> [fn]
  var textCache = Object.create(null); // "date|lang" -> jsonl 文本
  var SS_PREFIX = 'arxiv_jsonl_';
  var SS_BUDGET = 12;                 // sessionStorage 最多留几天,超了就淘汰最旧的

  var state = {
    availableDates: [],               // 升序
    dateLanguageMap: new Map(),
    start: null,
    end: null,
    ready: false
  };

  function on(evt, fn) {
    (listeners[evt] || (listeners[evt] = [])).push(fn);
    return function off() {
      listeners[evt] = (listeners[evt] || []).filter(function (f) { return f !== fn; });
    };
  }

  function emit(evt, payload) {
    (listeners[evt] || []).slice().forEach(function (fn) {
      try { fn(payload); } catch (e) { console.error('[store] ' + evt + ' 处理出错', e); }
    });
  }

  /* ---------------- 语言 ---------------- */

  function preferredLanguage() {
    // 本部署只产出中文;保留分支是为了兼容上游同时有中英两份的仓库
    var lang = navigator.language || navigator.userLanguage || '';
    return lang.indexOf('en') === 0 ? 'English' : 'Chinese';
  }

  function languageForDate(date) {
    var avail = state.dateLanguageMap.get(date);
    if (!avail || !avail.length) return preferredLanguage();
    var want = preferredLanguage();
    if (avail.indexOf(want) >= 0) return want;
    return avail.indexOf('Chinese') >= 0 ? 'Chinese' : avail[0];
  }

  /* ---------------- 日期清单 ---------------- */

  async function loadAvailableDates() {
    if (state.ready) return state.availableDates;
    var url = DATA_CONFIG.getDataUrl('assets/file-list.txt');
    var res = await fetch(url);
    if (!res.ok) throw new Error('文件列表拉取失败: ' + res.status);
    var text = await res.text();

    var re = /(\d{4}-\d{2}-\d{2})_AI_enhanced_(English|Chinese)\.jsonl/;
    var map = new Map();
    text.trim().split('\n').forEach(function (line) {
      var m = line.match(re);
      if (!m) return;
      if (!map.has(m[1])) map.set(m[1], []);
      map.get(m[1]).push(m[2]);
    });

    state.dateLanguageMap = map;
    // 统一升序。倒序曾经让趋势图的时间轴整个反过来,这里定死一次。
    state.availableDates = Array.from(map.keys()).sort();
    state.ready = true;

    if (!state.start && state.availableDates.length) {
      var last = state.availableDates[state.availableDates.length - 1];
      state.start = last;
      state.end = last;
    }
    emit('ready', state.availableDates.slice());
    return state.availableDates;
  }

  /* ---------------- jsonl 原文(带缓存) ---------------- */

  function ssGet(key) {
    try { return sessionStorage.getItem(SS_PREFIX + key); } catch (e) { return null; }
  }

  function ssSet(key, val) {
    try {
      var keys = Object.keys(sessionStorage).filter(function (k) { return k.indexOf(SS_PREFIX) === 0; });
      // 超预算先淘汰最旧的(键名含日期,字典序即时间序)
      keys.sort();
      while (keys.length >= SS_BUDGET) sessionStorage.removeItem(keys.shift());
      sessionStorage.setItem(SS_PREFIX + key, val);
    } catch (e) {
      // 配额满或隐私模式:内存缓存仍然有效,静默降级
    }
  }

  /** 取某一天的 jsonl 原文。同一天重复调用不会重复请求。 */
  async function fetchDay(date) {
    var lang = languageForDate(date);
    var key = date + '|' + lang;
    if (textCache[key]) return textCache[key];

    var cached = ssGet(key);
    if (cached) { textCache[key] = cached; return cached; }

    var url = DATA_CONFIG.getDataUrl('data/' + date + '_AI_enhanced_' + lang + '.jsonl');
    var res = await fetch(url);
    if (!res.ok) throw new Error(date + ' 数据拉取失败: ' + res.status);
    var text = await res.text();
    textCache[key] = text;
    ssSet(key, text);
    return text;
  }

  /** 并发取一段日期的原文,返回 [{date, text}],失败的那天会被跳过并 console 记一笔。 */
  async function fetchRange(dates) {
    var out = await Promise.all(dates.map(function (d) {
      return fetchDay(d).then(function (text) { return { date: d, text: text }; })
        .catch(function (e) { console.warn('[store] ' + d + ' 跳过:', e.message); return null; });
    }));
    return out.filter(Boolean);
  }

  /* ---------------- 当前日期范围 ---------------- */

  function datesInRange() {
    return state.availableDates.filter(function (d) {
      return d >= state.start && d <= state.end;
    });
  }

  function setRange(start, end, opts) {
    if (start > end) { var t = start; start = end; end = t; }
    if (state.start === start && state.end === end && !(opts && opts.force)) return;
    state.start = start;
    state.end = end;
    emit('rangechange', { start: start, end: end, dates: datesInRange() });
  }

  /** 「最近 N 个有数据的日子」。arXiv 周末不更新,按自然日算会少给内容。 */
  function presetRange(days) {
    var d = state.availableDates;
    if (!d.length) return null;
    var start = days === 0 ? d[0] : d[Math.max(0, d.length - days)];
    return { start: start, end: d[d.length - 1] };
  }

  global.Store = {
    on: on,
    emit: emit,
    state: state,
    loadAvailableDates: loadAvailableDates,
    fetchDay: fetchDay,
    fetchRange: fetchRange,
    datesInRange: datesInRange,
    setRange: setRange,
    presetRange: presetRange,
    languageForDate: languageForDate,
    preferredLanguage: preferredLanguage
  };
})(window);

/**
 * i18n —— 界面语言
 *
 * 语言影响三处,生效方式不同,别混淆:
 *   1. 界面文案  —— 纯前端,切换立即生效
 *   2. 审稿意见  —— 随请求把语言发给后端,下一次审稿就用新语言
 *                   (已经审过的结果按当时的语言存着,不会追溯翻译)
 *   3. 论文总结  —— 由每日流水线在生成时决定,前端只能在"当天有哪几种语言的
 *                   文件"里挑。想要另一种语言的总结,得让流水线也产出那一种
 *                   (.env.local 里的 LANGUAGE),否则回落到已有的那份。
 *
 * 必须在 <head> 里同步引入:首屏绘制前把 <html lang> 定好,静态文案也一次性
 * 替换掉,免得先闪一下默认语言。
 */
(function (global) {
  'use strict';

  var KEY = 'arxiv_lang';
  var FALLBACK = 'en';

  var DICT = {
    'en': {
      // ---- 外壳 ----
      'nav.papers': 'Papers',
      'nav.marked': 'Saved',
      'nav.stats': 'Trends',
      'nav.settings': 'Settings',
      'shell.skip': 'Skip to main content',
      'shell.dateTitle': 'Pick a date or a range',
      'shell.dateLoading': 'Loading…',
      'shell.pickDate': 'Pick a date',
      'shell.days': ' days',
      'shell.themeToggle': 'Switch theme',
      'shell.theme.light': 'Light (click to switch)',
      'shell.theme.dark': 'Dark (click to switch)',
      'shell.theme.system': 'Follow system (click to switch)',
      'shell.logout': 'Sign out',
      'shell.backToTop': 'Back to top',
      'shell.loadFailed': 'Failed to load the data index',

      // ---- 日期弹层 ----
      'date.title': 'Select date',
      'date.range': 'Date range',
      'date.latest': 'Latest day',
      'date.last7': 'Last 7 days',
      'date.last14': 'Last 14 days',
      'date.last30': 'Last 30 days',
      'date.all': 'All',
      'date.close': 'Close',

      // ---- 论文列表 ----
      'papers.all': 'All',
      'papers.search': 'Search title, abstract, authors…',
      'papers.searchLabel': 'Search papers',
      'papers.clear': 'Clear',
      'papers.count': '{n} papers',
      'papers.sortRelevance': 'Relevance',
      'papers.sortDate': 'Date',
      'papers.sortTitle': 'Sort by relevance / date',
      'papers.myFocus': 'My focus',
      'papers.loading': 'Loading papers…',
      'papers.emptyRange': 'No papers in this range',
      'papers.emptyDates': 'No data for this date range',
      'papers.details': 'Details →',
      'papers.matched': 'Matches the current filter',
      'papers.mark': 'Save / unsave',
      'papers.markLabel': 'Save',
      'papers.relevance': 'Relevance {score}/10',
      'papers.relevanceTitle': 'Relevance score',
      'papers.loadMore': 'Showing {shown} / {total} — keep scrolling to load more',
      'papers.langNotice': 'Summaries are shown in {have} — the daily pipeline has not produced {want} for this range. Set LANGUAGE in .env.local to change what it generates.',

      // ---- 详情 ----
      'detail.title': 'Details',
      'detail.tldr': 'TL;DR',
      'detail.motivation': 'Motivation',
      'detail.method': 'Method',
      'detail.result': 'Results',
      'detail.conclusion': 'Conclusion',
      'detail.abstract': 'Original abstract',
      'detail.hint': '← → to navigate · space for random · Esc to close',

      // ---- 一键审稿 ----
      'review.label': 'Review',
      'review.quick': 'Quick',
      'review.normal': 'Normal',
      'review.deep': 'Deep',
      'review.quickTitle': 'Fast model · ~20s',
      'review.normalTitle': 'Mid model · ~1min',
      'review.deepTitle': 'Strongest model · several minutes',
      'review.running': 'Reviewing ({mode})… first picking the venue, then writing the review',
      'review.runningDeep': ' Deep mode uses the strongest model and may take a few minutes.',
      'review.failed': 'Review failed: ',
      'review.unknownVenue': 'Unknown venue',
      'review.cached': ' · cached',
      'review.recommend': 'Recommendation',
      'review.rating': 'Rating',
      'review.confidence': 'Confidence',
      'review.summary': 'Summary',
      'review.strengths': 'Strengths',
      'review.weaknesses': 'Weaknesses',
      'review.detailed': 'Detailed comments',
      'review.questions': 'Questions to the authors',
      'review.rec.accept': 'Accept',
      'review.rec.minor': 'Minor revision',
      'review.rec.major': 'Major revision',
      'review.rec.reject': 'Reject',
      'review.reviewed': 'Reviewed',

      // ---- 已标记 ----
      'marked.title': 'Saved papers',
      'marked.desc': 'Papers you saved on any device show up here. Click the star to remove.',
      'marked.summary': '{total} saved · {reviewed} reviewed',
      'marked.onlyReviewed': 'Reviewed only',
      'marked.empty': 'Nothing saved yet',
      'marked.emptyHint': 'Click the ☆ on a paper card to save it; it will be here on any device.',
      'marked.emptyReviewed': 'None of your saved papers has been reviewed yet',
      'marked.unavailable': 'Saving is unavailable',
      'marked.unmark': 'Remove',
      'marked.removeFailed': 'Failed to remove, please retry',
      'marked.quick': 'Quick review',
      'marked.normal': 'Normal review',
      'marked.deep': 'Deep review',

      // ---- 统计 ----
      'stats.range': 'Time range',
      'stats.computing': 'Crunching…',
      'stats.total': 'Papers',
      'stats.totalHint': '{days} days · {perDay}/day avg',
      'stats.hit': 'Relevant (≥6)',
      'stats.hitHint': '{pct}% above threshold',
      'stats.noScore': 'No scores in this range',
      'stats.deep': 'Deep-read',
      'stats.deepHint': '{n} qualified but missed the cut',
      'stats.deepAll': 'All qualifying papers were deep-read',
      'stats.topCat': 'Most active area',
      'stats.topCatHint': '{n} papers · {pct}%',
      'stats.primaryTitle': 'Primary areas',
      'stats.primaryDesc': 'Daily count by the paper’s first arXiv category',
      'stats.subTitle': 'Sub-directions',
      'stats.subDesc': 'By bootstrapped sub-direction tags; untagged history is excluded',
      'stats.subEmpty': 'Papers in this range have no sub-direction tags yet (run ai/trend_tagger.py)',
      'stats.kwTitle': 'Keywords',
      'stats.kwDesc': 'Daily frequency of noun phrases in titles',
      'stats.kwListTitle': 'Top keywords',
      'stats.kwListDesc': 'Click a keyword to see the matching papers in the sidebar',
      'stats.noData': 'No data for this date range',
      'stats.noRelated': 'No matching papers',
      'stats.unitPapers': 'papers',
      'stats.unitTimes': 'times',

      // ---- 图表 ----
      'chart.table': 'Table view',
      'chart.chart': 'Chart view',
      'chart.other': 'Other ({n})',
      'chart.date': 'Date',
      'chart.empty': 'No data in the selected range',
      'chart.needTwoDays': 'A trend needs at least two days — pick a range above',
      'chart.aria': '{title}: {n} series, {from} to {to}',

      // ---- 设置 ----
      'settings.title': 'Settings',
      'settings.desc': 'Keywords and authors you follow are highlighted in the paper list and can be used to filter. Stored in this browser.',
      'settings.keywords': 'Keywords you follow',
      'settings.authors': 'Authors you follow',
      'settings.copy': 'Copy',
      'settings.add': 'Add',
      'settings.kwPlaceholder': 'Type a keyword and press Enter…',
      'settings.auPlaceholder': 'Type an author name and press Enter…',
      'settings.kwEmpty': 'No keywords yet. Add some below.',
      'settings.auEmpty': 'No authors yet. Add some below.',
      'settings.appearance': 'Appearance',
      'settings.light': 'Light',
      'settings.dark': 'Dark',
      'settings.system': 'System',
      'settings.language': 'Language',
      'settings.languageHint': 'Changes the interface immediately. New reviews will be written in this language; summaries follow whatever the daily pipeline produced.',
      'settings.reset': 'Reset',
      'settings.save': 'Save',
      'settings.saved': 'Saved',
      'settings.resetDone': 'Reset to defaults',
      'settings.resetConfirm': 'Clear all followed keywords and authors?',
      'settings.copied': '{what} copied ({n} items)',
      'settings.copyFailed': 'Copy failed',
      'settings.remove': 'Remove',
      'settings.kwWord': 'Keywords',
      'settings.auWord': 'Authors',

      // ---- 首次选择语言 ----
      'welcome.title': 'Choose your language',
      'welcome.desc': 'This sets the interface language and the language new reviews are written in. You can change it any time in Settings.',
      'welcome.confirm': 'Continue',
      'lang.Chinese': 'Chinese',
      'lang.English': 'English',
      'footer.note': 'Generated by AI — verify before relying on it.',
    },

    'zh-CN': {
      'nav.papers': '论文',
      'nav.marked': '已标记',
      'nav.stats': '统计',
      'nav.settings': '设置',
      'shell.skip': '跳到主要内容',
      'shell.dateTitle': '选择日期或日期范围',
      'shell.dateLoading': '加载中…',
      'shell.pickDate': '选择日期',
      'shell.days': ' 天',
      'shell.themeToggle': '切换主题',
      'shell.theme.light': '浅色(点击切换)',
      'shell.theme.dark': '深色(点击切换)',
      'shell.theme.system': '跟随系统(点击切换)',
      'shell.logout': '退出登录',
      'shell.backToTop': '回到顶部',
      'shell.loadFailed': '数据列表加载失败',

      'date.title': '选择日期',
      'date.range': '日期范围',
      'date.latest': '最新一天',
      'date.last7': '近 7 天',
      'date.last14': '近 14 天',
      'date.last30': '近 30 天',
      'date.all': '全部',
      'date.close': '关闭',

      'papers.all': '全部',
      'papers.search': '搜索标题、摘要、作者…',
      'papers.searchLabel': '搜索论文',
      'papers.clear': '清空',
      'papers.count': '{n} 篇',
      'papers.sortRelevance': '相关度',
      'papers.sortDate': '日期',
      'papers.sortTitle': '排序方式:相关度 / 日期',
      'papers.myFocus': '我的关注',
      'papers.loading': '加载论文中…',
      'papers.emptyRange': '这个范围内没有论文',
      'papers.emptyDates': '这个日期范围内没有数据',
      'papers.details': '详情 →',
      'papers.matched': '匹配当前筛选',
      'papers.mark': '标记/取消标记',
      'papers.markLabel': '标记',
      'papers.relevance': '相关 {score}/10',
      'papers.relevanceTitle': '相关性评分',
      'papers.loadMore': '已显示 {shown} / {total} 篇,继续滚动加载…',
      'papers.langNotice': '总结显示的是{have} —— 这段时间的流水线没有产出{want}版本。想换语言要改 .env.local 里的 LANGUAGE。',

      'detail.title': '详情',
      'detail.tldr': '速览',
      'detail.motivation': '研究动机',
      'detail.method': '核心方法',
      'detail.result': '主要结果',
      'detail.conclusion': '结论与意义',
      'detail.abstract': '英文原摘要',
      'detail.hint': '← → 翻页 · 空格随机 · Esc 关闭',

      'review.label': '一键审稿',
      'review.quick': '快速',
      'review.normal': '正常',
      'review.deep': '深度',
      'review.quickTitle': '快模型 · 约 20 秒',
      'review.normalTitle': '中档模型 · 约 1 分钟',
      'review.deepTitle': '最强模型 · 数分钟',
      'review.running': '{mode}审稿中…先判定投稿会议,再按模式选模型出意见',
      'review.runningDeep': '。深度模式走最强模型,可能要几分钟。',
      'review.failed': '审稿失败:',
      'review.unknownVenue': '未知会议',
      'review.cached': ' · 缓存结果',
      'review.recommend': '推荐',
      'review.rating': '评分',
      'review.confidence': '置信度',
      'review.summary': '总体评价',
      'review.strengths': '优点',
      'review.weaknesses': '不足',
      'review.detailed': '详细意见',
      'review.questions': '给作者的问题',
      'review.rec.accept': '接收',
      'review.rec.minor': '小修',
      'review.rec.major': '大修',
      'review.rec.reject': '拒稿',
      'review.reviewed': '已审',

      'marked.title': '已标记的论文',
      'marked.desc': '在任意设备上标记的论文都会出现在这里,点星号可取消标记。',
      'marked.summary': '{total} 篇已标记 · {reviewed} 篇已审稿',
      'marked.onlyReviewed': '只看已审稿',
      'marked.empty': '还没有标记任何论文',
      'marked.emptyHint': '在论文列表里点卡片上的 ☆ 即可标记,之后在任意设备上都能在这里找到。',
      'marked.emptyReviewed': '标记的论文里还没有审过稿的',
      'marked.unavailable': '标记功能不可用',
      'marked.unmark': '取消标记',
      'marked.removeFailed': '取消标记失败,请重试',
      'marked.quick': '快速审',
      'marked.normal': '正常审',
      'marked.deep': '深度审',

      'stats.range': '时间范围',
      'stats.computing': '统计中…',
      'stats.total': '论文总数',
      'stats.totalHint': '{days} 天 · 日均 {perDay} 篇',
      'stats.hit': '高相关 (≥6分)',
      'stats.hitHint': '{pct}% 的论文过线',
      'stats.noScore': '本区间无评分',
      'stats.deep': '深度精读',
      'stats.deepHint': '有 {n} 篇过线但未入选',
      'stats.deepAll': '过线论文已全部精读',
      'stats.topCat': '最活跃方向',
      'stats.topCatHint': '{n} 篇 · 占 {pct}%',
      'stats.primaryTitle': '主方向趋势',
      'stats.primaryDesc': '按论文首要 arXiv 类别统计每日篇数',
      'stats.subTitle': '子方向趋势',
      'stats.subDesc': '按自举标签库打的研究子方向统计;未打标的历史数据不计入',
      'stats.subEmpty': '所选范围内的论文还没有子方向标签(跑一次 ai/trend_tagger.py 就有了)',
      'stats.kwTitle': '关键词趋势',
      'stats.kwDesc': '标题中高频名词短语的每日出现次数',
      'stats.kwListTitle': '热门关键词',
      'stats.kwListDesc': '点击任意关键词,在侧栏查看包含它的论文',
      'stats.noData': '这个日期范围内没有数据',
      'stats.noRelated': '没有找到相关论文',
      'stats.unitPapers': '篇',
      'stats.unitTimes': '次',

      'chart.table': '表格视图',
      'chart.chart': '图表视图',
      'chart.other': '其他 ({n})',
      'chart.date': '日期',
      'chart.empty': '所选范围内暂无数据',
      'chart.needTwoDays': '趋势图需要至少两天的数据 —— 用上面的「时间范围」选一段',
      'chart.aria': '{title}:{n} 个系列,{from} 至 {to}',

      'settings.title': '设置',
      'settings.desc': '关注的关键词和作者会在论文列表里高亮,并可用于筛选。保存在本机浏览器。',
      'settings.keywords': '关注的关键词',
      'settings.authors': '关注的作者',
      'settings.copy': '复制',
      'settings.add': '添加',
      'settings.kwPlaceholder': '输入关键词后回车…',
      'settings.auPlaceholder': '输入作者名后回车…',
      'settings.kwEmpty': '还没有关键词。在下面添加。',
      'settings.auEmpty': '还没有作者。在下面添加。',
      'settings.appearance': '外观',
      'settings.light': '浅色',
      'settings.dark': '深色',
      'settings.system': '跟随系统',
      'settings.language': '语言',
      'settings.languageHint': '立即切换界面语言。之后新生成的审稿意见会用这个语言;论文总结取决于每日流水线产出了哪几种语言。',
      'settings.reset': '恢复默认',
      'settings.save': '保存设置',
      'settings.saved': '已保存',
      'settings.resetDone': '已恢复默认',
      'settings.resetConfirm': '清空所有关注的关键词和作者?',
      'settings.copied': '{what}已复制({n} 项)',
      'settings.copyFailed': '复制失败',
      'settings.remove': '移除',
      'settings.kwWord': '关键词',
      'settings.auWord': '作者',

      'welcome.title': '选择语言',
      'welcome.desc': '这会决定界面语言,以及之后生成的审稿意见用什么语言写。随时可以在「设置」里改。',
      'welcome.confirm': '开始使用',
      'lang.Chinese': '中文',
      'lang.English': '英文',
      'footer.note': '内容由 AI 生成,请自行甄别。'
    }
  };

  // 主方向类别的显示名。key 是 arXiv 类别码,英文直接用官方名。
  var CATEGORIES = {
    'en': {
      'cs.CR': 'Security & Cryptography', 'cs.SE': 'Software Engineering',
      'cs.CL': 'Computation & Language', 'cs.AI': 'Artificial Intelligence',
      'cs.LG': 'Machine Learning', 'cs.DC': 'Distributed Computing',
      'cs.AR': 'Hardware Architecture', 'cs.CV': 'Computer Vision',
      'cs.GR': 'Graphics', 'cs.DB': 'Databases', 'cs.HC': 'Human-Computer Interaction',
      'cs.IT': 'Information Theory', 'cs.NE': 'Neural & Evolutionary Computing',
      'cs.PL': 'Programming Languages', 'cs.CE': 'Computational Engineering',
      'cs.RO': 'Robotics', 'cs.GT': 'Game Theory', 'cs.CY': 'Computers & Society',
      'cs.MA': 'Multiagent Systems'
    },
    'zh-CN': {
      'cs.CR': '安全与漏洞', 'cs.SE': '软件工程', 'cs.CL': '自然语言处理',
      'cs.AI': 'AI', 'cs.LG': '机器学习', 'cs.DC': '分布式与并行计算',
      'cs.AR': '硬件架构', 'cs.CV': '计算机视觉', 'cs.GR': '图形学',
      'cs.DB': '数据库', 'cs.HC': '人机交互', 'cs.IT': '信息论',
      'cs.NE': '神经计算', 'cs.PL': '编程语言', 'cs.CE': '计算工程',
      'cs.RO': '机器人', 'cs.GT': '博弈论', 'cs.CY': '计算机与社会',
      'cs.MA': '多智能体系统'
    }
  };

  var LANGS = [
    { code: 'en',    label: 'English',  native: 'English' },
    { code: 'zh-CN', label: 'Chinese',  native: '简体中文' }
  ];

  var current = null;

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  /** 有没有明确选过。没选过要弹首次选择。 */
  function chosen() {
    var v = stored();
    return !!(v && DICT[v]);
  }

  function detect() {
    var v = stored();
    if (v && DICT[v]) return v;
    var nav = (navigator.languages && navigator.languages[0]) || navigator.language || '';
    return nav.toLowerCase().indexOf('zh') === 0 ? 'zh-CN' : FALLBACK;
  }

  function get() { return current || (current = detect()); }

  function set(code) {
    if (!DICT[code]) return;
    current = code;
    try { localStorage.setItem(KEY, code); } catch (e) { /* 隐私模式 */ }
    document.documentElement.setAttribute('lang', code);
    applyStatic();
    window.dispatchEvent(new CustomEvent('languagechange', { detail: { lang: code } }));
  }

  /** t('papers.count', {n: 12}) —— 占位符是 {name} */
  function t(key, vars) {
    var lang = get();
    var s = (DICT[lang] && DICT[lang][key]);
    if (s == null) s = (DICT[FALLBACK] && DICT[FALLBACK][key]);
    if (s == null) return key;          // 缺词条时显示 key,方便一眼看出漏翻
    if (!vars) return s;
    return s.replace(/\{(\w+)\}/g, function (m, k) {
      return vars[k] != null ? vars[k] : m;
    });
  }

  function category(code) {
    var m = CATEGORIES[get()] || CATEGORIES[FALLBACK];
    return m[code] || code;
  }

  /** 后端与文件名用的语言名(Chinese / English)。 */
  function backendName(code) {
    return (code || get()) === 'zh-CN' ? 'Chinese' : 'English';
  }

  /** 替换 HTML 里带 data-i18n / data-i18n-attr 的静态文案。 */
  function applyStatic(root) {
    (root || document).querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    // data-i18n-attr="title:shell.dateTitle,aria-label:shell.themeToggle"
    (root || document).querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      el.getAttribute('data-i18n-attr').split(',').forEach(function (pair) {
        var i = pair.indexOf(':');
        if (i < 0) return;
        el.setAttribute(pair.slice(0, i).trim(), t(pair.slice(i + 1).trim()));
      });
    });
  }

  document.documentElement.setAttribute('lang', get());

  // 首屏也要刷一遍静态文案 —— head 里执行时 DOM 还没建好,得等 DOMContentLoaded。
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { applyStatic(); });
  } else {
    applyStatic();
  }

  // 注意:**不要**导出裸的 window.t。compromise.js 也占用全局 t,而且它在本文件
  // 之后加载,会把我们的覆盖掉(表现为界面上出现一段 JS 源码)。
  // 各模块自己在 IIFE 顶部写 var t = I18n.t; 即可。
  global.I18n = {
    t: t, get: get, set: set, chosen: chosen, langs: LANGS,
    category: category, backendName: backendName, applyStatic: applyStatic
  };
})(window);

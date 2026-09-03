/**
 * 外壳 —— 顶栏、日期控件、主题开关、路由注册
 *
 * 日期控件归外壳所有:论文页和统计页都按同一个日期范围工作,
 * 各自维护一份的话,切过去还要再选一次,这正是旧版最别扭的地方。
 */
(function (global) {
  'use strict';

  var t = I18n.t;   // 不用全局 t:compromise.js 会覆盖它

  var fp = null;   // flatpickr 实例

  function $(id) { return document.getElementById(id); }

  /* ---------------------------------------------------------- 主题 --- */

  var THEME_ICON = {
    light: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17a5 5 0 100-10 5 5 0 000 10zm0 2a1 1 0 011 1v2a1 1 0 11-2 0v-2a1 1 0 011-1zm0-18a1 1 0 011 1v2a1 1 0 11-2 0V2a1 1 0 011-1zM4.2 4.2a1 1 0 011.4 0l1.5 1.5a1 1 0 01-1.4 1.4L4.2 5.6a1 1 0 010-1.4zm12.7 12.7a1 1 0 011.4 0l1.5 1.5a1 1 0 01-1.4 1.4l-1.5-1.5a1 1 0 010-1.4zM1 12a1 1 0 011-1h2a1 1 0 110 2H2a1 1 0 01-1-1zm19 0a1 1 0 011-1h2a1 1 0 110 2h-2a1 1 0 01-1-1zM4.2 19.8a1 1 0 010-1.4l1.5-1.5a1 1 0 011.4 1.4l-1.5 1.5a1 1 0 01-1.4 0zM16.9 7.1a1 1 0 010-1.4l1.5-1.5a1 1 0 111.4 1.4l-1.5 1.5a1 1 0 01-1.4 0z"/></svg>',
    dark: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>',
    system: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-5v2h3a1 1 0 110 2H8a1 1 0 110-2h3v-2H5a2 2 0 01-2-2V5zm2 0v10h14V5H5z"/></svg>'
  };

  function paintTheme() {
    var pref = Theme.get();
    var btn = $('themeToggle');
    btn.innerHTML = THEME_ICON[pref] || THEME_ICON.system;
    btn.title = t('shell.theme.' + pref);
    document.querySelectorAll('#themeChoice .chip').forEach(function (c) {
      c.classList.toggle('is-on', c.dataset.themePref === pref);
    });
  }


  /* ---------------------------------------------------------- 语言 --- */

  function paintLangChoice() {
    var cur = I18n.get();
    ['langChoice', 'langPick'].forEach(function (id) {
      var box = $(id);
      if (!box) return;
      box.innerHTML = '';
      I18n.langs.forEach(function (l) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip' + (l.code === cur ? ' is-on' : '');
        b.textContent = l.native;
        b.dataset.lang = l.code;
        b.addEventListener('click', function () {
          I18n.set(l.code);          // 立即切换,不等确认按钮
        });
        box.appendChild(b);
      });
    });
  }

  /** 首次进入(从没选过语言)弹一次选择。选过就再也不弹。 */
  function maybeAskLanguage() {
    if (I18n.chosen()) return;
    var m = $('langModal');
    m.hidden = false;
    $('langConfirm').addEventListener('click', function () {
      I18n.set(I18n.get());          // 落盘,标记为"选过了"
      m.hidden = true;
    });
  }

  /* ------------------------------------------------------ 日期控件 --- */

  function rangeLabel() {
    var s = Store.state.start, e = Store.state.end;
    if (!s) return t('shell.pickDate');
    if (s === e) return s;
    var n = Store.datesInRange().length;
    return s.slice(5) + ' → ' + e.slice(5) + ' · ' + n + t('shell.days');
  }

  function paintDate() {
    $('dateChipLabel').textContent = rangeLabel();
    var note = $('statsRangeNote');
    if (note) note.textContent = Store.state.start === Store.state.end
      ? Store.state.start
      : (Store.state.start + ' → ' + Store.state.end);
    paintPresetState();
  }

  function paintPresetState() {
    var dates = Store.datesInRange();
    var all = Store.state.availableDates;
    var isLatest = dates.length && dates[dates.length - 1] === all[all.length - 1];
    document.querySelectorAll('#statsPresets .chip, #datePresets .chip').forEach(function (b) {
      var days = parseInt(b.dataset.days, 10);
      var on = days === 0
        ? dates.length === all.length
        : (isLatest && dates.length === Math.min(days, all.length));
      b.classList.toggle('is-on', !!on);
    });
  }

  function openDatePicker() { $('datePickerModal').hidden = false; }
  function closeDatePicker() { $('datePickerModal').hidden = true; }

  function initDatePicker() {
    var dates = Store.state.availableDates;
    var input = $('datepicker');

    fp = flatpickr(input, {
      inline: true,
      mode: Store.state.start === Store.state.end ? 'single' : 'range',
      dateFormat: 'Y-m-d',
      defaultDate: Store.state.start === Store.state.end
        ? Store.state.start : [Store.state.start, Store.state.end],
      // 只允许选有数据的日子,省得选中一个空日期再报错
      enable: dates,
      onChange: function (sel) {
        if ($('dateRangeMode').checked) {
          if (sel.length === 2) {
            Store.setRange(fmt(sel[0]), fmt(sel[1]));
            closeDatePicker();
          }
        } else if (sel.length >= 1) {
          Store.setRange(fmt(sel[0]), fmt(sel[0]));
          closeDatePicker();
        }
      }
    });

    $('dateRangeMode').checked = Store.state.start !== Store.state.end;
    $('dateRangeMode').addEventListener('change', function () {
      fp.set('mode', this.checked ? 'range' : 'single');
      fp.clear();
    });

    $('dateChip').addEventListener('click', openDatePicker);
    $('dpClose').addEventListener('click', closeDatePicker);
    $('datePickerModal').addEventListener('click', function (e) {
      if (e.target.id === 'datePickerModal') closeDatePicker();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('datePickerModal').hidden) closeDatePicker();
    });

    // 预设:弹层里和统计页工具行里是同一套行为
    document.querySelectorAll('#datePresets .chip, #statsPresets .chip').forEach(function (b) {
      b.addEventListener('click', function () {
        var days = parseInt(b.dataset.days, 10);
        var r = Store.presetRange(days === 1 ? 1 : days);
        if (!r) return;
        Store.setRange(r.start, r.end);
        syncPickerTo(r);
        closeDatePicker();
      });
    });
  }

  function syncPickerTo(r) {
    if (!fp) return;
    var isRange = r.start !== r.end;
    $('dateRangeMode').checked = isRange;
    fp.set('mode', isRange ? 'range' : 'single');
    fp.setDate(isRange ? [r.start, r.end] : r.start, false);
  }

  function fmt(d) {
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  /* ------------------------------------------------------ 工具行 --- */

  /** 只显示属于当前路由的 subbar 槽位。 */
  function paintSubbar(route) {
    document.querySelectorAll('.subbar-slot').forEach(function (s) {
      var forWhat = s.dataset.for;
      if (forWhat === 'papers-filters') return;   // 由论文视图按有无关注词决定
      s.hidden = forWhat !== route;
    });
    var filters = document.querySelector('.subbar-slot[data-for="papers-filters"]');
    if (filters && route !== 'papers') filters.hidden = true;
    // 日期控件只对论文页和统计页有意义
    $('dateChip').hidden = (route !== 'papers' && route !== 'stats');
  }

  function paintTabs(route) {
    document.querySelectorAll('#mainTabs .tab').forEach(function (tab) {
      var on = tab.dataset.route === route;
      tab.classList.toggle('is-active', on);
      if (on) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
    });
  }

  /* ---------------------------------------------------------- 启动 --- */

  async function boot() {
    paintTheme();
    paintLangChoice();
    maybeAskLanguage();
    $('themeToggle').addEventListener('click', function () { Theme.cycle(); paintTheme(); });
    document.querySelectorAll('#themeChoice .chip').forEach(function (c) {
      c.addEventListener('click', function () { Theme.set(c.dataset.themePref); paintTheme(); });
    });

    if (Auth.isPasswordEnabled && Auth.isPasswordEnabled()) {
      var lo = $('logoutButton');
      lo.hidden = false;
      lo.addEventListener('click', function () { Auth.logout(); });
    }

    var top = $('backToTop');
    window.addEventListener('scroll', function () { top.hidden = window.scrollY < 320; }, { passive: true });
    top.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });

    document.querySelector('#paperSidebar .close-sidebar').addEventListener('click', function () {
      document.getElementById('paperSidebar').classList.remove('is-open');
    });

    Store.on('rangechange', paintDate);

    // 换语言:静态文案 i18n 自己刷了,这里补动态生成的那些 ——
    // 日期胶囊、语言选中态、以及当前视图整块重画。
    window.addEventListener('languagechange', function () {
      paintTheme();
      paintLangChoice();
      paintDate();
      if (Router.current) Router.rerender(Router.current);
    });

    try {
      await Store.loadAvailableDates();
    } catch (e) {
      document.getElementById('paperContainer').innerHTML =
        '<div class="empty-state"><p>' + t('shell.loadFailed') + '</p><p>' + e.message + '</p></div>';
      return;
    }

    // 默认打开最新一天;数据多的时候一上来就拉 30 天会很慢
    initDatePicker();
    paintDate();

    Router.register('papers',   { el: document.getElementById('view-papers'),   init: PapersView.init,   show: PapersView.show,   rerender: PapersView.rerender });
    Router.register('marked',   { el: document.getElementById('view-marked'),   init: MarkedView.init,   show: MarkedView.show,   rerender: MarkedView.show });
    Router.register('stats',    { el: document.getElementById('view-stats'),    init: StatsView.init,    show: StatsView.show,    rerender: StatsView.rerender });
    Router.register('settings', { el: document.getElementById('view-settings'), init: SettingsView.init, show: SettingsView.show, rerender: SettingsView.show });

    Router.onNavigate(function (route) { paintTabs(route); paintSubbar(route); });
    Router.start();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  global.Shell = { paintDate: paintDate, syncPickerTo: syncPickerTo, paintLangChoice: paintLangChoice };
})(window);

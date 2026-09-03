/**
 * 主题:浅色 / 深色 / 跟随系统
 *
 * 这个文件必须在 <head> 里同步引入,且排在样式表之前 —— 它要在首屏绘制前
 * 把 data-theme 写到 <html> 上。放到 DOMContentLoaded 里做的话,深色模式用户
 * 会先看到一帧白屏。
 */
(function () {
  'use strict';

  var KEY = 'arxiv_theme';        // 'light' | 'dark' | 'system'
  var root = document.documentElement;

  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return (v === 'light' || v === 'dark' || v === 'system') ? v : 'system';
    } catch (e) {
      return 'system';   // 隐私模式下 localStorage 会抛
    }
  }

  function apply(pref) {
    if (pref === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', pref);
    // 地址栏/状态栏颜色跟着主题走
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved() === 'dark' ? '#0d0f10' : '#ffffff');
  }

  /** 当前实际生效的是明还是暗(把 system 解析成具体值)。 */
  function resolved() {
    var pref = stored();
    if (pref !== 'system') return pref;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark' : 'light';
  }

  function set(pref) {
    try { localStorage.setItem(KEY, pref); } catch (e) { /* 忽略 */ }
    apply(pref);
    window.dispatchEvent(new CustomEvent('themechange', {
      detail: { pref: pref, resolved: resolved() }
    }));
  }

  /** 在 浅 → 深 → 跟随系统 之间轮转。 */
  function cycle() {
    var order = ['light', 'dark', 'system'];
    set(order[(order.indexOf(stored()) + 1) % order.length]);
    return stored();
  }

  apply(stored());

  // 跟随系统时,系统切换要实时反映(图表需要按新主题重画)
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function () {
      if (stored() === 'system') {
        apply('system');
        window.dispatchEvent(new CustomEvent('themechange', {
          detail: { pref: 'system', resolved: resolved() }
        }));
      }
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  // 首屏那一帧不要过渡,否则加载时会看到颜色渐变
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      requestAnimationFrame(function () { root.classList.add('theme-ready'); });
    });
  } else {
    requestAnimationFrame(function () { root.classList.add('theme-ready'); });
  }

  window.Theme = { get: stored, set: set, cycle: cycle, resolved: resolved };
})();

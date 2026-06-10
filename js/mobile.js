/**
 * 手机浏览器识别 / Mobile browser detection
 * 在 <html> 上加 is-mobile / is-desktop 类(供 CSS 用),并暴露 window.IS_MOBILE。
 * 放在 <head> 里尽早执行,避免渲染闪烁。
 */
(function () {
  function detectMobile() {
    var ua = navigator.userAgent || navigator.vendor || '';
    var uaMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Windows Phone/i.test(ua);
    // iPadOS 13+ 伪装成 Mac,用触摸点数补判
    var iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    var touch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    var small = window.matchMedia ? window.matchMedia('(max-width: 768px)').matches : (window.innerWidth <= 768);
    return uaMobile || iPadOS || (touch && small);
  }

  function apply() {
    var mobile = detectMobile();
    var root = document.documentElement;
    root.classList.toggle('is-mobile', mobile);
    root.classList.toggle('is-desktop', !mobile);
    window.IS_MOBILE = mobile;
  }

  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
})();

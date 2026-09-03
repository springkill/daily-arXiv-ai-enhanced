/**
 * 极简 hash 路由
 *
 * 用 hash 而不是 History API:站点是 nginx 直接吐静态文件,History 路由要求
 * 服务端把所有路径都 rewrite 到 index.html,那是部署侧的额外约定。hash 路由
 * 在任何静态托管上都能直接用,深链和刷新都不会 404。
 *
 * 每个视图注册一次 { init, show, hide }:
 *   - init 懒执行,只在首次进入该视图时跑一次(避免开页就把四个视图全初始化)
 *   - show 每次进入都跑,用来按当前日期范围补渲染
 */
(function (global) {
  'use strict';

  var routes = Object.create(null);
  var current = null;
  var DEFAULT = 'papers';

  function register(name, view) {
    routes[name] = Object.assign({ inited: false }, view);
  }

  function parse() {
    var h = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
    return routes[h] ? h : DEFAULT;
  }

  async function go(name, opts) {
    if (!routes[name]) name = DEFAULT;
    if (current === name && !(opts && opts.force)) return;

    var prev = current ? routes[current] : null;
    var next = routes[name];

    if (prev && prev.hide) { try { prev.hide(); } catch (e) { console.error(e); } }
    if (prev && prev.el) prev.el.hidden = true;

    current = name;
    document.body.dataset.route = name;

    if (next.el) next.el.hidden = false;

    if (!next.inited) {
      next.inited = true;
      if (next.init) {
        try { await next.init(); }
        catch (e) {
          next.inited = false;   // 初始化失败要能重试,否则该视图永久白屏
          console.error('[router] ' + name + ' 初始化失败', e);
        }
      }
    }
    if (next.show) { try { await next.show(); } catch (e) { console.error(e); } }

    emit(name);
    // 换视图后回到顶部,否则从长列表跳到设置页会停在半空
    if (!(opts && opts.keepScroll)) window.scrollTo({ top: 0, behavior: 'instant' });
  }

  var navListeners = [];
  function onNavigate(fn) { navListeners.push(fn); }
  function emit(name) {
    navListeners.forEach(function (fn) {
      try { fn(name); } catch (e) { console.error(e); }
    });
  }

  /** 强制让某个视图重新渲染(换语言后用)。 */
  async function rerender(name) {
    var v = routes[name];
    if (!v || !v.inited) return;
    if (v.rerender) { try { await v.rerender(); } catch (e) { console.error(e); } }
    else if (v.show) { try { await v.show(); } catch (e) { console.error(e); } }
  }

  function navigate(name) {
    if (location.hash === '#/' + name) go(name, { force: false });
    else location.hash = '#/' + name;
  }

  function start() {
    window.addEventListener('hashchange', function () { go(parse()); });
    if (!location.hash) location.replace('#/' + DEFAULT);
    go(parse());
  }

  global.Router = {
    register: register,
    start: start,
    navigate: navigate,
    rerender: rerender,
    onNavigate: onNavigate,
    get current() { return current; }
  };
})(window);

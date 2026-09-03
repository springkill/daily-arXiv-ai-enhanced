/**
 * 设置视图 —— 关注的关键词 / 作者 / 外观
 *
 * 存储契约与旧版一致(localStorage 的 preferredKeywords / preferredAuthors),
 * 所以老用户的配置不会丢。保存后论文视图在 show() 时会自己重新读。
 */
(function (global) {
  'use strict';

  var kw = [];
  var au = [];

  function load() {
    try { kw = JSON.parse(localStorage.getItem('preferredKeywords') || '[]'); } catch (e) { kw = []; }
    try { au = JSON.parse(localStorage.getItem('preferredAuthors') || '[]'); } catch (e) { au = []; }
    if (!Array.isArray(kw)) kw = [];
    if (!Array.isArray(au)) au = [];
  }

  function persist() {
    localStorage.setItem('preferredKeywords', JSON.stringify(kw));
    localStorage.setItem('preferredAuthors', JSON.stringify(au));
  }

  function paint() {
    paintList('selectedKeywords', 'emptyTagMessage', kw, '还没有关键词。在下面添加。', false);
    paintList('selectedAuthors', 'emptyAuthorMessage', au, '还没有作者。在下面添加。', true);
  }

  function paintList(hostId, emptyId, arr, emptyText, isAuthor) {
    var host = document.getElementById(hostId);
    host.innerHTML = '';
    if (!arr.length) {
      var p = document.createElement('div');
      p.className = 'empty-tag-message';
      p.id = emptyId;
      p.textContent = emptyText;
      host.appendChild(p);
      return;
    }
    arr.forEach(function (v) {
      var tag = document.createElement('span');
      tag.className = 'tag-item' + (isAuthor ? ' tag-author' : '');
      tag.appendChild(document.createTextNode(v));   // 用户输入,不走 innerHTML
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'remove-tag';
      x.textContent = '×';
      x.title = '移除';
      x.addEventListener('click', function () {
        var i = arr.indexOf(v);
        if (i >= 0) arr.splice(i, 1);
        persist(); paint();
      });
      tag.appendChild(x);
      host.appendChild(tag);
    });
  }

  function addFrom(inputId, arr) {
    var input = document.getElementById(inputId);
    var v = input.value.trim();
    if (!v) return;
    if (arr.indexOf(v) < 0) arr.push(v);
    input.value = '';
    persist(); paint();
    input.focus();
  }

  function copy(arr, what) {
    var text = arr.join(', ');
    var done = function () { toast(what + '已复制(' + arr.length + ' 项)'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { toast('复制失败'); });
    } else {
      // 非安全上下文下 clipboard API 不可用,退回 execCommand
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败'); }
      document.body.removeChild(ta);
    }
  }

  var toastEl = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.classList.remove('is-on'); }, 1800);
  }

  function init() {
    load();
    paint();

    document.getElementById('addKeyword').addEventListener('click', function () { addFrom('keywordInput', kw); });
    document.getElementById('addAuthor').addEventListener('click', function () { addFrom('authorInput', au); });

    document.getElementById('keywordInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addFrom('keywordInput', kw); }
    });
    document.getElementById('authorInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addFrom('authorInput', au); }
    });

    document.getElementById('copyKeywords').addEventListener('click', function () { copy(kw, '关键词'); });
    document.getElementById('copyAuthors').addEventListener('click', function () { copy(au, '作者'); });

    // 增删即时生效并已落盘,「保存」只是给一个明确的确认
    document.getElementById('saveSettings').addEventListener('click', function () {
      persist(); toast('已保存');
    });
    document.getElementById('resetSettings').addEventListener('click', function () {
      if (!confirm('清空所有关注的关键词和作者?')) return;
      kw = []; au = []; persist(); paint(); toast('已恢复默认');
    });
  }

  function show() { load(); paint(); }

  global.SettingsView = { init: init, show: show };
})(window);

/**
 * 「已标记」视图:列出跨设备标记的论文,可跳 arXiv、可取消标记。
 * 标记数据来自 js/marks.js(服务端存储),与日期范围无关。
 */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var MODE_NAME = { quick: '快速审', normal: '正常审', deep: '深度审' };

  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';

  function cardHtml(m) {
    var cats = Array.isArray(m.categories) ? m.categories : (m.categories ? [m.categories] : []);
    var badge = '';
    if (typeof m.relevance_score === 'number') {
      var s = m.relevance_score;
      var cls = s >= 8 ? 'rel-high' : (s >= 6 ? 'rel-mid' : 'rel-low');
      badge = '<span class="relevance-badge ' + cls + '">相关 ' + s + '/10' +
              (m.topic ? ' · ' + esc(m.topic) : '') + '</span>';
    }
    // 审稿结论:后端在 /api/marks 里就把每篇最深的那份联查出来了,
    // 收藏列表直接看得到结论,不用再点进详情。
    var rv = '';
    if (m.review) {
        var r = m.review;
        // 不要跟上面相关性徽章的 cls 重名 —— 同一函数里 var 重声明不报错,
        // 但读代码的人会以为是同一个变量
        var recCls = r.recommend === '接收' ? 'v-accept'
                   : (r.recommend === '拒稿' ? 'v-reject' : 'v-revise');
        rv = '<div class="ref-review">' +
             '<span class="ref-review-rec ' + recCls + '">' + esc(r.recommend || '已审') + '</span>' +
             (r.rating != null ? '<span class="ref-review-score">' + r.rating + '/10</span>' : '') +
             '<span class="ref-review-mode">' + esc(MODE_NAME[r.mode] || r.mode) + '</span>' +
             // 会议名最长,放最后并省略号截断,短元素才不会被挤到下一行
             '<span class="ref-review-venue" title="' + esc(r.venue || '') + '">' + esc(r.venue || '') + '</span>' +
             '</div>';
    }

    var url = m.url || ('https://arxiv.org/abs/' + encodeURIComponent(m.id));
    return '<article class="paper-ref' + (m.review ? ' has-review' : '') + '" data-id="' + esc(m.id) + '">' +
      '<a class="paper-ref-title" href="' + esc(url) + '" target="_blank" rel="noopener">' +
      esc(m.title || m.id) + '</a>' +
      (m.authors ? '<div class="paper-ref-meta">' + esc(m.authors) + '</div>' : '') +
      (m.summary ? '<div class="paper-ref-summary">' + esc(m.summary) + '</div>' : '') +
      rv +
      '<div class="paper-ref-foot">' +
        '<button class="mark-btn is-marked" data-id="' + esc(m.id) + '" type="button" ' +
        'title="取消标记" aria-label="取消标记">' + STAR + '</button>' +
        '<div class="paper-card-categories" style="margin:0">' + badge +
        cats.slice(0, 3).map(function (c) { return '<span class="category-tag">' + esc(c) + '</span>'; }).join('') +
        '</div>' +
        '<span class="paper-card-date" style="margin-left:auto">' + esc(m.date || '') + '</span>' +
      '</div></article>';
  }

  var onlyReviewed = false;

  function render() {
    var list = document.getElementById('markedList');
    if (!global.Marks) {
      list.innerHTML = '<div class="empty-state"><p>标记功能不可用</p></div>';
      return;
    }
    var all = Marks.list();
    var reviewed = all.filter(function (m) { return m.review; }).length;
    paintToolbar(all.length, reviewed);
    var items = onlyReviewed ? all.filter(function (m) { return m.review; }) : all;
    if (!items.length) {
      list.innerHTML = onlyReviewed
        ? '<div class="empty-state"><p>标记的论文里还没有审过稿的</p></div>'
        : '<div class="empty-state"><p>还没有标记任何论文</p>' +
          '<p>在论文列表里点卡片上的 ☆ 即可标记,之后在任意设备上都能在这里找到。</p></div>';
      return;
    }
    list.innerHTML = items.map(cardHtml).join('');

    list.querySelectorAll('.mark-btn').forEach(function (btn) {
      btn.addEventListener('click', async function (e) {
        e.preventDefault();
        btn.disabled = true;
        try {
          await Marks.remove(btn.getAttribute('data-id'));
          var node = btn.closest('.paper-ref');
          if (node) node.remove();
          if (!Marks.count()) render();
        } catch (err) {
          btn.disabled = false;
          alert('取消标记失败,请重试');
        }
      });
    });
  }

  /** 顶部工具行:总数 / 已审稿数 + 「只看已审稿」开关。 */
  function paintToolbar(total, reviewed) {
    var bar = document.getElementById('markedToolbar');
    if (!bar) return;
    bar.innerHTML = '';
    var note = document.createElement('span');
    note.className = 'subbar-note';
    note.textContent = total + ' 篇已标记 · ' + reviewed + ' 篇已审稿';
    bar.appendChild(note);
    if (!reviewed) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip' + (onlyReviewed ? ' is-on' : '');
    btn.textContent = '只看已审稿';
    btn.addEventListener('click', function () { onlyReviewed = !onlyReviewed; render(); });
    bar.appendChild(btn);
  }

  async function init() {
    if (global.Marks) {
      await Marks.load();
      // 在论文页取消标记后切过来要是最新的
      Marks.onChange(function () { if (Router.current === 'marked') render(); });
    }
    render();
  }

  function show() { render(); }

  global.MarkedView = { init: init, show: show };
})(window);

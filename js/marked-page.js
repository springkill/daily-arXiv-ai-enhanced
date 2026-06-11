/**
 * 「已标记」页:列出所有跨设备标记的论文,可跳转 arXiv、可取消标记。
 */
(function () {
  function fmtDate(d) {
    if (!d) return '';
    try {
      const dt = new Date(d);
      if (isNaN(dt)) return d;
      return dt.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch (e) { return d; }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function cardHtml(m) {
    const cats = Array.isArray(m.categories) ? m.categories : (m.categories ? [m.categories] : []);
    const catTags = cats.map(c => `<span class="category-tag">${esc(c)}</span>`).join('');
    let badge = '';
    if (typeof m.relevance_score === 'number') {
      const s = m.relevance_score;
      const cls = s >= 8 ? 'rel-high' : (s >= 6 ? 'rel-mid' : 'rel-low');
      const topic = m.topic ? ` · ${esc(m.topic)}` : '';
      badge = `<span class="relevance-badge ${cls}">相关 ${s}/10${topic}</span>`;
    }
    const url = m.url || ('https://arxiv.org/abs/' + encodeURIComponent(m.id));
    return `
      <div class="marked-item" data-id="${esc(m.id)}">
        <button class="mark-btn marked" data-id="${esc(m.id)}" title="取消标记" aria-label="取消标记">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
        </button>
        <div class="marked-item-body">
          <a class="marked-item-title" href="${esc(url)}" target="_blank" rel="noopener">${esc(m.title || m.id)}</a>
          <div class="marked-item-meta">
            ${badge}${catTags}
            <span class="marked-item-date">${esc(fmtDate(m.date))}</span>
          </div>
        </div>
      </div>`;
  }

  function render() {
    const listEl = document.getElementById('markedList');
    const totalEl = document.getElementById('markedTotal');
    if (!window.Marks) { listEl.innerHTML = '<div class="marked-empty">标记功能不可用</div>'; return; }
    const items = Marks.list();
    if (totalEl) totalEl.textContent = items.length;
    if (!items.length) {
      listEl.innerHTML = '<div class="marked-empty">还没有标记任何论文。<br>在首页点论文卡片上的 ☆ 即可标记,稍后在这里跨设备找到它。</div>';
      return;
    }
    listEl.innerHTML = items.map(cardHtml).join('');
    listEl.querySelectorAll('.mark-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const id = btn.getAttribute('data-id');
        btn.disabled = true;
        try {
          await Marks.remove(id);
          const node = btn.closest('.marked-item');
          if (node) node.remove();
          if (totalEl) totalEl.textContent = Marks.count();
          if (!Marks.count()) render();
        } catch (err) {
          alert('取消标记失败,请重试');
          btn.disabled = false;
        }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await Marks.load();
    render();
  });
})();

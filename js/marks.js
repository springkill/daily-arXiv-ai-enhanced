/**
 * 跨设备"已标记论文"客户端。所有设备共用后端 /api/marks(单用户,前置 basic auth)。
 * 全局对象 window.Marks。
 */
(function () {
  const API = '/api/marks';
  const state = {
    ids: new Set(),       // 已标记的论文 id
    items: new Map(),     // id -> 元数据
    loaded: false,
  };
  const listeners = new Set();

  function notify() { listeners.forEach(fn => { try { fn(); } catch (e) {} }); }

  async function load() {
    try {
      const resp = await fetch(API, { cache: 'no-store' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      state.ids.clear(); state.items.clear();
      (data.marks || []).forEach(m => { state.ids.add(String(m.id)); state.items.set(String(m.id), m); });
      state.loaded = true;
      notify();
      return true;
    } catch (e) {
      console.warn('加载标记失败:', e);
      state.loaded = true; // 失败也置位,避免一直等待
      notify();
      return false;
    }
  }

  function isMarked(id) { return state.ids.has(String(id)); }
  function count() { return state.ids.size; }
  function list() {
    return Array.from(state.items.values())
      .sort((a, b) => (b.marked_at || 0) - (a.marked_at || 0));
  }

  async function add(id, meta) {
    id = String(id);
    const resp = await fetch(API + '/' + encodeURIComponent(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(meta || {}),
    });
    if (!resp.ok) throw new Error('mark failed HTTP ' + resp.status);
    state.ids.add(id);
    state.items.set(id, Object.assign({ id: id, marked_at: Date.now() }, meta || {}));
    notify();
  }

  async function remove(id) {
    id = String(id);
    const resp = await fetch(API + '/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!resp.ok) throw new Error('unmark failed HTTP ' + resp.status);
    state.ids.delete(id);
    state.items.delete(id);
    notify();
  }

  // 切换;返回新状态(true=已标记)。乐观失败会抛错由调用方处理。
  async function toggle(id, meta) {
    if (isMarked(id)) { await remove(id); return false; }
    await add(id, meta); return true;
  }

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  window.Marks = { load, isMarked, count, list, add, remove, toggle, onChange, get loaded() { return state.loaded; } };
})();

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

export function $(id) {
  return document.getElementById(id);
}

/* ---------------- 弹层与 Android 返回键 ---------------- */

const overlayStack = [];

export function overlayOpen(id, hide, options = {}) {
  if (overlayStack.some((o) => o.id === id)) return;
  overlayStack.push({ id, hide });
  history.pushState({ heroxpOverlay: overlayStack.length }, '', location.href);
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
  options.onOpen?.();
}

export function overlayIsOpen(id) {
  return overlayStack.some((o) => o.id === id);
}

// 所有关闭动作都经过这里：栈顶弹层通过 history.back() 回收，popstate 统一执行隐藏。
export function overlayClose(id) {
  const idx = overlayStack.findIndex((o) => o.id === id);
  if (idx === -1) return;
  if (idx === overlayStack.length - 1) {
    history.back();
  } else {
    const [entry] = overlayStack.splice(idx, 1);
    entry.hide?.();
    const el = document.getElementById(entry.id);
    if (el) el.classList.add('hidden');
  }
}

export function overlayCount() {
  return overlayStack.length;
}

window.addEventListener('popstate', () => {
  const entry = overlayStack.pop();
  if (!entry) return;
  entry.hide?.();
  const el = document.getElementById(entry.id);
  if (el) el.classList.add('hidden');
});

/* ---------------- 轻提示 ---------------- */

let toastTimer = null;

export function toast(message, type = 'info') {
  let el = document.getElementById('appToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'appToast';
    el.className =
      'fixed top-3 left-1/2 -translate-x-1/2 z-[60] max-w-[92%] px-4 py-2.5 rounded-2xl text-xs font-bold shadow-lg transition-opacity duration-200 pointer-events-none text-center';
    document.body.appendChild(el);
  }
  const styles = {
    info: 'bg-slate-800/95 text-white',
    success: 'bg-emerald-600/95 text-white',
    error: 'bg-rose-600/95 text-white'
  };
  el.className = `fixed top-3 left-1/2 -translate-x-1/2 z-[60] max-w-[92%] px-4 py-2.5 rounded-2xl text-xs font-bold shadow-lg transition-opacity duration-200 pointer-events-none text-center ${styles[type]}`;
  el.textContent = message;
  el.style.opacity = '1';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.style.opacity = '0';
  }, 2600);
}

import { $, escapeHtml, overlayOpen, overlayClose } from '../lib/dom.js';

function describeEntityValue(entity, value) {
  if (value === null || value === undefined) return '（已删除）';
  if (entity === 'category') return `${value.name}（颜色 ${value.color}）`;
  if (entity === 'rule') {
    const version = value.versions[value.versions.length - 1];
    return `${version.name}：${version.points > 0 ? '+' : ''}${version.points} 分${value.deletedAt ? '（已删除）' : ''}`;
  }
  if (entity === 'reward') {
    const version = value.versions[value.versions.length - 1];
    return `${version.cost} 积分：${version.text.split('\n')[0]}${value.deletedAt ? '（已删除）' : ''}`;
  }
  return JSON.stringify(value);
}

/**
 * 冲突选择弹窗：每条冲突选择“本机版本”或“云端版本”。
 * 返回 choices 数组（'local'|'remote'）；用户取消返回 null，此时不得写回云端。
 */
export function initConflicts(ctx) {
  const modal = $('conflictModal');
  const listEl = $('conflictList');
  const titleEl = $('conflictModalTitle');
  const confirmBtn = $('conflictConfirmBtn');
  const cancelBtn = $('conflictCancelBtn');

  let currentConflicts = [];
  let resolveFn = null;

  function finish(choices) {
    const resolve = resolveFn;
    resolveFn = null;
    currentConflicts = [];
    overlayClose('conflictModal');
    resolve?.(choices);
  }

  confirmBtn.addEventListener('click', () => {
    const choices = currentConflicts.map((_, index) => {
      const checked = listEl.querySelector(`input[name="conflict-${index}"]:checked`);
      return checked?.value === 'remote' ? 'remote' : 'local';
    });
    finish(choices);
  });
  cancelBtn.addEventListener('click', () => finish(null));

  function show(conflicts, options = {}) {
    currentConflicts = conflicts;
    titleEl.textContent = options.title ?? `检测到 ${conflicts.length} 处数据冲突`;
    listEl.innerHTML = conflicts
      .map((conflict, index) => {
        const localDesc = conflict.localDesc ?? describeEntityValue(conflict.entity, conflict.local);
        const remoteDesc = conflict.remoteDesc ?? describeEntityValue(conflict.entity, conflict.remote);
        return `
        <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
          <p class="text-xs font-bold text-slate-700">${escapeHtml(conflict.label)}</p>
          <label class="flex items-start gap-2 p-2 bg-white rounded-lg border border-slate-200 cursor-pointer">
            <input type="radio" name="conflict-${index}" value="local" checked class="mt-0.5">
            <span class="text-xs text-slate-600"><b class="text-slate-700">本机：</b>${escapeHtml(localDesc)}</span>
          </label>
          <label class="flex items-start gap-2 p-2 bg-white rounded-lg border border-slate-200 cursor-pointer">
            <input type="radio" name="conflict-${index}" value="remote" class="mt-0.5">
            <span class="text-xs text-slate-600"><b class="text-slate-700">云端：</b>${escapeHtml(remoteDesc)}</span>
          </label>
        </div>`;
      })
      .join('');

    return new Promise((resolve) => {
      resolveFn = resolve;
      overlayOpen('conflictModal', () => {
        // Android/浏览器返回键关闭视为取消
        const pending = resolveFn;
        resolveFn = null;
        currentConflicts = [];
        modal.classList.add('hidden');
        pending?.(null);
      });
    });
  }

  return { show };
}

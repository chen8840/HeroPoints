import { $, escapeHtml, toast } from '../lib/dom.js';
import { activeRules, orderedCategories, sortByOrder } from '../domain/model.js';
import { pointsAt, nameAt, currentCategoryId } from '../domain/scoring.js';
import { deleteCategory, deleteRule, moveCategory, moveRule } from '../domain/operations.js';
import { buildBackupPayload, backupFileName, parseBackup, BackupFormatError } from '../sync/backup.js';
import { mergeDocuments, resolveConflicts } from '../domain/merge.js';

const MOVE_BUTTON_CLASS =
  'w-5 h-5 rounded-md text-[11px] leading-none text-slate-500 bg-slate-200/70 hover:bg-slate-300/70 transition disabled:opacity-25 disabled:cursor-default';

function moveButtons({ action, id, index, total, className = MOVE_BUTTON_CLASS }) {
  if (total < 2) return '';
  return `
    <span class="flex items-center gap-0.5">
      <button data-action="${action}" data-id="${escapeHtml(id)}" data-dir="-1" title="上移"
        ${index === 0 ? 'disabled' : ''} class="${className}">↑</button>
      <button data-action="${action}" data-id="${escapeHtml(id)}" data-dir="1" title="下移"
        ${index === total - 1 ? 'disabled' : ''} class="${className}">↓</button>
    </span>`;
}

export function initRules(ctx) {
  const container = $('ruleList');

  function render() {
    const doc = ctx.getDocument();
    const categories = orderedCategories(doc);
    const rules = activeRules(doc);
    const today = ctx.today();

    if (categories.length === 0) {
      container.innerHTML = '<div class="p-8 text-center text-slate-400 text-xs">暂无任何类别，请点击上方「+ 新增类别」</div>';
      return;
    }

    container.innerHTML = categories
      .map((category, categoryIndex) => {
        const catRules = sortByOrder(rules.filter((rule) => currentCategoryId(rule, today) === category.id));
        const itemsHtml = catRules
          .map((rule, ruleIndex) => {
            const points = pointsAt(rule, today);
            const versionCount = rule.versions.length;
            return `
            <div class="flex justify-between items-center gap-2 p-3 bg-white border border-slate-100 rounded-xl shadow-sm">
              <div class="flex items-start gap-2 min-w-0">
                <span class="text-xs font-bold px-2 py-0.5 rounded shrink-0 ${points > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}">${points > 0 ? '+' + points : points}</span>
                <span class="text-xs font-bold text-slate-700">${escapeHtml(nameAt(rule, today))}</span>
                ${versionCount > 1 ? `<span class="text-[9px] text-slate-400 shrink-0">已调整 ${versionCount - 1} 次</span>` : ''}
              </div>
              <div class="flex items-center gap-2.5 shrink-0">
                ${moveButtons({ action: 'move-rule', id: rule.id, index: ruleIndex, total: catRules.length })}
                <button data-action="edit-rule" data-id="${escapeHtml(rule.id)}" class="text-xs text-blue-500 font-medium hover:underline">编辑</button>
                <button data-action="delete-rule" data-id="${escapeHtml(rule.id)}" class="text-xs text-rose-400 font-medium hover:underline">删除</button>
              </div>
            </div>`;
          })
          .join('');

        return `
        <div class="space-y-2.5 bg-slate-50/80 p-3.5 rounded-2xl border border-slate-200/60 shadow-sm transition"
             style="border-left: 4px solid ${escapeHtml(category.color)};">
          <div class="flex justify-between items-center gap-1 h-6">
            <div class="flex items-center gap-2 min-w-0">
              <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${escapeHtml(category.color)}"></span>
              <span class="text-xs font-black text-slate-800 leading-none">${escapeHtml(category.name)}</span>
              <span class="text-[10px] bg-slate-200/90 text-slate-600 font-bold px-1.5 py-0.5 rounded-full leading-none">${catRules.length}</span>
              ${moveButtons({ action: 'move-cat', id: category.id, index: categoryIndex, total: categories.length })}
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <button data-action="add-rule" data-cat="${escapeHtml(category.id)}" class="px-2 py-1 rounded-md text-[11px] font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 transition leading-none">+加事项</button>
              <button data-action="edit-cat" data-id="${escapeHtml(category.id)}" class="px-2 py-1 rounded-md text-[11px] font-medium text-slate-600 hover:bg-slate-200/60 transition leading-none">编辑类别</button>
              <button data-action="delete-cat" data-id="${escapeHtml(category.id)}" class="px-2 py-1 rounded-md text-[11px] font-medium text-rose-500 hover:bg-rose-50 transition leading-none">删类别</button>
            </div>
          </div>
          <div class="space-y-1.5">
            ${itemsHtml || '<div class="text-center py-2 text-slate-300 text-xs">该类别暂无事项，点击上方加事项</div>'}
          </div>
        </div>`;
      })
      .join('');
  }

  container.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const { action, id, cat, dir } = button.dataset;
    const doc = ctx.getDocument();

    if (action === 'add-rule') {
      ctx.ui.openRuleModal({ categoryId: cat });
      return;
    }
    if (action === 'edit-rule') {
      const rule = doc.rules.find((r) => r.id === id);
      if (rule) ctx.ui.openRuleModal({ rule });
      return;
    }
    if (action === 'delete-rule') {
      if (!window.confirm('确定删除该事项吗？历史打分保持有效，不再显示在打分面板中。')) return;
      ctx.mutate((draft) => deleteRule(draft, id, { now: ctx.nowISO() }));
      ctx.refreshAll();
      return;
    }
    if (action === 'move-cat') {
      ctx.mutate((draft) => moveCategory(draft, id, Number(dir)));
      ctx.refreshAll();
      return;
    }
    if (action === 'move-rule') {
      ctx.mutate((draft) => moveRule(draft, id, Number(dir), { today: ctx.today() }));
      ctx.refreshAll();
      return;
    }
    if (action === 'edit-cat') {
      const category = doc.categories.find((c) => c.id === id);
      if (category) ctx.ui.openCategoryModal(category);
      return;
    }
    if (action === 'delete-cat') {
      const category = doc.categories.find((c) => c.id === id);
      if (!category) return;
      const count = activeRules(doc).filter((r) => currentCategoryId(r, ctx.today()) === id).length;
      const message =
        count > 0
          ? `确认删除类别「${category.name}」吗？\n该类别下的 ${count} 个事项将一并删除，历史打分保持有效。`
          : `确认删除类别「${category.name}」吗？`;
      if (!window.confirm(message)) return;
      ctx.mutate((draft) => deleteCategory(draft, id, { now: ctx.nowISO() }));
      ctx.refreshAll();
    }
  });

  $('addCategoryBtn').addEventListener('click', () => {
    ctx.ui.openCategoryModal(null);
  });
  $('addRuleTopBtn').addEventListener('click', () => {
    ctx.ui.openRuleModal({});
  });

  /* ---------- 备份导出 / 导入 ---------- */

  $('exportDataBtn').addEventListener('click', () => {
    const payload = buildBackupPayload(ctx.getDocument());
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = backupFileName();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast('备份已导出（不含云端密钥）', 'success');
  });

  $('importDataBtn').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        void handleImport(String(reader.result ?? ''));
      };
      reader.readAsText(file);
    });
    input.click();
  });

  async function handleImport(text) {
    let imported;
    try {
      imported = parseBackup(text);
    } catch (err) {
      window.alert(err instanceof BackupFormatError ? err.message : '读取备份失败，请检查文件');
      return;
    }

    const doc = ctx.getDocument();
    const base = ctx.store.getMeta().baselineDocument;
    const result = mergeDocuments({ base, local: doc, remote: imported });
    let merged = result.document;

    if (result.conflicts.length > 0) {
      const choices = await ctx.conflicts.show(result.conflicts, { title: '导入数据存在冲突，请选择保留哪一侧' });
      if (!choices) {
        toast('已取消导入', 'info');
        return;
      }
      merged = resolveConflicts(result, choices);
    }

    const beforeCount = { scores: doc.dailyScores.length, redemptions: doc.redemptions.length };
    ctx.replaceDocument(merged);
    const after = ctx.getDocument();
    ctx.refreshAll();
    const lines = [
      `导入完成：打分记录 ${beforeCount.scores} → ${after.dailyScores.length}，兑换记录 ${beforeCount.redemptions} → ${after.redemptions.length}`,
      '导入内容标记为待同步，可通过手动同步上传云端'
    ];
    window.alert(lines.join('\n'));
  }

  return { render };
}

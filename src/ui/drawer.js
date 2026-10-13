import { $, escapeHtml, overlayOpen, overlayClose } from '../lib/dom.js';
import { activeRules, orderedCategories, sortByOrder } from '../domain/model.js';
import { pointsAt, nameAt, scoresForDate, currentCategoryId } from '../domain/scoring.js';
import { applyScoreEdits } from '../domain/operations.js';

export function initDrawer(ctx) {
  const panel = $('scoreDrawer');
  const list = $('drawerItemList');
  const dateTitle = $('drawerDateTitle');
  const dailySum = $('drawerDailyTotal');
  let activeDate = null;
  let checked = new Set();
  let original = new Set();

  function renderList() {
    const doc = ctx.getDocument();
    const categories = orderedCategories(doc);
    const rules = activeRules(doc);
    const today = ctx.today();
    let html = '';

    for (const category of categories) {
      const items = sortByOrder(rules.filter((rule) => currentCategoryId(rule, today) === category.id));
      if (items.length === 0) continue;

      const itemsHtml = items
        .map((rule) => {
          const isChecked = checked.has(rule.id);
          const points = pointsAt(rule, activeDate);
          const isNegative = points < 0;
          const style = isChecked
            ? `border-color: ${category.color}; background-color: ${category.color}15;`
            : 'border-color: #f1f5f9; background-color: #f8fafc;';
          return `
            <label data-rule-row="${escapeHtml(rule.id)}" data-color="${escapeHtml(category.color)}"
                   class="flex items-center justify-between p-2.5 rounded-xl border transition cursor-pointer" style="${style}">
              <div class="flex items-center gap-2.5">
                <input type="checkbox" data-rule-id="${escapeHtml(rule.id)}" ${isChecked ? 'checked' : ''}
                       class="w-4 h-4 rounded" style="accent-color: ${escapeHtml(category.color)};">
                <span class="text-xs font-medium text-slate-800">${escapeHtml(nameAt(rule, activeDate))}</span>
              </div>
              <span class="text-xs font-black ${isNegative ? 'text-rose-500' : 'text-emerald-600'}">${points > 0 ? '+' + points : points}</span>
            </label>`;
        })
        .join('');

      html += `
        <div class="space-y-1.5">
          <div class="flex items-center gap-2 px-1">
            <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${escapeHtml(category.color)}"></span>
            <h4 class="text-xs font-bold text-slate-700 leading-none">${escapeHtml(category.name)}</h4>
          </div>
          <div class="space-y-1">${itemsHtml}</div>
        </div>`;
    }

    list.innerHTML = html || '<div class="text-center py-8 text-slate-400 text-xs">暂无可打分事项</div>';
  }

  function renderSum() {
    const doc = ctx.getDocument();
    let sum = 0;
    for (const ruleId of checked) {
      const rule = doc.rules.find((r) => r.id === ruleId);
      if (rule) sum += pointsAt(rule, activeDate);
    }
    dailySum.textContent = (sum >= 0 ? '+' : '') + sum;
  }

  function open(date) {
    activeDate = date;
    const doc = ctx.getDocument();
    const existing = scoresForDate(doc, date).filter((s) => s.checked).map((s) => s.ruleId);
    original = new Set(
      existing.filter((ruleId) => {
        const rule = doc.rules.find((r) => r.id === ruleId);
        return Boolean(rule) && !rule.deletedAt;
      })
    );
    checked = new Set(original);
    dateTitle.textContent = `${date} 奖惩打分`;
    renderList();
    renderSum();
    overlayOpen('scoreDrawer', () => hide());
  }

  function hide() {
    panel.classList.add('hidden');
  }

  list.addEventListener('change', (event) => {
    const input = event.target.closest('input[type=checkbox][data-rule-id]');
    if (!input) return;
    const ruleId = input.dataset.ruleId;
    if (input.checked) checked.add(ruleId);
    else checked.delete(ruleId);

    const row = list.querySelector(`[data-rule-row="${CSS.escape(ruleId)}"]`);
    if (row) {
      const color = row.dataset.color;
      row.style.borderColor = input.checked ? color : '#f1f5f9';
      row.style.backgroundColor = input.checked ? `${color}15` : '#f8fafc';
    }
    renderSum();
  });

  $('drawerSaveBtn').addEventListener('click', () => {
    const added = [...checked].filter((id) => !original.has(id));
    const removed = [...original].filter((id) => !checked.has(id));
    if (added.length > 0 || removed.length > 0) {
      ctx.mutate(
        (doc) =>
          applyScoreEdits(doc, activeDate, { added, removed }, { now: ctx.nowISO(), deviceId: ctx.deviceId }),
        { toast: false }
      );
      ctx.refreshAll();
    }
    overlayClose('scoreDrawer');
  });

  $('drawerCloseBtn').addEventListener('click', () => overlayClose('scoreDrawer'));

  return { open };
}

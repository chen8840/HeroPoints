import { $, escapeHtml } from '../lib/dom.js';
import { addMonths, addYears, monthLabel, yearLabel } from '../lib/date.js';
import { computePeriodStats } from '../domain/stats.js';

export function initStats(ctx) {
  let mode = 'month';
  let periodDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  function renderModeButtons() {
    const active = 'flex-1 py-1.5 rounded-lg text-xs font-bold bg-white text-orange-500 shadow-sm transition';
    const inactive = 'flex-1 py-1.5 rounded-lg text-xs font-bold text-slate-500 transition';
    $('statModeMonthBtn').className = mode === 'month' ? active : inactive;
    $('statModeYearBtn').className = mode === 'year' ? active : inactive;
  }

  function render() {
    renderModeButtons();
    $('statPeriodLabel').textContent = mode === 'month' ? monthLabel(periodDate) : yearLabel(periodDate);

    const stats = computePeriodStats(ctx.getDocument(), mode, periodDate);
    $('statEarned').textContent = `+${stats.earned}`;
    $('statDeducted').textContent = `-${stats.deducted}`;
    $('statSpent').textContent = `${stats.spent}`;
    $('statNet').textContent = `${stats.net}`;

    const barContainer = $('statCategoryBars');
    if (stats.topRules.length === 0) {
      barContainer.innerHTML = '<p class="text-slate-400 text-center py-4">该周期内暂无打卡数据</p>';
      return;
    }
    barContainer.innerHTML = stats.topRules
      .map(
        (item) => `
        <div>
          <div class="flex justify-between items-center mb-1 gap-2">
            <span class="font-medium text-slate-700">${escapeHtml(item.name)}</span>
            <span class="font-bold text-orange-500 whitespace-nowrap">${item.count} 次</span>
          </div>
          <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
            <div class="bg-orange-500 h-full rounded-full" style="width: ${Math.min(item.count * 10, 100)}%"></div>
          </div>
        </div>`
      )
      .join('');
  }

  $('statModeMonthBtn').addEventListener('click', () => {
    mode = 'month';
    render();
  });
  $('statModeYearBtn').addEventListener('click', () => {
    mode = 'year';
    render();
  });
  $('btnPrevPeriod').addEventListener('click', () => {
    periodDate = mode === 'month' ? addMonths(periodDate, -1) : addYears(periodDate, -1);
    render();
  });
  $('btnNextPeriod').addEventListener('click', () => {
    periodDate = mode === 'month' ? addMonths(periodDate, 1) : addYears(periodDate, 1);
    render();
  });

  return { render };
}

import { $ } from '../lib/dom.js';
import { addMonths, monthLabel, todayLocal } from '../lib/date.js';
import { dailyTotal, scoresForDate } from '../domain/scoring.js';

export function initCalendar(ctx, drawer) {
  let viewDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  function render() {
    const doc = ctx.getDocument();
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    $('currentMonthLabel').textContent = monthLabel(viewDate);

    const firstDay = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const today = todayLocal();
    const grid = $('calendarGrid');

    const cells = [];
    for (let i = 0; i < firstDay; i += 1) {
      cells.push('<div class="h-16 bg-slate-50/50 rounded-xl"></div>');
    }

    for (let day = 1; day <= totalDays; day += 1) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const checkedCount = scoresForDate(doc, dateStr).filter((s) => s.checked).length;
      const isToday = dateStr === today;

      let scoreBadge = '<span class="text-[10px] text-slate-300">•</span>';
      if (checkedCount > 0) {
        const total = dailyTotal(doc, dateStr);
        scoreBadge =
          total >= 0
            ? `<span class="text-[10px] bg-emerald-100 text-emerald-700 font-extrabold px-1 rounded mt-1">+${total}</span>`
            : `<span class="text-[10px] bg-rose-100 text-rose-700 font-extrabold px-1 rounded mt-1">${total}</span>`;
      }

      cells.push(`
        <button type="button" data-date="${dateStr}"
          class="h-16 bg-white border border-slate-100 shadow-sm rounded-xl p-1 flex flex-col items-center justify-between cursor-pointer active:scale-95 transition w-full ${isToday ? 'ring-2 ring-orange-500' : ''}">
          <span class="text-xs font-bold ${isToday ? 'text-orange-500' : 'text-slate-700'}">${day}</span>
          ${scoreBadge}
        </button>`);
    }

    grid.innerHTML = cells.join('');
  }

  $('calendarGrid').addEventListener('click', (event) => {
    const cell = event.target.closest('[data-date]');
    if (cell) drawer.open(cell.dataset.date);
  });

  $('btnPrevMonth').addEventListener('click', () => {
    viewDate = addMonths(viewDate, -1);
    render();
  });
  $('btnNextMonth').addEventListener('click', () => {
    viewDate = addMonths(viewDate, 1);
    render();
  });

  return { render };
}

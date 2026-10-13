// 所有业务日期一律使用设备本地日历的 YYYY-MM-DD，禁止用 toISOString 取日期。

export function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayLocal(now = new Date()) {
  return formatLocalDate(now);
}

export function addMonths(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

export function addYears(date, delta) {
  return new Date(date.getFullYear() + delta, date.getMonth(), 1);
}

export function monthLabel(date) {
  return `${date.getFullYear()}年 ${date.getMonth() + 1}月`;
}

export function yearLabel(date) {
  return `${date.getFullYear()}年 全年`;
}

export function periodPrefix(date, mode) {
  if (mode === 'year') return String(date.getFullYear());
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const datePart = sameYear
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return `${datePart} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

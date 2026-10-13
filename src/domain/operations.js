import { newId, compareRuleVersions, compareRewardVersions, requirePositiveCost, compareByOrder } from './model.js';
import { currentRewardVersion, categoryIdAt, currentCategoryId } from './scoring.js';
import { todayLocal } from '../lib/date.js';

/* 全部操作直接修改传入的草稿文档，由 store.mutate 负责持久化与修订号递增。 */

/* ---------------- 排序辅助 ---------------- */

function activeRulesInCategory(doc, categoryId, today) {
  return doc.rules.filter((rule) => !rule.deletedAt && currentCategoryId(rule, today) === categoryId);
}

function maxOrderInCategory(doc, categoryId, today, excludeId = null) {
  return doc.rules.reduce((max, rule) => {
    if (rule.deletedAt || rule.id === excludeId) return max;
    if (currentCategoryId(rule, today) !== categoryId) return max;
    return Math.max(max, typeof rule.order === 'number' ? rule.order : 0);
  }, -1);
}

const orderOf = (entry) => (typeof entry.order === 'number' ? entry.order : 0);

/**
 * 把 items（按显示顺序）中的一项上移/下移一位。
 * 只修改被移动项的序号（取相邻项中点/边界值），不重排其他项，
 * 这样两台的排序修改可以独立合并，互不干扰。
 */
function moveWithin(items, id, delta) {
  const index = items.findIndex((item) => item.id === id);
  const target = index + delta;
  if (index === -1 || target < 0 || target >= items.length) return false;

  const below = items[target];
  const above = delta > 0 ? items[target + 1] : items[target - 1];
  const newOrder = above ? (orderOf(below) + orderOf(above)) / 2 : orderOf(below) + delta;

  if (Math.abs(newOrder - orderOf(below)) < 1e-6) {
    // 相邻序号过于接近：整体重新编号后重试一次
    items.forEach((item, position) => {
      item.order = position;
    });
    return moveWithin(items, id, delta);
  }
  items[index].order = newOrder;
  return true;
}

export function moveCategory(doc, categoryId, delta) {
  const visible = doc.categories.filter((c) => !c.deletedAt).sort(compareByOrder);
  return moveWithin(visible, categoryId, delta);
}

export function moveRule(doc, ruleId, delta, { today }) {
  const rule = doc.rules.find((r) => r.id === ruleId);
  if (!rule || rule.deletedAt) return false;
  const visible = activeRulesInCategory(doc, currentCategoryId(rule, today), today).sort(compareByOrder);
  return moveWithin(visible, ruleId, delta);
}

export function setScore(doc, { date, ruleId, checked }, { now, deviceId }) {
  const existing = doc.dailyScores.find((s) => s.date === date && s.ruleId === ruleId);
  if (existing) {
    existing.checked = checked;
    existing.updatedAt = now;
    existing.deviceId = deviceId;
    return;
  }
  doc.dailyScores.push({ date, ruleId, checked, updatedAt: now, deviceId });
}

export function applyScoreEdits(doc, date, { added, removed }, options) {
  for (const ruleId of added) setScore(doc, { date, ruleId, checked: true }, options);
  for (const ruleId of removed) setScore(doc, { date, ruleId, checked: false }, options);
}

export function createCategory(doc, { name, color }) {
  const maxOrder = doc.categories.reduce((max, c) => Math.max(max, typeof c.order === 'number' ? c.order : 0), -1);
  doc.categories.push({ id: newId('cat'), name, color, deletedAt: null, order: maxOrder + 1 });
}

export function updateCategory(doc, categoryId, { name, color }) {
  const category = doc.categories.find((c) => c.id === categoryId);
  if (!category) return;
  category.name = name;
  category.color = color;
}

export function deleteCategory(doc, categoryId, { now }) {
  const category = doc.categories.find((c) => c.id === categoryId);
  if (!category) return;
  category.deletedAt = now;
  for (const rule of doc.rules) {
    if (categoryIdAt(rule, todayLocal(new Date(now))) === categoryId && !rule.deletedAt) rule.deletedAt = now;
  }
}

export function createRule(doc, { name, categoryId, points }, { today }) {
  const id = newId('rule');
  doc.rules.push({
    id,
    deletedAt: null,
    order: maxOrderInCategory(doc, categoryId, today) + 1,
    versions: [{ effectiveDate: null, name, categoryId, points }]
  });
  return id;
}

/**
 * 修改规则：分值变更按“更新时间”生效 —— 记分日期早于今天的使用旧分值；
 * 今天及之后使用新分值。同一天内多次修改合并为当天一个版本。
 */
export function updateRule(doc, ruleId, { name, categoryId, points }, { today }) {
  const rule = doc.rules.find((r) => r.id === ruleId);
  if (!rule) return { changed: false };

  const sorted = [...rule.versions].sort(compareRuleVersions);
  const latest = sorted[sorted.length - 1];
  const currentForToday =
    latest.effectiveDate !== null && latest.effectiveDate > today
      ? sorted.filter((v) => v.effectiveDate === null || v.effectiveDate <= today).pop()
      : latest;

  const unchanged =
    currentForToday &&
    currentForToday.name === name &&
    currentForToday.categoryId === categoryId &&
    currentForToday.points === points;
  if (unchanged) return { changed: false };

  const categoryChanged = currentForToday ? currentForToday.categoryId !== categoryId : false;

  const sameDay = rule.versions.find((v) => v.effectiveDate === today);
  if (sameDay) {
    sameDay.name = name;
    sameDay.categoryId = categoryId;
    sameDay.points = points;
  } else {
    rule.versions.push({ effectiveDate: today, name, categoryId, points });
  }
  rule.versions.sort(compareRuleVersions);

  // 换了类别：排到新类别末尾（不含自身），避免沿用旧类别的排序值造成乱序
  if (categoryChanged) rule.order = maxOrderInCategory(doc, categoryId, today, rule.id) + 1;
  return { changed: true };
}

export function deleteRule(doc, ruleId, { now }) {
  const rule = doc.rules.find((r) => r.id === ruleId);
  if (rule) rule.deletedAt = now;
}

export function createReward(doc, { cost, text, ruleNote }, { now }) {
  requirePositiveCost(cost);
  const id = newId('reward');
  doc.rewards.push({
    id,
    deletedAt: null,
    versions: [{ id: newId('rv'), effectiveDate: null, cost, text, ruleNote, createdAt: now }]
  });
  return id;
}

/** 修改兑换方案：生成新版本（旧兑换记录继续引用旧版本，历史消耗不变）。 */
export function updateReward(doc, rewardId, { cost, text, ruleNote }, { today, now }) {
  requirePositiveCost(cost);
  const reward = doc.rewards.find((r) => r.id === rewardId);
  if (!reward) return { changed: false };
  const current = currentRewardVersion(reward, today);
  if (current && current.cost === cost && current.text === text && current.ruleNote === ruleNote) {
    return { changed: false };
  }
  reward.versions.push({ id: newId('rv'), effectiveDate: today, cost, text, ruleNote, createdAt: now });
  reward.versions.sort(compareRewardVersions);
  return { changed: true };
}

export function deleteReward(doc, rewardId, { now }) {
  const reward = doc.rewards.find((r) => r.id === rewardId);
  if (reward) reward.deletedAt = now;
}

export function redeem(doc, rewardId, { now, deviceId }) {
  const reward = doc.rewards.find((r) => r.id === rewardId);
  if (!reward || reward.deletedAt) return null;
  const today = todayLocal(new Date(now));
  const version = currentRewardVersion(reward, today);
  if (!version) return null;
  requirePositiveCost(version.cost);
  const record = {
    id: newId('redemption'),
    rewardId,
    rewardVersionId: version.id,
    date: today,
    status: 'redeemed',
    updatedAt: now,
    deviceId
  };
  doc.redemptions.push(record);
  return record;
}

export function refundRedemption(doc, redemptionId, { now, deviceId }) {
  const record = doc.redemptions.find((r) => r.id === redemptionId);
  if (!record || record.status === 'refunded') return false;
  record.status = 'refunded';
  record.updatedAt = now;
  record.deviceId = deviceId;
  return true;
}

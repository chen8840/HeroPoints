import { compareRewardVersions } from './model.js';

/**
 * 取记分日期对应的规则版本：
 * - effectiveDate 为 null 的基准版本（Excel 初始值）适用于所有日期；
 * - 其余取“不晚于记分日期”的最新版本；
 * - 日期早于任何修改版本时回落到基准版本。
 */
export function ruleVersionForDate(rule, date) {
  let chosen = null;
  for (const version of rule.versions) {
    if (version.effectiveDate === null) {
      if (chosen === null || chosen.effectiveDate === null) chosen = version;
      continue;
    }
    if (version.effectiveDate <= date) {
      if (chosen === null || chosen.effectiveDate === null || version.effectiveDate >= chosen.effectiveDate) chosen = version;
    }
  }
  return chosen;
}

export function pointsAt(rule, date) {
  return ruleVersionForDate(rule, date)?.points ?? 0;
}

export function nameAt(rule, date) {
  return ruleVersionForDate(rule, date)?.name ?? '';
}

export function categoryIdAt(rule, date) {
  return ruleVersionForDate(rule, date)?.categoryId ?? null;
}

/** 事项当前所属类别（生效版本没有类别时回落到首个版本）。 */
export function currentCategoryId(rule, date) {
  return categoryIdAt(rule, date) ?? rule.versions[0]?.categoryId ?? null;
}

/** 当前生效版本（按今天取值）。 */
export function currentRuleVersion(rule, today) {
  return ruleVersionForDate(rule, today);
}

export function currentRewardVersion(reward, today) {
  let chosen = null;
  for (const version of reward.versions) {
    if (version.effectiveDate === null || version.effectiveDate <= today) {
      if (chosen === null || compareRewardVersions(chosen, version) <= 0) chosen = version;
    }
  }
  return chosen ?? reward.versions[0] ?? null;
}

export function rewardVersionById(reward, versionId) {
  return reward.versions.find((v) => v.id === versionId) ?? null;
}

/** 某天所有已勾选事项的合计分（含历史版本分值）。 */
export function dailyTotal(doc, date) {
  let sum = 0;
  for (const score of doc.dailyScores) {
    if (score.date !== date || !score.checked) continue;
    const rule = doc.rules.find((r) => r.id === score.ruleId);
    if (rule) sum += pointsAt(rule, date);
  }
  return sum;
}

export function scoresForDate(doc, date) {
  return doc.dailyScores.filter((s) => s.date === date);
}

export function redemptionCost(doc, redemption) {
  const reward = doc.rewards.find((r) => r.id === redemption.rewardId);
  if (!reward) return 0;
  const version = rewardVersionById(reward, redemption.rewardVersionId) ?? currentRewardVersion(reward, redemption.date || '9999-12-31');
  return version?.cost ?? 0;
}

/** 当前可用积分 = 已勾选得分合计 - 未撤销的兑换消耗。 */
export function balance(doc) {
  let earned = 0;
  for (const score of doc.dailyScores) {
    if (!score.checked) continue;
    const rule = doc.rules.find((r) => r.id === score.ruleId);
    if (rule) earned += pointsAt(rule, score.date);
  }
  let spent = 0;
  for (const redemption of doc.redemptions) {
    if (redemption.status === 'redeemed') spent += redemptionCost(doc, redemption);
  }
  return earned - spent;
}

import { periodPrefix } from '../lib/date.js';
import { pointsAt, nameAt, redemptionCost } from './scoring.js';

/**
 * 指定月/年周期的统计。
 * net 与原型一致：仅表示期间打分净增（不含兑换消耗）。
 */
export function computePeriodStats(doc, mode, periodDate) {
  const prefix = periodPrefix(periodDate, mode);
  let earned = 0;
  let deducted = 0;
  let spent = 0;
  const countsByRule = new Map();

  for (const score of doc.dailyScores) {
    if (!score.checked || !score.date.startsWith(prefix)) continue;
    const rule = doc.rules.find((r) => r.id === score.ruleId);
    if (!rule) continue;
    const points = pointsAt(rule, score.date);
    if (points > 0) earned += points;
    else deducted += Math.abs(points);
    const name = nameAt(rule, score.date);
    if (name) countsByRule.set(name, (countsByRule.get(name) ?? 0) + 1);
  }

  for (const redemption of doc.redemptions) {
    if (redemption.status !== 'redeemed') continue;
    if (!redemption.date.startsWith(prefix)) continue;
    spent += redemptionCost(doc, redemption);
  }

  const topRules = [...countsByRule.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  return { earned, deducted, spent, net: earned - deducted, topRules };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleVersionForDate, pointsAt, dailyTotal, balance, redemptionCost, currentRewardVersion } from '../src/domain/scoring.js';
import { computePeriodStats } from '../src/domain/stats.js';
import { makeDoc, cat, rule, score, reward, redemption } from './helpers.mjs';

test('规则分值按记分日期选择生效版本', () => {
  const r = {
    id: 'rule-x',
    deletedAt: null,
    versions: [
      { effectiveDate: null, name: '跳绳', categoryId: 'cat-1', points: 3 },
      { effectiveDate: '2026-10-15', name: '跳绳', categoryId: 'cat-1', points: 4 }
    ]
  };
  assert.equal(pointsAt(r, '2026-10-14'), 3, '更新前一天用旧分值');
  assert.equal(pointsAt(r, '2026-10-15'), 4, '更新当天用新分值');
  assert.equal(pointsAt(r, '2026-11-01'), 4, '更新之后用新分值');
  assert.equal(ruleVersionForDate(r, '2026-10-15').points, 4);
});

test('多个修改版本按时序取最近生效值', () => {
  const r = {
    id: 'rule-x',
    deletedAt: null,
    versions: [
      { effectiveDate: null, name: 'a', categoryId: null, points: 1 },
      { effectiveDate: '2026-10-10', name: 'a', categoryId: null, points: 2 },
      { effectiveDate: '2026-10-20', name: 'a', categoryId: null, points: 5 }
    ]
  };
  assert.equal(pointsAt(r, '2026-10-09'), 1);
  assert.equal(pointsAt(r, '2026-10-10'), 2);
  assert.equal(pointsAt(r, '2026-10-19'), 2);
  assert.equal(pointsAt(r, '2026-10-20'), 5);
});

test('跳绳两条规则同日累计 8 分', () => {
  const doc = makeDoc({
    categories: [cat('cat-1', '生活习惯')],
    rules: [rule('rule-jump-200', '每天跳绳200个', 3), rule('rule-jump-300', '每天跳绳300个', 5)],
    dailyScores: [
      score('2026-10-13', 'rule-jump-200', true, '2026-10-13T08:00:00.000Z'),
      score('2026-10-13', 'rule-jump-300', true, '2026-10-13T08:00:00.000Z')
    ]
  });
  assert.equal(dailyTotal(doc, '2026-10-13'), 8);
  assert.equal(balance(doc), 8);
});

test('余额 = 已勾选得分 - 未撤销兑换消耗，撤销后恢复', () => {
  const doc = makeDoc({
    rules: [rule('r1', '加分', 10), rule('r2', '扣分', -4)],
    dailyScores: [
      score('2026-10-12', 'r1', true, 't1'),
      score('2026-10-13', 'r1', true, 't2'),
      score('2026-10-13', 'r2', true, 't3')
    ],
    rewards: [reward('reward-80', 'reward-80-v1', 8, '零食')],
    redemptions: [
      redemption('red-1', 'reward-80', 'reward-80-v1', '2026-10-13', 'redeemed'),
      redemption('red-2', 'reward-80', 'reward-80-v1', '2026-10-13', 'refunded')
    ]
  });
  assert.equal(balance(doc), 10 + 10 - 4 - 8);
});

test('未勾选与不存在的规则不产生分数', () => {
  const doc = makeDoc({
    rules: [rule('r1', 'a', 10)],
    dailyScores: [score('2026-10-13', 'r1', false, 't1'), score('2026-10-13', 'ghost', true, 't2')]
  });
  assert.equal(balance(doc), 0);
});

test('兑换消耗按当时引用的方案版本计算，方案涨价不影响历史记录', () => {
  const rw = {
    id: 'reward-80',
    deletedAt: null,
    versions: [
      { id: 'v1', effectiveDate: null, cost: 80, text: '零食', ruleNote: '', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'v2', effectiveDate: '2026-10-20', cost: 100, text: '零食', ruleNote: '', createdAt: '2026-10-20T00:00:00.000Z' }
    ]
  };
  const doc = makeDoc({
    rewards: [rw],
    redemptions: [redemption('red-1', 'reward-80', 'v1', '2026-10-13')]
  });
  assert.equal(redemptionCost(doc, doc.redemptions[0]), 80);
  assert.equal(currentRewardVersion(rw, '2026-10-19').id, 'v1');
  assert.equal(currentRewardVersion(rw, '2026-10-20').id, 'v2');
});

test('月/年统计：earned/deducted/spent/net 与频次排行', () => {
  const doc = makeDoc({
    rules: [rule('r1', '口算', 5), rule('r2', '迟到', -10), rule('r3', '阅读', 2)],
    dailyScores: [
      score('2026-10-01', 'r1', true, 't1'),
      score('2026-10-02', 'r1', true, 't2'),
      score('2026-10-02', 'r2', true, 't3'),
      score('2026-10-02', 'r3', true, 't4'),
      score('2026-09-30', 'r1', true, 't5'),
      score('2025-10-01', 'r1', true, 't6')
    ],
    rewards: [reward('reward-80', 'v1', 80, 'x')],
    redemptions: [redemption('red-1', 'reward-80', 'v1', '2026-10-03', 'redeemed')]
  });

  const month = computePeriodStats(doc, 'month', new Date(2026, 9, 15));
  assert.equal(month.earned, 12);
  assert.equal(month.deducted, 10);
  assert.equal(month.spent, 80);
  assert.equal(month.net, 2);
  assert.deepEqual(month.topRules[0], { name: '口算', count: 2 });

  const year = computePeriodStats(doc, 'year', new Date(2026, 9, 15));
  assert.equal(year.earned, 17);
  assert.equal(year.deducted, 10);
});

test('历史打分的分值按记分日期版本统计', () => {
  const r = {
    id: 'r1',
    deletedAt: null,
    versions: [
      { effectiveDate: null, name: '跳绳', categoryId: null, points: 3 },
      { effectiveDate: '2026-10-15', name: '跳绳', categoryId: null, points: 4 }
    ]
  };
  const doc = makeDoc({
    rules: [r],
    dailyScores: [score('2026-10-14', 'r1', true, 't1'), score('2026-10-15', 'r1', true, 't2')]
  });
  const stats = computePeriodStats(doc, 'month', new Date(2026, 9, 1));
  assert.equal(stats.earned, 7);
});

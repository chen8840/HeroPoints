import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDoc, cat, rule, score, reward, redemption } from './helpers.mjs';
import { mergeDocuments, resolveConflicts } from '../src/domain/merge.js';
import { deleteCategory, updateRule, createReward, updateReward, redeem } from '../src/domain/operations.js';
import { normalizeDocument } from '../src/domain/model.js';
import { parseBackup } from '../src/sync/backup.js';

const base = () => makeDoc({ categories: [cat('cat-1', 'A'), cat('cat-2', 'B')], rules: [rule('r', 'Rule', 3)], rewards: [reward('rw', 'v', 80, 'Reward')] });

test('clock skew cannot discard a one-sided cancellation or refund', () => {
  const b = base();
  b.dailyScores = [score('2026-10-15', 'r', true, '2026-10-15T10:00:00Z')];
  b.redemptions = [redemption('red', 'rw', 'v', '2026-10-15')];
  const l = structuredClone(b);
  l.dailyScores[0].checked = false;
  l.dailyScores[0].updatedAt = '2026-10-15T09:00:00Z';
  l.redemptions[0].status = 'refunded';
  l.redemptions[0].updatedAt = '2020-01-01T00:00:00Z';
  for (const [local, remote] of [[l, b], [b, l]]) {
    const result = mergeDocuments({ base: b, local, remote });
    assert.equal(result.conflicts.length, 0);
    assert.equal(result.document.dailyScores[0].checked, false);
    assert.equal(result.document.redemptions[0].status, 'refunded');
  }
});

test('different score state with no baseline prompts and both choices resolve', () => {
  const l = base(), r = base();
  l.dailyScores = [score('2026-10-15', 'r', false, '2026-10-15T10:00:00Z')];
  r.dailyScores = [score('2026-10-15', 'r', true, '2026-10-15T11:00:00Z')];
  const result = mergeDocuments({ base: null, local: l, remote: r });
  assert.equal(result.conflicts[0].entity, 'score');
  assert.equal(resolveConflicts(result, ['local']).dailyScores[0].checked, false);
  assert.equal(resolveConflicts(result, ['remote']).dailyScores[0].checked, true);
});

test('two conflicting redemption changes prompt instead of taking newest clock', () => {
  const b = base(); b.redemptions = [redemption('red', 'rw', 'v', '2026-10-15')];
  const l = structuredClone(b), r = structuredClone(b);
  l.redemptions[0].status = 'refunded'; r.redemptions[0].date = '2026-10-16';
  const result = mergeDocuments({ base: b, local: l, remote: r });
  assert.equal(result.conflicts[0].entity, 'redemption');
  assert.equal(resolveConflicts(result, ['local']).redemptions[0].status, 'refunded');
  assert.equal(resolveConflicts(result, ['remote']).redemptions[0].date, '2026-10-16');
});

test('same business change with different clocks merges once without conflict', () => {
  const b = base(), l = base(), r = base();
  l.dailyScores = [score('2026-10-15', 'r', true, '2020-01-01T00:00:00Z', 'a')];
  r.dailyScores = [score('2026-10-15', 'r', true, '2030-01-01T00:00:00Z', 'b')];
  const result = mergeDocuments({ base: b, local: l, remote: r });
  assert.equal(result.conflicts.length, 0); assert.equal(result.document.dailyScores.length, 1);
});

test('deleting an old category preserves moved rules and deletes current members only', () => {
  const d = base(); d.rules.push(rule('stays', 'Stay', 2));
  updateRule(d, 'r', { name: 'Rule', categoryId: 'cat-2', points: 3 }, { today: '2026-10-15' });
  deleteCategory(d, 'cat-1', { now: '2026-10-16T12:00:00Z' });
  assert.equal(d.rules[0].deletedAt, null); assert.ok(d.rules[1].deletedAt);
  assert.equal(d.rules[0].versions[0].categoryId, 'cat-1');
});

for (const cost of [-80, 0, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid reward cost ${cost} rejected at domain boundary`, () => {
    const d = base();
    assert.throws(() => createReward(d, { cost, text: 'Invalid', ruleNote: '' }, { now: '2026-10-15T00:00:00Z' }));
    assert.throws(() => updateReward(d, 'rw', { cost, text: 'Invalid', ruleNote: '' }, { today: '2026-10-15', now: '2026-10-15T00:00:00Z' }));
    d.rewards[0].versions[0].cost = cost;
    assert.throws(() => normalizeDocument(d));
    assert.throws(() => redeem(d, 'rw', { now: '2026-10-15T00:00:00Z', deviceId: 'a' }));
    assert.equal(d.redemptions.length, 0);
  });
}

test('negative cost JSON backup is rejected, positive integer accepted', () => {
  const d = base(); d.rewards[0].versions[0].cost = -80;
  assert.throws(() => parseBackup(JSON.stringify(d)), /正整数/);
  d.rewards[0].versions[0].cost = 1;
  assert.equal(parseBackup(JSON.stringify(d)).rewards[0].versions[0].cost, 1);
});

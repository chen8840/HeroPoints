import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDocuments, resolveConflicts } from '../src/domain/merge.js';
import { documentsEqual, businessFingerprint } from '../src/domain/model.js';
import { makeDoc, cat, rule, score, reward, redemption } from './helpers.mjs';

const base = makeDoc({
  categories: [cat('cat-1', '生活习惯')],
  rules: [rule('r1', '跳绳', 3)],
  dailyScores: [score('2026-10-12', 'r1', true, '2026-10-12T08:00:00.000Z')],
  rewards: [reward('reward-80', 'v1', 80, '零食')],
  redemptions: []
});

test('两侧独立修改自动合并', () => {
  const local = { ...base, dailyScores: [...base.dailyScores, score('2026-10-13', 'r1', true, '2026-10-13T08:00:00.000Z')] };
  const remote = { ...base, categories: [cat('cat-1', '生活习惯'), cat('cat-2', '运动')] };
  const { document, conflicts } = mergeDocuments({ base, local, remote });
  assert.equal(conflicts.length, 0);
  assert.equal(document.dailyScores.length, 2);
  assert.equal(document.categories.length, 2);
});

test('取消勾选相对基线变更不会被未修改状态覆盖', () => {
  const local = { ...base, dailyScores: [score('2026-10-12', 'r1', false, '2026-10-12T20:00:00.000Z')] };
  const remoteUnchanged = { ...base };
  const first = mergeDocuments({ base, local, remote: remoteUnchanged });
  assert.equal(first.document.dailyScores[0].checked, false);

  // 旧设备仍持有勾选状态（时间戳更早）
  const remoteOldCheck = { ...base, dailyScores: [score('2026-10-12', 'r1', true, '2026-10-12T08:00:00.000Z', 'device-b')] };
  const second = mergeDocuments({
    base,
    local: { ...base, dailyScores: [score('2026-10-12', 'r1', false, '2026-10-12T20:00:00.000Z')] },
    remote: remoteOldCheck
  });
  assert.equal(second.document.dailyScores[0].checked, false);
  assert.equal(second.conflicts.length, 0);
});

test('同日同规则只保留一条记录', () => {
  const local = { ...base };
  const remote = { ...base, dailyScores: [score('2026-10-12', 'r1', true, '2026-10-12T08:00:00.000Z')] };
  const { document } = mergeDocuments({ base, local, remote });
  assert.equal(document.dailyScores.length, 1);
});

test('规则版本按生效日期合并，两侧不同日期修改都保留', () => {
  const localRule = rule('r1', '跳绳', 4, '2026-10-10');
  const remoteRule = rule('r1', '跳绳', 5, '2026-10-12');
  const local = { ...base, rules: [{ id: 'r1', deletedAt: null, versions: [...base.rules[0].versions, ...localRule.versions] }] };
  const remote = { ...base, rules: [{ id: 'r1', deletedAt: null, versions: [...base.rules[0].versions, ...remoteRule.versions] }] };
  const { document, conflicts } = mergeDocuments({ base, local, remote });
  assert.equal(conflicts.length, 0);
  assert.deepEqual(
    document.rules[0].versions.map((v) => [v.effectiveDate, v.points]),
    [
      [null, 3],
      ['2026-10-10', 4],
      ['2026-10-12', 5]
    ]
  );
});

test('同一天两侧改成不同分值 → 冲突，由用户选择', () => {
  const local = { ...base, rules: [{ id: 'r1', deletedAt: null, versions: [...base.rules[0].versions, ...rule('r1', '跳绳', 4, '2026-10-15').versions] }] };
  const remote = { ...base, rules: [{ id: 'r1', deletedAt: null, versions: [...base.rules[0].versions, ...rule('r1', '跳绳', 6, '2026-10-15').versions] }] };
  const result = mergeDocuments({ base, local, remote });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].entity, 'ruleVersion');

  const resolvedLocal = resolveConflicts(result, ['local']);
  const localVersion = resolvedLocal.rules[0].versions.find((v) => v.effectiveDate === '2026-10-15');
  assert.equal(localVersion.points, 4);

  const resolvedRemote = resolveConflicts(result, ['remote']);
  const remoteVersion = resolvedRemote.rules[0].versions.find((v) => v.effectiveDate === '2026-10-15');
  assert.equal(remoteVersion.points, 6);
});

test('无基线首次连接：另一侧新增版本自动并入，同键内容不同则提示', () => {
  const local = base;
  const remote = { ...base, rules: [{ id: 'r1', deletedAt: null, versions: [...base.rules[0].versions, ...rule('r1', '跳绳', 4, '2026-10-15').versions] }] };
  const first = mergeDocuments({ base: null, local, remote });
  assert.equal(first.conflicts.length, 0);
  assert.equal(first.document.rules[0].versions.length, 2);

  const localChanged = { ...base, rules: [{ id: 'r1', deletedAt: null, versions: [...base.rules[0].versions, ...rule('r1', '跳绳', 9, '2026-10-15').versions] }] };
  const second = mergeDocuments({ base: null, local: localChanged, remote });
  assert.equal(second.conflicts.length, 1);
});

test('一侧删除、另一侧修改 → 冲突；另一侧未改则删除生效', () => {
  const deleted = { ...base, rules: [{ id: 'r1', deletedAt: '2026-10-13T10:00:00.000Z', versions: base.rules[0].versions }] };
  const modified = { ...base, rules: [{ id: 'r1', deletedAt: null, versions: [...base.rules[0].versions, ...rule('r1', '跳绳', 4, '2026-10-15').versions] }] };

  const conflictResult = mergeDocuments({ base, local: deleted, remote: modified });
  assert.equal(conflictResult.conflicts.length, 1);
  assert.equal(conflictResult.conflicts[0].entity, 'rule');
  const keepRemote = resolveConflicts(conflictResult, ['remote']);
  assert.equal(keepRemote.rules[0].deletedAt, null);
  assert.equal(keepRemote.rules[0].versions.length, 2);
  const keepLocal = resolveConflicts(conflictResult, ['local']);
  assert.equal(keepLocal.rules.length, 1);
  assert.ok(keepLocal.rules[0].deletedAt);

  const plain = mergeDocuments({ base, local: deleted, remote: { ...base } });
  assert.equal(plain.conflicts.length, 0);
  assert.ok(plain.document.rules[0].deletedAt, '另一侧未修改时删除自动生效');
});

test('兑换记录按 id 幂等去重，单侧撤销按基线合并', () => {
  const withRedeem = {
    ...base,
    redemptions: [redemption('red-1', 'reward-80', 'v1', '2026-10-13', 'redeemed', '2026-10-13T09:00:00.000Z')]
  };
  const dup = mergeDocuments({ base, local: withRedeem, remote: withRedeem });
  assert.equal(dup.document.redemptions.length, 1);

  const refunded = {
    ...base,
    redemptions: [redemption('red-1', 'reward-80', 'v1', '2026-10-13', 'refunded', '2026-10-13T10:00:00.000Z')]
  };
  const merge = mergeDocuments({ base: withRedeem, local: refunded, remote: withRedeem });
  assert.equal(merge.document.redemptions.length, 1);
  assert.equal(merge.document.redemptions[0].status, 'refunded');

  const reversed = mergeDocuments({ base: withRedeem, local: withRedeem, remote: refunded });
  assert.equal(reversed.document.redemptions[0].status, 'refunded', '无论从哪侧同步都收敛到撤销状态');
});

test('重复同步/导入不产生重复记录', () => {
  const local = { ...base, dailyScores: [...base.dailyScores, score('2026-10-13', 'r1', true, '2026-10-13T08:00:00.000Z')] };
  const first = mergeDocuments({ base: null, local, remote: base });
  const second = mergeDocuments({ base: first.document, local: first.document, remote: first.document });
  assert.equal(second.document.dailyScores.length, 2);
  assert.equal(second.conflicts.length, 0);
});

test('businessFingerprint 忽略 documentRevision；顺序不同视为不同文档', () => {
  const a = makeDoc({ categories: [cat('c1', 'a', null, 0), cat('c2', 'b', null, 1)], documentRevision: 3 });
  const b = makeDoc({ categories: [cat('c1', 'a', null, 0), cat('c2', 'b', null, 1)], documentRevision: 99 });
  assert.ok(documentsEqual(a, b));
  assert.equal(businessFingerprint(a), businessFingerprint(b));

  const reordered = makeDoc({ categories: [cat('c2', 'b', null, 0), cat('c1', 'a', null, 1)], documentRevision: 3 });
  assert.ok(!documentsEqual(a, reordered), '类别排序不同属于不同文档');

  const changed = makeDoc({ categories: [cat('c1', 'a改名', null, 0), cat('c2', 'b', null, 1)], documentRevision: 3 });
  assert.ok(!documentsEqual(a, changed));
});

test('familyId 首次连接采用远端，保持一致', () => {
  const local = makeDoc({ familyId: 'family-local' });
  const remote = makeDoc({ familyId: 'family-remote' });
  const first = mergeDocuments({ base: null, local, remote });
  assert.equal(first.document.familyId, 'family-remote');
});

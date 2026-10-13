import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, STORAGE_KEYS, StorageFullError } from '../src/storage/store.js';
import { balance, currentRewardVersion, redemptionCost } from '../src/domain/scoring.js';
import { createMemoryStorage } from './helpers.mjs';

const FIXED_NOW = () => new Date('2026-10-13T09:00:00.000Z');

test('首次载入生成默认数据并确立基线，无待同步标记', () => {
  const storage = createMemoryStorage();
  const store = createStore({ storage, now: FIXED_NOW });
  const result = store.load();
  assert.equal(result.status, 'ok');
  assert.equal(store.getDocument().rules.length, 28);
  assert.equal(store.getDocument().categories.length, 4);
  assert.equal(store.hasPendingChanges(), false);
  assert.ok(store.getMeta().baselineDocument, '基线已建立');
});

test('修改后标记待同步，重启后恢复', () => {
  const storage = createMemoryStorage();
  const store = createStore({ storage, now: FIXED_NOW });
  store.load();
  store.mutate((doc) => {
    doc.dailyScores.push({ date: '2026-10-13', ruleId: 'rule-life-01', checked: true, updatedAt: 'x', deviceId: 'd' });
  });
  assert.equal(store.hasPendingChanges(), true);

  const store2 = createStore({ storage, now: FIXED_NOW });
  store2.load();
  assert.equal(store2.getDocument().dailyScores.length, 1);
  assert.equal(store2.hasPendingChanges(), true, '待同步状态不因重启丢失');
});

test('损坏数据不静默重置：返回 corrupted 且保留原始数据', () => {
  const storage = createMemoryStorage({ [STORAGE_KEYS.document]: '{broken json' });
  const store = createStore({ storage, now: FIXED_NOW });
  const result = store.load();
  assert.equal(result.status, 'corrupted');
  assert.equal(result.raw, '{broken json');
  assert.equal(storage.getItem(STORAGE_KEYS.document), '{broken json', '未覆盖损坏数据');
});

test('高于支持版本的数据视为不可读，不覆盖', () => {
  const doc = { schemaVersion: 99, familyId: 'x', categories: [], rules: [], dailyScores: [], rewards: [], redemptions: [] };
  const storage = createMemoryStorage({ [STORAGE_KEYS.document]: doc });
  const store = createStore({ storage, now: FIXED_NOW });
  assert.equal(store.load().status, 'corrupted');
});

test('原型 HERO_XP_DATA 迁移：规则/打分/兑换映射，凭据单独保存', () => {
  const legacy = {
    totalPoints: 999,
    categories: [
      { name: '生活习惯', color: '#10b981' },
      { name: '学习习惯', color: '#3b82f6' }
    ],
    rules: [
      { id: 101, category: '生活习惯', name: '7:20按时起床', points: 2 },
      { id: 999, category: '学习习惯', name: '家长自建事项', points: 7 }
    ],
    rewards: [{ id: 1, cost: 80, text: '1. 自选小零食1份\n2. 自选小文具1份\n3. 看10分钟英语动画片', rule: '每周限换1次' }],
    dailyLogs: { '2026-10-01': [101], '2026-10-02': [999] },
    redeemLogs: [{ id: 5, date: '2026-10-03', cost: 80, name: '1. 自选小零食1份 / 2. 自选小文具1份 / 3. 看10分钟英语动画片' }],
    syncConfig: { binId: 'bin-abc', apiKey: '$2b$10$secret' },
    lastSyncTime: '12:00'
  };
  const storage = createMemoryStorage({ [STORAGE_KEYS.legacy]: legacy });
  const store = createStore({ storage, now: FIXED_NOW });
  const result = store.load();
  assert.equal(result.status, 'ok');
  assert.equal(result.migratedFromLegacy, true);

  const doc = store.getDocument();
  const startup = doc.rules.find((r) => r.versions[0].name === '7:20按时起床');
  assert.equal(startup.id, 'rule-life-01', '同名规则复用默认 ID');
  const custom = doc.rules.find((r) => r.versions[0].name === '家长自建事项');
  assert.ok(custom && custom.versions[0].points === 7);
  assert.equal(doc.dailyScores.length, 2);
  assert.ok(doc.dailyScores.some((s) => s.ruleId === startup.id && s.date === '2026-10-01'));
  assert.equal(doc.redemptions.length, 1);
  assert.equal(doc.redemptions[0].rewardId, 'reward-80', '兑换记录匹配到默认方案');

  assert.deepEqual(store.getCredentials(), { binId: 'bin-abc', apiKey: '$2b$10$secret', keyHeader: null });
  assert.ok(storage.getItem(STORAGE_KEYS.legacy), '不销毁原型原始数据');

  const again = createStore({ storage, now: FIXED_NOW });
  again.load();
  assert.equal(again.getDocument().dailyScores.length, 2, '只迁移一次，不重复计数');
});

test('旧版同名规则复用 ID 时保留自定义名称、类别和20分基准，重启不重复迁移', () => {
  const legacy = {
    categories: ['生活习惯', '自定义类别'],
    rules: [{ id: 101, category: '自定义类别', name: '7：20按时起床', points: 20 }],
    dailyLogs: { '2026-10-01': [101] },
    redeemLogs: []
  };
  const storage = createMemoryStorage({ [STORAGE_KEYS.legacy]: legacy });
  const store = createStore({ storage, now: FIXED_NOW });
  assert.equal(store.load().migratedFromLegacy, true);
  const doc = store.getDocument();
  const rule = doc.rules.find((r) => r.id === 'rule-life-01');
  const category = doc.categories.find((c) => c.name === '自定义类别');
  assert.deepEqual(rule.versions, [{
    effectiveDate: null, name: '7：20按时起床', categoryId: category.id, points: 20
  }]);
  assert.equal(doc.dailyScores[0].ruleId, rule.id);
  assert.equal(balance(doc), 20, '使用旧版20分而不是默认2分');

  const rebooted = createStore({ storage, now: FIXED_NOW });
  assert.equal(rebooted.load().migratedFromLegacy, undefined);
  assert.deepEqual(rebooted.getDocument(), doc);
  assert.equal(rebooted.getDocument().rules.length, 28);
  assert.equal(rebooted.getDocument().dailyScores.length, 1);
  assert.equal(balance(rebooted.getDocument()), 20);
});

test('旧版匹配兑换保留每笔实际成本和文本，共用历史版本且不改变当前方案', () => {
  const text = '1. 自选小零食1份 / 2. 自选小文具1份 / 3. 看10分钟英语动画片';
  const legacy = {
    categories: ['生活习惯'],
    rules: [{ id: 101, category: '生活习惯', name: '7:20按时起床', points: 20 }],
    dailyLogs: { '2026-10-01': [101] },
    redeemLogs: [
      { id: 5, date: '2026-10-02', cost: 50, name: text },
      { id: 6, date: '2026-10-03', cost: 50, name: text },
      { id: 7, date: '2026-10-04', cost: 60, name: text }
    ]
  };
  const storage = createMemoryStorage({ [STORAGE_KEYS.legacy]: legacy });
  const store = createStore({ storage, now: FIXED_NOW });
  store.load();
  const doc = store.getDocument();
  const reward = doc.rewards.find((r) => r.id === 'reward-80');
  assert.equal(doc.rewards.length, 6, '匹配历史兑换仍复用方案 ID');
  assert.equal(reward.versions.length, 3, '相同历史成本和文本复用同一版本');
  assert.ok(doc.redemptions.every((r) => r.rewardId === reward.id));
  assert.equal(doc.redemptions[0].rewardVersionId, doc.redemptions[1].rewardVersionId);
  assert.deepEqual(doc.redemptions.map((r) => redemptionCost(doc, r)), [50, 50, 60]);
  for (const redemption of doc.redemptions) {
    assert.equal(reward.versions.find((v) => v.id === redemption.rewardVersionId).text, text);
  }
  const current = currentRewardVersion(reward, '2026-10-13');
  assert.equal(current.id, 'reward-80-v1');
  assert.equal(current.cost, 80, '历史成本不覆盖当前80分方案');
  assert.equal(balance(doc), -140);

  const rebooted = createStore({ storage, now: FIXED_NOW });
  rebooted.load();
  assert.deepEqual(rebooted.getDocument(), doc, '重启后版本、记录、金额保持不变且不重复');
  assert.equal(balance(rebooted.getDocument()), -140);
  assert.equal(currentRewardVersion(rebooted.getDocument().rewards.find((r) => r.id === reward.id), '2026-10-13').cost, 80);
});

test('凭据独立存储，不进入业务文档', () => {
  const storage = createMemoryStorage();
  const store = createStore({ storage, now: FIXED_NOW });
  store.load();
  store.setCredentials({ binId: 'bin-1', apiKey: 'key-1' });
  const raw = storage.getItem(STORAGE_KEYS.document);
  assert.ok(!raw.includes('bin-1') && !raw.includes('key-1'));
  assert.deepEqual(store.getCredentials(), { binId: 'bin-1', apiKey: 'key-1', keyHeader: null });
  store.clearCredentials();
  assert.deepEqual(store.getCredentials(), { binId: '', apiKey: '', keyHeader: null });
});

test('存储空间不足时抛错并保持内存与磁盘一致', () => {
  const storage = createMemoryStorage();
  const store = createStore({ storage, now: FIXED_NOW });
  store.load();
  const before = store.getDocument().dailyScores.length;
  const originalSetItem = storage.setItem;
  storage.setItem = () => {
    const err = new Error('quota');
    err.name = 'QuotaExceededError';
    throw err;
  };
  assert.throws(() => {
    store.mutate((doc) => {
      doc.dailyScores.push({ date: '2026-10-13', ruleId: 'rule-life-01', checked: true, updatedAt: 'x', deviceId: 'd' });
    });
  }, StorageFullError);
  assert.equal(store.getDocument().dailyScores.length, before, '失败后内存未被污染');
  storage.setItem = originalSetItem;
});

test('markChecked 记录当天成功检查，resetToDefaults 显式重置', () => {
  const storage = createMemoryStorage();
  const store = createStore({ storage, now: FIXED_NOW });
  store.load();
  const baseline = store.getDocument();
  store.markChecked({ baselineDocument: baseline });
  const meta = store.getMeta();
  assert.ok(meta.lastSuccessfulCheckDate, '记录了成功检查日期');
  assert.ok(meta.lastSuccessfulSyncAt);

  store.mutate((doc) => {
    doc.dailyScores.push({ date: '2026-10-13', ruleId: 'rule-life-01', checked: true, updatedAt: 'x', deviceId: 'd' });
  });
  assert.equal(store.hasPendingChanges(), true);
  store.resetToDefaults();
  assert.equal(store.getDocument().dailyScores.length, 0);
  assert.equal(store.hasPendingChanges(), false);
});

test('手动同步次数持久化并在新的一天重置', () => {
  const storage = createMemoryStorage();
  const store = createStore({ storage, now: FIXED_NOW });
  store.load();
  store.recordManualSync('2026-10-13');
  store.recordManualSync('2026-10-13');

  const reopened = createStore({ storage, now: FIXED_NOW });
  reopened.load();
  assert.equal(reopened.getManualSyncUsage().count, 2, '重启后保留次数');

  reopened.recordManualSync('2026-10-14');
  assert.equal(reopened.getManualSyncUsage().count, 1, '新的一天从 1 重新计');
  assert.equal(reopened.getManualSyncUsage().date, '2026-10-14');
});

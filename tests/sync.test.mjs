import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, STORAGE_KEYS } from '../src/storage/store.js';
import { createSyncService } from '../src/sync/syncService.js';
import { businessFingerprint, documentsEqual } from '../src/domain/model.js';
import { makeDoc, createMemoryStorage, cat, rule, score } from './helpers.mjs';

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body)
});

function createFakeBin({ record = null } = {}) {
  const state = {
    record,
    puts: [],
    gets: 0,
    getQueue: [],
    onGet: null,
    rejectGet: false,
    forceStatus: null
  };
  const fetchImpl = async (url, options = {}) => {
    const method = options.method ?? 'GET';
    if (state.rejectGet && method === 'GET') throw new TypeError('Failed to fetch');
    if (state.forceStatus) return jsonResponse(state.forceStatus, { message: 'forced' });

    const headers = options.headers ?? {};
    if (!headers['X-Master-Key'] && !headers['X-Access-Key']) {
      return jsonResponse(401, { message: 'missing key' });
    }
    if (method === 'GET') {
      state.gets += 1;
      state.onGet?.(state.gets);
      if (state.getQueue.length > 0) return jsonResponse(200, state.getQueue.shift());
      return jsonResponse(200, state.record ?? {});
    }
    if (method === 'PUT') {
      state.record = JSON.parse(options.body);
      state.puts.push(state.record);
      return jsonResponse(200, { metadata: {} });
    }
    return jsonResponse(405, {});
  };
  return { fetchImpl, state };
}

const NOW = () => new Date('2026-10-13T09:00:00.000Z');

function makeStore(doc) {
  const storage = createMemoryStorage({ [STORAGE_KEYS.document]: doc });
  const store = createStore({ storage, now: NOW });
  store.load();
  store.setCredentials({ binId: 'bin-1', apiKey: 'key-1' });
  return store;
}

const docWithScore = (date, ruleId) =>
  makeDoc({
    categories: [cat('cat-1', '生活习惯')],
    rules: [rule('r1', '跳绳', 3)],
    dailyScores: [score(date, ruleId, true, `${date}T08:00:00.000Z`)]
  });

test('未配置云端时保持本地模式', async () => {
  const storage = createMemoryStorage();
  const store = createStore({ storage, now: NOW });
  store.load();
  const { fetchImpl, state } = createFakeBin();
  const service = createSyncService({ store, fetchImpl, now: NOW });
  const result = await service.sync({ manual: true });
  assert.equal(result.status, 'not-configured');
  assert.equal(state.gets, 0);
  assert.equal(service.getUiState().configured, false);
});

test('数据一致：不写云端但记录当天成功检查', async () => {
  const local = docWithScore('2026-10-13', 'r1');
  const store = makeStore(local);
  const { fetchImpl, state } = createFakeBin({ record: local });
  const service = createSyncService({ store, fetchImpl, now: NOW });

  const result = await service.sync({ manual: true });
  assert.equal(result.status, 'in-sync');
  assert.equal(state.puts.length, 0);
  assert.equal(store.getMeta().lastSuccessfulCheckDate, '2026-10-13');
  assert.equal(service.getUiState().checkedToday, true);
  assert.equal(store.hasPendingChanges(), false);
});

test('远端新增记录自动合并、写回并更新基线', async () => {
  const local = docWithScore('2026-10-12', 'r1');
  const remote = docWithScore('2026-10-13', 'r1');
  const store = makeStore(local);
  const { fetchImpl, state } = createFakeBin({ record: remote });
  const service = createSyncService({ store, fetchImpl, now: NOW });

  const result = await service.sync({ manual: true });
  assert.equal(result.status, 'synced');
  assert.equal(state.puts.length, 1);
  assert.equal(state.puts[0].dailyScores.length, 2);
  assert.equal(store.getDocument().dailyScores.length, 2);
  assert.equal(store.hasPendingChanges(), false, '基线已更新为写回内容');
  assert.ok(documentsEqual(store.getMeta().baselineDocument, state.puts[0]));
});

test('冲突未处理：不写云端、不标记成功', async () => {
  const base = docWithScore('2026-10-12', 'r1');
  const localChanged = { ...base, rules: [{ id: 'r1', deletedAt: null, versions: [...base.rules[0].versions, ...rule('r1', '跳绳', 4, '2026-10-15').versions] }] };
  const remoteChanged = { ...base, rules: [{ id: 'r1', deletedAt: null, versions: [...base.rules[0].versions, ...rule('r1', '跳绳', 6, '2026-10-15').versions] }] };

  const store = makeStore(base);
  store.setDocument(localChanged);
  store.setMeta({ baselineDocument: base });
  const { fetchImpl, state } = createFakeBin({ record: remoteChanged });
  const conflictsSeen = [];
  const service = createSyncService({
    store,
    fetchImpl,
    now: NOW,
    hooks: {
      onConflicts: async (conflicts) => {
        conflictsSeen.push(...conflicts);
        return null; // 家长取消
      }
    }
  });

  const result = await service.sync({ manual: true });
  assert.equal(result.status, 'conflict-pending');
  assert.equal(conflictsSeen.length, 1);
  assert.equal(state.puts.length, 0, '冲突未解决不写回');
  assert.equal(store.getMeta().lastSuccessfulCheckDate, null, '不标记当天成功');

  // 家长选择后再次同步成功
  const service2 = createSyncService({
    store,
    fetchImpl,
    now: NOW,
    hooks: { onConflicts: async () => ['remote'] }
  });
  const result2 = await service2.sync({ manual: true });
  assert.equal(result2.status, 'synced');
  const written = state.puts[0].rules[0].versions.find((v) => v.effectiveDate === '2026-10-15');
  assert.equal(written.points, 6);
});

test('读取后远端被其他设备修改：阻止覆盖', async () => {
  const local = docWithScore('2026-10-12', 'r1');
  const remote = docWithScore('2026-10-13', 'r1');
  const store = makeStore(local);
  const { fetchImpl, state } = createFakeBin({ record: remote });
  // 第二次 GET 返回不同内容，模拟读取后、写回前的并发修改
  state.getQueue.push(docWithScore('2026-10-14', 'r1'));
  const service = createSyncService({ store, fetchImpl, now: NOW });

  const result = await service.sync({ manual: true });
  assert.equal(result.status, 'remote-changed');
  assert.equal(state.puts.length, 0);
  assert.equal(store.getMeta().lastSuccessfulCheckDate, null);
});

test('空 Bin 用本机数据初始化云端', async () => {
  const local = docWithScore('2026-10-13', 'r1');
  const store = makeStore(local);
  const { fetchImpl, state } = createFakeBin({ record: {} });
  const service = createSyncService({ store, fetchImpl, now: NOW });

  const result = await service.sync({ manual: true });
  assert.equal(result.status, 'initialized');
  assert.equal(state.puts.length, 1);
  assert.equal(store.getMeta().lastSuccessfulCheckDate, '2026-10-13');
});

test('云端内容无法识别：不写回并提示，用户确认后同一次同步完成初始化', async () => {
  const store = makeStore(docWithScore('2026-10-13', 'r1'));
  const { fetchImpl, state } = createFakeBin({ record: { hello: 'world' } });

  const decliningService = createSyncService({
    store,
    fetchImpl,
    now: NOW,
    hooks: { onUnrecognized: async () => false }
  });
  const result = await decliningService.sync({ manual: true });
  assert.equal(result.status, 'remote-unrecognized');
  assert.ok(result.preview.includes('hello'));
  assert.equal(state.puts.length, 0, '未确认前不覆盖远端');
  assert.equal(store.getMeta().lastSuccessfulCheckDate, null);

  let prompted = null;
  const confirmingService = createSyncService({
    store,
    fetchImpl,
    now: NOW,
    hooks: {
      onUnrecognized: async ({ preview, manual }) => {
        prompted = { preview, manual };
        return true;
      }
    }
  });
  const initialized = await confirmingService.sync({ manual: true });
  assert.equal(initialized.status, 'initialized');
  assert.equal(prompted.manual, true);
  assert.equal(state.puts.length, 1);
  assert.equal(state.puts[0].dailyScores.length, 1);
  assert.equal(store.getMeta().lastSuccessfulCheckDate, '2026-10-13');
});

test('自动检查遇到无法识别的云端内容不会询问用户，也不覆盖', async () => {
  const store = makeStore(docWithScore('2026-10-13', 'r1'));
  const { fetchImpl, state } = createFakeBin({ record: 'not a document' });
  let prompted = false;
  const service = createSyncService({
    store,
    fetchImpl,
    now: NOW,
    hooks: { onUnrecognized: async () => { prompted = true; return true; } }
  });
  const result = await service.autoCheckOnOpen();
  assert.equal(result.status, 'remote-unrecognized');
  assert.equal(prompted, false, '自动检查不弹出确认');
  assert.equal(state.puts.length, 0);
});

test('云端内容可识别时不会触发初始化确认，按正常合并处理', async () => {
  const local = docWithScore('2026-10-12', 'r1');
  const remote = docWithScore('2026-10-13', 'r1');
  const store = makeStore(local);
  const { fetchImpl, state } = createFakeBin({ record: remote });
  let prompted = false;
  const service = createSyncService({
    store,
    fetchImpl,
    now: NOW,
    hooks: { onUnrecognized: async () => { prompted = true; return true; } }
  });

  const result = await service.sync({ manual: true });
  assert.equal(result.status, 'synced');
  assert.equal(prompted, false);
  assert.equal(state.puts.length, 1);
  assert.equal(state.puts[0].dailyScores.length, 2, '两端记录都被保留');
});

test('鉴权失败与网络故障分别给出明确错误', async () => {
  const store = makeStore(docWithScore('2026-10-13', 'r1'));

  const auth = createFakeBin();
  auth.state.forceStatus = 401;
  const serviceAuth = createSyncService({ store, fetchImpl: auth.fetchImpl, now: NOW });
  const authResult = await serviceAuth.sync({ manual: true });
  assert.equal(authResult.status, 'error');
  assert.equal(authResult.error.type, 'auth');
  assert.equal(store.getMeta().lastSuccessfulCheckDate, null);

  const network = createFakeBin();
  network.state.rejectGet = true;
  const serviceNet = createSyncService({ store, fetchImpl: network.fetchImpl, now: NOW });
  const netResult = await serviceNet.sync({ manual: true });
  assert.equal(netResult.status, 'error');
  assert.equal(netResult.error.type, 'network');
});

test('记住可用的密钥请求头：首次回退后，后续同步直接使用 Access Key', async () => {
  const local = docWithScore('2026-10-13', 'r1');
  const store = makeStore(local);
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const headers = options.headers ?? {};
    const usingMaster = Boolean(headers['X-Master-Key']);
    calls.push(usingMaster ? 'master' : 'access');
    if (usingMaster) return jsonResponse(401, { message: 'not this header' });
    return jsonResponse(200, local);
  };
  const service = createSyncService({ store, fetchImpl, now: NOW });

  const first = await service.sync({ manual: true });
  assert.equal(first.status, 'in-sync');
  assert.deepEqual(calls, ['master', 'access'], '首次请求先试 Master，401 后回退 Access');
  assert.equal(store.getCredentials().keyHeader, 'X-Access-Key', '记住可用的请求头');

  const second = await service.sync({ manual: true });
  assert.equal(second.status, 'in-sync');
  assert.deepEqual(calls, ['master', 'access', 'access'], '后续请求不再产生多余的 401 往返');
});

test('密钥更换后不再沿用旧的请求头提示', async () => {
  const local = docWithScore('2026-10-13', 'r1');
  const store = makeStore(local);
  store.setCredentials({ binId: 'bin-1', apiKey: 'key-1', keyHeader: 'X-Access-Key' });
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const headers = options.headers ?? {};
    calls.push(headers['X-Access-Key'] ? 'access' : 'master');
    return jsonResponse(401, { message: 'denied' });
  };
  const service = createSyncService({ store, fetchImpl, now: NOW });
  const result = await service.sync({ manual: true });
  assert.equal(result.status, 'error');
  assert.equal(result.error.type, 'auth');
  assert.deepEqual(calls, ['access', 'master'], '提示的请求头仍先尝试，失败后回退另一个');
});

test('每天自动检查成功一次后跳过；手动同步仍会检查最新远端', async () => {
  const local = docWithScore('2026-10-13', 'r1');
  const store = makeStore(local);
  const { fetchImpl, state } = createFakeBin({ record: local });
  const service = createSyncService({ store, fetchImpl, now: NOW });

  const auto1 = await service.autoCheckOnOpen();
  assert.equal(auto1.status, 'in-sync');
  const getsAfterAuto = state.gets;

  const auto2 = await service.autoCheckOnOpen();
  assert.equal(auto2.status, 'skipped-today');
  assert.equal(state.gets, getsAfterAuto, '当天成功后不再发起远程请求');

  const manual = await service.sync({ manual: true });
  assert.equal(manual.status, 'in-sync');
  assert.ok(state.gets > getsAfterAuto, '手动同步仍会检查最新远端');
});

test('手动同步每天最多三次，达到上限后不再发起请求', async () => {
  const local = docWithScore('2026-10-13', 'r1');
  const store = makeStore(local);
  const { fetchImpl, state } = createFakeBin({ record: local });
  const service = createSyncService({ store, fetchImpl, now: NOW });

  for (let i = 1; i <= 3; i += 1) {
    const result = await service.sync({ manual: true });
    assert.equal(result.status, 'in-sync');
    assert.equal(result.usage.used, i);
    assert.equal(result.usage.limit, 3);
  }
  assert.equal(service.getUiState().manualSyncRemaining, 0);

  const getsAtLimit = state.gets;
  const blocked = await service.sync({ manual: true });
  assert.equal(blocked.status, 'manual-limit');
  assert.equal(blocked.usage.used, 3);
  assert.equal(state.gets, getsAtLimit, '达到上限后不再发起任何远程请求');
});

test('自动检查不计入手动同步次数', async () => {
  const local = docWithScore('2026-10-13', 'r1');
  const store = makeStore(local);
  const { fetchImpl } = createFakeBin({ record: local });
  const service = createSyncService({ store, fetchImpl, now: NOW });

  assert.equal((await service.autoCheckOnOpen()).status, 'in-sync');
  assert.equal(service.getUiState().manualSyncRemaining, 3, '自动检查不消耗手动次数');

  for (let i = 0; i < 3; i += 1) {
    assert.equal((await service.sync({ manual: true })).status, 'in-sync');
  }
  assert.equal((await service.sync({ manual: true })).status, 'manual-limit');
});

test('离线时手动同步直接提示且不占用次数', async () => {
  const local = docWithScore('2026-10-13', 'r1');
  const store = makeStore(local);
  const { fetchImpl, state } = createFakeBin({ record: local });

  const offlineService = createSyncService({ store, fetchImpl, now: NOW, isOnline: () => false });
  const result = await offlineService.sync({ manual: true });
  assert.equal(result.status, 'offline');
  assert.equal(state.gets, 0, '离线时不做任何请求');
  assert.equal(store.getManualSyncUsage().count, 0, '离线不占用次数');

  const onlineService = createSyncService({ store, fetchImpl, now: NOW });
  assert.equal((await onlineService.sync({ manual: true })).status, 'in-sync');
});

test('手动同步次数在新的一天自动重置', async () => {
  const local = docWithScore('2026-10-13', 'r1');
  let clock = new Date('2026-10-13T09:00:00.000Z');
  const storage = createMemoryStorage({ [STORAGE_KEYS.document]: local });
  const store = createStore({ storage, now: () => clock });
  store.load();
  store.setCredentials({ binId: 'bin-1', apiKey: 'key-1' });
  const { fetchImpl } = createFakeBin({ record: local });
  const service = createSyncService({ store, fetchImpl, now: () => clock });

  for (let i = 0; i < 3; i += 1) {
    await service.sync({ manual: true });
  }
  assert.equal((await service.sync({ manual: true })).status, 'manual-limit');

  clock = new Date('2026-10-14T09:00:00.000Z');
  const next = await service.sync({ manual: true });
  assert.equal(next.status, 'in-sync');
  assert.equal(next.usage.used, 1, '新的一天从 1 重新计数');
});

test('同步进行中拒绝重复请求', async () => {
  const local = docWithScore('2026-10-13', 'r1');
  const store = makeStore(local);
  const { fetchImpl } = createFakeBin({ record: local });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const slowFetch = async (url, options) => {
    await gate;
    return fetchImpl(url, options);
  };
  const service = createSyncService({ store, fetchImpl: slowFetch, now: NOW });

  const first = service.sync({ manual: true });
  const second = await service.sync({ manual: true });
  assert.equal(second.status, 'busy');
  release();
  const firstResult = await first;
  assert.equal(firstResult.status, 'in-sync');
});

test('同步期间的新本机修改保留为待同步，不被响应覆盖', async () => {
  const base = docWithScore('2026-10-12', 'r1');
  const local = base;
  const remote = docWithScore('2026-10-13', 'r1');
  const store = makeStore(local);
  const { fetchImpl, state } = createFakeBin({ record: remote });
  // 第二次 GET（写回前复查）时模拟用户又打了一天的分
  state.onGet = (count) => {
    if (count === 2) {
      store.mutate((doc) => {
        doc.dailyScores.push(score('2026-10-14', 'r1', true, '2026-10-14T09:00:00.000Z'));
      });
    }
  };
  const service = createSyncService({ store, fetchImpl, now: NOW });

  const result = await service.sync({ manual: true });
  assert.equal(result.status, 'synced');
  const dates = store.getDocument().dailyScores.map((s) => s.date).sort();
  assert.deepEqual(dates, ['2026-10-12', '2026-10-13', '2026-10-14'], '同步窗口内的本地加分不丢失');
  assert.equal(store.hasPendingChanges(), true, '未上传的修改标记为待同步');
  assert.equal(businessFingerprint(state.puts[0]).includes('2026-10-14'), false, '写回内容不含同步窗口内新增数据');
});

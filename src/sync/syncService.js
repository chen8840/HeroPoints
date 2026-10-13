import { createJsonBinClient, SyncError } from './jsonbin.js';
import { mergeDocuments, resolveConflicts } from '../domain/merge.js';
import { normalizeDocument, cloneDocument, documentsEqual } from '../domain/model.js';
import { todayLocal } from '../lib/date.js';

/** 手动同步每天最多执行次数（自动检查不计入）。 */
export const MANUAL_SYNC_DAILY_LIMIT = 3;

const defaultIsOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/**
 * 同步编排：
 * - 手动同步每天最多 MANUAL_SYNC_DAILY_LIMIT 次；自动检查每天最多成功一次（由 lastSuccessfulCheckDate 控制）。
 * - 每次同步都读取最新远端 → 比较 → 三方合并（冲突交由 onConflicts 决定）→ 写回前复查远端 → 写回。
 * - 失败或冲突未处理时绝不标记当天成功，也绝不覆盖远端。
 */
export function createSyncService({ store, fetchImpl, hooks = {}, now = () => new Date(), isOnline = defaultIsOnline }) {
  let inFlight = null;
  let lastError = null;

  const emit = () => hooks.onState?.(getUiState());

  function manualUsageToday() {
    const today = todayLocal(now());
    const usage = store.getManualSyncUsage();
    return { used: usage.date === today ? usage.count : 0, limit: MANUAL_SYNC_DAILY_LIMIT };
  }

  function getUiState() {
    const creds = store.getCredentials();
    const meta = store.getMeta();
    return {
      configured: Boolean(creds.binId && creds.apiKey),
      syncing: Boolean(inFlight),
      lastError,
      lastSuccessfulCheckDate: meta.lastSuccessfulCheckDate,
      lastSuccessfulSyncAt: meta.lastSuccessfulSyncAt,
      pending: store.hasPendingChanges(),
      checkedToday: meta.lastSuccessfulCheckDate === todayLocal(now()),
      manualSyncRemaining: Math.max(0, MANUAL_SYNC_DAILY_LIMIT - manualUsageToday().used)
    };
  }

  async function runSync(manual) {
    const creds = store.getCredentials();
    const client = createJsonBinClient({
      binId: creds.binId,
      apiKey: creds.apiKey,
      fetchImpl,
      keyHeader: creds.keyHeader,
      onKeyHeader: (keyHeader) => store.setCredentials({ ...creds, keyHeader })
    });

    const remoteRaw = await client.read();

    const recognized = (() => {
      try {
        return normalizeDocument(remoteRaw);
      } catch {
        return null;
      }
    })();

    if (client.isEmptyRemote(remoteRaw)) {
      // 空 Bin：用本机数据初始化云端（远端没有可被覆盖的内容）
      const initial = cloneDocument(store.getDocument());
      initial.documentRevision = (initial.documentRevision ?? 0) + 1;
      await client.write(initial);
      store.markChecked({ baselineDocument: initial });
      lastError = null;
      return { status: 'initialized' };
    }

    let remote = recognized;
    if (!remote) {
      // JSONBin 不允许 Bin 内容为空，新建的 Bin 往往带占位内容。
      // 不静默覆盖：只有手动同步经用户确认后才用本机数据初始化云端；自动检查绝不写入。
      const preview = JSON.stringify(remoteRaw).slice(0, 80);
      const shouldInitialize = manual && (await hooks.onUnrecognized?.({ preview, manual })) === true;
      if (shouldInitialize) {
        const initial = cloneDocument(store.getDocument());
        initial.documentRevision = (initial.documentRevision ?? 0) + 1;
        await client.write(initial);
        store.markChecked({ baselineDocument: initial });
        lastError = null;
        return { status: 'initialized' };
      }
      lastError = { type: 'invalid', message: '云端内容不是 HeroXP 数据，未做任何修改' };
      return { status: 'remote-unrecognized', preview };
    }

    const local = cloneDocument(store.getDocument());

    if (documentsEqual(remote, local)) {
      store.markChecked({ baselineDocument: remote });
      lastError = null;
      return { status: 'in-sync' };
    }

    const base = store.getMeta().baselineDocument;
    const mergeResult = mergeDocuments({ base, local, remote });
    let finalDoc = mergeResult.document;

    if (mergeResult.conflicts.length > 0) {
      const choices = await hooks.onConflicts?.(mergeResult.conflicts, { manual });
      if (!choices) return { status: 'conflict-pending' };
      finalDoc = resolveConflicts(mergeResult, choices);
    }

    // JSONBin 整文档写入无条件更新：写回前复查远端，若读取后被其他设备改过则阻止覆盖。
    const remoteCheckRaw = await client.read();
    let remoteCheck = null;
    try {
      remoteCheck = normalizeDocument(remoteCheckRaw);
    } catch {
      return { status: 'remote-changed' };
    }
    if (!documentsEqual(remoteCheck, remote)) {
      return { status: 'remote-changed' };
    }

    const toWrite = cloneDocument(finalDoc);
    toWrite.documentRevision = Math.max(local.documentRevision ?? 0, remote.documentRevision ?? 0) + 1;
    await client.write(toWrite);

    // 同步窗口内产生的新本机修改：合并保留并标记为待同步，不被网络响应覆盖。
    const current = store.getDocument();
    let applied = toWrite;
    if (!documentsEqual(current, local)) {
      applied = mergeDocuments({ base: local, local: current, remote: toWrite }).document;
    }
    store.setDocument(applied);
    store.markChecked({ baselineDocument: toWrite });
    lastError = null;
    return { status: 'synced' };
  }

  async function sync({ manual = false } = {}) {
    if (inFlight) return { status: 'busy' };
    const creds = store.getCredentials();
    if (!creds.binId || !creds.apiKey) return { status: 'not-configured' };

    if (manual) {
      const usage = manualUsageToday();
      if (usage.used >= MANUAL_SYNC_DAILY_LIMIT) return { status: 'manual-limit', usage };
      if (!isOnline()) return { status: 'offline' };
    }

    lastError = null;
    inFlight = (async () => {
      try {
        if (manual) store.recordManualSync(todayLocal(now()));
        return await runSync(manual);
      } catch (err) {
        const syncErr =
          err instanceof SyncError ? err : new SyncError('network', '网络请求失败，请检查网络连接');
        lastError = { type: syncErr.type, message: syncErr.message };
        return { status: 'error', error: lastError };
      }
    })();

    emit();
    try {
      const result = await inFlight;
      if (manual && result.status !== 'busy') result.usage = manualUsageToday();
      return result;
    } finally {
      inFlight = null;
      emit();
    }
  }

  /** 每次打开/进入应用时的自动检查：当天已成功过则跳过。 */
  async function autoCheckOnOpen() {
    const creds = store.getCredentials();
    if (!creds.binId || !creds.apiKey) return { status: 'not-configured' };
    if (store.getMeta().lastSuccessfulCheckDate === todayLocal(now())) return { status: 'skipped-today' };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { status: 'offline' };
    return sync({ manual: false });
  }

  function bindOnlineRetry() {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', () => {
      const creds = store.getCredentials();
      if (!creds.binId || !creds.apiKey) return;
      if (store.getMeta().lastSuccessfulCheckDate === todayLocal(now())) return;
      void autoCheckOnOpen();
    });
  }

  return { sync, autoCheckOnOpen, getUiState, bindOnlineRetry, emit };
}

import { $ } from '../lib/dom.js';
import { balance } from '../domain/scoring.js';
import { formatDateTime } from '../lib/date.js';

const SYNC_RESULT_MESSAGES = {
  'not-configured': '尚未配置云端：当前为本地模式，可在规则页填写 JSONBin 连接信息',
  'in-sync': '云端与本机数据一致',
  initialized: '已使用本机数据初始化云端 Bin',
  synced: '同步完成',
  'conflict-pending': '存在冲突未处理，未写入云端',
  'remote-changed': '云端数据刚被其他设备修改，请再次同步以合并',
  'remote-unrecognized': '云端内容不是 HeroXP 数据，未做任何修改',
  'manual-limit': '今日手动同步次数已用完（每天最多 3 次），明天恢复；自动检查不受影响',
  offline: '当前无网络连接，请连网后再同步',
  busy: '同步已在进行中',
  'skipped-today': '今天已完成过自动检查'
};

export function initHeader(ctx) {
  const pointsEl = $('headerPoints');
  const syncBtn = $('headerSyncBtn');
  const syncIcon = $('syncIcon');
  const syncBtnText = $('syncBtnText');
  const syncDot = $('syncDot');
  const syncLabel = $('syncTimeLabel');

  function renderPoints() {
    pointsEl.textContent = String(balance(ctx.getDocument()));
  }

  function renderSyncStatus() {
    const state = ctx.sync.getUiState();
    const meta = state;

    if (state.syncing) {
      syncIcon.classList.add('animate-spin');
      syncBtnText.textContent = '同步中';
      syncBtn.disabled = true;
      syncBtn.classList.add('opacity-70');
      syncDot.className = 'w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse';
      syncLabel.textContent = '正在同步...';
      return;
    }

    syncIcon.classList.remove('animate-spin');
    syncBtn.disabled = false;
    syncBtn.classList.remove('opacity-70');
    syncBtnText.textContent = '同步';

    if (!state.configured) {
      syncDot.className = 'w-1.5 h-1.5 rounded-full bg-slate-300';
      syncLabel.textContent = '本地模式（未配置云端）';
      return;
    }

    if (state.lastError) {
      syncDot.className = 'w-1.5 h-1.5 rounded-full bg-rose-400';
      syncLabel.textContent = `同步失败：${state.lastError.message}`;
      return;
    }

    if (state.pending) {
      syncDot.className = 'w-1.5 h-1.5 rounded-full bg-amber-300';
      const last = meta.lastSuccessfulSyncAt ? ` · 上次同步 ${formatDateTime(meta.lastSuccessfulSyncAt)}` : '';
      syncLabel.textContent = `有未同步修改${last}`;
      return;
    }

    syncDot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-300';
    if (meta.lastSuccessfulSyncAt) {
      syncLabel.textContent = `已同步 ${formatDateTime(meta.lastSuccessfulSyncAt)}`;
    } else if (meta.checkedToday) {
      syncLabel.textContent = '今日已检查';
    } else {
      syncLabel.textContent = '云端已配置 · 等待检查';
    }
  }

  syncBtn.addEventListener('click', () => {
    void ctx.manualSync();
  });

  return { render: () => { renderPoints(); renderSyncStatus(); } };
}

export function syncResultMessage(result) {
  if (result.status === 'error') return result.error.message;
  return SYNC_RESULT_MESSAGES[result.status] ?? '同步结束';
}

export function syncResultType(result) {
  if (result.status === 'error') return 'error';
  if (result.status === 'synced' || result.status === 'in-sync' || result.status === 'initialized') return 'success';
  if (result.status === 'conflict-pending' || result.status === 'remote-changed' || result.status === 'remote-unrecognized') {
    return 'error';
  }
  return 'info';
}
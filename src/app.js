import { $, toast } from './lib/dom.js';
import { createStore, StorageFullError } from './storage/store.js';
import { createSyncService } from './sync/syncService.js';
import { todayLocal } from './lib/date.js';
import { initHeader, syncResultMessage, syncResultType } from './ui/header.js';
import { initCalendar } from './ui/calendar.js';
import { initDrawer } from './ui/drawer.js';
import { initShop } from './ui/shop.js';
import { initStats } from './ui/stats.js';
import { initRules } from './ui/rules.js';
import { initModals } from './ui/modals.js';
import { initConflicts } from './ui/conflicts.js';
import { initInstall, initServiceWorker, initOrientationLock } from './ui/install.js';

const store = createStore();
const loadResult = store.load();

if (loadResult.status === 'corrupted') {
  showCorruptedScreen(loadResult.raw);
} else {
  boot(loadResult);
}

function showCorruptedScreen(raw) {
  document.body.innerHTML = `
    <div class="max-w-md mx-auto p-6 min-h-screen bg-white flex flex-col justify-center space-y-4">
      <h1 class="text-lg font-black text-rose-600">⚠️ 本机数据无法读取</h1>
      <p class="text-xs text-slate-600 leading-relaxed">
        检测到本机保存的数据损坏或来自更高版本。为避免静默丢失，应用没有自动重置。
        建议先导出损坏数据留存，再重置为初始规则（云端数据不受影响，之后可通过同步恢复）。
      </p>
      <button id="corruptedExportBtn" class="w-full py-2.5 bg-white border border-slate-300 text-slate-700 rounded-xl text-xs font-bold">导出损坏数据文件</button>
      <button id="corruptedResetBtn" class="w-full py-2.5 bg-rose-600 text-white rounded-xl text-xs font-bold">重置为初始数据（不可撤销）</button>
    </div>`;

  $('corruptedExportBtn').addEventListener('click', () => {
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'HeroXP_损坏数据.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast('已导出损坏数据文件', 'success');
  });
  $('corruptedResetBtn').addEventListener('click', () => {
    if (!window.confirm('确定重置本机数据为初始规则吗？此操作不可撤销，建议先导出损坏数据。')) return;
    store.resetToDefaults();
    location.reload();
  });
}

function boot(loadResult) {
  const conflictsUi = initConflicts();

  const sync = createSyncService({
    store,
    hooks: {
      onState: () => refreshHeader(),
      onConflicts: (conflicts, options) =>
        conflictsUi.show(conflicts, {
          title: options?.manual ? undefined : '每日自动检查发现数据冲突，请选择保留哪一侧'
        }),
      onUnrecognized: ({ preview }) =>
        window.confirm(
          `云端 Bin 的内容不是 HeroXP 数据：\n${preview}\n\n如果这是你刚新建的 Bin，点「确定」会用本机数据初始化云端（覆盖上面的内容）。\n若不放心，请先去 jsonbin.io 检查该 Bin 的内容。`
        )
    }
  });

  let header;
  let calendar;
  let drawer;
  let shop;
  let stats;
  let rules;
  let install;
  let modals;

  const ctx = {
    store,
    sync,
    deviceId: store.getDeviceId(),
    today: () => todayLocal(),
    nowISO: () => new Date().toISOString(),
    getDocument: () => store.getDocument(),
    refreshAll,
    refreshHeader,
    mutate,
    replaceDocument,
    manualSync,
    switchTab,
    conflicts: conflictsUi,
    ui: null
  };

  header = initHeader(ctx);
  drawer = initDrawer(ctx);
  calendar = initCalendar(ctx, drawer);
  shop = initShop(ctx);
  stats = initStats(ctx);
  rules = initRules(ctx);
  modals = initModals(ctx);
  install = initInstall();
  ctx.ui = modals;

  wireTabs();

  function refreshHeader() {
    header.render();
  }

  function refreshAll() {
    header.render();
    calendar.render();
    shop.render();
    rules.render();
    stats.render();
  }

  function mutate(fn) {
    try {
      return store.mutate(fn);
    } catch (err) {
      if (err instanceof StorageFullError) {
        window.alert('本机存储空间不足，本次修改未保存。请先导出备份，并清理浏览器存储后重试。');
        return undefined;
      }
      throw err;
    }
  }

  function replaceDocument(next) {
    try {
      store.setDocument(next);
      return true;
    } catch (err) {
      if (err instanceof StorageFullError) {
        window.alert('本机存储空间不足，导入未保存。');
        return false;
      }
      throw err;
    }
  }

  async function manualSync() {
    const result = await sync.sync({ manual: true });
    if (result.status !== 'busy') {
      let message = syncResultMessage(result);
      if (result.usage && !['manual-limit', 'not-configured', 'offline'].includes(result.status)) {
        const remaining = Math.max(0, result.usage.limit - result.usage.used);
        message += `（今日手动同步剩余 ${remaining} 次）`;
      }
      toast(message, syncResultType(result));
    }
    refreshAll();
  }

  function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach((el) => el.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach((button) => {
      button.classList.remove('text-orange-500', 'font-bold');
      button.classList.add('text-slate-400', 'font-medium');
    });
    $(`tab-${tabId}`).classList.remove('hidden');
    const activeBtn = $(`btn-${tabId}`);
    activeBtn.classList.remove('text-slate-400', 'font-medium');
    activeBtn.classList.add('text-orange-500', 'font-bold');
    refreshAll();
  }

  function wireTabs() {
    for (const tabId of ['calendar', 'shop', 'stats', 'rules']) {
      $(`btn-${tabId}`).addEventListener('click', () => switchTab(tabId));
    }
    $('headerShopBtn').addEventListener('click', () => switchTab('shop'));
  }

  async function runAutoCheck() {
    const result = await sync.autoCheckOnOpen();
    if (result.status === 'error') {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (!offline) toast(`自动检查未完成：${result.error.message}`, 'error');
    } else if (result.status === 'conflict-pending') {
      toast('检测到数据冲突且未处理，数据仍保存在本机', 'error');
    }
    refreshAll();
  }

  refreshAll();
  sync.bindOnlineRetry();
  void runAutoCheck();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void runAutoCheck();
  });

  initOrientationLock();
  initServiceWorker();

  if (loadResult.migratedFromLegacy) {
    toast('已从旧版原型数据迁移到本机', 'success');
  }
}

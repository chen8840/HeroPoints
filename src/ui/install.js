import { $, toast } from '../lib/dom.js';

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    window.navigator.standalone === true
  );
}

function detectPlatform() {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  return 'desktop';
}

export function initInstall() {
  let deferredPrompt = null;
  const section = $('installSection');

  function render() {
    const platform = detectPlatform();
    const standalone = isStandalone();

    if (standalone) {
      section.innerHTML = '<p class="text-[11px] text-slate-500">✅ 已作为应用运行（独立窗口模式）</p>';
      return;
    }

    const installButton = deferredPrompt
      ? '<button id="installAppBtn" class="w-full py-2 bg-slate-800 text-white rounded-xl text-xs font-bold">📲 安装到手机桌面</button>'
      : '<p class="text-[11px] text-slate-500 leading-relaxed">浏览器菜单中通常提供「安装应用」或「添加到主屏幕」（若已安装则不显示）。</p>';

    const guide =
      platform === 'ios'
        ? 'iPhone / iPad：用 Safari 打开本页 → 点底部「分享」按钮 → 选择「添加到主屏幕」。'
        : platform === 'android'
          ? 'Android：用 Chrome 打开本页 → 点右上角菜单里的「安装应用」或「添加到主屏幕」。'
          : '手机端：iPhone 用 Safari「分享 → 添加到主屏幕」；Android 用 Chrome 菜单「安装应用」。';

    section.innerHTML = `
      <p class="text-[11px] text-slate-500 leading-relaxed">${guide}</p>
      ${installButton}`;

    $('installAppBtn')?.addEventListener('click', () => {
      if (!deferredPrompt) return;
      const prompt = deferredPrompt;
      deferredPrompt = null;
      void prompt.prompt();
      prompt.userChoice?.then((choice) => {
        if (choice?.outcome === 'accepted') toast('正在安装到桌面...', 'success');
        render();
      });
    });
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    render();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    toast('已添加到桌面', 'success');
    render();
  });

  render();
  return { render };
}

export function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (globalThis.__HEROXP_DEV__) {
    // Development must bypass persistent PWA caches to see source changes.
    void navigator.serviceWorker.getRegistrations().then(async (registrations) => {
      await Promise.all(registrations.map((registration) => registration.unregister()));
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith('heroxp-')).map((key) => caches.delete(key)));
      if (navigator.serviceWorker.controller) location.reload();
    });
    return;
  }
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').then((registration) => {
      // 已下载但未激活的新版本（例如上次打开时未点「立即刷新」）：
      // updatefound 不会再次触发，必须在每次打开时直接检查 waiting，否则永远不会再提示。
      if (registration.waiting && navigator.serviceWorker.controller) {
        showUpdateBanner(registration.waiting);
      }
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner(worker);
          }
        });
      });
      // 打开应用和回到前台时主动检查一次新版本（应用可能长期不关闭）
      const checkForUpdate = () => {
        if (typeof registration.update === 'function') {
          void registration.update().catch(() => {});
        }
      };
      checkForUpdate();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
    });
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });
}

function showUpdateBanner(worker) {
  const banner = $('updateBanner');
  banner.classList.remove('hidden');
  $('updateApplyBtn').addEventListener('click', () => {
    banner.classList.add('hidden');
    worker.postMessage({ type: 'SKIP_WAITING' });
  });
  $('updateDismissBtn').addEventListener('click', () => {
    banner.classList.add('hidden');
  });
}

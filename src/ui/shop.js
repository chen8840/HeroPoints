import { $, escapeHtml, toast, overlayOpen, overlayClose } from '../lib/dom.js';
import { activeRewards, DEFAULT_NOTES } from '../domain/model.js';
import { balance, currentRewardVersion, rewardVersionById } from '../domain/scoring.js';
import { redeem, refundRedemption } from '../domain/operations.js';

export function initShop(ctx) {
  const listEl = $('rewardList');
  const historyList = $('redeemHistoryList');

  function render() {
    const doc = ctx.getDocument();
    const today = ctx.today();
    const total = balance(doc);

    const rewards = activeRewards(doc)
      .map((reward) => ({ reward, version: currentRewardVersion(reward, today) }))
      .filter((item) => item.version)
      .sort((a, b) => a.version.cost - b.version.cost);

    if (rewards.length === 0) {
      listEl.innerHTML = '<div class="p-8 text-center text-slate-400 text-xs">暂无兑换方案，点击右上角「+ 新增方案」</div>';
      return;
    }

    listEl.innerHTML = rewards
      .map(({ reward, version }) => {
        const canAfford = total >= version.cost;
        return `
        <div class="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm space-y-2.5">
          <div class="flex justify-between items-start">
            <div>
              <span class="text-xl font-black text-amber-500">${version.cost}</span>
              <span class="text-xs font-bold text-amber-500">积分兑换档</span>
              ${version.ruleNote ? `<span class="ml-2 text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold">${escapeHtml(version.ruleNote)}</span>` : ''}
            </div>
            <div class="flex gap-2 text-xs">
              <button data-action="edit" data-id="${escapeHtml(reward.id)}" class="text-slate-400 hover:text-blue-500">编辑</button>
              <button data-action="delete" data-id="${escapeHtml(reward.id)}" class="text-slate-400 hover:text-red-500">删除</button>
            </div>
          </div>
          <p class="text-xs text-slate-600 whitespace-pre-line font-medium leading-relaxed bg-slate-50 p-2.5 rounded-xl border border-slate-100">${escapeHtml(version.text)}</p>
          <button data-action="redeem" data-id="${escapeHtml(reward.id)}" ${canAfford ? '' : 'disabled'}
            class="w-full py-2 rounded-xl text-xs font-bold transition ${canAfford ? 'bg-orange-500 text-white shadow-md' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}">
            ${canAfford ? '立即兑换奖励' : '积分不足以兑换'}
          </button>
        </div>`;
      })
      .join('');
  }

  listEl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    const doc = ctx.getDocument();
    const reward = doc.rewards.find((r) => r.id === id);
    if (!reward) return;

    if (action === 'redeem') {
      const version = currentRewardVersion(reward, ctx.today());
      if (!version) return;
      if (!window.confirm(`确认消耗 ${version.cost} 积分兑换该方案吗？`)) return;
      const record = ctx.mutate((draft) => redeem(draft, id, { now: ctx.nowISO(), deviceId: ctx.deviceId }), { toast: false });
      if (record) {
        ctx.refreshAll();
        toast('兑换成功！记得向爸爸妈妈领取奖励', 'success');
      } else {
        toast('兑换失败：方案不存在', 'error');
      }
      return;
    }

    if (action === 'edit') {
      ctx.ui.openRewardModal(reward);
      return;
    }

    if (action === 'delete') {
      if (!window.confirm('确定删除该兑换方案吗？（历史兑换记录会保留）')) return;
      ctx.mutate((draft) => {
        const target = draft.rewards.find((r) => r.id === id);
        if (target) target.deletedAt = ctx.nowISO();
      });
      ctx.refreshAll();
    }
  });

  function renderHistory() {
    const doc = ctx.getDocument();
    const records = [...doc.redemptions].sort((a, b) =>
      a.date === b.date ? (a.updatedAt < b.updatedAt ? 1 : -1) : a.date < b.date ? 1 : -1
    );

    if (records.length === 0) {
      historyList.innerHTML = '<div class="text-center py-8 text-slate-400 text-xs">暂无兑换记录</div>';
      return;
    }

    historyList.innerHTML = records
      .map((record) => {
        const reward = doc.rewards.find((r) => r.id === record.rewardId);
        const version = reward ? rewardVersionById(reward, record.rewardVersionId) : null;
        const summary = version ? version.text.replace(/\n/g, ' / ') : '（方案已不存在）';
        const cost = version ? version.cost : 0;
        const refunded = record.status === 'refunded';
        return `
        <div class="p-3 ${refunded ? 'bg-slate-50/60' : 'bg-slate-50'} border border-slate-100 rounded-xl flex justify-between items-start">
          <div class="space-y-1">
            <span class="text-[10px] text-slate-400 font-bold">${escapeHtml(record.date)}</span>
            <p class="text-xs font-bold ${refunded ? 'text-slate-400 line-through' : 'text-slate-700'} leading-snug">${escapeHtml(summary)}</p>
            <span class="inline-block text-[11px] font-black ${refunded ? 'text-slate-400 bg-slate-100' : 'text-amber-600 bg-amber-50'} px-1.5 py-0.5 rounded">
              ${refunded ? `已撤销 · 退还 ${cost} 积分` : `-${cost} 积分`}
            </span>
          </div>
          ${
            refunded
              ? ''
              : `<button data-refund="${escapeHtml(record.id)}" class="text-[10px] text-rose-500 font-bold hover:underline ml-2 whitespace-nowrap">撤销/退分</button>`
          }
        </div>`;
      })
      .join('');
  }

  historyList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-refund]');
    if (!button) return;
    if (!window.confirm('确认撤销该条兑换吗？消耗的积分将退回。')) return;
    const changed = ctx.mutate((draft) => refundRedemption(draft, button.dataset.refund, { now: ctx.nowISO(), deviceId: ctx.deviceId }), {
      toast: false
    });
    if (changed) {
      ctx.refreshAll();
      renderHistory();
      toast('已撤销并退分', 'success');
    }
  });

  $('redeemHistoryOpenBtn').addEventListener('click', () => {
    renderHistory();
    overlayOpen('redeemHistoryModal', () => $('redeemHistoryModal').classList.add('hidden'));
  });
  $('redeemHistoryCloseBtn').addEventListener('click', () => overlayClose('redeemHistoryModal'));
  $('redeemHistoryCloseBtn2').addEventListener('click', () => overlayClose('redeemHistoryModal'));
  $('addRewardBtn').addEventListener('click', () => ctx.ui.openRewardModal(null));

  return { render };
}

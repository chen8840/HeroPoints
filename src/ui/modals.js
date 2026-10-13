import { $, escapeHtml, toast, overlayOpen, overlayClose } from '../lib/dom.js';
import { createCategory, updateCategory, createRule, updateRule, createReward, updateReward } from '../domain/operations.js';
import { pointsAt, nameAt, currentRewardVersion, currentCategoryId } from '../domain/scoring.js';
import { activeCategories, orderedCategories } from '../domain/model.js';

const PALETTE_COLORS = [
  { name: '翠绿', hex: '#10b981' },
  { name: '湖蓝', hex: '#3b82f6' },
  { name: '暖橙', hex: '#f59e0b' },
  { name: '警戒红', hex: '#ef4444' },
  { name: '梦幻紫', hex: '#8b5cf6' },
  { name: '甜心粉', hex: '#ec4899' },
  { name: '青碧', hex: '#06b6d4' },
  { name: '低调灰', hex: '#64748b' }
];

export function initModals(ctx) {
  let selectedColor = PALETTE_COLORS[0].hex;
  let editingCategoryId = null;
  let editingRuleId = null;
  let editingRewardId = null;

  /* ---------- 类别 ---------- */

  function renderPalette() {
    $('colorPaletteContainer').innerHTML = PALETTE_COLORS.map(
      (color) => `
      <button type="button" data-color="${color.hex}"
        class="flex flex-col items-center p-2 rounded-xl border transition ${selectedColor === color.hex ? 'border-slate-800 bg-slate-50 ring-2 ring-slate-800' : 'border-slate-200'}">
        <span class="w-6 h-6 rounded-full shadow-sm mb-1" style="background-color: ${color.hex}"></span>
        <span class="text-[10px] font-bold text-slate-600">${color.name}</span>
      </button>`
    ).join('');
  }

  function openCategoryModal(category) {
    editingCategoryId = category?.id ?? null;
    selectedColor = category?.color ?? PALETTE_COLORS[0].hex;
    $('categoryModalTitle').textContent = category ? `编辑类别: ${category.name}` : '新增类别';
    $('categoryNameInput').value = category?.name ?? '';
    renderPalette();
    overlayOpen('categoryModal', () => $('categoryModal').classList.add('hidden'));
  }

  $('colorPaletteContainer').addEventListener('click', (event) => {
    const button = event.target.closest('[data-color]');
    if (!button) return;
    selectedColor = button.dataset.color;
    renderPalette();
  });

  $('categorySaveBtn').addEventListener('click', () => {
    const name = $('categoryNameInput').value.trim();
    if (!name) {
      window.alert('类别名称不能为空！');
      return;
    }
    const doc = ctx.getDocument();
    const duplicated = activeCategories(doc).some((c) => c.name === name && c.id !== editingCategoryId);
    if (duplicated) {
      window.alert('该类别已存在！');
      return;
    }
    if (editingCategoryId) {
      ctx.mutate((draft) => updateCategory(draft, editingCategoryId, { name, color: selectedColor }));
    } else {
      ctx.mutate((draft) => createCategory(draft, { name, color: selectedColor }));
    }
    ctx.refreshAll();
    overlayClose('categoryModal');
  });
  $('categoryCancelBtn').addEventListener('click', () => overlayClose('categoryModal'));

  /* ---------- 事项 ---------- */

  function renderRuleCategoryOptions(selectedId) {
    const options = orderedCategories(ctx.getDocument())
      .map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
      .join('');
    $('ruleCategory').innerHTML = options;
  }

  function openRuleModal({ categoryId = null, rule = null } = {}) {
    const categories = orderedCategories(ctx.getDocument());
    if (categories.length === 0) {
      window.alert('请先添加至少一个类别！');
      return;
    }
    editingRuleId = rule?.id ?? null;
    $('ruleModalTitle').textContent = rule ? '修改具体事项' : '新增具体事项';
    $('ruleVersionHint').classList.toggle('hidden', !rule);
    renderRuleCategoryOptions(categoryId ?? (rule ? currentCategoryId(rule, ctx.today()) : null) ?? categories[0].id);
    $('ruleName').value = rule ? nameAt(rule, ctx.today()) : '';
    $('rulePoints').value = rule ? pointsAt(rule, ctx.today()) : '';
    overlayOpen('ruleModal', () => $('ruleModal').classList.add('hidden'));
  }

  $('ruleSaveBtn').addEventListener('click', () => {
    const categoryId = $('ruleCategory').value;
    const name = $('ruleName').value.trim();
    const points = Number.parseInt($('rulePoints').value, 10);
    if (!name || Number.isNaN(points)) {
      window.alert('请填写完整描述和积分分值！');
      return;
    }

    const today = ctx.today();
    if (editingRuleId) {
      const before = pointsAt(ctx.getDocument().rules.find((r) => r.id === editingRuleId), today);
      let changed = false;
      ctx.mutate((draft) => {
        changed = updateRule(draft, editingRuleId, { name, categoryId, points }, { today }).changed;
      });
      if (changed && before !== points) {
        toast('分值已更新：今天及以后使用新分值，历史记录保持原分值', 'success');
      } else if (changed) {
        toast('事项已更新', 'success');
      }
    } else {
      ctx.mutate((draft) => createRule(draft, { name, categoryId, points }, { today }));
      toast('事项已添加', 'success');
    }
    ctx.refreshAll();
    overlayClose('ruleModal');
  });
  $('ruleCancelBtn').addEventListener('click', () => overlayClose('ruleModal'));

  /* ---------- 兑换方案 ---------- */

  function openRewardModal(reward = null) {
    editingRewardId = reward?.id ?? null;
    $('rewardModalTitle').textContent = reward ? '修改兑换方案' : '新增兑换方案';
    $('rewardVersionHint').classList.toggle('hidden', !reward);
    if (reward) {
      const version = currentRewardVersion(reward, ctx.today());
      $('rewardCost').value = version?.cost ?? '';
      $('rewardText').value = version?.text ?? '';
      $('rewardRule').value = version?.ruleNote ?? '';
    } else {
      $('rewardCost').value = '';
      $('rewardText').value = '';
      $('rewardRule').value = '';
    }
    overlayOpen('rewardModal', () => $('rewardModal').classList.add('hidden'));
  }

  $('rewardSaveBtn').addEventListener('click', () => {
    const cost = Number($('rewardCost').value);
    const text = $('rewardText').value.trim();
    const ruleNote = $('rewardRule').value.trim();
    if (!Number.isSafeInteger(cost) || cost <= 0 || !text) {
      window.alert('请填写正整数积分与奖品内容');
      return;
    }
    const now = ctx.nowISO();
    if (editingRewardId) {
      let changed = false;
      ctx.mutate((draft) => {
        changed = updateReward(draft, editingRewardId, { cost, text, ruleNote }, { today: ctx.today(), now }).changed;
      });
      if (changed) toast('已生成新方案版本，历史兑换记录不受影响', 'success');
    } else {
      ctx.mutate((draft) => createReward(draft, { cost, text, ruleNote }, { now }));
      toast('方案已添加', 'success');
    }
    ctx.refreshAll();
    overlayClose('rewardModal');
  });
  $('rewardCancelBtn').addEventListener('click', () => overlayClose('rewardModal'));

  /* ---------- 云端配置 ---------- */

  $('syncConfigOpenBtn').addEventListener('click', () => {
    const creds = ctx.store.getCredentials();
    $('cfgBinId').value = creds.binId;
    $('cfgApiKey').value = creds.apiKey;
    overlayOpen('syncConfigModal', () => $('syncConfigModal').classList.add('hidden'));
  });
  $('syncConfigCancelBtn').addEventListener('click', () => overlayClose('syncConfigModal'));
  $('syncConfigSaveBtn').addEventListener('click', () => {
    const binId = $('cfgBinId').value.trim();
    const apiKey = $('cfgApiKey').value.trim();
    if (!binId !== !apiKey) {
      window.alert('Bin ID 与密钥需要同时填写，或同时留空切换回本地模式');
      return;
    }
    if (binId && apiKey) {
      const existing = ctx.store.getCredentials();
      // 密钥变化时清除记住的请求头，避免沿用失效的 Master/Access 提示
      ctx.store.setCredentials({
        binId,
        apiKey,
        keyHeader: apiKey === existing.apiKey ? existing.keyHeader : null
      });
    } else {
      ctx.store.clearCredentials();
    }
    ctx.refreshHeader();
    overlayClose('syncConfigModal');
    toast(binId ? '云端配置已保存到本机，点顶部「同步」即可上传' : '已切换为本地模式', 'success');
  });
  $('syncConfigClearBtn').addEventListener('click', () => {
    if (!window.confirm('确定清除本机的云端配置吗？（云端数据不受影响）')) return;
    ctx.store.clearCredentials();
    ctx.refreshHeader();
    overlayClose('syncConfigModal');
    toast('已清除云端配置，切换为本地模式', 'success');
  });

  return { openCategoryModal, openRuleModal, openRewardModal };
}

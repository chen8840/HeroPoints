import defaults from '../data/defaults.js';

export const SCHEMA_VERSION = 1;

export function newId(prefix) {
  const uuid =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${uuid}`;
}

export function createDefaultDocument() {
  return {
    schemaVersion: SCHEMA_VERSION,
    familyId: newId('family'),
    categories: defaults.categories.map((c, index) => ({ ...c, order: index })),
    rules: defaults.rules.map((r, index) => ({
      id: r.id,
      deletedAt: null,
      order: index,
      versions: r.versions.map((v) => ({ ...v }))
    })),
    dailyScores: [],
    rewards: defaults.rewards.map((r) => ({ id: r.id, deletedAt: null, versions: r.versions.map((v) => ({ ...v })) })),
    redemptions: [],
    documentRevision: 0
  };
}

export const DEFAULT_NOTES = defaults.notes;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export class InvalidDocumentError extends Error {}

function requireArray(raw, field) {
  if (!Array.isArray(raw[field])) throw new InvalidDocumentError(`字段 ${field} 缺失或不是数组`);
  return raw[field];
}

function normalizeRuleVersion(v) {
  if (!isPlainObject(v) || typeof v.name !== 'string' || typeof v.points !== 'number') {
    throw new InvalidDocumentError('规则版本数据不完整');
  }
  const effectiveDate = v.effectiveDate ?? null;
  if (effectiveDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    throw new InvalidDocumentError(`规则生效日期非法: ${effectiveDate}`);
  }
  return { effectiveDate, name: v.name, categoryId: v.categoryId ?? null, points: v.points };
}

export function requirePositiveCost(cost) {
  if (!Number.isSafeInteger(cost) || cost <= 0) throw new InvalidDocumentError('兑换积分必须为正整数');
  return cost;
}

function normalizeRewardVersion(v) {
  if (!isPlainObject(v) || typeof v.cost !== 'number' || typeof v.text !== 'string') {
    throw new InvalidDocumentError('兑换方案版本数据不完整');
  }
  if (typeof v.id !== 'string' || !v.id) throw new InvalidDocumentError('兑换方案版本缺少 id');
  return {
    id: v.id,
    effectiveDate: v.effectiveDate ?? null,
    cost: requirePositiveCost(v.cost),
    text: v.text,
    ruleNote: typeof v.ruleNote === 'string' ? v.ruleNote : '',
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : v.effectiveDate ? `${v.effectiveDate}T00:00:00.000Z` : '1970-01-01T00:00:00.000Z'
  };
}

export function normalizeScore(raw) {
  if (!isPlainObject(raw) || typeof raw.date !== 'string' || typeof raw.ruleId !== 'string') {
    throw new InvalidDocumentError('打分记录缺少日期或规则');
  }
  return {
    date: raw.date,
    ruleId: raw.ruleId,
    checked: raw.checked !== false,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
    deviceId: typeof raw.deviceId === 'string' ? raw.deviceId : 'unknown'
  };
}

export function normalizeRedemption(raw) {
  if (!isPlainObject(raw) || typeof raw.id !== 'string') {
    throw new InvalidDocumentError('兑换记录缺少 id');
  }
  return {
    id: raw.id,
    rewardId: raw.rewardId ?? null,
    rewardVersionId: raw.rewardVersionId ?? null,
    date: typeof raw.date === 'string' ? raw.date : '',
    status: raw.status === 'refunded' ? 'refunded' : 'redeemed',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
    deviceId: typeof raw.deviceId === 'string' ? raw.deviceId : 'unknown'
  };
}

/**
 * 校验并规范化共享业务文档。本机配置、同步标记不属于文档。
 * 传入无法识别的数据时抛出 InvalidDocumentError，调用方负责提示用户而不是静默重置。
 */
export function normalizeDocument(raw) {
  if (!isPlainObject(raw)) throw new InvalidDocumentError('数据不是合法的 JSON 对象');

  const doc = {
    schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : SCHEMA_VERSION,
    familyId: typeof raw.familyId === 'string' && raw.familyId ? raw.familyId : null,
    categories: requireArray(raw, 'categories').map((c, index) => {
      if (!isPlainObject(c) || typeof c.id !== 'string' || typeof c.name !== 'string') {
        throw new InvalidDocumentError('类别数据不完整');
      }
      return {
        id: c.id,
        name: c.name,
        color: typeof c.color === 'string' ? c.color : '#64748b',
        deletedAt: c.deletedAt ?? null,
        order: typeof c.order === 'number' && Number.isFinite(c.order) ? c.order : index
      };
    }),
    rules: requireArray(raw, 'rules').map((r, index) => {
      if (!isPlainObject(r) || typeof r.id !== 'string' || !Array.isArray(r.versions) || r.versions.length === 0) {
        throw new InvalidDocumentError('规则数据不完整');
      }
      return {
        id: r.id,
        deletedAt: r.deletedAt ?? null,
        order: typeof r.order === 'number' && Number.isFinite(r.order) ? r.order : index,
        versions: r.versions.map(normalizeRuleVersion)
      };
    }),
    dailyScores: requireArray(raw, 'dailyScores').map(normalizeScore),
    rewards: requireArray(raw, 'rewards').map((r) => {
      if (!isPlainObject(r) || typeof r.id !== 'string' || !Array.isArray(r.versions) || r.versions.length === 0) {
        throw new InvalidDocumentError('兑换方案数据不完整');
      }
      return { id: r.id, deletedAt: r.deletedAt ?? null, versions: r.versions.map(normalizeRewardVersion) };
    }),
    redemptions: requireArray(raw, 'redemptions').map(normalizeRedemption),
    documentRevision: typeof raw.documentRevision === 'number' ? raw.documentRevision : 0
  };

  if (doc.schemaVersion > SCHEMA_VERSION) {
    throw new InvalidDocumentError(`数据版本(${doc.schemaVersion})高于当前应用支持版本(${SCHEMA_VERSION})，请先更新应用`);
  }
  return doc;
}

/** 是否迁移过旧版本 schema（当前仅 v1）。 */
export function migrateDocument(raw) {
  if (isPlainObject(raw) && typeof raw.schemaVersion === 'number' && raw.schemaVersion < SCHEMA_VERSION) {
    return { ...raw, schemaVersion: SCHEMA_VERSION };
  }
  return raw;
}

function sortRulesVersions(rules) {
  for (const rule of rules) {
    rule.versions.sort(compareRuleVersions);
  }
}

export function compareRuleVersions(a, b) {
  const ka = a.effectiveDate ?? '';
  const kb = b.effectiveDate ?? '';
  if (ka === kb) return 0;
  return ka < kb ? -1 : 1;
}

export function compareRewardVersions(a, b) {
  const ea = a.effectiveDate ?? '';
  const eb = b.effectiveDate ?? '';
  if (ea !== eb) return ea < eb ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/** 类别／事项的展示顺序：order 小的在前，缺失时排最后，同序按 id 兜底。 */
export function compareByOrder(a, b) {
  const ao = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
  const bo = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortByOrder(items) {
  return [...items].sort(compareByOrder);
}

export function sortDocumentCollections(doc) {
  sortRulesVersions(doc.rules);
  doc.rewards.forEach((r) => r.versions.sort(compareRewardVersions));
  doc.categories.sort(compareByOrder);
  doc.rules.sort(compareByOrder);
  doc.rewards.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  doc.dailyScores.sort((a, b) => (a.date === b.date ? (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0) : a.date < b.date ? -1 : 1));
  doc.redemptions.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return doc;
}

/** 判断业务数据是否一致（忽略 documentRevision 等本机/同步标记）。 */
export function businessFingerprint(doc) {
  const normalized = normalizeDocument(JSON.parse(JSON.stringify(doc)));
  sortDocumentCollections(normalized);
  const { documentRevision, ...rest } = normalized;
  return JSON.stringify(rest);
}

export function documentsEqual(a, b) {
  return businessFingerprint(a) === businessFingerprint(b);
}

export function cloneDocument(doc) {
  return JSON.parse(JSON.stringify(doc));
}

/* ---------------- 记录级编辑辅助 ---------------- */

export function findRule(doc, ruleId) {
  return doc.rules.find((r) => r.id === ruleId) ?? null;
}

export function findCategory(doc, categoryId) {
  return doc.categories.find((c) => c.id === categoryId) ?? null;
}

export function findReward(doc, rewardId) {
  return doc.rewards.find((r) => r.id === rewardId) ?? null;
}

export function activeCategories(doc) {
  return doc.categories.filter((c) => !c.deletedAt);
}

export function orderedCategories(doc) {
  return sortByOrder(activeCategories(doc));
}

export function activeRules(doc) {
  return doc.rules.filter((r) => !r.deletedAt);
}

export function activeRewards(doc) {
  return doc.rewards.filter((r) => !r.deletedAt);
}

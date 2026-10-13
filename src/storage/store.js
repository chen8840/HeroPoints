import {
  createDefaultDocument,
  normalizeDocument,
  migrateDocument,
  cloneDocument,
  documentsEqual,
  InvalidDocumentError
} from '../domain/model.js';
import { todayLocal } from '../lib/date.js';

export const STORAGE_KEYS = {
  document: 'heroxp.document.v1',
  meta: 'heroxp.syncMeta.v1',
  credentials: 'heroxp.credentials.v1',
  deviceId: 'heroxp.deviceId.v1',
  legacy: 'HERO_XP_DATA'
};

export class StorageFullError extends Error {
  constructor() {
    super('本机存储空间不足');
  }
}

export class CorruptedDataError extends Error {
  constructor(raw) {
    super('本机保存的数据已损坏');
    this.raw = raw;
  }
}

export function createStore({ storage = globalThis.localStorage, now = () => new Date() } = {}) {
  let document = null;

  const readJSON = (key) => {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    return { raw, value: JSON.parse(raw) };
  };

  function saveDocument(next) {
    const previous = document;
    document = next;
    try {
      storage.setItem(STORAGE_KEYS.document, JSON.stringify(next));
    } catch (err) {
      document = previous;
      if (err && (err.name === 'QuotaExceededError' || err.code === 22)) throw new StorageFullError();
      throw err;
    }
  }

  function load() {
    let parsed;
    try {
      parsed = readJSON(STORAGE_KEYS.document);
    } catch {
      const raw = storage.getItem(STORAGE_KEYS.document);
      return { status: 'corrupted', raw: raw ?? '' };
    }

    if (parsed !== null) {
      try {
        document = normalizeDocument(migrateDocument(parsed.value));
        ensureMetaInitialized();
        return { status: 'ok', document };
      } catch (err) {
        if (err instanceof InvalidDocumentError) {
          return { status: 'corrupted', raw: parsed.raw };
        }
        throw err;
      }
    }

    const legacy = migrateLegacyData();
    if (legacy) {
      document = legacy.document;
      persistFresh();
      if (legacy.credentials) setCredentials(legacy.credentials);
      return { status: 'ok', document, migratedFromLegacy: true };
    }

    document = createDefaultDocument();
    persistFresh();
    return { status: 'ok', document };
  }

  function persistFresh() {
    storage.setItem(STORAGE_KEYS.document, JSON.stringify(document));
    const meta = getMeta();
    if (!meta.baselineDocument) {
      // 基线在首次载入时确立：此后与基线的差异即为“待同步修改”。
      setMeta({ baselineDocument: cloneDocument(document) });
    }
  }

  function ensureMetaInitialized() {
    const meta = getMeta();
    if (!meta.baselineDocument) setMeta({ baselineDocument: cloneDocument(document) });
  }

  /** 原型 HERO_XP_DATA 数据迁移：按名称匹配到默认规则/类别，保留历史打分与兑换记录。 */
  function migrateLegacyData() {
    const raw = storage.getItem(STORAGE_KEYS.legacy);
    if (!raw) return null;
    let legacy;
    try {
      legacy = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!legacy || !Array.isArray(legacy.rules) || !Array.isArray(legacy.categories)) return null;

    const doc = createDefaultDocument();
    const normalizeName = (s) =>
      String(s ?? '')
        .replace(/[\s,，、;；:：]/g, '')
        .replace(/[(（]/g, '(')
        .replace(/[)）]/g, ')');
    const matchByName = (candidates, name, used) => {
      const target = normalizeName(name);
      if (!target) return null;
      const exact = candidates.find((c) => !used.has(c.id) && normalizeName(c.name) === target);
      if (exact) return exact;
      return (
        candidates.find(
          (c) =>
            !used.has(c.id) &&
            target.length >= 4 &&
            (normalizeName(c.name).includes(target) || target.includes(normalizeName(c.name)))
        ) ?? null
      );
    };

    const categoryIdByName = new Map();
    const defaultCategories = doc.categories;
    const usedCategoryIds = new Set();
    (legacy.categories ?? []).forEach((cat, index) => {
      const name = typeof cat === 'string' ? cat : cat?.name;
      if (!name) return;
      const matched = matchByName(defaultCategories, name, usedCategoryIds);
      if (matched) {
        usedCategoryIds.add(matched.id);
        categoryIdByName.set(name, matched.id);
      } else {
        const id = `cat-legacy-${index + 1}`;
        if (!doc.categories.some((c) => c.id === id)) {
          doc.categories.push({ id, name, color: (typeof cat === 'object' && cat?.color) || '#64748b', deletedAt: null });
        }
        categoryIdByName.set(name, id);
      }
    });

    const ruleIdMap = new Map();
    const usedRuleIds = new Set();
    const legacyRules = (legacy.rules ?? []).filter((r) => r && r.name && typeof r.points === 'number');
    legacyRules.forEach((rule) => {
      const matched = matchByName(doc.rules.map((r) => ({ id: r.id, name: r.versions[0].name })), rule.name, usedRuleIds);
      if (matched) {
        usedRuleIds.add(matched.id);
        const existing = doc.rules.find((r) => r.id === matched.id);
        // 名称匹配只复用稳定 ID；旧原型的实际配置才是迁移后的基准。
        existing.versions = [{
          effectiveDate: null,
          name: rule.name,
          categoryId: categoryIdByName.get(rule.category) ?? existing.versions[0].categoryId,
          points: rule.points
        }];
        ruleIdMap.set(rule.id, matched.id);
        return;
      }
      const id = `rule-legacy-${String(rule.id).replace(/[^0-9a-zA-Z-]/g, '') || doc.rules.length + 1}`;
      const categoryId = categoryIdByName.get(rule.category) ?? doc.categories[0]?.id ?? null;
      if (!doc.rules.some((r) => r.id === id)) {
        doc.rules.push({ id, deletedAt: null, versions: [{ effectiveDate: null, name: rule.name, categoryId, points: rule.points }] });
      }
      ruleIdMap.set(rule.id, id);
    });

    const migratedAt = now().toISOString();
    Object.entries(legacy.dailyLogs ?? {}).forEach(([date, ids]) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(ids)) return;
      for (const oldId of new Set(ids)) {
        const ruleId = ruleIdMap.get(oldId);
        if (!ruleId) continue;
        doc.dailyScores.push({ date, ruleId, checked: true, updatedAt: migratedAt, deviceId: getDeviceId() });
      }
    });

    const defaultRewards = doc.rewards.map((r) => ({ id: r.id, text: r.versions[0].text }));
    (legacy.redeemLogs ?? []).forEach((log, index) => {
      if (!log || typeof log.cost !== 'number') return;
      const matched = matchByName(defaultRewards, String(log.name ?? '').replace(/\//g, ''), new Set());
      let rewardId = matched?.id ?? null;
      let versionId = null;
      const text = String(log.name ?? '历史兑换');
      if (matched) {
        const reward = doc.rewards.find((r) => r.id === matched.id);
        let historical = reward.versions.find((v) => v.cost === log.cost && v.text === text);
        if (!historical) {
          historical = {
            id: `${rewardId}-legacy-v${index + 1}`,
            effectiveDate: null,
            cost: log.cost,
            text,
            ruleNote: '',
            // 历史记录按版本 ID 引用；排序早于当前基准，不能取代在售方案。
            createdAt: '0001-01-01T00:00:00.000Z'
          };
          reward.versions.unshift(historical);
        }
        versionId = historical.id;
      }
      if (!rewardId) {
        rewardId = `reward-legacy-${index + 1}`;
        versionId = `${rewardId}-v1`;
        doc.rewards.push({
          id: rewardId,
          deletedAt: migratedAt,
          versions: [{ id: versionId, effectiveDate: null, cost: log.cost, text: String(log.name ?? '历史兑换'), ruleNote: '', createdAt: migratedAt }]
        });
      }
      doc.redemptions.push({
        id: `redemption-legacy-${log.id ?? index + 1}`,
        rewardId,
        rewardVersionId: versionId,
        date: typeof log.date === 'string' ? log.date : todayLocal(now()),
        status: 'redeemed',
        updatedAt: migratedAt,
        deviceId: getDeviceId()
      });
    });

    const credentials =
      legacy.syncConfig && legacy.syncConfig.binId && legacy.syncConfig.apiKey
        ? { binId: String(legacy.syncConfig.binId), apiKey: String(legacy.syncConfig.apiKey) }
        : null;

    return { document: normalizeDocument(doc), credentials };
  }

  const getDocument = () => document;

  function mutate(fn) {
    const draft = cloneDocument(document);
    const result = fn(draft);
    draft.documentRevision = (draft.documentRevision ?? 0) + 1;
    saveDocument(draft);
    return result;
  }

  function setDocument(next, { markSynced = false } = {}) {
    const normalized = normalizeDocument(cloneDocument(next));
    saveDocument(normalized);
    if (markSynced) {
      setMeta({
        lastSuccessfulCheckDate: todayLocal(now()),
        lastSuccessfulSyncAt: now().toISOString(),
        baselineDocument: cloneDocument(normalized)
      });
    }
    return normalized;
  }

  function markChecked({ baselineDocument = null } = {}) {
    setMeta({
      lastSuccessfulCheckDate: todayLocal(now()),
      lastSuccessfulSyncAt: now().toISOString(),
      ...(baselineDocument ? { baselineDocument: cloneDocument(baselineDocument) } : {})
    });
  }

  function getMeta() {
    try {
      const parsed = readJSON(STORAGE_KEYS.meta);
      const meta = parsed?.value ?? {};
      return {
        lastSuccessfulCheckDate: meta.lastSuccessfulCheckDate ?? null,
        lastSuccessfulSyncAt: meta.lastSuccessfulSyncAt ?? null,
        baselineDocument: meta.baselineDocument ?? null,
        manualSyncUsage: {
          date: typeof meta.manualSyncUsage?.date === 'string' ? meta.manualSyncUsage.date : null,
          count: typeof meta.manualSyncUsage?.count === 'number' ? meta.manualSyncUsage.count : 0
        }
      };
    } catch {
      return {
        lastSuccessfulCheckDate: null,
        lastSuccessfulSyncAt: null,
        baselineDocument: null,
        manualSyncUsage: { date: null, count: 0 }
      };
    }
  }

  function setMeta(partial) {
    const meta = { ...getMeta(), ...partial };
    storage.setItem(STORAGE_KEYS.meta, JSON.stringify(meta));
    return meta;
  }

  /** 当天手动同步已用次数。 */
  function getManualSyncUsage() {
    return getMeta().manualSyncUsage;
  }

  /** 记录一次手动同步（按本地日期累计，跨天自动从 1 重新计）。 */
  function recordManualSync(date) {
    const usage = getManualSyncUsage();
    const count = (usage.date === date ? usage.count : 0) + 1;
    setMeta({ manualSyncUsage: { date, count } });
    return { date, count };
  }

  function getCredentials() {
    try {
      const parsed = readJSON(STORAGE_KEYS.credentials);
      const creds = parsed?.value ?? {};
      return { binId: creds.binId ?? '', apiKey: creds.apiKey ?? '', keyHeader: creds.keyHeader ?? null };
    } catch {
      return { binId: '', apiKey: '', keyHeader: null };
    }
  }

  function setCredentials({ binId, apiKey, keyHeader = null }) {
    storage.setItem(
      STORAGE_KEYS.credentials,
      JSON.stringify({ binId: binId ?? '', apiKey: apiKey ?? '', keyHeader: keyHeader ?? null })
    );
  }

  function clearCredentials() {
    storage.removeItem(STORAGE_KEYS.credentials);
  }

  function getDeviceId() {
    let id = storage.getItem(STORAGE_KEYS.deviceId);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      storage.setItem(STORAGE_KEYS.deviceId, id);
    }
    return id;
  }

  function hasPendingChanges() {
    const meta = getMeta();
    if (!meta.baselineDocument) return false;
    return !documentsEqual(document, meta.baselineDocument);
  }

  function resetToDefaults() {
    document = createDefaultDocument();
    saveDocument(document);
    setMeta({ baselineDocument: cloneDocument(document) });
    return document;
  }

  return {
    load,
    getDocument,
    setDocument,
    mutate,
    markChecked,
    getMeta,
    setMeta,
    getManualSyncUsage,
    recordManualSync,
    getCredentials,
    setCredentials,
    clearCredentials,
    getDeviceId,
    hasPendingChanges,
    resetToDefaults
  };
}

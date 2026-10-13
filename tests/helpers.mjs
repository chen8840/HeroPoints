export function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
    _map: map
  };
}

export function makeDoc({
  familyId = 'family-test',
  categories = [],
  rules = [],
  dailyScores = [],
  rewards = [],
  redemptions = [],
  documentRevision = 1
} = {}) {
  return {
    schemaVersion: 1,
    familyId,
    categories,
    rules,
    dailyScores,
    rewards,
    redemptions,
    documentRevision
  };
}

export const cat = (id, name, deletedAt = null, order) => ({
  id,
  name,
  color: '#10b981',
  deletedAt,
  ...(order === undefined ? {} : { order })
});

export const rule = (id, name, points, effectiveDate = null, deletedAt = null, order) => ({
  id,
  deletedAt,
  ...(order === undefined ? {} : { order }),
  versions: [{ effectiveDate, name, categoryId: 'cat-1', points }]
});

export const score = (date, ruleId, checked, updatedAt, deviceId = 'device-a') => ({
  date,
  ruleId,
  checked,
  updatedAt,
  deviceId
});

export const reward = (id, versionId, cost, text, effectiveDate = null, deletedAt = null) => ({
  id,
  deletedAt,
  versions: [{ id: versionId, effectiveDate, cost, text, ruleNote: '', createdAt: '2026-01-01T00:00:00.000Z' }]
});

export const redemption = (id, rewardId, rewardVersionId, date, status = 'redeemed', updatedAt = '2026-01-01T00:00:00.000Z', deviceId = 'device-a') => ({
  id,
  rewardId,
  rewardVersionId,
  date,
  status,
  updatedAt,
  deviceId
});

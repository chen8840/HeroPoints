import {
  normalizeDocument,
  cloneDocument,
  compareRuleVersions,
  compareRewardVersions,
  sortDocumentCollections
} from './model.js';

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

const equal = (a, b) => stableStringify(a ?? null) === stableStringify(b ?? null);

const mapBy = (list, keyOf) => new Map((list ?? []).map((item) => [keyOf(item), item]));
const baseKey = (v) => (v === null || v === undefined ? '' : String(v));

function unionKeys(...maps) {
  const keys = new Set();
  for (const map of maps) for (const key of map.keys()) keys.add(key);
  return [...keys].sort();
}

/**
 * 三方合并：base(上次成功同步基线,可为 null)、local(本机)、remote(云端)。
 * 返回 { document, conflicts }。conflicts 非空时 document 中冲突位置暂用本机值占位，
 * 必须由用户选择后经 resolveConflicts 得到最终文档，且在此之前不得写回云端。
 */
export function mergeDocuments({ base, local, remote }) {
  const B = base ? normalizeDocument(cloneDocument(base)) : null;
  const L = normalizeDocument(cloneDocument(local));
  const R = normalizeDocument(cloneDocument(remote));
  const conflicts = [];

  const out = {
    schemaVersion: Math.max(L.schemaVersion, R.schemaVersion),
    familyId: mergeFamilyId(B, L, R),
    categories: [],
    rules: [],
    dailyScores: [],
    rewards: [],
    redemptions: [],
    documentRevision: Math.max(L.documentRevision || 0, R.documentRevision || 0)
  };

  mergeKeyedRecords({
    listName: '类别',
    entity: 'category',
    outList: out.categories,
    base: B?.categories ?? [],
    local: L.categories,
    remote: R.categories,
    conflicts,
    labelOf: (c) => `类别「${c.name}」`,
    subMerge: (b, l, r) => mergeCategoryRecord({ base: b, local: l, remote: r, conflicts })
  });

  mergeKeyedRecords({
    listName: '事项',
    entity: 'rule',
    outList: out.rules,
    base: B?.rules ?? [],
    local: L.rules,
    remote: R.rules,
    conflicts,
    labelOf: (r) => `事项「${ruleLabel(r)}」`,
    subMerge: (b, l, r) => mergeRuleRecord({ base: b, local: l, remote: r, conflicts })
  });

  mergeKeyedRecords({
    listName: '兑换方案',
    entity: 'reward',
    outList: out.rewards,
    base: B?.rewards ?? [],
    local: L.rewards,
    remote: R.rewards,
    conflicts,
    labelOf: (rw) => `兑换方案 ${rewardLabel(rw)}`,
    subMerge: (b, l, r) => mergeRewardRecord({ base: b, local: l, remote: r, conflicts })
  });

  mergeStateRecords({ base: B?.dailyScores ?? [], local: L.dailyScores, remote: R.dailyScores, out: out.dailyScores, conflicts, entity: 'score', keyOf: (s) => `${s.date}|${s.ruleId}` });
  mergeStateRecords({ base: B?.redemptions ?? [], local: L.redemptions, remote: R.redemptions, out: out.redemptions, conflicts, entity: 'redemption', keyOf: (s) => s.id });

  const document = sortDocumentCollections(normalizeDocument(out));
  return { document, conflicts };
}

export function hasConflicts(result) {
  return result.conflicts.length > 0;
}

/** 应用用户对冲突的选择（choices[i] 与 conflicts[i] 对应，取值 'local' | 'remote'）。 */
export function resolveConflicts(result, choices) {
  const doc = cloneDocument(result.document);
  result.conflicts.forEach((conflict, index) => {
    const choice = choices[index] ?? 'local';
    const value = choice === 'remote' ? conflict.remote : conflict.local;
    switch (conflict.entity) {
      case 'score':
        upsertByKey(doc.dailyScores, (s) => `${s.date}|${s.ruleId}`, conflict.entityId, value);
        break;
      case 'redemption':
        upsertByKey(doc.redemptions, 'id', conflict.entityId, value);
        break;
      case 'category':
        upsertByKey(doc.categories, 'id', conflict.entityId, value);
        break;
      case 'rule':
        upsertByKey(doc.rules, 'id', conflict.entityId, value);
        break;
      case 'reward':
        upsertByKey(doc.rewards, 'id', conflict.entityId, value);
        break;
      case 'ruleVersion': {
        const rule = doc.rules.find((item) => item.id === conflict.entityId);
        if (rule) upsertByKey(rule.versions, (v) => baseKey(v.effectiveDate), conflict.versionKey, value);
        break;
      }
      case 'rewardVersion': {
        const reward = doc.rewards.find((item) => item.id === conflict.entityId);
        if (reward) upsertByKey(reward.versions, 'id', conflict.versionKey, value);
        break;
      }
      default:
        break;
    }
  });
  return sortDocumentCollections(normalizeDocument(doc));
}

function upsertByKey(list, keyOf, key, value) {
  const getKey = typeof keyOf === 'function' ? keyOf : (item) => item[keyOf];
  const index = list.findIndex((item) => getKey(item) === key);
  if (value === null || value === undefined) {
    if (index >= 0) list.splice(index, 1);
    return;
  }
  if (index >= 0) list[index] = value;
  else list.push(value);
}

function mergeFamilyId(B, L, R) {
  if (!B) return R.familyId || L.familyId; // 首次连接：以远端为准，远端为空则用本机
  if (equal(L.familyId, B.familyId)) return R.familyId || L.familyId;
  if (equal(R.familyId, B.familyId)) return L.familyId || R.familyId;
  return R.familyId || L.familyId;
}

function mergeKeyedRecords({ entity, outList, base, local, remote, conflicts, labelOf, subMerge }) {
  const baseMap = mapBy(base, (x) => x.id);
  const localMap = mapBy(local, (x) => x.id);
  const remoteMap = mapBy(remote, (x) => x.id);

  for (const key of unionKeys(baseMap, localMap, remoteMap)) {
    const b = baseMap.get(key) ?? null;
    const l = localMap.get(key) ?? null;
    const r = remoteMap.get(key) ?? null;

    const pushConflict = (localValue, remoteValue) => {
      conflicts.push({
        id: `${entity}:${key}`,
        entity,
        entityId: key,
        versionKey: null,
        label: labelOf(l ?? r ?? b),
        local: localValue,
        remote: remoteValue
      });
      return { value: localValue };
    };

    let result;
    if (equal(l, r)) result = { value: r };
    else if (l === null) {
      if (b === null) result = { value: r };
      else if (equal(r, b)) result = { value: null };
      else result = pushConflict(l, r);
    } else if (r === null) {
      if (b === null) result = { value: l };
      else if (equal(l, b)) result = { value: null };
      else result = pushConflict(l, r);
    } else if (b === null) {
      result = subMerge ? subMerge(null, l, r) : pushConflict(l, r);
    } else if (equal(l, b)) {
      result = { value: r };
    } else if (equal(r, b)) {
      result = { value: l };
    } else {
      result = subMerge ? subMerge(b, l, r) : pushConflict(l, r);
    }

    if (result.value) outList.push(result.value);
  }
}

function ruleLabel(rule) {
  const version = [...rule.versions].sort(compareRuleVersions).pop();
  return version?.name ?? rule.id;
}

function rewardLabel(reward) {
  const version = [...reward.versions].sort(compareRewardVersions).pop();
  return version ? `${version.cost} 积分：${version.text.split('\n')[0]}` : reward.id;
}

/**
 * 合并规则/兑换方案记录的删除状态与版本列表。
 * 一侧删除、另一侧修改同一条记录时必须冲突提示，不静默取舍。
 */
function mergeRecordWithVersions({ base, local, remote, conflicts, entity, labelOf, mergeVersions }) {
  const bd = base?.deletedAt ?? null;
  const ld = local.deletedAt ?? null;
  const rd = remote.deletedAt ?? null;

  const pushConflict = () => {
    conflicts.push({
      id: `${entity}:${local.id}`,
      entity,
      entityId: local.id,
      versionKey: null,
      label: `${labelOf(local)}（一侧删除、另一侧修改）`,
      local,
      remote
    });
  };

  let deletedAt;
  if (equal(ld, rd)) {
    deletedAt = ld;
  } else if (base && equal(ld, bd)) {
    deletedAt = rd;
    if (rd !== null && !equal(local.versions, base.versions)) {
      pushConflict();
      return { value: local };
    }
  } else if (base && equal(rd, bd)) {
    deletedAt = ld;
    if (ld !== null && !equal(remote.versions, base.versions)) {
      pushConflict();
      return { value: local };
    }
  } else {
    pushConflict();
    return { value: local };
  }

  const versions = mergeVersions(base?.versions ?? null, local.versions, remote.versions);
  return { value: { id: local.id, deletedAt, versions } };
}

/**
 * 合并排序字段：只有一侧调整顺序时采用该侧；两侧都调整且不同时按本机为准。
 * 排序只是展示顺序，不为它打断家长做冲突选择。
 */
function mergeOrderField(baseOrder, localOrder, remoteOrder) {
  if (localOrder === remoteOrder) return localOrder;
  if (baseOrder !== undefined && localOrder === baseOrder) return remoteOrder;
  if (baseOrder !== undefined && remoteOrder === baseOrder) return localOrder;
  return localOrder;
}

function mergeCategoryRecord({ base, local, remote, conflicts }) {
  const order = mergeOrderField(base?.order, local.order, remote.order);
  const restOf = (category) => ({ name: category.name, color: category.color, deletedAt: category.deletedAt ?? null });
  const bRest = base ? restOf(base) : null;
  const lRest = restOf(local);
  const rRest = restOf(remote);

  if (equal(lRest, rRest)) return { value: { id: local.id, order, ...lRest } };
  if (bRest && equal(lRest, bRest)) return { value: { id: local.id, order, ...rRest } };
  if (bRest && equal(rRest, bRest)) return { value: { id: local.id, order, ...lRest } };

  conflicts.push({
    id: `category:${local.id}`,
    entity: 'category',
    entityId: local.id,
    versionKey: null,
    label: `类别「${local.name}」`,
    local,
    remote
  });
  return { value: local };
}

function mergeRuleRecord({ base, local, remote, conflicts }) {
  const merged = mergeRecordWithVersions({
    base,
    local,
    remote,
    conflicts,
    entity: 'rule',
    labelOf: (rule) => `事项「${ruleLabel(rule)}」`,
    mergeVersions: (b, l, r) =>
      mergeVersionList({
        entity: 'ruleVersion',
        entityId: local.id,
        base: b,
        local: l,
        remote: r,
        conflicts,
        keyOf: (v) => baseKey(v.effectiveDate),
        labelOf: (v, key) => `事项「${ruleLabel(local)}」${key === '' ? '的初始分值' : `自 ${key} 起的分值`}`,
        describe: (v) => (v === null ? '（无此版本）' : `${v.name}：${v.points > 0 ? '+' : ''}${v.points} 分`)
      })
  });
  if (merged.value !== local) {
    return { value: { ...merged.value, order: mergeOrderField(base?.order, local.order, remote.order) } };
  }
  return merged;
}

function mergeRewardRecord({ base, local, remote, conflicts }) {
  return mergeRecordWithVersions({
    base,
    local,
    remote,
    conflicts,
    entity: 'reward',
    labelOf: (reward) => `兑换方案「${rewardLabel(reward)}」`,
    mergeVersions: (b, l, r) =>
      mergeVersionList({
        entity: 'rewardVersion',
        entityId: local.id,
        base: b,
        local: l,
        remote: r,
        conflicts,
        keyOf: (v) => v.id,
        labelOf: (v) => `兑换方案「${rewardLabel(local)}」版本 ${v === null ? '' : v.id}`,
        describe: (v) =>
          v === null ? '（无此版本）' : `${v.cost} 积分：${v.text.split('\n')[0]}${v.ruleNote ? `（${v.ruleNote}）` : ''}`
      })
  });
}

function mergeVersionList({ entity, entityId, base, local, remote, conflicts, keyOf, labelOf, describe }) {
  const baseMap = mapBy(base ?? [], keyOf);
  const localMap = mapBy(local, keyOf);
  const remoteMap = mapBy(remote, keyOf);
  const result = [];

  for (const key of unionKeys(baseMap, localMap, remoteMap)) {
    const b = baseMap.get(key) ?? null;
    const l = localMap.get(key) ?? null;
    const r = remoteMap.get(key) ?? null;

    const record = (value) => {
      if (value) result.push(value);
    };

    if (equal(l, r)) {
      record(r);
      continue;
    }
    if (l === null) {
      if (b === null) record(r); // 远端新增
      else if (equal(r, b)) continue; // 本机删除
      else {
        conflicts.push(makeVersionConflict(entity, entityId, key, labelOf(l ?? r, key), describe(l), describe(r), l, r));
      }
      continue;
    }
    if (r === null) {
      if (b === null) record(l);
      else if (equal(l, b)) continue; // 远端删除
      else {
        conflicts.push(makeVersionConflict(entity, entityId, key, labelOf(l, key), describe(l), describe(r), l, r));
      }
      continue;
    }
    if (b === null) {
      conflicts.push(makeVersionConflict(entity, entityId, key, labelOf(l, key), describe(l), describe(r), l, r));
      record(l);
      continue;
    }
    if (equal(l, b)) {
      record(r);
      continue;
    }
    if (equal(r, b)) {
      record(l);
      continue;
    }
    conflicts.push(makeVersionConflict(entity, entityId, key, labelOf(l, key), describe(l), describe(r), l, r));
    record(l);
  }

  return result.sort(entity === 'ruleVersion' ? compareRuleVersions : compareRewardVersions);
}

function makeVersionConflict(entity, entityId, versionKey, label, localDesc, remoteDesc, local, remote) {
  return { id: `${entity}:${entityId}:${versionKey}`, entity, entityId, versionKey, label, local, remote, localDesc, remoteDesc };
}

// Compare business state, not device clocks: metadata alone is not an edit.
function stateValue(record) {
  if (!record) return null;
  const { updatedAt, deviceId, ...business } = record;
  return business;
}

function mergeStateRecords({ base, local, remote, out, conflicts, entity, keyOf }) {
  const bm = mapBy(base, keyOf), lm = mapBy(local, keyOf), rm = mapBy(remote, keyOf);
  for (const key of unionKeys(bm, lm, rm)) {
    const b = bm.get(key) ?? null, l = lm.get(key) ?? null, r = rm.get(key) ?? null;
    const same = (a, c) => equal(stateValue(a), stateValue(c));
    let value;
    // Records use explicit cancellation/refund states; absence is not deletion.
    if (l === null) value = r;
    else if (r === null) value = l;
    else if (same(l, r)) value = l;
    else if (same(l, b)) value = r;
    else if (same(r, b)) value = l;
    else {
      conflicts.push({ id: `${entity}:${key}`, entity, entityId: key, label: `${entity === 'score' ? '打分' : '兑换记录'} ${key}`, local: l, remote: r });
      value = l;
    }
    if (value) out.push(value);
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDoc, cat, rule } from './helpers.mjs';
import { normalizeDocument, orderedCategories, sortByOrder } from '../src/domain/model.js';
import { createCategory, createRule, updateRule, moveCategory, moveRule } from '../src/domain/operations.js';
import { mergeDocuments } from '../src/domain/merge.js';
import { currentCategoryId } from '../src/domain/scoring.js';

const TODAY = '2026-10-15';

const rulesOf = (doc, categoryId, today = TODAY) =>
  sortByOrder(doc.rules.filter((r) => !r.deletedAt && currentCategoryId(r, today) === categoryId));

test('缺少 order 的旧数据按数组位置补齐', () => {
  const doc = makeDoc({
    categories: [cat('cat-1', 'A'), cat('cat-2', 'B')],
    rules: [rule('r1', 'R1', 1), rule('r2', 'R2', 2)]
  });
  const normalized = normalizeDocument(doc);
  assert.deepEqual(
    normalized.categories.map((c) => [c.id, c.order]),
    [
      ['cat-1', 0],
      ['cat-2', 1]
    ]
  );
  assert.deepEqual(
    normalized.rules.map((r) => [r.id, r.order]),
    [
      ['r1', 0],
      ['r2', 1]
    ]
  );
});

test('类别上移下移只调整被移动项，越界不动', () => {
  const doc = normalizeDocument(makeDoc({ categories: [cat('cat-1', 'A'), cat('cat-2', 'B'), cat('cat-3', 'C')] }));
  assert.equal(moveCategory(doc, 'cat-3', -1), true);
  assert.deepEqual(orderedCategories(doc).map((c) => c.id), ['cat-1', 'cat-3', 'cat-2']);
  assert.deepEqual(
    doc.categories.map((c) => [c.id, c.order]),
    [
      ['cat-1', 0],
      ['cat-2', 1],
      ['cat-3', 0.5]
    ],
    '仅被移动项取邻里中点，其他项序号保持不变'
  );
  assert.equal(moveCategory(doc, 'cat-1', -1), false, '已在顶部');
  assert.equal(moveCategory(doc, 'cat-ghost', 1), false);
});

test('事项在类别内排序，不影响其他类别', () => {
  const doc = normalizeDocument(
    makeDoc({
      categories: [cat('cat-1', 'A'), cat('cat-2', 'B')],
      rules: [rule('r1', 'R1', 1), rule('r2', 'R2', 2), rule('r3', 'R3', 3)]
    })
  );
  // 把 r3 改到 cat-2：应排到新类别末尾
  updateRule(doc, 'r3', { name: 'R3', categoryId: 'cat-2', points: 3 }, { today: TODAY });
  assert.deepEqual(rulesOf(doc, 'cat-2').map((r) => r.id), ['r3']);

  assert.equal(moveRule(doc, 'r2', -1, { today: TODAY }), true);
  assert.deepEqual(rulesOf(doc, 'cat-1').map((r) => r.id), ['r2', 'r1']);
  assert.equal(moveRule(doc, 'r2', -1, { today: TODAY }), false, '已在类别顶部，不会跨类别移动');
  assert.equal(doc.rules.find((r) => r.id === 'r1').order, 0, '同类别其他事项序号不变');
  assert.equal(doc.rules.find((r) => r.id === 'r3').order, 0, '其他类别的事项序号不受影响');
});

test('新增类别与事项排在各自列表末尾', () => {
  const doc = normalizeDocument(makeDoc({ categories: [cat('cat-1', 'A')], rules: [rule('r1', 'R1', 1)] }));
  createCategory(doc, { name: 'B', color: '#000000' });
  const created = doc.categories.find((c) => c.name === 'B');
  assert.equal(created.order, 1);

  createRule(doc, { name: 'R2', categoryId: created.id, points: 2 }, { today: TODAY });
  assert.equal(doc.rules.find((r) => r.versions[0].name === 'R2').order, 0);
  createRule(doc, { name: 'R3', categoryId: 'cat-1', points: 3 }, { today: TODAY });
  assert.equal(doc.rules.find((r) => r.versions[0].name === 'R3').order, 1);
});

test('本机调整类别排序、云端修改类别名称：合并同时保留，无冲突', () => {
  const base = normalizeDocument(makeDoc({ categories: [cat('cat-1', 'A', null, 0), cat('cat-2', 'B', null, 1)] }));
  const local = normalizeDocument(makeDoc({ categories: [cat('cat-2', 'B', null, 0), cat('cat-1', 'A', null, 1)] }));
  const remote = normalizeDocument(makeDoc({ categories: [cat('cat-1', 'A改', null, 0), cat('cat-2', 'B', null, 1)] }));

  const result = mergeDocuments({ base, local, remote });
  assert.equal(result.conflicts.length, 0);
  assert.deepEqual(orderedCategories(result.document).map((c) => c.id), ['cat-2', 'cat-1'], '采用本机排序');
  assert.equal(result.document.categories.find((c) => c.id === 'cat-1').name, 'A改', '同时保留云端改名');
});

test('两侧各自调整排序：逐项合并生效、无冲突、结果稳定', () => {
  const base = normalizeDocument(
    makeDoc({ categories: [cat('cat-1', 'A', null, 0), cat('cat-2', 'B', null, 1), cat('cat-3', 'C', null, 2)] })
  );
  // 本机把 cat-2 移到最前，远端把 cat-3 移到最前
  const local = normalizeDocument(
    makeDoc({ categories: [cat('cat-2', 'B', null, -1), cat('cat-1', 'A', null, 0), cat('cat-3', 'C', null, 2)] })
  );
  const remote = normalizeDocument(
    makeDoc({ categories: [cat('cat-3', 'C', null, -1), cat('cat-1', 'A', null, 0), cat('cat-2', 'B', null, 1)] })
  );

  const result = mergeDocuments({ base, local, remote });
  assert.equal(result.conflicts.length, 0);
  assert.deepEqual(
    orderedCategories(result.document).map((c) => c.id),
    ['cat-2', 'cat-3', 'cat-1'],
    '两侧的移动都保留（同序号时按 id 稳定排序）'
  );

  // 另一台设备再次合并同一结果，顺序不再变化
  const again = mergeDocuments({ base: result.document, local: result.document, remote: result.document });
  assert.deepEqual(orderedCategories(again.document).map((c) => c.id), ['cat-2', 'cat-3', 'cat-1']);
});

test('无基线首次连接：排序差异不提示冲突，本机顺序生效', () => {
  const local = normalizeDocument(makeDoc({ categories: [cat('cat-1', 'A', null, 0), cat('cat-2', 'B', null, 1)] }));
  const remote = normalizeDocument(makeDoc({ categories: [cat('cat-2', 'B', null, 0), cat('cat-1', 'A', null, 1)] }));

  const result = mergeDocuments({ base: null, local, remote });
  assert.equal(result.conflicts.length, 0);
  assert.deepEqual(orderedCategories(result.document).map((c) => c.id), ['cat-1', 'cat-2']);
});

test('事项排序随同步保留，与云端分值修改互不干扰', () => {
  const base = normalizeDocument(
    makeDoc({ rules: [rule('r1', 'R1', 1, null, null, 0), rule('r2', 'R2', 2, null, null, 1)] })
  );
  const local = normalizeDocument(
    makeDoc({ rules: [rule('r2', 'R2', 2, null, null, 0), rule('r1', 'R1', 1, null, null, 1)] })
  );
  const remote = normalizeDocument(
    makeDoc({
      rules: [
        { id: 'r1', deletedAt: null, order: 0, versions: [...base.rules[0].versions, ...rule('r1', 'R1', 5, '2026-10-16').versions] },
        rule('r2', 'R2', 2, null, null, 1)
      ]
    })
  );

  const result = mergeDocuments({ base, local, remote });
  assert.equal(result.conflicts.length, 0);
  const merged = result.document.rules.find((r) => r.id === 'r1');
  assert.equal(merged.order, 1, '保留本机排序');
  assert.equal(merged.versions.length, 2, '保留云端的分值修改');
});

test('排序在同步往返后保持稳定', () => {
  const doc = normalizeDocument(
    makeDoc({ categories: [cat('cat-1', 'A'), cat('cat-2', 'B')], rules: [rule('r1', 'R1', 1), rule('r2', 'R2', 2)] })
  );
  moveCategory(doc, 'cat-2', -1);
  moveRule(doc, 'r2', -1, { today: TODAY });

  const result = mergeDocuments({ base: null, local: doc, remote: doc });
  assert.deepEqual(orderedCategories(result.document).map((c) => c.id), ['cat-2', 'cat-1']);
  assert.deepEqual(rulesOf(result.document, 'cat-1').map((r) => r.id), ['r2', 'r1']);
});

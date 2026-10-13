import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBackupPayload, parseBackup, backupFileName, BackupFormatError } from '../src/sync/backup.js';
import { mergeDocuments } from '../src/domain/merge.js';
import { documentsEqual } from '../src/domain/model.js';
import { makeDoc, cat, rule, score } from './helpers.mjs';

test('导出载荷只含业务文档，不含任何凭据字段', () => {
  const doc = makeDoc({ categories: [cat('cat-1', '生活习惯')], rules: [rule('r1', '跳绳', 3)] });
  const payload = buildBackupPayload(doc, new Date('2026-10-13T00:00:00.000Z'));
  const text = JSON.stringify(payload);
  assert.equal(payload.kind, 'heroxp-backup');
  assert.ok(!text.includes('apiKey'));
  assert.ok(!text.includes('binId'));
  assert.ok(!text.includes('baseline'));
  assert.equal(backupFileName(new Date('2026-10-13T00:00:00.000Z')), 'HeroXP_Backup_2026-10-13.json');
});

test('解析备份：支持包装格式与裸文档', () => {
  const doc = makeDoc({ categories: [cat('cat-1', '生活习惯')], rules: [rule('r1', '跳绳', 3)] });
  const wrapped = JSON.stringify(buildBackupPayload(doc));
  const parsedWrapped = parseBackup(wrapped);
  assert.ok(documentsEqual(parsedWrapped, doc));

  const parsedRaw = parseBackup(JSON.stringify(doc));
  assert.ok(documentsEqual(parsedRaw, doc));

  assert.throws(() => parseBackup('not json'), BackupFormatError);
  assert.throws(() => parseBackup('{"hello":1}'), BackupFormatError);
});

test('导入同一份数据幂等：合并后不产生重复记录', () => {
  const doc = makeDoc({
    categories: [cat('cat-1', '生活习惯')],
    rules: [rule('r1', '跳绳', 3)],
    dailyScores: [score('2026-10-13', 'r1', true, '2026-10-13T08:00:00.000Z')]
  });
  const local = makeDoc({ categories: [cat('cat-1', '生活习惯')], rules: [rule('r1', '跳绳', 3)] });
  const first = mergeDocuments({ base: null, local, remote: doc });
  assert.equal(first.document.dailyScores.length, 1);
  assert.equal(first.conflicts.length, 0);

  const second = mergeDocuments({ base: first.document, local: first.document, remote: doc });
  assert.equal(second.document.dailyScores.length, 1, '重复导入不重复计分');
  assert.equal(second.conflicts.length, 0);
});

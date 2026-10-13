import { normalizeDocument, cloneDocument, InvalidDocumentError } from '../domain/model.js';

export const BACKUP_KIND = 'heroxp-backup';
export const BACKUP_FORMAT_VERSION = 1;

/** 业务数据导出载荷：只含共享文档，绝不含 Bin ID / 密钥等本机凭据。 */
export function buildBackupPayload(doc, now = new Date()) {
  return {
    kind: BACKUP_KIND,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    document: cloneDocument(doc)
  };
}

export function backupFileName(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `HeroXP_Backup_${y}-${m}-${d}.json`;
}

export class BackupFormatError extends Error {}

/** 解析备份文件；兼容直接导出共享文档的情形。 */
export function parseBackup(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupFormatError('文件不是合法 JSON，无法导入');
  }
  const candidate = raw && typeof raw === 'object' && raw.kind === BACKUP_KIND ? raw.document : raw;
  if (!candidate || typeof candidate !== 'object') {
    throw new BackupFormatError('备份文件内容为空或格式不正确');
  }
  try {
    return normalizeDocument(candidate);
  } catch (err) {
    if (err instanceof InvalidDocumentError) {
      throw new BackupFormatError(`备份文件不可用：${err.message}`);
    }
    throw err;
  }
}

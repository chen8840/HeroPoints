const API_BASE = 'https://api.jsonbin.io/v3/b/';

export class SyncError extends Error {
  constructor(type, message, status = null) {
    super(message);
    this.name = 'SyncError';
    this.type = type;
    this.status = status;
  }
}

function errorForStatus(status) {
  if (status === 400) return new SyncError('invalid', '云端请求被拒绝：请检查 Bin ID 是否正确', status);
  if (status === 401 || status === 403) return new SyncError('auth', '云端密钥无效或没有该 Bin 的权限，请检查密钥', status);
  if (status === 404) return new SyncError('notFound', '云端 Bin 不存在或已被删除，请检查 Bin ID', status);
  if (status === 409 || status === 412) return new SyncError('conflict', '云端数据版本冲突，请重新同步', status);
  if (status === 429) return new SyncError('rateLimit', '请求过于频繁，请稍后再试', status);
  if (status >= 500) return new SyncError('server', '云端服务暂时不可用，请稍后再试', status);
  return new SyncError('http', `云端返回异常状态码 ${status}`, status);
}

const KEY_HEADERS = ['X-Master-Key', 'X-Access-Key'];

export function createJsonBinClient({ binId, apiKey, fetchImpl = globalThis.fetch, keyHeader = null, onKeyHeader = null }) {
  const binUrl = `${API_BASE}${encodeURIComponent(binId)}`;
  // 记住上一次成功的密钥头（Master/Access），后续请求直接使用，避免每次先付一次 401 往返。
  let working = keyHeader;

  async function call(method, target, body) {
    const attempt = async (headerName) => {
      try {
        return await fetchImpl(target, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'X-Bin-Meta': 'false',
            [headerName]: apiKey
          },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
      } catch {
        throw new SyncError('network', '网络请求失败，请检查网络连接');
      }
    };

    const ordered = working ? [working, ...KEY_HEADERS.filter((name) => name !== working)] : KEY_HEADERS;
    let response = null;
    for (const headerName of ordered) {
      response = await attempt(headerName);
      if (response.status === 401 || response.status === 403) continue;
      if (working !== headerName) {
        working = headerName;
        onKeyHeader?.(headerName);
      }
      return response;
    }
    return response;
  }

  async function read() {
    const response = await call('GET', `${binUrl}/latest`);
    if (!response.ok) throw errorForStatus(response.status);
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new SyncError('invalid', '云端数据不是合法 JSON，已阻止写入以免覆盖');
    }
    // 正常情况下 X-Bin-Meta:false 直接返回记录内容；兼容返回 {record, metadata} 的情况。
    if (
      payload !== null &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      'record' in payload &&
      'metadata' in payload
    ) {
      return payload.record;
    }
    return payload;
  }

  async function write(document) {
    const response = await call('PUT', binUrl, document);
    if (!response.ok) throw errorForStatus(response.status);
    return true;
  }

  function isEmptyRemote(raw) {
    if (raw === null || raw === undefined || raw === '') return true;
    if (Array.isArray(raw)) return raw.length === 0;
    if (typeof raw === 'object') return Object.keys(raw).length === 0;
    return false;
  }

  return { read, write, isEmptyRemote };
}

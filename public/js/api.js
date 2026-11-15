// HTTP-клиент: HTTP Basic из sessionStorage, LDAP-ошибки сервера → Error(message)
const KEY = 'ldap_auth';

export const getCreds = () => {
  try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; }
};

export const setCreds = (c) =>
  c ? sessionStorage.setItem(KEY, JSON.stringify(c)) : sessionStorage.removeItem(KEY);

// btoa не умеет юникод (пароли бывают кириллицей) — кодируем через TextEncoder
const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

export async function api(path, { method = 'GET', body } = {}) {
  const c = getCreds();
  const headers = { 'Content-Type': 'application/json' };
  if (c) headers.Authorization = 'Basic ' + b64(`${c.dn}:${c.password}`);
  const r = await fetch(path, { method, headers, body });
  if (r.status === 401 && c) {
    setCreds(null);
    location.reload();
    throw new Error('сессия истекла');
  }
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error((data && data.error) || r.statusText);
  return data;
}

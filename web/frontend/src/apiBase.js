/** API base path including subpath prefix (e.g. /shop/api). */
const base = import.meta.env.BASE_URL.replace(/\/$/, "");
export const API = `${base}/api`;

export function apiUrl(path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API}${p}`;
}

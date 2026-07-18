export class SessionExpiredError extends Error {
  constructor(message = "Session expired; log in again.") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

export function isSessionExpiredError(e) {
  return e instanceof SessionExpiredError;
}

export function createAuthFetch(getToken, onSessionExpired) {
  return async function authFetch(input, init) {
    const token = (getToken() || "").trim();
    const nextInit = { ...init };
    const headers = new Headers(init?.headers);
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    nextInit.headers = headers;

    const res = await fetch(input, nextInit);

    if (res.status === 401) {
      onSessionExpired();
      let detail = "";
      try {
        const j = await res.clone().json();
        if (typeof j?.detail === "string") {
          detail = j.detail;
        }
      } catch {
        // ignore
      }
      throw new SessionExpiredError(detail || "Unauthorized");
    }

    return res;
  };
}

// public/js/api.js
(function () {
  const TOKEN_KEY = "TOKEN";
  const API_BASE = ""; // same-origin. Có thể đổi thành 'http://localhost:3000' nếu cần.

  function getToken() { return localStorage.getItem(TOKEN_KEY) || null; }
  function setToken(t) {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  }

  function buildHeaders({ isForm = false, extra = {} } = {}) {
    const h = new Headers(extra);
    if (!isForm && !h.has("Content-Type")) {
      h.set("Content-Type", "application/json");
    }
    const tok = getToken();
    if (tok && !h.has("Authorization")) {
      h.set("Authorization", "Bearer " + tok);
    }
    return h;
  }

  async function parseResponse(res) {
    if (res.status === 204) return null;
    const ct = res.headers.get("content-type") || "";
    let data = null, text = null;
    if (ct.includes("application/json")) {
      try { data = await res.json(); } catch (_) {}
    } else {
      try { text = await res.text(); } catch (_) {}
    }
    if (!res.ok) {
      const msg =
        (data && (data.message || data.error || data.msg)) ||
        text ||
        `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.payload = data || text;
      throw err;
    }
    return data ?? text ?? null;
  }

  async function _fetch(path, { method = "GET", body, isForm = false, headers } = {}) {
    const opts = {
      method,
      credentials: "include",
      headers: buildHeaders({ isForm, extra: headers }),
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    };
    const res = await fetch(API_BASE + path, opts);
    return parseResponse(res);
  }

  const API = {
    getToken, setToken,

    captureAuth(resp) {
      const token =
        resp?.token ||
        resp?.data?.token ||
        resp?.accessToken ||
        resp?.jwt ||
        resp?.auth?.token;
      if (token) setToken(token);
      return resp;
    },

    async get(url, headers) { return _fetch(url, { method: "GET", headers }); },
    async post(url, body, headers) { return _fetch(url, { method: "POST", body, headers }); },
    async put(url, body, headers) { return _fetch(url, { method: "PUT", body, headers }); },
    async patch(url, body, headers) { return _fetch(url, { method: "PATCH", body, headers }); },
    async del(url, headers) { return _fetch(url, { method: "DELETE", headers }); },
    async delete(url, headers) { return _fetch(url, { method: "DELETE", headers }); },

    async upload(url, formData, headers) {
      return _fetch(url, { method: "POST", body: formData, isForm: true, headers });
    },

    socketAuth() {
      const tok = getToken();
      return tok ? { withCredentials: true, auth: { token: tok } } : { withCredentials: true };
    }
  };

  // mini toast (keeps existing behavior)
  window.toast = (msg) => {
    const el = document.getElementById("toast");
    if (!el) return alert(msg);
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 1500);
  };

  window.API = API;
})();

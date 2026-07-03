// Supabase client — auth + settings sync
// Anon key is safe to expose in client-side code; Row Level Security protects data.
(function () {
  var SUPABASE_URL = "https://jotirmhoohsquqvungrm.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_AaQ5SHzy1Q2XimB8-HLbdg_JuzzSGZw";

  // Settings keys to sync (never include wf-gh-token)
  var SYNC_KEYS = [
    "wf-equity-sheets",
    "wf-stocksetf-sheets",
    "wf-fd-sheets",
    "wf-mfmapping-sheets",
    "wf-stocksetfmapping-sheets",
    "wf-gh-owner",
    "wf-gh-repo",
    "wf-gh-branch"
  ];

  // DB column name for each localStorage key
  var KEY_TO_COL = {
    "wf-equity-sheets":          "equity_sheets",
    "wf-stocksetf-sheets":       "stocksetf_sheets",
    "wf-fd-sheets":              "fd_sheets",
    "wf-mfmapping-sheets":       "mfmapping_sheets",
    "wf-stocksetfmapping-sheets":"stocksetfmapping_sheets",
    "wf-gh-owner":               "gh_owner",
    "wf-gh-repo":                "gh_repo",
    "wf-gh-branch":              "gh_branch"
  };

  // ── Minimal Supabase REST client (no npm, no bundler) ─────────────────────

  function authHeaders(token) {
    return {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": "Bearer " + (token || SUPABASE_ANON_KEY),
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    };
  }

  function getSession() {
    try { return JSON.parse(localStorage.getItem("wf-sb-session")); } catch (e) { return null; }
  }
  function setSession(session) {
    if (session) localStorage.setItem("wf-sb-session", JSON.stringify(session));
    else localStorage.removeItem("wf-sb-session");
  }
  function getAccessToken() {
    var s = getSession();
    return s && s.access_token ? s.access_token : null;
  }
  function getUserId() {
    var s = getSession();
    return s && s.user ? s.user.id : null;
  }
  function getUserEmail() {
    var s = getSession();
    return s && s.user ? s.user.email : null;
  }

  function signUp(email, password) {
    return fetch(SUPABASE_URL + "/auth/v1/signup", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ email: email, password: password })
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.error || data.msg) throw new Error(data.error_description || data.msg || data.error);
      if (data.session) setSession(data.session);
      else if (data.access_token) setSession(data);
      return data;
    });
  }

  function signIn(email, password) {
    return fetch(SUPABASE_URL + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ email: email, password: password })
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.error || data.error_description) throw new Error(data.error_description || data.error);
      setSession(data);
      return data;
    });
  }

  function signOut() {
    var token = getAccessToken();
    setSession(null);
    return fetch(SUPABASE_URL + "/auth/v1/logout", {
      method: "POST",
      headers: authHeaders(token)
    }).catch(function () {});
  }

  function refreshSession() {
    var s = getSession();
    if (!s || !s.refresh_token) return Promise.resolve(null);
    return fetch(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ refresh_token: s.refresh_token })
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.access_token) { setSession(data); return data; }
      setSession(null);
      return null;
    }).catch(function () { return null; });
  }

  function getValidToken() {
    var s = getSession();
    if (!s || !s.access_token) return Promise.resolve(null);
    // Check if token expires within 60 seconds
    var exp = s.expires_at || (s.expires_in ? Math.floor(Date.now() / 1000) + s.expires_in : 0);
    if (exp && Math.floor(Date.now() / 1000) > exp - 60) {
      return refreshSession().then(function (newS) {
        return newS ? newS.access_token : null;
      });
    }
    return Promise.resolve(s.access_token);
  }

  // ── Settings sync ──────────────────────────────────────────────────────────

  function loadSettingsFromCloud() {
    return getValidToken().then(function (token) {
      if (!token) return null;
      var uid = getUserId();
      if (!uid) return null;
      return fetch(SUPABASE_URL + "/rest/v1/user_settings?user_id=eq." + uid + "&select=*", {
        headers: authHeaders(token)
      }).then(function (r) { return r.json(); }).then(function (rows) {
        if (!rows || !rows.length) return null;
        var row = rows[0];
        SYNC_KEYS.forEach(function (lsKey) {
          var col = KEY_TO_COL[lsKey];
          if (!col || row[col] == null) return;
          var val = row[col];
          // jsonb columns come back as objects/arrays; string columns as strings
          var toStore = (typeof val === "string") ? val : JSON.stringify(val);
          localStorage.setItem(lsKey, toStore);
        });
        return row;
      });
    });
  }

  function saveSettingsToCloud() {
    return getValidToken().then(function (token) {
      if (!token) return null;
      var uid = getUserId();
      if (!uid) return null;
      var payload = { user_id: uid };
      SYNC_KEYS.forEach(function (lsKey) {
        var col = KEY_TO_COL[lsKey];
        var raw = localStorage.getItem(lsKey);
        if (raw == null) return;
        // Try parsing JSON; if it fails treat as plain string
        try { payload[col] = JSON.parse(raw); } catch (e) { payload[col] = raw; }
      });
      payload.updated_at = new Date().toISOString();
      // upsert
      return fetch(SUPABASE_URL + "/rest/v1/user_settings?on_conflict=user_id", {
        method: "POST",
        headers: Object.assign({}, authHeaders(token), { "Prefer": "resolution=merge-duplicates,return=representation" }),
        body: JSON.stringify(payload)
      }).then(function (r) { return r.json(); });
    });
  }

  // ── Generic per-user table CRUD (used by the Expense manager) ───────────────
  // All helpers scope to the signed-in user; RLS enforces it server-side too.

  function dbRequest(method, path, body, token, extraPrefer) {
    var headers = authHeaders(token);
    if (extraPrefer) headers = Object.assign({}, headers, { "Prefer": extraPrefer });
    return fetch(SUPABASE_URL + "/rest/v1/" + path, {
      method: method,
      headers: headers,
      body: body != null ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (r.status === 204) return [];
      return r.json().then(function (data) {
        if (data && data.code && data.message) throw new Error(data.message);
        return data;
      });
    });
  }

  // query: extra PostgREST params, e.g. "select=*&order=sort_order.asc"
  function dbSelect(table, query) {
    return getValidToken().then(function (token) {
      if (!token) return null;
      var uid = getUserId();
      if (!uid) return null;
      var q = "user_id=eq." + uid + (query ? "&" + query : "&select=*");
      return dbRequest("GET", table + "?" + q, null, token);
    });
  }

  function dbInsert(table, row) {
    return getValidToken().then(function (token) {
      if (!token) return null;
      var uid = getUserId();
      if (!uid) return null;
      var payload = Array.isArray(row)
        ? row.map(function (r) { return Object.assign({ user_id: uid }, r); })
        : Object.assign({ user_id: uid }, row);
      return dbRequest("POST", table, payload, token);
    });
  }

  function dbUpdate(table, id, patch) {
    return getValidToken().then(function (token) {
      if (!token) return null;
      var uid = getUserId();
      if (!uid) return null;
      return dbRequest("PATCH", table + "?id=eq." + encodeURIComponent(id) + "&user_id=eq." + uid, patch, token);
    });
  }

  function dbDelete(table, id) {
    return getValidToken().then(function (token) {
      if (!token) return null;
      var uid = getUserId();
      if (!uid) return null;
      return dbRequest("DELETE", table + "?id=eq." + encodeURIComponent(id) + "&user_id=eq." + uid, null, token);
    });
  }

  window.WfDb = {
    select: dbSelect,
    insert: dbInsert,
    update: dbUpdate,
    remove: dbDelete
  };

  // ── Exported API ───────────────────────────────────────────────────────────

  window.WfAuth = {
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    getSession: getSession,
    getUserEmail: getUserEmail,
    getUserId: getUserId,
    isLoggedIn: function () { return !!getAccessToken(); },
    loadSettingsFromCloud: loadSettingsFromCloud,
    saveSettingsToCloud: saveSettingsToCloud,
    requireAuth: function (redirectTo) {
      if (!getAccessToken()) {
        window.location.href = redirectTo || "index.html";
        return false;
      }
      return true;
    }
  };
})();

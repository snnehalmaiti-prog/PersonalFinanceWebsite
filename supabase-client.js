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
    "wf-gh-branch",
    "wf-expense-templates",
    "wf-recurring-payments"
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
    "wf-gh-branch":              "gh_branch",
    "wf-expense-templates":      "expense_templates",
    "wf-recurring-payments":     "recurring_payments"
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

  function signUp(email, password, metadata) {
    var body = { email: email, password: password };
    if (metadata) body.data = metadata;
    return fetch(SUPABASE_URL + "/auth/v1/signup", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.error || data.msg || data.error_code || (data.code && data.code >= 400)) {
        throw new Error(data.error_description || data.msg || data.error || "Sign up failed");
      }
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
      if (data.error || data.error_description || data.msg || data.error_code || (data.code && data.code >= 400) || !data.access_token) {
        throw new Error(data.error_description || data.msg || data.error || "Invalid login credentials");
      }
      setSession(data);
      return data;
    });
  }

  function sendPasswordReset(email, redirectTo) {
    var body = { email: email };
    return fetch(SUPABASE_URL + "/auth/v1/recover" + (redirectTo ? "?redirect_to=" + encodeURIComponent(redirectTo) : ""), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().catch(function () { return {}; }); }).then(function (data) {
      if (data.error || data.msg || data.error_code || (data.code && data.code >= 400)) {
        throw new Error(data.error_description || data.msg || data.error || "Could not send reset email");
      }
      return data;
    });
  }

  function getUser() {
    var s = getSession();
    return s && s.user ? s.user : null;
  }

  function refreshUser() {
    return getValidToken().then(function (token) {
      if (!token) return null;
      return fetch(SUPABASE_URL + "/auth/v1/user", { headers: authHeaders(token) })
        .then(function (r) { return r.json(); }).then(function (user) {
          if (user && user.id) {
            var s = getSession() || {};
            s.user = user;
            setSession(s);
          }
          return user;
        });
    });
  }

  function updateUserMetadata(metadata) {
    return getValidToken().then(function (token) {
      if (!token) return Promise.reject(new Error("Not authenticated"));
      return fetch(SUPABASE_URL + "/auth/v1/user", {
        method: "PUT",
        headers: authHeaders(token),
        body: JSON.stringify({ data: metadata })
      }).then(function (r) { return r.json(); }).then(function (data) {
        if (data.error || data.msg || data.error_code || (data.code && data.code >= 400)) {
          throw new Error(data.error_description || data.msg || data.error || "Could not update profile");
        }
        var s = getSession() || {};
        s.user = data;
        setSession(s);
        return data;
      });
    });
  }

  function updatePassword(newPassword, accessToken) {
    var token = accessToken || getAccessToken();
    if (!token) return Promise.reject(new Error("Not authenticated"));
    return fetch(SUPABASE_URL + "/auth/v1/user", {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ password: newPassword })
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.error || data.msg || data.error_code || (data.code && data.code >= 400)) {
        throw new Error(data.error_description || data.msg || data.error || "Could not update password");
      }
      return data;
    });
  }

  function setSessionFromTokens(accessToken, refreshToken) {
    setSession({ access_token: accessToken, refresh_token: refreshToken, token_type: "bearer" });
  }

  function signOut() {
    var token = getAccessToken();
    setSession(null);
    // Clear per-user data so the next user on a shared device can't see the prior
    // user's sheet configs or GitHub PAT.
    try {
      SYNC_KEYS.forEach(function (k) { localStorage.removeItem(k); });
      localStorage.removeItem("wf-gh-token");
      sessionStorage.removeItem("wf-cloud-synced");
    } catch (e) {}
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

      function doUpsert(body) {
        return fetch(SUPABASE_URL + "/rest/v1/user_settings?on_conflict=user_id", {
          method: "POST",
          headers: Object.assign({}, authHeaders(token), { "Prefer": "resolution=merge-duplicates,return=representation" }),
          body: JSON.stringify(body)
        }).then(function (r) {
          return r.json().catch(function () { return null; }).then(function (data) { return { ok: r.ok, status: r.status, data: data }; });
        });
      }

      // Extract the offending column name from PostgREST's unknown-column error
      // (PGRST204: "Could not find the 'expense_templates' column of ...").
      function unknownColumnOf(res) {
        if (!res || res.ok || !res.data) return null;
        var msg = String(res.data.message || "");
        var m = (res.data.code === "PGRST204" || msg.indexOf("column") !== -1)
          ? msg.match(/'([^']+)' column/) : null;
        return m ? m[1] : null;
      }

      // Resilient upsert: a database whose user_settings table predates newer synced
      // keys rejects the WHOLE row for one unknown column, silently killing sync for
      // everything (sheet links, mappings, GH settings). Drop the offending column(s)
      // and retry — configs keep syncing even against an older schema. Retries are
      // bounded by the payload's own key count.
      var maxRetries = Object.keys(payload).length;
      function attempt(body, triesLeft) {
        return doUpsert(body).then(function (res) {
          var badCol = unknownColumnOf(res);
          if (badCol && badCol in body && triesLeft > 0) {
            console.warn("Settings sync: column '" + badCol + "' missing in DB — retrying without it. " +
              "Run the schema migration in supabase-schema.sql to sync this key too.");
            var slim = Object.assign({}, body);
            delete slim[badCol];
            return attempt(slim, triesLeft - 1);
          }
          if (!res.ok) console.warn("Settings sync failed:", res.status, res.data && (res.data.message || res.data.code || res.data));
          return res.data;
        });
      }
      return attempt(payload, maxRetries);
    });
  }

  // ── Sheet-data synced cache (user_sheet_data) ───────────────────────────────
  // Parsed sheet/mapping rows are cached per (user, prefix) so every device sees
  // the same fresh data without re-entering Google Sheet URLs or trusting stale
  // localStorage. Google Sheets stays the source of truth; this table is a cache.
  //
  // Rules that keep this safe (see failure-mode discussion):
  //  - one jsonb blob per prefix, upserted (never appended) → no row duplication
  //  - PAT and expense-ledger are never written here
  //  - a payload over ~2 MB is skipped (Postgres/PostgREST body limits)
  //  - all failures are swallowed; a bad cloud write never blocks the local write

  var SHEET_DATA_MAX_BYTES = 2 * 1024 * 1024; // 2 MB per prefix

  // saveSheetData(prefix, rows) — upsert the full rows array for one prefix.
  // Fire-and-forget: resolves to null on any problem, never rejects.
  function saveSheetData(prefix, rows) {
    return getValidToken().then(function (token) {
      if (!token) return null;
      var uid = getUserId();
      if (!uid || !prefix || !Array.isArray(rows)) return null;
      var body = { user_id: uid, prefix: String(prefix), rows: rows, updated_at: new Date().toISOString() };
      var serialized;
      try { serialized = JSON.stringify(body); } catch (e) { return null; }
      if (serialized.length > SHEET_DATA_MAX_BYTES) {
        console.warn("Sheet-data sync: '" + prefix + "' is " + Math.round(serialized.length / 1024) +
          "KB, over the 2MB cap — skipping cloud cache for this prefix.");
        return null;
      }
      return fetch(SUPABASE_URL + "/rest/v1/user_sheet_data?on_conflict=user_id,prefix", {
        method: "POST",
        headers: Object.assign({}, authHeaders(token), { "Prefer": "resolution=merge-duplicates,return=minimal" }),
        body: serialized
      }).then(function (r) {
        if (!r.ok) {
          return r.json().catch(function () { return null; }).then(function (data) {
            console.warn("Sheet-data sync failed for '" + prefix + "':", r.status, data && (data.message || data.code || data));
            return null;
          });
        }
        return true;
      }).catch(function () { return null; });
    }).catch(function () { return null; });
  }

  // loadAllSheetData() — fetch every cached prefix for the user in one request.
  // Returns [{prefix, rows, updated_at}] on success, or [] on any error (never throws).
  function loadAllSheetData() {
    return getValidToken().then(function (token) {
      if (!token) return [];
      var uid = getUserId();
      if (!uid) return [];
      return fetch(SUPABASE_URL + "/rest/v1/user_sheet_data?user_id=eq." + uid + "&select=prefix,rows,updated_at", {
        headers: authHeaders(token)
      }).then(function (r) {
        if (!r.ok) return [];
        return r.json().then(function (data) {
          return Array.isArray(data) ? data : [];
        }).catch(function () { return []; });
      }).catch(function () { return []; });
    }).catch(function () { return []; });
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
    sendPasswordReset: sendPasswordReset,
    updatePassword: updatePassword,
    setSessionFromTokens: setSessionFromTokens,
    getUser: getUser,
    refreshUser: refreshUser,
    updateUserMetadata: updateUserMetadata,
    getSession: getSession,
    getUserEmail: getUserEmail,
    getUserId: getUserId,
    isLoggedIn: function () { return !!getAccessToken(); },
    loadSettingsFromCloud: loadSettingsFromCloud,
    saveSettingsToCloud: saveSettingsToCloud,
    saveSheetData: saveSheetData,
    loadAllSheetData: loadAllSheetData,
    requireAuth: function (redirectTo) {
      if (!getAccessToken()) {
        window.location.href = redirectTo || "index.html";
        return false;
      }
      return true;
    }
  };
})();

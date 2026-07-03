// Expense Manager — Phase 1: Accounts + Categories (in-app CRUD, Supabase-backed).
// Records, budgets and analytics arrive in later phases. Data is per-user via RLS.
(function () {
  "use strict";

  var ACCT = "expense_accounts";
  var CATS = "expense_categories";

  var state = { accounts: [], categories: [], loaded: false };
  var wired = false;

  var COLORS = ["#EF4444", "#F59E0B", "#10B981", "#3B82F6", "#6366F1", "#8B5CF6",
    "#EC4899", "#14B8A6", "#F97316", "#84CC16", "#06B6D4", "#6B7280"];
  var CAT_EMOJIS = ["🍔", "🛒", "🛍️", "🏠", "🚗", "⛽", "🎬", "👕", "💊", "🏥", "📚", "🎓",
    "✈️", "🏋️", "🎁", "💡", "📱", "🐶", "💇", "☕", "🍺", "🎮", "🧾", "🚕", "🏦", "💰",
    "📈", "🎨", "🧹", "🔧", "🅿️", "🌐", "💼", "🧴", "🍎", "⚡"];
  var ACC_EMOJIS = ["💳", "🏦", "💵", "👛", "📲", "🪙", "💰", "🏧"];
  var ACC_TYPES = [
    { v: "cash", label: "Cash" }, { v: "bank", label: "Bank" },
    { v: "card", label: "Credit Card" }, { v: "wallet", label: "Wallet" },
    { v: "other", label: "Other" }
  ];

  // BudgetBakers-style starter taxonomy. Each expense category has subcategories.
  var DEFAULT_CATEGORIES = {
    expense: [
      { name: "Food & Drinks", icon: "🍔", color: "#F59E0B", subs: ["Restaurant", "Groceries", "Coffee"] },
      { name: "Shopping", icon: "🛍️", color: "#EC4899", subs: ["Clothes", "Electronics"] },
      { name: "Housing", icon: "🏠", color: "#6366F1", subs: ["Rent", "Utilities", "Maintenance"] },
      { name: "Transport", icon: "🚗", color: "#3B82F6", subs: ["Fuel", "Public transport", "Taxi"] },
      { name: "Entertainment", icon: "🎬", color: "#8B5CF6", subs: ["Movies", "Games"] },
      { name: "Health", icon: "💊", color: "#EF4444", subs: ["Pharmacy", "Doctor"] },
      { name: "Bills", icon: "🧾", color: "#14B8A6", subs: ["Phone", "Internet", "Electricity"] }
    ],
    income: [
      { name: "Salary", icon: "💼", color: "#10B981", subs: [] },
      { name: "Interest", icon: "🏦", color: "#06B6D4", subs: [] },
      { name: "Dividends", icon: "📈", color: "#84CC16", subs: [] },
      { name: "Other Income", icon: "💰", color: "#F97316", subs: [] }
    ]
  };

  function fmtMoney(n) {
    var v = Number(n) || 0;
    return "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }
  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ── Sub-tab navigation within the Expense panel ─────────────────────────────
  var SUBTABS = [
    { tab: "subtab-exp-overview", panel: "subpanel-exp-overview" },
    { tab: "subtab-exp-records", panel: "subpanel-exp-records" },
    { tab: "subtab-exp-categories", panel: "subpanel-exp-categories" },
    { tab: "subtab-exp-accounts", panel: "subpanel-exp-accounts" },
    { tab: "subtab-exp-budgets", panel: "subpanel-exp-budgets" }
  ];
  function showSubTab(tabId) {
    SUBTABS.forEach(function (s) {
      var t = el(s.tab), p = el(s.panel);
      if (!t || !p) return;
      var active = s.tab === tabId;
      t.classList.toggle("active", active);
      t.setAttribute("aria-selected", String(active));
      p.hidden = !active;
    });
  }

  // ── Data loading + first-run seeding ────────────────────────────────────────
  function loadData() {
    var accStatus = el("exp-accounts-status");
    var catStatus = el("exp-categories-status");
    if (accStatus) accStatus.textContent = "Loading…";
    if (catStatus) catStatus.textContent = "Loading…";

    return Promise.all([
      WfDb.select(ACCT, "select=*&order=sort_order.asc,created_at.asc"),
      WfDb.select(CATS, "select=*&order=sort_order.asc,created_at.asc")
    ]).then(function (res) {
      state.accounts = res[0] || [];
      state.categories = res[1] || [];
      state.loaded = true;
      var uid = WfAuth.getUserId();
      var seededKey = "wf-exp-seeded-" + uid;
      if (!state.categories.length && !localStorage.getItem(seededKey)) {
        return seedDefaults().then(function () {
          try { localStorage.setItem(seededKey, "1"); } catch (e) {}
          return loadData();
        });
      }
      renderAccounts();
      renderCategories();
    }).catch(function (err) {
      if (accStatus) accStatus.textContent = "Could not load: " + err.message;
      if (catStatus) catStatus.textContent = "Could not load: " + err.message;
    });
  }

  function seedDefaults() {
    // 1) one default account
    var seedAcct = WfDb.insert(ACCT, { name: "Cash", type: "cash", icon: "💵", color: "#10B981", initial_balance: 0, sort_order: 0 });
    // 2) parent categories (batch), then their subcategories (batch)
    var parents = [];
    ["expense", "income"].forEach(function (type) {
      DEFAULT_CATEGORIES[type].forEach(function (c, i) {
        parents.push({ name: c.name, type: type, icon: c.icon, color: c.color, parent_id: null, sort_order: i });
      });
    });
    var seedCats = WfDb.insert(CATS, parents).then(function (inserted) {
      if (!inserted || !inserted.length) return null;
      // Map inserted parents back to their default defs (by name+type) to build subs.
      var byKey = {};
      inserted.forEach(function (row) { byKey[row.type + "|" + row.name] = row.id; });
      var subs = [];
      ["expense", "income"].forEach(function (type) {
        DEFAULT_CATEGORIES[type].forEach(function (c) {
          var pid = byKey[type + "|" + c.name];
          (c.subs || []).forEach(function (sn, i) {
            subs.push({ name: sn, type: type, parent_id: pid, icon: c.icon, color: c.color, sort_order: i });
          });
        });
      });
      return subs.length ? WfDb.insert(CATS, subs) : null;
    });
    return Promise.all([seedAcct, seedCats]);
  }

  // ── Rendering: Accounts ─────────────────────────────────────────────────────
  function renderAccounts() {
    var list = el("exp-accounts-list");
    var status = el("exp-accounts-status");
    if (!list) return;
    if (!state.accounts.length) {
      if (status) { status.hidden = false; status.textContent = "No accounts yet — add your first account."; }
      list.innerHTML = "";
      return;
    }
    if (status) status.hidden = true;
    list.innerHTML = state.accounts.map(function (a) {
      var typeLabel = (ACC_TYPES.find(function (t) { return t.v === a.type; }) || {}).label || a.type;
      return '<div class="exp-account-card" style="border-left-color:' + esc(a.color) + '">' +
        '<div class="exp-account-top"><span class="exp-cat-icon" style="background:' + esc(a.color) + '">' + esc(a.icon) + '</span>' +
        '<span class="exp-account-name">' + esc(a.name) + '</span></div>' +
        '<div class="exp-account-type">' + esc(typeLabel) + '</div>' +
        '<div class="exp-account-bal">Opening: ' + fmtMoney(a.initial_balance) + '</div>' +
        '<div class="exp-row-actions">' +
        '<button type="button" class="exp-icon-btn" data-act="edit-acct" data-id="' + a.id + '" title="Edit">✏️</button>' +
        '<button type="button" class="exp-icon-btn" data-act="del-acct" data-id="' + a.id + '" title="Delete">🗑️</button>' +
        '</div></div>';
    }).join("");
  }

  // ── Rendering: Categories (grouped by type, with subcategories) ─────────────
  function renderCategories() {
    var status = el("exp-categories-status");
    if (status) status.hidden = !!state.categories.length;
    if (status && !state.categories.length) status.textContent = "No categories yet — add your first category.";
    renderCatGroup("expense", el("exp-categories-expense"), "Expense Categories");
    renderCatGroup("income", el("exp-categories-income"), "Income Categories");
  }

  function renderCatGroup(type, container, heading) {
    if (!container) return;
    var tops = state.categories.filter(function (c) { return c.type === type && !c.parent_id; });
    if (!tops.length) { container.innerHTML = ""; return; }
    var html = '<h3 class="exp-group-title">' + heading + '</h3>';
    tops.forEach(function (cat) {
      var subs = state.categories.filter(function (c) { return c.parent_id === cat.id; });
      html += '<div class="exp-cat">' +
        '<div class="exp-cat-head">' +
        '<span class="exp-cat-icon" style="background:' + esc(cat.color) + '">' + esc(cat.icon) + '</span>' +
        '<span class="exp-cat-name">' + esc(cat.name) + '</span>' +
        '<div class="exp-row-actions">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="add-sub" data-id="' + cat.id + '">+ Subcategory</button>' +
        '<button type="button" class="exp-icon-btn" data-act="edit-cat" data-id="' + cat.id + '" title="Edit">✏️</button>' +
        '<button type="button" class="exp-icon-btn" data-act="del-cat" data-id="' + cat.id + '" title="Delete">🗑️</button>' +
        '</div></div>';
      if (subs.length) {
        html += '<div class="exp-subcat-list">' + subs.map(function (s) {
          return '<span class="exp-subcat">' + esc(s.name) +
            '<button type="button" class="exp-icon-btn" data-act="edit-cat" data-id="' + s.id + '" title="Edit">✏️</button>' +
            '<button type="button" class="exp-icon-btn" data-act="del-cat" data-id="' + s.id + '" title="Delete">🗑️</button>' +
            '</span>';
        }).join("") + '</div>';
      }
      html += '</div>';
    });
    container.innerHTML = html;
  }

  // ── Modal plumbing ──────────────────────────────────────────────────────────
  var modalCtx = null; // { kind, mode, record, parent, type, icon, color }

  function openModal(title, bodyHtml, ctx) {
    modalCtx = ctx;
    el("exp-modal-title").textContent = title;
    el("exp-modal-body").innerHTML = bodyHtml;
    el("exp-modal-overlay").hidden = false;
    // wire icon + color pickers if present
    wirePickers();
  }
  function closeModal() { el("exp-modal-overlay").hidden = true; modalCtx = null; }

  function pickerGrid(items, selected, kind) {
    return '<div class="exp-picker" data-picker="' + kind + '">' + items.map(function (it) {
      var isColor = kind === "color";
      var sel = it === selected ? " selected" : "";
      return isColor
        ? '<button type="button" class="exp-swatch' + sel + '" data-val="' + it + '" style="background:' + it + '"></button>'
        : '<button type="button" class="exp-emoji' + sel + '" data-val="' + it + '">' + it + '</button>';
    }).join("") + '</div>';
  }

  function wirePickers() {
    var body = el("exp-modal-body");
    body.querySelectorAll(".exp-picker").forEach(function (grid) {
      var kind = grid.getAttribute("data-picker");
      grid.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-val]");
        if (!btn) return;
        grid.querySelectorAll("[data-val]").forEach(function (b) { b.classList.remove("selected"); });
        btn.classList.add("selected");
        if (kind === "icon") modalCtx.icon = btn.getAttribute("data-val");
        else modalCtx.color = btn.getAttribute("data-val");
      });
    });
  }

  // ── Account add/edit ────────────────────────────────────────────────────────
  function openAccountModal(record) {
    var r = record || { name: "", type: "cash", icon: "💳", color: "#3B82F6", initial_balance: 0 };
    var ctx = { kind: "account", mode: record ? "edit" : "add", record: record, icon: r.icon, color: r.color };
    var html =
      '<label class="exp-field"><span>Name</span><input type="text" id="exp-f-name" value="' + esc(r.name) + '" placeholder="e.g. HDFC Bank" /></label>' +
      '<label class="exp-field"><span>Type</span><select id="exp-f-type">' +
        ACC_TYPES.map(function (t) { return '<option value="' + t.v + '"' + (t.v === r.type ? " selected" : "") + '>' + t.label + '</option>'; }).join("") +
      '</select></label>' +
      '<label class="exp-field"><span>Opening balance</span><input type="number" id="exp-f-bal" value="' + (Number(r.initial_balance) || 0) + '" step="0.01" /></label>' +
      '<div class="exp-field"><span>Icon</span>' + pickerGrid(ACC_EMOJIS, r.icon, "icon") + '</div>' +
      '<div class="exp-field"><span>Color</span>' + pickerGrid(COLORS, r.color, "color") + '</div>';
    openModal(record ? "Edit account" : "Add account", html, ctx);
  }

  function saveAccount() {
    var name = el("exp-f-name").value.trim();
    if (!name) { el("exp-f-name").focus(); return; }
    var row = {
      name: name,
      type: el("exp-f-type").value,
      initial_balance: Number(el("exp-f-bal").value) || 0,
      icon: modalCtx.icon,
      color: modalCtx.color
    };
    var op = modalCtx.mode === "edit"
      ? WfDb.update(ACCT, modalCtx.record.id, row)
      : WfDb.insert(ACCT, Object.assign({ sort_order: state.accounts.length }, row));
    return op.then(function () { closeModal(); return loadData(); });
  }

  // ── Category add/edit (top-level or subcategory) ────────────────────────────
  function openCategoryModal(record, parent, presetType) {
    var r = record || { name: "", type: presetType || "expense", icon: parent ? parent.icon : "🏷️", color: parent ? parent.color : "#6B7280" };
    var isSub = !!(parent || (record && record.parent_id));
    var ctx = { kind: "category", mode: record ? "edit" : "add", record: record, parent: parent, icon: r.icon, color: r.color };
    var typeVal = record ? record.type : (parent ? parent.type : (presetType || "expense"));
    var html =
      '<label class="exp-field"><span>Name</span><input type="text" id="exp-f-name" value="' + esc(r.name) + '" placeholder="' + (isSub ? "e.g. Groceries" : "e.g. Food & Drinks") + '" /></label>';
    if (!isSub) {
      html += '<div class="exp-field"><span>Type</span><div class="exp-type-toggle" id="exp-f-type-toggle">' +
        '<button type="button" data-type="expense" class="' + (typeVal === "expense" ? "active" : "") + '">Expense</button>' +
        '<button type="button" data-type="income" class="' + (typeVal === "income" ? "active" : "") + '">Income</button>' +
        '</div></div>';
    } else {
      var pName = parent ? parent.name : (findCat(record.parent_id) || {}).name;
      html += '<div class="exp-field"><span>Under category</span><div class="exp-readonly">' + esc(pName || "") + '</div></div>';
    }
    html += '<div class="exp-field"><span>Icon</span>' + pickerGrid(CAT_EMOJIS, r.icon, "icon") + '</div>' +
      '<div class="exp-field"><span>Color</span>' + pickerGrid(COLORS, r.color, "color") + '</div>';
    ctx.type = typeVal;
    ctx.isSub = isSub;
    openModal(record ? "Edit category" : (isSub ? "Add subcategory" : "Add category"), html, ctx);
    // wire type toggle
    var tt = el("exp-f-type-toggle");
    if (tt) tt.addEventListener("click", function (e) {
      var b = e.target.closest("[data-type]"); if (!b) return;
      tt.querySelectorAll("[data-type]").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active"); modalCtx.type = b.getAttribute("data-type");
    });
  }

  function saveCategory() {
    var name = el("exp-f-name").value.trim();
    if (!name) { el("exp-f-name").focus(); return; }
    var row = { name: name, type: modalCtx.type, icon: modalCtx.icon, color: modalCtx.color };
    var op;
    if (modalCtx.mode === "edit") {
      op = WfDb.update(CATS, modalCtx.record.id, row);
    } else {
      row.parent_id = modalCtx.parent ? modalCtx.parent.id : null;
      row.sort_order = state.categories.filter(function (c) {
        return c.type === row.type && (c.parent_id || null) === (row.parent_id || null);
      }).length;
      op = WfDb.insert(CATS, row);
    }
    return op.then(function () { closeModal(); return loadData(); });
  }

  function findCat(id) { return state.categories.find(function (c) { return c.id === id; }); }
  function findAcct(id) { return state.accounts.find(function (a) { return a.id === id; }); }

  // ── Delete ──────────────────────────────────────────────────────────────────
  function deleteCategory(id) {
    var cat = findCat(id);
    if (!cat) return;
    var subs = state.categories.filter(function (c) { return c.parent_id === id; });
    var msg = subs.length
      ? 'Delete "' + cat.name + '" and its ' + subs.length + ' subcategory(ies)?'
      : 'Delete "' + cat.name + '"?';
    if (!window.confirm(msg)) return;
    WfDb.remove(CATS, id).then(function () { return loadData(); }); // ON DELETE CASCADE removes subs
  }
  function deleteAccount(id) {
    var a = findAcct(id);
    if (!a) return;
    if (!window.confirm('Delete account "' + a.name + '"? Records on it will be kept but unlinked.')) return;
    WfDb.remove(ACCT, id).then(function () { return loadData(); });
  }

  // ── Wiring (once) ───────────────────────────────────────────────────────────
  function wireOnce() {
    if (wired) return;
    wired = true;

    SUBTABS.forEach(function (s) {
      var t = el(s.tab);
      if (t) t.addEventListener("click", function () { showSubTab(s.tab); });
    });

    var addAcct = el("exp-add-account-btn");
    if (addAcct) addAcct.addEventListener("click", function () { openAccountModal(null); });
    var addCat = el("exp-add-category-btn");
    if (addCat) addCat.addEventListener("click", function () { openCategoryModal(null, null, "expense"); });

    // Delegated actions on accounts list
    var accList = el("exp-accounts-list");
    if (accList) accList.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-act]"); if (!btn) return;
      var id = btn.getAttribute("data-id");
      if (btn.getAttribute("data-act") === "edit-acct") openAccountModal(findAcct(id));
      if (btn.getAttribute("data-act") === "del-acct") deleteAccount(id);
    });

    // Delegated actions on category groups
    ["exp-categories-expense", "exp-categories-income"].forEach(function (gid) {
      var g = el(gid);
      if (!g) return;
      g.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-act]"); if (!btn) return;
        var id = btn.getAttribute("data-id");
        var act = btn.getAttribute("data-act");
        if (act === "edit-cat") openCategoryModal(findCat(id));
        else if (act === "del-cat") deleteCategory(id);
        else if (act === "add-sub") openCategoryModal(null, findCat(id));
      });
    });

    // Modal controls
    el("exp-modal-close").addEventListener("click", closeModal);
    el("exp-modal-cancel").addEventListener("click", closeModal);
    el("exp-modal-overlay").addEventListener("click", function (e) {
      if (e.target === el("exp-modal-overlay")) closeModal();
    });
    el("exp-modal-save").addEventListener("click", function () {
      if (!modalCtx) return;
      if (modalCtx.kind === "account") saveAccount();
      else if (modalCtx.kind === "category") saveCategory();
    });
  }

  // ── Entry point (called by script.js when the Expense tab is shown) ─────────
  function onShow() {
    var gate = el("exp-signin-gate");
    var content = el("exp-content");
    if (!window.WfAuth || !WfAuth.isLoggedIn()) {
      if (gate) gate.hidden = false;
      if (content) content.hidden = true;
      return;
    }
    if (gate) gate.hidden = true;
    if (content) content.hidden = false;
    wireOnce();
    if (!state.loaded) loadData();
  }

  window.WfExpense = { onShow: onShow };
})();

// build: redeploy trigger

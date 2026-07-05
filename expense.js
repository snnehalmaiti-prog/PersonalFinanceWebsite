// Expense Manager — Phase 1: Accounts + Categories (in-app CRUD, Supabase-backed).
// Records, budgets and analytics arrive in later phases. Data is per-user via RLS.
(function () {
  "use strict";

  var ACCT = "expense_accounts";
  var CATS = "expense_categories";
  var PMS = "expense_payment_methods";

  var state = { accounts: [], categories: [], paymentMethods: [], loaded: false };

  var DEFAULT_PAYMENT_METHODS = [
    { name: "Cash", icon: "💵", color: "#10B981" },
    { name: "UPI", icon: "📲", color: "#6366F1" },
    { name: "Debit Card", icon: "💳", color: "#3B82F6" },
    { name: "Credit Card", icon: "💳", color: "#EF4444" },
    { name: "Netbanking", icon: "🏦", color: "#0EA5E9" },
    { name: "Wallet", icon: "👛", color: "#F97316" }
  ];
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

    var pmStatus = el("exp-payment-methods-status");
    if (pmStatus) pmStatus.textContent = "Loading…";
    return Promise.all([
      WfDb.select(ACCT, "select=*&order=sort_order.asc,created_at.asc"),
      WfDb.select(CATS, "select=*&order=sort_order.asc,created_at.asc"),
      WfDb.select(PMS, "select=*&order=sort_order.asc,created_at.asc")
    ]).then(function (res) {
      state.accounts = res[0] || [];
      state.categories = res[1] || [];
      state.paymentMethods = res[2] || [];
      state.loaded = true;

      // One-time migration: clear stored icon/color from all existing records
      var uid = WfAuth.getUserId();
      var migratedKey = "wf-exp-icons-cleared-" + uid;
      if (!localStorage.getItem(migratedKey)) {
        var clears = [];
        state.accounts.forEach(function (a) {
          if (a.icon || a.color) clears.push(WfDb.update(ACCT, a.id, { icon: null, color: null }));
        });
        state.paymentMethods.forEach(function (p) {
          if (p.icon || p.color) clears.push(WfDb.update(PMS, p.id, { icon: null, color: null }));
        });
        state.categories.forEach(function (c) {
          if (c.icon || c.color) clears.push(WfDb.update(CATS, c.id, { icon: null, color: null }));
        });
        if (clears.length) {
          return Promise.all(clears).then(function () {
            try { localStorage.setItem(migratedKey, "1"); } catch (e) {}
            return loadData();
          });
        }
        try { localStorage.setItem(migratedKey, "1"); } catch (e) {}
      }

      var seededKey = "wf-exp-seeded-" + uid;
      if (!state.categories.length && !localStorage.getItem(seededKey)) {
        return seedDefaults().then(function () {
          try { localStorage.setItem(seededKey, "1"); } catch (e) {}
          return loadData();
        });
      }
      renderAccounts();
      renderCategories();
      renderPaymentMethods();
    }).catch(function (err) {
      if (accStatus) accStatus.textContent = "Could not load: " + err.message;
      if (catStatus) catStatus.textContent = "Could not load: " + err.message;
      if (pmStatus) pmStatus.textContent = "Could not load: " + err.message;
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
    var seedPms = WfDb.insert(PMS, DEFAULT_PAYMENT_METHODS.map(function (p, i) {
      return { name: p.name, icon: p.icon, color: p.color, sort_order: i };
    }));
    return Promise.all([seedAcct, seedCats, seedPms]);
  }

  // Generic BudgetBakers-style row: circular icon, name, optional meta, chevron, kebab.
  function rowHtml(opts) {
    return '<div class="exp-row"' + (opts.clickable ? ' data-nav="' + opts.id + '"' : "") + '>' +
      '<span class="exp-row-name">' + esc(opts.name) +
        (opts.sub ? '<span class="exp-row-sub">' + esc(opts.sub) + '</span>' : "") + '</span>' +
      (opts.meta ? '<span class="exp-row-meta">' + esc(opts.meta) + '</span>' : "") +
      (opts.chevron ? '<span class="exp-row-chevron">›</span>' : "") +
      '<button type="button" class="exp-kebab" data-kebab="' + opts.kebab + '" data-id="' + opts.id + '" aria-label="More">⋮</button>' +
      '</div>';
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
      return rowHtml({ id: a.id, icon: a.icon, color: a.color, name: a.name,
        sub: typeLabel, meta: "Opening " + fmtMoney(a.initial_balance), kebab: "acct" });
    }).join("");
  }

  // ── Rendering: Payment methods ──────────────────────────────────────────────
  function renderPaymentMethods() {
    var list = el("exp-payment-methods-list");
    var status = el("exp-payment-methods-status");
    if (!list) return;
    if (!state.paymentMethods.length) {
      if (status) { status.hidden = false; status.textContent = "No payment methods yet — add your first one."; }
      list.innerHTML = "";
      return;
    }
    if (status) status.hidden = true;
    list.innerHTML = state.paymentMethods.map(function (p) {
      return rowHtml({ id: p.id, icon: p.icon, color: p.color, name: p.name, kebab: "pm" });
    }).join("");
  }

  function findPm(id) { return state.paymentMethods.find(function (p) { return p.id === id; }); }

  function openPaymentMethodModal(record) {
    modalCtx = { kind: "pm", id: record ? record.id : null,
      draft: {
        name: record ? record.name : "",
        icon: record ? record.icon : "💳",
        color: record ? record.color : "#6366F1",
        is_credit_card: record ? !!record.is_credit_card : false
      } };
    var d = modalCtx.draft;
    var body =
      '<label class="exp-field"><span>Name</span><input id="exp-pm-name" type="text" value="' + esc(d.name) + '" placeholder="e.g. UPI, Cash"/></label>' +
      '<label class="exp-field" style="flex-direction:row; align-items:center; gap:8px;">' +
        '<input type="checkbox" id="exp-pm-cc"' + (d.is_credit_card ? " checked" : "") + ' style="width:auto; margin:0;" />' +
        '<span style="margin:0;">Credit card</span>' +
      '</label>' +
      '';
    openModal(record ? "Edit payment method" : "Add payment method", body, modalCtx);
    wirePickers();
    el("exp-pm-name").addEventListener("input", function (e) { d.name = e.target.value; });
    el("exp-pm-cc").addEventListener("change", function (e) { d.is_credit_card = e.target.checked; });
  }

  function savePaymentMethod() {
    var d = modalCtx.draft;
    if (!d.name.trim()) return;
    var payload = { name: d.name.trim(), is_credit_card: !!d.is_credit_card };
    var p = modalCtx.id ? WfDb.update(PMS, modalCtx.id, payload)
      : WfDb.insert(PMS, Object.assign({ sort_order: state.paymentMethods.length }, payload));
    return p.then(function () { closeModal(); return loadData(); });
  }

  function deletePaymentMethod(id) {
    if (!confirm("Delete this payment method?")) return;
    WfDb.remove(PMS, id).then(function () { return loadData(); });
  }

  function paymentMethodMenu(id) {
    return [
      { label: "Edit", fn: function () { var p = findPm(id); if (p) openPaymentMethodModal(p); } },
      { label: "Delete", danger: true, fn: function () { deletePaymentMethod(id); } }
    ];
  }

  // ── Rendering: Categories (row list + drill-down into subcategories) ────────
  var catNav = { parentId: null }; // null = top-level list; else showing a category's subs

  function renderCategories() {
    var status = el("exp-categories-status");
    var body = el("exp-categories-body");
    var heading = el("exp-categories-heading");
    var addBtn = el("exp-add-category-btn");
    if (!body) return;

    if (!state.categories.length) {
      if (status) { status.hidden = false; status.textContent = "No categories yet — add your first category."; }
      if (heading) heading.textContent = "Categories";
      body.innerHTML = "";
      return;
    }
    if (status) status.hidden = true;

    if (catNav.parentId) {
      // Drill-down: show one category's subcategories
      var parent = findCat(catNav.parentId);
      if (!parent) { catNav.parentId = null; return renderCategories(); }
      if (heading) heading.innerHTML = '<button type="button" class="exp-back" id="exp-cat-back">‹ Categories</button> ' + esc(parent.name);
      if (addBtn) addBtn.textContent = "+ Add subcategory";
      var subs = state.categories.filter(function (c) { return c.parent_id === parent.id; });
      body.innerHTML = subs.length
        ? subs.map(function (s) { return rowHtml({ id: s.id, icon: s.icon, color: s.color, name: s.name, kebab: "cat" }); }).join("")
        : '<p class="muted small">No subcategories yet — add one.</p>';
      var back = el("exp-cat-back");
      if (back) back.addEventListener("click", function () { catNav.parentId = null; renderCategories(); });
      return;
    }

    // Top-level: grouped by expense / income / budget
    if (heading) heading.textContent = "Categories";
    if (addBtn) addBtn.textContent = "+ Add category";
    var html = "";
    [["expense", "Expense (outflow)"], ["income", "Income (inflow)"], ["budget", "Budget (inflow)"]].forEach(function (g) {
      var tops = state.categories.filter(function (c) { return c.type === g[0] && !c.parent_id; });
      if (!tops.length) return;
      html += '<h4 class="exp-group-title">' + g[1] + '</h4>';
      html += tops.map(function (cat) {
        if (g[0] === "expense") {
          var subCount = state.categories.filter(function (c) { return c.parent_id === cat.id; }).length;
          return rowHtml({ id: cat.id, icon: cat.icon, color: cat.color, name: cat.name,
            sub: subCount ? subCount + " subcategor" + (subCount > 1 ? "ies" : "y") : "",
            chevron: true, clickable: true, kebab: "cat" });
        }
        // Income + Budget: no subcategories, no drill-down chevron
        var meta = "";
        if (g[0] === "budget") {
          var acct = findAcct(cat.account_id);
          meta = acct ? acct.name : "No account";
        } else {
          meta = "All accounts";
        }
        return rowHtml({ id: cat.id, icon: cat.icon, color: cat.color, name: cat.name,
          meta: meta, kebab: "cat" });
      }).join("");
    });
    body.innerHTML = html;
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
      '<label class="exp-field" style="flex-direction:row; align-items:center; gap:8px;">' +
        '<input type="checkbox" id="exp-f-contrib"' + (r.contributing_account ? " checked" : "") + ' style="width:auto;" />' +
        '<span style="margin:0;">Contributing account</span>' +
      '</label>' +
      '';
    openModal(record ? "Edit account" : "Add account", html, ctx);
  }

  function saveAccount() {
    var name = el("exp-f-name").value.trim();
    if (!name) { el("exp-f-name").focus(); return; }
    var row = {
      name: name,
      type: el("exp-f-type").value,
      initial_balance: Number(el("exp-f-bal").value) || 0,
      contributing_account: el("exp-f-contrib").checked,
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
        '<button type="button" data-type="budget" class="' + (typeVal === "budget" ? "active" : "") + '">Budget</button>' +
        '</div></div>';
      // Account picker (shown only for budget)
      var acctOptions = '<option value="">— select —</option>' + state.accounts.map(function (a) {
        return '<option value="' + a.id + '"' + (record && record.account_id === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>';
      }).join("");
      html += '<div class="exp-field" id="exp-f-acct-field" style="display:' + (typeVal === "budget" ? "" : "none") + ';">' +
        '<span>Assigned account</span><select id="exp-f-acct" style="padding:8px 10px; border:1px solid #d1d5db; border-radius:6px; font-size:14px;">' + acctOptions + '</select></div>';
    } else {
      var pName = parent ? parent.name : (findCat(record.parent_id) || {}).name;
      html += '<div class="exp-field"><span>Under category</span><div class="exp-readonly">' + esc(pName || "") + '</div></div>';
    }
    html += '';
    ctx.type = typeVal;
    ctx.isSub = isSub;
    openModal(record ? "Edit category" : (isSub ? "Add subcategory" : "Add category"), html, ctx);
    // wire type toggle
    var tt = el("exp-f-type-toggle");
    if (tt) tt.addEventListener("click", function (e) {
      var b = e.target.closest("[data-type]"); if (!b) return;
      tt.querySelectorAll("[data-type]").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      modalCtx.type = b.getAttribute("data-type");
      var acctField = el("exp-f-acct-field");
      if (acctField) acctField.style.display = (modalCtx.type === "budget") ? "" : "none";
    });
  }

  function saveCategory() {
    var name = el("exp-f-name").value.trim();
    if (!name) { el("exp-f-name").focus(); return; }
    var row = { name: name, type: modalCtx.type };
    if (modalCtx.type === "budget") {
      var acctEl = el("exp-f-acct");
      row.account_id = acctEl ? (acctEl.value || null) : null;
    } else {
      row.account_id = null;
    }
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

  // ── Kebab (⋮) context menu ──────────────────────────────────────────────────
  var _kebabEl = null;
  function closeKebab() { if (_kebabEl) { _kebabEl.remove(); _kebabEl = null; } }

  function openKebab(anchor, items) {
    closeKebab();
    var menu = document.createElement("div");
    menu.className = "exp-kebab-menu";
    menu.innerHTML = items.map(function (it, i) {
      return '<button type="button" data-i="' + i + '"' + (it.danger ? ' class="danger"' : "") + '>' + esc(it.label) + '</button>';
    }).join("");
    document.body.appendChild(menu);
    var r = anchor.getBoundingClientRect();
    menu.style.top = (window.scrollY + r.bottom + 4) + "px";
    // right-align the menu to the kebab
    menu.style.left = (window.scrollX + r.right - menu.offsetWidth) + "px";
    menu.addEventListener("click", function (e) {
      var b = e.target.closest("[data-i]"); if (!b) return;
      var idx = Number(b.getAttribute("data-i"));
      closeKebab();
      if (items[idx] && items[idx].fn) items[idx].fn();
    });
    _kebabEl = menu;
  }

  function accountMenu(id) {
    return [
      { label: "Edit", fn: function () { openAccountModal(findAcct(id)); } },
      { label: "Delete", danger: true, fn: function () { deleteAccount(id); } }
    ];
  }
  function categoryMenu(id) {
    var cat = findCat(id);
    var items = [{ label: "Edit", fn: function () { openCategoryModal(findCat(id)); } }];
    if (cat && !cat.parent_id && cat.type === "expense") items.push({ label: "Add subcategory", fn: function () { openCategoryModal(null, findCat(id)); } });
    items.push({ label: "Delete", danger: true, fn: function () { deleteCategory(id); } });
    return items;
  }

  // ── Wiring (once) ───────────────────────────────────────────────────────────
  // ── Bulk CSV import ─────────────────────────────────────────────────────────
  function parseCsv(text) {
    var rows = [], row = [], cur = "", inQ = false, i, ch;
    text = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (i = 0; i < text.length; i++) {
      ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; } else { inQ = false; }
        } else { cur += ch; }
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ",") { row.push(cur); cur = ""; }
        else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
        else cur += ch;
      }
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (v) { return String(v).trim().length; }); });
  }

  function normDate(s) {
    s = String(s || "").trim().replace(/^"|"$/g, "");
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return s.replace(/\//g, "-");
    var m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (m) {
      var p1 = Number(m[1]), p2 = Number(m[2]), yr = m[3];
      var mm, dd;
      if (p1 > 12) { dd = p1; mm = p2; }        // DD/MM/YYYY
      else if (p2 > 12) { mm = p1; dd = p2; }   // M/D/YYYY (US)
      else { mm = p1; dd = p2; }                // ambiguous → assume M/D/YYYY
      if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
      return yr + "-" + String(mm).padStart(2, "0") + "-" + String(dd).padStart(2, "0");
    }
    var d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }

  function normName(s) {
    return String(s == null ? "" : s)
      .replace(/[\p{Extended_Pictographic}️]/gu, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }
  function findByName(list, name) {
    if (!name) return null;
    var n = normName(name);
    if (!n) return null;
    return list.find(function (x) { return normName(x.name) === n; }) || null;
  }

  function csvEscape(v) {
    var s = String(v == null ? "" : v);
    if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function downloadCategoriesCsv() {
    var rows = [["Type", "Category", "Subcategory", "Icon", "Color", "Account"]];
    var parents = state.categories.filter(function (c) { return !c.parent_id; })
      .slice().sort(function (a, b) {
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return String(a.name).localeCompare(String(b.name));
      });
    parents.forEach(function (p) {
      var acctName = p.account_id ? ((findAcct(p.account_id) || {}).name || "") : "";
      rows.push([p.type, p.name, "", p.icon || "", p.color || "", acctName]);
      var subs = state.categories.filter(function (c) { return c.parent_id === p.id; })
        .slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      subs.forEach(function (s) {
        rows.push([p.type, p.name, s.name, s.icon || "", s.color || "", acctName]);
      });
    });
    var csv = rows.map(function (r) { return r.map(csvEscape).join(","); }).join("\n") + "\n";
    var blob = new Blob([csv], { type: "text/csv" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var stamp = new Date().toISOString().slice(0, 10);
    a.href = url; a.download = "categories-" + stamp + ".csv"; a.click();
    URL.revokeObjectURL(url);
  }

  function downloadImportTemplate() {
    var csv = "Date,Type,Amount,Account,Category,Subcategory,Payment Method,Labels,Note\n" +
      '"2026-07-04","expense","900","Common","Entertainment","Movies","UPI","",""\n' +
      '"2026-07-04","budget","10000","Common","Common Budget","","","",""\n' +
      '"2026-07-01","income","10000","","Income","","","",""\n';
    var blob = new Blob([csv], { type: "text/csv" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "records-template.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  function importRecordsFromCsv(file) {
    var status = el("exp-import-status");
    var report = el("exp-import-report");
    if (report) report.innerHTML = "";
    var wrap = el("exp-import-progress-wrap");
    if (wrap) wrap.hidden = true;
    if (!file) return;
    if (!state.loaded) { status.textContent = "Please wait — expense data is still loading."; return; }
    status.textContent = "Reading " + file.name + "…";
    var reader = new FileReader();
    var autoCreate = !!(el("exp-import-autocreate") && el("exp-import-autocreate").checked);
    reader.onload = function () {
      try {
      var rows = parseCsv(String(reader.result || ""));
      if (rows.length < 2) { status.textContent = "CSV is empty."; return; }
      var header = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
      function idx(name) { return header.indexOf(name); }
      var iDate = idx("date"), iType = idx("type"), iAmt = idx("amount"),
          iAcct = idx("account"), iCat = idx("category"), iSub = idx("subcategory"),
          iPm = idx("payment method"), iLbl = idx("labels"), iNote = idx("note");
      if (iDate < 0 || iType < 0 || iAmt < 0) {
        status.textContent = "CSV header must include Date, Type, Amount.";
        return;
      }
      // ── Pre-import validation summary ────────────────────────────────────
      var vBody = el("exp-import-validation-body");
      var vPanel = el("exp-import-validation");
      var vConfirm = el("exp-import-confirm-btn");
      var vCancel = el("exp-import-cancel-btn");
      var scan = { total: 0, byType: { expense: 0, budget: 0, income: 0 }, badDate: 0, badType: 0, badAmount: 0,
        missingAccts: {}, missingCats: {}, missingSubs: {}, missingPms: {} };
      for (var vr = 1; vr < rows.length; vr++) {
        var vrow = rows[vr];
        scan.total++;
        var vDate = normDate(vrow[iDate]);
        var vType = String(vrow[iType] || "").trim().toLowerCase();
        var vAmt = Number(String(vrow[iAmt] || "").replace(/[₹,\s]/g, ""));
        if (!vDate) { scan.badDate++; continue; }
        if (["expense", "budget", "income"].indexOf(vType) < 0) { scan.badType++; continue; }
        if (!vAmt || vAmt <= 0) { scan.badAmount++; continue; }
        scan.byType[vType]++;
        var vAcctName = iAcct >= 0 ? String(vrow[iAcct] || "").trim() : "";
        if (vType !== "income" && vAcctName && !findByName(state.accounts, vAcctName)) {
          scan.missingAccts[vAcctName] = (scan.missingAccts[vAcctName] || 0) + 1;
        }
        var vCatName = iCat >= 0 ? String(vrow[iCat] || "").trim() : "";
        var vCat = vCatName ? findByName(state.categories.filter(function (c) { return c.type === vType && !c.parent_id; }), vCatName) : null;
        if (vType !== "income" && vCatName && !vCat) {
          var key = vType + " → " + vCatName;
          scan.missingCats[key] = (scan.missingCats[key] || 0) + 1;
        }
        var vSubName = iSub >= 0 ? String(vrow[iSub] || "").trim() : "";
        if (vSubName && vCat && !findByName(state.categories.filter(function (c) { return c.parent_id === vCat.id; }), vSubName)) {
          var sKey = vCatName + " → " + vSubName;
          scan.missingSubs[sKey] = (scan.missingSubs[sKey] || 0) + 1;
        }
        var vPmName = iPm >= 0 ? String(vrow[iPm] || "").trim() : "";
        if (vType === "expense" && vPmName && !findByName(state.paymentMethods, vPmName)) {
          scan.missingPms[vPmName] = (scan.missingPms[vPmName] || 0) + 1;
        }
      }
      function listBullets(obj, label) {
        var keys = Object.keys(obj);
        if (!keys.length) return "";
        var items = keys.map(function (k) { return "<li>" + esc(k) + " <span class=\"muted\">(" + obj[k] + " row" + (obj[k] > 1 ? "s" : "") + ")</span></li>"; }).join("");
        return "<div><strong>" + esc(label) + "</strong><ul style=\"margin:4px 0 8px 18px;\">" + items + "</ul></div>";
      }
      var missingAcctCount = Object.keys(scan.missingAccts).length;
      var missingCatCount = Object.keys(scan.missingCats).length;
      var missingSubCount = Object.keys(scan.missingSubs).length;
      var missingPmCount = Object.keys(scan.missingPms).length;
      var willAutoCreate = autoCreate && (missingCatCount || missingSubCount);
      var willBlock = missingAcctCount + missingPmCount + (autoCreate ? 0 : (missingCatCount + missingSubCount));
      var summary = "";
      summary += "<div><strong>" + scan.total + "</strong> data rows — "
        + scan.byType.expense + " expense, "
        + scan.byType.budget + " budget, "
        + scan.byType.income + " income."
        + (scan.badDate ? " <span style=\"color:#dc2626;\">" + scan.badDate + " bad date</span>." : "")
        + (scan.badType ? " <span style=\"color:#dc2626;\">" + scan.badType + " bad type</span>." : "")
        + (scan.badAmount ? " <span style=\"color:#dc2626;\">" + scan.badAmount + " bad amount</span>." : "")
        + "</div>";
      summary += listBullets(scan.missingAccts, "Missing Accounts (blocks import)");
      summary += listBullets(scan.missingCats, "Missing Categories" + (autoCreate ? " (will be auto-created)" : " (blocks import)"));
      summary += listBullets(scan.missingSubs, "Missing Subcategories" + (autoCreate ? " (will be auto-created)" : " (blocks import)"));
      summary += listBullets(scan.missingPms, "Missing Payment methods (blocks import)");
      if (!missingAcctCount && !missingCatCount && !missingSubCount && !missingPmCount && !scan.badDate && !scan.badType && !scan.badAmount) {
        summary += "<div style=\"color:#059669;\"><strong>All rows look valid ✓</strong></div>";
      }
      if (vBody) vBody.innerHTML = summary;
      if (vPanel) vPanel.hidden = false;
      status.textContent = "Validation complete. Review below and click Proceed to import.";
      var proceed = function () {
        if (vPanel) vPanel.hidden = true;
        status.textContent = "Starting import…";
        if (autoCreate) startAutoCreateThenImport(); else processRows();
      };
      var cancelFn = function () {
        if (vPanel) vPanel.hidden = true;
        status.textContent = "Import cancelled.";
      };
      if (vConfirm) vConfirm.onclick = proceed;
      if (vCancel) vCancel.onclick = cancelFn;
      return;

      // Auto-create missing categories / subcategories when requested
      function processRows() {
      var toInsert = [], errors = [];
      for (var r = 1; r < rows.length; r++) {
        var row = rows[r];
        var lineNo = r + 1;
        var date = normDate(row[iDate]);
        var type = String(row[iType] || "").trim().toLowerCase();
        var amt = Number(String(row[iAmt] || "").replace(/[₹,\s]/g, ""));
        if (!date) { errors.push("Line " + lineNo + ": bad date"); continue; }
        if (["expense", "budget", "income"].indexOf(type) < 0) { errors.push("Line " + lineNo + ": type must be expense/budget/income"); continue; }
        if (!amt || amt <= 0) { errors.push("Line " + lineNo + ": bad amount"); continue; }
        var acctName = iAcct >= 0 ? row[iAcct] : "";
        var acct = findByName(state.accounts, acctName);
        if (type !== "income" && !acct) { errors.push("Line " + lineNo + ": account \"" + acctName + "\" not found"); continue; }
        var catName = iCat >= 0 ? row[iCat] : "";
        var catCandidates = state.categories.filter(function (c) { return c.type === type && !c.parent_id; });
        var cat = findByName(catCandidates, catName);
        if (type !== "income" && catName && !cat) {
          var avail = catCandidates.map(function (c) { return c.name; }).join(", ") || "(none)";
          errors.push("Line " + lineNo + ": category \"" + catName + "\" not found under type " + type + ". Available: " + avail);
          continue;
        }
        var subName = iSub >= 0 ? row[iSub] : "";
        var sub = null;
        if (subName && cat) {
          sub = findByName(state.categories.filter(function (c) { return c.parent_id === cat.id; }), subName);
          if (!sub) { errors.push("Line " + lineNo + ": subcategory \"" + subName + "\" not found under " + cat.name); continue; }
        }
        var pmName = iPm >= 0 ? row[iPm] : "";
        var pm = findByName(state.paymentMethods, pmName);
        if (type === "expense" && pmName && !pm) { errors.push("Line " + lineNo + ": payment method \"" + pmName + "\" not found"); continue; }
        var labels = [];
        if (iLbl >= 0 && String(row[iLbl] || "").trim()) {
          labels = String(row[iLbl]).split(/[|;,]/).map(function (s) { return s.trim(); }).filter(Boolean);
        }
        var txnAtIso;
        try {
          var d0 = new Date(date + "T00:00:00");
          if (isNaN(d0.getTime())) d0 = new Date(date);
          if (isNaN(d0.getTime())) { errors.push("Line " + lineNo + ": could not parse date \"" + row[iDate] + "\""); continue; }
          txnAtIso = d0.toISOString();
        } catch (e) {
          errors.push("Line " + lineNo + ": bad date \"" + row[iDate] + "\"");
          continue;
        }
        toInsert.push({
          txn_date: date,
          txn_at: txnAtIso,
          amount: amt,
          type: type,
          account_id: type === "income" ? null : acct.id,
          category_id: cat ? cat.id : null,
          subcategory_id: sub ? sub.id : null,
          payment_method_id: pm ? pm.id : null,
          note: iNote >= 0 ? String(row[iNote] || "") : "",
          labels: labels
        });
      }
      if (!toInsert.length) {
        status.textContent = "No valid rows to import.";
        if (report && errors.length) report.innerHTML = '<p class="muted small" style="color:#dc2626;">' + errors.map(esc).join("<br>") + '</p>';
        return;
      }
      var total = toInsert.length;
      status.textContent = "Importing " + total + " records…";
      var progWrap = el("exp-import-progress-wrap");
      var progBar = el("exp-import-progress-bar");
      var progLabel = el("exp-import-progress-label");
      if (progWrap) progWrap.hidden = false;
      if (progBar) progBar.style.width = "0%";
      if (progLabel) progLabel.textContent = "0 / " + total + " (0%)";
      var results = [], done = 0, okRunning = 0, failRunning = 0;
      function updateProgress() {
        var pct = total ? Math.round((done / total) * 100) : 0;
        if (progBar) progBar.style.width = pct + "%";
        if (progLabel) progLabel.textContent = done + " / " + total + " (" + pct + "%) — " + okRunning + " ok" + (failRunning ? ", " + failRunning + " failed" : "");
      }
      function next(i) {
        if (i >= total) {
          var okCount = results.filter(function (x) { return x.ok; }).length;
          var failCount = results.length - okCount;
          status.textContent = "Imported " + okCount + " record(s)" + (failCount ? " — " + failCount + " failed" : "") + ".";
          if (progBar) progBar.style.width = "100%";
          if (progLabel) progLabel.textContent = total + " / " + total + " (100%) — " + okCount + " ok" + (failCount ? ", " + failCount + " failed" : "");
          var extra = results.filter(function (x) { return !x.ok; }).map(function (x) { return "Row " + x.line + ": " + x.err; });
          var all = errors.concat(extra);
          if (report) report.innerHTML = all.length ? '<p class="muted small" style="color:#dc2626;">' + all.map(esc).join("<br>") + '</p>' : "";
          return;
        }
        WfDb.insert("expense_records", toInsert[i])
          .then(function () { results.push({ ok: true }); okRunning++; })
          .catch(function (e) { results.push({ ok: false, line: i + 2, err: (e && e.message) || String(e) }); failRunning++; })
          .then(function () {
            done++;
            status.textContent = "Importing " + done + " / " + total + "…";
            updateProgress();
            next(i + 1);
          });
      }
      next(0);
      }

      function startAutoCreateThenImport() {
        status.textContent = "Preparing categories…";
        var wantCats = {}, wantSubs = {};
        for (var rr = 1; rr < rows.length; rr++) {
          var rw = rows[rr];
          var tt = String(rw[iType] || "").trim().toLowerCase();
          if (["expense", "budget", "income"].indexOf(tt) < 0) continue;
          if (tt === "income") continue;
          var cn = iCat >= 0 ? String(rw[iCat] || "").trim() : "";
          if (!cn) continue;
          var existing = findByName(state.categories.filter(function (c) { return c.type === tt && !c.parent_id; }), cn);
          var key = tt + "::" + normName(cn);
          if (!existing) wantCats[key] = { type: tt, name: cn };
          var sn = iSub >= 0 ? String(rw[iSub] || "").trim() : "";
          if (sn) {
            var subKey = key + "::" + normName(sn);
            wantSubs[subKey] = { type: tt, parentName: cn, name: sn };
          }
        }
        var catList = Object.keys(wantCats).map(function (k) { return wantCats[k]; });
        var chain = Promise.resolve();
        catList.forEach(function (c) {
          chain = chain.then(function () {
            return WfDb.insert(CATS, {
              type: c.type, name: c.name,
              icon: c.type === "budget" ? "🎯" : "🏷️",
              color: COLORS[state.categories.length % COLORS.length],
              parent_id: null,
              sort_order: state.categories.filter(function (x) { return x.type === c.type && !x.parent_id; }).length
            }).then(function (rows) {
              if (rows && rows[0]) state.categories.push(rows[0]);
            });
          });
        });
        chain = chain.then(function () {
          var subList = Object.keys(wantSubs).map(function (k) { return wantSubs[k]; });
          var sc = Promise.resolve();
          subList.forEach(function (s) {
            sc = sc.then(function () {
              var parent = findByName(state.categories.filter(function (c) { return c.type === s.type && !c.parent_id; }), s.parentName);
              if (!parent) return;
              var already = findByName(state.categories.filter(function (c) { return c.parent_id === parent.id; }), s.name);
              if (already) return;
              return WfDb.insert(CATS, {
                type: s.type, name: s.name,
                icon: "•", color: parent.color || "#6B7280",
                parent_id: parent.id,
                sort_order: state.categories.filter(function (c) { return c.parent_id === parent.id; }).length
              }).then(function (rows) {
                if (rows && rows[0]) state.categories.push(rows[0]);
              });
            });
          });
          return sc;
        }).then(function () {
          renderCategories();
          processRows();
        }).catch(function (e) {
          status.textContent = "Auto-create failed: " + ((e && e.message) || String(e));
        });
      }
      } catch (err) {
        status.textContent = "Import failed: " + ((err && err.message) || String(err));
        if (window.console) console.error("[csv import]", err);
      }
    };
    reader.onerror = function () { status.textContent = "Failed to read file."; };
    reader.readAsText(file);
  }

  function wireOnce() {
    if (wired) return;
    wired = true;

    SUBTABS.forEach(function (s) {
      var t = el(s.tab);
      if (t) t.addEventListener("click", function () { showSubTab(s.tab); });
    });

    // Expense sub-tabs (Accounts / Records / Analytics)
    document.querySelectorAll(".exp-subtab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var key = btn.getAttribute("data-exp-subtab");
        document.querySelectorAll(".exp-subtab").forEach(function (b) {
          var active = b === btn;
          b.classList.toggle("active", active);
          b.setAttribute("aria-selected", String(active));
        });
        ["accounts", "records", "analytics"].forEach(function (k) {
          var panel = el("exp-subpanel-" + k);
          if (panel) panel.hidden = (k !== key);
        });
      });
    });

    var addAcct = el("exp-add-account-btn");
    if (addAcct) addAcct.addEventListener("click", function () { openAccountModal(null); });
    var addPm = el("exp-add-payment-method-btn");
    if (addPm) addPm.addEventListener("click", function () { openPaymentMethodModal(null); });
    var dlCats = el("exp-download-categories-btn");
    if (dlCats) dlCats.addEventListener("click", downloadCategoriesCsv);
    var tplBtn = el("exp-import-template-btn");
    if (tplBtn) tplBtn.addEventListener("click", downloadImportTemplate);
    var impFile = el("exp-import-file");
    if (impFile) impFile.addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      importRecordsFromCsv(f);
      e.target.value = "";
    });

    var addCat = el("exp-add-category-btn");
    if (addCat) addCat.addEventListener("click", function () {
      if (catNav.parentId) openCategoryModal(null, findCat(catNav.parentId)); // add subcategory
      else openCategoryModal(null, null, "expense");
    });

    // Accounts list: kebab menu only (no drill-down)
    var accList = el("exp-accounts-list");
    if (accList) accList.addEventListener("click", function (e) {
      var kb = e.target.closest("[data-kebab]");
      if (kb) { openKebab(kb, accountMenu(kb.getAttribute("data-id"))); return; }
    });

    // Payment methods list: kebab menu only
    var pmList = el("exp-payment-methods-list");
    if (pmList) pmList.addEventListener("click", function (e) {
      var kb = e.target.closest("[data-kebab]");
      if (kb) { openKebab(kb, paymentMethodMenu(kb.getAttribute("data-id"))); return; }
    });

    // Categories body: row drill-down + kebab menu
    var catBody = el("exp-categories-body");
    if (catBody) catBody.addEventListener("click", function (e) {
      var kb = e.target.closest("[data-kebab]");
      if (kb) { e.stopPropagation(); openKebab(kb, categoryMenu(kb.getAttribute("data-id"))); return; }
      var row = e.target.closest("[data-nav]");
      if (row) { catNav.parentId = row.getAttribute("data-nav"); renderCategories(); }
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
      else if (modalCtx.kind === "pm") savePaymentMethod();
    });

    // Close the kebab menu on outside click / scroll / escape
    document.addEventListener("click", function (e) {
      if (_kebabEl && !e.target.closest(".exp-kebab-menu") && !e.target.closest("[data-kebab]")) closeKebab();
    });
    window.addEventListener("scroll", closeKebab, true);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeKebab(); });
  }

  var _authMode = "signin";
  var _authWired = false;

  function wireAuthOnce() {
    if (_authWired) return;
    _authWired = true;
    var form = el("exp-auth-form");
    var toggle = el("exp-auth-toggle");
    var errEl = el("exp-auth-error");
    if (!form) return;
    toggle.addEventListener("click", function (e) {
      e.preventDefault();
      _authMode = _authMode === "signin" ? "signup" : "signin";
      el("exp-auth-title").textContent = _authMode === "signin" ? "Sign in" : "Create account";
      el("exp-auth-submit").textContent = _authMode === "signin" ? "Sign in" : "Create account";
      el("exp-auth-toggle-prompt").textContent = _authMode === "signin" ? "No account?" : "Already have one?";
      toggle.textContent = _authMode === "signin" ? "Create one" : "Sign in";
      errEl.textContent = "";
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      errEl.textContent = "";
      var email = el("exp-auth-email").value.trim();
      var pw = el("exp-auth-password").value;
      var btn = el("exp-auth-submit");
      btn.disabled = true;
      var origText = btn.textContent;
      btn.textContent = _authMode === "signin" ? "Signing in…" : "Creating…";
      var p = _authMode === "signin" ? WfAuth.signIn(email, pw) : WfAuth.signUp(email, pw);
      p.then(function () {
        btn.disabled = false;
        btn.textContent = origText;
        onShow();
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = origText;
        errEl.textContent = (err && err.message) || "Something went wrong. Please try again.";
      });
    });
  }

  // ── Entry point (called by script.js when the Expense tab is shown) ─────────
  function onShow() {
    var gate = el("exp-signin-gate");
    var content = el("exp-content");
    if (!window.WfAuth || !WfAuth.isLoggedIn()) {
      if (gate) gate.hidden = false;
      if (content) content.hidden = true;
      wireAuthOnce();
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















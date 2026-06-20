(function () {
  "use strict";

  // ===== Theme toggle =====
  var root = document.documentElement;
  var themeToggle = document.getElementById("theme-toggle");
  var storedTheme = localStorage.getItem("wf-theme");
  var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  function applyTheme(theme) {
    if (theme === "dark") {
      root.setAttribute("data-theme", "dark");
      themeToggle.setAttribute("aria-pressed", "true");
    } else {
      root.removeAttribute("data-theme");
      themeToggle.setAttribute("aria-pressed", "false");
    }
  }

  applyTheme(storedTheme || (prefersDark ? "dark" : "light"));

  themeToggle.addEventListener("click", function () {
    var isDark = root.getAttribute("data-theme") === "dark";
    var next = isDark ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem("wf-theme", next);
  });

  // ===== Mobile menu =====
  var menuToggle = document.getElementById("menu-toggle");
  var mobileNav = document.getElementById("mobile-nav");

  if (menuToggle && mobileNav) {
    menuToggle.addEventListener("click", function () {
      var open = mobileNav.classList.toggle("open");
      menuToggle.classList.toggle("open", open);
      menuToggle.setAttribute("aria-expanded", String(open));
      menuToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });

    mobileNav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        mobileNav.classList.remove("open");
        menuToggle.classList.remove("open");
        menuToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  // ===== Scroll-reveal animation =====
  var animatedEls = document.querySelectorAll("[data-animate]");
  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            var el = entry.target;
            var delay = el.getAttribute("data-delay");
            if (delay) el.style.transitionDelay = delay + "ms";
            el.classList.add("in-view");
            observer.unobserve(el);
          }
        });
      },
      { threshold: 0.15 }
    );
    animatedEls.forEach(function (el) { observer.observe(el); });
  } else {
    animatedEls.forEach(function (el) { el.classList.add("in-view"); });
  }

  // ===== Animated counters =====
  var counters = document.querySelectorAll("[data-counter]");
  function animateCounter(el) {
    var target = parseInt(el.getAttribute("data-counter"), 10);
    var duration = 1400;
    var start = null;

    function step(timestamp) {
      if (!start) start = timestamp;
      var progress = Math.min((timestamp - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(eased * target);
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  if ("IntersectionObserver" in window) {
    var counterObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            animateCounter(entry.target);
            counterObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.5 }
    );
    counters.forEach(function (el) { counterObserver.observe(el); });
  } else {
    counters.forEach(animateCounter);
  }

  // ===== Login modal =====
  var loginOverlay = document.getElementById("login-overlay");
  var openLoginBtn = document.getElementById("open-login");
  var openLoginMobileBtn = document.getElementById("open-login-mobile");
  var closeLoginBtn = document.getElementById("close-login");
  var tabLogin = document.getElementById("tab-login");
  var tabSignup = document.getElementById("tab-signup");
  var loginHeading = document.querySelector(".modal-heading");
  var loginSub = document.querySelector(".modal-sub");
  var lastFocusedEl = null;

  function openModal() {
    lastFocusedEl = document.activeElement;
    loginOverlay.hidden = false;
    document.body.style.overflow = "hidden";
    closeLoginBtn.focus();
  }

  function closeModal() {
    loginOverlay.hidden = true;
    document.body.style.overflow = "";
    if (lastFocusedEl) lastFocusedEl.focus();
  }

  function setMode(mode) {
    var isLogin = mode === "login";
    tabLogin.classList.toggle("active", isLogin);
    tabSignup.classList.toggle("active", !isLogin);
    tabLogin.setAttribute("aria-selected", String(isLogin));
    tabSignup.setAttribute("aria-selected", String(!isLogin));
    loginHeading.textContent = isLogin ? "Welcome back" : "Create your account";
    loginSub.textContent = isLogin ? "Access your portfolio dashboard" : "Start tracking your investments in minutes";
  }

  if (openLoginBtn) {
    openLoginBtn.addEventListener("click", openModal);
    if (openLoginMobileBtn) {
      openLoginMobileBtn.addEventListener("click", function () {
        mobileNav.classList.remove("open");
        menuToggle.classList.remove("open");
        menuToggle.setAttribute("aria-expanded", "false");
        openModal();
      });
    }
    closeLoginBtn.addEventListener("click", closeModal);
    loginOverlay.addEventListener("click", function (e) {
      if (e.target === loginOverlay) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !loginOverlay.hidden) closeModal();
    });
    tabLogin.addEventListener("click", function () { setMode("login"); });
    tabSignup.addEventListener("click", function () { setMode("signup"); });

    document.getElementById("google-login").addEventListener("click", function () {
      window.location.href = "dashboard.html";
    });

    document.getElementById("login-form").addEventListener("submit", function (e) {
      e.preventDefault();
      window.location.href = "dashboard.html";
    });
  }

  // ===== Settings tabs =====
  var settingsTabProfile = document.getElementById("tab-profile");
  var settingsTabTransactions = document.getElementById("tab-transactions");
  var settingsTabMapping = document.getElementById("tab-mapping");
  if (settingsTabProfile && settingsTabTransactions) {
    var settingsTabs = [
      { tab: settingsTabProfile, panel: document.getElementById("panel-profile"), key: "profile" },
      { tab: settingsTabTransactions, panel: document.getElementById("panel-transactions"), key: "transactions" },
      { tab: settingsTabMapping, panel: document.getElementById("panel-mapping"), key: "mapping" }
    ];

    function showSettingsTab(tab) {
      settingsTabs.forEach(function (entry) {
        if (!entry.tab) return;
        var isActive = entry.key === tab;
        entry.tab.classList.toggle("active", isActive);
        entry.tab.setAttribute("aria-selected", String(isActive));
        entry.panel.hidden = !isActive;
      });
    }

    settingsTabs.forEach(function (entry) {
      if (!entry.tab) return;
      entry.tab.addEventListener("click", function () { showSettingsTab(entry.key); });
    });
  }

  // ===== Dashboard tabs =====
  var dashTabOverview = document.getElementById("tab-overview");
  var dashTabEquity = document.getElementById("tab-equity");
  var dashTabFixedIncome = document.getElementById("tab-fixedincome");
  if (dashTabOverview && dashTabEquity) {
    var panelOverview = document.getElementById("panel-overview");
    var panelEquity = document.getElementById("panel-equity");
    var panelFixedIncome = document.getElementById("panel-fixedincome");
    var dashTabs = [
      { tab: dashTabOverview, panel: panelOverview, key: "overview" },
      { tab: dashTabEquity, panel: panelEquity, key: "equity" },
      { tab: dashTabFixedIncome, panel: panelFixedIncome, key: "fixedincome" }
    ];

    function showDashboardTab(tab) {
      dashTabs.forEach(function (entry) {
        if (!entry.tab) return;
        var isActive = entry.key === tab;
        entry.tab.classList.toggle("active", isActive);
        entry.tab.setAttribute("aria-selected", String(isActive));
        entry.panel.hidden = !isActive;
      });
    }

    dashTabs.forEach(function (entry) {
      if (!entry.tab) return;
      entry.tab.addEventListener("click", function () { showDashboardTab(entry.key); });
    });
  }

  // ===== Portfolio selector =====
  var PORTFOLIO_NAMES_KEY = "wf-portfolio-names";
  var SELECTED_PORTFOLIO_KEY = "wf-selected-portfolio";

  function getStoredPortfolioNames() {
    try {
      return JSON.parse(localStorage.getItem(PORTFOLIO_NAMES_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function selectPortfolio(value, label) {
    localStorage.setItem(SELECTED_PORTFOLIO_KEY, value);
    var portfolioLabel = document.getElementById("portfolio-label");
    if (portfolioLabel) portfolioLabel.textContent = label;
    updateDashboardStats();
  }

  function parseNumber(value) {
    var cleaned = String(value == null ? "" : value).replace(/[^0-9.-]/g, "");
    return parseFloat(cleaned) || 0;
  }

  function normalizeText(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim().toLowerCase();
  }

  function sumInvestmentForRows(rows, portfolioFilter) {
    if (!rows || !rows.length) return 0;
    var header = rows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var typeIdx = header.indexOf("transaction type");
    var valueIdx = header.indexOf("value");
    if (portfolioIdx === -1 || typeIdx === -1 || valueIdx === -1) return 0;

    var total = 0;
    rows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && portfolio.toLowerCase() !== portfolioFilter.toLowerCase()) return;
      var type = (row[typeIdx] || "").trim().toLowerCase();
      var value = parseNumber(row[valueIdx]);
      total += type.indexOf("sell") !== -1 ? -value : value;
    });
    return total;
  }

  function sumEquityBuyInvestment(rows, portfolioFilter) {
    if (!rows || !rows.length) return 0;
    var header = rows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var typeIdx = header.indexOf("transaction type");
    var categoryIdx = header.indexOf("instrument category");
    var unitsIdx = header.indexOf("units");
    var priceIdx = header.indexOf("price");
    if (portfolioIdx === -1 || typeIdx === -1 || categoryIdx === -1 || unitsIdx === -1 || priceIdx === -1) return 0;

    var total = 0;
    rows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && normalizeText(portfolio) !== normalizeText(portfolioFilter)) return;
      var category = normalizeText(row[categoryIdx]);
      var type = normalizeText(row[typeIdx]);
      if (category.indexOf("equity") === -1 || type.indexOf("buy") === -1) return;
      var units = parseNumber(row[unitsIdx]);
      var price = parseNumber(row[priceIdx]);
      total += units * price;
    });
    return total;
  }

  function getSheetRows(prefix) {
    var raw = localStorage.getItem("wf-" + prefix + "-data");
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function computeTotalInvestment(portfolioFilter, prefixes) {
    var total = 0;
    prefixes.forEach(function (prefix) {
      var rows = getSheetRows(prefix);
      if (!rows) return;
      total += prefix === "equity"
        ? sumEquityBuyInvestment(rows, portfolioFilter)
        : sumInvestmentForRows(rows, portfolioFilter);
    });
    return total;
  }

  function buildSyncDiagnostics(prefix, rows) {
    if (prefix !== "equity" && prefix !== "fixedincome") return "";
    var header = rows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var typeIdx = header.indexOf("transaction type");
    var valueIdx = header.indexOf("value");
    var categoryIdx = header.indexOf("instrument category");
    var unitsIdx = header.indexOf("units");
    var priceIdx = header.indexOf("price");

    var requiredIdx = prefix === "equity"
      ? { "portfolio name": portfolioIdx, "transaction type": typeIdx, "instrument category": categoryIdx, units: unitsIdx, price: priceIdx }
      : { "portfolio name": portfolioIdx, "transaction type": typeIdx, value: valueIdx };

    var missing = Object.keys(requiredIdx).filter(function (key) { return requiredIdx[key] === -1; });
    if (missing.length) {
      return "Synced " + (rows.length - 1) + " rows, but couldn't find column(s): " + missing.join(", ") + ". Check the header row number and exact column names.";
    }

    var matched = 0;
    rows.slice(1).forEach(function (row) {
      if (prefix === "equity") {
        var category = normalizeText(row[categoryIdx]);
        var type = normalizeText(row[typeIdx]);
        if (category.indexOf("equity") !== -1 && type.indexOf("buy") !== -1) matched += 1;
      } else {
        matched += 1;
      }
    });

    var total = prefix === "equity"
      ? sumEquityBuyInvestment(rows, "all")
      : sumInvestmentForRows(rows, "all");

    return "Synced " + (rows.length - 1) + " rows. " + matched + " row(s) counted toward Total Investment. Computed total: " + formatCurrency(total) + ".";
  }

  function formatCurrency(amount) {
    var sign = amount < 0 ? "-" : "";
    return sign + "₹" + Math.abs(amount).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  }

  function updateDashboardStats() {
    var overviewEl = document.getElementById("overview-total-investment");
    var equityEl = document.getElementById("equity-total-investment");
    var fixedIncomeEl = document.getElementById("fixedincome-total-investment");
    if (!overviewEl && !equityEl && !fixedIncomeEl) return;
    var selected = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
    if (overviewEl) overviewEl.textContent = formatCurrency(computeTotalInvestment(selected, ["equity", "fixedincome"]));
    if (equityEl) equityEl.textContent = formatCurrency(computeTotalInvestment(selected, ["equity"]));
    if (fixedIncomeEl) fixedIncomeEl.textContent = formatCurrency(computeTotalInvestment(selected, ["fixedincome"]));
  }

  function updateRefreshButtonStatus() {
    var refreshBtn = document.getElementById("refresh-all");
    if (!refreshBtn) return;
    var connectedCount = ["equity", "fixedincome"].filter(function (prefix) {
      return !!getSheetRows(prefix);
    }).length;

    refreshBtn.classList.remove("status-connected", "status-partial", "status-disconnected");
    if (connectedCount === 2) refreshBtn.classList.add("status-connected");
    else if (connectedCount === 0) refreshBtn.classList.add("status-disconnected");
    else refreshBtn.classList.add("status-partial");
  }

  function populatePortfolioSelect() {
    var menu = document.getElementById("portfolio-menu");
    if (!menu) return;
    var names = getStoredPortfolioNames();
    var selected = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
    if (selected !== "all" && names.indexOf(selected) === -1) selected = "all";

    menu.innerHTML = "";
    var allItems = [{ value: "all", label: "All Portfolios" }].concat(
      names.map(function (name) { return { value: name, label: name }; })
    );

    allItems.forEach(function (item) {
      var li = document.createElement("li");
      li.setAttribute("role", "option");
      li.dataset.value = item.value;
      li.textContent = item.label;
      var isSelected = item.value === selected;
      li.className = "portfolio-option" + (isSelected ? " selected" : "");
      li.setAttribute("aria-selected", String(isSelected));
      li.addEventListener("click", function () {
        selectPortfolio(item.value, item.label);
        populatePortfolioSelect();
        closePortfolioMenu();
      });
      menu.appendChild(li);
    });

    var selectedItem = allItems.filter(function (item) { return item.value === selected; })[0];
    if (selectedItem) selectPortfolio(selectedItem.value, selectedItem.label);
  }

  function addPortfolioNames(names) {
    if (!names || !names.length) return;
    var existing = getStoredPortfolioNames();
    names.forEach(function (name) {
      if (name && existing.indexOf(name) === -1) existing.push(name);
    });
    localStorage.setItem(PORTFOLIO_NAMES_KEY, JSON.stringify(existing));
    populatePortfolioSelect();
  }

  var portfolioToggle = document.getElementById("portfolio-toggle");
  var portfolioMenu = document.getElementById("portfolio-menu");

  function closePortfolioMenu() {
    if (!portfolioMenu) return;
    portfolioMenu.hidden = true;
    portfolioToggle.setAttribute("aria-expanded", "false");
  }

  function openPortfolioMenu() {
    if (!portfolioMenu) return;
    portfolioMenu.hidden = false;
    portfolioToggle.setAttribute("aria-expanded", "true");
  }

  updateDashboardStats();

  var refreshAllBtn = document.getElementById("refresh-all");
  if (refreshAllBtn) {
    refreshAllBtn.addEventListener("click", function () {
      var prefixes = ["equity", "fixedincome"];
      var pending = 0;

      function done() {
        pending -= 1;
        if (pending <= 0) {
          refreshAllBtn.classList.remove("spinning");
          updateDashboardStats();
          updateRefreshButtonStatus();
        }
      }

      prefixes.forEach(function (prefix) {
        var url = localStorage.getItem("wf-" + prefix + "-sheet-link");
        if (!url) return;
        var parsed = parseSheetUrl(url);
        if (!parsed) return;
        pending += 1;
        refreshAllBtn.classList.add("spinning");
        fetchSheetJSONP(
          parsed.id,
          parsed.gid,
          function (data) {
            var rows = gvizRowsFromResponse(data);
            if (rows.length > 1) {
              addPortfolioNames(extractColumnValues(rows, "Portfolio Name"));
              localStorage.setItem("wf-" + prefix + "-data", JSON.stringify(rows));
            }
            done();
          },
          done,
          localStorage.getItem("wf-" + prefix + "-header-row") || 1
        );
      });

      if (pending === 0) updateDashboardStats();
    });
  }

  updateRefreshButtonStatus();

  if (portfolioToggle && portfolioMenu) {
    populatePortfolioSelect();

    portfolioToggle.addEventListener("click", function (e) {
      e.stopPropagation();
      if (portfolioMenu.hidden) openPortfolioMenu();
      else closePortfolioMenu();
    });

    document.addEventListener("click", function (e) {
      if (!portfolioMenu.hidden && !portfolioMenu.contains(e.target) && e.target !== portfolioToggle) {
        closePortfolioMenu();
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !portfolioMenu.hidden) {
        closePortfolioMenu();
        portfolioToggle.focus();
      }
    });
  }

  // ===== Google Sheet transaction cards (Equity, Fixed Income, etc.) =====
  function parseSheetUrl(url) {
    var idMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!idMatch) return null;
    var gidMatch = url.match(/[#&?]gid=([0-9]+)/);
    return { id: idMatch[1], gid: gidMatch ? gidMatch[1] : "0" };
  }

  function gvizRowsFromResponse(data) {
    var cols = data.table.cols.map(function (c) { return c.label || c.id || ""; });
    var rows = [cols];
    (data.table.rows || []).forEach(function (r) {
      var row = (r.c || []).map(function (cell) {
        if (!cell) return "";
        if (cell.f != null) return cell.f;
        return cell.v != null ? String(cell.v) : "";
      });
      rows.push(row);
    });
    return rows;
  }

  function fetchSheetJSONP(id, gid, onData, onError, headerRow) {
    var callbackName = "__wfSheetCallback_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
    var script = document.createElement("script");
    var timeoutId;

    function cleanup() {
      clearTimeout(timeoutId);
      delete window[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[callbackName] = function (data) {
      cleanup();
      if (data.status === "error") {
        onError();
      } else {
        onData(data);
      }
    };

    script.onerror = function () {
      cleanup();
      onError();
    };

    var rangeParam = "";
    var startRow = parseInt(headerRow, 10);
    if (startRow > 1) {
      rangeParam = "&range=A" + startRow + "%3AZZ";
    }

    script.src =
      "https://docs.google.com/spreadsheets/d/" + id +
      "/gviz/tq?gid=" + gid + rangeParam +
      "&tqx=out:json;responseHandler:" + callbackName;

    timeoutId = setTimeout(function () {
      cleanup();
      onError();
    }, 12000);

    document.head.appendChild(script);
  }

  function filterColumns(rows, allowedFields) {
    if (!allowedFields) return rows;
    var header = rows[0];
    var normalized = header.map(function (h) { return h.trim().toLowerCase(); });
    var indices = allowedFields
      .map(function (field) { return normalized.indexOf(field.toLowerCase()); })
      .filter(function (i) { return i !== -1; });

    return rows.map(function (row) {
      return indices.map(function (i) { return row[i]; });
    });
  }

  function extractColumnValues(rows, fieldName) {
    var header = rows[0];
    var normalized = header.map(function (h) { return h.trim().toLowerCase(); });
    var index = normalized.indexOf(fieldName.toLowerCase());
    if (index === -1) return [];

    var values = [];
    rows.slice(1).forEach(function (row) {
      var value = (row[index] || "").trim();
      if (value && values.indexOf(value) === -1) values.push(value);
    });
    return values;
  }

  function initSheetCard(prefix, options) {
    options = options || {};
    var sheetLinkInput = document.getElementById(prefix + "-sheet-link");
    if (!sheetLinkInput) return;

    var sheetSaveBtn = document.getElementById(prefix + "-sheet-save");
    var sheetSyncBtn = document.getElementById(prefix + "-sheet-sync");
    var sheetStatus = document.getElementById(prefix + "-sheet-status");
    var sheetTableWrap = document.getElementById(prefix + "-sheet-table-wrap");
    var sheetTable = document.getElementById(prefix + "-sheet-table");
    var statusPill = document.getElementById(prefix + "-status-pill");
    var meta = document.getElementById(prefix + "-meta");
    var lastSync = document.getElementById(prefix + "-last-sync");
    var rowCountEl = document.getElementById(prefix + "-row-count");
    var openSheetLink = document.getElementById(prefix + "-open-sheet");
    var headerRowInput = document.getElementById(prefix + "-header-row");
    var storageKey = "wf-" + prefix + "-sheet-link";
    var headerRowKey = "wf-" + prefix + "-header-row";

    function renderTable(rows) {
      sheetTable.innerHTML = "";
      if (!rows.length) return;
      var thead = document.createElement("thead");
      var headRow = document.createElement("tr");
      rows[0].forEach(function (cell) {
        var th = document.createElement("th");
        th.textContent = cell;
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      sheetTable.appendChild(thead);

      var tbody = document.createElement("tbody");
      rows.slice(1).forEach(function (r) {
        var tr = document.createElement("tr");
        r.forEach(function (cell) {
          var td = document.createElement("td");
          td.textContent = cell;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      sheetTable.appendChild(tbody);
    }

    function setStatus(message, isError) {
      sheetStatus.hidden = !message;
      sheetStatus.textContent = message || "";
      sheetStatus.style.color = isError ? "#EF4444" : "";
    }

    function setConnected(isConnected) {
      statusPill.textContent = isConnected ? "Connected" : "Not connected";
      statusPill.classList.toggle("connected", isConnected);
    }

    function syncSheet(url) {
      var parsed = parseSheetUrl(url);
      if (!parsed) {
        setStatus("That doesn't look like a valid Google Sheets link.", true);
        sheetTableWrap.hidden = true;
        setConnected(false);
        return;
      }
      setStatus("Verifying and syncing…", false);

      var headerRow = headerRowInput ? headerRowInput.value : 1;

      fetchSheetJSONP(
        parsed.id,
        parsed.gid,
        function (data) {
          var rows = gvizRowsFromResponse(data);
          if (rows.length <= 1) {
            setStatus("The sheet appears to be empty.", true);
            sheetTableWrap.hidden = true;
            setConnected(false);
            return;
          }
          addPortfolioNames(extractColumnValues(rows, "Portfolio Name"));
          localStorage.setItem("wf-" + prefix + "-data", JSON.stringify(rows));
          updateDashboardStats();
          updateRefreshButtonStatus();
          var diagnostics = buildSyncDiagnostics(prefix, rows);
          var displayRows = filterColumns(rows, options.fields);
          if (options.showTable === false) {
            sheetTableWrap.hidden = true;
          } else {
            renderTable(displayRows);
            sheetTableWrap.hidden = false;
          }
          setStatus(diagnostics, false);
          setConnected(true);

          var rowCount = displayRows.length - 1;
          rowCountEl.textContent = rowCount + (rowCount === 1 ? " row" : " rows");
          lastSync.textContent = "Last sync: " + new Date().toLocaleTimeString();
          openSheetLink.href = url;
          meta.hidden = false;
        },
        function () {
          setStatus("Couldn't load the sheet. Make sure it's shared as \"Anyone with the link can view.\"", true);
          sheetTableWrap.hidden = true;
          setConnected(false);
        },
        headerRow
      );
    }

    var savedLink = localStorage.getItem(storageKey);
    var savedHeaderRow = localStorage.getItem(headerRowKey);
    if (savedHeaderRow && headerRowInput) headerRowInput.value = savedHeaderRow;
    if (savedLink) {
      sheetLinkInput.value = savedLink;
      syncSheet(savedLink);
    }

    sheetSaveBtn.addEventListener("click", function () {
      var url = sheetLinkInput.value.trim();
      if (!url) return;
      localStorage.setItem(storageKey, url);
      if (headerRowInput) localStorage.setItem(headerRowKey, headerRowInput.value || "1");
      setStatus("Link saved.", false);
    });

    sheetSyncBtn.addEventListener("click", function () {
      var url = sheetLinkInput.value.trim();
      if (!url) return;
      localStorage.setItem(storageKey, url);
      if (headerRowInput) localStorage.setItem(headerRowKey, headerRowInput.value || "1");
      syncSheet(url);
    });
  }

  initSheetCard("equity", {
    fields: [
      "Transaction Date",
      "Portfolio Name",
      "Instrument Name",
      "Instrument Category",
      "Instrument Sub Category",
      "Market Segment",
      "Region",
      "Transaction Type",
      "Units",
      "Price",
      "Value"
    ],
    showTable: false
  });
  initSheetCard("fixedincome", {
    fields: [
      "Transaction Date",
      "Portfolio Name",
      "Instrument Name",
      "Instrument Category",
      "Instrument Sub Category",
      "Market Segment",
      "Region",
      "Transaction Type",
      "Units",
      "Price",
      "Value"
    ],
    showTable: false
  });
  initSheetCard("mfmapping");

  // ===== Signup form (demo only, no backend) =====
  var form = document.getElementById("signup-form");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = document.getElementById("email").value;
      var button = form.querySelector("button");
      var originalText = button.textContent;
      button.textContent = "Thanks! Check your inbox →";
      button.disabled = true;
      setTimeout(function () {
        button.textContent = originalText;
        button.disabled = false;
        form.reset();
      }, 3000);
      console.log("Signup requested for:", email);
    });
  }
})();

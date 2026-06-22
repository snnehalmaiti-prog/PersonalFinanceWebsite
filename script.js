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
    renderValueChart();
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
    var instrumentIdx = header.indexOf("instrument name");
    var typeIdx = header.indexOf("transaction type");
    var categoryIdx = header.indexOf("instrument category");
    var unitsIdx = header.indexOf("units");
    var valueIdx = header.indexOf("value");
    if (portfolioIdx === -1 || instrumentIdx === -1 || typeIdx === -1 || categoryIdx === -1 || unitsIdx === -1 || valueIdx === -1) return 0;

    var byInstrument = {};
    rows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && normalizeText(portfolio) !== normalizeText(portfolioFilter)) return;
      var category = normalizeText(row[categoryIdx]);
      if (category.indexOf("equity") === -1) return;

      var instrument = (row[instrumentIdx] || "").trim();
      var type = normalizeText(row[typeIdx]);
      var units = parseNumber(row[unitsIdx]);
      var value = parseNumber(row[valueIdx]);

      if (!byInstrument[instrument]) {
        byInstrument[instrument] = { buyUnits: 0, buyValue: 0, sellUnits: 0 };
      }
      if (type.indexOf("buy") !== -1) {
        byInstrument[instrument].buyUnits += units;
        byInstrument[instrument].buyValue += value;
      } else if (type.indexOf("sell") !== -1) {
        byInstrument[instrument].sellUnits += units;
      }
    });

    var total = 0;
    Object.keys(byInstrument).forEach(function (instrument) {
      var entry = byInstrument[instrument];
      if (entry.buyUnits <= 0) return;
      var avgBuyPrice = entry.buyValue / entry.buyUnits;
      var remainingUnits = Math.max(entry.buyUnits - entry.sellUnits, 0);
      total += remainingUnits * avgBuyPrice;
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
    if (prefix === "mfmapping") {
      var rawHeader = rows[0];
      var header = rawHeader.map(normalizeText);
      var instrumentIdx = header.indexOf("instrument name");
      var isinIdx = header.findIndex(function (h) { return h.indexOf("identifier") !== -1 || h.indexOf("isin") !== -1; });
      var headerPreview = rawHeader.map(function (h) { return "\"" + h + "\""; }).join(", ");
      if (instrumentIdx === -1 || isinIdx === -1) {
        return "Synced " + (rows.length - 1) + " rows. Detected header columns: [" + headerPreview + "]. " +
          (instrumentIdx === -1 ? "No \"Instrument Name\" column found. " : "") +
          (isinIdx === -1 ? "No \"Identifier\"/\"ISIN\" column found. " : "") +
          "Check the header row number.";
      }
      var mapped = 0;
      rows.slice(1).forEach(function (row) {
        if ((row[instrumentIdx] || "").trim() && (row[isinIdx] || "").trim()) mapped++;
      });
      return "Synced " + (rows.length - 1) + " rows. Detected header columns: [" + headerPreview + "]. " + mapped + " row(s) have both Instrument Name and Identifier filled in.";
    }
    if (prefix !== "equity" && prefix !== "fixedincome") return "";
    var header = rows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var instrumentIdx = header.indexOf("instrument name");
    var typeIdx = header.indexOf("transaction type");
    var valueIdx = header.indexOf("value");
    var categoryIdx = header.indexOf("instrument category");
    var unitsIdx = header.indexOf("units");

    var requiredIdx = prefix === "equity"
      ? { "portfolio name": portfolioIdx, "instrument name": instrumentIdx, "transaction type": typeIdx, "instrument category": categoryIdx, units: unitsIdx, value: valueIdx }
      : { "portfolio name": portfolioIdx, "transaction type": typeIdx, value: valueIdx };

    var missing = Object.keys(requiredIdx).filter(function (key) { return requiredIdx[key] === -1; });
    if (missing.length) {
      return "Synced " + (rows.length - 1) + " rows, but couldn't find column(s): " + missing.join(", ") + ". Check the header row number and exact column names.";
    }

    var matched = 0;
    if (prefix === "equity") {
      var instruments = {};
      rows.slice(1).forEach(function (row) {
        var category = normalizeText(row[categoryIdx]);
        if (category.indexOf("equity") === -1) return;
        instruments[(row[instrumentIdx] || "").trim()] = true;
      });
      matched = Object.keys(instruments).length;
    } else {
      matched = rows.length - 1;
    }

    var total = prefix === "equity"
      ? sumEquityBuyInvestment(rows, "all")
      : sumInvestmentForRows(rows, "all");

    var matchedLabel = prefix === "equity" ? " distinct equity instrument(s) counted." : " row(s) counted toward Total Investment.";
    return "Synced " + (rows.length - 1) + " rows. " + matched + matchedLabel + " Computed total: " + formatCurrency(total) + ".";
  }

  function formatCurrency(amount) {
    var sign = amount < 0 ? "-" : "";
    return sign + "₹" + Math.abs(amount).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  }

  function updateDashboardStats() {
    var overviewEl = document.getElementById("overview-total-investment");
    var equityEl = document.getElementById("equity-total-investment");
    var fixedIncomeEl = document.getElementById("fixedincome-total-investment");
    if (overviewEl || equityEl || fixedIncomeEl) {
      var selected = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
      if (overviewEl) overviewEl.textContent = formatCurrency(computeTotalInvestment(selected, ["equity", "fixedincome"]));
      if (equityEl) equityEl.textContent = formatCurrency(computeTotalInvestment(selected, ["equity"]));
      if (fixedIncomeEl) fixedIncomeEl.textContent = formatCurrency(computeTotalInvestment(selected, ["fixedincome"]));
    }
    updateTotalCurrentValue();
  }

  // Total Current Value: Instrument Name -> ISIN (Mapping sheet) -> Scheme Code
  // (AMFI NAVAll.txt) -> latest NAV (mfapi.in), multiplied by units currently held.
  function updateTotalCurrentValue() {
    var overviewEl = document.getElementById("overview-total-current-value");
    var equityEl = document.getElementById("equity-total-current-value");
    if (!overviewEl && !equityEl) return;

    var selected = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
    var unitEvents = buildInstrumentUnitEvents(selected);

    var loadingMsg = "Fetching AMFI NAV data… this can take up to 30s the first time.";
    if (overviewEl) { overviewEl.textContent = "…"; overviewEl.title = loadingMsg; }
    if (equityEl) { equityEl.textContent = "…"; equityEl.title = loadingMsg; }

    buildInstrumentSchemeMap().then(function (schemeMap) {
      var instruments = Object.keys(unitEvents).filter(function (name) { return !!schemeMap[name]; });
      if (!instruments.length) {
        var reason = !Object.keys(unitEvents).length
          ? "No equity holdings found in the synced Equity Transactions sheet" + (lastUnitEventsDiagnostic ? " (" + lastUnitEventsDiagnostic + ")" : "") + "."
          : !Object.keys(schemeMap).length
          ? "Could not resolve any Instrument Name to a Scheme Code via the Mutual Fund Mapping sheet / AMFI." + (lastSchemeMapDiagnostic ? " (" + lastSchemeMapDiagnostic + ")" : "")
          : "None of your equity instruments matched a resolved Scheme Code.";
        if (overviewEl) { overviewEl.textContent = formatCurrency(0); overviewEl.title = reason; }
        if (equityEl) { equityEl.textContent = formatCurrency(0); equityEl.title = reason; }
        return;
      }

      Promise.all(instruments.map(function (name) { return fetchNavHistory(schemeMap[name]); }))
        .then(function (navHistories) {
          var total = 0;
          instruments.forEach(function (name, i) {
            var navHistory = navHistories[i];
            var events = unitEvents[name];
            var units = events.length ? events[events.length - 1].cumulativeUnits : 0;
            var nav = latest_nav_for(navHistory);
            if (units > 0 && nav) total += units * nav;
          });
          if (overviewEl) overviewEl.textContent = formatCurrency(total);
          if (equityEl) equityEl.textContent = formatCurrency(total);
        });
    });
  }

  function latest_nav_for(navHistory) {
    if (!navHistory || !navHistory.length) return null;
    return navHistory[navHistory.length - 1].nav;
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
  renderValueChart();

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
          renderValueChart();
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

    // Without &headers=1, gviz returns generic column labels (A, B, C…) instead of
    // the actual text in the first row of the ranged data, even though the data
    // itself starts at the right row. That breaks header-name matching downstream.
    script.src =
      "https://docs.google.com/spreadsheets/d/" + id +
      "/gviz/tq?gid=" + gid + rangeParam +
      "&headers=1" +
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

  // ===== Current Value Over Time chart =====
  var NAV_CACHE_PREFIX = "wf-nav-cache-";
  var NAV_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

  function parseMfApiDate(d) {
    var parts = String(d || "").split("-");
    if (parts.length !== 3) return null;
    return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
  }

  function dateKey(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function fetchNavHistory(schemeCode) {
    var cacheKey = NAV_CACHE_PREFIX + schemeCode;
    try {
      var cached = JSON.parse(localStorage.getItem(cacheKey));
      if (cached && Date.now() - cached.fetchedAt < NAV_CACHE_MAX_AGE_MS) {
        return Promise.resolve(cached.data);
      }
    } catch (e) {}

    return fetch("https://api.mfapi.in/mf/" + schemeCode)
      .then(function (res) { return res.json(); })
      .then(function (json) {
        var data = (json.data || [])
          .map(function (entry) { return { date: parseMfApiDate(entry.date), nav: parseNumber(entry.nav) }; })
          .filter(function (entry) { return entry.date; })
          .sort(function (a, b) { return a.date - b.date; });
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ fetchedAt: Date.now(), data: data }));
        } catch (e) {}
        return data;
      })
      .catch(function () { return []; });
  }

  function buildInstrumentIsinMap() {
    var rows = getSheetRows("mfmapping");
    var map = {};
    lastIsinMapDiagnostic = null;
    if (!rows || !rows.length) {
      lastIsinMapDiagnostic = "Mutual Fund Mapping sheet has no synced data.";
      return map;
    }
    var header = rows[0].map(normalizeText);
    var instrumentIdx = header.indexOf("instrument name");
    var isinIdx = header.findIndex(function (h) { return h.indexOf("identifier") !== -1 || h.indexOf("isin") !== -1; });
    if (instrumentIdx === -1 || isinIdx === -1) {
      var missingCols = [];
      if (instrumentIdx === -1) missingCols.push("Instrument Name");
      if (isinIdx === -1) missingCols.push("Identifier/ISIN");
      lastIsinMapDiagnostic = "Mutual Fund Mapping sheet is missing column(s): " + missingCols.join(", ") + ".";
      return map;
    }
    rows.slice(1).forEach(function (row) {
      var instrument = (row[instrumentIdx] || "").trim();
      var isin = (row[isinIdx] || "").trim().toUpperCase();
      if (instrument && isin) map[instrument] = isin;
    });
    if (!Object.keys(map).length) {
      lastIsinMapDiagnostic = "Mutual Fund Mapping sheet has rows, but none had both Instrument Name and Identifier filled in.";
    }
    return map;
  }
  var lastIsinMapDiagnostic = null;

  var AMFI_ISIN_MAP_CACHE_KEY = "wf-amfi-isin-map";
  var AMFI_ISIN_MAP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  var AMFI_NAV_URL = "https://www.amfiindia.com/spages/NAVAll.txt";

  function fetchAmfiIsinToSchemeMap() {
    try {
      var cached = JSON.parse(localStorage.getItem(AMFI_ISIN_MAP_CACHE_KEY));
      if (cached && Date.now() - cached.fetchedAt < AMFI_ISIN_MAP_MAX_AGE_MS) {
        return Promise.resolve(cached.data);
      }
    } catch (e) {}

    function parseAndCache(text) {
      var isinToCode = {};
      text.split("\n").forEach(function (line) {
        var parts = line.split(";");
        if (parts.length < 6) return;
        var schemeCode = parts[0].trim();
        var isinPayout = parts[1].trim();
        var isinReinvest = parts[2].trim();
        if (!/^\d+$/.test(schemeCode)) return;
        [isinPayout, isinReinvest].forEach(function (isin) {
          if (isin && isin.toUpperCase() !== "NA") isinToCode[isin.toUpperCase()] = schemeCode;
        });
      });
      try {
        localStorage.setItem(AMFI_ISIN_MAP_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), data: isinToCode }));
      } catch (e) {}
      return isinToCode;
    }

    function isValidNavText(text) {
      return !!text && text.indexOf(";") !== -1;
    }

    function tryFetch(url, isJsonWrapped) {
      var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      var timeoutId = controller ? setTimeout(function () { controller.abort(); }, 25000) : null;
      return fetch(url, controller ? { signal: controller.signal } : undefined)
        .then(function (res) {
          if (timeoutId) clearTimeout(timeoutId);
          if (!res.ok) throw new Error("fetch failed");
          return isJsonWrapped ? res.json().then(function (j) { return j.contents || ""; }) : res.text();
        })
        .catch(function (err) {
          if (timeoutId) clearTimeout(timeoutId);
          throw err;
        });
    }

    // AMFI's NAVAll.txt does not send CORS headers for direct browser fetches,
    // and known free CORS proxies (allorigins, corsproxy.io, thingproxy) are
    // frequently rate-limited, blocked by AMFI specifically, or offline, so try
    // several before giving up.
    var sources = [
      { url: AMFI_NAV_URL, name: "direct" },
      { url: "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(AMFI_NAV_URL), name: "codetabs" },
      { url: "https://api.allorigins.win/get?url=" + encodeURIComponent(AMFI_NAV_URL), jsonWrapped: true, name: "allorigins-get" },
      { url: "https://api.allorigins.win/raw?url=" + encodeURIComponent(AMFI_NAV_URL), name: "allorigins-raw" },
      { url: "https://corsproxy.io/?url=" + encodeURIComponent(AMFI_NAV_URL), name: "corsproxy" }
    ];

    lastAmfiFetchFailures = [];
    function attempt(index) {
      if (index >= sources.length) return Promise.resolve(null);
      return tryFetch(sources[index].url, sources[index].jsonWrapped)
        .then(function (text) {
          if (isValidNavText(text)) return text;
          lastAmfiFetchFailures.push(sources[index].name + ":empty");
          return attempt(index + 1);
        })
        .catch(function (err) {
          var code = err && err.name === "AbortError" ? "timeout" : (err && err.message ? err.message.slice(0, 20) : "error");
          lastAmfiFetchFailures.push(sources[index].name + ":" + code);
          return attempt(index + 1);
        });
    }

    return attempt(0).then(function (text) {
      return text ? parseAndCache(text) : {};
    });
  }
  var lastAmfiFetchFailures = [];

  var lastSchemeMapDiagnostic = null;

  function buildInstrumentSchemeMap() {
    var isinMap = buildInstrumentIsinMap();
    lastSchemeMapDiagnostic = null;
    return fetchAmfiIsinToSchemeMap().then(function (isinToCode) {
      var map = {};
      Object.keys(isinMap).forEach(function (instrument) {
        var isin = isinMap[instrument];
        var code = isinToCode[isin];
        if (code) map[instrument] = code;
      });
      if (!Object.keys(map).length) {
        if (lastIsinMapDiagnostic) {
          lastSchemeMapDiagnostic = lastIsinMapDiagnostic;
        } else if (!Object.keys(isinToCode).length) {
          lastSchemeMapDiagnostic = "AMFI fetch failed. " + lastAmfiFetchFailures.join(", ");
        } else {
          var sampleIsins = Object.keys(isinMap).slice(0, 3).map(function (name) { return isinMap[name]; });
          lastSchemeMapDiagnostic = "AMFI NAV file loaded (" + Object.keys(isinToCode).length + " ISINs), but none of your mapped ISIN(s) matched (e.g. " + sampleIsins.join(", ") + ").";
        }
      }
      return map;
    });
  }

  // Google Sheets gviz returns dates as locale-formatted strings (e.g. "21/06/2026"
  // for DD/MM/YYYY, common in India). JS's native Date parser misreads slash-separated
  // dates as MM/DD/YYYY, so "21/06/2026" comes out NaN. Parse DD/MM/YYYY and DD-MM-YYYY
  // explicitly before falling back to native parsing.
  function parseFlexibleDate(value) {
    var str = String(value == null ? "" : value).trim();
    if (!str) return null;
    var match = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
    if (match) {
      var day = Number(match[1]);
      var month = Number(match[2]);
      var year = Number(match[3]);
      if (month > 12 && day <= 12) { var tmp = day; day = month; month = tmp; }
      var parsed = new Date(year, month - 1, day);
      return isNaN(parsed) ? null : parsed;
    }
    var native = new Date(str);
    return isNaN(native) ? null : native;
  }

  var lastUnitEventsDiagnostic = null;

  function buildInstrumentUnitEvents(portfolioFilter) {
    var rows = getSheetRows("equity");
    var events = {};
    lastUnitEventsDiagnostic = null;
    if (!rows || !rows.length) {
      lastUnitEventsDiagnostic = "no synced Equity Transactions data";
      return events;
    }
    var header = rows[0].map(normalizeText);
    var dateColIdx = header.findIndex(function (h) { return h.indexOf("date") !== -1; });
    var required = {
      "portfolio name": header.indexOf("portfolio name"),
      "instrument name": header.indexOf("instrument name"),
      "instrument category": header.indexOf("instrument category"),
      "transaction type": header.indexOf("transaction type"),
      units: header.indexOf("units"),
      "a date column": dateColIdx
    };
    var missing = Object.keys(required).filter(function (key) { return required[key] === -1; });
    if (missing.length) {
      lastUnitEventsDiagnostic = "missing column(s): " + missing.join(", ");
      return events;
    }
    var portfolioIdx = required["portfolio name"];
    var instrumentIdx = required["instrument name"];
    var categoryIdx = required["instrument category"];
    var typeIdx = required["transaction type"];
    var unitsIdx = required.units;
    var dateIdx = required["a date column"];

    var equityRowCount = 0;
    var unparseableDateCount = 0;
    rows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && normalizeText(portfolio) !== normalizeText(portfolioFilter)) return;
      var category = normalizeText(row[categoryIdx]);
      if (category.indexOf("equity") === -1) return;
      equityRowCount++;
      var instrument = (row[instrumentIdx] || "").trim();
      var date = parseFlexibleDate(row[dateIdx]);
      if (!date) { unparseableDateCount++; return; }
      var type = normalizeText(row[typeIdx]);
      var units = parseNumber(row[unitsIdx]);
      var delta = type.indexOf("buy") !== -1 ? units : (type.indexOf("sell") !== -1 ? -units : 0);
      if (!events[instrument]) events[instrument] = [];
      events[instrument].push({ date: date, delta: delta });
    });

    if (!Object.keys(events).length) {
      lastUnitEventsDiagnostic = equityRowCount
        ? equityRowCount + " equity row(s) found, but " + unparseableDateCount + " had an unparseable Transaction Date."
        : "no rows matched Instrument Category containing \"equity\" for the selected portfolio.";
    }

    Object.keys(events).forEach(function (instrument) {
      events[instrument].sort(function (a, b) { return a.date - b.date; });
      var running = 0;
      events[instrument].forEach(function (e) { running += e.delta; e.cumulativeUnits = running; });
    });
    return events;
  }

  function lastAtOrBefore(sortedEvents, targetDate, valueKey) {
    var lo = 0, hi = sortedEvents.length - 1, result = null;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (sortedEvents[mid].date <= targetDate) {
        result = sortedEvents[mid][valueKey];
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return result;
  }

  function renderValueChart() {
    var canvas = document.getElementById("value-chart");
    var statusEl = document.getElementById("value-chart-status");
    var rangeEl = document.getElementById("value-chart-range");
    var resetBtn = document.getElementById("value-chart-reset");
    if (!canvas || typeof Chart === "undefined") return;

    statusEl.textContent = "Resolving mutual fund scheme codes…";

    buildInstrumentSchemeMap().then(function (schemeMap) {
      var selectedPortfolio = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
      var unitEvents = buildInstrumentUnitEvents(selectedPortfolio);
      var instruments = Object.keys(unitEvents).filter(function (name) { return !!schemeMap[name]; });
      var skipped = Object.keys(unitEvents).length - instruments.length;

      if (!instruments.length) {
        statusEl.textContent = skipped
          ? "No Instrument Name in your Equity sheet could be resolved to a Scheme Code via the Mutual Fund Mapping sheet and AMFI."
          : "Connect your Equity Transactions and Mutual Fund Mapping sheets to see this chart.";
        return;
      }

      statusEl.textContent = "Fetching NAV history for " + instruments.length + " instrument(s)…";

      Promise.all(instruments.map(function (name) { return fetchNavHistory(schemeMap[name]); }))
        .then(function (navHistories) {
        var navByInstrument = {};
        instruments.forEach(function (name, i) { navByInstrument[name] = navHistories[i]; });

        var allDates = {};
        instruments.forEach(function (name) {
          (navByInstrument[name] || []).forEach(function (entry) { allDates[dateKey(entry.date)] = entry.date; });
        });
        var timeline = Object.keys(allDates).map(function (k) { return allDates[k]; }).sort(function (a, b) { return a - b; });
        var today = new Date();
        timeline = timeline.filter(function (d) { return d <= today; });

        if (!timeline.length) {
          statusEl.textContent = "No NAV history available yet for your mapped instruments.";
          return;
        }

        var points = timeline.map(function (date) {
          var total = 0;
          instruments.forEach(function (name) {
            var units = lastAtOrBefore(unitEvents[name], date, "cumulativeUnits") || 0;
            var nav = lastAtOrBefore(navByInstrument[name], date, "nav");
            if (units > 0 && nav) total += units * nav;
          });
          return { x: date, y: total };
        });

        statusEl.textContent = instruments.length + " instrument(s) plotted" + (skipped ? " (" + skipped + " unmapped instrument(s) skipped)" : "") + ".";

        var first = timeline[0], last = timeline[timeline.length - 1];
        if (rangeEl) rangeEl.textContent = first.toLocaleDateString() + " – " + last.toLocaleDateString();

        if (window.__wfValueChart) window.__wfValueChart.destroy();
        window.__wfValueChart = new Chart(canvas.getContext("2d"), {
          type: "line",
          data: {
            datasets: [{
              label: "Current Value",
              data: points,
              borderColor: "#10B981",
              backgroundColor: "rgba(16,185,129,0.12)",
              fill: true,
              tension: 0.15,
              pointRadius: 0,
              borderWidth: 2
            }]
          },
          options: {
            maintainAspectRatio: false,
            scales: {
              x: { type: "time", time: { unit: "month" } },
              y: { ticks: { callback: function (v) { return formatCurrency(v); } } }
            },
            plugins: {
              legend: { display: false },
              zoom: {
                pan: { enabled: true, mode: "x" },
                zoom: {
                  wheel: { enabled: true },
                  pinch: { enabled: true },
                  mode: "x",
                  onZoomComplete: function (ctx) { updateVisibleRangeLabel(ctx.chart); }
                }
              }
            }
          }
        });

        function updateVisibleRangeLabel(chart) {
          var xScale = chart.scales.x;
          if (rangeEl) rangeEl.textContent = new Date(xScale.min).toLocaleDateString() + " – " + new Date(xScale.max).toLocaleDateString();
        }
      });
    });

    if (resetBtn && !resetBtn.dataset.bound) {
      resetBtn.dataset.bound = "1";
      resetBtn.addEventListener("click", function () {
        if (window.__wfValueChart) window.__wfValueChart.resetZoom();
      });
    }
  }

  renderValueChart();

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

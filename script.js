(function () {
  "use strict";

  // ===== Theme toggle =====
  var root = document.documentElement;
  var themeToggle = document.getElementById("theme-toggle");
  var storedTheme = localStorage.getItem("wf-theme");
  var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  var SPLIT_CHART_COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4", "#EC4899", "#84CC16"];

  var AMFI_ISIN_MAP_CACHE_KEY = "wf-amfi-isin-map";
  var AMFI_ISIN_MAP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  var AMFI_ISIN_MAP_STATIC_FILE = "amfi_isin_map.json";
  var lastAmfiFetchFailures = [];

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
  var dashTabStocksEtf = document.getElementById("tab-stocksetf");
  if (dashTabOverview && dashTabEquity) {
    var panelOverview = document.getElementById("panel-overview");
    var panelEquity = document.getElementById("panel-equity");
    var panelFixedIncome = document.getElementById("panel-fixedincome");
    var panelStocksEtf = document.getElementById("panel-stocksetf");
    var dashTabs = [
      { tab: dashTabOverview, panel: panelOverview, key: "overview" },
      { tab: dashTabEquity, panel: panelEquity, key: "equity" },
      { tab: dashTabStocksEtf, panel: panelStocksEtf, key: "stocksetf" },
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

  // Treat residual fractional units below this as a fully closed-out position,
  // to absorb floating-point rounding error from repeated cumulative +=/-=.
  var UNITS_EPSILON = 1e-6;

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
    renderEquityHoldingsTable();
  }

  function parseNumber(value) {
    var raw = String(value == null ? "" : value).trim();
    var isParenNegative = /^\(.*\)$/.test(raw);
    var cleaned = raw.replace(/[^0-9.-]/g, "");
    var parsed = parseFloat(cleaned) || 0;
    return isParenNegative ? -Math.abs(parsed) : parsed;
  }

  function validateNumericCell(value) {
    var raw = String(value == null ? "" : value).trim();
    if (!raw) return { ok: false, reason: "is blank" };
    var hasDigit = /[0-9]/.test(raw);
    if (!hasDigit) return { ok: false, reason: "is not a number (\"" + raw + "\")" };
    var parsed = parseNumber(raw);
    if (parsed === 0) return { ok: false, reason: "is zero" };
    if (parsed < 0) return { ok: false, reason: "is negative (" + parsed + ")" };
    return { ok: true, reason: "" };
  }

  function normalizeText(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim().toLowerCase();
  }

  function sumInvestmentForRows(rows, portfolioFilter) {
    if (!rows || !rows.length) return 0;
    var header = rows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var typeIdx = header.indexOf("transaction type");
    var unitsIdx = header.indexOf("units");
    var priceIdx = header.indexOf("price");
    if (portfolioIdx === -1 || typeIdx === -1 || unitsIdx === -1 || priceIdx === -1) return 0;

    var total = 0;
    rows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && portfolio.toLowerCase() !== portfolioFilter.toLowerCase()) return;
      var type = (row[typeIdx] || "").trim().toLowerCase();
      var value = parseNumber(row[unitsIdx]) * parseNumber(row[priceIdx]);
      total += type.indexOf("sell") !== -1 ? -value : value;
    });
    return total;
  }

  function groupUnitTransactionsByInstrument(rows, portfolioFilter) {
    var header = rows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var instrumentIdx = header.indexOf("instrument name");
    var typeIdx = header.indexOf("transaction type");
    var unitsIdx = header.indexOf("units");
    var priceIdx = header.indexOf("price");
    var dateIdx = header.indexOf("transaction date");
    if (portfolioIdx === -1 || instrumentIdx === -1 || typeIdx === -1 || unitsIdx === -1 || priceIdx === -1 || dateIdx === -1) return null;

    var transactionsByInstrument = {};
    rows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && normalizeText(portfolio) !== normalizeText(portfolioFilter)) return;

      var type = normalizeText(row[typeIdx]);
      var isBuy = type.indexOf("buy") !== -1;
      var isSell = type.indexOf("sell") !== -1;
      if (!isBuy && !isSell) return;

      var instrument = (row[instrumentIdx] || "").trim();
      if (!transactionsByInstrument[instrument]) transactionsByInstrument[instrument] = [];
      transactionsByInstrument[instrument].push({
        type: isBuy ? "buy" : "sell",
        units: parseNumber(row[unitsIdx]),
        price: parseNumber(row[priceIdx]),
        date: parseFlexibleDate(row[dateIdx]),
        order: transactionsByInstrument[instrument].length
      });
    });

    Object.keys(transactionsByInstrument).forEach(function (instrument) {
      transactionsByInstrument[instrument].sort(function (a, b) {
        var at = a.date ? a.date.getTime() : 0;
        var bt = b.date ? b.date.getTime() : 0;
        return at !== bt ? at - bt : a.order - b.order;
      });
    });
    return transactionsByInstrument;
  }

  function fifoRemainingLots(txns) {
    var buyLots = [];
    txns.forEach(function (txn) {
      if (txn.type === "buy") {
        buyLots.push({ units: txn.units, price: txn.price });
        return;
      }
      var unitsToMatch = txn.units;
      while (unitsToMatch > 0 && buyLots.length) {
        var lot = buyLots[0];
        var matched = Math.min(unitsToMatch, lot.units);
        lot.units -= matched;
        unitsToMatch -= matched;
        if (lot.units <= 0) buyLots.shift();
      }
    });
    return buyLots;
  }

  function sumUnitBasedBuyInvestment(rows, portfolioFilter) {
    if (!rows || !rows.length) return 0;
    var transactionsByInstrument = groupUnitTransactionsByInstrument(rows, portfolioFilter);
    if (!transactionsByInstrument) return 0;

    var total = 0;
    Object.keys(transactionsByInstrument).forEach(function (instrument) {
      var remainingLots = fifoRemainingLots(transactionsByInstrument[instrument]);
      remainingLots.forEach(function (lot) { total += lot.units * lot.price; });
    });
    return total;
  }

  function sumUnitBasedRealizedReturn(rows, portfolioFilter) {
    if (!rows || !rows.length) return 0;
    var transactionsByInstrument = groupUnitTransactionsByInstrument(rows, portfolioFilter);
    if (!transactionsByInstrument) return 0;

    var total = 0;
    Object.keys(transactionsByInstrument).forEach(function (instrument) {
      var buyLots = [];
      transactionsByInstrument[instrument].forEach(function (txn) {
        if (txn.type === "buy") {
          buyLots.push({ units: txn.units, price: txn.price });
          return;
        }
        var unitsToMatch = txn.units;
        var costOfSoldUnits = 0;
        while (unitsToMatch > 0 && buyLots.length) {
          var lot = buyLots[0];
          var matched = Math.min(unitsToMatch, lot.units);
          costOfSoldUnits += matched * lot.price;
          lot.units -= matched;
          unitsToMatch -= matched;
          if (lot.units <= 0) buyLots.shift();
        }
        var saleProceeds = txn.units * txn.price;
        total += saleProceeds - costOfSoldUnits;
      });
    });
    return total;
  }

  function computeInstrumentRealizedDetail(txns) {
    var buyLots = [];
    var costOfSoldUnits = 0;
    var saleProceeds = 0;
    var unitsSold = 0;
    var lastSell = null;
    txns.forEach(function (txn) {
      if (txn.type === "buy") {
        buyLots.push({ units: txn.units, price: txn.price });
        return;
      }
      var unitsToMatch = txn.units;
      while (unitsToMatch > 0 && buyLots.length) {
        var lot = buyLots[0];
        var matched = Math.min(unitsToMatch, lot.units);
        costOfSoldUnits += matched * lot.price;
        lot.units -= matched;
        unitsToMatch -= matched;
        if (lot.units <= 0) buyLots.shift();
      }
      saleProceeds += txn.units * txn.price;
      unitsSold += txn.units;
      if (!lastSell || (txn.date && (!lastSell.date || txn.date.getTime() >= lastSell.date.getTime()))) {
        lastSell = txn;
      }
    });
    return {
      costOfSoldUnits: costOfSoldUnits,
      saleProceeds: saleProceeds,
      unitsSold: unitsSold,
      avgBuyCost: unitsSold > 0 ? costOfSoldUnits / unitsSold : 0,
      realizedPnl: saleProceeds - costOfSoldUnits,
      lastSellPrice: lastSell ? lastSell.price : 0,
      lastSellDate: lastSell ? lastSell.date : null
    };
  }

  function computeRealizedReturn(portfolioFilter, prefixes) {
    var total = 0;
    prefixes.forEach(function (prefix) {
      var rows = getSheetRows(prefix);
      if (!rows) return;
      if (prefix === "equity" || prefix === "stocksetf") total += sumUnitBasedRealizedReturn(rows, portfolioFilter);
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
      if (prefix === "equity" || prefix === "stocksetf") total += sumUnitBasedBuyInvestment(rows, portfolioFilter);
      else total += sumInvestmentForRows(rows, portfolioFilter);
    });
    return total;
  }

  function buildSyncDiagnostics(prefix, rows) {
    if (prefix === "mfmapping" || prefix === "stocksetfmapping") {
      var rawHeader = rows[0];
      var header = rawHeader.map(normalizeText);
      var instrumentIdx = header.indexOf("instrument name");
      var isinIdx = header.findIndex(function (h) { return h.indexOf("identifier") !== -1 || h.indexOf("isin") !== -1; });
      var headerPreview = rawHeader.map(function (h) { return "\"" + h + "\""; }).join(", ");
      if (instrumentIdx === -1 || isinIdx === -1) {
        return {
          missingColumns: true,
          message: "Synced " + (rows.length - 1) + " rows. Detected header columns: [" + headerPreview + "]. " +
            (instrumentIdx === -1 ? "No \"Instrument Name\" column found. " : "") +
            (isinIdx === -1 ? "No \"Identifier\"/\"ISIN\" column found. " : "") +
            "Check the header row number."
        };
      }
      var mapped = 0;
      var badRows = [];
      var seenInstruments = {};
      rows.slice(1).forEach(function (row, i) {
        var instrument = (row[instrumentIdx] || "").trim();
        var identifier = (row[isinIdx] || "").trim();
        if (instrument && identifier) mapped++;

        var issues = [];
        if (!instrument) issues.push("Instrument Name is blank");
        if (!identifier) issues.push("Identifier/ISIN is blank");
        if (instrument) {
          var key = normalizeText(instrument);
          if (seenInstruments[key]) issues.push("Instrument Name is a duplicate of row " + seenInstruments[key]);
          else seenInstruments[key] = i + 2;
        }
        if (issues.length) badRows.push("Row " + (i + 2) + ": " + issues.join(", "));
      });

      var baseMsg = "Synced " + (rows.length - 1) + " rows. Detected header columns: [" + headerPreview + "]. " + mapped + " row(s) have both Instrument Name and Identifier filled in.";
      if (badRows.length) {
        var mapPreview = badRows.slice(0, 5).join(" | ");
        var mapMore = badRows.length > 5 ? " (+" + (badRows.length - 5) + " more)" : "";
        return {
          missingColumns: true,
          message: baseMsg + " Found " + badRows.length + " row(s) with missing/duplicate data: " + mapPreview + mapMore + ". Fix these cells in the sheet and sync again."
        };
      }
      return { missingColumns: false, message: baseMsg };
    }
    if (prefix !== "equity" && prefix !== "fixedincome" && prefix !== "stocksetf") return { missingColumns: false, message: "" };
    var header = rows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var instrumentIdx = header.indexOf("instrument name");
    var typeIdx = header.indexOf("transaction type");
    var priceIdx = header.indexOf("price");
    var unitsIdx = header.indexOf("units");

    var requiredIdx = (prefix === "equity" || prefix === "stocksetf")
      ? { "portfolio name": portfolioIdx, "instrument name": instrumentIdx, "transaction type": typeIdx, units: unitsIdx, price: priceIdx }
      : { "portfolio name": portfolioIdx, "transaction type": typeIdx, units: unitsIdx, price: priceIdx };

    var missing = Object.keys(requiredIdx).filter(function (key) { return requiredIdx[key] === -1; });
    if (missing.length) {
      return {
        missingColumns: true,
        message: "Header row number is incorrect. Make adjustments by adding correct header row number."
      };
    }

    var matched = 0;
    if (prefix === "equity" || prefix === "stocksetf") {
      var instruments = {};
      rows.slice(1).forEach(function (row) {
        instruments[(row[instrumentIdx] || "").trim()] = true;
      });
      matched = Object.keys(instruments).length;
    } else {
      matched = rows.length - 1;
    }

    var total = (prefix === "equity" || prefix === "stocksetf")
      ? sumUnitBasedBuyInvestment(rows, "all")
      : sumInvestmentForRows(rows, "all");

    var badRows = [];
    rows.slice(1).forEach(function (row, i) {
      var portfolio = (row[portfolioIdx] || "").trim();
      var type = normalizeText(row[typeIdx]);
      var isBuyOrSell = type.indexOf("buy") !== -1 || type.indexOf("sell") !== -1;
      var issues = [];
      if (!portfolio) issues.push("Portfolio Name is blank");
      if ((prefix === "equity" || prefix === "stocksetf") && !(row[instrumentIdx] || "").trim()) issues.push("Instrument Name is blank");
      if (!type) issues.push("Transaction Type is blank");
      if (isBuyOrSell) {
        var unitsCheck = validateNumericCell(row[unitsIdx]);
        if (!unitsCheck.ok) issues.push("Units " + unitsCheck.reason);
        var priceCheck = validateNumericCell(row[priceIdx]);
        if (!priceCheck.ok) issues.push("Price " + priceCheck.reason);
      }
      if (issues.length) badRows.push("Row " + (i + 2) + " (" + (portfolio || "unknown portfolio") + "): " + issues.join(", "));
    });

    var matchedLabel = (prefix === "equity" || prefix === "stocksetf") ? " distinct instrument(s) counted." : " row(s) counted toward Total Investment.";
    var baseMessage = "Synced " + (rows.length - 1) + " rows. " + matched + matchedLabel + " Computed total: " + formatCurrency(total) + ".";
    if (badRows.length) {
      var preview = badRows.slice(0, 5).join(" | ");
      var more = badRows.length > 5 ? " (+" + (badRows.length - 5) + " more)" : "";
      return {
        missingColumns: true,
        message: baseMessage + " Found " + badRows.length + " row(s) with missing/invalid data: " + preview + more + ". Fix these cells in the sheet and sync again."
      };
    }
    return { missingColumns: false, message: baseMessage };
  }

  function formatCurrency(amount) {
    var sign = amount < 0 ? "-" : "";
    return sign + "₹" + Math.abs(amount).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  }

  function formatCompactINR(amount) {
    var sign = amount < 0 ? "-" : "";
    var abs = Math.abs(amount);
    if (abs >= 1e7) return sign + (abs / 1e7).toFixed(abs % 1e7 === 0 ? 0 : 1) + "Cr";
    if (abs >= 1e5) return sign + (abs / 1e5).toFixed(abs % 1e5 === 0 ? 0 : 1) + "L";
    if (abs >= 1e3) return sign + (abs / 1e3).toFixed(abs % 1e3 === 0 ? 0 : 1) + "K";
    return sign + abs.toFixed(2);
  }

  function setSignedCurrency(el, amount) {
    if (!el) return;
    el.textContent = (amount > 0 ? "+" : "") + formatCurrency(amount);
    el.classList.remove("positive", "negative");
    if (amount > 0) el.classList.add("positive");
    else if (amount < 0) el.classList.add("negative");
  }

  function updateDashboardStats() {
    var overviewEl = document.getElementById("overview-total-investment");
    var equityEl = document.getElementById("equity-total-investment");
    var fixedIncomeEl = document.getElementById("fixedincome-total-investment");
    var stocksEtfEl = document.getElementById("stocksetf-total-investment");
    var overviewRealizedEl = document.getElementById("overview-realized-return");
    var equityRealizedEl = document.getElementById("equity-realized-return");
    var stocksEtfRealizedEl = document.getElementById("stocksetf-realized-return");
    if (overviewEl || equityEl || fixedIncomeEl || stocksEtfEl) {
      var selected = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
      if (overviewEl) overviewEl.textContent = formatCurrency(computeTotalInvestment(selected, ["equity", "fixedincome", "stocksetf"]));
      if (equityEl) equityEl.textContent = formatCurrency(computeTotalInvestment(selected, ["equity"]));
      if (fixedIncomeEl) fixedIncomeEl.textContent = formatCurrency(computeTotalInvestment(selected, ["fixedincome"]));
      if (stocksEtfEl) stocksEtfEl.textContent = formatCurrency(computeTotalInvestment(selected, ["stocksetf"]));
    }
    if (overviewRealizedEl || equityRealizedEl || stocksEtfRealizedEl) {
      var selectedForRealized = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
      setSignedCurrency(overviewRealizedEl, computeRealizedReturn(selectedForRealized, ["equity", "stocksetf"]));
      setSignedCurrency(equityRealizedEl, computeRealizedReturn(selectedForRealized, ["equity"]));
      setSignedCurrency(stocksEtfRealizedEl, computeRealizedReturn(selectedForRealized, ["stocksetf"]));
    }
    updateTotalCurrentValue();
  }

  // Total Current Value: Instrument Name -> ISIN (Mapping sheet) -> Scheme Code
  // (AMFI NAVAll.txt) -> latest NAV (mfapi.in), multiplied by units currently held.
  function setUnrealizedReturn(returnEl, pctEl, currentValue, investment) {
    if (!returnEl && !pctEl) return;
    var unrealized = currentValue - investment;
    var pct = investment > 0 ? (unrealized / investment) * 100 : 0;
    var cls = unrealized > 0 ? "positive" : (unrealized < 0 ? "negative" : "");
    if (returnEl) {
      returnEl.textContent = (unrealized > 0 ? "+" : "") + formatCurrency(unrealized);
      returnEl.classList.remove("positive", "negative");
      if (cls) returnEl.classList.add(cls);
    }
    if (pctEl) {
      pctEl.textContent = (pct > 0 ? "+" : "") + pct.toFixed(2) + "%";
      pctEl.classList.remove("positive", "negative");
      if (cls) pctEl.classList.add(cls);
    }
  }

  function updateTotalCurrentValue() {
    var overviewEl = document.getElementById("overview-total-current-value");
    var equityEl = document.getElementById("equity-total-current-value");
    var overviewReturnEl = document.getElementById("overview-unrealized-return");
    var overviewPctEl = document.getElementById("overview-return-pct");
    var equityReturnEl = document.getElementById("equity-unrealized-return");
    var equityPctEl = document.getElementById("equity-return-pct");
    var overviewXirrEl = document.getElementById("overview-xirr");
    var equityXirrEl = document.getElementById("equity-xirr");
    if (!overviewEl && !equityEl && !overviewReturnEl && !equityReturnEl && !overviewXirrEl && !equityXirrEl) return;

    var selected = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
    var unitEvents = buildInstrumentUnitEvents(selected);
    var investment = computeTotalInvestment(selected, ["equity"]);
    var equityRows = getSheetRows("equity");

    var loadingMsg = "Fetching AMFI NAV data… this can take up to 30s the first time.";
    if (overviewEl) { overviewEl.textContent = "…"; overviewEl.title = loadingMsg; }
    if (equityEl) { equityEl.textContent = "…"; equityEl.title = loadingMsg; }
    if (overviewReturnEl) overviewReturnEl.textContent = "…";
    if (overviewPctEl) overviewPctEl.textContent = "…";
    if (equityReturnEl) equityReturnEl.textContent = "…";
    if (equityPctEl) equityPctEl.textContent = "…";
    if (overviewXirrEl) overviewXirrEl.textContent = "…";
    if (equityXirrEl) equityXirrEl.textContent = "…";

    buildInstrumentSchemeMap().then(function (schemeMap) {
      var instruments = Object.keys(unitEvents).filter(function (name) { return !!lookupSchemeCode(schemeMap, name); });
      if (!instruments.length) {
        var reason = !Object.keys(unitEvents).length
          ? "No equity holdings found in the synced Mutual Fund Transactions sheet" + (lastUnitEventsDiagnostic ? " (" + lastUnitEventsDiagnostic + ")" : "") + "."
          : !Object.keys(schemeMap).length
          ? "Could not resolve any Instrument Name to a Scheme Code via the Mutual Fund Mapping sheet / AMFI." + (lastSchemeMapDiagnostic ? " (" + lastSchemeMapDiagnostic + ")" : "")
          : "None of your equity instruments matched a resolved Scheme Code.";
        if (overviewEl) { overviewEl.textContent = formatCurrency(0); overviewEl.title = reason; }
        if (equityEl) { equityEl.textContent = formatCurrency(0); equityEl.title = reason; }
        setUnrealizedReturn(overviewReturnEl, overviewPctEl, 0, investment);
        setUnrealizedReturn(equityReturnEl, equityPctEl, 0, investment);
        var xirrCashFlows = buildXirrCashFlows(equityRows, selected);
        var xirrNoValue = calculateXIRR(xirrCashFlows);
        setXirr(overviewXirrEl, xirrNoValue);
        setXirr(equityXirrEl, xirrNoValue);
        return;
      }

      return Promise.all(instruments.map(function (name) { return fetchNavHistory(lookupSchemeCode(schemeMap, name)); }))
        .then(function (navHistories) {
          var total = 0;
          instruments.forEach(function (name, i) {
            var navHistory = navHistories[i];
            var events = unitEvents[name];
            var units = events.length ? events[events.length - 1].cumulativeUnits : 0;
            var nav = latest_nav_for(navHistory);
            if (units > UNITS_EPSILON && nav) total += units * nav;
          });
          if (overviewEl) overviewEl.textContent = formatCurrency(total);
          if (equityEl) equityEl.textContent = formatCurrency(total);
          setUnrealizedReturn(overviewReturnEl, overviewPctEl, total, investment);
          setUnrealizedReturn(equityReturnEl, equityPctEl, total, investment);

          var xirrCashFlows = buildXirrCashFlows(equityRows, selected);
          if (total > UNITS_EPSILON) xirrCashFlows.push({ date: new Date(), amount: total });
          var xirr = calculateXIRR(xirrCashFlows);
          setXirr(overviewXirrEl, xirr);
          setXirr(equityXirrEl, xirr);
        });
    });
  }

  // Cash flows for XIRR: Buy = negative (money out), Sell = positive (money in).
  // Each transaction is kept as its own row — buys and sells on the same date are not netted.
  function buildXirrCashFlows(rows, portfolioFilter, instrumentFilter) {
    if (!rows || !rows.length) return [];
    var header = rows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var instrumentIdx = header.indexOf("instrument name");
    var typeIdx = header.indexOf("transaction type");
    var unitsIdx = header.indexOf("units");
    var priceIdx = header.indexOf("price");
    var dateIdx = header.indexOf("transaction date");
    if (portfolioIdx === -1 || typeIdx === -1 || unitsIdx === -1 || priceIdx === -1 || dateIdx === -1) return [];
    if (instrumentFilter && instrumentIdx === -1) return [];

    var flows = [];
    rows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && normalizeText(portfolio) !== normalizeText(portfolioFilter)) return;
      if (instrumentFilter && normalizeText((row[instrumentIdx] || "").trim()) !== normalizeText(instrumentFilter)) return;

      var type = normalizeText(row[typeIdx]);
      var isBuy = type.indexOf("buy") !== -1;
      var isSell = type.indexOf("sell") !== -1;
      if (!isBuy && !isSell) return;

      var units = parseNumber(row[unitsIdx]);
      var price = parseNumber(row[priceIdx]);
      var date = parseFlexibleDate(row[dateIdx]);
      if (!date || !units || !price) return;

      var amount = units * price;
      flows.push({ date: date, amount: isBuy ? -amount : amount });
    });
    return flows;
  }

  // Solves XIRR via Newton-Raphson on NPV(rate) = sum(amount / (1+rate)^(days/365)),
  // falling back to bisection if Newton's method fails to converge.
  function calculateXIRR(cashflows) {
    if (!cashflows || cashflows.length < 2) return null;
    var hasPositive = cashflows.some(function (c) { return c.amount > 0; });
    var hasNegative = cashflows.some(function (c) { return c.amount < 0; });
    if (!hasPositive || !hasNegative) return null;

    var t0 = cashflows.reduce(function (min, c) {
      return c.date.getTime() < min ? c.date.getTime() : min;
    }, cashflows[0].date.getTime());

    function yearsFromStart(date) {
      return (date.getTime() - t0) / (1000 * 60 * 60 * 24 * 365);
    }

    function npv(rate) {
      return cashflows.reduce(function (sum, c) {
        return sum + c.amount / Math.pow(1 + rate, yearsFromStart(c.date));
      }, 0);
    }

    function npvDerivative(rate) {
      return cashflows.reduce(function (sum, c) {
        var t = yearsFromStart(c.date);
        if (t === 0) return sum;
        return sum - (t * c.amount) / Math.pow(1 + rate, t + 1);
      }, 0);
    }

    var rate = 0.1;
    var converged = false;
    for (var i = 0; i < 100; i++) {
      var f = npv(rate);
      var fp = npvDerivative(rate);
      if (Math.abs(fp) < 1e-10) break;
      var nextRate = rate - f / fp;
      if (!isFinite(nextRate) || nextRate <= -0.999999) break;
      if (Math.abs(nextRate - rate) < 1e-7) { rate = nextRate; converged = true; break; }
      rate = nextRate;
    }

    if (!converged || !isFinite(rate) || Math.abs(npv(rate)) > 1) {
      var low = -0.999999, high = 10;
      var fLow = npv(low), fHigh = npv(high);
      if (fLow * fHigh > 0) return converged ? rate : null;
      for (var j = 0; j < 200; j++) {
        var mid = (low + high) / 2;
        var fMid = npv(mid);
        if (Math.abs(fMid) < 1e-6) { rate = mid; break; }
        if ((fMid > 0) === (fLow > 0)) { low = mid; fLow = fMid; } else { high = mid; }
        rate = mid;
      }
    }
    return rate;
  }

  function setXirr(el, rate) {
    if (!el) return;
    if (rate === null || rate === undefined || !isFinite(rate)) {
      el.textContent = "—";
      el.classList.remove("positive", "negative");
      return;
    }
    var pct = rate * 100;
    el.textContent = (pct > 0 ? "+" : "") + pct.toFixed(2) + "%";
    el.classList.remove("positive", "negative");
    if (pct > 0) el.classList.add("positive");
    else if (pct < 0) el.classList.add("negative");
  }

  function latest_nav_for(navHistory) {
    if (!navHistory || !navHistory.length) return null;
    return navHistory[navHistory.length - 1].nav;
  }

  function updateRefreshButtonStatus(prefix) {
    var refreshBtn = document.getElementById(prefix + "-refresh");
    if (!refreshBtn) return;
    refreshBtn.classList.remove("status-connected", "status-disconnected");
    refreshBtn.classList.add(getSheetRows(prefix) ? "status-connected" : "status-disconnected");
  }

  function populatePortfolioSelect() {
    var menu = document.getElementById("portfolio-menu");
    if (!menu) return;
    var names = collectPortfolioNamesFromSheets(["equity", "stocksetf", "fixedincome"]);
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
    portfolioMenu.classList.remove("open");
    portfolioToggle.setAttribute("aria-expanded", "false");
  }

  function openPortfolioMenu() {
    if (!portfolioMenu) return;
    portfolioMenu.hidden = false;
    portfolioMenu.classList.add("open");
    portfolioToggle.setAttribute("aria-expanded", "true");
  }

  updateDashboardStats();
  renderValueChart();
  renderEquityHoldingsTable();
  renderInvestmentSplitChart();

  var equityHoldingsShowClosedOnly = document.getElementById("equity-holdings-show-closed-only");
  if (equityHoldingsShowClosedOnly) equityHoldingsShowClosedOnly.addEventListener("change", renderEquityHoldingsTable);

  ["equity", "fixedincome", "stocksetf"].forEach(function (prefix) {
    var refreshBtn = document.getElementById(prefix + "-refresh");
    updateRefreshButtonStatus(prefix);
    if (!refreshBtn) return;

    refreshBtn.addEventListener("click", function () {
      var configs = loadSheetConfigs(prefix);
      if (!configs.length) return;
      refreshBtn.classList.add("spinning");
      fetchAndMergeSheets(configs, function (merged) {
        refreshBtn.classList.remove("spinning");
        if (merged && merged.length > 1) {
          addPortfolioNames(extractColumnValues(merged, "Portfolio Name"));
          localStorage.setItem("wf-" + prefix + "-data", JSON.stringify(merged));
        }
        updateDashboardStats();
        updateRefreshButtonStatus(prefix);
        populatePortfolioSelect();
        if (prefix === "equity") { renderValueChart(); renderEquityHoldingsTable(); renderMarketSegmentChart(); }
        renderInvestmentSplitChart();
      }, TRANSACTION_SHEET_FIELDS);
    });
  });

  if (portfolioToggle && portfolioMenu) {
    populatePortfolioSelect();

    portfolioToggle.addEventListener("click", function (e) {
      e.stopPropagation();
      if (!portfolioMenu.classList.contains("open")) openPortfolioMenu();
      else closePortfolioMenu();
    });

    document.addEventListener("click", function (e) {
      if (portfolioMenu.classList.contains("open") && !portfolioMenu.contains(e.target) && e.target !== portfolioToggle) {
        closePortfolioMenu();
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && portfolioMenu.classList.contains("open")) {
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
    var colTypes = data.table.cols.map(function (c) { return c.type || ""; });
    var cols = data.table.cols.map(function (c) { return c.label || c.id || ""; });
    var rows = [cols];
    (data.table.rows || []).forEach(function (r) {
      var row = (r.c || []).map(function (cell, i) {
        if (!cell) return "";
        // Numeric columns: use the raw value, not the display-formatted string —
        // cell.f can be "₹1,234.00" or "(1,234.00)" for negatives, which the
        // numeric parser can't reliably reconstruct.
        if (colTypes[i] === "number") return cell.v != null ? String(cell.v) : "";
        if (cell.f != null) return cell.f;
        return cell.v != null ? String(cell.v) : "";
      });
      rows.push(row);
    });
    return rows;
  }

  function sheetErrorMessage(reason) {
    if (reason === "private") {
      return "This sheet appears to be private or restricted. Open it in Google Sheets, click \"Share\", and set access to \"Anyone with the link can view\", then sync again.";
    }
    if (reason === "timeout") {
      return "Couldn't reach the sheet (request timed out). Check your internet connection and the link, then try again.";
    }
    return "Couldn't load the sheet. Double-check the link and that it's shared as \"Anyone with the link can view.\"";
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
        var reasons = (data.errors || []).map(function (e) { return e.reason; });
        onError(reasons.indexOf("access_denied") !== -1 ? "private" : "query");
      } else {
        onData(data);
      }
    };

    script.onerror = function () {
      cleanup();
      onError("private");
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
      onError("timeout");
    }, 12000);

    document.head.appendChild(script);
  }

  function loadSheetConfigs(prefix) {
    var raw = localStorage.getItem("wf-" + prefix + "-sheets");
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {}
    }
    var legacyLink = localStorage.getItem("wf-" + prefix + "-sheet-link");
    if (legacyLink) {
      return [{ link: legacyLink, headerRow: localStorage.getItem("wf-" + prefix + "-header-row") || "1" }];
    }
    return [];
  }

  var CANONICAL_FIELD_KEYWORDS = {
    "transaction date": ["date"],
    "portfolio name": ["portfolio"],
    "instrument name": ["instrument", "scheme", "fund"],
    "transaction type": ["transaction type", "type"],
    units: ["unit"],
    price: ["price", "nav", "rate"]
  };

  function findHeaderIndex(ownHeader, canonicalName) {
    var exact = ownHeader.indexOf(canonicalName);
    if (exact !== -1) return exact;
    var keywords = CANONICAL_FIELD_KEYWORDS[canonicalName] || [];
    for (var k = 0; k < keywords.length; k++) {
      var idx = ownHeader.findIndex(function (h) { return h.indexOf(keywords[k]) !== -1; });
      if (idx !== -1) return idx;
    }
    return -1;
  }

  function realignRowsToHeader(rows, canonicalHeader) {
    var normalizedCanonical = canonicalHeader.map(normalizeText);
    var ownHeader = rows[0].map(normalizeText);
    var columnMap = normalizedCanonical.map(function (name) { return findHeaderIndex(ownHeader, name); });
    return rows.slice(1).map(function (row) {
      return columnMap.map(function (idx) { return idx === -1 ? "" : (row[idx] || ""); });
    });
  }

  function fetchAndMergeSheets(configs, onComplete, canonicalFields) {
    var perSheetStats = configs.map(function (c) {
      return { link: c.link, rowCount: 0, error: c.link && parseSheetUrl(c.link) ? null : "query" };
    });
    var validIndexes = [];
    configs.forEach(function (c, i) {
      if (c.link && parseSheetUrl(c.link)) validIndexes.push(i);
    });
    var failures = configs.length - validIndexes.length;
    if (!validIndexes.length) {
      onComplete(null, failures, [], perSheetStats);
      return;
    }

    var resultsByIndex = new Array(validIndexes.length);
    var pending = validIndexes.length;
    var failureReasons = [];

    function finish() {
      var merged = null;
      resultsByIndex.forEach(function (rows) {
        if (!rows || rows.length <= 1) return;
        if (canonicalFields) {
          var aligned = realignRowsToHeader(rows, canonicalFields);
          merged = merged ? merged.concat(aligned) : [canonicalFields].concat(aligned);
        } else if (!merged) {
          merged = rows;
        } else {
          merged = merged.concat(realignRowsToHeader(rows, merged[0]));
        }
      });
      onComplete(merged, failures, failureReasons, perSheetStats);
    }

    validIndexes.forEach(function (origIndex, i) {
      var config = configs[origIndex];
      var parsed = parseSheetUrl(config.link);
      fetchSheetJSONP(
        parsed.id,
        parsed.gid,
        function (data) {
          var rows = gvizRowsFromResponse(data);
          resultsByIndex[i] = rows;
          perSheetStats[origIndex].rowCount = Math.max(rows.length - 1, 0);
          pending -= 1;
          if (pending <= 0) finish();
        },
        function (reason) {
          failures += 1;
          failureReasons.push(reason);
          perSheetStats[origIndex].error = reason;
          pending -= 1;
          if (pending <= 0) finish();
        },
        config.headerRow
      );
    });
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

    function setConnected(state) {
      statusPill.classList.remove("connected", "warning");
      if (state === "warning") {
        statusPill.textContent = "Connected";
        statusPill.classList.add("warning");
      } else if (state) {
        statusPill.textContent = "Connected";
        statusPill.classList.add("connected");
      } else {
        statusPill.textContent = "Not connected";
      }
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
          populatePortfolioSelect();
          var diagnostics = buildSyncDiagnostics(prefix, rows);
          var displayRows = filterColumns(rows, options.fields);
          if (options.showTable === false) {
            sheetTableWrap.hidden = true;
          } else {
            renderTable(displayRows);
            sheetTableWrap.hidden = false;
          }
          setStatus(diagnostics.message, diagnostics.missingColumns);
          setConnected(diagnostics.missingColumns ? "warning" : true);

          var rowCount = displayRows.length - 1;
          rowCountEl.textContent = rowCount + (rowCount === 1 ? " row" : " rows");
          lastSync.textContent = "Last sync: " + new Date().toLocaleTimeString();
          openSheetLink.href = url;
          meta.hidden = false;
        },
        function (reason) {
          setStatus(sheetErrorMessage(reason), true);
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

    function autoSave() {
      var url = sheetLinkInput.value.trim();
      if (url) localStorage.setItem(storageKey, url);
      if (headerRowInput) localStorage.setItem(headerRowKey, headerRowInput.value || "1");
    }

    sheetLinkInput.addEventListener("change", autoSave);
    if (headerRowInput) headerRowInput.addEventListener("change", autoSave);

    sheetSyncBtn.addEventListener("click", function () {
      var url = sheetLinkInput.value.trim();
      if (!url) return;
      autoSave();
      syncSheet(url);
    });
  }

  var TRANSACTION_SHEET_FIELDS = [
    "Transaction Date",
    "Portfolio Name",
    "Instrument Name",
    "Transaction Type",
    "Units",
    "Price"
  ];

  function initMultiSheetCard(prefix, options) {
    options = options || {};
    var listEl = document.getElementById(prefix + "-sheets-list");
    if (!listEl) return;

    var addBtn = document.getElementById(prefix + "-sheet-add");
    var sheetSyncBtn = document.getElementById(prefix + "-sheet-sync");
    var sheetStatus = document.getElementById(prefix + "-sheet-status");
    var sheetTableWrap = document.getElementById(prefix + "-sheet-table-wrap");
    var sheetTable = document.getElementById(prefix + "-sheet-table");
    var statusPill = document.getElementById(prefix + "-status-pill");
    var sheetsKey = "wf-" + prefix + "-sheets";

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

    function setConnected(state) {
      statusPill.classList.remove("connected", "warning");
      if (state === "warning") {
        statusPill.textContent = "Connected";
        statusPill.classList.add("warning");
      } else if (state) {
        statusPill.textContent = "Connected";
        statusPill.classList.add("connected");
      } else {
        statusPill.textContent = "Not connected";
      }
    }

    function autoSaveConfigs() {
      var configs = readRowConfigs().filter(function (c) { return c.link; });
      localStorage.setItem(sheetsKey, JSON.stringify(configs));
      localStorage.removeItem("wf-" + prefix + "-sheet-link");
      localStorage.removeItem("wf-" + prefix + "-header-row");
    }

    function addRow(config) {
      config = config || { link: "", headerRow: "1" };
      var row = document.createElement("div");
      row.className = "sheet-row";

      var linkInput = document.createElement("input");
      linkInput.type = "url";
      linkInput.className = "sheet-row-link";
      linkInput.placeholder = "Paste your Google Sheets link here";
      linkInput.value = config.link || "";
      linkInput.addEventListener("change", autoSaveConfigs);

      var headerInput = document.createElement("input");
      headerInput.type = "number";
      headerInput.className = "sheet-row-header-row header-row-input";
      headerInput.min = "1";
      headerInput.value = config.headerRow || "1";
      headerInput.title = "Row number where column headers are";
      headerInput.addEventListener("change", autoSaveConfigs);

      var removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn btn-ghost btn-sm sheet-row-remove";
      removeBtn.setAttribute("aria-label", "Remove sheet");
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", function () {
        row.remove();
        if (!listEl.children.length) addRow();
        autoSaveConfigs();
      });

      var fields = document.createElement("div");
      fields.className = "equity-link-row sheet-row-fields";
      fields.appendChild(linkInput);
      fields.appendChild(headerInput);
      fields.appendChild(removeBtn);

      var rowMeta = document.createElement("div");
      rowMeta.className = "equity-meta muted small sheet-row-meta";
      rowMeta.hidden = true;
      var rowLastSync = document.createElement("span");
      rowLastSync.className = "sheet-row-last-sync";
      rowLastSync.textContent = "Last sync: —";
      var dotSep = document.createElement("span");
      dotSep.className = "dot-sep";
      dotSep.setAttribute("aria-hidden", "true");
      dotSep.innerHTML = "&bull;";
      var rowCountSpan = document.createElement("span");
      rowCountSpan.className = "sheet-row-count";
      rowCountSpan.textContent = "0 rows";
      var dotSep2 = document.createElement("span");
      dotSep2.className = "dot-sep";
      dotSep2.setAttribute("aria-hidden", "true");
      dotSep2.innerHTML = "&bull;";
      var rowOpenLink = document.createElement("a");
      rowOpenLink.className = "sheet-row-open-link";
      rowOpenLink.href = "#";
      rowOpenLink.target = "_blank";
      rowOpenLink.rel = "noopener";
      rowOpenLink.innerHTML = "Open sheet &#8599;";
      rowMeta.appendChild(rowLastSync);
      rowMeta.appendChild(dotSep);
      rowMeta.appendChild(rowCountSpan);
      rowMeta.appendChild(dotSep2);
      rowMeta.appendChild(rowOpenLink);

      row.appendChild(fields);
      row.appendChild(rowMeta);
      listEl.appendChild(row);
    }

    function readRowConfigs() {
      return Array.prototype.slice.call(listEl.querySelectorAll(".sheet-row")).map(function (row) {
        return {
          link: row.querySelector(".sheet-row-link").value.trim(),
          headerRow: row.querySelector(".sheet-row-header-row").value || "1"
        };
      });
    }

    function applyPerSheetStats(perSheetStats) {
      var rowEls = Array.prototype.slice.call(listEl.querySelectorAll(".sheet-row"));
      var now = new Date().toLocaleTimeString();
      var statsByLink = {};
      (perSheetStats || []).forEach(function (s) {
        if (s && s.link) statsByLink[s.link] = s;
      });
      rowEls.forEach(function (rowEl) {
        var link = rowEl.querySelector(".sheet-row-link").value.trim();
        var rowMeta = rowEl.querySelector(".sheet-row-meta");
        if (!rowMeta) return;
        var stats = link ? statsByLink[link] : null;
        if (!link || !stats) {
          rowMeta.hidden = true;
          return;
        }
        var lastSyncSpan = rowMeta.querySelector(".sheet-row-last-sync");
        var rowCountSpan = rowMeta.querySelector(".sheet-row-count");
        var openLink = rowMeta.querySelector(".sheet-row-open-link");
        if (stats.error) {
          lastSyncSpan.textContent = "Last sync failed";
          rowCountSpan.textContent = sheetErrorMessage(stats.error);
        } else {
          lastSyncSpan.textContent = "Last sync: " + now;
          rowCountSpan.textContent = stats.rowCount + (stats.rowCount === 1 ? " row" : " rows");
        }
        openLink.href = link;
        rowMeta.hidden = false;
      });
    }

    function syncAll() {
      var configs = readRowConfigs().filter(function (c) { return c.link; });
      if (!configs.length) {
        setStatus("Add at least one Google Sheets link.", true);
        sheetTableWrap.hidden = true;
        setConnected(false);
        return;
      }
      setStatus("Verifying and syncing " + configs.length + " sheet(s)…", false);

      fetchAndMergeSheets(configs, function (merged, failures, failureReasons, perSheetStats) {
        applyPerSheetStats(perSheetStats);
        if (!merged || merged.length <= 1) {
          var reasonMsg = failures
            ? (failureReasons.indexOf("private") !== -1
                ? sheetErrorMessage("private")
                : "Couldn't load " + failures + " of " + configs.length + " sheet(s). " + sheetErrorMessage(failureReasons[0]))
            : "The sheet(s) appear to be empty.";
          setStatus(reasonMsg, true);
          sheetTableWrap.hidden = true;
          setConnected(false);
          return;
        }
        addPortfolioNames(extractColumnValues(merged, "Portfolio Name"));
        localStorage.setItem("wf-" + prefix + "-data", JSON.stringify(merged));
        updateDashboardStats();
        updateRefreshButtonStatus(prefix);
        populatePortfolioSelect();
        var diagnostics = buildSyncDiagnostics(prefix, merged);
        var displayRows = filterColumns(merged, options.fields);
        if (options.showTable === false) {
          sheetTableWrap.hidden = true;
        } else {
          renderTable(displayRows);
          sheetTableWrap.hidden = false;
        }
        var failureNote = failures
          ? " (" + failures + " sheet(s) failed to load: " + sheetErrorMessage(failureReasons[0]) + ")"
          : "";
        setStatus(diagnostics.message + failureNote, !!failures || diagnostics.missingColumns);
        setConnected(diagnostics.missingColumns ? "warning" : true);
      }, options.fields);
    }

    var savedConfigs = loadSheetConfigs(prefix);
    if (savedConfigs.length) {
      savedConfigs.forEach(function (c) { addRow(c); });
    } else {
      addRow();
    }

    if (addBtn) {
      addBtn.addEventListener("click", function () { addRow(); autoSaveConfigs(); });
    }

    if (sheetSyncBtn) {
      sheetSyncBtn.addEventListener("click", function () {
        autoSaveConfigs();
        syncAll();
      });
    }

    if (savedConfigs.length) syncAll();
  }

  initMultiSheetCard("equity", { fields: TRANSACTION_SHEET_FIELDS, showTable: false });
  initMultiSheetCard("fixedincome", { fields: TRANSACTION_SHEET_FIELDS, showTable: false });
  initMultiSheetCard("stocksetf", { fields: TRANSACTION_SHEET_FIELDS, showTable: false });
  initSheetCard("mfmapping");
  initSheetCard("stocksetfmapping");

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
        var revived = (cached.data || []).map(function (entry) { return { date: new Date(entry.date), nav: entry.nav }; });
        return Promise.resolve(revived);
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
      if (instrument && isin) {
        map[instrument] = isin;
        map[normalizeText(instrument)] = isin;
      }
    });
    if (!Object.keys(map).length) {
      lastIsinMapDiagnostic = "Mutual Fund Mapping sheet has rows, but none had both Instrument Name and Identifier filled in.";
    }
    return map;
  }
  var lastIsinMapDiagnostic = null;

  function buildInstrumentSegmentMap() {
    var rows = getSheetRows("mfmapping");
    var map = {};
    if (!rows || !rows.length) return map;
    var header = rows[0].map(normalizeText);
    var instrumentIdx = header.indexOf("instrument name");
    var segmentIdx = header.findIndex(function (h) { return h.indexOf("market segment") !== -1; });
    if (segmentIdx === -1) segmentIdx = header.findIndex(function (h) { return h.indexOf("segment") !== -1; });
    if (segmentIdx === -1) segmentIdx = header.findIndex(function (h) { return h.indexOf("category") !== -1; });
    if (instrumentIdx === -1 || segmentIdx === -1) return map;
    rows.slice(1).forEach(function (row) {
      var instrument = (row[instrumentIdx] || "").trim();
      var segment = (row[segmentIdx] || "").trim();
      if (instrument && segment) {
        map[instrument] = segment;
        map[normalizeText(instrument)] = segment;
      }
    });
    return map;
  }

  function lookupSegment(segmentMap, instrumentName) {
    return segmentMap[instrumentName] || segmentMap[normalizeText(instrumentName)] || "Unclassified";
  }

  // The browser can't fetch AMFI's NAVAll.txt directly or via public CORS
  // proxies (AMFI blocks both). fetch_amfi_isin_map.py fetches it server-side
  // and writes amfi_isin_map.json into the repo; reading that same-origin
  // file avoids CORS entirely. A GitHub Actions workflow refreshes it daily.
  function fetchStaticAmfiIsinMap() {
    return fetch(AMFI_ISIN_MAP_STATIC_FILE, { cache: "no-store" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (payload) { return payload && payload.data ? payload.data : null; })
      .catch(function () { return null; });
  }

  function fetchAmfiIsinToSchemeMap() {
    try {
      var cached = JSON.parse(localStorage.getItem(AMFI_ISIN_MAP_CACHE_KEY));
      if (cached && Date.now() - cached.fetchedAt < AMFI_ISIN_MAP_MAX_AGE_MS) {
        return Promise.resolve(cached.data);
      }
    } catch (e) {}

    lastAmfiFetchFailures = [];
    return fetchStaticAmfiIsinMap().then(function (staticData) {
      if (staticData && Object.keys(staticData).length) {
        try {
          localStorage.setItem(AMFI_ISIN_MAP_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), data: staticData }));
        } catch (e) {}
        return staticData;
      }
      lastAmfiFetchFailures.push("amfi_isin_map.json missing or empty");
      return {};
    });
  }

  var lastSchemeMapDiagnostic = null;

  function lookupSchemeCode(schemeMap, instrumentName) {
    return schemeMap[instrumentName] || schemeMap[normalizeText(instrumentName)];
  }

  function buildInstrumentSchemeMap() {
    var isinMap = buildInstrumentIsinMap();
    lastSchemeMapDiagnostic = null;
    return fetchAmfiIsinToSchemeMap().then(function (isinToCode) {
      var map = {};
      Object.keys(isinMap).forEach(function (instrument) {
        var isin = isinMap[instrument];
        var code = isinToCode[isin];
        if (code) {
          map[instrument] = code;
          map[normalizeText(instrument)] = code;
        }
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
      lastUnitEventsDiagnostic = "no synced Mutual Fund Transactions data";
      return events;
    }
    var header = rows[0].map(normalizeText);
    var dateColIdx = header.findIndex(function (h) { return h.indexOf("date") !== -1; });
    var required = {
      "portfolio name": header.indexOf("portfolio name"),
      "instrument name": header.indexOf("instrument name"),
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
    var typeIdx = required["transaction type"];
    var unitsIdx = required.units;
    var dateIdx = required["a date column"];

    var equityRowCount = 0;
    var unparseableDateCount = 0;
    rows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && normalizeText(portfolio) !== normalizeText(portfolioFilter)) return;
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
        : "no rows matched the selected portfolio.";
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
      var instruments = Object.keys(unitEvents).filter(function (name) { return !!lookupSchemeCode(schemeMap, name); });
      var skipped = Object.keys(unitEvents).length - instruments.length;

      if (!instruments.length) {
        statusEl.textContent = skipped
          ? "No Instrument Name in your Equity sheet could be resolved to a Scheme Code via the Mutual Fund Mapping sheet and AMFI."
          : "Connect your Mutual Fund Transactions and Mutual Fund Mapping sheets to see this chart.";
        return;
      }

      statusEl.textContent = "Fetching NAV history for " + instruments.length + " instrument(s)…";

      return Promise.all(instruments.map(function (name) { return fetchNavHistory(lookupSchemeCode(schemeMap, name)); }))
        .then(function (navHistories) {
        var navByInstrument = {};
        instruments.forEach(function (name, i) { navByInstrument[name] = navHistories[i]; });

        var allDates = {};
        instruments.forEach(function (name) {
          (navByInstrument[name] || []).forEach(function (entry) { allDates[dateKey(entry.date)] = entry.date; });
        });
        var timeline = Object.keys(allDates).map(function (k) { return allDates[k]; }).sort(function (a, b) { return a - b; });
        var today = new Date();
        var firstTxnDate = null, lastTxnDate = null;
        instruments.forEach(function (name) {
          var events = unitEvents[name];
          if (events && events.length) {
            var earliest = events[0].date;
            var latest = events[events.length - 1].date;
            if (!firstTxnDate || earliest < firstTxnDate) firstTxnDate = earliest;
            if (!lastTxnDate || latest > lastTxnDate) lastTxnDate = latest;
          }
        });
        timeline = timeline.filter(function (d) { return d <= today && (!firstTxnDate || d >= firstTxnDate); });

        if (!timeline.length) {
          statusEl.textContent = "No NAV history available yet for your mapped instruments.";
          return;
        }

        var points = timeline.map(function (date) {
          var total = 0;
          instruments.forEach(function (name) {
            var units = lastAtOrBefore(unitEvents[name], date, "cumulativeUnits") || 0;
            var nav = lastAtOrBefore(navByInstrument[name], date, "nav");
            if (units > UNITS_EPSILON && nav) total += units * nav;
          });
          return { x: date, y: total };
        });

        statusEl.textContent = instruments.length + " instrument(s) plotted" + (skipped ? " (" + skipped + " unmapped instrument(s) skipped)" : "") + ".";

        var first = timeline[0], last = timeline[timeline.length - 1];
        if (rangeEl) rangeEl.textContent = first.toLocaleDateString() + " – " + last.toLocaleDateString();

        var fullMinTime = first.getTime();
        var fullMaxTime = last.getTime();
        var sixMonthsMs = 1000 * 60 * 60 * 24 * 182;
        var initialMin = Math.max(fullMinTime, fullMaxTime - sixMonthsMs);
        var initialMax = fullMaxTime;

        if (window.__wfValueChart) window.__wfValueChart.destroy();
        var ctx = canvas.getContext("2d");
        var fillGradient = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 320);
        fillGradient.addColorStop(0, "rgba(59,130,246,0.25)");
        fillGradient.addColorStop(1, "rgba(59,130,246,0)");
        window.__wfValueChart = new Chart(ctx, {
          type: "line",
          data: {
            datasets: [{
              label: "Current Value",
              data: points,
              borderColor: "#3B82F6",
              backgroundColor: fillGradient,
              fill: true,
              tension: 0,
              stepped: "before",
              pointRadius: 0,
              borderWidth: 1.5
            }]
          },
          options: {
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: "index" },
            scales: {
              x: {
                type: "time",
                time: { unit: "month", displayFormats: { month: "MMM" } },
                min: initialMin,
                max: initialMax,
                grid: { display: false },
                ticks: {
                  maxRotation: 0,
                  autoSkip: true,
                  major: { enabled: true },
                  font: function (ctx) { return ctx.tick && ctx.tick.major ? { weight: "bold" } : {}; },
                  callback: function (value, index, ticks) {
                    var d = new Date(value);
                    return d.getMonth() === 0 ? String(d.getFullYear()) : d.toLocaleDateString("en-US", { month: "short" });
                  }
                }
              },
              y: { ticks: { callback: function (v) { return formatCompactINR(v); } }, grid: { display: false } }
            },
            plugins: {
              legend: { display: false },
              zoom: {
                limits: {
                  x: {
                    min: firstTxnDate ? firstTxnDate.getTime() : undefined,
                    max: lastTxnDate ? lastTxnDate.getTime() : undefined
                  }
                },
                pan: {
                  enabled: true,
                  mode: "x",
                  onPanComplete: function (ctx) { updateVisibleRangeLabel(ctx.chart); }
                },
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
    }).catch(function (err) {
      statusEl.textContent = "Couldn't render the chart: " + (err && err.message ? err.message : err);
    });

    if (resetBtn && !resetBtn.dataset.bound) {
      resetBtn.dataset.bound = "1";
      resetBtn.addEventListener("click", function () {
        if (window.__wfValueChart) window.__wfValueChart.resetZoom();
      });
    }
  }

  renderValueChart();

  function collectPortfolioNamesFromSheets(prefixes) {
    var names = [];
    var seen = {};
    prefixes.forEach(function (prefix) {
      var rows = getSheetRows(prefix);
      if (!rows || !rows.length) return;
      var header = rows[0].map(normalizeText);
      var portfolioIdx = findHeaderIndex(header, "portfolio name");
      if (portfolioIdx === -1) return;
      rows.slice(1).forEach(function (row) {
        var name = (row[portfolioIdx] == null ? "" : String(row[portfolioIdx])).trim();
        if (!name) return;
        var key = normalizeText(name);
        if (!seen[key]) { seen[key] = true; names.push(name); }
      });
    });
    return names;
  }

  function renderInvestmentSplitChart() {
    var canvas = document.getElementById("portfolio-split-chart");
    var statusEl = document.getElementById("portfolio-split-status");
    if (!canvas || !statusEl || typeof Chart === "undefined") return;

    var prefixes = ["equity", "stocksetf", "fixedincome"];
    var names = collectPortfolioNamesFromSheets(prefixes);
    if (!names.length) {
      statusEl.textContent = "No portfolios found yet. Connect your transaction sheets in Settings.";
      if (window.__wfSplitChart) { window.__wfSplitChart.destroy(); window.__wfSplitChart = null; }
      return;
    }

    var labels = [];
    var data = [];
    names.forEach(function (name) {
      var invested = computeTotalInvestment(name, prefixes);
      if (invested > UNITS_EPSILON) {
        labels.push(name);
        data.push(invested);
      }
    });

    if (!labels.length) {
      statusEl.textContent = "No invested amount found yet across your portfolios.";
      if (window.__wfSplitChart) { window.__wfSplitChart.destroy(); window.__wfSplitChart = null; }
      return;
    }

    var total = data.reduce(function (sum, v) { return sum + v; }, 0);
    statusEl.textContent = "Invested value split across " + labels.length + " portfolio(s), total " + formatCurrency(total) + ".";

    if (window.__wfSplitChart) window.__wfSplitChart.destroy();
    var ctx = canvas.getContext("2d");
    window.__wfSplitChart = new Chart(ctx, {
      type: "pie",
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: labels.map(function (_, i) { return SPLIT_CHART_COLORS[i % SPLIT_CHART_COLORS.length]; }),
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var value = ctx.parsed;
                var pct = total > 0 ? (value / total) * 100 : 0;
                return ctx.label + ": " + formatCurrency(value) + " (" + pct.toFixed(1) + "%)";
              }
            }
          }
        }
      }
    });
  }

  function renderEquityHoldingsTable() {
    var statusEl = document.getElementById("equity-holdings-status");
    var tableWrap = document.getElementById("equity-holdings-table-wrap");
    var tbody = document.getElementById("equity-holdings-tbody");
    if (!statusEl || !tableWrap || !tbody) return;

    var rows = getSheetRows("equity");
    if (!rows || !rows.length) {
      statusEl.textContent = "Connect your Mutual Fund Transactions sheet in Settings to populate this view.";
      tableWrap.hidden = true;
      return;
    }

    var selectedPortfolio = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
    var transactionsByInstrument = groupUnitTransactionsByInstrument(rows, selectedPortfolio);
    if (!transactionsByInstrument) {
      statusEl.textContent = "Header row number is incorrect. Make adjustments by adding correct header row number.";
      tableWrap.hidden = true;
      return;
    }

    var showClosedOnlyCheckbox = document.getElementById("equity-holdings-show-closed-only");
    var showClosedOnly = !!(showClosedOnlyCheckbox && showClosedOnlyCheckbox.checked);

    var holdings = [];
    Object.keys(transactionsByInstrument).forEach(function (instrument) {
      var remainingLots = fifoRemainingLots(transactionsByInstrument[instrument]);
      var remainingUnits = 0, investedCost = 0;
      remainingLots.forEach(function (lot) { remainingUnits += lot.units; investedCost += lot.units * lot.price; });
      if (showClosedOnly) {
        if (remainingUnits >= 1) return;
      } else if (remainingUnits < 1) {
        return;
      }
      var avgNav;
      if (remainingUnits > UNITS_EPSILON) {
        avgNav = investedCost / remainingUnits;
      } else {
        avgNav = computeInstrumentRealizedDetail(transactionsByInstrument[instrument]).avgBuyCost;
      }
      holdings.push({ instrument: instrument, units: remainingUnits, invested: investedCost, avgNav: avgNav });
    });

    if (!holdings.length) {
      statusEl.textContent = "No mutual fund holdings with unsold units found.";
      tableWrap.hidden = true;
      return;
    }

    statusEl.textContent = "Resolving mutual fund scheme codes…";

    buildInstrumentSchemeMap().then(function (schemeMap) {
      var resolvable = holdings.filter(function (h) { return h.units < 1 || !!lookupSchemeCode(schemeMap, h.instrument); });
      var skipped = holdings.length - resolvable.length;
      if (!resolvable.length) {
        statusEl.textContent = "None of your holdings could be resolved to a Scheme Code via the Mutual Fund Mapping sheet and AMFI.";
        tableWrap.hidden = true;
        return;
      }

      return Promise.all(resolvable.map(function (h) { return h.units < 1 ? Promise.resolve([]) : fetchNavHistory(lookupSchemeCode(schemeMap, h.instrument)); }))
        .then(function (navHistories) {
          tbody.innerHTML = "";
          resolvable.forEach(function (h, i) {
            var isClosed = h.units < 1;
            var currNav, current, pnl, pnlPct, dayChgPct;

            if (isClosed) {
              var detail = computeInstrumentRealizedDetail(transactionsByInstrument[h.instrument]);
              currNav = detail.lastSellPrice;
              current = detail.saleProceeds;
              pnl = detail.realizedPnl;
              pnlPct = detail.costOfSoldUnits > 0 ? (pnl / detail.costOfSoldUnits) * 100 : 0;
              dayChgPct = 0;
            } else {
              var navHistory = navHistories[i] || [];
              if (!navHistory.length) return;
              var latest = navHistory[navHistory.length - 1];
              var prev = navHistory.length > 1 ? navHistory[navHistory.length - 2] : null;
              currNav = latest.nav;
              current = h.units * currNav;
              pnl = current - h.invested;
              pnlPct = h.invested > 0 ? (pnl / h.invested) * 100 : 0;
              dayChgPct = prev && prev.nav ? ((currNav - prev.nav) / prev.nav) * 100 : 0;
            }

            var tr = document.createElement("tr");

            var nameTd = document.createElement("td");
            nameTd.className = "fund-name";
            nameTd.textContent = h.instrument;
            tr.appendChild(nameTd);

            var qtyTd = document.createElement("td");
            qtyTd.className = "num";
            qtyTd.textContent = h.units.toFixed(3);
            tr.appendChild(qtyTd);

            var avgNavTd = document.createElement("td");
            avgNavTd.className = "num";
            avgNavTd.textContent = h.avgNav.toFixed(2);
            tr.appendChild(avgNavTd);

            var currNavTd = document.createElement("td");
            currNavTd.className = "num";
            currNavTd.textContent = currNav.toFixed(3);
            tr.appendChild(currNavTd);

            var investedTd = document.createElement("td");
            investedTd.className = "num";
            investedTd.textContent = formatCurrency(h.invested);
            tr.appendChild(investedTd);

            var currentTd = document.createElement("td");
            currentTd.className = "num";
            currentTd.textContent = formatCurrency(current);
            tr.appendChild(currentTd);

            var pnlTd = document.createElement("td");
            pnlTd.className = "num " + (pnl > 0 ? "positive" : (pnl < 0 ? "negative" : ""));
            pnlTd.textContent = (pnl > 0 ? "+" : "") + formatCurrency(pnl);
            tr.appendChild(pnlTd);

            var netChgTd = document.createElement("td");
            netChgTd.className = "num " + (pnlPct > 0 ? "positive" : (pnlPct < 0 ? "negative" : ""));
            netChgTd.textContent = (pnlPct > 0 ? "+" : "") + pnlPct.toFixed(2) + "%";
            tr.appendChild(netChgTd);

            var dayChgTd = document.createElement("td");
            dayChgTd.className = "num " + (dayChgPct > 0 ? "positive" : (dayChgPct < 0 ? "negative" : ""));
            dayChgTd.textContent = (dayChgPct > 0 ? "+" : "") + dayChgPct.toFixed(2) + "%";
            tr.appendChild(dayChgTd);

            var instrumentCashFlows = buildXirrCashFlows(rows, selectedPortfolio, h.instrument);
            if (!isClosed && current > UNITS_EPSILON) instrumentCashFlows.push({ date: new Date(), amount: current });
            var instrumentXirr = calculateXIRR(instrumentCashFlows);
            var xirrTd = document.createElement("td");
            if (instrumentXirr === null || instrumentXirr === undefined || !isFinite(instrumentXirr)) {
              xirrTd.className = "num";
              xirrTd.textContent = "—";
            } else {
              var xirrPct = instrumentXirr * 100;
              xirrTd.className = "num " + (xirrPct > 0 ? "positive" : (xirrPct < 0 ? "negative" : ""));
              xirrTd.textContent = (xirrPct > 0 ? "+" : "") + xirrPct.toFixed(2) + "%";
            }
            tr.appendChild(xirrTd);

            tbody.appendChild(tr);
          });

          statusEl.textContent = resolvable.length + " holding(s) with unsold units" + (skipped ? " (" + skipped + " unmapped holding(s) skipped)" : "") + ".";
          tableWrap.hidden = false;
        });
    }).catch(function (err) {
      statusEl.textContent = "Couldn't load holdings: " + (err && err.message ? err.message : err);
      tableWrap.hidden = true;
    });
  }

  renderEquityHoldingsTable();

  function renderMarketSegmentChart() {
    var canvas = document.getElementById("market-segment-chart");
    var statusEl = document.getElementById("market-segment-status");
    if (!canvas || !statusEl || typeof Chart === "undefined") return;

    var rows = getSheetRows("equity");
    if (!rows || !rows.length) {
      statusEl.textContent = "Connect your Mutual Fund Transactions sheet in Settings to populate this chart.";
      if (window.__wfSegmentChart) { window.__wfSegmentChart.destroy(); window.__wfSegmentChart = null; }
      return;
    }

    var selectedPortfolio = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
    var transactionsByInstrument = groupUnitTransactionsByInstrument(rows, selectedPortfolio);
    if (!transactionsByInstrument) {
      statusEl.textContent = "Header row number is incorrect. Make adjustments by adding correct header row number.";
      return;
    }

    var holdings = [];
    Object.keys(transactionsByInstrument).forEach(function (instrument) {
      var remainingLots = fifoRemainingLots(transactionsByInstrument[instrument]);
      var remainingUnits = 0, investedCost = 0;
      remainingLots.forEach(function (lot) { remainingUnits += lot.units; investedCost += lot.units * lot.price; });
      if (remainingUnits < 1) return;
      holdings.push({ instrument: instrument, units: remainingUnits, invested: investedCost });
    });

    if (!holdings.length) {
      statusEl.textContent = "No mutual fund holdings with unsold units found.";
      if (window.__wfSegmentChart) { window.__wfSegmentChart.destroy(); window.__wfSegmentChart = null; }
      return;
    }

    buildInstrumentSchemeMap().then(function (schemeMap) {
      var segmentMap = buildInstrumentSegmentMap();
      var resolvable = holdings.filter(function (h) { return !!lookupSchemeCode(schemeMap, h.instrument); });
      if (!resolvable.length) {
        statusEl.textContent = "None of your holdings could be resolved to a Scheme Code via the Mutual Fund Mapping sheet and AMFI.";
        if (window.__wfSegmentChart) { window.__wfSegmentChart.destroy(); window.__wfSegmentChart = null; }
        return;
      }

      return Promise.all(resolvable.map(function (h) { return fetchNavHistory(lookupSchemeCode(schemeMap, h.instrument)); }))
        .then(function (navHistories) {
          var totalsBySegment = {};
          resolvable.forEach(function (h, i) {
            var navHistory = navHistories[i] || [];
            if (!navHistory.length) return;
            var currNav = navHistory[navHistory.length - 1].nav;
            var current = h.units * currNav;
            var segment = lookupSegment(segmentMap, h.instrument);
            totalsBySegment[segment] = (totalsBySegment[segment] || 0) + current;
          });

          var labels = Object.keys(totalsBySegment);
          if (!labels.length) {
            statusEl.textContent = "Couldn't determine current value for any holding yet.";
            if (window.__wfSegmentChart) { window.__wfSegmentChart.destroy(); window.__wfSegmentChart = null; }
            return;
          }
          var data = labels.map(function (l) { return totalsBySegment[l]; });
          var total = data.reduce(function (sum, v) { return sum + v; }, 0);

          var hasUnclassified = labels.indexOf("Unclassified") !== -1;
          statusEl.textContent = "Current value split across " + labels.length + " market segment(s), total " + formatCurrency(total) + "." +
            (hasUnclassified ? " Add a \"Market Segment\" column to your Mutual Fund Mapping sheet to classify all holdings." : "");

          if (window.__wfSegmentChart) window.__wfSegmentChart.destroy();
          var ctx = canvas.getContext("2d");
          window.__wfSegmentChart = new Chart(ctx, {
            type: "pie",
            data: {
              labels: labels,
              datasets: [{
                data: data,
                backgroundColor: labels.map(function (_, i) { return SPLIT_CHART_COLORS[i % SPLIT_CHART_COLORS.length]; }),
                borderWidth: 1
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { position: "bottom" },
                tooltip: {
                  callbacks: {
                    label: function (ctx) {
                      var value = ctx.parsed;
                      var pct = total > 0 ? (value / total) * 100 : 0;
                      return ctx.label + ": " + formatCurrency(value) + " (" + pct.toFixed(1) + "%)";
                    }
                  }
                }
              }
            }
          });
        });
    }).catch(function (err) {
      statusEl.textContent = "Couldn't load the market segment split: " + (err && err.message ? err.message : err);
    });
  }

  renderMarketSegmentChart();

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

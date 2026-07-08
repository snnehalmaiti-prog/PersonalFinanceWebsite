(function () {
  "use strict";

  // ===== Theme toggle =====
  var root = document.documentElement;
  var themeToggle = document.getElementById("theme-toggle");
  var storedTheme = localStorage.getItem("wf-theme");
  var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  var SPLIT_CHART_COLORS = ["#1F9D6B", "#F2A65A", "#6FA8DC", "#E1604B", "#9B8AFB", "#D9B44A", "#4FBDB0", "#C97FB0"];

  function getCssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }


  if (typeof Chart !== "undefined") {
    Chart.register({
      id: "wfCenterText",
      afterDraw: function (chart) {
        var opts = chart.config.options.plugins && chart.config.options.plugins.wfCenterText;
        if (!opts || !opts.text) return;
        var ctx = chart.ctx;
        var area = chart.chartArea;
        var centerX = (area.left + area.right) / 2;
        var centerY = (area.top + area.bottom) / 2;
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = opts.color || "#23211D";
        ctx.font = "700 17px Sora, Inter, sans-serif";
        ctx.fillText(opts.text, centerX, centerY + (opts.subtext ? -9 : 0));
        if (opts.subtext) {
          ctx.font = "600 11px Inter, sans-serif";
          ctx.fillStyle = opts.subColor || "#7A7568";
          ctx.fillText(opts.subtext, centerX, centerY + 13);
        }
        ctx.restore();
      }
    });
  }

  function renderApplePieChart(canvas, opts) {
    var labels = opts.labels;
    var data = opts.data;
    var total = opts.total;
    var centerLabel = opts.centerLabel || "Current";
    var formatLabel = opts.formatLabel;

    if (window[opts.instanceKey]) window[opts.instanceKey].destroy();
    var ctx = canvas.getContext("2d");
    var surface = getCssVar("--surface") || "#FFFFFF";
    var textColor = getCssVar("--text") || "#23211D";
    var mutedColor = getCssVar("--muted") || "#7A7568";

    var chart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: labels.map(function (_, i) { return SPLIT_CHART_COLORS[i % SPLIT_CHART_COLORS.length]; }),
          borderColor: surface,
          borderWidth: 3,
          borderRadius: 8,
          spacing: 3,
          hoverOffset: 14,
          hoverBorderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "68%",
        animation: { animateRotate: true, animateScale: true, duration: 900, easing: "easeOutQuint" },
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              usePointStyle: true,
              pointStyle: "circle",
              padding: 14,
              boxWidth: 8,
              boxHeight: 8,
              color: mutedColor,
              font: { family: "Inter", size: 12, weight: "600" }
            }
          },
          tooltip: {
            backgroundColor: surface,
            titleColor: textColor,
            bodyColor: textColor,
            borderColor: getCssVar("--border") || "#ECE7DC",
            borderWidth: 1,
            padding: 12,
            cornerRadius: 10,
            displayColors: true,
            boxPadding: 4,
            callbacks: {
              label: function (ctx) {
                var value = ctx.parsed;
                var pct = total > 0 ? (value / total) * 100 : 0;
                return ctx.label + ": " + formatLabel(value) + " (" + pct.toFixed(1) + "%)";
              }
            }
          },
          wfCenterText: {
            text: formatLabel(total),
            subtext: centerLabel,
            color: textColor,
            subColor: mutedColor
          }
        }
      }
    });
    window[opts.instanceKey] = chart;
    return chart;
  }

  var AMFI_ISIN_MAP_CACHE_KEY = "wf-amfi-isin-map";
  var AMFI_ISIN_MAP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  var AMFI_ISIN_MAP_STATIC_FILE = "amfi_isin_map.json";
  var AMFI_NAV_MAP_CACHE_KEY = "wf-amfi-nav-map";
  var AMFI_NAV_MAP_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  var AMFI_NAV_MAP_STATIC_FILE = "amfi_nav.json";
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
      { tab: settingsTabMapping, panel: document.getElementById("panel-mapping"), key: "mapping" },
      { tab: document.getElementById("tab-expense"), panel: document.getElementById("panel-expense"), key: "expense" }
    ];

    function showSettingsTab(tab) {
      settingsTabs.forEach(function (entry) {
        if (!entry.tab) return;
        var isActive = entry.key === tab;
        entry.tab.classList.toggle("active", isActive);
        entry.tab.setAttribute("aria-selected", String(isActive));
        entry.panel.hidden = !isActive;
      });
      if (tab === "expense" && window.WfExpense) window.WfExpense.onShow();
    }

    settingsTabs.forEach(function (entry) {
      if (!entry.tab) return;
      entry.tab.addEventListener("click", function () { showSettingsTab(entry.key); });
    });
  }

  // ===== Dashboard tabs =====
  var dashTabOverview = document.getElementById("tab-overview");
  var dashTabInvestment = document.getElementById("tab-investment");
  if (dashTabOverview && dashTabInvestment) {
    var panelOverview = document.getElementById("panel-overview");
    var panelInvestment = document.getElementById("panel-investment");
    var dashTabs = [
      { tab: dashTabOverview, panel: panelOverview, key: "overview" },
      { tab: dashTabInvestment, panel: panelInvestment, key: "investment" },
      { tab: document.getElementById("tab-expense"), panel: document.getElementById("panel-expense"), key: "expense" }
    ];

    // ===== Investment sub-tabs =====
    var investSubTabs = [
      { tab: document.getElementById("subtab-equity"),      panel: document.getElementById("subpanel-equity"),      key: "equity" },
      { tab: document.getElementById("subtab-stocksetf"),   panel: document.getElementById("subpanel-stocksetf"),   key: "stocksetf" },
      { tab: document.getElementById("subtab-fixedincome"), panel: document.getElementById("subpanel-fixedincome"), key: "fixedincome" }
    ];

    function showInvestmentSubTab(key) {
      investSubTabs.forEach(function (entry) {
        if (!entry.tab || !entry.panel) return;
        var isActive = entry.key === key;
        entry.tab.classList.toggle("active", isActive);
        entry.tab.setAttribute("aria-selected", String(isActive));
        entry.panel.hidden = !isActive;
      });
      if (key === "stocksetf") renderStockEtfHoldingsTable();
      if (key === "equity") renderEquityHoldingsTable();
    }

    investSubTabs.forEach(function (entry) {
      if (!entry.tab) return;
      entry.tab.addEventListener("click", function () { showInvestmentSubTab(entry.key); });
    });

    function showDashboardTab(tab) {
      dashTabs.forEach(function (entry) {
        if (!entry.tab) return;
        var isActive = entry.key === tab;
        entry.tab.classList.toggle("active", isActive);
        entry.tab.setAttribute("aria-selected", String(isActive));
        entry.panel.hidden = !isActive;
      });
      document.querySelectorAll(".left-drawer-item").forEach(function (btn) {
        btn.classList.toggle("active", btn.dataset.tab === tab);
      });
      if (tab === "investment") {
        // activate Mutual Fund sub-tab by default when switching to Investment
        var activeSubTab = investSubTabs.find(function (e) { return e.tab && e.tab.classList.contains("active"); });
        var activeKey = activeSubTab ? activeSubTab.key : "equity";
        showInvestmentSubTab(activeKey);
      }
      if (tab === "expense" && typeof window.loadDashAccounts === "function") {
        // Re-fetch accounts/categories/payment methods so any Settings renames appear.
        window.loadDashAccounts();
      }
    }

    dashTabs.forEach(function (entry) {
      if (!entry.tab) return;
      entry.tab.addEventListener("click", function () { showDashboardTab(entry.key); });
    });
  }

  // ===== Left nav drawer (mobile) =====
  var leftDrawer = document.getElementById("left-drawer");
  var leftDrawerOverlay = document.getElementById("left-drawer-overlay");
  var leftDrawerToggle = document.getElementById("left-drawer-toggle");
  var leftDrawerClose = document.getElementById("left-drawer-close");

  function openLeftDrawer() {
    if (!leftDrawer) return;
    leftDrawer.hidden = false;
    leftDrawerOverlay.hidden = false;
    setTimeout(function () { leftDrawer.classList.add("open"); }, 10);
    if (leftDrawerToggle) leftDrawerToggle.setAttribute("aria-expanded", "true");
  }

  function closeLeftDrawer() {
    if (!leftDrawer) return;
    leftDrawer.classList.remove("open");
    leftDrawerOverlay.hidden = true;
    if (leftDrawerToggle) leftDrawerToggle.setAttribute("aria-expanded", "false");
  }

  if (leftDrawerToggle) leftDrawerToggle.addEventListener("click", openLeftDrawer);
  if (leftDrawerClose) leftDrawerClose.addEventListener("click", closeLeftDrawer);
  if (leftDrawerOverlay) leftDrawerOverlay.addEventListener("click", closeLeftDrawer);

  document.querySelectorAll(".left-drawer-item").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var tab = btn.dataset.tab;
      var tabEl = tab && document.getElementById("tab-" + tab);
      if (tabEl) tabEl.click();
      closeLeftDrawer();
    });
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && leftDrawer && leftDrawer.classList.contains("open")) closeLeftDrawer();
  });

  // Treat residual fractional units below this as a fully closed-out position,
  // to absorb floating-point rounding error from repeated cumulative +=/-=.
  var UNITS_EPSILON = 1e-6;

  // ===== Portfolio selector =====
  var PORTFOLIO_NAMES_KEY = "wf-portfolio-names";
  var SELECTED_PORTFOLIO_KEY = "wf-selected-portfolio";
  var EXCLUDE_FIXED_INCOME_KEY = "wf-exclude-fixedincome";
  var EXCLUDE_SAVINGS_INVESTMENT_KEY = "wf-exclude-savings-investment";

  function isFixedIncomeExcluded() {
    return localStorage.getItem(EXCLUDE_FIXED_INCOME_KEY) === "true";
  }

  // Investment Corpus/Savings Account holdings ("Savings/Investment Holding"). When excluded,
  // their Invested Amount/Current Value are dropped from every dashboard aggregate (Overview,
  // Fixed Income stats, Account Value chart) — separate from, and on top of, the always-on
  // exclusion of these holdings from XIRR (see buildFdAtParXirrCashFlows callers).
  function isSavingsInvestmentExcluded() {
    return localStorage.getItem(EXCLUDE_SAVINGS_INVESTMENT_KEY) === "true";
  }

  function overviewInvestmentPrefixes() {
    var base = ["equity", "fd", "stocksetf"];
    return isFixedIncomeExcluded() ? base.filter(function (p) { return p !== "fd"; }) : base;
  }

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
    renderAllFixedIncomeHoldingsTable();
    renderCommodityHoldingsTable();
    renderMarketSegmentChart();
    renderMutualFundPortfolioSplitChart();
    renderStockEtfHoldingsTable();
  }

  function parseNumber(value) {
    var raw = String(value == null ? "" : value).trim();
    var isParenNegative = /^\(.*\)$/.test(raw);
    var cleaned = raw.replace(/[^0-9.-]/g, "");
    var parsed = parseFloat(cleaned) || 0;
    return isParenNegative ? -Math.abs(parsed) : parsed;
  }

  // Percentage-formatted Google Sheets cells come through gvizRowsFromResponse as the raw
  // numeric value (e.g. 0.087 for a cell displaying "8.70%"), since the column type is
  // "number" rather than text. Only divide by 100 when the cell text itself carries a "%".
  function parsePercentRate(value) {
    var raw = String(value == null ? "" : value).trim();
    if (!raw) return 0;
    if (raw.indexOf("%") !== -1) return parseNumber(raw) / 100;
    return parseNumber(raw);
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
    var amountIdx = header.indexOf("amount");
    var categoryIdx = header.indexOf("instrument category");
    var isAmountBased = amountIdx !== -1;
    if (portfolioIdx === -1 || typeIdx === -1 || (!isAmountBased && (unitsIdx === -1 || priceIdx === -1))) return 0;

    var total = 0;
    rows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && portfolio.toLowerCase() !== portfolioFilter.toLowerCase()) return;
      if (categoryIdx !== -1 && normalizeText(row[categoryIdx]) !== "fixed income") return;
      var type = (row[typeIdx] || "").trim().toLowerCase();
      var value = isAmountBased ? parseNumber(row[amountIdx]) : parseNumber(row[unitsIdx]) * parseNumber(row[priceIdx]);
      total += type.indexOf("sell") !== -1 || type.indexOf("withdraw") !== -1 ? -value : value;
    });
    return total;
  }

  function sumEpfAmount(rows, portfolioFilter, includeInterest) {
    if (!rows || !rows.length) return 0;
    var header = rows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var typeIdx = header.indexOf("transaction type");
    var amountIdx = header.indexOf("amount");
    var categoryIdx = header.indexOf("instrument category");
    if (portfolioIdx === -1 || typeIdx === -1 || amountIdx === -1) return 0;

    var total = 0;
    rows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && portfolio.toLowerCase() !== portfolioFilter.toLowerCase()) return;
      if (categoryIdx !== -1 && normalizeText(row[categoryIdx]) !== "fixed income") return;
      var type = normalizeText(row[typeIdx]);
      var isDeposit = type.indexOf("deposit") !== -1;
      var isInterest = type.indexOf("interest") !== -1;
      if (!isDeposit && !(includeInterest && isInterest)) return;
      total += parseNumber(row[amountIdx]);
    });
    return total;
  }

  // Fixed Deposit/Savings Account sheet: sums Invested Amount across the same deduped
  // holdings shown in the "Savings/Investment Holding" and "Fixed Deposit Holding" tables
  // (Investment Corpus/Savings Account collapsed to their latest transaction per
  // Portfolio/Bank/Instrument, Fixed Deposit rows summed standalone).
  function sumFdInvestment(rows, portfolioFilter) {
    if (!rows || !rows.length) return 0;
    var fiHoldings = buildFdFixedIncomeHoldingsList(rows, portfolioFilter);
    var fiTotal = 0;
    if (fiHoldings) fiHoldings.forEach(function (h) {
      var normSub = normalizeText(h.subCategory || "");
      if (isSavingsInvestmentExcluded() && (normSub === "investment corpus" || normSub === "savings account")) return;
      fiTotal += h.invested;
    });
    return fiTotal;
  }

  // Counts full 1-month periods completed between start and asOf — used for monthly
  // compounding on Investment Corpus/Savings Account rows.
  function countElapsedMonths(start, asOf) {
    if (!start || !asOf || asOf <= start) return 0;
    var months = 0;
    var cursor = start;
    while (true) {
      var next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
      if (next > asOf) break;
      cursor = next;
      months++;
    }
    return months;
  }

  // Investment Corpus and Savings Account rows: Current Value = Invested Amount + interest
  // accrued from Transaction Date to today (capped at Maturity Date, if any), compounded
  // monthly at Rate of Return. Deduped to the latest transaction per Portfolio/Bank/Instrument,
  // matching the "Savings/Investment Holding" table.
  function sumFdCurrentValueAtPar(rows, portfolioFilter) {
    if (!rows || !rows.length || isSavingsInvestmentExcluded()) return 0;
    var holdings = buildFdHoldingsList(rows, portfolioFilter, function (normSubCategory) {
      return normSubCategory === "investment corpus" || normSubCategory === "savings account";
    });
    if (!holdings) return 0;
    var total = 0;
    holdings.forEach(function (h) { total += h.current; });
    return total;
  }

  function buildFdAtParXirrCashFlows(rows, portfolioFilter) {
    if (!rows || !rows.length) return [];
    var header = rows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var amountIdx = header.indexOf("invested amount");
    var categoryIdx = header.indexOf("instrument category");
    var subCategoryIdx = header.indexOf("instrument sub category");
    var dateIdx = header.indexOf("transaction date");
    if (portfolioIdx === -1 || amountIdx === -1 || subCategoryIdx === -1 || dateIdx === -1) return [];

    var flows = [];
    rows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && portfolio.toLowerCase() !== portfolioFilter.toLowerCase()) return;
      if (categoryIdx !== -1 && normalizeText(row[categoryIdx]) !== "fixed income") return;
      var subCategory = normalizeText(row[subCategoryIdx]);
      if (subCategory !== "investment corpus" && subCategory !== "savings account") return;

      var amount = parseNumber(row[amountIdx]);
      var date = parseFlexibleDate(row[dateIdx]);
      if (!date || !amount) return;
      flows.push({ date: date, amount: -amount });
    });
    return flows;
  }

  // Counts full 3-month periods completed between start and asOf — banks credit FD interest
  // only at full quarter boundaries, not continuously, so a partial quarter earns nothing yet.
  function countElapsedQuarters(start, asOf) {
    if (!start || !asOf || asOf <= start) return 0;
    var quarters = 0;
    var cursor = start;
    while (true) {
      var next = new Date(cursor.getFullYear(), cursor.getMonth() + 3, cursor.getDate());
      if (next > asOf) break;
      cursor = next;
      quarters++;
    }
    return quarters;
  }

  // Fixed Deposit rows: Current Value = Invested Amount + interest accrued from Transaction
  // Date to today (capped at Maturity Date), compounded quarterly at Rate of Return.
  // Fixed Deposit rows: Current Value via the same quarterly-compounding logic as the
  // "Fixed Deposit Holding" table (each row stands alone, no dedup needed).
  function sumFdMaturedCurrentValue(rows, portfolioFilter) {
    if (!rows || !rows.length) return 0;
    var holdings = buildFdHoldingsList(rows, portfolioFilter, function (normSubCategory) {
      return normSubCategory === "fixed deposit";
    });
    if (!holdings) return 0;
    var total = 0;
    holdings.forEach(function (h) { total += h.current; });
    return total;
  }

  function sumProvidentFundCurrentValue(rows, portfolioFilter) {
    if (!rows || !rows.length) return 0;
    var holdings = buildFdFixedIncomeHoldingsList(rows, portfolioFilter);
    if (!holdings) return 0;
    var total = 0;
    holdings.forEach(function (h) {
      var normSub = normalizeText(h.subCategory || "");
      if (normSub === "provident fund" || normSub === "provident pension" || normSub === "public provident fund") total += h.current;
    });
    return total;
  }

  function sumProvidentFundRealizedProfit(rows, portfolioFilter) {
    if (!rows || !rows.length) return 0;
    var holdings = buildFdFixedIncomeHoldingsList(rows, portfolioFilter);
    if (!holdings) return 0;
    var total = 0;
    holdings.forEach(function (h) {
      var normSub = normalizeText(h.subCategory || "");
      if (normSub === "provident fund" || normSub === "provident pension" || normSub === "public provident fund") total += (h.realizedProfit || 0);
    });
    return total;
  }

  // Realized Profit for Fixed Deposits = current accrued value − invested amount,
  // identical to Unrealized Profit (applies to all FDs regardless of maturity status).
  function sumFdRealizedProfit(rows, portfolioFilter) {
    if (!rows || !rows.length) return 0;
    var holdings = buildFdHoldingsList(rows, portfolioFilter, function (normSubCategory) {
      return normSubCategory === "fixed deposit";
    });
    if (!holdings) return 0;
    var total = 0;
    holdings.forEach(function (h) { total += h.current - h.invested; });
    return total;
  }

  function buildFdMaturedXirrCashFlows(rows, portfolioFilter) {
    if (!rows || !rows.length) return [];
    var header = rows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var amountIdx = header.indexOf("invested amount");
    var categoryIdx = header.indexOf("instrument category");
    var subCategoryIdx = header.indexOf("instrument sub category");
    var dateIdx = header.indexOf("transaction date");
    if (portfolioIdx === -1 || amountIdx === -1 || subCategoryIdx === -1 || dateIdx === -1) return [];

    var flows = [];
    rows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && portfolio.toLowerCase() !== portfolioFilter.toLowerCase()) return;
      if (categoryIdx !== -1 && normalizeText(row[categoryIdx]) !== "fixed income") return;
      if (normalizeText(row[subCategoryIdx]) !== "fixed deposit") return;

      var amount = parseNumber(row[amountIdx]);
      var date = parseFlexibleDate(row[dateIdx]);
      if (!date || !amount) return;
      flows.push({ date: date, amount: -amount });
    });
    return flows;
  }

  function buildProvidentFundXirrCashFlows(rows, portfolioFilter) {
    if (!rows || !rows.length) return [];
    var header = rows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var amountIdx = header.indexOf("invested amount");
    var categoryIdx = header.indexOf("instrument category");
    var subCategoryIdx = header.indexOf("instrument sub category");
    var txTypeIdx = header.indexOf("transaction type");
    var dateIdx = header.indexOf("transaction date");
    if (portfolioIdx === -1 || amountIdx === -1 || subCategoryIdx === -1 || dateIdx === -1) return [];

    var flows = [];
    rows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && normalizeText(portfolio) !== normalizeText(portfolioFilter)) return;
      if (categoryIdx !== -1 && normalizeText(row[categoryIdx]) !== "fixed income") return;
      var normSub = normalizeText(row[subCategoryIdx] || "");
      if (normSub !== "provident fund" && normSub !== "provident pension" && normSub !== "public provident fund") return;
      var normTxType = txTypeIdx !== -1 ? normalizeText(row[txTypeIdx] || "") : "";
      if (normTxType === "interest") return; // interest is part of terminal value, not a cash flow
      var amount = parseNumber(row[amountIdx]);
      var date = parseFlexibleDate(row[dateIdx]);
      if (!date || !amount) return;
      // Deposits are outflows (negative), withdrawals are inflows (positive)
      flows.push({ date: date, amount: normTxType === "withdrawal" ? amount : -amount });
    });
    return flows;
  }

  // Commodity XIRR: each purchase is a negative cash flow on the transaction date
  // (amount = grams × historical gold price/g). Terminal positive flow = total grams × current price.
  // Returns a Promise because historical gold prices require async API calls.
  function buildCommodityXirrCashFlows(fdRows, portfolioFilter, currentGoldPrice) {
    if (!fdRows || !fdRows.length || !currentGoldPrice) return Promise.resolve([]);
    var header = fdRows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var categoryIdx = header.indexOf("instrument category");
    var dateIdx = header.indexOf("transaction date");
    var gramsIdx = header.indexOf("grams");
    var maturityIdx = header.indexOf("maturity date/sell date");
    if (portfolioIdx === -1 || dateIdx === -1 || gramsIdx === -1) return Promise.resolve([]);

    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var entries = [];
    fdRows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && normalizeText(portfolio) !== normalizeText(portfolioFilter)) return;
      if (categoryIdx !== -1 && normalizeText(row[categoryIdx]) !== "commodity") return;
      var grams = parseNumber(row[gramsIdx]);
      var date = parseFlexibleDate(row[dateIdx]);
      var dateStr = formatDateISO(date);
      if (!grams || !date || !dateStr) return;
      var sellDateParsed = maturityIdx !== -1 ? parseFlexibleDate(row[maturityIdx]) : null;
      var sellDateStr = sellDateParsed ? formatDateISO(sellDateParsed) : null;
      var sellDay = sellDateParsed ? new Date(sellDateParsed.getFullYear(), sellDateParsed.getMonth(), sellDateParsed.getDate()) : null;
      var isSold = !!(sellDay && today > sellDay);
      entries.push({ date: date, dateStr: dateStr, grams: grams, isSold: isSold, sellDate: sellDateParsed, sellDateStr: sellDateStr });
    });

    if (!entries.length) return Promise.resolve([]);

    var uniqueDates = collectCommodityUniqueDates(fdRows, portfolioFilter);

    return Promise.all(uniqueDates.map(function (dateStr) {
      return fetchXauInrForDate(dateStr)
        .then(function (price) { return { dateStr: dateStr, price: price }; })
        .catch(function () { return { dateStr: dateStr, price: null }; });
    })).then(function (results) {
      var histPrices = {};
      results.forEach(function (r) { if (r.price) histPrices[r.dateStr] = r.price; });

      var flows = [];
      var activeGrams = 0;
      entries.forEach(function (e) {
        var buyPrice = histPrices[e.dateStr];
        if (!buyPrice) return;
        flows.push({ date: e.date, amount: -(e.grams * buyPrice) });
        if (e.isSold) {
          var sellPrice = e.sellDateStr && histPrices[e.sellDateStr];
          if (sellPrice) flows.push({ date: e.sellDate, amount: e.grams * sellPrice });
        } else {
          activeGrams += e.grams;
        }
      });
      if (activeGrams > 0) flows.push({ date: new Date(), amount: activeGrams * currentGoldPrice });
      return flows;
    });
  }

  function groupUnitTransactionsByInstrument(rows, portfolioFilter) {
    if (!rows || !rows.length) return null;
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
      var isCorporateAction = type === "split" || type === "bonus";
      if (!isBuy && !isSell && !isCorporateAction) return;

      var instrument = (row[instrumentIdx] || "").trim();
      if (!transactionsByInstrument[instrument]) transactionsByInstrument[instrument] = [];
      transactionsByInstrument[instrument].push({
        type: (isBuy || isCorporateAction) ? "buy" : "sell",
        units: parseNumber(row[unitsIdx]),
        price: isCorporateAction ? 0 : parseNumber(row[priceIdx]),
        date: parseFlexibleDate(row[dateIdx]),
        isCorporateAction: isCorporateAction,
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
      else if (prefix === "fixedincome") total += sumEpfAmount(rows, portfolioFilter, false);
      else if (prefix === "fd") total += sumFdInvestment(rows, portfolioFilter);
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
    if (prefix === "fd") {
      var rawHeaderFd = rows[0];
      var headerFd = rawHeaderFd.map(normalizeText);
      var maturityDateIdx = headerFd.indexOf("maturity date/sell date");
      if (maturityDateIdx === -1) maturityDateIdx = headerFd.indexOf("maturity date");
      var fdIdx = {
        "transaction date": headerFd.indexOf("transaction date"),
        "portfolio name": headerFd.indexOf("portfolio name"),
        bank: headerFd.indexOf("bank"),
        "instrument name": headerFd.indexOf("instrument name"),
        "instrument category": headerFd.indexOf("instrument category"),
        "instrument sub category": headerFd.indexOf("instrument sub category"),
        "transaction type": headerFd.indexOf("transaction type"),
        "invested amount": headerFd.indexOf("invested amount"),
        "maturity date/sell date": maturityDateIdx,
        "rate of return": headerFd.indexOf("rate of return")
      };
      var gramsIdx = headerFd.indexOf("grams");
      var missingFd = Object.keys(fdIdx).filter(function (key) { return fdIdx[key] === -1; });
      if (missingFd.length) {
        return {
          missingColumns: true,
          message: "Header row number is incorrect. Make adjustments by adding correct header row number. Missing column(s): " + missingFd.join(", ") + "."
        };
      }

      var fdTotal = sumFdInvestment(rows, "all");
      var fdBadRows = [];
      rows.slice(1).forEach(function (row, i) {
        var portfolio = (row[fdIdx["portfolio name"]] || "").trim();
        var bank = (row[fdIdx.bank] || "").trim();
        var instrument = (row[fdIdx["instrument name"]] || "").trim();
        var category = (row[fdIdx["instrument category"]] || "").trim();
        var subCategory = (row[fdIdx["instrument sub category"]] || "").trim();
        var maturityRaw = (row[fdIdx["maturity date/sell date"]] || "").trim();
        var rateRaw = (row[fdIdx["rate of return"]] || "").trim();
        var txType = (fdIdx["transaction type"] !== -1 ? row[fdIdx["transaction type"]] || "" : "").trim();
        var normCategory = normalizeText(category);
        var normSubCategory = normalizeText(subCategory);
        var isFixedDeposit = normCategory === "fixed income" && normSubCategory === "fixed deposit";
        var isCommodity = normCategory === "commodity";
        var isProvidentFund = normCategory === "fixed income" && (normSubCategory === "provident fund" || normSubCategory === "provident pension" || normSubCategory === "public provident fund");

        var issues = [];
        if (!portfolio) issues.push("Portfolio is blank");
        if (!instrument) issues.push("Instrument Name is blank");
        if (!category) issues.push("Instrument Category is blank");
        if (!subCategory) issues.push("Inst. Sub-Cat is blank");
        if (!parseFlexibleDate(row[fdIdx["transaction date"]])) issues.push("Transaction Date is blank or not a valid date");
        if (!isCommodity) {
          var amountCheck = validateNumericCell(row[fdIdx["invested amount"]]);
          if (!amountCheck.ok) issues.push("Invested Amount " + amountCheck.reason);
        }

        if (!isProvidentFund) {
          if (isFixedDeposit && !maturityRaw) issues.push("Maturity Date/Sell Date is mandatory for Fixed Deposit rows but is blank");
          else if (maturityRaw && !parseFlexibleDate(maturityRaw)) issues.push("Maturity Date/Sell Date is not a valid date");

          if (isFixedDeposit && !rateRaw) issues.push("Rate of Return is mandatory for Fixed Deposit rows but is blank");
          else if (rateRaw && !/[0-9]/.test(rateRaw)) issues.push("Rate of Return is not a valid percentage");
        }

        var gramsRaw = gramsIdx !== -1 ? (row[gramsIdx] || "").trim() : "";

        if (isProvidentFund) {
          if (bank) issues.push("Bank must be blank for Provident Fund/Provident Pension rows");
          if (!txType) issues.push("Transaction Type is blank");
          if (!row[fdIdx["invested amount"]] || !(row[fdIdx["invested amount"]] || "").trim()) issues.push("Invested Amount is blank");
          if (gramsRaw) issues.push("Grams must be blank for Provident Fund/Provident Pension rows");
          if (maturityRaw) issues.push("Maturity Date/Sell Date must be blank for Provident Fund/Provident Pension rows");
          if (rateRaw) issues.push("Rate of Return must be blank for Provident Fund/Provident Pension rows");
        } else if (!isCommodity && !bank) {
          issues.push("Bank is blank");
        }
        if (isCommodity) {
          if (gramsRaw && isNaN(parseFloat(gramsRaw))) issues.push("Grams must be a number");
        }

        if (issues.length) fdBadRows.push("Row " + (i + 2) + " (" + (portfolio || "unknown portfolio") + "): " + issues.join(", "));
      });

      var fdBaseMessage = "Synced " + (rows.length - 1) + " rows. Computed total: " + formatCurrency(fdTotal) + ".";
      if (fdBadRows.length) {
        var fdPreview = fdBadRows.slice(0, 5).join(" | ");
        var fdMore = fdBadRows.length > 5 ? " (+" + (fdBadRows.length - 5) + " more)" : "";
        return {
          missingColumns: true,
          message: fdBaseMessage + " Found " + fdBadRows.length + " row(s) with missing/invalid data: " + fdPreview + fdMore + ". Fix these cells in the sheet and sync again."
        };
      }
      return { missingColumns: false, message: fdBaseMessage };
    }
    if (prefix !== "equity" && prefix !== "fixedincome" && prefix !== "stocksetf") return { missingColumns: false, message: "" };
    var header = rows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var instrumentIdx = header.indexOf("instrument name");
    var typeIdx = header.indexOf("transaction type");
    var priceIdx = header.indexOf("price");
    var unitsIdx = header.indexOf("units");
    var amountIdx = header.indexOf("amount");
    var isAmountBased = (prefix === "fixedincome" || prefix === "fd") && amountIdx !== -1;

    var requiredIdx = (prefix === "equity" || prefix === "stocksetf")
      ? { "portfolio name": portfolioIdx, "instrument name": instrumentIdx, "transaction type": typeIdx, units: unitsIdx, price: priceIdx }
      : isAmountBased
      ? { "portfolio name": portfolioIdx, "transaction type": typeIdx, amount: amountIdx }
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
      : prefix === "fixedincome"
      ? sumEpfAmount(rows, "all", false)
      : sumInvestmentForRows(rows, "all");

    var badRows = [];
    rows.slice(1).forEach(function (row, i) {
      var portfolio = (row[portfolioIdx] || "").trim();
      var type = normalizeText(row[typeIdx]);
      var isBuyOrSell = type.indexOf("buy") !== -1 || type.indexOf("sell") !== -1 || type.indexOf("withdraw") !== -1 || type.indexOf("deposit") !== -1 || type.indexOf("contribut") !== -1 || type.indexOf("interest") !== -1;
      var issues = [];
      if (!portfolio) issues.push("Portfolio is blank");
      if ((prefix === "equity" || prefix === "stocksetf") && !(row[instrumentIdx] || "").trim()) issues.push("Instrument Name is blank");
      if (!type) issues.push("Transaction Type is blank");
      if (isAmountBased) {
        if (isBuyOrSell) {
          var amountCheck = validateNumericCell(row[amountIdx]);
          if (!amountCheck.ok) issues.push("Amount " + amountCheck.reason);
        }
      } else if (isBuyOrSell) {
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

    // Check for instruments in transactions that are missing from the mapping sheet
    if (prefix === "equity" || prefix === "stocksetf") {
      var mappingPrefix = prefix === "equity" ? "mfmapping" : "stocksetfmapping";
      var mappingLabel = prefix === "equity" ? "Mutual Fund Mapping" : "Stocks/ETF Mapping";
      var mappingRows = getSheetRows(mappingPrefix);
      if (mappingRows && mappingRows.length > 1) {
        var mappingHeader = mappingRows[0].map(normalizeText);
        var mappingInstrIdx = mappingHeader.indexOf("instrument name");
        var mappingInstruments = {};
        if (mappingInstrIdx !== -1) {
          mappingRows.slice(1).forEach(function (r) {
            var name = normalizeText((r[mappingInstrIdx] || "").trim());
            if (name) mappingInstruments[name] = true;
          });
        }
        var txInstruments = {};
        rows.slice(1).forEach(function (row) {
          var name = (row[instrumentIdx] || "").trim();
          if (name) txInstruments[normalizeText(name)] = name;
        });
        var missing = Object.keys(txInstruments).filter(function (k) { return !mappingInstruments[k]; });
        if (missing.length) {
          var missingNames = missing.map(function (k) { return txInstruments[k]; });
          var missingPreview = missingNames.slice(0, 5).join(", ");
          var missingMore = missingNames.length > 5 ? " (+" + (missingNames.length - 5) + " more)" : "";
          return {
            missingColumns: true,
            message: baseMessage + " Warning: " + missing.length + " instrument(s) found in transactions but missing from " + mappingLabel + ": " + missingPreview + missingMore + ". Add them to the mapping sheet and sync again."
          };
        }
      }
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

  // Per-tab numeric values — refreshed by each tab's async computation; overview is their sum.
  var _ov = { mfInvested: 0, mfCurrent: 0, mfUnrealized: 0, mfRealized: 0,
               seInvested: 0, seCurrent: 0, seUnrealized: 0, seDayChange: 0, seRealized: 0, seXirrFlows: [],
               fiInvested: 0, fiCurrent: 0, fiUnrealized: 0, fiRealized: 0,
               commInvested: 0, commCurrent: 0, commUnrealized: 0, commRealized: 0 };

  function refreshOverviewStats() {
    var overviewInvestedEl = document.getElementById("overview-total-investment");
    var overviewCurrentEl = document.getElementById("overview-total-current-value");
    var overviewReturnEl = document.getElementById("overview-unrealized-return");
    var overviewPctEl = document.getElementById("overview-return-pct");
    var overviewRealizedEl = document.getElementById("overview-realized-return");
    var fiInvested = isFixedIncomeExcluded() ? 0 : _ov.fiInvested;
    var fiCurrent = isFixedIncomeExcluded() ? 0 : _ov.fiCurrent;
    var fiRealized = isFixedIncomeExcluded() ? 0 : _ov.fiRealized;
    // Use seCurrent if prices have loaded; fall back to seInvested so overview is never blank
    var seCurrent = _ov.seCurrent > 0 ? _ov.seCurrent : _ov.seInvested;
    var totalInvested = _ov.mfInvested + _ov.seInvested + fiInvested + _ov.commInvested;
    var totalCurrent = _ov.mfCurrent + seCurrent + fiCurrent + _ov.commCurrent;
    var totalRealized = _ov.mfRealized + _ov.seRealized + fiRealized + _ov.commRealized;
    if (overviewInvestedEl) overviewInvestedEl.textContent = formatCurrency(totalInvested);
    if (overviewCurrentEl) overviewCurrentEl.textContent = formatCurrency(totalCurrent);
    setUnrealizedReturn(overviewReturnEl, overviewPctEl, totalCurrent, totalInvested);
    if (overviewRealizedEl) setSignedCurrency(overviewRealizedEl, totalRealized);
  }

  function refreshCategoryCards() {
    var fiInvested = isFixedIncomeExcluded() ? 0 : _ov.fiInvested;
    var fiCurrent  = isFixedIncomeExcluded() ? 0 : _ov.fiCurrent;
    var fiUnrealized = isFixedIncomeExcluded() ? 0 : _ov.fiUnrealized;
    var fiRealized = isFixedIncomeExcluded() ? 0 : _ov.fiRealized;
    var commInvested  = isFixedIncomeExcluded() ? 0 : _ov.commInvested;
    var commCurrent   = isFixedIncomeExcluded() ? 0 : _ov.commCurrent;
    var commUnrealized = isFixedIncomeExcluded() ? 0 : _ov.commUnrealized;
    var commRealized  = isFixedIncomeExcluded() ? 0 : _ov.commRealized;

    var seCurrent = _ov.seCurrent > 0 ? _ov.seCurrent : _ov.seInvested;

    // Mutual Funds
    var mfInv = _ov.mfInvested, mfCur = _ov.mfCurrent;
    var elMfInv = document.getElementById("cat-mf-invested");
    var elMfCur = document.getElementById("cat-mf-current");
    var elMfUnr = document.getElementById("cat-mf-unrealized");
    var elMfRlz = document.getElementById("cat-mf-realized");
    var elMfRet = document.getElementById("cat-mf-return");
    if (elMfInv) elMfInv.textContent = formatCurrency(mfInv);
    if (elMfCur) elMfCur.textContent = formatCurrency(mfCur);
    if (elMfUnr) setSignedCurrency(elMfUnr, _ov.mfUnrealized);
    if (elMfRlz) setSignedCurrency(elMfRlz, _ov.mfRealized);
    if (elMfRet) {
      var mfPct = mfInv > 0 ? ((mfCur - mfInv) / mfInv * 100) : 0;
      elMfRet.textContent = (mfPct >= 0 ? "+" : "") + mfPct.toFixed(2) + "%";
      elMfRet.className = "cat-stat-value" + (mfPct > 0 ? " positive" : mfPct < 0 ? " negative" : "");
    }

    // Stocks / ETF
    var seInv = _ov.seInvested, seCur = seCurrent;
    var elSeInv = document.getElementById("cat-se-invested");
    var elSeCur = document.getElementById("cat-se-current");
    var elSeDc  = document.getElementById("cat-se-daychange");
    var elSeUnr = document.getElementById("cat-se-unrealized");
    var elSeRlz = document.getElementById("cat-se-realized");
    var elSeRet = document.getElementById("cat-se-return");
    if (elSeInv) elSeInv.textContent = formatCurrency(seInv);
    if (elSeCur) elSeCur.textContent = formatCurrency(seCur);
    if (elSeDc)  setSignedCurrency(elSeDc, _ov.seDayChange);
    if (elSeUnr) setSignedCurrency(elSeUnr, _ov.seUnrealized);
    if (elSeRlz) setSignedCurrency(elSeRlz, _ov.seRealized);
    if (elSeRet) {
      var sePct = seInv > 0 ? ((seCur - seInv) / seInv * 100) : 0;
      elSeRet.textContent = (sePct >= 0 ? "+" : "") + sePct.toFixed(2) + "%";
      elSeRet.className = "cat-stat-value" + (sePct > 0 ? " positive" : sePct < 0 ? " negative" : "");
    }

    // Fixed Income + Commodity combined
    var fiTotalInv = fiInvested + commInvested;
    var fiTotalCur = fiCurrent + commCurrent;
    var fiTotalUnr = fiUnrealized + commUnrealized;
    var fiTotalRlz = fiRealized + commRealized;
    var elFiInv = document.getElementById("cat-fi-invested");
    var elFiCur = document.getElementById("cat-fi-current");
    var elFiUnr = document.getElementById("cat-fi-unrealized");
    var elFiRlz = document.getElementById("cat-fi-realized");
    var elFiRet = document.getElementById("cat-fi-return");
    if (elFiInv) elFiInv.textContent = formatCurrency(fiTotalInv);
    if (elFiCur) elFiCur.textContent = formatCurrency(fiTotalCur);
    if (elFiUnr) setSignedCurrency(elFiUnr, fiTotalUnr);
    if (elFiRlz) setSignedCurrency(elFiRlz, fiTotalRlz);
    if (elFiRet) {
      var fiPct = fiTotalInv > 0 ? ((fiTotalCur - fiTotalInv) / fiTotalInv * 100) : 0;
      elFiRet.textContent = (fiPct >= 0 ? "+" : "") + fiPct.toFixed(2) + "%";
      elFiRet.className = "cat-stat-value" + (fiPct > 0 ? " positive" : fiPct < 0 ? " negative" : "");
    }
  }

  function updateDashboardStats() {
    // Reset accumulator so stale tab values don't persist across portfolio changes
    _ov.mfInvested = 0; _ov.mfCurrent = 0; _ov.mfUnrealized = 0; _ov.mfRealized = 0;
    _ov.seInvested = 0; _ov.seCurrent = 0; _ov.seUnrealized = 0; _ov.seDayChange = 0; _ov.seRealized = 0; _ov.seXirrFlows = []; _ov._overviewBaseFlows = null; _ov._mfCommDayChange = null;
    _ov.fiInvested = 0; _ov.fiCurrent = 0; _ov.fiUnrealized = 0; _ov.fiRealized = 0;
    _ov.commInvested = 0; _ov.commCurrent = 0; _ov.commUnrealized = 0; _ov.commRealized = 0;

    var equityEl = document.getElementById("equity-total-investment");
    var fixedIncomeEl = document.getElementById("fixedincome-total-investment");
    var stocksEtfEl = document.getElementById("stocksetf-total-investment");
    var equityRealizedEl = document.getElementById("equity-realized-return");
    var stocksEtfRealizedEl = document.getElementById("stocksetf-realized-return");

    var selected = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";

    // Invested amounts (synchronous)
    var mfInvested = computeTotalInvestment(selected, ["equity"]);
    var seInvested = computeTotalInvestment(selected, ["stocksetf"]);
    var fiBaseInvested = computeTotalInvestment(selected, ["fixedincome", "fd"]);
    if (equityEl) equityEl.textContent = formatCurrency(mfInvested);
    if (stocksEtfEl) stocksEtfEl.textContent = formatCurrency(seInvested);
    if (fixedIncomeEl) fixedIncomeEl.textContent = formatCurrency(fiBaseInvested);
    _ov.mfInvested = mfInvested;
    _ov.seInvested = seInvested;
    _ov.fiInvested = fiBaseInvested;

    // Realized profits (synchronous for MF and SE)
    var mfRealized = computeRealizedReturn(selected, ["equity"]);
    var seRealized = computeRealizedReturn(selected, ["stocksetf"]);
    if (equityRealizedEl) setSignedCurrency(equityRealizedEl, mfRealized);
    if (stocksEtfRealizedEl) setSignedCurrency(stocksEtfRealizedEl, seRealized);
    _ov.mfRealized = mfRealized;
    _ov.seRealized = seRealized;
    refreshOverviewStats(); refreshCategoryCards();

    // Commodity invested amount added to Fixed Income asynchronously
    var fdRowsInv = getSheetRows("fd");
    var uniqueDatesInv = fdRowsInv ? collectCommodityUniqueDates(fdRowsInv, selected) : [];
    Promise.all([
      fetchGoldPriceINRPerGram().catch(function () { return null; }),
      Promise.all(uniqueDatesInv.map(function (d) {
        return fetchXauInrForDate(d).then(function (p) { return { dateStr: d, price: p }; }).catch(function () { return { dateStr: d, price: null }; });
      }))
    ]).then(function (results) {
      var goldPrice = results[0];
      if (!goldPrice || !fdRowsInv || !fdRowsInv.length) return;
      var histPrices = {};
      results[1].forEach(function (r) { if (r.price) histPrices[r.dateStr] = r.price; });
      var fullHoldings = buildCommodityHoldingsList(fdRowsInv, selected, goldPrice, histPrices) || [];
      var commodityInvested = 0;
      fullHoldings.forEach(function (h) { commodityInvested += h.invested; });
      if (fixedIncomeEl) fixedIncomeEl.textContent = formatCurrency(fiBaseInvested + commodityInvested);
      _ov.commInvested = commodityInvested;
      refreshOverviewStats(); refreshCategoryCards();
    });

    updateEpfStats();
    updateTotalCurrentValue();
  }

  function updateEpfStats() {
    var currentValueEl = document.getElementById("fixedincome-current-value");
    var profitEl = document.getElementById("fixedincome-unrealized-profit");
    var pctEl = document.getElementById("fixedincome-return-pct");
    var realizedProfitEl = document.getElementById("fixedincome-realized-profit");
    var xirrEl = document.getElementById("fixedincome-xirr");
    var selected = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
    var fdRows = getSheetRows("fd");
    var connectHintEl = document.getElementById("fixedincome-connect-hint");
    if (connectHintEl) connectHintEl.hidden = !!(fdRows && fdRows.length);

    // Fetch current gold price + all historical prices (buy and sell dates) for commodity rows
    var uniqueCommodityDates = fdRows ? collectCommodityUniqueDates(fdRows, selected) : [];
    Promise.all([
      fetchGoldPriceINRPerGram().catch(function () { return null; }),
      Promise.all(uniqueCommodityDates.map(function (dateStr) {
        return fetchXauInrForDate(dateStr).then(function (p) { return { dateStr: dateStr, price: p }; }).catch(function () { return { dateStr: dateStr, price: null }; });
      }))
    ]).then(function (results) {
      var goldPrice = results[0];
      var histPrices = {};
      results[1].forEach(function (r) { if (r.price) histPrices[r.dateStr] = r.price; });

      var commodityHoldingsFull = (fdRows && goldPrice)
        ? buildCommodityHoldingsList(fdRows, selected, goldPrice, histPrices)
        : [];
      var commodityInvested = 0, commodityCurrent = 0, commodityRealizedProfit = 0;
      if (commodityHoldingsFull) commodityHoldingsFull.forEach(function (h) {
        commodityInvested += h.invested;
        commodityCurrent += h.current;
        commodityRealizedProfit += h.realizedProfit;
      });

      var fiInvestment = fdRows ? sumFdInvestment(fdRows, selected) : 0;
      var investment = fiInvestment + commodityInvested;
      var fiCurrentValue = (fdRows ? sumFdCurrentValueAtPar(fdRows, selected) : 0) + (fdRows ? sumFdMaturedCurrentValue(fdRows, selected) : 0) + (fdRows ? sumProvidentFundCurrentValue(fdRows, selected) : 0);
      var currentValue = fiCurrentValue + commodityCurrent;
      if (currentValueEl) currentValueEl.textContent = formatCurrency(currentValue);
      setUnrealizedReturn(profitEl, pctEl, currentValue, investment);
      var fiRealized = (fdRows ? sumFdRealizedProfit(fdRows, selected) : 0) + (fdRows ? sumProvidentFundRealizedProfit(fdRows, selected) : 0);
      if (realizedProfitEl) setSignedCurrency(realizedProfitEl, fiRealized + commodityRealizedProfit);

      _ov.fiCurrent = fiCurrentValue;
      _ov.fiUnrealized = fiCurrentValue - fiInvestment;
      _ov.fiRealized = fiRealized;
      _ov.commCurrent = commodityCurrent;
      _ov.commUnrealized = commodityCurrent - commodityInvested;
      _ov.commRealized = commodityRealizedProfit;
      refreshOverviewStats(); refreshCategoryCards();

      if (xirrEl) {
        var pfCurrentValue = fdRows ? sumProvidentFundCurrentValue(fdRows, selected) : 0;
        var currentValueForXirr = (fdRows ? sumFdMaturedCurrentValue(fdRows, selected) : 0) + pfCurrentValue;
        var baseCashFlows = (fdRows ? buildFdMaturedXirrCashFlows(fdRows, selected) : [])
          .concat(fdRows ? buildProvidentFundXirrCashFlows(fdRows, selected) : []);
        buildCommodityXirrCashFlows(fdRows, selected, goldPrice).then(function (commodityFlows) {
          var allFlows = baseCashFlows.concat(commodityFlows);
          if (currentValueForXirr > 0) allFlows.push({ date: new Date(), amount: currentValueForXirr });
          setXirr(xirrEl, calculateXIRR(allFlows));
        });
      }
    });
  }

  function renderFixedIncomeHoldingsTable() {
    var statusEl = document.getElementById("fixedincome-holdings-status");
    var tableWrap = document.getElementById("fixedincome-holdings-table-wrap");
    var tbody = document.getElementById("fixedincome-holdings-tbody");
    if (!statusEl || !tableWrap || !tbody) return;

    var rows = getSheetRows("fixedincome");
    if (!rows || !rows.length) {
      statusEl.textContent = "Connect your Provident Fund (EPF) Transactions sheet in Settings to populate this view.";
      tableWrap.hidden = true;
      return;
    }

    var header = rows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var instrumentIdx = header.indexOf("instrument name");
    var typeIdx = header.indexOf("transaction type");
    var amountIdx = header.indexOf("amount");
    var categoryIdx = header.indexOf("instrument category");
    var subCategoryIdx = header.indexOf("instrument sub category");
    if (portfolioIdx === -1 || instrumentIdx === -1 || typeIdx === -1 || amountIdx === -1) {
      statusEl.textContent = "Header row number is incorrect. Make adjustments by adding correct header row number.";
      tableWrap.hidden = true;
      return;
    }

    var selectedPortfolio = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
    var byKey = {};
    rows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (selectedPortfolio !== "all" && normalizeText(portfolio) !== normalizeText(selectedPortfolio)) return;
      if (categoryIdx !== -1 && normalizeText(row[categoryIdx]) !== "fixed income") return;
      var instrument = (row[instrumentIdx] || "").trim();
      if (!instrument) return;
      var subCategory = subCategoryIdx !== -1 ? (row[subCategoryIdx] || "").trim() : "";
      var type = normalizeText(row[typeIdx]);
      var isDeposit = type.indexOf("deposit") !== -1;
      var isInterest = type.indexOf("interest") !== -1;
      if (!isDeposit && !isInterest) return;

      var key = portfolio + "||" + instrument + "||" + subCategory;
      var amount = parseNumber(row[amountIdx]);
      if (!byKey[key]) byKey[key] = { portfolio: portfolio, instrument: instrument, subCategory: subCategory, invested: 0, current: 0 };
      if (isDeposit) { byKey[key].invested += amount; byKey[key].current += amount; }
      else byKey[key].current += amount;
    });

    var holdings = Object.keys(byKey).map(function (key) {
      var entry = byKey[key];
      var unrealized = entry.current - entry.invested;
      var pct = entry.invested > 0 ? (unrealized / entry.invested) * 100 : 0;
      return { portfolio: entry.portfolio, instrument: entry.instrument, subCategory: entry.subCategory, invested: entry.invested, current: entry.current, unrealized: unrealized, pct: pct };
    });

    if (!holdings.length) {
      statusEl.textContent = "No EPF holdings found.";
      tableWrap.hidden = true;
      return;
    }

    tbody.innerHTML = "";
    holdings.forEach(function (h) {
      var tr = document.createElement("tr");
      var cls = h.unrealized > 0 ? "positive" : (h.unrealized < 0 ? "negative" : "");

      var portfolioTd = document.createElement("td");
      portfolioTd.className = "col-desktop-only";
      portfolioTd.textContent = h.portfolio;
      tr.appendChild(portfolioTd);

      var nameTd = document.createElement("td");
      nameTd.className = "fund-name";
      nameTd.textContent = h.instrument;
      tr.appendChild(nameTd);

      var subCategoryTd = document.createElement("td");
      subCategoryTd.className = "col-desktop-only";
      subCategoryTd.textContent = h.subCategory;
      tr.appendChild(subCategoryTd);

      var investedTd = document.createElement("td");
      investedTd.className = "num";
      investedTd.textContent = formatCurrency(h.invested);
      tr.appendChild(investedTd);

      var currentTd = document.createElement("td");
      currentTd.className = "num col-desktop-only";
      currentTd.textContent = formatCurrency(h.current);
      tr.appendChild(currentTd);

      var unrealizedTd = document.createElement("td");
      unrealizedTd.className = "num col-desktop-only " + cls;
      unrealizedTd.textContent = (h.unrealized > 0 ? "+" : "") + formatCurrency(h.unrealized);
      tr.appendChild(unrealizedTd);

      var pctTd = document.createElement("td");
      pctTd.className = "num " + cls;
      pctTd.textContent = (h.pct > 0 ? "+" : "") + h.pct.toFixed(2) + "%";
      tr.appendChild(pctTd);

      tbody.appendChild(tr);
    });

    statusEl.textContent = holdings.length + " holding(s).";
    tableWrap.hidden = false;
  }

  // Shared by the "Savings/Investment Holding" and "Fixed Deposit Holding" tables —
  // both read the same FD sheet but render mutually-exclusive Instrument Sub Category subsets.
  function buildFdHoldingsList(rows, portfolioFilter, includeSubCategory) {
    var header = rows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var bankIdx = header.indexOf("bank");
    var instrumentIdx = header.indexOf("instrument name");
    var categoryIdx = header.indexOf("instrument category");
    var subCategoryIdx = header.indexOf("instrument sub category");
    var amountIdx = header.indexOf("invested amount");
    var dateIdx = header.indexOf("transaction date");
    var maturityIdx = header.indexOf("maturity date/sell date");
    if (maturityIdx === -1) maturityIdx = header.indexOf("maturity date");
    var rateIdx = header.indexOf("rate of return");
    if (portfolioIdx === -1 || bankIdx === -1 || instrumentIdx === -1 || subCategoryIdx === -1 || amountIdx === -1 || dateIdx === -1 || maturityIdx === -1 || rateIdx === -1) {
      return null;
    }

    var today = new Date();
    var holdings = [];
    // Investment Corpus/Savings Account rows represent a running balance, not standalone
    // holdings — only the latest transaction per (Portfolio, Bank, Instrument) counts.
    var latestCorpusByKey = {};
    rows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && normalizeText(portfolio) !== normalizeText(portfolioFilter)) return;
      if (categoryIdx !== -1 && normalizeText(row[categoryIdx]) !== "fixed income") return;
      var subCategory = (row[subCategoryIdx] || "").trim();
      var normSubCategory = normalizeText(subCategory);
      if (!subCategory) return;
      if (!includeSubCategory(normSubCategory)) return;

      var bank = (row[bankIdx] || "").trim();
      var instrument = (row[instrumentIdx] || "").trim();

      if (normSubCategory === "investment corpus" || normSubCategory === "savings account") {
        var corpusDate = parseFlexibleDate(row[dateIdx]);
        var key = normalizeText(portfolio) + "||" + normalizeText(bank) + "||" + normalizeText(instrument);
        var existing = latestCorpusByKey[key];
        if (!existing || (corpusDate && (!existing.date || corpusDate > existing.date))) {
          latestCorpusByKey[key] = { row: row, date: corpusDate, portfolio: portfolio, bank: bank, instrument: instrument, subCategory: subCategory };
        }
        return;
      }

      var invested = parseNumber(row[amountIdx]);
      var current = invested;
      if (normSubCategory === "fixed deposit") {
        var rate = parsePercentRate(row[rateIdx]);
        var startDate = parseFlexibleDate(row[dateIdx]);
        var maturityDate = parseFlexibleDate(row[maturityIdx]);
        if (startDate) {
          var asOfDate = maturityDate && maturityDate < today ? maturityDate : today;
          var elapsedQuarters = countElapsedQuarters(startDate, asOfDate);
          if (elapsedQuarters > 0 && rate) {
            current = invested * Math.pow(1 + rate / 4, elapsedQuarters);
          }
        }
      }

      holdings.push({
        portfolio: portfolio,
        bank: bank,
        instrument: instrument,
        subCategory: subCategory,
        invested: invested,
        current: current,
        startDate: parseFlexibleDate(row[dateIdx])
      });
    });

    Object.keys(latestCorpusByKey).forEach(function (key) {
      var entry = latestCorpusByKey[key];
      var row = entry.row;
      var invested = parseNumber(row[amountIdx]);
      var current = invested;
      var rate = parsePercentRate(row[rateIdx]);
      var startDate = entry.date;
      var maturityDate = parseFlexibleDate(row[maturityIdx]);
      if (startDate && rate) {
        var asOfDate = maturityDate && maturityDate < today ? maturityDate : today;
        var elapsedMonths = countElapsedMonths(startDate, asOfDate);
        if (elapsedMonths > 0) {
          current = invested * Math.pow(1 + rate / 12, elapsedMonths);
        }
      }
      holdings.push({
        portfolio: entry.portfolio,
        bank: entry.bank,
        instrument: entry.instrument,
        subCategory: entry.subCategory,
        invested: invested,
        current: current,
        startDate: startDate
      });
    });

    return holdings;
  }

  // Builds holdings from the FD sheet (all Fixed Income sub-categories).
  function buildFdFixedIncomeHoldingsList(fdRows, portfolioFilter) {
    var header = fdRows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var bankIdx = header.indexOf("bank");
    var instrumentIdx = header.indexOf("instrument name");
    var categoryIdx = header.indexOf("instrument category");
    var subCategoryIdx = header.indexOf("instrument sub category");
    var txTypeIdx = header.indexOf("transaction type");
    var amountIdx = header.indexOf("invested amount");
    var dateIdx = header.indexOf("transaction date");
    var maturityIdx = header.indexOf("maturity date/sell date");
    if (maturityIdx === -1) maturityIdx = header.indexOf("maturity date");
    var rateIdx = header.indexOf("rate of return");
    if (portfolioIdx === -1 || instrumentIdx === -1 || amountIdx === -1 || dateIdx === -1) return null;

    var today = new Date();
    var holdings = [];
    var latestCorpusByKey = {};
    var providentFundByKey = {};
    fdRows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && normalizeText(portfolio) !== normalizeText(portfolioFilter)) return;
      var normCategory = categoryIdx !== -1 ? normalizeText(row[categoryIdx]) : "";
      if (normCategory !== "fixed income") return;
      var subCategory = subCategoryIdx !== -1 ? (row[subCategoryIdx] || "").trim() : "";
      var normSubCategory = normalizeText(subCategory);
      if (!subCategory) return;
      var bank = bankIdx !== -1 ? (row[bankIdx] || "").trim() : "";
      var instrument = (row[instrumentIdx] || "").trim();
      if (!instrument) return;

      if (normSubCategory === "investment corpus" || normSubCategory === "savings account") {
        var corpusDate = parseFlexibleDate(row[dateIdx]);
        var corpusKey = normalizeText(portfolio) + "||" + normalizeText(bank) + "||" + normalizeText(instrument);
        var existing = latestCorpusByKey[corpusKey];
        if (!existing || (corpusDate && (!existing.date || corpusDate > existing.date))) {
          latestCorpusByKey[corpusKey] = { row: row, date: corpusDate, portfolio: portfolio, bank: bank, instrument: instrument, subCategory: subCategory };
        }
        return;
      }

      if (normSubCategory === "provident fund" || normSubCategory === "provident pension" || normSubCategory === "public provident fund") {
        var pfKey = normalizeText(portfolio) + "||" + normalizeText(instrument) + "||" + normalizeText(subCategory);
        if (!providentFundByKey[pfKey]) {
          providentFundByKey[pfKey] = { portfolio: portfolio, instrument: instrument, subCategory: subCategory, txns: [] };
        }
        var normTxType = txTypeIdx !== -1 ? normalizeText(row[txTypeIdx] || "") : "";
        var txDate = parseFlexibleDate(row[dateIdx]);
        providentFundByKey[pfKey].txns.push({ date: txDate, amount: parseNumber(row[amountIdx]), type: normTxType });
        return;
      }

      var invested = parseNumber(row[amountIdx]);
      var current = invested;
      if (normSubCategory === "fixed deposit" && maturityIdx !== -1 && rateIdx !== -1) {
        var rate = parsePercentRate(row[rateIdx]);
        var startDate = parseFlexibleDate(row[dateIdx]);
        var maturityDate = parseFlexibleDate(row[maturityIdx]);
        if (startDate) {
          var asOfDate = maturityDate && maturityDate < today ? maturityDate : today;
          var elapsedQuarters = countElapsedQuarters(startDate, asOfDate);
          if (elapsedQuarters > 0 && rate) current = invested * Math.pow(1 + rate / 4, elapsedQuarters);
        }
      }
      holdings.push({ portfolio: portfolio, bank: bank, instrument: instrument, subCategory: subCategory, invested: invested, current: current });
    });

    Object.keys(latestCorpusByKey).forEach(function (key) {
      var entry = latestCorpusByKey[key];
      var row = entry.row;
      var invested = parseNumber(row[amountIdx]);
      var current = invested;
      if (rateIdx !== -1 && maturityIdx !== -1) {
        var rate = parsePercentRate(row[rateIdx]);
        var startDate = entry.date;
        var maturityDate = parseFlexibleDate(row[maturityIdx]);
        if (startDate && rate) {
          var asOfDate = maturityDate && maturityDate < today ? maturityDate : today;
          var elapsedMonths = countElapsedMonths(startDate, asOfDate);
          if (elapsedMonths > 0) current = invested * Math.pow(1 + rate / 12, elapsedMonths);
        }
      }
      holdings.push({ portfolio: entry.portfolio, bank: entry.bank, instrument: entry.instrument, subCategory: entry.subCategory, invested: invested, current: current });
    });

    Object.keys(providentFundByKey).forEach(function (key) {
      var pf = providentFundByKey[key];
      pf.txns.sort(function (a, b) { return (a.date || 0) - (b.date || 0); });

      var lots = []; // FIFO queue of deposit lots {amount}
      var totalInterest = 0;
      var realizedInterest = 0;

      pf.txns.forEach(function (tx) {
        if (tx.type === "interest") {
          totalInterest += tx.amount;
        } else if (tx.type === "withdrawal") {
          // FIFO consume deposit lots
          var totalPrincipalBefore = lots.reduce(function (s, l) { return s + l.amount; }, 0);
          var remaining = tx.amount;
          while (remaining > 0 && lots.length > 0) {
            if (lots[0].amount <= remaining) {
              remaining -= lots[0].amount;
              lots.shift();
            } else {
              lots[0].amount -= remaining;
              remaining = 0;
            }
          }
          var withdrawnPrincipal = tx.amount - remaining;
          // Proportional interest on the withdrawn principal becomes realized profit
          if (totalPrincipalBefore > 0 && totalInterest > 0) {
            var interestRealized = totalInterest * (withdrawnPrincipal / totalPrincipalBefore);
            realizedInterest += interestRealized;
            totalInterest -= interestRealized;
          }
        } else {
          lots.push({ amount: tx.amount });
        }
      });

      var invested = lots.reduce(function (s, l) { return s + l.amount; }, 0);
      var current = invested + totalInterest;
      holdings.push({ portfolio: pf.portfolio, bank: "", instrument: pf.instrument, subCategory: pf.subCategory, invested: invested, current: current, realizedProfit: realizedInterest });
    });

    return holdings;
  }

  // Builds holdings from the EPF/fixedincome sheet using deposit+interest accumulation logic.
  function buildEpfFixedIncomeHoldingsList(epfRows, portfolioFilter) {
    var header = epfRows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var instrumentIdx = header.indexOf("instrument name");
    var typeIdx = header.indexOf("transaction type");
    var amountIdx = header.indexOf("amount");
    var subCategoryIdx = header.indexOf("instrument sub category");
    var categoryIdx = header.indexOf("instrument category");
    if (portfolioIdx === -1 || instrumentIdx === -1 || typeIdx === -1 || amountIdx === -1) return null;

    var byKey = {};
    epfRows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && normalizeText(portfolio) !== normalizeText(portfolioFilter)) return;
      if (categoryIdx !== -1 && normalizeText(row[categoryIdx]) !== "fixed income") return;
      var instrument = (row[instrumentIdx] || "").trim();
      if (!instrument) return;
      var subCategory = subCategoryIdx !== -1 ? (row[subCategoryIdx] || "").trim() : "";
      var type = normalizeText(row[typeIdx]);
      var isDeposit = type.indexOf("deposit") !== -1;
      var isInterest = type.indexOf("interest") !== -1;
      if (!isDeposit && !isInterest) return;
      var key = normalizeText(portfolio) + "||" + normalizeText(instrument) + "||" + normalizeText(subCategory);
      var amount = parseNumber(row[amountIdx]);
      if (!byKey[key]) byKey[key] = { portfolio: portfolio, instrument: instrument, subCategory: subCategory, invested: 0, current: 0 };
      if (isDeposit) { byKey[key].invested += amount; byKey[key].current += amount; }
      else byKey[key].current += amount;
    });

    return Object.keys(byKey).map(function (key) {
      var e = byKey[key];
      return { portfolio: e.portfolio, bank: "", instrument: e.instrument, subCategory: e.subCategory, invested: e.invested, current: e.current };
    });
  }

  function renderAllFixedIncomeHoldingsTable() {
    var statusEl = document.getElementById("fixedincome-holding-status");
    var tableWrap = document.getElementById("fixedincome-holding-table-wrap");
    var tbody = document.getElementById("fixedincome-holding-tbody");
    if (!statusEl || !tableWrap || !tbody) return;

    var selectedPortfolio = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
    var fdRows = getSheetRows("fd");

    if (!fdRows || !fdRows.length) {
      statusEl.textContent = "Connect your Fixed Income/Commodity sheet in Settings to populate this view.";
      tableWrap.hidden = true;
      return;
    }

    var holdings = [];
    var headerError = false;

    if (fdRows && fdRows.length) {
      var fdHoldings = buildFdFixedIncomeHoldingsList(fdRows, selectedPortfolio);
      if (fdHoldings === null) { headerError = true; }
      else holdings = holdings.concat(fdHoldings);
    }

    if (headerError && !holdings.length) {
      statusEl.textContent = "Header row number is incorrect. Make adjustments by adding correct header row number.";
      tableWrap.hidden = true;
      return;
    }
    if (!holdings.length) {
      statusEl.textContent = "No Fixed Income holdings found.";
      tableWrap.hidden = true;
      return;
    }

    tbody.innerHTML = "";
    holdings.forEach(function (h) {
      var tr = document.createElement("tr");
      var unrealized = h.current - h.invested;
      var returnPct = h.invested > 0 ? (unrealized / h.invested) * 100 : 0;
      var cls = unrealized > 0 ? "positive" : unrealized < 0 ? "negative" : "";

      var portfolioTd = document.createElement("td");
      portfolioTd.className = "col-desktop-only";
      portfolioTd.textContent = h.portfolio;
      tr.appendChild(portfolioTd);

      var subCategoryTd = document.createElement("td");
      subCategoryTd.className = "col-desktop-only";
      subCategoryTd.textContent = h.subCategory;
      tr.appendChild(subCategoryTd);

      var nameTd = document.createElement("td");
      nameTd.className = "fund-name";
      nameTd.textContent = h.instrument;
      tr.appendChild(nameTd);

      var investedTd = document.createElement("td");
      investedTd.className = "num";
      investedTd.textContent = formatCurrency(h.invested);
      tr.appendChild(investedTd);

      var currentTd = document.createElement("td");
      currentTd.className = "num col-desktop-only";
      currentTd.textContent = formatCurrency(h.current);
      tr.appendChild(currentTd);

      var unrealizedTd = document.createElement("td");
      unrealizedTd.className = "num " + cls;
      unrealizedTd.textContent = (unrealized > 0 ? "+" : "") + formatCurrency(unrealized);
      tr.appendChild(unrealizedTd);

      var returnTd = document.createElement("td");
      returnTd.className = "num " + cls;
      returnTd.textContent = (returnPct > 0 ? "+" : "") + returnPct.toFixed(2) + "%";
      tr.appendChild(returnTd);

      tbody.appendChild(tr);
    });

    statusEl.textContent = holdings.length + " holding(s).";
    tableWrap.hidden = false;
  }

  function renderFdHoldingsTableInto(statusEl, tableWrap, tbody, holdings, emptyMessage, showReturn) {
    if (!holdings || !holdings.length) {
      statusEl.textContent = emptyMessage;
      tableWrap.hidden = true;
      return;
    }

    tbody.innerHTML = "";
    holdings.forEach(function (h) {
      var tr = document.createElement("tr");

      var portfolioTd = document.createElement("td");
      portfolioTd.className = "col-desktop-only";
      portfolioTd.textContent = h.portfolio;
      tr.appendChild(portfolioTd);

      var bankTd = document.createElement("td");
      bankTd.className = "col-desktop-only";
      bankTd.textContent = h.bank;
      tr.appendChild(bankTd);

      var nameTd = document.createElement("td");
      nameTd.className = "fund-name";
      nameTd.textContent = h.instrument;
      tr.appendChild(nameTd);

      var subCategoryTd = document.createElement("td");
      subCategoryTd.className = "col-desktop-only";
      subCategoryTd.textContent = h.subCategory;
      tr.appendChild(subCategoryTd);

      var investedTd = document.createElement("td");
      investedTd.className = "num";
      investedTd.textContent = formatCurrency(h.invested);
      tr.appendChild(investedTd);

      var currentTd = document.createElement("td");
      currentTd.className = "num col-desktop-only";
      currentTd.textContent = formatCurrency(h.current);
      tr.appendChild(currentTd);

      if (showReturn) {
        var unrealizedProfit = h.current - h.invested;
        var unrealizedTd = document.createElement("td");
        unrealizedTd.className = "num " + (unrealizedProfit > 0 ? "positive" : unrealizedProfit < 0 ? "negative" : "");
        unrealizedTd.textContent = (unrealizedProfit > 0 ? "+" : "") + formatCurrency(unrealizedProfit);
        tr.appendChild(unrealizedTd);

        var returnPct = h.invested > 0 ? (unrealizedProfit / h.invested) * 100 : 0;
        var returnTd = document.createElement("td");
        returnTd.className = "num " + (returnPct > 0 ? "positive" : returnPct < 0 ? "negative" : "");
        returnTd.textContent = (returnPct > 0 ? "+" : "") + returnPct.toFixed(2) + "%";
        tr.appendChild(returnTd);

      }

      tbody.appendChild(tr);
    });

    statusEl.textContent = holdings.length + " holding(s).";
    tableWrap.hidden = false;
  }

  // "Savings/Investment Holding": Investment Corpus and Savings Account sub-categories.
  // Fixed Deposit has its own dedicated "Fixed Deposit Holding" table below.
  function renderFdHoldingsTable() {
    var statusEl = document.getElementById("fd-holdings-status");
    var tableWrap = document.getElementById("fd-holdings-table-wrap");
    var tbody = document.getElementById("fd-holdings-tbody");
    if (!statusEl || !tableWrap || !tbody) return;

    var rows = getSheetRows("fd");
    if (!rows || !rows.length) {
      statusEl.textContent = "Connect your Fixed Income/Commodity sheet in Settings to populate this view.";
      tableWrap.hidden = true;
      return;
    }

    var selectedPortfolio = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
    var holdings = buildFdHoldingsList(rows, selectedPortfolio, function (normSubCategory) {
      return normSubCategory === "investment corpus" || normSubCategory === "savings account";
    });
    if (holdings === null) {
      statusEl.textContent = "Header row number is incorrect. Make adjustments by adding correct header row number.";
      tableWrap.hidden = true;
      return;
    }

    renderFdHoldingsTableInto(statusEl, tableWrap, tbody, holdings, "No Investment Corpus/Savings Account holdings found.", false);
  }

  // "Fixed Deposit Holding": Fixed Deposit sub-category only.
  function renderFixedDepositHoldingsTable() {
    var statusEl = document.getElementById("fixeddeposit-holdings-status");
    var tableWrap = document.getElementById("fixeddeposit-holdings-table-wrap");
    var tbody = document.getElementById("fixeddeposit-holdings-tbody");
    if (!statusEl || !tableWrap || !tbody) return;

    var rows = getSheetRows("fd");
    if (!rows || !rows.length) {
      statusEl.textContent = "Connect your Fixed Income/Commodity sheet in Settings to populate this view.";
      tableWrap.hidden = true;
      return;
    }

    var selectedPortfolio = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
    var holdings = buildFdHoldingsList(rows, selectedPortfolio, function (normSubCategory) {
      return normSubCategory === "fixed deposit";
    });
    if (holdings === null) {
      statusEl.textContent = "Header row number is incorrect. Make adjustments by adding correct header row number.";
      tableWrap.hidden = true;
      return;
    }

    renderFdHoldingsTableInto(statusEl, tableWrap, tbody, holdings, "No Fixed Deposit holdings found.", true);
  }

  // ─── Stocks/ETF: stock_prices.json helpers ────────────────────────────────
  var STOCK_PRICES_CACHE_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes
  var _stockPricesPromise = null;

  function buildStockMappingTable() {
    var rows = getSheetRows("stocksetfmapping");
    var map = {};
    if (!rows || rows.length < 2) return map;
    var header = rows[0].map(normalizeText);
    var instrumentIdx = header.indexOf("instrument name");
    var categoryIdx   = header.indexOf("instrument category");
    var subCatIdx     = header.indexOf("instrument sub category");
    var segmentIdx    = header.findIndex(function(h) { return h.indexOf("market segment") !== -1; });
    var regionIdx     = header.findIndex(function(h) { return h === "region"; });
    var identifierIdx = header.findIndex(function(h) { return h.indexOf("identifier") !== -1; });
    if (instrumentIdx === -1 || regionIdx === -1 || identifierIdx === -1) return map;
    rows.slice(1).forEach(function (row) {
      var name = (row[instrumentIdx] || "").trim();
      if (!name) return;
      var region     = (row[regionIdx]     || "").trim();
      var identifier = (row[identifierIdx] || "").trim();
      map[normalizeText(name)] = {
        ticker:   identifier || name,
        region:   region,
        exchange: region === "India" ? "NSE" : null,
        segment:  segmentIdx  !== -1 ? (row[segmentIdx]  || "").trim() : "",
        subCat:   subCatIdx   !== -1 ? (row[subCatIdx]   || "").trim() : "",
        category: categoryIdx !== -1 ? (row[categoryIdx] || "").trim() : ""
      };
    });
    return map;
  }

  // Returns a Promise<{ updated, prices, usd_inr_history }> — cached 15 min in localStorage.
  function fetchAllStockPrices() {
    var cacheKey = "wf-stock-prices-json";
    try {
      var cached = JSON.parse(localStorage.getItem(cacheKey));
      if (cached && cached.fetchedAt && Date.now() - cached.fetchedAt < STOCK_PRICES_CACHE_MAX_AGE_MS) {
        return Promise.resolve(cached.data);
      }
    } catch (e) {}
    if (_stockPricesPromise) return _stockPricesPromise;
    _stockPricesPromise = fetch("stock_prices.json?t=" + Math.floor(Date.now() / STOCK_PRICES_CACHE_MAX_AGE_MS))
      .then(function (r) {
        if (!r.ok) throw new Error("stock_prices.json not found (HTTP " + r.status + ")");
        return r.json();
      })
      .then(function (data) {
        try { localStorage.setItem(cacheKey, JSON.stringify({ data: data, fetchedAt: Date.now() })); } catch (e) {}
        _stockPricesPromise = null;
        return data;
      })
      .catch(function (err) {
        _stockPricesPromise = null;
        throw err;
      });
    return _stockPricesPromise;
  }

  // Build holdings array for Stocks/ETF with FIFO lots and USD/INR conversion.
  // Returns a Promise resolving to array of { instrument, ticker, region, exchange, units, avgCostINR, investedINR, lots }
  function buildStockHoldings(rows, mappingTable, portfolioFilter, showClosed) {
    var transactionsByInstrument = groupUnitTransactionsByInstrument(rows, portfolioFilter);
    if (!transactionsByInstrument) return Promise.resolve([]);

    var holdings = [];
    Object.keys(transactionsByInstrument).forEach(function (instrument) {
      var txns = transactionsByInstrument[instrument];
      var remainingLots = fifoRemainingLots(txns);
      var remainingUnits = 0;
      remainingLots.forEach(function (lot) { remainingUnits += lot.units; });
      if (showClosed) {
        if (remainingUnits >= UNITS_EPSILON) return; // skip open positions
      } else {
        if (remainingUnits < UNITS_EPSILON) return; // skip closed positions
      }

      var mapping = mappingTable[normalizeText(instrument)];
      if (!mapping) return; // skip instruments not found in mapping sheet
      var ticker = mapping.ticker;
      var region = mapping.region;
      var exchange = mapping.exchange || null;

      // Attach date to each remaining lot by replaying transactions
      var lotsWithDate = [];
      var buyQueue = [];
      txns.forEach(function (txn) {
        if (txn.type === "buy") {
          buyQueue.push({ units: txn.units, price: txn.price, date: txn.date });
        } else {
          var toMatch = txn.units;
          while (toMatch > 0 && buyQueue.length) {
            var head = buyQueue[0];
            var matched = Math.min(toMatch, head.units);
            head.units -= matched;
            toMatch -= matched;
            if (head.units <= 0) buyQueue.shift();
          }
        }
      });
      lotsWithDate = buyQueue.slice();

      holdings.push({ instrument: instrument, ticker: ticker, region: region, exchange: exchange, remainingUnits: remainingUnits, lots: lotsWithDate, txns: txns });
    });

    if (!holdings.length) return Promise.resolve([]);

    // For US stocks, look up historical USD/INR from stock_prices.json usd_inr_history
    return fetchAllStockPrices().catch(function () { return { prices: {}, usd_inr_history: {} }; }).then(function (stockPricesData) {
      var usdRateMap = stockPricesData.usd_inr_history || {};

      return holdings.map(function (h) {
        var investedINR = 0;
        h.lots.forEach(function (lot) {
          if (h.region === "US") {
            var dateStr = formatDateISO(lot.date);
            var rate = usdRateMap[dateStr] || 84; // fallback rate
            investedINR += lot.units * lot.price * rate;
          } else {
            investedINR += lot.units * lot.price;
          }
        });
        var avgCostINR = h.remainingUnits > UNITS_EPSILON ? investedINR / h.remainingUnits : 0;
        return {
          instrument: h.instrument,
          ticker: h.ticker,
          region: h.region,
          exchange: h.exchange,
          units: h.remainingUnits,
          avgCostINR: avgCostINR,
          investedINR: investedINR,
          txns: h.txns
        };
      });
    });
  }

  // ─── End Stocks/ETF helpers ───────────────────────────────────────────────

  var GOLD_PRICE_CACHE_KEY = "wf-gold-price-inr-per-gram";
  var GOLD_PRICE_CACHE_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours
  var GOLD_API_KEY = "goldapi-bb93d5efdf450d839eba8c4fe351ead2-io";
  var GOLD_DAY_CHANGE_CACHE_KEY = "wf-gold-day-change-inr-per-gram";
  var GOLD_DAY_CHANGE_CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
  var TROY_OZ_TO_GRAM = 31.1035;

  function formatDateISO(date) {
    if (!date) return null;
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1);
    var d = String(date.getDate());
    return y + "-" + (m.length < 2 ? "0" + m : m) + "-" + (d.length < 2 ? "0" + d : d);
  }

  // Fetches today's gold day change per gram directly from goldapi.io's current-price endpoint.
  // goldapi.io's `ch` field is the official daily change (today close vs previous close) per troy oz.
  // This is more accurate than subtracting two dated-endpoint prices, which often return the same value.
  function fetchGoldDayChangeINRPerGram() {
    try {
      var cached = JSON.parse(localStorage.getItem(GOLD_DAY_CHANGE_CACHE_KEY));
      if (cached && Date.now() - cached.fetchedAt < GOLD_DAY_CHANGE_CACHE_MAX_AGE_MS) return Promise.resolve(cached.change);
    } catch (e) {}
    return fetch("https://www.goldapi.io/api/XAU/INR", {
      headers: { "x-access-token": GOLD_API_KEY, "Content-Type": "application/json" }
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || data.ch === undefined || data.ch === null) throw new Error("No ch in goldapi response");
        var changePerGram = data.ch / TROY_OZ_TO_GRAM;
        try { localStorage.setItem(GOLD_DAY_CHANGE_CACHE_KEY, JSON.stringify({ change: changePerGram, fetchedAt: Date.now() })); } catch (e) {}
        return changePerGram;
      });
  }

  function fetchXauInrForDate(dateStr) {
    // Historical prices never change — cache indefinitely
    var cacheKey = "wf-gold-hist-" + dateStr;
    try {
      var cached = JSON.parse(localStorage.getItem(cacheKey));
      if (cached && cached.price) return Promise.resolve(cached.price);
    } catch (e) {}

    // Fetch from one currency-api CDN URL
    function fetchFromCurrencyApi(url) {
      return fetch(url)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var xauInr = data && data.xau && data.xau.inr;
          if (!xauInr) throw new Error("No XAU/INR");
          return xauInr / TROY_OZ_TO_GRAM;
        });
    }

    // Fallback: goldapi.io — historical XAU/INR per gram, CORS-friendly
    function fetchFromGoldApi(dStr) {
      var datePart = dStr.replace(/-/g, "");
      var url = "https://www.goldapi.io/api/XAU/INR/" + datePart;
      return fetch(url, { headers: { "x-access-token": GOLD_API_KEY, "Content-Type": "application/json" } })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          // goldapi.io returns price_gram_24k directly; fall back to price (per troy oz) / 31.1035
          var pricePerGram = data && (data.price_gram_24k || (data.price && data.price / TROY_OZ_TO_GRAM));
          if (!pricePerGram) throw new Error("No goldapi price for " + dStr);
          return pricePerGram;
        });
    }

    // Try jsDelivr npm CDN → goldapi.io for a given date
    function tryDateAllSources(dStr) {
      var urlA = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@" + dStr + "/v1/currencies/xau.min.json";
      return fetchFromCurrencyApi(urlA)
        .catch(function () { return fetchFromGoldApi(dStr); });
    }

    // Step back up to 3 days (handles weekends/holidays for currency-api dates)
    // Yahoo Finance is tried for EACH date in the window before giving up
    function tryDate(dStr, attemptsLeft) {
      return tryDateAllSources(dStr)
        .then(function (pricePerGram) {
          try { localStorage.setItem(cacheKey, JSON.stringify({ price: pricePerGram })); } catch (e) {}
          return pricePerGram;
        })
        .catch(function () {
          if (attemptsLeft <= 0) throw new Error("No XAU/INR found near " + dateStr);
          var parts = dStr.split("-");
          var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) - 1);
          return tryDate(formatDateISO(d), attemptsLeft - 1);
        });
    }
    return tryDate(dateStr, 3);
  }

  function fetchGoldPriceINRPerGram() {
    try {
      var cached = JSON.parse(localStorage.getItem(GOLD_PRICE_CACHE_KEY));
      if (cached && Date.now() - cached.fetchedAt < GOLD_PRICE_CACHE_MAX_AGE_MS) {
        return Promise.resolve(cached.price);
      }
    } catch (e) {}

    // jsDelivr CDN-hosted currency API — CORS-friendly, no API key, includes XAU (gold) in INR
    return fetch("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/xau.min.json")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var xauInr = data && data.xau && data.xau.inr;
        console.log("[Gold] XAU/INR from currency-api:", xauInr);
        if (!xauInr) throw new Error("Invalid currency-api response");
        var priceInrPerGram = xauInr / TROY_OZ_TO_GRAM;
        try {
          localStorage.setItem(GOLD_PRICE_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), price: priceInrPerGram }));
        } catch (e) {}
        return priceInrPerGram;
      });
  }

  // ─── Benchmark index XIRR comparison ──────────────────────────────────────

  var _indexHistoryCache = null;

  function fetchIndexHistory() {
    if (_indexHistoryCache) return Promise.resolve(_indexHistoryCache);
    return fetchAllStockPrices().then(function (data) {
      _indexHistoryCache = (data && data.index_history) || {};
      return _indexHistoryCache;
    }).catch(function () {
      _indexHistoryCache = {};
      return _indexHistoryCache;
    });
  }

  function lookupIndexPrice(prices, dateStr) {
    // exact match
    if (prices[dateStr] !== undefined) return prices[dateStr];
    // search up to 5 trading days back for a price on or before this date
    var d = new Date(dateStr);
    for (var i = 1; i <= 5; i++) {
      d.setDate(d.getDate() - 1);
      var s = d.toISOString().slice(0, 10);
      if (prices[s] !== undefined) return prices[s];
    }
    return null;
  }

  function buildIndexXirrCashFlows(allCashFlows, indexPrices) {
    // allCashFlows: [{date: Date, amount: Number}] — negative = invest, positive = redeem
    // For each outflow (buy), simulate buying index units; for each inflow (sell), simulate selling.
    // Terminal: remaining units × current index price.
    if (!allCashFlows || !allCashFlows.length || !indexPrices) return null;

    var indexDates = Object.keys(indexPrices).sort();
    if (!indexDates.length) return null;
    var latestPrice = indexPrices[indexDates[indexDates.length - 1]];

    var unitsHeld = 0;
    var flows = [];

    allCashFlows.forEach(function (cf) {
      var dateStr = cf.date.toISOString().slice(0, 10);
      var price = lookupIndexPrice(indexPrices, dateStr);
      if (!price) return; // skip if no index price near this date
      if (cf.amount < 0) {
        // buy: invest |amount| into index
        var units = Math.abs(cf.amount) / price;
        unitsHeld += units;
        flows.push({ date: cf.date, amount: cf.amount }); // outflow
      } else {
        // sell: redeem proportional units
        var sellUnits = Math.min(unitsHeld, cf.amount / price);
        unitsHeld = Math.max(0, unitsHeld - sellUnits);
        flows.push({ date: cf.date, amount: cf.amount }); // inflow
      }
    });

    if (unitsHeld > 0) {
      flows.push({ date: new Date(), amount: unitsHeld * latestPrice });
    }

    return flows;
  }

  // periodYears: number of years to look back (null = all time)
  function computeBenchmarkXirr(indexKey, periodYears) {
    var selected = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
    var equityRows = getSheetRows("equity");
    var seRows = getSheetRows("stocksetf");
    var fdRows = getSheetRows("fd");

    var allFlows = buildXirrCashFlows(equityRows, selected);
    if (seRows) allFlows = allFlows.concat(buildXirrCashFlows(seRows, selected));
    if (fdRows && !isFixedIncomeExcluded()) {
      allFlows = allFlows
        .concat(buildFdMaturedXirrCashFlows(fdRows, selected))
        .concat(buildProvidentFundXirrCashFlows(fdRows, selected));
    }

    var cutoff = periodYears ? new Date(new Date() - periodYears * 365.25 * 24 * 60 * 60 * 1000) : null;
    function afterCutoff(f) { return !cutoff || f.date >= cutoff; }

    // Index XIRR: buy-only flows filtered to the selected period.
    var allFlowsForIndex = buildXirrCashFlows(equityRows, selected).filter(afterCutoff);
    if (seRows) allFlowsForIndex = allFlowsForIndex.concat(buildXirrCashFlows(seRows, selected).filter(afterCutoff));
    if (fdRows) {
      allFlowsForIndex = allFlowsForIndex
        .concat(buildFdMaturedXirrCashFlows(fdRows, selected).filter(afterCutoff))
        .concat(buildProvidentFundXirrCashFlows(fdRows, selected).filter(afterCutoff));
    }

    // All-time portfolio XIRR (used for "All" period and as fallback)
    var flowsWithTerminal;
    if (_ov._overviewBaseFlows && _ov._overviewBaseFlows.length) {
      flowsWithTerminal = _ov._overviewBaseFlows.concat(_ov.seXirrFlows || []);
    } else {
      var currentVal = _ov.mfCurrent + (_ov.seCurrent > 0 ? _ov.seCurrent : 0) + (isFixedIncomeExcluded() ? 0 : _ov.fiCurrent) + _ov.commCurrent;
      flowsWithTerminal = allFlows.slice();
      if (currentVal > 0) flowsWithTerminal.push({ date: new Date(), amount: currentVal });
    }
    var allTimePortfolioXirr = calculateXIRR(flowsWithTerminal);

    // For a selected period: compute portfolio value at cutoff as "starting investment",
    // then XIRR over [cutoff → today] using actual flows within the period + current value.
    var portfolioXirrPromise;
    if (periodYears && cutoff) {
      portfolioXirrPromise = computePortfolioValueAtDate(cutoff, selected).then(function (result) {
        var startVal = result.value;
        if (!startVal || startVal <= 0) return allTimePortfolioXirr;
        // Terminal value must use the exact same scope as startVal: MF + only the stock
        // tickers that had historical prices at the cutoff (seCurrentIncluded).
        var periodCurrentVal = _ov.mfCurrent + result.seCurrentIncluded;
        // Period flows: MF + stocks only — FD/PF value isn't part of startVal/terminal,
        // so including its contributions would make money vanish and drag XIRR down.
        var mfSeFlows = buildXirrCashFlows(equityRows, selected);
        if (seRows) mfSeFlows = mfSeFlows.concat(buildXirrCashFlows(seRows, selected));
        var periodFlows = [{ date: cutoff, amount: -startVal }];
        mfSeFlows.forEach(function (f) { if (f.date > cutoff) periodFlows.push(f); });
        if (periodCurrentVal > 0) periodFlows.push({ date: new Date(), amount: periodCurrentVal });
        return calculateXIRR(periodFlows) || allTimePortfolioXirr;
      });
    } else {
      portfolioXirrPromise = Promise.resolve(allTimePortfolioXirr);
    }

    return portfolioXirrPromise.then(function (portfolioXirr) {
      return fetchIndexHistory().then(function (indexHistory) {
        var indexData = indexHistory[indexKey];
        var indexPriceDates = indexData && indexData.prices ? Object.keys(indexData.prices).sort() : [];
        var indexHasHistory = indexPriceDates.length >= 30 &&
          (new Date(indexPriceDates[indexPriceDates.length - 1]) - new Date(indexPriceDates[0])) > 180 * 24 * 60 * 60 * 1000;
        if (!indexHasHistory) return { portfolioXirr: portfolioXirr, indexXirr: null };
        var buyFlowsForIndex = allFlowsForIndex.filter(function (f) { return f.amount < 0; });
        var indexFlows = buildIndexXirrCashFlows(buyFlowsForIndex, indexData.prices);
        var indexXirr = indexFlows ? calculateXIRR(indexFlows) : null;
        return { portfolioXirr: portfolioXirr, indexXirr: indexXirr };
      });
    });
  }

  function computeBenchmarkCagr(indexKey, periodYears) {
    // Index CAGR = point-to-point from startDate to today.
    // startDate = periodYears ago if a period is selected, else first investment date.
    var selected = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
    var equityRows = getSheetRows("equity");
    var seRows = getSheetRows("stocksetf");
    var fdRows = getSheetRows("fd");

    var startDate;
    if (periodYears) {
      startDate = new Date(new Date() - periodYears * 365.25 * 24 * 60 * 60 * 1000);
    } else {
      var allFlows = buildXirrCashFlows(equityRows, selected);
      if (seRows) allFlows = allFlows.concat(buildXirrCashFlows(seRows, selected));
      if (fdRows && !isFixedIncomeExcluded()) {
        allFlows = allFlows
          .concat(buildFdMaturedXirrCashFlows(fdRows, selected))
          .concat(buildProvidentFundXirrCashFlows(fdRows, selected));
      }
      if (!allFlows.length) return Promise.resolve({ indexCagr: null, years: null });
      startDate = allFlows.reduce(function (min, f) {
        return f.date.getTime() < min.getTime() ? f.date : min;
      }, allFlows[0].date);
    }

    var yearsHeld = (new Date() - startDate) / (1000 * 60 * 60 * 24 * 365.25);
    if (yearsHeld < 0.05) return Promise.resolve({ indexCagr: null, years: yearsHeld });

    return fetchIndexHistory().then(function (indexHistory) {
      var indexData = indexHistory[indexKey];
      var sortedDates = indexData && indexData.prices ? Object.keys(indexData.prices).sort() : [];
      var indexHasCagrHistory = sortedDates.length >= 30 &&
        (new Date(sortedDates[sortedDates.length - 1]) - new Date(sortedDates[0])) > 180 * 24 * 60 * 60 * 1000;
      if (!indexHasCagrHistory) return { indexCagr: null, years: yearsHeld };

      var prices = indexData.prices;
      var startDateStr = formatDateISO(startDate);
      var startPrice = null;
      for (var i = 0; i < sortedDates.length; i++) {
        if (sortedDates[i] >= startDateStr) { startPrice = prices[sortedDates[i]]; break; }
      }
      var endPrice = prices[sortedDates[sortedDates.length - 1]];
      // Require at least 30 days between start and end price dates to avoid near-zero CAGR from same-day lookup
      var startPriceDate = startPrice ? sortedDates.find(function(d) { return prices[d] === startPrice && d >= startDateStr; }) : null;
      var spanDays = startPriceDate ? (new Date(sortedDates[sortedDates.length-1]) - new Date(startPriceDate)) / (24*60*60*1000) : 0;
      var indexCagr = (startPrice && endPrice && spanDays > 30)
        ? Math.pow(endPrice / startPrice, 1 / yearsHeld) - 1
        : null;

      return { indexCagr: indexCagr, years: yearsHeld };
    });
  }

  // Returns a Promise<number> — total portfolio value (MF + stocks) at a historical date.
  function computePortfolioValueAtDate(targetDate, portfolioFilter) {
    return buildInstrumentSchemeMap().then(function (schemeMap) {
      var unitEvents = buildInstrumentUnitEvents(portfolioFilter);
      var instruments = Object.keys(unitEvents).filter(function (name) { return !!lookupSchemeCode(schemeMap, name); });

      var seRows = getSheetRows("stocksetf");
      var seMappingTable = buildStockMappingTable();
      var seUnitEventsByTicker = {};
      if (seRows && seRows.length && Object.keys(seMappingTable).length) {
        var seTxns = groupUnitTransactionsByInstrument(seRows, portfolioFilter);
        if (seTxns) {
          Object.keys(seTxns).forEach(function (instrument) {
            var mapping = seMappingTable[normalizeText(instrument)];
            if (!mapping) return;
            var sorted = (seTxns[instrument] || []).filter(function (t) { return !!t.date; }).sort(function (a, b) { return a.date - b.date; });
            if (!sorted.length) return;
            var running = 0;
            seUnitEventsByTicker[mapping.ticker] = { region: mapping.region, events: sorted.map(function (txn) {
              running += txn.type === "buy" ? txn.units : -txn.units;
              return { date: txn.date, cumulativeUnits: Math.max(0, running) };
            }) };
          });
        }
      }

      var navHistoriesPromise = instruments.length
        ? Promise.all(instruments.map(function (name) { return fetchNavHistory(lookupSchemeCode(schemeMap, name)); }))
        : Promise.resolve([]);
      var spPromise = Object.keys(seUnitEventsByTicker).length
        ? fetchAllStockPrices().catch(function () { return {}; })
        : Promise.resolve({});

      return Promise.all([navHistoriesPromise, spPromise]).then(function (res) {
        var navHistories = res[0];
        var spData = res[1];
        var stockHistory = spData.stock_history || {};
        var usdInrHistMap = spData.usd_inr_history || {};
        var allPrices = spData.prices || {};
        var usdInrToday = allPrices["__USD_INR__"] ? allPrices["__USD_INR__"].price : 84;
        var navByInstrument = {};
        instruments.forEach(function (name, i) { navByInstrument[name] = navHistories[i]; });

        var dateStr = formatDateISO(targetDate);
        var mfTotal = 0, seTotal = 0;
        var includedStockTickers = [];
        instruments.forEach(function (name) {
          var units = lastAtOrBefore(unitEvents[name], targetDate, "cumulativeUnits") || 0;
          var nav = lastAtOrBefore(navByInstrument[name], targetDate, "nav");
          if (units > UNITS_EPSILON && nav) mfTotal += units * nav;
        });
        var seCurrentIncluded = 0;
        var today = new Date();
        Object.keys(seUnitEventsByTicker).forEach(function (ticker) {
          var entry = seUnitEventsByTicker[ticker];
          var units = lastAtOrBefore(entry.events, targetDate, "cumulativeUnits") || 0;
          if (units <= UNITS_EPSILON) return;
          var hist = stockHistory[ticker];
          // Only use actual historical price — never fall back to current LTP (would distort XIRR)
          var price = hist ? lookupIndexPrice(hist.prices, dateStr) : null;
          if (!price) return;
          var isUsd = entry.region === "US" || (hist && hist.currency === "USD");
          seTotal += units * price * (isUsd ? (usdInrHistMap[dateStr] || usdInrToday) : 1);
          includedStockTickers.push(ticker);
          // Current value of this same ticker (today's units × LTP) so callers can build
          // a terminal value with the exact same stock scope as the historical value.
          var unitsToday = lastAtOrBefore(entry.events, today, "cumulativeUnits") || 0;
          var cur = allPrices[ticker];
          if (unitsToday > UNITS_EPSILON && cur && cur.price) {
            seCurrentIncluded += unitsToday * cur.price * (isUsd ? usdInrToday : 1);
          }
        });
        return { value: mfTotal + seTotal, mfValue: mfTotal, seValue: seTotal, seCurrentIncluded: seCurrentIncluded, includedStockTickers: includedStockTickers };
      });
    });
  }

  // Compute rolling CAGR statistics over all rolling windows of `windowYears` in portfolio history.
  // Portfolio value at each monthly date = MF (units × NAV) + Stock (units × historical price).
  // Index CAGR = point-to-point from stock_prices.json index_history.
  function computeRollingReturns(windowYears, indexKey) {
    var selected = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
    return buildInstrumentSchemeMap().then(function (schemeMap) {
      var unitEvents = buildInstrumentUnitEvents(selected);
      var instruments = Object.keys(unitEvents).filter(function (name) { return !!lookupSchemeCode(schemeMap, name); });

      var seRows = getSheetRows("stocksetf");
      var seMappingTable = buildStockMappingTable();
      var seUnitEventsByTicker = {};
      if (seRows && seRows.length && Object.keys(seMappingTable).length) {
        var seTxns = groupUnitTransactionsByInstrument(seRows, selected);
        if (seTxns) {
          Object.keys(seTxns).forEach(function (instrument) {
            var mapping = seMappingTable[normalizeText(instrument)];
            if (!mapping) return;
            var sorted = (seTxns[instrument] || []).filter(function (t) { return !!t.date; }).sort(function (a, b) { return a.date - b.date; });
            if (!sorted.length) return;
            var running = 0;
            seUnitEventsByTicker[mapping.ticker] = { region: mapping.region, instrument: instrument, events: sorted.map(function (txn) {
              running += txn.type === "buy" ? txn.units : -txn.units;
              return { date: txn.date, cumulativeUnits: Math.max(0, running) };
            }) };
          });
        }
      }

      var navHistoriesPromise = instruments.length
        ? Promise.all(instruments.map(function (name) { return fetchNavHistory(lookupSchemeCode(schemeMap, name)); }))
        : Promise.resolve([]);
      var stockPricesPromise = fetchAllStockPrices().catch(function () { return {}; });

      return Promise.all([navHistoriesPromise, stockPricesPromise]).then(function (res) {
        var navHistories = res[0];
        var spData = res[1];
        var stockHistory = spData.stock_history || {};
        var usdInrHistMap = spData.usd_inr_history || {};
        var allPrices = spData.prices || {};
        var usdInrToday = allPrices["__USD_INR__"] ? allPrices["__USD_INR__"].price : 84;
        var indexPrices = ((spData.index_history || {})[indexKey] || {}).prices || null;

        var navByInstrument = {};
        instruments.forEach(function (name, i) { navByInstrument[name] = navHistories[i]; });

        // Find earliest transaction date across all asset types
        var firstDate = null;
        instruments.forEach(function (name) {
          var evs = unitEvents[name];
          if (evs && evs.length && (!firstDate || evs[0].date < firstDate)) firstDate = evs[0].date;
        });
        Object.keys(seUnitEventsByTicker).forEach(function (ticker) {
          var evs = seUnitEventsByTicker[ticker].events;
          if (evs.length && (!firstDate || evs[0].date < firstDate)) firstDate = evs[0].date;
        });
        if (!firstDate) return null;

        // Monthly sample dates from firstDate to today
        var today = new Date(); today.setHours(0, 0, 0, 0);
        var samples = [];
        var d = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
        while (d <= today) { samples.push(new Date(d)); d.setMonth(d.getMonth() + 1); }
        if (!samples.length || samples[samples.length - 1] < today) samples.push(today);

        // Portfolio value at each sample date
        var portfolioValues = [];
        samples.forEach(function (date) {
          var dateStr = formatDateISO(date);
          var total = 0;
          instruments.forEach(function (name) {
            var units = lastAtOrBefore(unitEvents[name], date, "cumulativeUnits") || 0;
            var nav = lastAtOrBefore(navByInstrument[name], date, "nav");
            if (units > UNITS_EPSILON && nav) total += units * nav;
          });
          Object.keys(seUnitEventsByTicker).forEach(function (ticker) {
            var entry = seUnitEventsByTicker[ticker];
            var units = lastAtOrBefore(entry.events, date, "cumulativeUnits") || 0;
            if (units <= UNITS_EPSILON) return;
            var hist = stockHistory[ticker];
            // Only actual historical prices — today's LTP as a proxy would distort rolling CAGRs
            var price = hist ? lookupIndexPrice(hist.prices, dateStr) : null;
            if (!price) return;
            if (entry.region === "US" || (hist && hist.currency === "USD")) {
              total += units * price * (usdInrHistMap[dateStr] || usdInrToday);
            } else {
              total += units * price;
            }
          });
          if (total > 0) portfolioValues.push({ date: date, value: total });
        });

        if (portfolioValues.length < 2) return null;

        // Unitize the portfolio into a synthetic NAV series (like a fund NAV) using
        // monthly time-weighted returns: each month's growth is computed net of external
        // cash flows (buys/sells), so contributions don't masquerade as return. Rolling
        // returns are then plain CAGR windows over this NAV series — the standard method:
        //   Rolling return = (End NAV / Start NAV)^(1/n) − 1
        // Flows must cover exactly the instruments included in the valuations above:
        // MF schemes that resolved in the scheme map, and stocks that have price history.
        // Including flows for unvalued instruments would subtract contributions with no
        // matching value increase, understating the return.
        var equityRows = getSheetRows("equity");
        var extFlows = [];
        instruments.forEach(function (name) {
          extFlows = extFlows.concat(buildXirrCashFlows(equityRows, selected, name));
        });
        if (seRows) {
          Object.keys(seUnitEventsByTicker).forEach(function (ticker) {
            if (!stockHistory[ticker]) return; // excluded from valuation → exclude flows too
            extFlows = extFlows.concat(buildXirrCashFlows(seRows, selected, seUnitEventsByTicker[ticker].instrument));
          });
        }
        // buildXirrCashFlows: buys are negative (money out of pocket), sells positive.
        // Net contribution INTO the portfolio during a period = -sum(amounts).
        extFlows.sort(function (a, b) { return a.date - b.date; });

        var navSeries = [{ date: portfolioValues[0].date, nav: 100 }];
        for (var m = 1; m < portfolioValues.length; m++) {
          var prevPt = portfolioValues[m - 1], curPt = portfolioValues[m];
          var netFlow = 0;
          for (var q = 0; q < extFlows.length; q++) {
            var ef = extFlows[q];
            if (ef.date <= prevPt.date) continue;
            if (ef.date > curPt.date) break;
            netFlow += -ef.amount; // contribution into portfolio is positive
          }
          // End-of-period flow assumption: period growth = (V_t - F_t) / V_{t-1}
          var g = prevPt.value > 0 ? (curPt.value - netFlow) / prevPt.value : 1;
          if (!isFinite(g) || g <= 0) g = 1; // guard against degenerate months
          navSeries.push({ date: curPt.date, nav: navSeries[m - 1].nav * g });
        }

        var windowMs = windowYears * 365.25 * 24 * 60 * 60 * 1000;
        var portRolling = [], idxRolling = [];

        navSeries.forEach(function (startPt, i) {
          var targetEnd = new Date(startPt.date.getTime() + windowMs);
          if (targetEnd > today) return;
          var endPt = null;
          for (var j = i + 1; j < navSeries.length; j++) {
            if (navSeries[j].date >= targetEnd) { endPt = navSeries[j]; break; }
          }
          if (!endPt || startPt.nav <= 0) return;
          var actualYears = (endPt.date - startPt.date) / (365.25 * 24 * 60 * 60 * 1000);
          if (actualYears < windowYears * 0.85) return;

          var cagr = Math.pow(endPt.nav / startPt.nav, 1 / actualYears) - 1;
          if (isFinite(cagr) && cagr > -1 && cagr < 20) portRolling.push(cagr);

          if (indexPrices) {
            var sp = lookupIndexPrice(indexPrices, formatDateISO(startPt.date));
            var ep = lookupIndexPrice(indexPrices, formatDateISO(endPt.date));
            if (sp && ep) {
              var ic = Math.pow(ep / sp, 1 / actualYears) - 1;
              if (isFinite(ic) && ic > -1 && ic < 20) idxRolling.push(ic);
            }
          }
        });

        if (!portRolling.length) return null;

        function stats(arr) {
          arr.sort(function (a, b) { return a - b; });
          return { min: arr[0], median: arr[Math.floor(arr.length / 2)], max: arr[arr.length - 1], count: arr.length };
        }
        return { portfolio: stats(portRolling), index: idxRolling.length ? stats(idxRolling) : null };
      });
    });
  }

  function indexDisplayName(indexKey) {
    return indexKey === "NIFTY50" ? "Nifty 50"
      : indexKey === "NIFTYMIDCAP150" ? "Nifty Midcap 150"
      : indexKey === "NIFTYNEXT50" ? "Nifty Next 50"
      : indexKey === "NIFTY500" ? "Nifty 500" : indexKey;
  }

  // Rolling-return summary shown beside the XIRR block (right of the divider) in the
  // benchmark card. Driven by the selected period (1Y/2Y/3Y/5Y) and index; median is the
  // representative single figure. "All" and "10Y" have no rolling window → "N/A".
  function initRollingReturnSummary() {
    var sumPortEl = document.getElementById("rolling-summary-port");
    var sumIdxEl = document.getElementById("rolling-summary-idx");
    var sumAlphaEl = document.getElementById("rolling-summary-alpha");
    var sumIdxLabelEl = document.getElementById("rolling-summary-idx-label");
    if (!sumPortEl && !sumIdxEl) return;

    // Windows we can compute a rolling return for. "all"/"10" are intentionally excluded.
    var ROLLING_PERIODS = { "1": 1, "2": 1, "3": 1, "5": 1 };

    function fmtPct(v) {
      if (v === null || v === undefined || !isFinite(v)) return "—";
      var pct = v * 100;
      return (pct > 0 ? "+" : "") + pct.toFixed(1) + "%";
    }
    function setSummaryCell(el, v, asText) {
      if (!el) return;
      if (asText !== undefined) {
        el.textContent = asText;
        el.classList.remove("positive", "negative");
        return;
      }
      el.textContent = fmtPct(v);
      el.classList.remove("positive", "negative");
      if (v > 0) el.classList.add("positive");
      else if (v < 0) el.classList.add("negative");
    }
    function setSummary(portMedian, idxMedian, notAvailable) {
      if (notAvailable) {
        setSummaryCell(sumPortEl, null, "N/A");
        setSummaryCell(sumIdxEl, null, "N/A");
        setSummaryCell(sumAlphaEl, null, "—");
        return;
      }
      setSummaryCell(sumPortEl, portMedian);
      setSummaryCell(sumIdxEl, idxMedian, idxMedian == null ? "—" : undefined);
      if (portMedian != null && isFinite(portMedian) && idxMedian != null && isFinite(idxMedian)) {
        var alpha = (portMedian - idxMedian) * 100;
        sumAlphaEl.textContent = (alpha > 0 ? "+" : "") + alpha.toFixed(1) + "%";
        sumAlphaEl.classList.remove("positive", "negative");
        sumAlphaEl.classList.add(alpha > 0 ? "positive" : alpha < 0 ? "negative" : "");
      } else {
        setSummaryCell(sumAlphaEl, null, "—");
      }
    }

    var _renderGen = 0;

    function renderForPeriod(period) {
      _renderGen++;
      var gen = _renderGen;
      period = String(period || "all");

      var indexKey = localStorage.getItem("wf-benchmark-index") || "NIFTY50";
      if (sumIdxLabelEl) sumIdxLabelEl.textContent = indexDisplayName(indexKey) + " Rolling Return";

      if (!ROLLING_PERIODS[period]) { setSummary(null, null, true); return; }

      setSummary(null, null, false); // reset to "—" while computing
      var windowYears = parseFloat(period);
      computeRollingReturns(windowYears, indexKey).then(function (result) {
        if (gen !== _renderGen) return;
        if (!result) { setSummary(null, null, false); return; }
        var p = result.portfolio, idx = result.index;
        // Median = representative single-figure rolling return.
        setSummary(p.median, idx ? idx.median : null, false);
      }).catch(function () {
        if (gen !== _renderGen) return;
        setSummary(null, null, false);
      });
    }

    // Re-render whenever the benchmark period or index changes.
    document.addEventListener("wf-benchmark-changed", function (e) {
      var period = (e.detail && e.detail.period) || localStorage.getItem("wf-benchmark-period") || "all";
      renderForPeriod(period);
    });

    // Initial render from the saved period (benchmark card may init before or after this).
    renderForPeriod(localStorage.getItem("wf-benchmark-period") || "all");
  }

  function initBenchmarkCard() {
    var toggle = document.getElementById("benchmark-toggle");
    var menu = document.getElementById("benchmark-menu");
    var labelEl = document.getElementById("benchmark-label");
    var resultEl = document.getElementById("benchmark-result");
    var statusEl = document.getElementById("benchmark-status");
    var portfolioXirrEl = document.getElementById("benchmark-portfolio-xirr");
    var indexXirrEl = document.getElementById("benchmark-index-xirr");
    var alphaEl = document.getElementById("benchmark-alpha");
    var indexNameEl = document.getElementById("benchmark-index-name");
    var portfolioLabelEl = document.getElementById("benchmark-portfolio-label");
    var subtitleEl = document.getElementById("benchmark-subtitle");
    var modeXirrBtn = document.getElementById("bench-mode-xirr");
    var modeCagrBtn = document.getElementById("bench-mode-cagr");
    if (!toggle || !menu) return;

    var BENCH_KEY = "wf-benchmark-index";
    var BENCH_MODE_KEY = "wf-benchmark-mode";
    var VALID_BENCH_KEYS = { NIFTY50: 1, NIFTYMIDCAP150: 1, NIFTYNEXT50: 1, NIFTY500: 1 };
    var savedKey = localStorage.getItem(BENCH_KEY) || "NIFTY50";
    // Fall back if a previously-selected index (e.g. removed Nifty Smallcap) is no longer available.
    if (!VALID_BENCH_KEYS[savedKey]) { savedKey = "NIFTY50"; localStorage.setItem(BENCH_KEY, savedKey); }
    var _mode = localStorage.getItem(BENCH_MODE_KEY) || "xirr"; // "xirr" | "cagr"
    var BENCH_PERIOD_KEY = "wf-benchmark-period";
    var _period = localStorage.getItem(BENCH_PERIOD_KEY) || "all"; // "all"|"1"|"2"|"3"|"5"|"10"

    var _lastXirrResult = null;
    var _lastCagrResult = null;

    var periodRow = document.querySelector(".bench-period-row");
    function setPeriod(p) {
      _period = p;
      localStorage.setItem(BENCH_PERIOD_KEY, p);
      if (periodRow) {
        periodRow.querySelectorAll(".range-pill").forEach(function (btn) {
          btn.classList.toggle("active", btn.dataset.period === p);
        });
      }
    }

    function fmtRate(val) {
      if (val === null || val === undefined || !isFinite(val)) return "—";
      return (val > 0 ? "+" : "") + (val * 100).toFixed(2) + "%";
    }

    function setMode(mode) {
      _mode = mode;
      localStorage.setItem(BENCH_MODE_KEY, mode);
      if (modeXirrBtn) modeXirrBtn.classList.toggle("active", mode === "xirr");
      if (modeCagrBtn) modeCagrBtn.classList.toggle("active", mode === "cagr");
      var label = mode === "cagr" ? "CAGR" : "XIRR";
      if (subtitleEl) subtitleEl.textContent = mode === "cagr"
        ? "point-to-point CAGR over selected period"
        : "Based on actual investment cash flow dates";
      if (portfolioLabelEl) portfolioLabelEl.textContent = "Portfolio " + label;
    }

    function renderResult(mode, xirrResult, cagrResult) {
      var indexKey = localStorage.getItem(BENCH_KEY) || "NIFTY50";
      var selectedEl = menu.querySelector("[data-value='" + indexKey + "']");
      var indexName = selectedEl ? selectedEl.textContent.trim() : "Index";
      var label = mode === "cagr" ? "CAGR" : "XIRR";
      if (indexNameEl) indexNameEl.textContent = indexName + " " + label;

      var portVal, idxVal;
      if (mode === "cagr") {
        // Portfolio CAGR = Portfolio XIRR (correct money-weighted return for SIP portfolios)
        portVal = xirrResult ? xirrResult.portfolioXirr : null;
        idxVal = cagrResult ? cagrResult.indexCagr : null;
      } else {
        portVal = xirrResult ? xirrResult.portfolioXirr : null;
        idxVal = xirrResult ? xirrResult.indexXirr : null;
      }

      portfolioXirrEl.textContent = fmtRate(portVal);
      portfolioXirrEl.className = "benchmark-col-value " + (portVal != null && isFinite(portVal) ? (portVal > 0 ? "positive" : portVal < 0 ? "negative" : "") : "");

      var idxText = (idxVal != null && isFinite(idxVal)) ? fmtRate(idxVal) : (mode === "xirr" ? "No data — trigger Fetch Stock Prices" : "No data");
      indexXirrEl.textContent = idxText;
      indexXirrEl.className = "benchmark-col-value " + (idxVal != null && isFinite(idxVal) ? (idxVal > 0 ? "positive" : idxVal < 0 ? "negative" : "") : "");

      if (portVal != null && isFinite(portVal) && idxVal != null && isFinite(idxVal)) {
        var alpha = (portVal - idxVal) * 100;
        alphaEl.textContent = (alpha > 0 ? "+" : "") + alpha.toFixed(2) + "%";
        alphaEl.className = "benchmark-col-value " + (alpha > 0 ? "positive" : alpha < 0 ? "negative" : "");
      } else {
        alphaEl.textContent = "—";
        alphaEl.className = "benchmark-col-value";
      }
    }

    var _benchmarkGeneration = 0;

    function applyBenchmark(indexKey) {
      localStorage.setItem(BENCH_KEY, indexKey);
      var options = menu.querySelectorAll("[data-value]");
      options.forEach(function (o) { o.classList.toggle("selected", o.dataset.value === indexKey); });
      var selected = menu.querySelector("[data-value='" + indexKey + "']");
      var indexName = selected ? selected.textContent.trim() : "Index";
      labelEl.textContent = indexName || "Select Index";

      // Notify the rolling-returns card of the current period + index.
      document.dispatchEvent(new CustomEvent("wf-benchmark-changed", { detail: { period: _period, indexKey: indexKey } }));

      _benchmarkGeneration++;
      var gen = _benchmarkGeneration;

      if (!indexKey) {
        resultEl.hidden = true;
        statusEl.hidden = true;
        return;
      }

      _lastXirrResult = null;
      _lastCagrResult = null;
      resultEl.hidden = true;
      statusEl.hidden = false;
      statusEl.textContent = "Calculating…";
      setMode(_mode);

      var periodYears = (_period && _period !== "all") ? parseFloat(_period) : null;
      Promise.all([
        computeBenchmarkXirr(indexKey, periodYears),
        computeBenchmarkCagr(indexKey, periodYears)
      ]).then(function (results) {
        if (gen !== _benchmarkGeneration) return;
        _lastXirrResult = results[0];
        _lastCagrResult = results[1];
        statusEl.hidden = true;
        resultEl.hidden = false;
        renderResult(_mode, _lastXirrResult, _lastCagrResult);
      }).catch(function () {
        if (gen !== _benchmarkGeneration) return;
        statusEl.hidden = false;
        statusEl.textContent = "Could not compute benchmark.";
        resultEl.hidden = true;
      });
    }

    // Dropdown open/close
    toggle.addEventListener("click", function () {
      var isOpen = !menu.hidden;
      menu.hidden = isOpen;
      toggle.setAttribute("aria-expanded", String(!isOpen));
      if (!isOpen) menu.classList.add("open");
      else menu.classList.remove("open");
    });
    document.addEventListener("click", function (e) {
      if (!toggle.contains(e.target) && !menu.contains(e.target)) {
        menu.hidden = true;
        menu.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
    menu.querySelectorAll("[data-value]").forEach(function (opt) {
      opt.addEventListener("click", function () {
        menu.hidden = true;
        menu.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        applyBenchmark(opt.dataset.value);
      });
    });

    // Mode toggle buttons (XIRR / CAGR)
    [modeXirrBtn, modeCagrBtn].forEach(function (btn) {
      if (!btn) return;
      btn.addEventListener("click", function () {
        var newMode = btn.dataset.mode;
        if (newMode === _mode) return;
        setMode(newMode);
        if (!resultEl.hidden && (_lastXirrResult || _lastCagrResult)) {
          renderResult(_mode, _lastXirrResult, _lastCagrResult);
        }
      });
    });

    // Period pill buttons
    if (periodRow) {
      periodRow.querySelectorAll(".range-pill").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var newPeriod = btn.dataset.period;
          if (newPeriod === _period) return;
          setPeriod(newPeriod);
          var currentKey = localStorage.getItem(BENCH_KEY) || "NIFTY50";
          if (currentKey) applyBenchmark(currentKey);
        });
      });
    }

    // Restore saved mode, period and selection
    setMode(_mode);
    setPeriod(_period);
    if (savedKey) applyBenchmark(savedKey);

    // When exclusion changes, updateDashboardStats is async. Wait for the next
    // wf-overview-flows-ready (fired once _ov._overviewBaseFlows is populated)
    // before re-running the benchmark so it has a valid terminal value.
    var _pendingBenchmarkRefresh = false;
    document.addEventListener("wf-exclusion-changed", function () {
      _pendingBenchmarkRefresh = true;
    });
    document.addEventListener("wf-overview-flows-ready", function () {
      var currentKey = localStorage.getItem(BENCH_KEY) || "NIFTY50";
      if (!currentKey) return;
      // Refresh if exclusion changed, or if Portfolio XIRR is still blank (initial load).
      var portfolioBlank = portfolioXirrEl && portfolioXirrEl.textContent === "—";
      if (!_pendingBenchmarkRefresh && !portfolioBlank) return;
      _pendingBenchmarkRefresh = false;
      applyBenchmark(currentKey);
    });
  }

  function buildCommodityHoldingsList(rows, portfolioFilter, goldPricePerGram, historicalPrices) {
    var header = rows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var instrumentIdx = header.indexOf("instrument name");
    var categoryIdx = header.indexOf("instrument category");
    var subCategoryIdx = header.indexOf("instrument sub category");
    var dateIdx = header.indexOf("transaction date");
    var gramsIdx = header.indexOf("grams");
    var maturityIdx = header.indexOf("maturity date/sell date");
    if (portfolioIdx === -1 || instrumentIdx === -1 || gramsIdx === -1) return null;

    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var holdings = [];
    rows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && normalizeText(portfolio) !== normalizeText(portfolioFilter)) return;
      if (categoryIdx !== -1 && normalizeText(row[categoryIdx]) !== "commodity") return;
      var instrument = (row[instrumentIdx] || "").trim();
      if (!instrument) return;
      var category = categoryIdx !== -1 ? (row[categoryIdx] || "").trim() : "";
      var subCategory = subCategoryIdx !== -1 ? (row[subCategoryIdx] || "").trim() : "";
      var grams = parseNumber(row[gramsIdx]);
      var dateStr = dateIdx !== -1 ? formatDateISO(parseFlexibleDate(row[dateIdx])) : null;

      var sellDateParsed = maturityIdx !== -1 ? parseFlexibleDate(row[maturityIdx]) : null;
      var sellDateStr = sellDateParsed ? formatDateISO(sellDateParsed) : null;
      var sellDay = sellDateParsed ? new Date(sellDateParsed.getFullYear(), sellDateParsed.getMonth(), sellDateParsed.getDate()) : null;
      var isSold = !!(sellDay && today > sellDay);

      var buyPrice = dateStr && historicalPrices && historicalPrices[dateStr];
      var sellPrice = sellDateStr && historicalPrices && historicalPrices[sellDateStr];

      var invested, current, realizedProfit;
      if (isSold) {
        invested = 0;
        current = 0;
        realizedProfit = (buyPrice && sellPrice && grams > 0) ? (sellPrice - buyPrice) * grams : 0;
      } else {
        invested = (buyPrice && grams > 0) ? grams * buyPrice : 0;
        current = (goldPricePerGram && grams > 0) ? grams * goldPricePerGram : invested;
        realizedProfit = 0;
      }

      holdings.push({ portfolio: portfolio, bank: category, instrument: instrument, subCategory: subCategory,
        invested: invested, current: current, grams: isSold ? 0 : grams,
        dateStr: dateStr, sellDateStr: sellDateStr, isSold: isSold, realizedProfit: realizedProfit });
    });
    return holdings;
  }

  function renderCommodityHoldingsTable() {
    var statusEl = document.getElementById("commodity-holdings-status");
    var tableWrap = document.getElementById("commodity-holdings-table-wrap");
    var tbody = document.getElementById("commodity-holdings-tbody");
    if (!statusEl || !tableWrap || !tbody) return;

    var rows = getSheetRows("fd");
    if (!rows || !rows.length) {
      statusEl.textContent = "Connect your Fixed Income/Commodity sheet in Settings to populate this view.";
      tableWrap.hidden = true;
      return;
    }

    var selectedPortfolio = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
    statusEl.textContent = "Fetching gold prices…";

    // Collect unique buy + sell dates from commodity rows to fetch historical prices
    var uniqueDates = collectCommodityUniqueDates(rows, selectedPortfolio);

    Promise.all([
      fetchGoldPriceINRPerGram().catch(function () { return null; }),
      fetchGoldDayChangeINRPerGram().catch(function () { return null; }),
      Promise.all(uniqueDates.map(function (dateStr) {
        return fetchXauInrForDate(dateStr).then(function (price) { return { dateStr: dateStr, price: price }; }).catch(function (e) { return { dateStr: dateStr, price: null }; });
      }))
    ]).then(function (results) {
      var goldPrice = results[0];
      var goldDayChangePerGram = results[1];
      var historicalPrices = {};
      results[2].forEach(function (r) { if (r.price) historicalPrices[r.dateStr] = r.price; });

      var allHoldings = buildCommodityHoldingsList(rows, selectedPortfolio, goldPrice, historicalPrices);
      console.log("[Commodity] holdings:", allHoldings);
      if (allHoldings === null) {
        statusEl.textContent = "Header row number is incorrect. Make adjustments by adding correct header row number.";
        tableWrap.hidden = true;
        return;
      }
      // Only show active (unsold) holdings in the table
      var holdings = allHoldings.filter(function (h) { return !h.isSold; });
      if (!holdings.length) {
        statusEl.textContent = "No Physical Commodity holdings found.";
        tableWrap.hidden = true;
        return;
      }

      tbody.innerHTML = "";
      holdings.forEach(function (h) {
      var tr = document.createElement("tr");

        var portfolioTd = document.createElement("td");
        portfolioTd.className = "col-desktop-only";
        portfolioTd.textContent = h.portfolio;
        tr.appendChild(portfolioTd);

        var subCategoryTd = document.createElement("td");
        subCategoryTd.className = "col-desktop-only";
        subCategoryTd.textContent = h.subCategory;
        tr.appendChild(subCategoryTd);

        var goldRateTd = document.createElement("td");
        goldRateTd.className = "num col-desktop-only";
        goldRateTd.textContent = goldPrice ? "₹" + Math.round(goldPrice).toLocaleString("en-IN") : "—";
        tr.appendChild(goldRateTd);

        var gmsTd = document.createElement("td");
        gmsTd.className = "num col-desktop-only";
        gmsTd.textContent = h.grams > 0 ? h.grams.toLocaleString("en-IN") : "—";
        tr.appendChild(gmsTd);

        var investedTd = document.createElement("td");
        investedTd.className = "num";
        investedTd.textContent = formatCurrency(h.invested);
        tr.appendChild(investedTd);

        var currentTd = document.createElement("td");
        currentTd.className = "num";
        currentTd.textContent = formatCurrency(h.current);
        tr.appendChild(currentTd);

        var dayChange = (goldDayChangePerGram !== null && goldDayChangePerGram !== undefined && h.grams > 0) ? goldDayChangePerGram * h.grams : null;
        var dayChangeTd = document.createElement("td");
        dayChangeTd.className = "num " + (dayChange > 0 ? "positive" : dayChange < 0 ? "negative" : "");
        dayChangeTd.textContent = dayChange !== null ? (dayChange > 0 ? "+" : "") + formatCurrency(dayChange) : "—";
        tr.appendChild(dayChangeTd);

        var unrealized = h.current - h.invested;
        var unrealizedTd = document.createElement("td");
        unrealizedTd.className = "num " + (unrealized > 0 ? "positive" : unrealized < 0 ? "negative" : "");
        unrealizedTd.textContent = (unrealized > 0 ? "+" : "") + formatCurrency(unrealized);
        tr.appendChild(unrealizedTd);

        var returnPct = h.invested > 0 ? (unrealized / h.invested) * 100 : 0;
        var returnTd = document.createElement("td");
        returnTd.className = "num " + (returnPct > 0 ? "positive" : returnPct < 0 ? "negative" : "");
        returnTd.textContent = (returnPct > 0 ? "+" : "") + returnPct.toFixed(2) + "%";
        tr.appendChild(returnTd);

        tbody.appendChild(tr);
      });

      var rateDate = goldPrice ? (function () {
        try {
          var cached = JSON.parse(localStorage.getItem(GOLD_PRICE_CACHE_KEY));
          if (cached && cached.fetchedAt) {
            var d = new Date(cached.fetchedAt);
            return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
          }
        } catch (e) {}
        return new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
      })() : null;
      statusEl.textContent = holdings.length + " holding(s)." + (rateDate ? " Gold rate as of " + rateDate + "." : "");
      tableWrap.hidden = false;
    });
  }

  // Cash flows for EPF XIRR: each Deposit is money out (negative). Interest rows are
  // excluded — they're accrued growth already reflected in the terminal balance, not
  // an external contribution. A terminal positive cash flow (current EPF balance) is
  // appended by the caller.
  function buildEpfXirrCashFlows(rows, portfolioFilter) {
    if (!rows || !rows.length) return [];
    var header = rows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var typeIdx = header.indexOf("transaction type");
    var amountIdx = header.indexOf("amount");
    var categoryIdx = header.indexOf("instrument category");
    var dateIdx = header.indexOf("transaction date");
    if (portfolioIdx === -1 || typeIdx === -1 || amountIdx === -1 || dateIdx === -1) return [];

    var flows = [];
    rows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && portfolio.toLowerCase() !== portfolioFilter.toLowerCase()) return;
      if (categoryIdx !== -1 && normalizeText(row[categoryIdx]) !== "fixed income") return;
      var type = normalizeText(row[typeIdx]);
      if (type.indexOf("deposit") === -1) return;

      var amount = parseNumber(row[amountIdx]);
      var date = parseFlexibleDate(row[dateIdx]);
      if (!date || !amount) return;
      flows.push({ date: date, amount: -amount });
    });
    return flows;
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

  function setDayChange(el, dayChange) {
    if (!el) return;
    var cls = dayChange > 0 ? "positive" : (dayChange < 0 ? "negative" : "");
    el.textContent = (dayChange > 0 ? "+" : "") + formatCurrency(dayChange);
    el.classList.remove("positive", "negative");
    if (cls) el.classList.add(cls);
  }

  function previous_nav_for(navHistory) {
    if (!navHistory || navHistory.length < 2) return null;
    return navHistory[navHistory.length - 2].nav;
  }

  // Returns all unique dates (buy + sell) for commodity rows — used to batch-fetch historical prices.
  function collectCommodityUniqueDates(fdRows, portfolioFilter) {
    if (!fdRows || !fdRows.length) return [];
    var header = fdRows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var categoryIdx = header.indexOf("instrument category");
    var dateIdx = header.indexOf("transaction date");
    var maturityIdx = header.indexOf("maturity date/sell date");
    var dates = [];
    fdRows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && normalizeText(portfolio) !== normalizeText(portfolioFilter)) return;
      if (categoryIdx !== -1 && normalizeText(row[categoryIdx]) !== "commodity") return;
      var buyDate = dateIdx !== -1 ? formatDateISO(parseFlexibleDate(row[dateIdx])) : null;
      if (buyDate && dates.indexOf(buyDate) === -1) dates.push(buyDate);
      var sellDate = maturityIdx !== -1 ? formatDateISO(parseFlexibleDate(row[maturityIdx])) : null;
      if (sellDate && dates.indexOf(sellDate) === -1) dates.push(sellDate);
    });
    return dates;
  }

  function getTotalCommodityGrams(fdRows, portfolioFilter) {
    if (!fdRows || !fdRows.length) return 0;
    var header = fdRows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var categoryIdx = header.indexOf("instrument category");
    var gramsIdx = header.indexOf("grams");
    var maturityIdx = header.indexOf("maturity date/sell date");
    if (gramsIdx === -1) return 0;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var total = 0;
    fdRows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && normalizeText(portfolio) !== normalizeText(portfolioFilter)) return;
      if (categoryIdx !== -1 && normalizeText(row[categoryIdx]) !== "commodity") return;
      var sellDate = maturityIdx !== -1 ? parseFlexibleDate(row[maturityIdx]) : null;
      if (sellDate) { var sd = new Date(sellDate.getFullYear(), sellDate.getMonth(), sellDate.getDate()); if (today > sd) return; }
      total += parseNumber(row[gramsIdx]);
    });
    return total;
  }

  function fetchCommodityDayChange(fdRows, portfolioFilter) {
    var grams = getTotalCommodityGrams(fdRows, portfolioFilter);
    if (!grams) return Promise.resolve(0);
    return fetchGoldDayChangeINRPerGram()
      .then(function (changePerGram) { return changePerGram * grams; })
      .catch(function () { return 0; });
  }

  function updateTotalCurrentValue() {
    var equityEl = document.getElementById("equity-total-current-value");
    var equityReturnEl = document.getElementById("equity-unrealized-return");
    var equityPctEl = document.getElementById("equity-return-pct");
    var overviewXirrEl = document.getElementById("overview-xirr");
    var equityXirrEl = document.getElementById("equity-xirr");
    var overviewDayChangeEl = document.getElementById("overview-day-change");
    var equityDayChangeEl = document.getElementById("equity-day-change");
    if (!equityEl && !equityReturnEl && !overviewXirrEl && !equityXirrEl && !overviewDayChangeEl && !equityDayChangeEl) return;

    var selected = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
    var unitEvents = buildInstrumentUnitEvents(selected);
    var equityRows = getSheetRows("equity");
    var transactionsByInstrumentForInvestment = groupUnitTransactionsByInstrument(equityRows, selected) || {};

    function overviewXirrCashFlows(equityFlows, goldPrice, commodityFlows) {
      var flows = equityFlows.slice();
      if (!isFixedIncomeExcluded()) {
        var fdRows = getSheetRows("fd");
        // Savings/Investment Holding (Investment Corpus/Savings Account) is always excluded
        // from XIRR — its running-balance updates aren't real cash-flow events.
        var pfCurrentValue = fdRows ? sumProvidentFundCurrentValue(fdRows, selected) : 0;
        var fixedIncomeCurrentValue = (fdRows ? sumFdMaturedCurrentValue(fdRows, selected) : 0) + pfCurrentValue;
        flows = flows
          .concat(fdRows ? buildFdMaturedXirrCashFlows(fdRows, selected) : [])
          .concat(fdRows ? buildProvidentFundXirrCashFlows(fdRows, selected) : []);
        if (fixedIncomeCurrentValue > 0) flows.push({ date: new Date(), amount: fixedIncomeCurrentValue });
      }
      // Commodity is always included in XIRR regardless of Fixed Income exclusion
      if (commodityFlows && commodityFlows.length) flows = flows.concat(commodityFlows);
      return flows;
    }

    var loadingMsg = "Fetching AMFI NAV data… this can take up to 30s the first time.";
    if (equityEl) { equityEl.textContent = "…"; equityEl.title = loadingMsg; }
    if (equityReturnEl) equityReturnEl.textContent = "…";
    if (equityPctEl) equityPctEl.textContent = "…";
    if (overviewXirrEl) overviewXirrEl.textContent = "…";
    if (equityXirrEl) equityXirrEl.textContent = "…";
    if (overviewDayChangeEl) overviewDayChangeEl.textContent = "…";
    if (equityDayChangeEl) equityDayChangeEl.textContent = "…";

    function investedCostFor(instrumentNames) {
      var total = 0;
      instrumentNames.forEach(function (name) {
        var txns = transactionsByInstrumentForInvestment[name];
        if (!txns) return;
        fifoRemainingLots(txns).forEach(function (lot) { total += lot.units * lot.price; });
      });
      return total;
    }

    // Fetch gold price upfront so commodity profit/XIRR flow into overview stats
    var fdRowsForOverview = getSheetRows("fd");
    var commodityProfitPromise = (function () {
      if (!fdRowsForOverview || !fdRowsForOverview.length) return Promise.resolve({ profit: 0, flows: [] });
      var uniqueDatesOv = collectCommodityUniqueDates(fdRowsForOverview, selected);
      return Promise.all([
        fetchGoldPriceINRPerGram().catch(function () { return null; }),
        Promise.all(uniqueDatesOv.map(function (d) {
          return fetchXauInrForDate(d).then(function (p) { return { dateStr: d, price: p }; }).catch(function () { return { dateStr: d, price: null }; });
        }))
      ]).then(function (res) {
        var goldPrice = res[0];
        if (!goldPrice) return { profit: 0, flows: [] };
        var histPrices = {};
        res[1].forEach(function (r) { if (r.price) histPrices[r.dateStr] = r.price; });
        var fullHoldings = buildCommodityHoldingsList(fdRowsForOverview, selected, goldPrice, histPrices) || [];
        var profit = 0;
        fullHoldings.forEach(function (h) { profit += h.current - h.invested; });
        return buildCommodityXirrCashFlows(fdRowsForOverview, selected, goldPrice).then(function (flows) {
          return { profit: profit, flows: flows };
        });
      });
    })();

    Promise.all([buildInstrumentSchemeMap(), commodityProfitPromise]).then(function (results) {
      var schemeMap = results[0];
      var commodityData = results[1];
      var commodityProfit = commodityData.profit;
      var commodityFlows = commodityData.flows;

      var instruments = Object.keys(unitEvents).filter(function (name) { return !!lookupSchemeCode(schemeMap, name); });
      console.log("[NAV] instruments held:", Object.keys(unitEvents), "resolved scheme codes:", instruments.map(function (name) { return name + " -> " + lookupSchemeCode(schemeMap, name); }));
      if (!instruments.length) {
        var reason = !Object.keys(unitEvents).length
          ? "No equity holdings found in the synced Mutual Fund Transactions sheet" + (lastUnitEventsDiagnostic ? " (" + lastUnitEventsDiagnostic + ")" : "") + "."
          : !Object.keys(schemeMap).length
          ? "Could not resolve any Instrument Name to a Scheme Code via the Mutual Fund Mapping sheet / AMFI." + (lastSchemeMapDiagnostic ? " (" + lastSchemeMapDiagnostic + ")" : "")
          : "None of your equity instruments matched a resolved Scheme Code.";
        if (equityEl) { equityEl.textContent = formatCurrency(0); equityEl.title = reason; }
        _ov.mfCurrent = 0; _ov.mfUnrealized = 0;
        refreshOverviewStats(); refreshCategoryCards();
        setUnrealizedReturn(equityReturnEl, equityPctEl, 0, 0);
        var xirrCashFlows = buildXirrCashFlows(equityRows, selected);
        var xirrNoValue = calculateXIRR(xirrCashFlows);
        var ovBaseFlows = overviewXirrCashFlows(xirrCashFlows, null, commodityFlows);
        _ov._overviewBaseFlows = ovBaseFlows;
        setXirr(overviewXirrEl, calculateXIRR(ovBaseFlows.concat(_ov.seXirrFlows)));
        setXirr(equityXirrEl, xirrNoValue);
        setDayChange(equityDayChangeEl, 0);
        document.dispatchEvent(new CustomEvent("wf-overview-flows-ready"));
        fetchCommodityDayChange(fdRowsForOverview, selected).then(function (commodityDayChange) {
          _ov._mfCommDayChange = commodityDayChange;
          setDayChange(overviewDayChangeEl, commodityDayChange + _ov.seDayChange);
        });
        return;
      }

      return Promise.all(instruments.map(function (name) { return fetchNavHistory(lookupSchemeCode(schemeMap, name)); }))
        .then(function (navHistories) {
          var total = 0;
          var yesterdayTotal = 0;
          var heldInstruments = [];
          instruments.forEach(function (name, i) {
            var navHistory = navHistories[i];
            var events = unitEvents[name];
            var units = events.length ? events[events.length - 1].cumulativeUnits : 0;
            var nav = latest_nav_for(navHistory);
            var prevNav = previous_nav_for(navHistory);
            if (units > UNITS_EPSILON && nav) { total += units * nav; heldInstruments.push(name); }
            if (units > UNITS_EPSILON && prevNav) yesterdayTotal += units * prevNav;
          });
          var investment = investedCostFor(heldInstruments);
          var unrealizedProfit = total - investment;
          if (equityEl) equityEl.textContent = formatCurrency(total);
          setUnrealizedReturn(equityReturnEl, equityPctEl, total, investment);
          _ov.mfCurrent = total; _ov.mfUnrealized = unrealizedProfit;
          refreshOverviewStats(); refreshCategoryCards();
          var equityDayChange = total - yesterdayTotal;
          setDayChange(equityDayChangeEl, equityDayChange);
          fetchCommodityDayChange(fdRowsForOverview, selected).then(function (commodityDayChange) {
            _ov._mfCommDayChange = equityDayChange + commodityDayChange;
            setDayChange(overviewDayChangeEl, _ov._mfCommDayChange + _ov.seDayChange);
          });

          var xirrCashFlows = buildXirrCashFlows(equityRows, selected);
          if (total > UNITS_EPSILON) xirrCashFlows.push({ date: new Date(), amount: total });
          var xirr = calculateXIRR(xirrCashFlows);
          var ovBaseFlows2 = overviewXirrCashFlows(xirrCashFlows, null, commodityFlows);
          _ov._overviewBaseFlows = ovBaseFlows2;
          setXirr(overviewXirrEl, calculateXIRR(ovBaseFlows2.concat(_ov.seXirrFlows)));
          setXirr(equityXirrEl, xirr);
          document.dispatchEvent(new CustomEvent("wf-overview-flows-ready"));
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
    var names = collectPortfolioNamesFromSheets(["equity", "stocksetf", "fixedincome", "fd"]);
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

  var exclusionsToggle = document.getElementById("exclusions-toggle");
  var exclusionsMenu = document.getElementById("exclusions-menu");
  var exclusionsLabel = document.getElementById("exclusions-label");
  var excludeFixedIncomeToggle = document.getElementById("exclude-fixedincome-toggle");
  var excludeSavingsInvestmentToggle = document.getElementById("exclude-savings-investment-toggle");
  var exclusionsReset = document.getElementById("exclusions-reset");

  function closeExclusionsMenu() {
    if (!exclusionsMenu) return;
    exclusionsMenu.classList.remove("open");
    if (exclusionsToggle) exclusionsToggle.setAttribute("aria-expanded", "false");
  }

  function openExclusionsMenu() {
    if (!exclusionsMenu) return;
    exclusionsMenu.hidden = false;
    exclusionsMenu.classList.add("open");
    if (exclusionsToggle) exclusionsToggle.setAttribute("aria-expanded", "true");
  }

  function syncExclusionOptionState() {
    var fixedIncomeOn = isFixedIncomeExcluded();
    var savingsInvestmentOn = isSavingsInvestmentExcluded();
    if (excludeFixedIncomeToggle) {
      excludeFixedIncomeToggle.classList.toggle("selected", fixedIncomeOn);
      excludeFixedIncomeToggle.setAttribute("aria-selected", fixedIncomeOn ? "true" : "false");
    }
    if (excludeSavingsInvestmentToggle) {
      excludeSavingsInvestmentToggle.classList.toggle("selected", savingsInvestmentOn);
      excludeSavingsInvestmentToggle.setAttribute("aria-selected", savingsInvestmentOn ? "true" : "false");
    }
    if (exclusionsReset) {
      exclusionsReset.classList.toggle("selected", !fixedIncomeOn && !savingsInvestmentOn);
      exclusionsReset.setAttribute("aria-selected", !fixedIncomeOn && !savingsInvestmentOn ? "true" : "false");
    }
    if (exclusionsLabel) {
      exclusionsLabel.textContent = fixedIncomeOn
        ? (excludeFixedIncomeToggle ? excludeFixedIncomeToggle.textContent : "Exclusions")
        : savingsInvestmentOn
        ? (excludeSavingsInvestmentToggle ? excludeSavingsInvestmentToggle.textContent : "Exclusions")
        : "No Exclusion";
    }
  }

  function applyExclusion(key, otherKey) {
    var nowExcluded = localStorage.getItem(key) !== "true";
    localStorage.setItem(key, nowExcluded ? "true" : "false");
    if (nowExcluded) localStorage.setItem(otherKey, "false");
    syncExclusionOptionState();
    updateDashboardStats();
    renderValueChart();
    renderInvestmentSplitChart();
    renderInstrumentSplitChart();
    document.dispatchEvent(new CustomEvent("wf-exclusion-changed"));
  }

  if (excludeFixedIncomeToggle) {
    excludeFixedIncomeToggle.addEventListener("click", function () {
      applyExclusion(EXCLUDE_FIXED_INCOME_KEY, EXCLUDE_SAVINGS_INVESTMENT_KEY);
      closeExclusionsMenu();
    });
  }

  if (excludeSavingsInvestmentToggle) {
    excludeSavingsInvestmentToggle.addEventListener("click", function () {
      applyExclusion(EXCLUDE_SAVINGS_INVESTMENT_KEY, EXCLUDE_FIXED_INCOME_KEY);
      closeExclusionsMenu();
    });
  }

  if (exclusionsReset) {
    exclusionsReset.addEventListener("click", function () {
      localStorage.setItem(EXCLUDE_FIXED_INCOME_KEY, "false");
      localStorage.setItem(EXCLUDE_SAVINGS_INVESTMENT_KEY, "false");
      syncExclusionOptionState();
      updateDashboardStats();
      renderValueChart();
      renderInvestmentSplitChart();
      renderInstrumentSplitChart();
      document.dispatchEvent(new CustomEvent("wf-exclusion-changed"));
      closeExclusionsMenu();
    });
  }

  syncExclusionOptionState();

  if (exclusionsToggle && exclusionsMenu) {
    exclusionsToggle.addEventListener("click", function (e) {
      e.stopPropagation();
      if (!exclusionsMenu.classList.contains("open")) openExclusionsMenu();
      else closeExclusionsMenu();
    });

    document.addEventListener("click", function (e) {
      if (exclusionsMenu.classList.contains("open") && !exclusionsMenu.contains(e.target) && e.target !== exclusionsToggle) {
        closeExclusionsMenu();
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && exclusionsMenu.classList.contains("open")) {
        closeExclusionsMenu();
        exclusionsToggle.focus();
      }
    });
  }

  updateDashboardStats();
  renderValueChart();
  renderEquityHoldingsTable();
  renderAllFixedIncomeHoldingsTable();
  renderInvestmentSplitChart();
  renderInstrumentSplitChart();

  var equityHoldingsShowClosedOnly = document.getElementById("equity-holdings-show-closed-only");
  if (equityHoldingsShowClosedOnly) equityHoldingsShowClosedOnly.addEventListener("change", renderEquityHoldingsTable);

  var stocksetfShowClosed = document.getElementById("stocksetf-show-closed");
  if (stocksetfShowClosed) stocksetfShowClosed.addEventListener("change", renderStockEtfHoldingsTable);
  var stocksetfUsShowClosed = document.getElementById("stocksetf-us-show-closed");
  if (stocksetfUsShowClosed) stocksetfUsShowClosed.addEventListener("change", renderStockEtfHoldingsTable);

  ["equity", "fixedincome", "fd", "stocksetf"].forEach(function (prefix) {
    var refreshBtn = document.getElementById(prefix + "-refresh");
    updateRefreshButtonStatus(prefix);
    if (!refreshBtn) return;

    refreshBtn.addEventListener("click", function () {
      var configs = loadSheetConfigs(prefix);
      if (!configs.length) return;
      var canonicalFields = prefix === "fixedincome" ? FIXED_INCOME_SHEET_FIELDS : prefix === "fd" ? FD_SHEET_FIELDS : TRANSACTION_SHEET_FIELDS;
      refreshBtn.classList.add("spinning");
      fetchAndMergeSheets(configs, function (merged) {
        refreshBtn.classList.remove("spinning");
        if (merged && merged.length > 1) {
          addPortfolioNames(extractColumnValues(merged, "Portfolio Name"));
          localStorage.setItem("wf-" + prefix + "-data", JSON.stringify(merged));
          document.dispatchEvent(new CustomEvent("wf-sync-complete"));
        }
        updateDashboardStats();
        updateRefreshButtonStatus(prefix);
        populatePortfolioSelect();
        if (prefix === "equity") { renderValueChart(); renderMonthlyInvestmentByCategory(); renderEquityHoldingsTable(); renderMarketSegmentChart(); renderMutualFundPortfolioSplitChart(); }
        if (prefix === "fixedincome") { renderValueChart(); renderMonthlyInvestmentByCategory(); renderAllFixedIncomeHoldingsTable(); }
        if (prefix === "fd") { renderValueChart(); renderMonthlyInvestmentByCategory(); renderAllFixedIncomeHoldingsTable(); renderCommodityHoldingsTable(); }
        if (prefix === "stocksetf" || prefix === "stocksetfmapping") { renderMonthlyInvestmentByCategory(); renderStockEtfHoldingsTable(); }
        renderInvestmentSplitChart();
        renderInstrumentSplitChart();
        renderMonthlyCashFlow();
      }, canonicalFields);
    });
  });

  var equityRefreshNavBtn = document.getElementById("equity-refresh-nav");
  if (equityRefreshNavBtn) {
    equityRefreshNavBtn.addEventListener("click", function () {
      var originalLabel = equityRefreshNavBtn.textContent;
      equityRefreshNavBtn.disabled = true;
      equityRefreshNavBtn.textContent = "Triggering…";

      // Clear locally cached NAV/ISIN data
      Object.keys(localStorage).forEach(function (key) {
        if (key.indexOf(NAV_CACHE_PREFIX) === 0) localStorage.removeItem(key);
      });
      localStorage.removeItem(AMFI_ISIN_MAP_CACHE_KEY);
      localStorage.removeItem(AMFI_NAV_MAP_CACHE_KEY);

      // Trigger AMFI NAV and ISIN Map workflows via GitHub API if credentials are saved
      var gh = loadGhSettings();
      if (gh.owner && gh.repo && gh.token) {
        var apiBase = "https://api.github.com/repos/" + gh.owner + "/" + gh.repo + "/actions/workflows/";
        var headers = { "Authorization": "Bearer " + gh.token, "Accept": "application/vnd.github+json", "Content-Type": "application/json" };
        var branch = gh.branch || "main";
        var body = JSON.stringify({ ref: branch });
        ["update-amfi-nav.yml", "update-amfi-isin-map.yml"].forEach(function (wf) {
          fetch(apiBase + wf + "/dispatches", { method: "POST", headers: headers, body: body })
            .catch(function () {}); // silent — workflows run in background
        });
        equityRefreshNavBtn.textContent = "Triggered ✓";
      } else {
        equityRefreshNavBtn.textContent = "Refreshing…";
      }

      updateDashboardStats();
      renderValueChart();
      renderEquityHoldingsTable();
      renderMarketSegmentChart();
      renderMutualFundPortfolioSplitChart();
      renderInvestmentSplitChart();
      renderInstrumentSplitChart();
      setTimeout(function () {
        equityRefreshNavBtn.disabled = false;
        equityRefreshNavBtn.textContent = originalLabel;
      }, 2000);
    });
  }

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
    if (!url || !/docs\.google\.com\/spreadsheets/i.test(url)) return null;
    var idMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!idMatch) return null;
    var gidMatch = url.match(/[#&?]gid=([0-9]+)/);
    return { id: idMatch[1], gid: gidMatch ? gidMatch[1] : "0" };
  }

  function detectSheetUrlType(url) {
    if (!url) return null;
    if (/docs\.google\.com\/spreadsheets/i.test(url)) return "google";
    if (/drive\.google\.com/i.test(url)) return "gdrive";
    if (/1drv\.ms|onedrive\.live\.com/i.test(url)) return "onedrive";
    if (/sharepoint\.com/i.test(url)) return "sharepoint";
    if (/\.csv(\?|#|$)/i.test(url) || /[?&]format=csv/i.test(url) || /export=csv/i.test(url)) return "csv";
    return null;
  }

  function toCsvFetchUrl(url, type) {
    if (type === "gdrive") {
      // Google Drive file shared as "anyone with link" — export as CSV
      var idMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/) || url.match(/[?&]id=([a-zA-Z0-9-_]+)/);
      if (!idMatch) return null;
      return "https://drive.google.com/uc?export=csv&id=" + idMatch[1];
    }
    if (type === "onedrive") {
      // OneDrive personal share link → anonymous sharing API with CSV format
      try {
        var b64 = btoa(url).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
        return "https://api.onedrive.com/v1.0/shares/u!" + b64 + "/root/content?format=csv";
      } catch (e) { return null; }
    }
    if (type === "sharepoint") {
      // SharePoint file — append download=1 to get the file; may need manual CSV export
      return url.replace(/\?.*$/, "") + "?download=1";
    }
    if (type === "csv") return url;
    return null;
  }

  function parseCSVText(text) {
    var rows = [];
    var lines = text.split(/\r?\n/);
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      if (!line.trim()) continue;
      var row = [];
      var inQuote = false;
      var cell = "";
      for (var ci = 0; ci < line.length; ci++) {
        var ch = line[ci];
        if (ch === '"') {
          if (inQuote && line[ci + 1] === '"') { cell += '"'; ci++; }
          else inQuote = !inQuote;
        } else if (ch === "," && !inQuote) {
          row.push(cell.trim()); cell = "";
        } else {
          cell += ch;
        }
      }
      row.push(cell.trim());
      rows.push(row);
    }
    return rows;
  }

  function parseLocalFile(file, headerRow, onRows, onError) {
    var reader = new FileReader();
    reader.onerror = function () { onError("Could not read file."); };
    reader.onload = function (e) {
      try {
        if (typeof XLSX === "undefined") { onError("Excel parser not loaded. Please refresh the page."); return; }
        var data = new Uint8Array(e.target.result);
        var wb = XLSX.read(data, { type: "array", cellDates: true, dateNF: "yyyy-mm-dd" });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false, dateNF: "yyyy-mm-dd" });
        // Remove empty trailing rows
        while (allRows.length && allRows[allRows.length - 1].every(function (c) { return !c; })) allRows.pop();
        var startRow = Math.max(1, parseInt(headerRow, 10) || 1) - 1;
        var rows = allRows.slice(startRow);
        if (!rows.length) { onError("The file appears to be empty."); return; }
        // Normalise all values to strings
        rows = rows.map(function (r) { return r.map(function (c) { return c == null ? "" : String(c); }); });
        onRows(rows);
      } catch (err) {
        onError(err.message || "Parse error.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function fetchSheetData(config, onRows, onError) {
    var url = (config.link || "").trim();
    var headerRow = parseInt(config.headerRow, 10) || 1;
    var type = detectSheetUrlType(url);

    if (type === "google") {
      var parsed = parseSheetUrl(url);
      if (!parsed) { onError("query"); return; }
      fetchSheetJSONP(parsed.id, parsed.gid, function (data) {
        onRows(gvizRowsFromResponse(data));
      }, onError, headerRow);
      return;
    }

    // OneDrive/SharePoint blocks cross-origin requests from browsers (no CORS headers).
    // Guide the user to a workaround instead of waiting for a timeout.
    if (type === "onedrive" || type === "sharepoint") {
      onError("onedrive_cors");
      return;
    }

    var csvUrl = type ? toCsvFetchUrl(url, type) : null;
    if (!csvUrl) { onError("query"); return; }

    fetch(csvUrl)
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then(function (text) {
        var allRows = parseCSVText(text);
        var rows = headerRow > 1 ? allRows.slice(headerRow - 1) : allRows;
        if (!rows.length) { onError("empty"); return; }
        onRows(rows);
      })
      .catch(function (err) {
        onError(err.message && err.message.indexOf("403") !== -1 ? "private" : "timeout");
      });
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
      return "This file appears to be private. For Google Sheets: Share → Anyone with the link can view. For OneDrive/Excel: Share → Anyone with the link. Then sync again.";
    }
    if (reason === "timeout") {
      return "Couldn't reach the file (request timed out). Check your internet connection and the link, then try again.";
    }
    if (reason === "empty") {
      return "The file appears to be empty.";
    }
    if (reason === "onedrive_cors") {
      return "OneDrive/SharePoint links can’t be loaded directly due to browser security restrictions. Easiest fix: upload your Excel file to Google Drive (drive.google.com), share it as “Anyone with the link”, then paste the Google Drive link here — it will be fetched and converted automatically.";
    }
    return "Couldn't load the file. Check the link and make sure it is shared publicly (anyone with the link can view).";
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
      var valid = (c.localData && c.localData.length > 1) || (c.link && detectSheetUrlType(c.link));
      return { link: c.link, rowCount: 0, error: valid ? null : "query" };
    });
    var validIndexes = [];
    configs.forEach(function (c, i) {
      var valid = (c.localData && c.localData.length > 1) || (c.link && detectSheetUrlType(c.link));
      if (valid) validIndexes.push(i);
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
      // Use pre-parsed local file data if available
      if (config.localData && config.localData.length > 1) {
        resultsByIndex[i] = config.localData;
        perSheetStats[origIndex].rowCount = Math.max(config.localData.length - 1, 0);
        pending -= 1;
        if (pending <= 0) finish();
        return;
      }
      fetchSheetData(
        config,
        function (rows) {
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
        }
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

  function initSheetCard(prefix, options, afterSync) {
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
    var fileInput = document.getElementById(prefix + "-file-input");
    var uploadBtn = document.getElementById(prefix + "-upload-btn");
    var storageKey = "wf-" + prefix + "-sheet-link";
    var headerRowKey = "wf-" + prefix + "-header-row";
    var localDataKey = "wf-" + prefix + "-local-data";
    var _localData = null;

    // Restore local data from localStorage if previously uploaded
    try {
      var saved = localStorage.getItem(localDataKey);
      if (saved) _localData = JSON.parse(saved);
    } catch (e) {}

    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener("click", function () { fileInput.click(); });
      fileInput.addEventListener("change", function () {
        var file = fileInput.files[0];
        if (!file) return;
        var headerRow = headerRowInput ? headerRowInput.value : "1";
        parseLocalFile(file, headerRow, function (rows) {
          _localData = rows;
          try { localStorage.setItem(localDataKey, JSON.stringify(rows)); } catch (e) {}
          sheetLinkInput.value = "📎 " + file.name;
          localStorage.setItem(storageKey, sheetLinkInput.value);
          syncWithLocalData(rows);
        }, function (err) {
          setStatus("Could not read file: " + err, true);
        });
        fileInput.value = "";
      });
    }

    // Inject toggle button directly before the table wrap (scoped per-card)
    var tableToggleEl = document.createElement("button");
    tableToggleEl.type = "button";
    tableToggleEl.className = "btn btn-ghost btn-sm sheet-table-toggle";
    tableToggleEl.style.marginTop = "10px";
    tableToggleEl.hidden = true;
    tableToggleEl.textContent = "View Entries";
    sheetTableWrap.parentNode.insertBefore(tableToggleEl, sheetTableWrap);
    tableToggleEl.addEventListener("click", function () {
      var expanded = sheetTableWrap.getAttribute("data-expanded") === "true";
      setTableExpanded(!expanded);
    });

    function setTableExpanded(expanded) {
      sheetTableWrap.setAttribute("data-expanded", expanded ? "true" : "false");
      var tbody = sheetTable.querySelector("tbody");
      if (!tbody) return;
      var total = tbody.querySelectorAll("tr").length;
      if (expanded) {
        sheetTableWrap.hidden = false;
        sheetTableWrap.style.maxHeight = "252px"; // ~5 rows visible, scroll for rest
        sheetTableWrap.style.overflowY = total > 5 ? "auto" : "";
        tableToggleEl.textContent = "Hide Entries";
      } else {
        sheetTableWrap.hidden = true;
        sheetTableWrap.style.maxHeight = "";
        sheetTableWrap.style.overflowY = "";
        tableToggleEl.textContent = "View Entries (" + total + ")";
      }
      tableToggleEl.hidden = false;
    }

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
      // Start collapsed
      setTableExpanded(false);
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

    function syncWithLocalData(rows) {
      if (!rows || rows.length <= 1) {
        setStatus("The file appears to be empty.", true);
        setConnected(false);
        return;
      }
      processRows(rows);
    }

    function processRows(rows) {
      addPortfolioNames(extractColumnValues(rows, "Portfolio Name"));
      localStorage.setItem("wf-" + prefix + "-data", JSON.stringify(rows));
      document.dispatchEvent(new CustomEvent("wf-sync-complete"));
      if (typeof afterSync === "function") afterSync(rows);
      updateDashboardStats();
      populatePortfolioSelect();
      var diagnostics = buildSyncDiagnostics(prefix, rows);
      var displayRows = filterColumns(rows, options.fields);
      if (options.showTable === false) {
        sheetTableWrap.hidden = true;
      } else {
        renderTable(displayRows);
      }
      setStatus(diagnostics.message, diagnostics.missingColumns);
      setConnected(diagnostics.missingColumns ? "warning" : true);
      var rowCount = displayRows.length - 1;
      rowCountEl.textContent = rowCount + (rowCount === 1 ? " row" : " rows");
      lastSync.textContent = "Last sync: " + new Date().toLocaleTimeString();
      meta.hidden = false;
    }

    function syncSheet(url) {
      // If the displayed value is an uploaded filename, use local data
      if (_localData && url.startsWith("📎 ")) {
        setStatus("Verifying and syncing…", false);
        syncWithLocalData(_localData);
        return;
      }
      if (!detectSheetUrlType(url)) {
        setStatus("Paste a Google Sheets, OneDrive, or direct CSV link.", true);
        sheetTableWrap.hidden = true;
        setConnected(false);
        return;
      }
      setStatus("Verifying and syncing…", false);

      var headerRow = headerRowInput ? headerRowInput.value : 1;

      fetchSheetData(
        { link: url, headerRow: headerRow },
        function (rows) {
          if (rows.length <= 1) {
            setStatus("The sheet appears to be empty.", true);
            sheetTableWrap.hidden = true;
            setConnected(false);
            return;
          }
          openSheetLink.href = url;
          processRows(rows);
        },
        function (reason) {
          setStatus(sheetErrorMessage(reason), true);
          sheetTableWrap.hidden = true;
          setConnected(false);
        }
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
      if (url) {
        localStorage.setItem(storageKey, url);
      } else {
        _localData = null;
        localStorage.removeItem(localDataKey);
        localStorage.removeItem(storageKey);
        localStorage.removeItem("wf-" + prefix + "-data");
        sheetTableWrap.hidden = true;
        setStatus("", false);
        setConnected(false);
        meta.hidden = true;
        updateDashboardStats();
      }
      if (headerRowInput) localStorage.setItem(headerRowKey, headerRowInput.value || "1");
    }

    sheetLinkInput.addEventListener("change", autoSave);
    if (headerRowInput) headerRowInput.addEventListener("change", autoSave);

    sheetSyncBtn.addEventListener("click", function () {
      var url = sheetLinkInput.value.trim();
      if (!url) {
        autoSave();
        return;
      }
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

  var FIXED_INCOME_SHEET_FIELDS = [
    "Transaction Date",
    "Portfolio Name",
    "Instrument Name",
    "Instrument Category",
    "Instrument Sub Category",
    "Transaction Type",
    "Amount"
  ];

  var FD_SHEET_FIELDS = [
    "Transaction Date",
    "Portfolio Name",
    "Bank",
    "Instrument Name",
    "Instrument Category",
    "Instrument Sub Category",
    "Transaction Type",
    "Grams",
    "Invested Amount",
    "Maturity Date/Sell Date",
    "Rate of Return"
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
      // Persist localData for uploaded files but cap size to avoid quota errors
      configs = configs.map(function (c) {
        if (c.localData && c.localData.length > 50000) {
          var trimmed = Object.assign({}, c);
          trimmed.localData = c.localData.slice(0, 50000);
          return trimmed;
        }
        return c;
      });
      localStorage.setItem(sheetsKey, JSON.stringify(configs));
      localStorage.removeItem("wf-" + prefix + "-sheet-link");
      localStorage.removeItem("wf-" + prefix + "-header-row");
      document.dispatchEvent(new CustomEvent("wf-settings-saved"));
    }

    function addRow(config) {
      config = config || { link: "", headerRow: "1" };
      var row = document.createElement("div");
      row.className = "sheet-row";

      // Restore localData from saved config so re-syncs use it
      if (config.localData) row._localData = config.localData;

      var linkInput = document.createElement("input");
      linkInput.type = "text";
      linkInput.className = "sheet-row-link";
      linkInput.placeholder = "Paste link or upload a file →";
      linkInput.value = config.link || "";
      linkInput.addEventListener("change", function () { row._localData = null; autoSaveConfigs(); });

      var fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = ".xlsx,.xls,.csv";
      fileInput.style.display = "none";
      fileInput.addEventListener("change", function () {
        var file = fileInput.files[0];
        if (!file) return;
        parseLocalFile(file, config.headerRow || "1", function (rows) {
          row._localData = rows;
          linkInput.value = "📎 " + file.name;
          row.querySelector(".sheet-row-link").type = "text";
          autoSaveConfigs();
          document.dispatchEvent(new CustomEvent("wf-file-uploaded"));
        }, function (err) {
          alert("Could not read file: " + err);
        });
        fileInput.value = "";
      });

      var uploadBtn = document.createElement("button");
      uploadBtn.type = "button";
      uploadBtn.className = "btn btn-outline btn-sm sheet-row-upload";
      uploadBtn.title = "Upload Excel or CSV file";
      uploadBtn.innerHTML = "&#128206; Upload";
      uploadBtn.addEventListener("click", function () { fileInput.click(); });

      row.appendChild(fileInput);

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
        if (!readRowConfigs().filter(function (c) { return c.link; }).length) {
          localStorage.removeItem("wf-" + prefix + "-data");
          updateDashboardStats();
          updateRefreshButtonStatus(prefix);
        }
      });

      var numberRow = document.createElement("div");
      numberRow.className = "sheet-row-number-row";
      numberRow.appendChild(headerInput);
      numberRow.appendChild(removeBtn);

      var fields = document.createElement("div");
      fields.className = "equity-link-row sheet-row-fields";
      fields.appendChild(linkInput);
      fields.appendChild(uploadBtn);
      fields.appendChild(numberRow);

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
          headerRow: row.querySelector(".sheet-row-header-row").value || "1",
          localData: row._localData || null
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
        localStorage.removeItem("wf-" + prefix + "-data");
        updateDashboardStats();
        updateRefreshButtonStatus(prefix);
        setStatus("Add at least one sheet link (Google Sheets, OneDrive, or CSV).", true);
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
        document.dispatchEvent(new CustomEvent("wf-sync-complete"));
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
        if (typeof options.afterSync === "function") options.afterSync(merged);
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

    // Auto-sync when a file is uploaded via the upload button
    document.addEventListener("wf-file-uploaded", function () { syncAll(); });

    if (savedConfigs.length) syncAll();
  }

  initMultiSheetCard("equity", { fields: TRANSACTION_SHEET_FIELDS, showTable: false });
  initMultiSheetCard("fixedincome", { fields: FIXED_INCOME_SHEET_FIELDS, showTable: false });
  initMultiSheetCard("fd", { fields: FD_SHEET_FIELDS, showTable: false });
  initMultiSheetCard("stocksetf", { fields: TRANSACTION_SHEET_FIELDS, showTable: false, afterSync: function () {
    // Auto-push mapping to GitHub so the price-fetch workflow picks up new instruments
    var mappingRows = getSheetRows("stocksetfmapping");
    if (mappingRows && mappingRows.length > 1) pushMappingToGitHub(mappingRows);
  }});
  initSheetCard("mfmapping");

  // ─── GitHub integration: push stocksetf_mapping.json after every mapping sync ──
  function loadGhSettings() {
    return {
      owner:  localStorage.getItem("wf-gh-owner")  || "",
      repo:   localStorage.getItem("wf-gh-repo")   || "",
      branch: localStorage.getItem("wf-gh-branch") || "",
      token:  localStorage.getItem("wf-gh-token")  || ""
    };
  }

  function pushMappingToGitHub(rows) {
    var gh = loadGhSettings();
    if (!gh.owner || !gh.repo || !gh.token) return; // not configured — silent skip
    var content = btoa(unescape(encodeURIComponent(JSON.stringify(rows))));
    var apiBase = "https://api.github.com/repos/" + gh.owner + "/" + gh.repo + "/contents/stocksetf_mapping.json";
    var headers = { "Authorization": "Bearer " + gh.token, "Content-Type": "application/json", "Accept": "application/vnd.github+json" };
    // GET current SHA (needed for update)
    fetch(apiBase + (gh.branch ? "?ref=" + encodeURIComponent(gh.branch) : ""), { headers: headers })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (existing) {
        var body = { message: "chore: update stocksetf_mapping.json", content: content };
        if (gh.branch) body.branch = gh.branch;
        if (existing && existing.sha) body.sha = existing.sha;
        return fetch(apiBase, { method: "PUT", headers: headers, body: JSON.stringify(body) });
      })
      .then(function (r) {
        if (r && (r.status === 200 || r.status === 201)) {
          console.log("stocksetf_mapping.json pushed to GitHub successfully.");
        } else {
          console.warn("GitHub push returned status", r && r.status);
        }
      })
      .catch(function (err) { console.warn("GitHub push failed:", err); });
  }

  // Wire GitHub settings save button
  var ghOwnerEl  = document.getElementById("gh-owner");
  var ghRepoEl   = document.getElementById("gh-repo");
  var ghBranchEl = document.getElementById("gh-branch");
  var ghTokenEl  = document.getElementById("gh-token");
  var ghSaveBtn  = document.getElementById("gh-save-btn");
  var ghSaveStatus = document.getElementById("gh-save-status");
  if (ghOwnerEl && ghRepoEl && ghBranchEl && ghTokenEl && ghSaveBtn) {
    // Pre-fill from localStorage
    ghOwnerEl.value  = localStorage.getItem("wf-gh-owner")  || "";
    ghRepoEl.value   = localStorage.getItem("wf-gh-repo")   || "";
    ghBranchEl.value = localStorage.getItem("wf-gh-branch") || "";
    ghTokenEl.value  = localStorage.getItem("wf-gh-token")  || "";
    ghSaveBtn.addEventListener("click", function () {
      localStorage.setItem("wf-gh-owner",  ghOwnerEl.value.trim());
      localStorage.setItem("wf-gh-repo",   ghRepoEl.value.trim());
      localStorage.setItem("wf-gh-branch", ghBranchEl.value.trim());
      localStorage.setItem("wf-gh-token",  ghTokenEl.value.trim());
      document.dispatchEvent(new CustomEvent("wf-settings-saved"));
      if (ghSaveStatus) { ghSaveStatus.textContent = "Saved."; setTimeout(function () { ghSaveStatus.textContent = ""; }, 2000); }
    });
  }

  initSheetCard("stocksetfmapping", {}, function afterSync(rows) {
    pushMappingToGitHub(rows);
  });

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

  function withAmfiNavOverride(schemeCode, data) {
    return fetchAmfiNavMap().then(function (navMap) {
      var entry = navMap && navMap[schemeCode];
      if (!entry) return data;
      var amfiDate = parseAmfiNavDate(entry.date);
      var amfiNav = parseNumber(entry.nav);
      if (!amfiDate || !amfiNav) return data;
      var latest = data.length ? data[data.length - 1] : null;
      if (latest && latest.date.getTime() >= amfiDate.getTime()) return data;
      console.log("[NAV] scheme " + schemeCode + ": applying newer AMFI NAV", { date: amfiDate, nav: amfiNav });
      return data.concat([{ date: amfiDate, nav: amfiNav }]);
    });
  }

  function fetchNavHistory(schemeCode) {
    var cacheKey = NAV_CACHE_PREFIX + schemeCode;
    try {
      var cached = JSON.parse(localStorage.getItem(cacheKey));
      if (cached && Date.now() - cached.fetchedAt < NAV_CACHE_MAX_AGE_MS) {
        var revived = (cached.data || []).map(function (entry) { return { date: new Date(entry.date), nav: entry.nav }; });
        console.log("[NAV] scheme " + schemeCode + ": using cached data, latest =", revived.length ? revived[revived.length - 1] : null, "fetched at", new Date(cached.fetchedAt));
        return withAmfiNavOverride(schemeCode, revived);
      }
    } catch (e) {}

    console.log("[NAV] scheme " + schemeCode + ": fetching fresh from api.mfapi.in");
    return fetch("https://api.mfapi.in/mf/" + schemeCode)
      .then(function (res) { return res.json(); })
      .then(function (json) {
        var data = (json.data || [])
          .map(function (entry) { return { date: parseMfApiDate(entry.date), nav: parseNumber(entry.nav) }; })
          .filter(function (entry) { return entry.date; })
          .sort(function (a, b) { return a.date - b.date; });
        console.log("[NAV] scheme " + schemeCode + ": fetched, latest =", data.length ? data[data.length - 1] : null);
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ fetchedAt: Date.now(), data: data }));
        } catch (e) {}
        return data;
      })
      .catch(function (err) {
        console.error("Failed to fetch NAV history for scheme " + schemeCode + ":", err);
        return [];
      })
      .then(function (data) { return withAmfiNavOverride(schemeCode, data); });
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

  // AMFI's own daily NAV file (proxied server-side into amfi_nav.json by a GitHub Actions
  // workflow), used to fill in NAV values api.mfapi.in hasn't ingested yet.
  function parseAmfiNavDate(d) {
    var months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    var parts = String(d || "").trim().split("-");
    if (parts.length !== 3) return null;
    var month = months[parts[1].toLowerCase().slice(0, 3)];
    if (month === undefined) return null;
    return new Date(Number(parts[2]), month, Number(parts[0]));
  }

  function fetchStaticAmfiNavMap() {
    return fetch(AMFI_NAV_MAP_STATIC_FILE, { cache: "no-store" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (payload) { return payload && payload.data ? payload.data : null; })
      .catch(function () { return null; });
  }

  function fetchAmfiNavMap() {
    try {
      var cached = JSON.parse(localStorage.getItem(AMFI_NAV_MAP_CACHE_KEY));
      if (cached && Date.now() - cached.fetchedAt < AMFI_NAV_MAP_MAX_AGE_MS) {
        return Promise.resolve(cached.data);
      }
    } catch (e) {}

    return fetchStaticAmfiNavMap().then(function (staticData) {
      if (staticData && Object.keys(staticData).length) {
        try {
          localStorage.setItem(AMFI_NAV_MAP_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), data: staticData }));
        } catch (e) {}
        return staticData;
      }
      return {};
    });
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

  function buildEpfValueEvents(portfolioFilter) {
    var rows = getSheetRows("fixedincome");
    if (!rows || !rows.length) return [];
    var header = rows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var typeIdx = header.indexOf("transaction type");
    var amountIdx = header.indexOf("amount");
    var categoryIdx = header.indexOf("instrument category");
    var dateIdx = header.findIndex(function (h) { return h.indexOf("date") !== -1; });
    if (portfolioIdx === -1 || typeIdx === -1 || amountIdx === -1 || dateIdx === -1) return [];

    var events = [];
    rows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && normalizeText(portfolio) !== normalizeText(portfolioFilter)) return;
      if (categoryIdx !== -1 && normalizeText(row[categoryIdx]) !== "fixed income") return;
      var type = normalizeText(row[typeIdx]);
      var isDeposit = type.indexOf("deposit") !== -1;
      var isInterest = type.indexOf("interest") !== -1;
      if (!isDeposit && !isInterest) return;
      var date = parseFlexibleDate(row[dateIdx]);
      if (!date) return;
      events.push({ date: date, delta: parseNumber(row[amountIdx]) });
    });

    events.sort(function (a, b) { return a.date - b.date; });
    var running = 0;
    events.forEach(function (e) { running += e.delta; e.cumulativeValue = running; });
    return events;
  }

  // Investment Corpus/Savings Account rows in the FD sheet are running-balance snapshots,
  // not discrete cash flows — each row's Invested Amount replaces the prior balance for that
  // Portfolio/Bank/Instrument. For the Account Value chart we convert consecutive balances
  // into month-on-month deltas and accumulate them into a single timeline, mirroring how
  // EPF deposit/interest events build a running cumulative value.
  function buildFdValueEvents(portfolioFilter) {
    var rows = getSheetRows("fd");
    if (!rows || !rows.length) return [];
    var header = rows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var bankIdx = header.indexOf("bank");
    var instrumentIdx = header.indexOf("instrument name");
    var categoryIdx = header.indexOf("instrument category");
    var subCategoryIdx = header.indexOf("instrument sub category");
    var amountIdx = header.indexOf("invested amount");
    var dateIdx = header.indexOf("transaction date");
    if (portfolioIdx === -1 || bankIdx === -1 || instrumentIdx === -1 || subCategoryIdx === -1 || amountIdx === -1 || dateIdx === -1) return [];

    var entries = [];
    rows.slice(1).forEach(function (row, rowIdx) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && normalizeText(portfolio) !== normalizeText(portfolioFilter)) return;
      if (categoryIdx !== -1 && normalizeText(row[categoryIdx]) !== "fixed income") return;
      var subCategory = normalizeText(row[subCategoryIdx]);
      var isBalance = (subCategory === "investment corpus" || subCategory === "savings account");
      var isPf = (subCategory === "provident fund");
      if (!isBalance && !isPf) return;

      var date = parseFlexibleDate(row[dateIdx]);
      if (!date) return;
      // Balance rows share a key per portfolio/bank/instrument (replacement).
      // PF rows are discrete deposits, so use a unique key per row so each adds.
      var key = isPf
        ? "pf||" + rowIdx
        : normalizeText(portfolio) + "||" + normalizeText(row[bankIdx]) + "||" + normalizeText(row[instrumentIdx]);
      entries.push({ date: date, key: key, amount: parseNumber(row[amountIdx]) });
    });

    entries.sort(function (a, b) { return a.date - b.date; });
    var lastByKey = {};
    var events = [];
    var running = 0;
    entries.forEach(function (entry) {
      var previous = lastByKey[entry.key] || 0;
      var delta = entry.amount - previous;
      lastByKey[entry.key] = entry.amount;
      running += delta;
      events.push({ date: entry.date, cumulativeValue: running });
    });
    return events;
  }

  // Builds stepped commodity (gold) gram events at each buy/sell date.
  // Value = cumulativeGrams × currentGoldPrice, so the chart shows market value at today's price.
  function buildCommodityGramEvents(fdRows, portfolioFilter) {
    if (!fdRows || !fdRows.length) return [];
    var header = fdRows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var categoryIdx = header.indexOf("instrument category");
    var gramsIdx = header.indexOf("grams");
    var dateIdx = header.indexOf("transaction date");
    var maturityIdx = header.indexOf("maturity date/sell date");
    if (gramsIdx === -1 || dateIdx === -1) return [];

    var today = new Date(); today.setHours(0, 0, 0, 0);
    var raw = [];
    fdRows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && normalizeText(portfolio) !== normalizeText(portfolioFilter)) return;
      if (categoryIdx !== -1 && normalizeText(row[categoryIdx]) !== "commodity") return;
      var grams = parseNumber(row[gramsIdx]);
      if (!grams) return;
      var buyDate = parseFlexibleDate(row[dateIdx]);
      if (!buyDate) return;
      raw.push({ date: buyDate, gramsDelta: grams });

      var sellDateParsed = maturityIdx !== -1 ? parseFlexibleDate(row[maturityIdx]) : null;
      if (sellDateParsed) {
        var sellDay = new Date(sellDateParsed.getFullYear(), sellDateParsed.getMonth(), sellDateParsed.getDate());
        if (today > sellDay) {
          raw.push({ date: sellDateParsed, gramsDelta: -grams });
        }
      }
    });

    raw.sort(function (a, b) { return a.date - b.date; });
    var running = 0;
    return raw.map(function (e) {
      running += e.gramsDelta;
      return { date: e.date, cumulativeGrams: running };
    });
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

    // Wire "Change benchmark" button to scroll to and open the benchmark card
    var changeBtn = document.getElementById("avc-change-benchmark");
    if (changeBtn && !changeBtn.dataset.bound) {
      changeBtn.dataset.bound = "1";
      changeBtn.addEventListener("click", function () {
        var benchCard = document.getElementById("benchmark-card");
        if (benchCard) benchCard.scrollIntoView({ behavior: "smooth", block: "start" });
        var benchToggle = document.getElementById("benchmark-toggle");
        if (benchToggle) setTimeout(function () { benchToggle.click(); }, 400);
      });
    }

    statusEl.hidden = false;
    statusEl.textContent = "Resolving mutual fund scheme codes…";

    buildInstrumentSchemeMap().then(function (schemeMap) {
      var selectedPortfolio = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
      var unitEvents = buildInstrumentUnitEvents(selectedPortfolio);
      var instruments = Object.keys(unitEvents).filter(function (name) { return !!lookupSchemeCode(schemeMap, name); });
      var skipped = Object.keys(unitEvents).length - instruments.length;
      // Growth-of-₹100 compares equity-style returns against an equity index;
      // fixed-income (EPF, PF, FD, Savings, Investment Corpus) is always
      // excluded so the comparison is apples-to-apples.
      var epfEvents = [];
      var fdValueEvents = [];
      // For the raw Account Value chart, honour the user's exclusion filters
      // — include fixed-income + savings when the user hasn't excluded them.
      var epfEventsAll = isFixedIncomeExcluded() ? [] : buildEpfValueEvents(selectedPortfolio);
      var fdValueEventsAll = (isFixedIncomeExcluded() || isSavingsInvestmentExcluded()) ? [] : buildFdValueEvents(selectedPortfolio);

      // Build commodity gram events and fetch monthly gold price history for chart
      var fdRowsForChart = getSheetRows("fd");
      var commodityGramEvents = fdRowsForChart
        ? buildCommodityGramEvents(fdRowsForChart, selectedPortfolio) : [];
      var hasAnyCommodity = commodityGramEvents.length > 0;

      // Build SE unit events keyed by ticker for chart contribution
      var seRows = getSheetRows("stocksetf");
      var seMappingTable = buildStockMappingTable();
      var seUnitEventsByTicker = {}; // { ticker: [{date, cumulativeUnits, region}] }
      if (seRows && seRows.length && Object.keys(seMappingTable).length) {
        var seTxns = groupUnitTransactionsByInstrument(seRows, selectedPortfolio);
        if (seTxns) {
          Object.keys(seTxns).forEach(function (instrument) {
            var mapping = seMappingTable[normalizeText(instrument)];
            if (!mapping) return;
            var ticker = mapping.ticker;
            var region = mapping.region;
            var sorted = seTxns[instrument].filter(function (t) { return !!t.date; }).sort(function (a, b) { return a.date - b.date; });
            if (!sorted.length) return;
            var running = 0;
            var events = sorted.map(function (txn) {
              running += txn.type === "buy" ? txn.units : -txn.units;
              return { date: txn.date, cumulativeUnits: Math.max(0, running) };
            });
            seUnitEventsByTicker[ticker] = events;
          });
        }
      }
      var hasAnySE = Object.keys(seUnitEventsByTicker).length > 0;

      var currentGoldPricePromise = hasAnyCommodity
        ? fetchGoldPriceINRPerGram().catch(function () { return null; })
        : Promise.resolve(null);
      var stockPricesPromise = hasAnySE
        ? fetchAllStockPrices().catch(function () { return { prices: {}, usd_inr_history: {} }; })
        : Promise.resolve({ prices: {}, usd_inr_history: {} });
      // Build monthly sample dates from first buy to today for historical price chart
      var goldPriceHistoryPromise = hasAnyCommodity
        ? (function () {
            var firstDate = commodityGramEvents[0].date;
            var samples = [];
            var d = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
            var todaySample = new Date(); todaySample.setHours(0, 0, 0, 0);
            while (d <= todaySample) {
              samples.push(formatDateISO(new Date(d)));
              d.setMonth(d.getMonth() + 1);
            }
            samples.push(formatDateISO(todaySample));
            return Promise.all(samples.map(function (dStr) {
              return fetchXauInrForDate(dStr)
                .then(function (p) { return { date: new Date(dStr), price: p }; })
                .catch(function () { return null; });
            })).then(function (results) {
              return results.filter(Boolean).sort(function (a, b) { return a.date - b.date; });
            });
          })()
        : Promise.resolve([]);

      if (!instruments.length && !epfEvents.length && !fdValueEvents.length && !hasAnyCommodity && !hasAnySE) {
        if (window.__wfValueChart) {
          window.__wfValueChart.destroy();
          window.__wfValueChart = null;
        }
        statusEl.hidden = false;
        statusEl.textContent = skipped
          ? "No Instrument Name in your Equity sheet could be resolved to a Scheme Code via the Mutual Fund Mapping sheet and AMFI."
          : "Connect your Mutual Fund Transactions and Mutual Fund Mapping sheets to see this chart.";
        return;
      }

      statusEl.textContent = instruments.length ? "Fetching NAV history for " + instruments.length + " instrument(s)…" : "Loading…";

      return Promise.all([
        Promise.all(instruments.map(function (name) { return fetchNavHistory(lookupSchemeCode(schemeMap, name)); })),
        currentGoldPricePromise,
        goldPriceHistoryPromise,
        stockPricesPromise
      ]).then(function (outerResults) {
        var navHistories = outerResults[0];
        var currentGoldPrice = outerResults[1];
        var goldPriceHistory = outerResults[2];
        var stockPricesData = outerResults[3];
        var allPrices = (stockPricesData && stockPricesData.prices) || {};
        var usdInrHistMap = (stockPricesData && stockPricesData.usd_inr_history) || {};
        var usdInrToday = allPrices["__USD_INR__"] ? allPrices["__USD_INR__"].price : 84;
        var navByInstrument = {};
        instruments.forEach(function (name, i) { navByInstrument[name] = navHistories[i]; });

        var allDates = {};
        instruments.forEach(function (name) {
          (navByInstrument[name] || []).forEach(function (entry) { allDates[dateKey(entry.date)] = entry.date; });
        });
        epfEvents.forEach(function (entry) { allDates[dateKey(entry.date)] = entry.date; });
        fdValueEvents.forEach(function (entry) { allDates[dateKey(entry.date)] = entry.date; });
        commodityGramEvents.forEach(function (entry) { allDates[dateKey(entry.date)] = entry.date; });
        Object.keys(seUnitEventsByTicker).forEach(function (ticker) {
          seUnitEventsByTicker[ticker].forEach(function (e) { allDates[dateKey(e.date)] = e.date; });
        });
        // Fill daily dates for commodity so the chart has a dense timeline
        if (commodityGramEvents.length) {
          var commFill = new Date(commodityGramEvents[0].date);
          var commToday = new Date(); commToday.setHours(0, 0, 0, 0);
          while (commFill <= commToday) {
            allDates[dateKey(commFill)] = new Date(commFill);
            commFill.setDate(commFill.getDate() + 1);
          }
        }
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
        if (epfEvents.length) {
          var epfEarliest = epfEvents[0].date;
          var epfLatest = epfEvents[epfEvents.length - 1].date;
          if (!firstTxnDate || epfEarliest < firstTxnDate) firstTxnDate = epfEarliest;
          if (!lastTxnDate || epfLatest > lastTxnDate) lastTxnDate = epfLatest;
        }
        if (fdValueEvents.length) {
          var fdEarliest = fdValueEvents[0].date;
          var fdLatest = fdValueEvents[fdValueEvents.length - 1].date;
          if (!firstTxnDate || fdEarliest < firstTxnDate) firstTxnDate = fdEarliest;
          if (!lastTxnDate || fdLatest > lastTxnDate) lastTxnDate = fdLatest;
        }
        if (commodityGramEvents.length) {
          var commEarliest = commodityGramEvents[0].date;
          if (!firstTxnDate || commEarliest < firstTxnDate) firstTxnDate = commEarliest;
        }
        Object.keys(seUnitEventsByTicker).forEach(function (ticker) {
          var events = seUnitEventsByTicker[ticker];
          if (events.length) {
            var seEarliest = events[0].date;
            if (!firstTxnDate || seEarliest < firstTxnDate) firstTxnDate = seEarliest;
          }
        });
        timeline = timeline.filter(function (d) { return d <= today && (!firstTxnDate || d >= firstTxnDate); });

        if (!timeline.length) {
          statusEl.hidden = false;
          statusEl.textContent = "No NAV history available yet for your mapped instruments.";
          return;
        }

        var points = timeline.map(function (date) {
          var activeGrams = lastAtOrBefore(commodityGramEvents, date, "cumulativeGrams") || 0;
          var goldPriceAtDate = lastAtOrBefore(goldPriceHistory, date, "price") || currentGoldPrice || 0;
          var total = (lastAtOrBefore(epfEvents, date, "cumulativeValue") || 0)
            + (lastAtOrBefore(fdValueEvents, date, "cumulativeValue") || 0)
            + (activeGrams > 0 ? activeGrams * goldPriceAtDate : 0);
          instruments.forEach(function (name) {
            var units = lastAtOrBefore(unitEvents[name], date, "cumulativeUnits") || 0;
            var nav = lastAtOrBefore(navByInstrument[name], date, "nav");
            if (units > UNITS_EPSILON && nav) total += units * nav;
          });
          // Stocks/ETF: use historical price from stock_history when available, else current price.
          var dateStr = formatDateISO(date);
          var stockHistory = (stockPricesData && stockPricesData.stock_history) || {};
          Object.keys(seUnitEventsByTicker).forEach(function (ticker) {
            var events = seUnitEventsByTicker[ticker];
            var units = lastAtOrBefore(events, date, "cumulativeUnits") || 0;
            if (units <= UNITS_EPSILON) return;
            var hist = stockHistory[ticker];
            var price = hist ? lookupIndexPrice(hist.prices, dateStr) : null;
            if (!price) { var p = allPrices[ticker]; if (p) price = p.price; }
            if (!price) return;
            var isUsd = hist ? hist.currency === "USD" : (allPrices[ticker] && allPrices[ticker].currency === "USD");
            if (isUsd) {
              total += units * price * (usdInrHistMap[dateStr] || usdInrToday);
            } else {
              total += units * price;
            }
          });
          return { x: date, y: total };
        });

        statusEl.hidden = true;

        // Build a parallel points-all series that layers fixed-income /
        // savings on top of the equity value so the Account Value chart
        // reflects total portfolio worth respecting the exclusion toggles.
        var pointsAll = points.map(function (p) {
          var extra = (lastAtOrBefore(epfEventsAll, p.x, "cumulativeValue") || 0)
                    + (lastAtOrBefore(fdValueEventsAll, p.x, "cumulativeValue") || 0);
          return { x: p.x, y: p.y + extra };
        });

        // Snap the last point to Overview's authoritative current value:
        // Overview's fiCurrent/commCurrent include interest accrual + live
        // prices that the historical timeline can't replay. Historical points
        // stay as deposits (correct); only the tail matches Overview.
        (function snapLastPointToOverview() {
          if (!pointsAll.length || typeof _ov === "undefined" || !_ov) return;
          var live = (_ov.mfCurrent || 0) + (_ov.seCurrent > 0 ? _ov.seCurrent : 0)
            + (isFixedIncomeExcluded() ? 0 : (_ov.fiCurrent || 0))
            + (isFixedIncomeExcluded() ? 0 : (_ov.commCurrent || 0));
          if (live > 0) pointsAll[pointsAll.length - 1] = { x: pointsAll[pointsAll.length - 1].x, y: live };
        })();

        // Render the raw Account Value (₹) chart next to Growth-of-₹100.
        try { _renderPortfolioValueChart(pointsAll); } catch (e) {}

        var first = timeline[0], last = timeline[timeline.length - 1];
        if (rangeEl) rangeEl.textContent = first.toLocaleDateString() + " – " + last.toLocaleDateString();

        var fullMinTime = first.getTime();
        var fullMaxTime = last.getTime();

        // === Growth-of-₹100 normalization + benchmark overlay ===
        var indexKey = localStorage.getItem("wf-benchmark-index") || "NIFTY50";
        var indexDisplayName = indexKey === "NIFTY50" ? "Nifty 50"
          : indexKey === "NIFTYNEXT50" ? "Nifty Next 50"
          : indexKey === "NIFTYMIDCAP150" ? "Nifty Midcap 150"
          : indexKey === "NIFTY500" ? "Nifty 500" : indexKey;

        // === Time-Weighted Return NAV computation ===
        // Collect contribution/withdrawal events from all sheets. Positive delta
        // means money flowed into the portfolio (a contribution), negative means
        // money was withdrawn. Interest/gains are NOT included — they show up as
        // increases in portfolio value and are what drives NAV growth.
        var contribEvents = [];

        // MF + Stocks/ETF: buildXirrCashFlows returns negative for buys, positive for sells.
        var equityRowsForFlow = getSheetRows("equity");
        var seRowsForFlow = getSheetRows("stocksetf");
        if (equityRowsForFlow) {
          buildXirrCashFlows(equityRowsForFlow, selectedPortfolio).forEach(function (f) {
            contribEvents.push({ date: f.date, delta: -f.amount });
          });
        }
        if (seRowsForFlow) {
          buildXirrCashFlows(seRowsForFlow, selectedPortfolio).forEach(function (f) {
            contribEvents.push({ date: f.date, delta: -f.amount });
          });
        }

        // Fixed Income (EPF, PF, FD, Savings): excluded from Growth-of-₹100 chart.
        if (false) {
          var fiRowsForFlow = getSheetRows("fixedincome");
          if (fiRowsForFlow && fiRowsForFlow.length) {
            var fiHdr = fiRowsForFlow[0].map(normalizeText);
            var fiPortIdx = fiHdr.indexOf("portfolio name");
            var fiTypeIdx = fiHdr.indexOf("transaction type");
            var fiAmtIdx = fiHdr.indexOf("amount");
            var fiCatIdx = fiHdr.indexOf("instrument category");
            var fiDateIdx = fiHdr.findIndex(function (h) { return h.indexOf("date") !== -1; });
            if (fiPortIdx !== -1 && fiTypeIdx !== -1 && fiAmtIdx !== -1 && fiDateIdx !== -1) {
              fiRowsForFlow.slice(1).forEach(function (row) {
                var portfolio = (row[fiPortIdx] || "").trim();
                if (selectedPortfolio !== "all" && normalizeText(portfolio) !== normalizeText(selectedPortfolio)) return;
                if (fiCatIdx !== -1 && normalizeText(row[fiCatIdx]) !== "fixed income") return;
                var type = normalizeText(row[fiTypeIdx]);
                if (type.indexOf("deposit") === -1) return;
                var date = parseFlexibleDate(row[fiDateIdx]);
                if (!date) return;
                var amt = parseNumber(row[fiAmtIdx]);
                if (!amt) return;
                contribEvents.push({ date: date, delta: amt });
              });
            }
          }

          // FD sheet — fixed deposits: each row is a discrete deposit
          // Investment corpus / savings: use buildFdValueEvents deltas as contribution proxy
          // Gold/commodity: buy = contribution, sell = withdrawal
          var fdRowsForFlow = getSheetRows("fd");
          if (fdRowsForFlow && fdRowsForFlow.length) {
            var fdHdr = fdRowsForFlow[0].map(normalizeText);
            var fdPortIdx = fdHdr.indexOf("portfolio name");
            var fdTypeIdx = fdHdr.indexOf("transaction type");
            var fdAmtIdx = fdHdr.indexOf("invested amount");
            var fdDateIdx = fdHdr.indexOf("transaction date");
            var fdSubIdx = fdHdr.indexOf("instrument sub category");
            if (fdPortIdx !== -1 && fdAmtIdx !== -1 && fdDateIdx !== -1) {
              fdRowsForFlow.slice(1).forEach(function (row) {
                var portfolio = (row[fdPortIdx] || "").trim();
                if (selectedPortfolio !== "all" && normalizeText(portfolio) !== normalizeText(selectedPortfolio)) return;
                var sub = fdSubIdx !== -1 ? normalizeText(row[fdSubIdx]) : "";
                var type = fdTypeIdx !== -1 ? normalizeText(row[fdTypeIdx]) : "";
                var date = parseFlexibleDate(row[fdDateIdx]);
                if (!date) return;
                var amt = parseNumber(row[fdAmtIdx]);
                if (!amt) return;

                if (sub === "fixed deposit") {
                  // Discrete deposit — contribution
                  contribEvents.push({ date: date, delta: amt });
                } else if (sub === "gold" || sub === "silver" || sub === "commodity") {
                  var isBuy = type.indexOf("buy") !== -1 || !type;
                  contribEvents.push({ date: date, delta: isBuy ? amt : -amt });
                }
                // Investment Corpus / Savings Account: skipped here — handled below via
                // buildFdValueEvents balance-delta stream to catch running-balance changes
              });
            }

            // Investment Corpus / Savings: balance deltas as contribution proxy.
            // (Interest accrual is small for these; treating balance moves as
            // contributions is a reasonable approximation.)
            var fdBalanceEvents = buildFdValueEvents(selectedPortfolio);
            var prevBal = 0;
            fdBalanceEvents.forEach(function (ev) {
              var delta = ev.cumulativeValue - prevBal;
              prevBal = ev.cumulativeValue;
              if (Math.abs(delta) > 0.01) contribEvents.push({ date: ev.date, delta: delta });
            });
          }
        }

        contribEvents.sort(function (a, b) { return a.date - b.date; });

        // Cumulative contributions at each timeline date (running sum through time)
        var cumContribAt = new Array(points.length).fill(0);
        var evIdx = 0, runningContrib = 0;
        for (var pi = 0; pi < points.length; pi++) {
          while (evIdx < contribEvents.length && contribEvents[evIdx].date <= points[pi].x) {
            runningContrib += contribEvents[evIdx].delta;
            evIdx++;
          }
          cumContribAt[pi] = runningContrib;
        }

        // TWR NAV: start at 100 on the first day the portfolio has value.
        // units_0 = value_0 / 100. Thereafter, when contributions arrive at
        // date t, units grow by Δcontrib / NAV(previous). Between contributions,
        // NAV moves purely with portfolio value.
        var basePortIdx = 0;
        while (basePortIdx < points.length && !(points[basePortIdx].y > 0)) basePortIdx++;
        var normPortPoints = points.map(function () { return { x: null, y: null }; });
        var lastPortNorm = null;
        if (basePortIdx < points.length && points[basePortIdx].y > 0) {
          var units = points[basePortIdx].y / 100;
          normPortPoints[basePortIdx] = { x: points[basePortIdx].x, y: 100 };
          var prevNav = 100;
          var prevContrib = cumContribAt[basePortIdx];
          for (var i = basePortIdx + 1; i < points.length; i++) {
            var dContrib = cumContribAt[i] - prevContrib;
            if (Math.abs(dContrib) > 0.01 && prevNav > 0) {
              // Units adjust for cash flow at the prevailing NAV
              units += dContrib / prevNav;
            }
            var nav = units > 0 && points[i].y > 0 ? (points[i].y / units) : prevNav;
            normPortPoints[i] = { x: points[i].x, y: nav };
            prevNav = nav;
            prevContrib = cumContribAt[i];
          }
          lastPortNorm = prevNav;
        } else {
          normPortPoints = points.map(function (p) { return { x: p.x, y: null }; });
        }

        // Fetch index history and build normalized benchmark series aligned to portfolio dates.
        fetchIndexHistory().then(function (indexHistory) {
          var indexData = indexHistory && indexHistory[indexKey];
          var indexPrices = indexData && indexData.prices ? indexData.prices : null;
          var normIdxPoints = [];
          var lastIdxNorm = null;
          if (indexPrices) {
            var basePortDate = formatDateISO(points[basePortIdx] ? points[basePortIdx].x : first);
            var baseIdxPrice = lookupIndexPrice(indexPrices, basePortDate);
            var baseIdxIdx = basePortIdx;
            // If index has no price at the portfolio's inception (e.g. portfolio
            // starts in 2015 but index history only from 2018), find the first
            // timeline date where the index has a price and rebase both series
            // so they start at the same NAV on that later date.
            if (!baseIdxPrice) {
              for (var bi = basePortIdx; bi < points.length; bi++) {
                var p = lookupIndexPrice(indexPrices, formatDateISO(points[bi].x));
                if (p) { baseIdxPrice = p; baseIdxIdx = bi; break; }
              }
            }
            if (baseIdxPrice) {
              var portNavAtIdxBase = (normPortPoints[baseIdxIdx] && normPortPoints[baseIdxIdx].y) || 100;
              normIdxPoints = points.map(function (p, i) {
                if (i < baseIdxIdx) return { x: p.x, y: null };
                var price = lookupIndexPrice(indexPrices, formatDateISO(p.x));
                return { x: p.x, y: price ? (price * portNavAtIdxBase / baseIdxPrice) : null };
              });
              for (var li = normIdxPoints.length - 1; li >= 0; li--) {
                if (normIdxPoints[li].y != null) { lastIdxNorm = normIdxPoints[li].y; break; }
              }
            }
          }

          // Update header legend + eyebrow with inception year
          var inceptionYear = (points[basePortIdx] ? points[basePortIdx].x : first).getFullYear();
          var eyebrowEl = document.getElementById("avc-eyebrow");
          if (eyebrowEl) eyebrowEl.textContent = "GROWTH OF ₹100 · SINCE " + inceptionYear;
          var portValEl = document.getElementById("avc-portfolio-value");
          if (portValEl) portValEl.textContent = lastPortNorm != null ? "₹" + Math.round(lastPortNorm) : "—";
          var idxNameEl = document.getElementById("avc-index-name");
          if (idxNameEl) idxNameEl.textContent = indexDisplayName;
          var idxValEl = document.getElementById("avc-index-value");
          if (idxValEl) idxValEl.textContent = lastIdxNorm != null ? "₹" + Math.round(lastIdxNorm) : "—";

          // Verdict callout removed per user request; keep element hidden.
          var verdictEl = document.getElementById("avc-verdict");
          if (verdictEl) verdictEl.hidden = true;
          return { normIdxPoints: normIdxPoints };
        }).then(function (idxResult) {
          _renderNormalizedChart(idxResult ? idxResult.normIdxPoints : []);
        }).catch(function () {
          _renderNormalizedChart([]);
        });

        var calloutEl = document.getElementById("value-chart-callout");
        var calloutValueEl = document.getElementById("value-chart-callout-value");
        var calloutDateEl = document.getElementById("value-chart-callout-date");
        var rangePicker = document.getElementById("value-chart-range-picker");

        function _renderNormalizedChart(normIdxPoints) {
        if (window.__wfValueChart) window.__wfValueChart.destroy();
        var ctx = canvas.getContext("2d");
        var fillGradient = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 340);
        fillGradient.addColorStop(0, "rgba(16,185,129,0.22)");
        fillGradient.addColorStop(1, "rgba(16,185,129,0)");
        var datasets = [{
          label: "Portfolio",
          data: normPortPoints,
          borderColor: "#10B981",
          backgroundColor: fillGradient,
          fill: true,
          tension: 0.25,
          cubicInterpolationMode: "monotone",
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: "#10B981",
          pointHoverBorderColor: "#fff",
          pointHoverBorderWidth: 2,
          borderWidth: 2.5,
          spanGaps: true
        }];
        if (normIdxPoints && normIdxPoints.length) {
          datasets.push({
            label: indexDisplayName,
            data: normIdxPoints,
            borderColor: "#94A3B8",
            backgroundColor: "transparent",
            borderDash: [6, 5],
            fill: false,
            tension: 0.25,
            cubicInterpolationMode: "monotone",
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: "#94A3B8",
            pointHoverBorderColor: "#fff",
            pointHoverBorderWidth: 2,
            borderWidth: 2,
            spanGaps: true
          });
        }
        window.__wfValueChart = new Chart(ctx, {
          type: "line",
          data: { datasets: datasets },
          options: {
            maintainAspectRatio: false,
            animation: { duration: 350, easing: "easeOutQuart" },
            interaction: { intersect: false, mode: "index" },
            scales: {
              x: {
                type: "time",
                time: { unit: "year", displayFormats: { year: "yyyy", month: "MMM" } },
                min: fullMinTime,
                max: fullMaxTime,
                grid: { display: false },
                ticks: {
                  maxRotation: 0,
                  autoSkip: true,
                  major: { enabled: true },
                  font: function (ctx) { return ctx.tick && ctx.tick.major ? { weight: "bold" } : {}; },
                  callback: function (value) {
                    var d = new Date(value);
                    return d.getMonth() === 0 ? String(d.getFullYear()) : d.toLocaleDateString("en-US", { month: "short" });
                  }
                }
              },
              y: { ticks: { callback: function (v) { return "₹" + Math.round(v); } }, grid: { color: "rgba(150,150,150,0.12)" } }
            },
            plugins: {
              legend: { display: false },
              tooltip: {
                enabled: true,
                callbacks: {
                  title: function (items) {
                    if (!items || !items.length) return "";
                    var d = new Date(items[0].parsed.x);
                    return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
                  },
                  label: function (ctx) { return ctx.dataset.label + ": ₹" + Math.round(ctx.parsed.y); }
                }
              },
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
                  onPanComplete: function (ctx) { updateVisibleRangeLabel(ctx.chart); clearActiveRangePill(); }
                },
                zoom: {
                  wheel: { enabled: true },
                  pinch: { enabled: true },
                  mode: "x",
                  onZoomComplete: function (ctx) { updateVisibleRangeLabel(ctx.chart); clearActiveRangePill(); }
                }
              }
            },
          }
        });
        updateVisibleRangeLabel(window.__wfValueChart);
        } // end _renderNormalizedChart

        function updateVisibleRangeLabel(chart) {
          var xScale = chart.scales.x;
          if (rangeEl) rangeEl.textContent = new Date(xScale.min).toLocaleDateString() + " – " + new Date(xScale.max).toLocaleDateString();
        }

        function clearActiveRangePill() {
          if (!rangePicker) return;
          Array.prototype.forEach.call(rangePicker.querySelectorAll(".range-pill"), function (btn) { btn.classList.remove("active"); });
        }

        function applyRange(key, btn) {
          var chart = window.__wfValueChart;
          if (!chart) return;
          var spanMs;
          if (key === "1M") spanMs = 1000 * 60 * 60 * 24 * 30;
          else if (key === "6M") spanMs = 1000 * 60 * 60 * 24 * 182;
          else if (key === "1Y") spanMs = 1000 * 60 * 60 * 24 * 365;
          else if (key === "3Y") spanMs = 1000 * 60 * 60 * 24 * 365 * 3;
          else if (key === "5Y") spanMs = 1000 * 60 * 60 * 24 * 365 * 5;
          var min = key === "ALL" ? fullMinTime : Math.max(fullMinTime, fullMaxTime - spanMs);
          chart.options.scales.x.min = min;
          chart.options.scales.x.max = fullMaxTime;
          chart.update();
          updateVisibleRangeLabel(chart);
          clearActiveRangePill();
          if (btn) btn.classList.add("active");
        }

        if (rangePicker && !rangePicker.dataset.bound) {
          rangePicker.dataset.bound = "1";
          rangePicker.addEventListener("click", function (evt) {
            var btn = evt.target.closest(".range-pill");
            if (!btn) return;
            applyRange(btn.dataset.range, btn);
          });
        }

      });
    }).catch(function (err) {
      statusEl.textContent = "Couldn't render the chart: " + (err && err.message ? err.message : err);
    });

    function _renderPortfolioValueChart(points) {
      var canvas2 = document.getElementById("portfolio-value-chart");
      if (!canvas2 || typeof Chart === "undefined") return;
      if (window.__wfPortfolioValueChart) window.__wfPortfolioValueChart.destroy();
      var wrap = canvas2.parentNode;
      if (wrap) { wrap.innerHTML = ""; canvas2 = document.createElement("canvas"); canvas2.id = "portfolio-value-chart"; canvas2.height = 320; wrap.appendChild(canvas2); }
      var ctx2 = canvas2.getContext("2d");
      var grad = ctx2.createLinearGradient(0, 0, 0, canvas2.clientHeight || 320);
      grad.addColorStop(0, "rgba(16,185,129,0.28)");
      grad.addColorStop(1, "rgba(16,185,129,0)");
      var lastVal = points.length ? points[points.length - 1].y : 0;
      var lastEl = document.getElementById("pvc-current-value");
      if (lastEl) lastEl.textContent = "₹" + Math.round(lastVal).toLocaleString("en-IN");
      window.__wfPortfolioValueChart = new Chart(ctx2, {
        type: "line",
        data: {
          datasets: [{
            label: "Current Value",
            data: points,
            borderColor: "#10B981",
            backgroundColor: grad,
            fill: true,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.12
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (ctx) { return "₹" + Math.round(ctx.parsed.y).toLocaleString("en-IN"); }
              }
            }
          },
          scales: {
            x: { type: "time", time: { unit: "year" }, grid: { display: false } },
            y: {
              ticks: {
                callback: function (v) {
                  if (v >= 1e7) return "₹" + (v / 1e7).toFixed(1) + "Cr";
                  if (v >= 1e5) return "₹" + (v / 1e5).toFixed(1) + "L";
                  if (v >= 1e3) return "₹" + (v / 1e3).toFixed(0) + "K";
                  return "₹" + v;
                }
              },
              grid: { color: "rgba(0,0,0,0.05)" }
            }
          }
        }
      });
    }

    if (resetBtn && !resetBtn.dataset.bound) {
      resetBtn.dataset.bound = "1";
      resetBtn.addEventListener("click", function () {
        if (window.__wfValueChart) window.__wfValueChart.resetZoom();
        var rangePicker = document.getElementById("value-chart-range-picker");
        if (rangePicker) {
          Array.prototype.forEach.call(rangePicker.querySelectorAll(".range-pill"), function (btn) { btn.classList.remove("active"); });
          var threeY = rangePicker.querySelector('[data-range="3Y"]');
          if (threeY) threeY.classList.add("active");
        }
      });
    }
  }

  renderValueChart();
  renderMonthlyInvestmentByCategory();
  renderMonthlyCashFlow();

  // Re-render Growth-of-₹100 whenever the benchmark index changes on the
  // Benchmark Comparison card so both stay in sync.
  document.addEventListener("wf-benchmark-changed", function () {
    renderValueChart();
  });
  document.addEventListener("wf-exclusion-changed", function () {
    renderValueChart();
  });
  // Re-render split cards once Overview finishes hydrating _ov.* so the
  // "INVESTED TOTAL" numbers snap to Overview's authoritative figure.
  document.addEventListener("wf-overview-flows-ready", function () {
    if (typeof renderInvestmentSplitChart === "function") renderInvestmentSplitChart();
    if (typeof renderInstrumentSplitChart === "function") renderInstrumentSplitChart();
    renderValueChart();
  });

  // Wire the Portfolio Split card's Portfolio/Region toggle.
  (function () {
    var card = document.getElementById("investment-split-card");
    if (!card) return;
    var buttons = card.querySelectorAll("[data-isc-mode]");
    var savedMode = getIscMode();
    buttons.forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.iscMode === savedMode);
      btn.addEventListener("click", function () {
        var mode = btn.dataset.iscMode;
        localStorage.setItem(ISC_MODE_KEY, mode);
        buttons.forEach(function (b) { b.classList.toggle("active", b === btn); });
        renderInvestmentSplitChart();
      });
    });
  })();

  // ── Monthly Cash Flow chart (Income / Investment / Expense) ──────────────
  var __mcfChart;
  var __mcfYear;
  var __mcfAllTime = true;
  var __mcfData; // { byMonth: { "YYYY-MM": { income, expense, investment } }, yearList }

  function buildMcfInvestmentByMonth() {
    // Use the already-built Monthly Investment data to avoid duplication
    var result = {};
    if (__monthlyInvestCatData && __monthlyInvestCatData.byMonthCat) {
      var byMonthCat = __monthlyInvestCatData.byMonthCat;
      Object.keys(byMonthCat).forEach(function(ym) {
        var cats = byMonthCat[ym];
        var total = 0;
        Object.keys(cats).forEach(function(cat) { total += cats[cat] || 0; });
        if (total > 0) result[ym] = total;
      });
    }
    return result;
  }

  function renderMonthlyCashFlow() {
    var statusEl = document.getElementById("mcf-status");
    var yearSel = document.getElementById("mcf-year");
    if (typeof Chart === "undefined") return;

    // Use the same records already loaded by the expense tab (dashExpState.records)
    // so income/expense figures match exactly what the expense tab shows.
    var expRecords = (window.dashExpState && window.dashExpState.records) || [];

    var investByMonth = buildMcfInvestmentByMonth();
    var byMonth = {};

    expRecords.forEach(function(r) {
      if (!r.txn_date || !r.amount) return;
      var ym = String(r.txn_date).slice(0, 7);
      if (!byMonth[ym]) byMonth[ym] = { income: 0, expense: 0, investment: 0 };
      var amt = parseFloat(r.amount) || 0;
      if (r.type === "income") byMonth[ym].income += amt;
      else if (r.type === "expense") byMonth[ym].expense += amt;
      // "budget" type is kept separate; not counted in income or expense
    });

    // Merge investment data
    Object.keys(investByMonth).forEach(function(ym) {
      if (!byMonth[ym]) byMonth[ym] = { income: 0, expense: 0, investment: 0 };
      byMonth[ym].investment += investByMonth[ym];
    });

    // Build year list ONLY from years that have expense/income records,
    // and only from 2026 onwards.
    var yearSet = {};
    Object.keys(byMonth).forEach(function(ym) {
      if (ym < "2026-01") return;
      if (byMonth[ym].income > 0 || byMonth[ym].expense > 0) yearSet[ym.slice(0,4)] = 1;
    });
    var yearList = Object.keys(yearSet).sort();
    __mcfData = { byMonth: byMonth, yearList: yearList };

    if (!yearList.length) {
      if (statusEl) statusEl.textContent = "No expense records yet.";
      return;
    }
    if (!__mcfYear || yearList.indexOf(__mcfYear) < 0) __mcfYear = yearList[yearList.length - 1];
    if (yearSel) {
      var existing = [];
      for (var oi = 0; oi < yearSel.options.length; oi++) existing.push(yearSel.options[oi].value);
      if (existing.join(",") !== yearList.join(",")) {
        yearSel.innerHTML = yearList.map(function(y){ return '<option value="'+y+'">'+y+'</option>'; }).join("");
      }
      yearSel.value = __mcfYear;
      yearSel.style.display = __mcfAllTime ? "none" : "";
      yearSel.onchange = function() {
        __mcfYear = yearSel.value;
        _drawMcfChart();
      };
    }
    var allBtn = document.getElementById("mcf-alltime");
    if (allBtn) {
      allBtn.classList.toggle("active", !!__mcfAllTime);
      allBtn.onclick = function() {
        __mcfAllTime = !__mcfAllTime;
        allBtn.classList.toggle("active", !!__mcfAllTime);
        if (yearSel) yearSel.style.display = __mcfAllTime ? "none" : "";
        _drawMcfChart();
      };
    }
    _drawMcfChart();
  }

  window.renderMonthlyCashFlow = renderMonthlyCashFlow;

  function _drawMcfChart() {
    var MON_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    var wrap = document.getElementById("mcf-wrap");
    var statsEl = document.getElementById("mcf-stats");
    var legendEl = document.getElementById("mcf-legend");
    if (!wrap || typeof Chart === "undefined" || !__mcfData) return;

    var byMonth = __mcfData.byMonth;
    var yearList = __mcfData.yearList;

    // Determine month keys and labels
    var monthKeys, labels;
    if (__mcfAllTime && yearList.length) {
      var allKeys = Object.keys(byMonth).sort();
      if (allKeys.length) {
        var first = allKeys[0], last = allKeys[allKeys.length - 1];
        // Bound the range to months that actually have income/expense records
        // (ignore investment-only months like a 2024-only investment history).
        var expKeys = allKeys.filter(function(k) {
          return k >= "2026-01" && byMonth[k] && (byMonth[k].income > 0 || byMonth[k].expense > 0);
        });
        if (expKeys.length) {
          first = expKeys[0];
          last = expKeys[expKeys.length - 1];
        }
        monthKeys = []; labels = [];
        var cy = parseInt(first.slice(0,4)), cm = parseInt(first.slice(5,7));
        var ey = parseInt(last.slice(0,4)), em = parseInt(last.slice(5,7));
        while (cy < ey || (cy === ey && cm <= em)) {
          var ym = cy + "-" + String(cm).padStart(2,"0");
          monthKeys.push(ym);
          labels.push(MON_LABELS[cm-1] + " " + String(cy).slice(2));
          cm++; if (cm > 12) { cm = 1; cy++; }
        }
      } else { monthKeys = []; labels = []; }
    } else {
      var yr = __mcfYear || (yearList[yearList.length - 1]);
      monthKeys = []; labels = [];
      for (var m = 1; m <= 12; m++) {
        var ym2 = yr + "-" + String(m).padStart(2,"0");
        monthKeys.push(ym2); labels.push(MON_LABELS[m-1]);
      }
    }

    var COL_INCOME = "#52B788";     // green
    var COL_INVEST = "#3B82F6";     // blue
    var COL_EXPENSE = "#E8623A";    // coral/red

    var incomeData = monthKeys.map(function(k){ return (byMonth[k] && byMonth[k].income) || 0; });
    var investData = monthKeys.map(function(k){ return (byMonth[k] && byMonth[k].investment) || 0; });
    var expenseData = monthKeys.map(function(k){ return (byMonth[k] && byMonth[k].expense) || 0; });

    var totalIncome = incomeData.reduce(function(a,b){return a+b;},0);
    var totalInvest = investData.reduce(function(a,b){return a+b;},0);
    var totalExpense = expenseData.reduce(function(a,b){return a+b;},0);

    function fmtC(v) {
      if (v >= 1e7) return "₹" + (v/1e7).toFixed(1) + "Cr";
      if (v >= 1e5) return "₹" + (v/1e5).toFixed(1) + "L";
      if (v >= 1e3) return "₹" + (v/1e3).toFixed(0) + "k";
      return "₹" + Math.round(v);
    }

    // Stats row
    if (statsEl) {
      var stats = [
        { label: "Income", value: fmtC(totalIncome), cls: "positive" },
        { label: "Invested", value: fmtC(totalInvest), cls: "" },
        { label: "Expenses", value: fmtC(totalExpense), cls: totalExpense > 0 ? "negative" : "" }
      ];
      statsEl.innerHTML = stats.map(function(s){
        return '<div class="mic-stat"><span class="mic-stat-label">'+s.label+'</span>'
          +'<span class="mic-stat-value '+s.cls+'">'+s.value+'</span></div>';
      }).join("");
    }

    // Legend
    if (legendEl) {
      legendEl.innerHTML = [
        { color: COL_INCOME, label: "Income" },
        { color: COL_INVEST, label: "Invested" },
        { color: COL_EXPENSE, label: "Expenses" }
      ].map(function(l){
        return '<div class="mic-legend-item"><span class="mic-legend-bar" style="background:'+l.color+'"></span>'+l.label+'</div>';
      }).join("");
    }

    // Destroy and recreate canvas (nuclear fix)
    if (__mcfChart) { try { __mcfChart.destroy(); } catch(e) {} }
    wrap.innerHTML = "";
    var canvas = document.createElement("canvas");
    wrap.appendChild(canvas);

    try {
      __mcfChart = new Chart(canvas, {
        type: "bar",
        data: {
          labels: labels,
          datasets: [
            { label: "Income", data: incomeData, backgroundColor: COL_INCOME + "CC", borderWidth: 0, borderRadius: 3 },
            { label: "Invested", data: investData, backgroundColor: COL_INVEST + "CC", borderWidth: 0, borderRadius: 3 },
            { label: "Expenses", data: expenseData, backgroundColor: COL_EXPENSE + "CC", borderWidth: 0, borderRadius: 3 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function(ctx) { return ctx.dataset.label + ": " + fmtC(ctx.parsed.y); }
              }
            }
          },
          scales: {
            x: { stacked: false, grid: { display: false }, ticks: { font: { size: 11 } } },
            y: {
              beginAtZero: true,
              grid: { color: "rgba(0,0,0,0.05)" },
              ticks: { font: { size: 11 }, callback: function(v) {
                var abs = Math.abs(v);
                if (abs >= 1e5) return (v/1e5).toFixed(abs % 1e5 === 0 ? 0 : 1) + "L";
                if (abs >= 1e3) return (v/1e3).toFixed(0) + "k";
                return v;
              }}
            }
          }
        }
      });
    } catch(e) {
      var st = document.getElementById("mcf-status");
      if (st) st.textContent = "Chart error: " + e.message;
    }
  }

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

  // Returns a Promise<number> giving the INR-converted invested amount for the
  // stocksetf sheet under a given portfolio filter (US lots × historical
  // USD/INR rate from stock_prices.json).
  function computeStocksEtfInvestmentINR(portfolioFilter) {
    var info = computeStocksEtfInvestmentByRegion(portfolioFilter);
    return info.promise.then(function (r) { return (r.India || 0) + (r.US || 0); });
  }

  // Overview's authoritative "Invested" total (built by updateDashboardStats).
  // May return null on very early first render before _ov is populated.
  function getOverviewInvestedTotal() {
    if (typeof _ov === "undefined" || !_ov) return null;
    var fiEx = isFixedIncomeExcluded();
    var fi = fiEx ? 0 : (_ov.fiInvested || 0);
    var comm = fiEx ? 0 : (_ov.commInvested || 0);
    var total = (_ov.mfInvested || 0) + (_ov.seInvested || 0) + fi + comm;
    return total > 0 ? total : null;
  }
  // Overview's authoritative "Current" total (live prices + interest accrual).
  function getOverviewCurrentTotal() {
    if (typeof _ov === "undefined" || !_ov) return null;
    var fiEx = isFixedIncomeExcluded();
    var fi = fiEx ? 0 : (_ov.fiCurrent || 0);
    var comm = fiEx ? 0 : (_ov.commCurrent || 0);
    var seCurrent = _ov.seCurrent > 0 ? _ov.seCurrent : (_ov.seInvested || 0);
    var total = (_ov.mfCurrent || 0) + seCurrent + fi + comm;
    return total > 0 ? total : null;
  }

  var ISC_MODE_KEY = "wf-isc-mode";
  function getIscMode() { return localStorage.getItem(ISC_MODE_KEY) === "region" ? "region" : "portfolio"; }

  // Region split for Stocks/ETF using the stocksetfmapping "Region" column.
  // Returns { syncRegions, promise } — syncRegions gives immediate values
  // (US in USD-not-yet-INR); promise resolves with INR-converted US using
  // historical USD/INR rates from stock_prices.json.
  function computeStocksEtfInvestmentByRegion(portfolioFilter) {
    var rows = getSheetRows("stocksetf");
    var syncOut = { India: 0, US: 0 };
    var lotsByRegion = { India: [], US: [] };
    if (!rows) return { sync: syncOut, promise: Promise.resolve(syncOut) };
    var mapping = buildStockMappingTable();
    var byInst = groupUnitTransactionsByInstrument(rows, portfolioFilter);
    if (!byInst) return { sync: syncOut, promise: Promise.resolve(syncOut) };
    Object.keys(byInst).forEach(function (instrument) {
      var m = mapping[normalizeText(instrument)];
      var region = (m && m.region) || "India";
      // FIFO remaining lots with dates (needed for historical USD/INR lookup).
      var buyQueue = [];
      byInst[instrument].forEach(function (txn) {
        if (txn.type === "buy") { buyQueue.push({ units: txn.units, price: txn.price, date: txn.date }); return; }
        var toMatch = txn.units;
        while (toMatch > 0 && buyQueue.length) {
          var head = buyQueue[0];
          var matched = Math.min(toMatch, head.units);
          head.units -= matched; toMatch -= matched;
          if (head.units <= 0) buyQueue.shift();
        }
      });
      buyQueue.forEach(function (lot) {
        lotsByRegion[region === "US" ? "US" : "India"].push(lot);
        syncOut[region === "US" ? "US" : "India"] += lot.units * lot.price;
      });
    });
    var promise = fetchAllStockPrices()
      .catch(function () { return { usd_inr_history: {} }; })
      .then(function (data) {
        var rateMap = (data && data.usd_inr_history) || {};
        var indiaInr = 0, usInr = 0;
        lotsByRegion.India.forEach(function (lot) { indiaInr += lot.units * lot.price; });
        lotsByRegion.US.forEach(function (lot) {
          var rate = rateMap[formatDateISO(lot.date)] || 84;
          usInr += lot.units * lot.price * rate;
        });
        return { India: indiaInr, US: usInr };
      });
    return { sync: syncOut, promise: promise };
  }

  function renderInvestmentSplitChart() {
    var statusEl = document.getElementById("portfolio-split-status");
    if (!statusEl) return;

    // Same sheet coverage as the Overview's Total Investment: MF, Stocks/ETF,
    // Fixed Income (EPF) and FD — the latter two dropped when FI is excluded.
    var fiExcluded = isFixedIncomeExcluded();
    var prefixes = fiExcluded ? ["equity", "stocksetf"] : ["equity", "stocksetf", "fixedincome", "fd"];
    var mode = getIscMode();
    var titleEl = document.getElementById("isc-title");
    if (titleEl) titleEl.textContent = mode === "region" ? "Region Split" : "Portfolio Split";

    if (mode === "region") { _renderRegionSplit(prefixes, fiExcluded, statusEl); return; }

    var names = collectPortfolioNamesFromSheets(prefixes);
    if (!names.length) {
      statusEl.textContent = "No portfolios found yet. Connect your transaction sheets in Settings.";
      if (window.__wfSplitChart) { window.__wfSplitChart.destroy(); window.__wfSplitChart = null; }
      return;
    }

    var investedByName = {};
    var commodityByName = {}; // per-portfolio commodity invested (joins asynchronously)
    var namedSum = 0;
    names.forEach(function (name) {
      var invested = computeTotalInvestment(name, prefixes);
      if (invested > UNITS_EPSILON) {
        investedByName[name] = invested;
        namedSum += invested;
      }
    });

    // Instrument-category breakdown for one portfolio → sub-line under its name
    function portfolioCatSubline(name) {
      if (name === "Unassigned") return "";
      var eq = computeTotalInvestment(name, ["equity", "stocksetf"]);
      var fi = fiExcluded ? 0 : computeTotalInvestment(name, ["fixedincome", "fd"]);
      var comm = fiExcluded ? 0 : (commodityByName[name] || 0);
      var parts = [
        { label: "Equity", value: eq, color: "#10B981" },
        { label: "Fixed Income", value: fi, color: "#3B82F6" },
        { label: "Commodity", value: comm, color: "#F59E0B" }
      ].filter(function (p) { return p.value > UNITS_EPSILON; });
      var sum = parts.reduce(function (s, p) { return s + p.value; }, 0);
      if (sum <= 0) return "";
      return parts.map(function (p) {
        var pc = (p.value / sum) * 100;
        var pcStr = (pc >= 10 ? pc.toFixed(0) : pc.toFixed(1)) + "%";
        return '<span class="isc-cat-chip"><span class="isc-cat-dot" style="background:' + p.color + '"></span>' +
          p.label + ' ' + pcStr + '</span>';
      }).join("");
    }
    // Reconcile to the overview's "all" figure: blank-portfolio rows become an
    // Unassigned slice; a small negative remainder (per-portfolio FIFO cost
    // matching vs "all") is scaled away so both totals agree exactly.
    var allTotal = computeTotalInvestment("all", prefixes);
    var unassigned = allTotal - namedSum;
    if (unassigned > UNITS_EPSILON) {
      investedByName["Unassigned"] = unassigned;
    } else if (unassigned < -UNITS_EPSILON && namedSum > 0) {
      var scale = allTotal / namedSum;
      Object.keys(investedByName).forEach(function (n) { investedByName[n] *= scale; });
    }

    function drawSplitPie() {
      var barEl = document.getElementById("isc-bar");
      var listEl = document.getElementById("isc-list");
      var totalEl = document.getElementById("isc-total-value");
      var eyebrowEl = document.getElementById("isc-eyebrow-text");
      if (!barEl || !listEl || !totalEl) return;

      var entries = Object.keys(investedByName)
        .map(function (n) { return { name: n, value: investedByName[n] }; })
        .filter(function (e) { return e.value > UNITS_EPSILON; })
        .sort(function (a, b) { return b.value - a.value; });

      if (!entries.length) {
        statusEl.textContent = "No invested amount found yet across your portfolios.";
        barEl.innerHTML = "";
        listEl.innerHTML = "";
        totalEl.textContent = "—";
        return;
      }
      // Reconcile to Overview's authoritative Invested total (single source of
      // truth). Scale per-portfolio slices proportionally so the sum matches.
      var rawSum = entries.reduce(function (s, e) { return s + e.value; }, 0);
      var overviewTotal = getOverviewCurrentTotal();
      if (overviewTotal && rawSum > 0 && Math.abs(overviewTotal - rawSum) > 100) {
        var s = overviewTotal / rawSum;
        entries.forEach(function (e) { e.value *= s; });
      }
      var total = entries.reduce(function (s, e) { return s + e.value; }, 0);

      // Palette: green, orange, blue, purple, teal, pink, amber, indigo …
      var PALETTE = [
        { bar: "#10B981", tint: "#D1FAE5", ink: "#065F46" }, // green
        { bar: "#F59E0B", tint: "#FEF3C7", ink: "#B45309" }, // orange
        { bar: "#3B82F6", tint: "#DBEAFE", ink: "#1E40AF" }, // blue
        { bar: "#8B5CF6", tint: "#EDE9FE", ink: "#5B21B6" }, // purple
        { bar: "#06B6D4", tint: "#CFFAFE", ink: "#0E7490" }, // teal
        { bar: "#EC4899", tint: "#FCE7F3", ink: "#9D174D" }, // pink
        { bar: "#84CC16", tint: "#ECFCCB", ink: "#3F6212" }, // lime
        { bar: "#6366F1", tint: "#E0E7FF", ink: "#3730A3" }  // indigo
      ];

      if (eyebrowEl) {
        eyebrowEl.textContent = "INVESTED SPLIT · " + entries.length + " PORTFOLIO" + (entries.length === 1 ? "" : "S");
      }
      totalEl.textContent = formatCurrency(total);

      // Segmented bar
      barEl.innerHTML = entries.map(function (e, i) {
        var pct = (e.value / total) * 100;
        var col = PALETTE[i % PALETTE.length];
        return '<span class="isc-bar-seg" style="flex:' + pct + ' 0 0;background:' + col.bar + ';" title="' + e.name.replace(/"/g, '&quot;') + '"></span>';
      }).join("");

      // Portfolio rows
      listEl.innerHTML = entries.map(function (e, i) {
        var pct = (e.value / total) * 100;
        var col = PALETTE[i % PALETTE.length];
        var initial = (e.name.trim().charAt(0) || "?").toUpperCase();
        var pctStr = (pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)) + "%";
        return '<div class="isc-row">' +
          '<div class="isc-avatar" style="background:' + col.tint + ';color:' + col.ink + ';">' + initial + '</div>' +
          '<div class="isc-row-body">' +
            '<div class="isc-row-name">' + e.name + '</div>' +
            '<div class="isc-row-sub isc-cat-sub">' + portfolioCatSubline(e.name) + '</div>' +
          '</div>' +
          '<div class="isc-row-nums">' +
            '<div class="isc-row-amount">' + formatCurrency(e.value) + '</div>' +
            '<div class="isc-row-pct" style="color:' + col.bar + ';">' + pctStr + '</div>' +
          '</div>' +
        '</div>';
      }).join("");

      statusEl.textContent = "";
    }
    drawSplitPie();

    // US stocks/ETF INR conversion joins asynchronously. Replace the raw
    // stocksetf portion of each portfolio's total with the historical
    // USD/INR-adjusted value so US positions aren't undercounted.
    (function applyStocksEtfInrConversion() {
      var portfolios = Object.keys(investedByName);
      Promise.all(portfolios.map(function (name) {
        var raw = computeTotalInvestment(name, ["stocksetf"]);
        return computeStocksEtfInvestmentINR(name).then(function (inr) {
          return { name: name, delta: inr - raw };
        }).catch(function () { return null; });
      })).then(function (results) {
        var changed = false;
        results.forEach(function (r) {
          if (r && Math.abs(r.delta) > 0.01) {
            investedByName[r.name] = (investedByName[r.name] || 0) + r.delta;
            changed = true;
          }
        });
        if (changed) drawSplitPie();
      });
    })();

    // Commodity (gold) invested amounts join asynchronously, mirroring the overview
    if (!fiExcluded) {
      var fdRowsPie = getSheetRows("fd");
      var uniqueDatesPie = fdRowsPie ? collectCommodityUniqueDates(fdRowsPie, "all") : [];
      if (fdRowsPie && fdRowsPie.length) {
        Promise.all([
          fetchGoldPriceINRPerGram().catch(function () { return null; }),
          Promise.all(uniqueDatesPie.map(function (d) {
            return fetchXauInrForDate(d).then(function (p) { return { dateStr: d, price: p }; }).catch(function () { return { dateStr: d, price: null }; });
          }))
        ]).then(function (results) {
          var goldPrice = results[0];
          if (!goldPrice) return;
          var histPrices = {};
          results[1].forEach(function (r) { if (r.price) histPrices[r.dateStr] = r.price; });
          var commHoldings = buildCommodityHoldingsList(fdRowsPie, "all", goldPrice, histPrices) || [];
          var added = false;
          commHoldings.forEach(function (h) {
            if (!(h.invested > UNITS_EPSILON)) return;
            var name = (h.portfolio || "").trim() || "Unassigned";
            investedByName[name] = (investedByName[name] || 0) + h.invested;
            commodityByName[name] = (commodityByName[name] || 0) + h.invested;
            added = true;
          });
          if (added) drawSplitPie();
        });
      }
    }
  }

  function _renderRegionSplit(prefixes, fiExcluded, statusEl) {
    var selected = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
    var barEl = document.getElementById("isc-bar");
    var listEl = document.getElementById("isc-list");
    var totalEl = document.getElementById("isc-total-value");
    if (!barEl || !listEl || !totalEl) return;

    // MF + Fixed Income + FD (if not excluded) → India.
    // Stocks/ETF split by mapping Region column (US uses USD → INR at
    // historical per-lot rates once stock_prices.json resolves).
    var mfInvested = computeTotalInvestment(selected, ["equity"]);
    var fiInvested = fiExcluded ? 0 : computeTotalInvestment(selected, ["fixedincome", "fd"]);
    var seRegionInfo = computeStocksEtfInvestmentByRegion(selected);

    var investedByRegion = {
      "India": mfInvested + fiInvested + seRegionInfo.sync.India,
      "US":    seRegionInfo.sync.US
    };

    seRegionInfo.promise.then(function (inr) {
      investedByRegion["India"] = mfInvested + fiInvested + inr.India;
      investedByRegion["US"] = inr.US;
      draw();
    }).catch(function () {});

    var REGION_META = {
      "India": { bar: "#10B981", tint: "#D1FAE5", ink: "#065F46", flag: "🇮🇳" },
      "US":    { bar: "#6366F1", tint: "#E0E7FF", ink: "#3730A3", flag: "🇺🇸" }
    };

    function draw() {
      var entries = Object.keys(investedByRegion)
        .map(function (r) { return { name: r, value: investedByRegion[r] }; })
        .filter(function (e) { return e.value > UNITS_EPSILON; })
        .sort(function (a, b) { return b.value - a.value; });
      if (!entries.length) {
        statusEl.textContent = "No invested amount found yet.";
        barEl.innerHTML = ""; listEl.innerHTML = ""; totalEl.textContent = "—";
        return;
      }
      var total = entries.reduce(function (s, e) { return s + e.value; }, 0);
      totalEl.textContent = formatCurrency(total);
      barEl.innerHTML = entries.map(function (e) {
        var pct = (e.value / total) * 100;
        var meta = REGION_META[e.name] || REGION_META["India"];
        return '<span class="isc-bar-seg" style="flex:' + pct + ' 0 0;background:' + meta.bar + ';" title="' + e.name + '"></span>';
      }).join("");
      listEl.innerHTML = entries.map(function (e) {
        var pct = (e.value / total) * 100;
        var meta = REGION_META[e.name] || REGION_META["India"];
        var pctStr = (pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)) + "%";
        return '<div class="isc-row">' +
          '<div class="isc-avatar" style="background:' + meta.tint + ';color:' + meta.ink + ';font-size:0.85rem;">' + meta.flag + '</div>' +
          '<div class="isc-row-body">' +
            '<div class="isc-row-name">' + e.name + '</div>' +
          '</div>' +
          '<div class="isc-row-nums">' +
            '<div class="isc-row-amount">' + formatCurrency(e.value) + '</div>' +
            '<div class="isc-row-pct" style="color:' + meta.bar + ';">' + pctStr + '</div>' +
          '</div>' +
        '</div>';
      }).join("");
      statusEl.textContent = "";
    }
    draw();

    // Fold in commodity (gold) as India once historical prices resolve.
    if (!fiExcluded) {
      var fdRows = getSheetRows("fd");
      if (fdRows && fdRows.length) {
        var uniqueDates = collectCommodityUniqueDates(fdRows, "all");
        Promise.all([
          fetchGoldPriceINRPerGram().catch(function () { return null; }),
          Promise.all(uniqueDates.map(function (d) {
            return fetchXauInrForDate(d).then(function (p) { return { dateStr: d, price: p }; }).catch(function () { return { dateStr: d, price: null }; });
          }))
        ]).then(function (results) {
          var goldPrice = results[0]; if (!goldPrice) return;
          var histPrices = {}; results[1].forEach(function (r) { if (r.price) histPrices[r.dateStr] = r.price; });
          var commHoldings = buildCommodityHoldingsList(fdRows, selected, goldPrice, histPrices) || [];
          var extra = 0;
          commHoldings.forEach(function (h) { if (h.invested > UNITS_EPSILON) extra += h.invested; });
          if (extra > 0) { investedByRegion["India"] += extra; draw(); }
        });
      }
    }
  }

  // Split invested value across instrument categories (Equity, Fixed Income,
  // Commodity) using the same sources as the Overview, so the totals reconcile.
  function renderInstrumentSplitChart() {
    var statusEl = document.getElementById("instrument-split-status");
    var barEl = document.getElementById("iscat-bar");
    var listEl = document.getElementById("iscat-list");
    var totalEl = document.getElementById("iscat-total-value");
    var eyebrowEl = document.getElementById("iscat-eyebrow-text");
    if (!statusEl || !barEl || !listEl || !totalEl) return;

    // Category Split always covers ALL portfolios so its total reconciles with
    // Portfolio Split (which also uses "all"). Ignoring the header filter here.
    var selected = "all";
    var fiExcluded = isFixedIncomeExcluded();

    // Category → color + display icon
    var CATS = [
      { key: "Equity",       bar: "#10B981", tint: "#D1FAE5", ink: "#065F46", icon: "📈" },
      { key: "Fixed Income", bar: "#3B82F6", tint: "#DBEAFE", ink: "#1E40AF", icon: "🏦" },
      { key: "Commodity",    bar: "#F59E0B", tint: "#FEF3C7", ink: "#B45309", icon: "🪙" }
    ];

    var investedByCat = {
      "Equity": computeTotalInvestment(selected, ["equity", "stocksetf"]),
      "Fixed Income": fiExcluded ? 0 : computeTotalInvestment(selected, ["fixedincome", "fd"]),
      "Commodity": 0
    };

    // Per-portfolio splits within each category — populated below and refreshed
    // when the async commodity data joins. Rendered as chips under each row.
    var perCat = { "Equity": {}, "Fixed Income": {}, "Commodity": {} };
    // Palette shared with Portfolio Split for stable per-portfolio colors
    var PORTF_PALETTE = ["#10B981", "#F59E0B", "#3B82F6", "#8B5CF6", "#06B6D4", "#EC4899", "#84CC16", "#6366F1"];
    var portfolioColor = {};

    var portfolioPrefixes = fiExcluded ? ["equity", "stocksetf"] : ["equity", "stocksetf", "fixedincome", "fd"];
    var portfolioNames = (selected === "all") ? collectPortfolioNamesFromSheets(portfolioPrefixes) : [selected];
    // Rank portfolios by total investment (desc) so color assignment matches Portfolio Split
    var ranked = portfolioNames
      .map(function (n) { return { name: n, total: computeTotalInvestment(n, portfolioPrefixes) }; })
      .filter(function (p) { return p.total > UNITS_EPSILON; })
      .sort(function (a, b) { return b.total - a.total; });
    ranked.forEach(function (p, i) { portfolioColor[p.name] = PORTF_PALETTE[i % PORTF_PALETTE.length]; });

    portfolioNames.forEach(function (n) {
      var eq = computeTotalInvestment(n, ["equity", "stocksetf"]);
      if (eq > UNITS_EPSILON) perCat["Equity"][n] = eq;
      if (!fiExcluded) {
        var fi = computeTotalInvestment(n, ["fixedincome", "fd"]);
        if (fi > UNITS_EPSILON) perCat["Fixed Income"][n] = fi;
      }
    });

    // Adjust Equity per-portfolio + total by INR-converting US stocks/ETFs.
    (function applyEquityInrConversion() {
      Promise.all(portfolioNames.map(function (n) {
        var raw = computeTotalInvestment(n, ["stocksetf"]);
        return computeStocksEtfInvestmentINR(n).then(function (inr) {
          return { name: n, delta: inr - raw };
        }).catch(function () { return null; });
      })).then(function (results) {
        var totalDelta = 0, changed = false;
        results.forEach(function (r) {
          if (r && Math.abs(r.delta) > 0.01) {
            perCat["Equity"][r.name] = (perCat["Equity"][r.name] || 0) + r.delta;
            totalDelta += r.delta;
            changed = true;
          }
        });
        if (changed) {
          investedByCat["Equity"] += totalDelta;
          draw();
        }
      });
    })();

    function portfolioChipsForCat(catKey) {
      var byName = perCat[catKey] || {};
      var names = Object.keys(byName).sort(function (a, b) { return byName[b] - byName[a]; });
      var sum = names.reduce(function (s, n) { return s + byName[n]; }, 0);
      if (sum <= 0) return "";
      return names.map(function (n) {
        var pc = (byName[n] / sum) * 100;
        var pcStr = (pc >= 10 ? pc.toFixed(0) : pc.toFixed(1)) + "%";
        var color = portfolioColor[n] || "#94A3B8";
        return '<span class="isc-cat-chip"><span class="isc-cat-dot" style="background:' + color + '"></span>' +
          n + ' ' + pcStr + '</span>';
      }).join("");
    }

    function draw() {
      var entries = CATS
        .map(function (c) { return { name: c.key, value: investedByCat[c.key] || 0, meta: c }; })
        .filter(function (e) { return e.value > UNITS_EPSILON; })
        .sort(function (a, b) { return b.value - a.value; });

      if (!entries.length) {
        statusEl.textContent = "No invested amount found yet.";
        barEl.innerHTML = ""; listEl.innerHTML = ""; totalEl.textContent = "—";
        return;
      }
      // Reconcile to Overview's Invested total.
      var rawSum = entries.reduce(function (s, e) { return s + e.value; }, 0);
      var overviewTotal = getOverviewCurrentTotal();
      if (overviewTotal && rawSum > 0 && Math.abs(overviewTotal - rawSum) > 100) {
        var scl = overviewTotal / rawSum;
        entries.forEach(function (e) { e.value *= scl; });
      }
      var total = entries.reduce(function (s, e) { return s + e.value; }, 0);

      if (eyebrowEl) {
        eyebrowEl.textContent = "ASSET SPLIT · " + entries.length + " CATEGOR" + (entries.length === 1 ? "Y" : "IES");
      }
      totalEl.textContent = formatCurrency(total);

      barEl.innerHTML = entries.map(function (e) {
        var pct = (e.value / total) * 100;
        return '<span class="isc-bar-seg" style="flex:' + pct + ' 0 0;background:' + e.meta.bar + ';" title="' + e.name + '"></span>';
      }).join("");

      // Subtract commodity from Fixed Income per portfolio (fd sheet holds both)
      var fiAdjusted = {};
      Object.keys(perCat["Fixed Income"]).forEach(function (n) {
        var v = perCat["Fixed Income"][n] - (perCat["Commodity"][n] || 0);
        if (v > UNITS_EPSILON) fiAdjusted[n] = v;
      });
      var _origFI = perCat["Fixed Income"];
      perCat["Fixed Income"] = fiAdjusted;

      listEl.innerHTML = entries.map(function (e) {
        var pct = (e.value / total) * 100;
        var pctStr = (pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)) + "%";
        return '<div class="isc-row">' +
          '<div class="isc-avatar" style="background:' + e.meta.tint + ';color:' + e.meta.ink + ';">' + e.meta.icon + '</div>' +
          '<div class="isc-row-body">' +
            '<div class="isc-row-name">' + e.name + '</div>' +
            '<div class="isc-row-sub isc-cat-sub">' + portfolioChipsForCat(e.name) + '</div>' +
          '</div>' +
          '<div class="isc-row-nums">' +
            '<div class="isc-row-amount">' + formatCurrency(e.value) + '</div>' +
            '<div class="isc-row-pct" style="color:' + e.meta.bar + ';">' + pctStr + '</div>' +
          '</div>' +
        '</div>';
      }).join("");

      // Restore for next draw so the subtraction doesn't compound
      perCat["Fixed Income"] = _origFI;
      statusEl.textContent = "";
    }
    draw();

    // Commodity (gold/silver) invested amount joins asynchronously, mirroring the overview
    if (!fiExcluded) {
      var fdRows = getSheetRows("fd");
      var uniqueDates = fdRows ? collectCommodityUniqueDates(fdRows, selected) : [];
      if (fdRows && fdRows.length) {
        Promise.all([
          fetchGoldPriceINRPerGram().catch(function () { return null; }),
          Promise.all(uniqueDates.map(function (d) {
            return fetchXauInrForDate(d).then(function (p) { return { dateStr: d, price: p }; }).catch(function () { return { dateStr: d, price: null }; });
          }))
        ]).then(function (results) {
          var goldPrice = results[0];
          if (!goldPrice) return;
          var histPrices = {};
          results[1].forEach(function (r) { if (r.price) histPrices[r.dateStr] = r.price; });
          var commHoldings = buildCommodityHoldingsList(fdRows, selected, goldPrice, histPrices) || [];
          var commTotal = 0;
          commHoldings.forEach(function (h) {
            if (!(h.invested > UNITS_EPSILON)) return;
            commTotal += h.invested;
            var name = (h.portfolio || "").trim() || "Unassigned";
            perCat["Commodity"][name] = (perCat["Commodity"][name] || 0) + h.invested;
          });
          if (commTotal > UNITS_EPSILON) { investedByCat["Commodity"] = commTotal; draw(); }
        });
      }
    }
  }

  // No initializers: renderMonthlyInvestmentByCategory() runs earlier in this
  // script, and `= null` here would wipe the state it already set.
  var __monthlyInvestCatChart;
  var __monthlyInvestCatData; // { byMonthCat, yearList }
  var __monthlyInvestCatYear;
  var __monthlyInvestCatAllTime = false;
  var __monthlyInvestCatSplit = false; // off = single total bar per month
  var __monthlyInvestCatNet = false; // on = bars show invested minus withdrawn
  var __monthlyInvestCatFilter = null; // split mode: when set, show only this instrument category

  // MON_LABELS and MIC_PALETTE are defined inside drawMonthlyInvestCatChart to avoid hoisting issues

  function buildMonthlyInvestCatData() {
    var instrCatMap = {};
    ["mfmapping", "stocksetfmapping"].forEach(function (mp) {
      var mrows = getSheetRows(mp);
      if (!mrows || mrows.length < 2) return;
      var mhdr = mrows[0].map(normalizeText);
      var miIdx = mhdr.indexOf("instrument name");
      // Prefer "instrument sub category" > "market segment" > "segment" > "category"
      var mcIdx = mhdr.findIndex(function (h) { return h.indexOf("sub category") !== -1 || h === "instrument sub category"; });
      if (mcIdx === -1) mcIdx = mhdr.findIndex(function (h) { return h.indexOf("market segment") !== -1; });
      if (mcIdx === -1) mcIdx = mhdr.findIndex(function (h) { return h.indexOf("segment") !== -1; });
      if (mcIdx === -1) mcIdx = mhdr.findIndex(function (h) { return h.indexOf("category") !== -1; });
      if (miIdx === -1 || mcIdx === -1) return;
      mrows.slice(1).forEach(function (r) {
        var instr = (r[miIdx] || "").trim();
        var cat = (r[mcIdx] || "").trim();
        if (instr && cat) instrCatMap[normalizeText(instr)] = cat;
      });
    });

    var byMonthCat = {};
    var byMonthCatOut = {}; // withdrawals / sells / redemptions
    var allYears = {};
    function addTo(target, d, cat, amount) {
      var yr = String(d.getFullYear());
      var key = yr + "-" + String(d.getMonth() + 1).padStart(2, "0");
      allYears[yr] = true;
      if (!target[key]) target[key] = {};
      target[key][cat] = (target[key][cat] || 0) + amount;
    }
    function isOutType(type) {
      return type.indexOf("sell") !== -1 || type.indexOf("redeem") !== -1 ||
             type.indexOf("redemption") !== -1 || type.indexOf("withdraw") !== -1;
    }
    ["equity", "stocksetf"].forEach(function (prefix) {
      var rows = getSheetRows(prefix);
      if (!rows || rows.length < 2) return;
      var header = rows[0].map(normalizeText);
      var typeIdx = header.indexOf("transaction type");
      var dateIdx = header.indexOf("transaction date");
      var unitsIdx = header.indexOf("units");
      var priceIdx = header.indexOf("price");
      var amtIdx = header.indexOf("amount");
      var instrIdx = header.indexOf("instrument name");
      var subCatIdx = header.indexOf("instrument sub category");
      if (typeIdx === -1 || dateIdx === -1) return;
      if (amtIdx === -1 && (unitsIdx === -1 || priceIdx === -1)) return;
      rows.slice(1).forEach(function (row) {
        var type = normalizeText(row[typeIdx] || "");
        var isBuy = type.indexOf("buy") !== -1;
        var isOut = isOutType(type);
        if (!isBuy && !isOut) return;
        var d = parseFlexibleDate(row[dateIdx]);
        if (!d) return;
        var amount = amtIdx !== -1 ? parseNumber(row[amtIdx]) : (parseNumber(row[unitsIdx]) * parseNumber(row[priceIdx]));
        if (!amount) return;
        var instrName = instrIdx !== -1 ? normalizeText((row[instrIdx] || "").trim()) : "";
        var cat = (instrName && instrCatMap[instrName])
          ? instrCatMap[instrName]
          : (subCatIdx !== -1 && row[subCatIdx] ? (row[subCatIdx] || "").trim() : "Other");
        addTo(isBuy ? byMonthCat : byMonthCatOut, d, cat, Math.abs(amount));
      });
    });

    // Fixed Income: instrument sub category directly, transaction type contains "deposit"
    (function () {
      var rows = getSheetRows("fixedincome");
      if (!rows || rows.length < 2) return;
      var header = rows[0].map(normalizeText);
      var typeIdx   = header.indexOf("transaction type");
      var dateIdx   = header.indexOf("transaction date");
      var amtIdx    = header.indexOf("amount");
      var subCatIdx = header.indexOf("instrument sub category");
      if (typeIdx === -1 || dateIdx === -1 || amtIdx === -1 || subCatIdx === -1) return;
      rows.slice(1).forEach(function (row) {
        var type = normalizeText(row[typeIdx] || "");
        var isDep = type.indexOf("deposit") !== -1;
        var isOut = isOutType(type);
        if (!isDep && !isOut) return;
        var d = parseFlexibleDate(row[dateIdx]);
        if (!d) return;
        var amount = parseNumber(row[amtIdx]);
        if (!amount) return;
        var cat = (row[subCatIdx] || "").trim() || "Fixed Income";
        addTo(isDep ? byMonthCat : byMonthCatOut, d, cat, Math.abs(amount));
      });
    }());

    // FD sheet: use invested amount, any row with sub category, no type filter needed (each row = one deposit)
    (function () {
      var rows = getSheetRows("fd");
      if (!rows || rows.length < 2) return;
      var header = rows[0].map(normalizeText);
      var dateIdx   = header.indexOf("transaction date");
      var amtIdx    = header.indexOf("invested amount");
      if (amtIdx === -1) amtIdx = header.indexOf("amount");
      var subCatIdx = header.indexOf("instrument sub category");
      var typeIdx   = header.indexOf("transaction type");
      if (dateIdx === -1 || amtIdx === -1 || subCatIdx === -1) return;
      rows.slice(1).forEach(function (row) {
        var isOut = false;
        if (typeIdx !== -1) {
          var type = normalizeText(row[typeIdx] || "");
          isOut = isOutType(type);
          if (!isOut && type && type.indexOf("deposit") === -1 && type.indexOf("invest") === -1 && type.indexOf("buy") === -1) return;
        }
        var d = parseFlexibleDate(row[dateIdx]);
        if (!d) return;
        var amount = parseNumber(row[amtIdx]);
        if (!amount) return;
        var cat = (row[subCatIdx] || "").trim() || "Fixed Deposit";
        addTo(isOut ? byMonthCatOut : byMonthCat, d, cat, Math.abs(amount));
      });
    }());

    return { byMonthCat: byMonthCat, byMonthCatOut: byMonthCatOut, yearList: Object.keys(allYears).sort() };
  }

  function drawMonthlyInvestCatChart(yr) {
    var MON_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    var MIC_PALETTE = ["#3B82F6","#10B981","#F59E0B","#8B5CF6","#EF4444","#06B6D4","#EC4899","#84CC16","#F97316","#6366F1"];
    var MIC_GREEN = "#52B788"; var MIC_GREEN_PEAK = "#1B6E45"; var MIC_RED = "#E8623A";
    // Warm palette for split-by-instrument mode (matches screenshot)
    var MIC_SPLIT_PALETTE = ["#E8623A","#F5A623","#4DC0B5","#8B5CF6","#3B82F6","#10B981","#EC4899","#84CC16"];
    var wrap = document.getElementById("monthly-invest-cat-wrap");
    var statusEl = document.getElementById("monthly-invest-cat-status");
    if (!wrap || typeof Chart === "undefined" || !__monthlyInvestCatData) return;
    try {
    var byMonthCat = __monthlyInvestCatData.byMonthCat;
    var byMonthCatOut = __monthlyInvestCatData.byMonthCatOut || {};

    // Month keys and axis labels for the requested view:
    // all-time = every month from the first investment to the last,
    // yearly   = Jan..Dec of the selected year.
    var monthKeys = [];
    var labels = [];
    if (yr === "all") {
      var sortedKeys = Object.keys(byMonthCat).concat(Object.keys(byMonthCatOut)).sort();
      if (sortedKeys.length) {
        var first = sortedKeys[0].split("-"), last = sortedKeys[sortedKeys.length - 1].split("-");
        var cur = new Date(parseInt(first[0], 10), parseInt(first[1], 10) - 1, 1);
        var end = new Date(parseInt(last[0], 10), parseInt(last[1], 10) - 1, 1);
        while (cur <= end) {
          monthKeys.push(cur.getFullYear() + "-" + String(cur.getMonth() + 1).padStart(2, "0"));
          labels.push(MON_LABELS[cur.getMonth()] + " '" + String(cur.getFullYear()).slice(2));
          cur.setMonth(cur.getMonth() + 1);
        }
      }
    } else {
      for (var mi = 0; mi < 12; mi++) {
        monthKeys.push(yr + "-" + String(mi + 1).padStart(2, "0"));
        labels.push(MON_LABELS[mi]);
      }
    }

    var allCats = {};
    monthKeys.forEach(function (k) {
      if (byMonthCat[k]) Object.keys(byMonthCat[k]).forEach(function (c) { allCats[c] = true; });
    });
    var catList = Object.keys(allCats).sort();

    // In Net mode, each bar is invested minus withdrawn for that cell.
    var net = __monthlyInvestCatNet;
    function investedCell(k, cat) { return (byMonthCat[k] && byMonthCat[k][cat]) ? byMonthCat[k][cat] : 0; }
    function outCell(k, cat) { return (byMonthCatOut[k] && byMonthCatOut[k][cat]) ? byMonthCatOut[k][cat] : 0; }
    function barCell(k, cat) { return net ? investedCell(k, cat) - outCell(k, cat) : investedCell(k, cat); }
    function investedTotal(k) {
      var m = byMonthCat[k]; return m ? Object.keys(m).reduce(function (s, c) { return s + m[c]; }, 0) : 0;
    }
    function outTotal(k) {
      var m = byMonthCatOut[k]; return m ? Object.keys(m).reduce(function (s, c) { return s + m[c]; }, 0) : 0;
    }
    function barTotal(k) { return net ? investedTotal(k) - outTotal(k) : investedTotal(k); }

    // Find peak investment month index (for highlighting)
    var peakIdx = 0, peakVal = -Infinity;
    monthKeys.forEach(function (k, i) {
      var v = investedTotal(k);
      if (v > peakVal) { peakVal = v; peakIdx = i; }
    });
    var peakLabel = labels[peakIdx] || "";

    var datasets;
    if (__monthlyInvestCatSplit) {
      // If a legend filter is active but the category isn't in view, clear it
      if (__monthlyInvestCatFilter && catList.indexOf(__monthlyInvestCatFilter) === -1) {
        __monthlyInvestCatFilter = null;
      }
      datasets = [];
      catList.forEach(function (cat, i) {
        if (__monthlyInvestCatFilter && cat !== __monthlyInvestCatFilter) return;
        var col = MIC_SPLIT_PALETTE[i % MIC_SPLIT_PALETTE.length];
        datasets.push({
          label: cat,
          data: monthKeys.map(function (k2) { return barCell(k2, cat); }),
          backgroundColor: col + "99",
          borderColor: col,
          borderWidth: 0,
          borderRadius: 3, categoryPercentage: 0.72, barPercentage: 0.9,
          order: 2
        });
      });
    } else {
      // Non-split: green bars, peak month highlighted darker
      var barColors = monthKeys.map(function (_, i) {
        return (i === peakIdx ? MIC_GREEN_PEAK : MIC_GREEN) + "99";
      });
      var barBorders = monthKeys.map(function (_, i) {
        return i === peakIdx ? MIC_GREEN_PEAK : MIC_GREEN;
      });
      datasets = catList.length ? [{
        label: net ? "Net investment" : "Invested",
        data: monthKeys.map(function (k2) { return barTotal(k2); }),
        backgroundColor: barColors,
        borderColor: barBorders,
        borderWidth: 0,
        borderRadius: 4, categoryPercentage: 0.72, barPercentage: 0.9,
        order: 2
      }] : [];
    }

    // Withdrawal lines: one dashed line per sub-category that had any
    // sell/redeem/withdraw activity in the visible window.
    var outCats = {};
    monthKeys.forEach(function (k) {
      if (byMonthCatOut[k]) Object.keys(byMonthCatOut[k]).forEach(function (c) { outCats[c] = true; });
    });
    var outCatList = Object.keys(outCats).sort();
    // Months without withdrawals are null (not 0) so no dots render there
    function withdrawLine(label, color, vals, stackId) {
      return {
        type: "line", label: label, data: vals,
        borderColor: MIC_RED, backgroundColor: "transparent",
        borderWidth: 2, borderDash: [6, 4],
        pointRadius: 2, pointHoverRadius: 4, tension: 0.2,
        spanGaps: false,
        stack: stackId, yAxisID: "yOut", order: 0
      };
    }
    if (net) {
      // Net mode folds withdrawals into the bars, so no separate lines
    } else if (__monthlyInvestCatSplit) {
      outCatList.forEach(function (cat, i) {
        if (__monthlyInvestCatFilter && cat !== __monthlyInvestCatFilter) return;
        datasets.push(withdrawLine(cat + " (withdrawn)",
          MIC_PALETTE[(catList.indexOf(cat) !== -1 ? catList.indexOf(cat) : i) % MIC_PALETTE.length],
          monthKeys.map(function (k2) {
            return (byMonthCatOut[k2] && byMonthCatOut[k2][cat]) ? byMonthCatOut[k2][cat] : null;
          }),
          "wd-" + cat));
      });
    } else if (outCatList.length) {
      datasets.push(withdrawLine("Total withdrawn", "#EF4444",
        monthKeys.map(function (k2) {
          var m = byMonthCatOut[k2];
          if (!m) return null;
          var s = Object.keys(m).reduce(function (acc, c) { return acc + m[c]; }, 0);
          return s > 0 ? s : null;
        }),
        "wd-total"));
    }

    if (!catList.length && !outCatList.length) {
      if (statusEl) statusEl.textContent = "No data for " + (yr === "all" ? "all time" : yr) + ".";
      if (__monthlyInvestCatChart) { __monthlyInvestCatChart.destroy(); __monthlyInvestCatChart = null; }
      wrap.innerHTML = "";
      return;
    }
    if (statusEl) statusEl.textContent = "";

    // Destroy old chart and replace canvas to guarantee a clean render
    if (__monthlyInvestCatChart) { __monthlyInvestCatChart.destroy(); __monthlyInvestCatChart = null; }
    wrap.innerHTML = "";
    var canvas = document.createElement("canvas");
    wrap.appendChild(canvas);

    // Compute stats
    var activeMonths = monthKeys.filter(function (k) { return investedTotal(k) > 0; }).length || 1;
    var totalInvested = monthKeys.reduce(function (s, k) { return s + investedTotal(k); }, 0);
    var totalOut = monthKeys.reduce(function (s, k) { return s + outTotal(k); }, 0);
    var totalNet = totalInvested - totalOut;
    var avgPerMonth = totalInvested / activeMonths;

    function fmtCompact(v) {
      var a = Math.abs(v);
      if (a >= 1e5) return "₹" + (v / 1e5).toFixed(a % 1e5 === 0 ? 0 : 1) + "L";
      if (a >= 1e3) return "₹" + Math.round(v / 1e3) + "k";
      return "₹" + Math.round(v);
    }

    var statsEl = document.getElementById("monthly-invest-cat-stats");
    if (statsEl) {
      if (__monthlyInvestCatSplit) {
        // Split mode: "₹X avg invested / month" headline only — legend carries per-category avgs
        statsEl.innerHTML =
          '<div class="mic-stat"><span class="mic-stat-value" style="font-size:1.5rem;">' +
          fmtCompact(avgPerMonth) + '</span><span class="mic-stat-label" style="font-size:0.75rem;letter-spacing:0;">avg invested / month</span></div>';
      } else {
        var hasOut = totalOut > 0;
        var peakFmt = peakVal > 0 ? (peakLabel + " &middot; " + formatCurrency(peakVal)) : "—";
        statsEl.innerHTML =
          '<div class="mic-stat"><span class="mic-stat-label">Total Invested</span><span class="mic-stat-value">' + formatCurrency(totalInvested) + '</span></div>' +
          (hasOut ? '<div class="mic-stat"><span class="mic-stat-label">Withdrawn</span><span class="mic-stat-value negative">&minus;' + formatCurrency(totalOut) + '</span></div>' : '') +
          (hasOut ? '<div class="mic-stat"><span class="mic-stat-label">Net</span><span class="mic-stat-value ' + (totalNet >= 0 ? 'positive' : 'negative') + '">' + (totalNet >= 0 ? '+' : '−') + formatCurrency(Math.abs(totalNet)) + '</span></div>' : '') +
          '<div class="mic-stat"><span class="mic-stat-label">Peak Month</span><span class="mic-stat-value mic-stat-peak">' + peakFmt + '</span></div>';
      }
    }

    // Custom legend
    var legendEl = document.getElementById("monthly-invest-cat-legend");
    if (legendEl) {
      if (__monthlyInvestCatSplit) {
        // Per-category colour swatch + avg/month; clicking filters to that instrument
        legendEl.innerHTML = catList.map(function (cat, i) {
          var col = MIC_SPLIT_PALETTE[i % MIC_SPLIT_PALETTE.length];
          var catTotal = monthKeys.reduce(function (s, k) {
            return s + ((byMonthCat[k] && byMonthCat[k][cat]) ? byMonthCat[k][cat] : 0);
          }, 0);
          var catAvg = catTotal / activeMonths;
          var dimmed = __monthlyInvestCatFilter && __monthlyInvestCatFilter !== cat;
          return '<div class="mic-legend-item mic-legend-clickable' + (dimmed ? ' mic-legend-dimmed' : '') + '"' +
            ' role="button" tabindex="0" data-mic-cat="' + cat.replace(/"/g, '&quot;') + '">' +
            '<div class="mic-legend-bar" style="background:' + col + '"></div>' +
            cat + ' ' + fmtCompact(catAvg) + '</div>';
        }).join("");
        // Wire clicks: toggle filter for the clicked instrument, then redraw
        Array.prototype.forEach.call(legendEl.querySelectorAll("[data-mic-cat]"), function (item) {
          function toggle() {
            var cat = item.getAttribute("data-mic-cat");
            __monthlyInvestCatFilter = (__monthlyInvestCatFilter === cat) ? null : cat;
            drawMonthlyInvestCatChart(__monthlyInvestCatAllTime ? "all" : __monthlyInvestCatYear);
          }
          item.addEventListener("click", toggle);
          item.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
          });
        });
      } else {
        legendEl.innerHTML =
          '<div class="mic-legend-item"><div class="mic-legend-bar" style="background:' + MIC_GREEN + '"></div>' +
          (net ? "Net invested" : "Invested (left axis)") + '</div>' +
          (!net && outCatList.length ? '<div class="mic-legend-item"><div class="mic-legend-line"></div>Withdrawn (right axis)</div>' : '');
      }
    }

    __monthlyInvestCatChart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) { return ctx.dataset.label + ": " + formatCurrency(ctx.parsed.y); },
              afterBody: function (items) {
                var k = monthKeys[items[0].dataIndex];
                if (!k) return [];
                var inv = investedTotal(k), out = outTotal(k);
                var lines = [];
                if (!net && out > 0) lines.push("Withdrawn: " + formatCurrency(out));
                if (out > 0) lines.push("Net: " + formatCurrency(inv - out));
                return lines;
              }
            }
          }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 } } },
          y: {
            stacked: true, beginAtZero: !net, position: "left",
            grid: { color: "rgba(0,0,0,0.05)" },
            ticks: { font: { size: 11 }, callback: function (v) {
              var abs = Math.abs(v);
              if (abs >= 1e5) return (v/1e5).toFixed(abs % 1e5 === 0 ? 0 : 1) + "L";
              if (abs >= 1e3) return (v/1e3).toFixed(0) + "k";
              return v;
            }}
          },
          yOut: {
            beginAtZero: true, position: "right", display: !net && outCatList.length > 0,
            grid: { drawOnChartArea: false },
            ticks: { font: { size: 11 }, callback: function (v) {
              if (v >= 1e5) return (v/1e5).toFixed(0) + "L";
              if (v >= 1e3) return (v/1e3).toFixed(0) + "k";
              return v;
            }}
          }
        }
      }
    });
    } catch(e) {
      if (statusEl) statusEl.textContent = "Chart error: " + e.message;
    }
  }

  function renderMonthlyInvestmentByCategory() {
    var statusEl = document.getElementById("monthly-invest-cat-status");
    var yearSel = document.getElementById("monthly-invest-cat-year");
    if (typeof Chart === "undefined") return;

    // Rebuild raw data
    __monthlyInvestCatData = buildMonthlyInvestCatData();
    var yearList = __monthlyInvestCatData.yearList;
    if (!yearList.length) {
      if (statusEl) statusEl.textContent = "No investment data found.";
      return;
    }

    // Pick year: preserve selection if valid, else default to most recent year with data
    if (!__monthlyInvestCatYear || yearList.indexOf(__monthlyInvestCatYear) < 0) {
      var byMonthCat = __monthlyInvestCatData.byMonthCat;
      var defaultYr = yearList[yearList.length - 1];
      for (var yi = yearList.length - 1; yi >= 0; yi--) {
        var testYr = yearList[yi];
        var hasData = false;
        for (var mi2 = 0; mi2 < 12; mi2++) {
          var tk = testYr + "-" + String(mi2 + 1).padStart(2, "0");
          if (byMonthCat[tk]) { hasData = true; break; }
        }
        if (hasData) { defaultYr = testYr; break; }
      }
      __monthlyInvestCatYear = defaultYr;
    }

    // Rebuild year selector only when the year list changes; bind onchange once
    if (yearSel) {
      var existingYears = [];
      for (var oi = 0; oi < yearSel.options.length; oi++) existingYears.push(yearSel.options[oi].value);
      if (existingYears.join(",") !== yearList.join(",")) {
        yearSel.innerHTML = yearList.map(function (y) {
          return '<option value="' + y + '">' + y + '</option>';
        }).join("");
      }
      // Bind unconditionally so the handler can never be lost
      yearSel.onchange = function () {
        console.log("[MIC v12] year changed to", yearSel.value);
        __monthlyInvestCatYear = yearSel.value;
        drawMonthlyInvestCatChart(__monthlyInvestCatYear);
      };
      yearSel.value = __monthlyInvestCatYear;
      yearSel.style.display = __monthlyInvestCatAllTime ? "none" : "";
    }

    var netBtn = document.getElementById("monthly-invest-cat-net");
    if (netBtn) {
      netBtn.classList.toggle("active", !!__monthlyInvestCatNet);
      netBtn.onclick = function () {
        __monthlyInvestCatNet = !__monthlyInvestCatNet;
        netBtn.classList.toggle("active", !!__monthlyInvestCatNet);
        drawMonthlyInvestCatChart(__monthlyInvestCatAllTime ? "all" : __monthlyInvestCatYear);
      };
    }

    var splitBtn = document.getElementById("monthly-invest-cat-split");
    if (splitBtn) {
      splitBtn.classList.toggle("active", !!__monthlyInvestCatSplit);
      splitBtn.onclick = function () {
        __monthlyInvestCatSplit = !__monthlyInvestCatSplit;
        __monthlyInvestCatFilter = null; // reset instrument filter when toggling split
        splitBtn.classList.toggle("active", !!__monthlyInvestCatSplit);
        drawMonthlyInvestCatChart(__monthlyInvestCatAllTime ? "all" : __monthlyInvestCatYear);
      };
    }

    var allBtn = document.getElementById("monthly-invest-cat-alltime");
    if (allBtn) {
      allBtn.classList.toggle("active", !!__monthlyInvestCatAllTime);
      allBtn.onclick = function () {
        __monthlyInvestCatAllTime = !__monthlyInvestCatAllTime;
        allBtn.classList.toggle("active", !!__monthlyInvestCatAllTime);
        if (yearSel) yearSel.style.display = __monthlyInvestCatAllTime ? "none" : "";
        drawMonthlyInvestCatChart(__monthlyInvestCatAllTime ? "all" : __monthlyInvestCatYear);
      };
      // Update chevron text based on state
      allBtn.querySelector("svg") && (allBtn.childNodes[0].textContent = __monthlyInvestCatAllTime ? "All time " : "All time ");
    }

    drawMonthlyInvestCatChart(__monthlyInvestCatAllTime ? "all" : __monthlyInvestCatYear);
  }

  var equityHoldingsSortState = { key: null, dir: 1 };

  function pnlChip(text, value) {
    var span = document.createElement("span");
    span.className = "pnl-chip " + (value > 0 ? "positive" : (value < 0 ? "negative" : "neutral"));
    span.textContent = text;
    return span;
  }

  function truncateInstrumentNameToFund(name) {
    if (!name) return name;
    var match = /^(.*?\bfund\b)/i.exec(name);
    return match ? match[1] : name;
  }

  function renderEquityHoldingsRows(tbody, rowsData) {
    var key = equityHoldingsSortState.key;
    var dir = equityHoldingsSortState.dir;
    var sorted = rowsData.slice();
    if (key) {
      sorted.sort(function (a, b) {
        var av = a[key], bv = b[key];
        if (av === null || av === undefined) av = (typeof bv === "number") ? -Infinity : "";
        if (bv === null || bv === undefined) bv = (typeof av === "number") ? -Infinity : "";
        if (typeof av === "string" || typeof bv === "string") {
          return String(av).localeCompare(String(bv)) * dir;
        }
        return (av - bv) * dir;
      });
    }

    tbody.innerHTML = "";
    sorted.forEach(function (h, idx) {
      var tr = document.createElement("tr");
      tr.style.animationDelay = (Math.min(idx, 12) * 25) + "ms";
      tr.className = "row-enter";

      var nameTd = document.createElement("td");
      nameTd.className = "fund-name";
      nameTd.textContent = truncateInstrumentNameToFund(h.instrument);
      nameTd.title = h.instrument;
      tr.appendChild(nameTd);

      var qtyTd = document.createElement("td");
      qtyTd.className = "num col-desktop-only";
      qtyTd.textContent = h.units.toFixed(3);
      tr.appendChild(qtyTd);

      var avgNavTd = document.createElement("td");
      avgNavTd.className = "num col-desktop-only";
      avgNavTd.textContent = "₹" + h.avgNav.toFixed(2);
      tr.appendChild(avgNavTd);

      var currNavTd = document.createElement("td");
      currNavTd.className = "num col-desktop-only";
      currNavTd.textContent = "₹" + h.currNav.toFixed(3);
      tr.appendChild(currNavTd);

      var investedTd = document.createElement("td");
      investedTd.className = "num col-desktop-only";
      investedTd.textContent = formatCurrency(h.invested);
      tr.appendChild(investedTd);

      var currentTd = document.createElement("td");
      currentTd.className = "num";
      currentTd.textContent = formatCurrency(h.current);
      tr.appendChild(currentTd);

      var pnlTd = document.createElement("td");
      pnlTd.className = "num";
      pnlTd.appendChild(pnlChip((h.pnl > 0 ? "+" : "") + formatCurrency(h.pnl), h.pnl));
      tr.appendChild(pnlTd);

      var netChgTd = document.createElement("td");
      netChgTd.className = "num col-desktop-only";
      netChgTd.appendChild(pnlChip((h.pnlPct > 0 ? "+" : "") + h.pnlPct.toFixed(2) + "%", h.pnlPct));
      tr.appendChild(netChgTd);

      var dayChgTd = document.createElement("td");
      dayChgTd.className = "num col-desktop-only";
      dayChgTd.appendChild(pnlChip((h.dayChgPct > 0 ? "+" : "") + h.dayChgPct.toFixed(2) + "%", h.dayChgPct));
      tr.appendChild(dayChgTd);

      var xirrTd = document.createElement("td");
      xirrTd.className = "num";
      if (h.xirrPct === null || h.units < 1) {
        xirrTd.textContent = "—";
      } else {
        xirrTd.appendChild(pnlChip((h.xirrPct > 0 ? "+" : "") + h.xirrPct.toFixed(2) + "%", h.xirrPct));
      }
      tr.appendChild(xirrTd);

      tbody.appendChild(tr);
    });
  }

  function attachInstrumentColumnResizer() {
    if (window.matchMedia("(max-width: 760px)").matches) return;
    var resizer = document.getElementById("equity-holdings-instrument-resizer");
    var col = document.getElementById("equity-holdings-instrument-col");
    if (!resizer || !col || resizer.dataset.bound) return;
    resizer.dataset.bound = "1";

    var startX, startWidth;
    function onMouseMove(e) {
      var delta = e.clientX - startX;
      var newWidth = Math.max(140, Math.min(640, startWidth + delta));
      col.style.width = newWidth + "px";
    }
    function onMouseUp() {
      resizer.classList.remove("resizing");
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }
    resizer.addEventListener("mousedown", function (e) {
      e.preventDefault();
      startX = e.clientX;
      startWidth = col.getBoundingClientRect().width;
      resizer.classList.add("resizing");
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  function attachEquityHoldingsSortHandlers(tbody, rowsData) {
    var table = tbody.closest("table");
    if (!table) return;
    table.__wfRowsData = rowsData;
    if (table.dataset.sortableBound) return;
    table.dataset.sortableBound = "1";
    var headers = table.querySelectorAll("th[data-sort]");
    headers.forEach(function (th) {
      th.classList.add("sortable");
      var icon = document.createElement("span");
      icon.className = "sort-icon";
      th.appendChild(icon);
      th.addEventListener("click", function () {
        var key = th.getAttribute("data-sort");
        if (equityHoldingsSortState.key === key) {
          equityHoldingsSortState.dir *= -1;
        } else {
          equityHoldingsSortState.key = key;
          equityHoldingsSortState.dir = 1;
        }
        headers.forEach(function (other) {
          other.classList.remove("sort-asc", "sort-desc");
        });
        th.classList.add(equityHoldingsSortState.dir === 1 ? "sort-asc" : "sort-desc");
        renderEquityHoldingsRows(tbody, table.__wfRowsData);
      });
    });
  }

  function updateNavAsOf(navHistories) {
    var asOfEl = document.getElementById("equity-nav-asof");
    var asOfTextEl = document.getElementById("equity-nav-asof-text");
    if (!asOfEl || !asOfTextEl) return;

    var latestDate = null;
    (navHistories || []).forEach(function (navHistory) {
      if (!navHistory || !navHistory.length) return;
      var d = navHistory[navHistory.length - 1].date;
      if (!latestDate || d > latestDate) latestDate = d;
    });

    if (!latestDate) {
      asOfEl.hidden = true;
      return;
    }

    var today = new Date();
    var isStale = (today - latestDate) > (1000 * 60 * 60 * 24 * 3);
    asOfTextEl.textContent = "NAV Data: " + latestDate.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
    asOfEl.classList.toggle("stale", isStale);
    asOfEl.hidden = false;
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

    var selectedPortfolio = window.__mfHoldingsPortfolioOverride || localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
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
          var rowsData = [];
          resolvable.forEach(function (h, i) {
            var isClosed = h.units < 1;
            var currNav, current, pnl, pnlPct, dayChgPct;
            var investedForDisplay = h.invested;

            if (isClosed) {
              var detail = computeInstrumentRealizedDetail(transactionsByInstrument[h.instrument]);
              currNav = detail.lastSellPrice;
              current = detail.saleProceeds;
              investedForDisplay = detail.costOfSoldUnits;
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

            var instrumentCashFlows = buildXirrCashFlows(rows, selectedPortfolio, h.instrument);
            if (!isClosed && current > UNITS_EPSILON) instrumentCashFlows.push({ date: new Date(), amount: current });
            var instrumentXirr = calculateXIRR(instrumentCashFlows);
            var xirrPct = (instrumentXirr === null || instrumentXirr === undefined || !isFinite(instrumentXirr)) ? null : instrumentXirr * 100;

            rowsData.push({
              instrument: h.instrument,
              units: h.units,
              avgNav: h.avgNav,
              currNav: currNav,
              invested: investedForDisplay,
              current: current,
              pnl: pnl,
              pnlPct: pnlPct,
              dayChgPct: dayChgPct,
              xirrPct: xirrPct
            });
          });

          renderEquityHoldingsRows(tbody, rowsData);
          attachEquityHoldingsSortHandlers(tbody, rowsData);
          try { renderMfHoldingsCardList(rowsData); } catch (e) {}
          try { renderMfPortfolioCards(); } catch (e) {}
          try { renderMfAllocation(rowsData); } catch (e) {}
          try { renderMfPerformanceChart(); } catch (e) {}

          statusEl.textContent = "";
          tableWrap.hidden = true;
          updateNavAsOf(navHistories);
        });
    }).catch(function (err) {
      var msg = "Couldn't load holdings: " + (err && err.message ? err.message : err);
      if (statusEl) statusEl.textContent = msg;
      if (tableWrap) tableWrap.hidden = true;
    });
  }

  renderEquityHoldingsTable();

  // ── MF tab redesign — helpers ────────────────────────────────────────────
  var MFH_STATE = { showClosed: false, sort: "pnl-desc" };
  var MFALLOC_STATE = { mode: "Segment" };
  var MFPERF_STATE = { range: "All" };

  function _initials(name) {
    var parts = String(name || "").trim().split(/\s+/);
    var out = parts[0] ? parts[0].charAt(0).toUpperCase() : "?";
    if (parts.length > 1) out += parts[parts.length - 1].charAt(0).toUpperCase();
    return out;
  }
  function _shortCode(name) {
    if (!name) return "MF";
    var words = String(name).replace(/[^\w\s]/g, " ").trim().split(/\s+/).filter(Boolean);
    if (words.length >= 3) return (words[0].charAt(0) + words[1].charAt(0) + words[2].charAt(0)).toUpperCase();
    if (words.length === 2) return (words[0].substring(0, 2) + words[1].charAt(0)).toUpperCase();
    return words[0].substring(0, 3).toUpperCase();
  }
  var MFH_AVATAR_PALETTE = [
    { bg: "#D1FAE5", fg: "#065F46", accent: "green" },
    { bg: "#FEF3C7", fg: "#B45309", accent: "amber" },
    { bg: "#DBEAFE", fg: "#1E40AF", accent: "blue" },
    { bg: "#FED7AA", fg: "#B45309", accent: "amber" },
    { bg: "#EDE9FE", fg: "#5B21B6", accent: "purple" },
    { bg: "#CFFAFE", fg: "#0E7490", accent: "teal" },
    { bg: "#FCE7F3", fg: "#9D174D", accent: "red" }
  ];
  function _avatarFor(name, idx) { return MFH_AVATAR_PALETTE[idx % MFH_AVATAR_PALETTE.length]; }

  function _isSipInstrument(instrument) {
    // Heuristic: an instrument is treated as SIP if the equity sheet has ≥3
    // buy transactions for it — matches how most SIPs show up in the data.
    var rows = getSheetRows("equity");
    if (!rows) return false;
    var byInst = groupUnitTransactionsByInstrument(rows, "all");
    if (!byInst) return false;
    var txns = byInst[instrument] || [];
    var buys = 0;
    txns.forEach(function (t) { if (t.type === "buy" && !t.isCorporateAction) buys++; });
    return buys >= 3;
  }

  // Phase 3: card list rendering
  function renderMfHoldingsCardList(rowsData) {
    var list = document.getElementById("mfh-list");
    var eyebrow = document.getElementById("mfh-eyebrow");
    if (!list) return;
    var filtered = rowsData.filter(function (r) {
      var closed = r.units < 1;
      return MFH_STATE.showClosed ? closed : !closed;
    });
    var sortKey = MFH_STATE.sort;
    filtered.sort(function (a, b) {
      if (sortKey === "pnl-desc") return (b.pnl || 0) - (a.pnl || 0);
      if (sortKey === "pnl-asc") return (a.pnl || 0) - (b.pnl || 0);
      if (sortKey === "current-desc") return (b.current || 0) - (a.current || 0);
      return 0;
    });
    var segmentMap = buildInstrumentSegmentMap();
    if (eyebrow) eyebrow.textContent = "HOLDINGS · " + filtered.length + (MFH_STATE.showClosed ? " CLOSED" : " OPEN");
    if (!filtered.length) {
      list.innerHTML = '<p class="muted small" style="padding:20px;text-align:center;">No holdings to show.</p>';
      return;
    }
    var header = '<div class="mfh-list-header"><span>Instrument</span><span class="mfh-col-num">Invested</span><span class="mfh-col-num">Current</span><span class="mfh-col-num">Day Chg</span><span class="mfh-col-num">P&amp;L · Return</span><span class="mfh-col-num">XIRR</span></div>';
    var body = filtered.map(function (r, i) {
      var pal = _avatarFor(r.instrument, i);
      var code = _shortCode(r.instrument);
      var seg = lookupSegment(segmentMap, r.instrument);
      var sub = seg + " · " + r.units.toFixed(1) + " units @ ₹" + r.avgNav.toFixed(2);
      var isSip = _isSipInstrument(r.instrument);
      var pnlPos = r.pnl >= 0;
      var xirrCls = r.xirrPct == null ? "mfh-muted" : (r.xirrPct >= 0 ? "" : "mfh-negative");
      var xirrText = r.xirrPct == null ? "—" : ((r.xirrPct >= 0 ? "+" : "") + r.xirrPct.toFixed(2) + "%");
      return '<div class="mfh-row mfh-color-' + pal.accent + '">' +
        '<div class="mfh-inst">' +
          '<div class="mfh-avatar" style="background:' + pal.bg + ';color:' + pal.fg + ';">' + code + '</div>' +
          '<div class="mfh-inst-body">' +
            '<div class="mfh-inst-name">' + truncateInstrumentNameToFund(r.instrument) + (isSip ? '<span class="mfh-sip-badge">SIP</span>' : '') + '</div>' +
            '<div class="mfh-inst-sub">' + sub + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="mfh-col-num mfh-num-primary">' + formatCurrency(r.invested) + '</div>' +
        '<div class="mfh-col-num mfh-num-primary">' + formatCurrency(r.current) + '</div>' +
        (function () {
          var dayVal = (r.dayChgPct == null || r.current == null) ? null : (r.current * r.dayChgPct / 100);
          var cls = dayVal == null ? "mfh-muted" : (dayVal >= 0 ? "mfh-positive" : "mfh-negative");
          var text = dayVal == null ? "—" : ((dayVal >= 0 ? "+" : "") + formatCurrency(dayVal));
          return '<div class="mfh-col-num mfh-num-day ' + cls + '">' + text + '</div>';
        })() +
        '<div class="mfh-col-num mfh-num-pnl">' +
          '<span class="mfh-num-pnl-value ' + (pnlPos ? "" : "mfh-negative") + '">' + (pnlPos ? "+" : "") + formatCurrency(r.pnl) + '</span>' +
          '<span class="mfh-num-pnl-pct ' + (pnlPos ? "" : "mfh-negative") + '">' + (pnlPos ? "+" : "") + r.pnlPct.toFixed(2) + '%</span>' +
        '</div>' +
        '<div class="mfh-col-num mfh-num-xirr ' + xirrCls + '">' + xirrText + '</div>' +
      '</div>';
    }).join("");
    list.innerHTML = header + body;
  }

  // Phase 1: portfolio cards (per-portfolio MF invested/current/xirr)
  function renderMfPortfolioCards() {
    var row = document.getElementById("mfpc-row");
    if (!row) return;
    var rows = getSheetRows("equity");
    if (!rows) { row.innerHTML = ""; return; }
    var names = collectPortfolioNamesFromSheets(["equity"]);
    if (!names.length) { row.innerHTML = ""; return; }

    var cards = [];
    var combinedInv = 0, combinedCur = 0, combinedFlows = [];
    Promise.all(names.map(function (name) {
      var invested = computeTotalInvestment(name, ["equity"]);
      return _computeMfCurrentValueForPortfolio(name).then(function (current) {
        var flows = buildXirrCashFlows(rows, name);
        if (current > 0) flows = flows.concat([{ date: new Date(), amount: current }]);
        var xirr = calculateXIRR(flows);
        combinedInv += invested; combinedCur += current;
        return { name: name, invested: invested, current: current, xirr: xirr, flows: flows };
      });
    })).then(function (perPortfolio) {
      perPortfolio.sort(function (a, b) { return b.current - a.current; });
      // Combined card
      var equityRows = getSheetRows("equity");
      var comboFlows = buildXirrCashFlows(equityRows, "all");
      if (combinedCur > 0) comboFlows.push({ date: new Date(), amount: combinedCur });
      var comboXirr = calculateXIRR(comboFlows);
      var all = perPortfolio.concat([{ name: "Combined", invested: combinedInv, current: combinedCur, xirr: comboXirr, isCombined: true }]);
      row.innerHTML = all.map(function (p, i) {
        var pnl = p.current - p.invested;
        var pnlPct = p.invested > 0 ? (pnl / p.invested) * 100 : 0;
        var isNeg = pnl < 0;
        var xirrPct = p.xirr == null || !isFinite(p.xirr) ? null : p.xirr * 100;
        var pal = p.isCombined
          ? { bg: "#23211D", fg: "#fff" }
          : { bg: MFH_AVATAR_PALETTE[i % 3].bg, fg: MFH_AVATAR_PALETTE[i % 3].fg };
        var initial = p.isCombined ? "Σ" : _initials(p.name).charAt(0);
        var subtitle = p.isCombined ? "HOUSEHOLD TOTAL" : "PERSONAL PORTFOLIO";
        var progress = Math.min(100, Math.max(4, (pnlPct + 30) * 1.4)); // rough scaled fill
        return '<div class="mfpc-card ' + (p.isCombined ? "mfpc-combined" : "") + '">' +
          '<div class="mfpc-head">' +
            '<div class="mfpc-avatar" style="background:' + pal.bg + ';color:' + pal.fg + ';">' + initial + '</div>' +
            '<div class="mfpc-name-block">' +
              '<div class="mfpc-name">' + p.name + '</div>' +
              '<div class="mfpc-subtitle">' + subtitle + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="mfpc-current-label">CURRENT VALUE</div>' +
          '<div class="mfpc-current-value">' + formatCurrency(p.current) + '</div>' +
          '<div class="mfpc-bar"><div class="mfpc-bar-fill" style="width:' + progress + '%;"></div></div>' +
          '<div class="mfpc-return-row">' +
            '<span class="mfpc-return-pct ' + (isNeg ? "mfpc-negative" : "") + '">' + (isNeg ? "" : "+") + pnlPct.toFixed(2) + '%</span>' +
            '<span class="mfpc-gain">' + (isNeg ? "" : "+") + formatCurrency(pnl) + ' gain</span>' +
          '</div>' +
          '<div class="mfpc-footer">' +
            '<div class="mfpc-foot-item"><span class="mfpc-foot-label">Invested</span><span class="mfpc-foot-value">' + formatCurrency(p.invested) + '</span></div>' +
            '<div class="mfpc-foot-item"><span class="mfpc-foot-label">XIRR</span><span class="mfpc-foot-value mfpc-xirr ' + (xirrPct != null && xirrPct < 0 ? "mfpc-negative" : "") + '">' + (xirrPct == null ? "—" : (xirrPct >= 0 ? "+" : "") + xirrPct.toFixed(2) + "%") + '</span></div>' +
          '</div>' +
        '</div>';
      }).join("");
    });
  }

  function _computeMfCurrentValueForPortfolio(portfolio) {
    var rows = getSheetRows("equity");
    if (!rows) return Promise.resolve(0);
    var byInst = groupUnitTransactionsByInstrument(rows, portfolio);
    if (!byInst) return Promise.resolve(0);
    return buildInstrumentSchemeMap().then(function (schemeMap) {
      var names = Object.keys(byInst).filter(function (n) { return !!lookupSchemeCode(schemeMap, n); });
      return Promise.all(names.map(function (n) { return fetchNavHistory(lookupSchemeCode(schemeMap, n)); }))
        .then(function (histories) {
          var total = 0;
          names.forEach(function (n, i) {
            var lots = fifoRemainingLots(byInst[n]);
            var units = lots.reduce(function (s, l) { return s + l.units; }, 0);
            var hist = histories[i];
            var nav = hist && hist.length ? hist[hist.length - 1].nav : 0;
            if (units > UNITS_EPSILON && nav) total += units * nav;
          });
          return total;
        });
    });
  }

  // Phase 2: allocation by segment
  function renderMfAllocation(rowsData) {
    var listEl = document.getElementById("mfalloc-list");
    if (!listEl) return;
    var segmentMap = buildInstrumentSegmentMap();
    var bySeg = {};
    rowsData.forEach(function (r) {
      if (r.units < 1) return;
      var seg = lookupSegment(segmentMap, r.instrument);
      bySeg[seg] = (bySeg[seg] || 0) + (r.current || 0);
    });
    var entries = Object.keys(bySeg).map(function (k) { return { name: k, value: bySeg[k] }; })
      .sort(function (a, b) { return b.value - a.value; });
    var total = entries.reduce(function (s, e) { return s + e.value; }, 0);
    if (!entries.length) { listEl.innerHTML = '<p class="muted small">No allocation data.</p>'; return; }
    var PAL = ["#10B981", "#D4A017", "#3B82F6", "#E8623A", "#8B5CF6", "#64748B", "#06B6D4", "#EC4899"];
    listEl.innerHTML = entries.map(function (e, i) {
      var pct = total > 0 ? (e.value / total) * 100 : 0;
      var col = PAL[i % PAL.length];
      return '<div class="mfalloc-item">' +
        '<div class="mfalloc-name"><span class="mfalloc-dot" style="background:' + col + ';"></span>' + e.name + '</div>' +
        '<div class="mfalloc-nums">' +
          '<span class="mfalloc-amount">' + formatCurrency(e.value) + '</span>' +
          '<span class="mfalloc-pct">' + pct.toFixed(1) + '%</span>' +
        '</div>' +
        '<div class="mfalloc-bar"><div class="mfalloc-bar-fill" style="width:' + pct + '%;background:' + col + ';"></div></div>' +
      '</div>';
    }).join("");
  }

  // Phase 2: Portfolio vs Nifty performance chart
  function renderMfPerformanceChart() {
    var canvas = document.getElementById("mfperf-chart");
    if (!canvas || typeof Chart === "undefined") return;
    var rows = getSheetRows("equity");
    if (!rows) return;
    var flows = buildXirrCashFlows(rows, "all");
    if (!flows || !flows.length) return;
    // Build monthly buckets of cumulative invested vs current portfolio value
    // by replaying flows and applying latest NAV.
    var range = MFPERF_STATE.range;
    fetchIndexHistory().then(function (indexHistory) {
      var indexKey = localStorage.getItem("wf-benchmark-index") || "NIFTY50";
      var indexPrices = indexHistory && indexHistory[indexKey] && indexHistory[indexKey].prices;
      _computeMfCurrentValueForPortfolio("all").then(function (currentVal) {
        // Simple return series from first flow to today, normalized to 0
        flows.sort(function (a, b) { return a.date - b.date; });
        var firstDate = flows[0].date;
        var today = new Date();
        // Filter by range
        var startDate = firstDate;
        if (range !== "All") {
          var months = range === "1M" ? 1 : range === "6M" ? 6 : range === "1Y" ? 12 : 36;
          var candidate = new Date(today.getTime() - months * 30 * 86400000);
          if (candidate > firstDate) startDate = candidate;
        }
        // Sample monthly points from startDate → today
        var samples = [];
        var d = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
        var end = new Date(today.getFullYear(), today.getMonth(), 1);
        while (d <= end) { samples.push(new Date(d)); d.setMonth(d.getMonth() + 1); }
        samples.push(today);
        // Compute cumulative invested at each sample
        var portData = [], idxData = [];
        var invested = 0, flowIdx = 0;
        // Base index price at startDate
        var baseIdx = indexPrices ? lookupIndexPrice(indexPrices, formatDateISO(startDate)) : null;
        var totalInvestedAll = flows.reduce(function (s, f) { return s + (f.amount < 0 ? -f.amount : 0); }, 0);
        samples.forEach(function (dt) {
          while (flowIdx < flows.length && flows[flowIdx].date <= dt) {
            invested += (flows[flowIdx].amount < 0 ? -flows[flowIdx].amount : 0);
            flowIdx++;
          }
          // Portfolio return at time dt = (current * investedRatio - invested) / invested
          var estCurrent = totalInvestedAll > 0 ? currentVal * (invested / totalInvestedAll) : 0;
          var portRet = invested > 0 ? ((estCurrent - invested) / invested) * 100 : 0;
          portData.push({ x: dt, y: portRet });
          if (baseIdx && indexPrices) {
            var p = lookupIndexPrice(indexPrices, formatDateISO(dt));
            idxData.push({ x: dt, y: p ? ((p / baseIdx) - 1) * 100 : null });
          }
        });
        _drawMfPerfChart(canvas, portData, idxData);
        // Update legend + alpha
        var lastPort = portData[portData.length - 1] ? portData[portData.length - 1].y : 0;
        var lastIdx = idxData.length ? (idxData[idxData.length - 1] || {}).y : null;
        var portEl = document.getElementById("mfperf-port-return");
        var idxEl = document.getElementById("mfperf-idx-return");
        if (portEl) portEl.textContent = (lastPort >= 0 ? "+" : "") + lastPort.toFixed(1) + "%";
        if (idxEl) idxEl.textContent = lastIdx == null ? "—" : (lastIdx >= 0 ? "+" : "") + lastIdx.toFixed(1) + "%";
        var alphaEl = document.getElementById("mfperf-alpha");
        if (alphaEl) {
          if (lastIdx != null) {
            var alpha = lastPort - lastIdx;
            alphaEl.textContent = (alpha >= 0 ? "+" : "") + alpha.toFixed(1) + "%";
            alphaEl.classList.toggle("mfperf-negative", alpha < 0);
          } else alphaEl.textContent = "—";
        }
      });
    });
  }

  function _drawMfPerfChart(canvas, portData, idxData) {
    if (window.__wfMfPerfChart) window.__wfMfPerfChart.destroy();
    var wrap = canvas.parentNode;
    if (wrap) { wrap.innerHTML = ""; canvas = document.createElement("canvas"); canvas.id = "mfperf-chart"; canvas.height = 260; wrap.appendChild(canvas); }
    var ctx = canvas.getContext("2d");
    var grad = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 260);
    grad.addColorStop(0, "rgba(16,185,129,0.20)"); grad.addColorStop(1, "rgba(16,185,129,0)");
    var datasets = [{
      label: "Portfolio", data: portData,
      borderColor: "#10B981", backgroundColor: grad,
      fill: true, borderWidth: 2.5, pointRadius: 0, tension: 0.25
    }];
    if (idxData.length) datasets.push({
      label: "Nifty 50", data: idxData,
      borderColor: "#94A3B8", borderDash: [6, 4], borderWidth: 2, pointRadius: 0, tension: 0.25, fill: false
    });
    window.__wfMfPerfChart = new Chart(ctx, {
      type: "line", data: { datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: {
          callbacks: { label: function (c) { return c.dataset.label + ": " + (c.parsed.y >= 0 ? "+" : "") + c.parsed.y.toFixed(2) + "%"; } }
        } },
        scales: {
          x: { type: "time", time: { unit: "month" }, grid: { display: false } },
          y: { ticks: { callback: function (v) { return (v >= 0 ? "+" : "") + v + "%"; } }, grid: { color: "rgba(0,0,0,0.05)" } }
        }
      }
    });
  }

  // Wire toggles
  (function wireMfControls() {
    var openBtn = document.getElementById("mfh-open-toggle");
    var sortBtn = document.getElementById("mfh-sort-toggle");
    if (openBtn) openBtn.addEventListener("click", function () {
      MFH_STATE.showClosed = !MFH_STATE.showClosed;
      openBtn.textContent = MFH_STATE.showClosed ? "Closed" : "Open";
      var cb = document.getElementById("equity-holdings-show-closed-only");
      if (cb) cb.checked = MFH_STATE.showClosed;
      renderEquityHoldingsTable();
    });
    if (sortBtn) sortBtn.addEventListener("click", function () {
      MFH_STATE.sort = MFH_STATE.sort === "pnl-desc" ? "pnl-asc" : "pnl-desc";
      sortBtn.innerHTML = "Sort P&amp;L " + (MFH_STATE.sort === "pnl-desc" ? "&darr;" : "&uarr;");
      renderEquityHoldingsTable();
    });
    var pills = document.querySelectorAll("[data-mfperf-range]");
    pills.forEach(function (p) {
      p.addEventListener("click", function () {
        pills.forEach(function (x) { x.classList.remove("active"); });
        p.classList.add("active");
        MFPERF_STATE.range = p.dataset.mfperfRange;
        renderMfPerformanceChart();
      });
    });

    // Portfolio filter for the Holdings list (All / <each portfolio>).
    var pfToggle = document.getElementById("mfh-portfolio-toggle");
    if (pfToggle) {
      var portfolios = ["all"].concat(collectPortfolioNamesFromSheets(["equity"]) || []);
      var current = window.__mfHoldingsPortfolioOverride || "all";
      pfToggle.innerHTML = portfolios.map(function (p) {
        var label = p === "all" ? "All" : p;
        return '<button type="button" class="mfh-portfolio-btn ' + (p === current ? "active" : "") + '" data-mfh-portfolio="' + p.replace(/"/g, '&quot;') + '">' + label + '</button>';
      }).join("");
      pfToggle.querySelectorAll("[data-mfh-portfolio]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          window.__mfHoldingsPortfolioOverride = btn.dataset.mfhPortfolio;
          pfToggle.querySelectorAll("[data-mfh-portfolio]").forEach(function (b) { b.classList.toggle("active", b === btn); });
          renderEquityHoldingsTable();
        });
      });
    }
  })();

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

          renderApplePieChart(canvas, {
            instanceKey: "__wfSegmentChart",
            labels: labels,
            data: data,
            total: total,
            centerLabel: "Current",
            formatLabel: formatCurrency
          });
        });
    }).catch(function (err) {
      statusEl.textContent = "Couldn't load the market segment split: " + (err && err.message ? err.message : err);
    });
  }

  renderMarketSegmentChart();

  function groupUnitTransactionsByPortfolioAndInstrument(rows) {
    var header = rows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var instrumentIdx = header.indexOf("instrument name");
    var typeIdx = header.indexOf("transaction type");
    var unitsIdx = header.indexOf("units");
    var priceIdx = header.indexOf("price");
    var dateIdx = header.indexOf("transaction date");
    if (portfolioIdx === -1 || instrumentIdx === -1 || typeIdx === -1 || unitsIdx === -1 || priceIdx === -1 || dateIdx === -1) return null;

    var byPortfolio = {};
    rows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (!portfolio) return;

      var type = normalizeText(row[typeIdx]);
      var isBuy = type.indexOf("buy") !== -1;
      var isSell = type.indexOf("sell") !== -1;
      if (!isBuy && !isSell) return;

      var instrument = (row[instrumentIdx] || "").trim();
      if (!byPortfolio[portfolio]) byPortfolio[portfolio] = {};
      if (!byPortfolio[portfolio][instrument]) byPortfolio[portfolio][instrument] = [];
      byPortfolio[portfolio][instrument].push({
        type: isBuy ? "buy" : "sell",
        units: parseNumber(row[unitsIdx]),
        price: parseNumber(row[priceIdx]),
        date: parseFlexibleDate(row[dateIdx]),
        order: byPortfolio[portfolio][instrument].length
      });
    });

    Object.keys(byPortfolio).forEach(function (portfolio) {
      Object.keys(byPortfolio[portfolio]).forEach(function (instrument) {
        byPortfolio[portfolio][instrument].sort(function (a, b) {
          var at = a.date ? a.date.getTime() : 0;
          var bt = b.date ? b.date.getTime() : 0;
          return at !== bt ? at - bt : a.order - b.order;
        });
      });
    });
    return byPortfolio;
  }

  function renderMutualFundPortfolioSplitChart() {
    var canvas = document.getElementById("mf-portfolio-split-chart");
    var statusEl = document.getElementById("mf-portfolio-split-status");
    if (!canvas || !statusEl || typeof Chart === "undefined") return;

    var rows = getSheetRows("equity");
    if (!rows || !rows.length) {
      statusEl.textContent = "Connect your Mutual Fund Transactions sheet in Settings to populate this chart.";
      if (window.__wfMfPortfolioSplitChart) { window.__wfMfPortfolioSplitChart.destroy(); window.__wfMfPortfolioSplitChart = null; }
      return;
    }

    var byPortfolio = groupUnitTransactionsByPortfolioAndInstrument(rows);
    if (!byPortfolio) {
      statusEl.textContent = "Header row number is incorrect. Make adjustments by adding correct header row number.";
      return;
    }

    var selectedPortfolio = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
    if (selectedPortfolio !== "all") {
      var filteredByPortfolio = {};
      Object.keys(byPortfolio).forEach(function (portfolio) {
        if (normalizeText(portfolio) === normalizeText(selectedPortfolio)) filteredByPortfolio[portfolio] = byPortfolio[portfolio];
      });
      byPortfolio = filteredByPortfolio;
    }

    var holdings = [];
    Object.keys(byPortfolio).forEach(function (portfolio) {
      Object.keys(byPortfolio[portfolio]).forEach(function (instrument) {
        var remainingLots = fifoRemainingLots(byPortfolio[portfolio][instrument]);
        var remainingUnits = 0, investedCost = 0;
        remainingLots.forEach(function (lot) { remainingUnits += lot.units; investedCost += lot.units * lot.price; });
        if (remainingUnits < 1) return;
        holdings.push({ portfolio: portfolio, instrument: instrument, units: remainingUnits, invested: investedCost });
      });
    });

    if (!holdings.length) {
      statusEl.textContent = "No mutual fund holdings with unsold units found.";
      if (window.__wfMfPortfolioSplitChart) { window.__wfMfPortfolioSplitChart.destroy(); window.__wfMfPortfolioSplitChart = null; }
      return;
    }

    buildInstrumentSchemeMap().then(function (schemeMap) {
      var resolvable = holdings.filter(function (h) { return !!lookupSchemeCode(schemeMap, h.instrument); });
      if (!resolvable.length) {
        statusEl.textContent = "None of your holdings could be resolved to a Scheme Code via the Mutual Fund Mapping sheet and AMFI.";
        if (window.__wfMfPortfolioSplitChart) { window.__wfMfPortfolioSplitChart.destroy(); window.__wfMfPortfolioSplitChart = null; }
        return;
      }

      return Promise.all(resolvable.map(function (h) { return fetchNavHistory(lookupSchemeCode(schemeMap, h.instrument)); }))
        .then(function (navHistories) {
          var totalsByPortfolio = {};
          resolvable.forEach(function (h, i) {
            var navHistory = navHistories[i] || [];
            if (!navHistory.length) return;
            var currNav = navHistory[navHistory.length - 1].nav;
            var current = h.units * currNav;
            totalsByPortfolio[h.portfolio] = (totalsByPortfolio[h.portfolio] || 0) + current;
          });

          var labels = Object.keys(totalsByPortfolio);
          if (!labels.length) {
            statusEl.textContent = "Couldn't determine current value for any holding yet.";
            if (window.__wfMfPortfolioSplitChart) { window.__wfMfPortfolioSplitChart.destroy(); window.__wfMfPortfolioSplitChart = null; }
            return;
          }
          var data = labels.map(function (l) { return totalsByPortfolio[l]; });
          var total = data.reduce(function (sum, v) { return sum + v; }, 0);

          statusEl.textContent = "Current value split across " + labels.length + " portfolio(s), total " + formatCurrency(total) + ".";

          renderApplePieChart(canvas, {
            instanceKey: "__wfMfPortfolioSplitChart",
            labels: labels,
            data: data,
            total: total,
            centerLabel: "Current",
            formatLabel: formatCurrency
          });
        });
    }).catch(function (err) {
      statusEl.textContent = "Couldn't load the portfolio split: " + (err && err.message ? err.message : err);
    });
  }

  renderMutualFundPortfolioSplitChart();

  function linkPieChartBoxSizes(boxIdA, boxIdB) {
    var boxA = document.getElementById(boxIdA);
    var boxB = document.getElementById(boxIdB);
    if (!boxA || !boxB || boxA.dataset.linkedResize || typeof ResizeObserver === "undefined") return;
    boxA.dataset.linkedResize = "1";
    boxB.dataset.linkedResize = "1";

    var syncing = false;
    function mirror(source, target) {
      if (syncing) return;
      var rect = source.getBoundingClientRect();
      var targetRect = target.getBoundingClientRect();
      if (Math.abs(rect.width - targetRect.width) < 1 && Math.abs(rect.height - targetRect.height) < 1) return;
      syncing = true;
      target.style.width = Math.round(rect.width) + "px";
      target.style.height = Math.round(rect.height) + "px";
      requestAnimationFrame(function () { syncing = false; });
    }

    new ResizeObserver(function () { mirror(boxA, boxB); }).observe(boxA);
    new ResizeObserver(function () { mirror(boxB, boxA); }).observe(boxB);
  }

  linkPieChartBoxSizes("market-segment-resize", "mf-portfolio-split-resize");

  // ===== Stocks/ETF Holdings Table =====
  var seHoldingsSortState = { key: null, dir: 1 };

  function renderSeHoldingsRows(tbody, rowsData) {
    var key = seHoldingsSortState.key;
    var dir = seHoldingsSortState.dir;
    var sorted = rowsData.slice();
    if (key) {
      sorted.sort(function (a, b) {
        var av = a[key], bv = b[key];
        if (av === null || av === undefined) av = (typeof bv === "number") ? -Infinity : "";
        if (bv === null || bv === undefined) bv = (typeof av === "number") ? -Infinity : "";
        if (typeof av === "string" || typeof bv === "string") return String(av).localeCompare(String(bv)) * dir;
        return (av - bv) * dir;
      });
    }

    tbody.innerHTML = "";
    sorted.forEach(function (h, idx) {
      var tr = document.createElement("tr");
      tr.style.animationDelay = (Math.min(idx, 12) * 25) + "ms";
      tr.className = "row-enter";

      var nameTd = document.createElement("td");
      nameTd.className = "fund-name";
      nameTd.textContent = h.instrument;
      nameTd.title = h.instrument;
      tr.appendChild(nameTd);

      var qtyTd = document.createElement("td");
      qtyTd.className = "num col-desktop-only";
      qtyTd.textContent = h.units.toFixed(3);
      tr.appendChild(qtyTd);

      var avgTd = document.createElement("td");
      avgTd.className = "num col-desktop-only";
      avgTd.textContent = "₹" + h.avgCostINR.toFixed(2);
      tr.appendChild(avgTd);

      var ltpTd = document.createElement("td");
      ltpTd.className = "num col-desktop-only";
      ltpTd.textContent = h.ltpINR !== null ? "₹" + h.ltpINR.toFixed(2) : "—";
      tr.appendChild(ltpTd);

      var investedTd = document.createElement("td");
      investedTd.className = "num col-desktop-only";
      investedTd.textContent = formatCurrency(h.investedINR);
      tr.appendChild(investedTd);

      var currentTd = document.createElement("td");
      currentTd.className = "num";
      currentTd.textContent = h.currentINR !== null ? formatCurrency(h.currentINR) : "—";
      tr.appendChild(currentTd);

      var dayChgTd = document.createElement("td");
      dayChgTd.className = "num col-desktop-only";
      if (h.dayChangeINR !== null) {
        dayChgTd.appendChild(pnlChip((h.dayChangeINR > 0 ? "+" : "") + formatCurrency(h.dayChangeINR), h.dayChangeINR));
      } else {
        dayChgTd.textContent = "—";
      }
      tr.appendChild(dayChgTd);

      var pnlTd = document.createElement("td");
      pnlTd.className = "num";
      if (h.pnl !== null) {
        pnlTd.appendChild(pnlChip((h.pnl > 0 ? "+" : "") + formatCurrency(h.pnl), h.pnl));
      } else {
        pnlTd.textContent = "—";
      }
      tr.appendChild(pnlTd);

      var netChgTd = document.createElement("td");
      netChgTd.className = "num col-desktop-only";
      if (h.pnlPct !== null) {
        netChgTd.appendChild(pnlChip((h.pnlPct > 0 ? "+" : "") + h.pnlPct.toFixed(2) + "%", h.pnlPct));
      } else {
        netChgTd.textContent = "—";
      }
      tr.appendChild(netChgTd);

      var xirrTd = document.createElement("td");
      xirrTd.className = "num col-desktop-only";
      if (h.xirrPct === null || h.xirrPct === undefined || h.units < UNITS_EPSILON) {
        xirrTd.textContent = "—";
      } else {
        xirrTd.appendChild(pnlChip((h.xirrPct > 0 ? "+" : "") + h.xirrPct.toFixed(2) + "%", h.xirrPct));
      }
      tr.appendChild(xirrTd);

      tbody.appendChild(tr);
    });
  }

  function attachSeHoldingsSortHandlers(tbody, rowsData) {
    var table = tbody.closest("table");
    if (!table) return;
    table.__wfSeRowsData = rowsData;
    if (table.dataset.seSortableBound) return;
    table.dataset.seSortableBound = "1";
    var headers = table.querySelectorAll("th[data-sort]");
    headers.forEach(function (th) {
      th.classList.add("sortable");
      var icon = document.createElement("span");
      icon.className = "sort-icon";
      th.appendChild(icon);
      th.addEventListener("click", function () {
        var k = th.getAttribute("data-sort");
        if (seHoldingsSortState.key === k) {
          seHoldingsSortState.dir *= -1;
        } else {
          seHoldingsSortState.key = k;
          seHoldingsSortState.dir = 1;
        }
        headers.forEach(function (other) { other.classList.remove("sort-asc", "sort-desc"); });
        th.classList.add(seHoldingsSortState.dir === 1 ? "sort-asc" : "sort-desc");
        renderSeHoldingsRows(tbody, table.__wfSeRowsData);
      });
    });
  }

  function renderCorporateActionsWarning(corporateActions, seRows, holdings) {
    var warnEl = document.getElementById("stocksetf-corporate-actions-warning");
    if (!warnEl) return;

    // Build map: ticker/identifier.toLowerCase() → { firstTxnDate (ISO), txns }
    // Keyed by ticker (NSE symbol / identifier) to match corporate_actions keys in stock_prices.json
    var heldInstruments = {};
    (holdings || []).forEach(function (h) {
      var earliest = null;
      (h.txns || []).forEach(function (txn) {
        if (txn.date && (!earliest || txn.date < earliest)) earliest = txn.date;
      });
      heldInstruments[h.ticker.toLowerCase()] = {
        firstTxnDate: earliest ? formatDateISO(earliest) : null,
        txns: h.txns || []
      };
    });

    // Build a set of (instrument, date-window) pairs from existing split/bonus rows in the user's sheet
    var recordedKeys = {};
    if (seRows && seRows.length > 1) {
      var header = seRows[0].map(normalizeText);
      var typeIdx = header.indexOf("transaction type");
      var instrumentIdx = header.indexOf("instrument name");
      var dateIdx = header.indexOf("transaction date");
      if (typeIdx !== -1 && instrumentIdx !== -1 && dateIdx !== -1) {
        seRows.slice(1).forEach(function (row) {
          var type = normalizeText(row[typeIdx] || "");
          if (type !== "split" && type !== "bonus") return;
          var instrument = (row[instrumentIdx] || "").trim().toLowerCase();
          var date = parseFlexibleDate(row[dateIdx]);
          if (!date) return;
          // Allow ±14 day window around the recorded date
          for (var d = -14; d <= 14; d++) {
            var shifted = new Date(date.getTime() + d * 86400000);
            recordedKeys[instrument + "|" + formatDateISO(shifted)] = true;
          }
        });
      }
    }

    var unmatched = [];
    Object.keys(corporateActions).forEach(function (instrument) {
      var instrumentKey = instrument.toLowerCase();
      // Only warn for instruments the user currently holds
      if (!heldInstruments.hasOwnProperty(instrumentKey)) return;
      var held = heldInstruments[instrumentKey];
      var firstTxnDate = held.firstTxnDate;
      var txns = held.txns;
      var actions = corporateActions[instrument];
      actions.forEach(function (action) {
        // Skip corporate actions that happened before the user's first transaction
        if (firstTxnDate && action.date < firstTxnDate) return;
        var key = instrumentKey + "|" + action.date;
        if (!recordedKeys[key]) {
          // Calculate units held just before the corporate action date
          var unitsAtAction = 0;
          txns.forEach(function (txn) {
            if (!txn.date || formatDateISO(txn.date) >= action.date) return;
            unitsAtAction += txn.type === "buy" ? txn.units : -txn.units;
          });
          unitsAtAction = Math.max(0, Math.round(unitsAtAction * 1000) / 1000);
          if (unitsAtAction <= 0) return; // no units held at time of action — skip
          var extraUnits = Math.round(unitsAtAction * (action.ratio - 1) * 1000) / 1000;
          var dateParts = action.date.split("-");
          var displayDate = dateParts[2] + "/" + dateParts[1] + "/" + dateParts[0];
          var ratioDisplay = (action.ratio % 1 === 0) ? action.ratio.toFixed(0) : action.ratio;
          var label = instrument + " (" + displayDate + "): " + ratioDisplay + ":1 "
            + (action.type === "split" ? "split" : "bonus")
            + " — add " + extraUnits + " units at ₹0";
          unmatched.push(label);
        }
      });
    });

    if (!unmatched.length) {
      warnEl.hidden = true;
      return;
    }

    warnEl.hidden = false;
    warnEl.innerHTML = "";
    var title = document.createElement("div");
    title.className = "ca-warning-title";
    title.innerHTML = "<svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'/><line x1='12' y1='9' x2='12' y2='13'/><line x1='12' y1='17' x2='12.01' y2='17'/></svg> Corporate actions not recorded";
    warnEl.appendChild(title);
    var ul = document.createElement("ul");
    unmatched.forEach(function (msg) {
      var li = document.createElement("li");
      li.textContent = msg;
      ul.appendChild(li);
    });
    warnEl.appendChild(ul);
    var hint = document.createElement("p");
    hint.className = "ca-hint";
    hint.textContent = "For each item above, add a row with Transaction Type \"Split\" or \"Bonus\", the indicated units, price 0, and exactly the date shown. The banner clears once a matching row is recorded.";
    warnEl.appendChild(hint);
  }

  function renderStockEtfHoldingsTable() {
    var indiaStatusEl = document.getElementById("stocksetf-india-holdings-status");
    var indiaTableWrap = document.getElementById("stocksetf-india-holdings-table-wrap");
    var indiaTbody = document.getElementById("stocksetf-india-holdings-tbody");
    var usStatusEl = document.getElementById("stocksetf-us-holdings-status");
    var usTableWrap = document.getElementById("stocksetf-us-holdings-table-wrap");
    var usTbody = document.getElementById("stocksetf-us-holdings-tbody");
    if (!indiaStatusEl || !usStatusEl) return;

    var rows = getSheetRows("stocksetf");
    if (!rows || !rows.length) {
      indiaStatusEl.textContent = "Connect your Stocks/ETF Transactions sheet in Settings to populate this view.";
      usStatusEl.textContent = "Connect your Stocks/ETF Transactions sheet in Settings to populate this view.";
      if (indiaTableWrap) indiaTableWrap.hidden = true;
      if (usTableWrap) usTableWrap.hidden = true;
      return;
    }

    var selectedPortfolio = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
    var mappingTable = buildStockMappingTable();

    if (!Object.keys(mappingTable).length) {
      indiaStatusEl.textContent = "Sync your Stocks/ETF Mapping sheet in Settings → Mapping → Stocks/ETF Mapping, then return here.";
      usStatusEl.textContent = "Sync your Stocks/ETF Mapping sheet in Settings → Mapping → Stocks/ETF Mapping, then return here.";
      if (indiaTableWrap) indiaTableWrap.hidden = true;
      if (usTableWrap) usTableWrap.hidden = true;
      return;
    }

    indiaStatusEl.textContent = "Loading holdings…";
    usStatusEl.textContent = "Loading holdings…";

    var showClosedCheckbox = document.getElementById("stocksetf-show-closed");
    var showClosed = !!(showClosedCheckbox && showClosedCheckbox.checked);
    var showClosedUSCheckbox = document.getElementById("stocksetf-us-show-closed");
    var showClosedUS = !!(showClosedUSCheckbox && showClosedUSCheckbox.checked);
    Promise.all([
      buildStockHoldings(rows, mappingTable, selectedPortfolio, showClosed),
      buildStockHoldings(rows, mappingTable, selectedPortfolio, showClosedUS),
      buildStockHoldings(rows, mappingTable, selectedPortfolio, false)
    ]).then(function (results) {
      var indiaHoldings = results[0].filter(function(h) { return h.region !== "US"; });
      var usHoldings = results[1].filter(function(h) { return h.region === "US"; });
      var holdings = indiaHoldings.concat(usHoldings);
      var openHoldings = results[2];

      if (!holdings.length) {
        indiaStatusEl.textContent = "No Stocks/ETF holdings with unsold units found. Ensure instrument names match the mapping sheet exactly.";
        usStatusEl.textContent = "No US holdings found.";
        if (indiaTableWrap) indiaTableWrap.hidden = true;
        if (usTableWrap) usTableWrap.hidden = true;
        return;
      }

      indiaStatusEl.textContent = "Fetching live prices…";
      usStatusEl.textContent = "Fetching live prices…";

      // Load prices from stock_prices.json (generated by GitHub Actions via yfinance)
      return fetchAllStockPrices().catch(function () { return { prices: {}, usd_inr_history: {} }; }).then(function (stockData) {
        renderCorporateActionsWarning(stockData.corporate_actions || {}, rows, openHoldings);
        var allPrices = stockData.prices || {};
        var usdInrHistMap = stockData.usd_inr_history || {};
        var usdInrToday = allPrices["__USD_INR__"] ? allPrices["__USD_INR__"].price : 84;
        var pricesAvailable = Object.keys(allPrices).length > 0;
        var pricesUpdatedEl = document.getElementById("stocksetf-prices-updated");
        if (pricesUpdatedEl) {
          if (pricesAvailable && stockData.updated) {
            var utcDate = new Date(stockData.updated);
            var istStr = utcDate.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
            pricesUpdatedEl.textContent = "Prices as of " + istStr + " IST";
          } else if (!pricesAvailable) {
            pricesUpdatedEl.textContent = "Prices not yet fetched — trigger the \"Fetch Stock Prices\" GitHub Actions workflow.";
          } else {
            pricesUpdatedEl.textContent = "";
          }
        }

        var rowsData = [];

        holdings.forEach(function (h) {
          var isClosed = h.units < UNITS_EPSILON;
          var priceEntry = allPrices[h.ticker] || null;
          var eodRaw = priceEntry ? priceEntry.price : null;
          var prevRaw = priceEntry ? priceEntry.prev_close : null;
          var ltpINR = null, currentINR = null, dayChangeINR = null, pnl = null, pnlPct = null;
          var investedForDisplay = h.investedINR;
          var avgCostForDisplay = h.avgCostINR;

          if (isClosed) {
            // Mirrors MF closed position behaviour: show realized figures
            var detail = computeInstrumentRealizedDetail(h.txns || []);
            if (h.region === "US") {
              var sellDateStr = detail.lastSellDate ? formatDateISO(detail.lastSellDate) : null;
              var sellRate = (sellDateStr && usdInrHistMap[sellDateStr]) ? usdInrHistMap[sellDateStr] : usdInrToday;
              ltpINR = detail.lastSellPrice * sellRate;
              currentINR = detail.saleProceeds * sellRate;
              investedForDisplay = detail.costOfSoldUnits * sellRate;
              avgCostForDisplay = detail.avgBuyCost * sellRate;
            } else {
              ltpINR = detail.lastSellPrice;
              currentINR = detail.saleProceeds;
              investedForDisplay = detail.costOfSoldUnits;
              avgCostForDisplay = detail.avgBuyCost;
            }
            pnl = currentINR - investedForDisplay;
            pnlPct = investedForDisplay > 0 ? (pnl / investedForDisplay) * 100 : null;
          } else {
            if (eodRaw !== null) {
              if (h.region === "US") {
                ltpINR = eodRaw * usdInrToday;
              } else {
                ltpINR = eodRaw;
              }
              currentINR = h.units * ltpINR;
              pnl = currentINR - h.investedINR;
              pnlPct = h.investedINR > 0 ? (pnl / h.investedINR) * 100 : null;

              if (prevRaw !== null) {
                var prevINR = h.region === "US" ? prevRaw * usdInrToday : prevRaw;
                dayChangeINR = (ltpINR - prevINR) * h.units;
              }
            }
          }

          // XIRR cash flows in INR (no current value added for closed positions)
          var xirrFlows = [];
          if (h.region === "US") {
            (h.txns || []).forEach(function (txn) {
              if (!txn.date || !txn.units || !txn.price) return;
              var dateStr = formatDateISO(txn.date);
              var rateForDate = usdInrHistMap[dateStr] || usdInrToday;
              var amountINR = txn.units * txn.price * rateForDate;
              xirrFlows.push({ date: txn.date, amount: txn.type === "buy" ? -amountINR : amountINR });
            });
          } else {
            xirrFlows = buildXirrCashFlows(rows, selectedPortfolio, h.instrument);
          }
          if (!isClosed && currentINR !== null && currentINR > UNITS_EPSILON) {
            xirrFlows.push({ date: new Date(), amount: currentINR });
          }
          var xirrVal = calculateXIRR(xirrFlows);
          var xirrPct = (xirrVal === null || xirrVal === undefined || !isFinite(xirrVal)) ? null : xirrVal * 100;

          rowsData.push({
            instrument: h.instrument,
            region: h.region,
            units: h.units,
            avgCostINR: avgCostForDisplay,
            ltpINR: ltpINR,
            investedINR: investedForDisplay,
            currentINR: currentINR,
            dayChangeINR: dayChangeINR,
            pnl: pnl,
            pnlPct: pnlPct,
            xirrPct: xirrPct
          });
        });

          // Compute header stats always from open positions only
          var totalCurrentINR = 0, totalInvestedINR = 0, totalDayChangeINR = 0, totalPnlINR = 0;
          openHoldings.forEach(function (h) {
            var priceEntry = allPrices[h.ticker] || null;
            var eodRaw = priceEntry ? priceEntry.price : null;
            var prevRaw = priceEntry ? priceEntry.prev_close : null;
            if (eodRaw === null) return;
            var ltpINR = h.region === "US" ? eodRaw * usdInrToday : eodRaw;
            var cur = h.units * ltpINR;
            totalCurrentINR += cur;
            totalInvestedINR += h.investedINR;
            totalPnlINR += cur - h.investedINR;
            if (prevRaw !== null) {
              var prevINR = h.region === "US" ? prevRaw * usdInrToday : prevRaw;
              totalDayChangeINR += (ltpINR - prevINR) * h.units;
            }
          });

          var indiaRowsData = rowsData.filter(function(r) { return r.region !== "US"; });
          var usRowsData = rowsData.filter(function(r) { return r.region === "US"; });

          if (indiaHoldings.length) {
            renderSeHoldingsRows(indiaTbody, indiaRowsData);
            attachSeHoldingsSortHandlers(indiaTbody, indiaRowsData);
            indiaStatusEl.textContent = indiaRowsData.length + " holding(s).";
            if (indiaTableWrap) indiaTableWrap.hidden = false;
          } else {
            indiaStatusEl.textContent = "No India holdings found.";
            if (indiaTableWrap) indiaTableWrap.hidden = true;
          }

          if (usHoldings.length) {
            renderSeHoldingsRows(usTbody, usRowsData);
            attachSeHoldingsSortHandlers(usTbody, usRowsData);
            usStatusEl.textContent = usRowsData.length + " holding(s). Values in INR at today\'s USD/INR rate.";
            if (usTableWrap) usTableWrap.hidden = false;
          } else {
            usStatusEl.textContent = "No US holdings found.";
            if (usTableWrap) usTableWrap.hidden = true;
          }

          // Feed live totals back into overview accumulator and refresh dashboard
          // Use FIFO-adjusted invested (remaining lots only), not all-time buy total
          _ov.seInvested   = totalInvestedINR;
          _ov.seCurrent    = totalCurrentINR;
          _ov.seUnrealized = totalPnlINR;
          _ov.seDayChange  = totalDayChangeINR;
          var seInvestedEl = document.getElementById("stocksetf-total-investment");
          if (seInvestedEl) seInvestedEl.textContent = formatCurrency(totalInvestedINR);
          refreshOverviewStats(); refreshCategoryCards();
          if (_ov._mfCommDayChange !== null) {
            var overviewDayChgEl = document.getElementById("overview-day-change");
            if (overviewDayChgEl) setDayChange(overviewDayChgEl, _ov._mfCommDayChange + totalDayChangeINR);
          }

          // Update stat cards
          var seCurrentEl = document.getElementById("stocksetf-current-value");
          var seDayChgEl = document.getElementById("stocksetf-day-change");
          var seUnrealizedEl = document.getElementById("stocksetf-unrealized");
          var seReturnPctEl = document.getElementById("stocksetf-return-pct");
          var seXirrEl = document.getElementById("stocksetf-xirr");

          if (seCurrentEl) seCurrentEl.textContent = formatCurrency(totalCurrentINR);
          if (seDayChgEl) setSignedCurrency(seDayChgEl, totalDayChangeINR);
          if (seUnrealizedEl) setSignedCurrency(seUnrealizedEl, totalPnlINR);
          if (seReturnPctEl) {
            var retPct = totalInvestedINR > 0 ? (totalPnlINR / totalInvestedINR) * 100 : 0;
            seReturnPctEl.textContent = (retPct > 0 ? "+" : "") + retPct.toFixed(2) + "%";
            seReturnPctEl.className = "overview-stat-value " + (retPct > 0 ? "positive" : retPct < 0 ? "negative" : "");
          }

          // Portfolio-level XIRR (always from open positions)
          var seXirrFlows = [];
          openHoldings.forEach(function (hh) {
            if (hh.region === "US") {
              (hh.txns || []).forEach(function (txn) {
                if (!txn.date || !txn.units || !txn.price) return;
                var dateStr = formatDateISO(txn.date);
                var rateForDate = usdInrHistMap[dateStr] || usdInrToday;
                seXirrFlows.push({ date: txn.date, amount: txn.type === "buy" ? -(txn.units * txn.price * rateForDate) : (txn.units * txn.price * rateForDate) });
              });
            } else {
              buildXirrCashFlows(rows, selectedPortfolio, hh.instrument).forEach(function (f) { seXirrFlows.push(f); });
            }
          });
          // Store flows WITH terminal in _ov so the overview XIRR has a positive terminal to converge on.
          var seXirrFlowsWithTerminal = seXirrFlows.slice();
          if (totalCurrentINR > UNITS_EPSILON) seXirrFlowsWithTerminal.push({ date: new Date(), amount: totalCurrentINR });
          _ov.seXirrFlows = seXirrFlowsWithTerminal;
          if (seXirrEl) {
            var allFlows = seXirrFlowsWithTerminal;
            var portXirr = calculateXIRR(allFlows);
            if (portXirr !== null && isFinite(portXirr)) {
              var xirrPctPort = portXirr * 100;
              seXirrEl.textContent = (xirrPctPort > 0 ? "+" : "") + xirrPctPort.toFixed(2) + "%";
              seXirrEl.className = "overview-stat-value " + (xirrPctPort > 0 ? "positive" : xirrPctPort < 0 ? "negative" : "");
            } else {
              seXirrEl.textContent = "—";
            }
          }
          // Refresh overview XIRR now that SE flows are available.
          // _ov._overviewBaseFlows is set by updateTotalCurrentValue (equity+FI+commodity flows).
          // If it's already been computed, we can recompute overview XIRR without re-fetching.
          if (_ov._overviewBaseFlows) {
            var overviewXirrEl = document.getElementById("overview-xirr");
            if (overviewXirrEl) {
              setXirr(overviewXirrEl, calculateXIRR(_ov._overviewBaseFlows.concat(_ov.seXirrFlows)));
            }
          }
      });
    }).catch(function (err) {
      var msg = "Couldn't load holdings: " + (err && err.message ? err.message : err);
      if (indiaStatusEl) indiaStatusEl.textContent = msg;
      if (usStatusEl) usStatusEl.textContent = msg;
      if (indiaTableWrap) indiaTableWrap.hidden = true;
      if (usTableWrap) usTableWrap.hidden = true;
    });
  }

  renderStockEtfHoldingsTable();

  initBenchmarkCard();
  initRollingReturnSummary();

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

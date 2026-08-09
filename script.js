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

  // Which source each market payload came from, and when — read by the
  // "Price Updated" indicator.
  //
  // Declared HERE rather than beside the fetch helpers 8,300 lines below, purely
  // as ordering hygiene: selectPortfolio() runs at script.js:556, during this
  // file's own top-level execution, and starts those fetches. `var` hoists the
  // declaration but not the value, so anything assigned further down is undefined
  // to any code that runs before the body gets there — including every async
  // callback if the body ever aborts early.
  //
  // That is not hypothetical: an earlier version of the year picker was written
  // as `var X = (function(){...})()` below this point, threw at line 556, and
  // aborted the rest of the body — after which _marketSource was undefined and
  // recording a source threw "Cannot set properties of undefined". The picker was
  // the fault, not this variable; moving the declaration up just means the next
  // such mistake does not take the market-source indicator down with it.
  var _marketSource = {};

  // ─── Bulky payload cache (IndexedDB, not localStorage) ─────────────────────
  //
  // Three market-data payloads dominate a cold load: stock_prices.json (~2.3 MB),
  // amfi_nav.json (~1 MB) and amfi_isin_map.json (~0.5 MB). They used to be cached
  // in localStorage, which is SYNCHRONOUS — every load paid a JSON.parse of
  // multi-megabyte text on the main thread, and every refresh paid a JSON.stringify
  // plus a blocking disk write. On a mid-range Android that is the visible freeze.
  //
  // Worse, the three together exceed the ~5 MB localStorage quota, so setItem threw,
  // the entry was never stored, and the next load re-downloaded AND re-stringified
  // the whole thing. The cache was costing time without ever paying off.
  //
  // IndexedDB is asynchronous, has a far larger quota, and stores structured clones,
  // so there is no JSON serialisation at all. A miss is always safe: the caller
  // falls back to the network exactly as before.
  var BLOB_CACHE_PREFIX = "blob:";
  function _blobCacheGet(key, maxAgeMs) {
    // Reclaim quota from the legacy localStorage entry, once, on first read.
    try { localStorage.removeItem(key); } catch (e) {}
    if (!window.WfIdb) return Promise.resolve(null);
    return WfIdb.get(BLOB_CACHE_PREFIX + key).then(function (entry) {
      if (entry && entry.fetchedAt && (Date.now() - entry.fetchedAt) < maxAgeMs) return entry;
      return null;
    }).catch(function () { return null; });
  }
  function _blobCacheSet(key, entry) {
    if (!window.WfIdb || !entry) return;
    entry.fetchedAt = Date.now();
    try { WfIdb.set(BLOB_CACHE_PREFIX + key, entry); } catch (e) {}
  }

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

  // Guarded on the WHOLE legacy modal, not just the button. index.html has the
  // "Log in" button (and wires it to its own auth modal inline) but none of the rest
  // of this markup, so checking only openLoginBtn let the block run and then throw on
  // closeLoginBtn — an uncaught error on every landing-page load that also killed the
  // remainder of this IIFE, so anything added below it silently did not run there.
  if (openLoginBtn && loginOverlay && closeLoginBtn && tabLogin && tabSignup) {
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
      { tab: document.getElementById("tab-expense"), panel: document.getElementById("panel-expense"), key: "expense" },
      { tab: document.getElementById("tab-github"), panel: document.getElementById("panel-github"), key: "github" },
      { tab: document.getElementById("tab-epf"), panel: document.getElementById("panel-epf"), key: "epf" }
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
      if (tab === "epf" && window.wfRenderEpfRates) window.wfRenderEpfRates();
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
      if (key === "fixedincome") { renderAllFixedIncomeHoldingsTable(); renderCommodityHoldingsTable(); }
      // "Refresh NAV" applies to the Mutual Fund tab only; "Refresh Price" to
      // the Stocks/ETF tab only — each in the same right-aligned position.
      var refreshBtn = document.getElementById("equity-refresh-nav");
      if (refreshBtn) refreshBtn.style.display = (key === "equity") ? "" : "none";
      var refreshPriceBtn = document.getElementById("stocksetf-refresh-price");
      if (refreshPriceBtn) refreshPriceBtn.style.display = (key === "stocksetf") ? "" : "none";
      if (typeof window.wfResizeCharts === "function") window.wfResizeCharts();
    }

    investSubTabs.forEach(function (entry) {
      if (!entry.tab) return;
      entry.tab.addEventListener("click", function () { showInvestmentSubTab(entry.key); });
    });

    // Chart.js charts created while their tab/panel is hidden lay out at 0×0 and
    // don't fix themselves when shown or when the device rotates. Resize every
    // live chart whenever a panel becomes visible or the viewport changes, so
    // all cards/charts render correctly on any device (esp. mobile).
    function resizeAllCharts() {
      if (!window.Chart || typeof Chart.getChart !== "function") return;
      document.querySelectorAll("canvas").forEach(function (cv) {
        if (cv.offsetParent === null) return; // skip hidden canvases
        var ch = Chart.getChart(cv);
        if (ch) { try { ch.resize(); } catch (e) {} }
      });
    }
    var _chartResizeT = null;
    function scheduleChartResize(delay) {
      clearTimeout(_chartResizeT);
      _chartResizeT = setTimeout(resizeAllCharts, delay || 80);
    }
    window.wfResizeCharts = scheduleChartResize;
    if (!window.__wfChartResizeBound) {
      window.__wfChartResizeBound = true;
      window.addEventListener("resize", function () { scheduleChartResize(120); });
      window.addEventListener("orientationchange", function () { scheduleChartResize(250); });
    }

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
      // Mobile header shows the active tab as a centred title; the "+" add-record
      // button is only meaningful on the Expense tab.
      var titleEl = document.getElementById("mobile-header-title");
      if (titleEl) {
        var labels = { overview: "Overview", investment: "Investments", expense: "Expense", github: "GitHub Integration" };
        titleEl.textContent = labels[tab] || "";
      }
      var addBtn = document.getElementById("header-add-record");
      if (addBtn) addBtn.style.display = (tab === "expense") ? "" : "none";
      scheduleChartResize();
    }

    dashTabs.forEach(function (entry) {
      if (!entry.tab) return;
      entry.tab.addEventListener("click", function () { showDashboardTab(entry.key); });
    });

    // On mobile the header tab buttons are hidden (CSS) in favour of a centred
    // title + hamburger drawer; every tab is reachable from the drawer. Land on
    // the Expense tab on phones (quick expense entry is the primary mobile use).
    if (window.matchMedia && window.matchMedia("(max-width: 760px)").matches) {
      showDashboardTab("expense");
    }
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
    // The Overview selector filters ONLY the Overview tab. Refresh the Overview
    // surfaces: cards (updateDashboardStats), Account Value / Growth chart,
    // Portfolio & Category splits, and the Stocks/ETF overview totals (which
    // renderStockEtfHoldingsTable recomputes for the selected portfolio). The
    // Investments/Expense tabs are independent and are not re-rendered here.
    updateDashboardStats();
    renderValueChart();
    renderInvestmentSplitChart();
    renderInstrumentSplitChart();
    renderMonthlyInvestmentByCategory();
    renderProfitByCategoryCard();
    renderStockEtfHoldingsTable();
    // Nudge the Benchmark Comparison + Rolling Returns cards to recompute for
    // the new portfolio (they refresh on the next wf-overview-flows-ready).
    document.dispatchEvent(new CustomEvent("wf-exclusion-changed"));
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

  // Resolve the app's standard sheet column positions from a NORMALIZED header row
  // (i.e. rows[0].map(normalizeText)). Replaces the 4-6 line "var xIdx =
  // header.indexOf(...)" preamble that was copy-pasted across dozens of functions —
  // a single source of truth for column names that kills the "renamed a column,
  // missed one call site" bug class. Behaviour is identical to the inline lookups:
  // it does the same .indexOf on the same array, so every field is -1 when absent.
  // `date` uses the app-wide fuzzy "contains 'date'" match.
  function getColumnIndices(header) {
    var h = header || [];
    return {
      portfolio: h.indexOf("portfolio name"),
      instrument: h.indexOf("instrument name"),
      type: h.indexOf("transaction type"),
      units: h.indexOf("units"),
      price: h.indexOf("price"),
      amount: h.indexOf("amount"),
      investedAmount: h.indexOf("invested amount"),
      category: h.indexOf("instrument category"),
      subCategory: h.indexOf("instrument sub category"),
      bank: h.indexOf("bank"),
      // Exact "transaction date" vs the fuzzy "contains 'date'" match — kept
      // distinct because some sheets have several date columns (e.g. maturity date)
      // and different call sites deliberately want one or the other.
      transactionDate: h.indexOf("transaction date"),
      date: h.findIndex(function (x) { return typeof x === "string" && x.indexOf("date") !== -1; })
    };
  }

  // Escape strings coming from Google Sheet cells (instrument/portfolio/sub-cat
  // names, etc.) before interpolating into innerHTML. The dashboard origin holds
  // the Supabase session + GitHub PAT in localStorage, so an unescaped sheet cell
  // like <img src=x onerror=...> would be a real stored-XSS vector.
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // USD/INR rate for a given ISO date. Exact match first; otherwise the nearest
  // available date in the history map (prev preferred, then next) — ISO date keys
  // sort chronologically — and finally the supplied fallback (today's rate).
  // This avoids the old "exact-date-only, else hardcoded 84" mispricing for buys
  // dated on weekends/holidays or outside the history window.
  function lookupUsdInrRate(rateMap, dateStr, fallback) {
    if (!rateMap) return fallback;
    if (rateMap[dateStr]) return rateMap[dateStr];
    var keys = rateMap.__wfSortedKeys;
    if (!keys) {
      keys = Object.keys(rateMap).filter(function (k) { return k.indexOf("__") !== 0; }).sort();
      try { Object.defineProperty(rateMap, "__wfSortedKeys", { value: keys, enumerable: false, configurable: true }); } catch (e) {}
    }
    if (!keys.length) return fallback;
    var lo = 0, hi = keys.length - 1, bestPrev = null, bestNext = null;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (keys[mid] <= dateStr) { bestPrev = keys[mid]; lo = mid + 1; }
      else { bestNext = keys[mid]; hi = mid - 1; }
    }
    var chosen = bestPrev || bestNext;
    return chosen ? rateMap[chosen] : fallback;
  }

  // Last available price on or before dateStr (unbounded forward-fill). Used by the
  // TWR value series so a price gap wider than a few days doesn't drop a holding to
  // 0 for that month (which would create an artificial dip/recovery in the CAGR).
  function lastPriceOnOrBefore(priceMap, dateStr) {
    if (!priceMap) return null;
    if (priceMap[dateStr] !== undefined) return priceMap[dateStr];
    var keys = priceMap.__wfSortedKeys;
    if (!keys) {
      keys = Object.keys(priceMap).filter(function (k) { return k.indexOf("__") !== 0; }).sort();
      try { Object.defineProperty(priceMap, "__wfSortedKeys", { value: keys, enumerable: false, configurable: true }); } catch (e) {}
    }
    if (!keys.length) return null;
    var lo = 0, hi = keys.length - 1, best = null;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (keys[mid] <= dateStr) { best = keys[mid]; lo = mid + 1; }
      else hi = mid - 1;
    }
    return best ? priceMap[best] : null;
  }

  // Provident-fund family sub-categories — all valued with the same
  // deposit + interest + FIFO-withdrawal logic. Accepts common spellings.
  function isProvidentFundSub(sub) {
    var s = normalizeText(sub);
    return s === "provident fund" || s === "provident pension" || s === "public provident fund" ||
           s === "employee provident fund" || s === "epf" || s === "employee pension fund";
  }

  // A TERM DEPOSIT: any Fixed Income sub-category that is neither a running
  // balance (Savings Account / Investment Corpus, which carry a rolling figure
  // and accrue monthly) nor a provident fund (which has its own interest
  // engine). Recurring Deposit, Bond, NCD, Sovereign Gold Bond and anything else
  // you write in that column land here.
  //
  // These paths used to test `normSubCategory === "fixed deposit"` exactly, so a
  // row with any other sub-category contributed nothing to Current Value, the
  // holdings lists, the cash flows or the account-value history — the money was
  // not mis-valued, it was invisible. Matching by exclusion means a new
  // instrument type is counted the day it is entered, with no table to update.
  //
  // Valuation is the FD rule: compounded quarterly at the stated Rate of Return
  // until maturity. A blank or zero rate leaves the holding at par, so an
  // unrated instrument degrades to its invested amount rather than disappearing.
  function _fiIsTermDeposit(normSub) {
    if (!normSub) return false;
    if (normSub === "investment corpus" || normSub === "savings account") return false;
    if (isProvidentFundSub(normSub)) return false;
    return true;
  }

  // EPF/PF interest rates configured in Settings → EPF Interest, keyed by the
  // financial-year START year (April-based FY, e.g. 2024 → FY 2024–25).
  // Returns { year: rateFraction } (8.10% → 0.081).
  function getEpfRateMap() {
    var map = {};
    try {
      var arr = JSON.parse(localStorage.getItem("wf-epf-interest-rates"));
      if (Array.isArray(arr)) arr.forEach(function (r) {
        if (r && r.year != null && r.rate != null) map[Number(r.year)] = Number(r.rate) / 100;
      });
    } catch (e) {}
    return map;
  }
  // April-based financial-year start year for a date (Jan–Mar belong to the
  // previous year's FY). getMonth() is 0-indexed, so April = 3.
  function epfFyStart(d) { return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; }

  // Value a single Provident Fund / EPF account with interest computed the EPFO
  // way: monthly interest on the running balance (opening balance + that month's
  // contribution) at the configured annual rate ÷ 12, ACCRUED monthly but
  // CREDITED at the end of the financial year (31 Mar), then compounding into the
  // next year. Within a year the accrued interest does not itself earn interest.
  //   - A financial year that already has a manual "Interest" row keeps the user's
  //     figure and is NOT auto-computed (manual wins, no double count).
  //   - A financial year with no configured rate and no manual interest earns 0.
  //   - Withdrawals reduce principal and interest proportionally (balance drops by
  //     exactly the withdrawal amount).
  // Returns { invested (remaining principal), current, realizedProfit }.
  function computePfAccountValue(txns, rateMap, asOf) {
    var valid = txns.filter(function (t) { return t.date; }).sort(function (a, b) { return a.date - b.date; });
    // No usable dates → fall back to a simple, un-compounded sum (old behaviour).
    if (!valid.length) {
      var lotsF = [], intF = 0, realF = 0;
      txns.forEach(function (t) {
        if (t.type === "interest") intF += t.amount;
        else if (t.type === "withdrawal") {
          var pb = lotsF.reduce(function (s, l) { return s + l; }, 0), bb = pb + intF, w = Math.min(t.amount, bb);
          if (bb > 0 && w > 0) { var pp = w * (pb / bb), ip = w - pp, rem = pp; while (rem > 1e-9 && lotsF.length) { if (lotsF[0] <= rem + 1e-9) { rem -= lotsF.shift(); } else { lotsF[0] -= rem; rem = 0; } } realF += ip; intF -= ip; }
        } else lotsF.push(t.amount);
      });
      var invF = lotsF.reduce(function (s, l) { return s + l; }, 0);
      return { invested: invF, current: invF + intF, realizedProfit: realF, realizedByYear: {} };
    }
    var realizedByYear = {};

    // Manual interest per FY (any manual interest in a FY suppresses auto-calc for it).
    var manualByFY = {};
    valid.forEach(function (t) { if (t.type === "interest") { var fy = epfFyStart(t.date); manualByFY[fy] = (manualByFY[fy] || 0) + t.amount; } });

    // Bucket transactions by calendar year-month.
    var byYM = {};
    valid.forEach(function (t) {
      var k = t.date.getFullYear() + "-" + t.date.getMonth();
      var c = byYM[k] || (byYM[k] = { dep: [], intr: 0, wd: [] });
      if (t.type === "interest") c.intr += t.amount;
      else if (t.type === "withdrawal") c.wd.push(t.amount);
      else c.dep.push(t.amount);
    });

    var lots = [];        // remaining principal
    var credited = 0;     // interest credited at prior FY-ends (earns interest)
    var accrued = 0;      // interest accrued in the current FY (not yet credited)
    var realized = 0;
    var cur = new Date(valid[0].date.getFullYear(), valid[0].date.getMonth(), 1);
    var end = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
    var curFY = epfFyStart(cur);
    var fyHasManual = manualByFY[curFY] > 0;

    while (cur <= end) {
      var fy = epfFyStart(cur);
      if (fy !== curFY) {           // rolled into a new FY → credit the prior FY's accrual
        credited += accrued; accrued = 0;
        curFY = fy; fyHasManual = manualByFY[curFY] > 0;
      }
      var cell = byYM[cur.getFullYear() + "-" + cur.getMonth()];
      if (cell) {
        cell.dep.forEach(function (a) { lots.push({ amount: a }); });
        if (cell.intr) credited += cell.intr;   // manual interest = user's credited figure
        cell.wd.forEach(function (wamt) {
          var principalBefore = lots.reduce(function (s, l) { return s + l.amount; }, 0);
          var interestBefore = credited + accrued;
          var balanceBefore = principalBefore + interestBefore;
          var w = Math.min(wamt, balanceBefore);
          if (balanceBefore > 0 && w > 0) {
            var pp = w * (principalBefore / balanceBefore), ip = w - pp, rem = pp;
            while (rem > 1e-9 && lots.length > 0) { if (lots[0].amount <= rem + 1e-9) { rem -= lots[0].amount; lots.shift(); } else { lots[0].amount -= rem; rem = 0; } }
            realized += ip;
            var wy = String(cur.getFullYear());
            realizedByYear[wy] = (realizedByYear[wy] || 0) + ip;
            var fromAccrued = Math.min(accrued, ip); accrued -= fromAccrued; credited -= (ip - fromAccrued);
          }
        });
      }
      // Auto monthly interest: only when a rate is configured for this FY and the
      // user hasn't recorded a manual interest row for it. Base excludes the
      // current FY's own accrual (it doesn't compound until year-end).
      var rate = rateMap[curFY];
      if (rate && !fyHasManual) {
        var base = lots.reduce(function (s, l) { return s + l.amount; }, 0) + credited;
        accrued += base * (rate / 12);
      }
      cur.setMonth(cur.getMonth() + 1);
    }

    var principal = lots.reduce(function (s, l) { return s + l.amount; }, 0);
    // Current value includes the in-progress FY's accrued interest (shown live,
    // not only after 31 Mar); it is not yet moved into `credited`.
    return { invested: principal, current: principal + credited + accrued, realizedProfit: realized, realizedByYear: realizedByYear };
  }

  // Debug logger — off by default so holdings/scheme codes/emails aren't dumped
  // to the browser console in production. Enable with localStorage wf-debug=1.
  var WF_DEBUG = (function () { try { return localStorage.getItem("wf-debug") === "1"; } catch (e) { return false; } })();
  function dbg() { if (WF_DEBUG && window.console) console.log.apply(console, arguments); }

  function sumInvestmentForRows(rows, portfolioFilter) {
    if (!rows || !rows.length) return 0;
    var header = rows[0].map(normalizeText);
    var _ci = getColumnIndices(header);
    var portfolioIdx = _ci.portfolio, typeIdx = _ci.type, unitsIdx = _ci.units,
        priceIdx = _ci.price, amountIdx = _ci.amount, categoryIdx = _ci.category;
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
    var _ci = getColumnIndices(header);
    var portfolioIdx = _ci.portfolio, typeIdx = _ci.type, amountIdx = _ci.amount, categoryIdx = _ci.category;
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
      // Once an FD matures it is treated as closed — its principal is returned to
      // the user (untracked), so drop it from the Invested total.
      if (h.matured) return;
      fiTotal += h.invested;
    });
    return fiTotal;
  }

  // Add n months to a date, clamping the day to the target month's last day so
  // month-end starts don't overflow (Jan 31 + 1mo → Feb 28, not Mar 3).
  function _addMonthsClamped(base, n) {
    var y = base.getFullYear(), m = base.getMonth() + n, day = base.getDate();
    var lastDay = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(day, lastDay));
  }

  // Counts full 1-month periods completed between start and asOf — used for monthly
  // compounding on Investment Corpus/Savings Account rows. Each boundary is measured
  // from the ORIGINAL start (clamped) so month-end dates neither overflow nor drift.
  function countElapsedMonths(start, asOf) {
    if (!start || !asOf || asOf <= start) return 0;
    var months = 0;
    while (_addMonthsClamped(start, months + 1) <= asOf) months++;
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
    var _ci = getColumnIndices(header);
    var portfolioIdx = _ci.portfolio, amountIdx = _ci.investedAmount, categoryIdx = _ci.category,
        subCategoryIdx = _ci.subCategory, dateIdx = _ci.transactionDate;
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
    while (_addMonthsClamped(start, (quarters + 1) * 3) <= asOf) quarters++;
    return quarters;
  }

  // Elapsed quarters INCLUDING the part-quarter in progress, so a deposit's value
  // grows every day instead of standing still until the next quarter boundary and
  // then stepping. The whole-quarter count is exact; the remainder is the fraction
  // of the current quarter that has elapsed, measured against that quarter's own
  // length (91 or 92 days) so uneven months don't distort it. On a quarter
  // boundary this returns exactly the integer, so quarter-end values are
  // unchanged from countElapsedQuarters.
  function elapsedQuartersFractional(start, asOf) {
    var whole = countElapsedQuarters(start, asOf);
    if (!start || !asOf || asOf <= start) return 0;
    var qStart = _addMonthsClamped(start, whole * 3);
    var qEnd = _addMonthsClamped(start, (whole + 1) * 3);
    var span = qEnd - qStart;
    if (!(span > 0)) return whole;
    var frac = (asOf - qStart) / span;
    if (frac < 0) frac = 0;
    if (frac > 1) frac = 1;
    return whole + frac;
  }

  // Fixed Deposit rows: Current Value = Invested Amount + interest accrued from Transaction
  // Date to today (capped at Maturity Date), compounded quarterly at Rate of Return,
  // with the quarter in progress accrued pro-rata (see elapsedQuartersFractional).
  // Each row stands alone, so no dedup is needed.
  function sumFdMaturedCurrentValue(rows, portfolioFilter) {
    if (!rows || !rows.length) return 0;
    var holdings = buildFdHoldingsList(rows, portfolioFilter, function (normSubCategory) {
      return _fiIsTermDeposit(normSubCategory);
    });
    if (!holdings) return 0;
    var total = 0;
    holdings.forEach(function (h) { total += h.current; });
    return total;
  }

  // Current Value of ACTIVE (not-yet-matured) Fixed Deposits only. A matured FD is
  // treated as closed: its principal + interest leave the Current Value (the interest
  // is booked as Realized Profit instead). Used both for the displayed Current Value
  // AND as the XIRR terminal — matured FDs are excluded here because their proceeds
  // are now emitted as a dated inflow at maturity by buildFdMaturedXirrCashFlows.
  function sumFdActiveCurrentValue(rows, portfolioFilter) {
    if (!rows || !rows.length) return 0;
    var holdings = buildFdHoldingsList(rows, portfolioFilter, function (normSubCategory) {
      return _fiIsTermDeposit(normSubCategory);
    });
    if (!holdings) return 0;
    var total = 0;
    holdings.forEach(function (h) { if (!h.matured) total += h.current; });
    return total;
  }

  function sumProvidentFundCurrentValue(rows, portfolioFilter) {
    if (!rows || !rows.length) return 0;
    var holdings = buildFdFixedIncomeHoldingsList(rows, portfolioFilter);
    if (!holdings) return 0;
    var total = 0;
    holdings.forEach(function (h) {
      var normSub = normalizeText(h.subCategory || "");
      if (isProvidentFundSub(normSub)) total += h.current;
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
      if (isProvidentFundSub(normSub)) total += (h.realizedProfit || 0);
    });
    return total;
  }

  // Realized Profit for Fixed Deposits = interest earned, booked ONLY once the FD has
  // matured (maturity value − invested). While an FD is still running the interest
  // stays in Current Value as Unrealized Profit, not Realized.
  function sumFdRealizedProfit(rows, portfolioFilter) {
    if (!rows || !rows.length) return 0;
    var holdings = buildFdHoldingsList(rows, portfolioFilter, function (normSubCategory) {
      return _fiIsTermDeposit(normSubCategory);
    });
    if (!holdings) return 0;
    var total = 0;
    holdings.forEach(function (h) { if (h.matured) total += h.current - h.invested; });
    return total;
  }

  // What a fixed deposit paid out at maturity: principal compounded quarterly at
  // its own rate, with the part-quarter pro-rated. Shared so the XIRR flows, the
  // realized-interest attribution and the cash-flow chart can never disagree
  // about how much money came back.
  function fdMaturityValue(principal, startDate, maturityDate, rate) {
    var q = elapsedQuartersFractional(startDate, maturityDate);
    return (q > 0 && rate) ? principal * Math.pow(1 + rate / 4, q) : principal;
  }

  // Matured-FD realized interest keyed by maturity YEAR (mirrors sumFdRealizedProfit's
  // total). Lets the Realized Profit card attribute FD interest to a year, not just "all".
  function fdMaturedRealizedByYear(rows, portfolioFilter) {
    var out = {};
    if (!rows || !rows.length) return out;
    var header = rows[0].map(normalizeText);
    var pI = header.indexOf("portfolio name"), cI = header.indexOf("instrument category"),
        sI = header.indexOf("instrument sub category"), aI = header.indexOf("invested amount"),
        dI = header.indexOf("transaction date"), rI = header.indexOf("rate of return"),
        mI = header.indexOf("maturity date/sell date");
    if (mI === -1) mI = header.indexOf("maturity date");
    if (pI === -1 || aI === -1 || dI === -1 || sI === -1 || mI === -1 || rI === -1) return out;
    // Same boundary as the holdings builders (un-zeroed now) so the matured set matches
    // sumFdRealizedProfit exactly, including maturity-on-today.
    var todayD = new Date();
    rows.slice(1).forEach(function (row) {
      var pf = (row[pI] || "").trim();
      if (portfolioFilter !== "all" && normalizeText(pf) !== normalizeText(portfolioFilter)) return;
      if (cI !== -1 && normalizeText(row[cI]) !== "fixed income") return;
      if (!_fiIsTermDeposit(normalizeText(row[sI] || ""))) return;
      var matD = parseFlexibleDate(row[mI]);
      if (!(matD && matD < todayD)) return; // not matured
      var principal = parseNumber(row[aI]);
      var rate = parsePercentRate(row[rI]);
      var matVal = fdMaturityValue(principal, parseFlexibleDate(row[dI]), matD, rate);
      var interest = matVal - principal;
      if (!interest) return;
      var yr = String(matD.getFullYear());
      out[yr] = (out[yr] || 0) + interest;
    });
    return out;
  }

  // Provident-fund realized interest keyed by WITHDRAWAL year (mirrors the FIFO logic
  // in buildFdFixedIncomeHoldingsList so the total equals sumProvidentFundRealizedProfit).
  function pfRealizedByYear(rows, portfolioFilter) {
    var out = {};
    if (!rows || !rows.length) return out;
    var header = rows[0].map(normalizeText);
    var pI = header.indexOf("portfolio name"), cI = header.indexOf("instrument category"),
        sI = header.indexOf("instrument sub category"), tI = header.indexOf("transaction type"),
        aI = header.indexOf("invested amount"), dI = header.indexOf("transaction date"),
        iI = header.indexOf("instrument name");
    if (pI === -1 || aI === -1 || dI === -1 || sI === -1) return out;
    var byKey = {};
    rows.slice(1).forEach(function (row) {
      var pf = (row[pI] || "").trim();
      if (portfolioFilter !== "all" && normalizeText(pf) !== normalizeText(portfolioFilter)) return;
      if (cI !== -1 && normalizeText(row[cI]) !== "fixed income") return;
      if (!isProvidentFundSub(normalizeText(row[sI] || ""))) return;
      var key = normalizeText(pf) + "||" + normalizeText(iI !== -1 ? (row[iI] || "") : "") + "||" + normalizeText(row[sI] || "");
      (byKey[key] = byKey[key] || []).push({ date: parseFlexibleDate(row[dI]), amount: parseNumber(row[aI]), type: tI !== -1 ? normalizeText(row[tI] || "") : "" });
    });
    var rateMap = getEpfRateMap();
    var now = new Date();
    Object.keys(byKey).forEach(function (k) {
      // Delegate to the same engine as the current-value/realized total so the
      // per-year attribution reconciles with sumProvidentFundRealizedProfit.
      // Auto interest applies only to Sub Category "Provident Fund" (the 3rd
      // component of the key); others use manual-only (empty rate map).
      var subOfKey = k.split("||")[2] || "";
      var v = computePfAccountValue(byKey[k], subOfKey === "provident fund" ? rateMap : {}, now);
      Object.keys(v.realizedByYear || {}).forEach(function (yr) {
        out[yr] = (out[yr] || 0) + v.realizedByYear[yr];
      });
    });
    return out;
  }

  function buildFdMaturedXirrCashFlows(rows, portfolioFilter) {
    if (!rows || !rows.length) return [];
    var header = rows[0].map(normalizeText);
    var _ci = getColumnIndices(header);
    var portfolioIdx = _ci.portfolio, amountIdx = _ci.investedAmount, categoryIdx = _ci.category,
        subCategoryIdx = _ci.subCategory, dateIdx = _ci.transactionDate;
    if (portfolioIdx === -1 || amountIdx === -1 || subCategoryIdx === -1 || dateIdx === -1) return [];

    var rateIdx = header.indexOf("rate of return");
    var maturityIdx = header.indexOf("maturity date/sell date");
    if (maturityIdx === -1) maturityIdx = header.indexOf("maturity date");
    var today = new Date();

    var flows = [];
    rows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && portfolio.toLowerCase() !== portfolioFilter.toLowerCase()) return;
      if (categoryIdx !== -1 && normalizeText(row[categoryIdx]) !== "fixed income") return;
      if (!_fiIsTermDeposit(normalizeText(row[subCategoryIdx]))) return;

      var amount = parseNumber(row[amountIdx]);
      var date = parseFlexibleDate(row[dateIdx]);
      if (!date || !amount) return;
      flows.push({ date: date, amount: -amount }); // buy outflow at purchase

      // A FD that has ALREADY matured returned its proceeds AT MATURITY — emit a
      // positive inflow there, not in the today-dated terminal (the callers now use
      // sumFdActiveCurrentValue, which excludes matured FDs). Without this the money
      // is modelled as received today, understating the portfolio XIRR and letting
      // the benchmark index over-compound the same rupees to the present.
      var maturity = maturityIdx !== -1 ? parseFlexibleDate(row[maturityIdx]) : null;
      if (maturity && maturity < today) {
        var rate = rateIdx !== -1 ? parsePercentRate(row[rateIdx]) : 0;
        flows.push({ date: maturity, amount: fdMaturityValue(amount, date, maturity, rate) });
      }
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
      if (!isProvidentFundSub(normSub)) return;
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
      // Terminal marked so consumers that build their own terminal (the benchmark
      // index replay) can strip it and keep only the real buy/sell cash flows.
      if (activeGrams > 0) flows.push({ date: new Date(), amount: activeGrams * currentGoldPrice, _terminal: true });
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

  // fifoRemainingLots lives in wf-math.js (pure, unit-tested); thin wrapper here.
  function fifoRemainingLots(txns) { return WfMath.fifoRemainingLots(txns); }

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
        var matchedUnits = 0;
        while (unitsToMatch > 0 && buyLots.length) {
          var lot = buyLots[0];
          var matched = Math.min(unitsToMatch, lot.units);
          costOfSoldUnits += matched * lot.price;
          matchedUnits += matched;
          lot.units -= matched;
          unitsToMatch -= matched;
          if (lot.units <= 0) buyLots.shift();
        }
        // Clamp proceeds to units actually matched against buy lots. Selling more
        // than was ever bought (data-entry error / missed split) would otherwise
        // credit the unmatched units full proceeds at zero cost → phantom profit.
        var saleProceeds = matchedUnits * txn.price;
        total += saleProceeds - costOfSoldUnits;
      });
    });
    return total;
  }

  // Stocks/ETF realized return in INR — like sumUnitBasedRealizedReturn but
  // converts US buy costs and sale proceeds to INR at each leg's transaction-date
  // USD/INR rate (the plain version leaves US figures in USD). Async (needs the
  // rate history). Returns Promise<number>.
  function computeStocksEtfRealizedINR(portfolioFilter) {
    return fetchAllStockPrices().catch(function () { return {}; }).then(function (sp) {
      var usdInr = (sp && sp.usd_inr_history) || {};
      var usdToday = (sp && sp.prices && sp.prices["__USD_INR__"]) ? sp.prices["__USD_INR__"].price : 84;
      var seMap = buildStockMappingTable();
      var rows = getSheetRows("stocksetf");
      if (!rows) return 0;
      var tx = groupUnitTransactionsByInstrument(rows, portfolioFilter);
      if (!tx) return 0;
      var total = 0;
      Object.keys(tx).forEach(function (instr) {
        var m = seMap[normalizeText(instr)];
        var isUsd = !!(m && normalizeText(m.region) === "us");
        var lots = [];
        tx[instr].forEach(function (t) {
          if (t.type === "buy") {
            var r = isUsd ? (lookupUsdInrRate(usdInr, formatDateISO(t.date), usdToday)) : 1;
            lots.push({ units: t.units, cost: t.price * r });
            return;
          }
          var toMatch = t.units, cm = 0, mt = 0;
          while (toMatch > 0 && lots.length) {
            var l = lots[0];
            var q = Math.min(toMatch, l.units);
            cm += q * l.cost; mt += q; l.units -= q; toMatch -= q;
            if (l.units <= 0) lots.shift();
          }
          if (mt <= 0) return;
          var sr = isUsd ? (lookupUsdInrRate(usdInr, formatDateISO(t.date), usdToday)) : 1;
          total += mt * t.price * sr - cm;
        });
      });
      return total;
    });
  }

  // Stocks/ETF INVESTED in INR — the open cost basis after FIFO, with US buy legs
  // converted at each leg's transaction-date USD/INR rate. The synchronous
  // sumUnitBasedBuyInvestment leaves US figures in USD (they'd be ~84x too small in
  // rupees); this async version is the invested counterpart to
  // computeStocksEtfRealizedINR. Reuses the unit-tested FIFO kernel by feeding it
  // per-unit INR costs. Returns Promise<number>.
  function computeStocksEtfInvestedINR(portfolioFilter) {
    return fetchAllStockPrices().catch(function () { return {}; }).then(function (sp) {
      var usdInr = (sp && sp.usd_inr_history) || {};
      var usdToday = (sp && sp.prices && sp.prices["__USD_INR__"]) ? sp.prices["__USD_INR__"].price : 84;
      var seMap = buildStockMappingTable();
      var rows = getSheetRows("stocksetf");
      if (!rows) return 0;
      var tx = groupUnitTransactionsByInstrument(rows, portfolioFilter);
      if (!tx) return 0;
      var total = 0;
      Object.keys(tx).forEach(function (instr) {
        var m = seMap[normalizeText(instr)];
        var isUsd = !!(m && normalizeText(m.region) === "us");
        // Convert each buy leg's price to INR per-unit; sells carry no cost. FIFO
        // matching then leaves the open lots whose INR cost is the invested amount.
        var lotTxns = tx[instr].map(function (t) {
          if (t.type === "buy") {
            var r = isUsd ? (lookupUsdInrRate(usdInr, formatDateISO(t.date), usdToday)) : 1;
            return { type: "buy", units: t.units, price: t.price * r };
          }
          return { type: "sell", units: t.units, price: 0 };
        });
        fifoRemainingLots(lotTxns).forEach(function (l) { total += l.units * l.price; });
      });
      return total;
    });
  }

  // Stocks/ETF CURRENT value in INR — open units × live price, US converted at
  // today's USD/INR. If an instrument's live price hasn't loaded yet, falls back to
  // its INR cost basis so a freshly-added ticker still contributes. Returns
  // Promise<number>.
  // outByCat (optional): accumulates current value per Instrument Category, so a
  // bond ETF marked Fixed Income is not counted as equity. Return value is
  // unchanged for existing callers.
  function computeStocksEtfCurrentINR(portfolioFilter, outByCat) {
    return fetchAllStockPrices().catch(function () { return {}; }).then(function (sp) {
      var allPrices = (sp && sp.prices) || {};
      var usdInr = (sp && sp.usd_inr_history) || {};
      var usdToday = allPrices["__USD_INR__"] ? allPrices["__USD_INR__"].price : 84;
      var seMap = buildStockMappingTable();
      var rows = getSheetRows("stocksetf");
      if (!rows) return 0;
      var tx = groupUnitTransactionsByInstrument(rows, portfolioFilter);
      if (!tx) return 0;
      var total = 0;
      var _topCat = outByCat ? buildInstrumentTopCategoryMap() : null;
      function _addCat(nm, v) {
        if (!outByCat || !v) return;
        var c = _topCat[normalizeText(nm)] || "Equity";
        outByCat[c] = (outByCat[c] || 0) + v;
      }
      Object.keys(tx).forEach(function (instr) {
        var m = seMap[normalizeText(instr)];
        var isUsd = !!(m && normalizeText(m.region) === "us");
        var ticker = m && m.ticker;
        var lotTxns = tx[instr].map(function (t) {
          if (t.type === "buy") {
            var r = isUsd ? (lookupUsdInrRate(usdInr, formatDateISO(t.date), usdToday)) : 1;
            return { type: "buy", units: t.units, price: t.price * r };
          }
          return { type: "sell", units: t.units, price: 0 };
        });
        var units = 0, costINR = 0;
        fifoRemainingLots(lotTxns).forEach(function (l) { units += l.units; costINR += l.units * l.price; });
        if (units <= UNITS_EPSILON) return;
        var priceEntry = ticker ? allPrices[ticker] : null;
        if (priceEntry && priceEntry.price != null) {
          var v = units * (isUsd ? priceEntry.price * usdToday : priceEntry.price);
          total += v;
          _addCat(instr, v);
        } else {
          total += costINR; // no live price yet → cost-basis fallback
          _addCat(instr, costINR);
        }
      });
      return total;
    });
  }

  // Stocks/ETF CURRENT value in INR split by region — same valuation as
  // computeStocksEtfCurrentINR (open FIFO units × live price, US at today's
  // USD/INR, cost-basis fallback) but accumulated into { India, US } so the
  // Region Split can show true current values per region. Returns Promise<object>.
  function computeStocksEtfCurrentByRegion(portfolioFilter) {
    return fetchAllStockPrices().catch(function () { return {}; }).then(function (sp) {
      var allPrices = (sp && sp.prices) || {};
      var usdInr = (sp && sp.usd_inr_history) || {};
      var usdToday = allPrices["__USD_INR__"] ? allPrices["__USD_INR__"].price : 84;
      var seMap = buildStockMappingTable();
      var out = { India: 0, US: 0 };
      var rows = getSheetRows("stocksetf");
      if (!rows) return out;
      var tx = groupUnitTransactionsByInstrument(rows, portfolioFilter);
      if (!tx) return out;
      Object.keys(tx).forEach(function (instr) {
        var m = seMap[normalizeText(instr)];
        var isUsd = !!(m && normalizeText(m.region) === "us");
        var ticker = m && m.ticker;
        var lotTxns = tx[instr].map(function (t) {
          if (t.type === "buy") {
            var r = isUsd ? (lookupUsdInrRate(usdInr, formatDateISO(t.date), usdToday)) : 1;
            return { type: "buy", units: t.units, price: t.price * r };
          }
          return { type: "sell", units: t.units, price: 0 };
        });
        var units = 0, costINR = 0;
        fifoRemainingLots(lotTxns).forEach(function (l) { units += l.units; costINR += l.units * l.price; });
        if (units <= UNITS_EPSILON) return;
        var priceEntry = ticker ? allPrices[ticker] : null;
        var val = (priceEntry && priceEntry.price != null)
          ? units * (isUsd ? priceEntry.price * usdToday : priceEntry.price)
          : costINR;
        out[isUsd ? "US" : "India"] += val;
      });
      return out;
    });
  }

  // Per-portfolio CURRENT value broken into { equity, fixedIncome, commodity } in
  // INR, matching the Overview's own current aggregation (MF NAV + Stocks/ETF live
  // prices + FD/PF/EPF interest accrual + gold). Honours the Fixed-Income and
  // Savings/Investment exclusion toggles via the underlying helpers. Async; resolves
  // to zeros on any failure so the caller can fall back. Returns Promise<object>.
  function computePortfolioCurrentBreakdown(portfolio) {
    var fiEx = isFixedIncomeExcluded();
    var fdRows = getSheetRows("fd");
    var epfRows = getSheetRows("fixedincome");
    var commDates = (!fiEx && fdRows) ? collectCommodityUniqueDates(fdRows, portfolio) : [];
    var commodityPromise = (!fiEx && fdRows && _hasCommodityRows(fdRows, portfolio))
      ? Promise.all([
          fetchGoldPriceINRPerGram().catch(function () { return null; }),
          Promise.all(commDates.map(function (d) {
            return fetchXauInrForDate(d).then(function (p) { return { dateStr: d, price: p }; }).catch(function () { return { dateStr: d, price: null }; });
          }))
        ]).then(function (res) {
          var goldPrice = res[0];
          if (!goldPrice || !fdRows) return 0;
          var hist = {};
          res[1].forEach(function (r) { if (r.price) hist[r.dateStr] = r.price; });
          var hs = buildCommodityHoldingsList(fdRows, portfolio, goldPrice, hist) || [];
          var c = 0; hs.forEach(function (h) { c += h.current; }); return c;
        }).catch(function () { return 0; })
      : Promise.resolve(0);
    // Instruments carry their own Instrument Category, so a debt fund or bond ETF
    // held in the Mutual Fund / Stocks-ETF sheets belongs to Fixed Income and a
    // gold fund to Commodity. Collect their current values per category and move
    // the non-equity ones across, instead of counting every sheet row as Equity.
    var mfByCat = {}, seByCat = {};
    return Promise.all([
      _computeMfCurrentValueForPortfolio(portfolio, mfByCat).then(function (r) { return r.current; }).catch(function () { return 0; }),
      computeStocksEtfCurrentINR(portfolio, seByCat).catch(function () { return 0; }),
      commodityPromise
    ]).then(function (parts) {
      var mfCur = parts[0] || 0, seCur = parts[1] || 0, commCur = parts[2] || 0;
      var movedFi = 0, movedComm = 0;
      [mfByCat, seByCat].forEach(function (m) {
        Object.keys(m).forEach(function (c) {
          var n = normalizeText(c);
          if (n === "fixed income") movedFi += m[c];
          else if (n === "commodity") movedComm += m[c];
        });
      });
      var fiCur = 0;
      if (!fiEx && fdRows) {
        fiCur = (sumFdCurrentValueAtPar(fdRows, portfolio) || 0)
              + (sumFdActiveCurrentValue(fdRows, portfolio) || 0)
              + (sumProvidentFundCurrentValue(fdRows, portfolio) || 0);
      }
      if (!fiEx && epfRows && epfRows.length) {
        (buildEpfFixedIncomeHoldingsList(epfRows, portfolio) || []).forEach(function (h) { fiCur += (h.current || 0); });
      }
      // Subtract what was reclassified so nothing is double-counted; the three
      // buckets still sum to the same portfolio total as before.
      return {
        equity: Math.max(0, mfCur + seCur - movedFi - movedComm),
        fixedIncome: fiCur + (fiEx ? 0 : movedFi),
        commodity: commCur + (fiEx ? 0 : movedComm)
      };
    }).catch(function () { return { equity: 0, fixedIncome: 0, commodity: 0 }; });
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
      var matchedThisSell = 0;
      while (unitsToMatch > 0 && buyLots.length) {
        var lot = buyLots[0];
        var matched = Math.min(unitsToMatch, lot.units);
        costOfSoldUnits += matched * lot.price;
        matchedThisSell += matched;
        lot.units -= matched;
        unitsToMatch -= matched;
        if (lot.units <= 0) buyLots.shift();
      }
      // Clamp to units actually matched against buy lots — selling more than was
      // ever bought must not credit phantom zero-cost proceeds (mirrors the fix
      // in sumUnitBasedRealizedReturn).
      saleProceeds += matchedThisSell * txn.price;
      unitsSold += matchedThisSell;
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

  // Parsed-sheet memo. getSheetRows is called on the order of hundreds of times
  // per render pass (86 static call sites, most of them inside per-portfolio or
  // per-instrument loops), and each call used to re-read localStorage and re-parse
  // the whole sheet — hundreds of rows of JSON, synchronously, on the main thread.
  // That is a large share of the freeze on a phone.
  //
  // The memo is keyed on the raw string's length so a write from another tab (or
  // any path that bypasses _invalidateSheetRows) still invalidates it: getItem is
  // cheap, parsing is what costs. Callers MUST NOT mutate the array they get back,
  // which was already true — the existing code copies before filtering.
  var _sheetRowsMemo = {};
  function getSheetRows(prefix) {
    var raw = localStorage.getItem("wf-" + prefix + "-data");
    if (!raw) { delete _sheetRowsMemo[prefix]; return null; }
    var memo = _sheetRowsMemo[prefix];
    if (memo && memo.len === raw.length) return memo.rows;
    var rows;
    try { rows = JSON.parse(raw); }
    catch (e) { delete _sheetRowsMemo[prefix]; return null; }
    _sheetRowsMemo[prefix] = { len: raw.length, rows: rows };
    return rows;
  }

  // Called wherever a sheet's cached data is written or cleared, so the memo can
  // never serve rows for a payload that has been replaced by one of equal length.
  function _invalidateSheetRows(prefix) {
    if (prefix == null) _sheetRowsMemo = {};
    else delete _sheetRowsMemo[prefix];
  }

  // Fold/unfold long holdings lists: when there are >3 instrument rows,
  // insert a toggle before the subtotal that hides the detail rows.
  // Fold state persists across re-renders keyed by list DOM id.
  var WF_FOLD_STATE = {};
  function applyHoldingsFold(listId, threshold) {
    threshold = threshold || 3;
    var list = document.getElementById(listId);
    if (!list) return;
    var rows = list.querySelectorAll(".mfh-row");
    if (rows.length <= threshold + 1) return;
    var details = Array.prototype.slice.call(rows, 0, rows.length - 1);
    var state = WF_FOLD_STATE[listId] || (WF_FOLD_STATE[listId] = { folded: true });
    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "wf-fold-toggle";
    toggle.style.cssText = "background:#111827;color:#fff;border:0;font-size:0.66rem;font-weight:600;cursor:pointer;padding:3px 9px;margin:3px 0;border-radius:999px;align-self:center;box-shadow:0 1px 2px rgba(0,0,0,0.08);";
    function apply() {
      details.forEach(function (d) { d.style.display = state.folded ? "none" : ""; });
      toggle.textContent = state.folded
        ? ("▸ Show " + details.length + " instruments")
        : ("▾ Hide instruments");
    }
    toggle.addEventListener("click", function () { state.folded = !state.folded; apply(); });
    // Insert at the top of the list (after the header) so it's always visible.
    var header = list.querySelector(".mfh-list-header");
    if (header && header.nextSibling) list.insertBefore(toggle, header.nextSibling);
    else list.appendChild(toggle);
    apply();
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

  // Validation for the Fixed Income (fd) sheet: Savings Account and Investment
  // Corpus are running balances deduped by (Portfolio, Bank, Instrument), so within
  // each (Portfolio, Bank) pair the Instrument Name must be exactly ONE value for
  // each of those sub-categories. Two different Instrument Names for the same
  // portfolio + bank would be treated as separate holdings (unintended). Scoping is
  // per Portfolio AND per Bank, so different portfolios can hold the same bank's
  // savings/corpus under different names. The two sub-categories are checked
  // independently. Pure helper — returns human-readable conflict messages.
  function findSavingsBankInstrumentConflicts(rows) {
    if (!rows || rows.length < 2) return [];
    var header = rows[0].map(normalizeText);
    var ci = getColumnIndices(header);
    if (ci.category === -1 || ci.subCategory === -1 || ci.bank === -1 ||
        ci.instrument === -1 || ci.portfolio === -1) return [];

    function checkSubCategory(normSub, label) {
      var byPortfolioBank = {};
      rows.slice(1).forEach(function (row, i) {
        if (normalizeText(row[ci.category]) !== "fixed income") return;
        if (normalizeText(row[ci.subCategory]) !== normSub) return;
        var portfolio = (row[ci.portfolio] || "").trim();
        var bank = (row[ci.bank] || "").trim();
        var instrument = (row[ci.instrument] || "").trim();
        if (!portfolio || !bank || !instrument) return; // blanks are flagged by the per-row checks
        var key = normalizeText(portfolio) + "||" + normalizeText(bank);
        var e = byPortfolioBank[key] || (byPortfolioBank[key] = { portfolioDisplay: portfolio, bankDisplay: bank, names: {} });
        var nKey = normalizeText(instrument);
        var nEntry = e.names[nKey] || (e.names[nKey] = { display: instrument, rows: [] });
        nEntry.rows.push(i + 2); // 1-based sheet row (accounting for the header)
      });
      var conflicts = [];
      Object.keys(byPortfolioBank).forEach(function (key) {
        var e = byPortfolioBank[key];
        var nameKeys = Object.keys(e.names);
        if (nameKeys.length > 1) {
          var nameList = nameKeys.map(function (nk) {
            var r = e.names[nk].rows;
            return '"' + e.names[nk].display + '" (row' + (r.length > 1 ? "s " : " ") + r.join(", ") + ")";
          }).join(" and ");
          conflicts.push(label + ' for portfolio "' + e.portfolioDisplay + '" at bank "' + e.bankDisplay +
            '" must use a single Instrument Name, but found ' + nameKeys.length + ": " + nameList +
            ". Use one consistent Instrument Name for this portfolio+bank " + label.toLowerCase() + " balance.");
        }
      });
      return conflicts;
    }

    return checkSubCategory("savings account", "Savings Account")
      .concat(checkSubCategory("investment corpus", "Investment Corpus"));
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
        var isFixedDeposit = normCategory === "fixed income" && _fiIsTermDeposit(normSubCategory);
        var isCommodity = normCategory === "commodity";
        var isProvidentFund = normCategory === "fixed income" && isProvidentFundSub(normSubCategory);

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

      // Cross-row check: each Savings Account bank must use a single Instrument Name.
      findSavingsBankInstrumentConflicts(rows).forEach(function (msg) { fdBadRows.push(msg); });

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

  // Full, comma-grouped rupee amount (e.g. ₹2,58,55,820). Used for tooltips,
  // exports, and any place that needs the exact figure.
  // Number.toLocaleString builds an Intl.NumberFormat on every call, and this is
  // the single most-called formatting function in the app — it showed 205 ms of
  // self time in a profile of one mobile load. Building it once is byte-identical
  // output for a fraction of the cost.
  var _inrFullFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
  function formatCurrencyFull(amount) {
    var sign = amount < 0 ? "-" : "";
    return sign + "₹" + _inrFullFmt.format(Math.abs(amount));
  }

  // Display format: amounts of ₹1 crore or more are abbreviated as "₹2.58 CR";
  // smaller amounts keep the full comma-grouped form. Pair with _crTitle()/
  // el.title so the exact value is available on hover.
  function formatCurrency(amount) {
    var abs = Math.abs(amount);
    if (abs >= 1e7) {
      var sign = amount < 0 ? "-" : "";
      return sign + "₹" + (abs / 1e7).toFixed(2) + " CR";
    }
    return formatCurrencyFull(amount);
  }

  // Returns a ` title="₹full"` attribute string (for innerHTML) when the amount
  // is abbreviated (≥ 1 crore), else "". Keeps the exact figure on hover.
  function _crTitle(amount) {
    if (Math.abs(amount) < 1e7) return "";
    return ' title="' + formatCurrencyFull(amount).replace(/"/g, "") + '"';
  }

  // Sets textContent to the (possibly abbreviated) amount and, when abbreviated,
  // a title with the exact value so hovering reveals the full number.
  function setMoneyText(el, text, rawAmount) {
    if (!el) return;
    el.textContent = text;
    el.title = Math.abs(rawAmount) >= 1e7 ? formatCurrencyFull(rawAmount) : "";
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
    el.title = Math.abs(amount) >= 1e7 ? (amount > 0 ? "+" : "") + formatCurrencyFull(amount) : "";
    el.classList.remove("positive", "negative");
    if (amount > 0) el.classList.add("positive");
    else if (amount < 0) el.classList.add("negative");
  }

  // Per-asset-class numeric values — each refreshed by its own async computation;
  // the Overview is their aggregate (see wf-overview.js).
  //
  // Step 4 of the orchestrator refactor: this was one flat `_ov` bag mixing 19
  // numeric fields with 5 pieces of cash-flow bookkeeping, addressed by string
  // concatenation (`_ov[cls + "Current"]`). Splitting it in two makes the shape
  // explicit — a class is now a value object with a fixed set of fields, so a
  // typo reads as `undefined` on a known slice rather than silently creating a
  // new key on a shared bag, and the XIRR flow state can no longer be confused
  // for something the aggregator should sum.
  function _ovEmptySlice() {
    return { invested: 0, current: 0, unrealized: 0, realized: 0, dayChange: 0 };
  }
  var _ovSlice = {
    mf: _ovEmptySlice(), se: _ovEmptySlice(), fi: _ovEmptySlice(), comm: _ovEmptySlice(),
    // Debt funds/ETFs pulled out of mf and se. Kept per source so the two
    // independent flows cannot overwrite each other's contribution.
    debtMf: _ovEmptySlice(), debtSe: _ovEmptySlice()
  };

  // Cash-flow bookkeeping for the XIRR/benchmark cards. Deliberately NOT part of
  // a slice: these are flow arrays and scope tags, not values the Overview sums.
  var _ovFlows = {
    overviewBaseFlows: null,
    seXirrFlows: [],
    seFlowsINR: [],
    seComputedPortfolio: null,
    commodityXirrFlows: []
  };

  // The aggregation RULES (exclusion gating, the invested-fallback, which classes
  // carry day change) live in exactly one unit-tested place — wf-overview.js —
  // rather than being restated in each consumer. The store already matches the
  // aggregator's slice shape, so this is a straight read.
  //
  // Fixed income is passed WITHOUT dayChange: it has no intraday mark, and
  // omitting the field documents that at the call site.
  function _ovSlices() {
    return {
      mf: _ovSlice.mf,
      se: _ovSlice.se,
      fi: { invested: _ovSlice.fi.invested, current: _ovSlice.fi.current, unrealized: _ovSlice.fi.unrealized, realized: _ovSlice.fi.realized },
      comm: _ovSlice.comm,
      debtMf: _ovSlice.debtMf,
      debtSe: _ovSlice.debtSe
    };
  }

  function _ovAggregate() {
    return WfOverview.aggregateOverview(_ovSlices(), { excludeFixedIncome: isFixedIncomeExcluded() });
  }

  // ---- Slice write choke point (steps 2-4 of the orchestrator refactor) -----
  // Every async flow used to poke `_ov.<class><Field>` directly from a dozen
  // call sites, which is why one flow could silently clobber another's numbers
  // and why the reset rules had to be reasoned about per-field. All slice
  // mutation now goes through _ovApply/_ovResetSlice, giving us:
  //   * one place that records WHICH flow last wrote a class and when
  //     (provenance), so a stale write is visible instead of invisible;
  //   * a NaN guard, so a bad parse can never reach an aggregate;
  //   * a STALE-WRITE GUARD: a write tagged with the portfolio it was computed
  //     for is dropped when the user has since switched portfolios;
  //   * an unknown-field guard, now that fields are real keys on a typed slice
  //     rather than concatenated strings on a shared bag.
  var OV_SLICE_FIELDS = ["invested", "current", "unrealized", "realized", "dayChange"];
  var _ovProvenance = { mf: null, se: null, fi: null, comm: null, debtMf: null, debtSe: null };
  var _ovSeq = 0;
  var _ovStaleDrops = 0;

  function _ovCurrentPortfolio() { return localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all"; }

  // Apply a partial slice for one asset class. `source` names the originating
  // flow purely for diagnostics. Fields absent from `patch` are left untouched —
  // a flow that only knows the day change must not blank out the current value.
  //
  // `forPortfolio` is the stale-write guard: async flows capture the portfolio
  // they were started for and pass it here. If the user switched portfolios while
  // the fetch was in flight, the resolved-but-obsolete numbers are DROPPED rather
  // than painted over the new portfolio's. Two flows used to do this with ad-hoc
  // `if (localStorage.get(...) !== selected) return;` checks and the other three
  // had no protection at all — switching portfolios mid gold/NAV fetch could land
  // the previous portfolio's values. Omitting the argument keeps the old
  // unguarded behavior (used by the synchronous resets, which are current by
  // definition).
  function _ovApply(cls, patch, source, forPortfolio) {
    if (!patch) return false;
    var slice = _ovSlice[cls];
    if (!slice) { console.error("_ovApply: unknown asset class '" + cls + "'"); return false; }
    if (forPortfolio !== undefined && forPortfolio !== _ovCurrentPortfolio()) {
      _ovStaleDrops++;
      dbg("[_ov] DROP stale " + cls + " write from " + (source || "unknown") +
          " (computed for '" + forPortfolio + "', now '" + _ovCurrentPortfolio() + "')");
      return false;
    }
    var written = [];
    Object.keys(patch).forEach(function (f) {
      if (OV_SLICE_FIELDS.indexOf(f) === -1) {
        // Catches typos at the call site instead of letting them accumulate as
        // dead keys nobody reads — the failure mode of the old flat bag.
        console.error("_ovApply: unknown field '" + f + "' for class '" + cls + "'");
        return;
      }
      var v = +patch[f];
      if (!isFinite(v)) v = 0; // never let NaN reach an aggregate
      slice[f] = v;
      written.push(f);
    });
    if (!written.length) return false;
    _ovProvenance[cls] = { source: source || "unknown", seq: ++_ovSeq, fields: written };
    dbg("[_ov] " + cls + " <- " + (source || "unknown") + " {" + written.map(function (f) {
      return f + "=" + Math.round(slice[f]);
    }).join(", ") + "}");
    return true;
  }

  // Zero a class's slice. Used by the portfolio-change reset; keeping it here
  // (rather than inline field lists) is what makes the reset rules auditable.
  function _ovResetSlice(cls, source) {
    var patch = {};
    OV_SLICE_FIELDS.forEach(function (f) { patch[f] = 0; });
    _ovApply(cls, patch, source || "reset");
  }

  // Single paint entry point (step 3). Previously each flow called some subset of
  // {refreshOverviewStats, refreshCategoryCards, updateOverviewDayChange}, so
  // whether the header, the cards and the day change agreed depended on which
  // flow happened to finish last. Painting all three together from one aggregate
  // makes them consistent by construction — they can no longer show numbers
  // derived from different moments. All three are idempotent, so the extra work
  // per call is a few DOM writes.
  function renderOverview() {
    refreshOverviewStats();
    refreshCategoryCards();
    updateOverviewDayChange();
  }

  // Diagnostics: which flow last wrote each class, newest first. Surfaces a
  // dropped or stale component at a glance instead of by bisecting renders.
  function ovDebugProvenance() {
    return Object.keys(_ovProvenance).map(function (cls) {
      var p = _ovProvenance[cls];
      return { cls: cls, source: p ? p.source : "(never written)", seq: p ? p.seq : 0, fields: p ? p.fields : [] };
    }).sort(function (a, b) { return b.seq - a.seq; });
  }
  window.wfOvProvenance = function () {
    return { portfolio: _ovCurrentPortfolio(), staleWritesDropped: _ovStaleDrops, slices: ovDebugProvenance() };
  };

  function refreshOverviewStats() {
    var overviewInvestedEl = document.getElementById("overview-total-investment");
    var overviewCurrentEl = document.getElementById("overview-total-current-value");
    var overviewReturnEl = document.getElementById("overview-unrealized-return");
    var overviewPctEl = document.getElementById("overview-return-pct");
    var overviewRealizedEl = document.getElementById("overview-realized-return");
    var agg = _ovAggregate();
    var totalInvested = agg.invested;
    var totalCurrent = agg.current;
    var totalRealized = agg.realized;
    setMoneyText(overviewInvestedEl, formatCurrency(totalInvested), totalInvested);
    setMoneyText(overviewCurrentEl, formatCurrency(totalCurrent), totalCurrent);
    setUnrealizedReturn(overviewReturnEl, overviewPctEl, totalCurrent, totalInvested);
    if (overviewRealizedEl) setSignedCurrency(overviewRealizedEl, totalRealized);
    // Keep the Account Value chart's tail in lockstep with this card. The store is
    // updated by several async callbacks; the card refreshes on each, so push
    // the exact same total into the chart's last point instead of letting the
    // chart snap once (and lag when FI/commodity arrive later).
    syncAccountValueTail(totalCurrent);
  }

  // Update only the Account Value chart's last data point + "Current Value"
  // label to match the Overview Current card, without a full re-render.
  function syncAccountValueTail(total) {
    if (!(total > 0)) return;
    var lbl = document.getElementById("pvc-current-value");
    if (lbl) lbl.textContent = "₹" + Math.round(total).toLocaleString("en-IN");
    var ch = window.__wfPortfolioValueChart;
    if (ch && ch.data && ch.data.datasets && ch.data.datasets[0]) {
      var d = ch.data.datasets[0].data;
      if (d && d.length) {
        var last = d[d.length - 1];
        d[d.length - 1] = { x: (last && last.x) || last, y: total };
        try { ch.update("none"); } catch (e) {}
      }
    }
  }

  function refreshCategoryCards() {
    var cards = _ovAggregate().cards;

    // Mutual Funds
    var mfInv = cards.mf.invested, mfCur = cards.mf.current;
    var elMfInv = document.getElementById("cat-mf-invested");
    var elMfCur = document.getElementById("cat-mf-current");
    var elMfUnr = document.getElementById("cat-mf-unrealized");
    var elMfRlz = document.getElementById("cat-mf-realized");
    var elMfRet = document.getElementById("cat-mf-return");
    setMoneyText(elMfInv, formatCurrency(mfInv), mfInv);
    setMoneyText(elMfCur, formatCurrency(mfCur), mfCur);
    if (elMfUnr) setSignedCurrency(elMfUnr, cards.mf.unrealized);
    if (elMfRlz) setSignedCurrency(elMfRlz, cards.mf.realized);
    if (elMfRet) {
      var mfPct = cards.mf.returnPct;
      elMfRet.textContent = (mfPct >= 0 ? "+" : "") + mfPct.toFixed(2) + "%";
      elMfRet.className = "cat-stat-value" + (mfPct > 0 ? " positive" : mfPct < 0 ? " negative" : "");
    }

    // Stocks / ETF
    var seInv = cards.se.invested, seCur = cards.se.current;
    var elSeInv = document.getElementById("cat-se-invested");
    var elSeCur = document.getElementById("cat-se-current");
    var elSeDc  = document.getElementById("cat-se-daychange");
    var elSeUnr = document.getElementById("cat-se-unrealized");
    var elSeRlz = document.getElementById("cat-se-realized");
    var elSeRet = document.getElementById("cat-se-return");
    setMoneyText(elSeInv, formatCurrency(seInv), seInv);
    setMoneyText(elSeCur, formatCurrency(seCur), seCur);
    if (elSeDc)  setSignedCurrency(elSeDc, cards.se.dayChange);
    if (elSeUnr) setSignedCurrency(elSeUnr, cards.se.unrealized);
    if (elSeRlz) setSignedCurrency(elSeRlz, cards.se.realized);
    if (elSeRet) {
      var sePct = cards.se.returnPct;
      elSeRet.textContent = (sePct >= 0 ? "+" : "") + sePct.toFixed(2) + "%";
      elSeRet.className = "cat-stat-value" + (sePct > 0 ? " positive" : sePct < 0 ? " negative" : "");
    }

    // Fixed Income + Commodity combined
    var fiTotalInv = cards.fi.invested;
    var fiTotalCur = cards.fi.current;
    var fiTotalUnr = cards.fi.unrealized;
    var fiTotalRlz = cards.fi.realized;
    var elFiInv = document.getElementById("cat-fi-invested");
    var elFiCur = document.getElementById("cat-fi-current");
    var elFiUnr = document.getElementById("cat-fi-unrealized");
    var elFiRlz = document.getElementById("cat-fi-realized");
    var elFiRet = document.getElementById("cat-fi-return");
    setMoneyText(elFiInv, formatCurrency(fiTotalInv), fiTotalInv);
    setMoneyText(elFiCur, formatCurrency(fiTotalCur), fiTotalCur);
    if (elFiUnr) setSignedCurrency(elFiUnr, fiTotalUnr);
    if (elFiRlz) setSignedCurrency(elFiRlz, fiTotalRlz);
    if (elFiRet) {
      var fiPct = fiTotalInv > 0 ? ((fiTotalCur - fiTotalInv) / fiTotalInv * 100) : 0;
      elFiRet.textContent = (fiPct >= 0 ? "+" : "") + fiPct.toFixed(2) + "%";
      elFiRet.className = "cat-stat-value" + (fiPct > 0 ? " positive" : fiPct < 0 ? " negative" : "");
    }
  }

  function updateDashboardStats() {
    var selected = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";

    // Reset accumulator so stale tab values don't persist across portfolio changes
    _ovApply("mf", { invested: 0, current: 0, unrealized: 0, realized: 0 }, "updateDashboardStats:reset");
    _ovApply("se", { invested: 0, realized: 0 }, "updateDashboardStats:reset");
    _ovFlows.overviewBaseFlows = null;
    // The live Stocks/ETF current value (seCurrent/Unrealized/DayChange/XirrFlows)
    // is populated ASYNCHRONOUSLY by renderStockEtfHoldingsTable, which
    // updateDashboardStats does NOT trigger. Zeroing them here on every call
    // (e.g. an exclusion toggle or a late data event) would drop the Overview
    // Current to the seInvested fallback until the user forces an SE re-render.
    // Only clear them when the portfolio actually changes — then
    // renderStockEtfHoldingsTable will repopulate them.
    // The per-component DAY CHANGE values (mf/se/comm) are reset the SAME way —
    // only on a portfolio change. Zeroing mfDayChange/commDayChange on every
    // call (as before) made a late re-render collapse the Overview day change to
    // SE-only (18K→9K revert) during the async MF/commodity refetch window; the
    // MF/commodity flows overwrite them with fresh values when they resolve.
    if (_ovFlows.seComputedPortfolio !== selected) {
      _ovApply("se", { current: 0, unrealized: 0, dayChange: 0 }, "updateDashboardStats:portfolioChange");
      _ovApply("debtSe", { current: 0, unrealized: 0, dayChange: 0 }, "updateDashboardStats:portfolioChange");
      _ovApply("debtMf", { dayChange: 0 }, "updateDashboardStats:portfolioChange");
      _ovFlows.seXirrFlows = []; _ovFlows.seFlowsINR = [];
      _ovApply("mf", { dayChange: 0 }, "updateDashboardStats:portfolioChange");
      _ovApply("comm", { dayChange: 0 }, "updateDashboardStats:portfolioChange");
    }
    _ovApply("fi", { invested: 0, current: 0, unrealized: 0, realized: 0 }, "updateDashboardStats:reset");
    _ovApply("debtMf", { invested: 0, current: 0, unrealized: 0, realized: 0 }, "updateDashboardStats:reset");
    _ovApply("comm", { invested: 0, current: 0, unrealized: 0, realized: 0 }, "updateDashboardStats:reset");

    var equityEl = document.getElementById("equity-total-investment");
    var fixedIncomeEl = document.getElementById("fixedincome-total-investment");
    var stocksEtfEl = document.getElementById("stocksetf-total-investment");
    var equityRealizedEl = document.getElementById("equity-realized-return");
    var stocksEtfRealizedEl = document.getElementById("stocksetf-realized-return");

    // Invested amounts (synchronous)
    var mfInvested = computeTotalInvestment(selected, ["equity"]);
    var seInvested = computeTotalInvestment(selected, ["stocksetf"]);
    var fiBaseInvested = computeTotalInvestment(selected, ["fixedincome", "fd"]);
    if (equityEl) equityEl.textContent = formatCurrency(mfInvested);
    if (stocksEtfEl) stocksEtfEl.textContent = formatCurrency(seInvested);
    if (fixedIncomeEl) fixedIncomeEl.textContent = formatCurrency(fiBaseInvested);
    // Debt funds are reported as Fixed Income, so their cost leaves the Mutual
    // Fund invested figure. Same FIFO remaining-lot basis as the total it is
    // subtracted from, so the two cannot disagree by a rounding of method.
    var _dbtCatMap = buildInstrumentTopCategoryMap();
    var mfDebtInvested = (function () {
      var eqRows = getSheetRows("equity");
      if (!eqRows) return 0;
      var byInst = groupUnitTransactionsByInstrument(eqRows, selected);
      if (!byInst) return 0;
      var t = 0;
      Object.keys(byInst).forEach(function (nm) {
        if (normalizeText(_dbtCatMap[normalizeText(nm)] || "") !== "fixed income") return;
        fifoRemainingLots(byInst[nm]).forEach(function (l) { t += l.units * l.price; });
      });
      return t;
    })();
    _ovApply("mf", { invested: mfInvested - mfDebtInvested }, "updateDashboardStats:sync");
    _ovApply("debtMf", { invested: mfDebtInvested }, "updateDashboardStats:sync");
    _ovApply("se", { invested: seInvested }, "updateDashboardStats:sync");
    _ovApply("fi", { invested: fiBaseInvested }, "updateDashboardStats:sync");

    // Realized profits (synchronous for MF and SE)
    var mfRealized = computeRealizedReturn(selected, ["equity"]);
    var seRealized = computeRealizedReturn(selected, ["stocksetf"]);
    if (equityRealizedEl) setSignedCurrency(equityRealizedEl, mfRealized);
    if (stocksEtfRealizedEl) setSignedCurrency(stocksEtfRealizedEl, seRealized);
    _ovApply("mf", { realized: mfRealized }, "updateDashboardStats:sync");
    _ovApply("se", { realized: seRealized }, "updateDashboardStats:sync");
    renderOverview();

    // The sync seRealized above leaves US sells in USD. Recompute it in INR
    // (US converted at each leg's transaction-date rate) and refresh.
    computeStocksEtfRealizedINR(selected).then(function (seINR) {
      if ((localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all") !== selected) return; // portfolio changed meanwhile
      _ovApply("se", { realized: seINR }, "computeStocksEtfRealizedINR", selected);
      if (stocksEtfRealizedEl) setSignedCurrency(stocksEtfRealizedEl, seINR);
      renderOverview();
    }).catch(function () {});

    // Likewise, the sync seInvested above leaves US buys in USD. Recompute the
    // invested cost basis in INR (US converted per-leg) and refresh so the
    // top-line Invested, Return %, and Unrealized P&L are right for US holdings.
    computeStocksEtfInvestedINR(selected).then(function (seInvINR) {
      if ((localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all") !== selected) return; // portfolio changed meanwhile
      _ovApply("se", { invested: seInvINR }, "computeStocksEtfInvestedINR", selected);
      if (stocksEtfEl) stocksEtfEl.textContent = formatCurrency(seInvINR);
      renderOverview();
    }).catch(function () {});

    // Commodity invested amount added to Fixed Income asynchronously
    var fdRowsInv = getSheetRows("fd");
    var uniqueDatesInv = fdRowsInv ? collectCommodityUniqueDates(fdRowsInv, selected) : [];
    var _hasCommInv = _hasCommodityRows(fdRowsInv, selected);
    Promise.all([
      _hasCommInv ? fetchGoldPriceINRPerGram().catch(function () { return null; }) : Promise.resolve(null),
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
      _ovApply("comm", { invested: commodityInvested }, "updateDashboardStats:commodityInvested", selected);
      renderOverview();
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
    var fixedIncomeRowsPresent = getSheetRows("fixedincome");
    var connectHintEl = document.getElementById("fixedincome-connect-hint");
    if (connectHintEl) connectHintEl.hidden = !!((fdRows && fdRows.length) || (fixedIncomeRowsPresent && fixedIncomeRowsPresent.length));

    // Fetch current gold price + all historical prices (buy and sell dates) for commodity rows
    var uniqueCommodityDates = fdRows ? collectCommodityUniqueDates(fdRows, selected) : [];
    var _hasComm = _hasCommodityRows(fdRows, selected);
    Promise.all([
      _hasComm ? fetchGoldPriceINRPerGram().catch(function () { return null; }) : Promise.resolve(null),
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

      // Fold in the separate `fixedincome` sheet (EPF/PPF, "Amount" column). Its
      // deposits already reach _ovSlice.fi.invested via sumEpfAmount, but its CURRENT
      // value (deposits + interest) was never added — so those holdings showed a
      // phantom loss. Add both sides here so invested/current stay in lockstep.
      var epfRows = getSheetRows("fixedincome");
      var epfHoldings = (epfRows && epfRows.length) ? (buildEpfFixedIncomeHoldingsList(epfRows, selected) || []) : [];
      var epfInvested = 0, epfCurrent = 0;
      epfHoldings.forEach(function (h) { epfInvested += (h.invested || 0); epfCurrent += (h.current || 0); });

      var fiInvestment = (fdRows ? sumFdInvestment(fdRows, selected) : 0) + epfInvested;
      var investment = fiInvestment + commodityInvested;
      var fiCurrentValue = (fdRows ? sumFdCurrentValueAtPar(fdRows, selected) : 0) + (fdRows ? sumFdActiveCurrentValue(fdRows, selected) : 0) + (fdRows ? sumProvidentFundCurrentValue(fdRows, selected) : 0) + epfCurrent;
      var currentValue = fiCurrentValue + commodityCurrent;
      if (currentValueEl) currentValueEl.textContent = formatCurrency(currentValue);
      setUnrealizedReturn(profitEl, pctEl, currentValue, investment);
      var fiRealized = (fdRows ? sumFdRealizedProfit(fdRows, selected) : 0) + (fdRows ? sumProvidentFundRealizedProfit(fdRows, selected) : 0);
      if (realizedProfitEl) setSignedCurrency(realizedProfitEl, fiRealized + commodityRealizedProfit);

      _ovApply("fi", {
        current: fiCurrentValue,
        unrealized: fiCurrentValue - fiInvestment,
        realized: fiRealized
      }, "updateEpfStats", selected);
      _ovApply("comm", {
        current: commodityCurrent,
        unrealized: commodityCurrent - commodityInvested,
        realized: commodityRealizedProfit
      }, "updateEpfStats", selected);
      renderOverview();

      if (xirrEl) {
        var pfCurrentValue = fdRows ? sumProvidentFundCurrentValue(fdRows, selected) : 0;
        var currentValueForXirr = (fdRows ? sumFdActiveCurrentValue(fdRows, selected) : 0) + pfCurrentValue;
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

    var selectedPortfolio = "all";
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
      if (h.matured) {
        var maturedTag = document.createElement("span");
        maturedTag.className = "fd-matured-tag";
        maturedTag.textContent = "Matured";
        nameTd.appendChild(document.createTextNode(" "));
        nameTd.appendChild(maturedTag);
      }
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
      var fdMatured = false;
      if (_fiIsTermDeposit(normSubCategory)) {
        var rate = parsePercentRate(row[rateIdx]);
        var startDate = parseFlexibleDate(row[dateIdx]);
        var maturityDate = parseFlexibleDate(row[maturityIdx]);
        fdMatured = !!(maturityDate && maturityDate < today);
        if (startDate) {
          var asOfDate = maturityDate && maturityDate < today ? maturityDate : today;
          var elapsedQuarters = elapsedQuartersFractional(startDate, asOfDate);
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
        matured: fdMatured,
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

      if (isProvidentFundSub(normSubCategory)) {
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
      var fdMatured = false;
      if (_fiIsTermDeposit(normSubCategory) && maturityIdx !== -1 && rateIdx !== -1) {
        var rate = parsePercentRate(row[rateIdx]);
        var startDate = parseFlexibleDate(row[dateIdx]);
        var maturityDate = parseFlexibleDate(row[maturityIdx]);
        fdMatured = !!(maturityDate && maturityDate < today);
        if (startDate) {
          var asOfDate = maturityDate && maturityDate < today ? maturityDate : today;
          var elapsedQuarters = elapsedQuartersFractional(startDate, asOfDate);
          if (elapsedQuarters > 0 && rate) current = invested * Math.pow(1 + rate / 4, elapsedQuarters);
        }
      }
      holdings.push({ portfolio: portfolio, bank: bank, instrument: instrument, subCategory: subCategory, invested: invested, current: current, matured: fdMatured });
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

    var epfRateMap = getEpfRateMap();
    Object.keys(providentFundByKey).forEach(function (key) {
      var pf = providentFundByKey[key];
      // Auto interest-rate calculation applies ONLY to Instrument Sub Category
      // "Provident Fund". Other PF-family sub-categories (e.g. Public Provident
      // Fund) keep manual-interest-only behaviour (empty rate map → no auto-calc).
      var autoRates = (normalizeText(pf.subCategory) === "provident fund") ? epfRateMap : {};
      var v = computePfAccountValue(pf.txns, autoRates, today);
      holdings.push({ portfolio: pf.portfolio, bank: "", instrument: pf.instrument, subCategory: pf.subCategory, invested: v.invested, current: v.current, realizedProfit: v.realizedProfit });
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
    // Guard the legacy-table path but still let the new redesign render even if
    // one of the hidden legacy nodes is missing.
    if (!tbody) {
      try { renderFiRedesign(_buildAllFixedIncomeHoldingsList()); } catch (e) { console.error("FI redesign failed:", e); }
      return;
    }
    if (!statusEl || !tableWrap) return;

    var selectedPortfolio = "all";
    var fdRows = getSheetRows("fd");
    var fiRows = getSheetRows("fixedincome");

    if ((!fdRows || !fdRows.length) && (!fiRows || !fiRows.length)) {
      statusEl.textContent = "Connect your Fixed Income/Commodity sheet in Settings to populate this view.";
      tableWrap.hidden = true;
      try { renderFiRedesign(_buildAllFixedIncomeHoldingsList()); } catch (e) { console.error("FI redesign failed:", e); }
      return;
    }

    var holdings = [];
    var headerError = false;

    if (fdRows && fdRows.length) {
      var fdHoldings = buildFdFixedIncomeHoldingsList(fdRows, selectedPortfolio);
      if (fdHoldings === null) { headerError = true; }
      else holdings = holdings.concat(fdHoldings);
    }

    // Include EPF/PPF entries from the fixedincome sheet.
    if (fiRows && fiRows.length) {
      var fiHeader = fiRows[0].map(normalizeText);
      var fiPortIdx = fiHeader.indexOf("portfolio name");
      var fiInstIdx = fiHeader.indexOf("instrument name");
      var fiTypeIdx = fiHeader.indexOf("transaction type");
      var fiAmtIdx = fiHeader.indexOf("amount");
      var fiCatIdx = fiHeader.indexOf("instrument category");
      var fiSubIdx = fiHeader.indexOf("instrument sub category");
      if (fiPortIdx !== -1 && fiInstIdx !== -1 && fiTypeIdx !== -1 && fiAmtIdx !== -1) {
        var byKey = {};
        fiRows.slice(1).forEach(function (row) {
          var portfolio = (row[fiPortIdx] || "").trim();
          if (selectedPortfolio !== "all" && normalizeText(portfolio) !== normalizeText(selectedPortfolio)) return;
          if (fiCatIdx !== -1 && normalizeText(row[fiCatIdx]) !== "fixed income") return;
          var inst = (row[fiInstIdx] || "").trim();
          if (!inst) return;
          var sub = fiSubIdx !== -1 ? (row[fiSubIdx] || "").trim() : "";
          var type = normalizeText(row[fiTypeIdx]);
          var isDeposit = type.indexOf("deposit") !== -1;
          var isInterest = type.indexOf("interest") !== -1;
          if (!isDeposit && !isInterest) return;
          var key = portfolio + "||" + inst + "||" + sub;
          var amt = parseNumber(row[fiAmtIdx]);
          if (!byKey[key]) byKey[key] = { portfolio: portfolio, instrument: inst, subCategory: sub || "Provident Fund", invested: 0, current: 0 };
          if (isDeposit) { byKey[key].invested += amt; byKey[key].current += amt; }
          else byKey[key].current += amt;
        });
        Object.keys(byKey).forEach(function (k) { holdings.push(byKey[k]); });
      }
    }

    if (headerError && !holdings.length) {
      statusEl.textContent = "Header row number is incorrect.";
      tableWrap.hidden = true;
      try { renderFiRedesign(_buildAllFixedIncomeHoldingsList()); } catch (e) { console.error("FI redesign failed:", e); }
      return;
    }
    if (!holdings.length) {
      statusEl.textContent = "No Fixed Income holdings found.";
      tableWrap.hidden = true;
      try { renderFiRedesign(_buildAllFixedIncomeHoldingsList()); } catch (e) { console.error("FI redesign failed:", e); }
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

    statusEl.textContent = "";
    tableWrap.hidden = true;
    try { renderFiRedesign(_buildAllFixedIncomeHoldingsList()); } catch (e) { console.error("FI redesign failed:", e); }
  }

  function renderFiRedesign(holdings) {
    // Aggregate cards/allocation/split reflect only ACTIVE (open) holdings — a
    // matured FD is closed, so it's excluded from these like a sold stock is.
    var active = holdings.filter(function (h) { return !h.matured; });
    renderFiPortfolioCards(active);
    renderFiAllocation(active);
    renderFiInterestSplit(active);
    // Debt funds/ETFs count toward the FI totals above, but they have their own
    // Debt ETF/Mutual Fund table — listing them here too would show them twice.
    renderFiHoldingsCardList(holdings.filter(function (h) {
      return String(h.subCategory || "").toLowerCase().indexOf("debt") !== 0;
    }));
  }

  // Collects Fixed Income holdings from BOTH the fd sheet (FD/Corpus/Savings/PF)
  // AND the fixedincome sheet (EPF/PPF deposits + interest).
  function _buildAllFixedIncomeHoldingsList() {
    var selectedPortfolio = "all";
    var out = [];
    var fdRows = getSheetRows("fd");
    if (fdRows && fdRows.length) {
      var fd = buildFdFixedIncomeHoldingsList(fdRows, selectedPortfolio);
      if (fd && fd.length) out = out.concat(fd);
    }
    var fiRows = getSheetRows("fixedincome");
    if (fiRows && fiRows.length) {
      var fiHeader = fiRows[0].map(normalizeText);
      var pI = fiHeader.indexOf("portfolio name");
      var iI = fiHeader.indexOf("instrument name");
      var tI = fiHeader.indexOf("transaction type");
      var aI = fiHeader.indexOf("amount");
      var cI = fiHeader.indexOf("instrument category");
      var sI = fiHeader.indexOf("instrument sub category");
      if (pI !== -1 && iI !== -1 && tI !== -1 && aI !== -1) {
        var byKey = {};
        fiRows.slice(1).forEach(function (row) {
          var portfolio = (row[pI] || "").trim();
          if (selectedPortfolio !== "all" && normalizeText(portfolio) !== normalizeText(selectedPortfolio)) return;
          if (cI !== -1 && normalizeText(row[cI]) !== "fixed income") return;
          var inst = (row[iI] || "").trim();
          if (!inst) return;
          var sub = sI !== -1 ? (row[sI] || "").trim() : "";
          var type = normalizeText(row[tI]);
          var isDeposit = type.indexOf("deposit") !== -1;
          var isInterest = type.indexOf("interest") !== -1;
          if (!isDeposit && !isInterest) return;
          var key = portfolio + "||" + inst + "||" + sub;
          var amt = parseNumber(row[aI]);
          if (!byKey[key]) byKey[key] = { portfolio: portfolio, instrument: inst, subCategory: sub || "Provident Fund", invested: 0, current: 0 };
          if (isDeposit) { byKey[key].invested += amt; byKey[key].current += amt; }
          else byKey[key].current += amt;
        });
        Object.keys(byKey).forEach(function (k) { out.push(byKey[k]); });
      }
    }
    out = out.concat(_buildDebtFundHoldingsForFi());
    return out;
  }

  // Debt funds/ETFs (Instrument Category = Fixed Income in a mapping sheet) are
  // reported under Fixed Income, so the FI cards, allocation and split must see
  // them too — not just the Debt ETF/Mutual Fund list. Normalised onto the FI holding
  // shape. Portfolio comes from the row when tagged (Stocks/ETF), else from the
  // instrument's first appearance in the equity sheet.
  function _buildDebtFundHoldingsForFi() {
    var out = [];
    var portfolioByInst = {};
    ["equity", "stocksetf"].forEach(function (prefix) {
      var eqRows = getSheetRows(prefix);
      if (!eqRows || !eqRows.length) return;
      var hdr = eqRows[0].map(normalizeText);
      var pI = hdr.indexOf("portfolio name");
      var iI = hdr.indexOf("instrument name");
      if (pI === -1 || iI === -1) return;
      eqRows.slice(1).forEach(function (r) {
        var nm = (r[iI] || "").trim();
        if (nm && !portfolioByInst[normalizeText(nm)]) portfolioByInst[normalizeText(nm)] = (r[pI] || "").trim();
      });
    });
    (window.__mfDebtRows || []).forEach(function (r) {
      if ((r.units || 0) < UNITS_EPSILON) return;
      out.push({
        portfolio: r._portfolio || portfolioByInst[normalizeText(r.instrument)] || "",
        instrument: r.instrument,
        subCategory: "Debt Fund",
        invested: r.invested || 0,
        current: r.current || 0
      });
    });
    (window.__seDebtRows || []).forEach(function (r) {
      if ((r.units || 0) < UNITS_EPSILON || r.isClosed) return;
      out.push({
        portfolio: r._portfolio || portfolioByInst[normalizeText(r.instrument)] || "",
        instrument: r.instrument,
        subCategory: "Debt ETF",
        invested: r.investedINR || 0,
        current: r.currentINR || 0
      });
    });
    return out;
  }

  function _fiIsInterestBearing(sub) {
    var s = (sub || "").toLowerCase();
    return s.indexOf("corpus") === -1 && s.indexOf("saving") === -1;
  }
  function _fiIsGold(sub) {
    var s = (sub || "").toLowerCase();
    return s.indexOf("gold") !== -1 || s.indexOf("silver") !== -1 || s.indexOf("commodity") !== -1;
  }

  function renderFiPortfolioCards(holdings) {
    var row = document.getElementById("fipc-row");
    if (!row) return;
    // Local palette copy — MFH_AVATAR_PALETTE is defined later in the file and
    // may not be initialised the first time this runs.
    var FI_AVATAR_PALETTE = [
      { bg: "#D1FAE5", fg: "#065F46", accent: "green" },
      { bg: "#EDE9FE", fg: "#5B21B6", accent: "purple" },
      { bg: "#DBEAFE", fg: "#1E40AF", accent: "blue" },
      { bg: "#FEF3C7", fg: "#B45309", accent: "amber" },
      { bg: "#CFFAFE", fg: "#0E7490", accent: "teal" }
    ];
    function _fiInit(name) {
      var parts = String(name || "").trim().split(/\s+/);
      return parts[0] ? parts[0].charAt(0).toUpperCase() : "?";
    }
    // Group by portfolio
    var byPort = {};
    holdings.forEach(function (h) {
      var p = (h.portfolio || "").trim() || "Unassigned";
      if (!byPort[p]) byPort[p] = { invested: 0, current: 0, fi: 0, gold: 0 };
      byPort[p].invested += h.invested;
      byPort[p].current += h.current;
      if (_fiIsGold(h.subCategory)) byPort[p].gold += h.current;
      else byPort[p].fi += h.current;
    });
    var names = Object.keys(byPort).sort(function (a, b) { return byPort[b].current - byPort[a].current; });
    var combined = { invested: 0, current: 0, fi: 0, gold: 0 };
    names.forEach(function (n) { combined.invested += byPort[n].invested; combined.current += byPort[n].current; combined.fi += byPort[n].fi; combined.gold += byPort[n].gold; });
    var namedList = names.map(function (n, i) { var p = byPort[n]; p.name = n; p.paletteIdx = i; return p; });
    var all = [{ name: "Combined", invested: combined.invested, current: combined.current, fi: combined.fi, gold: combined.gold, isCombined: true }].concat(namedList);

    row.innerHTML = all.map(function (p, i) {
      var pnl = p.current - p.invested;
      var pnlPct = p.invested > 0 ? (pnl / p.invested) * 100 : 0;
      var pal = p.isCombined ? { bg: "#23211D", fg: "#fff" } : FI_AVATAR_PALETTE[i % FI_AVATAR_PALETTE.length];
      var initial = p.isCombined ? "Σ" : _fiInit(p.name);
      var subtitle = p.isCombined ? "HOUSEHOLD TOTAL" : "PERSONAL PORTFOLIO";
      var totalCur = p.fi + p.gold;
      var fiPct = totalCur > 0 ? (p.fi / totalCur) * 100 : 0;
      var goldPct = totalCur > 0 ? (p.gold / totalCur) * 100 : 0;
      // Compute XIRR using the same builders as Overview: matured FD flows +
      // PF flows + EPF flows, with terminal = corresponding current values.
      var xirrPct = null;
      try {
        var pName = p.isCombined ? "all" : p.name;
        var fdRows = getSheetRows("fd");
        var fiRows = getSheetRows("fixedincome");
        var flows = [];
        var terminal = 0;
        if (fdRows) {
          flows = flows.concat(buildFdMaturedXirrCashFlows(fdRows, pName) || []);
          flows = flows.concat(buildProvidentFundXirrCashFlows(fdRows, pName) || []);
          terminal += (sumFdActiveCurrentValue(fdRows, pName) || 0);
          terminal += (sumProvidentFundCurrentValue(fdRows, pName) || 0);
        }
        if (fiRows && typeof buildEpfXirrCashFlows === "function") {
          flows = flows.concat(buildEpfXirrCashFlows(fiRows, pName) || []);
          // EPF terminal = cumulative deposits + interest for this portfolio
          holdings.forEach(function (h) {
            var s = (h.subCategory || "").toLowerCase();
            if (isProvidentFundSub(s)
              && (p.isCombined || normalizeText(h.portfolio) === normalizeText(p.name))) {
              terminal += (h.current || 0);
            }
          });
        }
        // Debt funds/ETFs contribute their buy/sell flows and their current value,
        // so the card's XIRR covers everything the card's value covers.
        var _fiCatMap = buildInstrumentTopCategoryMap();
        ["equity", "stocksetf"].forEach(function (prefix) {
          var dRows = onlyFixedIncomeRows(getSheetRows(prefix), _fiCatMap);
          if (dRows && dRows.length > 1) flows = flows.concat(buildXirrCashFlows(dRows, pName) || []);
        });
        holdings.forEach(function (h) {
          var s = (h.subCategory || "").toLowerCase();
          if (s.indexOf("debt") !== 0) return;
          if (p.isCombined || normalizeText(h.portfolio) === normalizeText(p.name)) terminal += (h.current || 0);
        });
        if (terminal > 0) flows.push({ date: new Date(), amount: terminal });
        var x = calculateXIRR(flows);
        if (x != null && isFinite(x)) xirrPct = x * 100;
      } catch (e) { console.warn("FI XIRR failed for", p.name, e); }
      var goldStr = p.gold > 0 ? goldPct.toFixed(0) + "%" : "—";
      var fiStr = fiPct.toFixed(0) + "%";
      return '<div class="mfpc-card ' + (p.isCombined ? "mfpc-combined" : "") + '">' +
        '<div class="mfpc-head">' +
          '<div class="mfpc-avatar" style="background:' + pal.bg + ';color:' + pal.fg + ';">' + initial + '</div>' +
          '<div class="mfpc-name-block">' +
            '<div class="mfpc-name">' + escapeHtml(p.name) + '</div>' +
            '<div class="mfpc-subtitle">' + subtitle + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="mfpc-current-label">CURRENT VALUE</div>' +
        '<div class="mfpc-current-value"' + _crTitle(p.current) + '>' + formatCurrency(p.current) + '</div>' +
        _mfpcBarHtml() +
        _mfpcReturnRowHtml(pnl, pnlPct) +
        '<div class="mfpc-footer">' +
          '<div class="mfpc-foot-item"><span class="mfpc-foot-label">Invested</span><span class="mfpc-foot-value">' + formatCurrency(p.invested) + '</span></div>' +
          '<div class="mfpc-foot-item"><span class="mfpc-foot-label">XIRR</span><span class="mfpc-foot-value mfpc-xirr ' + (xirrPct != null && xirrPct < 0 ? "mfpc-negative" : "") + '">' + (xirrPct == null ? "—" : (xirrPct >= 0 ? "+" : "") + xirrPct.toFixed(2) + "%") + '</span></div>' +
        '</div>' +
      '</div>';
    }).join("");
  }

  var FIALLOC_MODE = { mode: "sub" };
  function renderFiAllocation(holdings) {
    var listEl = document.getElementById("fialloc-list");
    if (!listEl) return;
    var PAL = ["#10B981", "#E8623A", "#8B5CF6", "#3B82F6", "#D4A017", "#64748B", "#06B6D4", "#EC4899"];
    var PORT_PAL = ["#10B981", "#F59E0B", "#3B82F6", "#8B5CF6", "#06B6D4", "#EC4899", "#84CC16", "#6366F1"];

    if (FIALLOC_MODE.mode === "portfolio") {
      // Aggregate by portfolio; each portfolio row breaks down into sub-cat chips.
      var byPort = {}; // { p: { total, bySub: {sub: value} } }
      holdings.forEach(function (h) {
        var p = (h.portfolio || "Unassigned").trim() || "Unassigned";
        var s = h.subCategory || "Unclassified";
        if (!byPort[p]) byPort[p] = { total: 0, bySub: {} };
        byPort[p].total += h.current || 0;
        byPort[p].bySub[s] = (byPort[p].bySub[s] || 0) + (h.current || 0);
      });
      var portEntries = Object.keys(byPort).map(function (k) { return { name: k, total: byPort[k].total, bySub: byPort[k].bySub }; })
        .filter(function (e) { return e.total > 0.01; })
        .sort(function (a, b) { return b.total - a.total; });
      var grand = portEntries.reduce(function (s, e) { return s + e.total; }, 0);
      if (!portEntries.length || grand <= 0) { listEl.innerHTML = '<p class="muted small">No portfolio allocation data.</p>'; return; }
      var allSubs = {};
      portEntries.forEach(function (e) { Object.keys(e.bySub).forEach(function (k) { allSubs[k] = true; }); });
      var subList = Object.keys(allSubs);
      var subColor = {};
      subList.forEach(function (s, i) { subColor[s] = PAL[i % PAL.length]; });
      var portBar = '<div class="mfalloc-single-bar">' + portEntries.map(function (e, i) {
        var pct = (e.total / grand) * 100;
        return '<span class="mfalloc-seg" style="flex:' + pct + ' 0 0;background:' + PORT_PAL[i % PORT_PAL.length] + ';" title="' + escapeHtml(e.name) + '"></span>';
      }).join("") + '</div>';
      var portRows = portEntries.map(function (e, i) {
        var pct = (e.total / grand) * 100;
        var col = PORT_PAL[i % PORT_PAL.length];
        var subs = Object.keys(e.bySub).sort(function (a, b) { return e.bySub[b] - e.bySub[a]; });
        var chips = subs.filter(function (s) { return e.bySub[s] > 0.01; }).map(function (s) {
          var sp = (e.bySub[s] / e.total) * 100;
          return '<span class="isc-cat-chip"><span class="isc-cat-dot" style="background:' + subColor[s] + '"></span>' + escapeHtml(s) + ' ' + Math.round(sp) + '%</span>';
        }).join("");
        return '<div class="mfalloc-row" style="flex-direction:column;align-items:stretch;gap:4px;padding:8px 0;">' +
          '<div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;">' +
            '<span class="mfalloc-name"><span class="mfalloc-dot" style="background:' + col + ';"></span>' + escapeHtml(e.name) + '</span>' +
            '<span class="mfalloc-nums">' +
              '<span class="mfalloc-amount">' + formatCurrency(e.total) + '</span>' +
              '<span class="mfalloc-pct" style="color:' + col + ';">' + Math.round(pct) + '%</span>' +
            '</span>' +
          '</div>' +
          (chips ? '<div class="isc-cat-sub">' + chips + '</div>' : '') +
        '</div>';
      }).join("");
      listEl.innerHTML = portBar + '<div class="mfalloc-rows">' + portRows + '</div>';
      return;
    }

    var bySub = {};
    var countSub = {};
    holdings.forEach(function (h) {
      var s = h.subCategory || "Unclassified";
      bySub[s] = (bySub[s] || 0) + h.current;
      countSub[s] = (countSub[s] || 0) + 1;
    });
    var entries = Object.keys(bySub).map(function (k) { return { name: k, value: bySub[k], count: countSub[k] }; })
      .sort(function (a, b) { return b.value - a.value; });
    var total = entries.reduce(function (s, e) { return s + e.value; }, 0);
    if (!entries.length) { listEl.innerHTML = '<p class="muted small">No allocation data.</p>'; return; }
    var bar = '<div class="mfalloc-single-bar">' + entries.map(function (e, i) {
      var pct = total > 0 ? (e.value / total) * 100 : 0;
      return '<span class="mfalloc-seg" style="flex:' + pct + ' 0 0;background:' + PAL[i % PAL.length] + ';" title="' + escapeHtml(e.name) + '"></span>';
    }).join("") + '</div>';
    var rows = entries.map(function (e, i) {
      var pct = total > 0 ? (e.value / total) * 100 : 0;
      var col = PAL[i % PAL.length];
      return '<div class="mfalloc-row">' +
        '<span class="mfalloc-name"><span class="mfalloc-dot" style="background:' + col + ';"></span>' + escapeHtml(e.name) + ' <span class="muted" style="font-weight:500;">· ' + e.count + ' holdings</span></span>' +
        '<span class="mfalloc-nums">' +
          '<span class="mfalloc-amount">' + formatCurrency(e.value) + '</span>' +
          '<span class="mfalloc-pct" style="color:' + col + ';">' + (pct < 1 ? "<1%" : pct.toFixed(0) + "%") + '</span>' +
        '</span>' +
      '</div>';
    }).join("");
    listEl.innerHTML = bar + '<div class="mfalloc-rows">' + rows + '</div>';
  }

  // Wire the FI allocation Sub-Category ⇄ Portfolio toggle.
  (function wireFiAllocToggle() {
    var buttons = document.querySelectorAll("[data-fialloc-mode]");
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        FIALLOC_MODE.mode = btn.dataset.fiallocMode;
        buttons.forEach(function (b) { b.classList.toggle("active", b === btn); });
        renderAllFixedIncomeHoldingsTable();
      });
    });
  })();

  function renderFiInterestSplit(holdings) {
    var bar = document.getElementById("fisplit-bar");
    var rows = document.getElementById("fisplit-rows");
    var summary = document.getElementById("fisplit-summary");
    if (!bar || !rows) return;
    var interest = 0, nonInterest = 0;
    holdings.forEach(function (h) {
      if (_fiIsInterestBearing(h.subCategory)) interest += h.current;
      else nonInterest += h.current;
    });
    var total = interest + nonInterest;
    if (total <= 0) { bar.innerHTML = ""; rows.innerHTML = ""; if (summary) summary.textContent = ""; return; }
    var iPct = (interest / total) * 100;
    var nPct = (nonInterest / total) * 100;
    bar.innerHTML =
      '<span class="mfalloc-seg" style="flex:' + iPct + ' 0 0;background:#10B981;"></span>' +
      '<span class="mfalloc-seg" style="flex:' + nPct + ' 0 0;background:#8B7E6B;"></span>';
    rows.innerHTML =
      '<div class="mfalloc-row"><span class="mfalloc-name"><span class="mfalloc-dot" style="background:#10B981;"></span>Interest-bearing</span><span class="mfalloc-nums"><span class="mfalloc-amount">' + formatCurrency(interest) + '</span><span class="mfalloc-pct" style="color:#10B981;">' + iPct.toFixed(0) + '%</span></span></div>' +
      '<div class="mfalloc-row"><span class="mfalloc-name"><span class="mfalloc-dot" style="background:#8B7E6B;"></span>Non-interest bearing</span><span class="mfalloc-nums"><span class="mfalloc-amount">' + formatCurrency(nonInterest) + '</span><span class="mfalloc-pct" style="color:#8B7E6B;">' + nPct.toFixed(0) + '%</span></span></div>';
    if (summary) summary.innerHTML = '<strong>' + iPct.toFixed(0) + '%</strong> is earning interest &middot; Corpus and Savings sit idle at ' + formatCurrency(nonInterest) + '.';
  }

  var FIH_STATE = { sort: "pnl-desc", portfolio: "all", showClosed: false };
  function _fihSortCompare(a, b, key) {
    var pnlA = a.current - a.invested, pnlB = b.current - b.invested;
    var av, bv;
    switch (key) {
      case "instrument": av = String(a.instrument || "").toLowerCase(); bv = String(b.instrument || "").toLowerCase(); return av < bv ? -1 : av > bv ? 1 : 0;
      case "sub": av = String(a.subCategory || "").toLowerCase(); bv = String(b.subCategory || "").toLowerCase(); return av < bv ? -1 : av > bv ? 1 : 0;
      case "invested": return (a.invested || 0) - (b.invested || 0);
      case "current": return (a.current || 0) - (b.current || 0);
      case "pnl": return pnlA - pnlB;
      case "pct":
        var pctA = a.invested > 0 ? pnlA / a.invested : 0;
        var pctB = b.invested > 0 ? pnlB / b.invested : 0;
        return pctA - pctB;
    }
    return 0;
  }
  function renderFiHoldingsCardList(holdings) {
    var list = document.getElementById("fih-list");
    var eyebrow = document.getElementById("fih-eyebrow");
    if (!list) return;
    // Open / Closed (matured) toggle — mirrors the India/US holdings feature.
    // Wired up-front so it works even when the Open list is empty.
    var ocToggle = document.getElementById("fih-open-closed");
    if (ocToggle && !ocToggle.dataset.bound) {
      ocToggle.dataset.bound = "1";
      ocToggle.querySelectorAll("[data-fih-oc]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          FIH_STATE.showClosed = btn.dataset.fihOc === "closed";
          ocToggle.querySelectorAll("[data-fih-oc]").forEach(function (b) { b.classList.toggle("active", b === btn); });
          renderAllFixedIncomeHoldingsTable();
        });
      });
    }
    // Everything this portfolio would show, before the open/closed split — so the
    // pill can disable the side that has nothing behind it, exactly as the Mutual
    // Fund and Stocks/ETF tables do.
    var fihScope = holdings.filter(function (h) {
      if (FIH_STATE.portfolio !== "all" && normalizeText(h.portfolio || "") !== normalizeText(FIH_STATE.portfolio)) return false;
      // No gold exclusion here. These holdings are built from rows whose
      // Instrument Category is "fixed income", and the Commodity card only takes
      // rows categorised "commodity" — so a gold-flavoured sub-category (a
      // Sovereign Gold Bond, say) was dropped from this list and shown on no
      // other card, while still counting towards Category Split and net worth.
      return true;
    });
    var fihHasClosed = fihScope.some(function (h) { return !!h.matured; });
    var fihHasOpen = fihScope.some(function (h) { return !h.matured; });
    if (FIH_STATE.showClosed && !fihHasClosed && fihHasOpen) FIH_STATE.showClosed = false;
    else if (!FIH_STATE.showClosed && !fihHasOpen && fihHasClosed) FIH_STATE.showClosed = true;
    _setOpenClosedPill(ocToggle, FIH_STATE.showClosed, fihHasClosed, fihHasOpen);
    var filtered = fihScope.filter(function (h) {
      // Open = active holdings; Closed = matured FDs (money returned, interest realized).
      return !!h.matured === !!FIH_STATE.showClosed;
    });
    var fparts = String(FIH_STATE.sort || "pnl-desc").split("-");
    var fSortKey = fparts[0];
    var fSortDir = fparts[1] === "asc" ? 1 : -1;
    filtered.sort(function (a, b) { return fSortDir * _fihSortCompare(a, b, fSortKey); });
    if (eyebrow) eyebrow.textContent = "HOLDINGS · " + filtered.length + (FIH_STATE.showClosed ? " CLOSED" : " OPEN");
    if (!filtered.length) {
      list.innerHTML = '<p class="muted small" style="padding:16px;text-align:center;">No ' + (FIH_STATE.showClosed ? "closed (matured)" : "open") + ' fixed income holdings.</p>';
      return;
    }
    var subtotalInv = 0, subtotalCur = 0, subtotalPnl = 0;
    function _fArrow(k) { return fSortKey === k ? (fSortDir === -1 ? " ↓" : " ↑") : ""; }
    var header = '<div class="mfh-list-header" style="grid-template-columns: minmax(180px, 2fr) 1fr 1fr 1fr 1fr 0.9fr;">' +
      '<span class="mfh-sortable" data-fih-sort-col="instrument">Instrument' + _fArrow("instrument") + '</span>' +
      '<span class="mfh-sortable" data-fih-sort-col="sub">Sub-Cat' + _fArrow("sub") + '</span>' +
      '<span class="mfh-col-num mfh-sortable" data-fih-sort-col="invested">Invested' + _fArrow("invested") + '</span>' +
      '<span class="mfh-col-num mfh-sortable" data-fih-sort-col="current">Current' + _fArrow("current") + '</span>' +
      '<span class="mfh-col-num mfh-sortable" data-fih-sort-col="pnl">Unrealized' + _fArrow("pnl") + '</span>' +
      '<span class="mfh-col-num mfh-sortable" data-fih-sort-col="pct">Return %' + _fArrow("pct") + '</span></div>';
    var FI_AVATAR_PALETTE = [
      { bg: "#D1FAE5", fg: "#065F46", accent: "green" },
      { bg: "#EDE9FE", fg: "#5B21B6", accent: "purple" },
      { bg: "#DBEAFE", fg: "#1E40AF", accent: "blue" },
      { bg: "#FEF3C7", fg: "#B45309", accent: "amber" }
    ];
    var body = filtered.map(function (h, i) {
      var pal = FI_AVATAR_PALETTE[i % FI_AVATAR_PALETTE.length];
      var initial = (h.portfolio || "?").charAt(0).toUpperCase();
      // Closed (matured FD): money is returned, so Current shows 0 and the P&L
      // column is the realized interest (maturity value − principal).
      var dispCurrent = h.matured ? 0 : h.current;
      var pnl = h.current - h.invested;
      var pnlPct = h.invested > 0 ? (pnl / h.invested) * 100 : 0;
      var isIdle = !_fiIsInterestBearing(h.subCategory);
      var idleBadge = isIdle ? '<span class="mfh-sip-badge" style="background:#F1EBDD;color:#8B7E6B;">IDLE</span>' : '';
      var maturedBadge = h.matured ? '<span class="mfh-sip-badge" style="background:var(--emerald,#1a9e6e);color:#fff;">MATURED</span>' : '';
      subtotalInv += h.invested; subtotalCur += dispCurrent; subtotalPnl += pnl;
      return '<div class="mfh-row mfh-color-' + pal.accent + '" style="grid-template-columns: minmax(180px, 2fr) 1fr 1fr 1fr 1fr 0.9fr;">' +
        '<div class="mfh-inst"><div class="mfh-avatar" style="background:' + pal.bg + ';color:' + pal.fg + ';">' + initial + '</div>' +
          '<div class="mfh-inst-body">' +
            '<div class="mfh-inst-name">' + escapeHtml(h.instrument) + idleBadge + maturedBadge + '</div>' +
            '<div class="mfh-inst-sub">' + escapeHtml(h.portfolio || "—") + '</div>' +
          '</div>' +
        '</div>' +
        '<div><span class="mfh-sip-badge" style="background:' + pal.bg + ';color:' + pal.fg + ';">' + escapeHtml(h.subCategory) + '</span></div>' +
        '<div class="mfh-col-num mfh-num-primary">' + formatCurrency(h.invested) + '</div>' +
        '<div class="mfh-col-num mfh-num-primary">' + formatCurrency(dispCurrent) + '</div>' +
        '<div class="mfh-col-num mfh-num-primary ' + (pnl >= 0 ? "" : "mfh-negative") + '" style="color:' + (pnl > 0 ? "var(--emerald)" : pnl < 0 ? "var(--negative)" : "var(--muted)") + ';">' + (pnl > 0 ? "+" : "") + (pnl === 0 ? "₹0" : formatCurrency(pnl)) + '</div>' +
        '<div class="mfh-col-num mfh-num-xirr ' + (pnlPct > 0 ? "" : (pnlPct < 0 ? "mfh-negative" : "mfh-muted")) + '">' + (pnlPct > 0 ? "+" : "") + pnlPct.toFixed(2) + '%</div>' +
      '</div>';
    }).join("");
    // P&L = Σ(maturity/current − invested): unrealized for Open, realized interest for
    // Closed. Not (subtotalCur − subtotalInv), since Closed shows Current as 0.
    var subSum = subtotalPnl;
    var subPct = subtotalInv > 0 ? (subSum / subtotalInv) * 100 : 0;
    var footer = '<div class="mfh-row" style="grid-template-columns: minmax(180px, 2fr) 1fr 1fr 1fr 1fr 0.9fr;background:var(--bg);font-weight:700;border-radius:8px;padding:10px 6px;">' +
      '<div style="grid-column:span 2;font-size:0.55rem;letter-spacing:0.11em;text-transform:uppercase;color:var(--muted);">SUB-TOTAL · ' + filtered.length + ' HOLDINGS</div>' +
      '<div class="mfh-col-num mfh-num-primary">' + formatCurrency(subtotalInv) + '</div>' +
      '<div class="mfh-col-num mfh-num-primary">' + formatCurrency(subtotalCur) + '</div>' +
      // mfh-num-primary / mfh-num-xirr carry the type size. Without them these two
      // cells inherited the document's 16px while Invested and Current sat at
      // 0.72rem beside them, so the row read as two different sizes and the wider
      // text broke between the sign and the digits. Same classes as the body rows.
      '<div class="mfh-col-num mfh-num-primary" style="color:' + (subSum > 0 ? "var(--emerald)" : subSum < 0 ? "var(--negative)" : "var(--muted)") + ';">' + (subSum > 0 ? "+" : "") + formatCurrency(subSum) + '</div>' +
      '<div class="mfh-col-num mfh-num-xirr" style="color:' + (subPct > 0 ? "var(--emerald)" : subPct < 0 ? "var(--negative)" : "var(--muted)") + ';">' + (subPct > 0 ? "+" : "") + subPct.toFixed(2) + '%</div>' +
      '</div>';
    list.innerHTML = header + body + footer;
    try { applyHoldingsFold("fih-list"); } catch (e) {}
    list.querySelectorAll("[data-fih-sort-col]").forEach(function (el) {
      el.addEventListener("click", function () {
        var col = el.dataset.fihSortCol;
        var cur = String(FIH_STATE.sort || "").split("-");
        FIH_STATE.sort = (cur[0] === col && cur[1] === "desc") ? (col + "-asc") : (col + "-desc");
        renderFiHoldingsCardList(holdings);
      });
    });

    // Wire portfolio pill toggle
    var pf = document.getElementById("fih-portfolio-toggle");
    if (pf) {
      // Every fixed-income holding counts towards pill availability, including
      // gold-flavoured sub-categories — see the note above: they are not on the
      // Commodity card, so excluding them here disabled a pill for a portfolio
      // that does have holdings. Repainted every render because availability
      // follows the data, not the wiring.
      var withFi = [];
      (holdings || []).forEach(function (h) {
        var pn = (h.portfolio || "").trim();
        if (pn && withFi.indexOf(pn) === -1) withFi.push(pn);
      });
      FIH_STATE.portfolio = _renderPortfolioPills(
        pf, "data-fih-portfolio", _allPortfolioNames(["fd", "fixedincome"]), FIH_STATE.portfolio,
        function (p) { return withFi.indexOf(p) !== -1; });
      if (!pf.dataset.bound) {
        pf.dataset.bound = "1";
        pf.addEventListener("click", function (ev) {
          var btn = ev.target.closest("[data-fih-portfolio]");
          if (!btn || btn.disabled || btn.dataset.fihPortfolio === FIH_STATE.portfolio) return;
          FIH_STATE.portfolio = btn.dataset.fihPortfolio;
          renderAllFixedIncomeHoldingsTable();
        });
      }
    }
    var sortBtn = document.getElementById("fih-sort-toggle");
    if (sortBtn && !sortBtn.dataset.bound) {
      sortBtn.dataset.bound = "1";
      sortBtn.addEventListener("click", function () {
        FIH_STATE.sort = FIH_STATE.sort === "pnl-desc" ? "pnl-asc" : "pnl-desc";
        sortBtn.innerHTML = "Sort P&amp;L " + (FIH_STATE.sort === "pnl-desc" ? "&darr;" : "&uarr;");
        renderAllFixedIncomeHoldingsTable();
      });
    }
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
      if (h.matured) {
        var maturedTag = document.createElement("span");
        maturedTag.className = "fd-matured-tag";
        maturedTag.textContent = "Matured";
        nameTd.appendChild(document.createTextNode(" "));
        nameTd.appendChild(maturedTag);
      }
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

    var selectedPortfolio = "all";
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

    var selectedPortfolio = "all";
    var holdings = buildFdHoldingsList(rows, selectedPortfolio, function (normSubCategory) {
      return _fiIsTermDeposit(normSubCategory);
    });
    if (holdings === null) {
      statusEl.textContent = "Header row number is incorrect. Make adjustments by adding correct header row number.";
      tableWrap.hidden = true;
      return;
    }

    renderFdHoldingsTableInto(statusEl, tableWrap, tbody, holdings, "No Fixed Deposit holdings found.", true);
  }

  // ─── Stocks/ETF: stock_prices.json helpers ────────────────────────────────
  var STOCK_PRICES_CACHE_MAX_AGE_MS = 3 * 60 * 1000; // 3 minutes (merged: live-price cadence)
  // The bulky *_history series in stock_prices.json change once/day, so the 2.24 MB
  // file is cached far longer than the prices — the small live prices come from
  // Supabase every few minutes instead. This cuts repeated 2 MB downloads ~10x.
  var STOCK_STATIC_CACHE_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes (bulky static file)
  var _stockPricesPromise = null;
  var _stockStaticPromise = null;
  var _stockMergedCache = null; // { data, at } — in-memory merged (static + live)

  // Instrument -> Instrument Category ("Equity", "Fixed Income", "Commodity", …)
  // as stated in the Mutual Fund and Stocks/ETF mapping sheets.
  //
  // The sheet an instrument's transactions live in does NOT determine its
  // category: a debt fund and a gold fund both sit in the Mutual Fund sheet but
  // are Fixed Income and Commodity respectively. Anything holding a category
  // must consult this map rather than assume "equity sheet ⇒ Equity".
  // Memoised on the identity of the two mapping-sheet arrays. getSheetRows now
  // returns a stable reference while the underlying payload is unchanged, so
  // reference equality is an exact staleness check — and this map is rebuilt from
  // ~15 call sites, several of them per render. Treat the result as read-only.
  var _topCatMemo = null;
  function buildInstrumentTopCategoryMap() {
    var _mfRows = getSheetRows("mfmapping");
    var _seRows = getSheetRows("stocksetfmapping");
    if (_topCatMemo && _topCatMemo.mf === _mfRows && _topCatMemo.se === _seRows) return _topCatMemo.map;
    var map = {};
    ["mfmapping", "stocksetfmapping"].forEach(function (mp) {
      var rows = mp === "mfmapping" ? _mfRows : _seRows;
      if (!rows || rows.length < 2) return;
      var header = rows[0].map(normalizeText);
      var iIdx = header.indexOf("instrument name");
      var cIdx = header.indexOf("instrument category");
      if (iIdx === -1 || cIdx === -1) return;
      rows.slice(1).forEach(function (r) {
        var nm = (r[iIdx] || "").trim();
        var cat = (r[cIdx] || "").trim();
        if (nm && cat) map[normalizeText(nm)] = cat;
      });
    });
    _topCatMemo = { mf: _mfRows, se: _seRows, map: map };
    return map;
  }

  // An instrument mapped to Instrument Category "Fixed Income" is debt, wherever
  // it is traded. It is reported under Fixed Income / Debt ETF-Mutual and must be
  // kept out of the Mutual Fund and Stocks/ETF lists AND their totals.
  function isFixedIncomeInstrument(name, catMap) {
    var m = catMap || buildInstrumentTopCategoryMap();
    return normalizeText(m[normalizeText(name || "")] || "") === "fixed income";
  }

  // Returns a copy of a transaction sheet with Fixed Income instruments removed,
  // header preserved. Used so per-portfolio invested/XIRR are computed from the
  // same population as the valuation.
  function excludeFixedIncomeRows(rows, catMap) {
    if (!rows || rows.length < 2) return rows;
    var iIdx = rows[0].map(normalizeText).indexOf("instrument name");
    if (iIdx === -1) return rows;
    var m = catMap || buildInstrumentTopCategoryMap();
    return [rows[0]].concat(rows.slice(1).filter(function (r) {
      return !isFixedIncomeInstrument(r[iIdx], m);
    }));
  }

  // Complement of excludeFixedIncomeRows: keeps ONLY the debt transactions.
  function onlyFixedIncomeRows(rows, catMap) {
    if (!rows || rows.length < 2) return rows;
    var iIdx = rows[0].map(normalizeText).indexOf("instrument name");
    if (iIdx === -1) return [rows[0]];
    var m = catMap || buildInstrumentTopCategoryMap();
    return [rows[0]].concat(rows.slice(1).filter(function (r) {
      return isFixedIncomeInstrument(r[iIdx], m);
    }));
  }

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
    // Sector. Matched exactly first, then loosely, so a sheet labelling the
    // column "GICS Sector" or "Sector Name" still resolves.
    var sectorIdx     = header.indexOf("sector");
    if (sectorIdx === -1) sectorIdx = header.findIndex(function (h) { return h.indexOf("sector") !== -1; });
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
        category: categoryIdx !== -1 ? (row[categoryIdx] || "").trim() : "",
        sector:   sectorIdx   !== -1 ? (row[sectorIdx]   || "").trim() : ""
      };
    });
    return map;
  }

  // stock_prices.json — prices, USD/INR history, index history, corporate actions.
  // Cached 30 min and deduped in-flight. The per-ticker OHLC series used to live in
  // here too and were ~90% of the file (2.0 MB of 2.25 MB, ~595 KB gzipped); they
  // are now in stock_history.json, fetched only when a chart needs them, which takes
  // this file off the load path at 67 KB gzipped instead of 662 KB.
  function _getStaticStockData() {
    // Evict the old 2.24 MB merged cache key (replaced by the split static/live
    // caches) so the two don't co-exist and blow the localStorage quota.
    try { localStorage.removeItem("wf-stock-prices-json"); } catch (e) {}
    // One in-flight promise covers the cache read AND the fetch, so concurrent
    // callers can't each start their own 2.3 MB download while IDB is answering.
    if (_stockStaticPromise) return _stockStaticPromise;
    _stockStaticPromise = _blobCacheGet("wf-stock-prices-static", STOCK_STATIC_CACHE_MAX_AGE_MS)
      .then(function (hit) {
        if (hit && hit.data) { _stockStaticPromise = null; return hit.data; }
        return fetch("stock_prices.json?t=" + Math.floor(Date.now() / STOCK_STATIC_CACHE_MAX_AGE_MS))
          .then(function (r) {
            if (!r.ok) throw new Error("stock_prices.json not found (HTTP " + r.status + ")");
            return r.json();
          })
          .then(function (data) {
            _blobCacheSet("wf-stock-prices-static", { data: data });
            _stockStaticPromise = null;
            return data;
          });
      })
      .catch(function (err) { _stockStaticPromise = null; throw err; });
    return _stockStaticPromise;
  }

  // stock_history.json — the per-ticker OHLC series. Only the value chart, the TWR
  // series and the rolling-return analytics read these, so the fetch is deferred
  // until one of them actually runs. Same IndexedDB cache and in-flight dedupe as
  // the prices file.
  var _stockHistoryPromise = null;
  function _getStaticStockHistory() {
    if (_stockHistoryPromise) return _stockHistoryPromise;
    _stockHistoryPromise = _blobCacheGet("wf-stock-history-static", STOCK_STATIC_CACHE_MAX_AGE_MS)
      .then(function (hit) {
        if (hit && hit.data) { _stockHistoryPromise = null; return hit.data; }
        return fetch("stock_history.json?t=" + Math.floor(Date.now() / STOCK_STATIC_CACHE_MAX_AGE_MS))
          .then(function (r) {
            if (!r.ok) throw new Error("stock_history.json not found (HTTP " + r.status + ")");
            return r.json();
          })
          .then(function (data) {
            var hist = (data && data.stock_history) || {};
            _blobCacheSet("wf-stock-history-static", { data: hist });
            _stockHistoryPromise = null;
            return hist;
          });
      })
      .catch(function (err) { _stockHistoryPromise = null; throw err; });
    return _stockHistoryPromise;
  }

  // Merged prices WITH the OHLC history attached, for the chart paths. Callers keep
  // reading spData.stock_history, so nothing downstream changes.
  //
  // If the deployed stock_prices.json still carries stock_history inline (a build
  // from before the split), that copy is used and the extra request is skipped —
  // so a stale Pages deploy or a warm cache can't leave the charts empty. A failed
  // history fetch degrades to no history, which is what a failed prices fetch
  // already did.
  function fetchAllStockPricesWithHistory() {
    return fetchAllStockPrices().then(function (sp) {
      if (sp && sp.stock_history && Object.keys(sp.stock_history).length) return sp;
      return _getStaticStockHistory().catch(function () { return {}; }).then(function (hist) {
        var out = {};
        for (var k in sp) { if (Object.prototype.hasOwnProperty.call(sp, k)) out[k] = sp[k]; }
        out.stock_history = hist || {};
        return out;
      });
    });
  }

  // Returns a Promise<{ updated, prices, usd_inr_history, ... }>. The bulky static
  // histories are cached 30 min; the small live prices overlay from Supabase every
  // ~3 min (in-memory merged cache), so callers get fresh prices without re-pulling
  // the 2.24 MB file. Supabase failing falls back to the static prices.
  // The merged price payload if it is already in memory, else null. Lets a
  // SYNCHRONOUS builder reach USD/INR history without becoming a promise; callers
  // must handle null by re-rendering once the fetch lands.
  function getCachedStockPrices() {
    return (_stockMergedCache && _stockMergedCache.data) || null;
  }

  function fetchAllStockPrices() {
    if (_stockMergedCache && Date.now() - _stockMergedCache.at < STOCK_PRICES_CACHE_MAX_AGE_MS) {
      _rememberPriceSource(_stockMergedCache.data);
      return Promise.resolve(_stockMergedCache.data);
    }
    if (_stockPricesPromise) return _stockPricesPromise;
    var staticP = _getStaticStockData();
    var liveP = (window.WfAuth && WfAuth.loadMarketData)
      ? WfAuth.loadMarketData("stock_prices").catch(function () { return null; })
      : Promise.resolve(null);
    _stockPricesPromise = Promise.all([staticP, liveP])
      .then(function (res) {
        // Shallow-copy so we never mutate the cached static object's prices/updated.
        var base = res[0], data = {};
        for (var k in base) { if (Object.prototype.hasOwnProperty.call(base, k)) data[k] = base[k]; }
        var row = res[1];
        var live = row && row.data;
        if (live && live.prices && live.updated && (!data.updated || live.updated >= data.updated)) {
          data.prices = live.prices;
          if (live.corporate_actions) data.corporate_actions = live.corporate_actions;
          data.updated = live.updated;
          data._liveSource = "supabase";
          data._liveUpdated = row.updated_at || live.updated;
          dbg("[Prices] using live Supabase prices from", data._liveUpdated);
        } else {
          data._liveSource = "static";
          data._liveUpdated = data.updated || null;
        }
        _rememberPriceSource(data);
        _stockMergedCache = { data: data, at: Date.now() };
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
      var usdInrToday = (stockPricesData.prices && stockPricesData.prices["__USD_INR__"]) ? stockPricesData.prices["__USD_INR__"].price : 84;

      return holdings.map(function (h) {
        var investedINR = 0;
        var investedNative = 0; // native currency (USD for US, INR for India)
        h.lots.forEach(function (lot) {
          investedNative += lot.units * lot.price;
          if (h.region === "US") {
            var dateStr = formatDateISO(lot.date);
            var rate = lookupUsdInrRate(usdRateMap, dateStr, usdInrToday);
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
          investedNative: investedNative,
          txns: h.txns
        };
      });
    });
  }

  // ─── End Stocks/ETF helpers ───────────────────────────────────────────────

  var GOLD_PRICE_CACHE_KEY = "wf-gold-price-inr-per-gram";
  var GOLD_PRICE_CACHE_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours
  // Freshness of the last gold-rate resolution, surfaced under the rate so a
  // cached/stale fallback (all live sources failed) is visibly distinct from a
  // live value. fetchedAt = when the shown price was actually fetched.
  var _goldRateMeta = { fetchedAt: null, stale: false };
  function goldRateFreshnessText() {
    if (!_goldRateMeta.fetchedAt) return "";
    var mins = Math.max(0, Math.round((Date.now() - _goldRateMeta.fetchedAt) / 60000));
    var rel = mins < 1 ? "just now" : mins < 60 ? mins + "m ago"
      : mins < 1440 ? Math.round(mins / 60) + "h ago" : Math.round(mins / 1440) + "d ago";
    return _goldRateMeta.stale ? "cached · last updated " + rel + " (live source unavailable)" : "updated " + rel;
  }
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
    var mult = getGoldPremiumMultiplier();
    try {
      var cached = JSON.parse(localStorage.getItem(GOLD_DAY_CHANGE_CACHE_KEY));
      if (cached && Date.now() - cached.fetchedAt < GOLD_DAY_CHANGE_CACHE_MAX_AGE_MS) {
        // Cache the RAW (pre-premium) delta and apply the CURRENT premium on
        // read, so changing the premium % updates the day change like it does
        // the price. (Legacy caches stored the premium-applied value under
        // .change; fall back to that.)
        if (cached.rawChange != null) return Promise.resolve(cached.rawChange * mult);
        return Promise.resolve(cached.change);
      }
    } catch (e) {}
    // Keyless day change: today's spot per gram minus yesterday's, both via the
    // free currency-api. (goldapi.io is no longer used — its key 403s.)
    var yest = new Date();
    yest.setDate(yest.getDate() - 1);
    var yStr = formatDateISO(yest);
    return Promise.all([
      fetchGoldPriceINRPerGram().catch(function () { return null; }),
      fetchXauInrForDate(yStr).catch(function () { return null; })
    ]).then(function (r) {
      var today = r[0], prev = r[1];
      if (today == null || prev == null) throw new Error("gold day change unavailable");
      var changePerGram = today - prev;               // premium-applied (both inputs are)
      var rawChange = mult ? changePerGram / mult : changePerGram; // strip premium for cache
      try { localStorage.setItem(GOLD_DAY_CHANGE_CACHE_KEY, JSON.stringify({ rawChange: rawChange, fetchedAt: Date.now() })); } catch (e) {}
      return changePerGram;
    });
  }

  function fetchXauInrForDate(dateStr) {
    // Historical prices never change — cache indefinitely (raw international spot).
    var cacheKey = "wf-gold-hist-" + dateStr;
    try {
      var cached = JSON.parse(localStorage.getItem(cacheKey));
      if (cached && cached.price) return Promise.resolve(cached.price * getGoldPremiumMultiplier());
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

    // Keyless dated snapshot for a given date, tried across two mirrors of the
    // same dataset (jsDelivr, then the project's pages.dev fallback) so one CDN
    // failing doesn't blank the gold history. Weekend/holiday gaps are handled by
    // the caller stepping back a few days.
    function tryDateAllSources(dStr) {
      var urlA = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@" + dStr + "/v1/currencies/xau.min.json";
      var urlB = "https://" + dStr + ".currency-api.pages.dev/v1/currencies/xau.min.json";
      return fetchFromCurrencyApi(urlA).catch(function () { return fetchFromCurrencyApi(urlB); });
    }

    // Step back up to 3 days (handles weekends/holidays for currency-api dates)
    // Yahoo Finance is tried for EACH date in the window before giving up
    function tryDate(dStr, attemptsLeft) {
      return tryDateAllSources(dStr)
        .then(function (pricePerGram) {
          try { localStorage.setItem(cacheKey, JSON.stringify({ price: pricePerGram })); } catch (e) {}
          return pricePerGram * getGoldPremiumMultiplier();
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

  // Reads the user-configured India-retail premium % (0 = raw international spot).
  // The default must match what settings.html shows in the unsaved field, or a
  // user who never pressed Save is valued at a percentage they were never shown.
  var GOLD_PREMIUM_DEFAULT_PCT = 15;
  function getGoldPremiumMultiplier() {
    var raw = localStorage.getItem("wf-gold-premium-pct");
    var pct = raw == null || raw === "" ? GOLD_PREMIUM_DEFAULT_PCT : parseFloat(raw);
    if (!isFinite(pct)) pct = 0;
    return 1 + pct / 100;
  }

  function fetchGoldPriceINRPerGram() {
    try {
      var cached = JSON.parse(localStorage.getItem(GOLD_PRICE_CACHE_KEY));
      if (cached && Date.now() - cached.fetchedAt < GOLD_PRICE_CACHE_MAX_AGE_MS) {
        _goldRateMeta = { fetchedAt: cached.fetchedAt, stale: false };
        return Promise.resolve(cached.price * getGoldPremiumMultiplier());
      }
    } catch (e) {}

    // Keyless, CORS-friendly XAU (gold) price in INR. Two mirrors of the same
    // dataset — the jsDelivr CDN and the project's own pages.dev fallback — so a
    // transient failure of one URL doesn't blank the gold rate.
    var URLS = [
      "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/xau.min.json",
      "https://latest.currency-api.pages.dev/v1/currencies/xau.min.json"
    ];
    function tryUrls(i) {
      if (i >= URLS.length) return Promise.reject(new Error("all gold price sources failed"));
      return fetch(URLS[i])
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (data) {
          var xauInr = data && data.xau && data.xau.inr;
          if (!xauInr) throw new Error("Invalid currency-api response");
          return xauInr;
        })
        .catch(function () { return tryUrls(i + 1); });
    }
    return tryUrls(0).then(function (xauInr) {
      dbg("[Gold] XAU/INR from currency-api:", xauInr);
      var priceInrPerGram = xauInr / TROY_OZ_TO_GRAM;
      var now = Date.now();
      _goldRateMeta = { fetchedAt: now, stale: false };
      try {
        // Cache the raw international spot price; premium applied on read.
        localStorage.setItem(GOLD_PRICE_CACHE_KEY, JSON.stringify({ fetchedAt: now, price: priceInrPerGram }));
      } catch (e) {}
      return priceInrPerGram * getGoldPremiumMultiplier();
    }).catch(function (err) {
      // Last resort: a stale cached price is far better than a blank rate.
      try {
        var c = JSON.parse(localStorage.getItem(GOLD_PRICE_CACHE_KEY));
        if (c && c.price) { dbg("[Gold] all sources failed — using stale cache"); _goldRateMeta = { fetchedAt: c.fetchedAt || null, stale: true }; return c.price * getGoldPremiumMultiplier(); }
      } catch (e) {}
      throw err;
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

  // Fixed-income value (PF/EPF principal+interest, plus active Fixed Deposits at
  // par) as of a date — the opening mark for a period XIRR. Investment Corpus /
  // Savings Account are excluded (never part of XIRR), matching the Overview.
  function fixedIncomeValueAtDate(fdRows, portfolioFilter, asOf) {
    if (!fdRows || !fdRows.length) return 0;
    // PF/EPF: principal + accrued interest up to asOf (from the value timeline,
    // with the parked-cash "balance" rows excluded).
    var pfEvents = buildFdValueEvents(portfolioFilter, true);
    var pf = lastAtOrBefore(pfEvents, asOf, "cumulativeValue") || 0;
    // Fixed Deposits open at asOf → par value (bought on/before asOf, not yet matured).
    var header = fdRows[0].map(normalizeText);
    var pIdx = header.indexOf("portfolio name"), cIdx = header.indexOf("instrument category"),
        sIdx = header.indexOf("instrument sub category"), aIdx = header.indexOf("invested amount"),
        dIdx = header.indexOf("transaction date");
    var mIdx = header.indexOf("maturity date/sell date");
    if (mIdx === -1) mIdx = header.indexOf("maturity date");
    var fd = 0;
    fdRows.slice(1).forEach(function (row) {
      if (pIdx !== -1 && portfolioFilter !== "all" && normalizeText(row[pIdx]) !== normalizeText(portfolioFilter)) return;
      if (cIdx !== -1 && normalizeText(row[cIdx]) !== "fixed income") return;
      if (sIdx === -1 || !_fiIsTermDeposit(normalizeText(row[sIdx]))) return;
      var buy = parseFlexibleDate(row[dIdx]); if (!buy || buy > asOf) return;
      var mat = mIdx !== -1 ? parseFlexibleDate(row[mIdx]) : null;
      if (mat && mat <= asOf) return; // matured before asOf → already realized
      fd += parseNumber(row[aIdx]);
    });
    return pf + fd;
  }

  // periodYears: number of years to look back (null = all time)
  function computeBenchmarkXirr(indexKey, periodYears) {
    var selected = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
    var equityRows = getSheetRows("equity");
    var seRows = getSheetRows("stocksetf");
    var fdRows = getSheetRows("fd");

    // INR-converted SE flows (US buys/sells converted at transaction-date FX). Fall
    // back to the raw sheet flows only until the SE render has populated _seFlowsINR.
    var seFlowsINR = (_ovFlows.seFlowsINR && _ovFlows.seFlowsINR.length) ? _ovFlows.seFlowsINR
                     : (seRows ? buildXirrCashFlows(seRows, selected) : []);

    var allFlows = buildXirrCashFlows(equityRows, selected);
    if (seRows) allFlows = allFlows.concat(seFlowsINR);
    if (fdRows && !isFixedIncomeExcluded()) {
      allFlows = allFlows
        .concat(buildFdMaturedXirrCashFlows(fdRows, selected))
        .concat(buildProvidentFundXirrCashFlows(fdRows, selected));
    }

    var cutoff = periodYears ? new Date(new Date() - periodYears * 365.25 * 24 * 60 * 60 * 1000) : null;
    function afterCutoff(f) { return !cutoff || f.date >= cutoff; }

    // Index XIRR: buy-only flows filtered to the selected period. Fixed Income
    // flows are included/excluded with the same toggle as the portfolio side so
    // the comparison stays apples-to-apples.
    var allFlowsForIndex = buildXirrCashFlows(equityRows, selected).filter(afterCutoff);
    if (seRows) allFlowsForIndex = allFlowsForIndex.concat(seFlowsINR.filter(afterCutoff));
    if (fdRows && !isFixedIncomeExcluded()) {
      allFlowsForIndex = allFlowsForIndex
        .concat(buildFdMaturedXirrCashFlows(fdRows, selected).filter(afterCutoff))
        .concat(buildProvidentFundXirrCashFlows(fdRows, selected).filter(afterCutoff));
    }
    // Commodity (gold) is always part of the portfolio XIRR (its flows are in
    // _overviewBaseFlows regardless of the FI toggle), so the index must replay the
    // same gold rupees — otherwise the index never buys Nifty with money put into
    // gold and the displayed alpha is overstated. Strip the commodity terminal (the
    // index builds its own terminal). Populated async by the overview; the card
    // re-runs on wf-overview-flows-ready so a transient miss self-heals.
    var commodityIndexFlows = (_ovFlows.commodityXirrFlows || []).filter(function (f) { return !f._terminal; });
    if (commodityIndexFlows.length) allFlowsForIndex = allFlowsForIndex.concat(commodityIndexFlows.filter(afterCutoff));

    // All-time portfolio XIRR (used for "All" period and as fallback)
    var flowsWithTerminal;
    if (_ovFlows.overviewBaseFlows && _ovFlows.overviewBaseFlows.length) {
      flowsWithTerminal = _ovFlows.overviewBaseFlows.concat(_ovFlows.seXirrFlows || []);
    } else {
      var currentVal = _ovSlice.mf.current + (_ovSlice.se.current > 0 ? _ovSlice.se.current : 0) + (isFixedIncomeExcluded() ? 0 : _ovSlice.fi.current) + _ovSlice.comm.current;
      flowsWithTerminal = allFlows.slice();
      if (currentVal > 0) flowsWithTerminal.push({ date: new Date(), amount: currentVal });
    }
    var allTimePortfolioXirr = calculateXIRR(flowsWithTerminal);

    // For a selected period: compute portfolio value at cutoff as "starting investment",
    // then XIRR over [cutoff → today] using actual flows within the period + current value.
    // portfolioXirrPromise resolves to { xirr, indexFlows } where indexFlows are the
    // signed rupee cash flows (buys negative, sells positive) to simulate on the index —
    // WITH the same opening mark as the portfolio for a period window, and WITHOUT the
    // portfolio's rupee terminal (buildIndexXirrCashFlows computes its own terminal).
    var portfolioXirrPromise;
    if (periodYears && cutoff) {
      portfolioXirrPromise = computePortfolioValueAtDate(cutoff, selected).then(function (result) {
        // Opening mark (MF + stocks priced at the cutoff).
        var startVal = result.value;
        // Terminal value in the same scope: MF current + stocks' current value
        // (post-cutoff purchases now included via computePortfolioValueAtDate).
        var periodCurrentVal = _ovSlice.mf.current + result.seCurrentIncluded;
        // Period cash flows for MF + stocks (buys/sells after the cutoff).
        var periodFlows = [];
        var mfSeFlows = buildXirrCashFlows(equityRows, selected);
        if (seRows) mfSeFlows = mfSeFlows.concat(seFlowsINR);
        mfSeFlows.forEach(function (f) { if (f.date > cutoff) periodFlows.push(f); });

        // Fixed Income follows the exclusion toggle: with "No Exclusion" it is
        // part of the portfolio return; with "Exclude Fixed Income" it is left
        // out. (Matches the Overview / all-time treatment.)
        if (!isFixedIncomeExcluded() && fdRows) {
          startVal += fixedIncomeValueAtDate(fdRows, selected, cutoff);
          periodCurrentVal += (sumFdActiveCurrentValue(fdRows, selected) || 0)
                            + (sumProvidentFundCurrentValue(fdRows, selected) || 0);
          buildFdMaturedXirrCashFlows(fdRows, selected)
            .concat(buildProvidentFundXirrCashFlows(fdRows, selected))
            .forEach(function (f) { if (f.date > cutoff) periodFlows.push(f); });
        }

        if (!startVal || startVal <= 0) return { xirr: allTimePortfolioXirr, indexFlows: allFlowsForIndex };
        // Index seed = same opening mark (cutoff value) + post-cutoff signed flows, so the
        // index is measured over the SAME window and starting capital as the portfolio.
        var idxFlows = periodFlows.slice();
        idxFlows.unshift({ date: cutoff, amount: -startVal });
        // Portfolio period XIRR = opening mark + flows + rupee terminal at today.
        var portFlows = periodFlows.slice();
        portFlows.unshift({ date: cutoff, amount: -startVal });
        if (periodCurrentVal > 0) portFlows.push({ date: new Date(), amount: periodCurrentVal });
        return { xirr: (calculateXIRR(portFlows) || allTimePortfolioXirr), indexFlows: idxFlows };
      });
    } else {
      portfolioXirrPromise = Promise.resolve({ xirr: allTimePortfolioXirr, indexFlows: allFlowsForIndex });
    }

    return portfolioXirrPromise.then(function (pr) {
      return fetchIndexHistory().then(function (indexHistory) {
        var indexData = indexHistory[indexKey];
        var indexPriceDates = indexData && indexData.prices ? Object.keys(indexData.prices).sort() : [];
        var indexHasHistory = indexPriceDates.length >= 30 &&
          (new Date(indexPriceDates[indexPriceDates.length - 1]) - new Date(indexPriceDates[0])) > 180 * 24 * 60 * 60 * 1000;
        if (!indexHasHistory) return { portfolioXirr: pr.xirr, indexXirr: null };
        // Feed the FULL signed flows (buys AND sells) so the index redeems units when the
        // portfolio sells — apples-to-apples, not buy-only.
        var indexFlows = buildIndexXirrCashFlows(pr.indexFlows, indexData.prices);
        var indexXirr = indexFlows ? calculateXIRR(indexFlows) : null;
        return { portfolioXirr: pr.xirr, indexXirr: indexXirr };
      });
    });
  }

  // Builds a synthetic time-weighted-return NAV series (starting at 100) for the
  // portfolio's MF + Stocks/ETF holdings, sampled monthly from inception to today.
  // This is the same construction used by computeRollingReturns — external cash
  // flows (buys/sells) are netted out each month so contributions don't masquerade
  // as return. Returns Promise<[{date, nav}]> (null if insufficient data).
  function computePortfolioTwrNavSeries(selected) {
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
      var stockPricesPromise = fetchAllStockPricesWithHistory().catch(function () { return {}; });

      return Promise.all([navHistoriesPromise, stockPricesPromise]).then(function (res) {
        var navHistories = res[0];
        var spData = res[1];
        var stockHistory = spData.stock_history || {};
        var usdInrHistMap = spData.usd_inr_history || {};
        var allPrices = spData.prices || {};
        var usdInrToday = allPrices["__USD_INR__"] ? allPrices["__USD_INR__"].price : 84;

        var navByInstrument = {};
        instruments.forEach(function (name, i) { navByInstrument[name] = navHistories[i]; });

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

        var today = new Date(); today.setHours(0, 0, 0, 0);
        var samples = [];
        var d = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
        while (d <= today) { samples.push(new Date(d)); d.setMonth(d.getMonth() + 1); }
        if (!samples.length || samples[samples.length - 1] < today) samples.push(today);

        // Each sample records the price it valued every instrument at, so the
        // period's cash flow can be measured with those same prices. Measuring the
        // flow with the price recorded on the sheet instead let the gap between the
        // two leak into the return, permanently and in whichever direction the
        // recorded price differed.
        var portfolioValues = [];
        samples.forEach(function (date) {
          var dateStr = formatDateISO(date);
          var total = 0;
          var priceOf = {};
          instruments.forEach(function (name) {
            var units = lastAtOrBefore(unitEvents[name], date, "cumulativeUnits") || 0;
            var nav = lastAtOrBefore(navByInstrument[name], date, "nav");
            if (!nav) return;
            priceOf["mf|" + normalizeText(name)] = nav;
            if (units > UNITS_EPSILON) total += units * nav;
          });
          Object.keys(seUnitEventsByTicker).forEach(function (ticker) {
            var entry = seUnitEventsByTicker[ticker];
            var units = lastAtOrBefore(entry.events, date, "cumulativeUnits") || 0;
            var hist = stockHistory[ticker];
            var price = hist ? lastPriceOnOrBefore(hist.prices, dateStr) : null;
            if (!price) return;
            var isUsd = entry.region === "US" || (hist && hist.currency === "USD");
            var priceInr = isUsd ? price * (usdInrHistMap[dateStr] || usdInrToday) : price;
            // Recorded even at zero units: the sale that closes a position is the
            // flow that most needs pricing.
            priceOf["se|" + normalizeText(entry.instrument || "")] = priceInr;
            if (units > UNITS_EPSILON) total += units * priceInr;
          });
          if (total > 0) portfolioValues.push({ date: date, value: total, priceOf: priceOf });
        });

        if (portfolioValues.length < 2) return null;

        // Units traded for money, per instrument. Splits and bonuses are excluded —
        // they move the unit count without any money moving.
        var mfTradedUnits = buildTradedUnitsByDate(getSheetRows("equity"), selected);
        var seTradedUnits = buildTradedUnitsByDate(seRows, selected);

        var navSeries = [{ date: portfolioValues[0].date, nav: 100 }];
        for (var m = 1; m < portfolioValues.length; m++) {
          var prevPt = portfolioValues[m - 1], curPt = portfolioValues[m];
          // The period's flow, valued at the prices THIS sample used. The units
          // bought during the period are in the ending value at the ending price,
          // so that is the price at which they must be taken back out.
          var netFlow = 0;
          Object.keys(curPt.priceOf).forEach(function (key) {
            var byDate = key.slice(0, 3) === "mf|" ? mfTradedUnits[key.slice(3)]
                                                   : seTradedUnits[key.slice(3)];
            var u = tradedUnitsInRange(byDate, prevPt.date, curPt.date);
            if (u) netFlow += u * curPt.priceOf[key];
          });
          var g = prevPt.value > 0 ? (curPt.value - netFlow) / prevPt.value : 1;
          // C4: reflect real drawdowns instead of flattening them. Previously a
          // collapse interval (g <= 0, i.e. netted value fell to/through zero) was
          // forced to g = 1 (a flat 0% month), which understated the portfolio's
          // true loss and inflated its CAGR. Keep NAV strictly positive by
          // flooring a collapse at 0.01 (a bounded −99% for that interval) so the
          // drawdown shows through; only a genuinely non-finite ratio stays flat.
          if (!isFinite(g)) g = 1;
          else if (g <= 0) g = 0.01;
          navSeries.push({ date: curPt.date, nav: navSeries[m - 1].nav * g });
        }
        return navSeries;
      });
    });
  }

  // Portfolio AND index CAGR computed over ONE identical window, so the two
  // numbers (and their alpha) compare like-for-like. This replaces the earlier
  // pair of independent functions whose windows could diverge:
  //   C1 — the index CAGR's all-time start was the earliest of ALL cash flows
  //        (incl. FD/PF, which can predate the first equity buy), while the
  //        portfolio CAGR started at the first MF/Stocks-ETF sample.
  //   C2 — for a period (e.g. 3Y) the index annualised over the full period
  //        while the portfolio annualised over its own (possibly shorter) life.
  //   C3 — the index exponent used the requested window years even though its
  //        start PRICE was forced to the first available (later) date, so the
  //        price span was shorter than the exponent → index CAGR understated.
  //
  // Fix: anchor both series to the SAME start sample, the SAME end sample, and
  // the SAME actualYears exponent. The portfolio's TWR NAV series defines the
  // window; the index is priced at that window's own start/end dates. If the
  // index history begins after the window start, BOTH series are rebased to the
  // first sample the index can cover, so the exponent always matches the price
  // span. Returns Promise<{ portfolioCagr, indexCagr, years }>.
  function computeAlignedCagr(indexKey, periodYears) {
    var selected = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
    var EMPTY = { portfolioCagr: null, indexCagr: null, years: null };
    return Promise.all([
      computePortfolioTwrNavSeries(selected),
      fetchIndexHistory()
    ]).then(function (res) {
      var navSeries = res[0];
      if (!navSeries || navSeries.length < 2) return EMPTY;
      var indexHistory = res[1] || {};
      var indexData = indexHistory[indexKey];
      var prices = (indexData && indexData.prices) ? indexData.prices : null;
      var sortedIdxDates = prices ? Object.keys(prices).sort() : [];
      var indexUsable = sortedIdxDates.length >= 30 &&
        (new Date(sortedIdxDates[sortedIdxDates.length - 1]) - new Date(sortedIdxDates[0])) > 180 * 24 * 60 * 60 * 1000;

      // Window start = first NAV sample at/after the requested start (inception
      // when no period is selected, or when the portfolio is younger than the
      // period → its own inception).
      var startIdx = 0;
      if (periodYears) {
        var startDate = new Date(new Date() - periodYears * 365.25 * 24 * 60 * 60 * 1000);
        startIdx = -1;
        for (var i = 0; i < navSeries.length; i++) {
          if (navSeries[i].date >= startDate) { startIdx = i; break; }
        }
        if (startIdx === -1) return EMPTY; // period start after the last sample
      }

      // C1/C3: if index coverage begins after the portfolio's window start,
      // rebase BOTH series forward to the first sample the index can price, so
      // the portfolio and index cover the identical span.
      if (indexUsable) {
        var firstIdxDate = new Date(sortedIdxDates[0]);
        if (navSeries[startIdx].date < firstIdxDate) {
          var reIdx = -1;
          for (var j = startIdx; j < navSeries.length; j++) {
            if (navSeries[j].date >= firstIdxDate) { reIdx = j; break; }
          }
          if (reIdx === -1) indexUsable = false; else startIdx = reIdx;
        }
      }

      var startPt = navSeries[startIdx];
      var endPt = navSeries[navSeries.length - 1];
      var actualYears = (endPt.date - startPt.date) / (365.25 * 24 * 60 * 60 * 1000);
      if (actualYears < 0.05 || startPt.nav <= 0) return EMPTY;

      var out = { portfolioCagr: null, indexCagr: null, years: actualYears };

      // Portfolio CAGR over the common window.
      var pCagr = Math.pow(endPt.nav / startPt.nav, 1 / actualYears) - 1;
      if (isFinite(pCagr) && pCagr > -1) out.portfolioCagr = pCagr;

      // Index CAGR over the SAME start date, end date and exponent.
      if (indexUsable && prices) {
        // Nearest price on/before the target date, then on/after, else the last
        // available — robust to weekends/holidays/stale tails without stretching
        // the exponent (which is fixed to the portfolio window above).
        function idxPriceNear(dateStr) {
          var p = lookupIndexPrice(prices, dateStr);
          if (p) return p;
          for (var k = 0; k < sortedIdxDates.length; k++) { if (sortedIdxDates[k] >= dateStr) return prices[sortedIdxDates[k]]; }
          return sortedIdxDates.length ? prices[sortedIdxDates[sortedIdxDates.length - 1]] : null;
        }
        var startPrice = idxPriceNear(formatDateISO(startPt.date));
        var endPrice = idxPriceNear(formatDateISO(endPt.date));
        if (startPrice && endPrice) {
          var iCagr = Math.pow(endPrice / startPrice, 1 / actualYears) - 1;
          if (isFinite(iCagr) && iCagr > -1) out.indexCagr = iCagr;
        }
      }
      return out;
    }).catch(function () { return EMPTY; });
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
        ? fetchAllStockPricesWithHistory().catch(function () { return {}; })
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
          var hist = stockHistory[ticker];
          var isUsd = entry.region === "US" || (hist && hist.currency === "USD");
          var unitsAtCutoff = lastAtOrBefore(entry.events, targetDate, "cumulativeUnits") || 0;
          var unitsToday = lastAtOrBefore(entry.events, today, "cumulativeUnits") || 0;
          var cur = allPrices[ticker];
          var curVal = (unitsToday > UNITS_EPSILON && cur && cur.price)
            ? unitsToday * cur.price * (isUsd ? usdInrToday : 1) : 0;
          // Historical price at the cutoff (never fall back to current LTP — would distort XIRR).
          var priceAtCutoff = (unitsAtCutoff > UNITS_EPSILON && hist) ? lookupIndexPrice(hist.prices, dateStr) : null;

          if (unitsAtCutoff > UNITS_EPSILON && priceAtCutoff) {
            // Held & priced at the cutoff → contributes to the opening value AND its
            // current value to the terminal (same scope).
            seTotal += unitsAtCutoff * priceAtCutoff * (isUsd ? (usdInrHistMap[dateStr] || usdInrToday) : 1);
            includedStockTickers.push(ticker);
            seCurrentIncluded += curVal;
          } else if (unitsAtCutoff <= UNITS_EPSILON && unitsToday > UNITS_EPSILON) {
            // Bought entirely AFTER the cutoff → no opening value, but its buy cash flows
            // fall inside the period, so its current value must be in the terminal.
            // Omitting it made in-period purchases look like vanished money and dragged
            // the period (e.g. 5Y) portfolio XIRR down, sometimes negative.
            seCurrentIncluded += curVal;
          }
          // Held at cutoff but UNPRICED then → excluded from both opening and terminal
          // (its pre-cutoff buys are likewise outside the period flows).
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
      var stockPricesPromise = fetchAllStockPricesWithHistory().catch(function () { return {}; });

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
          var priceOf = {};
          instruments.forEach(function (name) {
            var units = lastAtOrBefore(unitEvents[name], date, "cumulativeUnits") || 0;
            var nav = lastAtOrBefore(navByInstrument[name], date, "nav");
            if (!nav) return;
            priceOf["mf|" + normalizeText(name)] = nav;
            if (units > UNITS_EPSILON) total += units * nav;
          });
          Object.keys(seUnitEventsByTicker).forEach(function (ticker) {
            var entry = seUnitEventsByTicker[ticker];
            var units = lastAtOrBefore(entry.events, date, "cumulativeUnits") || 0;
            var hist = stockHistory[ticker];
            // Only actual historical prices — today's LTP as a proxy would distort rolling CAGRs
            var price = hist ? lookupIndexPrice(hist.prices, dateStr) : null;
            if (!price) return;
            var isUsd = entry.region === "US" || (hist && hist.currency === "USD");
            var priceInr = isUsd ? price * (usdInrHistMap[dateStr] || usdInrToday) : price;
            priceOf["se|" + normalizeText(entry.instrument || "")] = priceInr;
            if (units > UNITS_EPSILON) total += units * priceInr;
          });
          if (total > 0) portfolioValues.push({ date: date, value: total, priceOf: priceOf });
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
        // Units traded for money; splits and bonuses move units without money.
        var mfTradedUnits = buildTradedUnitsByDate(getSheetRows("equity"), selected);
        var seTradedUnits = buildTradedUnitsByDate(seRows, selected);

        var navSeries = [{ date: portfolioValues[0].date, nav: 100 }];
        for (var m = 1; m < portfolioValues.length; m++) {
          var prevPt = portfolioValues[m - 1], curPt = portfolioValues[m];
          // Valued at THIS sample's prices, the same ones that produced curPt.value:
          // the units bought during the period sit in the ending value at the ending
          // price, so that is the price they must be taken back out at. Using the
          // amount recorded on the sheet instead let the difference between the two
          // leak into the return, every period, permanently.
          var netFlow = 0;
          Object.keys(curPt.priceOf).forEach(function (key) {
            var byDate = key.slice(0, 3) === "mf|" ? mfTradedUnits[key.slice(3)]
                                                   : seTradedUnits[key.slice(3)];
            var u = tradedUnitsInRange(byDate, prevPt.date, curPt.date);
            if (u) netFlow += u * curPt.priceOf[key];
          });
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
          // Keep any finite, economically-valid CAGR (> -100%). The old cagr<20
          // (2000%) upper cutoff silently dropped genuine extreme windows,
          // biasing min/median/max/count.
          if (isFinite(cagr) && cagr > -1) portRolling.push(cagr);

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
          var _n = arr.length, _mid = Math.floor(_n / 2);
          var _median = _n % 2 ? arr[_mid] : (arr[_mid - 1] + arr[_mid]) / 2;
          return { min: arr[0], median: _median, max: arr[arr.length - 1], count: arr.length };
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
        // Portfolio CAGR = true time-weighted CAGR over the period, so it compares
        // like-for-like with the index's point-to-point CAGR (and with the
        // Growth-of-₹100 chart). XIRR (money-weighted) is shown in XIRR mode.
        portVal = (cagrResult && cagrResult.portfolioCagr != null) ? cagrResult.portfolioCagr : null;
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
        // Portfolio + index CAGR over one identical window (see computeAlignedCagr).
        computeAlignedCagr(indexKey, periodYears)
      ]).then(function (results) {
        if (gen !== _benchmarkGeneration) return;
        _lastXirrResult = results[0];
        _lastCagrResult = results[1] || {};
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
    // wf-overview-flows-ready (fired once _ovFlows.overviewBaseFlows is populated)
    // before re-running the benchmark so it has a valid terminal value.
    var _pendingBenchmarkRefresh = false;
    var _benchmarkInitialRefreshDone = false;
    var _lastBenchmarkHadSe = false; // did the last benchmark run include the SE leg?
    function _seFlowsPresent() { return !!(_ovFlows.seXirrFlows && _ovFlows.seXirrFlows.length); }
    document.addEventListener("wf-exclusion-changed", function () {
      _pendingBenchmarkRefresh = true;
    });
    document.addEventListener("wf-overview-flows-ready", function () {
      var currentKey = localStorage.getItem(BENCH_KEY) || "NIFTY50";
      if (!currentKey) return;
      // The initial applyBenchmark() at load time can run before the Overview's
      // terminal flows and live prices are ready, yielding a stale/wrong figure
      // (e.g. a negative XIRR that later corrects). Force exactly one refresh on
      // the first flows-ready event so the numbers settle immediately on hard
      // refresh. Afterwards, only refresh when the exclusion filter changes.
      var portfolioBlank = portfolioXirrEl && portfolioXirrEl.textContent === "—";
      if (_benchmarkInitialRefreshDone && !_pendingBenchmarkRefresh && !portfolioBlank) return;
      _benchmarkInitialRefreshDone = true;
      _pendingBenchmarkRefresh = false;
      _lastBenchmarkHadSe = _seFlowsPresent();
      applyBenchmark(currentKey);
    });
    // Stocks/ETF cash flows resolve on their own async path (renderStockEtfHoldingsTable).
    // If the benchmark already ran WITHOUT them (SE finished after the overview's
    // first flows-ready), re-run it exactly once now that the SE leg is present —
    // otherwise the portfolio XIRR/alpha permanently omits the Stocks/ETF slice.
    document.addEventListener("wf-se-xirr-ready", function () {
      if (!_benchmarkInitialRefreshDone || _lastBenchmarkHadSe || !_seFlowsPresent()) return;
      var currentKey = localStorage.getItem(BENCH_KEY) || "NIFTY50";
      if (!currentKey) return;
      _lastBenchmarkHadSe = true;
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

      var invested, current, realizedProfit, priceUnavailable = false;
      if (isSold) {
        invested = 0;
        current = 0;
        realizedProfit = (buyPrice && sellPrice && grams > 0) ? (sellPrice - buyPrice) * grams : 0;
      } else {
        invested = (buyPrice && grams > 0) ? grams * buyPrice : 0;
        // No live rate: fall back to cost basis so the row still carries a value,
        // but flag it. Silently showing what you paid as what it is worth reads as
        // a real (and always exactly break-even) valuation.
        priceUnavailable = !goldPricePerGram && grams > 0;
        current = priceUnavailable ? invested : (grams > 0 ? grams * goldPricePerGram : 0);
        realizedProfit = 0;
      }

      holdings.push({ portfolio: portfolio, bank: category, instrument: instrument, subCategory: subCategory,
        invested: invested, current: current, grams: isSold ? 0 : grams,
        soldGrams: isSold ? grams : 0,
        soldInvested: (isSold && buyPrice && grams > 0) ? grams * buyPrice : 0,
        dateStr: dateStr, sellDateStr: sellDateStr, isSold: isSold, realizedProfit: realizedProfit,
        priceUnavailable: priceUnavailable });
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

    var selectedPortfolio = "all";
    statusEl.textContent = "Fetching gold prices…";

    // Collect unique buy + sell dates from commodity rows to fetch historical prices
    var uniqueDates = collectCommodityUniqueDates(rows, selectedPortfolio);
    var _hasCommCard = _hasCommodityRows(rows, selectedPortfolio);

    Promise.all([
      _hasCommCard ? fetchGoldPriceINRPerGram().catch(function () { return null; }) : Promise.resolve(null),
      _hasCommCard ? fetchGoldDayChangeINRPerGram().catch(function () { return null; }) : Promise.resolve(null),
      Promise.all(uniqueDates.map(function (dateStr) {
        return fetchXauInrForDate(dateStr).then(function (price) { return { dateStr: dateStr, price: price }; }).catch(function (e) { return { dateStr: dateStr, price: null }; });
      }))
    ]).then(function (results) {
      var goldPrice = results[0];
      var goldDayChangePerGram = results[1];
      var historicalPrices = {};
      results[2].forEach(function (r) { if (r.price) historicalPrices[r.dateStr] = r.price; });

      var allHoldings = buildCommodityHoldingsList(rows, selectedPortfolio, goldPrice, historicalPrices);
      dbg("[Commodity] holdings:", allHoldings);
      if (allHoldings === null) {
        statusEl.textContent = "Header row number is incorrect. Make adjustments by adding correct header row number.";
        tableWrap.hidden = true;
        return;
      }
      // Legacy table shows active (unsold) only; the card list handles Open/Closed.
      var holdings = allHoldings.filter(function (h) { return !h.isSold; });
      if (!allHoldings.length) {
        statusEl.textContent = "No Physical Commodity holdings found.";
        tableWrap.hidden = true;
        try { renderCmHoldingsCardList([], null, null, null); } catch (e) {}
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
      // Without a live rate every row is valued at cost, so the card would show a
      // flat 0% return that looks like real data. Say so instead.
      statusEl.textContent = allHoldings.some(function (h) { return h.priceUnavailable; })
        ? "Gold rate unavailable — showing cost basis, not current value."
        : "";
      tableWrap.hidden = true;
      try { renderCmHoldingsCardList(allHoldings, goldPrice, goldDayChangePerGram, rateDate); } catch (e) {}
    });
  }

  var COMH_STATE = { portfolio: "all", showClosed: false };
  function renderCmHoldingsCardList(allHoldings, goldPrice, dayChangePerGram, rateDate) {
    var list = document.getElementById("cmh-list");
    var eyebrow = document.getElementById("cmh-eyebrow");
    var asof = document.getElementById("cmh-gold-asof");
    var goldTop = document.getElementById("fi-gold-asof");
    if (!list) return;

    // Open / Closed (sold) toggle — mirrors the India/US & Fixed Income feature.
    var cmhOc = document.getElementById("cmh-open-closed");
    if (cmhOc && !cmhOc.dataset.bound) {
      cmhOc.dataset.bound = "1";
      cmhOc.querySelectorAll("[data-cmh-oc]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          COMH_STATE.showClosed = btn.dataset.cmhOc === "closed";
          cmhOc.querySelectorAll("[data-cmh-oc]").forEach(function (b) { b.classList.toggle("active", b === btn); });
          renderCommodityHoldingsTable();
        });
      });
    }
    // Portfolio pill toggle.
    var cmhPf = document.getElementById("cmh-portfolio-toggle");
    if (cmhPf) {
      var withGold = [];
      (allHoldings || []).forEach(function (h) {
        var pn = (h.portfolio || "").trim();
        if (pn && withGold.indexOf(pn) === -1) withGold.push(pn);
      });
      COMH_STATE.portfolio = _renderPortfolioPills(
        cmhPf, "data-cmh-portfolio", _allPortfolioNames(["fd"]), COMH_STATE.portfolio,
        function (p) { return withGold.indexOf(p) !== -1; });
      if (!cmhPf.dataset.bound) {
        cmhPf.dataset.bound = "1";
        cmhPf.addEventListener("click", function (ev) {
          var btn = ev.target.closest("[data-cmh-portfolio]");
          if (!btn || btn.disabled || btn.dataset.cmhPortfolio === COMH_STATE.portfolio) return;
          COMH_STATE.portfolio = btn.dataset.cmhPortfolio;
          renderCommodityHoldingsTable();
        });
      }
    }

    var freshness = goldRateFreshnessText();
    var asofText = rateDate
      ? "Gold rate as of " + rateDate + " · ₹" + Math.round(goldPrice).toLocaleString("en-IN") + "/g" + (freshness ? " · " + freshness : "")
      : "";
    if (asof) { asof.textContent = asofText; asof.style.color = _goldRateMeta.stale ? "#B45309" : ""; }
    if (goldTop) { goldTop.innerHTML = asofText ? "&#128337; " + asofText : ""; goldTop.style.color = _goldRateMeta.stale ? "#B45309" : ""; }

    // Same as the other holdings tables: work out what this portfolio has on each
    // side before splitting, so the pill can disable the empty one.
    var cmhScope = (allHoldings || []).filter(function (h) {
      return COMH_STATE.portfolio === "all" ||
        normalizeText(h.portfolio || "") === normalizeText(COMH_STATE.portfolio);
    });
    var cmhHasClosed = cmhScope.some(function (h) { return !!h.isSold; });
    var cmhHasOpen = cmhScope.some(function (h) { return !h.isSold; });
    if (COMH_STATE.showClosed && !cmhHasClosed && cmhHasOpen) COMH_STATE.showClosed = false;
    else if (!COMH_STATE.showClosed && !cmhHasOpen && cmhHasClosed) COMH_STATE.showClosed = true;
    _setOpenClosedPill(document.getElementById("cmh-open-closed"), COMH_STATE.showClosed, cmhHasClosed, cmhHasOpen);
    var holdings = cmhScope.filter(function (h) { return !!h.isSold === !!COMH_STATE.showClosed; });
    if (eyebrow) eyebrow.textContent = holdings.length ? ("HOLDINGS · " + holdings.length + (COMH_STATE.showClosed ? " CLOSED" : " OPEN")) : "";
    if (!holdings.length) {
      list.innerHTML = '<p class="muted small" style="padding:16px;text-align:center;">No ' + (COMH_STATE.showClosed ? "closed (sold)" : "open") + ' commodity holdings.</p>';
      return;
    }
    var header = '<div class="mfh-list-header" style="grid-template-columns: minmax(180px, 1.8fr) 0.9fr 0.8fr 0.8fr 0.9fr 0.9fr 0.9fr 0.8fr;">' +
      '<span>Instrument</span><span>Sub-Cat</span><span class="mfh-col-num">Rate</span><span class="mfh-col-num">Gms</span>' +
      '<span class="mfh-col-num">Invested</span><span class="mfh-col-num">Current</span><span class="mfh-col-num">Day Chg</span><span class="mfh-col-num">Return %</span></div>';
    var _subInv = 0, _subCur = 0, _subDay = 0, _subPnl = 0;
    var body = holdings.map(function (h, i) {
      var pal = { bg: "#FEF3C7", fg: "#B45309", accent: "amber" };
      // Closed (sold): show original cost as Invested, sale proceeds as Current, and
      // the realized gain as the P&L (Return %). Day change is N/A for a sold lot.
      var isClosed = !!h.isSold;
      var dispInvested = isClosed ? h.soldInvested : h.invested;
      var dispCurrent = isClosed ? (h.soldInvested + h.realizedProfit) : h.current;
      var dispGrams = isClosed ? h.soldGrams : h.grams;
      var pnl = isClosed ? h.realizedProfit : (h.current - h.invested);
      var pnlPct = dispInvested > 0 ? (pnl / dispInvested) * 100 : 0;
      var dayChg = isClosed ? 0 : ((dayChangePerGram || 0) * (h.grams || 0));
      var soldBadge = isClosed ? '<span class="mfh-sip-badge" style="background:var(--emerald,#1a9e6e);color:#fff;">SOLD</span>' : '';
      _subInv += dispInvested; _subCur += dispCurrent; _subDay += dayChg; _subPnl += pnl;
      return '<div class="mfh-row mfh-color-amber" style="grid-template-columns: minmax(180px, 1.8fr) 0.9fr 0.8fr 0.8fr 0.9fr 0.9fr 0.9fr 0.8fr;">' +
        '<div class="mfh-inst"><div class="mfh-avatar" style="background:' + pal.bg + ';color:' + pal.fg + ';">Au</div>' +
          '<div class="mfh-inst-body"><div class="mfh-inst-name">' + escapeHtml(h.instrument || "Gold") + soldBadge + '</div><div class="mfh-inst-sub">' + escapeHtml(h.portfolio || "—") + '</div></div></div>' +
        '<div><span class="mfh-sip-badge" style="background:' + pal.bg + ';color:' + pal.fg + ';">' + escapeHtml(h.subCategory || "Gold") + '</span></div>' +
        '<div class="mfh-col-num mfh-num-primary">₹' + Math.round(goldPrice || 0).toLocaleString("en-IN") + '</div>' +
        '<div class="mfh-col-num mfh-num-primary">' + (dispGrams || 0).toFixed(2) + '</div>' +
        '<div class="mfh-col-num mfh-num-primary">' + formatCurrency(dispInvested) + '</div>' +
        '<div class="mfh-col-num mfh-num-primary">' + formatCurrency(dispCurrent) + '</div>' +
        '<div class="mfh-col-num mfh-num-day ' + (Math.abs(dayChg) < 0.01 ? "mfh-muted" : (dayChg >= 0 ? "mfh-positive" : "mfh-negative")) + '">' + (Math.abs(dayChg) < 0.01 ? "—" : ((dayChg >= 0 ? "+" : "") + formatCurrency(dayChg))) + '</div>' +
        '<div class="mfh-col-num mfh-num-xirr ' + (pnlPct > 0 ? "" : pnlPct < 0 ? "mfh-negative" : "mfh-muted") + '">' + (pnlPct > 0 ? "+" : "") + pnlPct.toFixed(2) + '%</div>' +
      '</div>';
    }).join("");
    var _subPct = _subInv > 0 ? (_subPnl / _subInv) * 100 : 0;
    var footer = '<div class="mfh-row" style="grid-template-columns: minmax(180px, 1.8fr) 0.9fr 0.8fr 0.8fr 0.9fr 0.9fr 0.9fr 0.8fr;background:var(--bg);font-weight:700;border-radius:8px;padding:10px 6px;margin-top:6px;">' +
      '<div style="grid-column:span 4;font-size:0.55rem;letter-spacing:0.11em;text-transform:uppercase;color:var(--muted);">SUB-TOTAL · ' + holdings.length + ' HOLDINGS</div>' +
      '<div class="mfh-col-num mfh-num-primary">' + formatCurrency(_subInv) + '</div>' +
      '<div class="mfh-col-num mfh-num-primary">' + formatCurrency(_subCur) + '</div>' +
      '<div class="mfh-col-num mfh-num-day ' + (Math.abs(_subDay) < 0.01 ? "mfh-muted" : (_subDay >= 0 ? "mfh-positive" : "mfh-negative")) + '">' + (Math.abs(_subDay) < 0.01 ? "—" : ((_subDay >= 0 ? "+" : "") + formatCurrency(_subDay))) + '</div>' +
      '<div class="mfh-col-num mfh-num-xirr ' + (_subPct > 0 ? "mfh-positive" : _subPct < 0 ? "mfh-negative" : "mfh-muted") + '">' + (_subPct > 0 ? "+" : "") + _subPct.toFixed(2) + '%</div>' +
      '</div>';
    list.innerHTML = header + body + footer;
    try { applyHoldingsFold("cmh-list"); } catch (e) {}
  }

  // ── Stocks/ETF tab redesign ────────────────────────────────────────────
  // State is now per-region so India and US holdings tables filter/sort/toggle
  // independently of each other.
  // Open/Closed + sort state for the holdings tables. Declared HERE, alongside
  // SEH_STATE, rather than next to their renderers: `var` initialisers run in
  // source order while function declarations hoist, and renderEquityHoldingsTable
  // reads MFH_STATE during module init — from ABOVE the old declaration site, so it
  // saw undefined and threw whenever the first render had no holdings.
  var MFH_STATE = { showClosed: false, sort: "pnl-desc", portfolio: "all" };
  var DBTH_STATE = { showClosed: false, sort: "pnl-desc", portfolio: "all" };

  var SEH_STATE = {
    sort: { india: "pnl-desc", us: "pnl-desc" },
    portfolio: { india: "all", us: "all" },
    showClosed: { india: false, us: false }
  };
  var SE_AVATAR_PALETTE = [
    { bg: "#D1FAE5", fg: "#065F46", accent: "green" },
    { bg: "#FEF3C7", fg: "#B45309", accent: "amber" },
    { bg: "#DBEAFE", fg: "#1E40AF", accent: "blue" },
    { bg: "#EDE9FE", fg: "#5B21B6", accent: "purple" },
    { bg: "#FCE7F3", fg: "#9D174D", accent: "red" },
    { bg: "#CFFAFE", fg: "#0E7490", accent: "teal" }
  ];
  function _seInit(name) { var p = String(name || "").trim().split(/\s+/); return p[0] ? p[0].charAt(0).toUpperCase() : "?"; }
  function _seShortCode(name) {
    if (!name) return "SE";
    var w = String(name).replace(/[^\w\s]/g, " ").trim().split(/\s+/).filter(Boolean);
    if (w.length >= 3) return (w[0].charAt(0) + w[1].charAt(0) + w[2].charAt(0)).toUpperCase();
    if (w.length === 2) return (w[0].substring(0, 2) + w[1].charAt(0)).toUpperCase();
    return w[0].substring(0, 3).toUpperCase();
  }

  // Build one rowsData row per (portfolio × instrument) by running the same
  // pricing math as the outer overview flow, but with buildStockHoldings
  // called PER portfolio (so FIFO doesn't mix Snnehal's SILVERBEES with
  // Trisha's SILVERBEES).
  function _buildPerPortfolioSeRowsData(rows, mappingTable, allPrices, usdInrHistMap, usdInrToday) {
    if (!rows) return Promise.resolve([]);
    var portfolios = collectPortfolioNamesFromSheets(["stocksetf"]) || [];
    if (!portfolios.length) return Promise.resolve([]);
    return Promise.all(portfolios.map(function (p) {
      return Promise.all([
        buildStockHoldings(rows, mappingTable, p, false), // open
        buildStockHoldings(rows, mappingTable, p, true)   // closed
      ]).then(function (results) {
        var open = results[0] || [], closed = results[1] || [];
        var all = open.concat(closed);
        return all.map(function (h) {
          var isClosed = (h.units || 0) < UNITS_EPSILON;
          var priceEntry = allPrices[h.ticker] || null;
          var eodRaw = priceEntry ? priceEntry.price : null;
          var prevRaw = priceEntry ? priceEntry.prev_close : null;
          var ltpINR = null, currentINR = null, dayChangeINR = null, pnl = null, pnlPct = null;
          var investedForDisplay = h.investedINR;
          var avgCostForDisplay = h.avgCostINR;
          // Native-currency (USD) figures for US rows — shown under the INR values.
          var isUs = h.region === "US";
          var investedUSD = isUs ? (h.investedNative || 0) : null;
          var currentUSD = null;
          var ltpUSD = null;
          var avgCostUSD = (isUs && h.units > UNITS_EPSILON) ? (h.investedNative || 0) / h.units : null; // native USD avg cost
          if (isClosed) {
            var detail = computeInstrumentRealizedDetail(h.txns || []);
            if (h.region === "US") {
              var sellDateStr = detail.lastSellDate ? formatDateISO(detail.lastSellDate) : null;
              var sellRate = (sellDateStr && usdInrHistMap[sellDateStr]) ? usdInrHistMap[sellDateStr] : usdInrToday;
              ltpINR = detail.lastSellPrice * sellRate;
              currentINR = detail.saleProceeds * sellRate;
              investedForDisplay = detail.costOfSoldUnits * sellRate;
              avgCostForDisplay = detail.avgBuyCost * sellRate;
              investedUSD = detail.costOfSoldUnits; // native USD cost of sold units
              currentUSD = detail.saleProceeds;     // native USD proceeds
              ltpUSD = detail.lastSellPrice;        // native USD last traded price
              avgCostUSD = detail.avgBuyCost;       // native USD avg cost
            } else {
              ltpINR = detail.lastSellPrice;
              currentINR = detail.saleProceeds;
              investedForDisplay = detail.costOfSoldUnits;
              avgCostForDisplay = detail.avgBuyCost;
            }
            pnl = currentINR - investedForDisplay;
            pnlPct = investedForDisplay > 0 ? (pnl / investedForDisplay) * 100 : null;
          } else if (eodRaw !== null) {
            ltpINR = h.region === "US" ? eodRaw * usdInrToday : eodRaw;
            currentINR = h.units * ltpINR;
            if (isUs) { currentUSD = h.units * eodRaw; ltpUSD = eodRaw; } // native USD current + LTP
            pnl = currentINR - h.investedINR;
            pnlPct = h.investedINR > 0 ? (pnl / h.investedINR) * 100 : null;
            if (prevRaw !== null) {
              var prevINR = h.region === "US" ? prevRaw * usdInrToday : prevRaw;
              dayChangeINR = (ltpINR - prevINR) * h.units;
            }
          }
          // Per-holding XIRR, same method as the Mutual Fund list: this
          // instrument's own flows for THIS portfolio, plus its current value as
          // a terminal inflow. US legs convert at each transaction's own USD/INR
          // rate so the currency move is part of the return.
          //
          // This was previously hardcoded to null here, which is why the India
          // and US lists showed a dash on every row: the figure was computed in
          // the other builder, but these lists are fed by this one.
          var xirrFlows = [];
          if (h.region === "US") {
            (h.txns || []).forEach(function (txn) {
              if (!txn.date || !txn.units || !txn.price) return;
              var rateForDate = usdInrHistMap[formatDateISO(txn.date)] || usdInrToday;
              var amountINR = txn.units * txn.price * rateForDate;
              xirrFlows.push({ date: txn.date, amount: txn.type === "buy" ? -amountINR : amountINR });
            });
          } else {
            xirrFlows = buildXirrCashFlows(rows, p, h.instrument);
          }
          // A closed position is already valued by its proceeds; adding a
          // terminal for a holding that no longer exists would double count it.
          if (!isClosed && currentINR !== null && currentINR > UNITS_EPSILON) {
            xirrFlows.push({ date: new Date(), amount: currentINR });
          }
          var xirrVal = calculateXIRR(xirrFlows);
          var xirrPct = (xirrVal === null || xirrVal === undefined || !isFinite(xirrVal)) ? null : xirrVal * 100;

          return {
            instrument: h.instrument,
            region: h.region,
            units: h.units,
            avgCostINR: avgCostForDisplay,
            ltpINR: ltpINR,
            investedINR: investedForDisplay,
            currentINR: currentINR,
            investedUSD: investedUSD,
            currentUSD: currentUSD,
            ltpUSD: ltpUSD,
            avgCostUSD: avgCostUSD,
            dayChangeINR: dayChangeINR,
            pnl: pnl,
            pnlPct: pnlPct,
            xirrPct: xirrPct,
            isClosed: isClosed,
            _portfolio: p,
            // This is the builder that feeds the India/US card lists (the other
            // one serves the legacy table). Merging one instrument across
            // portfolios recomputes XIRR from the combined flows, so they have to
            // travel on the row — without them the merged row has no XIRR to show.
            _xirrFlows: xirrFlows
          };
        });
      });
    })).then(function (perPortfolioArrays) {
      var flat = [];
      perPortfolioArrays.forEach(function (arr) { arr.forEach(function (r) { flat.push(r); }); });
      return flat;
    });
  }

  // One row per (portfolio x debt instrument) from the Mutual Fund transaction
  // sheet, using the NAV history already fetched for that instrument. Same maths as
  // the Mutual Fund rows; the difference is only that the grouping is per portfolio,
  // which is what lets the Debt table carry its own portfolio filter.
  function _buildDebtRowsPerPortfolio(rows, navByInst, isDebt) {
    return _buildEquityRowsPerPortfolio(rows, navByInst, isDebt);
  }

  // Same, for any subset of the equity sheet. `include(instrument)` picks which
  // instruments to emit, so the Mutual Fund and Debt tables are two filters over one
  // build rather than two pipelines.
  function _buildEquityRowsPerPortfolio(rows, navByInst, isDebt) {
    var out = [];
    if (!rows || rows.length < 2) return out;
    var portfolios = collectPortfolioNamesFromRows(rows) || [];
    portfolios.forEach(function (portfolio) {
      var byInst = groupUnitTransactionsByInstrument(rows, portfolio);
      if (!byInst) return;
      Object.keys(byInst).forEach(function (instrument) {
        if (!isDebt(instrument)) return;
        var lots = fifoRemainingLots(byInst[instrument]);
        var units = 0, investedCost = 0;
        lots.forEach(function (l) { units += l.units; investedCost += l.units * l.price; });
        var hist = navByInst[instrument] || [];
        var isClosed = units < 1;
        var currNav, current, invested, pnl, pnlPct, dayChgPct;
        if (isClosed) {
          var detail = computeInstrumentRealizedDetail(byInst[instrument]);
          // A portfolio with no transactions for this instrument contributes nothing.
          if (!detail || !detail.costOfSoldUnits) return;
          currNav = detail.lastSellPrice;
          current = detail.saleProceeds;
          invested = detail.costOfSoldUnits;
          pnl = detail.realizedPnl;
          pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
          dayChgPct = 0;
        } else {
          var latest = hist.length ? hist[hist.length - 1] : null;
          var prev = hist.length > 1 ? hist[hist.length - 2] : null;
          // No NAV (unmapped, or the fetch failed): value at cost, matching the
          // fallback the Overview already uses, rather than dropping the holding.
          currNav = latest ? latest.nav : (units > 0 ? investedCost / units : 0);
          current = units * currNav;
          invested = investedCost;
          pnl = current - invested;
          pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
          dayChgPct = (latest && prev && prev.nav) ? ((latest.nav - prev.nav) / prev.nav) * 100 : 0;
        }
        var flows = buildXirrCashFlows(rows, portfolio, instrument);
        if (!isClosed && current > UNITS_EPSILON) flows.push({ date: new Date(), amount: current });
        var x = calculateXIRR(flows);
        out.push({
          instrument: instrument, units: units, avgNav: units > 0 ? investedCost / units : 0,
          currNav: currNav, invested: invested, current: current, pnl: pnl, pnlPct: pnlPct,
          dayChgPct: dayChgPct, xirrPct: (x == null || !isFinite(x)) ? null : x * 100,
          _portfolio: portfolio,
          // Kept so that merging one instrument across portfolios can recompute a
          // real XIRR from the combined flows. Averaging the per-portfolio XIRRs
          // would be wrong — XIRR is not additive.
          _xirrFlows: flows
        });
      });
    });
    return out;
  }

  // Debt ETF/Mutual Fund: debt funds from the equity sheet plus debt ETFs from the
  // Stocks/ETF sheet, normalised onto the Mutual Fund row shape so the shared
  // renderer can draw them side by side.
  function renderDebtHoldings() {
    var statusEl = document.getElementById("dbth-status");
    var mfRows = window.__mfDebtRows || [];
    var seRows = (window.__seDebtRows || []).map(function (r) {
      return {
        instrument: r.instrument,
        units: r.units,
        _portfolio: r._portfolio || "",
        // The list prints avg cost and LTP as ₹ figures, so US rows use their
        // INR values here rather than native USD — otherwise a $ amount would
        // render behind a ₹ sign.
        avgNav: r.avgCostINR || 0,
        currNav: r.ltpINR,
        invested: r.investedINR || 0,
        current: r.currentINR || 0,
        pnl: r.pnl || 0,
        pnlPct: r.pnlPct || 0,
        // The shared renderer works in day-change PERCENT and re-derives the
        // rupee figure from it; the SE rows carry rupees, so convert.
        dayChgPct: (r.dayChangeINR != null && r.currentINR && (r.currentINR - r.dayChangeINR) > 0)
          ? (r.dayChangeINR / (r.currentINR - r.dayChangeINR)) * 100 : null,
        dayChgINR: r.dayChangeINR != null ? r.dayChangeINR : null,
        xirrPct: r.xirrPct
      };
    });
    var all = mfRows.concat(seRows);

    // The portfolio pill and the open/closed filter are applied by the shared
    // renderer below, so this table behaves exactly like the others.
    var pfBox = document.getElementById("dbth-portfolio-toggle");
    if (pfBox && !pfBox.dataset.bound) {
      pfBox.dataset.bound = "1";
      pfBox.addEventListener("click", function (ev) {
        var btn = ev.target.closest("[data-dbth-portfolio]");
        if (!btn || btn.disabled || btn.dataset.dbthPortfolio === DBTH_STATE.portfolio) return;
        DBTH_STATE.portfolio = btn.dataset.dbthPortfolio;
        renderDebtHoldings();
      });
    }

    if (statusEl) {
      statusEl.textContent = all.length
        ? ""
        : "No debt funds or ETFs found. Mark an instrument's Instrument Category as \"Fixed Income\" in the Mutual Fund or Stocks/ETF mapping sheet.";
    }
    try {
      renderMfHoldingsCardList(all, {
        listId: "dbth-list", eyebrowId: "dbth-eyebrow", state: DBTH_STATE,
        toggleId: "dbth-open-toggle"
      });
    } catch (e) {}
    // The debt rows arrive from the MF/Stocks-ETF pipelines, which finish after
    // the Fixed Income tab has drawn. Repaint the FI cards/allocation/split now
    // that these holdings exist, otherwise they'd report only FD/PF.
    try { renderFiRedesign(_buildAllFixedIncomeHoldingsList()); } catch (e) {}
  }

  function renderStocksEtfRedesign(rowsData, usdInrToday) {
    // Debt ETFs belong to Debt ETF/Mutual Fund, not the India/US equity lists — an
    // instrument must appear in exactly one holdings table or its value reads
    // twice. Split before anything downstream consumes these rows.
    var _seCat = buildInstrumentTopCategoryMap();
    window.__seDebtRows = rowsData.filter(function (r) {
      return normalizeText(_seCat[normalizeText(r.instrument || "")] || "") === "fixed income";
    });
    rowsData = rowsData.filter(function (r) {
      return normalizeText(_seCat[normalizeText(r.instrument || "")] || "") !== "fixed income";
    });
    try { renderDebtHoldings(); } catch (e) {}
    // Portfolio Cards / Geography / Market-cap panels ALWAYS reflect the
    // OPEN positions regardless of the Open/Closed toggle. Holdings lists
    // filter independently per region below.
    var openOnly = rowsData.filter(function (r) { return !((r.units || 0) < UNITS_EPSILON || r.isClosed); });
    // Enrich each holding with its portfolio ONLY if it wasn't already tagged
    // upstream (e.g. by _buildPerPortfolioSeRowsData). This preserves proper
    // per-(portfolio × instrument) attribution.
    var seRows = getSheetRows("stocksetf");
    if (seRows && seRows.length) {
      var hdr = seRows[0].map(normalizeText);
      var pI = hdr.indexOf("portfolio name");
      var iI = hdr.indexOf("instrument name");
      if (pI !== -1 && iI !== -1) {
        var pByI = {};
        seRows.slice(1).forEach(function (row) {
          var name = (row[iI] || "").trim();
          if (name && !pByI[name]) pByI[name] = (row[pI] || "").trim();
        });
        rowsData.forEach(function (h) { if (!h._portfolio) h._portfolio = pByI[h.instrument] || ""; });
      }
    }
    window.__seLastOpenRowsData = openOnly;
    renderSePortfolioCards(openOnly);
    renderSeAllocation(openOnly);
    renderSeMarketCapSplit(openOnly);
    _wireSeHoldingsPortfolioToggle(rowsData, usdInrToday);
    renderSeHoldingsCardList(rowsData, "india");
    renderSeHoldingsCardList(rowsData, "us", usdInrToday);
  }

  // Latest rows for the delegated portfolio-pill handlers (bound once, but a click
  // must re-render from the newest data, not from whatever was in scope at wiring).
  var _seWiredRows = { rowsData: [], usdInrToday: null };
  function _wireSeHoldingsPortfolioToggle(rowsData, usdInrToday) {
    var seRows = getSheetRows("stocksetf");
    if (!seRows) return;
    // The delegated handlers below are bound once but must re-render from the
    // LATEST rows, so the current ones are parked here on every call.
    _seWiredRows = { rowsData: rowsData, usdInrToday: usdInrToday };
    // Each region's toggle updates only its own state and re-renders only its list.
    [
      { id: "seh-portfolio-toggle", region: "india" },
      { id: "seh-us-portfolio-toggle", region: "us" }
    ].forEach(function (spec) {
      var el = document.getElementById(spec.id);
      if (!el) return;
      // The pills themselves are painted by renderSeHoldingsCardList; this only
      // binds the (delegated) handler once.
      if (!el.dataset.bound) {
        el.dataset.bound = "1";
        el.addEventListener("click", function (ev) {
          var btn = ev.target.closest("[data-seh-portfolio]");
          if (!btn || btn.disabled || btn.dataset.sehPortfolio === SEH_STATE.portfolio[spec.region]) return;
          SEH_STATE.portfolio[spec.region] = btn.dataset.sehPortfolio;
          renderSeHoldingsCardList(_seWiredRows.rowsData, spec.region, _seWiredRows.usdInrToday);
        });
      }
    });
  }

  function renderSePortfolioCards(rowsData) {
    var row = document.getElementById("sepc-row");
    if (!row) return;
    var rows = getSheetRows("stocksetf");
    if (!rows) { row.innerHTML = ""; return; }
    // rowsData already excludes Fixed Income holdings; drop those transactions
    // too so the card's XIRR is computed over the same population as its value.
    var xirrRows = excludeFixedIncomeRows(rows);
    // Map instrument → portfolio (first occurrence in transactions).
    var header = rows[0].map(normalizeText);
    var pIdx = header.indexOf("portfolio name");
    var iIdx = header.indexOf("instrument name");
    var portfolioByInst = {};
    if (pIdx !== -1 && iIdx !== -1) {
      rows.slice(1).forEach(function (r) {
        var name = (r[iIdx] || "").trim();
        if (!name || portfolioByInst[name]) return;
        portfolioByInst[name] = (r[pIdx] || "").trim();
      });
    }
    // Seed byPort with every portfolio that appears in the sheet — so cards
    // still render for portfolios whose positions are all closed.
    // Seeded from the debt-filtered sheet: a portfolio holding only Fixed Income
    // instruments has no Stocks/ETF position, so it gets no card here.
    var byPort = {};
    (collectPortfolioNamesFromRows(xirrRows) || []).forEach(function (p) {
      byPort[p] = { invested: 0, current: 0, india: 0, us: 0, day: 0 };
    });
    rowsData.forEach(function (h) {
      var p = h._portfolio || portfolioByInst[h.instrument] || "Unassigned";
      if (!byPort[p]) byPort[p] = { invested: 0, current: 0, india: 0, us: 0, day: 0 };
      byPort[p].invested += h.investedINR || 0;
      byPort[p].current += h.currentINR || 0;
      byPort[p].day += h.dayChangeINR || 0;
      if (h.region === "US") byPort[p].us += h.currentINR || 0;
      else byPort[p].india += h.currentINR || 0;
    });
    var names = Object.keys(byPort).sort(function (a, b) { return byPort[b].current - byPort[a].current; });
    if (!names.length) { row.innerHTML = ""; return; }
    var combined = { invested: 0, current: 0, india: 0, us: 0, day: 0 };
    names.forEach(function (n) { combined.invested += byPort[n].invested; combined.current += byPort[n].current; combined.india += byPort[n].india; combined.us += byPort[n].us; combined.day += byPort[n].day; });
    var namedList = names.map(function (n) { var p = byPort[n]; p.name = n; return p; });
    var all = [{ name: "Combined", invested: combined.invested, current: combined.current, india: combined.india, us: combined.us, day: combined.day, isCombined: true }].concat(namedList);

    row.innerHTML = all.map(function (p, i) {
      var pnl = p.current - p.invested;
      var pnlPct = p.invested > 0 ? (pnl / p.invested) * 100 : 0;
      var pal = p.isCombined ? { bg: "#23211D", fg: "#fff" } : SE_AVATAR_PALETTE[i % 3];
      var initial = p.isCombined ? "Σ" : _seInit(p.name);
      var subtitle = p.isCombined ? "HOUSEHOLD TOTAL" : "PERSONAL PORTFOLIO";
      var totalCur = p.india + p.us;
      var iPct = totalCur > 0 ? Math.round(p.india / totalCur * 100) : 0;
      var uPct = totalCur > 0 ? Math.round(p.us / totalCur * 100) : 0;
      // Day change + day change % (vs previous close). prevVal = current − dayChange.
      var dayChg = p.day || 0;
      var prevVal = p.current - dayChg;
      var dayPct = prevVal > 0 ? (dayChg / prevVal) * 100 : 0;
      var dayNeg = dayChg < 0;
      var dayChgHtml = '<div class="mfpc-daychange ' + (dayNeg ? "mfpc-negative" : "") + '">' +
        '<span class="mfpc-daychange-label">DAY CHANGE</span>' +
        '<span class="mfpc-daychange-value">' + (dayNeg ? "" : "+") + formatCurrency(dayChg) +
          ' <span class="mfpc-daychange-pct">(' + (dayNeg ? "" : "+") + dayPct.toFixed(2) + '%)</span></span>' +
      '</div>';
      // XIRR
      var xirrPct = null;
      try {
        var flows = buildXirrCashFlows(xirrRows, p.isCombined ? "all" : p.name) || [];
        if (p.current > 0) flows.push({ date: new Date(), amount: p.current });
        var x = calculateXIRR(flows);
        if (x != null && isFinite(x)) xirrPct = x * 100;
      } catch (e) {}
      return '<div class="mfpc-card ' + (p.isCombined ? "mfpc-combined" : "") + '">' +
        '<div class="mfpc-head">' +
          '<div class="mfpc-avatar" style="background:' + pal.bg + ';color:' + pal.fg + ';">' + initial + '</div>' +
          '<div class="mfpc-name-block"><div class="mfpc-name">' + escapeHtml(p.name) + '</div><div class="mfpc-subtitle">' + subtitle + '</div></div>' +
        '</div>' +
        '<div class="mfpc-current-label">CURRENT VALUE</div>' +
        '<div class="mfpc-current-row">' +
          '<div class="mfpc-current-value"' + _crTitle(p.current) + '>' + formatCurrency(p.current) + '</div>' +
          dayChgHtml +
        '</div>' +
        _mfpcBarHtml() +
        _mfpcReturnRowHtml(pnl, pnlPct) +
        '<div class="mfpc-footer">' +
          '<div class="mfpc-foot-item"><span class="mfpc-foot-label">Invested</span><span class="mfpc-foot-value">' + formatCurrency(p.invested) + '</span></div>' +
          '<div class="mfpc-foot-item"><span class="mfpc-foot-label">XIRR</span><span class="mfpc-foot-value mfpc-xirr ' + (xirrPct != null && xirrPct < 0 ? "mfpc-negative" : "") + '">' + (xirrPct == null ? "—" : (xirrPct >= 0 ? "+" : "") + xirrPct.toFixed(2) + "%") + '</span></div>' +
          '<div class="mfpc-foot-item"><span class="mfpc-foot-label">India · US</span><span class="mfpc-foot-value"><span style="color:#10B981;">' + iPct + '%</span> · <span style="color:#E8623A;">' + uPct + '%</span></span></div>' +
        '</div>' +
      '</div>';
    }).join("");
  }

  function renderSeAllocation(rowsData) {
    var listEl = document.getElementById("sealloc-list");
    if (!listEl) return;
    var india = 0, us = 0, iCount = 0, uCount = 0;
    rowsData.forEach(function (h) {
      if (h.region === "US") { us += h.currentINR || 0; uCount++; }
      else { india += h.currentINR || 0; iCount++; }
    });
    var total = india + us;
    if (total <= 0) { listEl.innerHTML = '<p class="muted small">No allocation data.</p>'; return; }
    var iPct = india / total * 100, uPct = us / total * 100;
    var bar = '<div class="mfalloc-single-bar">' +
      '<span class="mfalloc-seg" style="flex:' + iPct + ' 0 0;background:#10B981;"></span>' +
      '<span class="mfalloc-seg" style="flex:' + uPct + ' 0 0;background:#E8623A;"></span>' +
      '</div>';
    var rows = '<div class="mfalloc-row"><span class="mfalloc-name"><span class="mfalloc-dot" style="background:#10B981;"></span>India <span class="muted" style="font-weight:500;">· ' + iCount + ' holdings</span></span><span class="mfalloc-nums"><span class="mfalloc-amount">' + formatCurrency(india) + '</span><span class="mfalloc-pct" style="color:#10B981;">' + iPct.toFixed(1) + '%</span></span></div>' +
      '<div class="mfalloc-row"><span class="mfalloc-name"><span class="mfalloc-dot" style="background:#E8623A;"></span>US <span class="muted" style="font-weight:500;">· ' + uCount + ' holdings</span></span><span class="mfalloc-nums"><span class="mfalloc-amount">' + formatCurrency(us) + '</span><span class="mfalloc-pct" style="color:#E8623A;">' + uPct.toFixed(1) + '%</span></span></div>';
    listEl.innerHTML = bar + '<div class="mfalloc-rows">' + rows + '</div>';
  }

  var SECAP_STATE = { mode: "marketcap" };
  function renderSeMarketCapSplit(rowsData) {
    var bar = document.getElementById("secap-bar");
    var rows = document.getElementById("secap-rows");
    var eyebrow = document.getElementById("secap-eyebrow");
    if (!bar || !rows) return;
    if (SECAP_STATE.mode === "portfolio") {
      if (eyebrow) eyebrow.textContent = "PORTFOLIO SPLIT · MARKET-CAP";
      var mappingP = buildStockMappingTable();
      function _capOf(h) {
        var m = mappingP[normalizeText(h.instrument)];
        if (!m) return null;
        var cat = normalizeText(m.category || "");
        if (cat.indexOf("etf") !== -1) return null;
        var seg = String((m.segment || "") + " " + (m.subCat || "") + " " + (m.category || "")).toLowerCase();
        if (seg.indexOf("large") !== -1) return "Large-cap";
        if (seg.indexOf("mid") !== -1) return "Mid-cap";
        if (seg.indexOf("small") !== -1) return "Small-cap";
        return null;
      }
      var CAP_COL = { "Large-cap": "#E8623A", "Mid-cap": "#D4A017", "Small-cap": "#10B981" };
      var byPort = {}; // { portfolio: { total, caps: {Large-cap, Mid-cap, Small-cap} } }
      rowsData.forEach(function (h) {
        var p = h._portfolio || "Unassigned";
        var cap = _capOf(h);
        if (!cap) return; // ETFs / unclassified skipped for market-cap breakdown
        if (!byPort[p]) byPort[p] = { total: 0, caps: { "Large-cap": 0, "Mid-cap": 0, "Small-cap": 0 } };
        byPort[p].caps[cap] += h.currentINR || 0;
        byPort[p].total += h.currentINR || 0;
      });
      var entries = Object.keys(byPort).map(function (k) { return { name: k, total: byPort[k].total, caps: byPort[k].caps }; })
        .filter(function (e) { return e.total > 0.01; })
        .sort(function (a, b) { return b.total - a.total; });
      var grand = entries.reduce(function (s, e) { return s + e.total; }, 0);
      if (!entries.length || grand <= 0) { bar.innerHTML = ""; rows.innerHTML = '<p class="muted small">No portfolio-level market-cap data.</p>'; return; }
      var PORT_PAL = ["#10B981", "#F59E0B", "#3B82F6", "#8B5CF6", "#06B6D4", "#EC4899", "#84CC16", "#6366F1"];
      bar.innerHTML = entries.map(function (e, i) {
        var pct = (e.total / grand) * 100;
        return '<span class="mfalloc-seg" style="flex:' + pct + ' 0 0;background:' + PORT_PAL[i % PORT_PAL.length] + ';" title="' + escapeHtml(e.name) + '"></span>';
      }).join("");
      rows.innerHTML = entries.map(function (e, i) {
        var pct = (e.total / grand) * 100;
        var col = PORT_PAL[i % PORT_PAL.length];
        // Per-portfolio market-cap chips underneath the row.
        var chips = ["Large-cap", "Mid-cap", "Small-cap"].filter(function (k) { return e.caps[k] > 0.01; })
          .map(function (k) {
            var kpct = (e.caps[k] / e.total) * 100;
            return '<span class="isc-cat-chip"><span class="isc-cat-dot" style="background:' + CAP_COL[k] + '"></span>' + k + ' ' + Math.round(kpct) + '%</span>';
          }).join("");
        return '<div class="mfalloc-row" style="flex-direction:column;align-items:stretch;gap:4px;padding:8px 0;">' +
          '<div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;">' +
            '<span class="mfalloc-name"><span class="mfalloc-dot" style="background:' + col + ';"></span>' + escapeHtml(e.name) + '</span>' +
            '<span class="mfalloc-nums">' +
              '<span class="mfalloc-amount">' + formatCurrency(e.total) + '</span>' +
              '<span class="mfalloc-pct" style="color:' + col + ';">' + Math.round(pct) + '%</span>' +
            '</span>' +
          '</div>' +
          (chips ? '<div class="isc-cat-sub">' + chips + '</div>' : '') +
        '</div>';
      }).join("");
      return;
    }
    if (eyebrow) eyebrow.textContent = "MARKET-CAP SPLIT · DIRECT EQUITY";
    var mapping = buildStockMappingTable();
    var byCap = { "Large-cap": 0, "Mid-cap": 0, "Small-cap": 0 };
    // Instrument Category behind each cap bucket, so a holding mapped to
    // something other than Equity is visible rather than being read as equity
    // purely because it sits in a market-cap row. Same column the mapping sheet
    // already supplies for this card.
    var capCats = { "Large-cap": {}, "Mid-cap": {}, "Small-cap": {} };
    rowsData.forEach(function (h) {
      var m = mapping[normalizeText(h.instrument)];
      if (!m) return;
      var cat = normalizeText(m.category || "");
      if (cat.indexOf("etf") !== -1) return;
      var seg = String((m.segment || "") + " " + (m.subCat || "") + " " + (m.category || "")).toLowerCase();
      var key = seg.indexOf("large") !== -1 ? "Large-cap"
        : seg.indexOf("mid") !== -1 ? "Mid-cap"
        : seg.indexOf("small") !== -1 ? "Small-cap" : null;
      if (key) {
        byCap[key] += h.currentINR || 0;
        var tc = (m.category || "").trim();
        if (tc) capCats[key][tc] = (capCats[key][tc] || 0) + (h.currentINR || 0);
      }
    });
    // A bucket can mix categories; list them largest first rather than showing
    // one and hiding the others.
    function capCatLabel(k) {
      var m = capCats[k];
      if (!m) return "";
      return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; }).join(" · ");
    }
    var total = byCap["Large-cap"] + byCap["Mid-cap"] + byCap["Small-cap"];
    if (total <= 0) { bar.innerHTML = ""; rows.innerHTML = '<p class="muted small">No market-cap data. Expected values like "Large Cap" / "Mid Cap" / "Small Cap" in the Market Segment column of the Stocks/ETF mapping sheet.</p>'; return; }
    var COL = { "Large-cap": "#E8623A", "Mid-cap": "#D4A017", "Small-cap": "#10B981" };
    bar.innerHTML = ["Large-cap", "Mid-cap", "Small-cap"].map(function (k) {
      var pct = byCap[k] / total * 100;
      return '<span class="mfalloc-seg" style="flex:' + pct + ' 0 0;background:' + COL[k] + ';"></span>';
    }).join("");
    rows.innerHTML = ["Large-cap", "Mid-cap", "Small-cap"].map(function (k) {
      var pct = byCap[k] / total * 100;
      var capLabel = capCatLabel(k);
      return '<div class="mfalloc-row">' +
        '<span class="mfalloc-name"><span class="mfalloc-dot" style="background:' + COL[k] + ';"></span>' + k +
          (capLabel ? '<span class="mfalloc-cat">' + escapeHtml(capLabel) + '</span>' : '') + '</span>' +
        '<span class="mfalloc-nums">' +
          '<span class="mfalloc-amount">' + formatCurrency(byCap[k]) + '</span>' +
          '<span class="mfalloc-pct" style="color:' + COL[k] + ';">' + Math.round(pct) + '%</span>' +
        '</span>' +
      '</div>';
    }).join("");
  }

  // Wire the Market-cap / Portfolio toggle on the Stocks/ETF split card.
  (function wireSecapToggle() {
    var card = document.getElementById("secap-card");
    if (!card) return;
    var buttons = card.querySelectorAll("[data-secap-mode]");
    if (!buttons.length) return;
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        SECAP_STATE.mode = btn.dataset.secapMode;
        buttons.forEach(function (b) { b.classList.toggle("active", b === btn); });
        // Always fully re-render the SE tab — that path guarantees the split
        // card is redrawn with the current mode, cache-free.
        renderStockEtfHoldingsTable();
      });
    });
  })();

  function _sehSortCompare(a, b, key) {
    var av, bv;
    switch (key) {
      case "instrument": av = String(a.instrument || "").toLowerCase(); bv = String(b.instrument || "").toLowerCase(); return av < bv ? -1 : av > bv ? 1 : 0;
      case "invested": return (a.investedINR || 0) - (b.investedINR || 0);
      case "current": return (a.currentINR || 0) - (b.currentINR || 0);
      case "ltp": return (a.ltpINR || 0) - (b.ltpINR || 0);
      case "pnl": return (a.pnl || 0) - (b.pnl || 0);
      case "day": return (a.dayChangeINR || 0) - (b.dayChangeINR || 0);
      // Unrated holdings sort to the bottom rather than counting as 0%, which
      // would place them among genuine flat performers.
      case "xirr": return (a.xirrPct == null ? -Infinity : a.xirrPct) - (b.xirrPct == null ? -Infinity : b.xirrPct);
    }
    return 0;
  }
  // Does this region/portfolio have any open, and any fully-closed, position?
  // Answered by replaying FIFO over the transaction sheet — no prices needed, which
  // is why this can run before (or instead of) the priced holdings build. Debt
  // instruments are excluded: they belong to Debt ETF/Mutual Fund Holding, which has its
  // own pill.
  function _seOpenClosedAvailability(region, portfolioFilter) {
    var out = { open: false, closed: false };
    var rows = getSheetRows("stocksetf");
    if (!rows || rows.length < 2) return out;
    var mapping = buildStockMappingTable();
    var catMap = buildInstrumentTopCategoryMap();
    var byInst = groupUnitTransactionsByInstrument(rows, portfolioFilter || "all");
    if (!byInst) return out;
    Object.keys(byInst).forEach(function (inst) {
      var m = mapping[normalizeText(inst)];
      if (!m) return;
      if (isFixedIncomeInstrument(inst, catMap)) return;
      var isUS = String(m.region || "").trim() === "US";
      if ((region === "us") !== isUS) return;
      var units = fifoRemainingLots(byInst[inst]).reduce(function (t, l) { return t + l.units; }, 0);
      if (units < UNITS_EPSILON) out.closed = true; else out.open = true;
    });
    return out;
  }

  // A holding's share of the invested total currently on screen. The base is
  // whatever the list is showing, so switching portfolio or Open/Closed re-scales
  // every row and the column still reads 100%. Sub-1% holdings keep a decimal
  // rather than collapsing to "0%".
  function _investedSharePct(invested, total) {
    if (!(total > 0) || invested == null || !isFinite(invested)) return "—";
    var pc = (invested / total) * 100;
    return (pc > 0 && pc < 1 ? pc.toFixed(1) : String(Math.round(pc))) + "%";
  }

  // Collapse one instrument held in several portfolios into a single row.
  //
  // Viewing "All" used to list the same fund once per portfolio, so a holding
  // split across two portfolios read as two unrelated positions and neither row
  // showed what was actually held. Amounts and units add up; the per-unit figures
  // are re-derived from the merged totals (a plain average of two average costs
  // is wrong whenever the two portfolios hold different quantities); and XIRR is
  // recomputed from the combined cash flows, because a rate of return is not
  // additive and cannot be averaged either.
  //
  // Only called when the portfolio filter is "all" — a specific portfolio has
  // nothing to merge — and always AFTER the open/closed filter, so an instrument
  // that is open in one portfolio and closed in another stays on two tabs.
  function _mergeHoldingRowsByInstrument(rows, opts) {
    opts = opts || {};
    var unitsKey = opts.unitsKey || "units";
    var sumKeys = opts.sumKeys || [];
    var avgPairs = opts.avgPairs || [];      // [avgKey, totalKey] → total / units
    var pctPairs = opts.pctPairs || [];      // [pctKey, partKey, wholeKey] → part/whole
    var order = [], byName = {};
    rows.forEach(function (r) {
      var k = normalizeText(r.instrument || "");
      if (!byName[k]) { byName[k] = []; order.push(k); }
      byName[k].push(r);
    });
    return order.map(function (k) {
      var group = byName[k];
      var names = [];
      group.forEach(function (r) {
        var pn = (r._portfolio || "").trim();
        if (pn && names.indexOf(pn) === -1) names.push(pn);
      });
      if (group.length === 1) {
        var solo = {}; for (var s in group[0]) solo[s] = group[0][s];
        solo._portfolios = names;
        return solo;
      }
      var m = {}; for (var f in group[0]) m[f] = group[0][f];
      m._portfolios = names;
      m._portfolio = names.join(" · ");
      [unitsKey].concat(sumKeys).forEach(function (key) {
        var any = false, tot = 0;
        group.forEach(function (r) {
          if (r[key] == null || !isFinite(r[key])) return;
          any = true; tot += r[key];
        });
        m[key] = any ? tot : null;
      });
      var units = m[unitsKey] || 0;
      avgPairs.forEach(function (p) {
        m[p[0]] = (units > 0 && m[p[1]] != null) ? m[p[1]] / units : null;
      });
      pctPairs.forEach(function (p) {
        var whole = m[p[2]];
        m[p[1]] = m[p[1]] == null ? null : m[p[1]];
        m[p[0]] = (whole && isFinite(whole) && m[p[1]] != null) ? (m[p[1]] / whole) * 100 : 0;
      });
      var flows = [];
      var haveFlows = group.every(function (r) { return Array.isArray(r._xirrFlows); });
      if (haveFlows) {
        group.forEach(function (r) { flows = flows.concat(r._xirrFlows); });
        var x = calculateXIRR(flows);
        m.xirrPct = (x == null || !isFinite(x)) ? null : x * 100;
        m._xirrFlows = flows;
      } else {
        // Better no number than a wrong one — an averaged XIRR is not an XIRR.
        m.xirrPct = null;
      }
      return m;
    });
  }

  function renderSeHoldingsCardList(rowsData, region, usdInrToday) {
    var listId = region === "us" ? "seh-us-list" : "seh-india-list";
    var eyebrowId = region === "us" ? "seh-us-eyebrow" : "seh-india-eyebrow";
    var list = document.getElementById(listId);
    var eyebrow = document.getElementById(eyebrowId);
    if (!list) return;
    var mapping = buildStockMappingTable();
    var regionShowClosed = !!SEH_STATE.showClosed[region];
    // Painted HERE, not only at wire-up: the portfolio pill's own click handler
    // re-renders through this function, so painting it anywhere else left the
    // highlight stuck on whatever was active when the card was first drawn — the
    // list filtered correctly while the control looked dead.
    SEH_STATE.portfolio[region] = _renderPortfolioPills(
      document.getElementById(region === "us" ? "seh-us-portfolio-toggle" : "seh-portfolio-toggle"),
      "data-seh-portfolio", _allPortfolioNames(["stocksetf"]), SEH_STATE.portfolio[region] || "all",
      function (p) {
        var a = _seOpenClosedAvailability(region, p);
        return a.open || a.closed;
      });
    var regionPortfolio = SEH_STATE.portfolio[region] || "all";
    var regionSort = SEH_STATE.sort[region] || "pnl-desc";
    // Everything this region/portfolio would show, before the open/closed split —
    // so "are there any closed positions" is answered for what the user is actually
    // looking at, and changing the portfolio pill updates the Closed segment.
    var inScope = rowsData.filter(function (h) {
      var isUS = h.region === "US";
      if (region === "us" && !isUS) return false;
      if (region === "india" && isUS) return false;
      if (regionPortfolio && regionPortfolio !== "all") {
        if (normalizeText(h._portfolio || "") !== normalizeText(regionPortfolio)) return false;
      }
      return true;
    });
    function _isClosedRow(h) { return (h.units || 0) < UNITS_EPSILON || h.isClosed; }
    // Availability comes from the TRANSACTION SHEET, not from inScope. The closed
    // set is only built when the legacy show-closed checkbox is on, so before the
    // user has ever pressed Closed there are no closed rows here to count — and the
    // pipeline bails entirely when no position is open, so this renderer may not run
    // at all. Reading the sheet answers the question without pricing anything.
    var avail = _seOpenClosedAvailability(region, regionPortfolio);
    var hasClosed = avail.closed || inScope.some(_isClosedRow);
    var hasOpen = avail.open || inScope.some(function (h) { return !_isClosedRow(h); });
    if (regionShowClosed && !hasClosed && hasOpen) {
      SEH_STATE.showClosed[region] = false;
      regionShowClosed = false;
    } else if (!regionShowClosed && !hasOpen && hasClosed) {
      SEH_STATE.showClosed[region] = true;
      regionShowClosed = true;
    }
    _setOpenClosedPill(document.getElementById(region === "us" ? "seh-us-open-toggle" : "seh-open-toggle"),
      regionShowClosed, hasClosed, hasOpen);
    var filtered = inScope.filter(function (h) {
      return regionShowClosed ? _isClosedRow(h) : !_isClosedRow(h);
    });
    if (!regionPortfolio || regionPortfolio === "all") {
      filtered = _mergeHoldingRowsByInstrument(filtered, {
        unitsKey: "units",
        sumKeys: ["investedINR", "currentINR", "investedUSD", "currentUSD", "dayChangeINR", "pnl"],
        avgPairs: [["avgCostINR", "investedINR"], ["avgCostUSD", "investedUSD"]],
        pctPairs: [["pnlPct", "pnl", "investedINR"]]
      });
    }
    var sParts = String(regionSort).split("-");
    var sortKey = sParts[0];
    var sortDir = sParts[1] === "asc" ? 1 : -1;
    filtered.sort(function (a, b) { return sortDir * _sehSortCompare(a, b, sortKey); });
    var label = region === "us" ? "US" : "INDIA";
    var count = filtered.length;
    var suffix = regionShowClosed ? " CLOSED" : " OPEN";
    if (eyebrow) {
      if (region === "us") {
        eyebrow.innerHTML = 'US · ' + count + suffix + ' <span id="seh-us-usdinr" class="mfh-sip-badge" style="margin-left:6px;">USD/INR · ' + (usdInrToday ? Number(usdInrToday).toFixed(2) : "—") + '</span>';
      } else {
        eyebrow.textContent = label + " · " + count + suffix;
      }
    }
    if (!filtered.length) { list.innerHTML = '<p class="muted small" style="padding:16px;text-align:center;">No ' + label.toLowerCase() + ' holdings.</p>'; return; }
    function _sArrow(k) { return sortKey === k ? (sortDir === -1 ? " ↓" : " ↑") : ""; }
    var header = '<div class="mfh-list-header" style="grid-template-columns: minmax(200px, 2.4fr) 1fr 1fr 1fr 0.9fr 1fr 0.85fr;">' +
      '<span class="mfh-sortable" data-seh-sort-col="instrument">Instrument' + _sArrow("instrument") + '</span>' +
      '<span class="mfh-col-num mfh-sortable" data-seh-sort-col="invested">Invested' + _sArrow("invested") + '</span>' +
      '<span class="mfh-col-num mfh-sortable" data-seh-sort-col="current">Current' + _sArrow("current") + '</span>' +
      '<span class="mfh-col-num mfh-sortable" data-seh-sort-col="ltp">LTP' + _sArrow("ltp") + '</span>' +
      '<span class="mfh-col-num mfh-sortable" data-seh-sort-col="day">Day Chg' + _sArrow("day") + '</span>' +
      '<span class="mfh-col-num mfh-sortable" data-seh-sort-col="pnl">P&amp;L · Return' + _sArrow("pnl") + '</span>' +
      '<span class="mfh-col-num mfh-sortable" data-seh-sort-col="xirr">XIRR' + _sArrow("xirr") + '</span></div>';
    var subInv = 0, subCur = 0, subDay = 0, subInvUSD = 0, subCurUSD = 0;
    function _fmtUsd(v) { return "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    // Amount cell: INR as the primary value, with the native USD amount beneath it
    // for US rows (mirrors the P&L value/return two-line layout). usd==null → INR only.
    function _seAmtCell(inr, usd) {
      if (usd == null) return '<div class="mfh-col-num mfh-num-primary"' + _crTitle(inr) + '>' + formatCurrency(inr) + '</div>';
      // Neutral primary (mfh-num-primary), NOT the green mfh-num-pnl-value — an
      // amount isn't a gain/loss, so it must match the black India/MF columns.
      // The mfh-num-pnl wrapper only supplies the two-line stacking.
      return '<div class="mfh-col-num mfh-num-pnl">' +
        '<span class="mfh-num-primary"' + _crTitle(inr) + '>' + formatCurrency(inr) + '</span>' +
        '<span class="mfh-num-pnl-pct" style="color:var(--muted);font-weight:500;">' + _fmtUsd(usd) + '</span></div>';
    }
    // Share of the invested total for this region's currently filtered list — so
    // India and US each read 100% on their own, and both re-scale when the
    // portfolio pill or the Open/Closed segment changes what is shown.
    var totalInvestedINR = filtered.reduce(function (s, h) { return s + (h.investedINR || 0); }, 0);
    var body = filtered.map(function (h, i) {
      var pal = SE_AVATAR_PALETTE[i % SE_AVATAR_PALETTE.length];
      var m = mapping[normalizeText(h.instrument)];
      var cat = m ? (m.category || "") : "";
      var segment = m ? (m.subCat || m.segment || "") : "";
      var isEtf = normalizeText(cat).indexOf("etf") !== -1;
      var code = _seShortCode(h.instrument);
      if (isEtf) code = "ETF";
      var pnl = h.pnl || 0;
      var pnlPct = h.pnlPct || 0;
      var day = h.dayChangeINR || 0;
      subInv += h.investedINR || 0; subCur += h.currentINR || 0; subDay += day;
      if (h.investedUSD != null) subInvUSD += h.investedUSD;
      if (h.currentUSD != null) subCurUSD += h.currentUSD;
      var badges = '';
      if (isEtf) badges += ' <span class="mfh-sip-badge" style="background:#F1EBDD;color:#7A7568;">ETF</span>';
      // US holdings show the native USD avg cost per unit; India shows ₹.
      var avgCostStr = (h.avgCostUSD != null)
        ? _fmtUsd(h.avgCostUSD)
        : '₹' + Number(h.avgCostINR || 0).toFixed(2);
      // Three deliberate lines under the name rather than one that wraps
      // mid-sentence: the portfolio(s), then the holding, then its share of
      // invested. On "All" a merged row names every portfolio it was summed
      // from; with a single portfolio that line is simply absent and the
      // holding line moves up.
      // Always name the portfolio, not just when the row was merged from several.
      // Showing it only for merged rows meant a holding in one portfolio had no
      // portfolio line at all, so the India/US lists read differently from Mutual
      // Fund Holding — which has always named it — and you could not tell whose a
      // single-portfolio holding was without switching the pill.
      var sePfNames = (h._portfolios && h._portfolios.length)
        ? h._portfolios.join(" + ")
        : (h._portfolio || "");
      var subLine = (sePfNames ? '<div class="mfh-inst-sub">' + escapeHtml(sePfNames) + '</div>' : "") +
        '<div class="mfh-inst-sub">' + (segment ? escapeHtml(segment) : "—") + ' · ' +
          (h.units || 0).toFixed(2) + ' @ ' + avgCostStr + '</div>' +
        '<div class="mfh-inst-share">' + _investedSharePct(h.investedINR || 0, totalInvestedINR) + '</div>';
      return '<div class="mfh-row mfh-color-' + pal.accent + '" style="grid-template-columns: minmax(200px, 2.4fr) 1fr 1fr 1fr 0.9fr 1fr 0.85fr;">' +
        '<div class="mfh-inst">' +
          '<div class="mfh-avatar" style="background:' + pal.bg + ';color:' + pal.fg + ';">' + code + '</div>' +
          '<div class="mfh-inst-body">' +
            '<div class="mfh-inst-name">' + escapeHtml(h.instrument) + badges + '</div>' +
            subLine +
          '</div>' +
        '</div>' +
        _seAmtCell(h.investedINR || 0, (h.investedUSD != null ? h.investedUSD : null)) +
        _seAmtCell(h.currentINR || 0, (h.currentUSD != null ? h.currentUSD : null)) +
        (h.ltpINR != null
          ? _seAmtCell(h.ltpINR, (h.ltpUSD != null ? h.ltpUSD : null))
          : '<div class="mfh-col-num mfh-num-primary">—</div>') +
        _mfhDayCell(Math.abs(day) < 0.01 ? null : day, (h.currentINR - day) > 0 ? (day / (h.currentINR - day)) * 100 : null) +
        '<div class="mfh-col-num mfh-num-pnl">' +
          '<span class="mfh-num-pnl-value ' + (pnl >= 0 ? "" : "mfh-negative") + '"' + _crTitle(pnl) + '>' + (pnl >= 0 ? "+" : "") + formatCurrency(pnl) + '</span>' +
          '<span class="mfh-num-pnl-pct ' + (pnlPct >= 0 ? "" : "mfh-negative") + '">' + (pnlPct >= 0 ? "+" : "") + pnlPct.toFixed(2) + '%</span>' +
        '</div>' +
        // xirrPct is already computed per holding when the rows are built, with
        // the same method the Mutual Fund list uses: that instrument's own buy and
        // sell flows (US legs converted at each transaction's USD/INR rate) plus
        // its current value as the terminal flow. A holding with no solvable rate
        // shows a dash rather than 0%.
        '<div class="mfh-col-num mfh-num-xirr ' +
          (h.xirrPct == null ? "mfh-muted" : (h.xirrPct >= 0 ? "" : "mfh-negative")) + '">' +
          (h.xirrPct == null ? "—" : (h.xirrPct >= 0 ? "+" : "") + h.xirrPct.toFixed(2) + "%") + '</div>' +
      '</div>';
    }).join("");
    var subPnl = subCur - subInv;
    var subPct = subInv > 0 ? (subPnl / subInv) * 100 : 0;
    var subDayPct = (subCur - subDay) > 0 ? (subDay / (subCur - subDay)) * 100 : null;
    var footer = '<div class="mfh-row" style="grid-template-columns: minmax(200px, 2.4fr) 1fr 1fr 1fr 0.9fr 1fr 0.85fr;background:var(--bg);padding:10px 6px;border-radius:8px;font-weight:700;">' +
      '<div style="font-size:0.72rem;">' + label + ' subtotal<div style="font-size:0.55rem;letter-spacing:0.11em;text-transform:uppercase;color:var(--muted);margin-top:2px;">' + count + ' HOLDINGS' + (region === "us" ? " · INR / USD" : "") + '</div></div>' +
      _seAmtCell(subInv, (region === "us" ? subInvUSD : null)) +
      _seAmtCell(subCur, (region === "us" ? subCurUSD : null)) +
      '<div class="mfh-col-num mfh-num-primary" style="color:var(--muted);">—</div>' +
      _mfhDayCell(Math.abs(subDay) < 0.01 ? null : subDay, subDayPct) +
      '<div class="mfh-col-num mfh-num-pnl"><span class="mfh-num-pnl-value ' + (subPnl >= 0 ? "" : "mfh-negative") + '"' + _crTitle(subPnl) + '>' + (subPnl >= 0 ? "+" : "") + formatCurrency(subPnl) + '</span><span class="mfh-num-pnl-pct ' + (subPct >= 0 ? "" : "mfh-negative") + '">' + (subPct >= 0 ? "+" : "") + subPct.toFixed(2) + '%</span></div>' +
      // Region XIRR is left blank, as the Mutual Fund subtotal does: adding up
      // per-holding rates is meaningless, and a true region rate needs the
      // combined cash flows rather than an average of percentages.
      '<div class="mfh-col-num mfh-num-xirr mfh-muted">—</div>' +
      '</div>';
    list.innerHTML = header + body + footer;
    try { applyHoldingsFold(listId); } catch (e) {}
    list.querySelectorAll("[data-seh-sort-col]").forEach(function (el) {
      el.addEventListener("click", function () {
        var col = el.dataset.sehSortCol;
        var cur = String(SEH_STATE.sort[region] || "").split("-");
        SEH_STATE.sort[region] = (cur[0] === col && cur[1] === "desc") ? (col + "-asc") : (col + "-desc");
        renderSeHoldingsCardList(rowsData, region, usdInrToday);
      });
    });
  }

  // Paints the active segment of an Open/Closed pill. The two buttons are always
  // both visible, so the state has to be shown by which one is highlighted rather
  // than by the label — a single button reading "Open" was ambiguous about whether
  // that was the current state or the action.
  // The progress bar and the "+x.xx%   +Rs n gain" line under every portfolio card.
  // These were copy-pasted into the Mutual Fund, Stocks/ETF and Fixed Income
  // renderers and had drifted: Stocks/ETF dropped the " gain"/" loss" word, so the
  // same line read differently depending on which investment tab you were on.
  // Shared so it cannot happen again.
  function _mfpcBarHtml() {
    // Static divider, not an indicator. It used to scale its fill with the return,
    // which made the same card look different on every tab while carrying no
    // information the percentage below it did not already state. Width lives in CSS.
    return '<div class="mfpc-bar"><div class="mfpc-bar-fill"></div></div>';
  }

  function _mfpcReturnRowHtml(pnl, pnlPct) {
    var isNeg = pnl < 0;
    return '<div class="mfpc-return-row">' +
      '<span class="mfpc-return-pct ' + (isNeg ? "mfpc-negative" : "") + '">' +
        (isNeg ? "" : "+") + pnlPct.toFixed(2) + '%</span>' +
      '<span class="mfpc-gain ' + (isNeg ? "mfpc-negative" : "mfpc-positive") + '"' + _crTitle(pnl) + '>' +
        (isNeg ? "" : "+") + formatCurrency(pnl) + (isNeg ? " loss" : " gain") + '</span>' +
    '</div>';
  }

  // Portfolio pills, painted the same way on every holdings card.
  //
  // Every card lists the SAME portfolios and disables the ones with nothing in that
  // particular table, rather than hiding them. Hiding made the row of names change
  // shape from card to card, which reads as data missing; a greyed name says "this
  // person holds nothing here", which is information. "All" is never disabled.
  //
  // Returns the selection to use — if the current one has become unavailable (a
  // portfolio that sold its last holding, or a filter carried over from another
  // card) it falls back to "all" rather than showing an empty table.
  function _renderPortfolioPills(container, attr, names, selected, isAvailable) {
    if (!container) return selected;
    if (selected !== "all" && !isAvailable(selected)) selected = "all";
    container.innerHTML = ["all"].concat(names).map(function (p) {
      var ok = p === "all" || isAvailable(p);
      return '<button type="button" class="mfh-portfolio-btn ' + (p === selected ? "active" : "") + '"' +
        (ok ? "" : ' disabled title="No holdings in this table"') +
        " " + attr + '="' + escapeHtml(p) + '">' +
        escapeHtml(p === "all" ? "All" : p) + "</button>";
    }).join("");
    return selected;
  }

  // The portfolios that appear anywhere in the transaction sheets. Used as the
  // common list so every card shows the same names.
  function _allPortfolioNames(prefixes) {
    return collectPortfolioNamesFromSheets(prefixes) || [];
  }

  // A segment with nothing behind it is disabled — an enabled control that leads to
  // an empty list reads as a bug. Symmetric: a portfolio that has sold everything
  // has no Open view, just as one that has never sold has no Closed view. Pass
  // undefined for either to leave that segment's enabled state alone (initial
  // wire-up, before any rows exist).
  //
  // When BOTH are empty the two are left enabled rather than locking the control
  // out entirely — there is nothing to protect the user from, and a dead pill next
  // to an empty table is more confusing than an inert one.
  function _setOpenClosedPill(container, showClosed, hasClosed, hasOpen) {
    if (!container) return;
    var neither = hasClosed === false && hasOpen === false;
    container.querySelectorAll(".isc-toggle-btn").forEach(function (b) {
      var wants = b.getAttribute("data-seh-open") || b.getAttribute("data-dbth-open") ||
                  b.getAttribute("data-mfh-open") || b.getAttribute("data-fih-oc") ||
                  b.getAttribute("data-cmh-oc");
      var isClosedSeg = wants === "closed";
      b.classList.toggle("active", isClosedSeg === !!showClosed);
      b.setAttribute("aria-pressed", String(isClosedSeg === !!showClosed));
      var has = isClosedSeg ? hasClosed : hasOpen;
      if (has === undefined) return;
      b.disabled = !has && !neither;
      b.title = b.disabled ? (isClosedSeg ? "No closed positions" : "No open positions") : "";
    });
  }

  // Wire Stocks/ETF controls — India and US Open toggles operate independently.
  (function wireSeControls() {
    [
      { id: "seh-open-toggle", region: "india" },
      { id: "seh-us-open-toggle", region: "us" }
    ].forEach(function (spec) {
      var box = document.getElementById(spec.id);
      if (!box) return;
      _setOpenClosedPill(box, SEH_STATE.showClosed[spec.region]);
      box.addEventListener("click", function (ev) {
        var btn = ev.target.closest("[data-seh-open]");
        if (!btn) return;
        var wantClosed = btn.getAttribute("data-seh-open") === "closed";
        if (wantClosed === !!SEH_STATE.showClosed[spec.region]) return; // already there
        SEH_STATE.showClosed[spec.region] = wantClosed;
        _setOpenClosedPill(box, wantClosed);
        // The rows already hold BOTH sides for every portfolio
        // (_buildPerPortfolioSeRowsData builds open and closed), so this is a
        // re-filter, not a refetch — same as Fixed Income Holding. The legacy
        // checkboxes are still synced because other paths read them.
        var cb = document.getElementById("stocksetf-show-closed");
        var cb2 = document.getElementById("stocksetf-us-show-closed");
        if (cb) cb.checked = SEH_STATE.showClosed.india;
        if (cb2) cb2.checked = SEH_STATE.showClosed.us;
        renderSeHoldingsCardList(_seWiredRows.rowsData, spec.region, _seWiredRows.usdInrToday);
      });
    });
  })();

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
      returnEl.title = Math.abs(unrealized) >= 1e7 ? (unrealized > 0 ? "+" : "") + formatCurrencyFull(unrealized) : "";
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
    el.title = Math.abs(dayChange) >= 1e7 ? (dayChange > 0 ? "+" : "") + formatCurrencyFull(dayChange) : "";
    el.classList.remove("positive", "negative");
    if (cls) el.classList.add(cls);
  }

  // Overview day change = MF + Stocks/ETF + commodity, each populated by its own
  // async flow. Summing from the slice store here (rather than each flow trying to add the
  // others) removes the ordering race that previously dropped the SE component
  // when _mfCommDayChange had been reset. Missing components are simply 0 until
  // their flow resolves, then this is called again.
  function updateOverviewDayChange() {
    var el = document.getElementById("overview-day-change");
    if (!el) return;
    var comm = isFixedIncomeExcluded() ? 0 : (_ovSlice.comm.dayChange || 0);
    var mf = _ovSlice.mf.dayChange || 0, se = _ovSlice.se.dayChange || 0;
    var total = _ovAggregate().dayChange;
    dbg("[Overview dayChange] mf=" + Math.round(mf) + " se=" + Math.round(se) + " comm=" + Math.round(comm) + " total=" + Math.round(total));
    setDayChange(el, total);
  }

  function previous_nav_for(navHistory) {
    if (!navHistory || navHistory.length < 2) return null;
    return navHistory[navHistory.length - 2].nav;
  }

  // Returns all unique dates (buy + sell) for commodity rows — used to batch-fetch historical prices.
  // Does this portfolio hold ANY commodity at all?
  //
  // Gates the gold-price fetches. Six call sites asked currency-api for the XAU
  // rate unconditionally, so a portfolio with no commodity row still made a
  // network request (and its dated historical requests) on every load.
  //
  // Deliberately independent of collectCommodityUniqueDates: gating on "are
  // there any usable dates" would also skip a commodity row whose Transaction
  // Date failed to parse, and that row still needs today's rate to be valued.
  function _hasCommodityRows(fdRows, portfolioFilter) {
    if (!fdRows || fdRows.length < 2) return false;
    var header = fdRows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var categoryIdx = header.indexOf("instrument category");
    if (categoryIdx === -1) return false;
    for (var i = 1; i < fdRows.length; i++) {
      var row = fdRows[i];
      if (normalizeText(row[categoryIdx]) !== "commodity") continue;
      if (portfolioFilter && portfolioFilter !== "all" && portfolioIdx !== -1 &&
          normalizeText(row[portfolioIdx] || "") !== normalizeText(portfolioFilter)) continue;
      return true;
    }
    return false;
  }

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
        var fixedIncomeCurrentValue = (fdRows ? sumFdActiveCurrentValue(fdRows, selected) : 0) + pfCurrentValue;
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
      if (!_hasCommodityRows(fdRowsForOverview, selected)) return Promise.resolve({ profit: 0, flows: [] });
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
      // Stash for the benchmark card so its index side can replay the same gold
      // rupees (the pre-terminal buy/sell flows) — otherwise the index never
      // "buys Nifty" with money the user put into gold, overstating alpha.
      _ovFlows.commodityXirrFlows = commodityFlows || [];

      var instruments = Object.keys(unitEvents).filter(function (name) { return !!lookupSchemeCode(schemeMap, name); });
      dbg("[NAV] instruments held:", Object.keys(unitEvents), "resolved scheme codes:", instruments.map(function (name) { return name + " -> " + lookupSchemeCode(schemeMap, name); }));
      if (!instruments.length) {
        var reason = !Object.keys(unitEvents).length
          ? "No equity holdings found in the synced Mutual Fund Transactions sheet" + (lastUnitEventsDiagnostic ? " (" + lastUnitEventsDiagnostic + ")" : "") + "."
          : !Object.keys(schemeMap).length
          ? "Could not resolve any Instrument Name to a Scheme Code via the Mutual Fund Mapping sheet / AMFI." + (lastSchemeMapDiagnostic ? " (" + lastSchemeMapDiagnostic + ")" : "")
          : "None of your equity instruments matched a resolved Scheme Code.";
        if (equityEl) { equityEl.textContent = formatCurrency(0); equityEl.title = reason; }
        _ovApply("mf", { current: 0, unrealized: 0 }, "updateTotalCurrentValue:noInstruments", selected);
        renderOverview();
        setUnrealizedReturn(equityReturnEl, equityPctEl, 0, 0);
        var xirrCashFlows = buildXirrCashFlows(equityRows, selected);
        var xirrNoValue = calculateXIRR(xirrCashFlows);
        var ovBaseFlows = overviewXirrCashFlows(xirrCashFlows, null, commodityFlows);
        _ovFlows.overviewBaseFlows = ovBaseFlows;
        setXirr(overviewXirrEl, calculateXIRR(ovBaseFlows.concat(_ovFlows.seXirrFlows)));
        setXirr(equityXirrEl, xirrNoValue);
        setDayChange(equityDayChangeEl, 0);
        document.dispatchEvent(new CustomEvent("wf-overview-flows-ready"));
        fetchCommodityDayChange(fdRowsForOverview, selected).then(function (commodityDayChange) {
          // Gate by the FI toggle: when Fixed Income is excluded the commodity slice
          // is zeroed from every other card, so its day change must be excluded too.
          _ovApply("mf", { dayChange: 0 }, "updateTotalCurrentValue:noInstruments", selected);
          _ovApply("comm", { dayChange: isFixedIncomeExcluded() ? 0 : commodityDayChange }, "fetchCommodityDayChange", selected);
          updateOverviewDayChange();
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
            if (units <= UNITS_EPSILON) return;
            var nav = latest_nav_for(navHistory);
            var prevNav = previous_nav_for(navHistory);
            if (nav) {
              total += units * nav;
              heldInstruments.push(name);
              yesterdayTotal += units * (prevNav || nav);
            } else {
              // NAV couldn't be resolved for a still-held fund: value it at COST so
              // it nets to ₹0 P&L instead of appearing as a phantom loss (its cost
              // is in mfInvested; excluding it from current understated net worth).
              var cost = investedCostFor([name]);
              total += cost;
              heldInstruments.push(name);
              yesterdayTotal += cost; // unpriced → no day change
            }
          });
          // Held funds whose Scheme Code couldn't be resolved at all are filtered
          // out of `instruments` above but still count in mfInvested — value them
          // at cost too so they don't surface as a phantom loss.
          Object.keys(unitEvents).forEach(function (name) {
            if (lookupSchemeCode(schemeMap, name)) return; // priced/handled above
            var evs = unitEvents[name];
            var u = evs.length ? evs[evs.length - 1].cumulativeUnits : 0;
            if (u <= UNITS_EPSILON) return;
            var c = investedCostFor([name]);
            total += c;
            yesterdayTotal += c;
            heldInstruments.push(name);
          });
          // Debt funds are Fixed Income, so their value leaves the Mutual Fund
          // figures and is reported separately. Splitting here — after valuation,
          // before the totals are published — keeps one valuation path and means
          // net worth is unchanged: what mf loses, debtMf gains.
          var _dbtMap = buildInstrumentTopCategoryMap();
          function _isDebtName(n) {
            return normalizeText(_dbtMap[normalizeText(n || "")] || "") === "fixed income";
          }
          var debtNames = heldInstruments.filter(_isDebtName);
          var mfNames = heldInstruments.filter(function (n) { return !_isDebtName(n); });
          var debtCurrent = 0, debtYesterday = 0;
          debtNames.forEach(function (name) {
            var idx = instruments.indexOf(name);
            var evs = unitEvents[name] || [];
            var u = evs.length ? evs[evs.length - 1].cumulativeUnits : 0;
            if (u <= UNITS_EPSILON) return;
            var nh = idx === -1 ? null : navHistories[idx];
            var nv = nh ? latest_nav_for(nh) : null;
            var pv = nh ? previous_nav_for(nh) : null;
            if (nv) { debtCurrent += u * nv; debtYesterday += u * (pv || nv); }
            else { var c = investedCostFor([name]); debtCurrent += c; debtYesterday += c; }
          });
          var debtInvested = debtNames.length ? investedCostFor(debtNames) : 0;
          total -= debtCurrent;
          yesterdayTotal -= debtYesterday;
          heldInstruments = mfNames;

          var investment = investedCostFor(heldInstruments);
          var unrealizedProfit = total - investment;
          // invested is owned by updateDashboardStats; only the live figures are
          // written here, so the two flows never contend for the same field.
          _ovApply("debtMf", {
            current: debtCurrent,
            unrealized: debtCurrent - debtInvested,
            dayChange: debtCurrent - debtYesterday
          }, "updateTotalCurrentValue:debt", selected);
          if (equityEl) equityEl.textContent = formatCurrency(total);
          setUnrealizedReturn(equityReturnEl, equityPctEl, total, investment);
          _ovApply("mf", { current: total, unrealized: unrealizedProfit }, "updateTotalCurrentValue:nav", selected);
          renderOverview();
          var equityDayChange = total - yesterdayTotal;
          setDayChange(equityDayChangeEl, equityDayChange);
          _ovApply("mf", { dayChange: equityDayChange }, "updateTotalCurrentValue:nav", selected);
          updateOverviewDayChange(); // reflect MF immediately; commodity/SE fold in when they resolve
          fetchCommodityDayChange(fdRowsForOverview, selected).then(function (commodityDayChange) {
            _ovApply("comm", { dayChange: isFixedIncomeExcluded() ? 0 : commodityDayChange }, "fetchCommodityDayChange", selected);
            updateOverviewDayChange();
          });

          var xirrCashFlows = buildXirrCashFlows(equityRows, selected);
          if (total > UNITS_EPSILON) xirrCashFlows.push({ date: new Date(), amount: total });
          var xirr = calculateXIRR(xirrCashFlows);
          var ovBaseFlows2 = overviewXirrCashFlows(xirrCashFlows, null, commodityFlows);
          _ovFlows.overviewBaseFlows = ovBaseFlows2;
          setXirr(overviewXirrEl, calculateXIRR(ovBaseFlows2.concat(_ovFlows.seXirrFlows)));
          setXirr(equityXirrEl, xirr);
          document.dispatchEvent(new CustomEvent("wf-overview-flows-ready"));
        });
    });
  }

  // Cash flows for XIRR: Buy = negative (money out), Sell = positive (money in).
  // Each transaction is kept as its own row — buys and sells on the same date are not netted.
  // Units traded FOR MONEY, per instrument per day. Splits and bonuses are
  // excluded: they change the unit count without any money moving, and the
  // unit price falls to match, so the curve must not react to them at all.
  function buildTradedUnitsByDate(rows, portfolioFilter) {
    var out = {};
    if (!rows || !rows.length) return out;
    var h = rows[0].map(normalizeText);
    var pI = h.indexOf("portfolio name"), iI = h.indexOf("instrument name"),
        tI = h.indexOf("transaction type"), uI = h.indexOf("units"),
        cI = h.indexOf("price"), dI = h.indexOf("transaction date");
    if (pI === -1 || iI === -1 || tI === -1 || uI === -1 || dI === -1) return out;
    rows.slice(1).forEach(function (row) {
      if (portfolioFilter !== "all" &&
          normalizeText((row[pI] || "").trim()) !== normalizeText(portfolioFilter)) return;
      var type = normalizeText(row[tI] || "");
      if (type === "split" || type === "bonus") return; // no money moved
      var isBuy = type.indexOf("buy") !== -1, isSell = type.indexOf("sell") !== -1;
      if (!isBuy && !isSell) return;
      var units = parseNumber(row[uI]);
      var price = cI === -1 ? 0 : parseNumber(row[cI]);
      if (!units || !price) return; // a zero price is a corporate action, not a trade
      var d = parseFlexibleDate(row[dI]);
      if (!d) return;
      var key = normalizeText((row[iI] || "").trim());
      var byDate = out[key] || (out[key] = {});
      byDate[dateKey(d)] = (byDate[dateKey(d)] || 0) + (isBuy ? units : -units);
    });
    return out;
  }

  // Units traded in a half-open period (after `from`, up to and including `to`),
  // for one instrument. Used to value a period's flow at that period's own price.
  function tradedUnitsInRange(byDate, from, to) {
    if (!byDate) return 0;
    var lo = from ? dateKey(from) : "", hi = dateKey(to), sum = 0;
    for (var k in byDate) { if (k > lo && k <= hi) sum += byDate[k]; }
    return sum;
  }

  // Every stocks/ETF cash flow in a portfolio, converted to INR at each
  // transaction's own USD/INR rate. ALL instruments, including ones that have been
  // fully sold: a closed position's buys and proceeds are as much a part of the
  // return as an open one's. Building this from the OPEN holdings instead silently
  // dropped every exited position from the portfolio XIRR and from the benchmark
  // that replays these flows — measured at +301.91% where the money earned
  // -59.63%, because the one closed position happened to be the loss.
  // Rows with no mapping are skipped: nothing values them anywhere, so counting
  // their money would compare cash against a value that does not exist.
  function buildSeInrFlows(rows, portfolioFilter, mappingTable, usdMap, usdToday) {
    var out = [];
    var byInstrument = groupUnitTransactionsByInstrument(rows, portfolioFilter) || {};
    Object.keys(byInstrument).forEach(function (instrument) {
      var mapping = mappingTable && mappingTable[normalizeText(instrument)];
      if (!mapping) return;
      var isUsd = normalizeText(mapping.region) === "us";
      byInstrument[instrument].forEach(function (txn) {
        if (!txn.date || !txn.units || !txn.price) return; // price 0 = corporate action
        var rate = isUsd ? ((usdMap && usdMap[formatDateISO(txn.date)]) || usdToday || 1) : 1;
        var amt = txn.units * txn.price * rate;
        out.push({ date: txn.date, amount: txn.type === "buy" ? -amt : amt });
      });
    });
    out.sort(function (a, b) { return a.date - b.date; });
    return out;
  }

  // Click-and-drag the chart left/right.
  //
  // Implemented here rather than left to chartjs-plugin-zoom's own pan, which
  // depends on Hammer.js being present and which we have no way to verify loads.
  // This needs nothing but pointer events, works the same for mouse and touch, and
  // is ours to test. The plugin keeps wheel and pinch, which are native to it.
  //
  // The window keeps its width and slides; `limits` stop it leaving the data, so
  // dragging past either end simply stops rather than revealing blank space.
  function wireChartXDrag(canvas, getChart, minLimit, maxLimit, onChange) {
    if (!canvas) return;
    // Re-wiring the same canvas would stack handlers and pan at a multiple of the
    // pointer speed.
    if (canvas.__wfDragWired) canvas.__wfDragWired();
    var dragging = false, startX = 0, startMin = 0, startMax = 0, moved = false;

    function span(chart) {
      var sc = chart && chart.scales && chart.scales.x;
      if (!sc || !isFinite(sc.min) || !isFinite(sc.max)) return null;
      return { min: sc.min, max: sc.max };
    }

    function onDown(e) {
      var chart = getChart();
      var w = span(chart);
      if (!w) return;
      dragging = true; moved = false;
      startX = e.clientX; startMin = w.min; startMax = w.max;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    }

    function onMove(e) {
      if (!dragging) return;
      var chart = getChart();
      if (!chart) return;
      var area = chart.chartArea;
      var width = area ? (area.right - area.left) : canvas.clientWidth;
      if (!(width > 0)) return;
      var dx = e.clientX - startX;
      if (!moved && Math.abs(dx) < 4) return; // a click is not a drag
      moved = true;
      // Dragging right moves the window BACK in time: the data follows the cursor.
      var perPixel = (startMax - startMin) / width;
      var shift = -dx * perPixel;
      var min = startMin + shift, max = startMax + shift;
      if (min < minLimit) { max += minLimit - min; min = minLimit; }
      if (max > maxLimit) { min -= max - maxLimit; max = maxLimit; }
      if (min < minLimit) min = minLimit; // window wider than the data
      setChartXWindow(chart, min, max);
      if (onChange) onChange();
      e.preventDefault();
    }

    function onUp(e) {
      if (!dragging) return;
      dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
      if (moved && onChange) onChange();
    }

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onUp);
    canvas.__wfDragWired = function () {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onUp);
      canvas.__wfDragWired = null;
    };
  }

  // Set a chart's visible x window. zoomScale/resetZoom come from
  // chartjs-plugin-zoom, which is a separate CDN script: if it fails to load —
  // offline, blocked, an ad blocker — Chart.js itself is still fine, and calling a
  // plugin method blind threw and took the whole render down with it. Fall back to
  // the scale options, which pins the window instead of making it draggable. A
  // chart that cannot be panned beats no chart at all.
  function setChartXWindow(chart, min, max) {
    if (!chart) return;
    if (typeof chart.zoomScale === "function") {
      chart.zoomScale("x", { min: min, max: max }, "none");
      return;
    }
    if (chart.options && chart.options.scales && chart.options.scales.x) {
      chart.options.scales.x.min = min;
      chart.options.scales.x.max = max;
      chart.update();
    }
  }

  function resetChartXWindow(chart, min, max) {
    if (!chart) return;
    if (typeof chart.resetZoom === "function") { chart.resetZoom(); return; }
    setChartXWindow(chart, min, max);
  }

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
  // calculateXIRR lives in wf-math.js (pure, unit-tested). This thin wrapper keeps
  // the in-closure call sites and hoisting behaviour unchanged.
  function calculateXIRR(cashflows) { return WfMath.calculateXIRR(cashflows); }

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
  // Re-render the Account Value chart once the Overview's live values finish
  // loading, so its snapped last point matches the Overview Current card even
  // if the chart rendered first (e.g. before Stocks/ETF prices arrived).
  if (!window.__wfValueChartOverviewBound) {
    window.__wfValueChartOverviewBound = true;
    var _vcRefreshT = null;
    document.addEventListener("wf-overview-flows-ready", function () {
      clearTimeout(_vcRefreshT);
      _vcRefreshT = setTimeout(function () { try { renderValueChart(); } catch (e) {} }, 150);
    });
  }
  renderEquityHoldingsTable();
  renderAllFixedIncomeHoldingsTable();
  renderCommodityHoldingsTable();
  renderInvestmentSplitChart();
  renderInstrumentSplitChart();
  renderProfitByCategoryCard();

  var equityHoldingsShowClosedOnly = document.getElementById("equity-holdings-show-closed-only");
  if (equityHoldingsShowClosedOnly) equityHoldingsShowClosedOnly.addEventListener("change", renderEquityHoldingsTable);

  var stocksetfShowClosed = document.getElementById("stocksetf-show-closed");
  if (stocksetfShowClosed) stocksetfShowClosed.addEventListener("change", renderStockEtfHoldingsTable);
  var stocksetfUsShowClosed = document.getElementById("stocksetf-us-show-closed");
  if (stocksetfUsShowClosed) stocksetfUsShowClosed.addEventListener("change", renderStockEtfHoldingsTable);

  // Mirror a freshly-parsed sheet/mapping blob into the Supabase synced cache so
  // other devices/browsers pick it up without re-entering URLs. Fire-and-forget:
  // Google Sheets stays the source of truth and the local write already happened,
  // so a cloud failure here is a silent no-op (WfAuth.saveSheetData never rejects).
  // Always a FULL REPLACE of the prefix — never an append — so re-syncing the same
  // sheet can't duplicate rows in the cache.
  function pushSheetDataToCloud(prefix, rows) {
    try {
      if (window.WfAuth && WfAuth.isLoggedIn() && Array.isArray(rows)) {
        WfAuth.saveSheetData(prefix, rows);
      }
    } catch (e) {}
  }

  // Re-fetch one transaction-sheet prefix from its source, refresh the cache, and
  // re-render the dashboard surfaces it feeds. Used by the per-tab Refresh buttons
  // AND by the on-load background resync below.
  function resyncSheetPrefixFromCloud(prefix, spinBtn) {
    var configs = loadSheetConfigs(prefix);
    if (!configs.length) return;
    var canonicalFields = prefix === "fixedincome" ? FIXED_INCOME_SHEET_FIELDS : prefix === "fd" ? FD_SHEET_FIELDS : TRANSACTION_SHEET_FIELDS;
    if (spinBtn) spinBtn.classList.add("spinning");
    fetchAndMergeSheets(configs, function (merged, failures, failureReasons, perSheetStats, fetchFailures) {
      if (spinBtn) spinBtn.classList.remove("spinning");
      // Only accept the result when every sheet that was fetched actually LOADED.
      // A partial fetch returns fewer rows but still length>1; writing it would
      // (a) degrade the local view and (b) clobber the fuller shared cloud blob,
      // poisoning every other device that seeds from it. On a partial fetch we
      // keep the last-known-good cache untouched — the seed/next clean resync
      // already holds the full data. Gate on fetchFailures (real load failures)
      // NOT total failures, so a permanently-invalid config entry sitting beside
      // valid sheets doesn't freeze this prefix's updates forever.
      if (merged && merged.length > 1 && !fetchFailures) {
        addPortfolioNames(extractColumnValues(merged, "Portfolio Name"));
        localStorage.setItem("wf-" + prefix + "-data", JSON.stringify(merged));
        _invalidateSheetRows(prefix);
        pushSheetDataToCloud(prefix, merged);
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
      renderProfitByCategoryCard();
      renderMonthlyCashFlow();
    }, canonicalFields);
  }

  ["equity", "fixedincome", "fd", "stocksetf"].forEach(function (prefix) {
    var refreshBtn = document.getElementById(prefix + "-refresh");
    updateRefreshButtonStatus(prefix);
    if (!refreshBtn) return;
    refreshBtn.addEventListener("click", function () { resyncSheetPrefixFromCloud(prefix, refreshBtn); });
  });

  // Refresh a single mapping sheet (stored raw, no canonical realignment) and
  // re-render the holdings that depend on it.
  function resyncMappingFromCloud(prefix) {
    var cfgs = loadSheetConfigs(prefix);
    var cfg = cfgs && cfgs[0];
    if (!cfg || !cfg.link) return;
    try {
      fetchSheetData(cfg, function (rows) {
        if (!rows || rows.length <= 1) return; // keep cache on empty/failure
        localStorage.setItem("wf-" + prefix + "-data", JSON.stringify(rows));
        _invalidateSheetRows(prefix);
        pushSheetDataToCloud(prefix, rows);
        document.dispatchEvent(new CustomEvent("wf-sync-complete"));
        try { renderStockEtfHoldingsTable(); renderEquityHoldingsTable(); } catch (e) {}
      }, function () {});
    } catch (e) {}
  }

  // The dashboard renders sheet data from the localStorage cache; the sheet CARDS
  // that re-fetch from the source live only on Settings. So on the dashboard,
  // re-sync every configured sheet in the background on load — otherwise rows added
  // elsewhere (e.g. a new portfolio) stay hidden behind a stale cache until the user
  // visits Settings. Stale-while-revalidate: the cached view is already on screen and
  // updates when the fresh data arrives. Guard: only run where the Settings sheet
  // cards are absent (i.e. the dashboard), so Settings isn't double-syncing.
  // Deferred via setTimeout so the field-constant `var`s (declared later in this
  // file) are assigned before the resync reads them, and wrapped in try/catch so a
  // resync error can never break the rest of the page.
  setTimeout(function () {
    try {
      if (document.getElementById("stocksetf-sheets-list")) return; // Settings page
      ["equity", "stocksetf", "fixedincome", "fd"].forEach(function (prefix) {
        try { resyncSheetPrefixFromCloud(prefix); } catch (e) {}
      });
      ["stocksetfmapping", "mfmapping"].forEach(function (prefix) {
        try { resyncMappingFromCloud(prefix); } catch (e) {}
      });
    } catch (e) {}
  }, 1500);

  var equityRefreshNavBtn = document.getElementById("equity-refresh-nav");
  if (equityRefreshNavBtn) {
    equityRefreshNavBtn.addEventListener("click", function () {
      var originalLabel = equityRefreshNavBtn.textContent;
      equityRefreshNavBtn.disabled = true;
      equityRefreshNavBtn.textContent = "Triggering…";

      // Drop every cached NAV/price payload — IndexedDB and in-memory included, not
      // just the localStorage keys these caches used to live in — then re-render, so
      // the button changes what is on screen rather than only queueing a workflow.
      clearMarketDataCaches().then(function () {
        try {
          renderValueChart();
          updateDashboardStats();
          renderEquityHoldingsTable();
        } catch (e) {}
      });

      // Restore the button to its resting label after showing the outcome.
      function resetNavBtn(delay) {
        setTimeout(function () {
          equityRefreshNavBtn.disabled = false;
          equityRefreshNavBtn.textContent = originalLabel;
        }, delay);
      }

      // Trigger AMFI NAV and ISIN Map workflows via GitHub API if credentials are saved
      var gh = loadGhSettings();
      if (gh.owner && gh.repo && gh.token) {
        var apiBase = "https://api.github.com/repos/" + gh.owner + "/" + gh.repo + "/actions/workflows/";
        var headers = { "Authorization": "Bearer " + gh.token, "Accept": "application/vnd.github+json", "Content-Type": "application/json" };
        var branch = gh.branch || "main";
        var body = JSON.stringify({ ref: branch });
        // update-mf-history.yml too: it is what rebuilds the bundled NAV history,
        // so leaving it out would refresh today's NAV while the history the charts
        // are drawn from stayed as it was.
        Promise.all(["update-amfi-nav.yml", "update-amfi-isin-map.yml", "update-mf-history.yml"].map(function (wf) {
          return fetch(apiBase + wf + "/dispatches", { method: "POST", headers: headers, body: body })
            .then(function (r) { return r.ok; })
            .catch(function () { return false; });
        })).then(function (results) {
          var okCount = results.filter(Boolean).length;
          // Reflect real dispatch status instead of always claiming success —
          // an expired/invalid PAT returns 401/404 and should not read as "Triggered".
          // Set the final state from INSIDE the promise so it is never clobbered by a
          // blind timer; keep it visible for a few seconds before restoring the label.
          equityRefreshNavBtn.textContent = okCount === results.length
            ? "Triggered ✓"
            : (okCount > 0 ? "Partly triggered" : "Trigger failed — check GitHub token");
          resetNavBtn(4000);
        });
      } else {
        equityRefreshNavBtn.textContent = "Set GitHub token in Settings";
        resetNavBtn(3000);
      }

      // Re-render dashboard surfaces if they exist (this button also lives on the
      // Settings page, where these dashboard elements are absent).
      try {
        if (document.getElementById("value-chart")) {
          updateDashboardStats();
          renderValueChart();
          renderEquityHoldingsTable();
          renderStockEtfHoldingsTable();
          renderMarketSegmentChart();
          renderMutualFundPortfolioSplitChart();
          renderInvestmentSplitChart();
          renderInstrumentSplitChart();
        }
      } catch (e) {}
    });
  }

  // "Refresh Price" (Stocks/ETF tab) — dispatch only the stock-price workflow
  // and re-fetch stock/ETF current values.
  var stocksetfRefreshPriceBtn = document.getElementById("stocksetf-refresh-price");
  if (stocksetfRefreshPriceBtn) {
    stocksetfRefreshPriceBtn.addEventListener("click", function () {
      var originalLabel = stocksetfRefreshPriceBtn.textContent;
      stocksetfRefreshPriceBtn.disabled = true;
      stocksetfRefreshPriceBtn.textContent = "Triggering…";

      // Clear cached stock prices so current values re-fetch fresh.
      localStorage.removeItem("wf-stock-prices-json");

      function resetPriceBtn(delay) {
        setTimeout(function () {
          stocksetfRefreshPriceBtn.disabled = false;
          stocksetfRefreshPriceBtn.textContent = originalLabel;
        }, delay);
      }

      var gh = loadGhSettings();
      if (gh.owner && gh.repo && gh.token) {
        var apiBase = "https://api.github.com/repos/" + gh.owner + "/" + gh.repo + "/actions/workflows/";
        var headers = { "Authorization": "Bearer " + gh.token, "Accept": "application/vnd.github+json", "Content-Type": "application/json" };
        var body = JSON.stringify({ ref: gh.branch || "main" });
        fetch(apiBase + "fetch_stock_prices.yml/dispatches", { method: "POST", headers: headers, body: body })
          .then(function (r) {
            // Final state set from inside the promise so it survives (not clobbered
            // by a blind timer); shown for a few seconds, then the label restores.
            stocksetfRefreshPriceBtn.textContent = r.ok ? "Triggered ✓" : "Trigger failed — check GitHub token";
            resetPriceBtn(4000);
          })
          .catch(function () {
            stocksetfRefreshPriceBtn.textContent = "Trigger failed — check GitHub token";
            resetPriceBtn(4000);
          });
      } else {
        stocksetfRefreshPriceBtn.textContent = "Set GitHub token in Settings";
        resetPriceBtn(3000);
      }

      // Re-render Stocks/ETF surfaces with cleared cache (dashboard only).
      try {
        if (document.getElementById("value-chart")) {
          updateDashboardStats();
          renderStockEtfHoldingsTable();
          renderMarketSegmentChart();
        }
      } catch (e) {}
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
    // fetchFailures counts only sheets that were valid but failed to LOAD (timeout,
    // private, network) — NOT statically-invalid configs. Callers use this to decide
    // whether a merge is a transient partial fetch (keep last-known-good) vs a
    // complete result that happens to sit alongside a permanently-bad config entry.
    var fetchFailures = 0;
    if (!validIndexes.length) {
      onComplete(null, failures, [], perSheetStats, fetchFailures);
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
      onComplete(merged, failures, failureReasons, perSheetStats, fetchFailures);
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
          fetchFailures += 1;
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
    // Single-sheet cards (the mapping sheets) historically stored their config only
    // under the legacy -sheet-link / -header-row keys, which settings-sync does not
    // upload (it syncs wf-<prefix>-sheets). Mirror the config into that array form so
    // the mapping URL round-trips to other devices like the transaction sheets do.
    var sheetsKey = "wf-" + prefix + "-sheets";
    function writeSheetsMirror(url, headerRow) {
      try {
        if (!url) { localStorage.removeItem(sheetsKey); return; }
        var entry = { link: url, headerRow: headerRow || "1" };
        // File uploads have no fetchable URL, so carry the parsed rows in the mirror
        // (exactly like the multi-sheet cards) — otherwise the file can't round-trip
        // to other devices. Mapping files are small; cap defensively regardless.
        if (url.indexOf("📎") !== -1 && _localData && _localData.length > 1) {
          entry.localData = _localData.length > 50000 ? _localData.slice(0, 50000) : _localData;
        }
        localStorage.setItem(sheetsKey, JSON.stringify([entry]));
      } catch (e) {}
    }
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
          // Mirror the uploaded config (incl. parsed rows) into the synced array form
          // and notify Settings so it uploads — lets a file-based mapping round-trip.
          writeSheetsMirror(sheetLinkInput.value, headerRow);
          document.dispatchEvent(new CustomEvent("wf-settings-saved"));
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
      _invalidateSheetRows(prefix);
      pushSheetDataToCloud(prefix, rows);
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

    var savedLink = null;
    var savedHeaderRow = null;
    // Cross-device: the mapping config's source of truth is the synced
    // wf-<prefix>-sheets array (settings-sync). PREFER it over the legacy
    // -sheet-link / -header-row keys so a URL/header change made on another device
    // propagates here even when a stale legacy config is present locally. Fall back
    // to the legacy keys only when no mirror exists yet (pre-migration devices).
    try {
      var arr = JSON.parse(localStorage.getItem(sheetsKey) || "null");
      if (Array.isArray(arr) && arr[0] && arr[0].link) {
        savedLink = arr[0].link;
        savedHeaderRow = arr[0].headerRow || localStorage.getItem(headerRowKey);
        // Rehydrate an uploaded file's parsed rows so a file-based mapping
        // reconnects on a fresh device without re-uploading.
        if (arr[0].localData && arr[0].localData.length > 1) {
          _localData = arr[0].localData;
          try { localStorage.setItem(localDataKey, JSON.stringify(_localData)); } catch (e) {}
        }
        localStorage.setItem(storageKey, savedLink);
        if (savedHeaderRow) localStorage.setItem(headerRowKey, savedHeaderRow);
      }
    } catch (e) {}
    if (!savedLink) {
      savedLink = localStorage.getItem(storageKey);
      savedHeaderRow = localStorage.getItem(headerRowKey);
    }
    // Fallback: a file-based mapping whose rows didn't ride along in the settings
    // mirror can still recover them from the synced sheet-data cache (wf-<prefix>-data).
    if (savedLink && savedLink.indexOf("📎") !== -1 && (!_localData || _localData.length <= 1)) {
      try {
        var cachedData = JSON.parse(localStorage.getItem("wf-" + prefix + "-data") || "null");
        if (Array.isArray(cachedData) && cachedData.length > 1) _localData = cachedData;
      } catch (e) {}
    }
    if (savedHeaderRow && headerRowInput) headerRowInput.value = savedHeaderRow;
    if (savedLink) {
      sheetLinkInput.value = savedLink;
      // Backfill the array mirror for existing users whose config predates mapping
      // settings-sync. If it wasn't already present, upload it now so the mapping
      // config reaches the cloud without waiting for a manual re-sync.
      if (!localStorage.getItem(sheetsKey)) {
        writeSheetsMirror(savedLink, savedHeaderRow);
        document.dispatchEvent(new CustomEvent("wf-settings-saved"));
      }
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
        _invalidateSheetRows(prefix);
        sheetTableWrap.hidden = true;
        setStatus("", false);
        setConnected(false);
        meta.hidden = true;
        updateDashboardStats();
      }
      if (headerRowInput) localStorage.setItem(headerRowKey, headerRowInput.value || "1");
      // Mirror into the synced array form and notify Settings so saveSettingsToCloud
      // uploads the mapping config to the cloud (round-trips to other devices).
      writeSheetsMirror(url, headerRowInput ? headerRowInput.value : "1");
      document.dispatchEvent(new CustomEvent("wf-settings-saved"));
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
          _invalidateSheetRows(prefix);
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
        _invalidateSheetRows(prefix);
        updateDashboardStats();
        updateRefreshButtonStatus(prefix);
        setStatus("Add at least one sheet link (Google Sheets, OneDrive, or CSV).", true);
        sheetTableWrap.hidden = true;
        setConnected(false);
        return;
      }
      setStatus("Verifying and syncing " + configs.length + " sheet(s)…", false);

      fetchAndMergeSheets(configs, function (merged, failures, failureReasons, perSheetStats, fetchFailures) {
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
        _invalidateSheetRows(prefix);
        // Only a fetch-clean merge reaches the shared cloud cache (see resync note)
        // so a partial fetch can't clobber a fuller blob other devices seed from.
        // Gate on fetchFailures, not total failures, so a bad config entry beside
        // valid sheets doesn't permanently block the cloud push.
        if (!fetchFailures) pushSheetDataToCloud(prefix, merged);
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
  // Pushed for the same reason the stocks mapping is: the workflow that bundles
  // NAV history needs to know which schemes the user actually holds.
  initSheetCard("mfmapping", {}, function afterSync(rows) {
    if (rows && rows.length > 1) pushMappingToGitHub(rows, "mfmapping.json");
  });

  // ─── GitHub integration: push stocksetf_mapping.json after every mapping sync ──
  function loadGhSettings() {
    return {
      owner:  localStorage.getItem("wf-gh-owner")  || "",
      repo:   localStorage.getItem("wf-gh-repo")   || "",
      branch: localStorage.getItem("wf-gh-branch") || "",
      token:  localStorage.getItem("wf-gh-token")  || ""
    };
  }

  // Visible, non-console status for the GitHub mapping push so users can see
  // success/failure without opening DevTools (esp. on mobile).
  function showGhToast(msg, ok) {
    var t = document.getElementById("gh-push-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "gh-push-toast";
      t.style.cssText =
        "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);" +
        "z-index:9999;max-width:88vw;padding:10px 16px;border-radius:10px;" +
        "font:600 0.85rem/1.3 system-ui,sans-serif;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,0.25);";
      document.body.appendChild(t);
    }
    t.style.background = ok ? "#1a9e6e" : "#c0392b";
    t.textContent = msg;
    t.style.display = "block";
    clearTimeout(showGhToast._h);
    showGhToast._h = setTimeout(function () { t.style.display = "none"; }, 6000);
  }

  function pushMappingToGitHub(rows, fileName) {
    var gh = loadGhSettings();
    if (!gh.owner || !gh.repo || !gh.token) {
      showGhToast("GitHub push skipped: set owner, repo & token in Settings.", false);
      return; // not configured
    }
    var content = btoa(unescape(encodeURIComponent(JSON.stringify(rows))));
    var file = fileName || "stocksetf_mapping.json";
    var apiBase = "https://api.github.com/repos/" + gh.owner + "/" + gh.repo + "/contents/" + file;
    var headers = { "Authorization": "Bearer " + gh.token, "Content-Type": "application/json", "Accept": "application/vnd.github+json" };
    // GET current SHA (needed for update)
    fetch(apiBase + (gh.branch ? "?ref=" + encodeURIComponent(gh.branch) : ""), { headers: headers })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (existing) {
        // Skip the push when the file already matches — avoids a redundant commit
        // (and the Pages deploy + price-fetch run it would trigger) on every load.
        if (existing && typeof existing.content === "string" &&
            existing.content.replace(/\s/g, "") === content) {
          showGhToast("✓ Mapping already up to date.", true);
          return null;
        }
        var body = { message: "chore: update " + file, content: content };
        if (gh.branch) body.branch = gh.branch;
        if (existing && existing.sha) body.sha = existing.sha;
        return fetch(apiBase, { method: "PUT", headers: headers, body: JSON.stringify(body) });
      })
      .then(function (r) {
        if (r === null) return; // no push needed (already up to date)
        if (r && (r.status === 200 || r.status === 201)) {
          dbg("stocksetf_mapping.json pushed to GitHub successfully.");
          showGhToast("✓ Mapping pushed to GitHub.", true);
        } else {
          console.warn("GitHub push returned status", r && r.status);
          showGhToast("GitHub push failed: HTTP " + (r && r.status) +
            ((r && r.status === 404) ? " (check branch name / repo access)" :
             (r && r.status === 403) ? " (token needs Contents: write)" :
             (r && r.status === 401) ? " (token invalid or expired)" : ""), false);
        }
      })
      .catch(function (err) {
        console.warn("GitHub push failed:", err);
        showGhToast("GitHub push error: " + (err && err.message || err), false);
      });
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
  // NAV history is IMMUTABLE once published: the NAV a fund reported in 2019 is
  // still that number today. It used to be cached in localStorage under a 24-hour
  // expiry, so the first load of every day threw away eight years of unchanging
  // prices and re-downloaded all of it — 18 funds measured at 2.61 MB, against a
  // measured localStorage quota of 4.94 MB. Past about 34 funds the write failed,
  // and because the write is wrapped in a bare catch it failed SILENTLY: nothing
  // was ever cached again and every refresh refetched everything.
  //
  // So: keep it in IndexedDB (async, roomy, stores Dates as Dates with no JSON at
  // all), and stop expiring it on a clock. Freshness does not need an expiry —
  // amfi_nav.json already carries today's NAV for all 14,222 schemes and
  // withAmfiNavOverride already appends it, so the tail is covered without asking
  // mfapi.in for anything.
  var NAV_CACHE_PREFIX = "wf-nav-cache-";     // legacy localStorage; swept below
  var NAV_IDB_PREFIX = "nav:";
  // AMFI does occasionally restate a NAV it has already published. Two things
  // catch that. First, cheaply and immediately: amfi_nav.json gives a (date, nav)
  // per scheme, and if we already hold that date with a DIFFERENT nav then the
  // series has been corrected under us and is refetched. Second, as a backstop for
  // any restatement further back than that one date, the whole series is refetched
  // if it is older than this — rare enough to cost nothing, often enough that
  // drift cannot live forever.
  var NAV_HISTORY_BACKSTOP_MS = 30 * 24 * 60 * 60 * 1000;
  // A NAV is published to 4dp; anything above this is a real restatement rather
  // than a float artefact of round-tripping through storage.
  var NAV_RESTATEMENT_EPSILON = 0.0005;

  // One-time reclaim of the megabytes the old localStorage cache is holding.
  // Without this the quota stays full and every OTHER localStorage write —
  // sheet data, settings — keeps failing for as long as the entries sit there.
  function _sweepLegacyNavCache() {
    try {
      var doomed = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(NAV_CACHE_PREFIX) === 0) doomed.push(k);
      }
      doomed.forEach(function (k) { localStorage.removeItem(k); });
      if (doomed.length) dbg("[NAV] reclaimed " + doomed.length + " legacy localStorage entries");
    } catch (e) {}
  }
  _sweepLegacyNavCache();

  // Resolved series for this page session.
  //
  // The IndexedDB write is fire-and-forget, so a later render pass can ask for a
  // scheme before the previous pass's write has landed — and fetch it again.
  // Measured on an 18-fund portfolio: without this, a refresh made 72 NAV requests
  // (four render passes x 18 schemes) instead of none. A single-scheme test cannot
  // see it, because one scheme resolves long before the next pass starts; it only
  // appears once enough schemes are in flight to push the writes behind the reads.
  var _navSessionCache = {};

  // "Refresh NAV" has to actually clear the caches, and they no longer all live in
  // localStorage: the per-scheme NAV histories, the two AMFI maps, the MF history
  // bundle and the stock prices are IndexedDB entries now. Clearing the old
  // localStorage keys alone silently does nothing — the button would report success
  // and serve exactly the same figures.
  //
  // The in-memory session state has to go too, or the re-render that follows reads
  // the promises already resolved on this page and nothing changes until a reload.
  function clearMarketDataCaches() {
    _navSessionCache = {};
    _navHistoryPromises = {};
    _amfiNavMapSessionPromise = null;
    _amfiIsinMapPromise = null;
    _mfHistoryPromise = null;
    _stockMergedCache = null;
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf(NAV_CACHE_PREFIX) === 0) localStorage.removeItem(k);  // pre-IDB leftovers
      });
      localStorage.removeItem("wf-stock-prices-json");
    } catch (e) {}
    if (!window.WfIdb) return Promise.resolve();
    // By PREFIX, not by a list of keys. Every bulky market payload is stored under
    // BLOB_CACHE_PREFIX — both AMFI maps, stock prices, stock history, the MF
    // history bundle — so this cannot miss one by forgetting to add it here, which
    // is exactly what the enumerated list did. The expense snapshot is keyed
    // differently and is not market data, so it is left alone.
    return Promise.all([
      WfIdb.removePrefix(NAV_IDB_PREFIX),
      WfIdb.removePrefix(BLOB_CACHE_PREFIX)
    ]).then(function () {}, function () {});
  }

  function _navCacheGet(schemeCode) {
    if (_navSessionCache[schemeCode]) {
      return Promise.resolve({ data: _navSessionCache[schemeCode], _session: true });
    }
    if (!window.WfIdb) return Promise.resolve(null);
    return WfIdb.get(NAV_IDB_PREFIX + schemeCode).then(function (entry) {
      if (!entry || !entry.data || !entry.data.length) return null;
      return entry;
    }).catch(function () { return null; });
  }
  function _navCacheSet(schemeCode, data) {
    if (!data || !data.length) return;
    _navSessionCache[schemeCode] = data;
    if (!window.WfIdb) return;
    // Structured clone keeps the Date objects, so there is no parse on read and no
    // stringify on write — the whole reason this moved off localStorage.
    try { WfIdb.set(NAV_IDB_PREFIX + schemeCode, { fetchedAt: Date.now(), data: data }); } catch (e) {}
  }

  // Has AMFI restated a NAV we already hold? Uses the map that is downloaded
  // anyway, so this costs one lookup rather than a request.
  function _navSeriesWasRestated(schemeCode, series) {
    return fetchAmfiNavMap().then(function (navMap) {
      var entry = navMap && navMap[schemeCode];
      if (!entry) return false;
      var d = parseAmfiNavDate(entry.date);
      var nav = parseNumber(entry.nav);
      if (!d || !nav) return false;
      var t = d.getTime();
      for (var i = series.length - 1; i >= 0; i--) {
        var pt = series[i];
        if (!pt || !pt.date) continue;
        var pt_t = pt.date.getTime();
        if (pt_t < t) break;               // sorted ascending: past the date, stop
        if (pt_t !== t) continue;
        return Math.abs(pt.nav - nav) > NAV_RESTATEMENT_EPSILON;
      }
      return false;                        // date not held yet — an append, not a restatement
    }).catch(function () { return false; });
  }

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
      dbg("[NAV] scheme " + schemeCode + ": applying newer AMFI NAV", { date: amfiDate, nav: amfiNav });
      return data.concat([{ date: amfiDate, nav: amfiNav }]);
    });
  }

  // In-flight dedup: on a cold cache the same scheme is requested by several
  // render paths simultaneously (value chart, benchmark, overview). Without
  // this, each fires an identical api.mfapi.in request. Keyed by schemeCode;
  // cleared when the fetch settles.
  var _navHistoryPromises = {};

  // Resolve the base NAV history (cache-or-fetch), deduped across concurrent callers.
  // ─── The bundle ────────────────────────────────────────────────────────────
  // mf_history.json holds every mapped fund's history in one same-origin file,
  // built nightly by fetch_mf_history.py. Without it a cold load asks
  // api.mfapi.in for one fund at a time — eighteen requests for an eighteen-fund
  // portfolio, per user, per day, against a free community service. The stocks
  // side has worked this way for a while; this is the same arrangement for funds.
  //
  // It is strictly an optimisation. A fund missing from it — newly added, or the
  // nightly job has not run since it was mapped — falls through to the per-fund
  // request exactly as before, so a repo with no bundle at all still works.
  var MF_HISTORY_STATIC_FILE = "mf_history.json";
  var MF_HISTORY_CACHE_KEY = "wf-mf-history-static";
  var MF_HISTORY_MAX_AGE_MS = 12 * 60 * 60 * 1000;
  var _mfHistoryPromise = null;

  function fetchMfHistoryBundle() {
    if (_mfHistoryPromise) return _mfHistoryPromise;
    _mfHistoryPromise = _blobCacheGet(MF_HISTORY_CACHE_KEY, MF_HISTORY_MAX_AGE_MS).then(function (cached) {
      if (cached && cached.data) return cached.data;
      return fetch(MF_HISTORY_STATIC_FILE, { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (payload) {
          var map = (payload && payload.mf_history) || null;
          if (map && Object.keys(map).length) {
            _blobCacheSet(MF_HISTORY_CACHE_KEY, { data: map });
            return map;
          }
          return {};
        })
        .catch(function () { return {}; });     // no bundle in this repo — fine
    }).catch(function () { return {}; });
    return _mfHistoryPromise;
  }

  // { "YYYY-MM-DD": nav } -> the [{date, nav}] shape the rest of the app expects,
  // ascending, which is what every consumer assumes.
  function _navSeriesFromBundle(byIso) {
    var out = [];
    Object.keys(byIso).forEach(function (iso) {
      var parts = String(iso).split("-");
      if (parts.length !== 3) return;
      var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      var nav = parseNumber(byIso[iso]);
      if (d && nav) out.push({ date: d, nav: nav });
    });
    out.sort(function (a, b) { return a.date - b.date; });
    return out;
  }

  // The 30-day backstop is a routine re-read with nothing urgent about it, so it
  // may come from the bundle: one request covers every fund that is due, instead of
  // one each. A restatement does NOT come through here — see the call site.
  function _navRefresh(schemeCode) {
    return _navFetchFromBundle(schemeCode).then(function (fromBundle) {
      return fromBundle || _navFetchFromNetwork(schemeCode);
    });
  }

  function _navFetchFromBundle(schemeCode) {
    return fetchMfHistoryBundle().then(function (map) {
      var byIso = map && map[schemeCode];
      if (!byIso) return null;
      var series = _navSeriesFromBundle(byIso);
      if (!series.length) return null;
      // Stored per scheme like a network result, so later loads read the small
      // per-fund entry and never touch the bundle again.
      _navCacheSet(schemeCode, series);
      return series;
    }).catch(function () { return null; });
  }

  function _navFetchFromNetwork(schemeCode) {
    return fetch("https://api.mfapi.in/mf/" + schemeCode)
      .then(function (res) { return res.json(); })
      .then(function (json) {
        var data = (json.data || [])
          .map(function (entry) { return { date: parseMfApiDate(entry.date), nav: parseNumber(entry.nav) }; })
          .filter(function (entry) { return entry.date; })
          .sort(function (a, b) { return a.date - b.date; });
        _navCacheSet(schemeCode, data);
        return data;
      })
      .catch(function (err) {
        console.error("Failed to fetch NAV history for scheme " + schemeCode + ":", err);
        return [];
      });
  }

  function fetchNavHistoryBase(schemeCode) {
    // The dedup has to wrap the CACHE READ too, not just the network call. The read
    // is async now, so without this every render path that wants the same scheme
    // arrives before IndexedDB answers, all miss, and all fetch — which is the
    // stampede the cache exists to prevent.
    if (_navHistoryPromises[schemeCode]) return _navHistoryPromises[schemeCode];

    var p = _navCacheGet(schemeCode).then(function (cached) {
      if (!cached) {
        return _navFetchFromBundle(schemeCode).then(function (fromBundle) {
          return fromBundle || _navFetchFromNetwork(schemeCode);
        });
      }
      // Already resolved this load, so it has been through the checks below once.
      if (cached._session) return cached.data;
      if (Date.now() - (cached.fetchedAt || 0) >= NAV_HISTORY_BACKSTOP_MS) {
        return _navRefresh(schemeCode);
      }
      return _navSeriesWasRestated(schemeCode, cached.data).then(function (restated) {
        if (!restated) { _navSessionCache[schemeCode] = cached.data; return cached.data; }
        // Straight to mfapi, NOT the bundle. The bundle is rebuilt nightly, so it
        // can easily be older than the correction — serving it here would re-cache
        // the stale series and the restatement would be detected again on the next
        // load, and the next, until the bundle caught up.
        dbg("[NAV] scheme " + schemeCode + ": AMFI restated a held NAV — refetching");
        return _navFetchFromNetwork(schemeCode);
      });
    })
      .then(function (data) { delete _navHistoryPromises[schemeCode]; return data; },
            function (e) { delete _navHistoryPromises[schemeCode]; throw e; });

    _navHistoryPromises[schemeCode] = p;
    return p;
  }

  function fetchNavHistory(schemeCode) {
    return fetchNavHistoryBase(schemeCode).then(function (data) {
      return withAmfiNavOverride(schemeCode, data);
    });
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

  // Returns the FRESHER of the static JSON file (on Pages) and the Supabase
  // market_data row for an AMFI map. Both hold { fetchedAt|updated_at, data:map };
  // Supabase (written by the daily workflow, no deploy needed) wins ties. Either
  // source failing falls back to the other. Resolves to the map (or null).
  // Source of each market_data feed on the last resolution: 'supabase' | 'static'
  // (+ the timestamp used), so the UI can show a "Live" indicator.
  function getMarketSource(key) { return _marketSource[key] || null; }
  // Record the stock_prices source (set on the data object by fetchAllStockPrices)
  // into _marketSource so the Stocks/ETF "Price Updated" pill can badge it.
  function _rememberPriceSource(data) {
    if (!data || !data._liveSource) return;
    _marketSource["stock_prices"] = { source: data._liveSource, at: data._liveUpdated || data.updated || null };
  }

  function _fetchAmfiMapHybrid(staticFile, marketKey) {
    var staticP = fetch(staticFile, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    var liveP = (window.WfAuth && WfAuth.loadMarketData)
      ? WfAuth.loadMarketData(marketKey).catch(function () { return null; })
      : Promise.resolve(null);
    return Promise.all([staticP, liveP]).then(function (res) {
      var sp = res[0], row = res[1];
      var chosen = null, chosenTs = -1, src = null, srcTs = null;
      if (sp && sp.data && Object.keys(sp.data).length) { chosen = sp.data; chosenTs = sp.fetchedAt || 0; src = "static"; srcTs = sp.fetchedAt || null; }
      if (row && row.data && Object.keys(row.data).length) {
        var liveTs = row.updated_at ? Date.parse(row.updated_at) : 0;
        if (!chosen || liveTs >= chosenTs) { chosen = row.data; src = "supabase"; srcTs = row.updated_at || null; dbg("[AMFI] using live Supabase", marketKey, row.updated_at); }
      }
      if (src) _marketSource[marketKey] = { source: src, at: srcTs };
      return chosen;
    });
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

  // Session snapshot of the resolved NAV map. Without this, fetchAmfiNavMap
  // re-runs the static-vs-Supabase hybrid on every caller, and because the live
  // Supabase branch only becomes available once WfAuth finishes initializing,
  // the map can resolve one way early in the load (static file) and a different,
  // fresher way later (Supabase snapshot with a newer NAV date). withAmfiNavOverride
  // then appends the newer point on the later pass, shifting the day-change baseline
  // and making the Overview MF day change oscillate (e.g. -9,310 -> +891) between
  // renders. Pinning the first non-empty resolution for the page session guarantees
  // the Overview and the portfolio cards read the SAME NAV map, so day change is stable.
  var _amfiNavMapSessionPromise = null;
  function fetchAmfiNavMap() {
    // The cache read is async now, so it lives INSIDE the pinned session promise —
    // otherwise two callers arriving before IDB answers would both miss and both
    // run the hybrid, which is exactly the race the pin exists to prevent.
    if (_amfiNavMapSessionPromise) return _amfiNavMapSessionPromise;

    var p = _blobCacheGet(AMFI_NAV_MAP_CACHE_KEY, AMFI_NAV_MAP_MAX_AGE_MS).then(function (cached) {
      if (cached && cached.data && Object.keys(cached.data).length) {
        if (cached.source) _marketSource["amfi_nav"] = cached.source; // restore source for the indicator
        return cached.data;
      }
      return _fetchAmfiMapHybrid(AMFI_NAV_MAP_STATIC_FILE, "amfi_nav").then(function (staticData) {
        if (staticData && Object.keys(staticData).length) {
          _blobCacheSet(AMFI_NAV_MAP_CACHE_KEY, { data: staticData, source: _marketSource["amfi_nav"] || null });
          return staticData;
        }
        // Empty result (both sources unavailable): don't pin it — let the next
        // caller retry so a transient miss doesn't freeze an empty map all session.
        _amfiNavMapSessionPromise = null;
        return {};
      });
    }, function (err) {
      _amfiNavMapSessionPromise = null;
      throw err;
    });

    _amfiNavMapSessionPromise = p;
    return p;
  }

  var _amfiIsinMapPromise = null;
  function fetchAmfiIsinToSchemeMap() {
    if (_amfiIsinMapPromise) return _amfiIsinMapPromise;
    _amfiIsinMapPromise = _blobCacheGet(AMFI_ISIN_MAP_CACHE_KEY, AMFI_ISIN_MAP_MAX_AGE_MS).then(function (cached) {
      if (cached && cached.data && Object.keys(cached.data).length) return cached.data;
      lastAmfiFetchFailures = [];
      return _fetchAmfiMapHybrid(AMFI_ISIN_MAP_STATIC_FILE, "amfi_isin").then(function (staticData) {
        if (staticData && Object.keys(staticData).length) {
          _blobCacheSet(AMFI_ISIN_MAP_CACHE_KEY, { data: staticData });
          return staticData;
        }
        lastAmfiFetchFailures.push("amfi_isin_map.json missing or empty");
        _amfiIsinMapPromise = null; // don't pin an empty map for the session
        return {};
      });
    }).catch(function (err) { _amfiIsinMapPromise = null; throw err; });
    return _amfiIsinMapPromise;
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
  // Memoised on the raw string. Every pass over a sheet re-parses the same date
  // cells — buildInstrumentUnitEvents, buildXirrCashFlows and
  // groupUnitTransactionsByInstrument each walk the whole sheet — and the fallback
  // path is the native Date parser, which is slow. 253 ms of self time in a profile
  // of one mobile load, on a few hundred distinct date strings.
  //
  // The cache stores the TIMESTAMP, not the Date: callers get a fresh object every
  // time, so nothing can mutate a shared one. Allocating a Date from a number is
  // far cheaper than parsing a string.
  // Created lazily inside the function, NOT by a `var` initialiser here: function
  // declarations hoist but assignments do not, and parseFlexibleDate is called
  // during module init from far above this point — a plain `var` left the memo
  // undefined for those calls and every one of them threw.
  var _dateParseMemo = null;
  var _dateParseMemoSize = 0;
  function parseFlexibleDate(value) {
    var str = String(value == null ? "" : value).trim();
    if (!str) return null;
    // `!_dateParseMemo`, not `=== null`: before the `var` initialiser below has run
    // the hoisted binding is UNDEFINED, and those early calls are exactly the ones
    // that must not throw.
    if (!_dateParseMemo) _dateParseMemo = Object.create(null);
    var hit = _dateParseMemo[str];
    if (hit !== undefined) return hit === null ? null : new Date(hit);
    var out = _parseFlexibleDateUncached(str);
    // A sheet has a bounded set of date strings; the bound is a safety valve for
    // pathological input, not an expected path.
    if (_dateParseMemoSize < 20000) {
      _dateParseMemo[str] = out === null ? null : out.getTime();
      _dateParseMemoSize++;
    }
    return out;
  }

  function _parseFlexibleDateUncached(str) {
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
      // split/bonus add units at zero cost — count them like buys so the unit
      // timeline (Overview MF current value, growth/benchmark charts) matches the
      // holdings tables, which already treat corporate actions as buys.
      var isCorpAction = (type === "split" || type === "bonus");
      var delta = (type.indexOf("buy") !== -1 || isCorpAction) ? units : (type.indexOf("sell") !== -1 ? -units : 0);
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
  // excludeBalance: when true, drop Investment Corpus / Savings Account ("balance")
  // rows but keep Provident Fund — used by the Account Value chart under the
  // "Exclude Savings/Investment" filter so it matches the Overview cards.
  function buildFdValueEvents(portfolioFilter, excludeBalance, includeFd) {
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
    var typeIdx = header.indexOf("transaction type");
    var maturityIdx = header.indexOf("maturity date/sell date");
    if (maturityIdx === -1) maturityIdx = header.indexOf("maturity date");
    if (portfolioIdx === -1 || bankIdx === -1 || instrumentIdx === -1 || subCategoryIdx === -1 || amountIdx === -1 || dateIdx === -1) return [];

    var entries = [];
    rows.slice(1).forEach(function (row, rowIdx) {
      var portfolio = (row[portfolioIdx] || "").trim();
      if (portfolioFilter !== "all" && normalizeText(portfolio) !== normalizeText(portfolioFilter)) return;
      if (categoryIdx !== -1 && normalizeText(row[categoryIdx]) !== "fixed income") return;
      var subCategory = normalizeText(row[subCategoryIdx]);
      var isBalance = (subCategory === "investment corpus" || subCategory === "savings account");
      var isPf = isProvidentFundSub(subCategory);
      var isFd = _fiIsTermDeposit(subCategory);
      if (!isBalance && !isPf && !(isFd && includeFd)) return;
      if (excludeBalance && isBalance) return; // keep PF, drop parked cash

      var date = parseFlexibleDate(row[dateIdx]);
      if (!date) return;
      var amount = parseNumber(row[amountIdx]);

      if (isFd) {
        // A Fixed Deposit holds its principal from purchase to maturity, then the
        // money leaves the FD (proceeds realized/reinvested). Model as +principal
        // at purchase and →0 at maturity via a per-row key. (Accrued interest is
        // omitted here — a minor understatement vs the headline, far better than
        // the FD being absent from the chart entirely.)
        var fdKey = "fd||" + rowIdx;
        entries.push({ date: date, key: fdKey, amount: amount });
        var mat = maturityIdx !== -1 ? parseFlexibleDate(row[maturityIdx]) : null;
        if (mat) entries.push({ date: mat, key: fdKey, amount: 0 });
        return;
      }

      if (isPf) {
        // PF rows are discrete deposits/withdrawals; a withdrawal REDUCES the running
        // balance. Previously every PF row was added positively (no type read), so a
        // withdrawal inflated the FI value on the chart and the XIRR opening mark.
        var type = typeIdx !== -1 ? normalizeText(row[typeIdx]) : "";
        if (type.indexOf("withdraw") !== -1) amount = -Math.abs(amount);
        entries.push({ date: date, key: "pf||" + rowIdx, amount: amount });
        return;
      }

      // Balance rows (savings/corpus) share a key per portfolio/bank/instrument so a
      // new balance replaces the old (running-balance snapshot).
      var key = normalizeText(portfolio) + "||" + normalizeText(row[bankIdx]) + "||" + normalizeText(row[instrumentIdx]);
      entries.push({ date: date, key: key, amount: amount });
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

  // A single dashboard load calls renderValueChart a dozen times — portfolio
  // select, benchmark apply, each sheet that finishes loading, the overview
  // flows event. Each call is a multi-second async chain, and every one that
  // is already obsolete by the time its data arrives still pays the full cost
  // of recomputing thousands of timeline points and rebuilding the charts.
  // Stamp each call with a generation and drop it at every async resumption
  // point once a newer call has started. The newest call is never superseded,
  // so the chart the user ends up looking at is always the complete one.
  // A completed render's inputs, so a later call that would recompute exactly the
  // same chart can stop instead. The generation guard next to this drops renders
  // that are SUPERSEDED while still in flight; this drops ones that are redundant
  // because nothing they read has changed since the last one finished. Measured on
  // an 18-fund / 6-stock / 8-year portfolio, a refresh built each value chart four
  // times and three of those were byte-identical to the one before.
  var _vcLastInputKey = null;

  var _vcGen = 0;
  // The Growth chart's inception year, so its period line can go back to
  // "SINCE <year>" when the zoom is reset without recomputing the series.
  var _avcInceptionYear = null;
  var _avcMonthFmt = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" });
  function renderValueChart() {
    var _vcMyGen = ++_vcGen;
    function _superseded() { return _vcMyGen !== _vcGen; }
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
      if (_superseded()) return null;
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
      // FI excluded → drop the whole FD series. Savings/Investment excluded →
      // drop only Investment Corpus + Savings Account (parked cash), keep PF,
      // matching the Overview cards.
      // includeFd=true: the Account Value chart shows total FI worth, so it needs
      // Fixed Deposits too (the XIRR opening-mark caller values FDs separately and
      // intentionally omits them here to avoid double-counting).
      var fdValueEventsAll = isFixedIncomeExcluded()
        ? []
        : buildFdValueEvents(selectedPortfolio, isSavingsInvestmentExcluded(), true);

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
            // The instrument name and region ride along with the events: the
            // Growth-of-₹100 contributions must be drawn from exactly the rows
            // this series values, and US rows need their FX conversion.
            events.instrument = instrument;
            events.region = region;
            seUnitEventsByTicker[ticker] = events;
          });
        }
      }
      var hasAnySE = Object.keys(seUnitEventsByTicker).length > 0;

      var currentGoldPricePromise = hasAnyCommodity
        ? fetchGoldPriceINRPerGram().catch(function () { return null; })
        : Promise.resolve(null);
      var stockPricesPromise = hasAnySE
        ? fetchAllStockPricesWithHistory().catch(function () { return { prices: {}, usd_inr_history: {} }; })
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
        if (_superseded()) return null;
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
        // The Account Value series layers the *All* fixed-income events (epfEventsAll /
        // fdValueEventsAll) on top of equity. Their dates must extend the timeline too —
        // otherwise fixed-income history that predates the first MF/Stocks/commodity
        // transaction (e.g. PF/EPF/FD started years earlier) falls off the left edge.
        epfEventsAll.forEach(function (entry) { allDates[dateKey(entry.date)] = entry.date; });
        fdValueEventsAll.forEach(function (entry) { allDates[dateKey(entry.date)] = entry.date; });
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
        // Growth-of-₹100 is an equity vs equity-index comparison, so it stays anchored
        // at the first MF/Stocks/commodity transaction. Capture that before extending
        // the window for fixed income below.
        var equityFirstTxnDate = firstTxnDate;
        // Account Value · Over Time must span the earliest date across ALL transactional
        // sheets. Fixed income (PF/EPF/FD/Savings) often starts years before the first
        // equity buy — extend firstTxnDate with the *All* FI events so that history is
        // plotted from its true start instead of being clipped to the equity inception.
        if (epfEventsAll.length) {
          var epfAllEarliest = epfEventsAll[0].date;
          var epfAllLatest = epfEventsAll[epfEventsAll.length - 1].date;
          if (!firstTxnDate || epfAllEarliest < firstTxnDate) firstTxnDate = epfAllEarliest;
          if (!lastTxnDate || epfAllLatest > lastTxnDate) lastTxnDate = epfAllLatest;
        }
        if (fdValueEventsAll.length) {
          var fdAllEarliest = fdValueEventsAll[0].date;
          var fdAllLatest = fdValueEventsAll[fdValueEventsAll.length - 1].date;
          if (!firstTxnDate || fdAllEarliest < firstTxnDate) firstTxnDate = fdAllEarliest;
          if (!lastTxnDate || fdAllLatest > lastTxnDate) lastTxnDate = fdAllLatest;
        }
        timeline = timeline.filter(function (d) { return d <= today && (!firstTxnDate || d >= firstTxnDate); });

        if (!timeline.length) {
          statusEl.hidden = false;
          statusEl.textContent = "No NAV history available yet for your mapped instruments.";
          return;
        }

        // Everything the rest of this render reads, in one string. If it matches the
        // last COMPLETED render and both charts are still on screen, the result
        // would be identical point for point, so there is nothing to do.
        //
        // Built from the RESOLVED data rather than from a change counter, so it
        // cannot miss an input by forgetting to bump something: the series lengths,
        // the instrument list, the price payload's own stamp and the Overview total
        // the last point snaps to are the inputs, and they are all here.
        var _inputKey = [
          selectedPortfolio,
          localStorage.getItem("wf-benchmark-index") || "NIFTY50",
          isFixedIncomeExcluded() ? 1 : 0,
          isSavingsInvestmentExcluded() ? 1 : 0,
          timeline.length, +timeline[0], +timeline[timeline.length - 1],
          instruments.length, instruments.join(","),
          Object.keys(seUnitEventsByTicker).sort().join(","),
          epfEvents.length, fdValueEvents.length, commodityGramEvents.length,
          epfEventsAll.length, fdValueEventsAll.length,
          navHistories.reduce(function (n, h) { return n + (h ? h.length : 0); }, 0),
          (stockPricesData && stockPricesData.updated) || "",
          Object.keys(allPrices).length,
          Math.round(getOverviewCurrentTotal() || 0)
        ].join("|");
        if (_vcLastInputKey === _inputKey &&
            window.__wfValueChart && window.__wfPortfolioValueChart) {
          statusEl.hidden = true;
          return null;
        }

        // Pre-compute each sorted series' value-at-or-before every timeline date in
        // one linear pass (WfMath.forwardFillOverTimeline), instead of a binary
        // search per (date × series). Turns this O(dates·series·log n) hot loop into
        // O(dates·series) — the chart's dominant render cost. Exact equivalence to
        // the previous lastAtOrBefore calls is unit-tested (test-math W1).
        var _ff = WfMath.forwardFillOverTimeline;
        var commodityGramsAt = _ff(commodityGramEvents, timeline, "cumulativeGrams");
        var goldPriceSeriesAt = _ff(goldPriceHistory, timeline, "price");
        var epfAt = _ff(epfEvents, timeline, "cumulativeValue");
        var fdAt = _ff(fdValueEvents, timeline, "cumulativeValue");
        var unitsAtByName = {}, navAtByName = {};
        instruments.forEach(function (name) {
          unitsAtByName[name] = _ff(unitEvents[name], timeline, "cumulativeUnits");
          navAtByName[name] = _ff(navByInstrument[name], timeline, "nav");
        });
        var seUnitsAtByTicker = {};
        var seTickers = Object.keys(seUnitEventsByTicker);
        seTickers.forEach(function (ticker) {
          seUnitsAtByTicker[ticker] = _ff(seUnitEventsByTicker[ticker], timeline, "cumulativeUnits");
        });

        var mfTradedUnits = buildTradedUnitsByDate(getSheetRows("equity"), selectedPortfolio);
        var seTradedUnits = buildTradedUnitsByDate(getSheetRows("stocksetf"), selectedPortfolio);

        // Everything below is loop-invariant: normalizeText() per (instrument ×
        // timeline point) and a fresh Object.keys() per point were the dominant
        // cost of the render on a multi-year, multi-instrument portfolio. Hoist
        // them so the per-point work is arithmetic and array indexing only.
        var instrumentList = instruments.slice();
        var mfUnitsByIdx = instrumentList.map(function (name) { return unitsAtByName[name]; });
        var mfNavByIdx = instrumentList.map(function (name) { return navAtByName[name]; });
        var mfTradedByIdx = instrumentList.map(function (name) { return mfTradedUnits[normalizeText(name)] || null; });
        var stockHistoryAll = (stockPricesData && stockPricesData.stock_history) || {};
        var seMeta = seTickers.map(function (ticker) {
          var hist = stockHistoryAll[ticker] || null;
          var live = allPrices[ticker] || null;
          return {
            units: seUnitsAtByTicker[ticker],
            histPrices: hist ? hist.prices : null,
            livePrice: live ? live.price : null,
            isUsd: hist ? hist.currency === "USD" : !!(live && live.currency === "USD"),
            traded: seTradedUnits[normalizeText(seUnitEventsByTicker[ticker].instrument || "")] || null,
          };
        });

        // Cash flow at each timeline point, marked at that point's own valuation.
        var flowAt = new Array(timeline.length).fill(0);

        var commodityValueAt = [];
        var points = timeline.map(function (date, i) {
          var activeGrams = commodityGramsAt[i] || 0;
          var goldPriceAtDate = goldPriceSeriesAt[i] || currentGoldPrice || 0;
          var commVal = activeGrams > 0 ? activeGrams * goldPriceAtDate : 0;
          commodityValueAt.push(commVal);
          var total = (epfAt[i] || 0) + (fdAt[i] || 0) + commVal;
          var dk = dateKey(date);
          for (var mi = 0; mi < instrumentList.length; mi++) {
            var units = mfUnitsByIdx[mi][i] || 0;
            var nav = mfNavByIdx[mi][i];
            if (units > UNITS_EPSILON && nav) total += units * nav;
            // The flow is valued at the SAME nav this instrument was just valued at,
            // so a purchase changes the unit count and never the unit price. Skipped
            // when there is no nav: the value series cannot see this instrument on
            // this date either, and counting money against value that is not there
            // is what put a permanent hole in the curve.
            if (!nav) continue;
            var traded = mfTradedByIdx[mi];
            if (traded && traded[dk]) flowAt[i] += traded[dk] * nav;
          }
          // Stocks/ETF: use historical price from stock_history when available, else current price.
          var dateStr = formatDateISO(date);
          for (var si = 0; si < seMeta.length; si++) {
            var meta = seMeta[si];
            var seUnits = meta.units[i] || 0;
            var price = meta.histPrices ? lookupIndexPrice(meta.histPrices, dateStr) : null;
            if (!price) price = meta.livePrice;
            if (!price) continue;
            var priceInr = meta.isUsd ? price * (usdInrHistMap[dateStr] || usdInrToday) : price;
            if (seUnits > UNITS_EPSILON) total += seUnits * priceInr;
            // Same rule, and the same INR price: the flow can never disagree with
            // the valuation, in magnitude or in currency. Deliberately NOT gated on
            // still holding units — the sale that takes a position to zero is
            // exactly the flow that must be counted, or the value would vanish with
            // nothing to explain it and the curve would read it as a total loss.
            var seTraded = meta.traded;
            if (seTraded && seTraded[dk]) flowAt[i] += seTraded[dk] * priceInr;
          }
          return { x: date, y: total };
        });

        statusEl.hidden = true;

        // Build a parallel points-all series that layers fixed-income /
        // savings on top of the equity value so the Account Value chart
        // reflects total portfolio worth respecting the exclusion toggles.
        var epfAllAt = _ff(epfEventsAll, timeline, "cumulativeValue");
        var fdAllAt = _ff(fdValueEventsAll, timeline, "cumulativeValue");
        var pointsAll = points.map(function (p, i) {
          var extra = (epfAllAt[i] || 0) + (fdAllAt[i] || 0);
          return { x: p.x, y: p.y + extra };
        });

        // Snap the last point to the Overview's authoritative Current total so
        // the chart's tail equals the Overview card exactly. Using
        // getOverviewCurrentTotal() (which gates by the FI toggle and falls back
        // seCurrent→seInvested, never →0) avoids dropping the Stocks/ETF value
        // when its live prices haven't finished loading yet. If the overview
        // isn't ready, keep the timeline's own last point (which already values
        // MF+SE at current prices) — and the overview-ready listener re-renders.
        (function snapLastPointToOverview() {
          if (!pointsAll.length) return;
          // Race guard: this callback runs after async NAV/price fetches; if the
          // user switched portfolio meanwhile, the store now holds the NEW portfolio's
          // totals while this series was built for the OLD one — snapping would
          // splice a wrong tail. Skip; the portfolio-change re-render supersedes.
          if ((localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all") !== selectedPortfolio) return;
          var overviewTotal = (typeof getOverviewCurrentTotal === "function") ? getOverviewCurrentTotal() : null;
          if (overviewTotal && overviewTotal > 0) {
            var li = pointsAll.length - 1;
            pointsAll[li] = { x: pointsAll[li].x, y: overviewTotal };
          }
        })();

        // Render the raw Account Value (₹) chart next to Growth-of-₹100.
        try { _renderPortfolioValueChart(pointsAll); } catch (e) {}

        // Keep the series the snapshot backfill reconstructs history from. Only
        // the unfiltered one: a backfill built from a single portfolio's line
        // would record one person's share as the household's net worth.
        // …and run the backfill off the back of it. The write path also tries,
        // but it fires seconds after the Overview settles, while this chart waits
        // on NAV and price history and can easily still be loading then — in
        // which case the backfill found no series and did nothing. Triggering it
        // from here means it runs whenever the series actually arrives, in
        // whichever order that happens.
        if (selectedPortfolio === "all") {
          _snapAccountValuePoints = pointsAll;
          _snapBackfillSoon();
        }

        var first = timeline[0], last = timeline[timeline.length - 1];
        if (rangeEl) rangeEl.textContent = first.toLocaleDateString() + " – " + last.toLocaleDateString();

        // The Account Value chart (rendered above from pointsAll) spans the full
        // timeline including pre-equity fixed-income history. The Growth-of-₹100 chart
        // below stays anchored at the equity inception so it isn't given a long empty
        // left gap before the first MF/Stocks/commodity transaction.
        var fullMinTime = (equityFirstTxnDate || first).getTime();
        var fullMaxTime = last.getTime();

        // === Growth-of-₹100 normalization + benchmark overlay ===
        var indexKey = localStorage.getItem("wf-benchmark-index") || "NIFTY50";
        var indexDisplayName = indexKey === "NIFTY50" ? "Nifty 50"
          : indexKey === "NIFTYNEXT50" ? "Nifty Next 50"
          : indexKey === "NIFTYMIDCAP150" ? "Nifty Midcap 150"
          : indexKey === "NIFTY500" ? "Nifty 500" : indexKey;

        // === Time-Weighted Return NAV computation ===
        // The cash flow at each timeline point, valued at THE SAME PRICE the value
        // series used for that instrument on that date.
        //
        // This is the whole point. The NAV moves by (value − flow) / prevValue, so
        // if the flow is measured with a different price from the value, the
        // difference is silently booked as profit or loss. It used to take the
        // amount straight off the sheet: buying 100 units recorded at ₹12 while the
        // fund's NAV that day was ₹10 subtracted ₹1,200 of flow against ₹1,000 of
        // new value, and the ₹200 gap became a permanent 20% hole in the curve.
        // Every purchase leaked a little, in whichever direction the recorded price
        // differed from the valuation, and the leaks compounded — which is how the
        // curve could sit below an index the portfolio's XIRR was beating.
        //
        // Marking the flow at the valuation price makes "money in creates units and
        // never moves the unit price" exactly true, which is what the model says.
        // For mutual funds it is also simply correct: an order fills AT that day's
        // NAV. For stocks it discards intraday movement between the trade and the
        // close, which is small and unbiased — unlike a recorded price that may be
        // an average, or carry brokerage.
        //
        // Fixed income (EPF/PF/FD/Savings) and commodity contribute neither value
        // nor flows here: Growth-of-₹100 is an equity vs equity-index comparison.
        // The dead branch that used to collect their cash flows is gone with the
        // contribEvents list it fed.
// Growth-of-₹100 value series = portfolio value with commodity (physical
        // gold/silver from the fd sheet) stripped out. Physical-gold purchases are
        // not tracked as contributions, so leaving their value in would make each
        // purchase look like instant growth. The ₹100 line is therefore a pure
        // MF + Stocks/ETF vs equity-index comparison (Fixed Income is already
        // excluded above). Commodity is still shown on the Account Value chart.
        var growthPoints = points.map(function (p, i) {
          return { x: p.x, y: p.y - (commodityValueAt[i] || 0) };
        });

        // Cumulative contributions at each timeline date, from the flows gathered in
        // the same pass that valued the portfolio — so the two can never disagree
        // about a price, a currency, or whether an instrument existed that day.
        var cumContribAt = new Array(points.length).fill(0);
        var runningContrib = 0;
        for (var pi = 0; pi < points.length; pi++) {
          runningContrib += flowAt[pi] || 0;
          cumContribAt[pi] = runningContrib;
        }

        // TWR NAV: start at 100 on the first day the portfolio has value, then
        // chain each period's return.
        //
        //   NAV(i) = NAV(i-1) × (value(i) − contributions(i)) / value(i-1)
        //
        // Subtracting the period's own cash flow from the ENDING value is what
        // makes the return time-weighted: money put in today has not earned
        // anything yet, so it must not count as growth. Exact here rather than an
        // approximation, because every transaction date is itself a timeline
        // point — a flow never straddles a period.
        //
        // This used to carry a unit count instead, buying units at the PREVIOUS
        // point's NAV. That is only right if the value did not move between the
        // two points, and it is wrong exactly when it matters most: a purchase on
        // a day the price jumped bought units at the stale NAV, permanently
        // diluting the series. A fund that doubled while being bought into read
        // ₹133 instead of ₹200 — and looked like it had LOST to an index that
        // rose half as much.
        // The recurrence itself lives in WfMath.twrNavSeries so it can be tested
        // against hand-computed cases; here it is only mapped back onto dates.
        var _twr = WfMath.twrNavSeries(
          growthPoints.map(function (p) { return p.y; }), cumContribAt);
        var basePortIdx = _twr.baseIndex === -1 ? growthPoints.length : _twr.baseIndex;
        var lastPortNorm = _twr.last;
        var normPortPoints = growthPoints.map(function (p, i) {
          return { x: p.x, y: _twr.nav[i] };
        });

        // Open the window where the curve actually starts, not at the first equity
        // transaction. The two are the same date only when every instrument held
        // then can be priced then. They are not when an instrument's price history
        // begins after it was bought — a fund bought in 2018 whose NAV history only
        // reaches back to 2021, a ticker that no longer resolves — because units
        // with no price contribute nothing, the portfolio reads as worthless, and
        // the curve cannot start until the prices do. The axis meanwhile still
        // spanned from the transaction, so the chart opened with years of empty
        // space to the left of its own first point and the period line named a
        // year nothing was drawn in.
        //
        // Anchoring on the first plotted point makes the axis, the period line and
        // the curve all read off the same date, so they cannot disagree.
        if (normPortPoints[basePortIdx] && normPortPoints[basePortIdx].x) {
          fullMinTime = normPortPoints[basePortIdx].x.getTime();
        }
        // And hand the chart only the points it can draw. Setting the window is not
        // enough on its own: a time scale derives its own range from the data, so
        // leading null points keep the axis anchored years before the curve if the
        // window is ever re-derived — on a resize, an update, or when the zoom
        // plugin is unavailable and the window has to be applied through the scale
        // options instead. Trimming the head makes the axis right by construction
        // rather than by a call that has to keep winning.
        var plotFrom = Math.max(0, Math.min(basePortIdx, normPortPoints.length));
        var plotPortPoints = plotFrom > 0 ? normPortPoints.slice(plotFrom) : normPortPoints;

        // Fetch index history and build normalized benchmark series aligned to portfolio dates.
        fetchIndexHistory().then(function (indexHistory) {
          if (_superseded()) return null;
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

          // Update header legend + period line with inception year. The title is a
          // fixed string; the line under it says which period is on screen.
          var inceptionYear = (points[basePortIdx] ? points[basePortIdx].x : first).getFullYear();
          _avcInceptionYear = inceptionYear;
          var periodEl = document.getElementById("avc-period");
          if (periodEl) periodEl.textContent = "SINCE " + inceptionYear;
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
          // A superseded index fetch resolves to null. Drawing on that would put
          // the Growth chart up with no benchmark and, worse, from a stale
          // render's data — so bail instead of falling through to the empty case.
          if (_superseded()) return;
          _renderNormalizedChart(idxResult ? idxResult.normIdxPoints : []);
        }).catch(function () {
          if (_superseded()) return;
          _renderNormalizedChart([]);
        });

        var calloutEl = document.getElementById("value-chart-callout");
        var calloutValueEl = document.getElementById("value-chart-callout-value");
        var calloutDateEl = document.getElementById("value-chart-callout-date");
        var rangePicker = document.getElementById("value-chart-range-picker");

        // The index series only exists once the benchmark fetch lands. Hold on to
        // it so the zoom readout can report the index at the window's edge too,
        // and not just the portfolio.
        var _avcIdxSeries = [];

        // Hover readout, replacing the floating tooltip: both series' figures land
        // in the header legend they already occupy, and the period line names the
        // date they belong to. Leaving the chart restores the zoom-window state.
        var _avcDayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
        var _avcHoverIdx = -1;
        function avcHover(els) {
          var idx = els && els.length ? els[0].index : -1;
          if (idx === _avcHoverIdx) return;   // fires on every pointer move
          _avcHoverIdx = idx;
          var pt = plotPortPoints[idx];
          if (idx < 0 || !pt) { updateVisibleRangeLabel(window.__wfValueChart); return; }
          var portEl = document.getElementById("avc-portfolio-value");
          if (portEl) portEl.textContent = pt.y != null ? "₹" + Math.round(pt.y) : "—";
          // The index is a separate series and may be shorter or have gaps, so it
          // is read at the hovered DATE rather than at the same array index.
          setAvcLegend("avc-index-value", _avcIdxSeries, pt.x.getTime());
          var per = document.getElementById("avc-period");
          if (per) per.textContent = _avcDayFmt.format(pt.x).toUpperCase();
        }
        // Assignment, not addEventListener: _renderNormalizedChart runs again on
        // every re-render and this canvas is reused, so a listener added each time
        // would stack up one handler per render.
        if (canvas) {
          canvas.onmouseleave = function () {
            _avcHoverIdx = -1;
            if (window.__wfValueChart) updateVisibleRangeLabel(window.__wfValueChart);
          };
        }

        function _renderNormalizedChart(normIdxPoints) {
        // Same trim, same offset, so the two datasets stay aligned point for point.
        normIdxPoints = (normIdxPoints || []).slice(plotFrom);
        _avcIdxSeries = normIdxPoints;
        if (window.__wfValueChart) window.__wfValueChart.destroy();
        var ctx = canvas.getContext("2d");
        var fillGradient = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 340);
        fillGradient.addColorStop(0, "rgba(16,185,129,0.22)");
        fillGradient.addColorStop(1, "rgba(16,185,129,0)");
        var datasets = [{
          label: "Portfolio",
          data: plotPortPoints,
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
            interaction: { intersect: false, mode: "index", axis: "x" },
            onHover: function (evt, els, chart) { avcHover(els); },
            scales: {
              x: {
                type: "time",
                // No fixed unit → Chart.js auto-selects the tick unit from the
                // visible range, so zooming in switches from years to months.
                // Identical to the Account Value chart's: the two sit side by side
                // and must not disagree about what a date looks like. displayFormats
                // is the whole specification — see the absent ticks block below.
                time: { minUnit: "day", displayFormats: { year: "yyyy", month: "MMM yy", day: "d MMM" } },
                // NOT min/max here. A hard bound on the scale options is re-applied
                // on every update, so the pan writes were undone as fast as they were
                // made and dragging this chart did nothing. The window is bounded by
                // the zoom plugin's own limits below, and opened through it instead.
                // No ticks block, exactly as on the Account Value chart. The callback
                // that used to live here relabelled every tick itself — bolded year
                // markers interleaved with bare month names — so the two charts
                // labelled dates differently. Chart.js formats both from
                // displayFormats now, so they match at every zoom by construction.
                grid: { display: false },
              },
              y: { ticks: { callback: function (v) { return "₹" + Math.round(v); } }, grid: { color: "rgba(150,150,150,0.12)" } }
            },
            plugins: {
              legend: { display: false },
              // Off. Portfolio and Index go in the card header instead — the same
              // place CASH FLOW · MONTHLY keeps its stats row — so both series
              // are read in one fixed spot rather than from a box that moves.
              tooltip: { enabled: false },
              zoom: {
                limits: {
                  // Clamp pan/zoom to the actually-plotted range so zooming OUT
                  // can't reveal empty space. Using lastTxnDate here let the view
                  // pan into the future because lastTxnDate is extended by
                  // fixed-income events (e.g. an FD's future maturity date).
                  x: { min: fullMinTime, max: fullMaxTime }
                },
                pan: {
                  // Off: the drag is handled by wireChartXDrag below, which needs no
                  // Hammer.js. Leaving both on would pan at twice the pointer speed.
                  enabled: false,
                  mode: "x"
                },
                zoom: {
                  wheel: { enabled: true },
                  pinch: { enabled: true },
                  mode: "x",
                  // Drag belongs to panning, not to box-select zooming; the two
                  // cannot share the gesture.
                  drag: { enabled: false },
                  onZoomComplete: function (ctx) { updateVisibleRangeLabel(ctx.chart); clearActiveRangePill(); }
                }
              }
            },
          }
        });
        // The opening window is the equity inception → last sample, narrower than
        // the plotted data when fixed income predates the first equity buy. Set
        // through the plugin it survives, and panning starts from here.
        setChartXWindow(window.__wfValueChart, fullMinTime, fullMaxTime);
        wireChartXDrag(canvas, function () { return window.__wfValueChart; },
          fullMinTime, fullMaxTime, function () {
            updateVisibleRangeLabel(window.__wfValueChart);
            clearActiveRangePill();
          });
        updateVisibleRangeLabel(window.__wfValueChart);
        // Both charts are now on screen for these inputs. Recorded here rather than
        // where the key is computed, so a render that throws or is superseded part
        // way through never claims to have finished.
        _vcLastInputKey = _inputKey;
        } // end _renderNormalizedChart

        function updateVisibleRangeLabel(chart) {
          var xScale = chart.scales.x;
          if (rangeEl) rangeEl.textContent = new Date(xScale.min).toLocaleDateString() + " – " + new Date(xScale.max).toLocaleDateString();
          // The period line follows the zoom: at rest it names the inception year,
          // zoomed it names the window. The title above it never changes.
          var lo = isFinite(xScale.min) ? xScale.min : fullMinTime;
          var hi = isFinite(xScale.max) ? xScale.max : fullMaxTime;
          var full = lo <= fullMinTime + 1 && hi >= fullMaxTime - 1;
          var periodEl3 = document.getElementById("avc-period");
          if (periodEl3) {
            periodEl3.textContent = full
              ? (_avcInceptionYear ? "SINCE " + _avcInceptionYear : "SINCE INCEPTION")
              : ("FROM " + new Date(lo).getFullYear() +
                 " · TO " + _avcMonthFmt.format(new Date(hi)).toUpperCase());
          }
          // Both legend figures follow the window, the same way Account Value's
          // does: what ₹100 had grown to at the RIGHT EDGE of what is on screen,
          // not what it is worth today. Zoomed to a window that ends in 2021, a
          // legend still reading today's figure describes a different chart from
          // the one being looked at.
          setAvcLegend("avc-portfolio-value", plotPortPoints, hi);
          setAvcLegend("avc-index-value", _avcIdxSeries, hi);
        }

        // Last plotted value at or before t. Deliberately "at or before" and
        // deliberately skipping nulls: it must name a value the series actually
        // has on screen, never one interpolated across a gap.
        function setAvcLegend(elId, series, t) {
          var el = document.getElementById(elId);
          if (!el) return;
          var hit = null;
          for (var i = 0; i < (series || []).length; i++) {
            var pt = series[i];
            if (!pt || pt.x.getTime() > t) break;
            if (pt.y != null) hit = pt;
          }
          el.textContent = hit ? "₹" + Math.round(hit.y) : "—";
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
          // Through the plugin, so panning afterwards starts from this window
          // instead of fighting a hard scale bound.
          setChartXWindow(chart, min, fullMaxTime);
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

      // The readout follows whatever window is on screen. Zoomed out it is the
      // current value; zoomed in — by wheel, pinch, drag, or a range pill — it is
      // the value at the right edge of the view plus the change across it, so
      // "what was I worth at the end of last month, and how did that month go" is
      // answerable by looking rather than by reading tooltips.
      var nameEl = document.getElementById("pvc-legend-name");
      var changeEl = document.getElementById("pvc-range-change");
      var _pvcMonthFmt = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" });
      function pvcValueAt(t) {
        // Last point at or before t — the value actually held then, not interpolated.
        var hit = null;
        for (var i = 0; i < points.length; i++) {
          if (points[i].x.getTime() <= t) hit = points[i]; else break;
        }
        return hit;
      }
      function updatePvcReadout() {
        var chart = window.__wfPortfolioValueChart;
        if (!chart || !points.length) return;
        var sc = chart.scales && chart.scales.x;
        var lo = sc && isFinite(sc.min) ? sc.min : pvcXMin;
        var hi = sc && isFinite(sc.max) ? sc.max : pvcXMax;
        var full = lo <= pvcXMin + 1 && hi >= pvcXMax - 1;
        var endPt = pvcValueAt(hi) || points[points.length - 1];
        var startPt = pvcValueAt(lo);
        if (lastEl) lastEl.textContent = "₹" + Math.round(endPt.y).toLocaleString("en-IN");
        // The period line under the title already names the window, so the legend
        // label stays a plain noun rather than repeating the month.
        if (nameEl) nameEl.textContent = full ? "Current Value" : "Value";
        var pvcPeriodEl = document.getElementById("pvc-period");
        if (pvcPeriodEl) {
          // The year the visible window opens in — taken from the first plotted
          // point inside it, not from the bound, so it names a year the chart is
          // actually showing data for.
          var firstVis = null;
          for (var fj = 0; fj < points.length; fj++) {
            if (points[fj].x.getTime() >= lo) { firstVis = points[fj]; break; }
          }
          pvcPeriodEl.textContent = full
            ? "OVER TIME"
            : ("FROM " + (firstVis ? firstVis.x : new Date(lo)).getFullYear() +
               " · TO " + _pvcMonthFmt.format(endPt.x).toUpperCase());
        }
        if (!changeEl) return;
        // A change needs two points to be a change. Zoomed to the full range there
        // is nothing to compare against, and the earliest point has no "before".
        if (full || !startPt || startPt === endPt || !(startPt.y > 0)) {
          changeEl.hidden = true;
          return;
        }
        var delta = endPt.y - startPt.y;
        var pct = (delta / startPt.y) * 100;
        changeEl.hidden = false;
        changeEl.className = "avc-legend-change " + (delta >= 0 ? "pvc-up" : "pvc-down");
        changeEl.textContent = (delta >= 0 ? "+" : "−") + "₹" +
          Math.round(Math.abs(delta)).toLocaleString("en-IN") +
          " (" + (delta >= 0 ? "+" : "−") + Math.abs(pct).toFixed(2) + "%)";
      }
      // Hover readout. The value and the date it belongs to go into the card
      // header, replacing the floating tooltip: the figures stay in one place, so
      // comparing two dates is a matter of moving the pointer rather than
      // remembering what the last box said. Leaving the chart restores whatever
      // the zoom window was reporting.
      var _pvcDayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
      var _pvcHoverIdx = -1;
      function pvcHover(els) {
        var idx = els && els.length ? els[0].index : -1;
        if (idx === _pvcHoverIdx) return;   // Chart.js fires onHover on every move
        _pvcHoverIdx = idx;
        if (idx < 0 || !points[idx]) { updatePvcReadout(); return; }
        var pt = points[idx];
        if (lastEl) lastEl.textContent = "₹" + Math.round(pt.y).toLocaleString("en-IN");
        if (nameEl) nameEl.textContent = "Value";
        var per = document.getElementById("pvc-period");
        if (per) per.textContent = _pvcDayFmt.format(pt.x).toUpperCase();
        if (changeEl) changeEl.hidden = true;
      }
      if (canvas2) {
        canvas2.onmouseleave = function () { _pvcHoverIdx = -1; updatePvcReadout(); };
      }

      // Zoom/pan bounds = the plotted data range so zoom-out can't reveal empty space.
      var pvcXMin = points.length ? points[0].x.getTime() : undefined;
      var pvcXMax = points.length ? points[points.length - 1].x.getTime() : undefined;
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
          // Hovering anywhere over the plot picks the nearest point along x, so
          // the readout responds to being near the line rather than only to
          // landing on a 0px-radius point.
          interaction: { intersect: false, mode: "index", axis: "x" },
          onHover: function (evt, els, chart) { pvcHover(els); },
          plugins: {
            legend: { display: false },
            // Off. The figures go in the card header instead — the same place
            // CASH FLOW · MONTHLY keeps its stats row — so reading the chart
            // never means chasing a floating box across it.
            tooltip: { enabled: false },
            zoom: {
              limits: { x: { min: pvcXMin, max: pvcXMax } },
              // Off — see wireChartXDrag; two pan implementations would double up.
              pan: { enabled: false, mode: "x" },
              zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x",
                      drag: { enabled: false }, onZoomComplete: updatePvcReadout }
            }
          },
          scales: {
            x: {
              type: "time",
              // minUnit "day", not "month": zoomed into a single month the axis has
              // to be able to label days, or the view the range pills open is
              // unreadable — one tick for the whole window.
              time: { minUnit: "day", displayFormats: { year: "yyyy", month: "MMM yy", day: "d MMM" } },
              grid: { display: false }
            },
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
      wireChartXDrag(canvas2, function () { return window.__wfPortfolioValueChart; },
        pvcXMin, pvcXMax, updatePvcReadout);

      // Double-click to reset the zoom back to the full range.
      canvas2.ondblclick = function () {
        if (!window.__wfPortfolioValueChart) return;
        resetChartXWindow(window.__wfPortfolioValueChart, pvcXMin, pvcXMax);
        updatePvcReadout();
      };

      updatePvcReadout();
    }

    if (resetBtn && !resetBtn.dataset.bound) {
      resetBtn.dataset.bound = "1";
      resetBtn.addEventListener("click", function () {
        if (window.__wfValueChart && typeof window.__wfValueChart.resetZoom === "function") {
          window.__wfValueChart.resetZoom();
        }
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
  // Opens on the current year, not All time. Years of history compress this
  // year's bars to slivers, and the months you are actually reconciling are the
  // recent ones — All time stays one click away.
  var __mcfAllTime = false;
  var __mcfData; // { byMonth: { "YYYY-MM": { income, expense, investment } }, yearList }

  function buildMcfInvestmentByMonth() {
    // Income & Expenses · Monthly is HOUSEHOLD-WIDE (its income/expense series are
    // never portfolio-filtered), so its Investment series must be all-portfolios
    // too. The shared __monthlyInvestCatData follows the Overview's portfolio
    // selector — reusing it silently shrank the Investment bars to the selected
    // portfolio while income/expense stayed global (mixed-scope chart). Build an
    // explicit all-scope dataset instead.
    var result = {};
    var allData;
    try { allData = buildMonthlyInvestCatData("all"); } catch (e) { allData = null; }
    if (allData && allData.byMonthCat) {
      var byMonthCat = allData.byMonthCat;
      var byMonthCatOut = allData.byMonthCatOut || {};
      function sumCats(map, ym) {
        var m = map[ym];
        return m ? Object.keys(m).reduce(function (s, c) { return s + (m[c] || 0); }, 0) : 0;
      }
      // Net Invested = Total Invested − Total Withdrawal for each month.
      var months = {};
      Object.keys(byMonthCat).forEach(function (ym) { months[ym] = true; });
      Object.keys(byMonthCatOut).forEach(function (ym) { months[ym] = true; });
      Object.keys(months).forEach(function (ym) {
        var net = sumCats(byMonthCat, ym) - sumCats(byMonthCatOut, ym);
        if (net !== 0) result[ym] = net;
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

    // Build the year list from every year that actually has income/expense
    // records. There used to be a hardcoded `ym < "2026-01"` cutoff here, which
    // silently hid earlier years (2025 and before) from the dropdown while the
    // All time view — which has no such cutoff and bounds itself to months with
    // real records — happily charted them. The two disagreed: the data was
    // plotted but the year could not be selected.
    var yearSet = {};
    Object.keys(byMonth).forEach(function(ym) {
      if (byMonth[ym].income > 0 || byMonth[ym].expense > 0) yearSet[ym.slice(0,4)] = 1;
    });
    var yearList = Object.keys(yearSet).sort();
    __mcfData = { byMonth: byMonth, yearList: yearList };

    if (!yearList.length) {
      if (statusEl) statusEl.textContent = "No expense records yet.";
      return;
    }
    if (!__mcfYear || yearList.indexOf(__mcfYear) < 0) {
      // The current year when it has records, otherwise the most recent year
      // that does — landing on an empty chart in January would be worse than
      // showing the last year with something in it.
      var _thisYear = String(new Date().getFullYear());
      __mcfYear = yearList.indexOf(_thisYear) >= 0 ? _thisYear : yearList[yearList.length - 1];
    }
    if (yearSel) {
      var existing = [];
      for (var oi = 0; oi < yearSel.options.length; oi++) existing.push(yearSel.options[oi].value);
      if (existing.join(",") !== yearList.join(",")) {
        yearSel.innerHTML = yearList.map(function(y){ return '<option value="'+y+'">'+y+'</option>'; }).join("");
      }
      yearSel.value = __mcfYear;
      yearSel.onchange = function() {
        __mcfYear = yearSel.value;
        _drawMcfChart();
      };
      _wfYpAttach(yearSel);
      _wfYpSetHidden(yearSel, __mcfAllTime);
    }
    var allBtn = document.getElementById("mcf-alltime");
    if (allBtn) {
      allBtn.classList.toggle("active", !!__mcfAllTime);
      allBtn.onclick = function() {
        __mcfAllTime = !__mcfAllTime;
        allBtn.classList.toggle("active", !!__mcfAllTime);
        if (yearSel) _wfYpSetHidden(yearSel, __mcfAllTime);
        _drawMcfChart();
      };
    }
    _drawMcfChart();
    try { renderExpenseCategoryPie(); } catch (e) {}
  }

  window.renderMonthlyCashFlow = renderMonthlyCashFlow;

  // ─── Decade-grid year picker ─────────────────────────────────────────────
  //
  // Replaces the native <select> on the three monthly cards with a decade grid:
  // a "2020 – 2029" header with ‹ › arrows and the ten years laid out four to a
  // row. Years the card has no data for are shown but greyed and unclickable, so
  // the gaps in your history are visible instead of silently absent — a native
  // select could only omit them, which reads as though those years never existed.
  //
  // The <select> stays in the DOM as the source of truth: choosing a year sets
  // its value and dispatches "change", so every existing onchange handler keeps
  // working untouched, and the enabled set is exactly its option list — which
  // each card already builds from its own records.
  // Declared as functions, not a `var` holding an IIFE. renderMonthlyInvestment-
  // ByCategory is called synchronously from populatePortfolioSelect during
  // script.js's own top-level execution (script.js:556), i.e. long before a
  // `var` this far down the file would be assigned — function declarations hoist,
  // an IIFE's result does not. The same ordering already bites _marketSource.
  var _wfYpPop = null;   // only ever read for truthiness, so undefined is fine

  function _wfYpClose() {
    if (!_wfYpPop) return;
    try { _wfYpPop.remove(); } catch (e) {}
    _wfYpPop = null;
    document.removeEventListener("mousedown", _wfYpDocDown, true);
    document.removeEventListener("keydown", _wfYpKeyDown, true);
  }
  function _wfYpDocDown(ev) {
    if (_wfYpPop && !_wfYpPop.contains(ev.target) &&
        !(_wfYpPop.__btn && _wfYpPop.__btn.contains(ev.target))) _wfYpClose();
  }
  function _wfYpKeyDown(ev) { if (ev.key === "Escape") _wfYpClose(); }

  // Keep the whole popover on screen. These buttons sit at the right edge of
  // their card, so anchoring the popover's left to the button pushed it past the
  // viewport: the grid could not fit four columns in what was left, so the cells
  // squeezed and the right half was clipped. Measured after insertion, because
  // the width depends on the rendered contents.
  function _wfYpPlace(pop, btn) {
    var M = 8;                                   // margin from the viewport edge
    var r = btn.getBoundingClientRect();
    var w = pop.offsetWidth, h = pop.offsetHeight;
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;

    // Prefer left-aligned with the button; fall back to right-aligned, then to
    // simply pinned inside the viewport.
    var left = r.left;
    if (left + w > vw - M) left = r.right - w;
    if (left < M) left = M;
    if (left + w > vw - M) left = Math.max(M, vw - M - w);

    // Below the button unless there is no room, in which case above it.
    var top = r.bottom + 6;
    if (top + h > vh - M && r.top - 6 - h >= M) top = r.top - 6 - h;
    if (top + h > vh - M) top = Math.max(M, vh - M - h);

    pop.style.left = Math.round(left) + "px";
    pop.style.top = Math.round(top) + "px";
  }

  function _wfYpOpen(sel, btn) {
    _wfYpClose();
    var available = [];
    for (var i = 0; i < sel.options.length; i++) available.push(String(sel.options[i].value));
    var current = String(sel.value || available[available.length - 1] || new Date().getFullYear());
    var decade = Math.floor(Number(current) / 10) * 10;

    var pop = document.createElement("div");
    pop.className = "wf-yp-pop";
    pop.__btn = btn;
    // Fixed positioning: the cards clip their overflow, so an absolutely
    // positioned popover would be cut off at the card edge. Placement happens
    // after it is in the DOM, once its real size is known — see _wfYpPlace.

    function paint() {
      var head = '<div class="wf-yp-head">' +
        '<button type="button" class="wf-yp-nav" data-yp-nav="-1" aria-label="Previous decade">&lsaquo;</button>' +
        '<span class="wf-yp-range">' + decade + ' &ndash; ' + (decade + 9) + '</span>' +
        '<button type="button" class="wf-yp-nav" data-yp-nav="1" aria-label="Next decade">&rsaquo;</button>' +
        '</div>';
      var cells = "";
      for (var y = decade; y <= decade + 9; y++) {
        var ys = String(y);
        var has = available.indexOf(ys) !== -1;
        cells += '<button type="button" class="wf-yp-year' +
          (has ? "" : " is-disabled") + (ys === current ? " is-selected" : "") + '"' +
          (has ? ' data-yp-year="' + ys + '"' : ' disabled aria-disabled="true"') +
          '>' + ys + '</button>';
      }
      pop.innerHTML = head + '<div class="wf-yp-grid">' + cells + '</div>';
      Array.prototype.forEach.call(pop.querySelectorAll("[data-yp-nav]"), function (b) {
        b.addEventListener("click", function () {
          decade += Number(b.getAttribute("data-yp-nav")) * 10;
          paint();
        });
      });
      Array.prototype.forEach.call(pop.querySelectorAll("[data-yp-year]"), function (b) {
        b.addEventListener("click", function () {
          sel.value = b.getAttribute("data-yp-year");
          _wfYpClose();
          // The <select> stays authoritative, so the card's own handler runs.
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          _wfYpAttach(sel);
        });
      });
    }
    paint();
    document.body.appendChild(pop);
    _wfYpPlace(pop, btn);
    _wfYpPop = pop;
    document.addEventListener("mousedown", _wfYpDocDown, true);
    document.addEventListener("keydown", _wfYpKeyDown, true);
  }

  // Idempotent: safe to call on every render. Builds the button on first use and
  // afterwards just re-syncs its label with the <select>, which the cards
  // reassign as their data and filters change.
  function _wfYpAttach(sel) {
    if (!sel) return;
    var btn = sel.__wfYpBtn;
    if (!btn) {
      sel.style.display = "none";
      sel.setAttribute("data-wf-yp", "1");
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mic-dropdown-btn wf-yp-btn";
      btn.setAttribute("aria-haspopup", "dialog");
      btn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (_wfYpPop && _wfYpPop.__btn === btn) { _wfYpClose(); return; }
        _wfYpOpen(sel, btn);
      });
      sel.parentNode.insertBefore(btn, sel.nextSibling);
      sel.__wfYpBtn = btn;
    }
    btn.textContent = String(sel.value || "");
    btn.style.display = (sel.getAttribute("data-wf-yp-hidden") === "1") ? "none" : "";
  }

  // The cards used to hide the year control via sel.style.display. The select is
  // permanently hidden once attached, so they flag it here and the button follows.
  function _wfYpSetHidden(sel, hidden) {
    if (!sel) return;
    sel.setAttribute("data-wf-yp-hidden", hidden ? "1" : "0");
    if (sel.__wfYpBtn) sel.__wfYpBtn.style.display = hidden ? "none" : "";
  }

  window.WfYearPicker = { attach: _wfYpAttach, setHidden: _wfYpSetHidden, close: _wfYpClose };

  // ─── Expense by Category pie (with year selector + category→sub drill-down) ──
  var __epcYear = null;
  var __epcAccount = "all"; // "all" or an account_id
  var __epcMonthMode = false; // false = whole year; true = a specific month
  var __epcMonth = new Date().getMonth(); // 0-11 when in month mode
  var __epcDrillCat = null; // null = top-level categories; else a categoryId
  // Third level: a sub-category id (or "__other_<top>"), showing the individual
  // transactions behind that slice instead of another doughnut.
  var __epcDrillSub = null;
  var __epcDrillSubLabel = "";
  var __EPC_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  var __EPC_PALETTE = ["#E8623A", "#F5A623", "#4DC0B5", "#8B5CF6", "#3B82F6", "#10B981",
                       "#EC4899", "#84CC16", "#F97316", "#6366F1", "#14B8A6", "#D946EF"];
  // The doughnut and the transaction list occupy the same slot; only one shows.
  function _epcShowChart() {
    var wrap = document.getElementById("epc-wrap");
    var legend = document.getElementById("epc-legend");
    var txns = document.getElementById("epc-txns");
    if (wrap) wrap.hidden = false;
    if (legend) legend.hidden = false;
    if (txns) { txns.hidden = true; txns.innerHTML = ""; }
  }

  // Every transaction behind one sub-category slice.
  //
  // Ordering: in Month mode the period is already a single month, so plain date
  // order is all there is. Otherwise the view spans the whole selected year and
  // the rows are grouped under month headings, oldest month first — which is
  // what "sort by month for the selected year" asks for, and reads the way a
  // statement does. Within a month, date order again.
  function _epcRenderTxns(yearRecs, topId, subId, periodLbl, accounts, topLevelId, subIdOf, statusEl) {
    var wrap = document.getElementById("epc-wrap");
    var legend = document.getElementById("epc-legend");
    var host = document.getElementById("epc-txns");
    if (!host) return;
    if (wrap) wrap.hidden = true;
    if (legend) legend.hidden = true;
    host.hidden = false;

    var acctName = {};
    (accounts || []).forEach(function (a) { acctName[String(a.id)] = a.name || "Account"; });

    var rows = yearRecs.filter(function (r) {
      if (!r.category_id) return false;
      if (topLevelId(r.category_id) !== topId) return false;
      return subIdOf(r, topId) === subId;
    }).sort(function (a, b) {
      return String(a.txn_date).localeCompare(String(b.txn_date));
    });

    var total = rows.reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0);
    if (statusEl) {
      statusEl.textContent = __epcDrillSubLabel + " · " + rows.length + " transaction" +
        (rows.length === 1 ? "" : "s") + " · " + formatCurrency(total) + " · " + periodLbl;
    }
    if (!rows.length) {
      host.innerHTML = '<p class="muted small" style="padding:14px;text-align:center;">No transactions for ' +
        escapeHtml(periodLbl) + '.</p>';
      return;
    }

    var html = "", lastMonth = null;
    rows.forEach(function (r) {
      var iso = String(r.txn_date);
      var mk = iso.slice(0, 7);
      // Month headings only when the period spans a year; in Month mode every
      // row sits in the same month and a heading would just repeat the title.
      if (!__epcMonthMode && mk !== lastMonth) {
        lastMonth = mk;
        var mi = Number(iso.slice(5, 7)) - 1;
        html += '<div class="epc-txn-month">' + escapeHtml(__EPC_MONTHS[mi] || mk) + '</div>';
      }
      var day = iso.slice(8, 10) + " " + (__EPC_MONTHS[Number(iso.slice(5, 7)) - 1] || "").slice(0, 3);
      var note = (r.note || "").trim();
      var acct = r.account_id ? (acctName[String(r.account_id)] || "") : "";
      var meta = [day, acct].filter(Boolean).join(" · ");
      html += '<div class="epc-txn-row">' +
        '<div class="epc-txn-body">' +
          '<div class="epc-txn-name">' + escapeHtml(note || "(no note)") + '</div>' +
          '<div class="epc-txn-meta">' + escapeHtml(meta) + '</div>' +
        '</div>' +
        '<div class="epc-txn-amt">' + formatCurrency(Number(r.amount) || 0) + '</div>' +
      '</div>';
    });
    host.innerHTML = html;
  }

  function renderExpenseCategoryPie() {
    var canvas = document.getElementById("epc-chart");
    var statusEl = document.getElementById("epc-status");
    var yearSel = document.getElementById("epc-year");
    var backBtn = document.getElementById("epc-back");
    var subtitleEl = document.getElementById("epc-subtitle");
    if (!canvas || typeof Chart === "undefined") return;

    var records = (window.dashExpState && window.dashExpState.records) || [];
    var categories = (window.dashExpState && window.dashExpState.categories) || [];
    var accounts = (window.dashExpState && window.dashExpState.accounts) || [];
    var catById = {};
    categories.forEach(function (c) { catById[c.id] = c; });
    function topLevelId(catId) {
      var c = catById[catId];
      return (c && c.parent_id) ? c.parent_id : catId;
    }
    function nameOf(catId) {
      var c = catById[catId];
      return (c && c.name) ? c.name : "Uncategorized";
    }

    // Year list from expense records.
    var yearSet = {};
    records.forEach(function (r) {
      if (r.type === "expense" && r.txn_date) yearSet[String(r.txn_date).slice(0, 4)] = 1;
    });
    var yearList = Object.keys(yearSet).sort();
    if (!yearList.length) {
      if (statusEl) statusEl.textContent = "No expense records yet.";
      if (window.__epcChart) { try { window.__epcChart.destroy(); } catch (e) {} window.__epcChart = null; }
      return;
    }
    if (!__epcYear || yearList.indexOf(__epcYear) < 0) __epcYear = yearList[yearList.length - 1];
    if (yearSel) {
      var existing = [];
      for (var oi = 0; oi < yearSel.options.length; oi++) existing.push(yearSel.options[oi].value);
      if (existing.join(",") !== yearList.join(",")) {
        yearSel.innerHTML = yearList.map(function (y) { return '<option value="' + y + '">' + y + '</option>'; }).join("");
      }
      yearSel.value = __epcYear;
      yearSel.onchange = function () { __epcYear = yearSel.value; __epcDrillCat = null; __epcDrillSub = null; renderExpenseCategoryPie(); };
      _wfYpAttach(yearSel);
    }
    if (backBtn) {
      backBtn.style.display = __epcDrillCat ? "" : "none";
      // One level at a time: transactions → sub-categories → categories.
      backBtn.onclick = function () {
        if (__epcDrillSub) __epcDrillSub = null;
        else __epcDrillCat = null;
        renderExpenseCategoryPie();
      };
    }
    if (subtitleEl) {
      var _crumb = !__epcDrillCat ? ""
        : (__epcDrillSub ? nameOf(__epcDrillCat) + " › " + __epcDrillSubLabel : nameOf(__epcDrillCat));
      subtitleEl.textContent = _crumb;
      subtitleEl.style.display = _crumb ? "" : "none";
    }

    // Account dropdown: All accounts + each account.
    var acctSel = document.getElementById("epc-account");
    if (acctSel) {
      var wantAcct = ["all"].concat(accounts.map(function (a) { return String(a.id); }));
      var haveAcct = [];
      for (var ai = 0; ai < acctSel.options.length; ai++) haveAcct.push(acctSel.options[ai].value);
      if (haveAcct.join(",") !== wantAcct.join(",")) {
        acctSel.innerHTML = '<option value="all">All accounts</option>' + accounts.map(function (a) {
          return '<option value="' + escapeHtml(String(a.id)) + '">' + escapeHtml(a.name || "Account") + '</option>';
        }).join("");
      }
      if (wantAcct.indexOf(__epcAccount) === -1) __epcAccount = "all";
      acctSel.value = __epcAccount;
      acctSel.onchange = function () { __epcAccount = acctSel.value; __epcDrillCat = null; __epcDrillSub = null; renderExpenseCategoryPie(); };
    }

    // Month toggle + month dropdown: when active, view a specific month of the year.
    var monthToggle = document.getElementById("epc-month-toggle");
    var monthSel = document.getElementById("epc-month");
    if (monthSel && !monthSel.options.length) {
      monthSel.innerHTML = __EPC_MONTHS.map(function (n, i) { return '<option value="' + i + '">' + n + '</option>'; }).join("");
    }
    if (monthToggle) {
      monthToggle.classList.toggle("active", __epcMonthMode);
      monthToggle.onclick = function () { __epcMonthMode = !__epcMonthMode; __epcDrillCat = null; __epcDrillSub = null; renderExpenseCategoryPie(); };
    }
    if (monthSel) {
      monthSel.style.display = __epcMonthMode ? "" : "none";
      monthSel.value = String(__epcMonth);
      monthSel.onchange = function () { __epcMonth = Number(monthSel.value); __epcDrillCat = null; __epcDrillSub = null; renderExpenseCategoryPie(); };
    }

    // Aggregate expenses for the selected year (+ month when in month mode) + account.
    var monKey = __epcMonthMode ? (__epcYear + "-" + String(__epcMonth + 1).padStart(2, "0")) : null;
    var periodLbl = __epcMonthMode ? (__EPC_MONTHS[__epcMonth] + " " + __epcYear) : String(__epcYear);
    var yearRecs = records.filter(function (r) {
      if (r.type !== "expense" || !r.txn_date || !Number(r.amount)) return false;
      if (__epcMonthMode) { if (String(r.txn_date).slice(0, 7) !== monKey) return false; }
      else if (String(r.txn_date).slice(0, 4) !== __epcYear) return false;
      if (__epcAccount !== "all" && String(r.account_id) !== __epcAccount) return false;
      return true;
    });

    // Records carry the category in category_id and the sub-category in
    // subcategory_id (a category with parent_id). Resolve the top-level category,
    // and derive the sub from subcategory_id (or category_id itself if that is a
    // child). hasSubByTop marks categories that actually have sub-category spend.
    var sums = {}, keyIds = {};
    var hasSubByTop = {};
    function subIdOf(r, top) {
      if (r.subcategory_id) return r.subcategory_id;
      if (catById[r.category_id] && catById[r.category_id].parent_id) return r.category_id; // category_id is itself a sub
      return "__other_" + top;
    }
    yearRecs.forEach(function (r) {
      if (!r.category_id) return;
      var top = topLevelId(r.category_id);
      var hasSub = !!(r.subcategory_id || (catById[r.category_id] && catById[r.category_id].parent_id));
      if (__epcDrillCat) {
        if (top !== __epcDrillCat) return;
        var subId = subIdOf(r, top);
        sums[subId] = (sums[subId] || 0) + Number(r.amount);
        keyIds[subId] = subId;
      } else {
        sums[top] = (sums[top] || 0) + Number(r.amount);
        keyIds[top] = top;
        if (hasSub) hasSubByTop[top] = true;
      }
    });

    // ── Third level: the transactions behind one sub-category ───────────────
    if (__epcDrillCat && __epcDrillSub) {
      _epcRenderTxns(yearRecs, __epcDrillCat, __epcDrillSub, periodLbl, accounts,
                     topLevelId, subIdOf, statusEl);
      return;
    }
    _epcShowChart();

    var entries = Object.keys(sums).map(function (id) {
      var label = (id.indexOf("__other_") === 0) ? "Other" : nameOf(id);
      return { id: id, label: label, value: sums[id] };
    }).filter(function (e) { return e.value > 0; })
      .sort(function (a, b) { return b.value - a.value; });

    if (!entries.length) {
      _epcShowChart();
      if (statusEl) statusEl.textContent = "No expenses" + (__epcDrillCat ? " in this category" : "") + " for " + periodLbl + ".";
      if (window.__epcChart) { try { window.__epcChart.destroy(); } catch (e) {} window.__epcChart = null; }
      return;
    }
    var total = entries.reduce(function (s, e) { return s + e.value; }, 0);
    if (statusEl) statusEl.textContent = (__epcDrillCat ? nameOf(__epcDrillCat) + " · " : "") + "Total " + formatCurrency(total) + " · " + periodLbl +
      (__epcDrillCat ? " · tap a slice for transactions" : " · tap a slice for sub-categories");

    var colors = entries.map(function (_, i) { return __EPC_PALETTE[i % __EPC_PALETTE.length]; });
    if (window.__epcChart) { try { window.__epcChart.destroy(); } catch (e) {} window.__epcChart = null; }
    window.__epcChart = new Chart(canvas.getContext("2d"), {
      type: "doughnut",
      data: {
        labels: entries.map(function (e) { return e.label; }),
        datasets: [{ data: entries.map(function (e) { return e.value; }), backgroundColor: colors, borderWidth: 1, borderColor: "#fff" }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        cutout: "58%",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var v = ctx.parsed || 0;
                var pct = total > 0 ? (v / total * 100).toFixed(1) : "0";
                return ctx.label + ": " + formatCurrency(v) + " (" + pct + "%)";
              }
            }
          }
        },
        onClick: function (evt, els) {
          if (!els || !els.length) return;
          var e = entries[els[0].index];
          if (__epcDrillCat) {
            // Already in a category: a slice is a sub-category, so open its
            // transactions rather than doing nothing.
            __epcDrillSub = e.id;
            __epcDrillSubLabel = e.label;
          } else {
            if (!hasSubByTop[e.id]) return; // no sub-categories to drill into
            __epcDrillCat = e.id;
          }
          renderExpenseCategoryPie();
        }
      }
    });
    // Pointer cursor over drillable slices.
    canvas.style.cursor = "pointer";

    // Custom legend list showing every (sub)category with its expense + %.
    var legendEl = document.getElementById("epc-legend");
    if (legendEl) {
      legendEl.innerHTML = entries.map(function (e, i) {
        var pct = total > 0 ? (e.value / total * 100).toFixed(1) : "0";
        var drillable = __epcDrillCat ? true : !!hasSubByTop[e.id];
        return '<div class="epc-legend-item' + (drillable ? " epc-legend-drill" : "") + '"' +
          (drillable ? ' role="button" tabindex="0" data-epc-cat="' + escapeHtml(String(e.id)) +
            '" data-epc-label="' + escapeHtml(String(e.label)) + '"' : "") + '>' +
          '<span class="epc-legend-dot" style="background:' + colors[i] + '"></span>' +
          '<span class="epc-legend-name"' + _crTitle(e.value) + '>' + escapeHtml(e.label) + '</span>' +
          '<span class="epc-legend-val">' + formatCurrency(e.value) + '</span>' +
          '<span class="epc-legend-pct">' + pct + '%</span></div>';
      }).join("");
      // Clicking a drillable legend row drills in, matching a slice click.
      Array.prototype.forEach.call(legendEl.querySelectorAll("[data-epc-cat]"), function (row) {
        function drill() {
          if (__epcDrillCat) {
            __epcDrillSub = row.getAttribute("data-epc-cat");
            __epcDrillSubLabel = row.getAttribute("data-epc-label") || "";
          } else {
            __epcDrillCat = row.getAttribute("data-epc-cat");
          }
          renderExpenseCategoryPie();
        }
        row.addEventListener("click", drill);
        row.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); drill(); } });
      });
    }
  }
  window.renderExpenseCategoryPie = renderExpenseCategoryPie;

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
          return byMonth[k] && (byMonth[k].income > 0 || byMonth[k].expense > 0);
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

    // Plot only months that have income. Year mode previously drew all twelve
    // and All time drew a contiguous span, so months without income rendered as
    // empty slots that squeezed the real bars.
    //
    // Income alone is the test: a month with expenses (or investment) but no
    // income is dropped along with its expense and invested bars, so every
    // column on the chart has an income figure behind it.
    (function () {
      var keptKeys = [], keptLabels = [];
      monthKeys.forEach(function (k, i) {
        var b = byMonth[k];
        if (b && (b.income || 0) > 0) {
          keptKeys.push(k); keptLabels.push(labels[i]);
        }
      });
      monthKeys = keptKeys; labels = keptLabels;
    })();

    // Nothing left to plot (a period with no income at all). Say so instead of
    // rendering an empty axis.
    var mcfStatusEl = document.getElementById("mcf-status");
    if (!monthKeys.length) {
      if (mcfStatusEl) mcfStatusEl.textContent = "No income records in this period.";
      if (__mcfChart) { try { __mcfChart.destroy(); } catch (e) {} __mcfChart = null; }
      wrap.innerHTML = "";
      if (statsEl) statsEl.innerHTML = "";
      if (legendEl) legendEl.innerHTML = "";
      return;
    }
    if (mcfStatusEl) mcfStatusEl.textContent = "";

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
      // Expense % = Expenses ÷ Income × 100 (share of income spent). "—" when
      // there's no income to divide by.
      var expPct = totalIncome > 0 ? (totalExpense / totalIncome) * 100 : null;
      var stats = [
        { label: "Income", value: fmtC(totalIncome), cls: "positive" },
        { label: "Invested", value: fmtC(totalInvest), cls: "" },
        { label: "Expenses", value: fmtC(totalExpense), cls: totalExpense > 0 ? "negative" : "" },
        { label: "Expense %", value: expPct == null ? "—" : expPct.toFixed(1) + "%", cls: expPct != null && expPct > 100 ? "negative" : "" }
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

  // Same as collectPortfolioNamesFromSheets but for an already-loaded rows array,
  // so callers working on a filtered copy of a sheet (e.g. debt excluded) list
  // only the portfolios that survive the filter.
  function collectPortfolioNamesFromRows(rows) {
    if (!rows || !rows.length) return [];
    var header = rows[0].map(normalizeText);
    var portfolioIdx = findHeaderIndex(header, "portfolio name");
    if (portfolioIdx === -1) return [];
    var names = [], seen = {};
    rows.slice(1).forEach(function (row) {
      var name = (row[portfolioIdx] == null ? "" : String(row[portfolioIdx])).trim();
      if (!name) return;
      var key = normalizeText(name);
      if (!seen[key]) { seen[key] = true; names.push(name); }
    });
    return names;
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
  // Returns null before any slice is populated, so callers can distinguish
  // "not loaded yet" from a genuine zero.
  function getOverviewInvestedTotal() {
    var total = _ovAggregate().invested;
    return total > 0 ? total : null;
  }
  // Overview's authoritative "Current" total (live prices + interest accrual).
  // Shares refreshOverviewStats' exact aggregation (exclusion gating + the
  // per-class invested fallback), so the chart tail and benchmark terminal can
  // never disagree with the Overview card or use a zeroed component.
  function getOverviewCurrentTotal() {
    var total = _ovAggregate().current;
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
        var usdInrToday = (data && data.prices && data.prices["__USD_INR__"]) ? data.prices["__USD_INR__"].price : 84;
        var indiaInr = 0, usInr = 0, usUsd = 0;
        lotsByRegion.India.forEach(function (lot) { indiaInr += lot.units * lot.price; });
        lotsByRegion.US.forEach(function (lot) {
          var rate = lookupUsdInrRate(rateMap, formatDateISO(lot.date), usdInrToday);
          usUsd += lot.units * lot.price;           // native USD cost of open US lots
          usInr += lot.units * lot.price * rate;    // same lots × their historical buy rate
        });
        // usUsd/usdInrToday let callers derive the average buy USD/INR
        // (usInr / usUsd) and today's rate without a second pass.
        return { India: indiaInr, US: usInr, usUsd: usUsd, usdInrToday: usdInrToday };
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

    // The USD/INR footnote belongs to Region mode only — clear any stale copy
    // before a Portfolio render so it doesn't linger when the user toggles back.
    var _fxEl = document.getElementById("isc-fx");
    if (_fxEl) _fxEl.innerHTML = "";

    if (mode === "region") { _renderRegionSplit(prefixes, fiExcluded, statusEl); return; }

    var names = collectPortfolioNamesFromSheets(prefixes);
    if (!names.length) {
      statusEl.textContent = "No portfolios found yet. Connect your transaction sheets in Settings.";
      if (window.__wfSplitChart) { window.__wfSplitChart.destroy(); window.__wfSplitChart = null; }
      return;
    }

    var investedByName = {};
    var commodityByName = {}; // per-portfolio commodity invested (joins asynchronously)
    // Once per-portfolio CURRENT values resolve (async), these hold each portfolio's
    // actual current total and its {equity,fixedIncome,commodity} current breakdown.
    // While null, the card shows the fast invested-based render; the current pass
    // then supersedes it so each portfolio reflects its own return, not the blend.
    var currentByName = null;
    var currentCatByName = {};
    var namedSum = 0;
    names.forEach(function (name) {
      var invested = computeTotalInvestment(name, prefixes);
      if (invested > UNITS_EPSILON) {
        investedByName[name] = invested;
        namedSum += invested;
      }
    });

    // Commodity-category MF/ETF (from mapping.category === "commodity") should
    // be counted under Commodity, not Equity. Compute once per portfolio.
    var _mfCatMap_ps = {}, _seMap_ps = {};
    try { _mfCatMap_ps = buildMfCategoryMap(); } catch (e) {}
    try { _seMap_ps = buildStockMappingTable(); } catch (e) {}
    // Invested amounts held in the Mutual Fund / Stocks-ETF sheets that do NOT
    // belong to Equity, keyed by their Instrument Category. Previously this only
    // looked for Commodity, so a debt fund marked Fixed Income stayed counted as
    // Equity. Reads the category the mapping sheets state, whatever it is.
    var _instrTopCat_ps = {};
    try { _instrTopCat_ps = buildInstrumentTopCategoryMap(); } catch (e) {}
    function _nonEquityFromEquitySources(portfolioName) {
      var out = {};
      ["equity", "stocksetf"].forEach(function (prefix) {
        try {
          var rowsX = getSheetRows(prefix);
          if (!rowsX || !rowsX.length) return;
          var txByI = groupUnitTransactionsByInstrument(rowsX, portfolioName);
          if (!txByI) return;
          Object.keys(txByI).forEach(function (nm) {
            var cat = _instrTopCat_ps[normalizeText(nm)] || "";
            var n = normalizeText(cat);
            if (!n || n === "equity") return;
            var amt = 0;
            fifoRemainingLots(txByI[nm]).forEach(function (l) { amt += l.units * l.price; });
            if (amt) out[n] = (out[n] || 0) + amt;
          });
        } catch (e) {}
      });
      return out;
    }

    // US Stocks/ETF INR-conversion delta per portfolio — populated
    // asynchronously by applyStocksEtfInrConversion(). portfolioCatSubline
    // adds it to Equity so chip percentages line up with the row total.
    var _seInrDeltaByName = {};

    // Instrument-category breakdown for one portfolio → sub-line under its name.
    // Uses CURRENT breakdown once it has resolved; falls back to invested until then.
    function portfolioCatSubline(name) {
      if (name === "Unassigned") return "";
      var eq, fi, comm;
      if (currentByName && currentCatByName[name]) {
        var cb = currentCatByName[name];
        eq = cb.equity; fi = cb.fixedIncome; comm = cb.commodity;
      } else {
        eq = computeTotalInvestment(name, ["equity", "stocksetf"]) + (_seInrDeltaByName[name] || 0);
        var nonEq = _nonEquityFromEquitySources(name);
        var extraComm = nonEq["commodity"] || 0;
        var extraFi = nonEq["fixed income"] || 0;
        // Move every non-equity category out of Equity, not just commodity.
        Object.keys(nonEq).forEach(function (n) { eq -= nonEq[n]; });
        fi = (fiExcluded ? 0 : computeTotalInvestment(name, ["fixedincome", "fd"])) + extraFi;
        comm = (fiExcluded ? 0 : (commodityByName[name] || 0)) + extraComm;
      }
      var parts = [
        { label: "Equity", value: eq, color: "#10B981" },
        { label: "Fixed Income", value: fi, color: "#3B82F6" },
        { label: "Commodity", value: comm, color: "#F59E0B" }
      ].filter(function (p) { return p.value > UNITS_EPSILON; });
      var sum = parts.reduce(function (s, p) { return s + p.value; }, 0);
      if (sum <= 0) return "";
      return parts.map(function (p) {
        var pc = (p.value / sum) * 100;
        var pcStr = (pc < 1 ? pc.toFixed(1) : String(Math.round(pc))) + "%";
        return '<span class="isc-cat-chip" title="' + p.label + ' ₹' + Math.round(p.value).toLocaleString("en-IN") + '"><span class="isc-cat-dot" style="background:' + p.color + '"></span>' +
          p.label + ' ' + pcStr + '</span>';
      }).join("");
    }
    // Reconcile to the overview's "all" figure: blank-portfolio rows become an
    // Unassigned slice; a small negative remainder (per-portfolio FIFO cost
    // matching vs "all") is scaled away so both totals agree exactly.
    var allTotal = computeTotalInvestment("all", prefixes);
    var unassigned = allTotal - namedSum;
    // The negative-remainder rescale is BOUNDED: a large mismatch means a real
    // data/computation error, and silently scaling every portfolio would hide it.
    var _rescaleBound = Math.max(1000, allTotal * 0.005); // ₹1000 or 0.5%
    if (unassigned > UNITS_EPSILON) {
      investedByName["Unassigned"] = unassigned;
    } else if (unassigned < -UNITS_EPSILON && namedSum > 0 && -unassigned <= _rescaleBound) {
      var scale = allTotal / namedSum;
      Object.keys(investedByName).forEach(function (n) { investedByName[n] *= scale; });
    } else if (unassigned < -_rescaleBound) {
      console.warn("Portfolio Split: per-portfolio invested exceeds the all-portfolios total by ₹" +
        Math.round(-unassigned).toLocaleString("en-IN") + " — leaving unreconciled (possible data issue).");
    }

    function drawSplitPie() {
      var barEl = document.getElementById("isc-bar");
      var listEl = document.getElementById("isc-list");
      var totalEl = document.getElementById("isc-total-value");
      var labelEl = document.getElementById("isc-total-label");
      if (!barEl || !listEl || !totalEl) return;

      // Use per-portfolio CURRENT values once resolved; invested until then.
      var valueByName = currentByName || investedByName;
      var entries = Object.keys(valueByName)
        .map(function (n) { return { name: n, value: valueByName[n] }; })
        .filter(function (e) { return e.value > UNITS_EPSILON; })
        .sort(function (a, b) { return b.value - a.value; });

      if (!entries.length) {
        statusEl.textContent = "No value found yet across your portfolios.";
        barEl.innerHTML = "";
        listEl.innerHTML = "";
        totalEl.textContent = "—";
        return;
      }
      // No reconciliation to the overview store here: this card always covers ALL portfolios and
      // must ignore the Overview's portfolio selector (getOverviewCurrentTotal
      // reflects the SELECTED portfolio). The invested render is a fast placeholder;
      // the per-portfolio current pass supersedes it with authoritative values.
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

      // Truthful header: the fast first paint is INVESTED; the async per-portfolio
      // pass upgrades it to CURRENT. The label must say which one is showing —
      // Label is always "CURRENT TOTAL" per product decision — the invested
      // figures are only a brief placeholder until the current pass resolves.
      if (labelEl) labelEl.textContent = "CURRENT TOTAL";
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
            '<div class="isc-row-name">' + escapeHtml(e.name) + '</div>' +
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
    // Supersede the fast invested-based render with each portfolio's ACTUAL current
    // value (its own return, not the portfolio-wide blend). Computes MF + Stocks/ETF
    // + Fixed Income + commodity current per portfolio, then re-draws. Falls back to
    // the invested render on failure. "Unassigned" keeps its invested figure since
    // its instruments can't be attributed to a portfolio's holdings.
    (function applyPerPortfolioCurrent() {
      var names2 = Object.keys(investedByName).filter(function (n) { return n !== "Unassigned"; });
      if (!names2.length) return;
      Promise.all(names2.map(function (name) {
        return computePortfolioCurrentBreakdown(name).then(function (b) { return { name: name, b: b }; }).catch(function () { return null; });
      })).then(function (results) {
        var cur = {}, cat = {}, any = false;
        results.forEach(function (r) {
          if (!r) return;
          var tot = (r.b.equity || 0) + (r.b.fixedIncome || 0) + (r.b.commodity || 0);
          if (tot > UNITS_EPSILON) { cur[r.name] = tot; cat[r.name] = r.b; any = true; }
        });
        if (!any) return;
        // Preserve any Unassigned slice from the invested render so the bar still totals.
        if (investedByName["Unassigned"] > UNITS_EPSILON) cur["Unassigned"] = investedByName["Unassigned"];
        currentByName = cur;
        currentCatByName = cat;
        drawSplitPie();
      });
    })();
  }

  function _renderRegionSplit(prefixes, fiExcluded, statusEl) {
    var selected = "all";
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
      // USD/INR footnote for the US leg:
      //  • Buy $ : ₹  = units-weighted avg rate paid per $1 (US INR cost ÷ US USD cost)
      //  • Current $ : ₹ = today's rate from stock_prices.json
      // Rendered into #isc-fx (Region mode only). Placed below the India/US rows.
      var buyRate = (inr.usUsd > 0) ? (inr.US / inr.usUsd) : null;
      var curRate = (inr.usdInrToday > 0) ? inr.usdInrToday : null;
      renderRegionFx(buyRate, curRate);
      draw();
    }).catch(function () {});

    function renderRegionFx(buyRate, curRate) {
      var fxEl = document.getElementById("isc-fx");
      if (!fxEl) return;
      // No US holdings → nothing to show (keeps the card compact).
      if (buyRate == null && curRate == null) { fxEl.innerHTML = ""; return; }
      function _pair(label, valHtml) {
        return '<span class="isc-fx-pair">' +
          '<span class="isc-fx-label">' + label + '</span>' +
          '<span class="isc-fx-val">' + valHtml + '</span>' +
        '</span>';
      }
      function _rate(rate) { return rate != null ? '₹' + Number(rate).toFixed(2) : '—'; }
      // % change = how much the rupee-per-dollar has moved from the average buy
      // rate to today (the unrealized FX gain/loss on the dollars deployed).
      var pctHtml = '—', pctCls = '';
      if (buyRate != null && buyRate > 0 && curRate != null) {
        var pct = (curRate - buyRate) / buyRate * 100;
        pctCls = pct > 0 ? ' isc-fx-pos' : pct < 0 ? ' isc-fx-neg' : '';
        pctHtml = (pct > 0 ? '+' : '') + pct.toFixed(2) + '%';
      }
      fxEl.innerHTML =
        '<div class="isc-fx-title">US · USD/INR</div>' +
        '<div class="isc-fx-row">' +
          _pair("Buy $ : ₹", _rate(buyRate)) +
          _pair("Current $ : ₹", _rate(curRate)) +
          _pair("% change", '<span class="' + pctCls.trim() + '">' + pctHtml + '</span>') +
        '</div>';
    }

    // Supersede the invested placeholder with true per-region CURRENT values:
    // India = MF current + Fixed Income current + commodity (gold) + India-listed
    // SE current; US = US-listed SE current. Uses the same helpers as Portfolio
    // Split (all-portfolios scope), so the two toggles of this card agree and
    // neither follows the Overview's portfolio selector.
    var currentByRegion = null;
    Promise.all([
      computePortfolioCurrentBreakdown("all"),
      computeStocksEtfCurrentByRegion("all")
    ]).then(function (res) {
      var b = res[0] || { equity: 0, fixedIncome: 0, commodity: 0 };
      var se = res[1] || { India: 0, US: 0 };
      // b.equity is NOT "MF + SE": computePortfolioCurrentBreakdown has already
      // moved commodity- and fixed-income-category funds/ETFs out of it and into
      // b.commodity / b.fixedIncome. Reconstructing an MF-only figure by
      // subtracting the full SE total therefore subtracted those instruments a
      // second time, and Math.max(0, …) then hid the negative — a gold ETF held
      // with little or no mutual fund landed in India twice AND inflated the
      // grand total.
      //
      // The three buckets already sum to the whole portfolio, so no MF-only
      // figure is needed: everything is India except US-listed Stocks/ETF. This
      // also keeps a US-listed commodity ETF in US rather than India.
      var us = se.US || 0;
      var india = Math.max(0, (b.equity || 0) + (b.fixedIncome || 0) + (b.commodity || 0) - us);
      if (india + us <= UNITS_EPSILON) return;
      currentByRegion = { India: india, US: us };
      draw();
    }).catch(function () {});

    var REGION_META = {
      "India": { bar: "#10B981", tint: "#D1FAE5", ink: "#065F46", flag: "🇮🇳" },
      "US":    { bar: "#6366F1", tint: "#E0E7FF", ink: "#3730A3", flag: "🇺🇸" }
    };

    function draw() {
      // True per-region CURRENT once resolved; invested placeholder until then.
      // No rescaling to getOverviewCurrentTotal — that follows the Overview's
      // SELECTED portfolio and assumes both regions earned the blended return
      // (the same defect fixed in the Portfolio view of this card).
      var valueByRegion = currentByRegion || investedByRegion;
      var entries = Object.keys(valueByRegion)
        .map(function (r) { return { name: r, value: valueByRegion[r] }; })
        .filter(function (e) { return e.value > UNITS_EPSILON; })
        .sort(function (a, b) { return b.value - a.value; });
      if (!entries.length) {
        statusEl.textContent = "No value found yet.";
        barEl.innerHTML = ""; listEl.innerHTML = ""; totalEl.textContent = "—";
        return;
      }
      var total = entries.reduce(function (s, e) { return s + e.value; }, 0);
      // Truthful header for the Region toggle too: invested placeholder vs current.
      var regionLabelEl = document.getElementById("isc-total-label");
      if (regionLabelEl) regionLabelEl.textContent = "CURRENT TOTAL";
      totalEl.textContent = formatCurrency(total);
      barEl.innerHTML = entries.map(function (e) {
        var pct = (e.value / total) * 100;
        var meta = REGION_META[e.name] || REGION_META["India"];
        return '<span class="isc-bar-seg" style="flex:' + pct + ' 0 0;background:' + meta.bar + ';" title="' + escapeHtml(e.name) + '"></span>';
      }).join("");
      listEl.innerHTML = entries.map(function (e) {
        var pct = (e.value / total) * 100;
        var meta = REGION_META[e.name] || REGION_META["India"];
        var pctStr = (pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)) + "%";
        return '<div class="isc-row">' +
          '<div class="isc-avatar" style="background:' + meta.tint + ';color:' + meta.ink + ';font-size:0.85rem;">' + meta.flag + '</div>' +
          '<div class="isc-row-body">' +
            '<div class="isc-row-name">' + escapeHtml(e.name) + '</div>' +
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
      if (fdRows && fdRows.length && _hasCommodityRows(fdRows, "all")) {
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
  function renderInstrumentSplitChart(_retry) {
    var statusEl = document.getElementById("instrument-split-status");
    var barEl = document.getElementById("iscat-bar");
    var listEl = document.getElementById("iscat-list");
    var totalEl = document.getElementById("iscat-total-value");
    var catLabelEl = document.getElementById("iscat-total-label");
    if (!statusEl || !barEl || !listEl || !totalEl) return;

    // Category Split always covers ALL portfolios and ignores the Overview's
    // portfolio selector entirely — totals are computed per portfolio and summed,
    // never read from the overview store (which reflects the SELECTED portfolio).
    var selected = "all";
    var fiExcluded = isFixedIncomeExcluded();

    // Category → color + display icon
    var CATS = [
      { key: "Equity",       bar: "#10B981", tint: "#D1FAE5", ink: "#065F46", icon: "📈" },
      { key: "Fixed Income", bar: "#3B82F6", tint: "#DBEAFE", ink: "#1E40AF", icon: "🏦" },
      { key: "Commodity",    bar: "#F59E0B", tint: "#FEF3C7", ink: "#B45309", icon: "🪙" }
    ];

    var portfolioPrefixes = fiExcluded ? ["equity", "stocksetf"] : ["equity", "stocksetf", "fixedincome", "fd"];
    var portfolioNames = collectPortfolioNamesFromSheets(portfolioPrefixes) || [];

    // Palette shared with Portfolio Split for stable per-portfolio colors
    var PORTF_PALETTE = ["#10B981", "#F59E0B", "#3B82F6", "#8B5CF6", "#06B6D4", "#EC4899", "#84CC16", "#6366F1"];
    var portfolioColor = {};
    portfolioNames
      .map(function (n) { return { name: n, total: computeTotalInvestment(n, portfolioPrefixes) }; })
      .filter(function (p) { return p.total > UNITS_EPSILON; })
      .sort(function (a, b) { return b.total - a.total; })
      .forEach(function (p, i) { portfolioColor[p.name] = PORTF_PALETTE[i % PORTF_PALETTE.length]; });

    // Commodity detection from the mapping sheets.
    var _mfCatMap = {}, _seMap = {};
    try { _mfCatMap = buildMfCategoryMap(); } catch (e) {}
    try { _seMap = buildStockMappingTable(); } catch (e) {}
    function _isCommodityMf(nm) { return _mfCatMap[normalizeText(nm)] === "commodity"; }
    function _isCommoditySe(nm) { var m = _seMap[normalizeText(nm)]; return !!(m && m.category && normalizeText(m.category) === "commodity"); }

    // Per-portfolio INVESTED split (non-commodity Equity / Commodity MF+ETF / FI).
    // Used for chip proportions within each category (a good approximation until
    // per-portfolio current values arrive).
    var eqInvByP = {}, commInvByP = {}, fiInvByP = {};
    portfolioNames.forEach(function (n) {
      var eqInv = 0, commInv = 0;
      var mfRows = getSheetRows("equity");
      if (mfRows) {
        var tx = groupUnitTransactionsByInstrument(mfRows, n) || {};
        Object.keys(tx).forEach(function (nm) {
          var s = 0; fifoRemainingLots(tx[nm]).forEach(function (l) { s += l.units * l.price; });
          if (_isCommodityMf(nm)) commInv += s; else eqInv += s;
        });
      }
      var seRows = getSheetRows("stocksetf");
      if (seRows) {
        var tx2 = groupUnitTransactionsByInstrument(seRows, n) || {};
        Object.keys(tx2).forEach(function (nm) {
          var s = 0; fifoRemainingLots(tx2[nm]).forEach(function (l) { s += l.units * l.price; });
          if (_isCommoditySe(nm)) commInv += s; else eqInv += s;
        });
      }
      if (eqInv > UNITS_EPSILON) eqInvByP[n] = eqInv;
      if (commInv > UNITS_EPSILON) commInvByP[n] = commInv;
      if (!fiExcluded) {
        var fi = computeTotalInvestment(n, ["fixedincome", "fd"]);
        if (fi > UNITS_EPSILON) fiInvByP[n] = fi;
      }
    });

    // Category TOTALS are the SUM of per-portfolio CURRENT values across ALL
    // portfolios (computePortfolioCurrentBreakdown — same helper Portfolio Split
    // uses), never the overview store (which follows the Overview's selected portfolio). Until the
    // async currents resolve, invested sums serve as a fast placeholder. The only
    // adjustment is moving the commodity MF/ETF current value out of Equity into
    // Commodity (net-zero on the grand total). commCurrentByP holds physical +
    // MF/ETF commodity current per portfolio for the Commodity chips.
    var commCurrentByP = {};
    var catTotal = { "Equity": 0, "Fixed Income": 0, "Commodity": 0 };
    var _allCur = null;             // { eq, fi, comm } summed over all portfolios
    var _lastCommEtfMf = 0;         // last commodity-MF/ETF current total applied
    function recomputeTotals(commEtfMfCurrentTotal) {
      _lastCommEtfMf = commEtfMfCurrentTotal;
      if (_allCur) {
        // computePortfolioCurrentBreakdown has ALREADY moved commodity-category
        // funds/ETFs out of Equity and into Commodity. Applying
        // commEtfMfCurrentTotal here as well counted a gold ETF twice in
        // Commodity and subtracted it twice from Equity — net-zero on the grand
        // total, which is why it looked plausible. Take these as-is.
        catTotal["Equity"] = Math.max(0, _allCur.eq);
        catTotal["Fixed Income"] = fiExcluded ? 0 : _allCur.fi;
        catTotal["Commodity"] = fiExcluded ? 0 : _allCur.comm;
        return;
      }
      // Invested placeholder: eqInvByP excludes commodity MF/ETF, so add it back
      // for the base that commEtfMfCurrentTotal is subtracted from.
      var eqBase = 0, commPhys = 0, fiC = 0;
      Object.keys(eqInvByP).forEach(function (n) { eqBase += eqInvByP[n]; });
      Object.keys(commInvByP).forEach(function (n) { eqBase += commInvByP[n]; });
      Object.keys(fiInvByP).forEach(function (n) { fiC += fiInvByP[n]; });
      catTotal["Equity"] = Math.max(0, eqBase - commEtfMfCurrentTotal);
      catTotal["Fixed Income"] = fiExcluded ? 0 : fiC;
      catTotal["Commodity"] = (fiExcluded ? 0 : commPhys) + commEtfMfCurrentTotal;
    }
    recomputeTotals(0);

    // All-portfolio current pass: sum each portfolio's actual current breakdown,
    // then re-anchor the category totals and redraw. Selection-independent.
    Promise.all(portfolioNames.map(function (n) {
      return computePortfolioCurrentBreakdown(n).then(function (b) { return b; }).catch(function () { return null; });
    })).then(function (results) {
      var eq = 0, fi = 0, comm = 0, any = false;
      results.forEach(function (b) {
        if (!b) return;
        eq += b.equity || 0; fi += b.fixedIncome || 0; comm += b.commodity || 0;
        if ((b.equity || 0) + (b.fixedIncome || 0) + (b.commodity || 0) > UNITS_EPSILON) any = true;
      });
      if (!any) return;
      _allCur = { eq: eq, fi: fi, comm: comm };
      recomputeTotals(_lastCommEtfMf);
      draw();
    });

    function chipMapFor(catKey) {
      if (catKey === "Equity") return eqInvByP;
      if (catKey === "Fixed Income") return fiInvByP;
      // Commodity: prefer actual current per portfolio once loaded, else invested.
      return Object.keys(commCurrentByP).length ? commCurrentByP : commInvByP;
    }
    function portfolioChipsForCat(catKey) {
      var byName = chipMapFor(catKey) || {};
      var names = Object.keys(byName).sort(function (a, b) { return byName[b] - byName[a]; });
      var sum = names.reduce(function (s, n) { return s + byName[n]; }, 0);
      if (sum <= 0) return "";
      return names.map(function (n) {
        var pc = (byName[n] / sum) * 100;
        var pcStr = (pc < 1 ? pc.toFixed(1) : String(Math.round(pc))) + "%";
        var color = portfolioColor[n] || "#94A3B8";
        return '<span class="isc-cat-chip" title="' + n + ' ₹' + Math.round(byName[n]).toLocaleString("en-IN") + '"><span class="isc-cat-dot" style="background:' + color + '"></span>' +
          n + ' ' + pcStr + '</span>';
      }).join("");
    }

    function draw() {
      var entries = CATS
        .map(function (c) { return { name: c.key, value: catTotal[c.key] || 0, meta: c }; })
        .filter(function (e) { return e.value > UNITS_EPSILON; })
        .sort(function (a, b) { return b.value - a.value; });

      if (!entries.length) {
        statusEl.textContent = "No holdings found yet.";
        barEl.innerHTML = ""; listEl.innerHTML = ""; totalEl.textContent = "—";
        return;
      }
      var total = entries.reduce(function (s, e) { return s + e.value; }, 0);

      // Label is always "CURRENT TOTAL" per product decision — the invested
      // figures are only a brief placeholder until _allCur resolves.
      if (catLabelEl) {
        catLabelEl.textContent = "CURRENT TOTAL";
      }
      totalEl.textContent = formatCurrency(total);

      barEl.innerHTML = entries.map(function (e) {
        var pct = (e.value / total) * 100;
        return '<span class="isc-bar-seg" style="flex:' + pct + ' 0 0;background:' + e.meta.bar + ';" title="' + escapeHtml(e.name) + '"></span>';
      }).join("");

      listEl.innerHTML = entries.map(function (e) {
        var pct = (e.value / total) * 100;
        var pctStr = (pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)) + "%";
        return '<div class="isc-row">' +
          '<div class="isc-avatar" style="background:' + e.meta.tint + ';color:' + e.meta.ink + ';">' + e.meta.icon + '</div>' +
          '<div class="isc-row-body">' +
            '<div class="isc-row-name">' + escapeHtml(e.name) + '</div>' +
            '<div class="isc-row-sub isc-cat-sub">' + portfolioChipsForCat(e.name) + '</div>' +
          '</div>' +
          '<div class="isc-row-nums">' +
            '<div class="isc-row-amount">' + formatCurrency(e.value) + '</div>' +
            '<div class="isc-row-pct" style="color:' + e.meta.bar + ';">' + pctStr + '</div>' +
          '</div>' +
        '</div>';
      }).join("");

      statusEl.textContent = "";
    }
    draw();

    // Physical commodity CURRENT value per portfolio (for Commodity chips only —
    // the category total comes from the all-portfolio current pass above).
    if (!fiExcluded) {
      var fdRows = getSheetRows("fd");
      var uniqueDates = fdRows ? collectCommodityUniqueDates(fdRows, selected) : [];
      if (fdRows && fdRows.length && _hasCommodityRows(fdRows, selected)) {
        Promise.all([
          fetchGoldPriceINRPerGram().catch(function () { return null; }),
          Promise.all(uniqueDates.map(function (d) {
            return fetchXauInrForDate(d).then(function (p) { return { dateStr: d, price: p }; }).catch(function () { return { dateStr: d, price: null }; });
          }))
        ]).then(function (results) {
          var goldPrice = results[0]; if (!goldPrice) return;
          var histPrices = {}; results[1].forEach(function (r) { if (r.price) histPrices[r.dateStr] = r.price; });
          var commHoldings = buildCommodityHoldingsList(fdRows, selected, goldPrice, histPrices) || [];
          commHoldings.forEach(function (h) {
            if (!(h.current > UNITS_EPSILON)) return;
            var name = (h.portfolio || "").trim() || "Unassigned";
            commCurrentByP[name] = (commCurrentByP[name] || 0) + h.current;
          });
          draw();
        });
      }
    }

    // Commodity MF/ETF CURRENT value (total + per portfolio). The total is moved
    // out of Equity into Commodity via recomputeTotals; the per-portfolio values
    // feed the Commodity chips.
    if (!fiExcluded) {
      (function commodityMfEtfCurrent() {
        var rowsSE = getSheetRows("stocksetf");
        var rowsMF = getSheetRows("equity");
        var running = { v: 0 };
        var work = [];
        if (rowsSE && Object.keys(_seMap).length) {
          work.push(fetchAllStockPrices().catch(function () { return { prices: {} }; }).then(function (data) {
            var prices = data.prices || {};
            var usdInrToday = prices["__USD_INR__"] ? prices["__USD_INR__"].price : 84;
            portfolioNames.forEach(function (p) {
              var tx = groupUnitTransactionsByInstrument(rowsSE, p); if (!tx) return;
              Object.keys(tx).forEach(function (nm) {
                if (!_isCommoditySe(nm)) return;
                var m = _seMap[normalizeText(nm)];
                var units = 0; fifoRemainingLots(tx[nm]).forEach(function (l) { units += l.units; });
                var pe = prices[m.ticker]; var ltp = pe ? pe.price : null;
                if (ltp == null || units < UNITS_EPSILON) return;
                var val = units * ltp; if (m.region === "US") val *= usdInrToday;
                commCurrentByP[p] = (commCurrentByP[p] || 0) + val;
                running.v += val;
              });
            });
          }));
        }
        if (rowsMF) {
          work.push(buildInstrumentSchemeMap().then(function (schemeMap) {
            var jobs = [];
            portfolioNames.forEach(function (p) {
              var tx = groupUnitTransactionsByInstrument(rowsMF, p); if (!tx) return;
              Object.keys(tx).forEach(function (nm) {
                if (!_isCommodityMf(nm)) return;
                var units = 0; fifoRemainingLots(tx[nm]).forEach(function (l) { units += l.units; });
                if (units < 1) return;
                var code = lookupSchemeCode(schemeMap, nm); if (!code) return;
                jobs.push(fetchNavHistory(code).catch(function () { return []; }).then(function (nh) {
                  var latest = nh.length ? nh[nh.length - 1] : null; if (!latest) return;
                  var val = units * latest.nav;
                  commCurrentByP[p] = (commCurrentByP[p] || 0) + val;
                  running.v += val;
                }));
              });
            });
            return Promise.all(jobs);
          }));
        }
        Promise.all(work).then(function () {
          recomputeTotals(running.v);
          try { draw(); } catch (e) {}
        }).catch(function () {});
      })();
    }
  }

  // No initializers: renderMonthlyInvestmentByCategory() runs earlier in this
  // script, and `= null` here would wipe the state it already set.
  var __monthlyInvestCatChart;
  var __monthlyInvestCatData; // { byMonthCat, yearList }
  // ─── Realized Profit by Category card ─────────────────────────────────────
  // instrument (normalized) → { category, sub } from the Mutual Fund mapping.
  function buildMfCatSubMap() {
    var rows = getSheetRows("mfmapping");
    var map = {};
    if (!rows || rows.length < 2) return map;
    var header = rows[0].map(normalizeText);
    var iIdx = header.indexOf("instrument name");
    var cIdx = header.indexOf("instrument category");
    var sIdx = header.indexOf("instrument sub category");
    if (sIdx === -1) sIdx = header.findIndex(function (h) { return h.indexOf("market segment") !== -1 || h.indexOf("segment") !== -1; });
    if (iIdx === -1) return map;
    rows.slice(1).forEach(function (row) {
      var name = (row[iIdx] || "").trim();
      if (!name) return;
      map[normalizeText(name)] = {
        category: cIdx !== -1 ? (row[cIdx] || "").trim() : "",
        sub: sIdx !== -1 ? (row[sIdx] || "").trim() : ""
      };
    });
    return map;
  }

  // Computes realized (booked) profit — sale proceeds minus FIFO-matched cost —
  // Realized detail for each SOLD instrument, bucketed by the month of the sale:
  // { "YYYY-MM": { normalisedInstrument: { units, cost, proceeds } } }.
  //
  // Deliberately the same FIFO as buildRealizedProfitByCategory — lots consumed
  // oldest first across the instrument's whole history, units clamped to what was
  // actually matched so overselling cannot credit zero-cost proceeds, and US legs
  // converted at each transaction's own USD/INR rate. Only sells are attributed
  // to a month; the buys that funded them keep their original dates, which is
  // what makes the cost basis right.
  //
  // Only the unit-priced sheets are covered. FD/PF/commodity rows carry no unit
  // price, so the drill-down leaves their price and P&L columns blank rather than
  // inventing a number.
  var __micRealizedCache = {};
  function buildRealizedByMonthInstrument(portfolioFilter) {
    var cacheKey = portfolioFilter || "all";
    if (__micRealizedCache[cacheKey]) return __micRealizedCache[cacheKey];
    var pr = fetchAllStockPrices().catch(function () { return {}; }).then(function (sp) {
      var usdInr = (sp && sp.usd_inr_history) || {};
      var usdToday = (sp && sp.prices && sp.prices["__USD_INR__"]) ? sp.prices["__USD_INR__"].price : 84;
      var seMap = buildStockMappingTable();
      var out = {};
      // Keyed by portfolio as well as instrument. The drill-down lists rows under
      // a portfolio heading, and running one combined FIFO would report the same
      // realized figure against every portfolio that sold the instrument that
      // month — double counting it. A per-portfolio pool also matches how the
      // rest of the app derives per-portfolio numbers.
      function add(d, pf, instr, units, cost, proceeds) {
        if (!d || units <= 0) return;
        var key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        out[key] = out[key] || {};
        out[key][pf] = out[key][pf] || {};
        var e = out[key][pf][instr] = out[key][pf][instr] || { units: 0, cost: 0, proceeds: 0 };
        e.units += units; e.cost += cost; e.proceeds += proceeds;
      }
      var pfNames = collectPortfolioNamesFromSheets(["equity", "stocksetf"]) || [];
      // When the chart is already filtered to one portfolio, that is the only
      // pool that can appear.
      if (portfolioFilter && portfolioFilter !== "all") pfNames = [portfolioFilter];
      pfNames.forEach(function (pf) {
      ["equity", "stocksetf"].forEach(function (prefix) {
        var rows = getSheetRows(prefix);
        if (!rows) return;
        var tx = groupUnitTransactionsByInstrument(rows, pf);
        if (!tx) return;
        Object.keys(tx).forEach(function (instr) {
          var norm = normalizeText(instr);
          var isUsd = false;
          if (prefix === "stocksetf") {
            var m = seMap[norm];
            isUsd = !!(m && normalizeText(m.region) === "us");
          }
          var lots = [];
          tx[instr].forEach(function (t) {
            if (t.type === "buy") {
              var buyRate = isUsd ? lookupUsdInrRate(usdInr, formatDateISO(t.date), usdToday) : 1;
              lots.push({ units: t.units, cost: t.price * buyRate });
              return;
            }
            var toMatch = t.units, costMatched = 0, matched = 0;
            while (toMatch > 0 && lots.length) {
              var l = lots[0];
              var mq = Math.min(toMatch, l.units);
              costMatched += mq * l.cost;
              matched += mq;
              l.units -= mq;
              toMatch -= mq;
              if (l.units <= 0) lots.shift();
            }
            if (matched <= 0) return;
            var sellRate = isUsd ? lookupUsdInrRate(usdInr, formatDateISO(t.date), usdToday) : 1;
            add(t.date, pf, norm, matched, costMatched, matched * t.price * sellRate);
          });
        });
      });
      });
      return out;
    }).catch(function () { return {}; });
    __micRealizedCache[cacheKey] = pr;
    return pr;
  }

  // from Mutual Fund + Stocks/ETF sells, bucketed by year → category → sub
  // category. US sells/costs are converted to INR at each leg's transaction-date
  // rate. Returns Promise<{ buckets, years }>, where buckets[year|"all"][cat][sub].
  function buildRealizedProfitByCategory(portfolioFilter) {
    var fdRows = getSheetRows("fd");
    var commDates = (fdRows && typeof collectCommodityUniqueDates === "function")
      ? collectCommodityUniqueDates(fdRows, portfolioFilter) : [];
    return Promise.all([
      fetchAllStockPrices().catch(function () { return {}; }),
      _hasCommodityRows(fdRows, portfolioFilter)
        ? fetchGoldPriceINRPerGram().catch(function () { return null; })
        : Promise.resolve(null),
      Promise.all(commDates.map(function (d) {
        return fetchXauInrForDate(d).then(function (p) { return { d: d, p: p }; }).catch(function () { return { d: d, p: null }; });
      }))
    ]).then(function (res) {
      var sp = res[0], goldPrice = res[1];
      var commHist = {};
      res[2].forEach(function (r) { if (r.p) commHist[r.d] = r.p; });
      var usdInr = (sp && sp.usd_inr_history) || {};
      var usdToday = (sp && sp.prices && sp.prices["__USD_INR__"]) ? sp.prices["__USD_INR__"].price : 84;
      var seMap = buildStockMappingTable();
      var mfMap = buildMfCatSubMap();

      var buckets = {}, years = {};
      function add(year, cat, sub, amt) {
        if (!amt) return;
        years[year] = true;
        [year, "all"].forEach(function (Y) {
          buckets[Y] = buckets[Y] || {};
          buckets[Y][cat] = buckets[Y][cat] || {};
          buckets[Y][cat][sub] = (buckets[Y][cat][sub] || 0) + amt;
        });
      }
      // For realized amounts that can't be attributed to a specific year
      // (FD accrued interest, PF interest): count only under "All time".
      function addAllOnly(cat, sub, amt) {
        if (!amt) return;
        buckets["all"] = buckets["all"] || {};
        buckets["all"][cat] = buckets["all"][cat] || {};
        buckets["all"][cat][sub] = (buckets["all"][cat][sub] || 0) + amt;
      }

      [{ prefix: "equity", defCat: "Mutual Funds" }, { prefix: "stocksetf", defCat: "Stocks/ETF" }].forEach(function (spec) {
        var rows = getSheetRows(spec.prefix);
        if (!rows) return;
        var tx = groupUnitTransactionsByInstrument(rows, portfolioFilter);
        if (!tx) return;
        Object.keys(tx).forEach(function (instr) {
          var norm = normalizeText(instr);
          var cat, sub, region = "India";
          if (spec.prefix === "stocksetf") {
            var m = seMap[norm];
            cat = (m && m.category) || spec.defCat;
            sub = (m && (m.subCat || m.segment)) || (m && m.category) || "Other";
            region = (m && m.region) || "India";
          } else {
            var mm = mfMap[norm];
            cat = (mm && mm.category) || spec.defCat;
            sub = (mm && mm.sub) || "Other";
          }
          if (!cat) cat = spec.defCat;
          if (!sub) sub = cat;
          var isUsd = normalizeText(region) === "us";
          var lots = [];
          tx[instr].forEach(function (t) {
            if (t.type === "buy") {
              var buyRate = isUsd ? (lookupUsdInrRate(usdInr, formatDateISO(t.date), usdToday)) : 1;
              lots.push({ units: t.units, cost: t.price * buyRate });
              return;
            }
            var toMatch = t.units, costMatched = 0, matched = 0;
            while (toMatch > 0 && lots.length) {
              var l = lots[0];
              var mq = Math.min(toMatch, l.units);
              costMatched += mq * l.cost;
              matched += mq;
              l.units -= mq;
              toMatch -= mq;
              if (l.units <= 0) lots.shift();
            }
            if (matched <= 0) return;
            var sellRate = isUsd ? (lookupUsdInrRate(usdInr, formatDateISO(t.date), usdToday)) : 1;
            var realized = (matched * t.price * sellRate) - costMatched;
            var yr = t.date ? String(t.date.getFullYear()) : null;
            if (yr) add(yr, cat, sub, realized);
          });
        });
      });

      // Commodity (physical gold/silver from the fd sheet): realized on sale,
      // attributed to the sell year and its sub-category.
      if (fdRows && goldPrice) {
        var commHoldings = buildCommodityHoldingsList(fdRows, portfolioFilter, goldPrice, commHist) || [];
        commHoldings.forEach(function (h) {
          if (!h.realizedProfit) return;
          var yr = h.sellDateStr ? h.sellDateStr.slice(0, 4) : null;
          var sub = h.subCategory || "Commodity";
          if (yr) add(yr, "Commodity", sub, h.realizedProfit);
          else addAllOnly("Commodity", sub, h.realizedProfit);
        });
      }

      // Fixed Income realized — matured-FD interest is booked at its maturity year;
      // Provident Fund interest is booked at each withdrawal year. Attributed per
      // year (falling back to "all" only when a date is missing).
      if (fdRows) {
        var fdByYear = fdMaturedRealizedByYear(fdRows, portfolioFilter);
        Object.keys(fdByYear).forEach(function (y) {
          if (y === "all") addAllOnly("Fixed Income", "Fixed Deposit", fdByYear[y]);
          else add(y, "Fixed Income", "Fixed Deposit", fdByYear[y]);
        });
        var pfByYear = pfRealizedByYear(fdRows, portfolioFilter);
        Object.keys(pfByYear).forEach(function (y) {
          if (y === "all") addAllOnly("Fixed Income", "Provident Fund", pfByYear[y]);
          else add(y, "Fixed Income", "Provident Fund", pfByYear[y]);
        });
      }

      return { buckets: buckets, years: Object.keys(years).sort() };
    });
  }

  // Year selection now matches EXPENSE BY CATEGORY: a decade-grid picker holding
  // real years only, with "All time" split out into its own toggle. The buckets
  // are still keyed by year plus an "all" bucket, so the lookup key is derived
  // from the two pieces of state rather than stored as a fake year.
  var __profitCatYear = null;
  var __profitCatAllTime = true;
  var __profitCatPortfolio = "all";
  var __profitCatExpanded = {}; // category → expanded?
  function renderProfitByCategoryCard() {
    var listEl = document.getElementById("profit-cat-list");
    var totalEl = document.getElementById("profit-cat-total");
    var labelEl = document.getElementById("profit-cat-total-label");
    var yearSel = document.getElementById("profit-cat-year");
    var portSel = document.getElementById("profit-cat-portfolio");
    var statusEl = document.getElementById("profit-cat-status");
    if (!listEl || !totalEl || !yearSel) return;

    // Portfolio dropdown: All Portfolios + each portfolio (independent of the
    // Overview selector).
    if (portSel) {
      var portNames = collectPortfolioNamesFromSheets(["equity", "stocksetf", "fd"]) || [];
      var wantPorts = ["all"].concat(portNames);
      var havePorts = [];
      for (var pi = 0; pi < portSel.options.length; pi++) havePorts.push(portSel.options[pi].value);
      if (havePorts.join(",") !== wantPorts.join(",")) {
        portSel.innerHTML = wantPorts.map(function (p) {
          return '<option value="' + escapeHtml(p) + '">' + (p === "all" ? "All Portfolios" : escapeHtml(p)) + '</option>';
        }).join("");
      }
      if (wantPorts.indexOf(__profitCatPortfolio) === -1) __profitCatPortfolio = "all";
      portSel.value = __profitCatPortfolio;
      portSel.onchange = function () { __profitCatPortfolio = portSel.value; renderProfitByCategoryCard(); };
    }

    var portfolioFilter = __profitCatPortfolio;
    buildRealizedProfitByCategory(portfolioFilter).then(function (data) {
      var years = data.years || [];
      // Real years only, ascending — the picker greys the rest of the decade, so
      // a year with no realized profit is visible rather than absent.
      var wantOpts = years.slice().sort();
      var haveOpts = [];
      for (var oi = 0; oi < yearSel.options.length; oi++) haveOpts.push(yearSel.options[oi].value);
      if (haveOpts.join(",") !== wantOpts.join(",")) {
        yearSel.innerHTML = wantOpts.map(function (y) {
          return '<option value="' + y + '">' + y + '</option>';
        }).join("");
      }
      if (!__profitCatYear || wantOpts.indexOf(__profitCatYear) === -1) {
        __profitCatYear = wantOpts.length ? wantOpts[wantOpts.length - 1] : null;
      }
      if (__profitCatYear) yearSel.value = __profitCatYear;
      yearSel.onchange = function () {
        __profitCatYear = yearSel.value;
        __profitCatAllTime = false;
        renderProfitByCategoryCard();
      };
      _wfYpAttach(yearSel);
      _wfYpSetHidden(yearSel, __profitCatAllTime || !wantOpts.length);

      var allBtn = document.getElementById("profit-cat-alltime");
      if (allBtn) {
        allBtn.classList.toggle("active", !!__profitCatAllTime);
        allBtn.onclick = function () {
          __profitCatAllTime = !__profitCatAllTime;
          renderProfitByCategoryCard();
        };
      }

      // "all" is a bucket key, not a selectable year.
      var bucketKey = (__profitCatAllTime || !__profitCatYear) ? "all" : __profitCatYear;
      if (labelEl) labelEl.textContent = bucketKey === "all" ? "REALIZED PROFIT · ALL TIME" : ("REALIZED PROFIT · " + bucketKey);

      var byCat = data.buckets[bucketKey] || {};
      var cats = Object.keys(byCat).map(function (cat) {
        var subs = byCat[cat];
        var catTotal = Object.keys(subs).reduce(function (s, k) { return s + subs[k]; }, 0);
        return { cat: cat, total: catTotal, subs: subs };
      }).filter(function (c) { return Math.abs(c.total) > 0.5; })
        .sort(function (a, b) { return b.total - a.total; });

      var grand = cats.reduce(function (s, c) { return s + c.total; }, 0);
      totalEl.textContent = (grand >= 0 ? "+" : "") + formatCurrency(grand);
      totalEl.className = "isc-total-value " + (grand > 0 ? "positive" : grand < 0 ? "negative" : "");
      totalEl.title = Math.abs(grand) >= 1e7 ? (grand >= 0 ? "+" : "") + formatCurrencyFull(grand) : "";

      var yearNote = "";
      if (!cats.length) {
        listEl.innerHTML = "";
        if (statusEl) statusEl.textContent = "No realized profit booked" + (bucketKey === "all" ? " yet." : " in " + bucketKey + ".");
        return;
      }
      if (statusEl) statusEl.textContent = yearNote;

      listEl.innerHTML = cats.map(function (c) {
        var expanded = !!__profitCatExpanded[c.cat];
        var sign = c.total >= 0 ? "positive" : "negative";
        var caret = '<span class="pcat-caret">' + (expanded ? "▾" : "▸") + '</span>';
        var subRows = Object.keys(c.subs)
          .map(function (s) { return { sub: s, val: c.subs[s] }; })
          .filter(function (s) { return Math.abs(s.val) > 0.5; })
          .sort(function (a, b) { return b.val - a.val; })
          .map(function (s) {
            var scls = s.val >= 0 ? "positive" : "negative";
            return '<div class="pcat-subrow"><span class="pcat-sub-name">' + escapeHtml(s.sub) + '</span>' +
              '<span class="pcat-sub-val ' + scls + '"' + _crTitle(s.val) + '>' + (s.val >= 0 ? "+" : "") + formatCurrency(s.val) + '</span></div>';
          }).join("");
        return '<div class="pcat-group">' +
          '<div class="pcat-row" role="button" tabindex="0" data-pcat="' + escapeHtml(c.cat) + '">' +
            caret + '<span class="pcat-name">' + escapeHtml(c.cat) + '</span>' +
            '<span class="pcat-val ' + sign + '"' + _crTitle(c.total) + '>' + (c.total >= 0 ? "+" : "") + formatCurrency(c.total) + '</span>' +
          '</div>' +
          '<div class="pcat-subs" style="display:' + (expanded ? "block" : "none") + ';">' + subRows + '</div>' +
        '</div>';
      }).join("");

      Array.prototype.forEach.call(listEl.querySelectorAll("[data-pcat]"), function (row) {
        function toggle() {
          var cat = row.getAttribute("data-pcat");
          __profitCatExpanded[cat] = !__profitCatExpanded[cat];
          renderProfitByCategoryCard();
        }
        row.addEventListener("click", toggle);
        row.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
      });
    }).catch(function () {});
  }

  var __monthlyInvestCatYear;
  var __monthlyInvestCatAllTime = false;
  var __monthlyInvestCatSplit = false; // off = single total bar per month
  var __monthlyInvestCatNet = false; // on = bars show invested minus withdrawn
  // Split mode: instruments picked from the legend. Empty = show every
  // instrument. Multiple may be selected, so the chart can compare a chosen
  // subset rather than only one instrument at a time.
  var __monthlyInvestCatFilters = [];
  // Drill-down modal: "all" | "in" (bought) | "out" (sold), plus a handle to the
  // current render so the filter buttons — bound once, outside the chart's
  // per-render closure — can redraw the open month.
  var __micTxnFilter = "all";
  var __micRealizedData = null;
  var __micTxnRerender = null;
  var __monthlyInvestCatIdle = false; // on = show month-on-month parked-cash balances (Savings Account + Investment Corpus)
  var __monthlyIdleCashData; // { byMonthInstr, instruments, yearList }
  // Idle Cash keeps its OWN legend selection. It lists parked-cash instruments
  // (Savings Account, Investment Corpus), a different namespace from the flow
  // views' sub-categories, so sharing __monthlyInvestCatFilters would mean a
  // pick made in one view silently emptying the other.
  var __monthlyIdleCashFilters = [];

  // MON_LABELS and MIC_PALETTE are defined inside drawMonthlyInvestCatChart to avoid hoisting issues

  function buildMonthlyInvestCatData(portfolioOverride) {
    // Cash Flow · Monthly follows the Overview portfolio selector; callers with a
    // different scope (e.g. the household-wide Income & Expenses chart) pass an
    // explicit portfolioOverride instead of inheriting the selection.
    var ovPortfolio = portfolioOverride || localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
    function ovSkip(row, portIdx) {
      return ovPortfolio !== "all" && portIdx !== -1 &&
        normalizeText((row[portIdx] || "").trim()) !== normalizeText(ovPortfolio);
    }
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

    // Instrument -> Instrument Category ("Equity", "Commodity", "Fixed Income"),
    // read from the mapping sheets' own column rather than inferred. Deriving it
    // from the sub-category was wrong: a gold fund's sub-category reads "Gold",
    // not "Commodity", so it was silently grouped under Equity and no Commodity
    // row ever appeared.
    var instrTopCatMap = {};
    ["mfmapping", "stocksetfmapping"].forEach(function (mp) {
      var mrows = getSheetRows(mp);
      if (!mrows || mrows.length < 2) return;
      var mhdr = mrows[0].map(normalizeText);
      var miIdx = mhdr.indexOf("instrument name");
      var mcIdx = mhdr.indexOf("instrument category");
      if (miIdx === -1 || mcIdx === -1) return;
      mrows.slice(1).forEach(function (r) {
        var instr = (r[miIdx] || "").trim();
        var tcat = (r[mcIdx] || "").trim();
        if (instr && tcat) instrTopCatMap[normalizeText(instr)] = tcat;
      });
    });

    // US stocks and ETFs are priced in dollars in the sheet, while this chart is
    // entirely in rupees — a $78 purchase was drawn, and totalled, as ₹78. Convert
    // at the transaction's own date rate, the same way every other rupee figure in
    // the app does. The rates come from the in-memory price payload; when it has
    // not arrived yet the caller re-renders once it has.
    var _sp = getCachedStockPrices();
    var usdInrMap = (_sp && _sp.usd_inr_history) || null;
    var usdInrToday = (_sp && _sp.prices && _sp.prices["__USD_INR__"])
      ? _sp.prices["__USD_INR__"].price : 84;
    var usRegionByInstr = {};
    (function () {
      var mrows = getSheetRows("stocksetfmapping");
      if (!mrows || mrows.length < 2) return;
      var mhdr = mrows[0].map(normalizeText);
      var miIdx = mhdr.indexOf("instrument name");
      var mrIdx = mhdr.indexOf("region");
      if (miIdx === -1 || mrIdx === -1) return;
      mrows.slice(1).forEach(function (r) {
        var instr = (r[miIdx] || "").trim();
        if (instr && normalizeText(r[mrIdx]) === "us") usRegionByInstr[normalizeText(instr)] = true;
      });
    }());
    function toInr(amount, instrName, d) {
      if (!usRegionByInstr[instrName]) return amount;
      return amount * lookupUsdInrRate(usdInrMap, formatDateISO(d), usdInrToday);
    }

    var byMonthCat = {};
    var byMonthCatOut = {}; // withdrawals / sells / redemptions
    // Same flows rolled up to Instrument Category (Equity / Fixed Income /
    // Commodity) instead of sub-category. The card's aggregate view has no
    // per-instrument bars, so its hover breakdown reports these broader groups.
    var byMonthGrp = {};
    var byMonthGrpOut = {};
    // Row-level detail behind each month, captured here rather than re-derived
    // later so the drill-down can never disagree with the bars: it comes from
    // the same pass, past the same portfolio, parked-cash and transaction-type
    // filters.
    var byMonthTxns = {};
    var allYears = {};
    function recordTxn(d, rec) {
      var key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      (byMonthTxns[key] = byMonthTxns[key] || []).push(rec);
    }
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
    // Savings Account / Investment Corpus are running-balance parked cash, not
    // discrete cash-flow events — excluded from the monthly cash-flow chart so
    // balance snapshots don't masquerade as monthly inflows/outflows.
    function isParkedCashSub(sub) {
      var s = normalizeText(sub || "");
      return s === "savings account" || s === "investment corpus";
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
      var portIdx = header.indexOf("portfolio name");
      if (typeIdx === -1 || dateIdx === -1) return;
      if (amtIdx === -1 && (unitsIdx === -1 || priceIdx === -1)) return;
      rows.slice(1).forEach(function (row) {
        if (ovSkip(row, portIdx)) return;
        var type = normalizeText(row[typeIdx] || "");
        var isBuy = type.indexOf("buy") !== -1;
        var isOut = isOutType(type);
        if (!isBuy && !isOut) return;
        var d = parseFlexibleDate(row[dateIdx]);
        if (!d) return;
        var amount = amtIdx !== -1 ? parseNumber(row[amtIdx]) : (parseNumber(row[unitsIdx]) * parseNumber(row[priceIdx]));
        if (!amount) return;
        var instrName = instrIdx !== -1 ? normalizeText((row[instrIdx] || "").trim()) : "";
        // Only the stocksetf sheet carries US rows; the equity (mutual fund) sheet
        // is rupees throughout, and its instruments are absent from this map.
        amount = toInr(amount, instrName, d);
        var cat = (instrName && instrCatMap[instrName])
          ? instrCatMap[instrName]
          : (subCatIdx !== -1 && row[subCatIdx] ? (row[subCatIdx] || "").trim() : "Other");
        addTo(isBuy ? byMonthCat : byMonthCatOut, d, cat, Math.abs(amount));
        // Gold funds and ETFs live in these sheets but are not Equity. Take the
        // category the mapping sheet states; fall back to Equity only when the
        // instrument has no mapping row at all.
        var grp = (instrName && instrTopCatMap[instrName]) ||
                  (normalizeText(cat) === "commodity" ? "Commodity" : "Equity");
        addTo(isBuy ? byMonthGrp : byMonthGrpOut, d, grp, Math.abs(amount));
        recordTxn(d, {
          date: d,
          instrument: instrIdx !== -1 ? (row[instrIdx] || "").trim() : "",
          portfolio: portIdx !== -1 ? (row[portIdx] || "").trim() : "",
          cat: cat, grp: grp,
          amount: Math.abs(amount),
          out: !isBuy,
          type: (row[typeIdx] || "").trim(),
          source: prefix === "equity" ? "Mutual Fund" : "Stocks/ETF"
        });
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
      var portIdx   = header.indexOf("portfolio name");
      var fiInstrIdx = header.indexOf("instrument name");
      if (typeIdx === -1 || dateIdx === -1 || amtIdx === -1 || subCatIdx === -1) return;
      rows.slice(1).forEach(function (row) {
        if (ovSkip(row, portIdx)) return;
        var type = normalizeText(row[typeIdx] || "");
        var isDep = type.indexOf("deposit") !== -1;
        var isOut = isOutType(type);
        if (!isDep && !isOut) return;
        if (isParkedCashSub(row[subCatIdx])) return;
        var d = parseFlexibleDate(row[dateIdx]);
        if (!d) return;
        var amount = parseNumber(row[amtIdx]);
        if (!amount) return;
        var cat = (row[subCatIdx] || "").trim() || "Fixed Income";
        addTo(isDep ? byMonthCat : byMonthCatOut, d, cat, Math.abs(amount));
        addTo(isDep ? byMonthGrp : byMonthGrpOut, d, "Fixed Income", Math.abs(amount));
        recordTxn(d, {
          date: d,
          instrument: fiInstrIdx !== -1 ? (row[fiInstrIdx] || "").trim() : "",
          portfolio: portIdx !== -1 ? (row[portIdx] || "").trim() : "",
          cat: cat, grp: "Fixed Income",
          amount: Math.abs(amount),
          out: !isDep,
          type: (row[typeIdx] || "").trim(),
          source: "Fixed Income"
        });
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
      var portIdx   = header.indexOf("portfolio name");
      // This sheet holds both fixed income and commodity rows, told apart by
      // the Instrument Category column.
      var instrCatIdx = header.indexOf("instrument category");
      var fdInstrIdx = header.indexOf("instrument name");
      var rateIdx = header.indexOf("rate of return");
      var maturityIdx = header.indexOf("maturity date/sell date");
      if (maturityIdx === -1) maturityIdx = header.indexOf("maturity date");
      var todayD = new Date();
      if (dateIdx === -1 || amtIdx === -1 || subCatIdx === -1) return;
      rows.slice(1).forEach(function (row) {
        if (ovSkip(row, portIdx)) return;
        if (isParkedCashSub(row[subCatIdx])) return;
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
        // Take the sheet's own Instrument Category so any value it uses shows up,
        // instead of collapsing everything that isn't the literal string
        // "commodity" into Fixed Income.
        var grp = (instrCatIdx !== -1 && (row[instrCatIdx] || "").trim()) || "Fixed Income";
        addTo(isOut ? byMonthGrpOut : byMonthGrp, d, grp, Math.abs(amount));
        recordTxn(d, {
          date: d,
          instrument: fdInstrIdx !== -1 ? (row[fdInstrIdx] || "").trim() : "",
          portfolio: portIdx !== -1 ? (row[portIdx] || "").trim() : "",
          cat: cat, grp: grp,
          amount: Math.abs(amount),
          out: isOut,
          type: typeIdx !== -1 ? (row[typeIdx] || "").trim() : "",
          source: grp
        });

        // A fixed deposit has no sell row: the sheet records the deposit and a
        // maturity date, and the money comes back on that date. Without this the
        // chart showed the deposit as an outflow and nothing ever coming in, so a
        // year whose only event was an FD maturing looked empty. Booked at the
        // maturity month for the amount actually received (principal + interest,
        // same engine as the XIRR flows). Only for FDs that have ALREADY matured —
        // a future maturity is not a cash flow yet.
        // Instrument Category must be Fixed Income: a Commodity row's maturity
        // column holds a SELL date, and that sale is already its own row. The
        // old exact "fixed deposit" test excluded commodity by accident; matching
        // term deposits by exclusion means the category has to be checked here.
        if (!isOut && maturityIdx !== -1 &&
            (instrCatIdx === -1 || normalizeText(row[instrCatIdx] || "") === "fixed income") &&
            _fiIsTermDeposit(normalizeText(row[subCatIdx] || ""))) {
          var matD = parseFlexibleDate(row[maturityIdx]);
          if (matD && matD < todayD) {
            var matVal = fdMaturityValue(Math.abs(amount), d, matD,
              rateIdx !== -1 ? parsePercentRate(row[rateIdx]) : 0);
            addTo(byMonthCatOut, matD, cat, matVal);
            addTo(byMonthGrpOut, matD, grp, matVal);
            recordTxn(matD, {
              date: matD,
              instrument: fdInstrIdx !== -1 ? (row[fdInstrIdx] || "").trim() : "",
              portfolio: portIdx !== -1 ? (row[portIdx] || "").trim() : "",
              cat: cat, grp: grp,
              amount: matVal,
              out: true,
              // An FD has no units, so the FIFO realized pass produces nothing for
              // it. Its profit is simply the interest it paid, which is known
              // exactly here — carried on the row so the drill-down can show a
              // real P&L instead of a dash.
              pnl: matVal - Math.abs(amount),
              type: "Maturity",
              source: grp
            });
          }
        }
      });
    }());

    return {
      byMonthCat: byMonthCat, byMonthCatOut: byMonthCatOut,
      byMonthGrp: byMonthGrp, byMonthGrpOut: byMonthGrpOut,
      byMonthTxns: byMonthTxns,
      yearList: Object.keys(allYears).sort()
    };
  }

  // Month-on-month PARKED-CASH balances for the "Idle Cash" toggle. Savings
  // Account and Investment Corpus rows in the fd sheet are running-balance
  // snapshots per (portfolio, bank, instrument): each row REPLACES the prior
  // balance for that key. To show the balance held each month we forward-fill
  // every key's latest snapshot across the timeline and aggregate by instrument
  // name. Returns { byMonthInstr: { "YYYY-MM": { instrument: balance } },
  // instruments: [names], yearList: [years] }.
  function buildMonthlyIdleCashData(portfolioOverride) {
    var ovPortfolio = portfolioOverride || localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
    var empty = { byMonthInstr: {}, instruments: [], yearList: [] };
    var rows = getSheetRows("fd");
    if (!rows || rows.length < 2) return empty;
    var header = rows[0].map(normalizeText);
    var portIdx = header.indexOf("portfolio name");
    var bankIdx = header.indexOf("bank");
    var instrIdx = header.indexOf("instrument name");
    var catIdx = header.indexOf("instrument category");
    var subIdx = header.indexOf("instrument sub category");
    var amtIdx = header.indexOf("invested amount");
    if (amtIdx === -1) amtIdx = header.indexOf("amount");
    var dateIdx = header.indexOf("transaction date");
    if (subIdx === -1 || amtIdx === -1 || dateIdx === -1) return empty;

    function isParked(sub) {
      var s = normalizeText(sub || "");
      return s === "savings account" || s === "investment corpus";
    }

    // Collect balance snapshots per key.
    var snapsByKey = {}; // key -> { instrument, snaps: [{date, balance}] }
    var earliest = null;
    rows.slice(1).forEach(function (row) {
      if (ovPortfolio !== "all" && portIdx !== -1 &&
          normalizeText((row[portIdx] || "").trim()) !== normalizeText(ovPortfolio)) return;
      if (catIdx !== -1 && normalizeText(row[catIdx]) !== "fixed income") return;
      if (!isParked(row[subIdx])) return;
      var d = parseFlexibleDate(row[dateIdx]);
      if (!d) return;
      var bal = parseNumber(row[amtIdx]);
      var portfolio = (portIdx !== -1 ? row[portIdx] : "") || "";
      var bank = (bankIdx !== -1 ? row[bankIdx] : "") || "";
      var instrument = ((instrIdx !== -1 ? row[instrIdx] : "") || "").trim() || bank.trim() || (row[subIdx] || "").trim() || "Idle Cash";
      var key = normalizeText(portfolio) + "||" + normalizeText(bank) + "||" + normalizeText(instrument);
      if (!snapsByKey[key]) snapsByKey[key] = { instrument: instrument, snaps: [] };
      snapsByKey[key].snaps.push({ date: d, balance: bal });
      if (!earliest || d < earliest) earliest = d;
    });

    var keys = Object.keys(snapsByKey);
    if (!keys.length || !earliest) return empty;
    keys.forEach(function (k) { snapsByKey[k].snaps.sort(function (a, b) { return a.date - b.date; }); });

    // Month timeline: first snapshot month .. current month (balances persist).
    var byMonthInstr = {};
    var allYears = {};
    var cur = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
    var today = new Date();
    var end = new Date(today.getFullYear(), today.getMonth(), 1);
    while (cur <= end) {
      var mk = cur.getFullYear() + "-" + String(cur.getMonth() + 1).padStart(2, "0");
      // End-of-month cutoff: latest snapshot on or before this date is the held balance.
      var eom = new Date(cur.getFullYear(), cur.getMonth() + 1, 0, 23, 59, 59);
      keys.forEach(function (k) {
        var rec = snapsByKey[k];
        var bal = null;
        for (var i = 0; i < rec.snaps.length; i++) {
          if (rec.snaps[i].date <= eom) bal = rec.snaps[i].balance; else break;
        }
        if (bal != null && Math.abs(bal) > 0.005) {
          if (!byMonthInstr[mk]) byMonthInstr[mk] = {};
          byMonthInstr[mk][rec.instrument] = (byMonthInstr[mk][rec.instrument] || 0) + bal;
          allYears[String(cur.getFullYear())] = true;
        }
      });
      cur.setMonth(cur.getMonth() + 1);
    }

    var instrSet = {};
    Object.keys(byMonthInstr).forEach(function (mk) {
      Object.keys(byMonthInstr[mk]).forEach(function (n) { instrSet[n] = true; });
    });
    return { byMonthInstr: byMonthInstr, instruments: Object.keys(instrSet).sort(), yearList: Object.keys(allYears).sort() };
  }

  function drawMonthlyInvestCatChart(yr) {
    if (__monthlyInvestCatIdle) { drawMonthlyIdleCashChart(yr); return; }
    var MON_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    var MIC_PALETTE = ["#3B82F6","#10B981","#F59E0B","#8B5CF6","#EF4444","#06B6D4","#EC4899","#84CC16","#F97316","#6366F1"];
    var MIC_GREEN = "#52B788"; var MIC_GREEN_PEAK = "#1B6E45"; var MIC_RED = "#E8623A";
    // Warm palette for split-by-instrument mode (matches screenshot)
    // Colours are assigned by position and wrap with the modulo below, so with
    // only eight entries a ninth sub-category repeated the first one's colour —
    // two different instruments then looked identical in the bars, the legend
    // and the hover split. Sixteen distinct hues push that collision out past
    // any realistic sub-category count.
    var MIC_SPLIT_PALETTE = [
      "#E8623A","#F5A623","#4DC0B5","#8B5CF6","#3B82F6","#10B981","#EC4899","#84CC16",
      "#0EA5E9","#D946EF","#F97316","#14B8A6","#6366F1","#EAB308","#DC2626","#7C3AED"
    ];
    var wrap = document.getElementById("monthly-invest-cat-wrap");
    var statusEl = document.getElementById("monthly-invest-cat-status");
    if (!wrap || typeof Chart === "undefined" || !__monthlyInvestCatData) return;
    try {
    var byMonthCat = __monthlyInvestCatData.byMonthCat;
    var byMonthCatOut = __monthlyInvestCatData.byMonthCatOut || {};
    // Same flows grouped by Instrument Category, used by the hover breakdown in
    // the aggregate view (see renderHoverSplit).
    var byMonthGrp = __monthlyInvestCatData.byMonthGrp || {};
    var byMonthGrpOut = __monthlyInvestCatData.byMonthGrpOut || {};

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
    // In "By instrument" mode a legend click filters the chart to one
    // instrument. The bars honoured that filter but these totals did not, so the
    // Total Invested / Withdrawn / Net figures kept showing every instrument
    // while the chart showed one — the headline numbers disagreed with the bars
    // beneath them. Everything derived from these helpers (the stats row, the
    // tooltip totals, the peak-month highlight and the avg/month) now reflects
    // the selected instrument.
    function catIncluded(cat) {
      return !__monthlyInvestCatFilters.length || __monthlyInvestCatFilters.indexOf(cat) !== -1;
    }
    function investedTotal(k) {
      var m = byMonthCat[k];
      return m ? Object.keys(m).reduce(function (s, c) { return catIncluded(c) ? s + m[c] : s; }, 0) : 0;
    }
    function outTotal(k) {
      var m = byMonthCatOut[k];
      return m ? Object.keys(m).reduce(function (s, c) { return catIncluded(c) ? s + m[c] : s; }, 0) : 0;
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
      // Drop selections that aren't in view (e.g. after a year change), so a
      // stale pick can't leave the chart looking empty with no way to see why.
      __monthlyInvestCatFilters = __monthlyInvestCatFilters.filter(function (c) {
        return catList.indexOf(c) !== -1;
      });
      datasets = [];
      catList.forEach(function (cat, i) {
        if (!catIncluded(cat)) return;
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
        if (!catIncluded(cat)) return;
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
      var hasOut = totalOut > 0;
      statsEl.innerHTML =
        '<div class="mic-stat"><span class="mic-stat-label">Total Invested</span><span class="mic-stat-value">' + formatCurrency(totalInvested) + '</span></div>' +
        (hasOut ? '<div class="mic-stat"><span class="mic-stat-label">Withdrawn</span><span class="mic-stat-value negative">&minus;' + formatCurrency(totalOut) + '</span></div>' : '') +
        (hasOut ? '<div class="mic-stat"><span class="mic-stat-label">Net</span><span class="mic-stat-value ' + (totalNet >= 0 ? 'positive' : 'negative') + '">' + (totalNet >= 0 ? '+' : '−') + formatCurrency(Math.abs(totalNet)) + '</span></div>' : '');
    }

    // ── Hovered-month split, shown under the stats row ──────────────────────
    // This is the per-instrument breakdown that used to sit inside the tooltip.
    // Only the instruments passing the legend selection are listed, so the split
    // always adds up to the Total Invested figure above it.
    var splitEl = document.getElementById("mic-hover-split");
    var __micHoverIdx = -1;

    // Resting state: totals for the whole period on show, broken down by
    // Instrument Category. Summing the plotted months means the current year
    // naturally reads year-to-date (there is no future data to include), while a
    // past year or the all-time view still totals correctly.
    function periodGrpTotals(src) {
      var out = {};
      monthKeys.forEach(function (mk) {
        var m = src[mk];
        if (!m) return;
        Object.keys(m).forEach(function (c) { out[c] = (out[c] || 0) + m[c]; });
      });
      return out;
    }
    function periodScopeLabel() {
      if (__monthlyInvestCatAllTime) return "All time";
      var y = String(yr);
      return y === String(new Date().getFullYear()) ? y + " · Year to date" : y;
    }

    function clearHoverSplit() {
      __micHoverIdx = -1;
      showPeriodSplit();
    }
    function renderHoverSplit(idx) {
      if (!splitEl) return;
      // Ignore repeats: Chart.js fires onHover on every pointer move, and
      // rebuilding the row each time made the text flicker.
      if (idx === __micHoverIdx) return;
      __micHoverIdx = idx;
      var k = monthKeys[idx];
      if (!k) { clearHoverSplit(); return; }

      // Same category colours the Portfolio/Category split cards use, so a
      // category reads the same wherever it appears.
      // Keyed on the normalised name so a category still gets its colour however
      // it is capitalised or spaced in the sheet ("Fixed Income", "fixed income").
      var GRP_COLORS = { "equity": "#10B981", "fixed income": "#3B82F6", "commodity": "#F59E0B" };
      function chips(map, negative) {
        var m = map[k] || {};
        return Object.keys(m)
          .filter(function (c) { return m[c] > 0 && catIncluded(c); })
          .sort(function (a, b) { return m[b] - m[a]; })
          .map(function (c) {
            // The swatch identifies the INSTRUMENT, so it keeps that
            // instrument's legend colour on both rows. It was forced to red on
            // the withdrawal row, which broke the link to the legend and made
            // every withdrawn instrument look alike. Direction is already
            // carried by the row's caption, the minus sign and the red amount.
            var col = GRP_COLORS[normalizeText(c)]; // Instrument Category (aggregate view)
            if (!col) {
              var i = catList.indexOf(c);
              // Position in catList keeps the chip in step with the bars and the
              // legend. A name that isn't in the list falls back to a hash of
              // itself rather than a shared colour, so two such names stay
              // distinguishable instead of both rendering the same green.
              if (i === -1) {
                var hsh = 0;
                for (var hi = 0; hi < c.length; hi++) hsh = (hsh * 31 + c.charCodeAt(hi)) >>> 0;
                i = hsh;
              }
              col = MIC_SPLIT_PALETTE[i % MIC_SPLIT_PALETTE.length];
            }
            return '<span class="mic-hs-item">' +
              '<span class="mic-hs-dot" style="background:' + col + '"></span>' +
              escapeHtml(c) + ' <b class="' + (negative ? 'negative' : '') + '">' +
              (negative ? '&minus;' : '') + formatCurrency(m[c]) + '</b></span>';
          }).join("");
      }

      // "By instrument" breaks the month down by Instrument Sub Category, matching
      // the stacked bars. The aggregate view draws one bar per month, so a
      // sub-category list there would describe something not on screen — it
      // reports the broader Instrument Categories (Equity, Fixed Income,
      // Commodity) instead, and investment only.
      var invHtml, outHtml;
      if (__monthlyInvestCatSplit) {
        invHtml = chips(byMonthCat, false);
        // Net mode already nets withdrawals into each bar, so listing them again
        // here would read as an additional outflow.
        outHtml = net ? "" : chips(byMonthCatOut, true);
      } else {
        invHtml = chips(byMonthGrp, false);
        outHtml = "";
      }
      if (!invHtml && !outHtml) { clearHoverSplit(); return; }
      // The axis is abbreviated for space ("Feb", "Feb 26"); spell the month out
      // here, where there is room and no ambiguity about which year is meant.
      var MON_FULL = ["January","February","March","April","May","June",
                      "July","August","September","October","November","December"];
      var kp = String(k).split("-");
      var monthText = (MON_FULL[parseInt(kp[1], 10) - 1] || labels[idx] || k) +
                      (kp[0] ? " " + kp[0] : "");
      // Three rows: month, investment, withdrawal. All three are always emitted
      // (blank when the month has none) so the block's height never changes as
      // the pointer moves between months.
      // Month row also carries that month's totals, so the figures the chips
      // break down are stated next to the month rather than having to be added
      // up by eye. Both honour the legend selection, exactly like the chips.
      var mInv = investedTotal(k), mOut = outTotal(k);

      // Realized P&L for the month's sales. Summed per portfolio+instrument from
      // the same FIFO pools the Sold view uses, and restricted to instruments the
      // legend is currently showing so it agrees with the Invested and Withdrawal
      // figures beside it. Null when the month has no priced sales, so a month
      // without one simply omits the figure.
      var mPnl = (function () {
        var data = __micRealizedData && __micRealizedData[k];
        if (!data) return null;
        var seen = {}, total = 0, any = false;
        (txnsByMonth[k] || []).forEach(function (t) {
          if (!t.out || !catIncluded(t.cat)) return;
          var pf = t.portfolio || "";
          var n = normalizeText(t.instrument || "");
          var key = pf + "|" + n;
          if (seen[key]) return;                    // one entry per instrument per portfolio
          var r = data[pf] && data[pf][n];
          if (!r || !(r.units > 0)) return;
          seen[key] = 1;
          total += r.proceeds - r.cost;
          any = true;
        });
        return any ? total : null;
      })();
      // Net mode folds withdrawals into the bars, so reporting a withdrawal
      // figure alongside them would double-count it in the reader's head. The
      // month therefore states one number — the net the bar actually shows —
      // and the withdrawal breakdown row is dropped below.
      var netMode = !!net;
      splitEl.innerHTML =
        '<div class="mic-hs-row">' +
          '<span class="mic-hs-month">' + escapeHtml(monthText) + '</span>' +
          '<span class="mic-hs-tot"><span class="mic-hs-tot-label">' +
            (netMode ? 'Net Invested' : 'Invested') + '</span>' +
            '<b>' + formatCurrency(netMode ? (mInv - mOut) : mInv) + '</b></span>' +
          (!netMode && mOut > 0
            ? '<span class="mic-hs-tot"><span class="mic-hs-tot-label">Withdrawal</span>' +
              '<b class="negative">&minus;' + formatCurrency(mOut) + '</b></span>'
            : '') +
          (mPnl !== null
            ? '<span class="mic-hs-tot"><span class="mic-hs-tot-label">P&amp;L</span>' +
              '<b class="' + (mPnl >= 0 ? 'mic-hs-pos' : 'negative') + '">' +
              (mPnl >= 0 ? '+' : '&minus;') + formatCurrency(Math.abs(mPnl)) + '</b></span>'
            : '') +
        '</div>' +
        '<div class="mic-hs-row">' +
          (invHtml ? '<span class="mic-hs-cap">Investment</span><span class="mic-hs-group">' + invHtml + '</span>' : '') +
        '</div>' +
        '<div class="mic-hs-row mic-hs-out">' +
          (outHtml ? '<span class="mic-hs-cap mic-hs-cap-out">Withdrawal</span><span class="mic-hs-group">' + outHtml + '</span>' : '') +
        '</div>';
    }
    // Period breakdown by Instrument Category, shown whenever nothing is hovered.
    // Uses the same three-row shape as the hovered-month view so the block's
    // height is identical in both states and the chart never moves.
    function showPeriodSplit() {
      if (!splitEl) return;
      var GRP_COLORS_P = { "equity": "#10B981", "fixed income": "#3B82F6", "commodity": "#F59E0B" };
      function grpChips(totals, negative) {
        return Object.keys(totals)
          .filter(function (c) { return totals[c] > 0; })
          .sort(function (a, b) { return totals[b] - totals[a]; })
          .map(function (c) {
            // Unknown categories get a stable colour from the palette rather than
            // all sharing one, so two of them remain distinguishable.
            var col = GRP_COLORS_P[normalizeText(c)];
            if (!col) {
              var h = 0;
              for (var hj = 0; hj < c.length; hj++) h = (h * 31 + c.charCodeAt(hj)) >>> 0;
              col = MIC_SPLIT_PALETTE[h % MIC_SPLIT_PALETTE.length];
            }
            return '<span class="mic-hs-item">' +
              '<span class="mic-hs-dot" style="background:' + col + '"></span>' +
              escapeHtml(c) + ' <b class="' + (negative ? 'negative' : '') + '">' +
              (negative ? '&minus;' : '') + formatCurrency(totals[c]) + '</b></span>';
          }).join("");
      }
      var inv = periodGrpTotals(byMonthGrp);
      var out = periodGrpTotals(byMonthGrpOut);
      var invHtml = grpChips(inv, false);
      var outHtml = grpChips(out, true);
      if (!invHtml && !outHtml) { splitEl.innerHTML = ""; return; }
      splitEl.innerHTML =
        '<div class="mic-hs-row"><span class="mic-hs-month">' + escapeHtml(periodScopeLabel()) + '</span></div>' +
        '<div class="mic-hs-row">' +
          (invHtml ? '<span class="mic-hs-cap">Investment</span><span class="mic-hs-group">' + invHtml + '</span>' : '') +
        '</div>' +
        '<div class="mic-hs-row mic-hs-out">' +
          (outHtml ? '<span class="mic-hs-cap mic-hs-cap-out">Withdrawal</span><span class="mic-hs-group">' + outHtml + '</span>' : '') +
        '</div>';
    }

    clearHoverSplit();

    // Custom legend
    var legendEl = document.getElementById("monthly-invest-cat-legend");
    if (legendEl) {
      if (__monthlyInvestCatSplit) {
        // Per-instrument colour swatch. Clicking toggles that instrument in or
        // out of the selection, so several can be shown at once; the unselected
        // ones dim. With nothing selected every instrument shows.
        var anySelected = __monthlyInvestCatFilters.length > 0;
        legendEl.innerHTML = catList.map(function (cat, i) {
          var col = MIC_SPLIT_PALETTE[i % MIC_SPLIT_PALETTE.length];
          var on = catIncluded(cat);
          return '<div class="mic-legend-item mic-legend-clickable' + (on ? '' : ' mic-legend-dimmed') + '"' +
            ' role="button" tabindex="0"' +
            ' aria-pressed="' + (anySelected && on ? 'true' : 'false') + '"' +
            ' title="' + (on && anySelected ? 'Click to remove from the selection' : 'Click to add to the selection') + '"' +
            ' data-mic-cat="' + cat.replace(/"/g, '&quot;') + '">' +
            '<div class="mic-legend-bar" style="background:' + col + '"></div>' +
            cat + '</div>';
        }).join("") +
        // Escape hatch: with a subset selected, clicking each one off again is
        // tedious, and there is no other affordance for "show everything".
        (anySelected
          ? '<div class="mic-legend-item mic-legend-clickable mic-legend-clear" role="button" tabindex="0"' +
            ' data-mic-clear="1" title="Show all instruments">Show all</div>'
          : "");
        // Wire clicks: toggle membership of the clicked instrument, then redraw.
        Array.prototype.forEach.call(legendEl.querySelectorAll("[data-mic-cat]"), function (item) {
          function toggle() {
            var cat = item.getAttribute("data-mic-cat");
            var at = __monthlyInvestCatFilters.indexOf(cat);
            if (at === -1) __monthlyInvestCatFilters.push(cat);
            else __monthlyInvestCatFilters.splice(at, 1);
            drawMonthlyInvestCatChart(__monthlyInvestCatAllTime ? "all" : __monthlyInvestCatYear);
          }
          item.addEventListener("click", toggle);
          item.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
          });
        });
        Array.prototype.forEach.call(legendEl.querySelectorAll("[data-mic-clear]"), function (item) {
          function clearAll() {
            __monthlyInvestCatFilters = [];
            drawMonthlyInvestCatChart(__monthlyInvestCatAllTime ? "all" : __monthlyInvestCatYear);
          }
          item.addEventListener("click", clearAll);
          item.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); clearAll(); }
          });
        });
      } else {
        legendEl.innerHTML =
          '<div class="mic-legend-item"><div class="mic-legend-bar" style="background:' + MIC_GREEN + '"></div>' +
          (net ? "Net invested" : "Invested (left axis)") + '</div>' +
          (!net && outCatList.length ? '<div class="mic-legend-item"><div class="mic-legend-line"></div>Withdrawn (right axis)</div>' : '');
      }
    }

    // onHover stops firing once the pointer leaves the canvas, so without this
    // the split panel would stay stuck on the last month hovered.
    canvas.addEventListener("mouseleave", clearHoverSplit);

    // ── Drill-down: click a month to list the transactions behind it ────────
    var txnsByMonth = (__monthlyInvestCatData && __monthlyInvestCatData.byMonthTxns) || {};
    // Start resolving realized P&L now rather than on first use: the hover
    // readout wants it, and it needs USD/INR history, so waiting until the
    // pointer arrives would leave the figure missing on the first hover.
    if (!__micRealizedData) {
      buildRealizedByMonthInstrument(localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all")
        .then(function (d) { __micRealizedData = d; });
    }

    function openTxnModal(idx) {
      var overlay = document.getElementById("mic-txn-overlay");
      var bodyEl = document.getElementById("mic-txn-body");
      var totalsEl = document.getElementById("mic-txn-totals");
      var subEl = document.getElementById("mic-txn-sub");
      var titleEl = document.getElementById("mic-txn-title");
      if (!overlay || !bodyEl) return;
      var k = monthKeys[idx];
      if (!k) return;

      var MON_FULL = ["January","February","March","April","May","June",
                      "July","August","September","October","November","December"];
      var kp = String(k).split("-");
      var monthText = (MON_FULL[parseInt(kp[1], 10) - 1] || k) + (kp[0] ? " " + kp[0] : "");

      // Honour the legend selection, so the list matches the bars on screen
      // rather than showing instruments the user has filtered out.
      var base = (txnsByMonth[k] || []).filter(function (t) { return catIncluded(t.cat); });

      // The direction buttons only earn their place on a month that has both.
      // On a one-sided month one of them is empty and the other returns exactly
      // what All already shows, so neither changes anything — both switch off
      // and All is left as the only option.
      var hasIn = base.some(function (t) { return !t.out; });
      var hasOut = base.some(function (t) { return t.out; });
      var mixed = hasIn && hasOut;
      // A filter that is no longer offered must not stay selected, or the table
      // would sit empty (or unchanged) beneath a disabled button.
      if (!mixed) __micTxnFilter = "all";
      var filterElNow = document.getElementById("mic-txn-filter");
      if (filterElNow) {
        filterElNow.querySelectorAll("[data-txn-filter]").forEach(function (b) {
          var f = b.getAttribute("data-txn-filter");
          var off = f !== "all" && !mixed;
          b.disabled = off;
          b.classList.toggle("is-disabled", off);
          // Say which of the two reasons applies, so a greyed button is never
          // ambiguous between "none of these" and "these are all of them".
          b.title = !off ? ""
            : (f === "out"
                ? (hasOut ? "Everything this month was sold" : "Nothing sold this month")
                : (hasIn ? "Everything this month was bought" : "Nothing bought this month"));
          b.classList.toggle("active", f === __micTxnFilter);
        });
      }

      // Bought / Sold filter. Applied before anything is counted, so the header
      // count, the group subtotals and the footer all describe what is actually
      // listed rather than the unfiltered month.
      var list = base;
      if (__micTxnFilter === "in") list = base.filter(function (t) { return !t.out; });
      else if (__micTxnFilter === "out") list = base.filter(function (t) { return t.out; });
      __micTxnRerender = function () { openTxnModal(idx); };

      // Realized detail for the extra Sold columns. Resolved asynchronously (it
      // needs USD/INR history), so render now and repaint if it lands later —
      // the modal must not sit blank waiting for it.
      var soldView = __micTxnFilter === "out";
      var realizedMonth = (__micRealizedData && __micRealizedData[k]) || null;
      // Wait on the DATA, not on this month's slice of it. A month can legitimately
      // have sold rows and no realized entry — an FD maturing, a PF withdrawal, a
      // commodity sale: none carry a unit price, so the FIFO pass never produces a
      // row for them. Keying the refetch on the empty slice meant openTxnModal
      // resolved the (cached, instant) promise and called itself again, forever,
      // and the page locked up the moment such a month was opened.
      if (soldView && !__micRealizedData) {
        buildRealizedByMonthInstrument(localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all")
          .then(function (data) {
            __micRealizedData = data;
            var ov = document.getElementById("mic-txn-overlay");
            // Only repaint if the same view is still on screen.
            if (ov && !ov.hidden && __micTxnFilter === "out") openTxnModal(idx);
          });
      }
      // Newest first, then largest — the order someone scanning for a specific
      // transaction expects.
      list = list.slice().sort(function (a, b) {
        return (b.date - a.date) || (b.amount - a.amount);
      });

      if (titleEl) titleEl.textContent = "Transactions · " + monthText;
      var inTot = 0, outTot = 0;
      list.forEach(function (t) { if (t.out) outTot += t.amount; else inTot += t.amount; });
      if (subEl) {
        var what = __micTxnFilter === "out" ? " sold" : (__micTxnFilter === "in" ? " bought" : "");
        subEl.textContent = list.length
          ? list.length + (list.length === 1 ? " transaction" : " transactions") + what
          : ("No" + (what || "") + " transactions for this month.");
      }

      if (!list.length) {
        bodyEl.innerHTML = '<p class="muted small" style="padding:14px 20px;margin:0;">Nothing to show.</p>';
        if (totalsEl) totalsEl.innerHTML = "";
      } else {
        // Roll repeat transactions of the same instrument into one line, keyed by
        // instrument AND direction. Buys and sells are therefore summed
        // separately and never netted against each other: an instrument bought
        // and sold in the same month shows both a positive and a negative line,
        // which is what makes the month's gross activity readable.
        var MON_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        function aggregateTxns(rows) {
          var m = {};
          rows.forEach(function (t) {
            var key = (t.instrument || t.cat || "—") + "|" + (t.out ? "out" : "in");
            if (!m[key]) {
              m[key] = {
                instrument: t.instrument, cat: t.cat, grp: t.grp, out: t.out,
                // Carried through because the realized lookup is keyed by
                // portfolio; without it every Sold row lost its Buy/Sell price
                // and P&L. Aggregation happens within a portfolio group, so all
                // rows folded into a line share this value.
                portfolio: t.portfolio,
                amount: 0, count: 0, types: {}, min: t.date, max: t.date,
                // Row-carried profit (FD interest). Kept separate from the FIFO
                // realized figures, which are keyed by instrument rather than by
                // row, so folding several maturities into one line still adds up.
                pnl: 0, pnlKnown: false
              };
            }
            var g = m[key];
            g.amount += t.amount;
            if (t.pnl != null) { g.pnl += t.pnl; g.pnlKnown = true; }
            g.count += 1;
            if (t.type) g.types[t.type] = true;
            if (t.date < g.min) g.min = t.date;
            if (t.date > g.max) g.max = t.date;
          });
          // Investments first, then withdrawals, each largest first.
          return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) {
            if (a.out !== b.out) return a.out ? 1 : -1;
            return b.amount - a.amount;
          });
        }

        function txnRow(t) {
          var col = MIC_SPLIT_PALETTE[Math.max(0, catList.indexOf(t.cat)) % MIC_SPLIT_PALETTE.length];
          var name = t.instrument || t.cat || "—";
          // One transaction keeps its date; several show how many were combined
          // and the span they cover, so the summed figure is never mistaken for
          // a single purchase.
          var dateCell;
          if (t.count > 1) {
            var span = t.min.getDate() === t.max.getDate()
              ? t.min.getDate() + " " + MON_SHORT[t.min.getMonth()]
              : t.min.getDate() + "–" + t.max.getDate() + " " + MON_SHORT[t.max.getMonth()];
            dateCell = '<span>' + t.count + ' txns</span>' +
                       '<br><span class="mic-txn-sub-cat">' + escapeHtml(span) + '</span>';
          } else {
            dateCell = escapeHtml(formatDateISO(t.min) || "");
          }
          var typeKeys = Object.keys(t.types);
          var typeLabel = typeKeys.length === 1 ? typeKeys[0]
            : (typeKeys.length > 1 ? typeKeys.join(" / ") : (t.out ? "Withdrawal" : "Investment"));
          // Sold view adds Buy Price / Sell Price / P&L, taken from the FIFO
          // realized figures. An instrument with no unit price (FD, PF,
          // commodity) shows blanks rather than a fabricated 0.
          var extra = "";
          if (soldView) {
            var pfKey = t.portfolio || "";
            var r = realizedMonth && realizedMonth[pfKey] &&
                    realizedMonth[pfKey][normalizeText(t.instrument || "")];
            if (r && r.units > 0) {
              var buyPx = r.cost / r.units, sellPx = r.proceeds / r.units, pnl = r.proceeds - r.cost;
              extra =
                '<td class="num">' + formatCurrency(buyPx) + '</td>' +
                '<td class="num">' + formatCurrency(sellPx) + '</td>';
              var pnlCell = '<td class="num ' + (pnl >= 0 ? 'pos' : 'out') + '">' +
                (pnl >= 0 ? '+' : '&minus;') + formatCurrency(Math.abs(pnl)) + '</td>';
              return '<tr>' +
                '<td>' + dateCell + '</td>' +
                '<td><span class="mic-txn-inst"><span class="mic-txn-dot" style="background:' + col + '"></span>' +
                  '<span>' + escapeHtml(name) +
                  (t.cat ? '<br><span class="mic-txn-sub-cat">' + escapeHtml(t.cat) + '</span>' : '') +
                  '</span></span></td>' +
                '<td>' + escapeHtml(t.grp || "") + '</td>' +
                '<td>' + escapeHtml(typeLabel) + '</td>' +
                extra +
                '<td class="num out">&minus;' + formatCurrency(t.amount) + '</td>' +
                pnlCell +
              '</tr>';
            }
            // No FIFO row. Buy/Sell price stay blank — there are no units to price
            // — but the profit itself can still be known: an FD's interest is
            // carried on the transaction.
            extra = '<td class="num mic-txn-na">—</td><td class="num mic-txn-na">—</td>';
            var rowPnlCell = t.pnlKnown
              ? '<td class="num ' + (t.pnl >= 0 ? 'pos' : 'out') + '">' +
                (t.pnl >= 0 ? '+' : '&minus;') + formatCurrency(Math.abs(t.pnl)) + '</td>'
              : '<td class="num mic-txn-na">—</td>';
            return '<tr>' +
              '<td>' + dateCell + '</td>' +
              '<td><span class="mic-txn-inst"><span class="mic-txn-dot" style="background:' + col + '"></span>' +
                '<span>' + escapeHtml(name) +
                (t.cat ? '<br><span class="mic-txn-sub-cat">' + escapeHtml(t.cat) + '</span>' : '') +
                '</span></span></td>' +
              '<td>' + escapeHtml(t.grp || "") + '</td>' +
              '<td>' + escapeHtml(typeLabel) + '</td>' +
              extra +
              '<td class="num out">&minus;' + formatCurrency(t.amount) + '</td>' +
              rowPnlCell +
            '</tr>';
          }
          return '<tr>' +
            '<td>' + dateCell + '</td>' +
            '<td><span class="mic-txn-inst"><span class="mic-txn-dot" style="background:' + col + '"></span>' +
              '<span>' + escapeHtml(name) +
              (t.cat ? '<br><span class="mic-txn-sub-cat">' + escapeHtml(t.cat) + '</span>' : '') +
              '</span></span></td>' +
            '<td>' + escapeHtml(t.grp || "") + '</td>' +
            '<td>' + escapeHtml(typeLabel) + '</td>' +
            '<td class="num' + (t.out ? ' out' : '') + '">' + (t.out ? '&minus;' : '') + formatCurrency(t.amount) + '</td>' +
          '</tr>';
        }

        // Group by portfolio. Rows with no portfolio name are collected under
        // "Unassigned" rather than dropped, so the group subtotals still add up
        // to the month's total.
        var groups = {};
        list.forEach(function (t) {
          var pf = t.portfolio || "Unassigned";
          (groups[pf] = groups[pf] || []).push(t);
        });
        function groupNet(rows) {
          return rows.reduce(function (n, t) { return n + (t.out ? -t.amount : t.amount); }, 0);
        }
        // Largest net first, so the portfolio that drove the bar is at the top.
        var groupNames = Object.keys(groups).sort(function (a, b) {
          return groupNet(groups[b]) - groupNet(groups[a]);
        });

        var pnlTot = 0, pnlKnown = false;
        var bodyHtml = groupNames.map(function (pf) {
          var rows = groups[pf];
          var gIn = 0, gOut = 0, gPnl = 0, gPnlKnown = false;
          rows.forEach(function (t) { if (t.out) gOut += t.amount; else gIn += t.amount; });
          // Row-carried profit first (FD interest), then the FIFO figures. The two
          // never cover the same row: an instrument has units or it does not.
          if (soldView) {
            rows.forEach(function (t) {
              if (t.pnl == null) return;
              gPnl += t.pnl;
              gPnlKnown = true;
            });
          }
          if (soldView && realizedMonth && realizedMonth[pf]) {
            // Sum each sold instrument once, from the per-portfolio pool.
            var seen = {};
            rows.forEach(function (t) {
              var n = normalizeText(t.instrument || "");
              if (!n || seen[n]) return;
              var r = realizedMonth[pf][n];
              if (!r || !(r.units > 0)) return;
              seen[n] = 1;
              gPnl += r.proceeds - r.cost;
              gPnlKnown = true;
            });
          }
          // Outside both branches: the footer must total whichever of the two
          // sources this group actually had.
          if (soldView) {
            pnlTot += gPnl;
            if (gPnlKnown) pnlKnown = true;
          }
          // Same rule as the footer: with a direction filter on, don't print the
          // other side's "₹0".
          var totals =
            (__micTxnFilter !== "out" ? formatCurrency(gIn) : '') +
            (__micTxnFilter !== "in" && gOut > 0
              ? (__micTxnFilter === "all" ? ' ' : '') + '<span class="out">&minus;' + formatCurrency(gOut) + '</span>'
              : '');
          return '<tbody class="mic-txn-group">' +
            '<tr class="mic-txn-group-row">' +
              '<td colspan="' + (soldView ? 6 : 4) + '"><span class="mic-txn-group-name">' + escapeHtml(pf) + '</span>' +
                '<span class="mic-txn-group-count">' + rows.length +
                (rows.length === 1 ? ' transaction' : ' transactions') + '</span></td>' +
              '<td class="num">' + totals + '</td>' +
              (soldView
                ? '<td class="num ' + (gPnlKnown ? (gPnl >= 0 ? 'pos' : 'out') : 'mic-txn-na') + '">' +
                  (gPnlKnown ? (gPnl >= 0 ? '+' : '&minus;') + formatCurrency(Math.abs(gPnl)) : '—') + '</td>'
                : '') +
            '</tr>' +
            aggregateTxns(rows).map(txnRow).join("") +
          '</tbody>';
        }).join("");

        bodyEl.innerHTML =
          '<table class="mic-txn-table"><thead><tr>' +
            '<th>Date</th><th>Instrument</th><th>Category</th><th>Type</th>' +
            (soldView ? '<th style="text-align:right;">Buy Price</th><th style="text-align:right;">Sell Price</th>' : '') +
            '<th style="text-align:right;">Amount</th>' +
            (soldView ? '<th style="text-align:right;">P&amp;L</th>' : '') +
          '</tr></thead>' + bodyHtml + '</table>' +
          // With a direction filter on, only that side is meaningful: showing
          // "Invested ₹0" and a Net equal to the single figure just adds noise.
          '';

        // Totals render above the list, outside the scrolling body, so they are
        // read before the rows rather than found by scrolling to the end.
        if (totalsEl) {
          totalsEl.innerHTML =
            (__micTxnFilter !== "out" ? '<span>Invested <b>' + formatCurrency(inTot) + '</b></span>' : '') +
            (__micTxnFilter !== "in" && outTot > 0
              ? '<span>Withdrawn <b class="out">&minus;' + formatCurrency(outTot) + '</b></span>' : '') +
            (__micTxnFilter === "all"
              ? '<span>Net <b>' + formatCurrency(inTot - outTot) + '</b></span>' : '') +
            // P&L only when the Sold view has priced sales behind it.
            (soldView && pnlKnown
              ? '<span>P&amp;L <b class="' + (pnlTot >= 0 ? 'pos' : 'out') + '">' +
                (pnlTot >= 0 ? '+' : '&minus;') + formatCurrency(Math.abs(pnlTot)) + '</b></span>'
              : '');
        }
      }
      overlay.hidden = false;
    }

    function closeTxnModal() {
      var overlay = document.getElementById("mic-txn-overlay");
      if (overlay) overlay.hidden = true;
      // Reopening always starts from All. A filter carried over from a previous
      // visit would silently hide most of the next month — an empty or oddly
      // short list with no visible cause, since the control is only noticed once
      // the modal is already open.
      __micTxnFilter = "all";
      var filterEl = document.getElementById("mic-txn-filter");
      if (filterEl) {
        filterEl.querySelectorAll("[data-txn-filter]").forEach(function (b) {
          b.classList.toggle("active", b.getAttribute("data-txn-filter") === "all");
        });
      }
    }
    // Bound once per element, not per redraw, or each re-render would stack
    // another copy of these listeners.
    (function bindTxnModalOnce() {
      var overlay = document.getElementById("mic-txn-overlay");
      if (!overlay || overlay.dataset.bound) return;
      overlay.dataset.bound = "1";
      var closeBtn = document.getElementById("mic-txn-close");
      if (closeBtn) closeBtn.addEventListener("click", closeTxnModal);
      var filterEl = document.getElementById("mic-txn-filter");
      if (filterEl) {
        filterEl.addEventListener("click", function (e) {
          var btn = e.target.closest("[data-txn-filter]");
          if (!btn || btn.disabled) return;
          __micTxnFilter = btn.getAttribute("data-txn-filter");
          filterEl.querySelectorAll("[data-txn-filter]").forEach(function (b) {
            b.classList.toggle("active", b === btn);
          });
          if (__micTxnRerender) __micTxnRerender();
        });
      }
      overlay.addEventListener("click", function (e) { if (e.target === overlay) closeTxnModal(); });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !overlay.hidden) closeTxnModal();
      });
    })();

    canvas.addEventListener("click", function (evt) {
      if (!__monthlyInvestCatChart) return;
      var pts = __monthlyInvestCatChart.getElementsAtEventForMode(
        evt, "index", { intersect: false }, false);
      if (!pts || !pts.length) return;
      openTxnModal(pts[0].index);
    });

    __monthlyInvestCatChart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        // Anywhere in a month's column identifies that month, so the thin
        // withdrawal line never has to be hit precisely. This used to come from
        // the tooltip's own mode; with the tooltip gone it lives here, where
        // onHover reads it.
        interaction: { mode: "index", intersect: false },
        // Drives the month rows under the stats row — the only readout now.
        onHover: function (evt, els, chart) {
          var idx = els && els.length ? els[0].index : -1;
          if (idx < 0) {
            var pts = chart.getElementsAtEventForMode(evt, "index", { intersect: false }, false);
            idx = pts && pts.length ? pts[0].index : -1;
          }
          if (idx < 0 || idx >= monthKeys.length) clearHoverSplit();
          else renderHoverSplit(idx);
        },
        plugins: {
          legend: { display: false },
          // No tooltip: the month's totals and its per-instrument split are both
          // reported in the rows under the stats row, so a floating panel would
          // only repeat them over the bars it is describing.
          tooltip: { enabled: false }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 } } },
          y: {
            stacked: true, beginAtZero: !net, position: "left",
            title: { display: true, text: (net ? "Net Invested (₹)" : "Invested (₹)"), font: { size: 11, weight: "600" } },
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
            title: { display: !net && outCatList.length > 0, text: "Withdrawn (₹)", font: { size: 11, weight: "600" } },
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

  // "Idle Cash" view: stacked month-on-month parked-cash balances per instrument
  // (Savings Account + Investment Corpus). Balances, not flows — so there are no
  // withdrawal lines and no Net; the stats show the latest total and the average.
  function drawMonthlyIdleCashChart(yr) {
    var MON_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    var IDLE_PALETTE = ["#4DC0B5","#3B82F6","#8B5CF6","#F5A623","#E8623A","#10B981","#EC4899","#84CC16","#F97316","#6366F1"];
    var wrap = document.getElementById("monthly-invest-cat-wrap");
    var statusEl = document.getElementById("monthly-invest-cat-status");
    if (!wrap || typeof Chart === "undefined") return;
    try {
      var data = __monthlyIdleCashData || buildMonthlyIdleCashData();
      var byMonthInstr = data.byMonthInstr || {};

      var monthKeys = [], labels = [];
      if (yr === "all") {
        var sortedKeys = Object.keys(byMonthInstr).sort();
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

      var instrSet = {};
      monthKeys.forEach(function (k) {
        if (byMonthInstr[k]) Object.keys(byMonthInstr[k]).forEach(function (n) { instrSet[n] = true; });
      });
      var instruments = Object.keys(instrSet).sort();

      function cell(k, instr) { return (byMonthInstr[k] && byMonthInstr[k][instr]) ? byMonthInstr[k][instr] : 0; }
      // Legend selection, exactly as the "By instrument" view defines it: an empty
      // list means show everything, and everything derived from it — the bars, the
      // stats row, the hovered-month split — reflects the same choice, so the parts
      // always add up to the totals stated above them.
      function idleIncluded(instr) {
        return !__monthlyIdleCashFilters.length || __monthlyIdleCashFilters.indexOf(instr) !== -1;
      }
      function monthTotal(k) {
        var m = byMonthInstr[k];
        return m ? Object.keys(m).reduce(function (s, c) { return idleIncluded(c) ? s + m[c] : s; }, 0) : 0;
      }

      if (!instruments.length) {
        if (statusEl) statusEl.textContent = "No idle-cash balances for " + (yr === "all" ? "all time" : yr) + ".";
        if (__monthlyInvestCatChart) { __monthlyInvestCatChart.destroy(); __monthlyInvestCatChart = null; }
        wrap.innerHTML = "";
        var legendElA = document.getElementById("monthly-invest-cat-legend");
        if (legendElA) legendElA.innerHTML = "";
        var statsElA = document.getElementById("monthly-invest-cat-stats");
        if (statsElA) statsElA.innerHTML = "";
        // Leaving the flow views' split panel up would describe a chart that is
        // no longer on screen.
        var splitElA = document.getElementById("mic-hover-split");
        if (splitElA) splitElA.innerHTML = "";
        return;
      }
      if (statusEl) statusEl.textContent = "";

      // Drop selections that aren't in view (e.g. after a year change), so a stale
      // pick can't leave the chart looking empty with no way to see why.
      __monthlyIdleCashFilters = __monthlyIdleCashFilters.filter(function (c) {
        return instruments.indexOf(c) !== -1;
      });
      var datasets = [];
      instruments.forEach(function (instr, i) {
        if (!idleIncluded(instr)) return;
        // Colour comes from the position in the FULL instrument list, not in the
        // filtered one, so an instrument keeps its colour as others are switched
        // off instead of taking over the colour of one that is no longer shown.
        var col = IDLE_PALETTE[i % IDLE_PALETTE.length];
        datasets.push({
          label: instr,
          data: monthKeys.map(function (k) { return cell(k, instr); }),
          backgroundColor: col + "CC",
          borderColor: col,
          borderWidth: 0,
          borderRadius: 3, categoryPercentage: 0.72, barPercentage: 0.9
        });
      });

      // Stats: latest month's total idle cash (the balance held now) + average
      // across months that had any balance.
      var lastWithData = null;
      for (var li = monthKeys.length - 1; li >= 0; li--) { if (monthTotal(monthKeys[li]) > 0) { lastWithData = monthKeys[li]; break; } }
      var activeMonths = monthKeys.filter(function (k) { return monthTotal(k) > 0; });
      var avg = activeMonths.length ? activeMonths.reduce(function (s, k) { return s + monthTotal(k); }, 0) / activeMonths.length : 0;
      var latestTotal = lastWithData ? monthTotal(lastWithData) : 0;
      var statsEl = document.getElementById("monthly-invest-cat-stats");
      if (statsEl) {
        statsEl.innerHTML =
          '<div class="mic-stat"><span class="mic-stat-label">Idle Cash (latest)</span><span class="mic-stat-value">' + formatCurrency(latestTotal) + '</span></div>' +
          '<div class="mic-stat"><span class="mic-stat-label">Avg / month</span><span class="mic-stat-value">' + formatCurrency(avg) + '</span></div>';
      }

      // Selectable legend, same contract as "By instrument": click (or Enter/Space)
      // toggles an instrument in or out of the selection, several can be on at
      // once, the unselected ones dim, and "Show all" clears the selection —
      // otherwise a user who picked a subset has to click each one off again.
      var legendEl = document.getElementById("monthly-invest-cat-legend");
      if (legendEl) {
        var anyIdleSelected = __monthlyIdleCashFilters.length > 0;
        legendEl.innerHTML = instruments.map(function (instr, i) {
          var col = IDLE_PALETTE[i % IDLE_PALETTE.length];
          var on = idleIncluded(instr);
          return '<div class="mic-legend-item mic-legend-clickable' + (on ? '' : ' mic-legend-dimmed') + '"' +
            ' role="button" tabindex="0"' +
            ' aria-pressed="' + (anyIdleSelected && on ? 'true' : 'false') + '"' +
            ' title="' + (on && anyIdleSelected ? 'Click to remove from the selection' : 'Click to add to the selection') + '"' +
            ' data-mic-idle="' + escapeHtml(instr).replace(/"/g, '&quot;') + '">' +
            '<div class="mic-legend-bar" style="background:' + col + '"></div>' +
            escapeHtml(instr) + '</div>';
        }).join("") +
        (anyIdleSelected
          ? '<div class="mic-legend-item mic-legend-clickable mic-legend-clear" role="button" tabindex="0"' +
            ' data-mic-idle-clear="1" title="Show all instruments">Show all</div>'
          : "");
        Array.prototype.forEach.call(legendEl.querySelectorAll("[data-mic-idle]"), function (item) {
          function toggle() {
            // Read the label off the rendered text, not the attribute: the
            // attribute is HTML-escaped for the markup and would not match the
            // raw instrument name the filter list holds.
            var instr = instruments[Array.prototype.indexOf.call(
              legendEl.querySelectorAll("[data-mic-idle]"), item)];
            if (instr == null) return;
            var at = __monthlyIdleCashFilters.indexOf(instr);
            if (at === -1) __monthlyIdleCashFilters.push(instr);
            else __monthlyIdleCashFilters.splice(at, 1);
            drawMonthlyInvestCatChart(__monthlyInvestCatAllTime ? "all" : __monthlyInvestCatYear);
          }
          item.addEventListener("click", toggle);
          item.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
          });
        });
        Array.prototype.forEach.call(legendEl.querySelectorAll("[data-mic-idle-clear]"), function (item) {
          function clearAll() {
            __monthlyIdleCashFilters = [];
            drawMonthlyInvestCatChart(__monthlyInvestCatAllTime ? "all" : __monthlyInvestCatYear);
          }
          item.addEventListener("click", clearAll);
          item.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); clearAll(); }
          });
        });
      }

      // ── Hovered-month split, in the same panel the flow views use ───────────
      // Idle Cash is a BALANCE, not a flow, so there is no Investment/Withdrawal
      // pair and no period sum — adding up twelve month-end balances would state
      // a number that was never held. The resting state is therefore the latest
      // month with a balance, which is what the stats row above already reports.
      var idleSplitEl = document.getElementById("mic-hover-split");
      var __idleHoverIdx = -1;
      var IDLE_MON_FULL = ["January","February","March","April","May","June",
                           "July","August","September","October","November","December"];
      function idleChips(k) {
        var m = byMonthInstr[k] || {};
        return Object.keys(m)
          .filter(function (c) { return m[c] > 0 && idleIncluded(c); })
          .sort(function (a, b) { return m[b] - m[a]; })
          .map(function (c) {
            // Position in the full instrument list, so a chip carries the same
            // colour as its bar and its legend entry.
            var col = IDLE_PALETTE[Math.max(0, instruments.indexOf(c)) % IDLE_PALETTE.length];
            return '<span class="mic-hs-item">' +
              '<span class="mic-hs-dot" style="background:' + col + '"></span>' +
              escapeHtml(c) + ' <b>' + formatCurrency(m[c]) + '</b></span>';
          }).join("");
      }
      function idleMonthText(k) {
        var kp = String(k).split("-");
        return (IDLE_MON_FULL[parseInt(kp[1], 10) - 1] || k) + (kp[0] ? " " + kp[0] : "");
      }
      function paintIdleSplit(k, restingLabel) {
        if (!idleSplitEl) return;
        var chipsHtml = k ? idleChips(k) : "";
        // Same total markup the flow views use (mic-hs-tot / mic-hs-tot-label), so
        // the row reads identically whichever mode produced it.
        var totalHtml = k
          ? '<span class="mic-hs-tot"><span class="mic-hs-tot-label">Idle Cash</span>' +
            '<b>' + formatCurrency(monthTotal(k)) + '</b></span>' : "";
        idleSplitEl.innerHTML =
          '<div class="mic-hs-row"><span class="mic-hs-month">' +
            escapeHtml(restingLabel || (k ? idleMonthText(k) : "")) + '</span>' + totalHtml +
          '</div>' +
          '<div class="mic-hs-row">' +
            (chipsHtml ? '<span class="mic-hs-cap">Idle Cash</span><span class="mic-hs-group">' + chipsHtml + '</span>' : '') +
          '</div>';
      }
      function showIdleRestingSplit() {
        // Latest month that still has a balance under the current selection.
        var k = null;
        for (var ri = monthKeys.length - 1; ri >= 0; ri--) {
          if (monthTotal(monthKeys[ri]) > 0) { k = monthKeys[ri]; break; }
        }
        if (!k) { if (idleSplitEl) idleSplitEl.innerHTML = ""; return; }
        paintIdleSplit(k, "Latest · " + idleMonthText(k));
      }
      function clearIdleHoverSplit() { __idleHoverIdx = -1; showIdleRestingSplit(); }
      function renderIdleHoverSplit(idx) {
        // Ignore repeats: Chart.js fires onHover on every pointer move.
        if (idx === __idleHoverIdx) return;
        __idleHoverIdx = idx;
        var k = monthKeys[idx];
        if (!k || monthTotal(k) <= 0) { clearIdleHoverSplit(); return; }
        paintIdleSplit(k, null);
      }
      clearIdleHoverSplit();

      if (__monthlyInvestCatChart) { __monthlyInvestCatChart.destroy(); __monthlyInvestCatChart = null; }
      wrap.innerHTML = "";
      var canvas = document.createElement("canvas");
      wrap.appendChild(canvas);

      __monthlyInvestCatChart = new Chart(canvas.getContext("2d"), {
        type: "bar",
        data: { labels: labels, datasets: datasets },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          // Anywhere in a month's column identifies that month, so a thin band in
          // the stack never has to be hit precisely. Same as the flow views.
          interaction: { mode: "index", intersect: false },
          onHover: function (evt, els, chart) {
            var idx = els && els.length ? els[0].index : -1;
            if (idx < 0) {
              var pts = chart.getElementsAtEventForMode(evt, "index", { intersect: false }, false);
              idx = pts && pts.length ? pts[0].index : -1;
            }
            if (idx < 0 || idx >= monthKeys.length) clearIdleHoverSplit();
            else renderIdleHoverSplit(idx);
          },
          plugins: {
            legend: { display: false },
            // No tooltip: the month's total and its per-instrument split are both
            // reported in the rows under the stats row, exactly as in Net and
            // By instrument, so a floating panel would only repeat them over the
            // bars it is describing.
            tooltip: { enabled: false }
          },
          scales: {
            x: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 } } },
            y: {
              stacked: true, beginAtZero: true, position: "left",
              title: { display: true, text: "Idle Cash (₹)", font: { size: 11, weight: "600" } },
              grid: { color: "rgba(0,0,0,0.05)" },
              ticks: { font: { size: 11 }, callback: function (v) {
                var abs = Math.abs(v);
                if (abs >= 1e5) return (v/1e5).toFixed(abs % 1e5 === 0 ? 0 : 1) + "L";
                if (abs >= 1e3) return (v/1e3).toFixed(0) + "k";
                return v;
              }}
            }
          }
        }
      });
      // onHover stops firing once the pointer leaves the canvas, so without this
      // the split panel would stay stuck on the last month hovered.
      canvas.addEventListener("mouseleave", clearIdleHoverSplit);
    } catch (e) {
      if (statusEl) statusEl.textContent = "Chart error: " + e.message;
    }
  }

  var _micAwaitingFx = false;
  function renderMonthlyInvestmentByCategory() {
    // US rows need USD/INR, which is read synchronously from the price cache. On a
    // cold load the cache is still empty, so the first paint would draw dollars as
    // rupees. Fetch once and repaint; the guard keeps it to a single retry.
    if (!getCachedStockPrices() && !_micAwaitingFx) {
      _micAwaitingFx = true;
      fetchAllStockPrices().catch(function () { return null; }).then(function () {
        renderMonthlyInvestmentByCategory();
      });
    }
    var statusEl = document.getElementById("monthly-invest-cat-status");
    var yearSel = document.getElementById("monthly-invest-cat-year");
    var portNameEl = document.getElementById("mic-portfolio-name");
    if (portNameEl) {
      var ovPort = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
      portNameEl.textContent = ovPort === "all" ? "" : " · " + ovPort;
    }
    if (typeof Chart === "undefined") return;

    // Rebuild raw data
    __monthlyInvestCatData = buildMonthlyInvestCatData();
    __monthlyIdleCashData = buildMonthlyIdleCashData();
    // Year selector spans both the cash-flow data and the idle-cash balances, so
    // toggling "Idle Cash" never leaves the user on a year with no idle data.
    var yearSet = {};
    (__monthlyInvestCatData.yearList || []).forEach(function (y) { yearSet[y] = true; });
    (__monthlyIdleCashData.yearList || []).forEach(function (y) { yearSet[y] = true; });
    var yearList = Object.keys(yearSet).sort();
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
        dbg("[MIC v12] year changed to", yearSel.value);
        __monthlyInvestCatYear = yearSel.value;
        drawMonthlyInvestCatChart(__monthlyInvestCatYear);
      };
      yearSel.value = __monthlyInvestCatYear;
      _wfYpAttach(yearSel);
      _wfYpSetHidden(yearSel, __monthlyInvestCatAllTime);
    }

    var idleBtn = document.getElementById("monthly-invest-cat-idle");
    // Reflect Idle mode by dimming the flow-only toggles (Net / By instrument),
    // which don't apply to a balance view.
    function _syncMicToggleActive() {
      var nB = document.getElementById("monthly-invest-cat-net");
      var sB = document.getElementById("monthly-invest-cat-split");
      if (nB) nB.classList.toggle("active", !__monthlyInvestCatIdle && !!__monthlyInvestCatNet);
      if (sB) sB.classList.toggle("active", !__monthlyInvestCatIdle && !!__monthlyInvestCatSplit);
      if (idleBtn) idleBtn.classList.toggle("active", !!__monthlyInvestCatIdle);
    }

    var netBtn = document.getElementById("monthly-invest-cat-net");
    if (netBtn) {
      netBtn.onclick = function () {
        __monthlyInvestCatIdle = false; // Net is a flow view — leave Idle Cash
        __monthlyInvestCatNet = !__monthlyInvestCatNet;
        _syncMicToggleActive();
        drawMonthlyInvestCatChart(__monthlyInvestCatAllTime ? "all" : __monthlyInvestCatYear);
      };
    }

    var splitBtn = document.getElementById("monthly-invest-cat-split");
    if (splitBtn) {
      splitBtn.onclick = function () {
        __monthlyInvestCatIdle = false; // By instrument is a flow view — leave Idle Cash
        __monthlyInvestCatSplit = !__monthlyInvestCatSplit;
        __monthlyInvestCatFilters = []; // reset instrument selection when toggling split
        _syncMicToggleActive();
        drawMonthlyInvestCatChart(__monthlyInvestCatAllTime ? "all" : __monthlyInvestCatYear);
      };
    }

    if (idleBtn) {
      idleBtn.onclick = function () {
        __monthlyInvestCatIdle = !__monthlyInvestCatIdle;
        // Entering or leaving Idle Cash starts from every instrument shown, the
        // same way toggling By instrument does. A selection carried across the
        // switch would hide most of the chart with the reason off-screen.
        __monthlyIdleCashFilters = [];
        if (__monthlyInvestCatIdle) {
          // Balance view — flow-only modes don't apply.
          __monthlyInvestCatNet = false;
          __monthlyInvestCatSplit = false;
          __monthlyInvestCatFilters = [];
        }
        _syncMicToggleActive();
        drawMonthlyInvestCatChart(__monthlyInvestCatAllTime ? "all" : __monthlyInvestCatYear);
      };
    }
    _syncMicToggleActive();

    var allBtn = document.getElementById("monthly-invest-cat-alltime");
    if (allBtn) {
      allBtn.classList.toggle("active", !!__monthlyInvestCatAllTime);
      allBtn.onclick = function () {
        __monthlyInvestCatAllTime = !__monthlyInvestCatAllTime;
        allBtn.classList.toggle("active", !!__monthlyInvestCatAllTime);
        if (yearSel) _wfYpSetHidden(yearSel, __monthlyInvestCatAllTime);
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

  // Renders a holdings-list Day Chg cell as stacked ₹ amount + % (like the P&L
  // column). dayAmt in ₹, dayPct the day-change percent (null → no % line).
  function _mfhDayCell(dayAmt, dayPct) {
    if (dayAmt == null || Math.abs(dayAmt) < 0.01) {
      return '<div class="mfh-col-num mfh-num-day mfh-muted">—</div>';
    }
    var cls = dayAmt >= 0 ? "mfh-positive" : "mfh-negative";
    var valTxt = (dayAmt >= 0 ? "+" : "") + formatCurrency(dayAmt);
    var pctTxt = (dayPct == null || !isFinite(dayPct)) ? ""
      : '<span class="mfh-num-day-pct">' + (dayPct >= 0 ? "+" : "") + dayPct.toFixed(2) + '%</span>';
    return '<div class="mfh-col-num mfh-num-day ' + cls + '"><span class="mfh-num-day-value">' + valTxt + '</span>' + pctTxt + '</div>';
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
    var dateStr = latestDate.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
    // Live-source indicator: green "Live" when the AMFI NAV map came from Supabase
    // (deploy-free live feed), otherwise a muted "File" for the static JSON.
    var src = getMarketSource("amfi_nav");
    var badge = src && src.source === "supabase"
      ? ' <span style="color:#10B981;font-weight:700;" title="Live from Supabase">&#9679; Live</span>'
      : (src && src.source === "static"
        ? ' <span style="color:var(--muted);font-weight:600;" title="From the static JSON on Pages">&#9679; File</span>'
        : '');
    asOfTextEl.innerHTML = "NAV Data: " + dateStr + badge;
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

    // Built for EVERY portfolio and BOTH sides, then filtered in the renderer — the
    // shape Fixed Income Holding already had. Baking the pills into the build meant
    // every click on a portfolio or on Open/Closed re-ran the whole pipeline,
    // including the NAV fetches, so filtering stalled on the network instead of
    // being instant. It also left the row set holding only one side, which is what
    // forced the __mfAnyClosed flag and the debt bypass.
    var selectedPortfolio = "all";
    var transactionsByInstrument = groupUnitTransactionsByInstrument(rows, selectedPortfolio);
    if (!transactionsByInstrument) {
      statusEl.textContent = "Header row number is incorrect. Make adjustments by adding correct header row number.";
      tableWrap.hidden = true;
      return;
    }

    var holdings = [];
    Object.keys(transactionsByInstrument).forEach(function (instrument) {
      var remainingLots = fifoRemainingLots(transactionsByInstrument[instrument]);
      var remainingUnits = 0, investedCost = 0;
      remainingLots.forEach(function (lot) { remainingUnits += lot.units; investedCost += lot.units * lot.price; });
      var avgNav;
      if (remainingUnits > UNITS_EPSILON) {
        avgNav = investedCost / remainingUnits;
      } else {
        avgNav = computeInstrumentRealizedDetail(transactionsByInstrument[instrument]).avgBuyCost;
      }
      holdings.push({ instrument: instrument, units: remainingUnits, invested: investedCost, avgNav: avgNav });
    });

    if (!holdings.length) {
      statusEl.textContent = MFH_STATE.showClosed
        ? "No closed mutual fund holdings for this filter."
        : "No mutual fund holdings with unsold units found.";
      tableWrap.hidden = true;
      // Clear the new card-list view too so stale rows don't linger.
      try { renderMfHoldingsCardList([]); } catch (e) {}
      return;
    }

    statusEl.textContent = "Resolving mutual fund scheme codes…";

    buildInstrumentSchemeMap().then(function (schemeMap) {
      var resolvable = holdings.filter(function (h) { return h.units < 1 || !!lookupSchemeCode(schemeMap, h.instrument); });
      var skipped = holdings.length - resolvable.length;
      if (!resolvable.length) {
        statusEl.textContent = "None of your holdings could be resolved to a Scheme Code via the Mutual Fund Mapping sheet and AMFI.";
        tableWrap.hidden = true;
        // Nothing renders on this path, so the Closed segment would keep whatever
        // state the markup shipped with. There is definitely nothing closed here.
        MFH_STATE.showClosed = false;
        _setOpenClosedPill(document.getElementById("mfh-open-toggle"), false, anyClosedMf, anyOpenMf);
        return;
      }

      return Promise.all(resolvable.map(function (h) { return h.units < 1 ? Promise.resolve([]) : fetchNavHistory(lookupSchemeCode(schemeMap, h.instrument)); }))
        .then(function (navHistories) {
          var _navByInst = {};
          resolvable.forEach(function (h, i) { _navByInst[h.instrument] = navHistories[i] || []; });
          // One build for every portfolio and both sides. The Mutual Fund and Debt
          // tables are two filters over it, and the pills below filter it again
          // without touching the network.
          var _allRows = _buildEquityRowsPerPortfolio(rows, _navByInst, function () { return true; });
          window.__mfAllRows = _allRows;
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
          // Split debt funds out of the equity list. An instrument marked Fixed
          // Income in the mapping sheet belongs in Debt ETF/Mutual Fund, and showing it
          // in both would double count it to the reader.
          var _dbtCat = buildInstrumentTopCategoryMap();
          function _isDebt(name) {
            return normalizeText(_dbtCat[normalizeText(name || "")] || "") === "fixed income";
          }
          // Two filters over the one per-portfolio build. Both tables therefore hold
          // every portfolio and both sides, and their pills are pure view state.
          var mfOnlyRows = _allRows.filter(function (r) { return !_isDebt(r.instrument); });
          window.__mfDebtRows = _allRows.filter(function (r) { return _isDebt(r.instrument); });
          window.__mfAllRows = mfOnlyRows;
          // Cached for the allocation toggle to re-render from. It holds the
          // debt-EXCLUDED rows so a later repaint can't reintroduce debt funds
          // into the Mutual Fund allocation.
          window.__mfLastRowsData = mfOnlyRows;
          try { renderMfHoldingsCardList(mfOnlyRows); } catch (e) {}
          try { renderDebtHoldings(); } catch (e) {}
          // Portfolio cards + allocation + performance are top-level summaries
          // and must NOT shift when the user filters the Holdings list to a
          // specific portfolio via the holdings pill toggle.
          var _mfOverride = window.__mfHoldingsPortfolioOverride;
          if (!_mfOverride || _mfOverride === "all") {
            try { renderMfPortfolioCards(); } catch (e) {}
            try { renderMfAllocation(mfOnlyRows); } catch (e) {}
            try { renderMfPerformanceChart(); } catch (e) {}
          }

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
  function _mfhSortCompare(a, b, key) {
    var av, bv;
    switch (key) {
      case "instrument": av = String(a.instrument || "").toLowerCase(); bv = String(b.instrument || "").toLowerCase(); return av < bv ? -1 : av > bv ? 1 : 0;
      case "invested": return (a.invested || 0) - (b.invested || 0);
      case "current": return (a.current || 0) - (b.current || 0);
      case "ltp": return (a.currNav || 0) - (b.currNav || 0);
      case "day": return ((a.dayChgPct || 0) * (a.current || 0) - (b.dayChgPct || 0) * (b.current || 0)) / 100;
      case "pnl": return (a.pnl || 0) - (b.pnl || 0);
      case "xirr": return (a.xirrPct == null ? -Infinity : a.xirrPct) - (b.xirrPct == null ? -Infinity : b.xirrPct);
    }
    return 0;
  }
  // Debt ETF/Mutual Fund reuses this list wholesale, so both tables share one
  // implementation and cannot drift apart in columns, sorting or formatting.
  // `opts` names the target elements and the sort/open state to read.
  function renderMfHoldingsCardList(rowsData, opts) {
    opts = opts || {};
    var listId = opts.listId || "mfh-list";
    var state = opts.state || MFH_STATE;
    var list = document.getElementById(listId);
    var eyebrow = document.getElementById(opts.eyebrowId || "mfh-eyebrow");
    if (!list) return;
    // Nothing closed → the Closed segment is disabled. And if we are already on
    // Closed when that becomes true (the list was re-rendered from a smaller set),
    // fall back to Open rather than stranding the user on an empty view behind a
    // control they can no longer press.
    // Both tables now receive every portfolio and both sides, so the pills are pure
    // view state over one row set — the shape Fixed Income Holding always had. The
    // portfolio filter is applied FIRST so the Open/Closed availability answers for
    // the portfolio on screen.
    var pfBoxId = opts.portfolioToggleId || (state === MFH_STATE ? "mfh-portfolio-toggle" : "dbth-portfolio-toggle");
    var pfAttr = state === MFH_STATE ? "data-mfh-portfolio" : "data-dbth-portfolio";
    var pfHave = [];
    rowsData.forEach(function (r) {
      var pn = (r._portfolio || "").trim();
      if (pn && pfHave.indexOf(pn) === -1) pfHave.push(pn);
    });
    state.portfolio = _renderPortfolioPills(
      document.getElementById(pfBoxId), pfAttr,
      _allPortfolioNames(state === MFH_STATE ? ["equity"] : ["equity", "stocksetf"]),
      state.portfolio || "all", function (p) { return pfHave.indexOf(p) !== -1; });
    var scoped = (state.portfolio && state.portfolio !== "all")
      ? rowsData.filter(function (r) { return normalizeText(r._portfolio || "") === normalizeText(state.portfolio); })
      : rowsData;
    var hasClosed = scoped.some(function (r) { return r.units < 1; });
    var hasOpen = scoped.some(function (r) { return r.units >= 1; });
    // Land on a side that has something, when there is one.
    if (state.showClosed && !hasClosed && hasOpen) state.showClosed = false;
    else if (!state.showClosed && !hasOpen && hasClosed) state.showClosed = true;
    _setOpenClosedPill(document.getElementById(opts.toggleId ||
      (state === MFH_STATE ? "mfh-open-toggle" : "dbth-open-toggle")), state.showClosed, hasClosed, hasOpen);
    var filtered = scoped.filter(function (r) {
      var closed = r.units < 1;
      return state.showClosed ? closed : !closed;
    });
    if (!state.portfolio || state.portfolio === "all") {
      filtered = _mergeHoldingRowsByInstrument(filtered, {
        unitsKey: "units",
        sumKeys: ["invested", "current", "pnl", "dayChgINR"],
        avgPairs: [["avgNav", "invested"]],
        pctPairs: [["pnlPct", "pnl", "invested"]]
        // currNav and dayChgPct are per-unit properties of the instrument itself,
        // identical across portfolios, so the first row's values carry over.
      });
    }
    var parts = String(state.sort || "pnl-desc").split("-");
    var sortKey = parts[0];
    var sortDir = parts[1] === "asc" ? 1 : -1;
    filtered.sort(function (a, b) { return sortDir * _mfhSortCompare(a, b, sortKey); });
    var segmentMap = buildInstrumentSegmentMap();
    if (eyebrow) eyebrow.textContent = "HOLDINGS · " + filtered.length + (state.showClosed ? " CLOSED" : " OPEN");
    if (!filtered.length) {
      list.innerHTML = '<p class="muted small" style="padding:20px;text-align:center;">No holdings to show.</p>';
      return;
    }
    function _arrow(k) { return sortKey === k ? (sortDir === -1 ? " ↓" : " ↑") : ""; }
    var mfhGrid = 'grid-template-columns: minmax(180px, 2.2fr) 0.9fr 0.9fr 0.9fr 0.85fr 1fr 0.85fr;';
    var header = '<div class="mfh-list-header" style="' + mfhGrid + '">' +
      '<span class="mfh-sortable" data-mfh-sort-col="instrument">Instrument' + _arrow("instrument") + '</span>' +
      '<span class="mfh-col-num mfh-sortable" data-mfh-sort-col="invested">Invested' + _arrow("invested") + '</span>' +
      '<span class="mfh-col-num mfh-sortable" data-mfh-sort-col="current">Current' + _arrow("current") + '</span>' +
      '<span class="mfh-col-num mfh-sortable" data-mfh-sort-col="ltp">LTP' + _arrow("ltp") + '</span>' +
      '<span class="mfh-col-num mfh-sortable" data-mfh-sort-col="day">Day Chg' + _arrow("day") + '</span>' +
      '<span class="mfh-col-num mfh-sortable" data-mfh-sort-col="pnl">P&amp;L · Return' + _arrow("pnl") + '</span>' +
      '<span class="mfh-col-num mfh-sortable" data-mfh-sort-col="xirr">XIRR' + _arrow("xirr") + '</span>' +
      '</div>';
    var subInv = 0, subCur = 0, subDay = 0, subPnl = 0;
    // Each row's share of invested. Computed up front, not from the subInv the
    // map accumulates — that one is still zero while the first row is drawn.
    // The base is the FILTERED set, so it re-scales to 100% whenever the
    // portfolio pill or the Open/Closed segment changes what is on screen.
    var totalInvested = filtered.reduce(function (s, r) { return s + (r.invested || 0); }, 0);
    var body = filtered.map(function (r, i) {
      subInv += r.invested || 0;
      subCur += r.current || 0;
      subPnl += r.pnl || 0;
      if (r.dayChgINR != null) subDay += r.dayChgINR;
      else if (r.dayChgPct != null && r.current != null) subDay += r.current * r.dayChgPct / 100;
      var pal = _avatarFor(r.instrument, i);
      var code = _shortCode(r.instrument);
      var seg = lookupSegment(segmentMap, r.instrument);
      // Name the portfolio(s) the holding sits in. On "All" a merged row lists
      // every portfolio it was summed from, so the figures can be traced back.
      var pfNames = (r._portfolios && r._portfolios.length) ? r._portfolios.join(" + ") : (r._portfolio || "");
      var sub = (pfNames ? '<div class="mfh-inst-sub">' + escapeHtml(pfNames) + '</div>' : "") +
        '<div class="mfh-inst-sub">' + escapeHtml(seg) + " · " + r.units.toFixed(1) +
          " units @ ₹" + r.avgNav.toFixed(2) + '</div>' +
        '<div class="mfh-inst-share">' + _investedSharePct(r.invested, totalInvested) + '</div>';
      var isSip = _isSipInstrument(r.instrument);
      var pnlPos = r.pnl >= 0;
      var xirrCls = r.xirrPct == null ? "mfh-muted" : (r.xirrPct >= 0 ? "" : "mfh-negative");
      var xirrText = r.xirrPct == null ? "—" : ((r.xirrPct >= 0 ? "+" : "") + r.xirrPct.toFixed(2) + "%");
      var ltpStr = (r.currNav != null && isFinite(r.currNav)) ? "₹" + Number(r.currNav).toFixed(2) : "—";
      return '<div class="mfh-row mfh-color-' + pal.accent + '" style="' + mfhGrid + '">' +
        '<div class="mfh-inst">' +
          '<div class="mfh-avatar" style="background:' + pal.bg + ';color:' + pal.fg + ';">' + code + '</div>' +
          '<div class="mfh-inst-body">' +
            '<div class="mfh-inst-name">' + escapeHtml(truncateInstrumentNameToFund(r.instrument)) + '</div>' +
            sub +
          '</div>' +
        '</div>' +
        '<div class="mfh-col-num mfh-num-primary"' + _crTitle(r.invested) + '>' + formatCurrency(r.invested) + '</div>' +
        '<div class="mfh-col-num mfh-num-primary"' + _crTitle(r.current) + '>' + formatCurrency(r.current) + '</div>' +
        '<div class="mfh-col-num mfh-num-primary">' + ltpStr + '</div>' +
        (function () {
          // Rupee day change is normally derived from the percent, which is
          // measured against the PREVIOUS close — so multiplying by the current
          // value is very slightly off. Rows that already know the exact rupee
          // figure (the Stocks/ETF-sourced debt rows) pass it through instead of
          // having it re-derived and rounded.
          if (r.dayChgINR != null) return _mfhDayCell(r.dayChgINR, r.dayChgPct);
          var dayVal = (r.dayChgPct == null || r.current == null) ? null : (r.current * r.dayChgPct / 100);
          return _mfhDayCell(dayVal, r.dayChgPct);
        })() +
        '<div class="mfh-col-num mfh-num-pnl">' +
          '<span class="mfh-num-pnl-value ' + (pnlPos ? "" : "mfh-negative") + '"' + _crTitle(r.pnl) + '>' + (pnlPos ? "+" : "") + formatCurrency(r.pnl) + '</span>' +
          '<span class="mfh-num-pnl-pct ' + (pnlPos ? "" : "mfh-negative") + '">' + (pnlPos ? "+" : "") + r.pnlPct.toFixed(2) + '%</span>' +
        '</div>' +
        '<div class="mfh-col-num mfh-num-xirr ' + xirrCls + '">' + xirrText + '</div>' +
      '</div>';
    }).join("");
    var subPct = subInv > 0 ? (subPnl / subInv) * 100 : 0;
    var subDayPct = (subCur - subDay) > 0 ? (subDay / (subCur - subDay)) * 100 : null;
    var footer = '<div class="mfh-row" style="' + mfhGrid + 'background:var(--bg);padding:10px 6px;border-radius:8px;font-weight:700;margin-top:6px;">' +
      '<div style="font-size:0.72rem;">' + (state.showClosed ? "Closed" : "Open") + ' subtotal<div style="font-size:0.55rem;letter-spacing:0.11em;text-transform:uppercase;color:var(--muted);margin-top:2px;">' + filtered.length + ' HOLDINGS</div></div>' +
      '<div class="mfh-col-num mfh-num-primary"' + _crTitle(subInv) + '>' + formatCurrency(subInv) + '</div>' +
      '<div class="mfh-col-num mfh-num-primary"' + _crTitle(subCur) + '>' + formatCurrency(subCur) + '</div>' +
      '<div class="mfh-col-num mfh-num-primary" style="color:var(--muted);">—</div>' +
      _mfhDayCell(Math.abs(subDay) < 0.01 ? null : subDay, subDayPct) +
      '<div class="mfh-col-num mfh-num-pnl"><span class="mfh-num-pnl-value ' + (subPnl >= 0 ? "" : "mfh-negative") + '"' + _crTitle(subPnl) + '>' + (subPnl >= 0 ? "+" : "") + formatCurrency(subPnl) + '</span><span class="mfh-num-pnl-pct ' + (subPct >= 0 ? "" : "mfh-negative") + '">' + (subPct >= 0 ? "+" : "") + subPct.toFixed(2) + '%</span></div>' +
      '<div class="mfh-col-num mfh-num-xirr mfh-muted">—</div>' +
      '</div>';
    list.innerHTML = header + body + footer;
    try { applyHoldingsFold(listId); } catch (e) {}
    list.querySelectorAll("[data-mfh-sort-col]").forEach(function (el) {
      el.addEventListener("click", function () {
        var col = el.dataset.mfhSortCol;
        var cur = String(state.sort || "").split("-");
        state.sort = (cur[0] === col && cur[1] === "desc") ? (col + "-asc") : (col + "-desc");
        renderMfHoldingsCardList(rowsData, opts);
      });
    });
  }

  // Phase 1: portfolio cards (per-portfolio MF invested/current/xirr)
  function renderMfPortfolioCards() {
    var row = document.getElementById("mfpc-row");
    if (!row) return;
    var allRows = getSheetRows("equity");
    if (!allRows) { row.innerHTML = ""; return; }
    // Debt funds are reported under Debt ETF/Mutual Fund, so they are excluded from
    // these cards' invested, current, day change and XIRR alike — computing all
    // four from the same non-debt population keeps the card internally consistent.
    var rows = excludeFixedIncomeRows(allRows);
    // Portfolios are drawn from the filtered sheet: one whose every instrument is
    // Fixed Income has no mutual fund holding, so it gets no card here at all.
    var names = collectPortfolioNamesFromRows(rows);
    if (!names.length) { row.innerHTML = ""; return; }

    var combinedInv = 0, combinedCur = 0, combinedDay = 0;
    Promise.all(names.map(function (name) {
      var invested = sumUnitBasedBuyInvestment(rows, name);
      return _computeMfCurrentValueForPortfolio(name, null, true).then(function (res) {
        var current = res.current, dayChange = res.dayChange;
        var flows = buildXirrCashFlows(rows, name);
        if (current > 0) flows = flows.concat([{ date: new Date(), amount: current }]);
        var xirr = calculateXIRR(flows);
        combinedInv += invested; combinedCur += current; combinedDay += dayChange;
        return { name: name, invested: invested, current: current, xirr: xirr, dayChange: dayChange };
      });
    })).then(function (perPortfolio) {
      perPortfolio.sort(function (a, b) { return b.current - a.current; });
      var comboFlows = buildXirrCashFlows(rows, "all");
      if (combinedCur > 0) comboFlows.push({ date: new Date(), amount: combinedCur });
      var comboXirr = calculateXIRR(comboFlows);
      var all = [{ name: "Combined", invested: combinedInv, current: combinedCur, xirr: comboXirr, dayChange: combinedDay, isCombined: true }].concat(perPortfolio);
      row.innerHTML = all.map(function (p, i) {
        var pnl = p.current - p.invested;
        var pnlPct = p.invested > 0 ? (pnl / p.invested) * 100 : 0;
        var xirrPct = p.xirr == null || !isFinite(p.xirr) ? null : p.xirr * 100;
        var pal = p.isCombined
          ? { bg: "#23211D", fg: "#fff" }
          : { bg: MFH_AVATAR_PALETTE[i % 3].bg, fg: MFH_AVATAR_PALETTE[i % 3].fg };
        var initial = p.isCombined ? "Σ" : _initials(p.name).charAt(0);
        var subtitle = p.isCombined ? "HOUSEHOLD TOTAL" : "PERSONAL PORTFOLIO";
        // Day change + day change % (vs previous close). prevVal = current − dayChange.
        var dayChg = p.dayChange || 0;
        var prevVal = p.current - dayChg;
        var dayPct = prevVal > 0 ? (dayChg / prevVal) * 100 : 0;
        var dayNeg = dayChg < 0;
        var dayChgHtml = '<div class="mfpc-daychange ' + (dayNeg ? "mfpc-negative" : "") + '">' +
          '<span class="mfpc-daychange-label">DAY CHANGE</span>' +
          '<span class="mfpc-daychange-value">' + (dayNeg ? "" : "+") + formatCurrency(dayChg) +
            ' <span class="mfpc-daychange-pct">(' + (dayNeg ? "" : "+") + dayPct.toFixed(2) + '%)</span></span>' +
        '</div>';
        return '<div class="mfpc-card ' + (p.isCombined ? "mfpc-combined" : "") + '">' +
          '<div class="mfpc-head">' +
            '<div class="mfpc-avatar" style="background:' + pal.bg + ';color:' + pal.fg + ';">' + initial + '</div>' +
            '<div class="mfpc-name-block">' +
              '<div class="mfpc-name">' + escapeHtml(p.name) + '</div>' +
              '<div class="mfpc-subtitle">' + subtitle + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="mfpc-current-label">CURRENT VALUE</div>' +
          '<div class="mfpc-current-row">' +
            '<div class="mfpc-current-value"' + _crTitle(p.current) + '>' + formatCurrency(p.current) + '</div>' +
            dayChgHtml +
          '</div>' +
          _mfpcBarHtml() +
          _mfpcReturnRowHtml(pnl, pnlPct) +
          '<div class="mfpc-footer">' +
            '<div class="mfpc-foot-item"><span class="mfpc-foot-label">Invested</span><span class="mfpc-foot-value">' + formatCurrency(p.invested) + '</span></div>' +
            '<div class="mfpc-foot-item"><span class="mfpc-foot-label">XIRR</span><span class="mfpc-foot-value mfpc-xirr ' + (xirrPct != null && xirrPct < 0 ? "mfpc-negative" : "") + '">' + (xirrPct == null ? "—" : (xirrPct >= 0 ? "+" : "") + xirrPct.toFixed(2) + "%") + '</span></div>' +
          '</div>' +
        '</div>';
      }).join("");
    });
  }

  // outByCat (optional): accumulates current value per Instrument Category, so
  // callers can separate debt and gold funds from equity ones. The return shape
  // is unchanged, so existing callers are unaffected.
  function _computeMfCurrentValueForPortfolio(portfolio, outByCat, excludeDebt) {
    var rows = getSheetRows("equity");
    if (!rows) return Promise.resolve({ current: 0, dayChange: 0 });
    var byInst = groupUnitTransactionsByInstrument(rows, portfolio);
    if (!byInst) return Promise.resolve({ current: 0, dayChange: 0 });
    var _topCat = (outByCat || excludeDebt) ? buildInstrumentTopCategoryMap() : null;
    if (excludeDebt) {
      Object.keys(byInst).forEach(function (n) {
        if (isFixedIncomeInstrument(n, _topCat)) delete byInst[n];
      });
    }
    function _addCat(nm, v) {
      if (!outByCat || !v) return;
      var c = _topCat[normalizeText(nm)] || "Equity";
      outByCat[c] = (outByCat[c] || 0) + v;
    }
    return buildInstrumentSchemeMap().then(function (schemeMap) {
      var allNames = Object.keys(byInst);
      var mapped = allNames.filter(function (n) { return !!lookupSchemeCode(schemeMap, n); });
      return Promise.all(mapped.map(function (n) { return fetchNavHistory(lookupSchemeCode(schemeMap, n)); }))
        .then(function (histories) {
          var histByName = {};
          mapped.forEach(function (n, i) { histByName[n] = histories[i]; });
          var total = 0, prevTotal = 0;
          allNames.forEach(function (n) {
            var lots = fifoRemainingLots(byInst[n]);
            var units = lots.reduce(function (s, l) { return s + l.units; }, 0);
            if (units <= UNITS_EPSILON) return;
            var hist = histByName[n];
            var nav = hist && hist.length ? hist[hist.length - 1].nav : 0;
            if (nav) {
              var prevNav = previous_nav_for(hist);
              total += units * nav;
              _addCat(n, units * nav);
              prevTotal += units * (prevNav || nav); // no day change if prev NAV missing
            } else {
              // Unmapped or NAV-missing fund: value at COST — matches the Overview's
              // updateTotalCurrentValue fallback so the split cards reconcile with it
              // (previously these funds were dropped, undercounting the split totals).
              var cost = lots.reduce(function (s, l) { return s + l.units * l.price; }, 0);
              total += cost;
              _addCat(n, cost);
              prevTotal += cost; // cost-valued → no day change
            }
          });
          return { current: total, dayChange: total - prevTotal };
        });
    });
  }

  var MFALLOC_MODE = { mode: "portfolio" };
  // Phase 2: allocation — segment (market cap) OR portfolio breakdown
  function renderMfAllocation(rowsData) {
    var listEl = document.getElementById("mfalloc-list");
    var eyebrow = null; // eyebrow is now static ("ALLOCATION · MUTUAL FUNDS")
    if (!listEl) return;
    var segmentMap = buildInstrumentSegmentMap();
    var PAL = ["#10B981", "#D4A017", "#3B82F6", "#E8623A", "#8B5CF6", "#64748B", "#06B6D4", "#EC4899"];
    var PORT_PAL = ["#10B981", "#F59E0B", "#3B82F6", "#8B5CF6", "#06B6D4", "#EC4899", "#84CC16", "#6366F1"];

    // Look up which portfolio each MF instrument belongs to.
    var eqRows = getSheetRows("equity") || [];
    var portfolioByInst = {};
    if (eqRows.length) {
      var hdr = eqRows[0].map(normalizeText);
      var pI = hdr.indexOf("portfolio name");
      var iI = hdr.indexOf("instrument name");
      if (pI !== -1 && iI !== -1) {
        eqRows.slice(1).forEach(function (row) {
          var name = (row[iI] || "").trim();
          if (name && !portfolioByInst[name]) portfolioByInst[name] = (row[pI] || "").trim();
        });
      }
    }

    if (MFALLOC_MODE.mode === "portfolio") {
      if (eyebrow) eyebrow.textContent = "PORTFOLIO";
      // Group by portfolio; each portfolio breaks down by market-cap/segment.
      var byPort = {}; // { p: { total, bySeg: {seg: value} } }
      rowsData.forEach(function (r) {
        if (r.units < 1) return;
        var p = portfolioByInst[r.instrument] || "Unassigned";
        var seg = lookupSegment(segmentMap, r.instrument);
        if (!byPort[p]) byPort[p] = { total: 0, bySeg: {} };
        byPort[p].total += r.current || 0;
        byPort[p].bySeg[seg] = (byPort[p].bySeg[seg] || 0) + (r.current || 0);
      });
      var entries = Object.keys(byPort).map(function (k) { return { name: k, total: byPort[k].total, bySeg: byPort[k].bySeg }; })
        .filter(function (e) { return e.total > 0.01; })
        .sort(function (a, b) { return b.total - a.total; });
      var grand = entries.reduce(function (s, e) { return s + e.total; }, 0);
      if (!entries.length || grand <= 0) { listEl.innerHTML = '<p class="muted small">No portfolio allocation data.</p>'; return; }
      // Build a stable segment→color map from segments seen anywhere.
      var allSegs = {};
      entries.forEach(function (e) { Object.keys(e.bySeg).forEach(function (k) { allSegs[k] = true; }); });
      var segList = Object.keys(allSegs);
      var segColor = {};
      segList.forEach(function (s, i) { segColor[s] = PAL[i % PAL.length]; });
      var bar = '<div class="mfalloc-single-bar">' + entries.map(function (e, i) {
        var pct = (e.total / grand) * 100;
        return '<span class="mfalloc-seg" style="flex:' + pct + ' 0 0;background:' + PORT_PAL[i % PORT_PAL.length] + ';" title="' + escapeHtml(e.name) + '"></span>';
      }).join("") + '</div>';
      var rowsHtml = entries.map(function (e, i) {
        var pct = (e.total / grand) * 100;
        var col = PORT_PAL[i % PORT_PAL.length];
        var chipSegs = Object.keys(e.bySeg).sort(function (a, b) { return e.bySeg[b] - e.bySeg[a]; });
        var chips = chipSegs.filter(function (s) { return e.bySeg[s] > 0.01; }).map(function (s) {
          var sp = (e.bySeg[s] / e.total) * 100;
          return '<span class="isc-cat-chip"><span class="isc-cat-dot" style="background:' + segColor[s] + '"></span>' + s + ' ' + Math.round(sp) + '%</span>';
        }).join("");
        return '<div class="mfalloc-row" style="flex-direction:column;align-items:stretch;gap:4px;padding:8px 0;">' +
          '<div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;">' +
            '<span class="mfalloc-name"><span class="mfalloc-dot" style="background:' + col + ';"></span>' + escapeHtml(e.name) + '</span>' +
            '<span class="mfalloc-nums">' +
              '<span class="mfalloc-amount">' + formatCurrency(e.total) + '</span>' +
              '<span class="mfalloc-pct" style="color:' + col + ';">' + Math.round(pct) + '%</span>' +
            '</span>' +
          '</div>' +
          (chips ? '<div class="isc-cat-sub">' + chips + '</div>' : '') +
        '</div>';
      }).join("");
      listEl.innerHTML = bar + '<div class="mfalloc-rows">' + rowsHtml + '</div>';
      return;
    }

    if (eyebrow) eyebrow.textContent = "MARKET CAP/SEGMENT";
    // A segment says nothing about asset class on its own — Arbitrage and Debt
    // sit next to Small Cap and read alike. Tag each row with the Instrument
    // Category its funds are mapped to, so equity and fixed income are
    // distinguishable at a glance.
    var mfTopCat = buildInstrumentTopCategoryMap();
    var bySeg = {};
    var catBySeg = {};
    rowsData.forEach(function (r) {
      if (r.units < 1) return;
      var seg = lookupSegment(segmentMap, r.instrument);
      bySeg[seg] = (bySeg[seg] || 0) + (r.current || 0);
      var cat = mfTopCat[normalizeText(r.instrument)] || "";
      if (cat) {
        if (!catBySeg[seg]) catBySeg[seg] = {};
        catBySeg[seg][cat] = (catBySeg[seg][cat] || 0) + (r.current || 0);
      }
    });
    // A segment can hold more than one category; list them largest first rather
    // than picking one and hiding the rest.
    function segCatLabel(seg) {
      var m = catBySeg[seg];
      if (!m) return "";
      return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; }).join(" · ");
    }
    var entries = Object.keys(bySeg).map(function (k) { return { name: k, value: bySeg[k] }; })
      .sort(function (a, b) { return b.value - a.value; });
    var total = entries.reduce(function (s, e) { return s + e.value; }, 0);
    if (!entries.length) { listEl.innerHTML = '<p class="muted small">No allocation data.</p>'; return; }
    var PAL = ["#10B981", "#D4A017", "#3B82F6", "#E8623A", "#8B5CF6", "#64748B", "#06B6D4", "#EC4899"];
    var bar = '<div class="mfalloc-single-bar">' + entries.map(function (e, i) {
      var pct = total > 0 ? (e.value / total) * 100 : 0;
      return '<span class="mfalloc-seg" style="flex:' + pct + ' 0 0;background:' + PAL[i % PAL.length] + ';" title="' + escapeHtml(e.name) + '"></span>';
    }).join("") + '</div>';
    var rows = entries.map(function (e, i) {
      var pct = total > 0 ? (e.value / total) * 100 : 0;
      var col = PAL[i % PAL.length];
      var catLabel = segCatLabel(e.name);
      return '<div class="mfalloc-row">' +
        '<span class="mfalloc-name"><span class="mfalloc-dot" style="background:' + col + ';"></span>' + escapeHtml(e.name) +
          (catLabel ? '<span class="mfalloc-cat">' + escapeHtml(catLabel) + '</span>' : '') + '</span>' +
        '<span class="mfalloc-nums">' +
          '<span class="mfalloc-amount">' + formatCurrency(e.value) + '</span>' +
          '<span class="mfalloc-pct" style="color:' + col + ';">' + pct.toFixed(1) + '%</span>' +
        '</span>' +
      '</div>';
    }).join("");
    listEl.innerHTML = bar + '<div class="mfalloc-rows">' + rows + '</div>';
  }

  // Phase 2: Portfolio vs Nifty performance chart (proper cumulative return)
  function renderMfPerformanceChart() {
    var canvas = document.getElementById("mfperf-chart");
    if (!canvas || typeof Chart === "undefined") return;
    var rows = getSheetRows("equity");
    if (!rows) return;
    var range = MFPERF_STATE.range;
    var portfolio = window.__mfHoldingsPortfolioOverride || "all";

    Promise.all([
      buildInstrumentSchemeMap(),
      fetchIndexHistory().catch(function () { return {}; })
    ]).then(function (results) {
      var schemeMap = results[0];
      var indexHistory = results[1];
      var indexKey = localStorage.getItem("wf-benchmark-index") || "NIFTY50";
      var indexPrices = indexHistory && indexHistory[indexKey] && indexHistory[indexKey].prices;

      var unitEvents = buildInstrumentUnitEvents(portfolio);
      // Debt funds are reported under Fixed Income, so this chart — the Mutual
      // Fund tab's performance vs benchmark — must track the same holdings the
      // rest of the tab shows.
      var _perfCat = buildInstrumentTopCategoryMap();
      var instruments = Object.keys(unitEvents).filter(function (n) {
        return !!lookupSchemeCode(schemeMap, n) && !isFixedIncomeInstrument(n, _perfCat);
      });
      if (!instruments.length) return;

      Promise.all(instruments.map(function (n) { return fetchNavHistory(lookupSchemeCode(schemeMap, n)); }))
        .then(function (histories) {
          var navByInst = {};
          instruments.forEach(function (n, i) { navByInst[n] = histories[i]; });

          // Build MF cash-flow list (positive amount = buy → invested, negative = sell → withdrawn)
          var flows = [];
          instruments.forEach(function (name) {
            (unitEvents[name] || []).forEach(function (ev) {
              // Track invested at first-touch of each unit-event date using buy-side amount
            });
          });
          // Use existing buildXirrCashFlows for MF cash flows.
          var xflows = buildXirrCashFlows(rows, portfolio);
          xflows.sort(function (a, b) { return a.date - b.date; });

          var today = new Date();
          var firstDate = xflows.length ? xflows[0].date : new Date();
          var startDate = firstDate;
          if (range !== "All") {
            var months = range === "1M" ? 1 : range === "6M" ? 6 : range === "1Y" ? 12 : 36;
            var candidate = new Date(today.getTime() - months * 30 * 86400000);
            if (candidate > firstDate) startDate = candidate;
          }

          // Monthly samples from startDate → today
          var samples = [];
          var d = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
          var end = new Date(today.getFullYear(), today.getMonth(), 1);
          while (d <= end) { samples.push(new Date(d)); d.setMonth(d.getMonth() + 1); }
          samples.push(today);

          // For each sample date, compute cumulative net invested and portfolio value
          var portData = [], idxData = [];
          var baseIdx = indexPrices ? lookupIndexPrice(indexPrices, formatDateISO(startDate)) : null;
          samples.forEach(function (dt) {
            // Net invested (buys - sells) up to dt
            var invested = 0;
            xflows.forEach(function (f) {
              if (f.date <= dt) invested += (-f.amount); // f.amount negative for buys
            });
            // Portfolio value = sum(units×NAV) at dt
            var value = 0;
            instruments.forEach(function (name) {
              var units = lastAtOrBefore(unitEvents[name] || [], dt, "cumulativeUnits") || 0;
              var nav = lastAtOrBefore(navByInst[name] || [], dt, "nav");
              if (units > UNITS_EPSILON && nav) value += units * nav;
            });
            var portRet = invested > 0 ? ((value - invested) / invested) * 100 : 0;
            portData.push({ x: dt, y: portRet });
            if (baseIdx && indexPrices) {
              var p = lookupIndexPrice(indexPrices, formatDateISO(dt));
              idxData.push({ x: dt, y: p ? ((p / baseIdx) - 1) * 100 : null });
            }
          });

          _drawMfPerfChart(canvas, portData, idxData);
          var lastPort = portData.length ? portData[portData.length - 1].y : 0;
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
  // Wire the MF Allocation Market Cap/Segment ⇄ Portfolio toggle.
  (function wireMfAllocToggle() {
    var buttons = document.querySelectorAll("[data-mfalloc-mode]");
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        MFALLOC_MODE.mode = btn.dataset.mfallocMode;
        buttons.forEach(function (b) { b.classList.toggle("active", b === btn); });
        if (window.__mfLastRowsData) renderMfAllocation(window.__mfLastRowsData);
        else renderEquityHoldingsTable();
      });
    });
  })();

  (function wireMfControls() {
    var openBtn = document.getElementById("mfh-open-toggle");
    var sortBtn = document.getElementById("mfh-sort-toggle");
    // Debt ETF/Mutual Fund has its own Open/Closed state, so switching one table does
    // not move the other. It re-renders from the rows already split out, with no
    // refetch needed.
    var dbtBox = document.getElementById("dbth-open-toggle");
    if (dbtBox) {
      _setOpenClosedPill(dbtBox, DBTH_STATE.showClosed);
      dbtBox.addEventListener("click", function (ev) {
        var btn = ev.target.closest("[data-dbth-open]");
        if (!btn) return;
        var wantClosed = btn.getAttribute("data-dbth-open") === "closed";
        if (wantClosed === !!DBTH_STATE.showClosed) return;
        DBTH_STATE.showClosed = wantClosed;
        _setOpenClosedPill(dbtBox, wantClosed);
        try { renderDebtHoldings(); } catch (e) {}
      });
    }
    if (openBtn) {
      _setOpenClosedPill(openBtn, MFH_STATE.showClosed);
      openBtn.addEventListener("click", function (ev) {
        var btn = ev.target.closest("[data-mfh-open]");
        if (!btn) return;
        var wantClosed = btn.getAttribute("data-mfh-open") === "closed";
        if (wantClosed === !!MFH_STATE.showClosed) return;
        MFH_STATE.showClosed = wantClosed;
        var cb = document.getElementById("equity-holdings-show-closed-only");
        if (cb) cb.checked = MFH_STATE.showClosed;
        dbg("MF Open toggle → showClosed:", MFH_STATE.showClosed);
        renderMfHoldingsCardList(window.__mfAllRows || []);
      });
    }
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
      // Delegated, so the pills can be repainted on every render (availability
      // depends on data that arrives after this wiring runs) without rebinding.
      pfToggle.addEventListener("click", function (ev) {
        var btn = ev.target.closest("[data-mfh-portfolio]");
        if (!btn || btn.disabled || btn.dataset.mfhPortfolio === MFH_STATE.portfolio) return;
        MFH_STATE.portfolio = btn.dataset.mfhPortfolio;
        // Filter the rows already built, like Fixed Income Holding — re-running the
        // pipeline here meant every click waited on the NAV fetches.
        window.__mfHoldingsPortfolioOverride = MFH_STATE.portfolio;
        renderMfHoldingsCardList(window.__mfAllRows || []);
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

    var selectedPortfolio = "all";
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

    var selectedPortfolio = "all";
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

    if (!seRows || seRows.length < 2) { warnEl.hidden = true; return; }
    var header = seRows[0].map(normalizeText);
    var portfolioIdx = header.indexOf("portfolio name");
    var typeIdx = header.indexOf("transaction type");
    var instrumentIdx = header.indexOf("instrument name");
    var unitsIdx = header.indexOf("units");
    var dateIdx = header.indexOf("transaction date");
    if (typeIdx === -1 || instrumentIdx === -1 || dateIdx === -1 || unitsIdx === -1) {
      warnEl.hidden = true; return;
    }

    var selectedPortfolio = "all";
    var mappingTable = buildStockMappingTable();

    // Build per-(portfolio × ticker) transaction lists directly from the sheet,
    // so that when two portfolios hold the same stock each is tracked separately.
    // Also collect the set of already-recorded split/bonus rows keyed per portfolio.
    var byPortfolioTicker = {}; // "portfolio|ticker" → { portfolio, ticker, firstTxnDate, txns }
    var recordedKeys = {};      // "portfolio|ticker|dateISO" → true (±14d window)
    seRows.slice(1).forEach(function (row) {
      var portfolio = (row[portfolioIdx] !== undefined ? row[portfolioIdx] : "").toString().trim();
      var type = normalizeText(row[typeIdx] || "");
      var isBuy = type.indexOf("buy") !== -1;
      var isSell = type.indexOf("sell") !== -1;
      var isCorpAction = type === "split" || type === "bonus";
      if (!isBuy && !isSell && !isCorpAction) return;

      var instrument = (row[instrumentIdx] || "").trim();
      var mapping = mappingTable[normalizeText(instrument)];
      if (!mapping || !mapping.ticker) return;
      var tickerKey = mapping.ticker.toLowerCase();
      var date = parseFlexibleDate(row[dateIdx]);
      if (!date) return;
      var comboKey = normalizeText(portfolio) + "|" + tickerKey;

      if (isCorpAction) {
        for (var d = -14; d <= 14; d++) {
          var shifted = new Date(date.getTime() + d * 86400000);
          recordedKeys[comboKey + "|" + formatDateISO(shifted)] = true;
        }
      }

      if (!byPortfolioTicker[comboKey]) {
        byPortfolioTicker[comboKey] = { portfolio: portfolio, ticker: mapping.ticker, firstTxnDate: null, txns: [] };
      }
      var bucket = byPortfolioTicker[comboKey];
      var iso = formatDateISO(date);
      if (!bucket.firstTxnDate || iso < bucket.firstTxnDate) bucket.firstTxnDate = iso;
      bucket.txns.push({ type: (isBuy || isCorpAction) ? "buy" : "sell", units: parseNumber(row[unitsIdx]), date: date });
    });

    // For each corporate action ticker, find every portfolio that holds it and
    // compute the per-portfolio units to add. Group results by ticker so a stock
    // held in two portfolios shows a sub-line per portfolio.
    var grouped = {}; // tickerKey → { instrument, actions: [ {date, ratio, type, lines:[{portfolio, units}]} ] }
    Object.keys(corporateActions).forEach(function (tickerName) {
      var tickerKey = tickerName.toLowerCase();
      var actions = corporateActions[tickerName];
      actions.forEach(function (action) {
        var lines = [];
        Object.keys(byPortfolioTicker).forEach(function (comboKey) {
          var bucket = byPortfolioTicker[comboKey];
          if (bucket.ticker.toLowerCase() !== tickerKey) return;
          if (selectedPortfolio !== "all" && normalizeText(bucket.portfolio) !== normalizeText(selectedPortfolio)) return;
          if (bucket.firstTxnDate && action.date < bucket.firstTxnDate) return;
          if (recordedKeys[normalizeText(bucket.portfolio) + "|" + tickerKey + "|" + action.date]) return;
          var unitsAtAction = 0;
          bucket.txns.forEach(function (txn) {
            if (!txn.date || formatDateISO(txn.date) >= action.date) return;
            unitsAtAction += txn.type === "buy" ? txn.units : -txn.units;
          });
          unitsAtAction = Math.max(0, Math.round(unitsAtAction * 1000) / 1000);
          if (unitsAtAction <= 0) return;
          var extraUnits = Math.round(unitsAtAction * (action.ratio - 1) * 1000) / 1000;
          lines.push({ portfolio: bucket.portfolio, units: extraUnits });
        });
        if (!lines.length) return;
        var dateParts = action.date.split("-");
        var displayDate = dateParts[2] + "/" + dateParts[1] + "/" + dateParts[0];
        var ratioDisplay = (action.ratio % 1 === 0) ? action.ratio.toFixed(0) : action.ratio;
        if (!grouped[tickerKey]) grouped[tickerKey] = { instrument: tickerName, actions: [] };
        grouped[tickerKey].actions.push({
          date: displayDate,
          ratio: ratioDisplay,
          type: action.type === "split" ? "Split" : "Bonus",
          lines: lines
        });
      });
    });

    var groupKeys = Object.keys(grouped);
    if (!groupKeys.length) { warnEl.hidden = true; return; }

    var pendingCount = 0;
    groupKeys.forEach(function (k) { grouped[k].actions.forEach(function (a) { pendingCount += a.lines.length; }); });

    warnEl.hidden = false;
    var warnSvg = "<svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'/><line x1='12' y1='9' x2='12' y2='13'/><line x1='12' y1='17' x2='12.01' y2='17'/></svg>";

    var items = groupKeys.map(function (tickerKey) {
      var g = grouped[tickerKey];
      var initials = escapeHtml(String(g.instrument).replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "?");
      return g.actions.map(function (a) {
        var badgeClass = a.type.toLowerCase() === "bonus" ? "ca-badge-bonus" : "ca-badge-split";
        var multiClass = a.lines.length > 1 ? " ca-action-multi" : "";
        var actionHtml = "<span class='ca-action" + multiClass + "'>" + a.lines.map(function (ln) {
          var us = (Math.round(ln.units * 1000) / 1000).toLocaleString("en-IN");
          return "<span class='ca-portfolio-line'><span class='ca-portfolio-name'>" + escapeHtml(ln.portfolio || "—") +
            "</span> Add <b>" + us + " units</b> @ ₹0 on <b>" + escapeHtml(a.date) + "</b></span>";
        }).join("") + "</span>";
        return "<div class='ca-item'>" +
          "<span class='ca-avatar'>" + initials + "</span>" +
          "<span class='ca-item-name'>" + escapeHtml(g.instrument) +
            "<span class='ca-badge " + badgeClass + "'>" + escapeHtml(a.ratio) + ":1 " + escapeHtml(a.type) + "</span></span>" +
          actionHtml +
        "</div>";
      }).join("");
    }).join("");

    warnEl.innerHTML =
      "<div class='ca-warning-head'>" +
        "<span class='ca-warning-icon'>" + warnSvg + "</span>" +
        "<span class='ca-warning-title'>Corporate actions not recorded</span>" +
        "<span class='ca-warning-count'>" + pendingCount + " pending</span>" +
      "</div>" +
      "<div class='ca-list'>" + items + "</div>" +
      "<p class='ca-hint'>Add each as a <b>Split</b>/<b>Bonus</b> row (Price 0) in your Stocks/ETF sheet. Clears once recorded.</p>";
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

    // The Stocks/ETF TAB is independent of the Overview portfolio selector — it
    // always builds all portfolios and lets its own per-region toggle filter.
    // The Overview accumulator (_ov.se*), however, must reflect the Overview
    // selector, so it is computed from a separate portfolio-filtered build below.
    var selectedPortfolio = "all";
    var ovPortfolio = localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all";
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
      buildStockHoldings(rows, mappingTable, selectedPortfolio, false),
      buildStockHoldings(rows, mappingTable, ovPortfolio, false)
    ]).then(function (results) {
      var indiaHoldings = results[0].filter(function(h) { return h.region !== "US"; });
      var usHoldings = results[1].filter(function(h) { return h.region === "US"; });
      var holdings = indiaHoldings.concat(usHoldings);
      var openHoldings = results[2];
      // Overview-portfolio-filtered open positions — drives _ov.se* only.
      var ovOpenHoldings = ovPortfolio === "all" ? results[2] : results[3];

      if (!holdings.length) {
        indiaStatusEl.textContent = "No Stocks/ETF holdings with unsold units found. Ensure instrument names match the mapping sheet exactly.";
        usStatusEl.textContent = "No US holdings found.";
        if (indiaTableWrap) indiaTableWrap.hidden = true;
        if (usTableWrap) usTableWrap.hidden = true;
        // Nothing renders here, so the pills would keep whatever the markup shipped
        // with. A portfolio that has sold everything lands on this path, and its
        // Closed segment must still be usable.
        ["india", "us"].forEach(function (reg) {
          var a = _seOpenClosedAvailability(reg, SEH_STATE.portfolio[reg] || "all");
          if (!a.open && a.closed) SEH_STATE.showClosed[reg] = true;
          _setOpenClosedPill(document.getElementById(reg === "us" ? "seh-us-open-toggle" : "seh-open-toggle"),
            SEH_STATE.showClosed[reg], a.closed, a.open);
        });
        // Nothing is held, but money was still put in and taken out, and that is a
        // return. Publish those flows before leaving: this branch is exactly the
        // "sold everything" case, and returning without them left the portfolio
        // XIRR and the benchmark describing only the other asset classes. The
        // terminal is zero here — there is nothing left to mark.
        fetchAllStockPrices().catch(function () { return {}; }).then(function (sp) {
          var flows = buildSeInrFlows(rows, ovPortfolio, mappingTable,
            (sp && sp.usd_inr_history) || {},
            (sp && sp.prices && sp.prices["__USD_INR__"]) ? sp.prices["__USD_INR__"].price : 84);
          _ovFlows.seFlowsINR = flows.slice();
          _ovFlows.seXirrFlows = flows.slice();
          document.dispatchEvent(new CustomEvent("wf-overview-flows-ready"));
        });
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
        // Visible "Price Updated: DD/MM & HH:MM" pill (mirrors the MF NAV Data pill).
        // When a fresh fetch has no timestamp, fall back to the last known update
        // time (persisted) instead of hiding — so it always shows the last price time.
        var priceAsOfEl = document.getElementById("stocksetf-price-asof");
        var priceAsOfTextEl = document.getElementById("stocksetf-price-asof-text");
        if (priceAsOfEl && priceAsOfTextEl) {
          var updatedTs = (pricesAvailable && stockData.updated) ? stockData.updated : null;
          if (updatedTs) {
            try { localStorage.setItem("wf-stocksetf-price-asof", updatedTs); } catch (e) {}
          } else {
            updatedTs = localStorage.getItem("wf-stocksetf-price-asof") || null;
          }
          if (updatedTs) {
            var u = new Date(updatedTs);
            var dm = u.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit" });
            var hm = u.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
            // Live-source badge: green "Live" from Supabase, muted "File" from the static JSON.
            var pSrc = getMarketSource("stock_prices");
            var pBadge = pSrc && pSrc.source === "supabase"
              ? ' <span style="color:#10B981;font-weight:700;" title="Live from Supabase">&#9679; Live</span>'
              : (pSrc && pSrc.source === "static"
                ? ' <span style="color:var(--muted);font-weight:600;" title="From the static JSON on Pages">&#9679; File</span>'
                : '');
            priceAsOfTextEl.innerHTML = "Price Updated: " + dm + " & " + hm + pBadge;
            var isStalePrice = (Date.now() - u.getTime()) > (1000 * 60 * 60 * 24);
            priceAsOfEl.classList.toggle("stale", isStalePrice);
            priceAsOfEl.hidden = false;
          } else {
            priceAsOfEl.hidden = true;
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
          var isUsRow = h.region === "US";
          var investedUSD = isUsRow ? (h.investedNative || 0) : null; // native USD
          var currentUSD = null;
          var ltpUSD = null;
          var avgCostUSD = (isUsRow && h.units > UNITS_EPSILON) ? (h.investedNative || 0) / h.units : null;

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
              investedUSD = detail.costOfSoldUnits;
              currentUSD = detail.saleProceeds;
              ltpUSD = detail.lastSellPrice;
              avgCostUSD = detail.avgBuyCost;
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
              if (isUsRow) { currentUSD = h.units * eodRaw; ltpUSD = eodRaw; } // native USD current + LTP
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
            investedUSD: investedUSD,
            currentUSD: currentUSD,
            ltpUSD: ltpUSD,
            avgCostUSD: avgCostUSD,
            dayChangeINR: dayChangeINR,
            pnl: pnl,
            pnlPct: pnlPct,
            xirrPct: xirrPct,
            // See the MF builder: merging across portfolios recomputes XIRR from
            // the combined flows rather than averaging per-portfolio rates.
            _xirrFlows: xirrFlows
          });
        });

          // Compute header stats (feeding _ov.se*) from the Overview-portfolio
          // open positions, so the Overview cards honour the Overview selector
          // while the tab itself shows all portfolios.
          var totalCurrentINR = 0, totalInvestedINR = 0, totalDayChangeINR = 0, totalPnlINR = 0;
          // Debt ETFs are Fixed Income, so they are totalled separately and
          // reported under that class instead of Stocks/ETF. Same loop and the
          // same price fallbacks, so what one total loses the other gains and net
          // worth is unchanged.
          var dbtCurrentINR = 0, dbtInvestedINR = 0, dbtDayChangeINR = 0, dbtPnlINR = 0;
          var _seDbtMap = buildInstrumentTopCategoryMap();
          ovOpenHoldings.forEach(function (h) {
            var _isDbt = normalizeText(_seDbtMap[normalizeText(h.instrument || "")] || "") === "fixed income";
            var priceEntry = allPrices[h.ticker] || null;
            var eodRaw = priceEntry ? priceEntry.price : null;
            var prevRaw = priceEntry ? priceEntry.prev_close : null;
            // Invested (cost basis) is price-independent — always count it, even for
            // a freshly-added instrument whose live price hasn't been fetched yet.
            // Only current value / P&L / day-change require a price.
            if (_isDbt) dbtInvestedINR += h.investedINR; else totalInvestedINR += h.investedINR;
            if (eodRaw === null) {
              // No live price yet: value the holding at cost so the Overview
              // Current reconciles with the split cards (which use the same cost
              // fallback via computeStocksEtfCurrentINR). Day change stays 0.
              if (_isDbt) dbtCurrentINR += h.investedINR; else totalCurrentINR += h.investedINR;
              return;
            }
            var ltpINR = h.region === "US" ? eodRaw * usdInrToday : eodRaw;
            var cur = h.units * ltpINR;
            var dayC = 0;
            if (prevRaw !== null) {
              var prevINR = h.region === "US" ? prevRaw * usdInrToday : prevRaw;
              dayC = (ltpINR - prevINR) * h.units;
            }
            if (_isDbt) {
              dbtCurrentINR += cur;
              dbtPnlINR += cur - h.investedINR;
              dbtDayChangeINR += dayC;
            } else {
              totalCurrentINR += cur;
              totalPnlINR += cur - h.investedINR;
              totalDayChangeINR += dayC;
            }
          });
          _ovApply("debtSe", {
            invested: dbtInvestedINR,
            current: dbtCurrentINR,
            unrealized: dbtPnlINR,
            dayChange: dbtDayChangeINR
          }, "renderStockEtfHoldingsTable:debt", ovPortfolio);

          var indiaRowsData = rowsData.filter(function(r) { return r.region !== "US"; });
          var usRowsData = rowsData.filter(function(r) { return r.region === "US"; });

          if (indiaHoldings.length) {
            renderSeHoldingsRows(indiaTbody, indiaRowsData);
            attachSeHoldingsSortHandlers(indiaTbody, indiaRowsData);
            indiaStatusEl.textContent = "";
            if (indiaTableWrap) indiaTableWrap.hidden = true;
          } else {
            indiaStatusEl.textContent = "No India holdings found.";
            if (indiaTableWrap) indiaTableWrap.hidden = true;
          }

          if (usHoldings.length) {
            renderSeHoldingsRows(usTbody, usRowsData);
            attachSeHoldingsSortHandlers(usTbody, usRowsData);
            usStatusEl.textContent = "";
            if (usTableWrap) usTableWrap.hidden = true;
          } else {
            usStatusEl.textContent = "No US holdings found.";
            if (usTableWrap) usTableWrap.hidden = true;
          }
          try {
            _buildPerPortfolioSeRowsData(rows, mappingTable, allPrices, usdInrHistMap, usdInrToday)
              .then(function (perPortRows) {
                var expanded = perPortRows && perPortRows.length ? perPortRows : rowsData;
                renderStocksEtfRedesign(expanded, usdInrToday);
              })
              .catch(function (err) { console.error("per-portfolio SE build failed:", err); renderStocksEtfRedesign(rowsData, usdInrToday); });
          } catch (e) { console.error("Se redesign failed:", e); }

          // Feed live totals back into overview accumulator and refresh dashboard
          // Use FIFO-adjusted invested (remaining lots only), not all-time buy total
          _ovApply("se", {
            invested: totalInvestedINR,
            current: totalCurrentINR,
            unrealized: totalPnlINR,
            dayChange: totalDayChangeINR
          }, "renderStockEtfHoldingsTable", ovPortfolio);
          // Tag with the OVERVIEW portfolio these totals were computed for
          // (ovOpenHoldings scope) — NOT the tab's hardcoded "all". Tagging "all"
          // while a portfolio is selected made updateDashboardStats' stale guard
          // zero out correct SE totals on the next stats refresh.
          _ovFlows.seComputedPortfolio = ovPortfolio;
          var seInvestedEl = document.getElementById("stocksetf-total-investment");
          if (seInvestedEl) seInvestedEl.textContent = formatCurrency(totalInvestedINR);
          renderOverview();
          // Fold the Stocks/ETF day change into the Overview total. No ordering
          // guard: updateOverviewDayChange sums whatever components are ready.
          updateOverviewDayChange();

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

          // Portfolio-level XIRR — every stocks/ETF row in the Overview portfolio,
          // INR-converted. Honours the Overview selector, consistent with the totals
          // above.
          //
          // It used to walk the OPEN holdings, which silently dropped every position
          // that had been fully sold — all of its buys and all of its proceeds. A
          // stock bought and exited was simply not part of the portfolio's return,
          // nor of the benchmark, which replays these same flows. Measured on a
          // fixture: ₹1,000 into a fund that doubled and ₹10,000 into a stock that
          // halved, both closed, reported +301.91% — the fund on its own — where the
          // money actually earned −59.63%. Mutual funds never had this filter, so
          // the two asset classes did not even agree on what the number meant.
          var seXirrFlows = buildSeInrFlows(rows, ovPortfolio, mappingTable, usdInrHistMap, usdInrToday);
          // INR-converted SE cash flows WITHOUT terminal — reused by the benchmark
          // comparison and period XIRR so those paths stop using unconverted USD.
          _ovFlows.seFlowsINR = seXirrFlows.slice();
          // Store flows WITH terminal so the overview XIRR has a positive terminal to converge on.
          var seXirrFlowsWithTerminal = seXirrFlows.slice();
          if (totalCurrentINR > UNITS_EPSILON) seXirrFlowsWithTerminal.push({ date: new Date(), amount: totalCurrentINR });
          _ovFlows.seXirrFlows = seXirrFlowsWithTerminal;
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
          // _ovFlows.overviewBaseFlows is set by updateTotalCurrentValue (equity+FI+commodity flows).
          // If it's already been computed, we can recompute overview XIRR without re-fetching.
          if (_ovFlows.overviewBaseFlows) {
            var overviewXirrEl = document.getElementById("overview-xirr");
            if (overviewXirrEl) {
              setXirr(overviewXirrEl, calculateXIRR(_ovFlows.overviewBaseFlows.concat(_ovFlows.seXirrFlows)));
            }
          }
          // Stocks/ETF flows arrive on a separate async path than the overview's
          // wf-overview-flows-ready. Notify the benchmark card so its portfolio
          // XIRR/alpha re-runs once with the SE leg included — otherwise it stays
          // computed over MF+FI+commodity only when it ran before SE resolved.
          document.dispatchEvent(new CustomEvent("wf-se-xirr-ready"));
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

  // ===== Net-worth snapshots (Phase 1: record + backfill) ====================
  //
  // Writes one row per local calendar date recording what the portfolio was
  // actually worth. The Account Value chart is a derivation — it is recomputed
  // from the sheets on every load, so correcting a 2019 transaction silently
  // rewrites 2019. A snapshot is a record, and must not move.
  //
  // Which makes refusing to write the important half. The dashboard resolves
  // progressively (mutual funds, then stocks, then gold), so for the first few
  // seconds of every load the total on screen is a partial one; storing it would
  // bake a permanent false dip into history. The rules live in wf-snapshots.js
  // (pure, unit-tested); everything here is plumbing to feed them.
  var _snapAccountValuePoints = null;   // set by the Account Value render, "all" only
  var _snapDone = false;                // at most one write attempt per load
  var SNAP_TABLE = "net_worth_snapshots";
  var SNAP_LAST_KEY = "wf-snapshot-last";

  function _snapReady() {
    return typeof window.WfSnapshots !== "undefined" &&
           window.WfDb && typeof WfDb.upsert === "function" &&
           window.WfAuth && WfAuth.isLoggedIn();
  }

  // Everything evaluateWrite needs, read at one instant.
  function _snapContext(breakdown, byPortfolio) {
    var fdRows = getSheetRows("fd");
    return {
      total: getOverviewCurrentTotal(),
      invested: getOverviewInvestedTotal(),
      breakdown: breakdown,
      byPortfolio: byPortfolio,
      portfolioFilter: localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all",
      fiExcluded: isFixedIncomeExcluded(),
      savingsExcluded: isSavingsInvestmentExcluded(),
      goldStale: !!(_goldRateMeta && _goldRateMeta.stale),
      hasCommodity: !!(fdRows && _hasCommodityRows(fdRows, "all")),
      dateKey: WfSnapshots.localDateKey(),
      marketSource: _marketSource
    };
  }

  // Already recorded today, at the same value? Then this load has nothing to add.
  // Cheap, and it keeps three open tabs from writing the same row three times.
  function _snapAlreadyWritten(dateKey, total) {
    try {
      var last = JSON.parse(localStorage.getItem(SNAP_LAST_KEY) || "null");
      return !!(last && last.date === dateKey && WfSnapshots.isStable(last.total, total));
    } catch (e) { return false; }
  }

  function _snapRecordWritten(row) {
    try {
      localStorage.setItem(SNAP_LAST_KEY, JSON.stringify({ date: row.snapshot_date, total: row.total }));
    } catch (e) {}
  }

  function _snapByPortfolio() {
    var names = collectPortfolioNamesFromSheets(["equity", "stocksetf", "fd", "fixedincome"]);
    if (!names.length) return Promise.resolve(null);
    return Promise.all(names.map(function (n) {
      return computePortfolioCurrentBreakdown(n)
        .then(function (b) { return { name: n, b: b }; })
        .catch(function () { return null; });
    })).then(function (res) {
      var out = {};
      res.forEach(function (r) {
        if (!r || !r.b) return;
        out[r.name] = {
          equity: Math.round(r.b.equity || 0),
          fixed_income: Math.round(r.b.fixedIncome || 0),
          commodity: Math.round(r.b.commodity || 0)
        };
      });
      return Object.keys(out).length ? out : null;
    }).catch(function () { return null; });
  }

  // Month ends the Account Value line can reconstruct, for the dates that have
  // no row yet. Flagged as reconstructions in wf-snapshots.planBackfill — a
  // backfilled point came from the very derivation this table exists to escape.
  // Runs on EVERY load, filling whichever completed months have no row — not
  // once, ever. That distinction is the fix for gaps: leave the dashboard shut
  // for three months and the old one-shot backfill (latched after its first
  // run) left a permanent three-month hole, so the next comparison spanned the
  // whole absence and read "over 3 months" instead of three monthly rows.
  // Reopening now reconstructs the months you missed.
  //
  // Cheap to repeat: months already stored are filtered out, so a load with
  // nothing missing writes nothing, and a reconstruction written once is never
  // rewritten — it stops moving the moment it is stored, like any other row.
  //
  // Called from both the write path and the Account Value render, whichever
  // finishes first, latched per load so the pair can't both write.
  var _snapBackfillTimer = null, _snapBackfillStarted = false;
  function _snapBackfillSoon() {
    if (_snapBackfillStarted) return;
    if (_snapBackfillTimer) clearTimeout(_snapBackfillTimer);
    _snapBackfillTimer = setTimeout(function () {
      _snapBackfill().then(function (n) { if (n) renderNetWorthMonthly(); });
    }, 800);
  }

  function _snapBackfill() {
    // Every exit below says why. A backfill that quietly does nothing is
    // indistinguishable from one that ran and found nothing to do, and telling
    // those apart from the outside took a round trip that should not have been
    // necessary.
    if (_snapBackfillStarted) { dbg("[Snapshot] backfill: already running"); return Promise.resolve(0); }
    // No series yet is NOT a reason to give up for good — the chart may still be
    // loading. Return without latching, so whichever caller comes next retries.
    if (!_snapAccountValuePoints || !_snapAccountValuePoints.length) {
      dbg("[Snapshot] backfill: no Account Value series yet, will retry when it renders");
      return Promise.resolve(0);
    }
    // The Account Value series honours the exclusion toggles, so with fixed
    // income or savings hidden its line is a partial one — reconstructing years
    // of history off it would write a permanently understated past. The write
    // rules refuse a live snapshot for the same reason; the backfill, which
    // bypasses them, has to refuse for itself. Checked before latching, so
    // turning the toggle back off lets the backfill run.
    if (isFixedIncomeExcluded() || isSavingsInvestmentExcluded()) {
      dbg("[Snapshot] backfill: skipped, an exclusion toggle is on");
      return Promise.resolve(0);
    }
    _snapBackfillStarted = true;
    var points = _snapAccountValuePoints;
    return WfDb.select(SNAP_TABLE, "select=snapshot_date").then(function (rows) {
      var have = (rows || []).map(function (r) { return String(r.snapshot_date).slice(0, 10); });
      var plan = WfSnapshots.planBackfill(points, have, WfSnapshots.localDateKey(), 600);
      dbg("[Snapshot] backfill: " + points.length + " chart points, " + have.length +
          " already stored, " + plan.length + " to write");
      if (!plan.length) return 0;
      return WfDb.upsert(SNAP_TABLE, plan, "user_id,snapshot_date").then(function () {
        dbg("[Snapshot] backfilled " + plan.length + " month ends");
        return plan.length;
      });
    }).catch(function (e) { dbg("[Snapshot] backfill skipped:", e && e.message); return 0; });
  }

  // The stability check: read the total, wait, read it again. A slice landing in
  // between moves it, and the write is abandoned for this load. Cheaper and far
  // more reliable than trying to enumerate every async path that feeds the total.
  function _snapRun() {
    if (_snapDone || !_snapReady()) return;
    _snapDone = true;
    var first = getOverviewCurrentTotal();
    var dateKey = WfSnapshots.localDateKey();
    if (!(first > 0)) return;
    if (_snapAlreadyWritten(dateKey, first)) { _snapBackfill(); return; }

    setTimeout(function () {
      Promise.all([computePortfolioCurrentBreakdown("all").catch(function () { return null; }),
                   _snapByPortfolio()])
        .then(function (parts) {
          var ctx = _snapContext(parts[0], parts[1]);
          ctx.totalAgain = first;
          var decision = WfSnapshots.evaluateWrite(ctx);
          if (!decision.write) {
            dbg("[Snapshot] not recorded: " + decision.reasons.join(", "));
            return null;
          }
          return WfDb.upsert(SNAP_TABLE, decision.row, "user_id,snapshot_date").then(function () {
            _snapRecordWritten(decision.row);
            dbg("[Snapshot] recorded " + decision.row.snapshot_date + " = " + decision.row.total);
          });
        })
        .then(function () { return _snapBackfill(); })
        // Re-read after writing, so today's row and the backfill appear on the
        // load that created them rather than only on the next one.
        .then(function () { renderNetWorthMonthly(); })
        .catch(function (e) { dbg("[Snapshot] write failed:", e && e.message); });
    }, 1500);
  }

  // ===== Net Worth · Monthly (Phase 2: reading the snapshots back) ==========
  //
  // The card the snapshot table exists for. Two things it can show that nothing
  // else on the dashboard can:
  //
  //   1. A past month's net worth that does not move when an old transaction is
  //      corrected — because it is read, not recomputed.
  //   2. The month's change split into what you put in and what the market did.
  //      Δ = contributions + market, so market is the remainder; the
  //      contributions half comes from the same monthly aggregation the Cash
  //      Flow card uses.
  //
  // Rows built from a reconstruction are labelled and greyed. A backfilled month
  // came from replaying today's sheets, so it carries none of (1)'s guarantee,
  // and a card that drew them identically would be claiming more than it knows.
  var NWM_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var _nwmExpanded = {};

  function _nwmMonthLabel(m) {
    var p = String(m).split("-");
    return NWM_MONTHS[(+p[1] || 1) - 1] + " " + p[0];
  }

  // Net contributions per month, household-wide: money in minus money out, from
  // the same builder the Cash Flow card uses. Passed "all" explicitly — the
  // snapshots are whole net worth, so attributing their change with one
  // portfolio's flows would blame the market for the other portfolio's investing.
  function _nwmContributionsByMonth() {
    var out = {};
    try {
      var d = buildMonthlyInvestCatData("all");
      if (!d) return out;
      Object.keys(d.byMonthGrp || {}).forEach(function (m) {
        var s = 0, g = d.byMonthGrp[m];
        Object.keys(g).forEach(function (k) { s += g[k] || 0; });
        out[m] = (out[m] || 0) + s;
      });
      Object.keys(d.byMonthGrpOut || {}).forEach(function (m) {
        var s = 0, g = d.byMonthGrpOut[m];
        Object.keys(g).forEach(function (k) { s += g[k] || 0; });
        out[m] = (out[m] || 0) - s;
      });
    } catch (e) {}

    // Savings Account / Investment Corpus rows are running balances, not
    // transactions, so they are absent from the aggregation above — while being
    // fully present in net worth. Without them, moving salary into a savings
    // account showed up as the market handing you money, every month.
    // buildMonthlyIdleCashData already forward-fills the balance held at each
    // month end; the flow is its month-over-month change.
    try {
      var idle = buildMonthlyIdleCashData("all");
      var totals = {};
      Object.keys((idle && idle.byMonthInstr) || {}).forEach(function (m) {
        var s = 0, g = idle.byMonthInstr[m];
        Object.keys(g).forEach(function (k) { s += g[k] || 0; });
        totals[m] = s;
      });
      var parked = WfSnapshots.parkedCashFlows(totals);
      Object.keys(parked).forEach(function (m) { out[m] = (out[m] || 0) + parked[m]; });
    } catch (e) {}
    return out;
  }

  function _nwmSigned(n) {
    return (n > 0 ? "+" : n < 0 ? "−" : "") + formatCurrency(Math.abs(n));
  }

  function _nwmRowHtml(r, idx) {
    var cls = r.delta == null ? "nwm-flat" : r.delta > 0 ? "nwm-up" : r.delta < 0 ? "nwm-down" : "nwm-flat";
    var open = !!_nwmExpanded[r.month];
    var h = '<div class="nwm-row' + (r.estimated || r.backfilled ? " is-estimated" : "") + '">';
    h += '<button type="button" class="nwm-row-head" data-nwm-month="' + escapeHtml(r.month) + '"' +
         ' aria-expanded="' + (open ? "true" : "false") + '">';
    h += '<span class="nwm-month">' + _nwmMonthLabel(r.month) +
         (r.backfilled ? '<span class="nwm-tag" title="Reconstructed from your transactions, not recorded on the day">est</span>' : "") +
         '</span>';
    h += '<span class="nwm-total"' + _crTitle(r.total) + '>' + formatCurrency(r.total) + '</span>';
    h += '<span class="nwm-delta ' + cls + '">' + (r.delta == null ? "—" : _nwmSigned(r.delta)) + '</span>';
    h += '</button>';

    if (r.delta != null) {
      h += '<div class="nwm-attr">';
      h += '<span>invested <b>' + _nwmSigned(r.contributions) + '</b></span>';
      h += '<span>market <b>' + _nwmSigned(r.market) + '</b></span>';
      if (r.gapMonths > 1) h += '<span>over ' + r.gapMonths + ' months</span>';
      if (r.estimated) h += '<span>from a reconstructed month</span>';
      h += '</div>';
    }

    if (open) {
      h += '<div class="nwm-detail">';
      var any = false;
      [["Equity", r.equity], ["Fixed Income", r.fixed_income], ["Commodity", r.commodity]]
        .forEach(function (p) {
          if (p[1] == null) return;
          any = true;
          h += '<span>' + p[0] + ' <b>' + formatCurrency(p[1]) + '</b></span>';
        });
      if (r.by_portfolio) {
        Object.keys(r.by_portfolio).forEach(function (name) {
          var v = r.by_portfolio[name];
          if (!v) return;
          var t = (v.equity || 0) + (v.fixed_income || 0) + (v.commodity || 0);
          any = true;
          h += '<span>' + escapeHtml(name) + ' <b>' + formatCurrency(t) + '</b></span>';
        });
      }
      // Backfilled rows have no split at all — say so rather than showing an
      // empty strip that reads as "nothing was held".
      if (!any) h += '<span>No category split — this month was reconstructed from the value history.</span>';
      h += '<span>as of ' + escapeHtml(r.date) + '</span>';
      h += '</div>';
    }
    return h + '</div>';
  }

  // The change, drawn. One bar per month, stacked into the two things that move
  // net worth: money you added and what the market did with it.
  //
  // Not a net-worth line — that is the Account Value chart, and since almost
  // every snapshot was reconstructed from that same series a second line would
  // be a monthly-sampled copy of it. The split is what only this data can show.
  //
  // Both parts can be negative (a withdrawal, a losing month) and stack away
  // from the axis in that direction, so the bar's extent is the month's total
  // change and its sign is visible at a glance.
  var NWM_INV = "#3B82F6", NWM_UP = "#10B981", NWM_DOWN = "#E8623A";
  var NWM_MAX_BARS = 24;
  var _nwmChart = null, _nwmChartSig = null;

  function _nwmFade(hex, on) {
    if (!on) return hex;
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + ",0.35)";
  }

  function _nwmDrawChart(rows) {
    var wrap = document.getElementById("nwm-chart-wrap");
    var legend = document.getElementById("nwm-chart-legend");
    var canvas = document.getElementById("nwm-chart");
    if (!wrap || !canvas) return;
    if (_nwmChart) { try { _nwmChart.destroy(); } catch (e) {} _nwmChart = window.__wfNwmChart = null; }

    // Oldest first for the x axis, and only months that HAVE a change — the
    // first snapshot has nothing to compare against, so it has no bar.
    var bars = rows.filter(function (r) { return r.delta != null; }).slice(0, NWM_MAX_BARS).reverse();
    if (typeof window.Chart !== "function" || bars.length < 1) {
      wrap.hidden = true;
      if (legend) legend.hidden = true;
      return;
    }
    wrap.hidden = false;
    if (legend) legend.hidden = false;

    var labels = bars.map(function (r) { return _nwmMonthLabel(r.month); });
    var invested = bars.map(function (r) { return r.contributions; });
    var market = bars.map(function (r) { return r.market; });
    // A month measured from a reconstruction is faded rather than dropped:
    // hiding it would leave an unexplained hole, and drawing it solid would
    // claim it was observed.
    var invColors = bars.map(function (r) { return _nwmFade(NWM_INV, r.estimated); });
    var mktColors = bars.map(function (r) {
      return _nwmFade(r.market >= 0 ? NWM_UP : NWM_DOWN, r.estimated);
    });

    _nwmChart = window.__wfNwmChart = new Chart(canvas.getContext ? canvas.getContext("2d") : canvas, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          { label: "Invested", data: invested, backgroundColor: invColors, stack: "chg",
            borderWidth: 0, borderRadius: 2 },
          { label: "Market", data: market, backgroundColor: mktColors, stack: "chg",
            borderWidth: 0, borderRadius: 2 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: false,
        scales: {
          x: { stacked: true, grid: { display: false },
               ticks: { font: { size: 10 }, maxRotation: 0, autoSkipPadding: 12 } },
          y: { stacked: true, grid: { color: "rgba(0,0,0,0.06)" },
               ticks: { font: { size: 10 },
                        callback: function (v) { return formatCompactINR(v); } } }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (c) {
                return c.dataset.label + ": " + _nwmSigned(c.parsed.y);
              },
              // The bar's own arithmetic, spelled out: the two parts and what
              // they sum to, plus where the month closed.
              afterBody: function (items) {
                var r = bars[items[0].dataIndex];
                if (!r) return "";
                var out = ["Change: " + _nwmSigned(r.delta),
                           "Closing: " + formatCurrency(r.total)];
                if (r.gapMonths > 1) out.push("Covers " + r.gapMonths + " months");
                if (r.estimated) out.push("Measured from a reconstructed month");
                return out;
              }
            }
          }
        }
      }
    });
  }

  function _nwmRender(rows) {
    var listEl = document.getElementById("nwm-list");
    var statusEl = document.getElementById("nwm-status");
    var countEl = document.getElementById("nwm-count");
    var footEl = document.getElementById("nwm-foot");
    if (!listEl) return;

    if (!rows.length) {
      listEl.innerHTML = "";
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = "No snapshots recorded yet. Your net worth is recorded once " +
          "each day you open the dashboard; the first month-over-month comparison appears " +
          "once there are two months of them.";
      }
      if (countEl) countEl.textContent = "";
      if (footEl) footEl.hidden = true;
      _nwmDrawChart([]);
      return;
    }
    if (statusEl) statusEl.hidden = true;
    // Only when the data actually changed. _nwmRender also runs on every
    // expand/collapse, and rebuilding the chart for a row toggle would throw
    // away and recreate it on each click.
    var sig = rows.map(function (r) { return r.month + ":" + r.delta + ":" + r.market; }).join("|");
    if (sig !== _nwmChartSig) { _nwmChartSig = sig; _nwmDrawChart(rows); }
    listEl.innerHTML = rows.map(_nwmRowHtml).join("");
    var recorded = rows.filter(function (r) { return !r.backfilled; }).length;
    if (countEl) {
      countEl.textContent = rows.length + " month" + (rows.length === 1 ? "" : "s") +
        (recorded < rows.length ? " · " + recorded + " recorded" : "");
    }
    if (footEl) {
      var est = rows.length - recorded;
      footEl.hidden = false;
      footEl.textContent = est
        ? est + " earlier month" + (est === 1 ? " was" : "s were") + " reconstructed from your " +
          "transaction history (marked “est”) — unlike recorded months, those can still change " +
          "if you edit an old transaction."
        : "Recorded month ends. These do not change when you edit an old transaction.";
    }
    listEl.querySelectorAll(".nwm-row-head").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var m = btn.getAttribute("data-nwm-month");
        _nwmExpanded[m] = !_nwmExpanded[m];
        _nwmRender(rows);
      });
    });
  }

  function renderNetWorthMonthly() {
    var card = document.getElementById("net-worth-monthly-card");
    if (!card) return;
    var statusEl = document.getElementById("nwm-status");
    if (!(window.WfAuth && WfAuth.isLoggedIn()) || !window.WfDb || !window.WfSnapshots) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    WfDb.select(SNAP_TABLE, "select=*&order=snapshot_date.asc")
      .then(function (rows) {
        _nwmRender(WfSnapshots.buildMonthlyChange(rows || [], _nwmContributionsByMonth()));
      })
      .catch(function (e) {
        // A missing table is the expected state until the migration is run, and
        // is worth saying plainly rather than leaving the card on "Loading…".
        if (statusEl) {
          statusEl.hidden = false;
          statusEl.textContent = /404|does not exist|relation/i.test(String(e && e.message))
            ? "Snapshot table not set up yet — run supabase-migration-snapshots.sql in the Supabase SQL editor."
            : "Couldn't load snapshots: " + (e && e.message ? e.message : e);
        }
        dbg("[Snapshot] read failed:", e && e.message);
      });
  }

  // Debounced off the load-completion events, rather than waiting for a fixed
  // set of them: wf-se-xirr-ready never fires for a portfolio holding no stocks,
  // so requiring both would silently never record anything for such a user.
  // Each event pushes the attempt out, so the run happens after the last slice
  // settles; the stability check then catches anything still in flight.
  var _snapTimer = null;
  function _snapSchedule() {
    if (_snapDone) return;
    if (_snapTimer) clearTimeout(_snapTimer);
    _snapTimer = setTimeout(_snapRun, 3000);
  }
  (function _snapWire() {
    if (!document.getElementById("overview-total-current-value")) return;
    ["wf-overview-flows-ready", "wf-se-xirr-ready"].forEach(function (ev) {
      document.addEventListener(ev, _snapSchedule);
    });
    // Show what is already recorded straight away. The write happens seconds
    // later and re-renders; waiting for it would leave the card on "Loading…"
    // for the whole of a slow load, and blank forever on a load that refuses to
    // write.
    renderNetWorthMonthly();
  })();

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
      dbg("Signup requested for:", email);
    });
  }
})();

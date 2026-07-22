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
    // Portfolio & Category splits, and the Stocks/ETF _ov totals (which
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

  // Current Value of ACTIVE (not-yet-matured) Fixed Deposits only. A matured FD is
  // treated as closed: its principal + interest leave the Current Value (the interest
  // is booked as Realized Profit instead). Used both for the displayed Current Value
  // AND as the XIRR terminal — matured FDs are excluded here because their proceeds
  // are now emitted as a dated inflow at maturity by buildFdMaturedXirrCashFlows.
  function sumFdActiveCurrentValue(rows, portfolioFilter) {
    if (!rows || !rows.length) return 0;
    var holdings = buildFdHoldingsList(rows, portfolioFilter, function (normSubCategory) {
      return normSubCategory === "fixed deposit";
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
      return normSubCategory === "fixed deposit";
    });
    if (!holdings) return 0;
    var total = 0;
    holdings.forEach(function (h) { if (h.matured) total += h.current - h.invested; });
    return total;
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
      if (normalizeText(row[sI] || "") !== "fixed deposit") return;
      var matD = parseFlexibleDate(row[mI]);
      if (!(matD && matD < todayD)) return; // not matured
      var principal = parseNumber(row[aI]);
      var rate = parsePercentRate(row[rI]);
      var q = countElapsedQuarters(parseFlexibleDate(row[dI]), matD);
      var matVal = (q > 0 && rate) ? principal * Math.pow(1 + rate / 4, q) : principal;
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
      if (normalizeText(row[subCategoryIdx]) !== "fixed deposit") return;

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
        var quarters = countElapsedQuarters(date, maturity);
        var maturityValue = (quarters > 0 && rate) ? amount * Math.pow(1 + rate / 4, quarters) : amount;
        flows.push({ date: maturity, amount: maturityValue });
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
  function computeStocksEtfCurrentINR(portfolioFilter) {
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
          total += units * (isUsd ? priceEntry.price * usdToday : priceEntry.price);
        } else {
          total += costINR; // no live price yet → cost-basis fallback
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
    var commodityPromise = (!fiEx && fdRows && commDates.length)
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
    return Promise.all([
      _computeMfCurrentValueForPortfolio(portfolio).then(function (r) { return r.current; }).catch(function () { return 0; }),
      computeStocksEtfCurrentINR(portfolio).catch(function () { return 0; }),
      commodityPromise
    ]).then(function (parts) {
      var mfCur = parts[0] || 0, seCur = parts[1] || 0, commCur = parts[2] || 0;
      var fiCur = 0;
      if (!fiEx && fdRows) {
        fiCur = (sumFdCurrentValueAtPar(fdRows, portfolio) || 0)
              + (sumFdActiveCurrentValue(fdRows, portfolio) || 0)
              + (sumProvidentFundCurrentValue(fdRows, portfolio) || 0);
      }
      if (!fiEx && epfRows && epfRows.length) {
        (buildEpfFixedIncomeHoldingsList(epfRows, portfolio) || []).forEach(function (h) { fiCur += (h.current || 0); });
      }
      return { equity: mfCur + seCur, fixedIncome: fiCur, commodity: commCur };
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

  function getSheetRows(prefix) {
    var raw = localStorage.getItem("wf-" + prefix + "-data");
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
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
        var isFixedDeposit = normCategory === "fixed income" && normSubCategory === "fixed deposit";
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
  function formatCurrencyFull(amount) {
    var sign = amount < 0 ? "-" : "";
    return sign + "₹" + Math.abs(amount).toLocaleString("en-IN", { maximumFractionDigits: 0 });
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

  // Per-tab numeric values — refreshed by each tab's async computation; overview is their sum.
  var _ov = { mfInvested: 0, mfCurrent: 0, mfUnrealized: 0, mfRealized: 0,
               seInvested: 0, seCurrent: 0, seUnrealized: 0, seDayChange: 0, seRealized: 0, seXirrFlows: [], _seFlowsINR: [],
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
    // Commodity lives in the Fixed Income/Commodity sheet and follows the FI
    // toggle — gate it the same way the category cards and getOverviewCurrentTotal
    // do, so the header total == Σ category cards == the split charts' total.
    var commInvested = isFixedIncomeExcluded() ? 0 : _ov.commInvested;
    var commCurrent = isFixedIncomeExcluded() ? 0 : _ov.commCurrent;
    var commRealized = isFixedIncomeExcluded() ? 0 : _ov.commRealized;
    // Use seCurrent if prices have loaded; fall back to seInvested so overview is never blank
    var seCurrent = _ov.seCurrent > 0 ? _ov.seCurrent : _ov.seInvested;
    var totalInvested = _ov.mfInvested + _ov.seInvested + fiInvested + commInvested;
    var totalCurrent = _ov.mfCurrent + seCurrent + fiCurrent + commCurrent;
    var totalRealized = _ov.mfRealized + _ov.seRealized + fiRealized + commRealized;
    setMoneyText(overviewInvestedEl, formatCurrency(totalInvested), totalInvested);
    setMoneyText(overviewCurrentEl, formatCurrency(totalCurrent), totalCurrent);
    setUnrealizedReturn(overviewReturnEl, overviewPctEl, totalCurrent, totalInvested);
    if (overviewRealizedEl) setSignedCurrency(overviewRealizedEl, totalRealized);
    // Keep the Account Value chart's tail in lockstep with this card. _ov is
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
    setMoneyText(elMfInv, formatCurrency(mfInv), mfInv);
    setMoneyText(elMfCur, formatCurrency(mfCur), mfCur);
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
    setMoneyText(elSeInv, formatCurrency(seInv), seInv);
    setMoneyText(elSeCur, formatCurrency(seCur), seCur);
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
    _ov.mfInvested = 0; _ov.mfCurrent = 0; _ov.mfUnrealized = 0; _ov.mfRealized = 0;
    _ov.seInvested = 0; _ov.seRealized = 0; _ov._overviewBaseFlows = null;
    _ov.mfDayChange = 0; _ov.commDayChange = 0; // per-component day changes (summed in updateOverviewDayChange)
    // The live Stocks/ETF current value (seCurrent/Unrealized/DayChange/XirrFlows)
    // is populated ASYNCHRONOUSLY by renderStockEtfHoldingsTable, which
    // updateDashboardStats does NOT trigger. Zeroing them here on every call
    // (e.g. an exclusion toggle or a late data event) would drop the Overview
    // Current to the seInvested fallback until the user forces an SE re-render.
    // Only clear them when the portfolio actually changes — then
    // renderStockEtfHoldingsTable will repopulate them.
    if (_ov._seComputedPortfolio !== selected) {
      _ov.seCurrent = 0; _ov.seUnrealized = 0; _ov.seDayChange = 0; _ov.seXirrFlows = []; _ov._seFlowsINR = [];
    }
    _ov.fiInvested = 0; _ov.fiCurrent = 0; _ov.fiUnrealized = 0; _ov.fiRealized = 0;
    _ov.commInvested = 0; _ov.commCurrent = 0; _ov.commUnrealized = 0; _ov.commRealized = 0;

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

    // The sync seRealized above leaves US sells in USD. Recompute it in INR
    // (US converted at each leg's transaction-date rate) and refresh.
    computeStocksEtfRealizedINR(selected).then(function (seINR) {
      if ((localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all") !== selected) return; // portfolio changed meanwhile
      _ov.seRealized = seINR;
      if (stocksEtfRealizedEl) setSignedCurrency(stocksEtfRealizedEl, seINR);
      refreshOverviewStats(); refreshCategoryCards();
    }).catch(function () {});

    // Likewise, the sync seInvested above leaves US buys in USD. Recompute the
    // invested cost basis in INR (US converted per-leg) and refresh so the
    // top-line Invested, Return %, and Unrealized P&L are right for US holdings.
    computeStocksEtfInvestedINR(selected).then(function (seInvINR) {
      if ((localStorage.getItem(SELECTED_PORTFOLIO_KEY) || "all") !== selected) return; // portfolio changed meanwhile
      _ov.seInvested = seInvINR;
      if (stocksEtfEl) stocksEtfEl.textContent = formatCurrency(seInvINR);
      refreshOverviewStats(); refreshCategoryCards();
    }).catch(function () {});

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
    var fixedIncomeRowsPresent = getSheetRows("fixedincome");
    var connectHintEl = document.getElementById("fixedincome-connect-hint");
    if (connectHintEl) connectHintEl.hidden = !!((fdRows && fdRows.length) || (fixedIncomeRowsPresent && fixedIncomeRowsPresent.length));

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

      // Fold in the separate `fixedincome` sheet (EPF/PPF, "Amount" column). Its
      // deposits already reach _ov.fiInvested via sumEpfAmount, but its CURRENT
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

      _ov.fiCurrent = fiCurrentValue;
      _ov.fiUnrealized = fiCurrentValue - fiInvestment;
      _ov.fiRealized = fiRealized;
      _ov.commCurrent = commodityCurrent;
      _ov.commUnrealized = commodityCurrent - commodityInvested;
      _ov.commRealized = commodityRealizedProfit;
      refreshOverviewStats(); refreshCategoryCards();

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
      if (normSubCategory === "fixed deposit") {
        var rate = parsePercentRate(row[rateIdx]);
        var startDate = parseFlexibleDate(row[dateIdx]);
        var maturityDate = parseFlexibleDate(row[maturityIdx]);
        fdMatured = !!(maturityDate && maturityDate < today);
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
      if (normSubCategory === "fixed deposit" && maturityIdx !== -1 && rateIdx !== -1) {
        var rate = parsePercentRate(row[rateIdx]);
        var startDate = parseFlexibleDate(row[dateIdx]);
        var maturityDate = parseFlexibleDate(row[maturityIdx]);
        fdMatured = !!(maturityDate && maturityDate < today);
        if (startDate) {
          var asOfDate = maturityDate && maturityDate < today ? maturityDate : today;
          var elapsedQuarters = countElapsedQuarters(startDate, asOfDate);
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
    renderFiHoldingsCardList(holdings);
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
      var isNeg = pnl < 0;
      var pal = p.isCombined ? { bg: "#23211D", fg: "#fff" } : FI_AVATAR_PALETTE[i % FI_AVATAR_PALETTE.length];
      var initial = p.isCombined ? "Σ" : _fiInit(p.name);
      var subtitle = p.isCombined ? "HOUSEHOLD TOTAL" : "PERSONAL PORTFOLIO";
      var totalCur = p.fi + p.gold;
      var fiPct = totalCur > 0 ? (p.fi / totalCur) * 100 : 0;
      var goldPct = totalCur > 0 ? (p.gold / totalCur) * 100 : 0;
      var progress = Math.min(100, Math.max(4, (pnlPct + 30) * 1.4));
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
        '<div class="mfpc-bar"><div class="mfpc-bar-fill" style="width:' + progress + '%;"></div></div>' +
        '<div class="mfpc-return-row">' +
          '<span class="mfpc-return-pct ' + (isNeg ? "mfpc-negative" : "") + '">' + (isNeg ? "" : "+") + pnlPct.toFixed(2) + '%</span>' +
          '<span class="mfpc-gain ' + (isNeg ? "mfpc-negative" : "mfpc-positive") + '"' + _crTitle(pnl) + '>' + (isNeg ? "" : "+") + formatCurrency(pnl) + (isNeg ? ' loss' : ' gain') + '</span>' +
        '</div>' +
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
    var filtered = holdings.filter(function (h) {
      if (FIH_STATE.portfolio !== "all" && normalizeText(h.portfolio || "") !== normalizeText(FIH_STATE.portfolio)) return false;
      if (_fiIsGold(h.subCategory)) return false; // gold shown in commodity card
      // Open = active holdings; Closed = matured FDs (money returned, interest realized).
      if (!!h.matured !== !!FIH_STATE.showClosed) return false;
      return true;
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
    var footer = '<div class="mfh-row" style="grid-template-columns: minmax(180px, 2fr) 1fr 1fr 1fr 1fr 0.9fr;background:var(--bg);font-weight:700;border-radius:8px;padding:10px 12px;">' +
      '<div style="grid-column:span 2;font-size:0.55rem;letter-spacing:0.11em;text-transform:uppercase;color:var(--muted);">SUB-TOTAL · ' + filtered.length + ' HOLDINGS</div>' +
      '<div class="mfh-col-num mfh-num-primary">' + formatCurrency(subtotalInv) + '</div>' +
      '<div class="mfh-col-num mfh-num-primary">' + formatCurrency(subtotalCur) + '</div>' +
      '<div class="mfh-col-num" style="color:' + (subSum > 0 ? "var(--emerald)" : subSum < 0 ? "var(--negative)" : "var(--muted)") + ';">' + (subSum > 0 ? "+" : "") + formatCurrency(subSum) + '</div>' +
      '<div class="mfh-col-num" style="color:' + (subPct > 0 ? "var(--emerald)" : subPct < 0 ? "var(--negative)" : "var(--muted)") + ';">' + (subPct > 0 ? "+" : "") + subPct.toFixed(2) + '%</div>' +
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
    if (pf && !pf.dataset.bound) {
      pf.dataset.bound = "1";
      var portfolios = ["all"].concat(collectPortfolioNamesFromSheets(["fd", "fixedincome"]) || []);
      pf.innerHTML = portfolios.map(function (p) {
        var label = p === "all" ? "All" : p;
        return '<button type="button" class="mfh-portfolio-btn ' + (p === FIH_STATE.portfolio ? "active" : "") + '" data-fih-portfolio="' + p.replace(/"/g, '&quot;') + '">' + escapeHtml(label) + '</button>';
      }).join("");
      pf.querySelectorAll("[data-fih-portfolio]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          FIH_STATE.portfolio = btn.dataset.fihPortfolio;
          pf.querySelectorAll("[data-fih-portfolio]").forEach(function (b) { b.classList.toggle("active", b === btn); });
          renderAllFixedIncomeHoldingsTable();
        });
      });
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
  var STOCK_PRICES_CACHE_MAX_AGE_MS = 3 * 60 * 1000; // 3 minutes (merged: live-price cadence)
  // The bulky *_history series in stock_prices.json change once/day, so the 2.24 MB
  // file is cached far longer than the prices — the small live prices come from
  // Supabase every few minutes instead. This cuts repeated 2 MB downloads ~10x.
  var STOCK_STATIC_CACHE_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes (bulky static file)
  var _stockPricesPromise = null;
  var _stockStaticPromise = null;
  var _stockMergedCache = null; // { data, at } — in-memory merged (static + live)

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

  // The bulky static stock_prices.json (histories) — cached 30 min in localStorage
  // and deduped in-flight. This is the 2.24 MB payload; keeping it out of the
  // 3-minute refresh loop is the main performance win.
  function _getStaticStockData() {
    // Evict the old 2.24 MB merged cache key (replaced by the split static/live
    // caches) so the two don't co-exist and blow the localStorage quota.
    try { localStorage.removeItem("wf-stock-prices-json"); } catch (e) {}
    try {
      var c = JSON.parse(localStorage.getItem("wf-stock-prices-static"));
      if (c && c.fetchedAt && Date.now() - c.fetchedAt < STOCK_STATIC_CACHE_MAX_AGE_MS) return Promise.resolve(c.data);
    } catch (e) {}
    if (_stockStaticPromise) return _stockStaticPromise;
    _stockStaticPromise = fetch("stock_prices.json?t=" + Math.floor(Date.now() / STOCK_STATIC_CACHE_MAX_AGE_MS))
      .then(function (r) {
        if (!r.ok) throw new Error("stock_prices.json not found (HTTP " + r.status + ")");
        return r.json();
      })
      .then(function (data) {
        try { localStorage.setItem("wf-stock-prices-static", JSON.stringify({ data: data, fetchedAt: Date.now() })); } catch (e) {}
        _stockStaticPromise = null;
        return data;
      })
      .catch(function (err) { _stockStaticPromise = null; throw err; });
    return _stockStaticPromise;
  }

  // Returns a Promise<{ updated, prices, usd_inr_history, ... }>. The bulky static
  // histories are cached 30 min; the small live prices overlay from Supabase every
  // ~3 min (in-memory merged cache), so callers get fresh prices without re-pulling
  // the 2.24 MB file. Supabase failing falls back to the static prices.
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
  function getGoldPremiumMultiplier() {
    var raw = localStorage.getItem("wf-gold-premium-pct");
    var pct = raw == null || raw === "" ? 0 : parseFloat(raw);
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
      if (sIdx === -1 || normalizeText(row[sIdx]) !== "fixed deposit") return;
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
    var seFlowsINR = (_ov._seFlowsINR && _ov._seFlowsINR.length) ? _ov._seFlowsINR
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
    var commodityIndexFlows = (_ov._commodityXirrFlows || []).filter(function (f) { return !f._terminal; });
    if (commodityIndexFlows.length) allFlowsForIndex = allFlowsForIndex.concat(commodityIndexFlows.filter(afterCutoff));

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
        var periodCurrentVal = _ov.mfCurrent + result.seCurrentIncluded;
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
      var stockPricesPromise = fetchAllStockPrices().catch(function () { return {}; });

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
            var price = hist ? lastPriceOnOrBefore(hist.prices, dateStr) : null;
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

        var equityRows = getSheetRows("equity");
        var extFlows = [];
        instruments.forEach(function (name) {
          extFlows = extFlows.concat(buildXirrCashFlows(equityRows, selected, name));
        });
        if (seRows) {
          Object.keys(seUnitEventsByTicker).forEach(function (ticker) {
            var entry = seUnitEventsByTicker[ticker];
            if (!stockHistory[ticker]) return;
            // US flows are in USD — convert each to INR at the flow's transaction-date
            // FX so they match the INR portfolio values (fixes CAGR/Growth-of-₹100).
            var isUsd = entry.region === "US" || (stockHistory[ticker] && stockHistory[ticker].currency === "USD");
            buildXirrCashFlows(seRows, selected, entry.instrument).forEach(function (f) {
              if (isUsd) {
                var rate = usdInrHistMap[formatDateISO(f.date)] || usdInrToday;
                extFlows.push({ date: f.date, amount: f.amount * rate });
              } else {
                extFlows.push(f);
              }
            });
          });
        }
        extFlows.sort(function (a, b) { return a.date - b.date; });

        var navSeries = [{ date: portfolioValues[0].date, nav: 100 }];
        for (var m = 1; m < portfolioValues.length; m++) {
          var prevPt = portfolioValues[m - 1], curPt = portfolioValues[m];
          var netFlow = 0;
          for (var q = 0; q < extFlows.length; q++) {
            var ef = extFlows[q];
            if (ef.date <= prevPt.date) continue;
            if (ef.date > curPt.date) break;
            netFlow += -ef.amount;
          }
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
    // wf-overview-flows-ready (fired once _ov._overviewBaseFlows is populated)
    // before re-running the benchmark so it has a valid terminal value.
    var _pendingBenchmarkRefresh = false;
    var _benchmarkInitialRefreshDone = false;
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
        soldGrams: isSold ? grams : 0,
        soldInvested: (isSold && buyPrice && grams > 0) ? grams * buyPrice : 0,
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

    var selectedPortfolio = "all";
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
      statusEl.textContent = "";
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
    if (cmhPf && !cmhPf.dataset.bound) {
      cmhPf.dataset.bound = "1";
      var ports = ["all"].concat(collectPortfolioNamesFromSheets(["fd"]) || []);
      cmhPf.innerHTML = ports.map(function (p) {
        var label = p === "all" ? "All" : p;
        return '<button type="button" class="mfh-portfolio-btn ' + (p === COMH_STATE.portfolio ? "active" : "") + '" data-cmh-portfolio="' + p.replace(/"/g, "&quot;") + '">' + escapeHtml(label) + '</button>';
      }).join("");
      cmhPf.querySelectorAll("[data-cmh-portfolio]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          COMH_STATE.portfolio = btn.dataset.cmhPortfolio;
          cmhPf.querySelectorAll("[data-cmh-portfolio]").forEach(function (b) { b.classList.toggle("active", b === btn); });
          renderCommodityHoldingsTable();
        });
      });
    }

    var freshness = goldRateFreshnessText();
    var asofText = rateDate
      ? "Gold rate as of " + rateDate + " · ₹" + Math.round(goldPrice).toLocaleString("en-IN") + "/g" + (freshness ? " · " + freshness : "")
      : "";
    if (asof) { asof.textContent = asofText; asof.style.color = _goldRateMeta.stale ? "#B45309" : ""; }
    if (goldTop) { goldTop.innerHTML = asofText ? "&#128337; " + asofText : ""; goldTop.style.color = _goldRateMeta.stale ? "#B45309" : ""; }

    var holdings = (allHoldings || []).filter(function (h) {
      if (COMH_STATE.portfolio !== "all" && normalizeText(h.portfolio || "") !== normalizeText(COMH_STATE.portfolio)) return false;
      return !!h.isSold === !!COMH_STATE.showClosed;
    });
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
    var footer = '<div class="mfh-row" style="grid-template-columns: minmax(180px, 1.8fr) 0.9fr 0.8fr 0.8fr 0.9fr 0.9fr 0.9fr 0.8fr;background:var(--bg);font-weight:700;border-radius:8px;padding:10px 12px;margin-top:6px;">' +
      '<div style="grid-column:span 4;font-size:0.55rem;letter-spacing:0.11em;text-transform:uppercase;color:var(--muted);">SUB-TOTAL · ' + holdings.length + ' HOLDINGS</div>' +
      '<div class="mfh-col-num mfh-num-primary">' + formatCurrency(_subInv) + '</div>' +
      '<div class="mfh-col-num mfh-num-primary">' + formatCurrency(_subCur) + '</div>' +
      '<div class="mfh-col-num mfh-num-day ' + (Math.abs(_subDay) < 0.01 ? "mfh-muted" : (_subDay >= 0 ? "mfh-positive" : "mfh-negative")) + '">' + (Math.abs(_subDay) < 0.01 ? "—" : ((_subDay >= 0 ? "+" : "") + formatCurrency(_subDay))) + '</div>' +
      '<div class="mfh-col-num ' + (_subPct > 0 ? "mfh-positive" : _subPct < 0 ? "mfh-negative" : "mfh-muted") + '">' + (_subPct > 0 ? "+" : "") + _subPct.toFixed(2) + '%</div>' +
      '</div>';
    list.innerHTML = header + body + footer;
    try { applyHoldingsFold("cmh-list"); } catch (e) {}
  }

  // ── Stocks/ETF tab redesign ────────────────────────────────────────────
  // State is now per-region so India and US holdings tables filter/sort/toggle
  // independently of each other.
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
            xirrPct: null,
            isClosed: isClosed,
            _portfolio: p
          };
        });
      });
    })).then(function (perPortfolioArrays) {
      var flat = [];
      perPortfolioArrays.forEach(function (arr) { arr.forEach(function (r) { flat.push(r); }); });
      return flat;
    });
  }

  function renderStocksEtfRedesign(rowsData, usdInrToday) {
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

  function _wireSeHoldingsPortfolioToggle(rowsData, usdInrToday) {
    var seRows = getSheetRows("stocksetf");
    if (!seRows) return;
    var portfolios = ["all"].concat(collectPortfolioNamesFromSheets(["stocksetf"]) || []);
    // Each region's toggle updates only its own state and re-renders only its list.
    [
      { id: "seh-portfolio-toggle", region: "india" },
      { id: "seh-us-portfolio-toggle", region: "us" }
    ].forEach(function (spec) {
      var el = document.getElementById(spec.id);
      if (!el) return;
      var currentPortfolio = SEH_STATE.portfolio[spec.region] || "all";
      el.innerHTML = portfolios.map(function (p) {
        var label = p === "all" ? "All" : p;
        return '<button type="button" class="mfh-portfolio-btn ' + (p === currentPortfolio ? "active" : "") + '" data-seh-portfolio="' + p.replace(/"/g, '&quot;') + '">' + escapeHtml(label) + '</button>';
      }).join("");
      el.querySelectorAll("[data-seh-portfolio]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          SEH_STATE.portfolio[spec.region] = btn.dataset.sehPortfolio;
          el.querySelectorAll("[data-seh-portfolio]").forEach(function (b) { b.classList.toggle("active", b === btn); });
          renderSeHoldingsCardList(rowsData, spec.region, usdInrToday);
        });
      });
    });
  }

  function renderSePortfolioCards(rowsData) {
    var row = document.getElementById("sepc-row");
    if (!row) return;
    var rows = getSheetRows("stocksetf");
    if (!rows) { row.innerHTML = ""; return; }
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
    var byPort = {};
    (collectPortfolioNamesFromSheets(["stocksetf"]) || []).forEach(function (p) {
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
    var combined = { invested: 0, current: 0, india: 0, us: 0, day: 0 };
    names.forEach(function (n) { combined.invested += byPort[n].invested; combined.current += byPort[n].current; combined.india += byPort[n].india; combined.us += byPort[n].us; combined.day += byPort[n].day; });
    var namedList = names.map(function (n) { var p = byPort[n]; p.name = n; return p; });
    var all = [{ name: "Combined", invested: combined.invested, current: combined.current, india: combined.india, us: combined.us, day: combined.day, isCombined: true }].concat(namedList);

    row.innerHTML = all.map(function (p, i) {
      var pnl = p.current - p.invested;
      var pnlPct = p.invested > 0 ? (pnl / p.invested) * 100 : 0;
      var isNeg = pnl < 0;
      var pal = p.isCombined ? { bg: "#23211D", fg: "#fff" } : SE_AVATAR_PALETTE[i % 3];
      var initial = p.isCombined ? "Σ" : _seInit(p.name);
      var subtitle = p.isCombined ? "HOUSEHOLD TOTAL" : "PERSONAL PORTFOLIO";
      var totalCur = p.india + p.us;
      var iPct = totalCur > 0 ? Math.round(p.india / totalCur * 100) : 0;
      var uPct = totalCur > 0 ? Math.round(p.us / totalCur * 100) : 0;
      var progress = Math.min(100, Math.max(4, (pnlPct + 30) * 1.4));
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
        var flows = buildXirrCashFlows(rows, p.isCombined ? "all" : p.name) || [];
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
        '<div class="mfpc-bar"><div class="mfpc-bar-fill" style="width:' + progress + '%;"></div></div>' +
        '<div class="mfpc-return-row">' +
          '<span class="mfpc-return-pct ' + (isNeg ? "mfpc-negative" : "") + '">' + (isNeg ? "" : "+") + pnlPct.toFixed(2) + '%</span>' +
          '<span class="mfpc-gain ' + (isNeg ? "mfpc-negative" : "mfpc-positive") + '"' + _crTitle(pnl) + '>' + (isNeg ? "" : "+") + formatCurrency(pnl) + '</span>' +
        '</div>' +
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
    rowsData.forEach(function (h) {
      var m = mapping[normalizeText(h.instrument)];
      if (!m) return;
      var cat = normalizeText(m.category || "");
      if (cat.indexOf("etf") !== -1) return;
      var seg = String((m.segment || "") + " " + (m.subCat || "") + " " + (m.category || "")).toLowerCase();
      var key = seg.indexOf("large") !== -1 ? "Large-cap"
        : seg.indexOf("mid") !== -1 ? "Mid-cap"
        : seg.indexOf("small") !== -1 ? "Small-cap" : null;
      if (key) byCap[key] += h.currentINR || 0;
    });
    var total = byCap["Large-cap"] + byCap["Mid-cap"] + byCap["Small-cap"];
    if (total <= 0) { bar.innerHTML = ""; rows.innerHTML = '<p class="muted small">No market-cap data. Expected values like "Large Cap" / "Mid Cap" / "Small Cap" in the Market Segment column of the Stocks/ETF mapping sheet.</p>'; return; }
    var COL = { "Large-cap": "#E8623A", "Mid-cap": "#D4A017", "Small-cap": "#10B981" };
    bar.innerHTML = ["Large-cap", "Mid-cap", "Small-cap"].map(function (k) {
      var pct = byCap[k] / total * 100;
      return '<span class="mfalloc-seg" style="flex:' + pct + ' 0 0;background:' + COL[k] + ';"></span>';
    }).join("");
    rows.innerHTML = ["Large-cap", "Mid-cap", "Small-cap"].map(function (k) {
      var pct = byCap[k] / total * 100;
      return '<div class="mfalloc-row">' +
        '<span class="mfalloc-name"><span class="mfalloc-dot" style="background:' + COL[k] + ';"></span>' + k + '</span>' +
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
    }
    return 0;
  }
  function renderSeHoldingsCardList(rowsData, region, usdInrToday) {
    var listId = region === "us" ? "seh-us-list" : "seh-india-list";
    var eyebrowId = region === "us" ? "seh-us-eyebrow" : "seh-india-eyebrow";
    var list = document.getElementById(listId);
    var eyebrow = document.getElementById(eyebrowId);
    if (!list) return;
    var mapping = buildStockMappingTable();
    var regionShowClosed = !!SEH_STATE.showClosed[region];
    var regionPortfolio = SEH_STATE.portfolio[region] || "all";
    var regionSort = SEH_STATE.sort[region] || "pnl-desc";
    var filtered = rowsData.filter(function (h) {
      var isUS = h.region === "US";
      if (region === "us" && !isUS) return false;
      if (region === "india" && isUS) return false;
      var isClosed = (h.units || 0) < UNITS_EPSILON || h.isClosed;
      if (regionShowClosed ? !isClosed : isClosed) return false;
      if (regionPortfolio && regionPortfolio !== "all") {
        if (normalizeText(h._portfolio || "") !== normalizeText(regionPortfolio)) return false;
      }
      return true;
    });
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
    var header = '<div class="mfh-list-header" style="grid-template-columns: minmax(200px, 2.4fr) 1fr 1fr 1fr 1fr 0.9fr;">' +
      '<span class="mfh-sortable" data-seh-sort-col="instrument">Instrument' + _sArrow("instrument") + '</span>' +
      '<span class="mfh-col-num mfh-sortable" data-seh-sort-col="invested">Invested' + _sArrow("invested") + '</span>' +
      '<span class="mfh-col-num mfh-sortable" data-seh-sort-col="current">Current' + _sArrow("current") + '</span>' +
      '<span class="mfh-col-num mfh-sortable" data-seh-sort-col="ltp">LTP' + _sArrow("ltp") + '</span>' +
      '<span class="mfh-col-num mfh-sortable" data-seh-sort-col="pnl">P&amp;L · Return' + _sArrow("pnl") + '</span>' +
      '<span class="mfh-col-num mfh-sortable" data-seh-sort-col="day">Day Chg.' + _sArrow("day") + '</span></div>';
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
      var subLine = (segment ? escapeHtml(segment) : "—") + ' · ' + (h.units || 0).toFixed(2) + ' @ ' + avgCostStr;
      return '<div class="mfh-row mfh-color-' + pal.accent + '" style="grid-template-columns: minmax(200px, 2.4fr) 1fr 1fr 1fr 1fr 0.9fr;">' +
        '<div class="mfh-inst">' +
          '<div class="mfh-avatar" style="background:' + pal.bg + ';color:' + pal.fg + ';">' + code + '</div>' +
          '<div class="mfh-inst-body">' +
            '<div class="mfh-inst-name">' + escapeHtml(h.instrument) + badges + '</div>' +
            '<div class="mfh-inst-sub">' + subLine + '</div>' +
          '</div>' +
        '</div>' +
        _seAmtCell(h.investedINR || 0, (h.investedUSD != null ? h.investedUSD : null)) +
        _seAmtCell(h.currentINR || 0, (h.currentUSD != null ? h.currentUSD : null)) +
        (h.ltpINR != null
          ? _seAmtCell(h.ltpINR, (h.ltpUSD != null ? h.ltpUSD : null))
          : '<div class="mfh-col-num mfh-num-primary">—</div>') +
        '<div class="mfh-col-num mfh-num-pnl">' +
          '<span class="mfh-num-pnl-value ' + (pnl >= 0 ? "" : "mfh-negative") + '"' + _crTitle(pnl) + '>' + (pnl >= 0 ? "+" : "") + formatCurrency(pnl) + '</span>' +
          '<span class="mfh-num-pnl-pct ' + (pnlPct >= 0 ? "" : "mfh-negative") + '">' + (pnlPct >= 0 ? "+" : "") + pnlPct.toFixed(2) + '%</span>' +
        '</div>' +
        _mfhDayCell(Math.abs(day) < 0.01 ? null : day, (h.currentINR - day) > 0 ? (day / (h.currentINR - day)) * 100 : null) +
      '</div>';
    }).join("");
    var subPnl = subCur - subInv;
    var subPct = subInv > 0 ? (subPnl / subInv) * 100 : 0;
    var subDayPct = (subCur - subDay) > 0 ? (subDay / (subCur - subDay)) * 100 : null;
    var footer = '<div class="mfh-row" style="grid-template-columns: minmax(200px, 2.4fr) 1fr 1fr 1fr 1fr 0.9fr;background:var(--bg);padding:10px 12px;border-radius:8px;font-weight:700;">' +
      '<div style="font-size:0.72rem;">' + label + ' subtotal<div style="font-size:0.55rem;letter-spacing:0.11em;text-transform:uppercase;color:var(--muted);margin-top:2px;">' + count + ' HOLDINGS' + (region === "us" ? " · INR / USD" : "") + '</div></div>' +
      _seAmtCell(subInv, (region === "us" ? subInvUSD : null)) +
      _seAmtCell(subCur, (region === "us" ? subCurUSD : null)) +
      '<div class="mfh-col-num mfh-num-primary" style="color:var(--muted);">—</div>' +
      '<div class="mfh-col-num mfh-num-pnl"><span class="mfh-num-pnl-value ' + (subPnl >= 0 ? "" : "mfh-negative") + '"' + _crTitle(subPnl) + '>' + (subPnl >= 0 ? "+" : "") + formatCurrency(subPnl) + '</span><span class="mfh-num-pnl-pct ' + (subPct >= 0 ? "" : "mfh-negative") + '">' + (subPct >= 0 ? "+" : "") + subPct.toFixed(2) + '%</span></div>' +
      _mfhDayCell(Math.abs(subDay) < 0.01 ? null : subDay, subDayPct) +
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

  // Wire Stocks/ETF controls — India and US Open toggles operate independently.
  (function wireSeControls() {
    [
      { id: "seh-open-toggle", region: "india" },
      { id: "seh-us-open-toggle", region: "us" }
    ].forEach(function (spec) {
      var btn = document.getElementById(spec.id);
      if (!btn) return;
      btn.addEventListener("click", function () {
        SEH_STATE.showClosed[spec.region] = !SEH_STATE.showClosed[spec.region];
        btn.textContent = SEH_STATE.showClosed[spec.region] ? "Closed" : "Open";
        // Sync legacy checkboxes so the outer buildStockHoldings call can
        // fetch closed positions when either region needs them. When either
        // region is Closed we must re-fetch; otherwise re-render is enough.
        var cb = document.getElementById("stocksetf-show-closed");
        var cb2 = document.getElementById("stocksetf-us-show-closed");
        if (cb) cb.checked = SEH_STATE.showClosed.india;
        if (cb2) cb2.checked = SEH_STATE.showClosed.us;
        renderStockEtfHoldingsTable();
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
  // async flow. Summing from _ov here (rather than each flow trying to add the
  // others) removes the ordering race that previously dropped the SE component
  // when _mfCommDayChange had been reset. Missing components are simply 0 until
  // their flow resolves, then this is called again.
  function updateOverviewDayChange() {
    var el = document.getElementById("overview-day-change");
    if (!el) return;
    var comm = isFixedIncomeExcluded() ? 0 : (_ov.commDayChange || 0);
    setDayChange(el, (_ov.mfDayChange || 0) + (_ov.seDayChange || 0) + comm);
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
      _ov._commodityXirrFlows = commodityFlows || [];

      var instruments = Object.keys(unitEvents).filter(function (name) { return !!lookupSchemeCode(schemeMap, name); });
      dbg("[NAV] instruments held:", Object.keys(unitEvents), "resolved scheme codes:", instruments.map(function (name) { return name + " -> " + lookupSchemeCode(schemeMap, name); }));
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
          // Gate by the FI toggle: when Fixed Income is excluded the commodity slice
          // is zeroed from every other card, so its day change must be excluded too.
          _ov.mfDayChange = 0;
          _ov.commDayChange = isFixedIncomeExcluded() ? 0 : commodityDayChange;
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
          var investment = investedCostFor(heldInstruments);
          var unrealizedProfit = total - investment;
          if (equityEl) equityEl.textContent = formatCurrency(total);
          setUnrealizedReturn(equityReturnEl, equityPctEl, total, investment);
          _ov.mfCurrent = total; _ov.mfUnrealized = unrealizedProfit;
          refreshOverviewStats(); refreshCategoryCards();
          var equityDayChange = total - yesterdayTotal;
          setDayChange(equityDayChangeEl, equityDayChange);
          _ov.mfDayChange = equityDayChange;
          updateOverviewDayChange(); // reflect MF immediately; commodity/SE fold in when they resolve
          fetchCommodityDayChange(fdRowsForOverview, selected).then(function (commodityDayChange) {
            _ov.commDayChange = isFixedIncomeExcluded() ? 0 : commodityDayChange;
            updateOverviewDayChange();
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

      // Clear locally cached NAV/ISIN data (Mutual Funds) + stock prices
      // (Stocks/ETF) so both current values re-fetch fresh.
      Object.keys(localStorage).forEach(function (key) {
        if (key.indexOf(NAV_CACHE_PREFIX) === 0) localStorage.removeItem(key);
      });
      localStorage.removeItem(AMFI_ISIN_MAP_CACHE_KEY);
      localStorage.removeItem(AMFI_NAV_MAP_CACHE_KEY);
      localStorage.removeItem("wf-stock-prices-json");

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
        Promise.all(["update-amfi-nav.yml", "update-amfi-isin-map.yml"].map(function (wf) {
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

  function pushMappingToGitHub(rows) {
    var gh = loadGhSettings();
    if (!gh.owner || !gh.repo || !gh.token) {
      showGhToast("GitHub push skipped: set owner, repo & token in Settings.", false);
      return; // not configured
    }
    var content = btoa(unescape(encodeURIComponent(JSON.stringify(rows))));
    var apiBase = "https://api.github.com/repos/" + gh.owner + "/" + gh.repo + "/contents/stocksetf_mapping.json";
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
        var body = { message: "chore: update stocksetf_mapping.json", content: content };
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
  function fetchNavHistoryBase(schemeCode) {
    var cacheKey = NAV_CACHE_PREFIX + schemeCode;
    try {
      var cached = JSON.parse(localStorage.getItem(cacheKey));
      if (cached && Date.now() - cached.fetchedAt < NAV_CACHE_MAX_AGE_MS) {
        var revived = (cached.data || []).map(function (entry) { return { date: new Date(entry.date), nav: entry.nav }; });
        return Promise.resolve(revived);
      }
    } catch (e) {}

    if (_navHistoryPromises[schemeCode]) return _navHistoryPromises[schemeCode];

    var p = fetch("https://api.mfapi.in/mf/" + schemeCode)
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
      .catch(function (err) {
        console.error("Failed to fetch NAV history for scheme " + schemeCode + ":", err);
        return [];
      })
      .then(function (data) { delete _navHistoryPromises[schemeCode]; return data; }, function (e) { delete _navHistoryPromises[schemeCode]; throw e; });

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
  var _marketSource = {};
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

  function fetchAmfiNavMap() {
    try {
      var cached = JSON.parse(localStorage.getItem(AMFI_NAV_MAP_CACHE_KEY));
      if (cached && Date.now() - cached.fetchedAt < AMFI_NAV_MAP_MAX_AGE_MS) {
        if (cached.source) _marketSource["amfi_nav"] = cached.source; // restore source for the indicator
        return Promise.resolve(cached.data);
      }
    } catch (e) {}

    return _fetchAmfiMapHybrid(AMFI_NAV_MAP_STATIC_FILE, "amfi_nav").then(function (staticData) {
      if (staticData && Object.keys(staticData).length) {
        try {
          localStorage.setItem(AMFI_NAV_MAP_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), data: staticData, source: _marketSource["amfi_nav"] || null }));
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
    return _fetchAmfiMapHybrid(AMFI_ISIN_MAP_STATIC_FILE, "amfi_isin").then(function (staticData) {
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
      var isFd = (subCategory === "fixed deposit");
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
        Object.keys(seUnitEventsByTicker).forEach(function (ticker) {
          seUnitsAtByTicker[ticker] = _ff(seUnitEventsByTicker[ticker], timeline, "cumulativeUnits");
        });

        var commodityValueAt = [];
        var points = timeline.map(function (date, i) {
          var activeGrams = commodityGramsAt[i] || 0;
          var goldPriceAtDate = goldPriceSeriesAt[i] || currentGoldPrice || 0;
          var commVal = activeGrams > 0 ? activeGrams * goldPriceAtDate : 0;
          commodityValueAt.push(commVal);
          var total = (epfAt[i] || 0) + (fdAt[i] || 0) + commVal;
          instruments.forEach(function (name) {
            var units = unitsAtByName[name][i] || 0;
            var nav = navAtByName[name][i];
            if (units > UNITS_EPSILON && nav) total += units * nav;
          });
          // Stocks/ETF: use historical price from stock_history when available, else current price.
          var dateStr = formatDateISO(date);
          var stockHistory = (stockPricesData && stockPricesData.stock_history) || {};
          Object.keys(seUnitEventsByTicker).forEach(function (ticker) {
            var units = seUnitsAtByTicker[ticker][i] || 0;
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
          // user switched portfolio meanwhile, _ov now holds the NEW portfolio's
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

        // Growth-of-₹100 value series = portfolio value with commodity (physical
        // gold/silver from the fd sheet) stripped out. Physical-gold purchases are
        // not tracked as contributions, so leaving their value in would make each
        // purchase look like instant growth. The ₹100 line is therefore a pure
        // MF + Stocks/ETF vs equity-index comparison (Fixed Income is already
        // excluded above). Commodity is still shown on the Account Value chart.
        var growthPoints = points.map(function (p, i) {
          return { x: p.x, y: p.y - (commodityValueAt[i] || 0) };
        });

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
        while (basePortIdx < growthPoints.length && !(growthPoints[basePortIdx].y > 0)) basePortIdx++;
        var normPortPoints = growthPoints.map(function () { return { x: null, y: null }; });
        var lastPortNorm = null;
        if (basePortIdx < growthPoints.length && growthPoints[basePortIdx].y > 0) {
          var units = growthPoints[basePortIdx].y / 100;
          normPortPoints[basePortIdx] = { x: growthPoints[basePortIdx].x, y: 100 };
          var prevNav = 100;
          var prevContrib = cumContribAt[basePortIdx];
          for (var i = basePortIdx + 1; i < growthPoints.length; i++) {
            var dContrib = cumContribAt[i] - prevContrib;
            if (Math.abs(dContrib) > 0.01 && prevNav > 0) {
              // Units adjust for cash flow at the prevailing NAV
              units += dContrib / prevNav;
            }
            var nav = units > 0 && growthPoints[i].y > 0 ? (growthPoints[i].y / units) : prevNav;
            normPortPoints[i] = { x: growthPoints[i].x, y: nav };
            prevNav = nav;
            prevContrib = cumContribAt[i];
          }
          lastPortNorm = prevNav;
        } else {
          normPortPoints = growthPoints.map(function (p) { return { x: p.x, y: null }; });
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
                // No fixed unit → Chart.js auto-selects the tick unit from the
                // visible range, so zooming in switches from years to months.
                time: { minUnit: "month", displayFormats: { year: "yyyy", month: "MMM yy" } },
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
                  // Clamp pan/zoom to the actually-plotted range so zooming OUT
                  // can't reveal empty space. Using lastTxnDate here let the view
                  // pan into the future because lastTxnDate is extended by
                  // fixed-income events (e.g. an FD's future maturity date).
                  x: { min: fullMinTime, max: fullMaxTime }
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
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (ctx) { return "₹" + Math.round(ctx.parsed.y).toLocaleString("en-IN"); }
              }
            },
            zoom: {
              limits: { x: { min: pvcXMin, max: pvcXMax } },
              pan: { enabled: true, mode: "x" },
              zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" }
            }
          },
          scales: {
            x: {
              type: "time",
              // Auto-select the tick unit so zooming in shows months, not just years.
              time: { minUnit: "month", displayFormats: { year: "yyyy", month: "MMM yy" } },
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
      // Double-click to reset the zoom back to the full range.
      canvas2.ondblclick = function () { if (window.__wfPortfolioValueChart) window.__wfPortfolioValueChart.resetZoom(); };
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
    try { renderExpenseCategoryPie(); } catch (e) {}
  }

  window.renderMonthlyCashFlow = renderMonthlyCashFlow;

  // ─── Expense by Category pie (with year selector + category→sub drill-down) ──
  var __epcYear = null;
  var __epcAccount = "all"; // "all" or an account_id
  var __epcMonthMode = false; // false = whole year; true = a specific month
  var __epcMonth = new Date().getMonth(); // 0-11 when in month mode
  var __epcDrillCat = null; // null = top-level categories; else a categoryId
  var __EPC_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  var __EPC_PALETTE = ["#E8623A", "#F5A623", "#4DC0B5", "#8B5CF6", "#3B82F6", "#10B981",
                       "#EC4899", "#84CC16", "#F97316", "#6366F1", "#14B8A6", "#D946EF"];
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
      yearSel.onchange = function () { __epcYear = yearSel.value; __epcDrillCat = null; renderExpenseCategoryPie(); };
    }
    if (backBtn) {
      backBtn.style.display = __epcDrillCat ? "" : "none";
      backBtn.onclick = function () { __epcDrillCat = null; renderExpenseCategoryPie(); };
    }
    if (subtitleEl) {
      subtitleEl.textContent = __epcDrillCat ? nameOf(__epcDrillCat) : "";
      subtitleEl.style.display = __epcDrillCat ? "" : "none";
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
      acctSel.onchange = function () { __epcAccount = acctSel.value; __epcDrillCat = null; renderExpenseCategoryPie(); };
    }

    // Month toggle + month dropdown: when active, view a specific month of the year.
    var monthToggle = document.getElementById("epc-month-toggle");
    var monthSel = document.getElementById("epc-month");
    if (monthSel && !monthSel.options.length) {
      monthSel.innerHTML = __EPC_MONTHS.map(function (n, i) { return '<option value="' + i + '">' + n + '</option>'; }).join("");
    }
    if (monthToggle) {
      monthToggle.classList.toggle("active", __epcMonthMode);
      monthToggle.onclick = function () { __epcMonthMode = !__epcMonthMode; __epcDrillCat = null; renderExpenseCategoryPie(); };
    }
    if (monthSel) {
      monthSel.style.display = __epcMonthMode ? "" : "none";
      monthSel.value = String(__epcMonth);
      monthSel.onchange = function () { __epcMonth = Number(monthSel.value); __epcDrillCat = null; renderExpenseCategoryPie(); };
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

    var entries = Object.keys(sums).map(function (id) {
      var label = (id.indexOf("__other_") === 0) ? "Other" : nameOf(id);
      return { id: id, label: label, value: sums[id] };
    }).filter(function (e) { return e.value > 0; })
      .sort(function (a, b) { return b.value - a.value; });

    if (!entries.length) {
      if (statusEl) statusEl.textContent = "No expenses" + (__epcDrillCat ? " in this category" : "") + " for " + periodLbl + ".";
      if (window.__epcChart) { try { window.__epcChart.destroy(); } catch (e) {} window.__epcChart = null; }
      return;
    }
    var total = entries.reduce(function (s, e) { return s + e.value; }, 0);
    if (statusEl) statusEl.textContent = (__epcDrillCat ? nameOf(__epcDrillCat) + " · " : "") + "Total " + formatCurrency(total) + " · " + periodLbl +
      (__epcDrillCat ? "" : " · tap a slice for sub-categories");

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
          if (__epcDrillCat) return; // already drilled — no further levels
          if (!els || !els.length) return;
          var id = entries[els[0].index].id;
          if (!hasSubByTop[id]) return; // no sub-categories to drill into
          __epcDrillCat = id;
          renderExpenseCategoryPie();
        }
      }
    });
    // Pointer cursor over drillable slices.
    canvas.style.cursor = __epcDrillCat ? "default" : "pointer";

    // Custom legend list showing every (sub)category with its expense + %.
    var legendEl = document.getElementById("epc-legend");
    if (legendEl) {
      legendEl.innerHTML = entries.map(function (e, i) {
        var pct = total > 0 ? (e.value / total * 100).toFixed(1) : "0";
        var drillable = !__epcDrillCat && hasSubByTop[e.id];
        return '<div class="epc-legend-item' + (drillable ? " epc-legend-drill" : "") + '"' +
          (drillable ? ' role="button" tabindex="0" data-epc-cat="' + escapeHtml(String(e.id)) + '"' : "") + '>' +
          '<span class="epc-legend-dot" style="background:' + colors[i] + '"></span>' +
          '<span class="epc-legend-name"' + _crTitle(e.value) + '>' + escapeHtml(e.label) + '</span>' +
          '<span class="epc-legend-val">' + formatCurrency(e.value) + '</span>' +
          '<span class="epc-legend-pct">' + pct + '%</span></div>';
      }).join("");
      // Clicking a drillable legend row drills in, matching a slice click.
      Array.prototype.forEach.call(legendEl.querySelectorAll("[data-epc-cat]"), function (row) {
        function drill() { __epcDrillCat = row.getAttribute("data-epc-cat"); renderExpenseCategoryPie(); }
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
    function _commodityFromEquitySources(portfolioName) {
      var total = 0;
      ["equity", "stocksetf"].forEach(function (prefix) {
        try {
          var rowsX = getSheetRows(prefix);
          if (!rowsX || !rowsX.length) return;
          var txByI = groupUnitTransactionsByInstrument(rowsX, portfolioName);
          if (!txByI) return;
          Object.keys(txByI).forEach(function (nm) {
            var isCommodity = false;
            if (prefix === "equity") {
              isCommodity = _mfCatMap_ps[normalizeText(nm)] === "commodity";
            } else {
              var m = _seMap_ps[normalizeText(nm)];
              isCommodity = !!(m && m.category && normalizeText(m.category) === "commodity");
            }
            if (!isCommodity) return;
            var remaining = fifoRemainingLots(txByI[nm]);
            remaining.forEach(function (l) { total += l.units * l.price; });
          });
        } catch (e) {}
      });
      return total;
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
        var extraComm = _commodityFromEquitySources(name);
        eq -= extraComm; // reclassify commodity MF/ETF out of Equity
        fi = fiExcluded ? 0 : computeTotalInvestment(name, ["fixedincome", "fd"]);
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
      // No reconciliation to _ov here: this card always covers ALL portfolios and
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
      // b.equity = MF + SE (both regions); isolate the MF part.
      var mfCur = Math.max(0, (b.equity || 0) - (se.India || 0) - (se.US || 0));
      var india = mfCur + (b.fixedIncome || 0) + (b.commodity || 0) + (se.India || 0);
      var us = se.US || 0;
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
      // No rescaling to _ov/getOverviewCurrentTotal — that follows the Overview's
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
  function renderInstrumentSplitChart(_retry) {
    var statusEl = document.getElementById("instrument-split-status");
    var barEl = document.getElementById("iscat-bar");
    var listEl = document.getElementById("iscat-list");
    var totalEl = document.getElementById("iscat-total-value");
    var catLabelEl = document.getElementById("iscat-total-label");
    if (!statusEl || !barEl || !listEl || !totalEl) return;

    // Category Split always covers ALL portfolios and ignores the Overview's
    // portfolio selector entirely — totals are computed per portfolio and summed,
    // never read from _ov (which reflects the SELECTED portfolio).
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
    // uses), never _ov (which follows the Overview's selected portfolio). Until the
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
      var eqBase, fiC, commPhys;
      if (_allCur) {
        eqBase = _allCur.eq;        // MF+SE current (incl. commodity-category funds)
        fiC = _allCur.fi;
        commPhys = _allCur.comm;    // physical gold current
      } else {
        // Invested placeholder: eqInvByP excludes commodity MF/ETF, so add it back
        // for the base that commEtfMfCurrentTotal is subtracted from.
        eqBase = 0; commPhys = 0; fiC = 0;
        Object.keys(eqInvByP).forEach(function (n) { eqBase += eqInvByP[n]; });
        Object.keys(commInvByP).forEach(function (n) { eqBase += commInvByP[n]; });
        Object.keys(fiInvByP).forEach(function (n) { fiC += fiInvByP[n]; });
      }
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
      if (fdRows && fdRows.length) {
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
  // from Mutual Fund + Stocks/ETF sells, bucketed by year → category → sub
  // category. US sells/costs are converted to INR at each leg's transaction-date
  // rate. Returns Promise<{ buckets, years }>, where buckets[year|"all"][cat][sub].
  function buildRealizedProfitByCategory(portfolioFilter) {
    var fdRows = getSheetRows("fd");
    var commDates = (fdRows && typeof collectCommodityUniqueDates === "function")
      ? collectCommodityUniqueDates(fdRows, portfolioFilter) : [];
    return Promise.all([
      fetchAllStockPrices().catch(function () { return {}; }),
      fdRows ? fetchGoldPriceINRPerGram().catch(function () { return null; }) : Promise.resolve(null),
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

  var __profitCatYear = "all";
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
      // Year dropdown: All time + each year (desc). Rebuild only when changed.
      var wantOpts = ["all"].concat(years.slice().reverse());
      var haveOpts = [];
      for (var oi = 0; oi < yearSel.options.length; oi++) haveOpts.push(yearSel.options[oi].value);
      if (haveOpts.join(",") !== wantOpts.join(",")) {
        yearSel.innerHTML = wantOpts.map(function (y) {
          return '<option value="' + y + '">' + (y === "all" ? "All time" : y) + '</option>';
        }).join("");
      }
      if (wantOpts.indexOf(__profitCatYear) === -1) __profitCatYear = "all";
      yearSel.value = __profitCatYear;
      yearSel.onchange = function () { __profitCatYear = yearSel.value; renderProfitByCategoryCard(); };

      if (labelEl) labelEl.textContent = __profitCatYear === "all" ? "REALIZED PROFIT · ALL TIME" : ("REALIZED PROFIT · " + __profitCatYear);

      var byCat = data.buckets[__profitCatYear] || {};
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
        if (statusEl) statusEl.textContent = "No realized profit booked" + (__profitCatYear === "all" ? " yet." : " in " + __profitCatYear + ".");
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
  var __monthlyInvestCatFilter = null; // split mode: when set, show only this instrument category
  var __monthlyInvestCatIdle = false; // on = show month-on-month parked-cash balances (Savings Account + Investment Corpus)
  var __monthlyIdleCashData; // { byMonthInstr, instruments, yearList }

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
      var portIdx   = header.indexOf("portfolio name");
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
      });
    }());

    return { byMonthCat: byMonthCat, byMonthCatOut: byMonthCatOut, yearList: Object.keys(allYears).sort() };
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
      var hasOut = totalOut > 0;
      statsEl.innerHTML =
        '<div class="mic-stat"><span class="mic-stat-label">Total Invested</span><span class="mic-stat-value">' + formatCurrency(totalInvested) + '</span></div>' +
        (hasOut ? '<div class="mic-stat"><span class="mic-stat-label">Withdrawn</span><span class="mic-stat-value negative">&minus;' + formatCurrency(totalOut) + '</span></div>' : '') +
        (hasOut ? '<div class="mic-stat"><span class="mic-stat-label">Net</span><span class="mic-stat-value ' + (totalNet >= 0 ? 'positive' : 'negative') + '">' + (totalNet >= 0 ? '+' : '−') + formatCurrency(Math.abs(totalNet)) + '</span></div>' : '');
    }

    // Custom legend
    var legendEl = document.getElementById("monthly-invest-cat-legend");
    if (legendEl) {
      if (__monthlyInvestCatSplit) {
        // Per-category colour swatch + avg/month; clicking filters to that instrument
        legendEl.innerHTML = catList.map(function (cat, i) {
          var col = MIC_SPLIT_PALETTE[i % MIC_SPLIT_PALETTE.length];
          var dimmed = __monthlyInvestCatFilter && __monthlyInvestCatFilter !== cat;
          return '<div class="mic-legend-item mic-legend-clickable' + (dimmed ? ' mic-legend-dimmed' : '') + '"' +
            ' role="button" tabindex="0" data-mic-cat="' + cat.replace(/"/g, '&quot;') + '">' +
            '<div class="mic-legend-bar" style="background:' + col + '"></div>' +
            cat + '</div>';
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
            // Show the full month summary from anywhere in the column, so the
            // user never has to hover the thin withdrawal line.
            mode: "index",
            intersect: false,
            // Collapse all datasets at this month into a single consolidated
            // block (built in `label`), so keep only the first item.
            filter: function (item) { return item.datasetIndex === 0; },
            callbacks: {
              label: function (ctx) {
                var k = monthKeys[ctx.dataIndex];
                if (!k) return "";
                var inv = investedTotal(k), out = outTotal(k);
                var lines = ["Total Invested: " + formatCurrency(inv)];
                // In "By instrument" mode, break the invested total down by
                // Instrument Sub Category.
                if (__monthlyInvestCatSplit && inv > 0) {
                  var invByCat = byMonthCat[k] || {};
                  Object.keys(invByCat)
                    .filter(function (c) { return invByCat[c] > 0; })
                    .sort(function (a, b) { return invByCat[b] - invByCat[a]; })
                    .forEach(function (c) { lines.push("   " + c + ": " + formatCurrency(invByCat[c])); });
                }
                if (out > 0) {
                  lines.push("Total Withdrawn: " + formatCurrency(out));
                  var byCat = byMonthCatOut[k] || {};
                  Object.keys(byCat)
                    .filter(function (c) { return byCat[c] > 0; })
                    .sort(function (a, b) { return byCat[b] - byCat[a]; })
                    .forEach(function (c) { lines.push("   " + c + ": " + formatCurrency(byCat[c])); });
                  lines.push("Net: " + formatCurrency(inv - out));
                }
                return lines;
              }
            }
          }
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
      function monthTotal(k) {
        var m = byMonthInstr[k];
        return m ? Object.keys(m).reduce(function (s, c) { return s + m[c]; }, 0) : 0;
      }

      if (!instruments.length) {
        if (statusEl) statusEl.textContent = "No idle-cash balances for " + (yr === "all" ? "all time" : yr) + ".";
        if (__monthlyInvestCatChart) { __monthlyInvestCatChart.destroy(); __monthlyInvestCatChart = null; }
        wrap.innerHTML = "";
        var legendElA = document.getElementById("monthly-invest-cat-legend");
        if (legendElA) legendElA.innerHTML = "";
        var statsElA = document.getElementById("monthly-invest-cat-stats");
        if (statsElA) statsElA.innerHTML = "";
        return;
      }
      if (statusEl) statusEl.textContent = "";

      var datasets = instruments.map(function (instr, i) {
        var col = IDLE_PALETTE[i % IDLE_PALETTE.length];
        return {
          label: instr,
          data: monthKeys.map(function (k) { return cell(k, instr); }),
          backgroundColor: col + "CC",
          borderColor: col,
          borderWidth: 0,
          borderRadius: 3, categoryPercentage: 0.72, barPercentage: 0.9
        };
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

      var legendEl = document.getElementById("monthly-invest-cat-legend");
      if (legendEl) {
        legendEl.innerHTML = instruments.map(function (instr, i) {
          var col = IDLE_PALETTE[i % IDLE_PALETTE.length];
          return '<div class="mic-legend-item"><div class="mic-legend-bar" style="background:' + col + '"></div>' + escapeHtml(instr) + '</div>';
        }).join("");
      }

      if (__monthlyInvestCatChart) { __monthlyInvestCatChart.destroy(); __monthlyInvestCatChart = null; }
      wrap.innerHTML = "";
      var canvas = document.createElement("canvas");
      wrap.appendChild(canvas);

      __monthlyInvestCatChart = new Chart(canvas.getContext("2d"), {
        type: "bar",
        data: { labels: labels, datasets: datasets },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              mode: "index", intersect: false,
              filter: function (item) { return item.datasetIndex === 0; },
              callbacks: {
                label: function (ctx) {
                  var k = monthKeys[ctx.dataIndex];
                  if (!k) return "";
                  var m = byMonthInstr[k] || {};
                  var lines = ["Idle Cash: " + formatCurrency(monthTotal(k))];
                  Object.keys(m).filter(function (c) { return m[c] > 0; })
                    .sort(function (a, b) { return m[b] - m[a]; })
                    .forEach(function (c) { lines.push("   " + c + ": " + formatCurrency(m[c])); });
                  return lines;
                }
              }
            }
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
    } catch (e) {
      if (statusEl) statusEl.textContent = "Chart error: " + e.message;
    }
  }

  function renderMonthlyInvestmentByCategory() {
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
      yearSel.style.display = __monthlyInvestCatAllTime ? "none" : "";
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
        __monthlyInvestCatFilter = null; // reset instrument filter when toggling split
        _syncMicToggleActive();
        drawMonthlyInvestCatChart(__monthlyInvestCatAllTime ? "all" : __monthlyInvestCatYear);
      };
    }

    if (idleBtn) {
      idleBtn.onclick = function () {
        __monthlyInvestCatIdle = !__monthlyInvestCatIdle;
        if (__monthlyInvestCatIdle) {
          // Balance view — flow-only modes don't apply.
          __monthlyInvestCatNet = false;
          __monthlyInvestCatSplit = false;
          __monthlyInvestCatFilter = null;
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

    var selectedPortfolio = window.__mfHoldingsPortfolioOverride || "all";
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
          window.__mfLastRowsData = rowsData;
          try { renderMfHoldingsCardList(rowsData); } catch (e) {}
          // Portfolio cards + allocation + performance are top-level summaries
          // and must NOT shift when the user filters the Holdings list to a
          // specific portfolio via the holdings pill toggle.
          var _mfOverride = window.__mfHoldingsPortfolioOverride;
          if (!_mfOverride || _mfOverride === "all") {
            try { renderMfPortfolioCards(); } catch (e) {}
            try { renderMfAllocation(rowsData); } catch (e) {}
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
  function renderMfHoldingsCardList(rowsData) {
    var list = document.getElementById("mfh-list");
    var eyebrow = document.getElementById("mfh-eyebrow");
    if (!list) return;
    var filtered = rowsData.filter(function (r) {
      var closed = r.units < 1;
      return MFH_STATE.showClosed ? closed : !closed;
    });
    var parts = String(MFH_STATE.sort || "pnl-desc").split("-");
    var sortKey = parts[0];
    var sortDir = parts[1] === "asc" ? 1 : -1;
    filtered.sort(function (a, b) { return sortDir * _mfhSortCompare(a, b, sortKey); });
    var segmentMap = buildInstrumentSegmentMap();
    if (eyebrow) eyebrow.textContent = "HOLDINGS · " + filtered.length + (MFH_STATE.showClosed ? " CLOSED" : " OPEN");
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
    var body = filtered.map(function (r, i) {
      subInv += r.invested || 0;
      subCur += r.current || 0;
      subPnl += r.pnl || 0;
      if (r.dayChgPct != null && r.current != null) subDay += r.current * r.dayChgPct / 100;
      var pal = _avatarFor(r.instrument, i);
      var code = _shortCode(r.instrument);
      var seg = lookupSegment(segmentMap, r.instrument);
      var sub = escapeHtml(seg) + " · " + r.units.toFixed(1) + " units @ ₹" + r.avgNav.toFixed(2);
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
            '<div class="mfh-inst-sub">' + sub + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="mfh-col-num mfh-num-primary"' + _crTitle(r.invested) + '>' + formatCurrency(r.invested) + '</div>' +
        '<div class="mfh-col-num mfh-num-primary"' + _crTitle(r.current) + '>' + formatCurrency(r.current) + '</div>' +
        '<div class="mfh-col-num mfh-num-primary">' + ltpStr + '</div>' +
        (function () {
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
    var footer = '<div class="mfh-row" style="' + mfhGrid + 'background:var(--bg);padding:10px 12px;border-radius:8px;font-weight:700;margin-top:6px;">' +
      '<div style="font-size:0.72rem;">' + (MFH_STATE.showClosed ? "Closed" : "Open") + ' subtotal<div style="font-size:0.55rem;letter-spacing:0.11em;text-transform:uppercase;color:var(--muted);margin-top:2px;">' + filtered.length + ' HOLDINGS</div></div>' +
      '<div class="mfh-col-num mfh-num-primary"' + _crTitle(subInv) + '>' + formatCurrency(subInv) + '</div>' +
      '<div class="mfh-col-num mfh-num-primary"' + _crTitle(subCur) + '>' + formatCurrency(subCur) + '</div>' +
      '<div class="mfh-col-num mfh-num-primary" style="color:var(--muted);">—</div>' +
      _mfhDayCell(Math.abs(subDay) < 0.01 ? null : subDay, subDayPct) +
      '<div class="mfh-col-num mfh-num-pnl"><span class="mfh-num-pnl-value ' + (subPnl >= 0 ? "" : "mfh-negative") + '"' + _crTitle(subPnl) + '>' + (subPnl >= 0 ? "+" : "") + formatCurrency(subPnl) + '</span><span class="mfh-num-pnl-pct ' + (subPct >= 0 ? "" : "mfh-negative") + '">' + (subPct >= 0 ? "+" : "") + subPct.toFixed(2) + '%</span></div>' +
      '<div class="mfh-col-num mfh-num-xirr mfh-muted">—</div>' +
      '</div>';
    list.innerHTML = header + body + footer;
    try { applyHoldingsFold("mfh-list"); } catch (e) {}
    list.querySelectorAll("[data-mfh-sort-col]").forEach(function (el) {
      el.addEventListener("click", function () {
        var col = el.dataset.mfhSortCol;
        var cur = String(MFH_STATE.sort || "").split("-");
        MFH_STATE.sort = (cur[0] === col && cur[1] === "desc") ? (col + "-asc") : (col + "-desc");
        renderMfHoldingsCardList(rowsData);
      });
    });
  }

  // Phase 1: portfolio cards (per-portfolio MF invested/current/xirr)
  function renderMfPortfolioCards() {
    var row = document.getElementById("mfpc-row");
    if (!row) return;
    var rows = getSheetRows("equity");
    if (!rows) { row.innerHTML = ""; return; }
    var names = collectPortfolioNamesFromSheets(["equity"]);
    if (!names.length) { row.innerHTML = ""; return; }

    var combinedInv = 0, combinedCur = 0, combinedDay = 0;
    Promise.all(names.map(function (name) {
      var invested = computeTotalInvestment(name, ["equity"]);
      return _computeMfCurrentValueForPortfolio(name).then(function (res) {
        var current = res.current, dayChange = res.dayChange;
        var flows = buildXirrCashFlows(rows, name);
        if (current > 0) flows = flows.concat([{ date: new Date(), amount: current }]);
        var xirr = calculateXIRR(flows);
        combinedInv += invested; combinedCur += current; combinedDay += dayChange;
        return { name: name, invested: invested, current: current, xirr: xirr, dayChange: dayChange };
      });
    })).then(function (perPortfolio) {
      perPortfolio.sort(function (a, b) { return b.current - a.current; });
      var equityRows = getSheetRows("equity");
      var comboFlows = buildXirrCashFlows(equityRows, "all");
      if (combinedCur > 0) comboFlows.push({ date: new Date(), amount: combinedCur });
      var comboXirr = calculateXIRR(comboFlows);
      var all = [{ name: "Combined", invested: combinedInv, current: combinedCur, xirr: comboXirr, dayChange: combinedDay, isCombined: true }].concat(perPortfolio);
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
          '<div class="mfpc-bar"><div class="mfpc-bar-fill" style="width:' + progress + '%;"></div></div>' +
          '<div class="mfpc-return-row">' +
            '<span class="mfpc-return-pct ' + (isNeg ? "mfpc-negative" : "") + '">' + (isNeg ? "" : "+") + pnlPct.toFixed(2) + '%</span>' +
            '<span class="mfpc-gain ' + (isNeg ? "mfpc-negative" : "mfpc-positive") + '"' + _crTitle(pnl) + '>' + (isNeg ? "" : "+") + formatCurrency(pnl) + (isNeg ? ' loss' : ' gain') + '</span>' +
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
    if (!rows) return Promise.resolve({ current: 0, dayChange: 0 });
    var byInst = groupUnitTransactionsByInstrument(rows, portfolio);
    if (!byInst) return Promise.resolve({ current: 0, dayChange: 0 });
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
              prevTotal += units * (prevNav || nav); // no day change if prev NAV missing
            } else {
              // Unmapped or NAV-missing fund: value at COST — matches the Overview's
              // updateTotalCurrentValue fallback so the split cards reconcile with it
              // (previously these funds were dropped, undercounting the split totals).
              var cost = lots.reduce(function (s, l) { return s + l.units * l.price; }, 0);
              total += cost;
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
    var bar = '<div class="mfalloc-single-bar">' + entries.map(function (e, i) {
      var pct = total > 0 ? (e.value / total) * 100 : 0;
      return '<span class="mfalloc-seg" style="flex:' + pct + ' 0 0;background:' + PAL[i % PAL.length] + ';" title="' + escapeHtml(e.name) + '"></span>';
    }).join("") + '</div>';
    var rows = entries.map(function (e, i) {
      var pct = total > 0 ? (e.value / total) * 100 : 0;
      var col = PAL[i % PAL.length];
      return '<div class="mfalloc-row">' +
        '<span class="mfalloc-name"><span class="mfalloc-dot" style="background:' + col + ';"></span>' + escapeHtml(e.name) + '</span>' +
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
      var instruments = Object.keys(unitEvents).filter(function (n) { return !!lookupSchemeCode(schemeMap, n); });
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
    if (openBtn) openBtn.addEventListener("click", function () {
      MFH_STATE.showClosed = !MFH_STATE.showClosed;
      openBtn.textContent = MFH_STATE.showClosed ? "Closed" : "Open";
      var cb = document.getElementById("equity-holdings-show-closed-only");
      if (cb) cb.checked = MFH_STATE.showClosed;
      dbg("MF Open toggle → showClosed:", MFH_STATE.showClosed, "checkbox.checked:", cb && cb.checked);
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
        return '<button type="button" class="mfh-portfolio-btn ' + (p === current ? "active" : "") + '" data-mfh-portfolio="' + p.replace(/"/g, '&quot;') + '">' + escapeHtml(label) + '</button>';
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
            xirrPct: xirrPct
          });
        });

          // Compute header stats (feeding _ov.se*) from the Overview-portfolio
          // open positions, so the Overview cards honour the Overview selector
          // while the tab itself shows all portfolios.
          var totalCurrentINR = 0, totalInvestedINR = 0, totalDayChangeINR = 0, totalPnlINR = 0;
          ovOpenHoldings.forEach(function (h) {
            var priceEntry = allPrices[h.ticker] || null;
            var eodRaw = priceEntry ? priceEntry.price : null;
            var prevRaw = priceEntry ? priceEntry.prev_close : null;
            // Invested (cost basis) is price-independent — always count it, even for
            // a freshly-added instrument whose live price hasn't been fetched yet.
            // Only current value / P&L / day-change require a price.
            totalInvestedINR += h.investedINR;
            if (eodRaw === null) {
              // No live price yet: value the holding at cost so the Overview
              // Current reconciles with the split cards (which use the same cost
              // fallback via computeStocksEtfCurrentINR). Day change stays 0.
              totalCurrentINR += h.investedINR;
              return;
            }
            var ltpINR = h.region === "US" ? eodRaw * usdInrToday : eodRaw;
            var cur = h.units * ltpINR;
            totalCurrentINR += cur;
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
          _ov.seInvested   = totalInvestedINR;
          _ov.seCurrent    = totalCurrentINR;
          _ov.seUnrealized = totalPnlINR;
          _ov.seDayChange  = totalDayChangeINR;
          // Tag with the OVERVIEW portfolio these totals were computed for
          // (ovOpenHoldings scope) — NOT the tab's hardcoded "all". Tagging "all"
          // while a portfolio is selected made updateDashboardStats' stale guard
          // zero out correct SE totals on the next stats refresh.
          _ov._seComputedPortfolio = ovPortfolio;
          var seInvestedEl = document.getElementById("stocksetf-total-investment");
          if (seInvestedEl) seInvestedEl.textContent = formatCurrency(totalInvestedINR);
          refreshOverviewStats(); refreshCategoryCards();
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

          // Portfolio-level XIRR — from the Overview-portfolio open positions so
          // _ov.seXirrFlows (and the overview XIRR) honour the Overview selector,
          // consistent with the totals above.
          var seXirrFlows = [];
          ovOpenHoldings.forEach(function (hh) {
            if (hh.region === "US") {
              (hh.txns || []).forEach(function (txn) {
                if (!txn.date || !txn.units || !txn.price) return;
                var dateStr = formatDateISO(txn.date);
                var rateForDate = usdInrHistMap[dateStr] || usdInrToday;
                seXirrFlows.push({ date: txn.date, amount: txn.type === "buy" ? -(txn.units * txn.price * rateForDate) : (txn.units * txn.price * rateForDate) });
              });
            } else {
              buildXirrCashFlows(rows, ovPortfolio, hh.instrument).forEach(function (f) { seXirrFlows.push(f); });
            }
          });
          // INR-converted SE cash flows WITHOUT terminal — reused by the benchmark
          // comparison and period XIRR so those paths stop using unconverted USD.
          _ov._seFlowsINR = seXirrFlows.slice();
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
      dbg("Signup requested for:", email);
    });
  }
})();

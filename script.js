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
  if (settingsTabProfile && settingsTabTransactions) {
    var panelProfile = document.getElementById("panel-profile");
    var panelTransactions = document.getElementById("panel-transactions");

    function showSettingsTab(tab) {
      var isProfile = tab === "profile";
      settingsTabProfile.classList.toggle("active", isProfile);
      settingsTabTransactions.classList.toggle("active", !isProfile);
      settingsTabProfile.setAttribute("aria-selected", String(isProfile));
      settingsTabTransactions.setAttribute("aria-selected", String(!isProfile));
      panelProfile.hidden = !isProfile;
      panelTransactions.hidden = isProfile;
    }

    settingsTabProfile.addEventListener("click", function () { showSettingsTab("profile"); });
    settingsTabTransactions.addEventListener("click", function () { showSettingsTab("transactions"); });
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

  function fetchSheetJSONP(id, gid, onData, onError) {
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

    script.src =
      "https://docs.google.com/spreadsheets/d/" + id +
      "/gviz/tq?gid=" + gid +
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
    var storageKey = "wf-" + prefix + "-sheet-link";

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
          rows = filterColumns(rows, options.fields);
          if (options.showTable === false) {
            sheetTableWrap.hidden = true;
          } else {
            renderTable(rows);
            sheetTableWrap.hidden = false;
          }
          setStatus("", false);
          setConnected(true);

          var rowCount = rows.length - 1;
          rowCountEl.textContent = rowCount + (rowCount === 1 ? " row" : " rows");
          lastSync.textContent = "Last sync: " + new Date().toLocaleTimeString();
          openSheetLink.href = url;
          meta.hidden = false;
        },
        function () {
          setStatus("Couldn't load the sheet. Make sure it's shared as \"Anyone with the link can view.\"", true);
          sheetTableWrap.hidden = true;
          setConnected(false);
        }
      );
    }

    var savedLink = localStorage.getItem(storageKey);
    if (savedLink) {
      sheetLinkInput.value = savedLink;
      syncSheet(savedLink);
    }

    sheetSaveBtn.addEventListener("click", function () {
      var url = sheetLinkInput.value.trim();
      if (!url) return;
      localStorage.setItem(storageKey, url);
      setStatus("Link saved.", false);
    });

    sheetSyncBtn.addEventListener("click", function () {
      var url = sheetLinkInput.value.trim();
      if (!url) return;
      localStorage.setItem(storageKey, url);
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
  initSheetCard("fixedincome");

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

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

  // ===== Equity Google Sheet import =====
  var sheetLinkInput = document.getElementById("equity-sheet-link");
  if (sheetLinkInput) {
    var sheetAddBtn = document.getElementById("equity-sheet-add");
    var sheetRefreshBtn = document.getElementById("equity-sheet-refresh");
    var sheetStatus = document.getElementById("equity-sheet-status");
    var sheetTableWrap = document.getElementById("equity-sheet-table-wrap");
    var sheetTable = document.getElementById("equity-sheet-table");
    var STORAGE_KEY = "wf-equity-sheet-link";

    function parseSheetUrl(url) {
      var idMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (!idMatch) return null;
      var gidMatch = url.match(/[#&?]gid=([0-9]+)/);
      return { id: idMatch[1], gid: gidMatch ? gidMatch[1] : "0" };
    }

    function parseCSV(text) {
      var rows = [];
      var row = [];
      var field = "";
      var inQuotes = false;
      for (var i = 0; i < text.length; i++) {
        var ch = text[i];
        if (inQuotes) {
          if (ch === '"') {
            if (text[i + 1] === '"') { field += '"'; i++; }
            else inQuotes = false;
          } else field += ch;
        } else {
          if (ch === '"') inQuotes = true;
          else if (ch === ",") { row.push(field); field = ""; }
          else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && text[i + 1] === "\n") i++;
            row.push(field); field = "";
            rows.push(row); row = [];
          } else field += ch;
        }
      }
      if (field.length || row.length) { row.push(field); rows.push(row); }
      return rows.filter(function (r) { return r.length > 1 || r[0] !== ""; });
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
    }

    function setStatus(message, isError) {
      sheetStatus.hidden = !message;
      sheetStatus.textContent = message || "";
      sheetStatus.style.color = isError ? "#EF4444" : "";
    }

    function loadSheet(url) {
      var parsed = parseSheetUrl(url);
      if (!parsed) {
        setStatus("That doesn't look like a valid Google Sheets link.", true);
        sheetTableWrap.hidden = true;
        return;
      }
      setStatus("Loading sheet data…", false);
      var csvUrl = "https://docs.google.com/spreadsheets/d/" + parsed.id + "/gviz/tq?tqx=out:csv&gid=" + parsed.gid;

      fetch(csvUrl)
        .then(function (res) {
          if (!res.ok) throw new Error("Request failed");
          return res.text();
        })
        .then(function (text) {
          var rows = parseCSV(text);
          if (!rows.length) {
            setStatus("The sheet appears to be empty.", true);
            sheetTableWrap.hidden = true;
            return;
          }
          renderTable(rows);
          sheetTableWrap.hidden = false;
          sheetRefreshBtn.hidden = false;
          setStatus("Last updated: " + new Date().toLocaleTimeString(), false);
        })
        .catch(function () {
          setStatus("Couldn't load the sheet. Make sure it's shared as \"Anyone with the link can view.\"", true);
          sheetTableWrap.hidden = true;
        });
    }

    var savedLink = localStorage.getItem(STORAGE_KEY);
    if (savedLink) {
      sheetLinkInput.value = savedLink;
      loadSheet(savedLink);
    }

    sheetAddBtn.addEventListener("click", function () {
      var url = sheetLinkInput.value.trim();
      if (!url) return;
      localStorage.setItem(STORAGE_KEY, url);
      loadSheet(url);
    });

    sheetRefreshBtn.addEventListener("click", function () {
      var url = sheetLinkInput.value.trim();
      if (!url) return;
      loadSheet(url);
    });
  }

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

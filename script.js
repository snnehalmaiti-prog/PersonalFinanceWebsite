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
      // Placeholder: wire up real Google Identity Services here with a Client ID.
      alert("Google Sign-In is a UI placeholder in this demo. Connect a Google OAuth Client ID to enable real authentication.");
    });

    document.getElementById("login-form").addEventListener("submit", function (e) {
      e.preventDefault();
      alert("This is a demo form — no backend is connected yet.");
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

/* PF Dashboard — PWA install chip (Phase 1: no service worker yet).
 *
 * Behaviour:
 *   - On Chromium browsers, capture the `beforeinstallprompt` event and show
 *     a compact "Install app" chip in the header. Clicking it triggers the
 *     native install prompt.
 *   - On iOS Safari (which never fires that event but is installable via the
 *     Share sheet), show a one-time "Add to Home Screen" hint chip instead.
 *   - Once installed, hide the chip and never show it again for this origin.
 *   - Suppress on the marketing landing page (index.html) — installing only
 *     makes sense once the user is inside the app.
 */
/* ── Service-worker registration + update toast (Phase 2) ─────────────────
 *
 * Registers sw.js for offline support and the app shell. Skips registration
 * on localhost and when the page URL carries ?nosw=1, so the SW never masks
 * bugs during local development or debugging. When a new SW is waiting, shows
 * a non-blocking "Update available — Reload" toast that applies the update.
 */
(function () {
  "use strict";

  if (!("serviceWorker" in navigator)) return;

  var host = location.hostname;
  var isLocalhost = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  var noSW = /[?&]nosw=1\b/.test(location.search);
  if (isLocalhost || noSW) return;

  var refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });

  function showUpdateToast(worker) {
    if (document.getElementById("pwa-update-toast")) return;
    var toast = document.createElement("div");
    toast.id = "pwa-update-toast";
    toast.className = "pwa-update-toast";
    toast.setAttribute("role", "status");
    toast.innerHTML =
      '<span>A new version is available.</span>' +
      '<button type="button" id="pwa-update-reload">Reload</button>' +
      '<button type="button" id="pwa-update-dismiss" aria-label="Dismiss">&times;</button>';
    (document.body || document.documentElement).appendChild(toast);
    document.getElementById("pwa-update-reload").addEventListener("click", function () {
      worker.postMessage({ type: "SKIP_WAITING" });
    });
    document.getElementById("pwa-update-dismiss").addEventListener("click", function () {
      toast.parentNode && toast.parentNode.removeChild(toast);
    });
  }

  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").then(function (reg) {
      // A worker is already waiting (update downloaded in a previous session).
      if (reg.waiting && navigator.serviceWorker.controller) {
        showUpdateToast(reg.waiting);
      }
      reg.addEventListener("updatefound", function () {
        var installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", function () {
          // Installed while an old controller is active => it's an update.
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            showUpdateToast(installing);
          }
        });
      });
    }).catch(function () { /* registration failed — app still works online */ });
  });
})();

(function () {
  "use strict";

  var STORAGE_INSTALLED = "wf-pwa-installed";
  var STORAGE_IOS_HINT_DISMISSED = "wf-pwa-ios-hint-dismissed";

  // Don't show the chip on the marketing landing page.
  var path = (location.pathname || "").toLowerCase();
  var isLandingPage = path.endsWith("/") || path.endsWith("/index.html");

  // Detect already-installed (standalone) mode.
  var isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari-specific
    window.navigator.standalone === true;

  if (isStandalone) {
    try { localStorage.setItem(STORAGE_INSTALLED, "1"); } catch (e) {}
    return;
  }

  if (localStorage.getItem(STORAGE_INSTALLED) === "1") return;
  if (isLandingPage) return;

  var deferredPrompt = null;

  function makeChip(label, onClick) {
    var chip = document.createElement("button");
    chip.type = "button";
    chip.id = "pwa-install-chip";
    chip.className = "pwa-install-chip";
    chip.setAttribute("aria-label", label);
    chip.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/>' +
      '<path d="M5 21h14"/></svg>' +
      '<span>' + label + '</span>';
    chip.addEventListener("click", onClick);
    return chip;
  }

  function mountChip(chip) {
    // Prefer the header action area if present.
    var host =
      document.querySelector(".header-actions") ||
      document.querySelector(".site-header .container") ||
      document.body;
    if (!host) return;
    // Avoid double-mount.
    if (document.getElementById("pwa-install-chip")) return;
    // Insert before the theme toggle for a natural spot in the header.
    var themeToggle = host.querySelector("#theme-toggle");
    if (themeToggle && themeToggle.parentNode === host) {
      host.insertBefore(chip, themeToggle);
    } else {
      host.appendChild(chip);
    }
  }

  function removeChip() {
    var el = document.getElementById("pwa-install-chip");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // ── Chromium install path ──────────────────────────────────────────────
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;

    var chip = makeChip("Install app", function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (choice) {
        if (choice && choice.outcome === "accepted") {
          try { localStorage.setItem(STORAGE_INSTALLED, "1"); } catch (e) {}
          removeChip();
        }
        deferredPrompt = null;
      });
    });
    // Wait for DOM ready if we ran before the header exists.
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { mountChip(chip); });
    } else {
      mountChip(chip);
    }
  });

  window.addEventListener("appinstalled", function () {
    try { localStorage.setItem(STORAGE_INSTALLED, "1"); } catch (e) {}
    removeChip();
    deferredPrompt = null;
  });

  // ── iOS Safari (no beforeinstallprompt) ────────────────────────────────
  // Show a hint chip that explains the Share → Add to Home Screen flow.
  var ua = navigator.userAgent || "";
  var isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  var isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  if (isIOS && isSafari && localStorage.getItem(STORAGE_IOS_HINT_DISMISSED) !== "1") {
    var iosChip = makeChip("Install app", function () {
      alert(
        "To install PF Dashboard on your iPhone or iPad:\n\n" +
        "1. Tap the Share button in Safari.\n" +
        "2. Scroll down and choose \"Add to Home Screen\".\n" +
        "3. Tap Add."
      );
      try { localStorage.setItem(STORAGE_IOS_HINT_DISMISSED, "1"); } catch (e) {}
    });
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { mountChip(iosChip); });
    } else {
      mountChip(iosChip);
    }
  }
})();

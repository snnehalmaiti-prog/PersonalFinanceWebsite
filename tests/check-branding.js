#!/usr/bin/env node
// Guard: the product is called Kosha, and the monogram is drawn from one source.
//
// A rename is the kind of change that half-lands: the header says one thing, the
// tab title another, and the installed PWA a third, because each lives in a
// different file and only the one you looked at got changed. Every place the name
// is user-visible is listed here.
//
// The mark is pinned too. icons/kosha-mark.svg is the source of truth for the
// shape and tools/make-icons.js renders every PNG from it; the inline copies in
// the page headers have to carry the same geometry, or the favicon and the header
// end up showing different logos.
"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

let failed = 0;
function check(cond, msg) { if (!cond) { console.error("  FAIL " + msg); failed++; } }

const NAME = "Kosha";
const PAGES = ["index.html", "dashboard.html", "settings.html", "offline.html"];

// No page may still carry the old name anywhere a user can read it.
const SHIPPED = PAGES.concat(["manifest.webmanifest", "sw.js", "pwa-register.js", "styles.css"]);
SHIPPED.forEach((f) => {
  check(!/PF Dashboard/.test(read(f)), f + " still says \"PF Dashboard\"");
});

// Titles, because the tab is the most-seen surface of all.
PAGES.forEach((f) => {
  const m = read(f).match(/<title>([^<]*)<\/title>/);
  check(m && m[1].includes(NAME), f + " <title> must name " + NAME + (m ? ": got \"" + m[1] + "\"" : ""));
});

// Installed-app identity: these are what the home screen and the app switcher show.
const mani = JSON.parse(read("manifest.webmanifest"));
check(mani.name && mani.name.includes(NAME), "manifest name must include " + NAME);
check(mani.short_name === NAME, "manifest short_name must be exactly " + NAME +
  " — it is what fits under a home-screen icon");
["index.html", "dashboard.html", "settings.html"].forEach((f) => {
  check(/name="apple-mobile-web-app-title" content="Kosha"/.test(read(f)),
    f + " must set the iOS home-screen title to " + NAME);
});

// The mark: one source, and the headers agree with it.
const svg = read("icons/kosha-mark.svg");
// The three strokes and the dot that make up the monogram.
const STROKES = [
  "M5.8 2.6 V17.7 C5.8 19.5 6.9 20.6 8.7 20.6",
  "M9.7 2.6 C14.9 3.1 18.4 6.6 18.4 11.6 C18.4 16.8 14.7 20.6 8.7 20.6",
  "M18.1 2.8 L12.6 11.3",
];
STROKES.forEach((d, i) => {
  check(svg.includes(d), "icons/kosha-mark.svg is missing monogram stroke " + (i + 1));
});
check(/<circle[^>]*r="1\.15"/.test(svg), "the monogram's dot is missing from the source SVG");

// Every header copy must carry all three strokes — a header that has drifted from
// the SVG shows a different logo from the favicon rendered out of it.
["index.html", "dashboard.html", "settings.html"].forEach((f) => {
  const s = read(f);
  STROKES.forEach((d, i) => {
    check(s.includes(d), f + " header monogram is missing stroke " + (i + 1) +
      " — it must match icons/kosha-mark.svg");
  });
  check(!/M6 17\.5L10\.5 10L14 14\.5L20 7/.test(s), f + " still draws the old tick logo");
});

// The generator and every icon it writes must exist, or the manifest points at
// files that are not there.
check(fs.existsSync(path.join(ROOT, "tools", "make-icons.js")),
  "tools/make-icons.js must exist — it is how the PNGs are regenerated from the SVG");
["favicon-16.png", "favicon-32.png", "apple-touch-icon-180.png",
 "icon-192.png", "icon-512.png", "icon-512-maskable.png"].forEach((f) => {
  check(fs.existsSync(path.join(ROOT, "icons", f)), "icons/" + f + " is missing");
});

if (failed) { console.error("\n" + failed + " branding check(s) failed"); process.exit(1); }
console.log("branding OK");

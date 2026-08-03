// Renders the Kosha app icons from icons/kosha-mark.svg, so every size comes
// from one source of truth and they cannot drift apart.
//
//   node tools/make-icons.js
//
// Sizes and padding follow what each slot needs:
//   favicon 16/32  — tighter padding, or the mark is a smudge at 16px
//   apple-touch    — Apple applies its own rounding, so the tile is drawn square
//   maskable       — 20% safe-zone padding on every side per the spec, since
//                    launchers crop maskable icons to their own shape
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MARK = fs.readFileSync(path.join(ROOT, "icons", "kosha-mark.svg"), "utf8");
const NAVY = "#0F1B2D";
const GOLD = "#E8C36F";

const TARGETS = [
  { file: "favicon-16.png", size: 16, radius: 3, pad: 0.02 },
  { file: "favicon-32.png", size: 32, radius: 7, pad: 0.02 },
  { file: "apple-touch-icon-180.png", size: 180, radius: 0, pad: 0.10 },
  { file: "icon-192.png", size: 192, radius: 42, pad: 0.08 },
  { file: "icon-512.png", size: 512, radius: 112, pad: 0.08 },
  { file: "icon-512-maskable.png", size: 512, radius: 0, pad: 0.20 },
];

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  for (const t of TARGETS) {
    const p = await (await b.newContext({ viewport: { width: t.size, height: t.size },
      deviceScaleFactor: 1 })).newPage();
    const inner = Math.round(t.size * (1 - t.pad * 2));
    await p.setContent(
      `<body style="margin:0;width:${t.size}px;height:${t.size}px">` +
      `<div style="width:${t.size}px;height:${t.size}px;border-radius:${t.radius}px;` +
      `background:${NAVY};color:${GOLD};display:flex;align-items:center;justify-content:center">` +
      `<div style="width:${inner}px;height:${inner}px;display:flex">` +
      MARK.replace("<svg ", `<svg style="width:100%;height:100%" `) +
      `</div></div></body>`);
    await p.waitForTimeout(120);
    await p.screenshot({ path: path.join(ROOT, "icons", t.file), omitBackground: t.radius > 0 });
    await p.context().close();
    console.log("  wrote icons/" + t.file + "  " + t.size + "px");
  }
  await b.close();
})();

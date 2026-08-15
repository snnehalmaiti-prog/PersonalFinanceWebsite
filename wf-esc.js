// The one HTML escaper.
//
// There were five, with three different character sets:
//
//   script.js      escapeHtml   & < > " '
//   dashboard.html _escHtml     & < > "      — no '
//   expense.js     esc          & < > "      — no '
//   settings.html  esc          & < > "      — no '
//   script.js      inline       "            — only the quote
//
// Every one of them was used somewhere the omissions happened to be inert:
// inside double-quoted attributes, or on values that could not contain the
// missing characters. So none was an active vulnerability. But five divergent
// escapers is exactly how the SIXTH call site ends up reaching for the weakest
// one in a context where the difference matters — a single-quoted attribute, or
// element text — and that is a stored-XSS bug on an origin holding the Supabase
// session and a repo-write GitHub PAT.
//
// Its own file, loaded synchronously in <head>, rather than exported from
// script.js: dashboard.html escapes inside inline code that runs during the
// cached-expense paint, which happens BEFORE script.js is injected. Anything
// depending on script.js having loaded would be undefined at exactly the wrong
// moment.
(function () {
  "use strict";

  var MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  // The apostrophe is escaped too. It costs nothing, and it is what makes the
  // result safe in a single-quoted attribute as well as a double-quoted one —
  // the difference between the strongest of the five originals and the rest.
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return MAP[c];
    });
  }

  window.WfEsc = escapeHtml;
})();

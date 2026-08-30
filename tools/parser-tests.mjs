// ============================================================================
// parser-tests.mjs — regression tests for the email-inbox parsers.
//
// Runs the SAME code the Edge Function uses (supabase/functions/email-inbox/
// parsers.mjs), so a passing run here means the deployed function will parse
// these formats correctly too.
//
//   Run:   node tools/parser-tests.mjs
//   CI:    exits non-zero if any case fails.
//
// When a bank/card format parses wrong, add a CASE below with the real email
// text and the fields you expect, fix the regex in parsers.mjs until this
// passes, THEN redeploy the function. This is the guardrail that would have
// caught the "05 Aug, 2026" date miss and the "URBANCLAP on 05 Aug" merchant
// bug before they shipped.
// ============================================================================

import {
  parseAmount, parseMerchant, parseSource, guessType, parseDate, cleanBody,
} from "../supabase/functions/email-inbox/parsers.mjs";

// cleanBody: forwarding headers + tracking URL should reduce to the alert text.
{
  const noisy = "---------- Forwarded message --------- From: Snnehal Maiti <snnehal.kr.maiti@gmail.com> Date: Sun, 30 Aug 2026 at 20:41 Subject: Fwd: UPI txn To: <maitisnnehal@gmail.com> <https://trkt.aclemails.com/v1/r/GSvohUqYWnGa9?x=1%2B2> Dear Customer, Rs.140.00 is debited from your account ending 0037 towards VPA paytm.s2f";
  const got = cleanBody(noisy);
  const want = "Dear Customer, Rs.140.00 is debited from your account ending 0037 towards VPA paytm.s2f";
  if (got !== want) {
    console.error("✗ cleanBody");
    console.error(`    expected ${JSON.stringify(want)}\n    got      ${JSON.stringify(got)}`);
    process.exit(1);
  }
  console.log("✓ cleanBody strips forwarding headers + tracking URL");
}

// Each case: a real-world email body + only the fields we want to assert.
// Omit a field to skip asserting it (e.g. merchant we don't fully trust yet).
const CASES = [
  {
    name: "HDFC credit card — BATA (month-first date)",
    text: "Rs. 427.00 debit from your HDFC Credit Card (ending 3370) for BATA INDIA on Aug 30, 2026",
    amount: 427, merchant: "BATA INDIA", date: "2026-08-30",
    source: "Card **70", type: "expense",
  },
  {
    name: "HDFC credit card — URBANCLAP (day-first, comma)",
    text: "Rs. 214.00 has been debited from your HDFC Bank Credit Card ending 3370 towards URBANCLAP on 05 Aug, 2026 at 12:43:00.",
    amount: 214, merchant: "URBANCLAP", date: "2026-08-05",
    source: "Card **70", type: "expense",
  },
  {
    name: "UPI debit — FOODLAND (account, dd-mm-yy)",
    text: "Dear Customer, Rs.45.00 has been debited from account 0037 to VPA paytm.s1fsv6a@pty FOODLAND SUPERMARKET on 03-04-26. Your UPI.",
    amount: 45, date: "2026-04-03", source: "Account **37", type: "expense",
  },
  {
    name: "Income alert — salary credited",
    text: "INR 50,000.00 credited to account 1234 as SALARY on 01-08-2026.",
    amount: 50000, type: "income", source: "Account **34",
  },
  {
    name: "ISO date passthrough",
    text: "USD 12.50 spent at NETFLIX.COM on 2026-08-15.",
    amount: 12.5, merchant: "NETFLIX.COM", date: "2026-08-15", type: "expense",
  },
];

let failures = 0;
for (const c of CASES) {
  const got = {
    amount: parseAmount(c.text),
    merchant: parseMerchant(c.text, ""),
    date: parseDate(c.text),
    source: parseSource(c.text),
    type: guessType(c.text),
  };
  const checks = ["amount", "merchant", "date", "source", "type"]
    .filter((k) => c[k] !== undefined);
  const bad = checks.filter((k) => String(got[k]) !== String(c[k]));
  if (bad.length) {
    failures++;
    console.error(`✗ ${c.name}`);
    bad.forEach((k) => console.error(`    ${k}: expected ${JSON.stringify(c[k])}, got ${JSON.stringify(got[k])}`));
  } else {
    console.log(`✓ ${c.name}`);
  }
}

console.log(`\n${CASES.length - failures}/${CASES.length} passed`);
if (failures) process.exit(1);

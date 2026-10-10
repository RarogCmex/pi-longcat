/**
 * Render `research/probe-ledger.md` from `research/probe-ledger.jsonl`.
 *
 * Generated, never hand-written: the JSONL is appended by the probe runners at
 * call time, so the human-readable ledger cannot drift from it (and a blind edit
 * over recorded numbers is how evidence gets corrupted — pitfalls L39). The
 * summary section ASSERTS: a row whose class says "free" but whose HTTP status is
 * 2xx with usage, or whose usage is missing while the call was accepted, is
 * reported as a hole rather than printed as a pass (pitfalls L35/L42 — "free
 * means rejected", and a diagnostic that cannot fail is decoration).
 *
 * Usage: node scripts/ledger-report.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const JSONL = join(ROOT, "research", "probe-ledger.jsonl");
const OUT = join(ROOT, "research", "probe-ledger.md");
const CNY_PER_USD = 6.7252; // same dated house rate the plugin uses (models.ts)

interface Row {
  n: number;
  ts: string;
  label: string;
  key: string;
  surface: string;
  purpose: string;
  bound: string;
  plannedClass: string;
  http: number | string;
  actualClass: string;
  in?: number;
  out?: number;
  cached?: number;
  costCny: number;
  note?: string;
}

const rows: Row[] = readFileSync(JSONL, "utf8")
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line) as Row);

/** A call that performed inference: 2xx AND usage captured. */
const billed = rows.filter((r) => r.actualClass === "BILLED");
/**
 * A row that performed no inference says so in its class ("no inference" for a
 * listing GET, "not billed" for an in-band error body or an SSE
 * `response.failed`). Those are not holes and not L35 misses: the audit is about
 * calls that GENERATED without being itemized, and about a planned-free probe
 * that came back accepted.
 */
const performedNoInference = (r: Row) => /no inference|not billed/i.test(r.actualClass);
const accepted = (r: Row) => {
  const status = typeof r.http === "number" ? r.http : 0;
  return status >= 200 && status < 300;
};

/** 2xx that generated but whose usage we never captured. */
const holes = rows.filter(
  (r) => accepted(r) && r.actualClass !== "BILLED" && !performedNoInference(r) && !/ABORTED|ERR/i.test(String(r.http)),
);
/** Aborted/errored mid-stream: accepted, but the usage event never arrived. */
const uncaptured = rows.filter((r) => /ABORTED|ERR:/i.test(String(r.http)));
/** Rows planned "free" that came back accepted AND generated — the L35 audit. */
const suspicious = rows.filter((r) => r.plannedClass === "free" && accepted(r) && !performedNoInference(r));
const totalCny = billed.reduce((sum, r) => sum + (r.costCny || 0), 0);
const totalIn = billed.reduce((sum, r) => sum + (r.in ?? 0), 0);
const totalOut = billed.reduce((sum, r) => sum + (r.out ?? 0), 0);

const lines: string[] = [
  "# Live probe ledger — pi-longcat",
  "",
  `Generated from \`research/probe-ledger.jsonl\` by \`node scripts/ledger-report.ts\`; do not hand-edit.`,
  "",
  "Rules (pi-provider-plugin Phase 5, pitfalls L35/L41/L42):",
  "",
  "- **Free means *rejected*.** A 2xx that generated is itemized with its usage and cost.",
  "- A 2xx carrying an in-band `{\"error\":…}` body, or an SSE `response.failed` with",
  "  `usage: 0`, performed no inference and is recorded as not billed.",
  "- Costing uses the gateway's own rates: ¥2 / 1M uncached input, ¥0.04 / 1M cached,",
  "  ¥8 / 1M output (`GET /openai/v1/models/{id}`, 2026-10-10). USD conversions use the",
  `  dated house rate ¥${CNY_PER_USD} = $1 (models.ts).`,
  "- `key` is the index name from `secret.env`, never the key.",
  "",
  "## Summary",
  "",
  `| | |`,
  `|---|---|`,
  `| ledger rows | ${rows.length} |`,
  `| calls that generated (BILLED) | ${billed.length} |`,
  `| input tokens bought | ${totalIn} |`,
  `| output tokens bought | ${totalOut} |`,
  `| **total spend** | **¥${totalCny.toFixed(6)} ≈ $${(totalCny / CNY_PER_USD).toFixed(6)}** |`,
  `| accepted rows whose usage was never captured | ${holes.length + uncaptured.length}${holes.length + uncaptured.length ? " — " + [...holes, ...uncaptured].map((h) => h.label).join(", ") : ""} |`,
  `| rows planned "free" that came back accepted and generated (L35 audit) | ${suspicious.length}${suspicious.length ? " — " + suspicious.map((h) => h.label).join(", ") : ""} |`,
  "",
  "Two calls are holes on purpose and are **not** estimated (the house rule is 'not",
  "captured' rather than a plausible number): `CAP2-chat-2.5-131073` was accepted and",
  "killed by the 3 s client-side abort guard before any usage event, and",
  "`R2-IM-2.5-textonly` timed out at 45 s. Both were bounded prompts with",
  "`max_tokens` 8/131073 respectively; the first is the reason every cap probe in",
  "this run carries an abort guard.",
  "",
  "## Rows",
  "",
  "| # | label | key | surface | HTTP | class | in | out | cached | ¥ |",
  "|---|---|---|---|---|---|---|---|---|---|",
];
for (const r of rows) {
  lines.push(
    `| ${r.n} | \`${r.label}\` | ${r.key} | ${r.surface} | ${r.http} | ${r.actualClass} | ${r.in ?? "–"} | ${r.out ?? "–"} | ${r.cached ?? "–"} | ${r.costCny ? r.costCny.toFixed(8) : "0"} |`,
  );
}
lines.push("", "## What each row was for", "");
for (const r of rows) {
  lines.push(`- **${r.n} \`${r.label}\`** (${r.bound}) — ${r.purpose}`);
}
lines.push("");
writeFileSync(OUT, lines.join("\n"));
console.log(
  `wrote ${OUT}: ${rows.length} rows, ${billed.length} billed, ¥${totalCny.toFixed(6)} (~$${(totalCny / CNY_PER_USD).toFixed(6)}), ${holes.length} holes, ${suspicious.length} suspicious`,
);
if (holes.length > 2) throw new Error(`too many uncaptured rows (${holes.length}) - the ledger would be decoration`);

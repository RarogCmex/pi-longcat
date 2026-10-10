/**
 * Prompt-caching report, generated from the ledger (no API calls).
 *
 * Two things are produced:
 *
 *  1. **The block-alignment claim, tested rather than asserted.** Across the cache
 *     rounds, every warm row is checked against `cached = floor(prompt/128) × 128`.
 *     Ten independent pairs from round 1 fit exactly (308→256, 593→512,
 *     1057→1024, 1107→1024, 1132→1024, 1154→1152, 1157→1152, 2285→2176, plus
 *     round-0's 359→256 and 836→768), which is what makes "128-token blocks" a
 *     finding instead of a guess. The script prints every row it scored, the fit
 *     count, and any row that breaks the model — a claim that cannot break is not
 *     a claim.
 *  2. **The economics**, computed from the gateway's own usage fields at the
 *     documented rates (¥2 / ¥0.04 / ¥8 per 1M): cold vs warm input cost for the
 *     measured pairs, so the README's "N× cheaper" sentence is reproducible.
 *
 * Honest limit, printed with the numbers: the platform deducts server-side and
 * exposes no balance/usage API to a model key, so these figures are COMPUTED from
 * published rates and reported usage — not read off an invoice.
 *
 * Usage: node scripts/cache-report.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
interface Row {
  n: number; label: string; key: string; surface: string; model?: string; actualClass: string;
  in?: number; out?: number; cached?: number; costCny: number; ttftMs?: number; note?: string; purpose?: string;
}
const rows: Row[] = readFileSync(join(ROOT, "research", "probe-ledger.jsonl"), "utf8")
  .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Row);

const BLOCK = 128;
// Real-pi rows are excluded from the block-model check on purpose: their `in` and
// `cached` are SUMS across the turns of one agent run, so neither is a single
// request's prompt and the per-request model does not apply. They are reported
// separately at the bottom (and they are the economically interesting ones: pi's
// own system prompt is a stable prefix that the agent loop re-sends every turn).
const realPi = rows.filter((r) => r.surface.startsWith("real-pi") && typeof r.in === "number");
const scored = rows.filter(
  (r) => !r.surface.startsWith("real-pi") && typeof r.in === "number" && typeof r.cached === "number" && r.in > 0,
);
let fits = 0;
const breaks: string[] = [];
console.log(`rows with both prompt and cached token counts: ${scored.length}\n`);
console.log("| row | label | prompt | cached | floor(prompt/128)*128 | fit |");
console.log("|---|---|---|---|---|---|");
for (const r of scored) {
  const predicted = Math.floor(r.in! / BLOCK) * BLOCK;
  // A cold call (cached 0) fits the model only when the prompt is under one block;
  // otherwise it is a first-touch row, which the model says nothing about.
  const cold = r.cached === 0;
  const fit = cold ? r.in! < BLOCK || /cold|call1|-1of|-call1|warm$/.test(r.label) === false ? true : predicted === r.cached : predicted === r.cached;
  if (cold && r.in! >= BLOCK) {
    // First touch on a fresh unique prefix: 0 cached is expected, not a model break.
    console.log(`| ${r.n} | \`${r.label}\` | ${r.in} | 0 | ${predicted} | cold (first touch) |`);
    continue;
  }
  if (fit) fits++;
  else breaks.push(`${r.label}: prompt ${r.in} → cached ${r.cached}, predicted ${predicted}`);
  console.log(`| ${r.n} | \`${r.label}\` | ${r.in} | ${r.cached} | ${predicted} | ${fit ? "✓" : "✗"} |`);
}
console.log(`\nblock model fits: ${fits}/${scored.length - (scored.filter((r) => r.cached === 0 && r.in! >= BLOCK).length)} warm rows; breaks: ${breaks.length}`);
for (const b of breaks) console.log(`  ✗ ${b}`);

// Economics: pair each warm row with the cold row of the same cell where possible.
const cells = new Map<string, { cold?: Row; warm?: Row }>();
for (const r of scored) {
  const cell = r.label.replace(/-?call\d+$/, "").replace(/-(cold|warm)$/, "");
  const entry = cells.get(cell) ?? {};
  if (r.cached === 0) entry.cold ??= r;
  else entry.warm ??= r;
  cells.set(cell, entry);
}
console.log("\n| cell | cold prompt | cold input ¥ | warm cached | warm input ¥ | ratio |");
console.log("|---|---|---|---|---|---|");
for (const [cell, { cold, warm }] of [...cells.entries()].sort()) {
  if (!cold || !warm || cold.in === undefined || warm.in === undefined) continue;
  const coldCost = (cold.in / 1e6) * 2;
  const warmCost = ((warm.in - (warm.cached ?? 0)) / 1e6) * 2 + ((warm.cached ?? 0) / 1e6) * 0.04;
  console.log(`| \`${cell}\` | ${cold.in} | ${coldCost.toFixed(6)} | ${warm.cached} | ${warmCost.toFixed(6)} | ${(coldCost / Math.max(warmCost, 1e-12)).toFixed(1)}× cheaper |`);
}
if (realPi.length) {
  console.log("\nreal-pi agent rows (usage summed across turns, so NOT checked against the per-request block model):");
  for (const r of realPi) {
    console.log(`  ${r.label.padEnd(34)} in=${String(r.in).padEnd(6)} cached=${String(r.cached ?? 0).padEnd(6)} out=${String(r.out ?? 0).padEnd(5)} cost=¥${r.costCny.toFixed(6)} | ${(r.note ?? "").slice(0, 90)}`);
  }
  console.log("  (cached > in on these rows is expected: pi's usage.input is net of cacheRead.");
}
console.log("\nNote: costs are COMPUTED from the documented rates and the gateway's own");
console.log("usage fields (¥2/1M uncached, ¥0.04/1M cached). The platform exposes no");
console.log("balance or usage API to a model key, so nothing here was read off an invoice.");

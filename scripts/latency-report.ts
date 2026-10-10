/**
 * C5 — latency/throughput summary for the billed round, read from the ledger.
 *
 * The third-party verdict being tested is aichina.news (2026-10-08): "capable and
 * cheap, but slow" (>30 min per coding task). Every billed call of this round
 * records `ttftMs` and `tokPerSec` (`research/lib.ts` measures them from the
 * stream: TTFT = request start → first content/reasoning delta; tok/s = output
 * tokens ÷ generation time after the first token). Real-pi rows record
 * `elapsedMs` and a first-stdout-byte figure instead, because pi does not expose
 * TTFT — those rows are labelled so the two are never averaged together.
 *
 * Usage: node scripts/latency-report.ts [--since-billed-round]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
interface Row {
  n: number; ts: string; label: string; key: string; surface: string; http: number | string;
  actualClass: string; in?: number; out?: number; cached?: number; costCny: number;
  ttftMs?: number; tokPerSec?: number; elapsedMs?: number; note?: string; model?: string;
}

/**
 * Rows written before `research/lib.ts` carried a `model` column get their model
 * from the label, with the mapping the round's runners actually used. Explicit
 * rather than a regex guess: an unattributed row must show as "unknown", never as
 * a plausible-looking wrong model.
 */
function modelOf(row: Row): string {
  if (row.model) return row.model;
  const l = row.label;
  if (/2\.5/.test(l)) return "LongCat-2.5-Preview";
  if (/2\.0/.test(l)) return "LongCat-2.0";
  if (/^(C2-language|C6-needle|C7-effort|A8-2\.5|A9-cross-on-2\.5)/.test(l)) return "LongCat-2.5-Preview";
  if (/^C1b-/.test(l)) return "LongCat-2.0";
  if (/^(A[1-9]|B-tools|B-realpi|C[0-9])/.test(l)) return "LongCat-2.0";
  return "unknown (row predates the model column)";
}
const rows: Row[] = readFileSync(join(ROOT, "research", "probe-ledger.jsonl"), "utf8")
  .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Row);

const billed = rows.filter((r) => r.actualClass === "BILLED");
const withTiming = billed.filter((r) => typeof r.ttftMs === "number" && typeof r.tokPerSec === "number");

function stats(values: number[]): { n: number; min: number; median: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: sorted[0] ?? 0,
    median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

const groups = new Map<string, Row[]>();
for (const row of withTiming) {
  const model = modelOf(row);
  groups.set(model, [...(groups.get(model) ?? []), row]);
}

console.log(`billed rows with timing: ${withTiming.length} of ${billed.length} billed rows (${rows.length} rows total)\n`);
console.log("| model | calls | TTFT ms (min/median/max) | output tok/s (min/median/max) | elapsed ms (median) | ¥ (this table) |");
console.log("|---|---|---|---|---|---|");
for (const [model, group] of [...groups.entries()].sort()) {
  const ttft = stats(group.map((r) => r.ttftMs!));
  const tps = stats(group.map((r) => r.tokPerSec!));
  const el = stats(group.map((r) => r.elapsedMs ?? 0));
  const cost = group.reduce((s, r) => s + r.costCny, 0);
  console.log(`| ${model} | ${group.length} | ${ttft.min} / ${ttft.median} / ${ttft.max} | ${tps.min} / ${tps.median} / ${tps.max} | ${el.median} | ${cost.toFixed(4)} |`);
}

const perSurface = new Map<string, Row[]>();
for (const row of withTiming) perSurface.set(row.surface, [...(perSurface.get(row.surface) ?? []), row]);
console.log("\nby surface:");
for (const [surface, group] of [...perSurface.entries()].sort()) {
  const ttft = stats(group.map((r) => r.ttftMs!));
  const tps = stats(group.map((r) => r.tokPerSec!));
  console.log(`  ${surface.padEnd(22)} n=${String(group.length).padEnd(3)} TTFT median ${String(ttft.median).padEnd(6)}ms  tok/s median ${tps.median}`);
}

// Large-input calls are reported separately: prefill dominates their TTFT and
// averaging them with 20-token calls would misrepresent both.
const big = withTiming.filter((r) => (r.in ?? 0) > 10_000);
if (big.length) {
  console.log("\nlarge-input calls (>10K prompt tokens), reported separately:");
  for (const r of big) console.log(`  ${r.label.padEnd(34)} in=${String(r.in).padEnd(7)} TTFT=${String(r.ttftMs).padEnd(7)}ms tok/s=${r.tokPerSec} cost=¥${r.costCny.toFixed(4)}`);
}
const piRows = billed.filter((r) => r.surface.startsWith("real-pi"));
if (piRows.length) {
  console.log("\nreal-pi rows (elapsed + first stdout byte, not TTFT):");
  for (const r of piRows) console.log(`  ${r.label.padEnd(34)} in=${String(r.in).padEnd(6)} out=${String(r.out).padEnd(5)} elapsed=${r.elapsedMs}ms cost=¥${r.costCny.toFixed(4)} | ${r.note?.slice(0, 110)}`);
}

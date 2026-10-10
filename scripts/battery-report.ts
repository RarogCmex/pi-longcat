/**
 * Re-score the battery from the SAVED bodies — no API calls, so the numbers in
 * the README can be regenerated (and re-checked) for free.
 *
 * Round 1's scorers ran inside the probe process and printed to its log; this
 * script re-derives them from `research/probes/*.json` (SSE streams) so a reader
 * can verify a claim without trusting a transcript. It also adds the two figures
 * round 1 did not compute: punctuation density for C1 (the mechanical proxy for
 * the review's "sentences 6-9 ungrammatical") and a per-cell truncation flag
 * (reasoning_tokens vs max_tokens), which is how the shared-budget invalidation
 * was found.
 *
 * Usage: node scripts/battery-report.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CN_NUMERALS, scoreC1 } from "../research/scoring.ts";

const PROBES = join(dirname(dirname(fileURLToPath(import.meta.url))), "research", "probes");

/** Reassemble the visible answer and the reasoning from a recorded SSE stream. */
function parseSse(file: string): { text: string; reasoning: string; usage?: any; finish?: string } {
  const raw = readFileSync(file, "utf8");
  let text = "";
  let reasoning = "";
  let usage: any;
  let finish: string | undefined;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    let event: any;
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }
    const delta = event.choices?.[0]?.delta;
    if (delta?.content) text += delta.content;
    if (delta?.reasoning_content) reasoning += delta.reasoning_content;
    if (event.choices?.[0]?.finish_reason) finish = event.choices[0].finish_reason;
    if (event.usage) usage = event.usage;
  }
  if (!text && !reasoning) {
    try {
      const json = JSON.parse(raw);
      text = json.choices?.[0]?.message?.content ?? "";
      reasoning = json.choices?.[0]?.message?.reasoning_content ?? "";
      usage = json.usage;
      finish = json.choices?.[0]?.finish_reason;
    } catch {
      /* not JSON either */
    }
  }
  return { text, reasoning, usage, finish };
}

const files = readdirSync(PROBES).filter((f) => /^(C1|C1b|C2|C3|C3b|C3c|C4|C6|C7)/.test(f)).sort();
console.log(`re-scoring ${files.length} battery bodies from ${PROBES}\n`);

console.log("## C1 — ten-sentence constraint task (mechanical)");
console.log("| body | lines | numerals in place | punctuation/line | reasoning tok | visible answer |");
console.log("|---|---|---|---|---|---|");
for (const f of files.filter((x) => /^C1/.test(x))) {
  const { text, usage, finish } = parseSse(join(PROBES, f));
  const s = scoreC1(text);
  console.log(`| \`${f}\` | ${s.lines} | ${s.correct}/10 | ${s.commasPerLine} | ${usage?.completion_tokens_details?.reasoning_tokens ?? "-"} | ${text.trim() ? `yes (${finish})` : `NONE (${finish}) — budget consumed by reasoning`} |`);
}
console.log(`\nnumerals expected, in order: ${CN_NUMERALS.join(" ")}`);

console.log("\n## C2 — answer language for English prompts (mechanical, CJK ratio)");
for (const f of files.filter((x) => /^C2/.test(x))) {
  const { text } = parseSse(join(PROBES, f));
  const chars = [...text.replace(/\s/g, "")];
  const cjk = chars.filter((c) => /[\u3400-\u9fff]/.test(c)).length;
  const ratio = chars.length ? cjk / chars.length : 0;
  console.log(`  ${f.padEnd(28)} ${ratio > 0.5 ? "CHINESE" : ratio > 0.05 ? "MIXED" : "ENGLISH"} (cjk ${(ratio * 100).toFixed(1)}%)`);
}

console.log("\n## C3/C4/C6/C7 — see the probe logs and the ledger rows");
for (const f of files.filter((x) => /^(C3|C4|C6|C7)/.test(x))) {
  const { text, usage, finish } = parseSse(join(PROBES, f));
  console.log(
    `  ${f.padEnd(34)} finish=${String(finish).padEnd(7)} out=${String(usage?.completion_tokens ?? "?").padEnd(6)} reasoning=${String(usage?.completion_tokens_details?.reasoning_tokens ?? "-").padEnd(6)} visible=${text.trim().length} chars`,
  );
}

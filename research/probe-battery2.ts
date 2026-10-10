/**
 * Priority C, round 2 — re-running the two battery cells that round 1 invalidated.
 *
 * Round 1 result, and why it is not a capability finding:
 *   C1 on LongCat-2.0   → "0/10 numerals, 0 lines"   with reasoning_tokens 2047
 *                         of max_tokens 2048 and NO visible content;
 *   C3 on 2.5-Preview   → "NO CODE BLOCK"            with reasoning_tokens 4095
 *                         of max_tokens 4096 and NO visible content.
 * Both were the shared-budget trap this plugin already documents (README
 * § Thinking: reasoning and the answer share `max_tokens`, and the gateway offers
 * no budget field — `thinking.budget_tokens` is measured ignored). The probe
 * design was wrong, not the model: it capped output below what thinking needed.
 * Re-running with an adequate cap is the honest fix, and the truncation itself is
 * a real finding worth keeping — it is what a caller that sets a small
 * `max_tokens` on a thinking-by-default model will get.
 *
 * Round 2 cells (KEY4, ≤¥5 battery budget; round 1 spent ¥0.33):
 *   C1b  ten-numeral constraint, LongCat-2.0, max_tokens 8192 (control for the
 *        2.5-Preview runs that passed at 2048) — 1 call;
 *   C3b  micro-coding, BOTH models, max_tokens 16384 with thinking on — 2 calls;
 *   C3c  micro-coding, 2.5-Preview, thinking OFF at 4096 — 1 call, which also
 *        measures the thinking×budget interaction on a real task.
 * Every cell is scored mechanically: C1 by numeral position + punctuation density,
 * C3 by actually EXECUTING the generated module against an independent 9-case
 * suite (and the model's own tests) with `node --test`.
 *
 * Usage: node research/probe-battery2.ts
 */
import { M20, M25, chat, loadKeys } from "./lib.ts";
import { C1_PROMPT, C3_PROMPT, extractBlocks, scoreC1, scoreC3 } from "./scoring.ts";

const KEY = process.env.LONGCAT_BATTERY_KEY ?? "KEY4";
if (!loadKeys()[KEY]) throw new Error(`${KEY} not present in secret.env`);
let spent = 0;
const findings: string[] = [];
function note(line: string): void {
  findings.push(line);
  console.log(`\n### ${line}`);
}
function tally(r: { costCny: number }): void {
  spent += r.costCny;
  if (spent > 2) throw new Error(`round-2 budget exhausted (¥${spent.toFixed(4)})`);
  console.log(`      cumulative round-2 spend on ${KEY}: ¥${spent.toFixed(6)}`);
}
const TODAY = "2026-10-11";

// ── C1b ──────────────────────────────────────────────────────────────────────
{
  const r = await chat(
    { model: M20, max_tokens: 8192, thinking: { type: "enabled" }, messages: [{ role: "user", content: C1_PROMPT }] },
    { keyId: KEY, label: "C1b-constraints-2.0-8k", purpose: "re-run of C1 on LongCat-2.0 with an adequate output cap (round 1 was truncated by reasoning at 2048)", bound: "max_tokens 8192, thinking enabled" },
  );
  tally(r);
  const s = scoreC1(r.text);
  note(
    `C1b LongCat-2.0 (${TODAY}, mechanical, max_tokens 8192): ${s.verdict} [${s.positions}] — out=${r.out} reasoning_tokens=${r.reasoningTokens} ` +
      `punctuation ${s.commasPerLine}/line. Round 1 at max_tokens 2048 produced NO visible answer (reasoning_tokens 2047), so the two are a paired measurement of the shared budget, not of the model.`,
  );
}

// ── C3b / C3c ────────────────────────────────────────────────────────────────
const cells: { label: string; model: string; thinking: "enabled" | "disabled"; maxTokens: number }[] = [
  { label: "C3b-microcoding-2.5-16k", model: M25, thinking: "enabled", maxTokens: 16_384 },
  { label: "C3b-microcoding-2.0-16k", model: M20, thinking: "enabled", maxTokens: 16_384 },
  { label: "C3c-microcoding-2.5-off-4k", model: M25, thinking: "disabled", maxTokens: 4_096 },
];
for (const cell of cells) {
  const r = await chat(
    { model: cell.model, max_tokens: cell.maxTokens, thinking: { type: cell.thinking }, messages: [{ role: "user", content: C3_PROMPT }] },
    { keyId: KEY, label: cell.label, purpose: `micro-coding re-run: ${cell.model}, thinking ${cell.thinking}, max_tokens ${cell.maxTokens}`, bound: `max_tokens ${cell.maxTokens}` },
  );
  tally(r);
  const blocks = extractBlocks(r.text);
  if (blocks.length === 0) {
    note(`C3 ${cell.label}: still NO CODE BLOCK (out=${r.out}, reasoning_tokens=${r.reasoningTokens}, finish=${r.finish}) — the answer never started.`);
    continue;
  }
  const scored = scoreC3(blocks[0]!, blocks[1]);
  console.log(`      ${cell.label}: theirs → ${scored.theirs.summary}; ours (9 cases) → ${scored.ours.summary}`);
  note(
    `C3 ${cell.model} / thinking ${cell.thinking} / max_tokens ${cell.maxTokens} (${TODAY}, mechanical — the code was EXECUTED): ` +
      `model's own tests ${scored.theirs.ok ? "PASS" : "FAIL"} (${scored.theirs.summary}); independent ${9}-case suite ${scored.ours.ok ? "PASS" : "FAIL"} (${scored.ours.summary}); ` +
      `out=${r.out} reasoning_tokens=${r.reasoningTokens ?? 0}; code kept in ${scored.dir}`,
  );
}

console.log("\n================ BATTERY ROUND 2 SUMMARY ================");
for (const f of findings) console.log(`• ${f}`);
console.log(`\nRound-2 spend: ¥${spent.toFixed(6)} on ${KEY}`);

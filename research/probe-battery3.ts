/**
 * Priority C, round 3 — the one C3 cell that round 2 lost to its own timeout.
 *
 * Round 2 ran 2.5-Preview at `max_tokens: 16384` with the library's default 120 s
 * wall clock; the model was still generating code when the guard fired, so the
 * cell produced no usage and no score (ledger row `C3b-microcoding-2.5-16k`,
 * class corrected to BILLED-uncaptured). The fix is a longer timeout, not a
 * smaller cap: shrinking the cap is what invalidated round 1 (reasoning ate the
 * whole budget). 600 s, one call, ≈¥0.15 worst case.
 *
 * Usage: node research/probe-battery3.ts
 */
import { M25, chat, loadKeys } from "./lib.ts";
import { C3_PROMPT, extractBlocks, scoreC3 } from "./scoring.ts";

const KEY = process.env.LONGCAT_BATTERY_KEY ?? "KEY4";
if (!loadKeys()[KEY]) throw new Error(`${KEY} not present in secret.env`);

const r = await chat(
  { model: M25, max_tokens: 16_384, thinking: { type: "enabled" }, messages: [{ role: "user", content: C3_PROMPT }] },
  {
    keyId: KEY,
    label: "C3d-microcoding-2.5-16k-600s",
    purpose: "micro-coding re-run on LongCat-2.5-Preview with a 600 s wall clock (round 2 was cut off at 120 s mid-generation)",
    bound: "max_tokens 16384, thinking enabled, 600 s timeout",
    timeoutMs: 600_000,
  },
);
console.log(`status=${r.status} out=${r.out} reasoning=${r.reasoningTokens} finish=${r.finish} cost=¥${r.costCny} elapsed=${r.elapsedMs}ms ttft=${r.ttftMs}ms ${r.tokPerSec} tok/s`);
const blocks = extractBlocks(r.text);
if (!blocks.length) {
  console.log(`NO CODE BLOCK (visible answer ${r.text.length} chars, reasoning ${r.reasoning.length} chars)`);
} else {
  const scored = scoreC3(blocks[0]!, blocks[1]);
  console.log(`blocks=${blocks.length} their tests: ${scored.theirs.summary}`);
  console.log(`independent 9-case suite: ${scored.ours.summary}`);
  console.log(`code kept in ${scored.dir}`);
}

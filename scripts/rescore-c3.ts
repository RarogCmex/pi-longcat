/**
 * Re-score the C3 micro-coding cells OFFLINE from the recorded SSE bodies.
 *
 * Why this exists: round 2's independent 9-case suite had a generator bug (test
 * names were interpolated unescaped into double-quoted JS literals, so the suite
 * itself was a SyntaxError) and reported FAIL for every model. The API calls were
 * already made and paid for, so the honest fix is to re-score from the saved
 * bodies rather than to spend again — and to keep the scorer in one module
 * (`research/scoring.ts`) so the original and the re-score cannot diverge.
 *
 * Usage: node scripts/rescore-c3.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { C3_CASES, extractBlocks, scoreC3 } from "../research/scoring.ts";

const PROBES = join(dirname(dirname(fileURLToPath(import.meta.url))), "research", "probes");

function answerOf(file: string): { text: string; out?: number; reasoning?: number; finish?: string } {
  const raw = readFileSync(file, "utf8");
  let text = "";
  let usage: any;
  let finish: string | undefined;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const d = t.slice(5).trim();
    if (!d || d === "[DONE]") continue;
    let e: any;
    try {
      e = JSON.parse(d);
    } catch {
      continue;
    }
    const delta = e.choices?.[0]?.delta;
    if (delta?.content) text += delta.content;
    if (e.choices?.[0]?.finish_reason) finish = e.choices[0].finish_reason;
    if (e.usage) usage = e.usage;
  }
  return { text, out: usage?.completion_tokens, reasoning: usage?.completion_tokens_details?.reasoning_tokens, finish };
}

const files = readdirSync(PROBES).filter((f) => /^C3/.test(f)).sort();
console.log(`re-scoring ${files.length} C3 bodies; independent suite has ${C3_CASES.length} cases\n`);
console.log("| body | finish | out tok | reasoning tok | code block? | model's own tests | independent 9-case suite |");
console.log("|---|---|---|---|---|---|---|");
for (const f of files) {
  const { text, out, reasoning, finish } = answerOf(join(PROBES, f));
  const blocks = extractBlocks(text);
  if (!blocks.length) {
    console.log(`| \`${f}\` | ${finish ?? "-"} | ${out ?? "-"} | ${reasoning ?? "-"} | NONE | – | – |`);
    continue;
  }
  const scored = scoreC3(blocks[0]!, blocks[1]);
  console.log(
    `| \`${f}\` | ${finish ?? "-"} | ${out ?? "-"} | ${reasoning ?? "-"} | yes (${blocks.length} block(s)) | ${scored.theirs.ok ? "PASS" : "FAIL"} — ${scored.theirs.summary} | ${scored.ours.ok ? "PASS" : "FAIL"} — ${scored.ours.summary} |`,
  );
  console.log(`| | | | | code kept: \`${scored.dir}\` | | |`);
}

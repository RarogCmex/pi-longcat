/**
 * Priority C — LongCat-2.5-Preview targeted battery (billed round, 2026-10-11).
 *
 * Derived from published third-party reviews, testing each complaint MECHANICALLY
 * where a mechanical score exists and flagging the rest as subjective with N and
 * date:
 *
 *  C1 strong-constraint instruction following — techgogogo.com (2026-09-26) found
 *     the constraints were kept (ten sentences ending 一…十 in order) but
 *     sentences 6-9 were ungrammatical. Replicated with the same task; compliance
 *     is scored by a regex over the numerals, grammaticality is reported as
 *     SUBJECTIVE (a human/reader judgement, N and date attached).
 *  C2 language consistency — the launch-day complaint was Chinese answers to
 *     English questions. Scored mechanically as the CJK character ratio of the
 *     answer.
 *  C3 verifiable micro-coding — the same prompt to 2.5-Preview and 2.0; the
 *     generated code is written to a temp file and **executed** with
 *     `node --test`, so the score is pass/fail from a real run, not a vibe.
 *  C4 harness dependence — eesel.ai's 2.0 review found agent-loop users rave and
 *     one-shot prompters complain. The one-shot side is measured here on the same
 *     task the real-pi agent loop gets in Priority B; the comparison is written up
 *     in the README, since the loop side runs inside pi.
 *  C5 latency/throughput — every billed call of this round records TTFT and
 *     output tokens/second in the ledger (`research/lib.ts`); the summary table is
 *     produced from the ledger by `scripts/latency-report.ts`.
 *  C6 mid-context coherence (operator-optional, ≤¥1) — a ~50K-token input with a
 *     unique needle; also a data point on large-input acceptance without a 1M fill.
 *  C7 effort-style fields — thinking is on/off only (techgogogo independently
 *     confirms the zai finding). Whatever effort-style field is sent, record
 *     accepted vs HONOURED via reasoning_tokens.
 *
 * Budget: ≤¥5 total, on KEY4 by default (a separate key from the cache suite's
 * KEY1 and the tool suite's KEY2, so the ≤¥1-per-key cap is not shared and a
 * per-key rate limit cannot cross-contaminate results).
 *
 * Usage: node research/probe-battery.ts [--skip-needle]
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { M20, M25, chat, loadKeys, uniquePrefix } from "./lib.ts";

const KEY = process.env.LONGCAT_BATTERY_KEY ?? "KEY4";
if (!loadKeys()[KEY]) throw new Error(`${KEY} not present in secret.env`);
const SKIP_NEEDLE = process.argv.includes("--skip-needle");
const HARD_BUDGET = Number(process.env.LONGCAT_BATTERY_BUDGET ?? "5");

let spent = 0;
const findings: string[] = [];
function note(line: string): void {
  findings.push(line);
  console.log(`\n### ${line}`);
}
function tally(r: { costCny: number }): void {
  spent += r.costCny;
  if (spent > HARD_BUDGET) throw new Error(`battery budget exhausted (¥${spent.toFixed(4)})`);
  console.log(`      cumulative battery spend on ${KEY}: ¥${spent.toFixed(6)} of ¥${HARD_BUDGET}`);
}

const TODAY = "2026-10-11";

// ── C1: strong-constraint instruction following ──────────────────────────────
const CN = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const C1_PROMPT =
  "Write exactly ten sentences about the history of the Great Wall of China. " +
  "Requirements: (1) exactly ten sentences, each on its own line; (2) sentence 1 must end with the character 一, " +
  "sentence 2 with 二, sentence 3 with 三, sentence 4 with 四, sentence 5 with 五, sentence 6 with 六, " +
  "sentence 7 with 七, sentence 8 with 八, sentence 9 with 九, sentence 10 with 十; " +
  "(3) each line must end with that character and nothing after it; (4) no numbering, no bullets.";

function scoreC1(text: string): { lines: number; correct: number; positions: string; verdict: string } {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const positions: string[] = [];
  let correct = 0;
  for (let i = 0; i < 10; i++) {
    const line = lines[i] ?? "";
    const last = [...line].pop() ?? "";
    const hit = last === CN[i];
    if (hit) correct++;
    positions.push(hit ? CN[i]! : `${i + 1}:${last || "∅"}`);
  }
  return {
    lines: lines.length,
    correct,
    positions: positions.join(" "),
    verdict: lines.length === 10 && correct === 10 ? "FULL COMPLIANCE" : `${correct}/10 numerals in place, ${lines.length} lines`,
  };
}

note(`C1 — strong-constraint instruction following (review: techgogogo.com ${"2026-09-26"}), N=3 on 2.5-Preview + N=1 control on 2.0`);
for (const [model, trials] of [[M25, 3], [M20, 1]] as const) {
  for (let i = 1; i <= trials; i++) {
    const r = await chat(
      { model, max_tokens: 2048, thinking: { type: "enabled" }, messages: [{ role: "user", content: C1_PROMPT }] },
      {
        keyId: KEY,
        label: `C1-constraints-${model === M25 ? "2.5" : "2.0"}-trial${i}`,
        purpose: `ten sentences ending 一…十 in order: mechanical compliance score, trial ${i}/${trials}`,
        bound: "max_tokens 2048, thinking enabled",
      },
    );
    tally(r);
    const s = scoreC1(r.text);
    console.log(`      C1 ${model} #${i}: ${s.verdict} [${s.positions}] (out=${r.out} ttft=${r.ttftMs}ms ${r.tokPerSec} tok/s)`);
    if (i === 1 || model === M20) {
      note(
        `C1 ${model} trial ${i}: ${s.verdict}. SUBJECTIVE (N=1, ${TODAY}, judged by the agent reading the output, not by a native-speaker panel): ` +
          `sentences 6-9 ${/六|七|八|九/.test(r.text) ? "were produced; grammaticality assessment recorded in research/probes/C1-*.json for a human to re-read" : "missing"}.`,
      );
    }
  }
}

// ── C2: language consistency ─────────────────────────────────────────────────
note(`C2 — language consistency: English prompt, answer language scored by CJK ratio, N=5 on 2.5-Preview`);
const C2_PROMPTS = [
  "Explain in two sentences what a mutex is.",
  "List three ways to reduce latency in a REST API.",
  "What does the acronym TTL usually mean in networking?",
  "Write one sentence describing what git rebase does.",
  "Name two differences between TCP and UDP.",
];
{
  const rows: { prompt: number; cjkRatio: number; lang: string }[] = [];
  for (let i = 0; i < C2_PROMPTS.length; i++) {
    const r = await chat(
      { model: M25, max_tokens: 300, thinking: { type: "disabled" }, messages: [{ role: "user", content: C2_PROMPTS[i] }] },
      { keyId: KEY, label: `C2-language-${i + 1}of5`, purpose: `English prompt → answer language (CJK ratio): "${C2_PROMPTS[i]!.slice(0, 40)}…"`, bound: "max_tokens 300, thinking disabled" },
    );
    tally(r);
    const chars = [...r.text.replace(/\s/g, "")];
    const cjk = chars.filter((c) => /[\u3400-\u9fff]/.test(c)).length;
    const ratio = chars.length ? cjk / chars.length : 0;
    const lang = ratio > 0.5 ? "CHINESE" : ratio > 0.05 ? "MIXED" : "ENGLISH";
    rows.push({ prompt: i + 1, cjkRatio: ratio, lang });
    console.log(`      C2 #${i + 1}: ${lang} (cjk ${(ratio * 100).toFixed(1)}%) ${JSON.stringify(r.text.slice(0, 90))}`);
  }
  const bad = rows.filter((x) => x.lang !== "ENGLISH");
  note(`C2 verdict: ${rows.length - bad.length}/${rows.length} answers in English${bad.length ? `, off-language on prompts [${bad.map((b) => b.prompt).join(", ")}]` : ""} (mechanical, N=${rows.length}, ${TODAY}). The launch-day complaint was Chinese answers to English questions.`);
}

// ── C7: effort-style fields — accepted vs HONOURED ───────────────────────────
note("C7 — thinking has only on/off: what happens to effort-style fields (accepted vs honoured, read from reasoning_tokens)");
{
  const variants: { label: string; extra: Record<string, unknown> }[] = [
    { label: "none-baseline", extra: { thinking: { type: "enabled" } } },
    { label: "reasoning_effort-low", extra: { thinking: { type: "enabled" }, reasoning_effort: "low" } },
    { label: "reasoning_effort-high", extra: { thinking: { type: "enabled" }, reasoning_effort: "high" } },
    { label: "thinking-budget_tokens-32", extra: { thinking: { type: "enabled", budget_tokens: 32 } } },
  ];
  const out: string[] = [];
  for (const v of variants) {
    const r = await chat(
      { model: M25, max_tokens: 256, messages: [{ role: "user", content: "Count from 1 to 30, separated by spaces." }], ...v.extra },
      { keyId: KEY, label: `C7-effort-${v.label}`, purpose: `2.5-Preview: is ${v.label} accepted, and is it HONOURED (reasoning_tokens)?`, bound: "max_tokens 256" },
    );
    tally(r);
    out.push(`${v.label}: status=${r.status} reasoning_tokens=${r.reasoningTokens ?? "?"} out=${r.out ?? "?"}${r.error ? ` error=${r.error.slice(0, 80)}` : ""}`);
    console.log(`      C7 ${out[out.length - 1]}`);
  }
  note(`C7 verdict: ${out.join(" | ")} ⇒ a field that returns 200 and does not move reasoning_tokens is accepted-and-ignored, which is why supportsReasoningEffort is false and no thinkingTokenBudgetField is declared.`);
}

// ── C3: verifiable micro-coding — the code is EXECUTED, not eyeballed ────────
const C3_PROMPT = `Write a JavaScript ES module that exports one function:

  export function parseDuration(input)

It converts a human duration string into an integer number of MILLISECONDS.
Supported unit suffixes: ms, s, m, h, d (case-insensitive), and compounds such as
"1h30m", "2d", "45s", "500ms", "1h", "90m". Unknown units, negative numbers and
garbage must throw a RangeError. Whitespace between parts is allowed.

Answer with EXACTLY two fenced code blocks and nothing else:
1. the module file (solution.mjs) — the function only, no tests, no imports;
2. a node:test file (their.test.mjs) that imports { parseDuration } from "./solution.mjs"
   and covers at least six cases.`;

const C3_CASES: [string, number | "throw"][] = [
  ["500ms", 500],
  ["45s", 45_000],
  ["2m", 120_000],
  ["1h30m", 5_400_000],
  ["2d", 172_800_000],
  [" 90m ", 5_400_000],
  ["1H", 3_600_000],
  ["banana", "throw"],
  ["-5s", "throw"],
];

function extractBlocks(text: string): string[] {
  const out: string[] = [];
  const re = /```(?:[a-zA-Z]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]!.trim());
  return out;
}

function runNodeTest(dir: string, file: string): { ok: boolean; summary: string } {
  try {
    const out = execFileSync(process.execPath, ["--test", file], { cwd: dir, encoding: "utf8", timeout: 45_000, stdio: ["ignore", "pipe", "pipe"] });
    const pass = /# pass (\d+)/.exec(out)?.[1] ?? /\bpass (\d+)/.exec(out)?.[1] ?? "?";
    const fail = /# fail (\d+)/.exec(out)?.[1] ?? /\bfail (\d+)/.exec(out)?.[1] ?? "?";
    return { ok: true, summary: `exit 0, pass ${pass}, fail ${fail}` };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    const text = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    const fail = /# fail (\d+)/.exec(text)?.[1] ?? "?";
    const firstError = (/Error \[[^\]]*\][^\n]*|AssertionError[^\n]*|SyntaxError[^\n]*|TypeError[^\n]*|ReferenceError[^\n]*/.exec(text)?.[0] ?? text.split("\n")[0] ?? "").slice(0, 160);
    return { ok: false, summary: `exit ${err.status ?? "?"}, fail ${fail}: ${firstError}` };
  }
}

note("C3 — verifiable micro-coding: identical prompt to both models, generated code EXECUTED with node --test (objective pass/fail)");
for (const model of [M25, M20]) {
  const r = await chat(
    { model, max_tokens: 4096, thinking: { type: "enabled" }, messages: [{ role: "user", content: C3_PROMPT }] },
    { keyId: KEY, label: `C3-microcoding-${model === M25 ? "2.5" : "2.0"}`, purpose: `parseDuration module + tests, then executed locally: ${model}`, bound: "max_tokens 4096, thinking enabled" },
  );
  tally(r);
  const blocks = extractBlocks(r.text);
  const dir = mkdtempSync(join(tmpdir(), "longcat-c3-"));
  if (blocks.length < 1) {
    note(`C3 ${model}: NO CODE BLOCK in the answer (out=${r.out}, finish=${r.finish}) — scored FAIL without execution.`);
    continue;
  }
  writeFileSync(join(dir, "solution.mjs"), blocks[0]!);
  let theirResult = { ok: false, summary: "no second block (no tests supplied)" };
  if (blocks[1]) {
    writeFileSync(join(dir, "their.test.mjs"), blocks[1]!);
    theirResult = runNodeTest(dir, "their.test.mjs");
  }
  // Our own cases, so a vacuous self-test cannot produce a pass.
  const mine = [
    `import test from "node:test"; import assert from "node:assert/strict";`,
    `import { parseDuration } from "./solution.mjs";`,
    ...C3_CASES.map(([input, expected], i) =>
      expected === "throw"
        ? `test("case${i} throws for ${JSON.stringify(input)}", () => { assert.throws(() => parseDuration(${JSON.stringify(input)}), RangeError); });`
        : `test("case${i} ${JSON.stringify(input)}", () => { assert.equal(parseDuration(${JSON.stringify(input)}), ${expected}); });`,
    ),
  ].join("\n");
  writeFileSync(join(dir, "mine.test.mjs"), mine);
  const mineResult = runNodeTest(dir, "mine.test.mjs");
  console.log(`      C3 ${model}: their tests → ${theirResult.summary}; independent ${C3_CASES.length}-case suite → ${mineResult.summary}`);
  note(
    `C3 ${model} (${TODAY}, mechanical): model-supplied tests ${theirResult.ok ? "PASS" : "FAIL"} (${theirResult.summary}); ` +
      `independent ${C3_CASES.length}-case suite ${mineResult.ok ? "PASS" : "FAIL"} (${mineResult.summary}). Code kept in ${dir}.`,
  );
}

// ── C4: harness dependence — the one-shot side of the comparison ─────────────
const HARNESS_LINES = ["alpha", "a much longer line here", "bb", "medium line", "x"];
const HARNESS_EXPECTED = [...HARNESS_LINES]
  .sort((a, b) => b.length - a.length)
  .map((line, i) => `${i + 1}: ${line}`)
  .join("\n");
const C4_TASK = `Here is the content of a file named input.txt (one item per line):

${HARNESS_LINES.join("\n")}

Produce the content of output.txt: the lines sorted by LENGTH, longest first, each
prefixed with its 1-based position and a colon (for example "1: longest line").
Ties keep their original relative order. Answer with the file content in one fenced
code block, then a final line reading exactly: DONE <number of lines>`;

note("C4 — harness dependence (review: eesel.ai on 2.0): the ONE-SHOT side of the task the pi agent loop also gets");
for (const model of [M25, M20]) {
  const r = await chat(
    { model, max_tokens: 600, thinking: { type: "enabled" }, messages: [{ role: "user", content: C4_TASK }] },
    { keyId: KEY, label: `C4-oneshot-${model === M25 ? "2.5" : "2.0"}`, purpose: `one-shot harness-dependence task, ${model}: exact-match scoring`, bound: "max_tokens 600, thinking enabled" },
  );
  tally(r);
  const block = extractBlocks(r.text)[0] ?? "";
  const produced = block.replace(/\s+$/, "");
  const doneLine = /DONE\s+(\d+)/.exec(r.text)?.[1];
  const exact = produced === HARNESS_EXPECTED;
  console.log(`      C4 ${model}: exact=${exact} DONE=${doneLine ?? "missing"} produced=${JSON.stringify(produced.slice(0, 120))}`);
  note(
    `C4 one-shot ${model} (${TODAY}, mechanical): output.txt content ${exact ? "EXACT MATCH" : `DIFFERS (got ${JSON.stringify(produced.slice(0, 80))})`}, report line ${doneLine === String(HARNESS_LINES.length) ? "correct" : `wrong or missing (${doneLine ?? "none"})`}. Compare with the agent-loop result in the README table.`,
  );
}

// ── C6: mid-context coherence with a ~50K-token needle ───────────────────────
if (!SKIP_NEEDLE) {
  note("C6 — mid-context coherence: ~50K-token input with a unique needle (also a large-input acceptance data point, without a 1M fill)");
  const filler = uniquePrefix("C6-filler", 1150); // ≈50K tokens measured on the first call
  for (const [position, needle, at] of [
    ["middle", "ZQX-7734-MIDDLE", 0.5],
    ["end", "ZQX-7734-ENDTAIL", 0.98],
  ] as const) {
    const lines = filler.split("\n");
    const idx = Math.min(lines.length - 2, Math.floor(lines.length * at));
    lines.splice(idx, 0, `IMPORTANT: the magic token for this document is ${needle}. Remember it exactly.`);
    const doc = lines.join("\n");
    const r = await chat(
      {
        model: M25,
        max_tokens: 64,
        thinking: { type: "disabled" },
        messages: [
          { role: "system", content: doc },
          { role: "user", content: "What is the magic token for this document? Reply with only the token, nothing else." },
        ],
      },
      {
        keyId: KEY,
        label: `C6-needle-${position}`,
        purpose: `~50K-token context with a unique needle at ${Math.round(at * 100)}% depth: retrieved exactly?`,
        bound: "max_tokens 64, thinking disabled, one call per position",
        timeoutMs: 300_000,
      },
    );
    tally(r);
    const answer = r.text.trim();
    const exact = answer === needle;
    console.log(`      C6 ${position}: prompt=${r.in} ttft=${r.ttftMs}ms answer=${JSON.stringify(answer.slice(0, 60))} exact=${exact}`);
    note(
      `C6 needle at ${Math.round(at * 100)}% depth (${TODAY}, mechanical): prompt_tokens=${r.in}, answer ${exact ? "EXACT" : `WRONG (${JSON.stringify(answer.slice(0, 40))} vs ${needle})`}, ` +
        `TTFT ${r.ttftMs}ms, ${r.tokPerSec ?? "?"} tok/s, cost ¥${r.costCny.toFixed(4)}.`,
    );
  }
}

console.log("\n================ BATTERY SUMMARY ================");
for (const f of findings) console.log(`• ${f}`);
console.log(`\nTotal battery spend: ¥${spent.toFixed(6)} (~$${(spent / 6.7252).toFixed(6)}) on ${KEY}, hard budget ¥${HARD_BUDGET}`);

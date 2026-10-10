/**
 * Mechanical scorers shared by the battery rounds.
 *
 * Kept in one module because the same task gets re-run when a first attempt is
 * invalidated (round 1 of C1/C3 was truncated by the shared thinking budget, see
 * probe-battery2.ts), and a re-run that scores differently from the original is
 * worse than no re-run at all.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CN_NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

export interface C1Score {
  lines: number;
  correct: number;
  positions: string;
  /** Punctuation density: commas/periods per line. A constraint task that ends
   *  every line with a bare numeral tends to suppress punctuation globally, which
   *  is the mechanical proxy for the review's "sentences 6-9 ungrammatical". */
  commasPerLine: number;
  verdict: string;
}

export function scoreC1(text: string): C1Score {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const positions: string[] = [];
  let correct = 0;
  for (let i = 0; i < 10; i++) {
    const line = lines[i] ?? "";
    const last = [...line].pop() ?? "";
    const hit = last === CN_NUMERALS[i];
    if (hit) correct++;
    positions.push(hit ? CN_NUMERALS[i]! : `${i + 1}:${last || "EMPTY"}`);
  }
  const commas = (text.match(/[,.，、;；]/g) ?? []).length;
  return {
    lines: lines.length,
    correct,
    positions: positions.join(" "),
    commasPerLine: lines.length ? Math.round((commas / lines.length) * 100) / 100 : 0,
    verdict: lines.length === 0 ? "NO VISIBLE ANSWER (output budget consumed by reasoning)" : lines.length === 10 && correct === 10 ? "FULL COMPLIANCE" : `${correct}/10 numerals in place, ${lines.length} lines`,
  };
}

export function extractBlocks(text: string): string[] {
  const out: string[] = [];
  const re = /```(?:[a-zA-Z]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]!.trim());
  return out;
}

/**
 * Pass/fail counts from `node --test` output. Node's reporter changed shape
 * across majors (TAP `# pass N`, spec `ℹ pass N`, and plain `pass N`), so all
 * three are tried — a "?" in a published table is how a scorer that cannot read
 * its own runner sneaks into a report.
 */
function counts(text: string): string {
  const grab = (label: string) =>
    new RegExp(`(?:^|\\s)(?:#|ℹ)?\\s*${label}\\s+(\\d+)`, "m").exec(text)?.[1] ?? "?";
  return `pass ${grab("pass")}, fail ${grab("fail")}`;
}

export function runNodeTest(dir: string, file: string): { ok: boolean; summary: string } {
  try {
    const out = execFileSync(process.execPath, ["--test", file], { cwd: dir, encoding: "utf8", timeout: 45_000, stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, summary: `exit 0, ${counts(out)}` };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    const text = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    const firstError = (/AssertionError[^\n]*|SyntaxError[^\n]*|TypeError[^\n]*|ReferenceError[^\n]*|Error \[[^\]]*\][^\n]*|Error: [^\n]*/.exec(text)?.[0] ?? text.split("\n")[0] ?? "").slice(0, 160);
    return { ok: false, summary: `exit ${err.status ?? "?"}, ${counts(text)}: ${firstError}` };
  }
}

export const C3_PROMPT = `Write a JavaScript ES module that exports one function:

  export function parseDuration(input)

It converts a human duration string into an integer number of MILLISECONDS.
Supported unit suffixes: ms, s, m, h, d (case-insensitive), and compounds such as
"1h30m", "2d", "45s", "500ms", "1h", "90m". Unknown units, negative numbers and
garbage must throw a RangeError. Whitespace between parts is allowed.

Answer with EXACTLY two fenced code blocks and nothing else:
1. the module file (solution.mjs) — the function only, no tests, no imports;
2. a node:test file (their.test.mjs) that imports { parseDuration } from "./solution.mjs"
   and covers at least six cases.`;

export const C3_CASES: [string, number | "throw"][] = [
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

/** Write the model's module + its own tests + our independent suite, run both. */
export function scoreC3(moduleCode: string, theirTests: string | undefined): { dir: string; theirs: { ok: boolean; summary: string }; ours: { ok: boolean; summary: string } } {
  const dir = mkdtempSync(join(tmpdir(), "longcat-c3-"));
  writeFileSync(join(dir, "solution.mjs"), moduleCode);
  const theirs = theirTests
    ? (writeFileSync(join(dir, "their.test.mjs"), theirTests), runNodeTest(dir, "their.test.mjs"))
    : { ok: false, summary: "no second block (no tests supplied)" };
  const mine = [
    `import test from "node:test"; import assert from "node:assert/strict";`,
    `import { parseDuration } from "./solution.mjs";`,
    // Test NAMES are JSON.stringify'd too: interpolating a quoted string into a
    // double-quoted JS literal produced `test("case0 "500ms"", …)` — a SyntaxError
    // in the generated suite, which round 2 mis-reported as the model's failure.
    ...C3_CASES.map(([input, expected], i) =>
      expected === "throw"
        ? `test(${JSON.stringify(`case${i} throws for ${input}`)}, () => { assert.throws(() => parseDuration(${JSON.stringify(input)}), RangeError); });`
        : `test(${JSON.stringify(`case${i} ${input}`)}, () => { assert.equal(parseDuration(${JSON.stringify(input)}), ${expected}); });`,
    ),
  ].join("\n");
  writeFileSync(join(dir, "mine.test.mjs"), mine);
  return { dir, theirs, ours: runNodeTest(dir, "mine.test.mjs") };
}

export const C1_PROMPT =
  "Write exactly ten sentences about the history of the Great Wall of China. " +
  "Requirements: (1) exactly ten sentences, each on its own line; (2) sentence 1 must end with the character 一, " +
  "sentence 2 with 二, sentence 3 with 三, sentence 4 with 四, sentence 5 with 五, sentence 6 with 六, " +
  "sentence 7 with 七, sentence 8 with 八, sentence 9 with 九, sentence 10 with 十; " +
  "(3) each line must end with that character and nothing after it; (4) no numbering, no bullets.";

export const HARNESS_LINES = ["alpha", "a much longer line here", "bb", "medium line", "x"];
export const HARNESS_EXPECTED = [...HARNESS_LINES].sort((a, b) => b.length - a.length).map((l, i) => `${i + 1}: ${l}`).join("\n");

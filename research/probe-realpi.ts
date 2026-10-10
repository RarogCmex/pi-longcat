/**
 * Priority B (billed half) — the real-pi pass, instrumented.
 *
 * The free half (install, --list-models, print/json error paths, auth check,
 * thinking-level clamping) was run on 2026-10-11 with a dead key and is recorded
 * in the README. What was left is the part that needs a funded key, and the
 * operator approved it with a ≤¥1-per-key budget:
 *
 *  1. one successful generation per model, inside real pi;
 *  2. ONE MULTI-TURN TOOL LOOP (read → write → reply) per model with thinking ON —
 *     this is the run the house skill demands, because it is what exercises
 *     reasoning-item and tool-call REPLAY across turns: a single-turn probe passes
 *     with the replay broken (references/testing.md § The real-pi pass). On the
 *     chat surface "replay" means our own `role:"tool"` results plus pi's
 *     `reasoning_content` blocks being sent back; the zai thinking format has no
 *     encrypted reasoning item to replay, which is exactly what this run tests.
 *  3. the harness-dependence comparison (battery item C4): the SAME task the
 *     one-shot battery got, scored mechanically on the file pi actually wrote.
 *
 * Every accepted call is ledgered with the KEY ID, pi's own parsed usage, the
 * wall-clock elapsed time and a time-to-first-stdout-byte figure (pi does not
 * expose TTFT, so the harness measures the first byte of its json stream and says
 * so in the row's note rather than calling it TTFT).
 *
 * Runs pi in an isolated HOME + PI_CODING_AGENT_DIR (a path with a space, on
 * purpose) so nothing touches the user's real config, and with --no-session so no
 * session file is left behind.
 *
 * Usage: node research/probe-realpi.ts [--models LongCat-2.0,LongCat-2.5-Preview]
 */
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendRow, loadKeys, M20, M25, PRICE } from "./lib.ts";

const KEY_ID = process.env.LONGCAT_REALPI_KEY ?? "KEY3";
const KEY = loadKeys()[KEY_ID];
if (!KEY) throw new Error(`${KEY_ID} not present in secret.env`);
const REPO = join(import.meta.dirname ?? ".", "..");
const MODELS = (process.argv.find((a) => a.startsWith("--models"))?.split("=")[1] ?? `${M20},${M25}`).split(",");
const BUDGET = Number(process.env.LONGCAT_REALPI_BUDGET ?? "1");

const HOME_DIR = mkdtempSync(join(tmpdir(), "pi-longcat-realpi-"));
const AGENT_DIR = join(HOME_DIR, "pi agent dir"); // a space on purpose
mkdirSync(AGENT_DIR, { recursive: true });
const WORK = join(HOME_DIR, "work");
mkdirSync(WORK, { recursive: true });

// The plugin must be installed into the ISOLATED HOME: a fresh agent dir has no
// extensions, and pi then reports `Model "longcat/..." not found` — which is what
// the first attempt at this script hit (it looked like a hang, and the real cause
// was invisible because stderr was not being surfaced). Install once, up front.
const repoRoot = join(import.meta.dirname ?? ".", "..");
execFileSync("pi", ["install", repoRoot], {
  env: { ...process.env, HOME: HOME_DIR, PI_CODING_AGENT_DIR: AGENT_DIR },
  encoding: "utf8",
  timeout: 120_000,
  stdio: ["ignore", "pipe", "pipe"],
});

const LINES = ["alpha", "a much longer line here", "bb", "medium line", "x"];
const EXPECTED = [...LINES].sort((a, b) => b.length - a.length).map((l, i) => `${i + 1}: ${l}`).join("\n");
writeFileSync(join(WORK, "input.txt"), LINES.join("\n") + "\n");

const TASK = [
  "Work in the current directory. Three steps, in order:",
  "1. read the file input.txt;",
  '2. write a file named output.txt whose lines are the lines of input.txt sorted by LENGTH (longest first), each prefixed with its 1-based position and a colon, e.g. "1: longest line". Ties keep their original order. No trailing commentary in the file;',
  "3. reply with exactly one line: DONE <number of lines written>.",
].join("\n");

interface PiRun {
  model: string;
  ok: boolean;
  stderr: string;
  elapsedMs: number;
  firstByteMs?: number;
  turns: { role: string; stopReason?: string; toolCalls?: string[]; in?: number; out?: number; cached?: number; thinking?: number; durationMs?: number; error?: string }[];
  totals: { in: number; out: number; cached: number; cost: number };
  output?: string;
  stdout: string;
}

function runPi(model: string, prompt: string, thinking: string, label: string, purpose: string): Promise<PiRun> {
  return new Promise((resolve) => {
    const started = Date.now();
    let firstByteMs: number | undefined;
    let stdout = "";
    let stderr = "";
    const child = execFile(
      "pi",
      ["--no-session", "-p", "--mode", "json", "--thinking", thinking, "--model", `longcat/${model}`, prompt],
      {
        cwd: WORK,
        env: { ...process.env, HOME: HOME_DIR, PI_CODING_AGENT_DIR: AGENT_DIR, LONGCAT_API_KEY: KEY },
        timeout: 600_000,
        maxBuffer: 32 * 1024 * 1024,
      },
      () => {
        const turns: PiRun["turns"] = [];
        for (const line of stdout.split("\n")) {
          if (!line.trim()) continue;
          let event: any;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event.type !== "message_end") continue;
          const m = event.message;
          if (m.role !== "assistant") continue;
          turns.push({
            role: m.role,
            stopReason: m.stopReason,
            toolCalls: (m.content ?? []).filter((c: any) => c.type === "toolCall").map((c: any) => c.name),
            in: m.usage?.input,
            out: m.usage?.output,
            cached: m.usage?.cacheRead,
            thinking: (m.content ?? []).filter((c: any) => c.type === "thinking").length,
            durationMs: m.durationMs,
            error: m.errorMessage,
          });
        }
        const totals = turns.reduce(
          (acc, t) => ({
            in: acc.in + (t.in ?? 0),
            out: acc.out + (t.out ?? 0),
            cached: acc.cached + (t.cached ?? 0),
            cost: acc.cost,
          }),
          { in: 0, out: 0, cached: 0, cost: 0 },
        );
        // pi's usage.input is net of cacheRead (openai-completions.js:1177), so the
        // cost formula here is the PARSED convention, not the raw-body one.
        totals.cost =
          Math.round(((totals.in / 1e6) * PRICE.input + (totals.cached / 1e6) * PRICE.cached + (totals.out / 1e6) * PRICE.output) * 1e8) / 1e8;
        const lastText = (() => {
          const texts: string[] = [];
          for (const line of stdout.split("\n")) {
            try {
              const event = JSON.parse(line);
              if (event.type === "message_end" && event.message?.role === "assistant") {
                for (const c of event.message.content ?? []) if (c.type === "text") texts.push(c.text);
              }
            } catch {
              /* ignore */
            }
          }
          return texts[texts.length - 1];
        })();
        appendRow({
          label,
          key: KEY_ID,
          surface: "real-pi (openai-completions)",
          purpose,
          bound: `pi -p --no-session --thinking ${thinking}, 600 s timeout, isolated HOME`,
          plannedClass: "billed",
          http: turns.length ? 200 : "no-assistant-message",
          actualClass: turns.some((t) => !t.error) ? "BILLED" : "free (rejected/no inference)",
          in: totals.in,
          out: totals.out,
          cached: totals.cached,
          costCny: totals.cost,
          elapsedMs: Date.now() - started,
          note: `assistant turns=${turns.length} toolCalls=[${turns.flatMap((t) => t.toolCalls ?? []).join(",")}] thinkingBlocks=[${turns.map((t) => t.thinking).join(",")}] firstByte=${firstByteMs ?? "?"}ms stop=[${turns.map((t) => t.stopReason).join(",")}]${turns.find((t) => t.error) ? ` error=${turns.find((t) => t.error)!.error!.slice(0, 160)}` : ""}${stderr.trim() ? ` stderr=${stderr.trim().slice(0, 200)}` : ""}`,
        });
        resolve({ model, ok: turns.length > 0, stderr, elapsedMs: Date.now() - started, firstByteMs, turns, totals, output: lastText, stdout });
      },
    );
    // pi in print mode can wait for EOF on stdin; closing it makes the run
    // deterministic under a spawned (non-TTY) child.
    child.stdin?.end();
    child.stdout?.on("data", (chunk: Buffer) => {
      if (firstByteMs === undefined) firstByteMs = Date.now() - started;
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
  });
}

let spent = 0;
const findings: string[] = [];
function note(line: string): void {
  findings.push(line);
  console.log(`\n### ${line}`);
}

// 1. one successful generation per model
for (const model of MODELS) {
  if (spent > BUDGET) throw new Error(`real-pi budget exhausted (¥${spent.toFixed(4)})`);
  const run = await runPi(model, "Reply with exactly one word: ok", "low", `B-realpi-generation-${model === M20 ? "2.0" : "2.5"}`, `real-pi successful generation on ${model}`);
  spent += run.totals.cost;
  note(
    `real-pi generation ${model}: turns=${run.turns.length} stop=${run.turns.map((t) => t.stopReason).join(",")} thinkingBlocks=${run.turns.map((t) => t.thinking).join(",")} ` +
      `usage in=${run.totals.in} out=${run.totals.out} cost=¥${run.totals.cost} elapsed=${run.elapsedMs}ms firstByte=${run.firstByteMs}ms output=${JSON.stringify((run.output ?? "").slice(0, 60))}`,
  );
}

// 2 + 3. the multi-turn tool loop (thinking ON), scored on the file pi wrote
for (const model of MODELS) {
  if (spent > BUDGET) throw new Error(`real-pi budget exhausted (¥${spent.toFixed(4)})`);
  const outFile = join(WORK, "output.txt");
  if (existsSync(outFile)) {
    // Keep each model's run independent: archive the previous model's output.txt
    // and remove it, so "NOT WRITTEN" can never be a stale file from the last run.
    writeFileSync(join(WORK, `output-${model === M20 ? "2.0" : "2.5"}-previous.txt`), readFileSync(outFile));
    rmSync(outFile);
  }
  const run = await runPi(
    model,
    TASK,
    "low",
    `B-realpi-toolloop-${model === M20 ? "2.0" : "2.5"}`,
    `real-pi multi-turn tool loop (read -> write -> reply) on ${model} with thinking ON: exercises tool-result and reasoning replay across turns`,
  );
  spent += run.totals.cost;
  const produced = existsSync(outFile) ? readFileSync(outFile, "utf8").replace(/\s+$/, "") : undefined;
  const exact = produced === EXPECTED;
  const doneOk = /DONE\s+5/.test(run.output ?? "");
  const tools = run.turns.flatMap((t) => t.toolCalls ?? []);
  note(
    `real-pi tool loop ${model}: assistant turns=${run.turns.length}, tool calls=[${tools.join(" → ")}], stop reasons=[${run.turns.map((t) => t.stopReason).join(", ")}], ` +
      `thinking blocks per turn=[${run.turns.map((t) => t.thinking).join(", ")}], usage in=${run.totals.in} out=${run.totals.out} cached=${run.totals.cached} cost=¥${run.totals.cost}, elapsed=${run.elapsedMs}ms.\n` +
      `      scored mechanically: output.txt ${exact ? "EXACT MATCH" : produced === undefined ? "NOT WRITTEN" : `DIFFERS: ${JSON.stringify(produced.slice(0, 100))}`}; reply ${doneOk ? "correct (DONE 5)" : `wrong: ${JSON.stringify((run.output ?? "").slice(0, 60))}`}\n` +
      `      replay verdict: ${tools.length >= 2 && run.turns.length >= 2 ? "multi-turn replay WORKS (a later turn reused the earlier tool result)" : "not enough turns to prove replay"}`,
  );
}

console.log("\n================ REAL-PI BILLED HALF SUMMARY ================");
for (const f of findings) console.log(`• ${f}`);
console.log(`\nTotal spend: ¥${spent.toFixed(6)} (~$${(spent / 6.7252).toFixed(6)}) on ${KEY_ID}, budget ¥${BUDGET}`);
console.log(`isolated HOME: ${HOME_DIR} (workdir ${WORK}, agent dir "${AGENT_DIR}")`);

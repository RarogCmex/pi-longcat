/**
 * Round DD-E — is the Responses `reasoning.effort` scale REAL on LongCat-2.5-Preview?
 *
 * Trigger: the 2026-10-24 DD-B5 cells measured the scale at N=1 per level and got
 * a NON-MONOTONIC spread (none 161 / minimal 177 / low 125 / medium 46 / high 156 /
 * xhigh 145 reasoning tokens) on an arithmetic prompt. N=1 cannot separate "the
 * scale is decorative" from "the scale is real and the spread is natural variance
 * at temperature 1.0" — and the two answers imply opposite catalog decisions
 * (keep `low`-only vs publish medium/high).
 *
 * Two free observations from 2026-10-25 sharpen the prior but do not settle it:
 *   - the gateway VALIDATES `reasoning.summary` ("must be one of concise, detailed,
 *     auto") but does NOT validate `reasoning.effort` (`"bogus-level"` → 200,
 *     `"HIGH"` → 200, only `""` → 400), so the documented vocabulary is not
 *     enforced server-side;
 *   - the response echoes the field back (`reasoning:{effort:"high",summary:null}`),
 *     which proves the value is stored, not that the model uses it.
 *
 * This round buys the missing sample size. Task selection is step 0
 * (`research/probe-task-pilot.ts`): the first candidate (an enumeration problem,
 * answer 38) SATURATED the cap — `DD-E1-pilot-low` returned reasoning_tokens 2047
 * of 2048, `finish=incomplete`, answer lost. A saturating task makes the scale
 * unmeasurable, because every level would report the cap. The pilot picked
 * `divcount` (331 reasoning tokens at effort=low, answered 60 ✓) as the primary
 * and `seats` (175 tokens, 3 ✓) as a second, cheaper task so the conclusion is not
 * an artefact of one prompt.
 *
 * Both expected answers are re-derived by exhaustive enumeration here
 * (`--answer`), so the target is not a hand-typed constant.
 *
 * Questions:
 *   E2  the scale: none/minimal/low/medium/high/xhigh on `divcount` (N=3) and on
 *       `seats` (N=2), `max_output_tokens` 2048 — high enough that a real
 *       high-effort cell is not truncated into the others.
 *   E3  baseline: NO `reasoning` field at all on `divcount` (N=3) — exactly what
 *       pi sends for 2.5×Responses when no level is requested (`off:null` ⇒ the
 *       adapter omits the field), so it is the reference the grid must beat.
 *   E4  the `summary` knob at effort=high on `divcount` (N=2 each): auto /
 *       concise / detailed. pi ships `summary:"auto"` alongside a positive level,
 *       so this is the OTHER half of the bytes the user actually gets; the grid
 *       deliberately omits `summary` so the effort effect is not confounded.
 *
 * Every call is a ledger row (`research/lib.ts` appendRow) and its raw body is
 * kept in `research/probes/DD-E*.json`.
 *
 * Worst case as written: 33 calls × 2048 output tokens × ¥8/1M ≈ ¥0.54; the
 * measured rate on `divcount` at effort=low is 647 output tokens (¥0.0053), so
 * the expected total is well under ¥0.20 unless a high-effort cell saturates.
 *
 * Usage: node research/probe-effort-scale.ts [--only E2|E3|E4] [--summary] [--answer]
 */
import { loadKeys, pace, responses, M25 } from "./lib.ts";

const ONLY = (() => {
  const i = process.argv.indexOf("--only");
  return i >= 0 ? process.argv[i + 1] : undefined;
})();
const WITH_SUMMARY = process.argv.includes("--summary");
const ANSWER_ONLY = process.argv.includes("--answer");
const KEY = "KEY1";

interface Task {
  id: string;
  prompt: string;
  expected: number;
  derive: () => number;
}

const TASKS: Record<string, Task> = {
  divcount: {
    id: "divcount",
    prompt:
      "A positive integer n is divisible by 12 and has exactly 12 positive divisors. " +
      "What is the smallest such n? Reply with only the final number and nothing else.",
    expected: 60,
    derive: () => {
      const divisors = (n: number) => {
        let c = 0;
        for (let d = 1; d <= n; d++) if (n % d === 0) c++;
        return c;
      };
      for (let n = 12; ; n += 12) if (divisors(n) === 12) return n;
    },
  },
  seats: {
    id: "seats",
    prompt:
      "Four people — Ana, Ben, Cleo and Dan — sit in a row of four chairs numbered 1 to 4. " +
      "Ana is not in chair 1. Ben sits immediately to the left of Cleo. Dan is in chair 4. " +
      "Cleo is not in chair 3. Which chair is Ana in? Reply with only the number.",
    expected: 3,
    derive: () => {
      const people = ["Ana", "Ben", "Cleo", "Dan"];
      const perms: string[][] = [];
      const walk = (acc: string[], rest: string[]) => {
        if (!rest.length) return perms.push(acc);
        rest.forEach((p, i) => walk([...acc, p], [...rest.slice(0, i), ...rest.slice(i + 1)]));
      };
      walk([], people);
      for (const p of perms) {
        const seat = (name: string) => p.indexOf(name) + 1;
        if (seat("Ana") === 1 || seat("Dan") !== 4 || seat("Cleo") === 3) continue;
        if (seat("Cleo") - seat("Ben") !== 1) continue;
        return seat("Ana");
      }
      return -1;
    },
  },
};

const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;
/** Runs per level per task: 3 on the primary, 2 on the second. */
const RUNS: Record<string, number> = { divcount: 3, seats: 2 };

/** Last integer in the visible text — the model was asked for one number and nothing else. */
function finalAnswer(text: string): number | undefined {
  const numbers = text.match(/-?\d+/g);
  if (!numbers?.length) return undefined;
  return Number(numbers[numbers.length - 1]);
}

function selected(label: string): boolean {
  return !ONLY || label.startsWith(ONLY);
}

interface Cell {
  label: string;
  task: Task;
  reasoning?: { effort: string; summary?: string };
}

async function runCell(cell: Cell): Promise<void> {
  const r = await responses(
    {
      model: M25,
      input: cell.task.prompt,
      max_output_tokens: 2048,
      ...(cell.reasoning ? { reasoning: cell.reasoning } : {}),
    },
    {
      keyId: KEY,
      label: cell.label,
      purpose:
        `effort=${cell.reasoning?.effort ?? "(omitted)"} on 2.5-Preview, task=${cell.task.id}: ` +
        `does the level move reasoning_tokens?${cell.reasoning?.summary ? ` (summary:${cell.reasoning.summary})` : ""}`,
      bound: "max_output_tokens 2048, 300 s timeout",
      timeoutMs: 300_000,
    },
  );
  const answer = finalAnswer(r.text);
  console.log(
    `${cell.label.padEnd(28)} reasoning=${String(r.reasoningTokens ?? "?").padStart(5)} ` +
      `out=${String(r.out ?? "?").padStart(5)} answer=${answer === undefined ? "NONE" : answer === cell.task.expected ? `${answer} ✓` : `${answer} ✗`} ` +
      `finish=${r.finish ?? "-"} ¥${r.costCny}`,
  );
}

async function main(): Promise<void> {
  if (ANSWER_ONLY) {
    for (const t of Object.values(TASKS)) console.log(`${t.id.padEnd(10)} expected=${t.expected} derived=${t.derive()}`);
    return;
  }
  if (!loadKeys()[KEY]) throw new Error(`${KEY} not present in secret.env`);
  console.log(`DD-E effort-scale round — key ${KEY}, only=${ONLY ?? "all"}, summary=${WITH_SUMMARY}`);
  for (const t of Object.values(TASKS)) console.log(`  ${t.id}: expected ${t.expected} (re-derived ${t.derive()})`);
  console.log();

  if (selected("E2")) {
    console.log("── E2 the scale: six levels × N (3 on divcount, 2 on seats) ──");
    for (const task of Object.values(TASKS)) {
      for (const effort of EFFORTS) {
        for (let run = 1; run <= RUNS[task.id]; run++) {
          await runCell({ label: `DD-E2-${task.id}-effort-${effort}-r${run}`, task, reasoning: { effort } });
        }
      }
      await pace();
    }
  }

  if (selected("E3")) {
    console.log("\n── E3 baseline: no reasoning field on divcount × N=3 ──");
    for (let run = 1; run <= 3; run++) {
      await runCell({ label: `DD-E3-nofield-divcount-r${run}`, task: TASKS.divcount });
    }
  }

  if (selected("E4") && WITH_SUMMARY) {
    console.log("\n── E4 summary knob at effort=high on divcount × N=2 ──");
    for (const summary of ["auto", "concise", "detailed"] as const) {
      for (let run = 1; run <= 2; run++) {
        await runCell({
          label: `DD-E4-summary-${summary}-r${run}`,
          task: TASKS.divcount,
          reasoning: { effort: "high", summary },
        });
      }
      await pace();
    }
  }
}

await main();

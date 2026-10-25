/**
 * Round DD-E, step 0 — pick the TASK for the effort-scale grid.
 *
 * The first candidate (count integers ≤1000 divisible by 7, not by 3 or 5, with an
 * odd digit sum; answer 38) saturated the cap: `DD-E1-pilot-low` returned
 * reasoning_tokens 2047 of 2048 and `finish=incomplete` with the answer lost. A
 * task that saturates makes the scale UNMEASURABLE — every level would report the
 * cap — so the task has to sit in the band where the model reasons but finishes:
 * enough reasoning to differ by level, few enough tokens to stay under the cap.
 *
 * Four candidates, one call each at effort=low, `max_output_tokens` 2048. The
 * winner is the one whose reasoning lands in a few hundred tokens AND whose
 * answer is right (a task the model cannot solve would make correctness useless
 * as a secondary signal).
 *
 * Every expected answer below is re-derived by exhaustive enumeration in this
 * file (`--answer`), so the target is not a hand-typed constant.
 *
 * Usage: node research/probe-task-pilot.ts [--answer]
 */
import { loadKeys, responses, M25 } from "./lib.ts";

const ANSWER_ONLY = process.argv.includes("--answer");
const KEY = "KEY1";

interface Candidate {
  id: string;
  prompt: string;
  expected: number;
  /** Independent re-derivation. */
  derive: () => number;
}

const CANDIDATES: Candidate[] = [
  {
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
  {
    id: "seats",
    prompt:
      "Four people — Ana, Ben, Cleo and Dan — sit in a row of four chairs numbered 1 to 4. " +
      "Ana is not in chair 1. Ben sits immediately to the left of Cleo. Dan is in chair 4. " +
      "Cleo is not in chair 3. Which chair is Ana in? Reply with only the number.",
    expected: 3,
    derive: () => {
      // brute force over the 4! arrangements
      const people = ["Ana", "Ben", "Cleo", "Dan"];
      const perms: string[][] = [];
      const walk = (acc: string[], rest: string[]) => {
        if (!rest.length) return perms.push(acc);
        rest.forEach((p, i) => walk([...acc, p], [...rest.slice(0, i), ...rest.slice(i + 1)]));
      };
      walk([], people);
      for (const p of perms) {
        const seat = (name: string) => p.indexOf(name) + 1;
        if (seat("Ana") === 1) continue;
        if (seat("Dan") !== 4) continue;
        if (seat("Cleo") === 3) continue;
        if (seat("Cleo") - seat("Ben") !== 1) continue;
        return seat("Ana");
      }
      return -1;
    },
  },
  {
    id: "lastdigit",
    prompt:
      "What is the last decimal digit of 7^2024? Reply with only the digit.",
    expected: 1,
    derive: () => {
      let v = 1;
      for (let i = 0; i < 2024; i++) v = (v * 7) % 10;
      return v;
    },
  },
  {
    id: "banana",
    prompt:
      "How many distinct arrangements of the letters of the word BANANA have no two A's " +
      "adjacent? Reply with only the final number and nothing else.",
    expected: 12,
    derive: () => {
      const letters = "BANANA".split("");
      const seen = new Set<string>();
      const walk = (acc: string, rest: string[]) => {
        if (!rest.length) return seen.add(acc);
        rest.forEach((ch, i) => walk(acc + ch, [...rest.slice(0, i), ...rest.slice(i + 1)]));
      };
      walk("", letters);
      return [...seen].filter((s) => !s.includes("AA")).length;
    },
  },
];

function finalAnswer(text: string): number | undefined {
  const numbers = text.match(/-?\d+/g);
  if (!numbers?.length) return undefined;
  return Number(numbers[numbers.length - 1]);
}

async function main(): Promise<void> {
  if (ANSWER_ONLY) {
    for (const c of CANDIDATES) console.log(`${c.id.padEnd(10)} expected=${c.expected} derived=${c.derive()}`);
    return;
  }
  if (!loadKeys()[KEY]) throw new Error(`${KEY} not present in secret.env`);
  console.log("DD-E step 0 — task selection, one call each at effort=low\n");
  for (const c of CANDIDATES) {
    const r = await responses(
      { model: M25, input: c.prompt, max_output_tokens: 2048, reasoning: { effort: "low" } },
      {
        keyId: KEY,
        label: `DD-E0-task-${c.id}`,
        purpose: `task-selection pilot for the effort grid: does ${c.id} reason moderately (not saturate 2048) and solve?`,
        bound: "max_output_tokens 2048, 300 s timeout",
        timeoutMs: 300_000,
      },
    );
    const answer = finalAnswer(r.text);
    console.log(
      `${c.id.padEnd(10)} reasoning=${String(r.reasoningTokens ?? "?").padStart(5)} out=${String(r.out ?? "?").padStart(5)} ` +
        `answer=${answer === undefined ? "NONE" : answer === c.expected ? `${answer} ✓` : `${answer} ✗`} ` +
        `finish=${r.finish ?? "-"} ¥${r.costCny}`,
    );
  }
}

await main();

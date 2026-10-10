/**
 * Priority A, round 3 — disambiguating the ONE cache result that has two possible
 * mechanisms, because they imply opposite plugin decisions.
 *
 * Round 2 (cell B3) found: an identical repeat of a ~1.2K-token request hit for
 * 1152 cached tokens, but changing ONLY the final user message ("ok" → "fine")
 * missed completely (0). Two mechanisms fit that observation:
 *
 *   (a) whole-request keying — the cache key covers the entire message list, so
 *       any tail change invalidates everything. Consequence: an agent's growing
 *       transcript NEVER hits, and prompt caching is worth almost nothing to a
 *       coding agent on this platform;
 *   (b) node-local caching without routing affinity — the platform documents
 *       `prompt_cache_key` as "cluster routing, to raise the cache hit rate", so
 *       without it a request can land on a node that never saw the prefix.
 *       Consequence: the cache IS prefix-based, and sending a stable
 *       `prompt_cache_key` should restore the hit — which would argue for
 *       injecting one on the chat surface (pi only sends it on Responses).
 *
 * Round 2's A4 ("a different prompt_cache_key missed ⇒ it partitions the cache")
 * is confounded by the same ambiguity, so it is re-tested here too.
 *
 * Design: ONE unique prefix, four calls in a fixed order, ~10 s apart:
 *   D1 keyed=alpha, question Q1  → cold (baseline)
 *   D2 keyed=alpha, question Q1  → must hit (identical repeat, control)
 *   D3 keyed=alpha, question Q2  → the discriminator: same key, changed tail
 *   D4 NO key,       question Q1 → does removing the key lose a warm prefix?
 *   D5 keyed=beta,   question Q1 → re-test of A4 under the same conditions
 * Verdicts are printed as a truth table so the mechanism can be read off, and the
 * whole cell costs ≈¥0.012 (5 calls, ≤1.2K prompt tokens each, max_tokens 16).
 *
 * Usage: node research/probe-cache3.ts
 */
import { M20, chat, loadKeys, uniquePrefix } from "./lib.ts";

const KEY = process.env.LONGCAT_CACHE_KEY ?? "KEY1";
if (!loadKeys()[KEY]) throw new Error(`${KEY} missing`);
const PREFIX = uniquePrefix("D-pck-routing", 24);
const Q1 = "Reply with exactly one word: ok";
const Q2 = "Reply with exactly one word: fine";

const steps: { label: string; pck?: string; question: string; expect: string }[] = [
  { label: "D1-keyed-alpha-Q1", pck: "alpha-session", question: Q1, expect: "cold (first touch of a unique prefix)" },
  { label: "D2-keyed-alpha-Q1-repeat", pck: "alpha-session", question: Q1, expect: "hit (identical repeat — the control; if this misses, the cell is void)" },
  { label: "D3-keyed-alpha-Q2-changedtail", pck: "alpha-session", question: Q2, expect: "DISCRIMINATOR: hit ⇒ prefix-based + routing (b); miss ⇒ whole-request keying (a)" },
  { label: "D4-nokey-Q1", question: Q1, expect: "hit ⇒ the key is not needed for affinity; miss ⇒ the key is what routes" },
  { label: "D5-keyed-beta-Q1", pck: "beta-session", question: Q1, expect: "hit ⇒ the key does not partition; miss ⇒ it does (re-test of A4)" },
];

let spent = 0;
const results: { label: string; prompt?: number; cached?: number }[] = [];
for (const step of steps) {
  const body: Record<string, unknown> = {
    model: M20,
    max_tokens: 16,
    thinking: { type: "disabled" },
    messages: [{ role: "system", content: PREFIX }, { role: "user", content: step.question }],
  };
  if (step.pck) body.prompt_cache_key = step.pck;
  const r = await chat(body, { keyId: KEY, label: step.label, purpose: `${step.expect}`, bound: "max_tokens 16, one unique prefix for the whole cell, 10 s pacing" });
  spent += r.costCny;
  results.push({ label: step.label, prompt: r.in, cached: r.cached });
  console.log(`      ${step.label}: prompt=${r.in ?? "?"} cached=${r.cached ?? "?"} cost=¥${r.costCny.toFixed(6)}`);
}

const hit = (i: number) => (results[i]!.cached ?? 0) > 0;
console.log("\n================ D-CELL TRUTH TABLE ================");
for (let i = 0; i < steps.length; i++) {
  console.log(`  ${steps[i]!.label.padEnd(32)} prompt=${String(results[i]!.prompt).padEnd(6)} cached=${String(results[i]!.cached).padEnd(6)} ${hit(i) ? "HIT" : "miss"}   (${steps[i]!.expect})`);
}
console.log("\nverdict:");
if (!hit(1)) console.log("  VOID — the identical-repeat control missed, so nothing below can be concluded (re-run).");
else {
  console.log(`  (a) whole-request keying:  ${hit(2) ? "REFUTED — a changed tail still hit" : "SUPPORTED — a changed tail missed"}`);
  console.log(`  (b) routing/affinity:      ${hit(2) ? "SUPPORTED — a stable prompt_cache_key kept the prefix warm across a tail change" : "not supported by D3"}`);
  console.log(`  prompt_cache_key needed:   ${hit(3) ? "no — the unkeyed request hit too" : "yes — removing the key lost the warm prefix"}`);
  console.log(`  prompt_cache_key partitions: ${hit(4) ? "no — a different key value still hit" : "yes — a different key value missed"}`);
}
console.log(`\nD-cell spend: ¥${spent.toFixed(6)} on ${KEY}`);

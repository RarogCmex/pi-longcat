/**
 * Priority A, round 2 — the four cache cells round 1 left unproven or unsupported.
 *
 * 1. **Cross-model sharing, properly controlled.** Round 1's A9 concluded "the
 *    cache is model-scoped" from `2.0 (cold) → 2.5 (miss)`, but it never confirmed
 *    the prefix had actually become warm on 2.0 — so the miss is equally explained
 *    by "nothing was ever cached". A surprising negative needs a control
 *    (testing.md § Proving a negative): this round runs 2.0 cold → 2.0 warm (must
 *    hit, or the cell is void) → 2.5 on the SAME prefix.
 * 2. **Below one block.** Ten independent round-1/round-2 pairs all fit
 *    `cached = floor(prompt/128) × 128` (see scripts/cache-report.ts). The model
 *    predicts zero caching under 128 prompt tokens; this tests ~50 and ~100.
 * 3. **Does the cache survive a changed tail?** Round 1 repeated the *identical*
 *    request. A coding agent does not: the system prompt and earlier turns are the
 *    prefix and the LAST user message changes every turn. Same unique prefix,
 *    different final question — if that misses, the cache is worth far less to an
 *    agent than the round-1 numbers suggest.
 * 4. **Is the cache key-scoped or account-scoped?** All nine keys behave
 *    identically and the platform's balance is per account. If a second key cannot
 *    see the first key's warm prefix, a key pool would silently lose the cache —
 *    which is a design input, not trivia.
 *
 * Budget: ≤¥0.10 on KEY1 (round 1 spent ¥0.035 of its ¥1 cap). Unique prefixes
 * per cell, `max_tokens` 16, ~10 s pacing, every call ledgered.
 *
 * Usage: node research/probe-cache2.ts
 */
import { M20, M25, chat, loadKeys, uniquePrefix } from "./lib.ts";

const KEY = process.env.LONGCAT_CACHE_KEY ?? "KEY1";
const OTHER = process.env.LONGCAT_CACHE_OTHER_KEY ?? "KEY5";
const keys = loadKeys();
if (!keys[KEY]) throw new Error(`${KEY} missing`);
if (!keys[OTHER]) throw new Error(`${OTHER} missing`);

let spent = 0;
const findings: string[] = [];
function note(line: string): void {
  findings.push(line);
  console.log(`\n### ${line}`);
}
const Q1 = "Reply with exactly one word: ok";
const Q2 = "Reply with exactly one word: fine";
async function call(prefix: string, label: string, purpose: string, opts: { model?: string; keyId?: string; question?: string } = {}) {
  const r = await chat(
    {
      model: opts.model ?? M20,
      max_tokens: 16,
      thinking: { type: "disabled" },
      messages: [{ role: "system", content: prefix }, { role: "user", content: opts.question ?? Q1 }],
    },
    { keyId: opts.keyId ?? KEY, label, purpose, bound: "max_tokens 16, unique prefix per cell" },
  );
  spent += r.costCny;
  if (spent > 0.5) throw new Error(`round-2 cache budget exceeded (¥${spent.toFixed(4)})`);
  console.log(`      ${label}: prompt=${r.in ?? "?"} cached=${r.cached ?? "?"} cost=¥${r.costCny.toFixed(6)}`);
  return r;
}

// 1. cross-model, with the control that round 1 lacked
{
  const prefix = uniquePrefix("B1-crossmodel", 24);
  const cold = await call(prefix, "B1-cross-2.0-cold", "cross-model cell, control step 1: 2.0 cold");
  const warm = await call(prefix, "B1-cross-2.0-warm", "cross-model cell, control step 2: 2.0 warm — MUST hit or the cell is void");
  const other = await call(prefix, "B1-cross-2.5-sameprefix", "cross-model cell, step 3: the same prefix on 2.5-Preview", { model: M25 });
  note(
    `B1 cross-model: 2.0 cold cached=${cold.cached ?? "?"} → 2.0 warm cached=${warm.cached ?? "?"} (control ${
      (warm.cached ?? 0) > 0 ? "SATISFIED" : "FAILED — cell void, prefix never cached"
    }) → 2.5-Preview same prefix cached=${other.cached ?? "?"} ⇒ ` +
      ((warm.cached ?? 0) > 0
        ? (other.cached ?? 0) > 0
          ? "the cache is SHARED across models"
          : "the cache is MODEL-SCOPED (warm on 2.0, cold on 2.5-Preview for the identical prefix)"
        : "UNRESOLVED — the control did not hit"),
  );
}

// 2. below one 128-token block
{
  for (const repeats of [1, 2]) {
    const prefix = uniquePrefix(`B2-sub-block-r${repeats}`, repeats);
    const a = await call(prefix, `B2-subblock-r${repeats}-call1`, `minimum cacheable prefix: ${repeats} repeat(s), call 1/2`);
    const b = await call(prefix, `B2-subblock-r${repeats}-call2`, `minimum cacheable prefix: ${repeats} repeat(s), call 2/2`);
    const predicted = Math.floor((b.in ?? 0) / 128) * 128;
    note(
      `B2 ${repeats} repeat(s): prompt=${b.in} cached=[${a.cached}, ${b.cached}]; floor(prompt/128)*128 predicts ${predicted} ⇒ ${b.cached === predicted ? "MODEL HOLDS" : "MODEL WRONG"}`,
    );
  }
}

// 3. changed tail (the agent-shaped case)
{
  const prefix = uniquePrefix("B3-changed-tail", 24);
  await call(prefix, "B3-tail-call1", "changed-tail cell: warm the prefix with question 1");
  const same = await call(prefix, "B3-tail-call2-same", "changed-tail cell: identical request (control, must hit)");
  const changed = await call(prefix, "B3-tail-call3-changed", "changed-tail cell: SAME prefix, DIFFERENT final user message — does the prefix still hit?", { question: Q2 });
  note(
    `B3 changed tail: identical repeat cached=${same.cached ?? "?"}, changed final question cached=${changed.cached ?? "?"} (prompt ${changed.in ?? "?"}) ⇒ ` +
      ((changed.cached ?? 0) > 0
        ? "the prefix cache survives a changed tail — an agent's growing transcript keeps hitting"
        : "a changed tail MISSES — the cache is whole-request, not prefix-based, and is worth much less to an agent"),
  );
}

// 4. key-scoped or account-scoped
{
  const prefix = uniquePrefix("B4-cross-key", 24);
  await call(prefix, "B4-key-call1", "cross-key cell: warm with the primary key");
  const warm = await call(prefix, "B4-key-call2-samekey", "cross-key cell: confirm the prefix is warm for the primary key");
  const other = await call(prefix, `B4-key-call3-${OTHER}`, `cross-key cell: the same warm prefix sent with ${OTHER}`, { keyId: OTHER });
  note(
    `B4 cross-key: primary warm cached=${warm.cached ?? "?"} → ${OTHER} on the same prefix cached=${other.cached ?? "?"} ⇒ ` +
      ((warm.cached ?? 0) > 0
        ? (other.cached ?? 0) > 0
          ? `the cache is not key-scoped (${OTHER} saw the primary key's warm prefix) — a key pool would keep cache hits`
          : `the cache IS key-scoped (${OTHER} missed) — rotating keys would throw away the cache`
        : "UNRESOLVED — the control did not hit"),
  );
}

console.log("\n================ CACHE ROUND 2 SUMMARY ================");
for (const f of findings) console.log(`• ${f}`);
console.log(`\nRound-2 spend: ¥${spent.toFixed(6)} on ${KEY}/${OTHER}`);

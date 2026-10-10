/**
 * Priority A — the prompt-caching suite (billed round, 2026-10-11).
 *
 * Operator-approved scope: the operator called prompt caching "крайне важный
 * параметр" and explicitly overrode the house default ("prove the accounting once
 * with two short requests, not in a loop" — skills/pi-provider-plugin references/
 * testing.md § Cost discipline). The override is recorded in the journal
 * (Section 11, J31) so the tension is visible to whoever folds this back in.
 *
 * Budget: ≤ ¥1 on the key this suite uses (KEY1 by default; override with
 * LONGCAT_CACHE_KEY). The suite aborts itself if cumulative cost passes
 * `--budget` (default ¥1.0) — a client-side ceiling, because no gateway is
 * guaranteed to reject anything.
 *
 * Method, and why it cannot be fooled by warmth (journal J26):
 *  - every cell builds its OWN unique prefix via `uniquePrefix(tag, repeats)`,
 *    seeded with a random UUID + timestamp, so a hit on call N can only have come
 *    from call N-1 of the same cell — never from a previous run, another cell, or
 *    another model;
 *  - no cell asserts "the first call misses". Each cell prints the per-call
 *    `cached_tokens` series and the verdict is read off the series. If a FRESH
 *    unique prefix reports cached_tokens > 0 on its very first call, that is
 *    itself reported as a finding (the cache is not prefix-keyed), not swallowed;
 *  - prefixes are ~1-4K measured tokens (the operator's cost-control bound), and
 *    `max_tokens` is 16 except where a cell needs reasoning room;
 *  - ~10 s pacing, one backoff-and-retry on 429 (the platform documents per-key
 *    rate limits without publishing numbers).
 *
 * Usage: node research/probe-cache.ts [--quick] [--budget 1.0]
 *   --quick  skips the TTL cell (A3), which otherwise waits ~21 minutes
 */
import { M20, M25, chat, costOf, loadKeys, pace, responses, uniquePrefix } from "./lib.ts";

const ARGV = process.argv.slice(2);
const QUICK = ARGV.includes("--quick");
const BUDGET = Number((ARGV.includes("--budget") ? ARGV[ARGV.indexOf("--budget") + 1] : "1.0") ?? "1.0");
const KEY = process.env.LONGCAT_CACHE_KEY ?? "KEY1";
if (!loadKeys()[KEY]) throw new Error(`${KEY} not present in secret.env`);

let spent = 0;
const findings: string[] = [];
function note(line: string): void {
  findings.push(line);
  console.log(`\n### ${line}`);
}
async function budgetGuard(label: string): Promise<void> {
  if (spent > BUDGET) throw new Error(`budget exhausted (¥${spent.toFixed(4)} > ¥${BUDGET}) before ${label}`);
}
function tally(cost: number): void {
  spent += cost;
  console.log(`      cumulative spend on ${KEY}: ¥${spent.toFixed(6)} of ¥${BUDGET.toFixed(2)}`);
}

const Q = "Reply with exactly one word: ok";
const series: Record<string, (number | undefined)[]> = {};
function record(cell: string, cached: number | undefined, prompt: number | undefined): void {
  (series[cell] ??= []).push(cached);
  console.log(`      ${cell}: prompt_tokens=${prompt ?? "?"} cached_tokens=${cached ?? "?"}`);
}

// ── A1: implicit prefix caching, scaled up from the 256/359 first measurement ──
const P1 = uniquePrefix("A1", 24);
note("A1 — implicit prefix caching on chat (no prompt_cache_key sent, as pi does), ~1K-token prefix, 4 identical calls");
for (let i = 1; i <= 4; i++) {
  await budgetGuard(`A1.${i}`);
  const r = await chat(
    { model: M20, max_tokens: 16, thinking: { type: "disabled" }, messages: [{ role: "system", content: P1 }, { role: "user", content: Q }] },
    { keyId: KEY, label: `A1-cache-chat-call${i}`, purpose: `implicit prefix cache, identical call ${i}/4 on a unique ~1K prefix`, bound: "max_tokens 16, unique prefix, 10 s pacing" },
  );
  record(`A1 call${i}`, r.cached, r.in);
  tally(r.costCny);
  if (i === 1) note(`A1 cold call: prompt_tokens=${r.in} cached=${r.cached} cache_write=${r.cacheWrite} cost=¥${r.costCny} ttft=${r.ttftMs}ms`);
}
{
  const vals = [1, 2, 3, 4].map((i) => series[`A1 call${i}`]?.[0]);
  const hits = vals.filter((v) => (v ?? 0) > 0).length;
  note(
    `A1 verdict: cached_tokens series = [${vals.join(", ")}] → ${hits}/4 calls reported a hit` +
      (vals[0] ? " — INCLUDING the first call on a fresh unique prefix, so the cache is not purely prefix-keyed" : " (first call cold, as expected)"),
  );
}

// ── A2: minimum cacheable prefix, bracketed in MEASURED tokens ──
note("A2 — minimum cacheable prefix: 6/12/24/48 repeats (≈256/512/1K/2K measured), 2 calls each, fresh unique prefix per size");
const bracket: { repeats: number; cells: (number | undefined)[]; prompts: (number | undefined)[] }[] = [];
for (const repeats of [6, 12, 24, 48]) {
  await budgetGuard(`A2 r${repeats}`);
  const prefix = uniquePrefix(`A2-${repeats}`, repeats);
  const entry = { repeats, cells: [] as (number | undefined)[], prompts: [] as (number | undefined)[] };
  for (let i = 1; i <= 2; i++) {
    const r = await chat(
      { model: M20, max_tokens: 16, thinking: { type: "disabled" }, messages: [{ role: "system", content: prefix }, { role: "user", content: Q }] },
      { keyId: KEY, label: `A2-minprefix-${repeats}x-call${i}`, purpose: `cache bracket: ${repeats} repeats, call ${i}/2`, bound: "max_tokens 16, unique prefix per size" },
    );
    entry.cells.push(r.cached);
    entry.prompts.push(r.in);
    tally(r.costCny);
    record(`A2 r${repeats} call${i}`, r.cached, r.in);
  }
  bracket.push(entry);
}
{
  const hit = bracket.find((b) => (b.cells[1] ?? 0) > 0);
  const miss = bracket.filter((b) => (b.cells[1] ?? 0) === 0);
  note(
    `A2 verdict: first size whose 2nd call hit = ${hit ? `${hit.prompts[1]} prompt_tokens (${hit.repeats} repeats, cached ${hit.cells[1]})` : "none — no size cached"}; ` +
      `sizes that did NOT hit on the 2nd call: ${miss.length ? miss.map((m) => `${m.prompts[1]} tok`).join(", ") : "none"}`,
  );
  const ratios = bracket.map((b) => ((b.cells[1] ?? 0) / Math.max(1, b.prompts[1] ?? 1)).toFixed(2));
  note(`A2 hit granularity (cached/prompt per size): [${ratios.join(", ")}] — a ratio < 1 means the cache is block-aligned, not whole-prefix`);
}

// ── A3: TTL / persistence across gaps ──
if (!QUICK) {
  note("A3 — TTL/persistence: one unique ~1K prefix re-sent after ~1, ~5 and ~15 minute gaps (waiting costs nothing)");
  const prefix = uniquePrefix("A3-ttl", 24);
  const gaps = [0, 60_000, 5 * 60_000, 15 * 60_000];
  const seen: (number | undefined)[] = [];
  for (let i = 0; i < gaps.length; i++) {
    if (i > 0) {
      console.log(`      …waiting ${Math.round(gaps[i]! / 60000)} min before the next call (no spend while waiting)`);
      await new Promise((r) => setTimeout(r, gaps[i]));
    }
    await budgetGuard(`A3.${i}`);
    const r = await chat(
      { model: M20, max_tokens: 16, thinking: { type: "disabled" }, messages: [{ role: "system", content: prefix }, { role: "user", content: Q }] },
      { keyId: KEY, label: `A3-ttl-gap${i === 0 ? "0" : `${Math.round(gaps[i]! / 60000)}min`}`, purpose: `cache persistence after a ${i === 0 ? "0 (warm)" : Math.round(gaps[i]! / 60000)}-minute gap`, bound: "max_tokens 16, one unique prefix for the whole cell" },
    );
    seen.push(r.cached);
    tally(r.costCny);
    record(`A3 gap ${i === 0 ? 0 : Math.round(gaps[i]! / 60000)}min`, r.cached, r.in);
  }
  note(`A3 verdict: cached_tokens at [warm, +1min, +5min, +15min] = [${seen.join(", ")}] → ${seen.every((v) => (v ?? 0) > 0) ? "still warm after 15 minutes; TTL is longer than 15 min (not bounded by this suite)" : `decayed at ${seen.findIndex((v, i) => i > 0 && (v ?? 0) === 0)} step(s)`}`);
}

// ── A4: does prompt_cache_key partition the cache? ──
note("A4 — prompt_cache_key: pi fills it from the session id on Responses and omits it on chat. Same unique prefix, three key values");
{
  const prefix = uniquePrefix("A4-pck", 24);
  const cells: { key: string | undefined; cached?: number; prompt?: number; status?: number | string; error?: string }[] = [];
  for (const [label, pck] of [["alpha", "alpha-session"], ["alpha-again", "alpha-session"], ["beta", "beta-session"]] as const) {
    await budgetGuard(`A4 ${label}`);
    const body: Record<string, unknown> = {
      model: M20, max_tokens: 16, thinking: { type: "disabled" },
      messages: [{ role: "system", content: prefix }, { role: "user", content: Q }],
    };
    if (pck) body.prompt_cache_key = pck;
    const r = await chat(body, {
      keyId: KEY,
      label: `A4-prompt-cache-key-${label}`,
      purpose: `does prompt_cache_key="${pck}" partition the implicit cache? (call ${label})`,
      bound: "max_tokens 16, one unique prefix, three key values",
    });
    cells.push({ key: pck, cached: r.cached, prompt: r.in, status: r.status, error: r.error });
    tally(r.costCny);
    console.log(`      A4 ${label}: status=${r.status} cached=${r.cached ?? "?"} prompt=${r.in ?? "?"}${r.error ? ` error=${r.error.slice(0, 120)}` : ""}`);
  }
  const [a1, a2, b1] = cells;
  note(
    `A4 verdict: alpha=${a1?.cached ?? "?"} → alpha-again=${a2?.cached ?? "?"} → beta=${b1?.cached ?? "?"} (prompt ${b1?.prompt ?? "?"}) ⇒ ` +
      ((b1?.cached ?? 0) > 0
        ? "prompt_cache_key does NOT partition the cache — a different key value still hits, so it is accepted and ignored (or advisory only) on the chat surface"
        : "a different prompt_cache_key MISSED ⇒ the key does partition the cache") +
      (a1?.status !== 200 ? ` — note the field's status on chat was ${a1?.status} (${(a1?.error ?? "").slice(0, 80)})` : ""),
  );
}

// ── A5: accounting — the cached rate, and whether a write carries a premium ──
note("A5 — accounting: is a cache hit priced at ¥0.04/1M and does a WRITE carry a premium? (from the gateway's own usage fields)");
{
  const prefix = uniquePrefix("A5-acct", 24);
  const cold = await chat(
    { model: M20, max_tokens: 16, thinking: { type: "disabled" }, messages: [{ role: "system", content: prefix }, { role: "user", content: Q }] },
    { keyId: KEY, label: "A5-accounting-cold", purpose: "cold call: does it report cache_write_tokens, and at what implied price?", bound: "max_tokens 16, unique prefix",
  });
  tally(cold.costCny);
  const warm = await chat(
    { model: M20, max_tokens: 16, thinking: { type: "disabled" }, messages: [{ role: "system", content: prefix }, { role: "user", content: Q }] },
    { keyId: KEY, label: "A5-accounting-warm", purpose: "warm call: cached_tokens and the resulting cost delta", bound: "max_tokens 16, same unique prefix",
  });
  tally(warm.costCny);
  const coldInputCost = costOf(cold.in ?? 0, 0, cold.cached ?? 0);
  const warmInputCost = costOf(warm.in ?? 0, 0, warm.cached ?? 0);
  note(
    `A5 cold: prompt=${cold.in} cached=${cold.cached} cache_write=${cold.cacheWrite} input-cost=¥${coldInputCost.toFixed(6)}\n` +
      `      A5 warm: prompt=${warm.in} cached=${warm.cached} cache_write=${warm.cacheWrite} input-cost=¥${warmInputCost.toFixed(6)}\n` +
      `      ratio warm/cold input cost = ${(warmInputCost / Math.max(coldInputCost, 1e-9)).toFixed(3)} (the documented rate ratio is 0.04/2 = 0.020 for a fully-cached prefix)\n` +
      `      cache-write premium observable? ${cold.cacheWrite ? `cache_write_tokens=${cold.cacheWrite} reported; the platform publishes NO write rate, so it cannot be priced from here` : "no cache_write_tokens on the cold call — nothing to price"}`,
  );
  note(
    "A5 caveat (honesty): the platform deducts server-side and exposes no balance/usage API to a model key, so the CNY figures here are COMPUTED from the documented rates and the gateway's own usage fields — not read off an invoice. The Usage page is behind a web login and was not consulted.",
  );
}

// ── A6: cache on the Responses surface ──
note("A6 — does cached_tokens appear on /openai/v1/responses at all? (pi sends prompt_cache_key there)");
{
  const prefix = uniquePrefix("A6-resp", 24);
  const seen: (number | undefined)[] = [];
  for (const i of [1, 2]) {
    await budgetGuard(`A6.${i}`);
    const r = await responses(
      {
        model: M20, max_output_tokens: 16, reasoning: { effort: "none" }, store: false, prompt_cache_key: "longcat-cache-suite",
        instructions: prefix, input: [{ role: "user", content: [{ type: "input_text", text: Q }] }],
      },
      { keyId: KEY, label: `A6-responses-cache-call${i}`, purpose: `Responses surface cache readout, call ${i}/2 on a unique ~1K prefix`, bound: "max_output_tokens 16, reasoning effort none",
    });
    seen.push(r.cached);
    tally(r.costCny);
    console.log(`      A6 call${i}: status=${r.status} prompt=${r.in ?? "?"} cached=${r.cached ?? "?"}${r.error ? ` error=${r.error.slice(0, 140)}` : ""}`);
  }
  note(`A6 verdict: Responses cached_tokens = [${seen.join(", ")}] ⇒ ${(seen[1] ?? 0) > 0 ? "the Responses surface DOES report cache hits" : seen.every((v) => v === undefined) ? "the Responses surface reports NO cache field at all (undefined, not zero)" : "the Responses surface reports cached_tokens but it stayed 0 for a repeated ~1K prefix"}`);
}

// ── A7: cache × thinking ──
note("A7 — cache × thinking: is reasoning regenerated on a warm prefix, and does thinking break the cache?");
{
  const prefix = uniquePrefix("A7-think", 24);
  const runs: { cached?: number; reasoningTokens?: number; reasoning: string; text: string }[] = [];
  for (const i of [1, 2]) {
    await budgetGuard(`A7.${i}`);
    const r = await chat(
      { model: M20, max_tokens: 64, thinking: { type: "enabled" }, messages: [{ role: "system", content: prefix }, { role: "user", content: "Reply with exactly one word: ok" }] },
      { keyId: KEY, label: `A7-cache-thinking-call${i}`, purpose: `thinking ON with a repeated unique prefix, call ${i}/2: is reasoning served from cache or regenerated?`, bound: "max_tokens 64, thinking enabled",
    });
    runs.push({ cached: r.cached, reasoningTokens: r.reasoningTokens, reasoning: r.reasoning, text: r.text });
    tally(r.costCny);
    console.log(`      A7 call${i}: cached=${r.cached ?? "?"} reasoning_tokens=${r.reasoningTokens ?? "?"} reasoning=${JSON.stringify(r.reasoning.slice(0, 80))}`);
  }
  const same = runs[0]!.reasoning.trim() === runs[1]!.reasoning.trim();
  note(
    `A7 verdict: cached=[${runs.map((r) => r.cached).join(", ")}], reasoning_tokens=[${runs.map((r) => r.reasoningTokens).join(", ")}], identical reasoning text: ${same} ⇒ ` +
      ((runs[1]?.reasoningTokens ?? 0) > 0
        ? `reasoning IS regenerated on a warm prefix (reasoning_tokens ${runs[1]?.reasoningTokens} on call 2) — the cache covers the prompt, not the thoughts`
        : "no reasoning tokens on the warm call — reasoning appears to be served/skipped") +
      (runs[1]?.cached ? "; the prefix cache survives thinking being on" : "; thinking ON appears to suppress the prefix cache hit"),
  );
}

// ── A8/A9: the other model, and cross-model sharing ──
note("A8/A9 — LongCat-2.5-Preview cache, and whether the two models share one cache");
{
  const shared = uniquePrefix("A8-cross", 24);
  const on20 = await chat(
    { model: M20, max_tokens: 16, thinking: { type: "disabled" }, messages: [{ role: "system", content: shared }, { role: "user", content: Q }] },
    { keyId: KEY, label: "A8-cross-on-2.0", purpose: "warm a unique prefix on LongCat-2.0 (control for the cross-model test)", bound: "max_tokens 16",
  });
  tally(on20.costCny);
  const cross = await chat(
    { model: M25, max_tokens: 16, thinking: { type: "disabled" }, messages: [{ role: "system", content: shared }, { role: "user", content: Q }] },
    { keyId: KEY, label: "A9-cross-on-2.5", purpose: "same unique prefix on LongCat-2.5-Preview: does one model's cache serve the other?", bound: "max_tokens 16",
  });
  tally(cross.costCny);
  const own25 = uniquePrefix("A8-own", 24);
  const a = await chat(
    { model: M25, max_tokens: 16, thinking: { type: "disabled" }, messages: [{ role: "system", content: own25 }, { role: "user", content: Q }] },
    { keyId: KEY, label: "A8-2.5-cache-call1", purpose: "2.5-Preview implicit cache, call 1/2 on its own unique prefix", bound: "max_tokens 16",
  });
  tally(a.costCny);
  const b = await chat(
    { model: M25, max_tokens: 16, thinking: { type: "disabled" }, messages: [{ role: "system", content: own25 }, { role: "user", content: Q }] },
    { keyId: KEY, label: "A8-2.5-cache-call2", purpose: "2.5-Preview implicit cache, call 2/2 (same unique prefix)", bound: "max_tokens 16",
  });
  tally(b.costCny);
  note(
    `A8 verdict (2.5-Preview, own prefix): cached=[${a.cached ?? "?"}, ${b.cached ?? "?"}] on prompt=[${a.in ?? "?"}, ${b.in ?? "?"}] ⇒ ${(b.cached ?? 0) > 0 ? "2.5-Preview caches like 2.0" : "no cache hit observed on 2.5-Preview"}`,
  );
  note(
    `A9 verdict (cross-model): 2.0 warmed cached=${on20.cached ?? 0}, then the SAME prefix on 2.5-Preview reported cached=${cross.cached ?? "?"} ⇒ ${(cross.cached ?? 0) > 0 ? "the cache is shared across models (or is not model-scoped)" : "the cache is model-scoped: a prefix warm on 2.0 is cold on 2.5-Preview"}`,
  );
}

// ── summary ──
console.log("\n================ CACHING SUITE SUMMARY ================");
for (const f of findings) console.log(`• ${f}`);
console.log(`\nTotal spend this suite: ¥${spent.toFixed(6)} (~$${(spent / 6.7252).toFixed(6)}) on ${KEY}, budget ¥${BUDGET.toFixed(2)}`);
if (spent > BUDGET) {
  console.error("BUDGET EXCEEDED");
  process.exitCode = 1;
}

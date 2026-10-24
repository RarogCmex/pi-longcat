/**
 * Doc-drift round — 2026-10-24, operator-approved ("посмотреть свежую
 * документацию, проверить reasoning-режимы, качество кода").
 *
 * Trigger: the platform docs gained two pages since the 2026-10-10 capture —
 * `api/model-params` (parameter defaults/ranges, incl. a NEW `thinking_budget`
 * and a temperature policy change from "range 0~1, rejected" to "fixed per
 * thinking state, OVERRIDDEN") and `api/responses` (the Responses surface is
 * now officially documented, with an effort scale none..xhigh and a `summary`
 * knob). The free harness re-run of 2026-10-24 already confirmed the
 * temperature drift live (1.5 → 200 accepted, was 400 on 2026-10-10).
 *
 * Questions, in order:
 *   A (free: GETs and guaranteed rejections)
 *     A1-A3  did GET /models{,/{id}} drift (supported_parameters)?
 *     A4-A6  are the newly documented top_p/top_k/repetition_penalty ranges
 *            actually validated (a 400 that names the parameter proves the
 *            field is real, for free)?
 *     A7     does the validator still report ONLY the first failure, or — as
 *            model-params now claims — every violating parameter?
 *     A8     is thinking_budget range-checked (max 262144)?
 *     A9     temperature 1.5 accepted (drift re-check with a captured body)?
 *   B (billed, bounded; reasoning modes on LongCat-2.5-Preview)
 *     B1-B4  does `thinking_budget` (top-level, the NEW documented name —
 *            `thinking.budget_tokens` was measured ignored on 2026-10-10)
 *            actually bound reasoning_tokens? Controls: no budget, and
 *            disabled+budget (disabled must win).
 *     B5-B10 Responses effort scale none/minimal/low/medium/high/xhigh, same
 *            arithmetic prompt, max_output_tokens 512: does reasoning_tokens
 *            move with the level (a real scale) or stay flat (decorative)?
 *            B7 (medium) adds summary:"auto" — does a summary arrive?
 *   C (billed; code quality)
 *     C1     the C3 microcoding task on 2.5-Preview with thinking_budget 1024:
 *            does the budget bind AND does code quality survive it? Precedent
 *            C3d (2026-10-11, no budget): own tests 11/11, independent 9/9,
 *            reasoning 7692 tokens. Scored mechanically by scoring.ts.
 *
 * Worst case as written: A ≈ ¥0.0002 (only A8/A9 can be accepted, 4 tokens
 * each), B ≈ 10 cells × ≤512 output ≈ ¥0.025, C ≤ 6144 output ≈ ¥0.05.
 * Every call is a ledger row (research/lib.ts appendRow); bodies land in
 * research/probes/DD-*.json.
 *
 * Usage: node research/probe-docdrift.ts [--only <label-prefix>] [--skip-c]
 */
import { appendRow, chat, responses, loadKeys, M20, M25, ORIGIN, pace, PRICE } from "./lib.ts";
import { C3_PROMPT, extractBlocks, scoreC3 } from "./scoring.ts";

const ONLY = (() => {
  const i = process.argv.indexOf("--only");
  return i >= 0 ? process.argv[i + 1] : undefined;
})();
const SKIP_C = process.argv.includes("--skip-c");
const KEY = "KEY1";
const ARITH = "Compute 17 * 23 + 45 * 67 - 89. Reply with only the final number and nothing else.";
const ARITH_EXPECTED = 3317;

function selected(label: string): boolean {
  return !ONLY || label.startsWith(ONLY);
}
/** Block gate: with --only, a prefix shorter than the block letter must still enter it. */
function blockSelected(letter: string): boolean {
  return !ONLY || ONLY.startsWith(letter) || letter.startsWith(ONLY);
}

/** Raw non-streaming POST/GET for the free cells: the status IS the evidence. */
async function raw(
  method: "GET" | "POST",
  path: string,
  label: string,
  purpose: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; json: any; text: string }> {
  const keys = loadKeys();
  await pace();
  const response = await fetch(`${ORIGIN}${path}`, {
    method,
    headers: { Authorization: `Bearer ${keys[KEY]}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  const promptTokens = json?.usage?.prompt_tokens;
  const outputTokens = json?.usage?.completion_tokens;
  const cached = json?.usage?.prompt_tokens_details?.cached_tokens;
  const generated = response.status === 200 && promptTokens !== undefined && !json?.error;
  appendRow({
    label: `DD-${label}`,
    key: KEY,
    model: typeof body?.model === "string" ? body.model : undefined,
    surface: method === "GET" ? "GET" : path.includes("/responses") ? "openai-responses" : "openai-completions",
    purpose,
    bound: method === "GET" ? "no inference" : `max_tokens ${body?.max_tokens ?? "-"} (rejection expected)`,
    plannedClass: "free",
    http: response.status,
    actualClass: generated ? "BILLED" : response.status === 200 ? "200-no-generation (not billed)" : "free (rejected/no inference)",
    in: promptTokens,
    out: outputTokens,
    cached,
    costCny: generated ? Math.round((((promptTokens - (cached ?? 0)) / 1e6) * PRICE.input + ((cached ?? 0) / 1e6) * PRICE.cached + (outputTokens / 1e6) * PRICE.output) * 1e8) / 1e8 : 0,
    note: text.slice(0, 300).replace(/\s+/g, " "),
  });
  return { status: response.status, json, text };
}

async function main(): Promise<void> {
  console.log(`doc-drift round 2026-10-24 — key ${KEY}, only=${ONLY ?? "all"}, skipC=${SKIP_C}`);

  // ── A: free cells ──────────────────────────────────────────────────────────
  if (blockSelected("A")) {
    if (selected("A1")) {
    const listing = await raw("GET", "/openai/v1/models", "A1-listing", "drift: does the listing still hold exactly 2.5-Preview + 2.0");
    console.log("A1 listing:", JSON.stringify((listing.json?.data ?? []).map((m: any) => [m.id, m.context_window, m.max_output_tokens])));
    }

    for (const [label, id] of [["A2-detail-2.5", M25], ["A3-detail-2.0", M20]] as const) {
      if (!selected(label)) continue;
      const detail = await raw("GET", `/openai/v1/models/${id}`, label, `drift: window/modality/pricing/supported_parameters for ${id}`);
      console.log(
        `${label}:`,
        JSON.stringify({
          context_length: detail.json?.context_length,
          input: detail.json?.architecture?.input_modalities,
          pricing: detail.json?.pricing,
          supported_parameters: detail.json?.supported_parameters,
        }),
      );
    }

    const tiny = { model: M20, messages: [{ role: "user", content: "Reply with exactly one word: ok" }], max_tokens: 4 };
    const rejections: [string, Record<string, unknown>, string][] = [
      ["A4-topp-2", { top_p: 2 }, "top_p range (0,1] validated? (new model-params page)"],
      ["A5-topk-101", { top_k: 101 }, "top_k range [-1,100] validated? (new model-params page)"],
      ["A6-reppen-1.6", { repetition_penalty: 1.6 }, "repetition_penalty range [1,1.5] validated? (new model-params page)"],
      ["A7-multi-violation", { top_p: 2, repetition_penalty: 3, top_k: 999 }, "does the 400 name EVERY violating parameter (docs now claim so) or only the first (measured 2026-10-10)?"],
      ["A8-budget-over", { thinking_budget: 262145 }, "is the NEW thinking_budget range-checked to <=262144?"],
    ];
    for (const [label, extra, purpose] of rejections) {
      if (!selected(label)) continue;
      const r = await raw("POST", "/openai/v1/chat/completions", label, purpose, { ...tiny, ...extra });
      console.log(`${label}: ${r.status} ${String(r.json?.error?.message ?? r.text).slice(0, 200).replace(/\s+/g, " ")}`);
    }

    const a9 = await raw("POST", "/openai/v1/chat/completions", "A9-temp-1.5", "temperature drift re-check: 400 (2026-10-10) vs accepted+overridden (docs 2026-10-24)", { ...tiny, temperature: 1.5 });
    console.log(`A9-temp-1.5: ${a9.status} echoed temperature=${a9.json?.temperature ?? "?"} out=${a9.json?.usage?.completion_tokens ?? "?"} err=${a9.json?.error?.message ?? "-"}`);
  }

  // ── B: billed cells, reasoning modes on 2.5-Preview ───────────────────────
  if (blockSelected("B")) {
    const bCells: [string, Record<string, unknown>, number, string][] = [
      ["B1-budget32", { thinking: { type: "enabled" }, thinking_budget: 32 }, 200, "does top-level thinking_budget=32 bound reasoning_tokens?"],
      ["B2-nobudget", { thinking: { type: "enabled" } }, 200, "control: same prompt, no budget — how many reasoning tokens does it want?"],
      ["B3-budget256", { thinking: { type: "enabled" }, thinking_budget: 256 }, 400, "does a LARGER budget move the ceiling (32 vs 256 vs none)?"],
      ["B4-off-budget32", { thinking: { type: "disabled" }, thinking_budget: 32 }, 64, "conflict cell: disabled + budget → disabled must win (no reasoning)"],
    ];
    for (const [label, extra, maxTokens, purpose] of bCells) {
      if (!selected(label)) continue;
      const r = await chat({ model: M25, messages: [{ role: "user", content: ARITH }], max_tokens: maxTokens, ...extra }, {
        keyId: KEY,
        label: `DD-${label}`,
        purpose,
        bound: `max_tokens ${maxTokens}, arithmetic prompt, 120 s timeout`,
        timeoutMs: 120_000,
      });
      console.log(
        `${label}: status=${r.status} finish=${r.finish} reasoning_tokens=${r.reasoningTokens ?? "?"} out=${r.out ?? "?"} text=${JSON.stringify((r.text || "").slice(0, 60))} err=${r.error ?? "-"} ¥${r.costCny}`,
      );
    }

    const efforts = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;
    for (const effort of efforts) {
      const label = `B5-effort-${effort}`;
      if (!selected(label)) continue;
      const reasoning: Record<string, unknown> = { effort };
      if (effort === "medium") reasoning.summary = "auto"; // B7 doubles as the summary probe
      const r = await responses(
        { model: M25, input: ARITH, max_output_tokens: 512, reasoning },
        { keyId: KEY, label: `DD-${label}`, purpose: `Responses effort scale: does effort=${effort} move reasoning_tokens?${effort === "medium" ? " (also summary:auto — does a summary arrive?)" : ""}`, bound: "max_output_tokens 512, arithmetic prompt, 120 s timeout", timeoutMs: 120_000 },
      );
      console.log(
        `${label}: status=${r.status} finish=${r.finish} reasoning_tokens=${r.reasoningTokens ?? "?"} out=${r.out ?? "?"} reasoningChars=${r.reasoning.length} text=${JSON.stringify((r.text || "").slice(0, 60))} err=${r.error ?? "-"} ¥${r.costCny}`,
      );
    }

    // Control on LongCat-2.0: README (measured 2026-10-11) says effort:none
    // ZEROED reasoning on 2.0. If it still does, the 2.5-Preview cells above are
    // a per-model difference; if it no longer does, the gateway changed.
    for (const effort of ["none", "low"] as const) {
      const label = `B6-effort20-${effort}`;
      if (!selected(label)) continue;
      const r = await responses(
        { model: M20, input: ARITH, max_output_tokens: 512, reasoning: { effort } },
        { keyId: KEY, label: `DD-${label}`, purpose: `control: effort=${effort} on LongCat-2.0 — does the 2026-10-11 'none zeroes reasoning' finding still hold?`, bound: "max_output_tokens 512, arithmetic prompt, 120 s timeout", timeoutMs: 120_000 },
      );
      console.log(
        `${label}: status=${r.status} finish=${r.finish} reasoning_tokens=${r.reasoningTokens ?? "?"} out=${r.out ?? "?"} reasoningChars=${r.reasoning.length} text=${JSON.stringify((r.text || "").slice(0, 60))} err=${r.error ?? "-"} ¥${r.costCny}`,
      );
    }

    // B7: can 2.5-Preview's reasoning be turned OFF at all on the Responses
    // surface? effort:none was just measured ignored (161 reasoning tokens);
    // try the chat-style `thinking` switch on that surface.
    for (const [label, extra] of [
      ["B7-resp25-thinking-disabled", { thinking: { type: "disabled" } }],
      ["B8-resp25-effortnone-thinking-disabled", { reasoning: { effort: "none" }, thinking: { type: "disabled" } }],
    ] as const) {
      if (!selected(label)) continue;
      const r = await responses(
        { model: M25, input: ARITH, max_output_tokens: 512, ...extra },
        { keyId: KEY, label: `DD-${label}`, purpose: "Responses surface on 2.5-Preview: is there ANY switch that zeroes reasoning (effort:none is ignored)?", bound: "max_output_tokens 512, arithmetic prompt, 120 s timeout", timeoutMs: 120_000 },
      );
      console.log(
        `${label}: status=${r.status} finish=${r.finish} reasoning_tokens=${r.reasoningTokens ?? "?"} out=${r.out ?? "?"} reasoningChars=${r.reasoning.length} text=${JSON.stringify((r.text || "").slice(0, 60))} err=${r.error ?? "-"} ¥${r.costCny}`,
      );
    }
  }

  // ── C: billed cells, code quality ─────────────────────────────────────────
  if (blockSelected("C") && !SKIP_C) {
    if (selected("C1")) {
    const r = await chat(
      { model: M25, messages: [{ role: "user", content: C3_PROMPT }], max_tokens: 6144, thinking: { type: "enabled" }, thinking_budget: 1024 },
      { keyId: KEY, label: "DD-C1-c3-budgeted", purpose: "C3 microcoding on 2.5-Preview WITH thinking_budget 1024: does the budget bind and does the code still pass?", bound: "max_tokens 6144, 480 s timeout", timeoutMs: 480_000 },
    );
    console.log(`C1: status=${r.status} finish=${r.finish} reasoning_tokens=${r.reasoningTokens ?? "?"} out=${r.out ?? "?"} ¥${r.costCny}`);
    const blocks = extractBlocks(r.text);
    console.log(`C1: extracted ${blocks.length} code block(s)`);
    if (blocks[0]) {
      const scored = scoreC3(blocks[0], blocks[1]);
      console.log(`C1 score: theirs=${scored.theirs.summary} | independent=${scored.ours.summary}`);
      appendRow({
        label: "DD-C1-score",
        key: KEY,
        model: M25,
        surface: "local",
        purpose: "mechanical score of DD-C1-c3-budgeted (no API call)",
        bound: "local node --test",
        plannedClass: "free",
        http: "n/a",
        actualClass: "free (rejected/no inference)",
        costCny: 0,
        note: `blocks=${blocks.length} theirs=${scored.theirs.summary} ours=${scored.ours.summary} dir=${scored.dir}`,
      });
    } else {
      console.log(`C1: NO CODE BLOCK — text=${JSON.stringify(r.text.slice(0, 200))} reasoning=${JSON.stringify(r.reasoning.slice(0, 200))}`);
    }
    }

    // C2: the same task with thinking DISABLED. Precedent C3c (2026-10-11):
    // 8/9 independent — compounds unsupported. Re-measured because the docs
    // changed the thinking-off sampling policy (temperature now forced 0.7),
    // and because B4 showed thinking-off arithmetic going WRONG on 2.5.
    if (selected("C2")) {
      const r = await chat(
        { model: M25, messages: [{ role: "user", content: C3_PROMPT }], max_tokens: 4096, thinking: { type: "disabled" } },
        { keyId: KEY, label: "DD-C2-c3-thinking-off", purpose: "C3 microcoding on 2.5-Preview with thinking DISABLED under the new forced-0.7 policy: does the 8/9 C3c precedent still hold?", bound: "max_tokens 4096, 240 s timeout", timeoutMs: 240_000 },
      );
      console.log(`C2: status=${r.status} finish=${r.finish} reasoning_tokens=${r.reasoningTokens ?? "?"} out=${r.out ?? "?"} ¥${r.costCny}`);
      const blocks = extractBlocks(r.text);
      console.log(`C2: extracted ${blocks.length} code block(s)`);
      if (blocks[0]) {
        const scored = scoreC3(blocks[0], blocks[1]);
        console.log(`C2 score: theirs=${scored.theirs.summary} | independent=${scored.ours.summary}`);
        appendRow({
          label: "DD-C2-score",
          key: KEY,
          model: M25,
          surface: "local",
          purpose: "mechanical score of DD-C2-c3-thinking-off (no API call)",
          bound: "local node --test",
          plannedClass: "free",
          http: "n/a",
          actualClass: "free (rejected/no inference)",
          costCny: 0,
          note: `blocks=${blocks.length} theirs=${scored.theirs.summary} ours=${scored.ours.summary} dir=${scored.dir}`,
        });
      } else {
        console.log(`C2: NO CODE BLOCK — text=${JSON.stringify(r.text.slice(0, 200))}`);
      }
    }
  }

  console.log("done — rows appended to research/probe-ledger.jsonl; regenerate with: node scripts/ledger-report.ts");
}

main().catch((e) => {
  console.error("probe round failed:", e);
  process.exit(1);
});

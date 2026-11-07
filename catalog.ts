/**
 * Curated LongCat (Meituan) catalog for https://api.longcat.chat.
 *
 * Provenance — every number below says where it came from and when. Nothing is
 * guessed; where the provider's own sources disagreed, the disagreement is
 * recorded and the measured value won.
 *
 *   ids            GET /openai/v1/models, live 2026-10-10, on all nine keys:
 *                  ["LongCat-2.5-Preview", "LongCat-2.0"] — identical list per
 *                  key, so the listing is account-global, not key-scoped.
 *                  Re-read 2026-11-07 on all nine keys: ["LongCat-2.5-Preview",
 *                  "LongCat-2.5", "LongCat-2.0"], still identical per key. The
 *                  change log gained "Version: 2026-11-02 — LongCat-2.5 Now
 *                  Available" and the docs were rewritten around it: quick start,
 *                  api/model-params, the FAQ and every pricing page now name
 *                  LongCat-2.5 and no longer mention 2.5-Preview or 2.0 — while
 *                  BOTH are still served (8-token liveness calls on each completed
 *                  on 2026-11-07). The catalog keeps all three: dropping a working
 *                  id because a web page stopped linking it would break users
 *                  mid-session. The two undocumented ones say so in priceNote.
 *   contextWindow  GET /openai/v1/models → `context_window: 1048576` and
 *                  GET /openai/v1/models/{id} → `context_length: 1048576`
 *                  (two machine-readable sources agree, 2026-10-10).
 *                  NOT independently measured: the only free oracle for a window
 *                  is a prompt+max_tokens sum above it, and on this gateway the
 *                  `max_tokens` ceiling check fires first (measured: a 1 048 576
 *                  request is rejected with "/max_tokens: 1048576 is not less or
 *                  equal to 131072", i.e. it never reaches a context check).
 *                  Measuring it for real needs a ~1M-token prompt, which is
 *                  billed in full if accepted (≈¥2), so it was deliberately not
 *                  run — see README "What is verified live, and how".
 *   maxTokens      MEASURED live 2026-10-10 with the cap oracle (a rejected
 *                  request costs nothing): LongCat-2.0 → 400 "/max_tokens:
 *                  131073 is not less or equal to 131072"; LongCat-2.5-Preview →
 *                  400 "/max_tokens: 262145 is not less or equal to 262144".
 *                  This settled a three-way contradiction (listing 262144 vs
 *                  api/chat + FAQ 128k) in favour of 262144 — and by 2026-10-24
 *                  the provider agreed with the measurement: the new
 *                  api/model-params page documents 262,144 (256K) for
 *                  2.5-Preview and 131,072 (128K) for 2.0, and api/chat now
 *                  defers to it. Re-run of the cap sweep on 2026-10-24: both
 *                  400s unchanged.
 *                  Caveat: enforced on the chat and Anthropic surfaces only —
 *                  /openai/v1/responses ACCEPTED max_output_tokens 131073
 *                  (measured 2026-10-10), so the cap oracle is dead there.
 *                  Re-swept 2026-11-07: LongCat-2.5 → 400 at 262145 naming 262144
 *                  (api/model-params still publishes 262,144 for it), and
 *                  2.5-Preview unchanged. But **2.0's 131073 was ACCEPTED (HTTP
 *                  200, billed, 28 tokens)** — the first 200 this oracle has ever
 *                  produced here — and 262145 then 400s naming 262144, so the
 *                  validator's ceiling for 2.0 moved to 262144 while GET /models
 *                  still advertises `max_output_tokens: 131072` for the same id.
 *                  The two sources now disagree and nothing free can settle which
 *                  one generation honours: an accepted request proves the
 *                  VALIDATOR gave way, not that 2.0 emits 131073 tokens. So the
 *                  catalog keeps the conservative published 131072 clamp and
 *                  records the disagreement instead of raising a user's cap on the
 *                  strength of a validator that stopped rejecting. Fixtures:
 *                  CAP7-chat-2.0-262145.json (the 400),
 *                  CAP8-chat-2.0-131073-accepted.json (the 200).
 *   prices (¥/1M)  GET /openai/v1/models/{id} → pricing {prompt "2",
 *                  completion "8", cached_tokens "0.04"} for all three ids
 *                  (2026-10-10, re-read 2026-11-07: LongCat-2.5 carries the same
 *                  three numbers). Matches the CNY column of the pricing page
 *                  (¥2 / ¥8 / ¥0.04), not the USD column ($0.30 / $1.20 /
 *                  $0.006) ⇒ these keys bill in CNY. Cache-hit accounting was
 *                  then measured, not assumed: two identical 836-token chat
 *                  calls reported cached_tokens 0 then 768 (2026-10-11).
 *   input mods     GET /openai/v1/models/{id} → architecture.input_modalities:
 *                  ["text","image"] for 2.5-Preview, ["text"] for 2.0,
 *                  ["text","image","video"] for LongCat-2.5 (2026-11-07).
 *                  2.5-Preview vision was then proven behaviourally (2026-10-11):
 *                  a generated 256×256 GREEN png (a colour the prompt cannot
 *                  suggest) was named "Green" with thinking enabled, and the
 *                  image cost input tokens (22 → 102). The same probe with
 *                  thinking disabled answered "White" / "Blank white rectangular
 *                  image" — see LONGCAT_VISION_CAVEAT.
 *                  2.0 accepted the identical image part and DROPPED it: input
 *                  tokens unchanged at 19 with and without the image (2026-10-11).
 *                  LongCat-2.5 is listed as ["text","image","video"] (2026-11-07).
 *                  Video is advertised but NOT registered: pi 1.5.0's
 *                  `ModelInputModality` is exactly ["text","image"]
 *                  (pi-ai/dist/providers/model-schema.js:5), so no field value
 *                  would let pi send a `video_url` block. The gateway does parse
 *                  one — a bogus `video_url` is rejected with 400 "Failed to
 *                  download video from URL" on BOTH 2.5 and 2.5-Preview (measured
 *                  2026-11-07), which proves the block is read, not ignored.
 *   thinking       `supported_parameters` on both models lists `thinking`;
 *                  docs specify {"type":"enabled"} / {"type":"disabled"}.
 *                  Measured 2026-10-10/11 on the chat surface: enabled →
 *                  `reasoning_content` + `completion_tokens_details.
 *                  reasoning_tokens: 7`; disabled → no reasoning, answer "ok";
 *                  field ABSENT → reasoning happens anyway, i.e. **thinking is
 *                  ON by default**. An invalid `{"type":"bogus"}` was accepted
 *                  and ignored, so acceptance proves nothing here — the switch
 *                  was verified by its output, not by its status code.
 *
 * What is deliberately NOT here (README "Not registered" carries the reasons):
 *   - The six retired Flash ids (LongCat-Flash-Chat, -Flash-Thinking,
 *     -Flash-Thinking-2601, -Flash-Lite, -Flash-Omni-2603,
 *     -Flash-Chat-2602-Exp): sunset 2026-05-29 per the platform change log and
 *     absent from the live listing. They are in EXCLUDED_MODEL_IDS so a future
 *     listing that re-serves one cannot be auto-registered.
 *   - Non-chat modalities: none exist on this platform as of 2026-10-11
 *     (POST /openai/v1/embeddings → 404; no audio/image-generation endpoint is
 *     documented or listed).
 */

import type { ThinkingLevelMap } from "@earendil-works/pi-ai";

/**
 * The two wire surfaces this plugin can register. Both live under the same base
 * URL (`https://api.longcat.chat/openai/v1`): pi's adapters append
 * `/chat/completions` and `/responses` respectively.
 *
 * The gateway also serves Anthropic Messages at
 * `https://api.longcat.chat/anthropic/v1/messages`, and it works (measured
 * 2026-10-10: streaming, tool_use blocks, thinking on/off), but it is NOT
 * registered: pi's Anthropic adapter authenticates with `x-api-key`
 * (pi-ai/dist/api/anthropic-messages.js:843-845) and this gateway rejects that
 * header with 401 `missing_api_key` (measured 2026-10-11). Supporting it would
 * mean a header-injecting fetch wrapper for no capability the other two lack.
 */
export type GatewayApi = "openai-completions" | "openai-responses";

/** Chinese Yuan per 1M tokens — the currency this platform bills in. */
export interface CnyPrice {
  input: number;
  output: number;
  /** Cache-hit input rate; the platform has no separate cache-write price. */
  cacheRead: number;
}

/**
 * How a model exposes reasoning, as a discriminated union rather than scattered
 * booleans. LongCat has exactly one real shape — a binary `thinking` object —
 * plus `none` for an id whose thinking was never measured (the live overlay's
 * unknown-family case): publishing a switch we did not verify would be worse
 * than publishing none, on a gateway where thinking is ON by default.
 */
export type ThinkingControl =
  | { kind: "toggle"; levels: ThinkingLevelMap }
  | { kind: "none" };

export interface CatalogEntry {
  /** Exact platform id — case-sensitive; an unknown id is a 400, not a 404. */
  id: string;
  name: string;
  contextWindow: number;
  /** Enforced `max_tokens` ceiling (measured), also pi's clamp for user caps. */
  maxTokens: number;
  input: ("text" | "image")[];
  thinking: ThinkingControl;
  cny: CnyPrice;
  /** Free-text caveat for the README; pi's Model has no notes field. */
  priceNote?: string;
}

/**
 * pi has six positive thinking levels; LongCat has one state ("thinking on").
 * The map therefore offers `off` plus a single positive level and marks the rest
 * unsupported, so pi clamps any higher request down to `low` instead of selling
 * a scale the provider does not have.
 *
 * `off` is a STRING on every model×surface pair where an off token was measured
 * to work — that is what makes the off switch reachable at all:
 *   - chat (pi's `zai` thinking format): enable/disable comes from
 *     `!!options.reasoningEffort`, and pi turns the level "off" into
 *     `undefined` before the adapter (pi-ai openai-completions.js:527), so the
 *     map value is unused but its null-ness is not — `off: null` would hide the
 *     level and clamp requests UP to `low`, i.e. bill thinking the user turned
 *     off. Measured working on BOTH models (`thinking:{"type":"disabled"}` →
 *     no reasoning).
 *   - Responses + LongCat-2.0: pi sends `reasoning: { effort: map.off ?? "none" }`
 *     when no level was requested (openai-responses.js:303-307). `"none"`
 *     zeroes reasoning on 2.0 (2026-10-11: output 8 → 2, reasoning_tokens 7 → 0;
 *     re-measured 0 on 2026-10-24).
 *   - Anthropic (unregistered, kept for the record): pi emits
 *     `thinking: {type:"disabled"}` only when `map.off !== null`
 *     (anthropic-messages.js:914,978).
 * `low` maps to `"low"` because that is the only effort token measured accepted
 * on the Responses surface (`reasoning: {effort:"low"}` echoed back, 2026-10-10);
 * on chat the value is never sent (supportsReasoningEffort is false).
 */
export const LONGCAT_THINKING: ThinkingLevelMap = {
  off: "none",
  minimal: null,
  low: "low",
  medium: null,
  high: null,
  xhigh: null,
  max: null,
};

/**
 * The ONE measured exception to "off is a string": the 2.5 family on the
 * Responses surface has **no off switch at all** (2026-10-24, ledger DD-B5/B7/B8):
 * `effort:"none"` → reasoning_tokens 161, chat-style `thinking:{"type":
 * "disabled"}` → 299, both together → 125 — nothing zeroes reasoning there,
 * while on 2.0 `effort:"none"` still zeroes (0 tokens, DD-B6).
 *
 * So `off: null` here is not the "bill thinking the user turned off" trap the
 * LONGCAT_THINKING comment warns about — on this pair the reasoning is billed
 * whatever the user picks. `null` makes pi's picker offer only `low`
 * (`getSupportedThinkingLevels` drops null-mapped levels) and clamps an explicit
 * "off" request UP to `low`; the adapter then omits `reasoning` entirely when no
 * level is requested (`thinkingLevelMap?.off !== null` guard,
 * openai-responses.js:303), leaving the gateway's think-by-default. Honest UI:
 * a switch that does nothing is worse than no switch. Operator decision
 * 2026-10-24.
 *
 * The "no off switch" half was then re-measured at a real sample on 2026-10-25
 * (ledger DD-E2/E3, research/notes.md §11): the six documented effort levels
 * are indistinguishable from sending NO reasoning field at all — divcount
 * medians 324/323/450/268/315/338 vs baseline 327, Kruskal–Wallis p = 0.713 —
 * and `summary` is flat too. So `low` is the whole of what this pair offers,
 * not a limitation of the map.
 */
export const LONGCAT_THINKING_RESPONSES_25: ThinkingLevelMap = {
  off: null,
  minimal: null,
  low: "low",
  medium: null,
  high: null,
  xhigh: null,
  max: null,
};

/**
 * Which level map a model gets on a given surface. Keyed on the 2.5 FAMILY
 * regex (same convention as `guessContext` in models.ts): the broken off switch
 * was measured on LongCat-2.5-Preview, and an unmeasured future 2.5-x id on
 * Responses inherits "no off offered" rather than a token nobody verified —
 * publishing an unverified off switch is exactly what this catalog refuses
 * elsewhere.
 */
export function thinkingLevelsFor(id: string, api: GatewayApi, levels: ThinkingLevelMap): ThinkingLevelMap {
  if (api === "openai-responses" && /^longcat-2\.5/i.test(id)) return LONGCAT_THINKING_RESPONSES_25;
  return levels;
}

/**
 * Measured caveat that belongs next to any "supports images" claim.
 *
 * **Re-measured 2026-11-07 and the old surface story does not survive.** The probe
 * below (solid-colour PNG, "what single colour") was re-run on the current platform
 * — 256×256 green, five cells per run, three runs (research/probe-25-vision.ts,
 * ledger rows GA-V-*):
 *   - LongCat-2.5, chat, thinking on   → 5/15 green
 *   - LongCat-2.5, chat, thinking off  → 1/9 green
 *   - LongCat-2.5, Responses, low      → 6/15 green
 *   - LongCat-2.5-Preview, chat        → 2/6 green (it was 4/4 on 2026-10-24)
 *   - solid RED png, chat, thinking on → 0/6 ("Magenta", "lavender", "Yellow", "Pink"…)
 *   - solid BLUE png, chat, thinking on → 2/6
 * So the Responses-only defect this plugin warns about (DD3, 2026-10-24: 1/6 vs
 * 4/4) is no longer a surface difference — it is a platform-wide wobble on small
 * solid-colour images, and with it goes the "use the chat surface for image work"
 * advice.
 *
 * Three controls say the image is nevertheless read: a text-only run of the same
 * question answers "I don't see an image attached"; image tokens are billed
 * (19 → 102 at 256², 345 at 512²); and a 512×512 white field with 2 or 3 black
 * bars was counted correctly 4/4 on LongCat-2.5 (same day). Naming the colour of
 * a small image is the unreliable part; structure is not.
 *
 * The original 2026-10-11 measurement, kept for provenance:
 * 2026-10-11, LongCat-2.5-Preview, generated solid-colour PNGs, question "What
 * single colour is this image? Answer with one word.":
 *   thinking enabled, max_tokens 64  → "Green" for a green 256×256 png, with
 *                                      reasoning "Looking at the image, it
 *                                      appears to be a solid green color" ✓
 *   thinking disabled, max_tokens 8  → "White" for the same green png ✗
 *   thinking disabled, max_tokens 8  → "White" for a red 64×64 png ✗
 *   thinking disabled, max_tokens 32 → "Blank white rectangular image." ✗
 * So the image is genuinely consumed (input tokens 22 → 102 → 1393 as the image
 * grows) and genuinely seen with thinking on, but the same model answers wrongly
 * with thinking off. Do not read that as "vision unsupported": it is "vision
 * unreliable at --thinking off".
 */
export const LONGCAT_VISION_CAVEAT =
  "images are accepted and genuinely consumed on both surfaces and on both " +
  "image-capable ids, LongCat-2.5 and its Preview (image tokens billed: 19 → 102 " +
  "for a 256×256 png, 345 for 512×512; a " +
  "text-only run of the same question answers \"I don't see an image attached\", " +
  "measured 2026-11-07) and structural reading works (a white field with 2 or 3 " +
  "black bars was counted correctly 4/4 on LongCat-2.5, same day); but naming the " +
  "COLOUR of a small image is unreliable on BOTH image-capable ids and BOTH " +
  "surfaces (green named green in 5/15 chat runs on 2.5, 6/15 on Responses, 2/6 " +
  "on 2.5-Preview; a " +
  "solid RED png 0/6) — treat fine colour/detail claims about small images as " +
  "suspect, and note that switching surface no longer changes the outcome";

/**
 * Minimum image AREA in px² the gateway enforces: a request is rejected with
 * `Image too small (area=Npx), minimum required area: >200px` unless W×H > 200.
 * Measured 2026-11-07 by bracket, every cell free: 64 px (8×8) and 196 px (14×14)
 * are rejected, 225 px (15×15) is accepted. It was >256 px when first measured on
 * 2026-10-11 (the same 8×8 request named 256 back then), and the docs' new
 * "Minimum area W × H at least 200 px" agrees with today's number, so the platform
 * relaxed it.
 */
export const MIN_IMAGE_AREA_PX = 200;

export const CATALOG: readonly CatalogEntry[] = [
  {
    id: "LongCat-2.5",
    name: "LongCat 2.5",
    contextWindow: 1_048_576, // listing + retrieve agree; not independently measured (see header)
    maxTokens: 262_144, // measured 2026-11-07: 262145 → 400 "is not less or equal to 262144"
    input: ["text", "image"], // listing adds "video"; pi 1.5.0 has no video modality (see header)
    thinking: { kind: "toggle", levels: LONGCAT_THINKING },
    cny: { input: 2, output: 8, cacheRead: 0.04 },
    priceNote:
      "The documented model since the 2026-11-02 change log (the docs no longer " +
      "link 2.5-Preview or 2.0 at all). " + LONGCAT_VISION_CAVEAT +
      `. Images with an area of ${MIN_IMAGE_AREA_PX} px² or less are rejected with 400 ` +
      '("Image too small (area=64px), minimum required area: >200px", measured 2026-11-07). ' +
      "Native tool calling measured working (finish_reason tool_calls, 2026-11-07); the " +
      "thinking off switch works on the chat surface and is still dead on Responses " +
      "(`reasoning:{effort:\"none\"}` → 23 reasoning tokens, 2026-11-07).",
  },
  {
    id: "LongCat-2.5-Preview",
    name: "LongCat 2.5 Preview",
    contextWindow: 1_048_576, // listing + retrieve agree; not independently measured (see header)
    maxTokens: 262_144, // measured 2026-10-10: 262145 → 400 "is not less or equal to 262144"
    input: ["text", "image"], // measured: image tokens billed + a non-guessable colour named correctly
    thinking: { kind: "toggle", levels: LONGCAT_THINKING },
    cny: { input: 2, output: 8, cacheRead: 0.04 },
    priceNote:
      "Superseded by LongCat-2.5 but STILL SERVED, and no longer documented by the " +
      "platform (the docs stopped linking it between 2026-10-24 and 2026-11-07; a " +
      "live 8-token call on 2026-11-07 still completed, so it stays registered). " +
      LONGCAT_VISION_CAVEAT +
      `. Images with an area of ${MIN_IMAGE_AREA_PX} px² or less are rejected with 400 ` +
      '("Image too small (area=64px), minimum required area: >200px", measured 2026-11-07).',
  },
  {
    id: "LongCat-2.0",
    name: "LongCat 2.0",
    contextWindow: 1_048_576, // listing + retrieve agree; not independently measured (see header)
    maxTokens: 131_072, // published clamp; the validator now allows 262144 — see the header
    // Text only. The listing says input_modalities ["text"], and an image part
    // sent anyway was accepted with ZERO effect: input tokens identical (19)
    // with and without the png, and the model reasoned "We are given an image?
    // Wait" — accepted-and-dropped, not supported (2026-10-11).
    input: ["text"],
    thinking: { kind: "toggle", levels: LONGCAT_THINKING },
    cny: { input: 2, output: 8, cacheRead: 0.04 },
    priceNote:
      "No longer documented by the platform (its docs stopped mentioning 2.0 between " +
      "2026-10-24 and 2026-11-07) but still served: a live 8-token call on 2026-11-07 " +
      "completed. Its output ceiling is now CONTRADICTORY: GET /models advertises " +
      "131072 and the catalog keeps that clamp, while the validator accepted " +
      "max_tokens 131073 (HTTP 200) and only rejected 262145, naming 262144 — see the " +
      "header. " +
      "Native tool calling measured working on the chat surface " +
      "(finish_reason tool_calls) and on the Anthropic surface (stop_reason " +
      "tool_use), 2026-10-10.",
  },
];

export const CATALOG_BY_ID: ReadonlyMap<string, CatalogEntry> = new Map(
  CATALOG.map((entry) => [entry.id, entry]),
);

/**
 * Ids this plugin has decided about and will NOT register, so the discovery
 * overlay cannot re-add them. "Known" = registered ∪ excluded (pitfalls C28).
 *
 * All six were retired by the platform on 2026-05-29 (change log) and none
 * appears in GET /models as of 2026-10-10.
 */
export const EXCLUDED_MODEL_IDS: readonly string[] = [
  "LongCat-Flash-Chat",
  "LongCat-Flash-Thinking",
  "LongCat-Flash-Thinking-2601",
  "LongCat-Flash-Lite",
  "LongCat-Flash-Omni-2603",
  "LongCat-Flash-Chat-2602-Exp",
];

/** Case-insensitive lookup helper for the known-id predicate. */
export function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}

/**
 * The single "have we decided about this id?" predicate. Used by the discovery
 * overlay so a refresh can neither re-add an excluded id nor freeze a stale copy
 * of a curated one (pi merges overlays by id and never deletes).
 */
export function isKnownId(id: string): boolean {
  const normalized = normalizeId(id);
  if (CATALOG.some((entry) => normalizeId(entry.id) === normalized)) return true;
  return EXCLUDED_MODEL_IDS.some((excluded) => normalizeId(excluded) === normalized);
}

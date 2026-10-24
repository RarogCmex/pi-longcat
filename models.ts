/**
 * Catalog → pi `Model` conversion.
 *
 * Four things pi cannot infer for `api.longcat.chat`:
 *
 *  1. Currency. The platform bills in CNY (¥2 / ¥8 / ¥0.04 per 1M tokens, read
 *     from `GET /openai/v1/models/{id}` on 2026-10-10 — the machine-readable
 *     pricing object matches the CNY column of the pricing page, not the USD
 *     column, which is how we know which of the two published columns applies to
 *     these keys). pi's `ModelCost` is USD per million, so the conversion uses a
 *     dated rate overridable via `LONGCAT_CNY_PER_USD`.
 *
 *  2. The wire surface. `LONGCAT_SURFACE` picks chat completions (default) or
 *     Responses; exactly one adapter is constructed per process, so a model can
 *     never point at a surface that was not registered. See `resolveSurface`.
 *
 *  3. Compat flags. Auto-detection classifies `api.longcat.chat` as a vanilla
 *     OpenAI endpoint (there is no rule for this host in
 *     `pi-ai/dist/api/openai-completions.js:1229-1313`), and that profile is
 *     wrong in six places — every line below is either a measurement or a
 *     documented absence, with the date:
 *      - `thinkingFormat: "zai"`   the single most important flag. LongCat's
 *        switch is `thinking: {"type":"enabled"|"disabled"}` — byte-identical to
 *        what pi's zai branch emits (`openai-completions.js:625-627`, including
 *        `clear_thinking: false`, which this gateway accepts). The auto-detected
 *        `"openai"` format would send `reasoning_effort` instead and NO thinking
 *        object, leaving thinking permanently ON (it is on by default here).
 *      - `supportsReasoningEffort: false`  auto-detect says TRUE. `reasoning_effort`
 *        is absent from `supported_parameters`; sending it returned 200 with no
 *        observable difference (2026-10-10), and "200 but nothing observable"
 *        means do not send.
 *      - `supportsDeveloperRole: false`  auto-detect says TRUE. Measured
 *        2026-10-11: a 43-token `role:"developer"` message left `prompt_tokens`
 *        at 14 — identical to the no-system-message baseline — while the same
 *        text as `role:"system"` raised it to 57. The role is silently dropped.
 *      - `maxTokensField: "max_tokens"`  auto-detect says `max_completion_tokens`.
 *        `supported_parameters` lists `max_tokens` only, and the gateway's own
 *        validator names `/max_tokens` (measured 2026-10-10: "/max_tokens:
 *        131073 is not less or equal to 131072"). See R7 in
 *        research/probe-ledger.jsonl for the behavioural confirmation.
 *      - `supportsStore: false`, `supportsLongCacheRetention: false`
 *        auto-detect says TRUE for both. Neither `store` nor
 *        `prompt_cache_retention` appears in `supported_parameters`; sending
 *        them would imply a cache control the platform does not offer.
 *      - `supportsUsageInStreaming` / `supportsFinishReason` stay TRUE because
 *        both were measured working (2026-10-10: a final SSE chunk carrying
 *        `usage` with `stream_options.include_usage`, and `finish_reason`
 *        `stop` / `length` / `tool_calls`).
 *
 *  4. Thinking levels. One map serves both surfaces, because pi derives each
 *     surface's off token from the same `thinkingLevelMap.off` entry — see
 *     `LONGCAT_THINKING` in catalog.ts for the three code paths and the
 *     measurements behind them.
 *
 * Deliberately NOT set: `promptCache`. The platform's cache is implicit and no
 * TTL is published anywhere in the docs, and pi's cache warmer only fires for
 * models that declare one — declaring a guessed TTL would make pi send extra
 * *billed* warming requests for a cache we cannot keep alive. What the cache is
 * worth is measured instead: two identical 836-token chat calls reported
 * `cached_tokens` 0 then 768, i.e. a 8.6× cheaper second call at the ¥0.04 rate
 * (2026-10-11). `cacheRead` is priced from that; `cacheWrite` is 0 because no
 * separate write price exists.
 */

import type {
  Model,
  ModelCost,
  OpenAICompletionsCompat,
  OpenAIResponsesCompat,
} from "@earendil-works/pi-ai";
import {
  CATALOG,
  LONGCAT_THINKING,
  thinkingLevelsFor,
  type CatalogEntry,
  type CnyPrice,
  type GatewayApi,
  type ThinkingControl,
} from "./catalog.ts";

export type { GatewayApi } from "./catalog.ts";

export const PROVIDER_ID = "longcat";

/**
 * Both surfaces live under the same base URL: pi appends `/chat/completions` or
 * `/responses`. Kept as a per-surface map (rather than one constant) so the
 * provider assembly reads the same way it does in the siblings that DO have
 * separate hosts, and so a future split is a data change.
 */
export const BASE_URL = "https://api.longcat.chat/openai/v1";
export const BASE_URL_BY_API: Readonly<Record<GatewayApi, string>> = {
  "openai-completions": BASE_URL,
  "openai-responses": BASE_URL,
};
export const DEFAULT_BASE_URL = BASE_URL;

/** Where the model listing lives (both prefixes serve an identical body). */
export const LISTING_URL = `${BASE_URL}/models`;

/**
 * The surface every model is registered with unless the user says otherwise.
 *
 * Chat completions is the default even though the house priority normally puts
 * Responses first, because on THIS gateway the Responses advantages were
 * measured absent and four defects were measured present (2026-10-10/11,
 * re-checked 2026-10-24):
 *   - it WAS undocumented — found by probing; the platform has since published
 *     an `api/responses` page (captured 2026-10-24), so this defect is history,
 *     but the next three are still live;
 *   - it does not enforce the output cap that both other surfaces enforce
 *     (`max_output_tokens: 131073` accepted for a model capped at 131072);
 *   - it answers validation failures with **HTTP 200** + an in-band
 *     `{"error":…}` body (two cases recorded), which pi would parse as an empty
 *     stream; `errors.ts` re-statuses those, but the surface is the only reason
 *     that wrapper exists;
 *   - its thinking off switch (`reasoning:{effort:"none"}`) is honoured for
 *     LongCat-2.0 text (reasoning_tokens 0, re-measured 2026-10-24) but was
 *     IGNORED when the request carried an image (2026-10-11), and on
 *     **LongCat-2.5-Preview it is ignored outright** — no switch zeroes
 *     reasoning there (effort:none → 161 tokens, thinking:disabled → 299, both
 *     → 125; 2026-10-24).
 *   - and the usual Responses selling point, cache accounting that reports hits,
 *     is not an advantage here: the chat surface reports `cached_tokens` too
 *     (768 of 836 measured).
 * `LONGCAT_SURFACE=responses` still registers it, for reasoning-item replay.
 */
export const DEFAULT_SURFACE: GatewayApi = "openai-completions";
export const SURFACE_ENV_VAR = "LONGCAT_SURFACE";
export const BASE_URL_ENV_VAR = "LONGCAT_BASE_URL";
export const API_KEY_ENV_VAR = "LONGCAT_API_KEY";

/**
 * CNY per 1 USD. Mid-market rate observed 2026-09-15 (open.er-api.com), the same
 * value and date the other CNY-billed gateway plugins in this repo use, so cost
 * reports stay comparable across them. Overridable because FX drifts; a stale
 * rate is a silently wrong cost report, which is why the date is a constant
 * name rather than a comment.
 */
export const DEFAULT_CNY_PER_USD = 6.7252;
export const CNY_RATE_DATE = "2026-09-15";

/** Precision so the ¥0.04 cache rate stays non-zero after conversion. */
const USD_DECIMALS = 1e6;

export function cnyPerUsd(env: (name: string) => string | undefined = (n) => process.env[n]): number {
  const raw = env("LONGCAT_CNY_PER_USD");
  const parsed = raw === undefined ? Number.NaN : Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CNY_PER_USD;
}

export function cnyToUsd(cny: number, rate: number): number {
  return Math.round((cny / rate) * USD_DECIMALS) / USD_DECIMALS;
}

/**
 * Which surface to register. Accepts the pi api id or a short name, trims, and is
 * case-insensitive. An unrecognized value falls back to the default rather than
 * failing at startup, and `recognized: false` is what lets `index.ts` warn about
 * it: there is no notify at registration time, so a silent fallback would leave
 * a user who typed `LONGCAT_SURFACE=chat-completions` wondering why nothing
 * changed (pitfalls P52).
 *
 * `anthropic` is recognized as a *request* and reported as unavailable rather
 * than silently ignored — the surface exists and works, it just cannot be
 * registered (see GatewayApi in catalog.ts for the measured reason).
 */
export function resolveSurface(
  env: (name: string) => string | undefined = (n) => process.env[n],
): { api: GatewayApi; requested?: string; recognized: boolean; unavailable?: string } {
  const raw = env(SURFACE_ENV_VAR)?.trim();
  if (!raw) return { api: DEFAULT_SURFACE, recognized: true };
  const lowered = raw.toLowerCase();
  if (lowered === "chat" || lowered === "completions" || lowered === "openai-completions")
    return { api: "openai-completions", requested: raw, recognized: true };
  if (lowered === "responses" || lowered === "openai-responses")
    return { api: "openai-responses", requested: raw, recognized: true };
  if (lowered === "anthropic" || lowered === "messages" || lowered === "anthropic-messages")
    return {
      api: DEFAULT_SURFACE,
      requested: raw,
      recognized: true,
      unavailable:
        "the Anthropic surface cannot be registered: pi's Anthropic adapter sends `x-api-key`, " +
        "which api.longcat.chat rejects with 401 missing_api_key (measured 2026-10-11)",
    };
  return { api: DEFAULT_SURFACE, requested: raw, recognized: false };
}

/** Endpoint override for a proxy or mirror. Trailing slashes are trimmed. */
export function resolveBaseUrl(
  api: GatewayApi,
  env: (name: string) => string | undefined = (n) => process.env[n],
): string {
  const trimmed = env(BASE_URL_ENV_VAR)?.trim().replace(/\/+$/, "");
  return trimmed ? trimmed : BASE_URL_BY_API[api];
}

function toCost(cny: CnyPrice, rate: number): ModelCost {
  return {
    input: cnyToUsd(cny.input, rate),
    output: cnyToUsd(cny.output, rate),
    cacheRead: cnyToUsd(cny.cacheRead, rate),
    // The platform publishes no cache-write price; cached input is billed at cacheRead.
    cacheWrite: 0,
  };
}

/**
 * Chat-completions flags. See the header for the measurement or documented
 * absence behind each one; the six that differ from pi's auto-detected profile
 * for this host are marked.
 */
export const CHAT_COMPAT: OpenAICompletionsCompat = {
  thinkingFormat: "zai", // differs from auto-detect ("openai") — the off switch depends on it
  supportsReasoningEffort: false, // differs from auto-detect (true)
  supportsDeveloperRole: false, // differs from auto-detect (true) — measured dropped
  maxTokensField: "max_tokens", // differs from auto-detect (max_completion_tokens)
  supportsStore: false, // differs from auto-detect (true)
  supportsLongCacheRetention: false, // differs from auto-detect (true)
  supportsStrictMode: false,
  supportsUsageInStreaming: true,
  supportsFinishReason: true,
  requiresToolResultName: false,
  requiresAssistantAfterToolResult: false,
  requiresThinkingAsText: false, // measured: reasoning arrives in `reasoning_content`
  supportsOpenAIGrammarTools: false,
  zaiToolStream: false, // `tool_stream` is Zhipu-specific and not in supported_parameters
};

/**
 * Responses flags — each one a documented absence rather than a guess.
 * `supported_parameters` (from `GET /models/{id}`, 2026-10-10) lists exactly:
 * max_tokens, temperature, top_p, stream, tools, tool_choice, thinking. Nothing
 * else is in the contract, and on this gateway "accepted" is not evidence
 * (`reasoning_effort` and an invalid `thinking.type` were both accepted and
 * ignored), so the flags follow the contract.
 */
export const RESPONSES_COMPAT: OpenAIResponsesCompat = {
  supportsDeveloperRole: false, // measured dropped on chat; not separately probed on Responses
  supportsLongCacheRetention: false, // default true — no prompt_cache_retention in the contract
  supportsStrictMode: false, // no `strict` in the contract
  supportsOpenAIGrammarTools: false,
  supportsAdditionalTools: false,
  supportsToolSearch: false,
  supportsExplicitPromptCacheMode: false, // no prompt_cache_options in the contract
  supportsMaxOutputTokens: true, // measured: echoed back and enforced as an output bound
  supportsMidConvoSystemMessages: false,
};

const ZERO_COST: ModelCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export type LongCatModel = Model<GatewayApi>;

/** Fields that do not depend on which surface the model is registered on —
 *  except the level map, which does since 2026-10-24: 2.5-family ids on the
 *  Responses surface hide `off` because no token zeroes their reasoning there
 *  (measured; see LONGCAT_THINKING_RESPONSES_25 in catalog.ts). */
function sharedFields(entry: CatalogEntry, api: GatewayApi, baseUrl: string, rate: number) {
  return {
    id: entry.id,
    name: entry.name,
    provider: PROVIDER_ID,
    baseUrl,
    input: [...entry.input] as ("text" | "image")[],
    cost: toCost(entry.cny, rate),
    contextWindow: entry.contextWindow,
    maxTokens: entry.maxTokens,
    reasoning: entry.thinking.kind === "toggle",
    // A map next to `reasoning: false` is a self-contradicting claim: pi ignores
    // it, so only a test would ever catch it — hence the union above.
    thinkingLevelMap: entry.thinking.kind === "toggle" ? thinkingLevelsFor(entry.id, api, entry.thinking.levels) : undefined,
  };
}

/**
 * One conversion function, one branch on `api`. Typed locals keep the compiler
 * honest about the per-surface `compat` shape with no casts (the shape that
 * stopped two catalogs drifting in pi-bigmodel).
 */
export function entryToModel(
  entry: CatalogEntry,
  api: GatewayApi,
  baseUrl: string,
  rate: number,
): LongCatModel {
  const shared = sharedFields(entry, api, baseUrl, rate);
  if (api === "openai-responses") {
    const model: Model<"openai-responses"> = {
      ...shared,
      api: "openai-responses",
      compat: { ...RESPONSES_COMPAT },
    };
    return model;
  }
  const model: Model<"openai-completions"> = {
    ...shared,
    api: "openai-completions",
    compat: { ...CHAT_COMPAT },
  };
  return model;
}

export function buildModels(
  api: GatewayApi,
  baseUrl: string,
  rate: number = cnyPerUsd(),
): LongCatModel[] {
  return CATALOG.map((entry) => entryToModel(entry, api, baseUrl, rate));
}

/**
 * Conservative shape for an id this build has never seen (e.g. a future
 * `LongCat-3.0` surfaced by the live overlay). Cost stays zero so pi reports
 * $0.00 rather than an invented number, and the window is small enough that
 * compaction fires early instead of overflowing.
 *
 * `reasoning: false` and NO level map: an unmeasured id gets no thinking
 * control at all, because a map next to `reasoning: false` is a claim that
 * contradicts itself, and LongCat's thinking is on by default — publishing a
 * switch we never verified would be worse than publishing none.
 */
export const UNKNOWN_MODEL_DEFAULTS = {
  contextWindow: 131_072,
  maxTokens: 8_192,
} as const;

/** Family heuristics: a new id inherits from the family it is named after. */
export function guessContext(id: string): number {
  if (/^longcat-2\.5/i.test(id)) return 1_048_576;
  if (/^longcat-2\./i.test(id)) return 1_048_576;
  if (/^longcat-/i.test(id)) return UNKNOWN_MODEL_DEFAULTS.contextWindow;
  return UNKNOWN_MODEL_DEFAULTS.contextWindow;
}

export function guessMaxTokens(id: string): number {
  if (/^longcat-2\.5/i.test(id)) return 262_144; // family value; a new id still needs the cap probe
  if (/^longcat-2\./i.test(id)) return 131_072;
  return UNKNOWN_MODEL_DEFAULTS.maxTokens;
}

/** Only the two measured ids get a thinking control; everything else is text-only. */
export function guessThinking(id: string): ThinkingControl | undefined {
  if (/^longcat-2\.(0|5)/i.test(id)) return { kind: "toggle", levels: LONGCAT_THINKING };
  return undefined;
}

export function guessInput(id: string): ("text" | "image")[] {
  // Vision was measured on 2.5-Preview only; a new id is text until probed.
  return ["text"];
}

export function unknownModelToModel(
  id: string,
  api: GatewayApi,
  baseUrl: string,
  contextWindow?: number,
  maxTokens?: number,
): LongCatModel {
  const entry: CatalogEntry = {
    id,
    name: id,
    contextWindow: contextWindow ?? guessContext(id),
    maxTokens: maxTokens ?? guessMaxTokens(id),
    input: guessInput(id),
    // Unmeasured id ⇒ no thinking control, and no level map to contradict it.
    thinking: guessThinking(id) ?? { kind: "none" },
    cny: { input: 0, output: 0, cacheRead: 0 },
  };
  const model = entryToModel(entry, api, baseUrl, DEFAULT_CNY_PER_USD);
  // Unknown ids must not invent a price: pin the object so tests can
  // identity-compare against ZERO_COST.
  model.cost = { ...ZERO_COST };
  return model;
}

/**
 * Catalog → pi `Model` conversion, currency, surface resolution, and the
 * thinking-level tristate as pi's OWN functions see it.
 *
 * The level-map tests import `getSupportedThinkingLevels` / `clampThinkingLevel`
 * from pi-ai rather than restating their rules: the tristate is the subtlest area
 * in pi, and a copy of its logic would drift while an import cannot.
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { CATALOG, CATALOG_BY_ID, LONGCAT_THINKING } from "../catalog.ts";
import {
  BASE_URL,
  BASE_URL_BY_API,
  CHAT_COMPAT,
  CNY_RATE_DATE,
  DEFAULT_CNY_PER_USD,
  DEFAULT_SURFACE,
  PROVIDER_ID,
  RESPONSES_COMPAT,
  UNKNOWN_MODEL_DEFAULTS,
  buildModels,
  cnyPerUsd,
  cnyToUsd,
  entryToModel,
  guessContext,
  guessInput,
  guessMaxTokens,
  guessThinking,
  resolveBaseUrl,
  resolveSurface,
  unknownModelToModel,
} from "../models.ts";

const env = (vars: Record<string, string | undefined>) => (name: string) => vars[name];

describe("currency", () => {
  test("converts CNY to USD at the dated house rate, rounded to 6 decimals", () => {
    assert.equal(DEFAULT_CNY_PER_USD, 6.7252);
    assert.match(CNY_RATE_DATE, /^\d{4}-\d{2}-\d{2}$/, "the rate must carry its date");
    // ¥2 / ¥8 / ¥0.04 per 1M — the numbers from GET /models/{id}.
    assert.equal(cnyToUsd(2, DEFAULT_CNY_PER_USD), 0.297389);
    assert.equal(cnyToUsd(8, DEFAULT_CNY_PER_USD), 1.189556);
    assert.equal(cnyToUsd(0.04, DEFAULT_CNY_PER_USD), 0.005948, "the cache rate must stay non-zero");
  });

  test("LONGCAT_CNY_PER_USD overrides, and garbage falls back to the dated rate", () => {
    assert.equal(cnyPerUsd(env({ LONGCAT_CNY_PER_USD: "7.5" })), 7.5);
    assert.equal(cnyPerUsd(env({ LONGCAT_CNY_PER_USD: " 7.5 " })), 7.5);
    for (const bad of ["", "abc", "0", "-1", "NaN", undefined]) {
      assert.equal(cnyPerUsd(env({ LONGCAT_CNY_PER_USD: bad })), DEFAULT_CNY_PER_USD, `${bad} must not win`);
    }
  });

  test("published costs are the converted CNY prices, with no cache-write price", () => {
    const model = entryToModel(CATALOG_BY_ID.get("LongCat-2.0")!, "openai-completions", BASE_URL, DEFAULT_CNY_PER_USD);
    assert.equal(model.cost.input, cnyToUsd(2, DEFAULT_CNY_PER_USD));
    assert.equal(model.cost.output, cnyToUsd(8, DEFAULT_CNY_PER_USD));
    assert.equal(model.cost.cacheRead, cnyToUsd(0.04, DEFAULT_CNY_PER_USD));
    assert.equal(model.cost.cacheWrite, 0, "the platform publishes no cache-write rate");
    assert.ok(model.cost.cacheRead < model.cost.input);
  });

  test("no model declares promptCache (an implicit cache with no published TTL)", () => {
    // Declaring it would make pi's cache warmer send extra BILLED requests for a
    // cache lifetime nobody documents. The cache itself is real and priced:
    // 768 of 836 tokens came back cached on the second identical call.
    for (const model of buildModels("openai-completions", BASE_URL)) {
      assert.equal(model.promptCache, undefined, `${model.id} must not declare promptCache`);
    }
  });
});

describe("surface resolution", () => {
  test("defaults to chat completions", () => {
    assert.equal(DEFAULT_SURFACE, "openai-completions");
    assert.deepEqual(resolveSurface(env({})), { api: "openai-completions", recognized: true });
  });

  test("accepts short and long names, case-insensitively, trimmed", () => {
    for (const value of ["chat", "CHAT", " completions ", "openai-completions"]) {
      const resolved = resolveSurface(env({ LONGCAT_SURFACE: value }));
      assert.equal(resolved.api, "openai-completions", value);
      assert.equal(resolved.recognized, true, value);
    }
    for (const value of ["responses", "RESPONSES", " openai-responses "]) {
      const resolved = resolveSurface(env({ LONGCAT_SURFACE: value }));
      assert.equal(resolved.api, "openai-responses", value);
      assert.equal(resolved.recognized, true, value);
    }
  });

  test("an unrecognized value falls back but reports itself (pitfalls P52)", () => {
    const resolved = resolveSurface(env({ LONGCAT_SURFACE: "respones" }));
    assert.equal(resolved.api, DEFAULT_SURFACE);
    assert.equal(resolved.recognized, false, "index.ts warns only when this is false");
    assert.equal(resolved.requested, "respones");
  });

  test("asking for the Anthropic surface explains why it cannot be registered", () => {
    const resolved = resolveSurface(env({ LONGCAT_SURFACE: "anthropic" }));
    assert.equal(resolved.api, DEFAULT_SURFACE);
    assert.equal(resolved.recognized, true, "the value IS understood…");
    assert.match(resolved.unavailable ?? "", /x-api-key/, "…and the reason is the measured auth-header mismatch");
    assert.match(resolved.unavailable ?? "", /401/);
  });

  test("both surfaces share one base URL, and LONGCAT_BASE_URL overrides it", () => {
    assert.equal(BASE_URL_BY_API["openai-completions"], BASE_URL_BY_API["openai-responses"]);
    assert.equal(BASE_URL, "https://api.longcat.chat/openai/v1");
    assert.equal(resolveBaseUrl("openai-responses", env({ LONGCAT_BASE_URL: "https://proxy.example/longcat/" })), "https://proxy.example/longcat");
    assert.equal(resolveBaseUrl("openai-completions", env({})), BASE_URL);
  });
});

describe("compat flags", () => {
  test("chat pins the six flags where pi's auto-detect for this host is wrong", () => {
    // Auto-detect (pi-ai/dist/api/openai-completions.js:1229-1313) has no rule
    // for api.longcat.chat, so it returns the vanilla-OpenAI profile. Each line
    // below is the measured or documented correction; see the models.ts header.
    assert.equal(CHAT_COMPAT.thinkingFormat, "zai", "auto-detect would say 'openai' and lose the off switch");
    assert.equal(CHAT_COMPAT.supportsReasoningEffort, false, "auto-detect says true");
    assert.equal(CHAT_COMPAT.supportsDeveloperRole, false, "auto-detect says true; the role is dropped");
    assert.equal(CHAT_COMPAT.maxTokensField, "max_tokens", "auto-detect says max_completion_tokens, which is IGNORED here");
    assert.equal(CHAT_COMPAT.supportsStore, false, "auto-detect says true");
    assert.equal(CHAT_COMPAT.supportsLongCacheRetention, false, "auto-detect says true");
  });

  test("chat keeps the flags that were measured working", () => {
    assert.equal(CHAT_COMPAT.supportsUsageInStreaming, true, "a final SSE usage chunk was recorded");
    assert.equal(CHAT_COMPAT.supportsFinishReason, true, "stop / length / tool_calls all recorded");
    assert.equal(CHAT_COMPAT.requiresThinkingAsText, false, "reasoning arrives in reasoning_content");
    assert.equal(CHAT_COMPAT.requiresAssistantAfterToolResult, false, "measured accepted without one");
    assert.equal(CHAT_COMPAT.zaiToolStream, false, "tool_stream is Zhipu-specific and not in the contract");
  });

  test("responses pins every flag the contract does not contain", () => {
    // supported_parameters from GET /models/{id}: max_tokens, temperature, top_p,
    // stream, tools, tool_choice, thinking. Nothing else is in the contract.
    assert.equal(RESPONSES_COMPAT.supportsLongCacheRetention, false);
    assert.equal(RESPONSES_COMPAT.supportsStrictMode, false);
    assert.equal(RESPONSES_COMPAT.supportsExplicitPromptCacheMode, false);
    assert.equal(RESPONSES_COMPAT.supportsToolSearch, false);
    assert.equal(RESPONSES_COMPAT.supportsAdditionalTools, false);
    assert.equal(RESPONSES_COMPAT.supportsDeveloperRole, false);
    assert.equal(RESPONSES_COMPAT.supportsMaxOutputTokens, true, "echoed back and enforced as a bound");
  });
});

describe("model building", () => {
  test("stamps the chosen surface on every model, and its matching compat block", () => {
    const chat = buildModels("openai-completions", BASE_URL);
    assert.equal(chat.length, CATALOG.length);
    for (const model of chat) {
      assert.equal(model.api, "openai-completions");
      assert.equal(model.provider, PROVIDER_ID);
      assert.equal(model.baseUrl, BASE_URL);
      assert.deepEqual(model.compat, CHAT_COMPAT);
      assert.notEqual(model.compat, CHAT_COMPAT, "each model gets a copy, not the shared object");
    }
    const responses = buildModels("openai-responses", BASE_URL);
    for (const model of responses) {
      assert.equal(model.api, "openai-responses");
      assert.deepEqual(model.compat, RESPONSES_COMPAT);
    }
  });

  test("carries the measured caps, windows and modalities", () => {
    const byId = new Map(buildModels("openai-completions", BASE_URL).map((m) => [m.id, m]));
    assert.equal(byId.get("LongCat-2.0")?.maxTokens, 131_072);
    assert.equal(byId.get("LongCat-2.5-Preview")?.maxTokens, 262_144);
    for (const model of byId.values()) assert.equal(model.contextWindow, 1_048_576);
    assert.deepEqual(byId.get("LongCat-2.5-Preview")?.input, ["text", "image"]);
    assert.deepEqual(byId.get("LongCat-2.0")?.input, ["text"]);
  });

  test("a rate override reaches every model's cost", () => {
    const models = buildModels("openai-completions", BASE_URL, 7.5);
    for (const model of models) assert.equal(model.cost.input, cnyToUsd(2, 7.5));
  });
});

describe("thinking levels, as pi's own functions see them", () => {
  test("curated models on chat offer exactly off and low", () => {
    for (const model of buildModels("openai-completions", BASE_URL)) {
      assert.equal(model.reasoning, true);
      assert.deepEqual(getSupportedThinkingLevels(model), ["off", "low"]);
    }
  });

  test("on Responses, 2.5-family models hide off (no switch zeroes their reasoning there) and 2.0 keeps it", () => {
    // Measured 2026-10-24 (DD-B5/B6/B7/B8): on the Responses surface
    // effort:none zeroes reasoning on LongCat-2.0 but NOT on LongCat-2.5-Preview
    // (nor does any other token). Offering an "off" that silently bills
    // reasoning is the exact lie the picker must not tell.
    const models = buildModels("openai-responses", BASE_URL);
    const preview = models.find((m) => m.id === "LongCat-2.5-Preview")!;
    const two = models.find((m) => m.id === "LongCat-2.0")!;
    assert.deepEqual(getSupportedThinkingLevels(preview), ["low"], "2.5 on Responses: only low is honest");
    assert.deepEqual(getSupportedThinkingLevels(two), ["off", "low"], "2.0 on Responses: effort:none is measured to work");
    assert.equal(clampThinkingLevel(preview, "off"), "low", "an explicit off request clamps UP — reasoning is billed either way on that pair");
    assert.equal(clampThinkingLevel(two, "off"), "off", "2.0's off switch cannot be clamped away");
  });

  test("off survives clamping — the off switch cannot be clamped away", () => {
    // The upward clamp is why `off: null` bills thinking the user turned off.
    // With a real off switch, "off" must stay "off".
    const model = buildModels("openai-completions", BASE_URL)[0]!;
    assert.equal(clampThinkingLevel(model, "off"), "off");
  });

  test("higher requests clamp DOWN to the one level LongCat has", () => {
    const model = buildModels("openai-completions", BASE_URL)[0]!;
    for (const level of ["minimal", "medium", "high", "xhigh", "max"] as const) {
      assert.equal(clampThinkingLevel(model, level), "low", `${level} must clamp to low, not to off`);
    }
  });

  test("the shared level map is the one every entry uses", () => {
    for (const entry of CATALOG) {
      assert.equal(entry.thinking.kind, "toggle");
      if (entry.thinking.kind === "toggle") assert.equal(entry.thinking.levels, LONGCAT_THINKING);
    }
  });
});

describe("unknown ids from the live overlay", () => {
  test("get zero cost, no thinking control, and conservative limits", () => {
    const model = unknownModelToModel("LongCat-3.0-Turbo", "openai-completions", BASE_URL);
    assert.deepEqual(model.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, "never invent a price");
    assert.equal(model.reasoning, false, "unmeasured thinking gets no control at all");
    assert.equal(model.thinkingLevelMap, undefined, "a map next to reasoning:false contradicts itself");
    assert.equal(model.contextWindow, UNKNOWN_MODEL_DEFAULTS.contextWindow);
    assert.equal(model.maxTokens, UNKNOWN_MODEL_DEFAULTS.maxTokens);
    assert.deepEqual(model.input, ["text"], "vision is measured per id, never inherited");
    assert.equal(model.name, "LongCat-3.0-Turbo");
  });

  test("prefer the numbers the listing published over a family guess", () => {
    const model = unknownModelToModel("LongCat-3.0-Turbo", "openai-completions", BASE_URL, 262_144, 65_536);
    assert.equal(model.contextWindow, 262_144);
    assert.equal(model.maxTokens, 65_536);
  });

  test("family heuristics: a LongCat-2.x name inherits the measured family values", () => {
    assert.equal(guessContext("LongCat-2.7"), 1_048_576);
    assert.equal(guessMaxTokens("LongCat-2.5-Flash"), 262_144);
    assert.equal(guessMaxTokens("LongCat-2.1"), 131_072);
    assert.equal(guessContext("something-else"), UNKNOWN_MODEL_DEFAULTS.contextWindow);
    assert.equal(guessThinking("LongCat-2.5-Preview")?.kind, "toggle");
    assert.equal(guessThinking("LongCat-9"), undefined);
    assert.deepEqual(guessInput("LongCat-2.5-Preview"), ["text"]);
  });
});

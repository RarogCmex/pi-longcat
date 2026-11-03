/**
 * Error-layer tests, in the order the skill prescribes: first print what pi
 * composes from a RECORDED body, then decide what (if anything) needs rewriting,
 * then prove the rewrite does not change pi's classification in either direction.
 *
 * Every body here is a fixture generated from the probe ledger
 * (`node scripts/extract-fixtures.ts` over `research/probes/`), so the strings
 * being matched are the gateway's own bytes. The one exception is clearly
 * labelled: the context-overflow body, which is documented but was never
 * measured, because producing it needs a prompt+max_tokens sum above 1 048 576
 * tokens (≈¥2 if accepted).
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import {
  getOverflowPatterns,
  isContextOverflow,
  isRetryableAssistantError,
  normalizeContext,
  type AssistantMessage,
  type ProviderStreams,
} from "@earendil-works/pi-ai";
import {
  AUTH_TAG,
  CAPACITY_TAG,
  QUOTA_TAG,
  classifyRewritten,
  clarifyAuthError,
  clarifyCapacityError,
  clarifyQuotaError,
  isConcurrencyLimitError,
  normalizeOverflowError,
  parseInBandError,
  remediateInBandResponse,
  shouldClarifyAuth,
  shouldClarifyQuota,
  statusForGatewayError,
} from "../errors.ts";
import { BASE_URL, buildModels } from "../models.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8").trim();

const chatModel = buildModels("openai-completions", BASE_URL)[0]!;
const respModel = buildModels("openai-responses", BASE_URL)[0]!;
const chatApi = openAICompletionsApi();
const respApi = openAIResponsesApi();

const transcript = normalizeContext({
  systemPrompt: "You are pi.",
  messages: [{ role: "user", content: "Say hi.", timestamp: Date.now() }],
});

/** Run pi's REAL adapter against a recorded body and return what pi composed. */
async function compose(
  api: ProviderStreams,
  model: typeof chatModel,
  init: { status: number; body: string; contentType?: string },
): Promise<string> {
  let composed = "";
  const stream = api.streamSimple(model as any, transcript, {
    apiKey: "ak_test",
    fetch: (async () =>
      new Response(init.body, {
        status: init.status,
        headers: { "content-type": init.contentType ?? "application/json" },
      })) as unknown as typeof fetch,
  } as any);
  for await (const event of stream as any) {
    if (event.type === "error") composed = event.error?.errorMessage ?? String(event.error);
  }
  return composed;
}

const assistant = (errorMessage: string): AssistantMessage =>
  ({ role: "assistant", errorMessage, stopReason: "error" }) as unknown as AssistantMessage;

/** The recorded bodies, with the call that produced each (ledger row labels). */
const RECORDED = {
  badKey: { status: 401, body: fixture("badkey-chat.json") },
  noKey: { status: 401, body: fixture("nokey-chat.json") },
  unknownModel: { status: 400, body: fixture("unknown-model-chat.json") },
  capTooBig: { status: 400, body: fixture("CAP1-chat-2.0-131073.json") },
  windowCheck: { status: 400, body: fixture("CAP4-chat-window-plus-1.json") },
  temperature: { status: 400, body: fixture("PA3-temperature-range.json") },
  imageTooSmall: { status: 400, body: fixture("IM1-image-2.5-chat.json") },
  malformedJson: { status: 400, body: fixture("malformed-json.json") },
  inBandResponses: { status: 200, body: fixture("responses-inband-200.json") },
  inBandRetrieve: { status: 200, body: fixture("retrieve-bogus-inband-200.json") },
};

/**
 * DOCUMENTED, NOT MEASURED. The platform's FAQ names `context_length_exceeded`
 * and explains it as "input (messages + max_tokens) exceeds the model's maximum
 * context window", in the gateway's standard envelope. Triggering it for real
 * costs ~¥2, so the shape is reconstructed from the documented code plus the
 * envelope every other error on this gateway uses.
 */
const DOCUMENTED_OVERFLOW = {
  status: 400,
  body: JSON.stringify({
    error: { code: "context_length_exceeded", message: "context_length_exceeded: input exceeds the model's maximum context window", type: "invalid_request_error" },
  }),
};

describe("what pi composes from the recorded bodies (step 0)", () => {
  test("a 401 keeps the gateway's code and message — pi needs no help classifying it", async () => {
    const composed = await compose(chatApi, chatModel, RECORDED.badKey);
    assert.match(composed, /401/, "the status must survive");
    assert.match(composed, /invalid_api_key/, "the vendor code must survive");
    assert.match(composed, /incorrect api key/);
    assert.equal(isRetryableAssistantError(assistant(composed)), false, "a dead key must not be retried");
  });

  test("a 400 keeps the CJK validation message", async () => {
    const composed = await compose(chatApi, chatModel, RECORDED.capTooBig);
    assert.match(composed, /400/);
    assert.match(composed, /131072/, "the disclosed ceiling must survive into the user's message");
  });

  test("the malformed-JSON envelope is the one body pi flattens to nothing useful", async () => {
    // {"code":50003,"message":"参数解析出错: …"} has no `error` object, so the SDK
    // composes a bare status. pi can never send malformed JSON, so this is
    // recorded rather than handled — see README "Error paths".
    const composed = await compose(chatApi, chatModel, RECORDED.malformedJson);
    assert.match(composed, /400/);
  });

  test("an in-band HTTP-200 error is invisible to pi until it is re-statused", async () => {
    // The measured failure mode: 200 + a JSON error body. On a stream pi has no
    // events to parse, so what comes out is a "stream ended" style message that
    // pi's retry catalog treats as transient.
    const before = await compose(respApi, respModel, RECORDED.inBandResponses);
    assert.equal(/invalid_prompt/.test(before), false, "without remediation the vendor code is lost");

    const remediated = await remediateInBandResponse(
      new Response(RECORDED.inBandResponses.body, { status: 200, headers: { "content-type": "application/json" } }),
    );
    assert.equal(remediated.status, 400);
    const after = await compose(respApi, respModel, {
      status: remediated.status,
      body: await remediated.text(),
    });
    assert.match(after, /invalid_prompt/, "after remediation the vendor code reaches the user");
    assert.equal(isRetryableAssistantError(assistant(after)), false, "and it is not retried");
  });
});

describe("in-band remediation", () => {
  test("parses only a JSON object with a top-level error message", () => {
    assert.deepEqual(parseInBandError(RECORDED.inBandResponses.body)?.code, "invalid_prompt");
    assert.deepEqual(parseInBandError(RECORDED.inBandRetrieve.body)?.message, "The model 'no-such-model' does not exist");
    assert.equal(parseInBandError(fixture("T2-thinking-disabled.json")), undefined, "a completion is not an error");
    assert.equal(parseInBandError("not json"), undefined);
    assert.equal(parseInBandError('{"error":"plain string"}'), undefined);
    assert.equal(parseInBandError("data: {}"), undefined);
  });

  test("maps the documented error codes onto their documented statuses", () => {
    assert.equal(statusForGatewayError({ code: "invalid_api_key", message: "x", type: "authentication_error" }), 401);
    assert.equal(statusForGatewayError({ code: "insufficient_quota", message: "x", type: "permission_error" }), 402);
    assert.equal(statusForGatewayError({ code: "rate_limit_exceeded", message: "x", type: "rate_limit_error" }), 429);
    assert.equal(statusForGatewayError({ code: "internal_error", message: "x", type: "server_error" }), 500);
    assert.equal(statusForGatewayError({ code: "invalid_parameter", message: "x", type: "invalid_request_error" }), 400);
    assert.equal(statusForGatewayError({ code: "invalid_prompt", message: "x", type: "unknown_error" }), 400);
  });

  test("never touches a non-200, a stream, or a successful body", async () => {
    const notFound = new Response("nope", { status: 404 });
    assert.equal(await remediateInBandResponse(notFound), notFound);

    const sse = new Response(fixture("S1-chat-stream.json"), { status: 200, headers: { "content-type": "text/event-stream" } });
    assert.equal(await remediateInBandResponse(sse), sse, "a live stream must pass through untouched");

    const ok = new Response(fixture("T2-thinking-disabled.json"), { status: 200, headers: { "content-type": "application/json" } });
    assert.equal(await remediateInBandResponse(ok), ok, "a completion must pass through untouched");
  });

  test("leaves an unreadable body alone instead of throwing", async () => {
    const broken = new Response(null, { status: 200, headers: { "content-type": "application/json" } });
    Object.defineProperty(broken, "clone", { value: () => ({ text: async () => { throw new Error("gone"); } }) });
    assert.equal(await remediateInBandResponse(broken as unknown as Response), broken);
  });
});

describe("overflow normalization", () => {
  test("the documented overflow body already compacts without us", async () => {
    const composed = await compose(chatApi, chatModel, DOCUMENTED_OVERFLOW);
    assert.equal(isContextOverflow(assistant(composed)), true, "pi matches context_length_exceeded itself");
    assert.equal(normalizeOverflowError(composed), null, "so our rewrite must be a no-op, not a double prefix");
  });

  test("a wording pi does not match gets the marker, idempotently", () => {
    const cjk = "400: 输入长度超出上下文限制";
    assert.equal(isContextOverflow(assistant(cjk)), false, "control: pi does not match this");
    const once = normalizeOverflowError(cjk);
    assert.ok(once?.startsWith("context_length_exceeded: "));
    assert.equal(isContextOverflow(assistant(once!)), true);
    assert.equal(normalizeOverflowError(once!), null, "idempotent");
  });

  test("the MEASURED cap rejection is never an overflow, before or after", async () => {
    // This is the negative that matters most on this gateway: "/max_tokens:
    // 131073 is not less or equal to 131072" is a bad request. Turning it into a
    // compaction trigger would make pi summarize a healthy session in a loop.
    for (const recorded of [RECORDED.capTooBig, RECORDED.windowCheck, RECORDED.temperature, RECORDED.imageTooSmall]) {
      const composed = await compose(chatApi, chatModel, recorded);
      assert.equal(isContextOverflow(assistant(composed)), false, composed);
      assert.equal(normalizeOverflowError(composed), null, composed);
      for (const pattern of getOverflowPatterns()) assert.equal(pattern.test(composed), false, `${pattern} matched ${composed}`);
    }
  });

  test("a rate limit can never be laundered into a compaction", () => {
    const limited = "429 rate_limit_exceeded: 上下文过长 too many requests";
    assert.equal(normalizeOverflowError(limited), null);
    assert.equal(isRetryableAssistantError(assistant("429 Too Many Requests")), true, "control: 429 stays retryable");
  });
});

describe("auth and balance clarification", () => {
  test("only credential failures are clarified, and the rewrite keeps the original", async () => {
    for (const recorded of [RECORDED.badKey, RECORDED.noKey]) {
      const composed = await compose(chatApi, chatModel, recorded);
      assert.equal(shouldClarifyAuth(assistant(composed)), true, composed);
      const clarified = clarifyAuthError(composed)!;
      assert.ok(clarified.startsWith("LongCat: "));
      assert.ok(clarified.includes(AUTH_TAG), "the tag is how turn_end reads the decision back (P51)");
      assert.equal(classifyRewritten(assistant(clarified)), "auth");
      assert.ok(clarified.includes(composed), "the original text must survive (pitfalls S33)");
      assert.match(clarified, /longcat\.chat\/platform\/api_keys/);
      assert.match(clarified, /\/login longcat/);
      assert.equal(isRetryableAssistantError(assistant(clarified)), false, "still not retryable");
      assert.equal(isContextOverflow(assistant(clarified)), false, "and not an overflow");
      assert.equal(clarifyAuthError(clarified), null, "idempotent");
    }
  });

  test("a balance failure says the key was accepted, so rotating it is not the fix", () => {
    // Documented shapes (402 "Insufficient token quota", 403 insufficient_quota);
    // not measurable without draining an account.
    const quota = '402: {"error":{"code":"insufficient_quota","message":"Insufficient token quota","type":"permission_error"}}';
    assert.equal(shouldClarifyQuota(assistant(quota)), true);
    assert.equal(shouldClarifyAuth(assistant(quota)), false, "money is not credentials");
    const clarified = clarifyQuotaError(quota)!;
    assert.equal(classifyRewritten(assistant(clarified)), "balance");
    assert.ok(clarified.includes(QUOTA_TAG));
    assert.match(clarified, /rotating it will not help/);
    assert.match(clarified, /Billing → Recharge/);
    assert.equal(isRetryableAssistantError(assistant(clarified)), false, "an empty balance must not burn the retry budget");
    assert.equal(isContextOverflow(assistant(clarified)), false);
    assert.equal(clarifyQuotaError(clarified), null, "idempotent");
  });

  test("a CJK balance wording is recognized too", () => {
    assert.equal(shouldClarifyQuota(assistant("400: 余额不足，请充值")), true);
    assert.equal(shouldClarifyQuota(assistant("400: 欠费")), true);
  });

  test("each rewrite's own explanation cannot cross-wire the other classifier", () => {
    // The auth text quotes 402/insufficient_quota to explain the difference, and
    // the balance text quotes the key page; without the tags, turn_end (which sees
    // our rewrite, not the gateway's) would file an auth failure under balance.
    const auth = clarifyAuthError("401: invalid_api_key")!;
    const quota = clarifyQuotaError("402: insufficient_quota")!;
    assert.equal(shouldClarifyQuota(assistant(auth)), false, "the auth rewrite must not read as a balance failure");
    assert.equal(shouldClarifyAuth(assistant(quota)), false, "and vice versa");
    assert.equal(classifyRewritten(assistant("401: plain gateway text")), undefined, "untagged text has no classification");
  });

  test("nothing else is relabelled as an auth problem", async () => {
    for (const recorded of [RECORDED.capTooBig, RECORDED.unknownModel, RECORDED.temperature, RECORDED.imageTooSmall]) {
      const composed = await compose(chatApi, chatModel, recorded);
      assert.equal(shouldClarifyAuth(assistant(composed)), false, composed);
      assert.equal(shouldClarifyQuota(assistant(composed)), false, composed);
    }
    assert.equal(shouldClarifyAuth(assistant("429 rate_limit_exceeded: incorrect api key wording")), false, "a rate limit wins");
    assert.equal(shouldClarifyAuth(assistant("")), false);
  });
});

/**
 * The platform-wide concurrency cap, measured 2026-11-03 while five subagents ran
 * on LongCat at once:
 *
 *   HTTP 429 {"message":"Too many concurrent responses create requests; global
 *   concurrency limit reached (96/96)","type":"rate_limit_error","param":null,
 *   "code":"request_rate_limited"}
 *
 * It is NOT a per-key rate limit and NOT a quota problem: 96/96 is the platform's
 * own request ceiling, so a single account saturating it says nothing about the
 * key, the balance, or this package's pacing. What the user needs is that
 * distinction plus the one action that works (wait / lower concurrency), because
 * the obvious reaction — rotate the key or top up — fixes nothing. It stays
 * retryable: 429 is in pi's transient catalog and the right answer for a slot
 * that frees up.
 */
const CONCURRENCY_BODY = JSON.stringify({
  message: "Too many concurrent responses create requests; global concurrency limit reached (96/96)",
  type: "rate_limit_error",
  param: null,
  code: "request_rate_limited",
});

describe("the platform-wide concurrency cap (429 request_rate_limited)", () => {
  test("pi composes it as a 429 and keeps it retryable", async () => {
    const composed = await compose(chatApi, chatModel, { status: 429, body: CONCURRENCY_BODY });
    assert.match(composed, /\b429\b/);
    assert.match(composed, /global concurrency limit reached/);
    assert.equal(isRetryableAssistantError(assistant(composed)), true, "a freed slot is worth waiting for");
  });

  test("the documented code maps to 429 even without the type field", () => {
    // The measured envelope carries BOTH `code` and `type`; a body with only the
    // code must not fall through to 400, which would make it non-retryable.
    assert.equal(statusForGatewayError({ code: "request_rate_limited", message: "x" }), 429);
    assert.equal(statusForGatewayError({ code: "request_rate_limited", message: "x", type: "rate_limit_error" }), 429);
  });

  test("only the concurrency wording is classified; a plain rate limit is not", async () => {
    assert.equal(isConcurrencyLimitError(`${await compose(chatApi, chatModel, { status: 429, body: CONCURRENCY_BODY })}`), true);
    assert.equal(isConcurrencyLimitError("429 rate_limit_exceeded: too many requests"), false);
    assert.equal(isConcurrencyLimitError("429: requests per minute exceeded"), false);
    assert.equal(isConcurrencyLimitError(""), false);
  });

  test("the rewrite names the platform ceiling, keeps 429, and stays out of auth/quota", () => {
    const composed = `429: ${CONCURRENCY_BODY}`;
    const clarified = clarifyCapacityError(composed)!;
    assert.ok(clarified.startsWith("LongCat: "));
    assert.ok(clarified.includes(CAPACITY_TAG));
    assert.match(clarified, /96\/96|platform/i);
    assert.match(clarified, /concurren/i);
    assert.match(clarified, /\b429\b/, "the retryable token survives the rewrite");
    assert.equal(isRetryableAssistantError(assistant(clarified)), true);
    assert.equal(classifyRewritten(assistant(clarified)), "capacity");
    assert.equal(shouldClarifyAuth(assistant(clarified)), false);
    assert.equal(shouldClarifyQuota(assistant(clarified)), false);
    assert.equal(normalizeOverflowError(clarified), null, "a busy platform never launders into compaction");
    assert.equal(clarifyCapacityError(clarified), null, "idempotent");
  });

  test("a capacity failure is never filed under auth or balance by the turn_end predicates", () => {
    const clarified = clarifyCapacityError(`429: ${CONCURRENCY_BODY}`)!;
    assert.equal(shouldClarifyAuth(assistant(clarified)), false);
    assert.equal(shouldClarifyQuota(assistant(clarified)), false);
    assert.equal(classifyRewritten(assistant(clarified)), "capacity");
  });
});

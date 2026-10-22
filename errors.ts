/**
 * Error handling for the LongCat gateway (api.longcat.chat).
 *
 * Step 0 was "print what pi composes": the recorded bodies in
 * `research/probes/` were driven through pi's real adapters in
 * `test/errors.test.ts`, and the result is that this file is SMALL, because the
 * gateway's error dialect is already close to OpenAI's and pi's own classifiers
 * handle most of it:
 *
 *   - `401 {"error":{"code":"invalid_api_key","message":"incorrect api key",
 *     "type":"authentication_error"}}` — measured on all three surfaces,
 *     streaming and non-streaming alike (2026-10-11). It is an OpenAI-shaped
 *     envelope with a real status, so pi keeps the body and its retry catalog
 *     already treats 401 as non-retryable. What is missing is *what to do next*,
 *     which is what `clarifyAuthError` adds (key page + `/login` + the fact that
 *     a 402/403 is a balance problem, not a key problem).
 *   - `400 {"error":{"code":"invalid_parameter","message":"参数校验失败: …"}}` —
 *     properly statused, message survives, and it must NOT be mistaken for a
 *     context overflow: the measured cap rejection ("/max_tokens: 131073 is not
 *     less or equal to 131072") contains a number and the word "not", and a
 *     naive `exceed…token` pattern would turn a bad request into a destructive
 *     compaction loop. `test/errors.test.ts` asserts that negative.
 *   - Overflow itself is documented as `context_length_exceeded` (FAQ, read
 *     2026-10-10), which pi-ai already matches
 *     (`pi-ai/dist/utils/overflow.js`, `/context[_ ]length[_ ]exceeded/i`), so
 *     `normalizeOverflowError` is a safety net for wordings pi does not match,
 *     not the primary mechanism. **The overflow body was never measured**: the
 *     only way to trigger it is a prompt+max_tokens sum above 1 048 576 tokens,
 *     which costs ≈¥2 if accepted, so it was deliberately not run. The patterns
 *     below come from the documented code plus the CJK phrasings this gateway
 *     family uses; they are marked as such and are idempotent, so a documented
 *     body that already carries the marker is left alone.
 *   - One rewrite-free result worth keeping: the malformed-JSON path answers with
 *     a *different*, non-OpenAI envelope (`{"code":50003,"message":"参数解析出错:
 *     …","data":"com.sankuai…"}`, measured 2026-10-10). pi never sends malformed
 *     JSON, so there is no user-facing path to fix; it is recorded in the README
 *     instead of being handled.
 *
 *  And one thing that DOES need code:
 *
 *   - **In-band HTTP-200 errors.** Two paths answer `200` with an error body:
 *     `POST /openai/v1/responses` with an invalid field (measured: `200
 *     {"error":{"code":"invalid_prompt",…}}`, content-type `application/json`)
 *     and `GET /openai/v1/models/{unknown}` (measured: `200
 *     {"error":{"message":"The model '…' does not exist"}}`). A 200 that carries
 *     no completion is unparseable as a response, and pi's SSE reader would
 *     report "stream ended before a terminal response event" — which is in pi's
 *     RETRYABLE list, so a permanent error would burn the whole retry budget
 *     (pitfalls S32). `remediateInBandResponse` re-statuses those bodies into
 *     the envelope the rest of the gateway already uses.
 *     Scope, measured: streaming requests do NOT hit this — a streaming
 *     validation failure arrives as a proper `response.failed` SSE event with
 *     `usage: 0` (recorded 2026-10-11), and auth failures are real 401s on every
 *     surface. The wrapper exists for the non-streaming JSON path and for the
 *     day the gateway starts answering a stream that way.
 *     NOT usable as the trigger: the `mt-gateway-error: true` response header.
 *     It looks like a perfect marker but it is present on successful
 *     non-streaming completions too (measured on 20 of 21 recorded 200s), so
 *     keying on it would re-status every working response.
 */

/** The platform's key page (docs: "Create and copy your API Key on the API Keys page"). */
export const API_KEYS_URL = "https://longcat.chat/platform/api_keys";
/**
 * Where the balance lives. The docs describe the path as "Billing → Recharge"
 * inside the platform SPA; the SPA returns 200 for every path, so no deep link
 * could be verified — the platform root is quoted instead of an invented one.
 */
export const BILLING_URL = "https://longcat.chat/platform";

/** Prefix every rewrite from this file starts with; also the idempotency guard. */
export const REWRITE_PREFIX = "LongCat: ";

/**
 * ASCII tags appended to each rewrite so `classifyRewritten` can read the
 * decision back from our OWN text. They go at the END of the message: the user
 * reads the first line, and a tag in front of it (the first implementation) made
 * the print-mode output start with `[longcat-auth] …`.
 *
 * Why this exists (measured by a failing test, 2026-10-11): pi applies the
 * `message_end` rewrite IN PLACE on the stored message, so `turn_end` sees the
 * rewritten text rather than the gateway's. The auth rewrite explains that an
 * empty balance is a *different* error and therefore contains the literals
 * `402` and `insufficient_quota` — which the balance predicate matches, so an
 * auth failure was about to be given the balance help entry. Classifying on a
 * tag we control, before falling back to the raw-text predicates, is the fix
 * (the same trick pi-bigmodel uses for its locale-independent `[auth]` tag).
 */
export const AUTH_TAG = "[longcat-auth]";
export const QUOTA_TAG = "[longcat-balance]";

/** Which of our rewrites produced this message, if any. */
export function classifyRewritten(message: { errorMessage?: string }): "auth" | "balance" | undefined {
  const text = message.errorMessage ?? "";
  if (text.includes(AUTH_TAG)) return "auth";
  if (text.includes(QUOTA_TAG)) return "balance";
  return undefined;
}

/**
 * Documented overflow wordings. `context_length_exceeded` is the documented code
 * (FAQ, 2026-10-10) and pi already matches it; the rest are the CJK/English
 * phrasings this gateway family uses for the same condition. UNMEASURED — see the
 * header. Deliberately NOT in this list: the measured parameter-validation
 * wording (`参数校验失败: /max_tokens: N is not less or equal to M`), which is a
 * bad request and must never trigger compaction.
 */
const CONTEXT_OVERFLOW_RE =
  /context_length_exceeded|context length exceeded|exceeds?[^.\n]{0,40}(?:context|maximum context) window|上下文[^.\n]{0,20}(?:超出|超过|过长)|(?:超出|超过)[^.\n]{0,20}上下文|输入[^.\n]{0,12}过长/i;

/** Rate limits are vetoed first: a busy gateway must never launder into a compaction. */
const RATE_LIMIT_RE =
  /rate.?limit|too many requests|requests per (?:second|minute)|\b429\b|频率|限流|过于频繁|访问量过大/i;

export const OVERFLOW_MARKER = "context_length_exceeded: ";

/**
 * Maps a gateway overflow error onto the marker pi's auto-compaction keys on.
 * Returns null when the message is not an overflow (or needs no rewrite), so the
 * caller can leave the message untouched. Idempotent.
 */
export function normalizeOverflowError(errorMessage: string): string | null {
  if (!errorMessage) return null;
  // pi matches /context[_ ]length[_ ]exceeded/i ANYWHERE in the message, so a
  // body that already carries the documented code needs nothing from us.
  if (errorMessage.includes("context_length_exceeded")) return null;
  if (errorMessage.startsWith(OVERFLOW_MARKER)) return null;
  if (RATE_LIMIT_RE.test(errorMessage)) return null;
  if (!CONTEXT_OVERFLOW_RE.test(errorMessage)) return null;
  return `${OVERFLOW_MARKER}${errorMessage}`;
}

/** The gateway's `{"error":{…}}` envelope, as parsed from a response body. */
export interface GatewayError {
  code?: string;
  message?: string;
  type?: string;
}

/**
 * Parse an in-band error body. Returns undefined for anything that is not a
 * JSON object with a top-level `error` object carrying a message — which is what
 * keeps a successful completion (no top-level `error` key, measured across 21
 * recorded 200s) out of the rewrite path.
 */
export function parseInBandError(body: string): GatewayError | undefined {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{")) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const error = (parsed as { error?: unknown }).error;
  if (!error || typeof error !== "object") return undefined;
  const { code, message, type } = error as Record<string, unknown>;
  if (typeof message !== "string" || !message) return undefined;
  return {
    code: typeof code === "string" ? code : undefined,
    message,
    type: typeof type === "string" ? type : undefined,
  };
}

/**
 * HTTP status for a gateway error code, from the platform's own error table
 * (docs "Error Types and Codes", read 2026-10-10) plus the two codes measured
 * arriving in-band at 200 (`invalid_prompt`, and the model-not-found
 * `invalid_request_error`).
 */
export function statusForGatewayError(error: GatewayError): number {
  const code = error.code ?? "";
  const type = error.type ?? "";
  if (code === "invalid_api_key" || type === "authentication_error") return 401;
  if (code === "insufficient_quota" || code === "insufficient_balance") return 402;
  if (type === "permission_error") return 403;
  if (code === "rate_limit_exceeded" || type === "rate_limit_error") return 429;
  if (type === "server_error" || code === "internal_error") return 500;
  return 400;
}

/**
 * Re-status an HTTP-200 response whose body is an error envelope, so the rest of
 * pi's status-keyed machinery (retry classification, the SDK's error path, our
 * own rewrites) sees the truth. Everything else is returned untouched and, for
 * bodies we do read, is re-emitted byte-identical.
 *
 * Guards, each one load-bearing:
 *  - status must be 200 (a real 4xx already carries its status);
 *  - content-type must be JSON (never touch a live `text/event-stream`);
 *  - the body must parse as an error envelope (a completion passes through);
 *  - the body is read via `clone()`, so an unremediated stream stays intact;
 *  - no `statusText`: an HTTP reason phrase must be Latin-1 and this gateway's
 *    messages are Chinese — undici throws on them. The message travels in the
 *    body, which is where pi reads it from.
 */
export async function remediateInBandResponse(response: Response): Promise<Response> {
  if (response.status !== 200) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!/application\/json/i.test(contentType)) return response;
  let body: string;
  try {
    body = await response.clone().text();
  } catch {
    return response;
  }
  const inBand = parseInBandError(body);
  if (!inBand) return response;
  const status = statusForGatewayError(inBand);
  const envelope = JSON.stringify({
    error: { code: inBand.code ?? "invalid_request", message: inBand.message, type: inBand.type ?? "invalid_request_error" },
  });
  return new Response(envelope, {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// ── The one request-shape fix ────────────────────────────────────────────────
//
// This plugin shipped for its first day with NO `before_provider_request` hook,
// and that absence was a measured result: every shape pi 1.1.0 produced was
// captured offline and accepted live (parts arrays, role:"tool" with and without a
// preceding assistant message, pi's full Responses body). What reopened it was a
// question nobody had asked at build time — how the platform's implicit prompt
// cache is addressed — and the answer is economic, not cosmetic (measured
// 2026-10-11, cells D1-D5 in research/probe-cache3.log):
//
//   keyed cold                    → miss
//   keyed, identical repeat       → HIT 1024/1107 cached
//   keyed, only the LAST message changed → HIT 1024   (the cache is prefix-based)
//   the same warm prefix sent WITHOUT prompt_cache_key → MISS
//   the same prefix under a different key value        → MISS
//
// So `prompt_cache_key` is the routing/namespace handle, and pi omits it on chat
// routes (pi-ai/dist/api/openai-completions.js:580-583 sends it only for
// api.openai.com or its own long-retention mode) while the Responses adapter
// fills it from the session id. Cached input is 50× cheaper (¥0.04 vs ¥2 per 1M),
// so omitting it on the DEFAULT surface is a silent cost bug for any multi-turn
// session. The fix is the one the house manual already prescribes
// (streaming-and-errors.md § Usage accounting): inject a 64-char-clamped session
// id. It adds no requests and declares no `promptCache`, so pi's cache warmer
// stays off — it only routes requests pi was already sending.

/** OpenAI-family `prompt_cache_key` length cap (pi-ai clamps the same way). */
export const MAX_CACHE_KEY_LENGTH = 64;

export function clampCacheKey(value: string): string {
  return value.length > MAX_CACHE_KEY_LENGTH ? value.slice(0, MAX_CACHE_KEY_LENGTH) : value;
}

/**
 * Add `prompt_cache_key` to a CHAT payload, or return `undefined` to leave the
 * payload untouched (pi's `before_provider_request` contract: only a returned
 * value replaces the payload).
 *
 * Guards, each one load-bearing:
 *  - chat bodies only (`messages` present, no `input`): on the Responses surface
 *    pi already sends the key, and a second writer would fight it;
 *  - never overwrite: if pi (or a future pi) already set the field, this is a
 *    no-op — that is what keeps the hook idempotent under a pi upgrade;
 *  - no session id ⇒ no injection (a constant key would merge every session into
 *    one namespace, which is worse than pi's default);
 *  - copies the payload rather than mutating it, so the identity check in
 *    `index.ts` can tell "changed" from "unchanged".
 */
export function injectPromptCacheKey(
  payload: unknown,
  options: { sessionId?: string; isChatSurface: boolean },
): Record<string, unknown> | undefined {
  if (!options.isChatSurface) return undefined;
  if (!options.sessionId) return undefined;
  if (!payload || typeof payload !== "object") return undefined;
  const body = payload as Record<string, unknown>;
  if (body.messages === undefined || body.input !== undefined) return undefined;
  if (body.prompt_cache_key !== undefined) return undefined;
  return { ...body, prompt_cache_key: clampCacheKey(options.sessionId) };
}

/**
 * True when an error-stopped assistant message looks like a LongCat credential
 * failure. Matches the measured 401 codes and the opaque shapes pi can end up
 * with, and nothing else — a rate limit or an overflow must not be relabelled as
 * an auth problem.
 */
export function shouldClarifyAuth(message: { errorMessage?: string }): boolean {
  const text = message.errorMessage ?? "";
  if (!text) return false;
  // Our own balance rewrite quotes the auth wording to explain the difference;
  // the tag decides, so a balance failure is never re-classified as a key problem.
  if (text.includes(QUOTA_TAG)) return false;
  if (RATE_LIMIT_RE.test(text)) return false;
  return /invalid_api_key|missing_api_key|incorrect api key|\b401\b|unauthorized|authentication_error/i.test(text);
}

/**
 * True when the failure is money, not credentials: the documented 402
 * "Insufficient token quota" / 403 `insufficient_quota`, and the balance wording
 * the docs use ("rejected once your balance reaches ¥0 or below").
 *
 * Distinguishing this from a bad key matters operationally: rotating the key
 * cannot fix an empty balance, and all nine keys in this deployment belong to the
 * same account, so rotating them would look like a fix and change nothing.
 */
export function shouldClarifyQuota(message: { errorMessage?: string }): boolean {
  const text = message.errorMessage ?? "";
  if (!text) return false;
  // Symmetric guard: the auth rewrite mentions 402/insufficient_quota to tell the
  // user what a balance error looks like, and must not be read as one.
  if (text.includes(AUTH_TAG)) return false;
  return /insufficient_quota|insufficient[_ -]balance|\b402\b|payment required|余额不足|请充值|欠费/i.test(text);
}

/**
 * Rewrites an opaque/terse credential failure into an actionable sentence.
 * Always keeps the original text (pitfalls S33: pi classifies from the composed
 * string, so a replacement that drops the `401`/`invalid_api_key` token would
 * silently change retryability). Idempotent via REWRITE_PREFIX.
 */
export function clarifyAuthError(errorMessage: string): string | null {
  if (!errorMessage) return null;
  if (errorMessage.startsWith(REWRITE_PREFIX)) return null;
  return (
    `${REWRITE_PREFIX}the API key was rejected (invalid, revoked, or not the key for this ` +
    `account). Create or copy a key at ${API_KEYS_URL}, then run \`/login longcat\` or set ` +
    `LONGCAT_API_KEY. Note that an empty balance is a DIFFERENT error (402 / ` +
    `insufficient_quota), so if the key is correct, check the balance instead. ` +
    `Original error: ${errorMessage} ${AUTH_TAG}`
  );
}

/**
 * Rewrites a balance failure into the one action that fixes it. Keeps the
 * substrings pi's non-retryable list keys on (`insufficient_quota`, `402`) so
 * the rewrite cannot make an exhausted balance retryable.
 */
export function clarifyQuotaError(errorMessage: string): string | null {
  if (!errorMessage) return null;
  if (errorMessage.startsWith(REWRITE_PREFIX)) return null;
  return (
    `${REWRITE_PREFIX}this account has no usable balance (insufficient_quota / 402). The key ` +
    `itself was accepted, so rotating it will not help — and on this platform all keys of one ` +
    `account share its balance. Top up at ${BILLING_URL} (Billing → Recharge), or wait for a ` +
    `Token Pack / promotional credit to be applied. ` +
    `Original error: ${errorMessage} ${QUOTA_TAG}`
  );
}

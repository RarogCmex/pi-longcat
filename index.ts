/**
 * LongCat (Meituan) provider for pi.
 *
 * Registers `longcat` as a first-class pi-ai provider: the curated
 * LongCat-2.5-Preview / LongCat-2.0 catalog (1M context, measured output caps,
 * CNY-derived USD pricing), a measured thinking on/off switch, `/login` with a
 * zero-inference key check, an additive live overlay from `GET /models`, and
 * readable messages for the gateway's auth and balance failures.
 *
 * Wire surfaces. The gateway serves three (all probed live 2026-10-10/11):
 *   - `POST /openai/v1/chat/completions` — registered by default. Documented,
 *     enforces the output cap (131073 → 400 naming 131072), answers failures
 *     with real HTTP statuses, and its `thinking:{"type":"disabled"}` switch is
 *     honoured even when the request carries an image.
 *   - `POST /openai/v1/responses` — `LONGCAT_SURFACE=responses`. Real but
 *     UNDOCUMENTED (found by probing: `m-spanname: OpenaiController.
 *     nativeResponses`); it buys typed reasoning items and replay, and costs
 *     three measured defects: it does not enforce the output cap (131073
 *     accepted), it answers some failures with HTTP 200 + an in-band error body
 *     (hence `withGatewayErrorRemediation`), and `reasoning:{"effort":"none"}`
 *     stops working once an image is in the request.
 *   - `POST /anthropic/v1/messages` — works (streaming, `tool_use`, thinking
 *     on/off all measured) but is NOT registered: pi's Anthropic adapter
 *     authenticates with `x-api-key` (`pi-ai/dist/api/anthropic-messages.js:
 *     810-812`) and this gateway rejects that header with 401 `missing_api_key`
 *     (measured 2026-10-11). `LONGCAT_SURFACE=anthropic` therefore reports the
 *     reason instead of silently doing nothing.
 * One adapter is constructed per process, so a model can never point at a surface
 * that was not registered.
 *
 * There is exactly **one `before_provider_request` hook** here, and it was added
 * a day after the plugin first shipped — the history matters, so both states are
 * dated:
 *
 *  - 2026-10-11 (build): NO hook. Every shape pi 1.1.0 produced was captured
 *    offline and accepted live (ledger rows PA1, TL3, R7-tool-result-no-assistant,
 *    R8-chat-pi-exact): a `content` parts array, `role:"tool"` with and without a
 *    preceding assistant message, and pi's full Responses body including
 *    `include:["reasoning.encrypted_content"]`. The absence was asserted by two
 *    tests. That answer was correct for the question asked: "does the gateway
 *    reject anything pi sends?"
 *  - 2026-10-11 (billed round, operator-prioritized caching): ONE hook, injecting
 *    `prompt_cache_key`. The new question was "how is the implicit cache
 *    addressed?", and the measured answer is that the key is the routing handle —
 *    a prefix warm under a key MISSES when the same bytes are sent without one,
 *    while a changed final message still HITS under a stable key (cells D1-D5).
 *    pi omits the field on chat routes, so the default surface was leaving a 50×
 *    input-price discount on the table for every multi-turn session. See
 *    `injectPromptCacheKey` in errors.ts for the measurements and the guards.
 *
 * An asserted absence is an answer to the questions asked, not a permanent verdict;
 * the flip updated the tests, the README and the journal together.
 *
 * Streaming, tool calls and usage accounting are delegated to pi-ai's adapters.
 */

// NOTE on this import: pi's extension loader aliases the bare
// "@earendil-works/pi-ai" specifier to pi-ai's compat entrypoint, a strict
// superset of the core one that re-exports `openAICompletionsApi` and
// `openAIResponsesApi`. Subpaths other than /compat, /oauth and /providers/all
// are NOT aliased. tsconfig.json mirrors the loader's alias so
// `npm run typecheck` sees what pi sees. This is the only pi-runtime-only import
// in the package; everything else lives in modules plain Node can load, which is
// what makes the offline suite possible without pi mocking.
import { openAICompletionsApi, openAIResponsesApi } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  clarifyAuthError,
  clarifyQuotaError,
  classifyRewritten,
  injectPromptCacheKey,
  normalizeOverflowError,
  shouldClarifyAuth,
  shouldClarifyQuota,
} from "./errors.ts";
import { PROVIDER_ID, resolveSurface } from "./models.ts";
import { buildLongCatProvider, withGatewayErrorRemediation } from "./provider.ts";

/** The only piece of `ExtensionContext` this file needs beyond the typed surface. */
type SessionCtx = { sessionManager?: { getSessionId?: () => string | undefined } };

export default function (pi: ExtensionAPI) {
  // Cache routing, and nothing else: inject `prompt_cache_key` (the clamped pi
  // session id) into chat payloads for this provider, because pi omits it there
  // and the gateway's cache is addressed by it. Guarded on the provider AND on the
  // registered surface (Responses already carries the key), never overwrites a
  // field pi sent, and returns undefined when it has nothing to add so the
  // payload keeps its identity.
  pi.on("before_provider_request", (event, ctx) => {
    if (ctx.model?.provider !== PROVIDER_ID) return undefined;
    const rewritten = injectPromptCacheKey(event.payload, {
      sessionId: (ctx as unknown as SessionCtx).sessionManager?.getSessionId?.(),
      isChatSurface: ctx.model?.api === "openai-completions",
    });
    return rewritten === undefined ? undefined : (rewritten as typeof event.payload);
  });

  // Three rewrites, all guarded to this provider and to error-stopped assistant
  // messages, applied in one order:
  //   1. overflow → the `context_length_exceeded:` marker pi's compaction keys on
  //      (first, so an overflow that also looks auth-ish still compacts, and with
  //      a rate-limit veto so a 429 can never be laundered into compaction);
  //   2. balance (402 / insufficient_quota) → the top-up page, plus the fact that
  //      the key was accepted so rotating it will not help;
  //   3. credential (401 invalid_api_key) → an actionable sentence.
  // Each keeps the original text, so pi's own retry classification is unchanged
  // (asserted against pi's real classifiers in test/errors.test.ts).
  pi.on("message_end", (event) => {
    const message = event.message;
    if (message.role !== "assistant") return;
    if (message.stopReason !== "error") return;
    if (message.provider !== PROVIDER_ID) return;

    const raw = message.errorMessage ?? "";
    const overflow = normalizeOverflowError(raw);
    if (overflow) return { message: { ...message, errorMessage: overflow } };

    if (shouldClarifyQuota(message)) {
      const quota = clarifyQuotaError(raw);
      if (quota) return { message: { ...message, errorMessage: quota } };
    }
    if (shouldClarifyAuth(message)) {
      const auth = clarifyAuthError(raw);
      if (auth) return { message: { ...message, errorMessage: auth } };
    }
  });

  // Persistent half of the same two cases, TUI only. `ctx.hasUI` is load-bearing:
  // an entry appended after the errored assistant message makes `pi -p` print
  // nothing at all, because print mode reads the last message and requires
  // `role === "assistant"`. Deduped on customType so a re-emitted turn does not
  // stack a second entry.
  //
  // pi applies the `message_end` rewrite IN PLACE on the stored message, so by
  // the time this handler runs, `errorMessage` is already our own text — the
  // predicates below must therefore recognize the rewritten form as well as the
  // raw one (they do: both rewrites keep the original text, and
  // `shouldClarify*` match the codes inside it). pitfalls P51.
  pi.on("turn_end", (event, ctx) => {
    if (!ctx.hasUI) return;
    if (event.outcome !== "error") return;
    const msg = event.message as unknown as {
      role: string;
      stopReason?: string;
      provider?: string;
      errorMessage?: string;
    };
    if (msg.provider !== PROVIDER_ID) return;
    // By now the message may already carry our own rewrite, in place, so ask the
    // tag first and fall back to the raw-text predicates for a message this
    // process never rewrote (a persisted session re-hydrated elsewhere).
    const classified = classifyRewritten(msg);
    const quota = classified ? classified === "balance" : shouldClarifyQuota(msg);
    if (classified ? classified !== "auth" && classified !== "balance" : !quota && !shouldClarifyAuth(msg)) return;
    const customType = quota ? "longcat-balance-help" : "longcat-auth-help";
    if (event.entries.some((e) => (e as { customType?: string }).customType === customType)) return;
    const content = quota
      ? "LongCat: this account has no usable balance (402 / `insufficient_quota`). The key was " +
        "accepted, so rotating it will not help — every key of one account shares its balance. " +
        "Top up at https://longcat.chat/platform (Billing → Recharge), or switch to a funded " +
        "account with `/login longcat` / `LONGCAT_API_KEY`."
      : "LongCat: the API key was rejected (401 `invalid_api_key`). Check it at " +
        "https://longcat.chat/platform/api_keys, then run `/login longcat` or update " +
        "`LONGCAT_API_KEY`. An empty balance is a different error (402), so a key that works " +
        "elsewhere may simply be out of credit.";
    return {
      entries: [
        ...event.entries,
        { type: "custom_message", customType, content, display: true },
      ],
    };
  });

  const { api, requested, recognized, unavailable } = resolveSurface();
  const streams = api === "openai-responses" ? openAIResponsesApi() : openAICompletionsApi();
  pi.registerProvider(buildLongCatProvider(api, withGatewayErrorRemediation(streams)));

  // A typo'd or unservable surface must not pass silently: there is no notify at
  // registration time (`ui` lives on the handler context), so the warning rides
  // the first session start, and only where a notice cannot corrupt output
  // (pitfalls P52 — the resolver reports `requested`/`recognized`, not just the
  // value, precisely so this is possible).
  if (requested !== undefined && (!recognized || unavailable)) {
    pi.on("session_start", (_event, ctx) => {
      if (!ctx.hasUI) return;
      const reason = unavailable ?? `unknown value "${requested}"`;
      ctx.ui.notify(
        `LongCat: LONGCAT_SURFACE=${requested} was not applied (${reason}); ` +
          `using ${api}. Valid values: chat, responses.`,
        "warning",
      );
    });
  }
}

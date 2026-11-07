/**
 * LongCat (Meituan) provider for pi.
 *
 * Registers `longcat` as a first-class pi-ai provider: the curated
 * LongCat-2.5 / LongCat-2.5-Preview / LongCat-2.0 catalog (1M context, measured
 * output caps, CNY-derived USD pricing), a measured thinking on/off switch,
 * `/login` with a zero-inference key check, an additive live overlay from
 * `GET /models`, and readable messages for the gateway's auth and balance
 * failures. LongCat-2.5 is the id the platform documents since its 2026-11-02
 * change-log entry; the other two are still served and stay registered (see
 * catalog.ts).
 *
 * Wire surfaces. The gateway serves three (all probed live 2026-10-10/11,
 * re-checked 2026-10-24):
 *   - `POST /openai/v1/responses` — **registered by default since 2026-10-24**
 *     (operator decision; officially documented by the platform that day, and a
 *     pi-shaped multi-turn tool loop was measured through the shipped stack —
 *     ledger DD2-M1/M2). Buys typed reasoning items and replay. Two measured
 *     caveats ride along: it does not enforce the output cap (131073 accepted),
 *     it answers some failures with HTTP 200 + an in-band error body (hence
 *     `withGatewayErrorRemediation`), and the 2.5 family has NO working
 *     thinking-off switch on it (measured) — so those model×surface pairs offer
 *     only the `low` level instead of selling a dead "off" (re-measured on the
 *     GA model 2026-11-07). Its vision through base64 images is also measured
 *     unreliable for colour/fine detail (both surfaces, DD3 plus the 2026-11-07
 *     round), so a run that starts with images gets a once-per-session warning
 *     (below).
 *   - `POST /openai/v1/chat/completions` — `LONGCAT_SURFACE=chat`. Documented,
 *     enforces the output cap (131073 → 400 naming 131072), answers failures
 *     with real HTTP statuses, and its `thinking:{"type":"disabled"}` switch is
 *     honoured on both models even when the request carries an image.
 *   - `POST /anthropic/v1/messages` — works (streaming, `tool_use`, thinking
 *     on/off all measured) but is NOT registered: pi's Anthropic adapter
 *     authenticates with `x-api-key` (`pi-ai/dist/api/anthropic-messages.js:
 *     843-845`) and this gateway rejects that header with 401 `missing_api_key`
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
 *    pi omits the field on chat routes, so the then-default chat surface was
 *    leaving a 50× input-price discount on the table for every multi-turn
 *    session. Since the 2026-10-24 default flip the hook is a no-op in the
 *    default configuration (pi's Responses adapter sends the key itself) and
 *    keeps paying for `LONGCAT_SURFACE=chat`. See `injectPromptCacheKey` in
 *    errors.ts for the measurements and the guards.
 *
 * An asserted absence is an answer to the questions asked, not a permanent verdict;
 * the flip updated the tests, the README and the journal together.
 *
 * Streaming, tool calls and usage accounting are delegated to pi-ai's adapters.
 */

// NOTE on this import: pi's extension loader aliases the bare
// "@earendil-works/pi-ai" specifier to pi-ai's compat entrypoint, a strict
// superset of the core one that re-exports `openAICompletionsApi` and
// `openAIResponsesApi`. Subpaths other than /compat, /models, /oauth and
// /providers/all are NOT aliased (/models joined the list in pi 1.4.0, #11156).
// tsconfig.json mirrors the loader's alias so
// `npm run typecheck` sees what pi sees. This is the only pi-runtime-only import
// in the package; everything else lives in modules plain Node can load, which is
// what makes the offline suite possible without pi mocking.
import { openAICompletionsApi, openAIResponsesApi } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  clarifyAuthError,
  clarifyCapacityError,
  clarifyQuotaError,
  classifyRewritten,
  injectPromptCacheKey,
  isConcurrencyLimitError,
  normalizeOverflowError,
  shouldClarifyAuth,
  shouldClarifyQuota,
} from "./errors.ts";
import { PROVIDER_ID, resolveSurface } from "./models.ts";
import { buildLongCatProvider, withGatewayErrorRemediation, withToolArgumentRepair } from "./provider.ts";

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

  // Four rewrites, all guarded to this provider and to error-stopped assistant
  // messages, applied in one order:
  //   1. overflow → the `context_length_exceeded:` marker pi's compaction keys on
  //      (first, so an overflow that also looks auth-ish still compacts, and with
  //      a rate-limit veto so a 429 can never be laundered into compaction);
  //   2. platform-wide concurrency 429 → the distinction that matters: the
  //      platform is saturated, not the key and not the balance, so rotate/top-up
  //      fixes nothing (measured 2026-11-03, `global concurrency limit reached`);
  //   3. balance (402 / insufficient_quota) → the top-up page, plus the fact that
  //      the key was accepted so rotating it will not help;
  //   4. credential (401 invalid_api_key) → an actionable sentence.
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

    if (isConcurrencyLimitError(raw)) {
      const capacity = clarifyCapacityError(raw);
      if (capacity) return { message: { ...message, errorMessage: capacity } };
    }
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
    // Three classes now, and the tag decides when our own rewrite is what turn_end
    // sees (pi replaces the stored message in place); the raw-text predicates are
    // the fallback for a session re-hydrated elsewhere (pitfalls P51).
    const kind: "auth" | "balance" | "capacity" | undefined =
      classified ??
      (shouldClarifyQuota(msg)
        ? "balance"
        : shouldClarifyAuth(msg)
          ? "auth"
          : isConcurrencyLimitError(msg.errorMessage ?? "")
            ? "capacity"
            : undefined);
    if (!kind) return;
    const customType =
      kind === "balance" ? "longcat-balance-help" : kind === "auth" ? "longcat-auth-help" : "longcat-capacity-help";
    if (event.entries.some((e) => (e as { customType?: string }).customType === customType)) return;
    const content =
      kind === "balance"
        ? "LongCat: this account has no usable balance (402 / `insufficient_quota`). The key was " +
          "accepted, so rotating it will not help — every key of one account shares its balance. " +
          "Top up at https://longcat.chat/platform (Billing → Recharge), or switch to a funded " +
          "account with `/login longcat` / `LONGCAT_API_KEY`."
        : kind === "auth"
          ? "LongCat: the API key was rejected (401 `invalid_api_key`). Check it at " +
            "https://longcat.chat/platform/api_keys, then run `/login longcat` or update " +
            "`LONGCAT_API_KEY`. An empty balance is a different error (402), so a key that works " +
            "elsewhere may simply be out of credit."
          : "LongCat: the platform is at its own concurrent-request ceiling (429 `request_rate_limited`, " +
            "\"global concurrency limit reached\"). This is not your key and not your balance — while " +
            "the platform is saturated every key of this account hits the same wall, so rotating or " +
            "topping up changes nothing. Wait for a slot (pi retries a 429 on its own) or run fewer " +
            "requests at once: parallel subagents and batches of sessions are what fills it.";
    return {
      entries: [
        ...event.entries,
        { type: "custom_message", customType, content, display: true },
      ],
    };
  });

  const { api, requested, recognized, unavailable } = resolveSurface();
  const streams = api === "openai-responses" ? openAIResponsesApi() : openAICompletionsApi();
  // Two wrappers, in this order: the fetch-level in-band error remediation owns
  // the wire, and the argument repair owns the events that leave the adapter —
  // it must sit outermost so it sees `toolcall_end` after the adapter parsed it
  // and before pi validates it (see provider.ts for both measurements).
  pi.registerProvider(
    buildLongCatProvider(api, withToolArgumentRepair(withGatewayErrorRemediation(streams))),
  );

  // The vision caveat surfaced where it bites (operator request 2026-10-24,
  // re-scoped 2026-11-07). The defect is no longer surface-specific: on
  // 2026-10-24 the Responses surface read a green 256×256 png as blue/teal in 5
  // of 6 runs while chat read it 4/4, and the warning was Responses-only. The
  // 2026-11-07 re-measurement (research/probe-25-vision.ts, ledger GA-V-*) found
  // the same wobble everywhere — 256×256 green named green in 5/15 chat runs on
  // LongCat-2.5, 6/15 on Responses, 2/6 on the Preview, 0/6 for a solid red png —
  // while structure still reads correctly (2 and 3 black bars counted 4/4 on the
  // GA model) and image tokens are still billed. So the warning now fires on
  // BOTH surfaces, and it no longer tells the user to switch to chat, because
  // that advice stopped being true.
  // before_agent_start is the one pre-request event that carries the user's
  // images (messageType union since pi 1.2.0; on an older host the guard simply
  // never matches, and the plugin's verified floor is 1.4.0). hasUI-gated like
  // every notification path here (print/json stay silent — P51),
  // session-id-deduped so an image-heavy session is not a wall of toasts.
  {
    const imageWarnedSessions = new Set<string>();
    pi.on("before_agent_start", (event, ctx) => {
      if (event.messageType !== "user") return;
      if (!event.images?.length) return;
      // before_agent_start fires for EVERY run, whatever model is active: a
      // user who switched to another provider must not get LongCat's warning.
      if (ctx.model?.provider !== PROVIDER_ID) return;
      if (!ctx.hasUI) return;
      const session = ctx.sessionManager?.getSessionId() ?? "(no session id)";
      if (imageWarnedSessions.has(session)) return;
      imageWarnedSessions.add(session);
      ctx.ui.notify(
        "LongCat: images are read (they are billed as input and structural " +
          "questions answered correctly), but naming the colour or fine detail of a " +
          "SMALL image is measured unreliable on this platform — a green 256×256 png " +
          "was called cyan/teal/blue in most runs on both surfaces and both models " +
          "(2026-11-07). Treat colour/detail claims about small images as suspect.",
        "warning",
      );
    });
  }

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

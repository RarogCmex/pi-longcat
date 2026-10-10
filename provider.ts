/**
 * Provider assembly.
 *
 * Split out from `index.ts` so it loads under plain Node (and `node --test`):
 * everything here resolves through pi-ai's core entrypoint. The symbols that do
 * not — `openAICompletionsApi` / `openAIResponsesApi`, which pi's loader serves
 * from the compat entrypoint — are injected by `index.ts`, so exactly one wire
 * adapter is constructed per registration.
 */

import {
  createProvider,
  envApiKeyAuth,
  type ApiKeyAuth,
  type Provider,
  type ProviderStreams,
} from "@earendil-works/pi-ai";
import { fetchLongCatModels } from "./discovery.ts";
import { remediateInBandResponse } from "./errors.ts";
import {
  buildModels,
  cnyPerUsd,
  resolveBaseUrl,
  type GatewayApi,
} from "./models.ts";

export { API_KEYS_URL, BILLING_URL } from "./errors.ts";
export { BASE_URL_BY_API, BASE_URL_ENV_VAR, DEFAULT_BASE_URL, resolveBaseUrl, resolveSurface, SURFACE_ENV_VAR } from "./models.ts";

export const API_KEY_AUTH_NAME = "LongCat API key";
export const API_KEY_ENV_VAR = "LONGCAT_API_KEY";

type EnvReader = (name: string) => string | undefined;

const processEnv: EnvReader = (name) =>
  typeof process !== "undefined" ? process.env?.[name] : undefined;

/** Marker so wrapped fetches are not wrapped twice (double registration / idempotence). */
const REMEDIATED = Symbol("longcat-in-band-remediation");

/**
 * Wrap a wire surface so every response passes `remediateInBandResponse`.
 *
 * Measured reason (2026-10-11): this gateway answers some failures with **HTTP
 * 200** and a JSON `{"error":…}` body — `POST /openai/v1/responses` with an
 * invalid field, and `GET /openai/v1/models/{unknown}`. A 200 with no completion
 * leaves pi's stream reader with nothing to parse and it reports "stream ended
 * before a terminal response event", which pi's retry catalog treats as
 * transient, so a permanent error would burn the whole retry budget (pitfalls
 * S32). Re-statusing the body puts it back on the ordinary error path.
 *
 * Injection composes with a caller-supplied fetch (pi may pass its own proxying
 * fetch) rather than replacing it, and marks itself so a second registration
 * cannot double-wrap. Anything that is not an in-band error passes through
 * byte-identical; the body is read via `clone()` so a live stream is untouched.
 */
export function withGatewayErrorRemediation(api: ProviderStreams): ProviderStreams {
  const inject = (options: { fetch?: typeof fetch } | undefined): { fetch?: typeof fetch } => {
    const inner: typeof fetch | undefined = options?.fetch;
    if ((inner as { [REMEDIATED]?: boolean } | undefined)?.[REMEDIATED]) return options ?? {};
    const wrapped: typeof fetch = async (input, init) =>
      remediateInBandResponse(await (inner ?? fetch)(input, init));
    (wrapped as unknown as { [REMEDIATED]: boolean })[REMEDIATED] = true;
    return { ...options, fetch: wrapped };
  };
  const wrapped: ProviderStreams = {
    stream: (model, context, options) => api.stream(model, context, inject(options) as typeof options),
    streamSimple: (model, context, options) =>
      api.streamSimple(model, context, inject(options) as typeof options),
  };
  // Optional members must survive the wrap, or pi would silently lose deferred
  // fetching for this provider the moment it starts using it.
  if (api.fetchDeferred) {
    wrapped.fetchDeferred = (model, handle, options) =>
      api.fetchDeferred!(model, handle, inject(options) as typeof options);
  }
  if (api.cancelDeferred) {
    wrapped.cancelDeferred = (model, handle, options) =>
      api.cancelDeferred!(model, handle, inject(options) as typeof options);
  }
  return wrapped;
}

/**
 * Zero-inference key check used by `/login`.
 *
 * `GET /models` costs nothing and discriminates cleanly (measured 2026-10-10):
 * 200 with a listing for a valid key, `401 {"error":{"code":"invalid_api_key",
 * "message":"incorrect api key"}}` for a bad one, `401 …"missing_api_key"` for
 * none. Auth is checked before the model and parameter validators on every
 * surface (measured: a bad key + an unknown model id still answers 401), so this
 * oracle cannot be fooled by a malformed body — the failure mode pitfalls A22
 * describes does not apply here.
 *
 * Fails OPEN: an unreachable gateway, a timeout, or a 5xx says nothing about the
 * key, and refusing to save a good key because our probe could not reach the
 * network is the worse mistake.
 */
export async function keyLooksValid(
  key: string,
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8_000,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    // Only the two credential statuses say anything about the key. A 5xx, a 429
    // or an unexpected shape means "the gateway could not answer", not "the key
    // is bad" — refusing to save a good key because our probe hit a bad minute is
    // the worse failure.
    if (response.status === 401 || response.status === 403) return false;
    return true;
  } catch {
    return true;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stored-key-then-env resolution (pi-ai's helper, decorated), plus two
 * LongCat touches: the key page link during `/login`, and whitespace trimming on
 * both paths — a key pasted with a trailing newline produces the same opaque 401
 * as a revoked one, which reads like an account problem rather than a stray
 * character.
 */
export function longcatApiKeyAuth(
  fetchImpl: typeof fetch = fetch,
  baseUrlForValidation: () => string = () => resolveBaseUrl("openai-completions"),
): ApiKeyAuth {
  const base = envApiKeyAuth(API_KEY_AUTH_NAME, [API_KEY_ENV_VAR]);
  return {
    ...base,

    async login(interaction) {
      interaction.signal.throwIfAborted();
      interaction.notify({
        type: "info",
        message: "Create a LongCat API key on the platform (API Keys page):",
        links: [{ url: "https://longcat.chat/platform/api_keys", label: "LongCat API Keys" }],
      });
      const entered = await interaction.prompt({
        type: "secret",
        message: API_KEY_AUTH_NAME,
        placeholder: "ak_...",
      });
      interaction.signal.throwIfAborted();
      const key = entered.trim();
      if (!key) throw new Error("No API key entered.");
      if (!key.startsWith("ak_")) {
        // Accept it anyway — rejecting on shape would lock users out the moment
        // the platform changes its key format.
        interaction.notify({
          type: "info",
          message: "That does not look like a LongCat key (expected ak_…). Saving it regardless.",
        });
      }
      // Costs nothing and catches a pasted-from-the-wrong-tab key before it is
      // stored. A failure to reach the gateway is NOT a reason to refuse the key.
      if (!(await keyLooksValid(key, baseUrlForValidation(), fetchImpl))) {
        throw new Error(
          "That key was rejected by api.longcat.chat (401 invalid_api_key). " +
            "Check it on https://longcat.chat/platform/api_keys — note that an empty balance " +
            "is a different error (402), so a key that works elsewhere may still be out of credit.",
        );
      }
      return { type: "api_key", key };
    },

    async resolve(input) {
      const resolved = await base.resolve(input);
      const key = resolved?.auth.apiKey?.trim();
      if (!resolved || !key) return undefined;
      return { ...resolved, auth: { ...resolved.auth, apiKey: key } };
    },
  };
}

/**
 * Build the `longcat` provider for ONE wire surface.
 *
 * `surface` decides every model's `api` field and its compat flags; `streams`
 * must be the matching pi-ai adapter, wrapped in `withGatewayErrorRemediation`.
 * Only one surface is registered per process (`LONGCAT_SURFACE`, default
 * `openai-completions`) so the picker shows 2 ids rather than 4, and so a model
 * can never end up pointing at an adapter that was never constructed.
 *
 * `models` is the curated baseline, always present and never network-dependent.
 * `fetchModels` layers live discovery on top: pi merges the overlay per id,
 * persists it through its own ModelsStore and restores it offline, so a new
 * LongCat release shows up without a catalog edit while a dead key or no network
 * degrades to the baseline.
 */
export function buildLongCatProvider(
  surface: GatewayApi,
  streams: ProviderStreams,
  env: EnvReader = processEnv,
  baseUrl: string = resolveBaseUrl(surface, env),
): Provider<GatewayApi> {
  return createProvider<GatewayApi>({
    id: "longcat",
    name: "LongCat (Meituan)",
    baseUrl,
    auth: { apiKey: longcatApiKeyAuth(fetch, () => resolveBaseUrl(surface, env)) },
    models: buildModels(surface, baseUrl, cnyPerUsd(env)),
    fetchModels: (context) =>
      fetchLongCatModels(
        { listingBaseUrl: resolveBaseUrl("openai-completions", env), baseUrl, api: surface },
        context,
      ),
    api: streams,
  });
}

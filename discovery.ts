/**
 * Live model discovery — the dynamic half of the catalog.
 *
 * `GET /openai/v1/models` requires a key (measured 2026-10-10: 401 without one,
 * 200 on all nine keys with an identical two-model list) and returns, per id,
 * `context_window` and `max_output_tokens` — so an unknown id can be registered
 * with the gateway's own numbers instead of a family guess.
 * `/anthropic/v1/models` serves a byte-identical body (measured), so the listing
 * is read from the OpenAI prefix whichever surface is registered.
 *
 * The overlay is **additive and unknowns-only**: `isKnownId` (registered ∪
 * deliberately excluded, alias-normalised) decides, so a refresh can neither
 * freeze a stale copy of a curated row over our measured caps and prices, nor
 * re-add one of the six retired Flash ids (pitfalls C28). A failed, empty, or
 * keyless listing returns `[]`, which leaves the curated baseline and any
 * previously persisted overlay untouched — an offline start degrades to "static
 * catalog", never to "broken provider".
 */

import type { RefreshModelsContext } from "@earendil-works/pi-ai";
import { isKnownId } from "./catalog.ts";
import { parseInBandError } from "./errors.ts";
import { API_KEY_ENV_VAR, unknownModelToModel, type GatewayApi, type LongCatModel } from "./models.ts";

/**
 * `GET /models` body, recorded verbatim 2026-10-10 (research/probes/key1-models.json):
 * {"object":"list","data":[{"id":"LongCat-2.5-Preview","object":"model",
 *  "owned_by":"LongCat","display_name":"LongCat-2.5-Preview",
 *  "context_window":1048576,"max_output_tokens":262144}, …]}
 */
export interface ListingEntry {
  id?: unknown;
  display_name?: unknown;
  context_window?: unknown;
  max_output_tokens?: unknown;
}

export interface ModelsResponse {
  object?: string;
  data?: ListingEntry[];
}

/** One listed model, with the numbers the gateway published for it. */
export interface ListedModel {
  id: string;
  contextWindow?: number;
  maxTokens?: number;
}

/**
 * Modalities that must never reach a coding agent's picker if the platform ever
 * lists non-chat models. None exist today (POST /openai/v1/embeddings → 404,
 * measured 2026-10-10); the filter is here so a future listing cannot add one
 * silently.
 */
const EXCLUDED = /(embed|rerank|vector|whisper|\bstt\b|\btts\b|\basr\b|speech|audio|video|ocr|translate|transliter|-vlm$|image-gen|cogview)/i;

function positiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

/** Pull ids + published limits out of a listing body. Pure, so it is testable offline. */
export function parseListing(payload: unknown): ListedModel[] {
  // The retrieve/listing paths can answer HTTP 200 with an error body
  // (measured 2026-10-11) — treat that as "no listing", not as an empty catalog.
  if (typeof payload === "string") {
    if (parseInBandError(payload)) return [];
    try {
      payload = JSON.parse(payload);
    } catch {
      return [];
    }
  }
  if (typeof payload !== "object" || payload === null) return [];
  const data = (payload as ModelsResponse).data;
  if (!Array.isArray(data)) return [];
  const seen = new Map<string, ListedModel>();
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) continue;
    const rawId = (entry as ListingEntry).id;
    if (typeof rawId !== "string" || !rawId.trim()) continue;
    const id = rawId.trim();
    if (EXCLUDED.test(id)) continue;
    if (seen.has(id)) continue;
    seen.set(id, {
      id,
      contextWindow: positiveInt((entry as ListingEntry).context_window),
      maxTokens: positiveInt((entry as ListingEntry).max_output_tokens),
    });
  }
  return [...seen.values()];
}

/**
 * Overlay for listed ids this build has not decided about. Known ids (curated or
 * deliberately excluded) are skipped so the catalog stays the source of truth.
 */
export function buildOverlay(
  listed: readonly ListedModel[],
  api: GatewayApi,
  baseUrl: string,
): LongCatModel[] {
  return listed
    .filter((entry) => !isKnownId(entry.id))
    .map((entry) => unknownModelToModel(entry.id, api, baseUrl, entry.contextWindow, entry.maxTokens));
}

/** Resolve the bearer token pi's auth layer did not hand us (env-only setups). */
export function resolveKey(
  context: Pick<RefreshModelsContext, "credential">,
  env: (name: string) => string | undefined = (n) => (typeof process !== "undefined" ? process.env?.[n] : undefined),
): string | undefined {
  const stored = context.credential;
  if (stored?.type === "api_key" && typeof stored.key === "string" && stored.key.trim()) {
    return stored.key.trim();
  }
  const fromEnv = env(API_KEY_ENV_VAR);
  return fromEnv?.trim() ? fromEnv.trim() : undefined;
}

/**
 * `fetchModels` implementation. Never throws.
 *
 * Bounded twice: pi's refresh signal, and our own ~8 s timeout, because pi may
 * await this during session start and a hung gateway must not stall it. The
 * abort listener is removed in `finally` (a listener left on an already-aborted
 * signal never fires and can hang the await — pitfalls L16).
 */
export async function fetchLongCatModels(
  targets: { listingBaseUrl: string; baseUrl: string; api: GatewayApi },
  context: RefreshModelsContext,
  timeoutMs = 8_000,
): Promise<LongCatModel[]> {
  if (!context.allowNetwork || context.signal.aborted) return [];
  const key = resolveKey(context);
  if (!key) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  context.signal.addEventListener("abort", onAbort, { once: true });

  try {
    const url = `${targets.listingBaseUrl.replace(/\/+$/, "")}/models`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const body = await response.text();
    // A 200 carrying an error envelope is this gateway's habit on the model
    // paths (measured); parseInBandError inside parseListing turns it into [].
    return buildOverlay(parseListing(body), targets.api, targets.baseUrl);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
    context.signal.removeEventListener("abort", onAbort);
  }
}

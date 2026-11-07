/**
 * Live harness for the LongCat gateway. Run explicitly, never by `npm test`:
 *
 *   node live/check.ts                 # free checks only — spends nothing
 *   node live/check.ts --billed        # + the accepted-call checks (itemized)
 *   LONGCAT_SURFACE=chat node live/check.ts --billed   # the non-default surface (Responses is the default since 2026-10-24)
 *
 * Key resolution: `LONGCAT_API_KEY`, else `KEY1` from `secret.env` in the repo
 * root (never printed, never committed), else every test skips.
 *
 * ── Cost classes (pi-provider-plugin Phase 5; the class is a claim about the
 *    RESPONSE, not about the intention) ────────────────────────────────────────
 *  This platform has **no zero-priced id**: all three ids are ¥2/1M uncached input,
 *  ¥0.04/1M cached, ¥8/1M output, and only a 2xx that generated is billed. So the
 *  usual "free because the id is free-tier" class does not exist here and the
 *  default run is limited to class 1:
 *   1. **Free by construction** — pre-inference rejections and no-inference GETs:
 *      the cap sweep (over-cap `max_tokens` → 400 naming the ceiling), unknown
 *      model id, garbage key, the top_p range (out-of-range → 400; temperature
 *      moved to the billed section on 2026-10-24 because the gateway stopped
 *      rejecting it — docs now say it is overridden), the measured image-area
 *      floor, `GET /models` and `GET /models/{id}`. A rejected request is not
 *      billed (docs: "Failed responses … will not be charged", and measured: an
 *      SSE `response.failed` carries `usage: 0`).
 *   2. **Billed** (`--billed` only) — accepted generations, each bounded
 *      client-side: `max_tokens` ≤ 8 for liveness/thinking, 200 for the tool
 *      round trip, 64 for the image colour naming (which needs the budget: with
 *      8 tokens the reasoning ate the whole answer), ~840-token prefix for the
 *      cache pair. Worst case for the whole `--billed` run as written: ≈¥0.01.
 *   3. **Deliberately not run** — the context-overflow probe. Producing
 *      `context_length_exceeded` needs prompt+max_tokens > 1 048 576, i.e. a
 *      ~1M-token upload that is billed in full if accepted (≈¥2), and the
 *      free alternative is closed: the `max_tokens` ceiling check fires before
 *      any context check (measured, fixture CAP4-chat-window-plus-1.json). The
 *      test below records that it was skipped on purpose, so the ledger and the
 *      suite agree.
 *
 * ── Ledger ───────────────────────────────────────────────────────────────────
 *  Every call is a row: check, surface (from the model's own `api`), the cap we
 *  ASKED for (from the options), the tokens pi PARSED out of `usage` (never a
 *  field fished out of a raw SSE body, which yields nothing), and the cost. The
 *  final test ASSERTS on the ledger — it fails on a row with a missing number and
 *  on a 2xx that never became a row — because a ledger check that cannot fail is
 *  decoration (pitfalls L42), and "free" has to stay a measured claim (L35).
 *
 * ── What it verifies ─────────────────────────────────────────────────────────
 *   1. the live listing still equals the curated catalog (drift detector);
 *   2. each model's published pricing/modalities still equal the catalog;
 *   3. the ENFORCED output caps are still the measured ones, from rejections
 *      (since 2026-11-07 the probe value is per id, not the catalog clamp: 2.0's
 *      validator accepts 131073 while its listing still says 131072, so probing
 *      the clamp bills — see catalog.ts);
 *   4. auth: a garbage key is a 401 end-to-end through the production wrapper,
 *      and the message a user sees is actionable and non-retryable;
 *   5. the in-band HTTP-200 error paths are re-statused by our fetch wrapper;
 *   6. the top_p range and the image-area floor are still enforced;
 *   7. (billed) liveness, the thinking switch measured by its OUTPUT, a tool
 *      round trip, image consumption proven by a STRUCTURAL question (2 black
 *      bars counted on a white field, 4/4 measured 2026-11-07) with the colour
 *      readout recorded but never asserted — the colour probe is a coin flip on
 *      both surfaces since 2026-11-07 (research/probe-25-vision.ts),
 *      cache accounting proven with exactly two requests, and — since
 *      2026-10-24 — the temperature override policy (an out-of-range
 *      temperature is ACCEPTED and generates; it was a 400 until the gateway
 *      changed, which the free run of that date caught by failing).
 *
 * The billed checks drive the SAME wrapped adapter production uses
 * (`withGatewayErrorRemediation(openAICompletionsApi())`) and the same model
 * objects `buildModels` produces, so a harness pass is a pass of the shipped path.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import {
  isContextOverflow,
  isRetryableAssistantError,
  normalizeContext,
  type AssistantMessage,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
// pi 1.5.0: pi-ai no longer re-exports TypeBox. Pi maps the old import to the
// compat entry plus its bundled TypeBox at runtime, but `tsc` sees neither, so
// the builder comes from `typebox` directly — the form the 1.5.0 docs prescribe
// for new code.
import { Type } from "typebox";
import { CATALOG, CATALOG_BY_ID, MIN_IMAGE_AREA_PX } from "../catalog.ts";
import { BASE_URL, buildModels, resolveSurface, type GatewayApi, type LongCatModel } from "../models.ts";
import { injectPromptCacheKey, remediateInBandResponse, clarifyAuthError, shouldClarifyAuth } from "../errors.ts";
import { withGatewayErrorRemediation } from "../provider.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const BILLED_MODE = process.argv.includes("--billed") || process.env.LONGCAT_LIVE_BILLED === "1";
const PACE_MS = Number(process.env.LONGCAT_LIVE_PACE_MS ?? 10_000);
const PRICE = { input: 2, cached: 0.04, output: 8 }; // ¥/1M, from GET /models/{id} 2026-10-10

function resolveKey(): string | undefined {
  const fromEnv = process.env.LONGCAT_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const secret = join(ROOT, "secret.env");
  if (existsSync(secret)) {
    for (const line of readFileSync(secret, "utf8").split("\n")) {
      const m = /^\s*KEY1\s*=\s*(\S+)\s*$/.exec(line);
      if (m) return m[1];
    }
  }
  return undefined;
}
const KEY = resolveKey();

/**
 * The KEY<n> id this run is using, for the ledger (the operator's budget cap is
 * per key, so a row that cannot be attributed to a key cannot be audited against
 * it). Resolved by exact match against secret.env; when the key came from the
 * environment and matches nothing there, the row says so instead of guessing.
 */
function resolveKeyId(): string {
  if (!KEY) return "none";
  const secret = join(ROOT, "secret.env");
  if (existsSync(secret)) {
    for (const line of readFileSync(secret, "utf8").split("\n")) {
      const m = /^\s*(KEY\d+)\s*=\s*(\S+)\s*$/.exec(line);
      if (m && m[2] === KEY) return m[1]!;
    }
  }
  return "LONGCAT_API_KEY (not one of secret.env's KEY1..KEY9)";
}
const KEY_ID = resolveKeyId();
const BASE = process.env.LONGCAT_BASE_URL?.trim().replace(/\/+$/, "") || BASE_URL;
/**
 * Probe paths are written from the host root (`/openai/v1/…`, `/anthropic/v1/…`)
 * so one helper can reach every surface; this is the base URL minus its
 * `/openai/v1` suffix. Built once, and asserted below, because a stray slash here
 * is a 404 that looks like a gateway change.
 */
const ORIGIN = BASE.replace(/\/openai\/v1\/?$/, "");
const { api: SURFACE } = resolveSurface();
const SKIP = !KEY ? "set LONGCAT_API_KEY (or put KEY1 in secret.env)" : false;

/**
 * A credential that must be rejected. Built from parts so no key-shaped literal
 * exists in the tree: `test/secret-hygiene.test.ts` scans every shipped file for
 * `ak_` + 16 characters and cannot tell a placeholder from a paste.
 */
const GARBAGE_KEY = ["ak_", "definitely", "_not_a_real_key"].join("");

// ── ledger ────────────────────────────────────────────────────────────────────
interface Row {
  check: string;
  surface: string;
  model: string;
  capAsked: number | string;
  http: number | string;
  cls: "free (rejected/no inference)" | "BILLED" | "200-no-generation (not billed)";
  in?: number;
  out?: number;
  cacheRead?: number;
  costCny: number;
  evidence: string;
}
const ROWS: Row[] = [];
let lastPace = 0;

async function pace(ms = PACE_MS): Promise<void> {
  const wait = Math.max(0, ms - (Date.now() - lastPace));
  lastPace = Date.now() + wait;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/**
 * Cost from a RAW gateway body, where `prompt_tokens` INCLUDES cached tokens.
 */
function costOfRaw(promptTokens = 0, output = 0, cached = 0): number {
  return Math.round((((promptTokens - cached) / 1e6) * PRICE.input + (cached / 1e6) * PRICE.cached + (output / 1e6) * PRICE.output) * 1e8) / 1e8;
}

/**
 * Cost from pi's PARSED usage, where `usage.input` is already net of the cache
 * (`pi-ai/dist/api/openai-completions.js:1186`:
 * `input = max(0, prompt_tokens - cacheRead - cacheWrite)`). Subtracting the
 * cache again here would produce a negative cost — which is exactly what the
 * first run of this harness printed, and why the two helpers are separate.
 */
function costOfParsed(input = 0, output = 0, cacheRead = 0): number {
  return Math.round(((input / 1e6) * PRICE.input + (cacheRead / 1e6) * PRICE.cached + (output / 1e6) * PRICE.output) * 1e8) / 1e8;
}

function record(row: Omit<Row, "costCny"> & { costCny?: number }): void {
  ROWS.push({
    ...row,
    // A row that did not state its own cost gets the raw-body convention; the
    // adapter-driven rows pass `costCny` explicitly because pi's usage is net of
    // the cache (see costOfParsed).
    costCny: row.costCny ?? (row.cls === "BILLED" ? costOfRaw(row.in, row.out, row.cacheRead) : 0),
  });
}

/** Raw POST for rejection probes: the status IS the evidence, so no adapter. */
async function post(
  path: string,
  body: Record<string, unknown>,
  opts: { check: string; key?: string | null; expect?: number; abortMs?: number; retryOn429?: number } = { check: "unlabelled" },
): Promise<{ status: number | string; text: string; json: any }> {
  await pace();
  const key = opts.key === null ? undefined : (opts.key ?? KEY);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.abortMs ?? 45_000);
  let status: number | string = 0;
  let text = "";
  try {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(`${ORIGIN}${path}`, {
        method: "POST",
        headers: {
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      status = response.status;
      text = await response.text();
      if (status === 429 && attempt < (opts.retryOn429 ?? 1)) {
        await new Promise((r) => setTimeout(r, 5_000 * (attempt + 1)));
        continue;
      }
      break;
    }
  } catch (e) {
    status = (e as Error).name === "AbortError" ? "ABORTED" : `ERR:${(e as Error).message.slice(0, 40)}`;
  } finally {
    clearTimeout(timer);
  }
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  const generated = status === 200 && (json?.usage?.prompt_tokens !== undefined || json?.usage?.input_tokens !== undefined);
  record({
    check: opts.check,
    surface: path.includes("/responses") ? "openai-responses" : path.includes("/anthropic/") ? "anthropic-messages" : "openai-completions",
    model: String(body.model ?? "-"),
    capAsked: String(body.max_tokens ?? body.max_output_tokens ?? "-"),
    http: status,
    cls: generated ? "BILLED" : status === 200 ? "200-no-generation (not billed)" : "free (rejected/no inference)",
    in: json?.usage?.prompt_tokens ?? json?.usage?.input_tokens,
    out: json?.usage?.completion_tokens ?? json?.usage?.output_tokens,
    cacheRead: json?.usage?.prompt_tokens_details?.cached_tokens ?? json?.usage?.cache_read_input_tokens,
    costCny: generated
      ? costOfRaw(json?.usage?.prompt_tokens ?? json?.usage?.input_tokens, json?.usage?.completion_tokens ?? json?.usage?.output_tokens, json?.usage?.prompt_tokens_details?.cached_tokens ?? json?.usage?.cache_read_input_tokens)
      : 0,
    evidence: text.slice(0, 220).replace(/\s+/g, " "),
  });
  return { status, text, json };
}

async function get(path: string, opts: { check: string; key?: string | null } = { check: "unlabelled" }): Promise<{ status: number; text: string; json: any }> {
  await pace();
  const key = opts.key === null ? undefined : (opts.key ?? KEY);
  const response = await fetch(`${ORIGIN}${path}`, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  record({
    check: opts.check,
    surface: "GET",
    model: path.includes("/models/") ? path.split("/models/")[1]! : "-",
    capAsked: "-",
    http: response.status,
    cls: "free (rejected/no inference)",
    evidence: text.slice(0, 200).replace(/\s+/g, " "),
  });
  return { status: response.status, text, json };
}

// ── the production path, for the billed checks ────────────────────────────────
const streamsBySurface: Record<GatewayApi, ReturnType<typeof withGatewayErrorRemediation>> = {
  "openai-completions": withGatewayErrorRemediation(openAICompletionsApi()),
  "openai-responses": withGatewayErrorRemediation(openAIResponsesApi()),
};

/**
 * The session id this harness run pretends to be. Unique per run so a warm cache
 * from a previous run cannot flatter the cache checks (journal J32), and passed to
 * the hook at pi's own hook point (`onPayload`) exactly where `index.ts` gets it.
 */
const SESSION_ID = `live-check-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function models(): LongCatModel[] {
  return buildModels(SURFACE, BASE);
}
function modelById(id: string): LongCatModel {
  const found = models().find((m) => m.id === id);
  assert.ok(found, `${id} not registered on ${SURFACE}`);
  return found;
}

/**
 * Tools go in the TRANSCRIPT, not in the stream options: pi reads them from
 * `context.tools`. Passing them as an option silently produces a request with no
 * `tools` field at all — measured on the first run of this harness, where the
 * model then invented an inline `<longcat_tool_call>get_current_time</…>` text
 * tag and `prompt_tokens` was 35 instead of ~155. The trap is worth keeping in a
 * comment because the failure looks like a gateway bug and is a harness bug.
 */
function transcript(userContent: unknown, systemPrompt = "You are pi, a coding agent.", tools?: unknown[]): TranscriptContext {
  return normalizeContext({
    systemPrompt,
    tools: tools as any,
    messages: [{ role: "user", content: userContent as any, timestamp: Date.now() }],
  });
}

/** Drive the shipped adapter and return pi's final AssistantMessage. */
async function ask(
  check: string,
  model: LongCatModel,
  userContent: unknown,
  options: { reasoning?: any; maxTokens?: number; tools?: any[]; toolChoice?: any; systemPrompt?: string; sessionId?: string | null; temperature?: number } = {},
): Promise<{ message: AssistantMessage; status: number | string }> {
  await pace();
  let status: number | string = "-";
  const stream = streamsBySurface[model.api as GatewayApi].streamSimple(model as any, transcript(userContent, options.systemPrompt, options.tools), {
    apiKey: KEY,
    reasoning: options.reasoning,
    temperature: options.temperature,
    maxTokens: options.maxTokens ?? 8,
    toolChoice: options.toolChoice as any,
    onResponse: (response: Response) => {
      status = response.status;
    },
    // The shipped hook, applied where pi applies it. A harness that bypasses the
    // extension's transform tests the adapter, not the plugin.
    onPayload: (body: unknown) =>
      injectPromptCacheKey(body, {
        sessionId: options.sessionId === null ? undefined : SESSION_ID,
        isChatSurface: model.api === "openai-completions",
      }) as unknown,
    fetch: (async (input: any, init: any) => {
      const response = await fetch(input, init);
      return remediateInBandResponse(response);
    }) as unknown as typeof fetch,
  } as any);
  const message = await stream.result();
  const usage = message.usage;
  record({
    check,
    surface: model.api,
    model: model.id,
    capAsked: options.maxTokens ?? 8,
    http: status,
    cls: message.stopReason === "error" ? "free (rejected/no inference)" : "BILLED",
    in: usage?.input,
    out: usage?.output,
    cacheRead: usage?.cacheRead,
    costCny: message.stopReason === "error" ? 0 : costOfParsed(usage?.input, usage?.output, usage?.cacheRead),
    evidence:
      message.stopReason === "error"
        ? String(message.errorMessage).slice(0, 200)
        : `stop=${message.stopReason} text=${JSON.stringify(message.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("")).slice(0, 120)}`,
  });
  return { message, status };
}

/** Solid-colour PNG built at run time — a pasted base64 blob can silently rot (L40). */
function solidPng(size: number, rgb: [number, number, number]): string {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const o = y * (1 + size * 3);
    raw[o] = 0;
    for (let x = 0; x < size; x++) {
      raw[o + 1 + x * 3] = rgb[0];
      raw[o + 2 + x * 3] = rgb[1];
      raw[o + 3 + x * 3] = rgb[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

/**
 * 512×512 white field with N black horizontal bars — the structural counterpart
 * to `solidPng`. Built at run time for the same reason (a pasted blob rots), and
 * drawn here rather than imported so the harness stays self-contained.
 */
function barsPng(n: number): string {
  const size = 512;
  const table = Array.from({ length: 256 }, (_, k) => {
    let c = k;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(size * (1 + size * 3), 0xff); // everything white…
  for (let y = 0; y < size; y++) raw[y * (1 + size * 3)] = 0; // …with filter 0 per row
  for (let b = 0; b < n; b++) {
    const top = Math.floor(((b + 0.5) * size) / n) - 12;
    for (let y = top; y < top + 24; y++) {
      for (let x = 40; x < size - 40; x++) {
        const o = y * (1 + size * 3) + 1 + x * 3;
        raw[o] = 0;
        raw[o + 1] = 0;
        raw[o + 2] = 0;
      }
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

// ── 1. free checks: catalog drift, caps, auth, limits ─────────────────────────

test("live/free: the probe origin is derived correctly (a stray slash would read as a gateway change)", { skip: SKIP }, () => {
  assert.equal(ORIGIN, "https://api.longcat.chat");
  assert.equal(`${ORIGIN}/openai/v1/models`, "https://api.longcat.chat/openai/v1/models");
});

test("live/free: GET /models still lists exactly the curated catalog", { skip: SKIP }, async () => {
  const { status, json } = await get("/openai/v1/models", { check: "listing" });
  assert.equal(status, 200);
  const listed = (json?.data ?? []).map((m: any) => m.id).sort();
  assert.deepEqual(listed, CATALOG.map((e) => e.id).sort(), "catalog drift: update catalog.ts and the README");
});

test("live/free: GET /models/{id} still agrees with the catalog on window, modality and price", { skip: SKIP }, async () => {
  for (const entry of CATALOG) {
    const { status, json } = await get(`/openai/v1/models/${entry.id}`, { check: `retrieve/${entry.id}` });
    assert.equal(status, 200);
    assert.equal(json.context_length, entry.contextWindow, `${entry.id}: context_length drifted`);
    // Video is the one deliberate disagreement: LongCat-2.5 lists it and the
    // catalog cannot claim it (pi has no video modality), so compare the two
    // modalities pi can express.
    const expressible = (json.architecture.input_modalities ?? []).filter((m: string) => m === "text" || m === "image");
    assert.deepEqual(expressible, entry.input, `${entry.id}: modalities drifted`);
    assert.equal(Number(json.pricing.prompt), entry.cny.input, `${entry.id}: input price drifted`);
    assert.equal(Number(json.pricing.completion), entry.cny.output, `${entry.id}: output price drifted`);
    assert.equal(Number(json.pricing.cached_tokens), entry.cny.cacheRead, `${entry.id}: cache price drifted`);
    assert.ok(json.supported_parameters.includes("thinking"), `${entry.id}: the thinking switch is gone from the contract`);
  }
});

test("live/free: the ENFORCED output caps are still the measured ones (cap sweep, from rejections)", { skip: SKIP }, async () => {
  // The sweep probes the enforced ceiling, which is no longer the same thing as
  // the catalog's clamp for every id (2026-11-07): LongCat-2.0's validator now
  // accepts 131073 and only rejects at 262145, while GET /models still advertises
  // 131072 for it — see catalog.ts and test/catalog.test.ts. Probing each id at
  // its own catalog clamp would therefore BILL the 2.0 probe, which is exactly how
  // this drift announced itself on 2026-11-07 (a 200 in a ¥0 sweep).
  const ENFORCED_CAP: Record<string, number> = {
    "LongCat-2.5": 262_144,
    "LongCat-2.5-Preview": 262_144,
    "LongCat-2.0": 262_144,
  };
  for (const entry of CATALOG) {
    const enforced = ENFORCED_CAP[entry.id] ?? entry.maxTokens;
    const { status, json } = await post(
      "/openai/v1/chat/completions",
      { model: entry.id, messages: [{ role: "user", content: "Reply with exactly one word: ok" }], max_tokens: enforced + 1 },
      { check: `cap-sweep/${entry.id}`, expect: 400 },
    );
    // Let an accepted rejection-probe fail loudly: a 200 here means the probe was
    // billed AND disclosed nothing (pitfalls L41.4 / testing.md).
    assert.equal(status, 400, `${entry.id}: cap probe was ACCEPTED (${status}) — billed, and no cap disclosed`);
    assert.match(String(json?.error?.message), new RegExp(String(enforced)), `${entry.id}: the rejection no longer names ${enforced}`);
    assert.ok(entry.maxTokens <= enforced, `${entry.id}: the catalog clamp ${entry.maxTokens} exceeds the enforced ceiling ${enforced}`);
  }
});

test("live/free: an unknown model id is a 400 invalid_parameter, not a 404", { skip: SKIP }, async () => {
  const { status, json } = await post(
    "/openai/v1/chat/completions",
    { model: "no-such-model-xyz", messages: [{ role: "user", content: "hi" }], max_tokens: 4 },
    { check: "unknown-model" },
  );
  assert.equal(status, 400);
  assert.equal(json.error.code, "invalid_parameter");
  assert.match(json.error.message, /Unsupported model/);
});

test("live/free: top_p is range-checked to (0, 1]", { skip: SKIP }, async () => {
  // Stands in for the old free temperature check: temperature left the rejected
  // class on 2026-10-24 (the gateway now OVERRIDES out-of-range values per the
  // api/model-params page, measured accepted+billed), and a probe that can be
  // accepted has no business in a run that promises ¥0. top_p's 400 is measured
  // the same day (ledger row DD-A4-topp-2).
  const { status, json } = await post(
    "/openai/v1/chat/completions",
    { model: "LongCat-2.0", messages: [{ role: "user", content: "hi" }], max_tokens: 4, top_p: 2 },
    { check: "top-p-range" },
  );
  assert.equal(status, 400, "top_p 2 was accepted — the validator changed again; re-read research/doc-api_model-params.txt and move this check to the billed section like temperature");
  assert.match(String(json?.error?.message), /top_p/);
});

test("live/free: an image under the measured area floor is rejected with the floor named", { skip: SKIP }, async () => {
  // 8x8 = 64 px area, under the >200 px floor recorded in MIN_IMAGE_AREA_PX
  // (relaxed from >256 on 2026-11-07; the other half of the bracket — 225 px
  // ACCEPTED — costs money and lives in research/probe-25-ga.ts cell B12).
  const tiny = solidPng(8, [0xe0, 0x10, 0x10]);
  const { status, json } = await post(
    "/openai/v1/chat/completions",
    {
      model: "LongCat-2.5",
      max_tokens: 4,
      messages: [{ role: "user", content: [{ type: "text", text: "What colour?" }, { type: "image_url", image_url: { url: `data:image/png;base64,${tiny}` } }] }],
    },
    { check: "image-floor" },
  );
  assert.equal(status, 400);
  assert.match(String(json?.error?.message), new RegExp(String(MIN_IMAGE_AREA_PX)), "the floor changed — update MIN_IMAGE_AREA_PX");
});

test("live/free: a garbage key is a 401 end-to-end through the production wrapper, and reads as actionable", { skip: SKIP }, async () => {
  const model = modelById("LongCat-2.0");
  const stream = streamsBySurface[model.api as GatewayApi].streamSimple(model as any, transcript("Say hi."), {
    apiKey: GARBAGE_KEY,
    maxTokens: 8,
  } as any);
  const message = await stream.result();
  record({
    check: "garbage-key",
    surface: model.api,
    model: model.id,
    capAsked: 8,
    http: 401,
    cls: "free (rejected/no inference)",
    evidence: String(message.errorMessage).slice(0, 200),
  });
  assert.equal(message.stopReason, "error");
  assert.match(String(message.errorMessage), /invalid_api_key|401/, "the credential failure must reach the user's message");
  assert.equal(isRetryableAssistantError(message), false, "a dead key must not burn the retry budget");
  assert.equal(isContextOverflow(message), false);
  assert.equal(shouldClarifyAuth(message), true, "index.ts's message_end rewrite must fire on this");
  const clarified = clarifyAuthError(String(message.errorMessage))!;
  assert.match(clarified, /longcat\.chat\/platform\/api_keys/);
  assert.equal(isRetryableAssistantError({ ...message, errorMessage: clarified } as AssistantMessage), false, "the rewrite must not make it retryable (S33)");
});

test("live/free: in-band HTTP-200 error bodies are re-statused by our wrapper", { skip: SKIP }, async () => {
  // Two measured paths answer 200 with an error body: GET /models/{unknown} and a
  // non-streaming POST /responses with an invalid field.
  const unknown = await get("/openai/v1/models/no-such-model-xyz", { check: "inband-retrieve" });
  assert.equal(unknown.status, 200, "precondition: the gateway still answers this in-band");
  const remediated = await remediateInBandResponse(
    new Response(unknown.text, { status: unknown.status, headers: { "content-type": "application/json" } }),
  );
  assert.equal(remediated.status, 400);
  assert.match(await remediated.clone().text(), /does not exist/);

  const inBand = await post(
    "/openai/v1/responses",
    { model: "LongCat-2.0", input: "hi", max_output_tokens: -5 },
    { check: "inband-responses" },
  );
  assert.equal(inBand.status, 200, "precondition: the Responses surface still answers validation in-band at 200");
  const fixed = await remediateInBandResponse(
    new Response(inBand.text, { status: 200, headers: { "content-type": "application/json" } }),
  );
  assert.equal(fixed.status, 400);
});

test("live/free: an oversized-prompt overflow probe is DELIBERATELY not run", { skip: SKIP }, () => {
  // Recorded rather than skipped in silence, so the ledger and the suite agree.
  record({
    check: "overflow-probe (not run)",
    surface: SURFACE,
    model: "-",
    capAsked: "-",
    http: "not-sent",
    cls: "free (rejected/no inference)",
    evidence:
      "needs prompt+max_tokens > 1048576 (~1M-token upload, ~¥2 if accepted); the free route is closed because the max_tokens ceiling check fires first (fixture CAP4-chat-window-plus-1.json)",
  });
  assert.ok(true);
});

// ── 2. billed checks: behaviour, not acceptance ───────────────────────────────

const skipBilled = !KEY ? SKIP : !BILLED_MODE ? "pass --billed to run the accepted-call checks (each is itemized in the ledger)" : false;

test("live/billed: the registered surface completes through the shipped adapter", { skip: skipBilled }, async () => {
  // LongCat-2.5, the id the platform documents since 2026-11-02 — the point of
  // this check is that the model a new user picks works end-to-end.
  const model = modelById("LongCat-2.5");
  // Budget 256, not 8: the GA model spends 30-200 reasoning tokens before it
  // emits the first character on the Responses surface, and that surface's off
  // switch does not work for the 2.5 family (see the next check) — at cap 8 the
  // run stops with `length` and no text at all (measured 2026-11-07, this
  // harness's own first run against LongCat-2.5). A liveness check that cannot
  // see a first token proves nothing.
  const { message, status } = await ask("liveness", model, "Reply with exactly one word: ok", { maxTokens: 256, reasoning: undefined });
  assert.equal(status, 200);
  assert.equal(message.stopReason, "stop", `expected a clean stop, got ${message.stopReason}: ${message.errorMessage ?? ""}`);
  assert.equal(message.model, model.id, "the echoed model must be the one we asked for (a reroute would be silent otherwise)");
  assert.equal(message.provider, "longcat");
  assert.ok((message.usage?.output ?? 0) > 0, "no output tokens");
  assert.ok(message.content.some((c: any) => c.type === "text" && /ok/i.test(c.text)), "no visible answer");
});

test("live/billed: the thinking switch is honoured, measured by OUTPUT not by status", { skip: skipBilled }, async () => {
  // Surface-aware since 2026-11-07, because "off" exists on exactly one of them
  // for this model: chat's `thinking:{"type":"disabled"}` zeroes reasoning on
  // every id (re-measured on LongCat-2.5: 0 reasoning tokens, answer "ok"),
  // while on Responses no token does (effort:none → 23 reasoning tokens), which
  // is why the catalog HIDES `off` there and sends no reasoning field at all.
  const model = modelById("LongCat-2.5");
  const off = await ask("thinking-off", model, "Reply with exactly one word: ok", { maxTokens: 256, reasoning: undefined });
  const on = await ask("thinking-on", model, "Reply with exactly one word: ok", { maxTokens: 256, reasoning: "low" });
  const thinkingBlocks = (m: AssistantMessage) => m.content.filter((c: any) => c.type === "thinking").length;
  if (SURFACE === "openai-completions") {
    assert.equal(thinkingBlocks(off.message), 0, "chat's disabled token must zero the reasoning");
  } else {
    assert.ok(
      thinkingBlocks(off.message) > 0,
      "on Responses the 2.5 family has no off switch — a request with no level must still reason (if this is now 0, effort:none started working and LONGCAT_THINKING_RESPONSES_25 can go)",
    );
  }
  assert.ok(thinkingBlocks(on.message) > 0, "thinking on must produce reasoning (pi parses reasoning_content into thinking blocks)");
  assert.ok(off.message.content.some((c: any) => c.type === "text"), "the answer must fit in the budget");
});

test("live/billed: an out-of-range temperature is ACCEPTED and overridden (2026-10-24 drift)", { skip: skipBilled }, async () => {
  // Docs (api/model-params, captured 2026-10-24): temperature is fixed per
  // thinking state (1.0 on / 0.7 off) and other values are "not rejected —
  // overridden". Measured: 1.5 → 200 + generated (was 400 on 2026-10-10; the
  // drift cost the two free harness runs of 2026-10-24 ¥0.000048 each before
  // this check moved here). The override VALUE is not observable — the response
  // echoes no temperature — so the assertion is acceptance + generation.
  const { status, message } = await ask("temperature-override", modelById("LongCat-2.0"), "Reply with exactly one word: ok", { maxTokens: 8, reasoning: undefined, temperature: 1.5 });
  assert.equal(status, 200);
  assert.equal(message.stopReason, "stop", `expected generation, got ${message.stopReason}: ${message.errorMessage ?? ""}`);
});

test("live/billed: a tool round trip returns stopReason toolUse with usable arguments", { skip: skipBilled }, async () => {
  const model = modelById("LongCat-2.5");
  const tool = {
    name: "get_current_time",
    description: "Return the current time for a timezone.",
    parameters: Type.Object({ zone: Type.String({ description: "IANA timezone" }) }),
  };
  const { message } = await ask("tool-roundtrip", model, "What time is it in UTC? You must call the get_current_time tool.", {
    maxTokens: 200,
    tools: [tool],
    toolChoice: "auto",
    reasoning: undefined,
  });
  assert.equal(message.stopReason, "toolUse", `expected toolUse, got ${message.stopReason}`);
  const call = message.content.find((c: any) => c.type === "toolCall") as any;
  assert.ok(call, "no tool call in the message");
  assert.equal(call.name, "get_current_time");
  assert.equal(typeof call.arguments.zone, "string", "arguments must arrive parsed, not as a string blob");
});

test("live/billed: an image is consumed and a STRUCTURAL fact about it is read correctly", { skip: skipBilled }, async () => {
  const model = modelById("LongCat-2.5");
  // What this check asserts, and why it changed shape on 2026-11-07:
  //  - The old version asserted the model names the colour of a solid green
  //    png, on the chat surface only, because chat read it 4/4 while Responses
  //    read it 1/6 (DD3, 2026-10-24). The 2026-11-07 re-measurement
  //    (research/probe-25-vision.ts, ledger GA-V-*) found that assertion to be a
  //    coin flip on BOTH surfaces and BOTH models: green named green in 5/15
  //    chat runs on LongCat-2.5, 6/15 on Responses, 2/6 on 2.5-Preview, and a
  //    solid RED png 0/6 ("Magenta", "lavender", "Yellow"). A check that
  //    asserts a coin flip is worse than no check.
  //  - What IS robust — and is what a coding agent actually needs from an image
  //    — is that the pixels are read at all: two black bars on a white field
  //    were counted correctly 4/4 on the same day, on the same surface, with the
  //    same reasoning budget. So the assertion is the count, the colour is
  //    recorded, and the tokenized-image invariant stays.
  const bars = barsPng(2);
  const COLOUR_Q = "What single colour is this image? Answer with one word.";
  const { message } = await ask(
    "image-structure",
    model,
    [
      { type: "text", text: "How many horizontal black bars are in this image? Answer with one number." },
      { type: "image", data: bars, mimeType: "image/png" },
    ],
    { maxTokens: 256, reasoning: "low" },
  );
  const answer = message.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ");
  assert.equal(message.stopReason, "stop", `image request failed: ${message.errorMessage ?? message.stopReason}`);
  assert.ok((message.usage?.input ?? 0) > 40, `the image was not tokenized: input ${message.usage?.input}`);
  assert.match(answer, /\b2\b/, `the image was not read: ${JSON.stringify(answer)}`);
  // Recorded, never asserted: the colour readout on the same model+surface. It
  // is the measurement that retired the old assertion, and keeping it in the
  // ledger is how the next round sees whether the encoder changed.
  const colour = await ask(
    "image-colour (recorded, not asserted)",
    model,
    [{ type: "text", text: COLOUR_Q }, { type: "image", data: solidPng(256, [0x18, 0xc8, 0x28]), mimeType: "image/png" }],
    { maxTokens: 256, reasoning: "low" },
  );
  const said = colour.message.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ").trim();
  console.log(`      colour readout (recorded, not asserted): ${JSON.stringify(said)}`);
});

test("live/billed: the injected prompt_cache_key makes a CHANGED-TAIL request hit the warm prefix", { skip: skipBilled }, async () => {
  // End-to-end form of research cell D3, through the shipped stack: pi omits
  // prompt_cache_key on chat routes, the gateway addresses its cache by that key
  // (a warm prefix misses without it), and index.ts injects the session id. If
  // this check ever fails, a multi-turn session is paying ¥2/1M instead of
  // ¥0.04/1M on its whole prefix.
  const model = modelById("LongCat-2.0");
  const prefix = `Cache-routing check ${SESSION_ID}.\n` + "Verify the valve, log the reading, reset the counter.\n".repeat(60);
  const first = await ask("cache-key-warm", model, "Reply with exactly one word: ok", { maxTokens: 16, systemPrompt: prefix, reasoning: undefined });
  assert.equal(first.message.stopReason, "stop", String(first.message.errorMessage ?? ""));
  const changed = await ask("cache-key-changed-tail", model, "Reply with exactly one word: fine", { maxTokens: 16, systemPrompt: prefix, reasoning: undefined });
  assert.ok(
    (changed.message.usage?.cacheRead ?? 0) > 0,
    `a changed final message lost the warm prefix (cacheRead ${changed.message.usage?.cacheRead}) — the hook is not reaching the wire, or the gateway stopped routing by prompt_cache_key`,
  );
  // Control: the same request with the hook suppressed must NOT be assumed to hit.
  // It is recorded, not asserted — an unkeyed request can land on a warm node, and
  // a flaky control is worse than none.
  const unkeyed = await ask("cache-key-control-unkeyed", model, "Reply with exactly one word: fine", { maxTokens: 16, systemPrompt: prefix, reasoning: undefined, sessionId: null });
  console.log(`      control (no prompt_cache_key): cacheRead=${unkeyed.message.usage?.cacheRead ?? 0} vs keyed=${changed.message.usage?.cacheRead ?? 0}`);
});

test("live/billed: cache accounting is proven with exactly two identical long-prefix requests", { skip: skipBilled }, async () => {
  const model = modelById("LongCat-2.0");
  const prefix = ("You are a terse assistant. Always answer with exactly one word. " + "Never explain yourself. ").repeat(20);
  const first = await ask("cache-warm", model, "Reply with exactly one word: ok", { maxTokens: 4, systemPrompt: prefix, reasoning: undefined });
  const second = await ask("cache-hit", model, "Reply with exactly one word: ok", { maxTokens: 4, systemPrompt: prefix, reasoning: undefined });
  // The first request is NOT asserted to miss: the cache is implicit and
  // server-side, so a prefix sent by an earlier run can still be warm (observed
  // 2026-10-11: cacheRead 256 on the first of the pair, five minutes after the
  // previous harness run). What is asserted is the accounting itself — a hit is
  // reported, it is a subset of the same prompt, and pi prices it.
  const hit = second.message.usage?.cacheRead ?? 0;
  assert.ok(hit > 0, `no cache hit was reported for a repeated ~360-token prefix (measured 768/836 with curl, and 256/359 through pi, on 2026-10-11): ${JSON.stringify(second.message.usage)}`);
  // pi's `usage.input` is net of the cache, so the invariant is about the SUM
  // matching the first request's prompt, not about cacheRead <= input.
  const firstTotal = (first.message.usage?.input ?? 0) + (first.message.usage?.cacheRead ?? 0);
  const secondTotal = (second.message.usage?.input ?? 0) + hit;
  assert.equal(secondTotal, firstTotal, "the two requests must carry the same prompt");
  const cost = second.message.usage?.cost;
  assert.ok(cost, "pi must price the usage");
  assert.ok(cost!.cacheRead > 0 && cost!.cacheRead < cost!.input + cost!.cacheRead, `a cache hit must be priced and cheaper than a miss: ${JSON.stringify(cost)}`);
});

test("live/billed: the Responses surface (when registered) completes and honours effort:none", { skip: skipBilled || SURFACE !== "openai-responses" ? (SURFACE !== "openai-responses" ? "Responses-only check; this run registered chat" : skipBilled) : false }, async () => {
  const model = modelById("LongCat-2.0");
  const off = await ask("responses-off", model, "Reply with exactly one word: ok", { maxTokens: 8, reasoning: undefined });
  assert.equal(off.message.stopReason, "stop", String(off.message.errorMessage ?? ""));
  assert.equal(off.message.content.filter((c: any) => c.type === "thinking").length, 0, "effort:none must zero reasoning on this surface");
  const on = await ask("responses-on", model, "Reply with exactly one word: ok", { maxTokens: 64, reasoning: "low" });
  assert.ok(on.message.content.filter((c: any) => c.type === "thinking").length > 0, "effort:low must produce reasoning items");
});

// ── 3. the ledger, which asserts ──────────────────────────────────────────────

test("live: spend ledger — every call itemized, no holes, total printed", { skip: SKIP }, async () => {
  const billed = ROWS.filter((r) => r.cls === "BILLED");
  const holes = billed.filter((r) => r.in === undefined || r.out === undefined);
  // A 2xx row must be accounted for: either it generated (BILLED), or it is a
  // no-inference GET, or it is a 200 that carried an error body / an SSE
  // response.failed. Anything else is an accepted call the ledger called free.
  const unexpected = ROWS.filter(
    (r) =>
      r.cls !== "BILLED" &&
      typeof r.http === "number" &&
      r.http >= 200 &&
      r.http < 300 &&
      !/not billed|no inference/.test(r.cls),
  );

  const width = (s: unknown, n: number) => String(s ?? "?").padEnd(n);
  console.log(`\n      surface: ${SURFACE}   billed mode: ${BILLED_MODE}   rows: ${ROWS.length}`);
  console.log(`      ${width("check", 30)}${width("surface", 20)}${width("model", 20)}${width("cap", 8)}${width("http", 8)}${width("in", 7)}${width("out", 6)}${width("cache", 7)}¥`);
  for (const r of ROWS) {
    console.log(
      `      ${width(r.check, 30)}${width(r.surface, 20)}${width(r.model, 20)}${width(r.capAsked, 8)}${width(r.http, 8)}${width(r.in, 7)}${width(r.out, 6)}${width(r.cacheRead, 7)}${r.costCny ? r.costCny.toFixed(8) : "0"}`,
    );
    if (r.evidence) console.log(`        ↳ ${r.evidence.slice(0, 180)}`);
  }
  // Optional append into the research ledger, so a harness run becomes part of
  // the same checkable record as the probe rounds instead of only stdout. Off by
  // default: a user's `npm run live` must not write into the repo.
  const ledgerPath = process.env.LONGCAT_LIVE_LEDGER;
  if (ledgerPath) {
    const { appendFileSync } = await import("node:fs");
    for (const r of ROWS) {
      appendFileSync(
        ledgerPath,
        JSON.stringify({
          n: 0,
          ts: new Date().toISOString(),
          label: `live/${r.check}`,
          key: KEY_ID,
          surface: r.surface,
          purpose: `live/check.ts ${BILLED_MODE ? "--billed" : "free"} run`,
          bound: `cap asked: ${r.capAsked}`,
          plannedClass: r.cls === "BILLED" ? "billed" : "free",
          http: r.http,
          actualClass: r.cls,
          in: r.in,
          out: r.out,
          cached: r.cacheRead,
          costCny: r.costCny,
          note: r.evidence.slice(0, 300),
        }) + "\n",
      );
    }
    console.log(`      ledger rows appended to ${ledgerPath} (renumber with scripts/ledger-report.ts)`);
  }

  const total = ROWS.reduce((sum, r) => sum + r.costCny, 0);
  console.log(`      TOTAL: ¥${total.toFixed(6)} (~$${(total / 6.7252).toFixed(6)}) across ${billed.length} billed call(s)`);

  // A ledger check that cannot fail is decoration (L42): these three assertions
  // are what make the table above evidence rather than output.
  assert.deepEqual(holes.map((h) => h.check), [], "a billed row is missing its usage — read it from pi's parsed usage, not the raw body");
  assert.deepEqual(unexpected.map((u) => u.check), [], "a 2xx row was not classified as billed — 'free' must mean rejected");
  if (!BILLED_MODE) {
    assert.equal(total, 0, "the default run must spend nothing");
    assert.equal(billed.length, 0);
  }
  assert.ok(ROWS.length >= 8, `only ${ROWS.length} rows — a check silently did not run`);
});

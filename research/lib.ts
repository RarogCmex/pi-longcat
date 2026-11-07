/**
 * Shared instrumentation for the BILLED probe rounds (2026-10-11, operator-
 * approved extended scope: prompt caching + the real-pi billed half + the
 * LongCat-2.5-Preview battery).
 *
 * Every call goes through `chat()` / `responses()` here, so three things are
 * true by construction rather than by discipline:
 *
 *  1. **Every accepted call is ledgered**, with the KEY ID (KEY1..KEY9, never the
 *     key), the HTTP status, pi-comparable usage, the cost in CNY at the
 *     gateway's own rates, and — new this round, because the operator asked for
 *     latency data — **TTFT and output tokens/second** measured from the stream.
 *  2. **Prefixes are unique per experiment.** `uniquePrefix()` seeds every prefix
 *     with a random UUID, so a cache hit on call N can only have come from call
 *     N-1 *of the same cell*. That is the design-level fix for journal J26: with
 *     a shared prefix, a warm cache left over from a previous run makes the first
 *     call hit and any "first must miss" assertion a flake — worse, it can make a
 *     *negative* result look positive. Cells therefore report the per-call
 *     `cached_tokens` series and the verdict is read off the series, never off an
 *     assumption about call 1.
 *  3. **Bounds are client-side**: every call carries `max_tokens`, a wall-clock
 *     abort, and (for streams) an output-token abort guard, because no gateway is
 *     guaranteed to reject.
 *
 * Rates: ¥2 / 1M uncached input, ¥0.04 / 1M cached input, ¥8 / 1M output, from
 * `GET /openai/v1/models/{id}` (2026-10-10) and re-verified by the live harness's
 * free drift check on 2026-10-11.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = dirname(HERE);
export const LEDGER = join(HERE, "probe-ledger.jsonl");
export const PROBES = join(HERE, "probes");

export const PRICE = { input: 2, cached: 0.04, output: 8 }; // ¥ per 1M
export const CNY_PER_USD = 6.7252; // dated house rate, 2026-09-15 (models.ts)
export const ORIGIN = "https://api.longcat.chat";

export const M20 = "LongCat-2.0";
/** The Preview id — every 2026-10 row in the ledger labelled M25 measured THIS. */
export const M25 = "LongCat-2.5-Preview";
/**
 * The GA id, live since the 2026-11-02 change log. Deliberately a separate
 * constant from `M25`: relabelling the October rows with the GA id would claim
 * measurements that were never taken on it.
 */
export const M25_GA = "LongCat-2.5";

export function loadKeys(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(join(ROOT, "secret.env"), "utf8").split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  const keys: Record<string, string> = {};
  for (let i = 1; i <= 9; i++) if (env[`KEY${i}`]) keys[`KEY${i}`] = env[`KEY${i}`];
  return keys;
}

/** Raw-body convention: `prompt_tokens` INCLUDES cached tokens. */
export function costOf(promptTokens = 0, output = 0, cached = 0): number {
  return (
    Math.round(
      (((promptTokens - cached) / 1e6) * PRICE.input +
        (cached / 1e6) * PRICE.cached +
        (output / 1e6) * PRICE.output) *
        1e8,
    ) / 1e8
  );
}

export interface Row {
  n: number;
  ts: string;
  label: string;
  key: string;
  /** Model id the call actually asked for (absent on rows written before 2026-10-11T03:00Z). */
  model?: string;
  surface: string;
  purpose: string;
  bound: string;
  plannedClass: "free" | "billed";
  http: number | string;
  actualClass: string;
  in?: number;
  out?: number;
  cached?: number;
  cacheWrite?: number;
  reasoning?: number;
  costCny: number;
  ttftMs?: number;
  tokPerSec?: number;
  elapsedMs?: number;
  note: string;
}

let nextN: number | undefined;
function rowNumber(): number {
  if (nextN === undefined) {
    let max = 0;
    try {
      for (const line of readFileSync(LEDGER, "utf8").split("\n")) {
        if (!line.trim()) continue;
        const n = Number((JSON.parse(line) as Row).n);
        if (Number.isFinite(n) && n > max) max = n;
      }
    } catch {
      max = 0;
    }
    nextN = max;
  }
  return ++nextN;
}

export function appendRow(row: Omit<Row, "n" | "ts"> & Partial<Pick<Row, "n" | "ts">>): Row {
  const full = { n: row.n ?? rowNumber(), ts: row.ts ?? new Date().toISOString(), ...row } as Row;
  appendFileSync(LEDGER, JSON.stringify(full) + "\n");
  return full;
}

export async function pace(ms = 10_000): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * A prefix that cannot collide with anything sent before, so a cache hit is
 * attributable to this experiment alone. `repeats` scales the size; the measured
 * `prompt_tokens` of the first call is what the ledger records, so a bracket is
 * reported in measured tokens rather than in an estimate.
 */
export function uniquePrefix(tag: string, repeats: number): string {
  const seed = `${tag}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
  const line = (i: number) =>
    `Clause ${i} of the ${seed} reference document: the operator must verify the ` +
    `pressure valve, log the reading in the ledger, and reset the counter.\n`;
  let out = `Reference document ${seed}.\n`;
  for (let i = 0; i < repeats; i++) out += line(i);
  return out;
}

export interface CallResult {
  status: number | string;
  ok: boolean;
  text: string;
  reasoning: string;
  toolCalls: any[];
  finish: string | undefined;
  in?: number;
  out?: number;
  cached?: number;
  cacheWrite?: number;
  reasoningTokens?: number;
  ttftMs?: number;
  tokPerSec?: number;
  elapsedMs: number;
  costCny: number;
  raw: string;
  error?: string;
}

export interface CallOptions {
  keyId: string;
  label: string;
  purpose: string;
  bound: string;
  /** Abort the stream after this many output deltas; a client-side ceiling. */
  abortAfterOutputTokens?: number;
  timeoutMs?: number;
  paceMs?: number;
  save?: boolean;
}

async function send(
  url: string,
  surface: string,
  keyId: string,
  body: Record<string, unknown>,
  opts: CallOptions,
): Promise<CallResult> {
  const keys = loadKeys();
  const key = keys[keyId];
  if (!key) throw new Error(`no ${keyId} in secret.env`);
  await pace(opts.paceMs ?? 10_000);

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
  let firstByteAt: number | undefined;
  let firstTokenAt: number | undefined;
  let text = "";
  let reasoning = "";
  const toolCalls: any[] = [];
  let finish: string | undefined;
  let usage: any;
  let raw = "";
  let status: number | string = "ERR";
  let errorText: string | undefined;
  let sawContent = false;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    status = response.status;
    firstByteAt = Date.now();
    const contentType = response.headers.get("content-type") ?? "";
    if (/text\/event-stream/i.test(contentType)) {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\n\n/);
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          for (const line of frame.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            let event: any;
            try {
              event = JSON.parse(data);
            } catch {
              continue;
            }
            if (event.error) errorText = JSON.stringify(event.error);
            // chat completions dialect
            const delta = event.choices?.[0]?.delta;
            if (delta?.content) {
              if (!sawContent) firstTokenAt = Date.now();
              sawContent = true;
              text += delta.content;
            }
            if (delta?.reasoning_content) {
              if (!sawContent) firstTokenAt = Date.now();
              sawContent = true;
              reasoning += delta.reasoning_content;
            }
            if (delta?.tool_calls) {
              if (!sawContent) firstTokenAt = Date.now();
              sawContent = true;
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                toolCalls[idx] = toolCalls[idx] ?? { id: tc.id, name: tc.function?.name, arguments: "" };
                if (tc.id) toolCalls[idx].id = tc.id;
                if (tc.function?.name) toolCalls[idx].name = tc.function.name;
                if (tc.function?.arguments) toolCalls[idx].arguments += tc.function.arguments;
              }
            }
            if (event.choices?.[0]?.finish_reason) finish = event.choices[0].finish_reason;
            if (event.usage) usage = event.usage;
            // responses dialect
            if (event.type === "response.output_text.delta") {
              if (!sawContent) firstTokenAt = Date.now();
              sawContent = true;
              text += event.delta ?? "";
            }
            if (event.type === "response.reasoning_text.delta" || event.type === "response.reasoning.delta") {
              if (!sawContent) firstTokenAt = Date.now();
              sawContent = true;
              reasoning += event.delta ?? "";
            }
            if (event.type === "response.completed" || event.type === "response.incomplete") {
              finish = event.response?.status;
              usage = event.response?.usage;
            }
            if (event.type === "response.failed") {
              finish = "failed";
              errorText = JSON.stringify(event.response?.error ?? {});
              usage = event.response?.usage;
            }
          }
        }
        const outSoFar = usage?.completion_tokens ?? usage?.output_tokens ?? 0;
        if (opts.abortAfterOutputTokens && sawContent && outSoFar >= opts.abortAfterOutputTokens) {
          controller.abort();
          break;
        }
      }
    } else {
      raw = await response.text();
      let json: any;
      try {
        json = JSON.parse(raw);
      } catch {
        json = undefined;
      }
      if (json?.error) errorText = JSON.stringify(json.error);
      const message = json?.choices?.[0]?.message;
      if (message?.content) text = message.content;
      if (message?.reasoning_content) reasoning = message.reasoning_content;
      if (message?.tool_calls) toolCalls.push(...message.tool_calls);
      finish = json?.choices?.[0]?.finish_reason ?? json?.status;
      usage = json?.usage;
      firstTokenAt = Date.now();
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") errorText = errorText ?? `fetch: ${(e as Error).message.slice(0, 120)}`;
    else errorText = errorText ?? "aborted by client guard";
  } finally {
    clearTimeout(timer);
  }

  const elapsedMs = Date.now() - started;
  const promptTokens = usage?.prompt_tokens ?? usage?.input_tokens;
  const outputTokens = usage?.completion_tokens ?? usage?.output_tokens;
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? usage?.input_tokens_details?.cached_tokens ?? usage?.cache_read_input_tokens;
  const cacheWrite = usage?.prompt_tokens_details?.cache_write_tokens ?? usage?.cache_creation_input_tokens;
  const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens ?? usage?.output_tokens_details?.reasoning_tokens;
  const generated = status === 200 && promptTokens !== undefined && !errorText;
  // An aborted stream that already produced content almost certainly billed: the
  // server kept generating after we hung up, it just never sent the usage event.
  // Calling that "not billed" is the L35 failure in a new disguise, so it gets its
  // own class and the cost stays 0 with the reason in the note (never an estimate).
  const abortedMidGeneration = status === 200 && promptTokens === undefined && (text.length > 0 || reasoning.length > 0);
  const cost = generated ? costOf(promptTokens, outputTokens, cached) : 0;
  const ttftMs = firstTokenAt ? firstTokenAt - started : undefined;
  const genMs = firstTokenAt && elapsedMs > (firstTokenAt - started) ? elapsedMs - (firstTokenAt - started) : undefined;
  const tokPerSec = genMs && outputTokens ? Math.round((outputTokens / (genMs / 1000)) * 10) / 10 : undefined;

  const result: CallResult = {
    status,
    ok: generated,
    text,
    reasoning,
    toolCalls: toolCalls.filter(Boolean),
    finish,
    in: promptTokens,
    out: outputTokens,
    cached,
    cacheWrite,
    reasoningTokens,
    ttftMs,
    tokPerSec,
    elapsedMs,
    costCny: cost,
    raw: raw.slice(0, 4000),
    error: errorText,
  };

  appendRow({
    label: opts.label,
    key: keyId,
    model: typeof body.model === "string" ? body.model : undefined,
    surface,
    purpose: opts.purpose,
    bound: opts.bound,
    plannedClass: "billed",
    http: status,
    actualClass: generated
      ? "BILLED"
      : abortedMidGeneration
        ? "BILLED-uncaptured (aborted mid-generation, usage never arrived)"
        : status === 200
          ? "200-no-usage (not billed)"
          : "free (rejected/no inference)",
    in: promptTokens,
    out: outputTokens,
    cached,
    cacheWrite,
    reasoning: reasoningTokens,
    costCny: cost,
    ttftMs,
    tokPerSec,
    elapsedMs,
    note: [
      errorText ? `error=${errorText.slice(0, 200)}` : "",
      abortedMidGeneration ? `PARTIAL OUTPUT DISCARDED: ${text.length + reasoning.length} chars generated before the abort; cost NOT captured and NOT estimated` : "",
      `finish=${finish ?? "-"}`,
      text ? `text=${JSON.stringify(text.slice(0, 200))}` : "",
      reasoning ? `reasoning=${JSON.stringify(reasoning.slice(0, 160))}` : "",
      toolCalls.filter(Boolean).length ? `tool_calls=${JSON.stringify(toolCalls.filter(Boolean)).slice(0, 200)}` : "",
      `ttft=${ttftMs ?? "?"}ms tok/s=${tokPerSec ?? "?"}`,
    ]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 600),
  });
  if (opts.save !== false) {
    // Bodies are saved verbatim; the ledger row is the summary, the file is the evidence.
    writeFileSync(join(PROBES, `${opts.label}.json`), raw);
  }
  return result;
}

export function chat(body: Record<string, unknown>, opts: CallOptions): Promise<CallResult> {
  return send(`${ORIGIN}/openai/v1/chat/completions`, "openai-completions", opts.keyId, { stream: true, stream_options: { include_usage: true }, ...body }, opts);
}

export function responses(body: Record<string, unknown>, opts: CallOptions): Promise<CallResult> {
  return send(`${ORIGIN}/openai/v1/responses`, "openai-responses", opts.keyId, { stream: true, ...body }, opts);
}

export const toolDef = {
  type: "function",
  function: {
    name: "get_current_time",
    description: "Return the current date and time for a timezone.",
    parameters: {
      type: "object",
      properties: { zone: { type: "string", description: "IANA timezone, e.g. UTC" } },
      required: ["zone"],
    },
  },
};

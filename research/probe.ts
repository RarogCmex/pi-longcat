/**
 * Phase-0/5 research probe runner for the LongCat gateway.
 *
 * NOT the deliverable harness (`live/check.ts` is); this script exists to answer
 * the design questions in research/notes.md §8 with the supervisor-approved,
 * bounded probe batch of 2026-10-11.
 *
 * Cost classes (pi-provider-plugin Phase 5):
 *   - "free"  : the request is guaranteed to be rejected pre-inference (a field
 *               the gateway is MEASURED to validate: auth, model id,
 *               `max_tokens > 0`, required keys) or performs no inference (GET).
 *   - "billed": the request may be accepted. Every one is bounded client-side
 *               (tiny prompt, max_tokens <= 8 except the two 200-token tool
 *               probes, 3 s abort guard on the cap/window probes) and lands in
 *               the ledger with its parsed usage.
 * Prices for costing: ¥2/1M input, ¥0.04/1M cached, ¥8/1M output
 * (GET /openai/v1/models/{id}, 2026-10-10).
 *
 * Usage: node research/probe.ts [--only <label-prefix>] [--dry]
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const PROBES = join(HERE, "probes");
mkdirSync(PROBES, { recursive: true });
const LEDGER = join(HERE, "probe-ledger.jsonl");

const PRICE = { input: 2, cached: 0.04, output: 8 }; // ¥ per 1M tokens
const PACE_MS = 10_000; // ~10 s between calls (skill: pace the harness)
const ABORT_MS = 3_000; // client-side abort guard for cap/window probes

const OAI = "https://api.longcat.chat/openai/v1";
const ANTH = "https://api.longcat.chat/anthropic/v1";
const M20 = "LongCat-2.0";
const M25 = "LongCat-2.5-Preview";
const SAY_OK = "Reply with exactly one word: ok";

function loadSecretEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(join(ROOT, "secret.env"), "utf8").split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const SECRET = loadSecretEnv();
const KEYS: Record<string, string> = {};
for (let i = 1; i <= 9; i++) if (SECRET[`KEY${i}`]) KEYS[`KEY${i}`] = SECRET[`KEY${i}`];

/**
 * Build a real 8×8 solid-red PNG at run time and return its base64.
 * Generated, never pasted: pitfalls L40 — a broken/1×1 image produces a false
 * "vision unsupported" finding, so the control image must be a valid file whose
 * colour the model can only name if it actually saw it.
 */
function solidRedPngBase64(size = 8): string {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 3);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      raw[rowStart + 1 + x * 3] = 0xe0; // R
      raw[rowStart + 2 + x * 3] = 0x10; // G
      raw[rowStart + 3 + x * 3] = 0x10; // B
    }
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return png.toString("base64");
}
const RED_PNG_B64 = solidRedPngBase64();

type Probe = {
  label: string;
  url: string;
  key?: string; // defaults to KEY1; "none" = no Authorization header
  body?: unknown; // undefined ⇒ GET
  cls: "free" | "billed";
  purpose: string;
  bound: string;
  stream?: boolean;
  abortMs?: number;
};

const t = (extra: Record<string, unknown> = {}) => ({
  model: M20,
  messages: [{ role: "user", content: SAY_OK }],
  max_tokens: 8,
  ...extra,
});
const toolDef = {
  type: "function",
  function: {
    name: "get_current_time",
    description: "Return the current time in UTC.",
    parameters: { type: "object", properties: { zone: { type: "string" } }, required: ["zone"] },
  },
};

const PROBES_LIST: Probe[] = [
  // ---- 1. surface liveness + SSE dialect (billed, tiny) ----
  {
    label: "S1-chat-stream",
    url: `${OAI}/chat/completions`,
    cls: "billed",
    purpose: "chat surface liveness, SSE dialect, usage, echoed model, finish_reason",
    bound: "max_tokens 8, 6-word prompt",
    body: t({ stream: true, stream_options: { include_usage: true } }),
    stream: true,
  },
  {
    label: "S2-responses-stream",
    url: `${OAI}/responses`,
    cls: "billed",
    purpose: "does the UNDOCUMENTED Responses surface generate at all?",
    bound: "max_output_tokens 8, 6-word prompt, abort 3 s",
    body: { model: M20, input: SAY_OK, max_output_tokens: 8, stream: true },
    stream: true,
    abortMs: ABORT_MS,
  },
  {
    label: "S3-anthropic-stream",
    url: `${ANTH}/messages`,
    cls: "billed",
    purpose: "Anthropic surface liveness + SSE dialect",
    bound: "max_tokens 8, 6-word prompt",
    body: { model: M20, messages: [{ role: "user", content: SAY_OK }], max_tokens: 8, stream: true },
    stream: true,
  },
  // ---- S31: what does the Responses surface do with pi's unconditional fields? ----
  {
    label: "S4-responses-pi-shaped",
    url: `${OAI}/responses`,
    cls: "billed",
    purpose: "pi's real Responses body: store:false + prompt_cache_key + reasoning{effort,summary} + instructions",
    bound: "max_output_tokens 8, abort 3 s",
    body: {
      model: M20,
      instructions: "You are a terse assistant.",
      input: [{ role: "user", content: SAY_OK }],
      max_output_tokens: 8,
      stream: true,
      store: false,
      prompt_cache_key: "probe-session-1",
      reasoning: { effort: "low", summary: "auto" },
    },
    stream: true,
    abortMs: ABORT_MS,
  },
  // ---- 2. thinking: accepted vs HONOURED (behavioural readout) ----
  {
    label: "T1-thinking-enabled",
    url: `${OAI}/chat/completions`,
    cls: "billed",
    purpose: 'thinking {"type":"enabled"} — is reasoning_content / reasoning_tokens produced?',
    bound: "max_tokens 8",
    body: t({ thinking: { type: "enabled" } }),
  },
  {
    label: "T2-thinking-disabled",
    url: `${OAI}/chat/completions`,
    cls: "billed",
    purpose: 'thinking {"type":"disabled"} — off-switch readout',
    bound: "max_tokens 8",
    body: t({ thinking: { type: "disabled" } }),
  },
  {
    label: "T3-thinking-absent",
    url: `${OAI}/chat/completions`,
    cls: "billed",
    purpose: "no thinking field at all — is thinking ON by default?",
    bound: "max_tokens 8",
    body: t(),
  },
  {
    label: "T4-thinking-zai-shape",
    url: `${OAI}/chat/completions`,
    cls: "billed",
    purpose: "pi's zai wire shape: thinking {type:enabled, clear_thinking:false} — accepted or rejected?",
    bound: "max_tokens 8",
    body: t({ thinking: { type: "enabled", clear_thinking: false } }),
  },
  {
    label: "T5-thinking-2.5",
    url: `${OAI}/chat/completions`,
    cls: "billed",
    purpose: "thinking enabled on LongCat-2.5-Preview (per-model thinking check)",
    bound: "max_tokens 8",
    body: t({ model: M25, thinking: { type: "enabled" } }),
  },
  {
    label: "T6-reasoning-effort",
    url: `${OAI}/chat/completions`,
    cls: "billed",
    purpose: "OpenAI-style reasoning_effort (not in supported_parameters) — accepted/ignored/rejected?",
    bound: "max_tokens 8",
    body: t({ reasoning_effort: "high" }),
  },
  {
    label: "T7-anthropic-thinking",
    url: `${ANTH}/messages`,
    cls: "billed",
    purpose: "Anthropic surface: LongCat's thinking object vs Anthropic's budget_tokens shape",
    bound: "max_tokens 8",
    body: {
      model: M20,
      messages: [{ role: "user", content: SAY_OK }],
      max_tokens: 8,
      thinking: { type: "enabled", budget_tokens: 1024 },
    },
  },
  // ---- 3. tools ----
  {
    label: "TL1-tools-chat",
    url: `${OAI}/chat/completions`,
    cls: "billed",
    purpose: "chat: does it emit tool_calls? (shape observable only if the tool is required)",
    bound: "max_tokens 200, tool_choice forced",
    body: t({
      max_tokens: 200,
      tools: [toolDef],
      tool_choice: { type: "function", function: { name: "get_current_time" } },
      messages: [{ role: "user", content: "What is the time in UTC? Use the tool." }],
    }),
  },
  {
    label: "TL2-tools-anthropic",
    url: `${ANTH}/messages`,
    cls: "billed",
    purpose: "Anthropic surface: tool_use block emitted?",
    bound: "max_tokens 200, tool_choice forced",
    body: {
      model: M20,
      messages: [{ role: "user", content: "What is the time in UTC? Use the tool." }],
      max_tokens: 200,
      tools: [
        {
          name: "get_current_time",
          description: "Return the current time in UTC.",
          input_schema: { type: "object", properties: { zone: { type: "string" } }, required: ["zone"] },
        },
      ],
      tool_choice: { type: "tool", name: "get_current_time" },
    },
  },
  {
    label: "TL3-tool-result-role",
    url: `${OAI}/chat/completions`,
    cls: "billed",
    purpose: "is role:'tool' accepted? (docs list only system|user|assistant) — decides the payload hook",
    bound: "max_tokens 8",
    body: {
      model: M20,
      max_tokens: 8,
      messages: [
        { role: "user", content: "What is the time in UTC? Use the tool." },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "get_current_time", arguments: '{"zone":"UTC"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "12:00 UTC" },
      ],
      tools: [toolDef],
    },
  },
  // ---- 4. request shapes pi sends ----
  {
    label: "PA1-content-parts-array",
    url: `${OAI}/chat/completions`,
    cls: "billed",
    purpose: "content as a parts array (pi's shape) vs the documented string — S28 discriminator",
    bound: "max_tokens 4",
    body: {
      model: M20,
      max_tokens: 4,
      messages: [{ role: "user", content: [{ type: "text", text: SAY_OK }] }],
    },
  },
  {
    label: "PA2-developer-role",
    url: `${OAI}/chat/completions`,
    cls: "billed",
    purpose: "role:'developer' accepted? (decides supportsDeveloperRole)",
    bound: "max_tokens 4",
    body: {
      model: M20,
      max_tokens: 4,
      messages: [
        { role: "developer", content: "You are terse." },
        { role: "user", content: SAY_OK },
      ],
    },
  },
  {
    label: "PA3-temperature-range",
    url: `${OAI}/chat/completions`,
    cls: "billed",
    purpose: "temperature 1.5 vs the documented 0~1 range — strictness readout",
    bound: "max_tokens 4",
    body: t({ max_tokens: 4, temperature: 1.5 }),
  },
  // ---- 5. images (listing says 2.5=text+image, 2.0=text) ----
  {
    label: "IM1-image-2.5-chat",
    url: `${OAI}/chat/completions`,
    cls: "billed",
    purpose: "image_url OBJECT form on 2.5-Preview + a modality-only question (L40: prove consumption)",
    bound: "max_tokens 8, 8×8 generated red PNG",
    body: {
      model: M25,
      max_tokens: 8,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What single colour is this image? Answer with one word." },
            { type: "image_url", image_url: { url: `data:image/png;base64,${RED_PNG_B64}` } },
          ],
        },
      ],
    },
  },
  {
    label: "IM2-image-2.0-chat",
    url: `${OAI}/chat/completions`,
    cls: "billed",
    purpose: "control: 2.0 is listed text-only — rejected, or accepted-and-dropped?",
    bound: "max_tokens 8, same generated PNG",
    body: {
      model: M20,
      max_tokens: 8,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What single colour is this image? Answer with one word." },
            { type: "image_url", image_url: { url: `data:image/png;base64,${RED_PNG_B64}` } },
          ],
        },
      ],
    },
  },
  // ---- 6. caps / window (rejection = free; acceptance = aborted at 3 s) ----
  {
    label: "CAP1-chat-2.0-131073",
    url: `${OAI}/chat/completions`,
    cls: "billed",
    purpose: "output cap of 2.0: listing says 131072 ⇒ window+1 should be rejected with the ceiling",
    bound: "max_tokens 131073, 6-word prompt, stream + 3 s abort",
    body: t({ stream: true, max_tokens: 131_073 }),
    stream: true,
    abortMs: ABORT_MS,
  },
  {
    label: "CAP2-chat-2.5-131073",
    url: `${OAI}/chat/completions`,
    cls: "billed",
    purpose: "2.5-Preview at 131073: discriminates the FAQ's 128k from the listing's 262144",
    bound: "max_tokens 131073, stream + 3 s abort",
    body: t({ model: M25, stream: true, max_tokens: 131_073 }),
    stream: true,
    abortMs: ABORT_MS,
  },
  {
    label: "CAP3-chat-2.5-262145",
    url: `${OAI}/chat/completions`,
    cls: "billed",
    purpose: "2.5-Preview at listing cap + 1 (262145)",
    bound: "max_tokens 262145, stream + 3 s abort",
    body: t({ model: M25, stream: true, max_tokens: 262_145 }),
    stream: true,
    abortMs: ABORT_MS,
  },
  {
    label: "CAP4-chat-window-plus-1",
    url: `${OAI}/chat/completions`,
    cls: "billed",
    purpose: "context window: tiny prompt + max_tokens 1048576 ⇒ prompt+max_tokens > 1M window; FAQ promises context_length_exceeded",
    bound: "max_tokens 1048576, stream + 3 s abort",
    body: t({ stream: true, max_tokens: 1_048_576 }),
    stream: true,
    abortMs: ABORT_MS,
  },
  {
    label: "CAP5-anthropic-131073",
    url: `${ANTH}/messages`,
    cls: "billed",
    purpose: "is the cap validated per surface? (Anthropic route)",
    bound: "max_tokens 131073, stream + 3 s abort",
    body: { model: M20, messages: [{ role: "user", content: SAY_OK }], max_tokens: 131_073, stream: true },
    stream: true,
    abortMs: ABORT_MS,
  },
  {
    label: "CAP6-responses-131073",
    url: `${OAI}/responses`,
    cls: "billed",
    purpose: "is the cap validated on the Responses surface?",
    bound: "max_output_tokens 131073, stream + 3 s abort",
    body: { model: M20, input: SAY_OK, max_output_tokens: 131_073, stream: true },
    stream: true,
    abortMs: ABORT_MS,
  },
];

// ---- 7. per-key entitlement: one tiny call on each key ----
for (const name of Object.keys(KEYS).slice(1)) {
  PROBES_LIST.push({
    label: `K-${name}`,
    url: `${OAI}/chat/completions`,
    key: name,
    cls: "billed",
    purpose: `${name}: call-level entitlement (403 insufficient_quota vs 200) — one account or nine?`,
    bound: "max_tokens 4, 6-word prompt",
    body: t({ max_tokens: 4 }),
  });
}

type Row = {
  n: number;
  ts: string;
  label: string;
  key: string;
  surface: string;
  purpose: string;
  bound: string;
  plannedClass: Probe["cls"];
  http: number | string;
  actualClass: string;
  in?: number;
  out?: number;
  cached?: number;
  costCny: number;
  note: string;
};

function surfaceOf(url: string): string {
  if (url.includes("/responses")) return "openai-responses";
  if (url.includes("/anthropic/")) return "anthropic-messages";
  if (url.includes("/chat/completions")) return "openai-completions";
  return "GET";
}

function usageOf(text: string, isStream: boolean): { in?: number; out?: number; cached?: number } {
  const blobs: string[] = [];
  if (isStream) {
    for (const line of text.split("\n")) {
      const s = line.trim();
      if (s.startsWith("data:")) blobs.push(s.slice(5).trim());
    }
  } else blobs.push(text);
  for (const b of blobs) {
    if (!b || b === "[DONE]") continue;
    try {
      const j = JSON.parse(b);
      const u = j.usage ?? j.response?.usage ?? j.message?.usage;
      if (!u) continue;
      const inp = u.prompt_tokens ?? u.input_tokens;
      const outp = u.completion_tokens ?? u.output_tokens;
      const cached = u.prompt_tokens_details?.cached_tokens ?? u.cache_read_input_tokens;
      if (inp !== undefined || outp !== undefined) return { in: inp, out: outp, cached };
    } catch {
      /* not JSON — keep scanning */
    }
  }
  return {};
}

async function run(p: Probe, n: number, keyName: string): Promise<Row> {
  const key = p.key === "none" ? undefined : (p.key ? KEYS[p.key] : KEYS.KEY1) ?? SECRET.KEY1;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), p.abortMs ?? 45_000);
  const started = Date.now();
  let http: number | string = "ERR";
  let text = "";
  let aborted = false;
  let headers: Record<string, string> = {};
  try {
    const res = await fetch(p.url, {
      method: p.body === undefined ? "GET" : "POST",
      headers: {
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...(p.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: p.body === undefined ? undefined : JSON.stringify(p.body),
      signal: ac.signal,
    });
    http = res.status;
    headers = Object.fromEntries([...res.headers.entries()].filter(([k]) => /^(mt-|m-|x-ws)/.test(k)));
    text = await res.text();
  } catch (e) {
    aborted = (e as Error)?.name === "AbortError";
    http = aborted ? `ABORTED(${p.abortMs}ms)` : `ERR:${(e as Error).message.slice(0, 60)}`;
  } finally {
    clearTimeout(timer);
  }
  const isStream = !!p.stream;
  const u = usageOf(text, isStream);
  const generated = u.in !== undefined || u.out !== undefined;
  const inBand = !isStream && /^\s*\{"error"/.test(text);
  const inBandStream = isStream && /"error"/.test(text) && !/"(delta|choices|output_text|content_block)"/.test(text);
  const billed = http === 200 && generated && !inBand && !inBandStream;
  const cost = billed
    ? ((u.in ?? 0) - (u.cached ?? 0)) / 1e6 * PRICE.input +
      (u.cached ?? 0) / 1e6 * PRICE.cached +
      (u.out ?? 0) / 1e6 * PRICE.output
    : 0;
  const actualClass = billed ? "BILLED" : http === 200 ? "200-no-usage (not billed)" : "free (rejected/no inference)";
  const label = `${p.label}`;
  writeFileSync(join(PROBES, `${label}.json`), text);
  if (Object.keys(headers).length) writeFileSync(join(PROBES, `${label}.headers.json`), JSON.stringify(headers, null, 2));
  const row: Row = {
    n,
    ts: new Date(started).toISOString(),
    label,
    key: keyName,
    surface: surfaceOf(p.url),
    purpose: p.purpose,
    bound: p.bound,
    plannedClass: p.cls,
    http,
    actualClass,
    in: u.in,
    out: u.out,
    cached: u.cached,
    costCny: Math.round(cost * 1e8) / 1e8,
    note: [aborted ? "aborted by client guard" : "", inBand || inBandStream ? "in-band error body" : "",
      text.slice(0, 200).replace(/\s+/g, " ")].filter(Boolean).join(" | "),
  };
  appendFileSync(LEDGER, JSON.stringify(row) + "\n");
  const cost_ = cost ? ` ¥${cost.toFixed(8)}` : "";
  console.log(
    `[${String(n).padStart(2, "0")}] ${label.padEnd(26)} ${String(http).padEnd(14)} ${actualClass.padEnd(28)} in=${u.in ?? "?"} out=${u.out ?? "?"}${cost_}`,
  );
  console.log(`      ↳ ${text.slice(0, 300).replace(/\s+/g, " ")}`);
  return row;
}

const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;
const dry = process.argv.includes("--dry");
const list = PROBES_LIST.map((p, i) => ({ p, i: i + 1 })).filter(
  ({ p }) => !only || p.label.toLowerCase().startsWith(only.toLowerCase()),
);
if (dry) {
  for (const { p, i } of list) console.log(`${i}. ${p.label} [${p.cls}] ${p.purpose}`);
  console.log(`\n${list.length} probes; billed-capable: ${list.filter((x) => x.p.cls === "billed").length}`);
} else {
  let total = 0;
  for (const { p, i } of list) {
    const keyName = p.key ?? (p.key === "none" ? "none" : "KEY1");
    const row = await run(p, i, keyName);
    total += row.costCny;
    await new Promise((r) => setTimeout(r, PACE_MS));
  }
  console.log(`\nTOTAL SPEND THIS RUN: ¥${total.toFixed(8)} (~$${(total / 6.7252).toFixed(8)})`);
  console.log(`Ledger rows appended: ${list.length} → research/probe-ledger.jsonl`);
}

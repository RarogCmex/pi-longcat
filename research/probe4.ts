/**
 * Round-4 research probes (2026-10-11) — matrix completion + a non-guessable vision control.
 *
 * Why a second round: three round-1 results were *acceptance* without a
 * behavioural readout, and acceptance proves nothing on this gateway
 * (pi-provider-pitfalls L40/T27, and the skill's "accepted ≠ honored"):
 *   - `role: "developer"` returned 200 with prompt_tokens identical to the
 *     no-system-message control ⇒ suspected silently dropped. Needs a long
 *     message so the token delta cannot hide, plus a `role: "system"` control.
 *   - the 8×8 control PNG was rejected by 2.5-Preview with a *measured* floor
 *     ("Image too small (area=64px), minimum required area: >256px") ⇒ the image
 *     probes must be re-run above that floor, with a text-only control on the
 *     same prompt, before any "supports images" claim.
 *   - `LongCat-2.0` (listing: text-only) ACCEPTED the image part with
 *     `image_tokens: 0` ⇒ accepted-and-dropped is the leading hypothesis; the
 *     control decides.
 * Plus two cache-accounting reads (one repeat per surface, not a loop — the
 * skill's "prove the accounting once with two short requests").
 *
 * Bounds: every call max_tokens <= 8, tiny prompts, 10 s pacing, all ledgered.
 * Usage: node research/probe4.ts
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
const PRICE = { input: 2, cached: 0.04, output: 8 }; // ¥/1M (GET /models/{id}, 2026-10-10)
const OAI = "https://api.longcat.chat/openai/v1";
const ANTH = "https://api.longcat.chat/anthropic/v1";
const M20 = "LongCat-2.0";
const M25 = "LongCat-2.5-Preview";

const SECRET: Record<string, string> = {};
for (const line of readFileSync(join(ROOT, "secret.env"), "utf8").split("\n")) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
  if (m) SECRET[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const KEY = SECRET.KEY1;

/** Solid-colour PNG built at run time (never pasted base64 — pitfalls L40). */
function solidPngBase64(size: number, rgb: [number, number, number]): string {
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
/** 64×64 = 4096 px area, above the measured >256 px floor (round 1, IM1). */
const RED64 = solidPngBase64(64, [0xe0, 0x10, 0x10]);
const IMG_Q = "What single colour is this image? Answer with one word.";
const LONG_SYS =
  "You are a terse assistant. Always answer with exactly one word. " +
  "Never explain yourself. Never use more than one word in any reply. " +
  "If asked a question, answer it with a single word and nothing else.";


/**
 * Round 3 answers three questions round 2 left open, each with a behavioural
 * readout rather than an acceptance (accepted ≠ honored):
 *  1. Does 2.5-Preview actually SEE the image? Round 2 proved the image is
 *     tokenized (input 85 vs 19) but max_tokens 8 was eaten by reasoning, so no
 *     visible answer existed. Re-run with thinking DISABLED so the answer fits.
 *  2. Is there a thinking off switch on the RESPONSES surface? pi's Responses
 *     adapter can only send `reasoning:{effort,summary}`; if neither `effort:
 *     "none"` nor an undocumented `thinking:{type:"disabled"}` zeroes
 *     `output_tokens_details.reasoning_tokens`, that surface has no off switch
 *     (pitfalls T28) and cannot be the default for a model that thinks by
 *     default.
 *  3. Does the ANTHROPIC surface honour LongCat's `thinking:{type:"disabled"}`?
 * Readout field: `usage.completion_tokens_details.reasoning_tokens` (chat /
 * responses) and the presence of a `thinking` content block (anthropic).
 * Bounds: max_tokens <= 8 everywhere, 10 s pacing, every call ledgered.
 */

/**
 * Round 4 closes two gaps:
 *  1. Surface x model matrix. Rounds 1-3 proved LongCat-2.0 on all three
 *     surfaces and LongCat-2.5-Preview on chat only. The uniform-vs-mixed
 *     discriminator (surfaces-and-routing.md) needs the other two cells before
 *     the plugin can pin one switch instead of per-model routing.
 *  2. Vision, with a control that cannot be guessed. Round 3's readout was
 *     ambiguous in an instructive way: WITH a red 64x64 image the model said
 *     "White", and the text-only control (same question, no image) said "Red".
 *     A red target with a "what colour" question is guessable from the prompt
 *     alone, so it cannot separate seeing from guessing. Round 4 sends a BLUE
 *     256x256 image (above the measured >256px-area floor) and asks the same
 *     question: "Blue" can only come from the image.
 * Bounds: max_tokens <= 8, 10 s pacing, ledgered.
 */
type P = { label: string; url: string; body: unknown; purpose: string; note?: string };
const BLUE256 = solidPngBase64(256, [0x10, 0x20, 0xe8]);
const R2: P[] = [
  {
    label: "R4-2.5-responses",
    url: `${OAI}/responses`,
    purpose: "matrix cell: LongCat-2.5-Preview on the Responses surface",
    body: { model: M25, max_output_tokens: 8, input: "Reply with exactly one word: ok" },
  },
  {
    label: "R4-2.5-anthropic",
    url: `${ANTH}/messages`,
    purpose: "matrix cell: LongCat-2.5-Preview on the Anthropic surface",
    body: { model: M25, max_tokens: 8, messages: [{ role: "user", content: "Reply with exactly one word: ok" }] },
  },
  {
    label: "R4-IM-blue-2.5",
    url: `${OAI}/chat/completions`,
    purpose: "vision proof: BLUE 256x256 PNG, thinking off, one-word answer — 'Blue' can only come from the image",
    body: { model: M25, max_tokens: 8, thinking: { type: "disabled" }, messages: [{ role: "user", content: [{ type: "text", text: IMG_Q }, { type: "image_url", image_url: { url: `data:image/png;base64,${BLUE256}` } }] }] },
  },
  {
    label: "R4-IM-blue-responses",
    url: `${OAI}/responses`,
    purpose: "same blue image on the Responses surface (image_url as a STRING) — cross-surface vision check",
    body: { model: M25, max_output_tokens: 8, reasoning: { effort: "none" }, input: [{ role: "user", content: [{ type: "input_text", text: IMG_Q }, { type: "input_image", image_url: `data:image/png;base64,${BLUE256}` }] }] },
  },
];
let n = 300;
let total = 0;
for (const p of R2) {
  n++;
  const started = Date.now();
  let http: number | string = "ERR";
  let text = "";
  try {
    const res = await fetch(p.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(p.body),
      signal: AbortSignal.timeout(45_000),
    });
    http = res.status;
    text = await res.text();
  } catch (e) {
    http = `ERR:${(e as Error).message.slice(0, 60)}`;
  }
  writeFileSync(join(PROBES, `${p.label}.json`), text);
  let inp: number | undefined;
  let out: number | undefined;
  let cached: number | undefined;
  let extra = "";
  try {
    const j = JSON.parse(text);
    const u = j.usage ?? j.response?.usage;
    inp = u?.prompt_tokens ?? u?.input_tokens;
    out = u?.completion_tokens ?? u?.output_tokens;
    cached = u?.prompt_tokens_details?.cached_tokens ?? u?.cache_read_input_tokens;
    const m = j.choices?.[0]?.message ?? {};
    const parts = Array.isArray(j.content) ? j.content.map((c: any) => `${c.type}:${JSON.stringify(c.text ?? c.thinking ?? c.input ?? c.image_url ?? "").slice(0, 120)}`).join(" || ") : "";
    extra = [
      m.content ? `content=${JSON.stringify(m.content).slice(0, 160)}` : "",
      m.reasoning_content ? `reasoning=${JSON.stringify(m.reasoning_content).slice(0, 160)}` : "",
      m.tool_calls ? `tool_calls=${JSON.stringify(m.tool_calls).slice(0, 160)}` : "",
      parts,
      u ? `details=${JSON.stringify(u.prompt_tokens_details ?? u.completion_tokens_details ?? {})}` : "",
      j.error ? `error=${JSON.stringify(j.error).slice(0, 200)}` : "",
    ].filter(Boolean).join(" | ");
  } catch {
    extra = text.slice(0, 200).replace(/\s+/g, " ");
  }
  const billed = http === 200 && (inp !== undefined || out !== undefined);
  const cost = billed
    ? (((inp ?? 0) - (cached ?? 0)) / 1e6) * PRICE.input + ((cached ?? 0) / 1e6) * PRICE.cached + ((out ?? 0) / 1e6) * PRICE.output
    : 0;
  total += cost;
  appendFileSync(
    LEDGER,
    JSON.stringify({
      n,
      ts: new Date(started).toISOString(),
      label: p.label,
      key: "KEY1",
      surface: p.url.includes("/responses") ? "openai-responses" : p.url.includes("/anthropic/") ? "anthropic-messages" : "openai-completions",
      purpose: p.purpose,
      bound: "max_tokens<=8, tiny prompt, 45 s timeout",
      plannedClass: "billed",
      http,
      actualClass: billed ? "BILLED" : http === 200 ? "200-no-usage (not billed)" : "free (rejected/no inference)",
      in: inp,
      out,
      cached,
      costCny: Math.round(cost * 1e8) / 1e8,
      note: extra.slice(0, 400),
    }) + "\n",
  );
  console.log(`[${n}] ${p.label.padEnd(26)} ${String(http).padEnd(6)} in=${inp ?? "?"} out=${out ?? "?"} cached=${cached ?? "?"}${cost ? ` ¥${cost.toFixed(8)}` : ""}`);
  console.log(`      ↳ ${extra.slice(0, 340)}`);
  await new Promise((r) => setTimeout(r, 10_000));
}
console.log(`\nROUND-2 SPEND: ¥${total.toFixed(8)} (~$${(total / 6.7252).toFixed(8)})`);

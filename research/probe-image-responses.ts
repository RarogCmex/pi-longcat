/**
 * Image-colour stability: Responses vs chat on LongCat-2.5-Preview — 2026-10-24.
 *
 * Trigger: after the default flip, the harness image check (generated GREEN
 * 256×256 png, "what single colour", thinking on, cap 128) answered **"Blue"**
 * on the Responses surface (ledger live/image-colour 10:39Z, out=39, stop=stop)
 * after a truncated run (10:33Z, stop=length) and one correct "Green" (09:30Z).
 * On chat the same probe has answered "Green" every time it was run
 * (2026-10-11 ×2, 2026-10-24 ×1). The new api/responses doc also says "image
 * URLs must be publicly accessible", which raises the question whether base64
 * data-url images are second-class on that surface.
 *
 * Cells (same generated png bytes in every cell; the colour cannot be guessed
 * from the prompt — the text-only control historically answered "Red"):
 *   IR1-IR3  Responses surface, reasoning effort low, max_output_tokens 128 ×3
 *   IR4-IR5  chat surface, thinking enabled (zai bytes), max_tokens 128 ×2
 * Verdict rule, written BEFORE the run: if chat is ≥4/5 green across all today's
 * observations and Responses is ≤2/5, the surface is the variable, not the
 * model. Anything else is "variance, keep measuring".
 *
 * Bounded: 5 calls × ≤128 output ≈ ¥0.006 worst case. Rows: DD3-IR*.
 * Usage: node research/probe-image-responses.ts
 */
import { deflateSync } from "node:zlib";
import { appendRow, chat, loadKeys, pace, PRICE, responses, M25 } from "./lib.ts";

const KEY = "KEY1";

/** The SAME solid green png the harness builds (0x18,0xc8,0x28), 256×256. */
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

const GREEN = solidPng(256, [0x18, 0xc8, 0x28]);
const QUESTION = "What single colour is this image? Answer with one word.";

function costOfParsed(input = 0, output = 0, cacheRead = 0): number {
  return Math.round(((input / 1e6) * PRICE.input + (cacheRead / 1e6) * PRICE.cached + (output / 1e6) * PRICE.output) * 1e8) / 1e8;
}

function verdict(text: string): string {
  const t = text.toLowerCase();
  if (/green/.test(t)) return "GREEN ✓";
  if (/\b(blue|red|white|black|yellow|blank)\b/.test(t)) return `WRONG (${text.trim().slice(0, 40)})`;
  return text.trim() ? `OTHER (${text.trim().slice(0, 40)})` : "EMPTY (truncated)";
}

async function main(): Promise<void> {
  console.log("image-colour stability probe — same png bytes, both surfaces, 2.5-Preview, thinking on");

  for (const i of [1, 2, 3]) {
    const label = `DD3-IR${i}-responses`;
    // lib.responses() sends the raw wire dialect: input items with input_image
    // and a data-url string — the exact shape pi's adapter emits (asserted in
    // test/wire-format.test.ts), so this measures the gateway, not pi.
    const r = await responses(
      {
        model: M25,
        input: [
          { role: "user", content: [{ type: "input_text", text: QUESTION }, { type: "input_image", image_url: `data:image/png;base64,${GREEN}` }] },
        ],
        max_output_tokens: 128,
        reasoning: { effort: "low" },
      },
      { keyId: KEY, label, purpose: "image colour stability on Responses (N=3)", bound: "max_output_tokens 128, 120 s", timeoutMs: 120_000 },
    );
    console.log(`IR${i} responses: out=${r.out} reas=${r.reasoningTokens ?? "?"} → ${verdict(r.text)}  ¥${r.costCny}`);
  }

  for (const i of [4, 5]) {
    const label = `DD3-IR${i}-chat`;
    const r = await chat(
      {
        model: M25,
        messages: [
          { role: "user", content: [{ type: "text", text: QUESTION }, { type: "image_url", image_url: { url: `data:image/png;base64,${GREEN}` } }] },
        ],
        max_tokens: 128,
        thinking: { type: "enabled" },
      },
      { keyId: KEY, label, purpose: "image colour stability on chat, control (N=2)", bound: "max_tokens 128, 120 s", timeoutMs: 120_000 },
    );
    console.log(`IR${i} chat:       out=${r.out} reas=${r.reasoningTokens ?? "?"} → ${verdict(r.text)}  ¥${r.costCny}`);
  }

  console.log("done — verdict rule (written before the run): chat ≥4/5 green AND responses ≤2/5 ⇒ the surface is the variable");
}

main().catch((e) => {
  console.error("probe failed:", e);
  process.exit(1);
});

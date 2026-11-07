/**
 * Vision reliability on the GA model — 2026-11-07.
 *
 * Trigger: the GA round's single chat-surface control (GA-B4) answered **"cyan"**
 * for the same solid GREEN png that LongCat-2.5-Preview named correctly 4/4 on
 * chat on 2026-10-24 and 2/2 on 2026-10-11. One sample cannot distinguish "the
 * GA model's vision is worse" from "this model also has the Responses-surface
 * defect" from "variance". This probe buys the sample size to tell them apart.
 *
 * Cells (identical generated png bytes every time, colour not inferable from the
 * prompt, cap 256 on chat / 384 on Responses — see the cap lesson below):
 *   V-25-chat-on  ×5  LongCat-2.5, chat, thinking enabled — the historical 4/4 case
 *   V-25-chat-off ×3  LongCat-2.5, chat, thinking disabled — the documented caveat
 *   V-25-resp     ×5  LongCat-2.5, Responses, effort low — the DD3 defect, N=5
 *   V-PREV-chat   ×3  LongCat-2.5-Preview, same probe, SAME DAY — the comparison
 *   V-PREV-resp   ×3  that makes "regressed vs Preview" a measurement and not a
 *                     memory of October
 *   V-noimage ×3   the same question with NO image — if this also answers a
 *                  random colour, the prompt is the variable and the image path
 *                  is exonerated (the historical text-only answer was "Red").
 *   V-512     ×5   a 512×512 green png — does size change the answer? (the first
 *                  two 512 cells were 2/2 correct while 256 was 3/10, so the
 *                  bracket gets a real N)
 *   V-RED / V-BLUE ×3 each, LongCat-2.5, chat, thinking on — the controls that
 *                  make the green result interpretable: colour naming that is
 *                  systematically off misses these too, a hue-shifted image
 *                  pipeline misses only the green/cyan pair.
 *
 * Cap lesson from the first run of this probe (2026-11-07, ledger GA-V-*): at
 * `max_tokens 64` the GA model's own reasoning (47-90 tokens on "what colour")
 * ate the answer and half the cells came back EMPTY. A truncated answer is not a
 * vision verdict, so every cell here runs at 256 (chat) / 384 (Responses) — the
 * first run's "0/5" is a cap artefact and is reported as such, not as evidence.
 *
 * V-bars2 / V-bars3 ×2 each: 512×512 white fields with 2 or 3 black bars — the
 * structure control that says whether the model reads the pixels at all.
 *
 * Verdict rule, written BEFORE the run (same as DD3): a surface is "unreliable"
 * when it is wrong in more than 1 of 5 runs; ≤1/5 wrong is "usable, keep
 * measuring". Anything the run contradicts is written up as such.
 *
 * Bounded: 30 calls × ≤384 output ≈ ¥0.06 worst case. **Measured: ¥0.1456 for
 * FOUR runs on 2026-11-07** (three complete plus the cap-64 first pass, ledger
 * rows GA-V-*). The repeats are load-bearing: one "cyan" was a curiosity, ten
 * cells made it a rate.
 * Usage: node research/probe-25-vision.ts
 */
import { deflateSync } from "node:zlib";
import { chat, loadKeys, ORIGIN, responses } from "./lib.ts";

const KEY = "KEY1";
const MODEL = "LongCat-2.5";
const PREVIEW = "LongCat-2.5-Preview";

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

const GREEN = solidPng(256, [0x18, 0xc8, 0x28]); // rgb(24,200,40) — a plain green

/**
 * 512×512 white field with N black horizontal bars. The colour probe alone cannot
 * tell "the image was mangled" from "this model is bad at colour", and those two
 * need different words in the catalog: structure is what a screenshot carries.
 */
function barsPng(n: number): string {
  const size = 512;
  const rgb = Array.from({ length: size }, () => Array.from({ length: size }, () => [255, 255, 255] as [number, number, number]));
  for (let b = 0; b < n; b++) {
    const top = Math.floor(((b + 0.5) * size) / n) - 12;
    for (let y = top; y < top + 24; y++) for (let x = 40; x < size - 40; x++) rgb[y][x] = [0, 0, 0];
  }
  const table = Array.from({ length: 256 }, (_, k) => {
    let c = k;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
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
    for (let x = 0; x < size; x++) {
      raw[o + 1 + x * 3] = rgb[y][x][0];
      raw[o + 2 + x * 3] = rgb[y][x][1];
      raw[o + 3 + x * 3] = rgb[y][x][2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}
const QUESTION = "What single colour is this image? Answer with one word.";

function verdict(text: string): "GREEN" | "WRONG" | "EMPTY" {
  const t = text.toLowerCase();
  if (/green/.test(t)) return "GREEN";
  return text.trim() ? "WRONG" : "EMPTY";
}

async function main(): Promise<void> {
  const keys = loadKeys();
  if (!keys[KEY]) throw new Error(`no ${KEY} in secret.env`);
  console.log(`vision reliability — same generated png every cell — ${ORIGIN}`);

  const tally = new Map<string, { hits: number; n: number }>();
  const bump = (cell: string, ok: boolean) => {
    const cur = tally.get(cell) ?? { hits: 0, n: 0 };
    tally.set(cell, { hits: cur.hits + (ok ? 1 : 0), n: cur.n + 1 });
  };

  /** One vision cell. `surface` picks the dialect AND the cap that fits its reasoning. */
  async function cell(
    cellName: string,
    model: string,
    surface: "chat" | "responses",
    colour: string,
    rgb: [number, number, number],
    thinking: "enabled" | "disabled" | "low",
    i: number,
  ): Promise<void> {
    const png = solidPng(256, rgb);
    const want = new RegExp(colour, "i");
    if (surface === "chat") {
      const r = await chat(
        {
          model,
          max_tokens: 256,
          ...(thinking === "enabled" ? { thinking: { type: "enabled" } } : {}),
          ...(thinking === "disabled" ? { thinking: { type: "disabled" } } : {}),
          messages: [{ role: "user", content: [{ type: "text", text: QUESTION }, { type: "image_url", image_url: { url: `data:image/png;base64,${png}` } }] }],
        },
        { keyId: KEY, label: `GA-V-${cellName}-${i}`, purpose: `${model} chat vision, thinking ${thinking}, solid ${colour} png`, bound: "max_tokens 256, 120 s", timeoutMs: 120_000 },
      );
      const said = r.text.trim().slice(0, 40);
      const ok = want.test(r.text);
      bump(cellName, ok);
      console.log(`${cellName.padEnd(14)} #${i}: in=${r.in} reas=${r.reasoningTokens ?? "-"} ${ok ? "HIT " : "MISS"} ${JSON.stringify(said)} ¥${r.costCny}`);
      return;
    }
    const r = await responses(
      {
        model,
        max_output_tokens: 384,
        reasoning: { effort: "low" },
        input: [{ role: "user", content: [{ type: "input_text", text: QUESTION }, { type: "input_image", image_url: `data:image/png;base64,${png}` }] }],
      },
      { keyId: KEY, label: `GA-V-${cellName}-${i}`, purpose: `${model} Responses vision, effort low, solid ${colour} png`, bound: "max_output_tokens 384, 120 s", timeoutMs: 120_000 },
    );
    const said = r.text.trim().slice(0, 40);
    const ok = want.test(r.text);
    bump(cellName, ok);
    console.log(`${cellName.padEnd(14)} #${i}: in=${r.in} reas=${r.reasoningTokens ?? "-"} ${ok ? "HIT " : "MISS"} ${JSON.stringify(said)} ¥${r.costCny}`);
  }

  const GREEN_RGB: [number, number, number] = [0x18, 0xc8, 0x28];

  for (let i = 1; i <= 5; i++) await cell("25-chat-on", MODEL, "chat", "green", GREEN_RGB, "enabled", i);
  for (let i = 1; i <= 3; i++) await cell("25-chat-off", MODEL, "chat", "green", GREEN_RGB, "disabled", i);
  for (let i = 1; i <= 5; i++) await cell("25-resp", MODEL, "responses", "green", GREEN_RGB, "low", i);
  for (let i = 1; i <= 3; i++) await cell("PREV-chat-on", PREVIEW, "chat", "green", GREEN_RGB, "enabled", i);
  for (let i = 1; i <= 3; i++) await cell("PREV-resp", PREVIEW, "responses", "green", GREEN_RGB, "low", i);
  for (let i = 1; i <= 3; i++) await cell("red", MODEL, "chat", "red", [255, 0, 0], "enabled", i);
  for (let i = 1; i <= 3; i++) await cell("blue", MODEL, "chat", "blue", [0, 0, 255], "enabled", i);

  // Controls that isolate the variable: no image at all, and a larger image.
  for (let i = 1; i <= 3; i++) {
    const r = await chat(
      { model: MODEL, max_tokens: 256, thinking: { type: "enabled" }, messages: [{ role: "user", content: QUESTION }] },
      { keyId: KEY, label: `GA-V-noimage-${i}`, purpose: "control: the same question with no image attached", bound: "max_tokens 256, 120 s", timeoutMs: 120_000 },
    );
    console.log(`${"noimage".padEnd(14)} #${i}: in=${r.in} reas=${r.reasoningTokens ?? "-"} ${JSON.stringify(r.text.trim().slice(0, 40))} ¥${r.costCny}`);
  }

  for (let i = 1; i <= 5; i++) {
    const png = solidPng(512, GREEN_RGB);
    const r = await chat(
      { model: MODEL, max_tokens: 256, thinking: { type: "enabled" }, messages: [{ role: "user", content: [{ type: "text", text: QUESTION }, { type: "image_url", image_url: { url: `data:image/png;base64,${png}` } }] }] },
      { keyId: KEY, label: `GA-V-25-chat-512-${i}`, purpose: "512×512 green png: does image size change the answer?", bound: "max_tokens 256, 120 s", timeoutMs: 120_000 },
    );
    console.log(`${"25-chat-512".padEnd(14)} #${i}: in=${r.in} reas=${r.reasoningTokens ?? "-"} ${/green/i.test(r.text) ? "HIT " : "MISS"} ${JSON.stringify(r.text.trim().slice(0, 40))} ¥${r.costCny}`);
  }

  // Structure beats colour: can the model count bars it has never seen a prompt for?
  for (const n of [2, 3]) {
    const png = barsPng(n);
    for (let i = 1; i <= 2; i++) {
      const r = await chat(
        {
          model: MODEL,
          max_tokens: 256,
          thinking: { type: "enabled" },
          messages: [
            { role: "user", content: [{ type: "text", text: "How many horizontal black bars are in this image? Answer with one number." }, { type: "image_url", image_url: { url: `data:image/png;base64,${png}` } }] },
          ],
        },
        { keyId: KEY, label: `GA-V-bars${n}-${i}`, purpose: `structure control: ${n} black bars on white, can it count them?`, bound: "max_tokens 256, 120 s", timeoutMs: 120_000 },
      );
      console.log(`${`bars${n}`.padEnd(14)} #${i}: in=${r.in} reas=${r.reasoningTokens ?? "-"} ${new RegExp(`${n}\\b`).test(r.text) ? "HIT " : "MISS"} ${JSON.stringify(r.text.trim().slice(0, 40))} ¥${r.costCny}`);
    }
  }

  console.log("\nsummary (verdict rule written before the run: >1 miss in 5 ⇒ unreliable)");
  for (const [cellName, { hits, n }] of tally) {
    const misses = n - hits;
    const verdictText = n >= 5 ? (misses > 1 ? "UNRELIABLE" : "usable") : misses > 0 ? "misses seen" : "clean";
    console.log(`  ${cellName.padEnd(14)} ${hits}/${n} → ${verdictText}`);
  }
}

main().catch((e) => {
  console.error("probe failed:", e);
  process.exit(1);
});

/**
 * LongCat-2.5 GA round — 2026-11-07.
 *
 * Trigger: the platform change log gained "Version: 2026-11-02 — LongCat-2.5 Now
 * Available", GET /openai/v1/models started returning a THIRD id (`LongCat-2.5`,
 * `input_modalities: ["text","image","video"]`, `max_output_tokens: 262144`), and
 * the docs were rewritten around it: the quick start, `api/model-params`, the FAQ
 * and every pricing page now name LongCat-2.5 and NO LONGER document
 * LongCat-2.5-Preview or LongCat-2.0, while both are still served by the API.
 * Two documented numbers also moved: the image-area floor (docs: 200 px, the
 * catalog carried the measured >256 px) and 2.0's output ceiling (the harness's
 * free cap sweep for 2.0 came back **200 ACCEPTED** — the oracle row is in the
 * ledger as a billed cell, which is exactly how a silent ceiling change announces
 * itself).
 *
 * Questions, in order.
 *  A (free: GETs and guaranteed rejections — the status IS the evidence)
 *    A1     is the listing now exactly {2.5, 2.5-Preview, 2.0}?
 *    A2     do the three retrieve bodies still agree with the catalog on window,
 *           modality and price?
 *    A3-A5  the cap oracle: 2.5 and 2.5-Preview at 262145, 2.0 at 262145 — does
 *           each name its ceiling? (2.0's 131073 was accepted, so its ceiling
 *           moved; 262145 is the number that brackets it for free)
 *    A6-A7  the image-area floor: 8×8 (64 px) and 14×14 (196 px) — does the
 *           gateway name the new 200 px floor, and is 196 still under it?
 *    A8-A9  is `video_url` a real content block on 2.5 and on 2.5-Preview (a
 *           failed download is proof the block was parsed; a schema rejection
 *           would be proof it was not)?
 *    A10    unknown model id and top_p range — the two unchanged guards.
 *  B (billed, bounded ≤ ¥0.02 as written)
 *    B1-B3  chat 2.5: thinking enabled / disabled / absent — is the switch still
 *           measured by its OUTPUT, and is thinking still on by default?
 *    B4     chat 2.5 vision: generated GREEN 256×256 png, thinking on, cap 64 —
 *           the chat-surface control.
 *    B5-B7  Responses 2.5: no `reasoning` field / `effort:"none"` / `effort:"low"`
 *           — is the 2.5-family off switch still dead on that surface (the reason
 *           LONGCAT_THINKING_RESPONSES_25 exists), or does GA honour it?
 *    B8-B9  Responses 2.5 vision ×2 — the DD3 defect (green read as blue/teal)
 *           re-measured on the GA model.
 *    B10    chat 2.5 tool round trip — is native tool calling still live?
 *    B11    liveness of the two undocumented-but-served ids (Preview, 2.0) at
 *           cap 8.
 *    B12    the other half of the floor bracket: a 15×15 (225 px) image must be
 *           ACCEPTED, or "200" is only a lower bound nobody crossed.
 *
 * Measured spend: **¥0.00396** for the whole script on 2026-11-07 (ledger rows
 * GA-A*/GA-B*), i.e. the free cells plus twelve bounded generations.
 *
 * Usage: node research/probe-25-ga.ts            # free cells only, spends ¥0
 *        node research/probe-25-ga.ts --billed   # + the billed cells
 *        node research/probe-25-ga.ts --only A3
 */
import { deflateSync } from "node:zlib";
import { appendRow, chat, loadKeys, ORIGIN, PRICE, pace, responses, toolDef } from "./lib.ts";

const KEY = "KEY1";
const BILLED = process.argv.includes("--billed");
const ONLY = (() => {
  const i = process.argv.indexOf("--only");
  return i >= 0 ? process.argv[i + 1] : undefined;
})();
const M25_GA = "LongCat-2.5";
const M25_PREVIEW = "LongCat-2.5-Preview";
const M20 = "LongCat-2.0";

function selected(label: string): boolean {
  return !ONLY || label === ONLY || label.startsWith(ONLY);
}
function blockSelected(letter: string): boolean {
  return !ONLY || ONLY.startsWith(letter) || letter.startsWith(ONLY);
}

/** The same generated solid PNG the harness and DD3 used — never a pasted blob. */
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

function verdict(text: string): string {
  const t = text.toLowerCase();
  if (/green/.test(t)) return "GREEN ✓";
  if (/\b(blue|teal|red|white|black|yellow|blank)\b/.test(t)) return `WRONG (${text.trim().slice(0, 40)})`;
  return text.trim() ? `OTHER (${text.trim().slice(0, 40)})` : "EMPTY (truncated)";
}

/** Raw non-streaming request for the free cells: a rejection is the evidence. */
async function raw(
  method: "GET" | "POST",
  path: string,
  label: string,
  purpose: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; json: any; text: string }> {
  const keys = loadKeys();
  await pace();
  const response = await fetch(`${ORIGIN}${path}`, {
    method,
    headers: { Authorization: `Bearer ${keys[KEY]}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  const promptTokens = json?.usage?.prompt_tokens;
  const outputTokens = json?.usage?.completion_tokens;
  const cached = json?.usage?.prompt_tokens_details?.cached_tokens;
  const generated = response.status === 200 && promptTokens !== undefined && !json?.error;
  appendRow({
    label: `GA-${label}`,
    key: KEY,
    model: typeof body?.model === "string" ? body.model : undefined,
    surface: method === "GET" ? "GET" : path.includes("/responses") ? "openai-responses" : path.includes("/anthropic") ? "anthropic-messages" : "openai-completions",
    purpose,
    bound: method === "GET" ? "no inference" : `max_tokens ${body?.max_tokens ?? "-"} (rejection expected)`,
    plannedClass: "free",
    http: response.status,
    actualClass: generated ? "BILLED" : response.status === 200 ? "200-no-generation (not billed)" : "free (rejected/no inference)",
    in: promptTokens,
    out: outputTokens,
    cached,
    costCny: generated
      ? Math.round((((promptTokens - (cached ?? 0)) / 1e6) * PRICE.input + ((cached ?? 0) / 1e6) * PRICE.cached + (outputTokens / 1e6) * PRICE.output) * 1e8) / 1e8
      : 0,
    note: text.slice(0, 300).replace(/\s+/g, " "),
  });
  return { status: response.status, json, text };
}

const CHAT = "/openai/v1/chat/completions";
const oneWord = [{ role: "user", content: "Reply with exactly one word: ok" }];
const imagePart = (px: number) => ({ type: "image_url", image_url: { url: `data:image/png;base64,${solidPng(px, [0x18, 0xc8, 0x28])}` } });

async function main(): Promise<void> {
  console.log(`LongCat-2.5 GA round — key ${KEY}, billed=${BILLED}, only=${ONLY ?? "all"}`);

  if (blockSelected("A")) {
    if (selected("A1")) {
      const r = await raw("GET", "/openai/v1/models", "A1-listing", "does the listing now carry LongCat-2.5 (3 ids)?");
      console.log("A1 listing:", JSON.stringify((r.json?.data ?? []).map((m: any) => [m.id, m.context_window, m.max_output_tokens, m.input_modalities?.join("+")])));
    }
    if (selected("A2")) {
      for (const id of [M25_GA, M25_PREVIEW, M20]) {
        const r = await raw("GET", `/openai/v1/models/${id}`, `A2-retrieve-${id}`, "window / modalities / price / contract");
        console.log(`A2 ${id}:`, JSON.stringify({ ctx: r.json?.context_length, mod: r.json?.architecture?.input_modalities, price: r.json?.pricing, params: r.json?.supported_parameters }));
      }
    }
    const caps: [string, string][] = [
      ["A3", M25_GA],
      ["A4", M25_PREVIEW],
      ["A5", M20],
    ];
    for (const [label, id] of caps) {
      if (!selected(label)) continue;
      const r = await raw("POST", CHAT, `${label}-cap-${id}`, `${id}: does 262145 name the ceiling?`, { model: id, messages: oneWord, max_tokens: 262145 });
      console.log(`${label} ${id} cap 262145: HTTP ${r.status} ${JSON.stringify(r.json?.error?.message)}`);
    }
    if (selected("A6")) {
      const r = await raw("POST", CHAT, `A6-floor-64px`, "8×8 / 64 px: the floor is still rejected and named", { model: M25_GA, max_tokens: 4, messages: [{ role: "user", content: [{ type: "text", text: "What colour?" }, imagePart(8)] }] });
      console.log(`A6 2.5 floor 64px: HTTP ${r.status} ${JSON.stringify(r.json?.error?.message)}`);
    }
    if (selected("A7")) {
      const r = await raw("POST", CHAT, `A7-floor-196px`, "14×14 / 196 px: is 196 still under the 200 px floor?", { model: M25_GA, max_tokens: 4, messages: [{ role: "user", content: [{ type: "text", text: "What colour?" }, imagePart(14)] }] });
      console.log(`A7 2.5 floor 196px: HTTP ${r.status} ${JSON.stringify(r.json?.error?.message)}`);
    }
    if (selected("A8")) {
      const r = await raw("POST", CHAT, `A8-video-2.5`, "video_url on 2.5: a failed download proves the block was parsed", {
        model: M25_GA, max_tokens: 4,
        messages: [{ role: "user", content: [{ type: "text", text: "What happens?" }, { type: "video_url", video_url: { url: "https://example.invalid/nope.mp4" } }] }],
      });
      console.log(`A8 2.5 video_url: HTTP ${r.status} ${JSON.stringify(r.json?.error?.message)}`);
    }
    if (selected("A9")) {
      const r = await raw("POST", CHAT, `A9-video-2.5-preview`, "video_url on 2.5-Preview: parsed too, though its listing still says text+image", {
        model: M25_PREVIEW, max_tokens: 4,
        messages: [{ role: "user", content: [{ type: "text", text: "What happens?" }, { type: "video_url", video_url: { url: "https://example.invalid/nope.mp4" } }] }],
      });
      console.log(`A9 2.5-Preview video_url: HTTP ${r.status} ${JSON.stringify(r.json?.error?.message)}`);
    }
    if (selected("A10")) {
      const unknown = await raw("POST", CHAT, `A10-unknown-model`, "unchanged guard: unknown id is 400 invalid_parameter", { model: "no-such-model-xyz", messages: oneWord, max_tokens: 4 });
      const topP = await raw("POST", CHAT, `A10-top_p`, "unchanged guard: top_p is range-checked", { model: M25_GA, messages: oneWord, max_tokens: 4, top_p: 2 });
      console.log(`A10 unknown: HTTP ${unknown.status} ${JSON.stringify(unknown.json?.error?.message)}`);
      console.log(`A10 top_p 2: HTTP ${topP.status} ${JSON.stringify(topP.json?.error?.message)}`);
    }
  }

  if (!BILLED) {
    console.log("\nfree cells done; pass --billed for B1-B11 (worst case ≈ ¥0.02)");
    return;
  }

  if (blockSelected("B")) {
    const opt = (label: string, purpose: string, bound = "max_tokens 8, 120 s") => ({ keyId: KEY, label, purpose, bound, timeoutMs: 120_000 });

    // B12 first: it is the acceptance the free A6/A7 rejections cannot supply.
    if (selected("B12")) {
      const r = await chat(
        { model: M25_GA, max_tokens: 8, thinking: { type: "enabled" }, messages: [{ role: "user", content: [{ type: "text", text: "What colour?" }, imagePart(15)] }] },
        opt("GA-B12-floor-225px", "15×15 / 225 px: accepted ⇒ the floor really is 200, not higher", "max_tokens 8, 120 s"),
      );
      console.log(`B12 2.5 floor 225px: in=${r.in} → ${verdict(r.text)} (accepted ⇒ 225 ≥ floor) ¥${r.costCny}`);
    }

    // B1-B3: the chat-surface thinking switch, measured by its output.
    const switches: [string, string, Record<string, unknown>][] = [
      ["B1", "chat 2.5 thinking enabled", { thinking: { type: "enabled" } }],
      ["B2", "chat 2.5 thinking disabled", { thinking: { type: "disabled" } }],
      ["B3", "chat 2.5 thinking absent (default)", {}],
    ];
    for (const [label, purpose, extra] of switches) {
      if (!selected(label)) continue;
      const r = await chat({ model: M25_GA, messages: oneWord, max_tokens: 8, ...extra }, opt(`GA-${label}-thinking`, purpose));
      console.log(`${label} ${purpose}: out=${r.out} reas=${r.reasoningTokens ?? "-"} text=${JSON.stringify(r.text.trim().slice(0, 40))} ¥${r.costCny}`);
    }

    // B4: chat vision control.
    if (selected("B4")) {
      const r = await chat(
        { model: M25_GA, messages: [{ role: "user", content: [{ type: "text", text: QUESTION }, { type: "image_url", image_url: { url: `data:image/png;base64,${GREEN}` } }] }], max_tokens: 64, thinking: { type: "enabled" } },
        opt("GA-B4-vision-chat", "chat surface vision control on the GA model", "max_tokens 64, 120 s"),
      );
      console.log(`B4 chat vision: in=${r.in} reas=${r.reasoningTokens ?? "-"} → ${verdict(r.text)} ¥${r.costCny}`);
    }

    // B5-B7: the Responses-surface off switch on the GA model.
    const efforts: [string, string, Record<string, unknown>][] = [
      ["B5", "responses 2.5 no reasoning field", {}],
      ["B6", "responses 2.5 effort none", { reasoning: { effort: "none" } }],
      ["B7", "responses 2.5 effort low", { reasoning: { effort: "low" } }],
    ];
    for (const [label, purpose, extra] of efforts) {
      if (!selected(label)) continue;
      const r = await responses({ model: M25_GA, input: "Reply with exactly one word: ok", max_output_tokens: 256, ...extra }, opt(`GA-${label}-effort`, purpose, "max_output_tokens 256, 120 s"));
      console.log(`${label} ${purpose}: out=${r.out} reas=${r.reasoningTokens ?? "-"} text=${JSON.stringify(r.text.trim().slice(0, 40))} ¥${r.costCny}`);
    }

    // B8-B9: the DD3 vision defect re-measured on GA, Responses surface.
    for (const label of ["B8", "B9"]) {
      if (!selected(label)) continue;
      const r = await responses(
        { model: M25_GA, input: [{ role: "user", content: [{ type: "input_text", text: QUESTION }, { type: "input_image", image_url: `data:image/png;base64,${GREEN}` }] }], max_output_tokens: 64, reasoning: { effort: "low" } },
        opt(`GA-${label}-vision-responses`, "DD3 re-check: base64 green png on Responses", "max_output_tokens 64, 120 s"),
      );
      console.log(`${label} responses vision: in=${r.in} reas=${r.reasoningTokens ?? "-"} → ${verdict(r.text)} ¥${r.costCny}`);
    }

    // B10: native tool calling on the GA model.
    if (selected("B10")) {
      const r = await chat(
        {
          model: M25_GA,
          messages: [{ role: "user", content: "What is the current time in UTC? Use the tool, do not guess." }],
          tools: [toolDef],
          tool_choice: "auto",
          max_tokens: 200,
          thinking: { type: "enabled" },
        },
        opt("GA-B10-tools", "native tool calling on the GA model", "max_tokens 200, 120 s"),
      );
      console.log(`B10 tools: finish=${r.finish} calls=${JSON.stringify(r.toolCalls.map((c: any) => c.function?.name ?? c.name))} ¥${r.costCny}`);
    }

    // B11: the two ids the docs no longer mention are still served.
    if (selected("B11")) {
      for (const id of [M25_PREVIEW, M20]) {
        const r = await chat({ model: id, messages: oneWord, max_tokens: 8 }, opt(`GA-B11-liveness-${id}`, `${id} is undocumented but still served`));
        console.log(`B11 ${id}: out=${r.out} text=${JSON.stringify(r.text.trim().slice(0, 40))} ¥${r.costCny}`);
      }
    }
  }

  console.log("\ndone — every cell above is a ledger row (research/probe-ledger.jsonl) and a body in research/probes/");
}

main().catch((e) => {
  console.error("probe failed:", e);
  process.exit(1);
});

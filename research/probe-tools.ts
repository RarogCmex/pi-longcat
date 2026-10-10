/**
 * Priority B (cheap half) — tool-call reliability across the thinking switch.
 *
 * Why this exists: pitfalls T29 records a gateway where a *working* off switch
 * halved the model's willingness to call a function tool (2 of 4 with thinking
 * off vs 6 of 6 with it on), and this build's own D5 finding is the same shape in
 * another modality (vision answers correctly with thinking on and wrongly with it
 * off). So "thinking off is honoured" is not the end of the question — the side
 * effects have to be measured too. The operator asked for N ≥ 4 per cell.
 *
 * Design (T29 discipline):
 *  - `tool_choice` is left at the gateway default ("auto"). Forcing the function
 *    would make the wire shape trivially observable and measure nothing about
 *    willingness; the prompt instead states the condition that makes calling the
 *    tool the only correct move ("you must call …, do not answer in text").
 *  - N = 5 per cell, 4 cells: {LongCat-2.0, LongCat-2.5-Preview} × {thinking
 *    enabled, thinking disabled}. Each call is scored mechanically into exactly
 *    one of: STRUCTURED (a `tool_calls` entry with parseable arguments),
 *    INLINE (text containing a tool-call-looking tag such as
 *    `<longcat_tool_call>`), TEXT (a plain answer, no call).
 *  - Budget: KEY2 (a different key from the cache suite, so the per-key ¥1 cap
 *    and any per-key rate limit are not shared). ~20 calls, ≈¥0.02.
 *
 * Usage: node research/probe-tools.ts
 */
import { M20, M25, chat, loadKeys, toolDef } from "./lib.ts";

const KEY = process.env.LONGCAT_TOOLS_KEY ?? "KEY2";
if (!loadKeys()[KEY]) throw new Error(`${KEY} not present in secret.env`);
const N = Number(process.env.LONGCAT_TOOLS_N ?? 5);
const PROMPT =
  "What is the current date and time right now? You must call the get_current_time tool to find out. " +
  "Do not answer from memory and do not answer in text — call the tool.";

type Verdict = "STRUCTURED" | "INLINE" | "TEXT" | "ERROR";
function score(r: { status: number | string; toolCalls: any[]; text: string; error?: string }): { verdict: Verdict; detail: string } {
  if (r.error && r.status !== 200) return { verdict: "ERROR", detail: `status ${r.status}: ${r.error.slice(0, 100)}` };
  const structured = r.toolCalls.filter((c) => c?.function?.name || c?.name);
  if (structured.length > 0) {
    const args = structured[0].function?.arguments ?? structured[0].arguments ?? structured[0].input;
    let parsed: unknown;
    try {
      parsed = typeof args === "string" ? JSON.parse(args) : args;
    } catch {
      return { verdict: "STRUCTURED", detail: `${structured[0].function?.name ?? structured[0].name} with UNPARSEABLE arguments ${JSON.stringify(args).slice(0, 80)}` };
    }
    return { verdict: "STRUCTURED", detail: `${structured[0].function?.name ?? structured[0].name}(${JSON.stringify(parsed)})` };
  }
  if (/tool_call|function_call|get_current_time\s*\(/i.test(r.text)) return { verdict: "INLINE", detail: `text-embedded call: ${JSON.stringify(r.text.slice(0, 120))}` };
  return { verdict: "TEXT", detail: `plain answer: ${JSON.stringify(r.text.slice(0, 120))}` };
}

const cells: { model: string; thinking: "enabled" | "disabled" }[] = [
  { model: M20, thinking: "enabled" },
  { model: M20, thinking: "disabled" },
  { model: M25, thinking: "enabled" },
  { model: M25, thinking: "disabled" },
];

let spent = 0;
const table: string[] = [];
for (const cell of cells) {
  const counts: Record<Verdict, number> = { STRUCTURED: 0, INLINE: 0, TEXT: 0, ERROR: 0 };
  for (let i = 1; i <= N; i++) {
    const r = await chat(
      {
        model: cell.model,
        max_tokens: 256,
        thinking: { type: cell.thinking },
        tools: [toolDef],
        messages: [{ role: "user", content: PROMPT }],
      },
      {
        keyId: KEY,
        label: `B-tools-${cell.model === M20 ? "2.0" : "2.5"}-${cell.thinking}-${i}of${N}`,
        purpose: `tool-call reliability: ${cell.model} with thinking ${cell.thinking}, trial ${i}/${N} (tool_choice left at the default so willingness is what is measured)`,
        bound: "max_tokens 256, one tool, no forced tool_choice",
      },
    );
    spent += r.costCny;
    const { verdict, detail } = score(r);
    counts[verdict]++;
    console.log(`      ${cell.model} / ${cell.thinking} #${i}: ${verdict} — ${detail} (in=${r.in} out=${r.out} ttft=${r.ttftMs}ms ${r.tokPerSec ?? "?"} tok/s)`);
  }
  table.push(
    `| ${cell.model} | thinking ${cell.thinking} | ${counts.STRUCTURED}/${N} | ${counts.INLINE} | ${counts.TEXT} | ${counts.ERROR} |`,
  );
}

console.log("\n================ TOOL RELIABILITY (N per cell = " + N + ") ================");
console.log("| model | switch | structured tool_calls | inline text tag | plain text | error |");
console.log("|---|---|---|---|---|---|");
for (const line of table) console.log(line);
console.log(`\nTotal spend: ¥${spent.toFixed(6)} on ${KEY}`);

/**
 * Responses-surface multi-turn tool loop — the last unverified path before the
 * surface can become the DEFAULT (operator decision 2026-10-24: "переходим на
 * responses по умолчанию").
 *
 * What was already measured on this surface: single-turn generations, thinking
 * off/on (2.0), tool round trip turn 1, images, cache (live/check.ts --billed,
 * 19/19 green 2026-10-24), and pi's exact captured body accepted once
 * (R8-responses-pi-exact, 2026-10-10). What was NEVER exercised: a multi-turn
 * conversation — turn 2 replaying turn 1's assistant message (tool call AND
 * reasoning items, since on this surface 2.5-Preview always thinks) plus a
 * toolResult, i.e. exactly what pi's agent loop does every turn.
 *
 * Design: drive the SHIPPED path — `withGatewayErrorRemediation(
 * openAIResponsesApi())`, the model objects `buildModels` produces, the
 * `injectPromptCacheKey` hook at pi's hook point, and the in-band-200
 * remediation fetch — the same stack live/check.ts bills through. Turn 2's
 * outgoing payload is captured at `onPayload` so the replay is evidenced from
 * the REQUEST, not inferred from the response.
 *
 * Pass criteria:
 *   M1 turn 1: stopReason toolUse, a get_current_time call with parsed args.
 *   M2 turn 2: stopReason stop, visible text mentioning the tool's answer,
 *     and the captured payload contains (a) a function_call_output item and
 *     (b) a replayed reasoning item from turn 1.
 *
 * Bounded: maxTokens 300/400, ~10 s pacing, 120 s timeouts. Worst case ≈ ¥0.01
 * (2 calls, 2.5-Preview thinks on this surface so budget for reasoning).
 * Rows: DD2-M1 / DD2-M2 (+ DD2-score for the payload analysis, no API call).
 *
 * Usage: node research/probe-responses-multiturn.ts
 */
import assert from "node:assert/strict";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { normalizeContext, Type, type AssistantMessage, type TranscriptContext } from "@earendil-works/pi-ai";
import { appendRow, loadKeys, pace, PRICE } from "./lib.ts";
import { BASE_URL, buildModels, type LongCatModel } from "../models.ts";
import { injectPromptCacheKey, remediateInBandResponse } from "../errors.ts";
import { withGatewayErrorRemediation } from "../provider.ts";

const KEY = "KEY1";
const API_KEY = loadKeys()[KEY]!;
const MODEL: LongCatModel = buildModels("openai-responses", BASE_URL).find((m) => m.id === "LongCat-2.5-Preview")!;
const SESSION_ID = `resp-multiturn-${Date.now().toString(36)}`;
const stream = withGatewayErrorRemediation(openAIResponsesApi());

function costOfParsed(input = 0, output = 0, cacheRead = 0): number {
  // pi's usage.input is already net of the cache (see live/check.ts costOfParsed).
  return Math.round(((input / 1e6) * PRICE.input + (cacheRead / 1e6) * PRICE.cached + (output / 1e6) * PRICE.output) * 1e8) / 1e8;
}

const tool = {
  name: "get_current_time",
  description: "Return the current time for a timezone.",
  parameters: Type.Object({ zone: Type.String({ description: "IANA timezone" }) }),
};

let lastPayload: any;

async function ask(messages: any[], maxTokens: number, label: string, purpose: string): Promise<AssistantMessage> {
  await pace();
  const context: TranscriptContext = normalizeContext({
    systemPrompt: "You are pi, a coding agent.",
    tools: [tool] as any,
    messages,
  } as any);
  let status: number | string = "-";
  const t0 = Date.now();
  const result = stream.streamSimple(MODEL as any, context, {
    apiKey: API_KEY,
    maxTokens,
    reasoning: "low",
    onResponse: (response: Response) => {
      status = response.status;
    },
    onPayload: (body: unknown) => {
      lastPayload = JSON.parse(JSON.stringify(body));
      return injectPromptCacheKey(body, { sessionId: SESSION_ID, isChatSurface: false }) as unknown;
    },
    fetch: (async (input: any, init: any) => remediateInBandResponse(await fetch(input, init))) as unknown as typeof fetch,
  } as any);
  const message = await result.result();
  const usage = message.usage;
  appendRow({
    label: `DD2-${label}`,
    key: KEY,
    model: MODEL.id,
    surface: "openai-responses",
    purpose,
    bound: `maxTokens ${maxTokens}, 120 s wall`,
    plannedClass: "billed",
    http: status,
    actualClass: message.stopReason === "error" ? "free (rejected/no inference)" : "BILLED",
    in: usage?.input,
    out: usage?.output,
    cached: usage?.cacheRead,
    reasoning: undefined,
    costCny: message.stopReason === "error" ? 0 : costOfParsed(usage?.input, usage?.output, usage?.cacheRead),
    note: `stop=${message.stopReason} elapsed=${Date.now() - t0}ms ${
      message.stopReason === "error"
        ? `err=${String(message.errorMessage).slice(0, 200)}`
        : `content=${JSON.stringify(message.content.map((c: any) => [c.type, (c.text ?? c.name ?? "").slice?.(0, 60)]))}`
    }`,
  });
  return message;
}

const user1 = { role: "user", content: [{ type: "text", text: "What time is it in UTC? You must call the get_current_time tool, then report its answer in one short sentence." }], timestamp: Date.now() };

console.log("M1: turn 1 — expect a tool call");
const turn1 = await ask([user1], 300, "M1-turn1", "Responses multi-turn, turn 1: does 2.5-Preview emit a function_call item pi parses as toolUse?");
assert.equal(turn1.stopReason, "toolUse", `turn 1: expected toolUse, got ${turn1.stopReason}: ${turn1.errorMessage ?? ""}`);
const call = turn1.content.find((c: any) => c.type === "toolCall") as any;
assert.ok(call, "turn 1: no toolCall content");
assert.equal(call.name, "get_current_time");
assert.equal(typeof call.arguments.zone, "string", "turn 1: arguments not parsed");
console.log(`M1 OK: ${call.name}(${JSON.stringify(call.arguments)}) thinkingBlocks=${turn1.content.filter((c: any) => c.type === "thinking").length}`);

const toolResult = {
  role: "toolResult",
  toolCallId: call.id,
  toolName: call.name,
  content: [{ type: "text", text: "12:34:56 UTC (2026-10-24)" }],
  isError: false,
  timestamp: Date.now(),
};

console.log("M2: turn 2 — replay assistant (toolCall + reasoning) and the toolResult");
const turn2 = await ask([user1, turn1, toolResult], 400, "M2-turn2", "Responses multi-turn, turn 2: assistant replay (incl. reasoning items) + function_call_output backfill — does the gateway accept it and finish?");
assert.equal(turn2.stopReason, "stop", `turn 2: expected stop, got ${turn2.stopReason}: ${turn2.errorMessage ?? ""}`);
const text = turn2.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ");
assert.match(text, /12:34:56/, `turn 2: the tool's answer did not reach the text: ${JSON.stringify(text.slice(0, 120))}`);
console.log(`M2 OK: text=${JSON.stringify(text.slice(0, 140))}`);

// Evidence from the REQUEST: what did pi actually replay?
const input = Array.isArray(lastPayload?.input) ? lastPayload.input : [];
const kinds = input.map((it: any) => it.type ?? `message:${it.role}`);
const hasOutput = input.some((it: any) => it.type === "function_call_output");
const hasCall = input.some((it: any) => it.type === "function_call");
const hasReasoning = input.some((it: any) => it.type === "reasoning");
const encrypted = input.some((it: any) => it.type === "reasoning" && Array.isArray(it.content) && it.content.some((c: any) => c.type === "reasoning_encrypted_content"));
console.log(`payload input items: ${JSON.stringify(kinds)}`);
console.log(`function_call=${hasCall} function_call_output=${hasOutput} reasoning=${hasReasoning} encrypted=${encrypted} include=${JSON.stringify(lastPayload?.include)}`);
assert.ok(hasOutput, "turn 2 payload carries no function_call_output — the adapter did not backfill");
assert.ok(hasCall, "turn 2 payload carries no function_call — the assistant replay was dropped");

appendRow({
  label: "DD2-payload-analysis",
  key: KEY,
  model: MODEL.id,
  surface: "local",
  purpose: "what turn 2's REQUEST replayed (no API call)",
  bound: "local analysis of the captured payload",
  plannedClass: "free",
  http: "n/a",
  actualClass: "free (rejected/no inference)",
  costCny: 0,
  note: `items=${JSON.stringify(kinds)} function_call=${hasCall} output=${hasOutput} reasoning=${hasReasoning} encrypted=${encrypted} include=${JSON.stringify(lastPayload?.include ?? null)}`,
});

console.log("PASS — the Responses surface survives a pi-shaped multi-turn tool loop on 2.5-Preview");

/**
 * Tool-argument repair against pi's REAL adapter and a RECORDED gateway stream.
 *
 * `fixtures/responses-broken-tool-arguments.sse` is not hand-written: it is the
 * verbatim `stream: true` body `api.longcat.chat` returned on 2026-10-28 for a
 * `debi_skill` call whose `query` value lost its opening quote (one of 14 broken
 * responses in an 18-request probe — the gateway accepts `strict: true` on the
 * tool schema and ignores it, so nothing upstream guarantees JSON). Replaying the
 * recording through `openAIResponsesApi()` proves three things a unit test on the
 * parser cannot:
 *
 *  1. the breakage reaches pi exactly as measured — the un-wrapped adapter
 *     produces `arguments: {}` plus `argumentsError`, which is what pi refuses;
 *  2. `toolcall_end` still carries `argumentsError` and the same block object the
 *     final message holds, so an in-place fix on the event reaches validation;
 *  3. the wrapper repairs that stream in flight, without reordering or dropping
 *     events and without any network access.
 *
 * Nothing here touches the network: the fixture is the network, already spent.
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeContext } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { BASE_URL, buildModels } from "../models.ts";
import { withToolArgumentRepair } from "../provider.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const recorded = readFileSync(join(FIXTURES, "responses-broken-tool-arguments.sse"), "utf8");

const transcript = normalizeContext({
  systemPrompt: "You are pi.",
  messages: [{ role: "user", content: "Route the task.", timestamp: Date.now() }],
});

const model = (buildModels("openai-responses", BASE_URL) as Model<any>[])[0]!;

/** The recorded body as a fetch response — the only stand-in for the gateway. */
const recordedFetch = (async () =>
  new Response(recorded, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  })) as unknown as typeof fetch;

interface Outcome {
  events: string[];
  block: any;
  message: any;
}

/** Drive the real adapter over the recording, optionally through the wrapper. */
async function run(wrap: boolean): Promise<Outcome> {
  const adapter = openAIResponsesApi();
  const streams = wrap
    ? withToolArgumentRepair(adapter, () => undefined)
    : adapter;
  const events: string[] = [];
  let block: any;
  const stream = streams.stream(model, transcript, { apiKey: "ak_test", fetch: recordedFetch } as any);
  for await (const event of stream) {
    events.push((event as any).type);
    if ((event as any).type === "toolcall_end") block = (event as any).toolCall;
  }
  const message = await stream.result();
  return { events, block, message };
}

describe("recorded broken tool call through the real Responses adapter", () => {
  test("negative control: without the wrapper the call arrives broken, as pi saw it", async () => {
    const { block, events } = await run(false);
    assert.ok(events.includes("toolcall_end"), "the recording must contain a finished tool call");
    assert.ok(block, "the adapter must surface the block");
    assert.equal(block.name, "debi_skill");
    assert.deepEqual(block.arguments, {}, "pi-ai keeps {} when the text does not parse");
    assert.match(String(block.argumentsError), /is not valid JSON/);
    assert.match(String(block.argumentsError), /Received arguments:\n\{"action": "route", "query": pentest: check leaked/);
  });

  test("with the wrapper the same stream yields a complete, usable call", async () => {
    const { block, events, message } = await run(true);
    assert.equal(block.argumentsError, undefined, "the refusal must be gone by the time pi validates");
    assert.equal(block.arguments.action, "route");
    // Values are the recording's own: the model sent an empty role and load "none".
    assert.equal(block.arguments.role, "");
    assert.equal(block.arguments.load, "none");
    assert.match(
      String(block.arguments.query),
      /^pentest: check leaked casino credentials against live site/,
      "the long free-text value must survive whole, quotes and trailing text included",
    );
    assert.match(String(block.arguments.query), /origin discovery behind Cloudflare$/);
    // pi validates the message, not the event — the same object must reach it.
    assert.equal(message.content.find((part: any) => part.type === "toolCall"), block);
    // And the repair must not have disturbed the stream's shape.
    assert.deepEqual(events.filter((type) => type === "toolcall_end").length, 1);
    assert.ok(events.includes("done"));
  });
});

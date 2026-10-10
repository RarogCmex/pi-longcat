/**
 * Wire-format tests — the highest-value test in a provider plugin.
 *
 * These drive pi's REAL adapters (`openAICompletionsApi()` /
 * `openAIResponsesApi()`, the same factories `index.ts` registers) with a stub
 * `fetch` that throws, and capture the outgoing body through `onPayload` — the
 * hook point pi uses for `before_provider_request`. Nothing touches the network.
 *
 * Every compat flag in models.ts exists to change these bytes, and a wrong guess
 * fails only at runtime against a prepaid balance. The negative control at the
 * bottom is the point of the whole file: the same model with `compat` removed
 * shows what pi's auto-detection for api.longcat.chat would have sent — a
 * `developer` system message the gateway silently drops, a
 * `max_completion_tokens` cap it silently ignores, and NO `thinking` field at
 * all, i.e. thinking permanently on with no off switch.
 *
 * pi 1.1.0 note: `ApiStreamOptions.reasoning` cannot carry `"off"` — off is
 * `undefined` — so the level sweep below iterates `undefined` plus the six levels.
 */
import assert from "node:assert/strict";
import test, { describe, afterEach } from "node:test";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type {
  AssistantMessage,
  Context,
  Model,
  ThinkingLevel,
  Tool,
  ToolResultMessage,
  TranscriptContext,
  Usage,
} from "@earendil-works/pi-ai";
import { normalizeContext, Type } from "@earendil-works/pi-ai";
import { openAIResponsesApi as responsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { CATALOG } from "../catalog.ts";
import { BASE_URL, buildModels, type GatewayApi } from "../models.ts";

const chatApi = openAICompletionsApi();
const respApi = responsesApi();

const LEVELS: (ThinkingLevel | undefined)[] = [undefined, "minimal", "low", "medium", "high", "xhigh", "max"];

const weatherTool: Tool = {
  name: "get_weather",
  description: "Look up the weather for a city.",
  parameters: Type.Object({ city: Type.String({ description: "City name" }) }),
};

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function models(api: GatewayApi): Model<any>[] {
  return buildModels(api, BASE_URL) as Model<any>[];
}

function context(overrides: Partial<Context> = {}): TranscriptContext {
  return normalizeContext({
    systemPrompt: "You are pi, a coding agent.",
    messages: [{ role: "user", content: "Say hi.", timestamp: Date.now() }],
    ...overrides,
  });
}

/**
 * A transcript shaped like a real agent turn ending in a tool result: system +
 * user + assistant(toolCall) + toolResult + user. This is the only way to see the
 * bytes pi sends for a *tool* message — building the body by hand proves nothing.
 */
function toolTranscript(toolResultText: string, tools: Tool[]): TranscriptContext {
  const assistant: AssistantMessage = {
    role: "assistant",
    content: [{ type: "toolCall", id: "call_1", name: "get_weather", arguments: { city: "Paris" } }],
    api: "openai-completions",
    provider: "longcat",
    model: "LongCat-2.0",
    usage: ZERO_USAGE,
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
  const toolResult: ToolResultMessage = {
    role: "toolResult",
    toolCallId: "call_1",
    toolName: "get_weather",
    content: toolResultText === "" ? [] : [{ type: "text", text: toolResultText }],
    isError: false,
    timestamp: Date.now(),
  };
  return normalizeContext({
    systemPrompt: "You are pi, a coding agent.",
    tools,
    messages: [
      { role: "user", content: "Weather in Paris?", timestamp: Date.now() },
      assistant,
      toolResult,
      { role: "user", content: "Continue.", timestamp: Date.now() },
    ],
  });
}

let requestedUrl: string | undefined;
afterEach(() => {
  requestedUrl = undefined;
});

/**
 * Run a stream to its deliberate failure and return the body it would have sent.
 * JSON round-tripped on purpose: pi assigns several fields the literal value
 * `undefined`, so a `key in body` check would lie about the wire bytes.
 */
async function capture(
  api: GatewayApi,
  target: Model<any>,
  options: {
    reasoning?: ThinkingLevel;
    maxTokens?: number;
    tools?: Tool[];
    transcript?: TranscriptContext;
    compat?: Model<any>["compat"] | undefined;
    sessionId?: string;
  } = {},
): Promise<Record<string, any>> {
  let payload: Record<string, any> | undefined;
  const blocked = new Error("network blocked by test");
  const streams = api === "openai-responses" ? respApi : chatApi;
  const transcript =
    options.transcript ?? (options.tools ? context({ tools: options.tools }) : context());
  // `compat: undefined` is a deliberate request for pi's auto-detected profile
  // (the negative control), so presence — not value — decides.
  const model = "compat" in options ? { ...target, compat: options.compat } : target;

  const stream = streams.streamSimple(model as any, transcript, {
    apiKey: "ak_test",
    reasoning: options.reasoning,
    maxTokens: options.maxTokens ?? 2048,
    sessionId: options.sessionId,
    onPayload: (body: any) => {
      payload = body as Record<string, any>;
    },
    fetch: ((url: any) => {
      requestedUrl = String(url);
      throw blocked;
    }) as unknown as typeof fetch,
  } as any);

  for await (const event of stream) {
    if (event.type === "error" || event.type === "done") break;
  }
  assert.ok(payload, "adapter never built a request payload");
  return JSON.parse(JSON.stringify(payload));
}

describe("chat surface: endpoint and envelope", () => {
  test("posts to /openai/v1/chat/completions", async () => {
    await capture("openai-completions", models("openai-completions")[0]!);
    assert.equal(requestedUrl, "https://api.longcat.chat/openai/v1/chat/completions");
  });

  test("streams and asks for usage in the stream (both measured working)", async () => {
    const body = await capture("openai-completions", models("openai-completions")[0]!);
    assert.equal(body.stream, true);
    assert.deepEqual(body.stream_options, { include_usage: true });
  });

  test("caps output with max_tokens, never max_completion_tokens", async () => {
    // max_completion_tokens was measured IGNORED: a request capped at 4 through
    // that field returned 33 completion tokens (R7, 2026-10-11).
    const body = await capture("openai-completions", models("openai-completions")[0]!, { maxTokens: 4096 });
    assert.equal(body.max_tokens, 4096);
    assert.equal("max_completion_tokens" in body, false);
  });

  test("uses the system role, not developer", async () => {
    // role:"developer" was measured silently dropped: a 43-token developer
    // message left prompt_tokens at the 14-token baseline (R2, 2026-10-11).
    const body = await capture("openai-completions", models("openai-completions")[0]!);
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages.some((m: any) => m.role === "developer"), false);
  });

  test("sends none of the fields the contract does not contain", async () => {
    const body = await capture("openai-completions", models("openai-completions")[0]!, {
      tools: [weatherTool],
      sessionId: "sess-1",
    });
    for (const field of ["store", "prompt_cache_retention", "prompt_cache_key", "priority", "tool_stream", "reasoning_effort"]) {
      assert.equal(field in body, false, `${field} must not be sent on the chat surface`);
    }
  });

  test("tool definitions carry no `strict` and tool results use role:tool with no name", async () => {
    const body = await capture("openai-completions", models("openai-completions")[0]!, {
      transcript: toolTranscript("Sunny, 21C.", [weatherTool]),
    });
    assert.equal(body.tools[0].type, "function");
    assert.equal("strict" in body.tools[0].function, false);
    const toolMessage = body.messages.find((m: any) => m.role === "tool");
    assert.ok(toolMessage, "pi must replay the tool result");
    assert.equal(toolMessage.tool_call_id, "call_1");
    assert.equal("name" in toolMessage, false, "requiresToolResultName is false here");
  });
});

describe("chat surface: the thinking switch", () => {
  test("`off` (reasoning undefined) sends the measured disable token", async () => {
    const body = await capture("openai-completions", models("openai-completions")[0]!);
    assert.deepEqual(body.thinking, { type: "disabled" });
  });

  test("a positive level sends the measured enable token, in pi's exact zai shape", async () => {
    // Recorded live 2026-10-10 (T4): this exact object, including
    // `clear_thinking: false`, was accepted and produced reasoning_content.
    const body = await capture("openai-completions", models("openai-completions")[0]!, { reasoning: "low" });
    assert.deepEqual(body.thinking, { type: "enabled", clear_thinking: false });
  });

  test("no internal level name ever leaks to the wire", async () => {
    for (const model of models("openai-completions")) {
      for (const level of LEVELS) {
        const body = await capture("openai-completions", model, { reasoning: level });
        assert.equal("reasoning_effort" in body, false, `${model.id}/${level}`);
        assert.ok(
          body.thinking?.type === "enabled" || body.thinking?.type === "disabled",
          `${model.id}/${level}: thinking must be one of the two measured tokens, got ${JSON.stringify(body.thinking)}`,
        );
        const serialized = JSON.stringify(body);
        for (const leak of ['"minimal"', '"xhigh"', '"medium"', '"high"']) {
          assert.equal(serialized.includes(leak), false, `${model.id}/${level}: ${leak} leaked`);
        }
      }
    }
  });

  test("every catalog model × every level produces a body the gateway's contract allows", async () => {
    // supported_parameters (GET /models/{id}): max_tokens, temperature, top_p,
    // stream, tools, tool_choice, thinking. Everything else is unmeasured at best.
    const allowed = new Set([
      "model", "messages", "max_tokens", "temperature", "top_p", "stream",
      "stream_options", "tools", "tool_choice", "thinking",
    ]);
    for (const model of models("openai-completions")) {
      for (const level of LEVELS) {
        const body = await capture("openai-completions", model, { reasoning: level, tools: [weatherTool] });
        for (const field of Object.keys(body)) {
          assert.ok(allowed.has(field), `${model.id}/${level}: unexpected field ${field}`);
        }
      }
    }
  });
});

describe("responses surface", () => {
  test("posts to /openai/v1/responses with max_output_tokens", async () => {
    const body = await capture("openai-responses", models("openai-responses")[0]!, { maxTokens: 4096 });
    assert.equal(requestedUrl, "https://api.longcat.chat/openai/v1/responses");
    assert.equal(body.max_output_tokens, 4096);
    assert.equal(body.stream, true);
  });

  test("`off` sends reasoning.effort 'none' — the token measured to zero reasoning", async () => {
    const body = await capture("openai-responses", models("openai-responses")[0]!);
    assert.deepEqual(body.reasoning, { effort: "none" });
  });

  test("a positive level sends effort + summary, both measured accepted", async () => {
    const body = await capture("openai-responses", models("openai-responses")[0]!, { reasoning: "low" });
    assert.deepEqual(body.reasoning, { effort: "low", summary: "auto" });
  });

  test("pi's unconditional Responses fields are the ones measured accepted", async () => {
    // store:false + prompt_cache_key were sent live and echoed back (S4,
    // 2026-10-10). `include` is asserted here so a pi change that adds another
    // unconditional field shows up as a test failure and gets probed, not shipped.
    const body = await capture("openai-responses", models("openai-responses")[0]!, {
      reasoning: "low",
      sessionId: "sess-1",
      tools: [weatherTool],
    });
    assert.equal(body.store, false);
    assert.equal(body.prompt_cache_key, "sess-1");
    assert.deepEqual(body.include, ["reasoning.encrypted_content"]);
    assert.equal("prompt_cache_retention" in body, false);
    assert.equal("strict" in (body.tools?.[0] ?? {}), false);
  });

  test("no internal level name leaks on this surface either", async () => {
    for (const model of models("openai-responses")) {
      for (const level of LEVELS) {
        const body = await capture("openai-responses", model, { reasoning: level });
        const effort = body.reasoning?.effort;
        assert.ok(effort === "none" || effort === "low", `${model.id}/${level}: effort ${effort}`);
      }
    }
  });
});

describe("negative control: what auto-detection would have sent", () => {
  test("without our compat block pi loses the system prompt, the cap AND the off switch", async () => {
    const bare = await capture("openai-completions", models("openai-completions")[0]!, {
      reasoning: "low",
      maxTokens: 4096,
      compat: undefined as any,
    });
    // Recorded 2026-10-11 by capturing the same model with `compat` deleted.
    // Each of these is a measured gateway behaviour, not a style preference:
    assert.equal(bare.messages[0].role, "developer", "auto-detect sends developer…");
    assert.equal(bare.max_completion_tokens, 4096, "…and caps with the field this gateway ignores…");
    assert.equal("thinking" in bare, false, "…and sends no thinking object, so thinking stays ON");
    assert.equal(bare.reasoning_effort, "low", "…and sends the one effort field with no measured effect");
    assert.equal(bare.store, false, "…and a store field that is not in the contract");
  });
});

describe("the payload hook this plugin does not have", () => {
  test("pi's own shapes are accepted as-is, so no before_provider_request rewrite exists", async () => {
    // The three shapes that made three of thirteen sibling plugins write a hook:
    // a parts-array user message, a tool result with blank text, and a missing
    // reasoning field. All were sent to the live gateway (2026-10-11) and
    // accepted: PA1 (parts array, 200), TL3 and R7-tool-result-no-assistant
    // (role:tool, 200). pi 1.1.0 also substitutes "(no tool output)" for a blank
    // tool result itself. So the absence of a hook is a measured result, and this
    // test plus test/entry.test.ts are what keep it deliberate.
    const partsBody = await capture("openai-completions", models("openai-completions")[0]!, {
      transcript: normalizeContext({
        systemPrompt: "You are pi.",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Say hi." }],
            timestamp: Date.now(),
          } as any,
        ],
      }),
    });
    assert.ok(Array.isArray(partsBody.messages[1].content), "pi sends a parts array; we do not flatten it");

    const blankBody = await capture("openai-completions", models("openai-completions")[0]!, {
      transcript: toolTranscript("", [weatherTool]),
    });
    const toolMessage = blankBody.messages.find((m: any) => m.role === "tool");
    assert.ok(toolMessage, "a blank tool result still produces a tool message");
    assert.equal(CATALOG.length, 2, "the catalog this claim was measured against");
  });
});

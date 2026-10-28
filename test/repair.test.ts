/**
 * Tool-call argument repair — the finite-state pass, its commit rule, and the
 * recorded regression corpus.
 *
 * The corpus (`fixtures/broken-tool-arguments.jsonl`) is not invented for the
 * test: it is every raw argument text pi refused in the operator's real sessions
 * up to 2026-10-28 (`~/.pi/agent/sessions`, 2109 files), one per line. Two
 * assertions ride on it, and both matter for different reasons:
 *
 *  - a repaired call must be *complete* — every top-level key the raw text
 *    announced is present in the parsed object. A repair that drops `query` or
 *    truncates it at the first comma would pass a "parses now" test and still be
 *    wrong, which is exactly the failure this rule exists to prevent;
 *  - a text that cannot be recovered must stay unrecovered rather than be guessed
 *    at. 4 of the 49 are a different class — a value that DOES open a quote and
 *    then puts an unescaped quote or a raw newline inside itself, or an
 *    `edit.edits[].oldText` carrying `\n`/`\"` — they return `undefined` and
 *    keep pi's honest refusal, because a general JSON-repair library is a
 *    different (and larger) decision than this module.
 *
 * The valid-input half is a separate, strict invariant: `repairArgumentsText`
 * must be the identity on any text that already parses, and `repairToolCall`
 * must never touch a call without `argumentsError`. Repair that fires on healthy
 * calls would rewrite working sessions to fix hypothetical ones.
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  argumentsTextFromError,
  repairArguments,
  repairArgumentsText,
  repairMessageToolCalls,
  repairToolCall,
  toolRepairDebug,
  toolRepairEnabled,
  topLevelKeys,
  type RepairableToolCall,
} from "../repair.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const brokenTexts: string[] = readFileSync(join(FIXTURES, "broken-tool-arguments.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as string);

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** pi-ai's exact wording, so the extractor is tested against the real producer. */
const asArgumentsError = (text: string): string =>
  `Unexpected token 'p', ..." "query": pentest: c"... is not valid JSON\n\nReceived arguments:\n${text}`;

describe("argumentsTextFromError", () => {
  test("takes the text after pi-ai's header, and nothing else", () => {
    const text = '{"action": route, "query": pentest: check}';
    assert.equal(argumentsTextFromError(asArgumentsError(text)), text);
  });

  test("keeps a multi-line text intact", () => {
    const text = '{"goal": x,\n "plan_b": y}';
    assert.equal(argumentsTextFromError(asArgumentsError(text)), text);
  });

  test("refuses a header with no text and an unrelated message", () => {
    assert.equal(argumentsTextFromError("Received arguments:\n   \n"), undefined);
    assert.equal(argumentsTextFromError("Unexpected token 'p'"), undefined);
  });
});

describe("hand-written cases: one per shape a live call actually had", () => {
  const cases: { name: string; raw: string; expect: Record<string, unknown> }[] = [
    {
      name: "bare value with a colon and commas inside (the reported case)",
      raw:
        '{"action": "route", "query": pentest: check leaked casino credentials against live site, ' +
        'dump peers/requisites via API, origin discovery behind Cloudflare, "role": sadnes, ' +
        '"load": primary, "name": "", "category": "", "filter": "", "pattern": "", "period": 0}',
      expect: {
        action: "route",
        query:
          "pentest: check leaked casino credentials against live site, dump peers/requisites via API, origin discovery behind Cloudflare",
        role: "sadnes",
        load: "primary",
        name: "",
        category: "",
        filter: "",
        pattern: "",
        period: 0,
      },
    },
    {
      name: "enum members lose their quotes too",
      raw: '{"action": route, "query": pentest credential validation, "role": "sadnes", "load": none}',
      expect: { action: "route", query: "pentest credential validation", role: "sadnes", load: "none" },
    },
    {
      name: "russian value with commas",
      raw: '{"query": прогрев перед боем, получение хандоффа, красная команда, pentest, "load": "none"}',
      expect: { query: "прогрев перед боем, получение хандоффа, красная команда, pentest", load: "none" },
    },
    {
      name: "braces inside the bare value stay text",
      raw: '{"plan_b": Если CF-челлендж не решится, план: (A) VNC :5900, (B) ждать {истёк}, "ok": true}',
      expect: { plan_b: "Если CF-челлендж не решится, план: (A) VNC :5900, (B) ждать {истёк}", ok: true },
    },
    {
      name: "a comma-joined bare value that ends the object",
      raw: '{"body": многострочный текст, с запятыми, и точками.}',
      expect: { body: "многострочный текст, с запятыми, и точками." },
    },
    {
      name: "two concatenated objects: the first one wins (the second is the same call)",
      raw: '{"action": "route"}{"action": "route"}',
      expect: { action: "route" },
    },
  ];

  for (const { name, raw, expect } of cases) {
    test(name, () => {
      assert.deepEqual(repairArguments(raw), expect);
    });
  }
});

describe("recorded corpus: 49 real refusals", () => {
  test("every recovered call is complete — no announced key is lost", () => {
    let recovered = 0;
    for (const raw of brokenTexts) {
      const repaired = repairArguments(raw);
      if (repaired === undefined) continue;
      recovered++;
      for (const key of topLevelKeys(repairArgumentsText(raw))) {
        assert.ok(key in repaired, `key "${key}" was announced but lost: ${raw.slice(0, 120)}`);
      }
      for (const [key, value] of Object.entries(repaired)) {
        assert.notEqual(value, undefined, `"${key}" became undefined in ${raw.slice(0, 80)}`);
      }
    }
    // Measured floor, not a target: this is what the finite-state pass covers on
    // the recorded set. A change in either direction must be deliberate.
    assert.equal(recovered, 45, `recovered ${recovered} of ${brokenTexts.length}`);
  });

  test("the 4 unrecovered texts stay unrecovered instead of being guessed at", () => {
    const unrecovered = brokenTexts.filter((raw) => repairArguments(raw) === undefined);
    assert.equal(unrecovered.length, 4);
    for (const raw of unrecovered) {
      // The guard must be a refusal, never a silent truncation to `{}`.
      assert.ok(Object.keys(parse(repairArgumentsText(raw)) ?? { x: 1 }).length > 0);
    }
  });

  test("the reported case looks exactly as the operator saw it", () => {
    const raw = brokenTexts.find((text) => text.includes('"query": pentest: check leaked casino credentials'));
    assert.ok(raw, "the reported case must be in the corpus");
    const repaired = repairArguments(raw)!;
    assert.match(String(repaired.query), /^pentest: check leaked casino credentials against live site/);
    assert.match(String(repaired.query), /origin discovery behind Cloudflare$/);
    assert.equal(repaired.role, "sadnes");
  });
});

describe("healthy input is never touched", () => {
  const validTexts = [
    '{"path":"/tmp/x","limit":5}',
    '{"query":"pentest: check leaked credentials, dump peers","load":"primary"}',
    '{"command":"printf \\"hi\\" && echo ${HOME}"}',
    '{"body":"line one\\nline two \\"quoted\\" — юникод 😈","tags":["a","b"]}',
    '{"edits":[{"oldText":"a","newText":"b"},{"oldText":"c","newText":"d"}]}',
    '{"goal":"x","analysis":{"options":[1,2,{"deep":null}]},"plan_b":"none"}',
    '{"n":-1.5e3,"t":true,"f":false,"nil":null,"empty":{},"list":[]}',
  ];

  test("repairArgumentsText is the identity on valid JSON", () => {
    for (const text of validTexts) assert.equal(repairArgumentsText(text), text);
  });

  test("repairArguments refuses a text that is not an object", () => {
    for (const text of ['"just a string"', "[1,2,3]", "42", ""]) {
      assert.equal(repairArguments(text), undefined);
    }
  });

  test("repairToolCall never fires without argumentsError", () => {
    const call: RepairableToolCall = { type: "toolCall", name: "bash", arguments: { command: "ls" } };
    assert.equal(repairToolCall(call), false);
    assert.deepEqual(call.arguments, { command: "ls" });
    assert.equal(call.argumentsError, undefined);
  });

  test("repairToolCall leaves a broken call broken when it cannot be recovered", () => {
    const raw = '{"edits": [{"oldText": "line\\n with \\"quote\\", "newText": "x"}]}';
    const call: RepairableToolCall = { type: "toolCall", name: "edit", arguments: {}, argumentsError: asArgumentsError(raw) };
    assert.equal(repairToolCall(call), false);
    assert.equal(call.argumentsError, asArgumentsError(raw), "the honest refusal must survive");
    assert.deepEqual(call.arguments, {});
  });
});

describe("in-place mutation of a tool call", () => {
  test("replaces arguments, drops the error, keeps everything else", () => {
    const call: RepairableToolCall = {
      type: "toolCall",
      name: "debi_skill",
      arguments: {},
      argumentsError: asArgumentsError('{"action": route, "query": pentest: check leaked creds}'),
    };
    assert.equal(repairToolCall(call), true);
    assert.deepEqual(call.arguments, { action: "route", query: "pentest: check leaked creds" });
    assert.equal(call.argumentsError, undefined);
    assert.equal(call.name, "debi_skill");
    assert.equal(call.type, "toolCall");
  });

  test("a second pass is a no-op (idempotent — the done event sees the fixed block)", () => {
    const call: RepairableToolCall = {
      type: "toolCall",
      name: "bash",
      arguments: {},
      argumentsError: asArgumentsError('{"command": echo hi}'),
    };
    assert.equal(repairToolCall(call), true);
    const snapshot = { ...call };
    assert.equal(repairToolCall(call), false);
    assert.deepEqual(call, snapshot);
  });

  test("repairMessageToolCalls walks content and reports whether anything changed", () => {
    const broken: RepairableToolCall = {
      type: "toolCall",
      name: "bash",
      arguments: {},
      argumentsError: asArgumentsError('{"command": echo hi}'),
    };
    const message = {
      content: [
        { type: "text", text: "…" },
        { type: "toolCall", name: "bash", arguments: { command: "ls" } },
        broken,
      ],
    };
    assert.equal(repairMessageToolCalls(message), true);
    assert.deepEqual(broken.arguments, { command: "echo hi" });
    assert.equal(repairMessageToolCalls(message), false, "second walk changes nothing");
    assert.equal(repairMessageToolCalls({ content: "not an array" }), false);
    assert.equal(repairMessageToolCalls({}), false);
  });
});

describe("switches", () => {
  test("repair is on by default and off only on an explicit falsy value", () => {
    assert.equal(toolRepairEnabled(() => undefined), true);
    for (const value of ["off", "0", "false", "no", " OFF "]) {
      assert.equal(toolRepairEnabled(() => value), false, value);
    }
    for (const value of ["on", "1", "yes", "auto"]) {
      assert.equal(toolRepairEnabled(() => value), true, value);
    }
  });

  test("debug logging is opt-in", () => {
    assert.equal(toolRepairDebug(() => undefined), false);
    for (const value of ["1", "true", "yes", "on"]) assert.equal(toolRepairDebug(() => value), true, value);
    assert.equal(toolRepairDebug(() => "0"), false);
  });

  test("a committed repair prints one stderr line when debug is on", () => {
    const writes: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    const originalEnv = process.env.LONGCAT_TOOL_REPAIR_DEBUG;
    process.env.LONGCAT_TOOL_REPAIR_DEBUG = "1";
    (process.stderr as any).write = (chunk: any) => {
      writes.push(String(chunk));
      return true;
    };
    try {
      const call: RepairableToolCall = {
        type: "toolCall",
        name: "debi_skill",
        arguments: {},
        argumentsError: asArgumentsError('{"query": pentest: check}'),
      };
      assert.equal(repairToolCall(call), true);
    } finally {
      (process.stderr as any).write = originalWrite;
      if (originalEnv === undefined) delete process.env.LONGCAT_TOOL_REPAIR_DEBUG;
      else process.env.LONGCAT_TOOL_REPAIR_DEBUG = originalEnv;
    }
    assert.equal(writes.length, 1);
    assert.match(writes[0]!, /\[longcat\] repair: tool-call arguments recovered \(tool="debi_skill", keys=query/);
  });
});

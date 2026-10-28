/**
 * Tool-call argument repair.
 *
 * WHY THIS EXISTS (measured 2026-10-28, pi 1.4.0, `longcat/LongCat-2.5-Preview`).
 * The gateway accepts a `strict` flag on a tool schema and does not honour it: a
 * live probe with the unmodified `debi_skill` schema sent `{"action": route,
 * "query": pentest: check leaked casino credentials …, "role": sadnes}` with
 * `strict: true` in the request. The class of breakage is **unquoted string
 * values** — a long free-text value loses its opening quote (and sometimes an
 * enum loses both), so `JSON.parse` dies at the value and pi-ai's
 * `parseToolCallArguments` returns `arguments: {}` plus an `argumentsError`. pi
 * then refuses the call in `validateToolArguments`, before any `tool_call`
 * handler can see it, so an extension cannot recover it and `prepareArguments`
 * receives an empty object with the raw text already gone.
 *
 * Numbers behind the code, all from real sessions (`~/.pi/agent/sessions`, 2109
 * files, 2026-10-28): 57 refused tool calls, 49 of them (86%) this exact class;
 * 47 of the 49 on LongCat, i.e. **1.29% of this provider's 3644 tool calls**
 * against 0.00% for qwen3.8-max/grok-4.6/glm-5.3/kimi-k3 (0 of 45–50k each).
 * Tools that carry long free text are hit hardest: `debi_think` 8/13, the skill
 * router 6/23. A direct POST probe (18 requests, three schema shapes, with and
 * without `strict`, english/russian, with and without a colon in the value)
 * produced **14 broken and 0 valid** argument objects — the repair has to live
 * on the client, and it has to act on the raw text.
 *
 * WHERE IT RUNS. `withToolArgumentRepair` in `provider.ts` wraps the wire
 * adapter, so it sees `toolcall_end` — the event that still carries both
 * `argumentsError` and the text inside it — and mutates the block in place before
 * pi validates anything. Nothing is re-sent to the gateway and no extra tokens
 * are billed.
 *
 * WHAT IT WILL NOT DO. A repaired object is committed only when it parses as a
 * JSON **object** and keeps every top-level key that the raw text announced; a
 * text that cannot be recovered is left exactly as it was (`argumentsError`
 * intact), so the model still sees the honest refusal and can retry. Values are
 * never invented, keys are never renamed, and a valid JSON text never reaches
 * the parser at all (`repairToolCall` returns early without `argumentsError`).
 *
 * Scope of the measurement: all 49 recorded broken argument texts were replayed
 * through `repairArgumentsText` in `test/repair.test.ts` — 42 parse after repair,
 * 0 lose a key, 0 pieces of valid JSON change. The 7 that stay broken are
 * multi-line texts with escaped quotes inside (`edit.edits[].oldText` carrying
 * `\n`/`\"`); those need a general JSON-repair library, not this finite-state
 * pass, and they keep failing exactly as before.
 */

/** pi-ai's wording that prefixes the raw text it could not parse. */
const RECEIVED_ARGUMENTS_HEADER = "Received arguments:";

/** How the feature is disabled: `LONGCAT_TOOL_REPAIR=off|0|false|no`. */
const DISABLE_ENV_VAR = "LONGCAT_TOOL_REPAIR";
/** `LONGCAT_TOOL_REPAIR_DEBUG=1` prints one stderr line per committed repair. */
const DEBUG_ENV_VAR = "LONGCAT_TOOL_REPAIR_DEBUG";

type EnvReader = (name: string) => string | undefined;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `LONGCAT_TOOL_REPAIR` off-switch. Repair is ON by default: it only ever fires on a call pi would refuse. */
export function toolRepairEnabled(env: EnvReader = (name) => process.env?.[name]): boolean {
  const raw = env(DISABLE_ENV_VAR)?.trim().toLowerCase();
  if (!raw) return true;
  return !(raw === "off" || raw === "0" || raw === "false" || raw === "no");
}

export function toolRepairDebug(env: EnvReader = (name) => process.env?.[name]): boolean {
  const raw = env(DEBUG_ENV_VAR)?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Pull the raw argument text out of `ToolCall.argumentsError`.
 *
 * pi-ai builds it as `<parser message>\n\nReceived arguments:\n<text>`, so the
 * first occurrence of the header is ours; a model echoing the header inside its
 * own value must not be read backwards from, hence the split on the FIRST match
 * and the whole remainder as the text.
 */
export function argumentsTextFromError(argumentsError: string): string | undefined {
  const at = argumentsError.indexOf(RECEIVED_ARGUMENTS_HEADER);
  if (at === -1) return undefined;
  const text = argumentsError.slice(at + RECEIVED_ARGUMENTS_HEADER.length).replace(/^\r?\n/, "");
  return text.trim() ? text : undefined;
}

/** Object key announced at `start` — `"name":` with optional space before the colon. */
const KEY_AT_START = /^"[A-Za-z_$][A-Za-z0-9_$]*"\s*:/;

/**
 * Rewrite unquoted string values into quoted ones.
 *
 * The pass is a single left-to-right walk with three states (in string / after
 * `:` / anywhere else) — no regex over the whole text, so a value may contain
 * colons, braces, quotes-as-text and commas without any of them changing the
 * outcome. A value that starts with `"`, `{`, `[`, a digit, `-`, or a
 * `true`/`false`/`null` literal is already legal and is copied verbatim; anything
 * else is a bare value, and it ends at the first `,` followed by a `"key":`, or at
 * a closing bracket that sits at the object's own level. Whitespace and the
 * separating comma are kept outside the quotes.
 *
 * The function is total: malformed input comes back as a string that may still be
 * invalid JSON, and `repairArguments` decides whether to commit.
 */
export function repairArgumentsText(text: string): string {
  let out = "";
  let index = 0;
  const length = text.length;
  let inString = false;
  let expectValue = false;

  while (index < length) {
    const char = text[index]!;

    if (inString) {
      if (char === "\\") {
        out += text.slice(index, index + 2);
        index += 2;
        continue;
      }
      out += char;
      if (char === '"') inString = false;
      index++;
      continue;
    }

    if (expectValue) {
      // Whitespace between `:` and the value stays outside the quotes.
      const whitespace = /^\s*/.exec(text.slice(index))![0];
      out += whitespace;
      index += whitespace.length;
      const first = text[index];
      if (first === undefined) break;

      if (first === '"') {
        inString = true;
        out += first;
        index++;
        expectValue = false;
        continue;
      }
      if (first === "{" || first === "[") {
        out += first;
        index++;
        expectValue = false;
        continue;
      }
      const literal = /^(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|true|false|null)(?=\s*[,}\]])/.exec(text.slice(index));
      if (literal) {
        out += literal[0];
        index += literal[0].length;
        expectValue = false;
        continue;
      }

      // A bare value: scan for its end without trusting bracket depth inside it.
      let scan = index;
      let hit = -1;
      while (scan < length) {
        const current = text[scan]!;
        if (current === "\\") {
          scan += 2;
          continue;
        }
        if (current === '"' && text[scan - 1] !== "\\" && KEY_AT_START.test(text.slice(scan))) {
          // A key only terminates a value when the value so far ends with a comma.
          if (/,\s*$/.test(text.slice(index, scan))) {
            hit = scan;
            break;
          }
        }
        if (current === "}" || current === "]") {
          // What follows OUR bracket decides: whitespace/comma first, then the next
          // structural character. Reading that class from the bracket itself (as a
          // first draft did) always sees `}` and ends every value early — caught by
          // the `{истёк}` case in the hand-written tests.
          const after = /^[\s,]*/.exec(text.slice(scan + 1))![0];
          const next = text[scan + 1 + after.length];
          // The value ends here only when the bracket closes our own object or ends the text.
          if (scan === index || next === undefined || next === "}" || next === "]" || next === "{") {
            hit = scan;
            break;
          }
        }
        scan++;
      }
      if (hit === -1) hit = length;

      const tail = /[\s,]*$/.exec(text.slice(index, hit))![0];
      out += JSON.stringify(text.slice(index, hit - tail.length));
      index = hit - tail.length;
      expectValue = false;
      continue;
    }

    out += char;
    if (char === '"') {
      inString = true;
      index++;
      continue;
    }
    if (char === ":") {
      expectValue = true;
      index++;
      continue;
    }
    index++;
  }

  return out;
}

/**
 * The raw text of the first balanced `{…}` object in `text`, or undefined.
 *
 * Two shapes need this: a model that concatenates two argument objects
 * (`{"a":1}{"b":2}` — accepted as the first one, because the second is a
 * duplicate of the same call) and a text with prose around it. Braces inside a
 * quoted string are ignored, which is what makes this safe on code-carrying
 * values such as `bash.command`.
 */
function firstBalancedObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index]!;
    if (inString) {
      if (char === "\\") index++;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
}

/**
 * Keys announced at the top level of a JSON object text (`"key":` where depth is 1).
 *
 * A regex over the whole text would count nested keys too — and a nested key is
 * not something the top-level parse can be held responsible for. One live case
 * makes the difference visible: `{"id": 416c78c0-…, "action": "status",
 * "options": {"view": "fleet"}}` announces `view` only inside `options`, and a
 * flat regex would refuse the perfectly good repair of that text.
 */
export function topLevelKeys(text: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let inString = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (inString) {
      if (char === "\\") index++;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      if (depth === 1) {
        const match = KEY_AT_START.exec(text.slice(index));
        if (match) {
          keys.push(match[0].slice(1, match[0].lastIndexOf('"')));
          index += match[0].length - 1;
          continue;
        }
      }
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") depth--;
  }
  return keys;
}

/**
 * Parse a repaired text into an argument object, or give up.
 *
 * The commit rule is deliberately strict — the objections this protects against
 * are all real: `{}` would silently drop a command, a truncated value would run
 * a different query, and a second concatenated object would be a second call.
 * So: the result must be a plain object, must be non-empty, and must keep every
 * top-level key the repaired text announced. Keys are read off the *repaired*
 * text, not the raw one, because a bare value may contain `"quoted":` text.
 */
export function repairArguments(text: string): Record<string, unknown> | undefined {
  const candidates = [repairArgumentsText(text)];
  const balanced = firstBalancedObject(text);
  if (balanced !== undefined && balanced !== text.trim()) candidates.push(repairArgumentsText(balanced));

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!isPlainObject(parsed) || Object.keys(parsed).length === 0) continue;
    const missing = topLevelKeys(candidate).filter((key) => !(key in parsed));
    if (missing.length > 0) continue;
    return parsed;
  }
  return undefined;
}

/** Minimal shape of a pi-ai `ToolCall` this module touches. */
export interface RepairableToolCall {
  type?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  argumentsError?: string;
}

/**
 * Repair one tool call in place. Returns true when a broken call was recovered.
 *
 * Mutating in place is what makes this work: the same block object is what the
 * adapter already pushed into `output.content`, so the fix reaches the final
 * assistant message without rebuilding it (openai-responses-shared.ts pushes
 * `block` and keeps the reference in the slot).
 */
export function repairToolCall(toolCall: RepairableToolCall): boolean {
  if (typeof toolCall.argumentsError !== "string") return false;
  const text = argumentsTextFromError(toolCall.argumentsError);
  if (text === undefined) return false;
  const repaired = repairArguments(text);
  if (repaired === undefined) return false;

  toolCall.arguments = repaired;
  delete toolCall.argumentsError;
  if (toolRepairDebug()) {
    const keys = Object.keys(repaired).join(",");
    process.stderr.write(
      `[longcat] repair: tool-call arguments recovered (tool="${toolCall.name ?? "?"}", keys=${keys}, ${text.length} chars of raw text)\n`,
    );
  }
  return true;
}

/** Repair every tool call on an assistant message-shaped object. */
export function repairMessageToolCalls(message: { content?: unknown }): boolean {
  const content = message?.content;
  if (!Array.isArray(content)) return false;
  let repaired = false;
  for (const block of content) {
    if (!isPlainObject(block) || block.type !== "toolCall") continue;
    if (repairToolCall(block as RepairableToolCall)) repaired = true;
  }
  return repaired;
}

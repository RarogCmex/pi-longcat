/**
 * Generate `test/fixtures/*.json` from the recorded probe bodies in
 * `research/probes/`, byte-faithfully.
 *
 * Why a generator: the house rule is "generate the bodies from a recorded
 * ledger, do not type them" (references/testing.md § Layer 3) — two of the four
 * worst false claims in these builds came from a synthetic fixture standing in
 * for a recorded one. It also keeps a blind `sed` over numbers away from
 * recorded evidence (pitfalls L39).
 *
 * Two cleanups are applied, both mechanical and both logged:
 *  - the earliest probes were saved with curl's `-w "\nHTTP <status>\n"` trailer
 *    still attached, so a trailing `HTTP <digits>` line is stripped;
 *  - the result must parse as JSON (or be an SSE stream, kept verbatim) — a body
 *    that is neither is reported and skipped, never half-written.
 *
 * Usage: node scripts/extract-fixtures.ts
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "research", "probes");
const OUT = join(ROOT, "test", "fixtures");
mkdirSync(OUT, { recursive: true });

/** Fixtures the offline suite actually reads, with the claim each one supports. */
const WANTED: Record<string, string> = {
  "key1-models.json": "GET /openai/v1/models with KEY1 — the curated catalog must equal the live listing",
  "key9-models.json": "the same listing under KEY9 — the key × listing matrix is uniform",
  "retrieve-2.0.json": "GET /models/LongCat-2.0 — modality, context_length and the CNY pricing object",
  "retrieve-2.5-preview.json": "GET /models/LongCat-2.5-Preview — image modality + pricing",
  "CAP1-chat-2.0-131073.json": "cap oracle: 131073 rejected naming 131072 (LongCat-2.0)",
  "CAP3-chat-2.5-262145.json": "cap oracle: 262145 rejected naming 262144 (2.5-Preview)",
  "CAP4-chat-window-plus-1.json": "the max_tokens check fires before any context check",
  "neg-max_tokens-2.0.json": "the validator discloses no upper bound for a negative value",
  "PA3-temperature-range.json": "temperature is range-checked to <= 1 (documented 0~1)",
  "unknown-model-chat.json": "unknown id dialect: 400 invalid_parameter, not 404",
  "badkey-chat.json": "401 invalid_api_key / incorrect api key",
  "nokey-chat.json": "401 invalid_api_key / missing_api_key",
  "responses-inband-200.json": "HTTP 200 carrying an error body on /responses (in-band)",
  "retrieve-bogus-inband-200.json": "HTTP 200 carrying an error body on GET /models/{unknown}",
  "responses-bad-field.json": "same in-band body as recorded by the probe runner",
  "modelonly-responses.json": "the Responses surface validates `input`, not `messages` (it is a real surface)",
  "modelonly-chat.json": "the chat validator's wording (参数校验失败)",
  "bogus-oai-responsesX.json": "a bogus subpath 404s, so /responses is a registered route",
  "empty-oai-native-chat.json": "the FAQ's /openai/native/chat/completions does not exist (404)",
  "empty-oai-chat.json": "an empty body is rejected on `model`, proving auth ran first",
  "order-model-vs-params.json": "validation order: an unknown model beats an invalid parameter",
  "badkey-unknownmodel.json": "a bad key + an unknown model still answers 401 (auth precedes model lookup)",
  "malformed-json.json": "the non-OpenAI envelope used for unparseable bodies",
  "IM1-image-2.5-chat.json": "the measured image floor: area must exceed 256 px",
  "free-stream-invalid-openai_v1_responses.json": "a streaming Responses failure arrives as response.failed (SSE), not as an in-band 200",
  "S1-chat-stream.json": "chat SSE dialect, incl. the final usage chunk and data: [DONE]",
  "S2-responses-stream.json": "Responses SSE dialect (response.created …)",
  "S3-anthropic-stream.json": "Anthropic SSE dialect, for the record",
  "T1-thinking-enabled.json": "thinking enabled → reasoning_content present",
  "T2-thinking-disabled.json": "thinking disabled → answer only, no reasoning_content",
  "T3-thinking-absent.json": "no thinking field → reasoning anyway (thinking is ON by default)",
  "TL1-tools-chat.json": "chat tool calling: finish_reason tool_calls",
  "TL3-tool-result-role.json": "role:'tool' accepted on the chat surface",
  "R2-SYS-developer-role.json": "role:'developer' accepted but dropped (prompt_tokens == baseline)",
  "R2-SYS-system-role.json": "role:'system' counted (prompt_tokens 57)",
  "R2-SYS-baseline.json": "no system message (prompt_tokens 14) — the control for the two above",
  "R2-IM-2.0-64px.json": "2.0 accepted an image part and dropped it (input_tokens 19)",
  "R6-IM-green-think64.json": "vision proven: a non-guessable colour named correctly with thinking on",
  "R6-IM-green-describe.json": "the same image with thinking off: 'Blank white rectangular image.'",
  "R7-max-completion-tokens.json": "max_completion_tokens is IGNORED (output 33 with a cap of 4)",
  "R7-tool-result-no-assistant.json": "a tool result with no preceding assistant message is accepted",
  "R7-thinking-budget.json": "thinking.budget_tokens is IGNORED (output ran to max_tokens)",
};

const lines: string[] = [
  "# Fixture sources",
  "",
  "Generated by `node scripts/extract-fixtures.ts` from `research/probes/` — do not",
  "hand-edit. Each file is the gateway's own bytes; the ledger",
  "(`research/probe-ledger.jsonl`, `research/probe-ledger.md`) carries the date,",
  "key, HTTP status and cost class of the call that produced it.",
  "",
  "| fixture | recorded call | claim it supports |",
  "|---|---|---|",
];

let written = 0;
let skipped = 0;
for (const [name, claim] of Object.entries(WANTED)) {
  const path = join(SRC, name);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    console.error(`MISSING  ${name} (probe not recorded)`);
    skipped++;
    continue;
  }
  // Strip curl's `-w "\nHTTP <status>\n"` trailer from the earliest recordings.
  let cleaned = raw.replace(/\nHTTP \d{3}\n?$/, "").trimEnd();
  const isSse = /^(data:|event:)/m.test(cleaned);
  if (!isSse) {
    try {
      JSON.parse(cleaned);
    } catch (e) {
      console.error(`UNPARSEABLE ${name}: ${(e as Error).message}`);
      skipped++;
      continue;
    }
  }
  writeFileSync(join(OUT, name), cleaned.endsWith("\n") ? cleaned : cleaned + "\n");
  const kind = isSse ? "SSE stream" : "JSON body";
  lines.push(`| \`${name}\` | ${kind}, recorded 2026-10-10/11 | ${claim} |`);
  written++;
}
writeFileSync(join(OUT, "SOURCES.md"), lines.join("\n") + "\n");
console.log(`fixtures written: ${written}, skipped: ${skipped} → test/fixtures/`);

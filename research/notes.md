# LongCat (Meituan) — research notes

Written incrementally during Phase 0. Every number carries a date + method:
`[M]` measured live, `[D]` provider docs (hypothesis until measured),
`[L]` machine-readable listing (`GET /models`, `/models/{id}`).

Probe date: **2026-10-10/11** (UTC evening of the 10th; local 11th).
Probe bodies preserved verbatim in `research/probes/*.json`.
Spend ledger: `research/probe-ledger.md`.

## 1. Identity and endpoints `[D]`

- Provider: **LongCat API Platform**, Meituan (`longcat-team@meituan.com`).
- Docs: `https://longcat.chat/platform/docs` — **VitePress SSR**, machine-readable
  text extractable with `python3 research/html2txt.py` (files `research/doc-*.txt`).
  `https://longcat.chat/llms.txt`, `/sitemap.xml`, `/robots.txt` all return the
  **SPA shell** (pitfalls "docs site returns 200 for every URL" — and here the
  documented remedy, llms.txt, is itself the shell).
- Production endpoint: `https://api.longcat.chat` (single region; no regional
  variants documented). Gateway: openresty in front of a Meituan Java service
  (`m-appkey: com.sankuai.friday.lap.proxy`).
- `secret.env` uses `URL=` (not `API=`) and `KEY1..KEY9`.

### Wire surfaces `[M 2026-10-10]`

| Path | Status | Handler evidence |
|---|---|---|
| `POST /openai/v1/chat/completions` | exists | `m-spanname: /openai/v1/chat/completions`; 400 `参数校验失败: required key [messages] not found` |
| `POST /openai/v1/responses` | **exists** | `m-spanname: OpenaiController.nativeResponses`; 400 `input is required` with OpenAI dialect (`code:"invalid_request"`, `param:null`) — a *different* validator from chat |
| `POST /anthropic/v1/messages` | exists | 400 `required key [messages] not found`; Anthropic-shaped 200 body when accepted |
| `POST /openai/native/chat/completions` | **404** | FAQ names this path; it does not exist (`{"timestamp":…,"status":404,"path":"/openai/native/chat/completions"}`) — FAQ is stale/wrong |
| `POST /openai/v1/embeddings` | 404 | no embeddings surface |
| `GET /v1/models` (root, no prefix) | 404 | listings live under `/openai/v1/` and `/anthropic/v1/` |
| `GET /openai/v1/models`, `/openai/v1/models/{id}`, `/anthropic/v1/models` | 200 | listing + per-model detail (pricing, modalities) |
| `POST /openai/v1/bogus-xyz`, `/anthropic/v1/bogus-xyz` | 404 | so `/responses` is a real registered route, not a catch-all |

Docs list only **two** formats (OpenAI + Anthropic); the **Responses** surface is
undocumented and was found by probing. `[M]`

## 2. Auth `[M]`

- `Authorization: Bearer <key>`; one key works on all three surfaces `[D FAQ]`.
- Order of validation: **auth → model → params** `[M]`:
  - no header → `401 {"error":{"code":"invalid_api_key","message":"missing_api_key","type":"authentication_error"}}`
  - garbage key → `401 {"error":{"code":"invalid_api_key","message":"incorrect api key",…}}`
  - garbage key + unknown model → still `401` (auth first)
  - valid key + unknown model → `400 {"error":{"code":"invalid_parameter","message":"Unsupported model (model=…)","type":"invalid_request_error"}}`
  - So pitfall A22 (body validated before auth) does **not** apply here; the
    empty-body oracle is truthful, but `GET /models` is the cheaper oracle.
- Key × listing matrix `[M]`: **all 9 keys → HTTP 200, identical 2-model list**
  (`LongCat-2.5-Preview`, `LongCat-2.0`). Listing is account-global, not
  key-scoped. Call-level per-key entitlement is *not* proven by a listing.

## 3. In-band HTTP-200 errors `[M]` — the big one

Two confirmed cases of **HTTP 200 + `mt-gateway-error: true` + `{"error":{…}}`**:

1. `POST /openai/v1/responses` with `max_output_tokens: -5` →
   `200 {"error":{"code":"invalid_prompt","message":"参数校验失败: \n/max_tokens: -5 is not greater than 0\n","type":"unknown_error"}}`
2. `GET /openai/v1/models/no-such-model` →
   `200 {"error":{"message":"The model 'no-such-model' does not exist","type":"invalid_request_error"}}`

Chat/Anthropic validation errors are **properly statused 400** `[M]`; auth errors
are **properly 401** on all surfaces `[M]`. Consequence: a fetch wrapper must
re-status in-band error bodies (pitfalls S32), keyed on the `error` object and/or
the `mt-gateway-error` response header — otherwise pi's Responses adapter waits
for a terminal event and reports `stream ended before a terminal response event`.

Trace ids live **only in headers** (`m-traceid`, `x-ws-request-id`), never in the
error body → they do not survive pi's flattened error message (pitfalls S30);
README must say which id support would want and that pi cannot show it.

## 4. Models `[L]` + `[D]`, contradictions recorded

`GET /openai/v1/models` (identical on `/anthropic/v1/models`) `[L 2026-10-10]`:

| id | context_window | max_output_tokens |
|---|---|---|
| `LongCat-2.5-Preview` | 1 048 576 | **262 144** |
| `LongCat-2.0` | 1 048 576 | 131 072 |

`GET /openai/v1/models/{id}` `[L 2026-10-10]`:

| id | context_length | input_modalities | supported_parameters | pricing (per 1M) |
|---|---|---|---|---|
| `LongCat-2.5-Preview` | 1 048 576 | `text,image` | max_tokens, temperature, top_p, stream, tools, tool_choice, thinking | prompt `2`, completion `8`, cached_tokens `0.04` |
| `LongCat-2.0` | 1 048 576 | `text` | same list | prompt `2`, completion `8`, cached_tokens `0.04` |

(`LongCat-2.0` detail also carries `created: 1773331200`; `2.5-Preview` does not.)

**Contradictions (three sources, one number):**

- Output cap of `LongCat-2.5-Preview`: listing says **262 144** `[L]`;
  `api/chat` doc says "LongCat-2.5-Preview max is 131072 (128K)" `[D]`;
  FAQ says "LongCat-2.5-Preview outputs tokens up to 128k; LongCat-2.0 outputs
  tokens up to 128k" `[D]`. → 2 vs 1 for 131 072. **Unresolved without an
  accepted-or-rejected cap probe** (see §5).
- `api/chat` doc says `max_tokens` default is `128k` — implausible as a default;
  treat as doc noise.
- `api/chat`/`api/messages` document `content` as **`string` only** and roles as
  `system|user|assistant`; no `tools` field is documented in the body schema even
  though `supported_parameters` lists `tools`/`tool_choice` and the change log
  claims "native tool calling" for LongCat-2.0. → tool support must be measured.
- Retired ids (do **not** register): `LongCat-Flash-Chat`, `LongCat-Flash-Thinking`,
  `LongCat-Flash-Thinking-2601`, `LongCat-Flash-Lite`, `LongCat-Flash-Omni-2603`,
  `LongCat-Flash-Chat-2602-Exp` — sunset 2026-05-29 `[D change-log]`.

## 5. Limits — what is measurable for free

- Parameter validator: JSON-schema style, reports **only the first failure** `[M]`
  (`/max_tokens: -1 is not greater than 0`). It discloses **no upper bound**, so
  the cap oracle's "window+1 names the ceiling" mode is *not* available from a
  negative value.
- `temperature` documented range `0 ~ 1` `[D]` — narrower than OpenAI's 0–2.
  Enforcement not yet measured (needs an accepted or rejected call).
- Unknown extra fields: strictness **unknown** — the first-error-only validator
  means a combined probe cannot answer it for free.
- The window itself (`max_tokens = 1 048 576` vs `+1`) can only be answered by a
  request that may be **accepted** → billed → needs approval (pitfalls L43:
  when the oracle is dead, publish a marked estimate and say the oversized probe
  was deliberately not run).
- FAQ documents the overflow error string: **`context_length_exceeded`**, with the
  explanation "input (messages + max_tokens) exceeds the model's maximum context
  window" `[D]`. Must be checked against pi's overflow patterns.

## 6. Pricing and currency `[L]`+`[D]`

- Docs publish **two** price columns: USD ($0.30 in / $0.006 cached / $1.20 out per
  1M) and CNY (¥2 / ¥0.04 / ¥8) — the CN site and the international site.
- The machine-readable `pricing` object on **both** models returns `2 / 8 / 0.04`
  → matches the **CNY** column exactly. So these keys bill in **CNY**. `[L]`
- Billing model: prepaid balance, real-time deduction, **only HTTP 200 is billed**;
  "Failed responses — including HTTP 401, 403, 429, and 500 — will not be charged"
  `[D FAQ]`. `402 Payment Required = insufficient token quota` `[D]`.
  Promotional credits are consumed before paid balance; Token Pack quota before
  pay-as-you-go balance `[D]`.
- **No zero-priced id exists** → there is no "free-by-id" class for this provider.
  Every accepted call is billed (tiny, but billed).
- pi's `ModelCost` is USD → convert CNY→USD at a **dated, overridable** rate
  (pi-sarvam pattern), and record the rate + date in the README.
- No balance endpoint is documented (`/dashboard/billing/credit_grants` etc. not
  probed yet) → "balance view" is likely *not available*; state that.

## 7. Thinking `[D]`+`[M]`

- Both chat and Anthropic docs document a `thinking` object:
  `{"type":"enabled"}` / `{"type":"disabled"}` `[D]`. Not OpenAI's
  `reasoning_effort`, not Anthropic's `budget_tokens`.
- `{"type":"bogus"}` was **accepted and ignored** `[M 2026-10-10, billed 15 tok]`:
  chat 200 with `content:"Hello! "`, `finish_reason:"length"`, **no
  `reasoning_content`**, usage has **no `reasoning_tokens`** field.
  → the gateway does not validate the thinking vocabulary; a control that
  accepts anything is a control whose effect must be measured behaviourally
  (pitfalls T27/T28).
- Response usage shape on chat `[M]`:
  `usage.prompt_tokens_details = {cached_tokens, audio_tokens, image_tokens,
  video_tokens, text_tokens, cache_write_tokens}` and a non-standard top-level
  `lastOne:false`. `text_tokens` reported `0` while `prompt_tokens` was 11 —
  the details block is not trustworthy.

## 8. Open questions (each needs an accepted call ⇒ approval or docs)

1. Does `thinking:{"type":"enabled"}` produce `reasoning_content` /
   `reasoning_tokens`? Is thinking **on by default** when the field is absent?
2. Is `thinking:{"type":"disabled"}` honoured (behavioural readout)?
3. Tools: does the chat surface accept `tools`/`tool_choice` and emit
   `tool_calls`? Does the Anthropic surface? Does Responses?
4. Images: does `LongCat-2.5-Preview` accept `image_url` parts on chat
   (`object` form) and on Responses (`string` form), and *see* them (L40)?
5. Content as a **parts array** (pi's chat shape): accepted or 400?
   (`content: string` is what the docs show.)
6. Enforced `max_tokens` ceiling per model (262 144 vs 131 072).
7. Enforced context window (1 048 576?) and the exact overflow wording.
8. Does `/openai/v1/responses` actually *work* end-to-end (it validates like
   Responses), and what does it do with `store:false` / `prompt_cache_key` (S31)?
9. Per-key entitlements at call time (9 keys): same account or separate?
10. Rate limits: numbers not published ("enforced per API key") `[D]`.
11. Streaming SSE dialect per surface; `finish_reason` mapping.
12. `temperature` range enforcement (0–1 documented).

## 9. Doc-drift round — 2026-10-24 `[M]` + `[D]`

Operator request: "посмотреть свежую документацию, особенно LongCat-2.5-Preview;
проверить reasoning-режимы, качество кода". Evidence: re-captured docs
(`research/doc-*.txt`, incl. two NEW pages), probe script
`research/probe-docdrift.ts`, ledger rows `DD-*` (28 rows, 18 billed, ¥0.0456 on
KEY1) + two harness rows `live-temperature-drift-run1/2` (¥0.000048 each, the
L35 class: planned free, came back accepted).

### 9.1 The docs changed `[D 2026-10-24 captures]`

- **NEW page `api/responses`**: the Responses surface is now OFFICIALLY
  documented (was: found by probing, 2026-10-10). It documents
  `reasoning:{effort: none/minimal/low/medium/high/xhigh, summary:
  auto/concise/detailed}`, `prompt_cache_key`, flat tool shapes (NOT the
  chat-style `function` wrapper — "rejects it with tools[0].name is required"),
  structured outputs (`text.format` json_object/json_schema), custom tools with
  lark/regex grammars, and: "image URLs must be publicly accessible" (base64
  data-url support on this surface untested), and "the connection is closed
  without an extra [DONE] marker".
- **NEW page `api/model-params`**: per-model caps — 2.5-Preview **262,144**,
  2.0 131,072 (the provider's docs now AGREE with the 2026-10-10 cap-oracle
  measurement; the old api/chat "131072 for 2.5" claim is gone, replaced by a
  pointer to this page). Parameter table: temperature FIXED per thinking state
  (1.0 on / 0.7 off) and "other values are not rejected — they are overridden";
  top_p (0,1] default 0.95; top_k [-1,100] default -1; repetition_penalty
  [1,1.5] default 1; **thinking_budget** integer max 262,144; range validation
  "identifies each violating parameter".
- `api/chat`: `max_tokens` no longer claims 131072 for 2.5-Preview; temperature
  text replaced by the override policy; top_p gained default/range.
- `api-docs` (overview): lists Responses API + Model Parameters.
- change-log / faq / pricing / token-pack / tools-overview / api/model:
  **no content diff** vs the 2026-10-10 captures.

### 9.2 Gateway behaviour drift `[M 2026-10-24, KEY1]`

- **temperature is no longer range-rejected.** `temperature: 1.5` → **200
  accepted + generated** (three observations: two harness free-runs, one probe
  `DD-A9-temp-1.5`; 2026-10-10 it was 400). Matches the new override policy.
  Consequence: `live/check.ts`'s free temperature check moved to the billed
  section (an accepted probe is not free), and the free validator check now
  uses `top_p: 2` (still a guaranteed 400).
- **The validator now reports EVERY violation in one 400** (`DD-A7`: top_k 999
  + top_p 2 + repetition_penalty 3 → three named lines). 2026-10-10 it reported
  only the first failure. Unknown-extra-field strictness is still unknowable
  from one combined probe... except A7 shows the validator scans all known
  fields; a bogus field is still neither listed nor rejected (`DD-A8` rode
  along with valid ones? — no: A8 carried only thinking_budget; strictness on
  unknown fields remains unmeasured).
- **top_p/top_k/repetition_penalty ranges are enforced** (400s naming the
  parameter and ceiling: `DD-A4/A5/A6`) — the fields are real, for free.
- **`supported_parameters` did NOT change** (`DD-A2/A3`): still
  [max_tokens, temperature, top_p, stream, tools, tool_choice, thinking]. The
  machine-readable contract LAGS the prose docs: top_k, repetition_penalty and
  thinking_budget are validated/accepted but not listed.

### 9.3 `thinking_budget` is documented but DECORATIVE `[M 2026-10-24]`

- Not range-checked: `thinking_budget: 262145` (over the documented max) →
  **200 accepted + generated** (`DD-A8`).
- Not enforced: budget 32 → reasoning_tokens **144**; budget 256 → 222; no
  budget → 171 (`DD-B1/B3/B2`, same arithmetic prompt, N=1 each — natural
  variance is the same order as the "budgets"). At scale: C3 microcoding with
  budget 1024 → reasoning_tokens **1642** (`DD-C1`). The 2026-10-10 finding
  stands under the new name: acceptance proves nothing; there is still no
  working reasoning budget on the chat surface.
- `thinking: {"type":"disabled"}` + `thinking_budget: 32` → no reasoning
  (disabled wins, `DD-B4`) — but the answer went **WRONG**: 3251 instead of
  3317 for `17*23+45*67-89`. Same pattern as the vision caveat: thinking off
  trades correctness, not just tokens.

### 9.4 Responses effort scale — model-dependent, and a dead off-switch on 2.5 `[M 2026-10-24]`

Same arithmetic prompt (expected 3317), `max_output_tokens: 512`,
LongCat-2.5-Preview unless noted:

| cell | effort/switch | reasoning_tokens | answer |
|---|---|---|---|
| DD-B5-none | none | **161** | 3317 ✓ |
| DD-B5-minimal | minimal | 177 | 3317 ✓ |
| DD-B5-low | low | 125 | 3317 ✓ |
| DD-B5-medium | medium (+summary:"auto") | 46 | 3317 ✓ |
| DD-B5-high | high | 156 | 3317 ✓ |
| DD-B5-xhigh | xhigh | 145 | 3317 ✓ |
| DD-B6-none (2.0) | none | **0** | **3747 ✗** |
| DD-B6-low (2.0) | low | 118 | 3317 ✓ |
| DD-B7 | (chat-style) thinking:{type:"disabled"} | **299** | 3317 ✓ |
| DD-B8 | effort:none + thinking:disabled | **125** | 3317 ✓ |

- **On 2.5-Preview the effort scale is not a scale**: none..xhigh all reason
  (46–177 tokens, non-monotonic, N=1 per level), and **NO switch zeroes
  reasoning** — neither `effort:"none"`, nor chat-style `thinking:disabled`,
  nor both. The Responses surface has no working off switch for this model.
- **On 2.0 `effort:"none"` still zeroes reasoning** (0 tokens, out 5) — the
  2026-10-11 finding holds — and with it the answer goes WRONG (3747). Both
  models: reasoning off ⇒ arithmetic wrong (2.5-chat-off: 3251; 2.0-resp-none:
  3747). Reasoning-on cells were 8/8 correct.
- Plugin consequence: `thinkingLevelMap.off = "none"` is truthful on chat
  (both models) and on Responses **only for LongCat-2.0**. On
  Responses+2.5-Preview the picker sold an "off" that silently keeps thinking
  ON and bills ¥8/1M reasoning tokens. DECIDED + IMPLEMENTED 2026-10-24
  (operator: "Да, убрать off"): option (a) — `LONGCAT_THINKING_RESPONSES_25`
  (`off: null`) applied by `thinkingLevelsFor(id, api, levels)` for the 2.5
  FAMILY on Responses; pi's picker offers only `low` there, explicit off
  requests clamp up (billed either way), and the adapter omits the `reasoning`
  field entirely when no level is requested (off === null guard,
  openai-responses.js:303). Chat and Responses/2.0 keep `off: "none"`.
- `summary:"auto"` (medium cell): reasoning arrived as short terse lines
  ("17 * 23 = 391\n45 * 67 = 3015\n…") via `response.reasoning_text.delta`;
  cannot distinguish "summary" from a naturally short CoT at N=1. No separate
  summary item type observed.

### 9.5 Code quality, 2.5-Preview, 2026-10-24 (C3 microcoding, mechanical scoring)

- `DD-C1` thinking ON (+ ignored budget 1024), max_tokens 6144: out 2336
  (reasoning 1642), ¥0.019, finish=stop. **Independent 9/9 PASS.** Own tests
  5 pass/1 fail — and the failure is the model's own arithmetic: its test
  expected `parseDuration("2D 6h 15m 10s 250ms") === 194_110_250`, the correct
  value is **195,310,250** (verified by hand: 172.8M+21.6M+0.9M+10k+250). The
  module is right; the self-test oracle is wrong. A new failure mode worth
  remembering: score the module independently, never trust the model's own
  expected values (which is exactly why scoring.ts exists).
- `DD-C2` thinking **OFF**, max_tokens 4096: out 1165, ¥0.0094, finish=stop.
  **Independent 9/9 PASS, own tests 14/14.** Compounds ("1h30m") — the C3c
  failure of 2026-10-11 — now pass. Candidate causes (not separable at N=1):
  the new forced temperature 0.7 with thinking off, gateway/model drift since
  launch, or run variance. The C3c-based "thinking-off gets compounds wrong"
  claim is no longer reproducible as of today.
- Cost/quality note: thinking off was **cheaper AND perfect** on this task
  today (¥0.009 vs ¥0.019), the inverse of the 2026-10-11 reading. N=1 each;
  the arithmetic cells (9.3/9.4) show where off still bites.

### 9.6 Unchanged (re-verified free, 2026-10-24)

Listing (2 ids), per-model details (window 1048576, modalities, ¥2/¥0.04/¥8,
`thinking` in supported_parameters), cap sweep (400s naming 262144/131072),
unknown-model 400, image-area floor 400 naming 256px, garbage key 401 through
the shipped wrapper, both in-band HTTP-200 error paths (`GET /models/{unknown}`
and `/responses` with max_output_tokens -5) — all as recorded on 2026-10-10/11.

## 10. Default-surface switch — 2026-10-24 (operator decision) `[M]`

Operator: "переходим на responses по умолчанию (если уже нет). Да, убрать off.
Сделать коммиты." Two changes, in this order of evidence:

1. **Precondition probe (DD2, `research/probe-responses-multiturn.ts`)**: the
   one thing Responses had never exercised — a multi-turn tool loop. Through
   the shipped stack (`withGatewayErrorRemediation(openAIResponsesApi())`,
   `buildModels`, the `injectPromptCacheKey` hook, the remediated fetch) on
   2.5-Preview: turn 1 → `stopReason toolUse`, `get_current_time({zone:"UTC"})`
   parsed; turn 2 replayed pi's own bytes — captured at `onPayload`:
   `[message:system, message:user, reasoning, function_call,
   function_call_output]` with `include:["reasoning.encrypted_content"]` — and
   completed with the tool's answer in the text. Reasoning items were replayed
   WITHOUT encrypted content (gateway returned none; `encrypted=false`) and it
   still worked. ¥0.0016, KEY1, rows DD2-M1/M2. Re-run after the map change:
   green again.
2. **`off` hidden for the 2.5 family on Responses** (`off: null` — see §9.4),
   then **`DEFAULT_SURFACE = "openai-responses"`** in models.ts. Wire-format
   suite pins the new bytes (no `reasoning` field for 2.5×Responses with no
   level; `{effort:"none"}` kept for 2.0×Responses). Offline suite 141 green.
3. **The flip then FOUND a defect the pre-flight missed** (this is why the
   harness runs after a change, not only before): the billed image-colour check
   on the new default truncated at cap 64 (stop=length, text="") and, with the
   cap raised to 128, answered **"Blue"** for the green png (live/image-colour
   10:33Z/10:39Z). Isolated by `research/probe-image-responses.ts` (DD3, verdict
   rule pre-registered in the file): same png bytes, thinking on, cap 128 —
   **Responses 1/6 correct** ("Green" ×1, "Blue" ×1, "teal" ×2, truncated ×2,
   incl. the harness rows) vs **chat 4/4 "Green"** (incl. today's earlier chat
   run). Images ARE tokenized on both (input 112); the READING fails on
   Responses, consistent with the new api/responses doc's "image URLs must be
   publicly accessible" (base64 data-urls second-class there — mechanism not
   observable from outside). Consequences: the harness colour check is
   **chat-only** (a check that flakes by gateway design is worse than a recorded
   defect), LONGCAT_VISION_CAVEAT + README carry "use LONGCAT_SURFACE=chat for
   image work", and the operator was informed with the A/B choice (revert the
   flip vs proceed documented). DD3 cost ¥0.0045, KEY1.
4. Residual risk (recorded in README "What is not verified"): long sessions,
   compaction, deeper multi-turn, the dead cap oracle, and now the vision
   defect above on the new default; `LONGCAT_SURFACE=chat` keeps the working
   2.5 off switch, vision, and the cap-enforcing gateway.

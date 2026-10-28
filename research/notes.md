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
   **Decision (operator, 2026-10-24): keep the Responses default.** Rationale:
   "работа с картинками… не главный user-case, в основном работа без картинок" —
   vision is not the primary use case, so the flip stands and image-heavy
   sessions opt into `LONGCAT_SURFACE=chat`. The defect stays recorded (not
   downgraded); a future gateway fix should re-run DD3 before relaxing the
   caveat.
   **Follow-up (operator, same day): "Предлагаю добавить сообщение-
   предупреждение при чтении картинок"** — implemented as a `before_agent_start`
   handler registered ONLY on the Responses surface: a run starting with
   attached images on a longcat model there fires a once-per-session
   `ui.notify(…, "warning")` naming the DD3 measurement and the
   `LONGCAT_SURFACE=chat` escape hatch. hasUI-gated (print/json silent),
   session-id deduped, provider+api scoped. Offline-tested (5 fake-pi cases,
   146 total green); the live TUI notify render is unverified like every other
   UI path here. v0.3.0.
4. Residual risk (recorded in README "What is not verified"): long sessions,
   compaction, deeper multi-turn, the dead cap oracle, and now the vision
   defect above on the new default; `LONGCAT_SURFACE=chat` keeps the working
   2.5 off switch, vision, and the cap-enforcing gateway.

## 11. Effort-scale round — 2026-10-25 `[M]` (operator: "Выполни платный прогон. Возьми задачу, которая требует размышлений.")

Operator question: "проверить поддержку уровней размышления для Longcat 2.5
preview, какие доступны? почему через pi задаётся только low?" The answer's one
gap was that §9.4's effort scale was measured at **N=1 per level**, which cannot
separate "the scale is decorative" from "the scale is real and the spread is
natural variance at the fixed temperature 1.0". This round buys the sample size
on a task that actually needs reasoning.

### 11.1 Free pre-checks `[M 2026-10-25, KEY1, ~¥0.0003]`

- `GET /models/{id}`: `supported_parameters` **unchanged** — still
  `[max_tokens, temperature, top_p, stream, tools, tool_choice, thinking]`;
  neither `reasoning` nor `reasoning_effort` is in the machine-readable contract.
- Docs `api/responses` + `api/model-params` re-fetched and converted with
  `research/html2txt.mjs`: **byte-identical** to the 2026-10-24 captures
  (`diff` empty), so the prose still promises
  `effort: none/minimal/low/medium/high/xhigh` + `summary: auto/concise/detailed`.
- **`reasoning.effort` vocabulary is NOT validated**: `"bogus-level"` → 200,
  `"HIGH"` → 200, only `""` → 400 ("must be a non-empty string…"). The documented
  scale is therefore not enforced server-side.
- **`reasoning.summary` vocabulary IS validated**: `"bogus"` → 400 "must be one
  of concise, detailed, auto". The asymmetry (typed summary, untyped effort) is
  itself evidence about which knob the gateway actually parses.
- The response **echoes** the field (`reasoning:{"effort":"high","summary":null}`)
  — the value is stored, which says nothing about whether the model uses it.

### 11.2 Task selection — the first candidate was unusable `[M 2026-10-25]`

`research/probe-task-pilot.ts` (4 candidates, one call each at `effort=low`,
`max_output_tokens` 2048, every expected answer re-derived by exhaustive
enumeration in the file):

| candidate | task | reasoning_tokens | answer |
|---|---|---|---|
| enumeration | integers ≤1000 divisible by 7, not by 3 or 5, odd digit sum → **38** | **2047 / 2048** | **NONE** (`finish=incomplete`) |
| `divcount` | smallest n divisible by 12 with exactly 12 divisors → **60** | 331 | 60 ✓ |
| `seats` | 4 people in chairs 1–4, four constraints → **3** | 175 | 3 ✓ |
| `lastdigit` | last decimal digit of 7^2024 → **1** | 69 | 1 ✓ |
| `banana` | arrangements of BANANA with no two A's adjacent → **12** | 148 | 12 ✓ |

The enumeration candidate **saturated the cap** (`DD-E1-pilot-low`, kept as
evidence): a task that saturates makes the scale unmeasurable, because every
level would report the cap. Chosen: `divcount` as the primary (331 tokens at
effort=low, answered correctly) and `seats` as a cheaper second task so the
conclusion is not an artefact of one prompt.

### 11.3 The grid — the scale is DECORATIVE `[M 2026-10-25, KEY1]`

`research/probe-effort-scale.ts`: `max_output_tokens` 2048 (high enough that a
real high-effort cell is not truncated into the others), temperature fixed at
1.0 by the gateway, `reasoning:{effort}` with **no** `summary` so the effort
effect is not confounded.

`divcount`, N=3 per level, `reasoning_tokens`:

| level | r1 | r2 | r3 | median | range |
|---|---|---|---|---|---|
| none | 324 | 265 | 541 | **324** | 265–541 |
| minimal | 449 | 323 | 254 | **323** | 254–449 |
| low | 313 | 450 | 472 | **450** | 313–472 |
| medium | 268 | 425 | 251 | **268** | 251–425 |
| high | 316 | 292 | 315 | **315** | 292–316 |
| xhigh | 338 | 343 | 267 | **338** | 267–343 |
| *baseline: no `reasoning` field* | 319 | 345 | 327 | **327** | 319–345 |

`seats`, N=2 per level, medians: none 222, minimal 298, low 297, medium 295,
**high 207** (the LOWEST of the six), xhigh 293.

`summary` knob at `effort=high` on `divcount`, N=2, medians: auto 330, concise
366, detailed 321 — against the grid's `high` without `summary` at 315, i.e. the
knob moves nothing either.

- **Kruskal–Wallis across the six `divcount` groups: H = 2.918, df = 5,
  p = 0.713** — no difference. The between-level spread of medians (268–450,
  1.7×) is smaller than the within-level spread (e.g. none: 265–541, 2.0×), and
  the baseline — *no field at all*, which is exactly what pi sends for
  2.5×Responses when no level is requested — sits at 327, mid-pack.
- No cache confound: `cached_tokens = 0` on every grid cell.
- Correctness is not level-dependent either: 36/39 calls right (`divcount` grid
  16/18, baseline 3/3, `summary` 5/6; `seats` 12/12), and the failures
  (`minimal-r1`→12, `low-r2`→10, `detailed-r1`→10) are scattered across levels.

### 11.4 Consequence

Confirms the existing catalog decision and adds the number that was missing:
on 2.5-Preview×Responses **the six documented effort levels are statistically
indistinguishable from sending nothing**, so `low`-only is not a limitation of
the plugin — it is the whole of what the gateway offers. No code change. `off`
remains dead on that pair (§9.4) and live on chat and on 2.0×Responses.
Probes: `research/probe-effort-scale.ts`, `research/probe-task-pilot.ts`; ledger
rows `DD-E0-*`, `DD-E1-*`, `DD-E2-*`, `DD-E3-*`, `DD-E4-*` — **44 rows, 44
billed, ¥0.14611 (~$0.0217)** on KEY1; bodies in `research/probes/DD-E*.json`.

## 12. Tool-call argument repair — 2026-10-28 `[M]`

Trigger: operator report — `Invalid arguments for tool "debi_skill": Unexpected
token 'p', ..." "query": pentest: c"... is not valid JSON` in session
`01a18390-074c-7114-b2ed-09923917ace0` (LongCat-2.5-Preview, thinking `low`,
SADNES). The `Received arguments:` body showed the class: `"query": pentest:
check leaked casino credentials …, "role": sadnes, "load": primary` — long
free-text values (and sometimes enums) without opening quotes.

### 12.1 How big it is `[M 2026-10-28]`

Measured over **all** recorded pi sessions (`~/.pi/agent/sessions`, 2109 files):

| metric | value |
|---|---|
| tool calls with `argumentsError` | 57 |
| … of which "value after `:` not in quotes" | **49 (86%)** |
| … on `longcat/LongCat-2.5-Preview` | 47 |
| LongCat error rate | **47 / 3644 tool calls = 1.29%** |
| qwen3.8-max / grok-4.6 / glm-5.3 / kimi-k3 | 0 of 45–50k each = **0.00%** |
| deepseek-flash | 5 / 13082 = 0.04% |
| tools with long free text, on LongCat | `debi_think` 8/13, `debi_session_end` 3/6, `debi_skill` 6/23 |

So it is a model property, not a tool-schema defect; tools whose arguments are
long prose are simply where a lost quote is most likely.

### 12.2 `strict` on this gateway is a no-op `[M 2026-10-28]`

Direct `POST /openai/v1/responses` probes (KEY5, `research/probe-tool-repair.ts`
energy: 18 requests, ~¥0.02) with the real `debi_skill` schema:

- no `strict`: 3/3 broken (+1 refusal to call);
- `strict: true`: 3/3 broken — the gateway **accepts the flag** and answers with
  `"role": null, …` plus the same unquoted values, i.e. it does not enforce and
  does not reject;
- schema reduced to 3 fields: 4/4 broken; with an explicit "value is one JSON
  string in double quotes" description: 2 broken + 2 refusals;
- english/russian, with/without a colon in the value, short/long: all broken.

TOTAL across the probe: **14 broken, 0 valid**. No prompt or schema shape helps;
the repair must be client-side. This also retro-justifies
`supportsStrictMode: false` in `models.ts` with a mechanism, not just an absence.

### 12.3 Where it has to run (and where it cannot) `[M, code-read]`

pi's order is `prepareToolCallArguments` (receives `{}` — the raw text is gone) →
`validateToolArguments` (throws on `argumentsError`) → `beforeToolCall` (our
`tool_call` hook never runs). `pi-ai`'s `repairJson` only escapes control
characters and bad escape sequences; unquoted values are outside it. Therefore:
not `prepareArguments`, not a `tool_call` handler, not `message_end` on the
LongCat path — the only place that still has the text is the adapter's
`toolcall_end` event (`ToolCall.argumentsError`), i.e. the provider stream.

### 12.4 The pass and what it recovers `[M]`

`repair.ts` is a single left-to-right finite-state walk (in-string / after-`:` /
elsewhere) that quotes bare values up to `, "key":` or the object's own closing
bracket; whitespace and the separating comma stay outside the quotes. A repaired
text is committed only if it parses as a non-empty object **and** keeps every
top-level key the text announced (nested keys are compared separately, because a
value may legitimately contain `"key":` text — one live case has `"options":
{"view": …}`).

Replayed over the 49 recorded refusals: **45 recovered (92%)**, 0 keys lost, 0
changes on valid JSON. The 4 left are a different class — a value that *does*
open a quote and then carries an unescaped quote or a raw newline inside itself
(and `edit.edits[].oldText` with `\n`/`\"`); those keep pi's honest refusal.

### 12.5 Wiring and live confirmation `[M]`

`withToolArgumentRepair` wraps the surface (`stream`, `streamSimple`,
`fetchDeferred`) as a **proxy**, not a rebuilt stream: pi sometimes consumes an
adapter stream by iterating events (`forwardStream`) and sometimes only by
awaiting `result()` (`complete()`), and a wrapper that fed a second stream would
deadlock the second path. Events are mutated in place and yielded unchanged.

Confirmed end-to-end in a real `pi -p --debi` run on 2026-10-28 against a local
proxy that replays the recorded broken SSE (`LONGCAT_BASE_URL=…:8787`):
`[longcat] repair: tool-call arguments recovered (tool="debi_skill",
keys=action,query,role,load, 183 chars of raw text)` — i.e. the repair fires
before pi's validation in the real runtime, not only in the test harness.

Regression cover: `test/repair.test.ts` (22 tests incl. the recorded corpus and
the "valid JSON is never touched" invariant), `test/provider.test.ts`
(`withToolArgumentRepair` — in-place fix, `result()`-only path, off switch, no
pass-through layer), `test/tool-argument-repair-wire.test.ts` (a recorded SSE
through the real Responses adapter, with a negative control).

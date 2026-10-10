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

# Live probe ledger — pi-longcat

Generated from `research/probe-ledger.jsonl` by `node scripts/ledger-report.ts`; do not hand-edit.

Rules (pi-provider-plugin Phase 5, pitfalls L35/L41/L42):

- **Free means *rejected*.** A 2xx that generated is itemized with its usage and cost.
- A 2xx carrying an in-band `{"error":…}` body, or an SSE `response.failed` with
  `usage: 0`, performed no inference and is recorded as not billed.
- Costing uses the gateway's own rates: ¥2 / 1M uncached input, ¥0.04 / 1M cached,
  ¥8 / 1M output (`GET /openai/v1/models/{id}`, 2026-10-10). USD conversions use the
  dated house rate ¥6.7252 = $1 (models.ts).
- `key` is the index name from `secret.env`, never the key.

## Summary

| | |
|---|---|
| ledger rows | 87 |
| calls that generated (BILLED) | 62 |
| input tokens bought | 7212 |
| output tokens bought | 587 |
| **total spend** | **¥0.015859 ≈ $0.002358** |
| 2xx rows with no captured usage (holes) | 4 — CAP2-chat-2.5-131073, listing-9-keys, retrieve-model-details, R2-IM-2.5-textonly |
| rows planned "free" that came back 2xx | 5 — B4-bad-thinking-type-chat, B4-bad-thinking-type-anthropic, listing-9-keys, retrieve-model-details, inband-200-evidence |

Two calls are holes on purpose and are **not** estimated (the house rule is 'not
captured' rather than a plausible number): `CAP2-chat-2.5-131073` was accepted and
killed by the 3 s client-side abort guard before any usage event, and
`R2-IM-2.5-textonly` timed out at 45 s. Both were bounded prompts with
`max_tokens` 8/131073 respectively; the first is the reason every cap probe in
this run carries an abort guard.

## Rows

| # | label | key | surface | HTTP | class | in | out | cached | ¥ |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `S1-chat-stream` | KEY1 | openai-completions | 200 | BILLED | 14 | 8 | 0 | 0.00009200 |
| 2 | `S2-responses-stream` | KEY1 | openai-responses | 200 | BILLED | 14 | 8 | – | 0.00009200 |
| 3 | `S3-anthropic-stream` | KEY1 | anthropic-messages | 200 | BILLED | 14 | 8 | – | 0.00009200 |
| 4 | `S4-responses-pi-shaped` | KEY1 | openai-responses | 200 | BILLED | 21 | 8 | – | 0.00010600 |
| 5 | `T1-thinking-enabled` | KEY1 | openai-completions | 200 | BILLED | 14 | 8 | 0 | 0.00009200 |
| 6 | `T2-thinking-disabled` | KEY1 | openai-completions | 200 | BILLED | 17 | 2 | 0 | 0.00005000 |
| 7 | `T3-thinking-absent` | KEY1 | openai-completions | 200 | BILLED | 14 | 8 | 0 | 0.00009200 |
| 8 | `T4-thinking-zai-shape` | KEY1 | openai-completions | 200 | BILLED | 14 | 8 | 0 | 0.00009200 |
| 9 | `T5-thinking-2.5` | KEY1 | openai-completions | 200 | BILLED | 14 | 8 | 0 | 0.00009200 |
| 10 | `T6-reasoning-effort` | KEY1 | openai-completions | 200 | BILLED | 14 | 8 | 0 | 0.00009200 |
| 11 | `T7-anthropic-thinking` | KEY1 | anthropic-messages | 200 | BILLED | 14 | 8 | – | 0.00009200 |
| 12 | `TL1-tools-chat` | KEY1 | openai-completions | 200 | BILLED | 148 | 77 | 0 | 0.00091200 |
| 13 | `TL2-tools-anthropic` | KEY1 | anthropic-messages | 200 | BILLED | 20 | 57 | 128 | 0.00024512 |
| 14 | `TL3-tool-result-role` | KEY1 | openai-completions | 200 | BILLED | 186 | 8 | 0 | 0.00043600 |
| 15 | `PA1-content-parts-array` | KEY1 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 16 | `PA2-developer-role` | KEY1 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 17 | `PA3-temperature-range` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 18 | `IM1-image-2.5-chat` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 19 | `IM2-image-2.0-chat` | KEY1 | openai-completions | 200 | BILLED | 19 | 8 | 0 | 0.00010200 |
| 20 | `CAP1-chat-2.0-131073` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 21 | `CAP2-chat-2.5-131073` | KEY1 | openai-completions | ABORTED(3000ms) | free (rejected/no inference) | – | – | – | 0 |
| 22 | `CAP3-chat-2.5-262145` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 23 | `CAP4-chat-window-plus-1` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 24 | `CAP5-anthropic-131073` | KEY1 | anthropic-messages | 400 | free (rejected/no inference) | – | – | – | 0 |
| 25 | `CAP6-responses-131073` | KEY1 | openai-responses | 200 | 200-no-usage (not billed) | 0 | 0 | – | 0 |
| 26 | `K-KEY2` | KEY2 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 27 | `K-KEY3` | KEY3 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 28 | `K-KEY4` | KEY4 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 29 | `B4-bad-thinking-type-chat` | KEY1 | openai-completions | 200 | BILLED | 11 | 4 | 0 | 0.00005400 |
| 30 | `K-KEY5` | KEY5 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 31 | `B4-bad-thinking-type-anthropic` | KEY1 | anthropic-messages | 200 | BILLED | 11 | 4 | 0 | 0.00005400 |
| 32 | `K-KEY6` | KEY6 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 33 | `listing-9-keys` | KEY1..KEY9 | GET | 200 | free (no inference) | – | – | – | 0 |
| 34 | `K-KEY7` | KEY7 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 35 | `retrieve-model-details` | KEY1 | GET | 200 | free (no inference) | – | – | – | 0 |
| 36 | `K-KEY8` | KEY8 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 37 | `path-matrix-empty-bodies` | KEY1 | multiple | 400 | free (rejected) | – | – | – | 0 |
| 38 | `K-KEY9` | KEY9 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 39 | `auth-and-model-dialect` | KEY1/garbage/none | multiple | 401 | free (rejected) | – | – | – | 0 |
| 40 | `inband-200-evidence` | KEY1 | openai-responses + GET | 200 | 200-in-band-error (not billed) | – | – | – | 0 |
| 41 | `R2-SYS-system-role` | KEY1 | openai-completions | 200 | BILLED | 57 | 4 | 0 | 0.00014600 |
| 42 | `R2-SYS-developer-role` | KEY1 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 43 | `R2-SYS-baseline` | KEY1 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 44 | `R2-IM-2.5-64px` | KEY1 | openai-completions | 200 | BILLED | 85 | 8 | 0 | 0.00023400 |
| 45 | `R2-IM-2.5-textonly` | KEY1 | openai-completions | ERR:The operation was aborted due to timeout | free (rejected/no inference) | – | – | – | 0 |
| 46 | `R2-IM-2.0-64px` | KEY1 | openai-completions | 200 | BILLED | 19 | 8 | 0 | 0.00010200 |
| 47 | `R2-IM-responses-2.5` | KEY1 | openai-responses | 200 | BILLED | 86 | 8 | 0 | 0.00023600 |
| 48 | `R2-CACHE-chat-repeat` | KEY1 | openai-completions | 200 | BILLED | 836 | 4 | 0 | 0.00170400 |
| 49 | `R2-CACHE-chat-repeat2` | KEY1 | openai-completions | 200 | BILLED | 836 | 4 | 768 | 0.00019872 |
| 50 | `R2-CACHE-chat-repeat2` | KEY1 | openai-completions | 200 | BILLED | 836 | 4 | 768 | 0.00019872 |
| 51 | `R2-CACHE-anthropic-repeat` | KEY1 | anthropic-messages | 200 | BILLED | 836 | 4 | – | 0.00170400 |
| 52 | `R3-IM-2.5-off` | KEY1 | openai-completions | 200 | BILLED | 88 | 2 | 0 | 0.00019200 |
| 53 | `R3-IM-2.0-off` | KEY1 | openai-completions | 200 | BILLED | 22 | 2 | 0 | 0.00006000 |
| 54 | `R3-IM-2.5-textonly` | KEY1 | openai-completions | 200 | BILLED | 22 | 2 | 0 | 0.00006000 |
| 55 | `R3-RESP-baseline` | KEY1 | openai-responses | 200 | BILLED | 14 | 8 | 0 | 0.00009200 |
| 56 | `R3-RESP-effort-none` | KEY1 | openai-responses | 200 | BILLED | 17 | 2 | 0 | 0.00005000 |
| 57 | `R3-RESP-thinking-disabled` | KEY1 | openai-responses | 200 | BILLED | 14 | 8 | 0 | 0.00009200 |
| 58 | `R3-ANTH-thinking-disabled` | KEY1 | anthropic-messages | 200 | BILLED | 17 | 2 | – | 0.00005000 |
| 59 | `R3-ANTH-budget` | KEY1 | anthropic-messages | 200 | BILLED | 14 | 8 | – | 0.00009200 |
| 60 | `R4-2.5-responses` | KEY1 | openai-responses | 200 | BILLED | 14 | 8 | 0 | 0.00009200 |
| 61 | `R4-2.5-anthropic` | KEY1 | anthropic-messages | 200 | BILLED | 14 | 8 | – | 0.00009200 |
| 62 | `R4-IM-blue-2.5` | KEY1 | openai-completions | 200 | BILLED | 105 | 2 | 0 | 0.00022600 |
| 63 | `R4-IM-blue-responses` | KEY1 | openai-responses | 200 | BILLED | 103 | 8 | 0 | 0.00027000 |
| 64 | `R5-IM-green-2.5` | KEY1 | openai-completions | 200 | BILLED | 105 | 2 | 0 | 0.00022600 |
| 65 | `R5-IM-red1024-2.5` | KEY1 | openai-completions | 200 | BILLED | 1393 | 2 | 0 | 0.00280200 |
| 66 | `R5-RESP-none-array` | KEY1 | openai-responses | 200 | BILLED | 17 | 2 | 0 | 0.00005000 |
| 67 | `R5-RESP-none-array-plain` | KEY1 | openai-responses | 200 | BILLED | 17 | 2 | 0 | 0.00005000 |
| 68 | `R5-RESP-none-image` | KEY1 | openai-responses | 200 | BILLED | 103 | 8 | 0 | 0.00027000 |
| 69 | `R6-IM-green-think64` | KEY1 | openai-completions | 200 | BILLED | 102 | 50 | 0 | 0.00060400 |
| 70 | `R6-IM-green-detail-high` | KEY1 | openai-completions | 200 | BILLED | 105 | 2 | 0 | 0.00022600 |
| 71 | `R6-IM-green-describe` | KEY1 | openai-completions | 200 | BILLED | 101 | 6 | 0 | 0.00025000 |
| 72 | `R7-max-completion-tokens` | KEY1 | openai-completions | 200 | BILLED | 14 | 33 | 0 | 0.00029200 |
| 73 | `R7-tool-result-no-assistant` | KEY1 | openai-completions | 200 | BILLED | 161 | 8 | 0 | 0.00038600 |
| 74 | `R7-thinking-budget` | KEY1 | openai-completions | 200 | BILLED | 20 | 64 | 0 | 0.00055200 |
| 75 | `free-stream-invalid-chat` | KEY1 | openai-completions | 400 | free (rejected) | – | – | – | 0 |
| 76 | `free-stream-invalid-responses` | KEY1 | openai-responses | 200 | 200 response.failed, usage 0 (not billed) | 0 | 0 | 0 | 0 |
| 77 | `free-stream-invalid-anthropic` | KEY1 | anthropic-messages | 400 | free (rejected) | – | – | – | 0 |
| 78 | `free-stream-auth-chat-badkey` | garbage | openai-completions | 401 | free (cannot bill) | – | – | – | 0 |
| 79 | `free-stream-auth-chat-nokey` | none | openai-completions | 401 | free (cannot bill) | – | – | – | 0 |
| 80 | `free-stream-auth-responses-badkey` | garbage | openai-responses | 401 | free (cannot bill) | – | – | – | 0 |
| 81 | `free-stream-auth-responses-nokey` | none | openai-responses | 401 | free (cannot bill) | – | – | – | 0 |
| 82 | `free-stream-auth-anthropic-badkey` | garbage | anthropic-messages | 401 | free (cannot bill) | – | – | – | 0 |
| 83 | `free-stream-auth-anthropic-nokey` | none | anthropic-messages | 401 | free (cannot bill) | – | – | – | 0 |
| 84 | `free-anthropic-xapikey` | KEY1 | anthropic-messages | 401 | free (rejected) | – | – | – | 0 |
| 85 | `free-anthropic-xapikey-noauth` | none | anthropic-messages | 401 | free (rejected) | – | – | – | 0 |
| 86 | `R8-responses-pi-exact` | KEY1 | openai-responses | 200 | BILLED | 159 | 8 | 0 | 0.00038200 |
| 87 | `R8-chat-pi-exact` | KEY1 | openai-completions | 200 | BILLED | 153 | 8 | 0 | 0.00037000 |

## What each row was for

- **1 `S1-chat-stream`** (max_tokens 8, 6-word prompt) — chat surface liveness, SSE dialect, usage, echoed model, finish_reason
- **2 `S2-responses-stream`** (max_output_tokens 8, 6-word prompt, abort 3 s) — does the UNDOCUMENTED Responses surface generate at all?
- **3 `S3-anthropic-stream`** (max_tokens 8, 6-word prompt) — Anthropic surface liveness + SSE dialect
- **4 `S4-responses-pi-shaped`** (max_output_tokens 8, abort 3 s) — pi's real Responses body: store:false + prompt_cache_key + reasoning{effort,summary} + instructions
- **5 `T1-thinking-enabled`** (max_tokens 8) — thinking {"type":"enabled"} — is reasoning_content / reasoning_tokens produced?
- **6 `T2-thinking-disabled`** (max_tokens 8) — thinking {"type":"disabled"} — off-switch readout
- **7 `T3-thinking-absent`** (max_tokens 8) — no thinking field at all — is thinking ON by default?
- **8 `T4-thinking-zai-shape`** (max_tokens 8) — pi's zai wire shape: thinking {type:enabled, clear_thinking:false} — accepted or rejected?
- **9 `T5-thinking-2.5`** (max_tokens 8) — thinking enabled on LongCat-2.5-Preview (per-model thinking check)
- **10 `T6-reasoning-effort`** (max_tokens 8) — OpenAI-style reasoning_effort (not in supported_parameters) — accepted/ignored/rejected?
- **11 `T7-anthropic-thinking`** (max_tokens 8) — Anthropic surface: LongCat's thinking object vs Anthropic's budget_tokens shape
- **12 `TL1-tools-chat`** (max_tokens 200, tool_choice forced) — chat: does it emit tool_calls? (shape observable only if the tool is required)
- **13 `TL2-tools-anthropic`** (max_tokens 200, tool_choice forced) — Anthropic surface: tool_use block emitted?
- **14 `TL3-tool-result-role`** (max_tokens 8) — is role:'tool' accepted? (docs list only system|user|assistant) — decides the payload hook
- **15 `PA1-content-parts-array`** (max_tokens 4) — content as a parts array (pi's shape) vs the documented string — S28 discriminator
- **16 `PA2-developer-role`** (max_tokens 4) — role:'developer' accepted? (decides supportsDeveloperRole)
- **17 `PA3-temperature-range`** (max_tokens 4) — temperature 1.5 vs the documented 0~1 range — strictness readout
- **18 `IM1-image-2.5-chat`** (max_tokens 8, 8×8 generated red PNG) — image_url OBJECT form on 2.5-Preview + a modality-only question (L40: prove consumption)
- **19 `IM2-image-2.0-chat`** (max_tokens 8, same generated PNG) — control: 2.0 is listed text-only — rejected, or accepted-and-dropped?
- **20 `CAP1-chat-2.0-131073`** (max_tokens 131073, 6-word prompt, stream + 3 s abort) — output cap of 2.0: listing says 131072 ⇒ window+1 should be rejected with the ceiling
- **21 `CAP2-chat-2.5-131073`** (max_tokens 131073, stream + 3 s abort) — 2.5-Preview at 131073: discriminates the FAQ's 128k from the listing's 262144
- **22 `CAP3-chat-2.5-262145`** (max_tokens 262145, stream + 3 s abort) — 2.5-Preview at listing cap + 1 (262145)
- **23 `CAP4-chat-window-plus-1`** (max_tokens 1048576, stream + 3 s abort) — context window: tiny prompt + max_tokens 1048576 ⇒ prompt+max_tokens > 1M window; FAQ promises context_length_exceeded
- **24 `CAP5-anthropic-131073`** (max_tokens 131073, stream + 3 s abort) — is the cap validated per surface? (Anthropic route)
- **25 `CAP6-responses-131073`** (max_output_tokens 131073, stream + 3 s abort) — is the cap validated on the Responses surface?
- **26 `K-KEY2`** (max_tokens 4, 6-word prompt) — KEY2: call-level entitlement (403 insufficient_quota vs 200) — one account or nine?
- **27 `K-KEY3`** (max_tokens 4, 6-word prompt) — KEY3: call-level entitlement (403 insufficient_quota vs 200) — one account or nine?
- **28 `K-KEY4`** (max_tokens 4, 6-word prompt) — KEY4: call-level entitlement (403 insufficient_quota vs 200) — one account or nine?
- **29 `B4-bad-thinking-type-chat`** (max_tokens 4, 1-word prompt) — does the gateway validate the thinking vocabulary? (planned as a guaranteed rejection: {"type":"bogus"})
- **30 `K-KEY5`** (max_tokens 4, 6-word prompt) — KEY5: call-level entitlement (403 insufficient_quota vs 200) — one account or nine?
- **31 `B4-bad-thinking-type-anthropic`** (max_tokens 4, 1-word prompt) — same probe on the Anthropic surface
- **32 `K-KEY6`** (max_tokens 4, 6-word prompt) — KEY6: call-level entitlement (403 insufficient_quota vs 200) — one account or nine?
- **33 `listing-9-keys`** (GET only, no inference) — key x listing matrix: nine keys, identical two-model list
- **34 `K-KEY7`** (max_tokens 4, 6-word prompt) — KEY7: call-level entitlement (403 insufficient_quota vs 200) — one account or nine?
- **35 `retrieve-model-details`** (GET only) — GET /models/{id} for both ids: modalities, context_length, CNY pricing object
- **36 `K-KEY8`** (max_tokens 4, 6-word prompt) — KEY8: call-level entitlement (403 insufficient_quota vs 200) — one account or nine?
- **37 `path-matrix-empty-bodies`** (empty body {} cannot be accepted) — which routes exist: chat, responses, anthropic, native (404), embeddings (404), bogus (404)
- **38 `K-KEY9`** (max_tokens 4, 6-word prompt) — KEY9: call-level entitlement (403 insufficient_quota vs 200) — one account or nine?
- **39 `auth-and-model-dialect`** (invalid credential / unknown id / negative max_tokens) — 401 invalid_api_key wording, unknown-model 400 wording, validation order (auth > model > params)
- **40 `inband-200-evidence`** (negative max_output_tokens / unknown model id) — confirm HTTP 200 + in-band error bodies (headers dumped)
- **41 `R2-SYS-system-role`** (max_tokens<=8, tiny prompt, 45 s timeout) — control: is role:'system' counted? (prompt_tokens delta vs R2-SYS-baseline)
- **42 `R2-SYS-developer-role`** (max_tokens<=8, tiny prompt, 45 s timeout) — same 50+-token message as role:'developer' — if prompt_tokens matches the baseline, the role is dropped
- **43 `R2-SYS-baseline`** (max_tokens<=8, tiny prompt, 45 s timeout) — baseline: user message only, no system/developer message
- **44 `R2-IM-2.5-64px`** (max_tokens<=8, tiny prompt, 45 s timeout) — 2.5-Preview with a valid 64×64 red PNG: does it say 'red'? are image_tokens > 0?
- **45 `R2-IM-2.5-textonly`** (max_tokens<=8, tiny prompt, 45 s timeout) — text-only control for the identical prompt on 2.5-Preview (input_tokens delta = image cost)
- **46 `R2-IM-2.0-64px`** (max_tokens<=8, tiny prompt, 45 s timeout) — control: 2.0 is listed text-only — rejected, or accepted-and-dropped (L40)?
- **47 `R2-IM-responses-2.5`** (max_tokens<=8, tiny prompt, 45 s timeout) — Responses surface image shape: input_image with image_url as a STRING (S31)
- **48 `R2-CACHE-chat-repeat`** (max_tokens<=8, tiny prompt, 45 s timeout) — does the chat surface ever report prompt_tokens_details.cached_tokens > 0 for a repeated prefix?
- **49 `R2-CACHE-chat-repeat2`** (max_tokens<=8, tiny prompt, 45 s timeout) — second identical long-prefix chat call: the pair is what proves cache accounting (a single call cannot)
- **50 `R2-CACHE-chat-repeat2`** (max_tokens<=8, tiny prompt, 45 s timeout) — second identical long-prefix chat call: the PAIR is what proves cache accounting (one call cannot)
- **51 `R2-CACHE-anthropic-repeat`** (max_tokens<=8, tiny prompt, 45 s timeout) — Anthropic surface cache accounting (round 1 reported cache_read_input_tokens: 128 unprompted)
- **52 `R3-IM-2.5-off`** (max_tokens<=8, tiny prompt, 45 s timeout) — 2.5-Preview + 64x64 red PNG + thinking disabled: visible one-word colour answer (L40 consumption proof)
- **53 `R3-IM-2.0-off`** (max_tokens<=8, tiny prompt, 45 s timeout) — control: same image on text-only 2.0 with thinking disabled — what does a model that got no image say?
- **54 `R3-IM-2.5-textonly`** (max_tokens<=8, tiny prompt, 45 s timeout) — text-only control for IMG_Q (round 2 timed out): input_tokens delta = the image's token cost
- **55 `R3-RESP-baseline`** (max_tokens<=8, tiny prompt, 45 s timeout) — Responses baseline: no thinking field — reasoning_tokens with thinking on by default
- **56 `R3-RESP-effort-none`** (max_tokens<=8, tiny prompt, 45 s timeout) — Responses off-switch candidate 1: reasoning:{effort:"none"} — does reasoning_tokens go to 0?
- **57 `R3-RESP-thinking-disabled`** (max_tokens<=8, tiny prompt, 45 s timeout) — Responses off-switch candidate 2: undocumented thinking:{type:disabled} pass-through
- **58 `R3-ANTH-thinking-disabled`** (max_tokens<=8, tiny prompt, 45 s timeout) — Anthropic surface: is thinking:{type:disabled} honoured (no thinking block)?
- **59 `R3-ANTH-budget`** (max_tokens<=8, tiny prompt, 45 s timeout) — Anthropic surface: pi's own shape thinking:{type:enabled,budget_tokens} — accepted, and does the budget bind?
- **60 `R4-2.5-responses`** (max_tokens<=8, tiny prompt, 45 s timeout) — matrix cell: LongCat-2.5-Preview on the Responses surface
- **61 `R4-2.5-anthropic`** (max_tokens<=8, tiny prompt, 45 s timeout) — matrix cell: LongCat-2.5-Preview on the Anthropic surface
- **62 `R4-IM-blue-2.5`** (max_tokens<=8, tiny prompt, 45 s timeout) — vision proof: BLUE 256x256 PNG, thinking off, one-word answer — 'Blue' can only come from the image
- **63 `R4-IM-blue-responses`** (max_tokens<=8, tiny prompt, 45 s timeout) — same blue image on the Responses surface (image_url as a STRING) — cross-surface vision check
- **64 `R5-IM-green-2.5`** (max_tokens<=8, tiny prompt, 45 s timeout) — vision decider: GREEN 256x256, thinking off — 'Green' can only come from the image
- **65 `R5-IM-red1024-2.5`** (max_tokens<=8, tiny prompt, 45 s timeout) — vision at 1024x1024 red, thinking off — does size change the answer?
- **66 `R5-RESP-none-array`** (max_tokens<=8, tiny prompt, 45 s timeout) — off switch with pi's ARRAY input shape (no image): does effort:none still zero reasoning_tokens?
- **67 `R5-RESP-none-array-plain`** (max_tokens<=8, tiny prompt, 45 s timeout) — off switch with array input whose content is a plain string (isolates 'array' from 'parts')
- **68 `R5-RESP-none-image`** (max_tokens<=8, tiny prompt, 45 s timeout) — re-run of round 4's ambiguous cell: array input + green image + effort:none
- **69 `R6-IM-green-think64`** (max_tokens<=8, tiny prompt, 45 s timeout) — green 256x256 with thinking ENABLED and max_tokens 64 — does budget change the answer?
- **70 `R6-IM-green-detail-high`** (max_tokens<=8, tiny prompt, 45 s timeout) — same image with detail:'high' (pi omits detail by default), thinking off, max_tokens 8
- **71 `R6-IM-green-describe`** (max_tokens<=8, tiny prompt, 45 s timeout) — open question instead of a forced colour word: 'Describe this image in five words' with thinking off, max_tokens 32
- **72 `R7-max-completion-tokens`** (max_tokens<=8, tiny prompt, 45 s timeout) — is max_completion_tokens read at all? (pi's default field for unknown hosts)
- **73 `R7-tool-result-no-assistant`** (max_tokens<=8, tiny prompt, 45 s timeout) — role:'tool' with NO preceding assistant tool_calls message — 400 or accepted?
- **74 `R7-thinking-budget`** (max_tokens<=8, tiny prompt, 45 s timeout) — does thinking.budget_tokens bound reasoning_tokens? (shared max_tokens budget trap)
- **75 `free-stream-invalid-chat`** (negative value, cannot be accepted) — streaming + max_tokens:-1 — is a stream failure in-band?
- **76 `free-stream-invalid-responses`** (invalid value; arrived as SSE response.failed with usage 0) — streaming + max_output_tokens:-1 — the Responses surface does NOT pre-validate
- **77 `free-stream-invalid-anthropic`** (negative value, cannot be accepted) — streaming + max_tokens:-1
- **78 `free-stream-auth-chat-badkey`** (invalid credential cannot be billed) — S32 scenario: does a streaming auth failure arrive as HTTP 200?
- **79 `free-stream-auth-chat-nokey`** (no credential) — same, no Authorization header
- **80 `free-stream-auth-responses-badkey`** (invalid credential) — S32 scenario on the Responses surface
- **81 `free-stream-auth-responses-nokey`** (no credential) — same, no header
- **82 `free-stream-auth-anthropic-badkey`** (invalid credential) — S32 scenario on the Anthropic surface
- **83 `free-stream-auth-anthropic-nokey`** (no credential) — same, no header
- **84 `free-anthropic-xapikey`** (empty body, cannot be accepted) — does the Anthropic surface accept pi's x-api-key header?
- **85 `free-anthropic-xapikey-noauth`** (empty body) — control: same empty body without any credential
- **86 `R8-responses-pi-exact`** (max_output_tokens 8, captured via onPayload then sent live) — pi's EXACT captured Responses body, incl. the unprobed include/store/prompt_cache_key/summary fields
- **87 `R8-chat-pi-exact`** (max_tokens 8, captured via onPayload then sent live) — pi's EXACT captured chat body, incl. thinking{type:enabled,clear_thinking:false} + tools

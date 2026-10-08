# PDF Insight

Upload a PDF, get a summary and structured JSON (document type, key points, entities, amounts, dates, keywords), preview it and download it as `.json`.

Demo: https://masterxxo.github.io/pdf-reader/

## Architecture

pnpm monorepo:

- `apps/web` — React + Vite, hosted on GitHub Pages. Extracts the text with pdf.js in the browser; only the text, file name and page count are sent to the API.
- `apps/api` — Hono on Cloudflare Workers. Holds the LLM API keys (as `wrangler secret`s) and calls the model.
- `packages/shared` — Zod schema of the result, used by both (the web app validates the response again before rendering).

Analysis on the API (`POST /analyze`):

1. **Normalize** the text: remove running headers/footers, page numbers and page markers, collapse whitespace (~4% fewer tokens on a dense report).
2. **Cache**: results are stored in KV for 7 days, keyed by a hash of the prompt and the normalized text.
3. **Model call**: Mistral (`ministral-8b-2512`, strict JSON Schema output) with Google Gemini as a fallback on 429/5xx/timeouts. The document is wrapped in delimiters, and the system prompt says to treat it as data, never as instructions. Output that is not valid JSON or does not match the schema gets one correction retry.
4. **Time budget**: one 27 s deadline per request shared by all calls; each call gets the time left, and a retry or fallback with less than 8 s left is not started (`LLM_TIMEOUT` instead).
5. **Bounded output**: lists are capped (key points 7, organizations/people 15, amounts/dates 10, keywords 10), short contexts, `max_tokens` 3000. Output generation is ~97% of the latency, so this matters most.
6. **Long documents**: above `SINGLE_CALL_MAX_TOKENS` the text can be split into chunks (map: compact partial per chunk; reduce: lists merged and deduped in code, one call for the summary). Disabled by default (`MAX_CHUNKS=1`); see known limitations.

Every `/analyze` response carries a `Server-Timing` header with the text size and each model call (duration, outcome, token usage).

## Local setup

Requires Node 22.12+ and pnpm.

```sh
cp apps/api/.dev.vars.example apps/api/.dev.vars   # then fill in the API keys
pnpm dev:local                                      # API on :8787, web app on :5173
```

Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

## Environment variables

API secrets (`apps/api/.dev.vars` locally, `wrangler secret put` in production; never committed):

| Name              | Purpose                           |
| ----------------- | --------------------------------- |
| `MISTRAL_API_KEY` | Primary provider (Mistral)        |
| `LLM_API_KEY`     | Fallback provider (Google Gemini) |
| `DEBUG`           | `1` logs timings (local only)     |

API vars (`apps/api/wrangler.toml`): `MISTRAL_MODEL`, `LLM_MODEL`, `ALLOWED_ORIGINS`, `SINGLE_CALL_MAX_TOKENS` (default 50000), `MAX_CHUNKS` (default 1), `CHUNK_CONCURRENCY` (default 2).

Web (`apps/web/.env`, GitHub Variables in CI): `VITE_API_URL` — base URL of the API.

## Known limitations

- **Document length: about 130,000 characters (~50k tokens).** That is ~29 pages of dense, small-print text, or more pages of typical documents. Longer documents are rejected at once with a message suggesting a shorter document. Measured end to end on production (dense Polish report, 10 pt A4):

  | Document              | Time             |
  | --------------------- | ---------------- |
  | 2 pages (9k chars)    | 14–15 s          |
  | 12 pages (57k chars)  | ~17 s            |
  | 29 pages (140k chars) | 20–21.5 s        |
  | 30 pages (145k chars) | rejected (0.3 s) |

- **Latency depends on the model provider.** Output speed on the free Mistral plan varies from ~20 to ~90 tokens/s. During slow periods even a short document can hit the 27 s budget and fail with "Analiza nie zmieściła się w limicie czasu"; retrying usually works.
- **Chunked analysis of longer documents is off by default.** On the free Mistral plan parallel requests are throttled, and two sequential chunk calls plus the merge call take ~30 s, more than the budget. `MAX_CHUNKS=2` enables it on a plan with real parallel requests.
- Lists are capped (e.g. at most 10 amounts and 10 dates), so a document with more keeps only the most important ones.
- No OCR: scanned PDFs without a text layer are rejected.
- Free-tier quotas: Mistral ~30 requests/min, Gemini ~20 requests/day; the API allows 5 analyses per minute per IP.

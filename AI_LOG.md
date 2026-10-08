# AI log

How AI tools were used to build PDF Insight, which prompts mattered most, and where the AI got things wrong.

## Tools used

- **Claude** (chat): planning, breaking the brief into stages, and writing the implementation prompts.
- **Claude Code** (CLI agent): implementation, tests, refactors, git commits, and checks against the running app.

<!-- TODO(Mateusz): add model versions and any other tools you used (e.g. for the brief analysis or design). -->

## Workflow

- **`CLAUDE.md` as project context.** It holds the stack, the data flow, the result schema and the hard rules (no API key in the frontend or in git, no `any`/`console.log`/`dangerouslySetInnerHTML`, Polish UI copy, accessibility, CI order). Claude Code loads it in every session, so every stage starts from the same constraints.
- **One prompt per stage.** Each stage (scaffold, schema, PDF extraction, API, results view, provider switch, performance, long documents, history and polish) was a separate prompt with a clear scope and "do not change the API contract or the schema" where relevant.
- **Small, reviewed commits.** Every diff was reviewed before committing; commits follow Conventional Commits and each one is a single logical step (see `git log`).
- **Verification before trust.** Lint, typecheck, unit tests and build had to pass with zero warnings before a commit; production behaviour was checked with real requests, not assumed.

<!-- TODO(Mateusz): add your own notes on how you reviewed diffs and what you changed by hand. -->

## Key prompts

<!--
TODO(Mateusz): this file was empty in the repository, so the earlier prompts are not here yet.
Paste 3–5 of your key prompts below (trimmed to the essential parts), for example:
- the initial planning prompt that produced CLAUDE.md,
- the API / LLM integration prompt,
- the prompt that switched to Mistral with Gemini as a fallback,
- the performance / time budget prompt.
-->

### Final features and polish (trimmed)

> Read CLAUDE.md first and follow it strictly. Scope: final features and polish. Do not change the API contract or the result schema.
>
> 1. F-09 — analysis history: store the last 10 analyses in localStorage (versioned key). Validate every entry with AnalysisResultSchema on read and silently drop invalid ones. Wrap all storage access in try/catch. Same document (same fileName + summary) replaces the older entry. "Ostatnie analizy" list, open without calling the API, per-entry delete, "Wyczyść historię" with confirmation, empty state, note that history stays in this browser. Unit tests.
> 2. Accessibility and responsive audit: every state at 360 px, 768 px and desktop; keyboard-only flow; focus to the results heading and to the error; WCAG AA contrast including aria-disabled; prefers-reduced-motion; run axe against the built app in each state and fix all violations; scan for leftover English strings.
> 3. Security and standards check, each item pass/fail: git history for keys and env files, grep for any/console.log/dangerouslySetInnerHTML, CORS with a foreign Origin, rate limit and body limit codes, env examples, CI order.
> 4. README and 5. AI_LOG restructure. Describe only things that actually happened — do not invent incidents.
> 5. Final check against the brief as a pass/fail table with evidence.

## Where the AI was wrong and how it was fixed

Each case below can be traced in the git history.

1. **zod leaked into the initial web bundle** (`4d6eb47`). The shared package called `toJSONSchema()` at module top level and was not marked side-effect free, so importing only constants pulled all of zod into the first bundle. The fix: `"sideEffects": false` and moving the JSON Schema generation into its own module (239 kB → 149 kB).
2. **The first LLM provider hit free-tier limits.** Gemini's free tier (~5 requests/min, ~20/day for the whole key) was used up by testing, and the worker answered with 429/502/504.
   - At first the per-IP limit (10/min) did not match the upstream quota, and an upstream 429 was reported as "service unavailable". Fixed in `ce40fcd` (limit 5/min, upstream 429 → `RATE_LIMITED`) and `ddd9427` (neutral message).
   - While diagnosing those errors, Claude Code proposed deploying a temporary logging build to the production worker. That was rejected; the cause turned out to be the quota, not a bug. The rule since then: diagnose locally with `wrangler dev`, never deploy debug builds to production.
   - Long-term fix: provider interface (`47b751a`), Mistral as primary with Gemini as fallback (`ca08b48`), KV cache so repeated documents do not use quota (`b93d5d2`).
3. **The chosen Mistral model had no quota** (`befbbeb`). The AI picked Mistral Small, which has a quota of 0 on the free Experiment plan, so every request got an immediate 429. It also sent `reasoning_effort`, which non-reasoning models reject with HTTP 400. The `x-ratelimit-limit-*` headers checked locally showed the 0 quota. The fix was switching to `ministral-8b-2512`, after measuring 3B, 8B and 14B, and dropping the parameter.
4. **Retry + timeout exceeded the 30 s target** (`c0ac004`). Mistral (20 s) and the Gemini fallback (25 s) had independent timeouts, so a slow first attempt still started a fallback long after 30 s. The fix: one 27 s request budget shared by all attempts, and no retry or fallback with less than 8 s left.
5. **Map–reduce for long documents did not fit the budget** (`4505eb9`). The assumption that chunking would keep long documents fast was wrong on the free plan: the chunked path worked in tests, but on the free plan parallel calls are throttled, so two chunks plus the merge took ~30 s. Benchmarks showed one call handles ~50k tokens in ~20–25 s, so production uses a single call and an upfront `TEXT_TOO_LONG` above that. The chunked path stays available behind `MAX_CHUNKS`.
6. **Stale local dev check after the provider switch** (found in the final audit). `scripts/dev.mjs` still required the Gemini key (`LLM_API_KEY`) after Mistral became primary. It now accepts either key.
7. **Invalid ARIA on the JSON preview** (found in the final audit). The scrollable `<pre>` had `aria-label` without a role, so the label was not reliably exposed. It is now a labelled `region`, and the Playwright suite checks that it is reachable by keyboard.

<!-- TODO(Mateusz): add tooling version conflicts if you hit any (e.g. during the monorepo setup); they are not visible in the git history, so they are not listed here. -->
<!-- TODO(Mateusz): add your own notes: what you caught in review, what you changed by hand, what you would do differently. -->

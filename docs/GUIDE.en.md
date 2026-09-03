<div align="center">

# Full Guide

[简体中文](./GUIDE.md) · **English** · [← Back to README](../README.en.md)

</div>

---

## Contents

- [Architecture](#architecture)
- [Daily pipeline](#daily-pipeline)
- [Relevance scoring](#relevance-scoring)
- [One-click review](#one-click-review)
- [Storage](#storage)
- [Frontend](#frontend)
- [Configuration](#configuration)
- [Gotchas](#gotchas)

## Architecture

A local cron job drives the pipeline; a single-page frontend reads the resulting
`.jsonl`; a small backend on the **host** (not in a container) serves bookmarks
and reviews from one sqlite file.

The backend runs on the host because it shells out to the Claude Code / Codex CLI
you are logged into — the credentials live in `~/.claude` / `~/.codex` and the
runtime is node. Putting that inside a Python container would mean installing node
and mounting credentials for no benefit. nginx in the container reverse-proxies to
the host instead.

Bookmarks and reviews share one database on purpose: "what did the review say
about this paper I saved?" is then a single SQL join instead of two round trips.

## Daily pipeline

`run-local.sh`: auth preflight → crawl `arxiv.org/list/<cat>/new` → dedupe against
the last 7 days → score + summarize → tag sub-directions → render Markdown →
refresh the file list. Steps 3.5 and 4 only warn on failure; the rest abort.

The crawler reads each category's `/new` page, which **includes cross-listed
papers**, and dedupes by id. So a category like `cs.AI` that is cross-listed
everywhere usually needs no separate entry — it already arrives via other
categories.

## Relevance scoring

`ai/research_focus.txt` is the *sole* basis for scoring.

*Stage 1* (fast tier, batched) scores every paper 0–10 and writes a full
five-section summary, so nothing is left contentless. *Stage 2* (deep tier,
per paper) rewrites those summaries for papers scoring at least
`RELEVANCE_THRESHOLD` and within the day's top `DEEP_TOP_K`.

`DEEP_TOP_K` is a **cost gate**. In practice the number of papers clearing the
threshold often exceeds the default 60, which means some qualifying papers only
get the fast-tier summary. The stats page shows exactly how many missed the cut.

Be concrete when writing your focus — the model aligns on specific vocabulary.
"LLM-assisted static analysis: taint analysis, dataflow, symbolic execution,
vulnerability detection, SAST" works far better than "machine learning". If a
direction spans both algorithms and systems/hardware, list keywords for both,
otherwise on-topic systems papers get scored down for *looking* like systems papers.

Output uses `@@MARKER@@` delimiters rather than JSON: long summaries containing
quotes, backslashes and LaTeX break JSON parsing but not markers.

## One-click review

<div align="center">
<img src="../images/ui-review.png" width="90%" alt="One-click review">
</div>

**Stage 1** (fast tier) reads the locally stored title and abstract and picks a
venue from a **fixed whitelist of 27 venues**, returning **only an index**. The
whitelist is the injection defence: arXiv abstracts are untrusted input, and
constraining the output to an index means a prompt injection can at worst pick the
wrong venue — it cannot change the output shape or reach the second prompt.

**Stage 2** writes the review as a reviewer *for that venue*, with Quick / Normal /
Deep selecting the fast / mid / deep tier (180s / 300s / 600s timeouts and
increasing required depth). Eight sections come back: summary, strengths,
weaknesses, detailed comments, questions, rating (1–10), recommendation
(accept / minor / major / reject) and confidence (1–5).

### Security boundary

- The request body accepts **only** `{id, date, mode}`, each validated against a
  regex or whitelist, capped at 512 bytes.
- **Title and abstract are always looked up server-side by id** from the local
  `.jsonl`. Any text in the request is discarded — the prompt's content is never
  under the caller's control.
- The submission is wrapped in tags with an explicit instruction that it is
  material under review, not instructions.
- Rating / recommendation / confidence are clamped to legal values server-side.
- The backend **never returns model-generated HTML** — only structured fields,
  which the frontend inserts via `textContent`.

Results are persisted, so repeat clicks are free; `GET /api/review?id=…` is
read-only and never triggers a new review, which is what makes results survive
view switches, reloads and other devices.

## Storage

`var/store.sqlite3` holds two tables keyed by `(user, …)`. `rating`,
`recommend` and `confidence` are promoted to columns so the bookmark list can
filter and sort without parsing JSON. WAL is on so the frontend can read while a
review is running.

> ⚠️ Never point `ARXIV_STORE_DIR` at an sshfs/NFS mount — sqlite's locking is
> unreliable on FUSE and **will silently corrupt data**. Local disk only.

> ⚠️ The repository *is* the web root, so `deploy/web.conf.template` explicitly
> denies `/var/`, `/deploy/` and `*.sqlite3`; otherwise the database would be
> directly downloadable.

`user` comes from the `X-Auth-User` header your reverse proxy sets from
`$remote_user`. `proxy_set_header` overrides any client-supplied value, so it
cannot be forged. Absent that header it falls back to `default` — which is the
usual migration trap: importers write `user='default'` while real traffic is
`user='<your login>'`, making bookmarks appear to vanish. Fix with
`python3 deploy/api/server.py --rekey default <your login>`.

## Frontend

Hash routing (`#/papers`, `#/marked`, `#/stats`, `#/settings`) rather than the
History API, because a static host would otherwise need a rewrite rule for every
path. `js/theme.js` must load synchronously and before the stylesheets so the
theme is set before first paint.

Chart colours come from a validated categorical palette (adjacent-pair CVD ΔE ≥ 8,
normal-vision ΔE ≥ 15, all ≥ 3:1 on the dark surface). They deliberately do **not**
follow the black/white/green theme — eight series squeezed into one hue are
unreadable. Every chart ships a crosshair with a unified tooltip, a toggleable
legend, a table view, and folds anything past eight series into "Other". Lines use
`curveMonotoneX`, not a Bézier smooth that would invent peaks between data points.

## Configuration

Everything lives in `.env.local` (copy from `.env.local.example`).

| Variable | Default | Notes |
|---|---|---|
| `CATEGORIES` | `cs.CR,cs.SE,cs.LG,cs.CL` | comma-separated, ordered by relevance |
| `LANGUAGE` | `Chinese` | `Chinese` or `English` only |
| `LLM_PROVIDER` | auto | `claude` or `codex`; auto-detected from PATH, claude first |
| `CLAUDE_MODEL_FAST/MID/DEEP` | `haiku`/`sonnet`/`opus` | the three tiers |
| `CODEX_MODEL_FAST/MID/DEEP` | unset | unset means your `~/.codex/config.toml` default |
| `CLAUDE_BIN` / `CODEX_BIN` | PATH | **cron's PATH is minimal — use absolute paths** |
| `RELEVANCE_THRESHOLD` | `6` | below this, no deep-tier rewrite |
| `DEEP_TOP_K` | `60` | **cost gate**: how many papers get the deep tier per day |
| `PREFILTER_BATCH` | `8` | smaller batches parse more reliably |
| `PREFILTER_WORKERS` / `DEEP_WORKERS` | `4` / `3` | concurrency |
| `REVIEW_BIND` | `127.0.0.1` | bind the docker bridge address if nginx is containerised; **never `0.0.0.0`** |
| `REVIEW_PORT` | `8801` | |
| `REVIEW_MAX_CONCURRENT` | `2` | returns 429 beyond this |
| `ARXIV_STORE_DIR` | `<repo>/var` | sqlite directory, local disk only |
| `ARXIV_LANGUAGE` | `Chinese` | see the gotcha below |

## Gotchas

**`LANGUAGE` is a POSIX locale variable** and is often already `zh_CN:en` in a
desktop session. A long-running service inherits it and builds filenames like
`..._AI_enhanced_zh_CN:en.jsonl`, which never match. The backend therefore reads
`ARXIV_LANGUAGE` and only accepts known values.

**cron failures** are almost always PATH or HOME: node (hence claude/codex) lives
under nvm and is not on cron's PATH, and without HOME the CLI cannot read its
credentials. Point crontab at `scripts/cron-wrapper.sh`, which fixes both.

**Deep review returning 504** means one of the two nginx layers still has the
default 60s `proxy_read_timeout`. Both need raising.

**Empty sub-direction chart** means the day's data has no `trend_tags` yet — run
`ai/trend_tagger.py` over that day's file.

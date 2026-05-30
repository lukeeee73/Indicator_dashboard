# Daily Market Analysis Routine

**Routine ID**: `daily-market-analysis`  
**Trigger**: Manual or scheduled  
**Purpose**: Collect qualitative news signals for watchlist tickers and push structured JSON + wiki markdown to GitHub

---

## Overview

This routine performs a **sector round-robin** across all watchlist tickers, collecting recent news (past 7 days), scoring narrative impact, and persisting results to two repositories:

1. **`Indicator_dashboard`** — structured JSON under `data/news/<TICKER>/<DATE>.json`
2. **`luke_wiki`** — human-readable markdown under `wiki/news/<TICKER> - <Company>.md`

---

## Watchlist

### 에너지 / 원자재 (Energy & Materials)
| Ticker | Company | Sector |
|--------|---------|--------|
| XOM | Exxon Mobil Corporation | Oil & Gas |
| CVX | Chevron Corporation | Oil & Gas |
| COP | ConocoPhillips | Oil & Gas |
| SHEL | Shell plc | Oil & Gas |
| OXY | Occidental Petroleum | Oil & Gas |
| SLB | Schlumberger Limited | Oilfield Services |
| FCX | Freeport-McMoRan Inc. | Copper Mining |
| NEM | Newmont Corporation | Gold Mining |
| LIN | Linde plc | Industrial Gases |
| APD | Air Products and Chemicals | Industrial Gases |

### 유틸리티 / 전력 (Utilities & Power)
| Ticker | Company | Sector |
|--------|---------|--------|
| NEE | NextEra Energy, Inc. | Renewable Utility |
| SO | The Southern Company | Regulated Utility |
| DUK | Duke Energy Corporation | Regulated Utility |
| AEP | American Electric Power | Regulated Utility |
| EXC | Exelon Corporation | Regulated Utility |
| CEG | Constellation Energy | Nuclear Power |
| VST | Vistra Corp. | Power Generation |
| SRE | Sempra | Gas/LNG Utility |
| ED | Consolidated Edison | Regulated Utility |
| D | Dominion Energy, Inc. | Regulated Utility |

---

## Execution Steps

### Step 1: Date Setup
```
analysis_date = yesterday (YYYY-MM-DD)
as_of_utc = yesterday at 21:00 UTC
```

### Step 2: Per-Ticker News Collection

For each ticker in the watchlist:

1. **Search** for recent news (past 7 days) using WebSearch
2. **Collect** 3-5 most impactful headlines with:
   - `title`: headline text
   - `source`: publication name
   - `url`: direct link
   - `published`: ISO datetime
   - `summary`: 1-2 sentence Korean summary
   - `impact`: `+`, `-`, or `0`
   - `category`: `earnings` | `macro` | `regulatory` | `m&a` | `other`
3. **Collect competitor context** (1-2 items): what happened at peer companies and how it affects the target ticker
4. **Score** four dimensions (-1.0 to +1.0):
   - `earnings_outlook`: near-term earnings trajectory
   - `competitive_position`: market share / strategic positioning
   - `regulatory_risk`: regulatory headwinds or tailwinds
   - `macro_sensitivity`: sensitivity to macro (oil price, rates, etc.)
5. **Compute** `narrative_score` = weighted average of scores
6. **Write** `summary_kr`, `key_events[]`, `risks[]`

### Step 3: Build JSON Payload

For each ticker, build `data/news/<TICKER>/<DATE>.json`:

```json
{
  "ticker": "XOM",
  "date": "YYYY-MM-DD",
  "as_of_utc": "YYYY-MM-DDT21:00:00Z",
  "news": [ ... ],
  "competitor_context": [ ... ],
  "scores": {
    "earnings_outlook": 0.0,
    "competitive_position": 0.0,
    "regulatory_risk": 0.0,
    "macro_sensitivity": 0.0
  },
  "narrative_score": 0.0,
  "summary_kr": "...",
  "key_events": [ ... ],
  "risks": [ ... ],
  "wiki_url": "https://github.com/lukeeee73/luke_wiki/blob/<branch>/wiki/news/<TICKER>%20-%20<Company>.md"
}
```

### Step 4: Build Wiki Markdown Payload

For each ticker, **append** to (or create) `wiki/news/<TICKER> - <Company>.md`:

```markdown
---
title: "<TICKER> - <Company> — Routine News Log"
created: <first_date>
updated: <today>
...
---

# <TICKER> - <Company> — Routine News Log

## 회사 소개
<2-3 sentence Korean description>

## 미해결 가설 (Open Claims)
<!-- OPEN_CLAIMS_START -->
- [ ] **<date>**: <hypothesis> (pending)
<!-- OPEN_CLAIMS_END -->

## 사실 누적 (Verified Facts)
<!-- FACTS_START -->
<!-- FACTS_END -->

## 일자별 기록 (역순)
<!-- DAILY_START -->
### <DATE>
**narrative_score**: <score>
**key_events**: <comma-separated>
**risks**: <comma-separated>

> [!claim] (<source>, <date>) <headline>
> <summary> impact: <+/-> / category: <cat>

**경쟁사 동향**:
- <TICKER>: <summary>
<!-- DAILY_END -->
```

**Important**: When updating an existing wiki file:
- Insert new daily entry **inside** `<!-- DAILY_START -->` / `<!-- DAILY_END -->` tags (at the top, newest first)
- Insert new open claims **inside** `<!-- OPEN_CLAIMS_START -->` / `<!-- OPEN_CLAIMS_END -->` tags
- Do NOT remove existing entries

### Step 5: Parallel Push

Push **both** repos simultaneously using `mcp__github__push_files`:

**Push 1 — Indicator_dashboard**:
- repo: `lukeeee73/Indicator_dashboard`
- branch: current active branch (check `.claude/state.json` or use `claude/build-indicators-pipeline-QFtLk`)
- commit: `chore(news): daily qualitative analysis (<DATE>)`
- files: all `data/news/<TICKER>/<DATE>.json` files + `.claude/routines/daily-market-analysis.md`

**Push 2 — luke_wiki**:
- repo: `lukeeee73/luke_wiki`
- branch: `claude/create-knowledge-repo-2LeNp`
- commit: `[routine-news] daily watchlist update <DATE> (에너지/원자재, 유틸리티/전력)`
- files: all `wiki/news/<TICKER> - <Company>.md` files + `wiki/news/_dashboard.md`

### Step 6: Report

After both pushes succeed, output:
```
## Daily Market Analysis Complete

**Date**: <analysis_date>
**Tickers processed**: <N>
**Sectors**: 에너지/원자재, 유틸리티/전력

### Push Results
| Repo | Branch | Files | Commit |
|------|--------|-------|--------|
| Indicator_dashboard | <branch> | <N> | <sha> |
| luke_wiki | <branch> | <N> | <sha> |

### Score Summary
| Ticker | Score | Key Signal |
|--------|-------|------------|
...
```

---

## Output Schema

### narrative_score Interpretation
| Range | Meaning |
|-------|---------|
| +0.20 to +1.0 | Strong positive momentum |
| +0.05 to +0.19 | Mild positive |
| -0.04 to +0.04 | Neutral |
| -0.05 to -0.19 | Mild negative |
| -0.20 to -1.0 | Strong negative momentum |

### Score Weights
```
earnings_outlook:    0.40
competitive_position: 0.25
regulatory_risk:     0.20
macro_sensitivity:   0.15
```

---

## File Naming Conventions

- JSON: `data/news/<TICKER>/<YYYY-MM-DD>.json`
- Wiki: `wiki/news/<TICKER> - <Full Company Name>.md`
- Dashboard: `wiki/news/_dashboard.md`

---

## Sector Round-Robin Order

Always process in this order to ensure consistent git history:

1. XOM, CVX, COP, SHEL, OXY (Oil & Gas)
2. SLB (Oilfield Services)
3. FCX, NEM (Mining)
4. LIN, APD (Industrial Gases)
5. NEE, SO, DUK, AEP, EXC (Regulated Utilities)
6. CEG, VST (Power Generation)
7. SRE, ED, D (Gas/LNG + NYC Utility + Dominion)

---

## Notes

- All summaries in **Korean** (summary_kr field)
- Scores bounded to [-1.0, +1.0]
- `narrative_score` is the composite weighted score
- Wiki files use Obsidian-compatible callout syntax (`> [!claim]`)
- Do not create PRs — push directly to branch
- The `wiki_url` field in JSON points to the corresponding wiki page on the wiki branch

"""미국 기준금리 변동 감지 → Claude Managed Agent 시장 리포트.

흐름 (매일 .github/workflows/rate-watch.yml 이 실행):
  1. FRED 에서 FOMC 목표 범위 상·하단(DFEDTARU / DFEDTARL)을 받아
     가장 최근의 변경 시점을 찾는다. LLM 호출 없음 — 변동이 없으면 여기서 끝.
  2. data/reports/rates/index.json 의 last_change 보다 새로운 변경이면
     달러·금리·위험자산 시계열 스냅샷을 FRED 에서 받아 킥오프 메시지를 만든다.
  3. managed_agents/agents/rate-watch.md 로 만든 에이전트의 세션을 열고
     outcome(루브릭)으로 report.json 을 받아 data/reports/rates/<date>.json 에 저장,
     index.json 을 갱신한다. 대시보드(js/rate-reports.js)가 이 파일을 읽는다.

환경 변수:
  FRED_API_KEY                  FRED API 키 (필수)
  ANTHROPIC_API_KEY             Claude API 키 (세션 실행 시)
  RATE_WATCH_AGENT_ID           ant apply 가 claude-lock.json 에 기록한 agent ID
  RATE_WATCH_ENVIRONMENT_ID     같은 파일의 environment ID
  RATE_WATCH_BUDGET_CENTS       세션 비용 상한(센트, 기본 500 = $5)

옵션:
  --check-only   변동 여부만 출력 (Claude 호출 없음)
  --force        이미 보고한 최신 변경이라도 리포트를 다시 만든다
  --dry-run      킥오프 메시지만 출력하고 세션은 열지 않는다
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import requests

if __package__:
    from .data_io import read_json, write_json
else:
    from data_io import read_json, write_json


REPO_ROOT = Path(__file__).resolve().parents[1]
REPORTS_DIR = REPO_ROOT / "data" / "reports" / "rates"
INDEX_PATH = REPORTS_DIR / "index.json"

FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations"
REQUEST_TIMEOUT = 60

TARGET_UPPER = "DFEDTARU"
TARGET_LOWER = "DFEDTARL"

# 킥오프에 넣는 시장 스냅샷 — 대시보드가 다루는 달러·금리·물가기대·위험자산.
SNAPSHOT_SERIES: dict[str, dict[str, str]] = {
    "DGS2":         {"label": "미 국채 2년", "unit": "%"},
    "DGS10":        {"label": "미 국채 10년", "unit": "%"},
    "T10Y2Y":       {"label": "10년-2년 금리차", "unit": "%p"},
    "T10YIE":       {"label": "10년 기대인플레이션(BEI)", "unit": "%"},
    "DTWEXBGS":     {"label": "달러 광의 지수", "unit": "index"},
    "DEXKOUS":      {"label": "원/달러 환율", "unit": "KRW"},
    "SP500":        {"label": "S&P 500", "unit": "index"},
    "VIXCLS":       {"label": "VIX", "unit": "index"},
    "BAMLH0A0HYM2": {"label": "미 하이일드 스프레드", "unit": "%"},
}
SNAPSHOT_LOOKBACK_DAYS = 45

SESSION_DEADLINE_SEC = 30 * 60
REQUIRED_SECTION = "원화·한국 영향"

# 출력물 검증 기준. 에이전트 쪽 grader 가 쓰는 루브릭 — 결과를 보며 조정한다.
STARTER_RUBRIC = f"""# Rate-change report rubric (starter — tune as needed)
- Exactly one file exists: /mnt/session/outputs/report.json, and it parses as JSON.
- It has every top-level key: decision_date, headline, summary, decision, sections, market_reaction, watch_next, sources.
- decision.previous_range, decision.new_range and decision.change_bp match the change given in the kickoff message.
- headline is Korean and at most 60 characters; summary is 3 to 5 Korean sentences.
- sections has 3 to 5 entries, each with non-empty title and body, and one title is exactly "{REQUIRED_SECTION}".
- Every number in market_reaction comes from the FRED snapshot in the kickoff message, or from a page listed in sources.
- The FOMC statement for the decision date on federalreserve.gov is cited in sources; every source has an https URL.
- verdict exists: stance is one of hawkish/neutral/dovish, conclusion is one Korean sentence of at most 40 characters, confidence is a number from 0 to 1,
  key_metrics has 3 to 5 entries that repeat numbers from market_reaction, and vs_previous is filled in (or says there is no earlier report).
- No string contains Markdown or HTML markup, and the report gives no buy/sell recommendation.
- If the snapshot has no observation after the decision date, the report says reaction data is not yet available instead of describing a reaction.
"""


# --------------------------------------------------------------------------
# FRED
# --------------------------------------------------------------------------
def fetch_series(series_id: str, api_key: str, start_date: str) -> list[dict]:
    """FRED 관측값을 [{'date', 'value'}] 로 반환 (결측 '.' 제외)."""
    params = {
        "series_id": series_id,
        "api_key": api_key,
        "file_type": "json",
        "observation_start": start_date,
    }
    resp = requests.get(FRED_BASE_URL, params=params, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    out: list[dict] = []
    for obs in resp.json().get("observations", []):
        try:
            out.append({"date": obs["date"], "value": float(obs["value"])})
        except (KeyError, TypeError, ValueError):
            continue
    return out


# --------------------------------------------------------------------------
# 변동 감지 (순수 함수)
# --------------------------------------------------------------------------
def find_latest_change(upper: list[dict], lower: list[dict]) -> Optional[dict]:
    """목표 범위가 마지막으로 바뀐 날짜와 전후 범위를 찾는다.

    상·하단을 날짜로 맞춘 뒤, 직전 관측과 범위가 달라진 가장 최근 날짜를 반환한다.
    """
    lower_by_date = {p["date"]: p["value"] for p in lower}
    pairs = [(p["date"], lower_by_date[p["date"]], p["value"])
             for p in sorted(upper, key=lambda p: p["date"]) if p["date"] in lower_by_date]
    for i in range(len(pairs) - 1, 0, -1):
        date, lo, hi = pairs[i]
        _, prev_lo, prev_hi = pairs[i - 1]
        if (lo, hi) != (prev_lo, prev_hi):
            return {
                "date": date,
                "previous": {"lower": prev_lo, "upper": prev_hi},
                "current": {"lower": lo, "upper": hi},
                "change_bp": round((hi - prev_hi) * 100),
            }
    return None


def is_new_change(change: Optional[dict], index: dict) -> bool:
    if change is None:
        return False
    last = (index.get("last_change") or {}).get("date")
    return last is None or change["date"] > last


def fmt_range(r: dict) -> str:
    return f"{r['lower']:.2f}–{r['upper']:.2f}%"


def summarize_series(series: list[dict], decision_date: str) -> dict:
    """결정일 직전 값, 결정일부터 5개 관측(즉각 반응), 최신 값, 최근 관측 10개.

    변경을 며칠 늦게 처리해도(--force 재생성 등) 결정 직후 반응을 볼 수 있게
    after_decision 을 따로 둔다.
    """
    before = [p for p in series if p["date"] < decision_date]
    after = [p for p in series if p["date"] >= decision_date]
    return {
        "before": before[-1] if before else None,
        "after_decision": after[:5],
        "latest": series[-1] if series else None,
        "has_post_decision_data": bool(after),
        "recent": series[-10:],
    }


def previous_verdict(index: dict, change_date: str) -> Optional[dict]:
    """직전 리포트의 판단(index 항목) — 새 리포트가 '이전 대비'를 쓰도록 킥오프에 넣는다."""
    for r in index.get("reports", []):
        if r.get("date", "") < change_date and r.get("stance"):
            return {k: r.get(k) for k in ("date", "new_range", "stance", "conclusion", "confidence")}
    return None


def build_kickoff(change: dict, snapshot: dict[str, dict], previous: Optional[dict] = None) -> str:
    lines = [
        f"The US federal funds target range changed, effective {change['date']} "
        "(FRED dates the range on its effective date, usually the day after the FOMC announcement; "
        "check the statement for the actual announcement date):",
        f"  previous {fmt_range(change['previous'])} -> new {fmt_range(change['current'])}"
        f" ({change['change_bp']:+d} bp). Source: FRED DFEDTARL/DFEDTARU.",
        "",
        "FRED market snapshot, fetched just now "
        f"({datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}).",
        "'before' is the last observation before the likely announcement day "
        "(effective date minus one day); 'after_decision' is the first 5 observations from that day (the immediate reaction); 'latest' and 'recent' (last 10) "
        "show where each series stands now.",
        "",
        json.dumps(
            {sid: {**SNAPSHOT_SERIES[sid], **data} for sid, data in snapshot.items()},
            ensure_ascii=False, indent=1,
        ),
        "",
        "Previous report's verdict (for verdict.vs_previous): "
        + (json.dumps(previous, ensure_ascii=False) if previous else "none - this is the first report with a verdict."),
        "",
        "Write the report described in your instructions to /mnt/session/outputs/report.json.",
    ]
    return "\n".join(lines)


# --------------------------------------------------------------------------
# 리포트 검증·저장 (순수 함수)
# --------------------------------------------------------------------------
REQUIRED_KEYS = ("decision_date", "headline", "summary", "decision",
                 "sections", "market_reaction", "watch_next", "sources")


STANCES = ("hawkish", "neutral", "dovish")
STANCE_LABELS = {"hawkish": "매파", "neutral": "중립", "dovish": "비둘기"}


def validate_verdict(verdict: Any) -> list[str]:
    """verdict 블록 검사. 대시보드 카드·필터가 이 필드만 읽는다."""
    if not isinstance(verdict, dict):
        return ["verdict must be an object"]
    errors = []
    if verdict.get("stance") not in STANCES:
        errors.append(f"verdict.stance must be one of {STANCES}")
    if not isinstance(verdict.get("conclusion"), str) or not verdict["conclusion"].strip():
        errors.append("verdict.conclusion must be a non-empty string")
    conf = verdict.get("confidence")
    if isinstance(conf, bool) or not isinstance(conf, (int, float)) or not 0 <= conf <= 1:
        errors.append("verdict.confidence must be a number between 0 and 1")
    metrics = verdict.get("key_metrics")
    if not isinstance(metrics, list) or not metrics or not all(
        isinstance(m, dict) and isinstance(m.get("label"), str)
        and isinstance(m.get("value"), (int, float)) and not isinstance(m.get("value"), bool)
        for m in metrics
    ):
        errors.append("verdict.key_metrics must be a non-empty list of {label, value, unit, change}")
    vs = verdict.get("vs_previous")
    if not isinstance(vs, dict) or not isinstance(vs.get("delta"), str):
        errors.append("verdict.vs_previous must be an object with a delta string")
    return errors


def report_tags(change_bp: Any, verdict: Optional[dict]) -> list[str]:
    """index 필터 칩용 태그: 방향(인상·인하·동결) + 판단(매파·중립·비둘기)."""
    tags = ["동결" if not change_bp else ("인상" if change_bp > 0 else "인하")]
    if verdict and verdict.get("stance") in STANCE_LABELS:
        tags.append(STANCE_LABELS[verdict["stance"]])
    return tags


def validate_report(report: Any) -> list[str]:
    """대시보드가 렌더링할 수 있는 모양인지 확인. 문제 목록을 반환 (빈 목록 = 통과)."""
    if not isinstance(report, dict):
        return ["report is not a JSON object"]
    errors = [f"missing key: {k}" for k in REQUIRED_KEYS if k not in report]
    if errors:
        return errors
    for key in ("decision_date", "headline", "summary"):
        if not isinstance(report[key], str) or not report[key].strip():
            errors.append(f"{key} must be a non-empty string")
    if not isinstance(report["decision"], dict):
        errors.append("decision must be an object")
    sections = report["sections"]
    if not isinstance(sections, list) or not all(
        isinstance(s, dict) and isinstance(s.get("title"), str) and isinstance(s.get("body"), str)
        for s in sections
    ):
        errors.append("sections must be a list of {title, body}")
    elif REQUIRED_SECTION not in {s["title"] for s in sections}:
        errors.append(f"sections must include '{REQUIRED_SECTION}'")
    # verdict 는 선택 — 에이전트를 다시 apply 하기 전에도 파이프라인이 멈추지 않게 한다.
    if "verdict" in report:
        errors.extend(validate_verdict(report["verdict"]))
    for key in ("market_reaction", "watch_next", "sources"):
        if not isinstance(report[key], list):
            errors.append(f"{key} must be a list")
    if isinstance(report["sources"], list):
        for s in report["sources"]:
            if not isinstance(s, dict) or not str(s.get("url", "")).startswith("https://"):
                errors.append("every source needs an https url")
                break
    return errors


def record_report(index: dict, change: dict, report: dict, session_id: str) -> dict:
    """index.json 에 새 리포트를 맨 앞에 추가 (같은 날짜는 교체)."""
    entry = {
        "date": change["date"],
        "headline": report["headline"],
        "change_bp": change["change_bp"],
        "new_range": fmt_range(change["current"]),
        "file": f"{change['date']}.json",
        "session_id": session_id,
        "tags": report_tags(change["change_bp"], report.get("verdict")),
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    verdict = report.get("verdict")
    if isinstance(verdict, dict):
        entry.update(stance=verdict["stance"], conclusion=verdict["conclusion"],
                     confidence=verdict["confidence"])
    reports = [r for r in index.get("reports", []) if r.get("date") != change["date"]]
    return {**index, "last_change": change, "reports": [entry, *reports]}


# --------------------------------------------------------------------------
# Claude Managed Agent 세션
# --------------------------------------------------------------------------
def run_agent_session(client, agent_id: str, environment_id: str, change: dict,
                      kickoff: str, budget_cents: str) -> tuple[str, dict]:
    """세션을 열고 outcome 이 끝날 때까지 스트림을 따라간 뒤 report.json 을 반환."""
    session = client.beta.sessions.create(
        agent=agent_id,
        environment_id=environment_id,
        title=f"FOMC rate change {change['date']}",
        metadata={"source": "rate_watch", "decision_date": change["date"]},
        budget={"type": "limit", "max_list_cost": {"amount": budget_cents, "currency": "USD"}},
    )
    print(f"Session: {session.id}")
    print(f"Trace:   https://platform.claude.com/workspaces/default/sessions/{session.id}")

    deadline = time.monotonic() + SESSION_DEADLINE_SEC
    # stream-first: 스트림을 연 뒤 킥오프를 보낸다.
    with client.beta.sessions.events.stream(session_id=session.id) as stream:
        client.beta.sessions.events.send(
            session_id=session.id,
            events=[
                {"type": "user.message", "content": [{"type": "text", "text": kickoff}]},
                {
                    "type": "user.define_outcome",
                    "description": "Write the FOMC rate-change market report as /mnt/session/outputs/report.json",
                    "rubric": {"type": "text", "content": STARTER_RUBRIC},
                    "max_iterations": 3,
                },
            ],
        )
        for event in stream:
            if time.monotonic() > deadline:
                raise TimeoutError(f"session {session.id} exceeded {SESSION_DEADLINE_SEC}s")
            etype = event.type
            if etype in ("agent.tool_use", "agent.mcp_tool_use"):
                name = getattr(event, "name", "?")
                print(f"  tool: {name}")
                if getattr(event, "evaluated_permission", None) == "ask":
                    # 무인 실행 — 서버가 판단하지 못한 호출은 거절한다.
                    client.beta.sessions.events.send(
                        session_id=session.id,
                        events=[{
                            "type": "user.tool_confirmation",
                            "tool_use_id": event.id,
                            "result": "deny",
                            "deny_message": "Unattended run: this call was not auto-approved. "
                                            "Continue without it.",
                        }],
                    )
            elif etype == "span.outcome_evaluation_end":
                print(f"  grader iteration {event.iteration}: {event.result}")
            elif etype == "session.error":
                print(f"  session error: {event}", file=sys.stderr)
            elif etype == "session.status_idle":
                if event.stop_reason.type != "requires_action":
                    print(f"  idle: {event.stop_reason.type}")
                    break
            elif etype == "session.status_terminated":
                print("  terminated")
                break

    return session.id, download_report(client, session.id)


def download_report(client, session_id: str) -> dict:
    # 세션이 idle 이 된 뒤 출력 파일이 목록에 잡히기까지 1~3초 걸린다.
    for attempt in range(5):
        files = client.beta.files.list(scope_id=session_id, betas=["managed-agents-2026-04-01"])
        for f in files.data:
            if f.filename.endswith("report.json"):
                raw = client.beta.files.download(f.id).read()
                return json.loads(raw.decode("utf-8"))
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"session {session_id} produced no report.json")


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------
def set_output(name: str, value: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"{name}={value}\n")


LOCK_PATH = REPO_ROOT / "managed_agents" / "claude-lock.json"


def resolve_resource_ids() -> tuple[Optional[str], Optional[str]]:
    """환경 변수 우선, 없으면 ant apply 가 쓴 claude-lock.json 에서 읽는다 (로컬 실행용)."""
    agent_id = os.environ.get("RATE_WATCH_AGENT_ID")
    env_id = os.environ.get("RATE_WATCH_ENVIRONMENT_ID")
    if agent_id and env_id:
        return agent_id, env_id
    try:
        resources = read_json(LOCK_PATH).get("resources", {})
    except (FileNotFoundError, ValueError):
        return agent_id, env_id
    agent_id = agent_id or resources.get("./agents/rate-watch.md", {}).get("id")
    env_id = env_id or resources.get("./environments/rate-watch.yaml", {}).get("id")
    return agent_id, env_id


def load_index() -> dict:
    try:
        return read_json(INDEX_PATH)
    except FileNotFoundError:
        return {"last_change": None, "reports": []}


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--check-only", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    fred_key = os.environ.get("FRED_API_KEY")
    if not fred_key:
        print("FRED_API_KEY is not set", file=sys.stderr)
        return 1

    start = "2008-12-01"  # DFEDTARU/L 시작 (그 이전은 단일 목표 DFEDTAR)
    change = find_latest_change(fetch_series(TARGET_UPPER, fred_key, start),
                                fetch_series(TARGET_LOWER, fred_key, start))
    index = load_index()
    if change is None:
        print("No target-range change found in FRED data.")
        set_output("changed", "false")
        return 0

    print(f"Latest change: {change['date']} {fmt_range(change['previous'])} -> "
          f"{fmt_range(change['current'])} ({change['change_bp']:+d} bp)")
    new = is_new_change(change, index)

    # 첫 실행: 과거 변경을 '이미 본 것'으로 기록만 하고 리포트는 만들지 않는다.
    if index.get("last_change") is None and not args.force:
        if not (args.check_only or args.dry_run):
            write_json(INDEX_PATH, {**index, "last_change": change})
            print("First run: recorded the latest change as the baseline (no report).")
        set_output("changed", "false")
        return 0

    set_output("changed", "true" if new else "false")
    if not new and not args.force:
        print("Already reported — nothing to do.")
        return 0
    if args.check_only:
        print("New change detected." if new else "Forced run requested.")
        return 0

    since = (date.fromisoformat(change["date"])
             - timedelta(days=SNAPSHOT_LOOKBACK_DAYS)).isoformat()
    # FRED 는 목표 범위를 '시행일'(보통 FOMC 발표 다음 날)에 기록한다. 발표 당일 종가는
    # 이미 결정이 반영된 값이므로, 발표 추정일(시행일 - 1일) 이전을 '결정 전'으로 자른다.
    announced = (date.fromisoformat(change["date"]) - timedelta(days=1)).isoformat()
    snapshot = {sid: summarize_series(fetch_series(sid, fred_key, since), announced)
                for sid in SNAPSHOT_SERIES}
    kickoff = build_kickoff(change, snapshot, previous_verdict(index, change["date"]))
    if args.dry_run:
        print(kickoff)
        return 0

    agent_id, env_id = resolve_resource_ids()
    if not agent_id or not env_id:
        print("RATE_WATCH_AGENT_ID / RATE_WATCH_ENVIRONMENT_ID are not set "
              "(see managed_agents/README.md)", file=sys.stderr)
        return 1

    import anthropic  # 세션 실행 시에만 필요

    client = anthropic.Anthropic()
    budget = os.environ.get("RATE_WATCH_BUDGET_CENTS", "500")
    session_id, report = run_agent_session(client, agent_id, env_id, change, kickoff, budget)

    errors = validate_report(report)
    if errors:
        print("Report failed validation:\n  " + "\n  ".join(errors), file=sys.stderr)
        return 1

    if "verdict" not in report:
        print("Warning: report has no verdict (run `ant apply` to update the agent).", file=sys.stderr)
    write_json(REPORTS_DIR / f"{change['date']}.json",
               {**report, "session_id": session_id, "change": change})
    write_json(INDEX_PATH, record_report(index, change, report, session_id))
    print(f"Saved data/reports/rates/{change['date']}.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())

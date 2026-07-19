#!/usr/bin/env python3
"""luke_wiki (Obsidian vault) → data/wiki/graph.json

대시보드 '위키' 탭의 지식 그래프 데이터를 생성한다.

  - 노드: vault 안의 모든 .md 노트 (숨김 폴더 · .obsidian · .trash 제외)
  - 엣지: [[위키링크]] (Obsidian 방식 — 파일명 기준, 대소문자 무시)
          + 상대경로 마크다운 링크 [텍스트](path.md)
  - 부가정보: frontmatter 전체 핵심 필드, 인식론적 callout 분포,
              마지막 수정일(git 커밋 날짜, 없으면 파일 mtime)
  - 지식 좌표: 검증 강도(evidence) × 판단 비중(importance) ×
               나의 개입도(agency, 명시 필드가 없으면 휴리스틱 추정)

노트 본문도 함께 내보낸다 (--no-content 로 끌 수 있음):
  data/wiki/notes/{노드 인덱스}.json — 대시보드 '이 화면에서 읽기' 뷰어가 사용.
  주의: 본문을 내보내면 대시보드가 공개일 경우 노트 내용도 공개된다.

사용법:
  python scripts/build_wiki_graph.py --vault ../luke_wiki --out data/wiki/graph.json
  # CI 에서는 update.yml / wiki-sync.yml 이 luke_wiki 체크아웃 후 자동 실행
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

SKIP_DIRS = {".git", ".obsidian", ".trash", ".github", "node_modules"}
MAX_NODES = 3000        # 안전 상한 — 이보다 크면 프론트 force 시뮬레이션이 버겁다
MAX_CONTENT = 120_000   # 노트 1개당 본문 상한 (문자) — 초과분은 잘라낸다

# [[Target]] · [[Target|별칭]] · [[Target#헤딩]] — Target 만 추출
WIKILINK_RE = re.compile(r"\[\[([^\]\|#]+)(?:#[^\]\|]*)?(?:\|[^\]]*)?\]\]")
# [텍스트](상대/경로.md) — http(s) 링크는 제외
MDLINK_RE = re.compile(r"\[[^\]]*\]\((?!https?://)([^)#]+\.md)(?:#[^)]*)?\)")
# 인라인 #태그 (한글 포함)
INLINE_TAG_RE = re.compile(r"(?<!\S)#([A-Za-z0-9가-힣_][A-Za-z0-9가-힣_/-]*)")
CALLOUT_RE = re.compile(r"^>\s*\[!([A-Za-z0-9_-]+)\]", re.MULTILINE | re.IGNORECASE)

CONFIDENCE_SCORE = {"low": 0.18, "medium": 0.58, "high": 0.90}
WEIGHT_SCORE = {"reference": 0.18, "important": 0.62, "foundational": 0.96}
TYPE_EVIDENCE_SCORE = {
    "claim": 0.25, "synthesis": 0.52, "principle": 0.64,
    "framework": 0.66, "fact-set": 0.90, "entity": 0.70,
    "index": 0.45, "source": 0.56,
}
TYPE_IMPORTANCE_SCORE = {
    "claim": 0.28, "synthesis": 0.82, "principle": 1.0,
    "framework": 0.58, "fact-set": 0.56, "entity": 0.42,
    "index": 0.48, "source": 0.24,
}
EPISTEMIC_CALLOUTS = ("fact", "claim", "judgment", "principle", "opinion")


def _scalar(value: str) -> str:
    return value.strip().strip("'\"")


def _inline_list(value: str) -> list[str]:
    value = value.strip()
    if value.startswith("[") and value.endswith("]"):
        value = value[1:-1]
    if not value:
        return []
    return [_scalar(item) for item in value.split(",") if _scalar(item)]


def parse_frontmatter(text: str) -> dict[str, str | list[str]]:
    """대시보드에 필요한 단순 YAML frontmatter를 의존성 없이 읽는다.

    이 vault가 사용하는 scalar, ``[a, b]`` inline list, ``- item`` block
    list만 대상으로 한다. 복잡한 YAML 객체는 원문 보존 대상이지 그래프 좌표
    입력이 아니므로 의도적으로 지원하지 않는다.
    """
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end < 0:
        return {}
    fm = text[3:end]
    data: dict[str, str | list[str]] = {}
    list_key: str | None = None
    for line in fm.splitlines():
        stripped = line.strip()
        if list_key and stripped.startswith("- "):
            values = data.setdefault(list_key, [])
            if isinstance(values, list):
                values.append(_scalar(stripped[2:]))
            continue
        list_key = None
        m = re.match(r"^([A-Za-z][\w-]*)\s*:\s*(.*)$", stripped)
        if not m:
            continue
        key, rest = m.group(1).lower(), m.group(2).strip()
        if not rest:
            data[key] = []
            list_key = key
        elif rest.startswith("[") and rest.endswith("]"):
            data[key] = _inline_list(rest)
        else:
            data[key] = _scalar(rest)
    return data


def _as_list(value: str | list[str] | None, split_commas: bool = False) -> list[str]:
    if isinstance(value, list):
        return [v for v in value if v]
    if not value:
        return []
    return _inline_list(value) if split_commas else [value]


def _score_dimensions(rel: str, fm: dict[str, str | list[str]],
                      callouts: dict[str, int]) -> dict[str, object]:
    """frontmatter와 callout에서 0..1 지식 좌표를 만든다.

    agency는 실제 저자를 단정하지 않는다. ``authorship``/``origin`` 같은 명시
    필드가 있으면 우선하고, 없으면 routine 격리·type·judgment callout을 이용한
    추정치임을 함께 내보낸다.
    """
    note_type = str(fm.get("type") or "").lower()
    confidence = str(fm.get("confidence") or "").lower()
    weight = str(fm.get("weight") or "").lower()
    sources = _as_list(fm.get("sources"), split_commas=True)

    conf_score = CONFIDENCE_SCORE.get(confidence, 0.36)
    type_evidence = TYPE_EVIDENCE_SCORE.get(note_type, 0.42)
    source_score = min(1.0, 0.48 + 0.17 * len(sources)) if sources else 0.12
    epistemic_total = sum(callouts.get(k, 0) for k in EPISTEMIC_CALLOUTS)
    if epistemic_total:
        callout_score = (
            callouts.get("fact", 0) * 0.92 +
            callouts.get("principle", 0) * 0.66 +
            callouts.get("judgment", 0) * 0.46 +
            callouts.get("claim", 0) * 0.28 +
            callouts.get("opinion", 0) * 0.16
        ) / epistemic_total
    else:
        callout_score = 0.38
    evidence = 0.52 * conf_score + 0.23 * type_evidence + 0.15 * source_score + 0.10 * callout_score

    importance = 0.78 * WEIGHT_SCORE.get(weight, 0.34) + \
                 0.22 * TYPE_IMPORTANCE_SCORE.get(note_type, 0.36)

    explicit = str(fm.get("authorship") or fm.get("origin") or fm.get("provenance") or "").lower()
    author = str(fm.get("author") or "").lower()
    inferred = not bool(explicit)
    if explicit:
        if any(token in explicit for token in ("human", "user", "luke", "personal", "사람", "직접")):
            agency, agency_basis = 0.96, "frontmatter: 사람 작성"
        elif any(token in explicit for token in ("mixed", "collab", "human-ai", "공동", "혼합")):
            agency, agency_basis = 0.62, "frontmatter: 사람·AI 공동"
        elif any(token in explicit for token in ("routine", "automation", "자동")):
            agency, agency_basis = 0.03, "frontmatter: 자동 수집"
        else:
            agency, agency_basis = 0.18, "frontmatter: AI/외부"
    elif "luke" in author or "개인" in author:
        agency, agency_basis, inferred = 0.94, "author: Luke", False
    elif rel.startswith("wiki/news/") or "routine-news" in _as_list(fm.get("tags")):
        agency, agency_basis = 0.03, "루틴 수집 추정"
    elif rel.startswith("sources/"):
        agency, agency_basis = 0.08, "원문 자료 추정"
    elif rel.startswith("inbox/"):
        agency, agency_basis = 0.92, "직접 캡처 추정"
    elif note_type == "synthesis":
        agency, agency_basis = 0.70, "내 종합 추정"
    elif note_type == "principle":
        agency, agency_basis = 0.68, "선택한 원칙 추정"
    else:
        agency, agency_basis = 0.20, "AI 정리 추정"

    if inferred and not rel.startswith("wiki/news/") and not rel.startswith("sources/"):
        agency += min(0.24, callouts.get("judgment", 0) * 0.08)
        agency += min(0.08, callouts.get("principle", 0) * 0.025)
        if callouts.get("judgment", 0):
            agency_basis += " + judgment"

    clamp = lambda value: max(0.0, min(1.0, value))
    return {
        "evidence": round(clamp(evidence), 3),
        "importance": round(clamp(importance), 3),
        "agency": round(clamp(agency), 3),
        "agency_basis": agency_basis,
        "agency_inferred": inferred,
    }


def git_last_dates(vault: Path) -> dict[str, str]:
    """파일별 마지막 커밋 날짜(YYYY-MM-DD) — git log 한 번으로 전부 수집."""
    try:
        out = subprocess.run(
            ["git", "-C", str(vault), "log", "--format=%x01%cs", "--name-only"],
            capture_output=True, text=True, timeout=120, check=True,
        ).stdout
    except Exception:
        return {}
    dates: dict[str, str] = {}
    current = None
    for line in out.splitlines():
        if line.startswith("\x01"):
            current = line[1:].strip()
        elif line.strip() and current and line not in dates:
            dates[line.strip()] = current  # log 는 최신순 — 첫 등장이 마지막 수정
    return dates


def git_branch(vault: Path) -> str | None:
    try:
        b = subprocess.run(
            ["git", "-C", str(vault), "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, timeout=10, check=True,
        ).stdout.strip()
        return b if b and b != "HEAD" else None
    except Exception:
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--vault", required=True, help="Obsidian vault 디렉토리")
    ap.add_argument("--out", default="data/wiki/graph.json")
    ap.add_argument("--repo", default="lukeeee73/luke_wiki", help="GitHub owner/repo (노트 링크용)")
    ap.add_argument("--branch", default=None, help="GitHub 링크 브랜치 (기본: vault 의 현재 브랜치)")
    ap.add_argument("--no-content", action="store_true",
                    help="노트 본문(data/wiki/notes/) 내보내기 생략")
    args = ap.parse_args()

    vault = Path(args.vault).resolve()
    if not vault.is_dir():
        print(f"error: vault 디렉토리가 없습니다: {vault}", file=sys.stderr)
        return 1

    md_files: list[Path] = []
    for root, dirs, files in os.walk(vault):
        dirs[:] = [d for d in sorted(dirs) if d not in SKIP_DIRS and not d.startswith(".")]
        for f in sorted(files):
            if f.lower().endswith(".md"):
                md_files.append(Path(root) / f)
    if len(md_files) > MAX_NODES:
        print(f"warn: 노트 {len(md_files)}개 → 상한 {MAX_NODES}개로 자릅니다", file=sys.stderr)
        md_files = md_files[:MAX_NODES]

    last_dates = git_last_dates(vault)

    nodes = []
    by_basename: dict[str, int] = {}   # 파일명(소문자, 확장자 없음) → 노드 idx
    by_relpath: dict[str, int] = {}    # 상대경로(소문자) → 노드 idx
    for i, p in enumerate(md_files):
        rel = p.relative_to(vault).as_posix()
        stem = p.stem
        parts = rel.split("/")[:-1]
        folder = "/".join(parts[:2]) if parts else "(root)"
        mtime = last_dates.get(rel)
        if not mtime:
            try:
                mtime = datetime.fromtimestamp(p.stat().st_mtime, tz=timezone.utc).strftime("%Y-%m-%d")
            except OSError:
                mtime = None
        nodes.append({
            "id": rel[:-3], "title": stem, "path": rel,
            "folder": folder, "tags": [], "mtime": mtime,
        })
        by_basename.setdefault(stem.lower(), i)
        by_relpath[rel.lower()] = i

    edge_set: set[tuple[int, int]] = set()
    contents: dict[int, str] = {}
    for i, p in enumerate(md_files):
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if not args.no_content:
            contents[i] = text[:MAX_CONTENT]

        fm = parse_frontmatter(text)
        tags = [t.lstrip("#") for t in _as_list(fm.get("tags")) if t]
        body = text[text.find("\n---", 3) + 4:] if text.startswith("---") else text
        tags += INLINE_TAG_RE.findall(body)
        seen: list[str] = []
        for t in tags:
            if t not in seen:
                seen.append(t)
        callouts: dict[str, int] = {}
        for kind in CALLOUT_RE.findall(body):
            key = kind.lower()
            callouts[key] = callouts.get(key, 0) + 1
        rel = nodes[i]["path"]
        domains = _as_list(fm.get("domain"), split_commas=True)
        sources = _as_list(fm.get("sources"), split_commas=True)
        nodes[i].update({
            "title": str(fm.get("title") or nodes[i]["title"]),
            "tags": seen[:12],
            "frontmatter": {
                "domain": domains,
                "type": str(fm.get("type") or "unknown"),
                "weight": str(fm.get("weight") or "unknown"),
                "confidence": str(fm.get("confidence") or "unknown"),
                "sources": sources,
                "created": str(fm.get("created") or ""),
                "updated": str(fm.get("updated") or ""),
            },
            "epistemic": {k: callouts.get(k, 0) for k in EPISTEMIC_CALLOUTS},
            "dimensions": _score_dimensions(rel, fm, callouts),
        })

        targets: set[int] = set()
        for m in WIKILINK_RE.finditer(text):
            name = m.group(1).strip()
            # 'folder/Note' 형태도, 'Note' 형태도 파일명 기준으로 해석
            j = by_relpath.get((name + ".md").lower())
            if j is None:
                j = by_basename.get(name.rsplit("/", 1)[-1].lower())
            if j is not None:
                targets.add(j)
        rel_dir = p.parent.relative_to(vault).as_posix()
        for m in MDLINK_RE.finditer(text):
            href = m.group(1).strip()
            candidate = os.path.normpath(os.path.join(rel_dir, href)).replace("\\", "/")
            j = by_relpath.get(candidate.lower()) or by_relpath.get(href.lstrip("./").lower())
            if j is not None:
                targets.add(j)
        for j in targets:
            if i != j:
                edge_set.add((min(i, j), max(i, j)))

    branch = args.branch or git_branch(vault) or "main"
    graph = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "repo": args.repo,
        "repo_url": f"https://github.com/{args.repo}",
        "branch": branch,
        "note_count": len(nodes),
        "edge_count": len(edge_set),
        "has_content": not args.no_content,
        "dimension_schema": {
            "evidence": {
                "label": "검증 강도",
                "low": "주장·미검증",
                "high": "사실·검증",
                "basis": "confidence + type + sources + 인식론 callout",
            },
            "importance": {
                "label": "판단 비중",
                "low": "참고",
                "high": "핵심",
                "basis": "weight + type",
            },
            "agency": {
                "label": "나의 개입도",
                "low": "AI·루틴",
                "high": "내 판단·원칙",
                "basis": "authorship/origin 우선, 없으면 폴더 + type + judgment callout 추정",
                "inference_warning": "명시적 authorship이 없는 노트는 저자를 단정하지 않는 휴리스틱 추정값",
            },
        },
        "nodes": nodes,
        "edges": sorted(edge_set),
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(graph, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # 노트 본문 — 노드 인덱스별 개별 파일 (뷰어가 필요할 때만 fetch)
    notes_dir = out.parent / "notes"
    if notes_dir.is_dir():
        shutil.rmtree(notes_dir)  # 삭제된 노트가 남지 않도록 전체 재생성
    if not args.no_content:
        notes_dir.mkdir(parents=True)
        for i, text in contents.items():
            payload = {"id": nodes[i]["id"], "path": nodes[i]["path"], "content": text}
            (notes_dir / f"{i}.json").write_text(
                json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    note_msg = "" if args.no_content else f", {len(contents)} note bodies → {notes_dir}/"
    print(f"ok: {len(nodes)} notes, {len(edge_set)} links → {out}{note_msg}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

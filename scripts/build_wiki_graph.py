#!/usr/bin/env python3
"""luke_wiki (Obsidian vault) → data/wiki/graph.json

대시보드 '위키' 탭의 지식 그래프 데이터를 생성한다.

  - 노드: vault 안의 모든 .md 노트 (숨김 폴더 · .obsidian · .trash 제외)
  - 엣지: [[위키링크]] (Obsidian 방식 — 파일명 기준, 대소문자 무시)
          + 상대경로 마크다운 링크 [텍스트](path.md)
  - 부가정보: 폴더(색 구분용), 태그(frontmatter + 인라인 #태그),
              마지막 수정일(git 커밋 날짜, 없으면 파일 mtime)

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


def parse_frontmatter_tags(text: str) -> list[str]:
    """YAML frontmatter 의 tags 필드만 가볍게 파싱 (yaml 의존성 없이)."""
    if not text.startswith("---"):
        return []
    end = text.find("\n---", 3)
    if end < 0:
        return []
    fm = text[3:end]
    tags: list[str] = []
    in_tags = False
    for line in fm.splitlines():
        stripped = line.strip()
        if in_tags:
            if stripped.startswith("- "):
                tags.append(stripped[2:].strip().strip("'\""))
                continue
            in_tags = False
        m = re.match(r"^tags?\s*:\s*(.*)$", stripped, re.IGNORECASE)
        if m:
            rest = m.group(1).strip()
            if not rest:
                in_tags = True
            elif rest.startswith("["):
                tags += [t.strip().strip("'\"") for t in rest.strip("[]").split(",") if t.strip()]
            else:
                tags += [t.strip().strip("'\"") for t in re.split(r"[,\s]+", rest) if t.strip()]
    return [t.lstrip("#") for t in tags if t]


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

        tags = parse_frontmatter_tags(text)
        body = text[text.find("\n---", 3) + 4:] if text.startswith("---") else text
        tags += INLINE_TAG_RE.findall(body)
        seen: list[str] = []
        for t in tags:
            if t not in seen:
                seen.append(t)
        nodes[i]["tags"] = seen[:8]

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

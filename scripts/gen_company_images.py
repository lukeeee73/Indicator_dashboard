#!/usr/bin/env python3
"""
기업 구조도 제품군 개념도(family.image)를 이미지 생성 API 로 자동 생성한다.

데이터 SSOT: data/companies/<TICKER>.json 의 각 family 에
    "image":        "data/companies/images/<TICKER>/<name>.webp"  (저장 경로)
    "image_prompt": "<영문 생성 프롬프트>"                         (이 스크립트가 사용)
둘 다 있는 family 만 대상으로, 이미지 파일이 없으면 생성한다(--force 면 재생성).

제공자(키는 환경변수, 레포에 절대 저장하지 않음):
    GEMINI_API_KEY  → Gemini 2.5 Flash Image ('나노바나나')   [기본·무료등급]
    OPENAI_API_KEY  → OpenAI gpt-image-1

사용:
    GEMINI_API_KEY=xxx python scripts/gen_company_images.py            # 누락분만
    GEMINI_API_KEY=xxx python scripts/gen_company_images.py NVDA --force
    OPENAI_API_KEY=xxx python scripts/gen_company_images.py AVGO

의존: Pillow (resize/webp). urllib 만 사용(외부 SDK 불필요).
"""
from __future__ import annotations

import base64
import glob
import io
import json
import os
import sys
import urllib.request
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
CO_DIR = REPO / "data" / "companies"
TARGET_W = 1100          # 카드 표시용 가로폭
WEBP_QUALITY = 82

GEMINI_MODEL = os.environ.get("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image")
STYLE_SUFFIX = (
    " Isometric 3D technical concept illustration, dark navy background (#0d0f12), "
    "subtle neon glow, clean minimal, high detail, NO text, NO words, NO logos, "
    "16:9 aspect ratio."
)


def _gemini(prompt: str, key: str) -> bytes:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["IMAGE"]},
    }).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json", "x-goog-api-key": key,
    })
    with urllib.request.urlopen(req, timeout=120) as r:
        doc = json.loads(r.read())
    for cand in doc.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                return base64.b64decode(inline["data"])
    raise RuntimeError(f"Gemini: 이미지 파트 없음 → {json.dumps(doc)[:300]}")


def _openai(prompt: str, key: str) -> bytes:
    url = "https://api.openai.com/v1/images/generations"
    body = json.dumps({"model": "gpt-image-1", "prompt": prompt,
                       "size": "1536x1024", "n": 1}).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {key}",
    })
    with urllib.request.urlopen(req, timeout=180) as r:
        doc = json.loads(r.read())
    return base64.b64decode(doc["data"][0]["b64_json"])


def _pick_provider():
    if os.environ.get("GEMINI_API_KEY"):
        return "gemini", os.environ["GEMINI_API_KEY"], _gemini
    if os.environ.get("OPENAI_API_KEY"):
        return "openai", os.environ["OPENAI_API_KEY"], _openai
    sys.exit("ERROR: GEMINI_API_KEY 또는 OPENAI_API_KEY 환경변수가 필요합니다.")


def _save_webp(raw: bytes, out: Path):
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    w = TARGET_W
    h = round(im.height * w / im.width)
    im = im.resize((w, h), Image.LANCZOS)
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out, "WEBP", quality=WEBP_QUALITY, method=6)


def _families_needing(only_ticker, force):
    jobs = []
    for fp in sorted(CO_DIR.glob("*.json")):
        tk = fp.stem
        if only_ticker and tk != only_ticker:
            continue
        doc = json.loads(fp.read_text())
        for seg in doc.get("segments", []):
            for fam in seg.get("families", []):
                img, prompt = fam.get("image"), fam.get("image_prompt")
                if not img or not prompt:
                    continue
                out = REPO / img
                if out.exists() and not force:
                    continue
                jobs.append((tk, fam.get("name_kr", ""), prompt, out))
    return jobs


def main():
    args = [a for a in sys.argv[1:]]
    force = "--force" in args
    only = next((a for a in args if not a.startswith("-")), None)
    name, key, fn = _pick_provider()
    jobs = _families_needing(only, force)
    if not jobs:
        print("생성할 이미지 없음 (모두 존재하거나 image_prompt 미설정).")
        return
    print(f"제공자: {name} · 대상 {len(jobs)}장")
    ok = 0
    for tk, fam, prompt, out in jobs:
        full = prompt.strip() + STYLE_SUFFIX
        try:
            raw = fn(full, key)
            _save_webp(raw, out)
            print(f"  ✓ {tk} · {fam} → {out.relative_to(REPO)} ({out.stat().st_size//1024}KB)")
            ok += 1
        except Exception as e:  # noqa: BLE001
            print(f"  ✗ {tk} · {fam}: {e}")
    print(f"완료: {ok}/{len(jobs)}")


if __name__ == "__main__":
    main()

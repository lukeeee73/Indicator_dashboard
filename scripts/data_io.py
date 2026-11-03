"""JSON file primitives shared by the data collection scripts.

Readers decide whether a missing or malformed file is recoverable. Keeping that
policy at each call site preserves the collectors' different fallback behavior.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def read_json(path: Path, *, encoding: str | None = "utf-8") -> Any:
    """Read any JSON value, propagating file and decoding errors to the caller."""
    with path.open("r", encoding=encoding) as file:
        return json.load(file)


def write_json(path: Path, payload: Any) -> None:
    """Write collection JSON with UTF-8, two-space indentation and a final newline."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")

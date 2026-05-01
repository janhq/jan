#!/usr/bin/env python3
"""Generate polished release notes via OpenAI from git log between two tags.

Reads env vars:
    OPENAI_API_KEY   required
    OPENAI_MODEL     default "gpt-4o-mini"
    OPENAI_BASE_URL  default "https://api.openai.com/v1"
    CURR_TAG         required, e.g. "v1.1.64"
    PREV_TAG         optional, resolved from git history if absent
    REPO             optional, e.g. "AtomicBot-ai/Atomic-Chat"

Writes the produced markdown to stdout.
Exit 0 on success; non-zero on any failure (caller treats as "skip enrichment").
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import urllib.error
import urllib.request

logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stderr)
logger = logging.getLogger("release-notes")


SYSTEM_PROMPT = """You are a release notes editor for a desktop AI app (Atomic Chat).
You receive a list of git commit subjects between two tags and produce
concise, polished, user-facing release notes for end users.

OUTPUT RULES:
- Output GitHub-flavored Markdown ONLY. No preamble, no closing remarks,
  no code fences around the whole output.
- Use ONLY these section headings, in this order, omitting any that are empty:
    ## 🚀 New Features
    ## 🔧 Improvements
    ## 🛠️ Fixes & Stability
    ## ⚠️ Breaking Changes
- Each item is a bullet starting with "- ".
- Convert commit subjects into user-friendly language. Strip prefixes like
  "feat:", "fix:", "refactor:", and scope tags like "(api)" unless they
  aid clarity.
- Group small UI/stability fixes into a single bullet, e.g.
  "10+ stability and UI fixes" (round the count down to the nearest 5 or 10).
- Skip: merge commits, "release:" / version-bump commits, dependency bumps
  from bots (dependabot/renovate), and pure CI/build/chore commits.
- Mention major platforms or features by name when present
  (Windows, macOS, MLX, DFlash, etc.).
- Be concise — one short sentence per bullet, no marketing fluff.

EXAMPLE OUTPUT:
## 🚀 New Features

- Windows support — Atomic Chat is now available on Windows
- DFlash for MLX models on Apple Silicon — up to 3–4× faster inference with lossless speculative decoding

## 🛠️ Fixes & Stability

- 10+ stability and UI fixes
"""


def _run(cmd: list[str]) -> str:
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout.strip()


def _resolve_prev_tag(curr_tag: str) -> str | None:
    try:
        return _run(["git", "describe", "--tags", "--abbrev=0", f"{curr_tag}^"])
    except subprocess.CalledProcessError:
        pass
    try:
        tags = _run(["git", "tag", "--list", "v[0-9]*", "--sort=-v:refname"]).splitlines()
        for tag in tags:
            if tag and tag != curr_tag:
                return tag
    except subprocess.CalledProcessError:
        pass
    return None


def _collect_commits(prev_tag: str | None, curr_tag: str) -> str:
    rng = f"{prev_tag}..{curr_tag}" if prev_tag else curr_tag
    return _run(["git", "log", "--no-merges", "--pretty=format:- %s", rng])


def _call_openai(api_key: str, base_url: str, model: str, user_content: str) -> str:
    payload = {
        "model": model,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
    }
    req = urllib.request.Request(
        url=f"{base_url.rstrip('/')}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    return body["choices"][0]["message"]["content"].strip()


def main() -> int:
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        logger.error("OPENAI_API_KEY is not set")
        return 1

    curr_tag = os.environ.get("CURR_TAG", "").strip()
    if not curr_tag:
        logger.error("CURR_TAG is not set")
        return 1

    base_url = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").strip()
    model = os.environ.get("OPENAI_MODEL", "gpt-5-mini").strip() or "gpt-5-mini"
    repo = os.environ.get("REPO", "").strip()

    prev_tag = os.environ.get("PREV_TAG", "").strip() or _resolve_prev_tag(curr_tag)
    logger.info("Previous tag: %s", prev_tag or "(none — first release)")
    logger.info("Current tag : %s", curr_tag)

    try:
        commits = _collect_commits(prev_tag, curr_tag)
    except subprocess.CalledProcessError as exc:
        logger.error("git log failed: %s", exc.stderr)
        return 1

    if not commits:
        logger.error("No commits found in range")
        return 1

    logger.info("Commits in range: %d line(s)", commits.count("\n") + 1)

    user_content = (
        (f"Repository: {repo}\n" if repo else "")
        + f"Previous tag: {prev_tag or '(none)'}\n"
        + f"Current tag: {curr_tag}\n\n"
        + "Commits (most recent first):\n"
        + commits
    )

    try:
        notes = _call_openai(api_key, base_url, model, user_content)
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        logger.error("OpenAI HTTP %s: %s — body: %s", exc.code, exc.reason, body)
        return 1
    except (urllib.error.URLError, KeyError, json.JSONDecodeError) as exc:
        logger.error("OpenAI call failed: %s", exc)
        return 1

    if not notes:
        logger.error("OpenAI returned empty content")
        return 1

    sys.stdout.write(notes + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

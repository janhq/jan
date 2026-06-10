#!/usr/bin/env python3
"""Generate polished release notes via OpenAI from git log between two tags.

Reads env vars:
    OPENAI_API_KEY   required
    OPENAI_MODEL     default "gpt-4o-mini"
    OPENAI_BASE_URL  default "https://api.openai.com/v1"
    CURR_TAG         required, e.g. "v1.1.64"
    PREV_TAG         optional, resolved from git history if absent
    REPO             optional, e.g. "AtomicBot-ai/Atomic-Chat"
    GH_TOKEN         optional; enables GitHub API lookups for PR authors
                     (Contributors section) and for fetching recent published
                     releases used as few-shot style exemplars.

The generated notes are produced in the style of our most recent *published*
releases (fetched via the GitHub API as few-shot examples) so the output
matches what we actually ship; commit bodies are included for detail.

Writes the produced markdown to stdout.
Exit 0 on success; non-zero on any failure (caller treats as "skip enrichment").
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stderr)
logger = logging.getLogger("release-notes")


SYSTEM_PROMPT = """You are a release notes editor for a desktop AI app (Atomic Chat).
You receive (1) optional REAL examples of our previously published release
notes and (2) the git commits (subject + body) between two tags. Produce
concise, polished, user-facing release notes for end users.

STYLE — match our previous releases:
- When REAL past-release examples are provided, MIRROR them: use the same
  section headings (exact wording, emoji, and order), the same tone, and the
  same level of detail. Do NOT invent new headings when examples are present.
- When no examples are provided, fall back to these headings, in this order,
  omitting any that are empty:
    ## 🚀 New Features
    ## 🔧 Improvements & Fixes
    ## ⚠️ Breaking Changes

OUTPUT RULES:
- Output GitHub-flavored Markdown ONLY. No preamble, no closing remarks,
  no code fences around the whole output.
- Do NOT write a "## 🙏 Contributors" section — it is appended automatically.
  Never invent or guess contributor names.
- Each item is a bullet starting with "- ". Describe what the change means
  for the user (benefit-oriented), using the commit body for detail — not the
  raw commit subject.
- Strip prefixes like "feat:", "fix:", "refactor:", and scope tags like
  "(api)" unless they aid clarity.
- Group small UI/stability fixes into a single bullet when appropriate, e.g.
  "10+ stability and UI fixes" (round the count down to the nearest 5 or 10).
- Skip: merge commits, "release:" / version-bump commits, dependency bumps
  from bots (dependabot/renovate), and pure CI/build/chore/docs commits.
- Mention major platforms or features by name when present
  (Windows, macOS, Linux, MLX, llama.cpp, DFlash, etc.).
- Be concise — one short sentence per bullet, no marketing fluff.

FALLBACK EXAMPLE (only when no real examples are provided):
## 🚀 New Features

- Windows support — Atomic Chat is now available on Windows

## 🔧 Improvements & Fixes

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


# Record / unit separators used to parse `git log` into (subject, body) pairs.
_REC_SEP = "\x1e"
_UNIT_SEP = "\x1f"
_COAUTHOR_RE = re.compile(r"(?im)^\s*co-authored-by:.*$")


def _collect_commits(
    prev_tag: str | None, curr_tag: str, max_body_chars: int = 1200
) -> str:
    """Return commits as "- <subject>" bullets with their (truncated) body.

    The body gives the LLM enough substance to write benefit-oriented bullets
    that match our previous, detail-rich releases — not just terse subjects.
    `Co-authored-by:` trailers are stripped and each body is capped at
    `max_body_chars` so a large range can't blow up the prompt budget.
    """
    rng = f"{prev_tag}..{curr_tag}" if prev_tag else curr_tag
    raw = _run(
        [
            "git",
            "log",
            "--no-merges",
            f"--pretty=format:{_REC_SEP}%s{_UNIT_SEP}%b",
            rng,
        ]
    )
    items: list[str] = []
    for rec in raw.split(_REC_SEP):
        rec = rec.strip("\n")
        if not rec.strip():
            continue
        subject, _, body = rec.partition(_UNIT_SEP)
        subject = subject.strip()
        body = _COAUTHOR_RE.sub("", body).strip()
        if max_body_chars and len(body) > max_body_chars:
            body = body[:max_body_chars].rstrip() + "…"
        if body:
            indented = "\n".join("  " + ln for ln in body.splitlines())
            items.append(f"- {subject}\n{indented}")
        else:
            items.append(f"- {subject}")
    return "\n".join(items)


_PR_NUMBER_RE = re.compile(r"\(#(\d+)\)")


def _gh_api(url: str, token: str | None) -> dict | list | None:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "atomic-chat-release-notes",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url=url, method="GET", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        logger.warning("GitHub API HTTP %s for %s: %s", exc.code, url, exc.reason)
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as exc:
        logger.warning("GitHub API request failed for %s: %s", url, exc)
    return None


def _collect_commit_log(prev_tag: str | None, curr_tag: str) -> str:
    """Return raw "<sha>\\t<subject>" lines for every non-merge commit in range.

    Uses local git history (CI checks out with fetch-depth: 0 + fetch-tags:
    true), so the full prev_tag..curr_tag range is covered — unlike GitHub's
    /compare endpoint which caps at 250 commits per response.
    """
    rng = f"{prev_tag}..{curr_tag}" if prev_tag else curr_tag
    return _run(["git", "log", "--no-merges", "--pretty=format:%H%x09%s", rng])


def _collect_contributors(
    repo: str,
    prev_tag: str | None,
    curr_tag: str,
    token: str | None,
) -> list[str]:
    """Return GitHub logins (in first-seen order) credited for changes in range.

    Strategy:
    - Enumerate every non-merge commit between prev_tag and curr_tag via local
      git log (no GitHub /compare 250-commit cap).
    - Parse "(#NNN)" PR refs from each commit subject and resolve the PR
      author through the GitHub API (cached per PR number).
    - For commits without a PR ref, fall back to the commit's GitHub-author
      login. Bots are kept as-is per project preference.
    """
    if not repo:
        logger.warning("REPO not set — skipping Contributors section")
        return []

    try:
        log = _collect_commit_log(prev_tag, curr_tag)
    except subprocess.CalledProcessError as exc:
        logger.warning("git log for contributors failed: %s", exc.stderr)
        return []

    if not log:
        return []

    pr_numbers: list[str] = []
    seen_prs: set[str] = set()
    shas_without_pr: list[str] = []

    for line in log.splitlines():
        if "\t" not in line:
            continue
        sha, subject = line.split("\t", 1)
        prs_in_subject = _PR_NUMBER_RE.findall(subject)
        if prs_in_subject:
            for pr_num in prs_in_subject:
                if pr_num not in seen_prs:
                    seen_prs.add(pr_num)
                    pr_numbers.append(pr_num)
        elif sha:
            shas_without_pr.append(sha)

    logger.info(
        "Contributor scan: %d PR ref(s), %d commit(s) without PR ref",
        len(pr_numbers),
        len(shas_without_pr),
    )

    logins: dict[str, None] = {}

    for pr_num in pr_numbers:
        payload = _gh_api(
            f"https://api.github.com/repos/{repo}/pulls/{pr_num}", token
        )
        login = ((payload or {}).get("user") or {}).get("login")
        if login and login not in logins:
            logins[login] = None

    for sha in shas_without_pr:
        payload = _gh_api(
            f"https://api.github.com/repos/{repo}/commits/{sha}", token
        )
        login = ((payload or {}).get("author") or {}).get("login")
        if login and login not in logins:
            logins[login] = None

    return list(logins.keys())


def _render_contributors_section(logins: list[str]) -> str:
    if not logins:
        return ""
    mentions = ", ".join(
        f"[@{login}](https://github.com/{login})" for login in logins
    )
    return (
        "\n\n## 🙏 Contributors\n\n"
        f"Thanks to {mentions} for their contributions to this release!"
    )


def _collect_style_examples(
    repo: str,
    token: str | None,
    curr_tag: str,
    limit: int = 3,
) -> list[tuple[str, str]]:
    """Return [(tag, body)] for the most recent *published* releases.

    These real, hand-approved releases are fed to the LLM as few-shot style
    exemplars so the generated notes match the structure/tone/headings we
    actually ship. Drafts, prereleases, the current tag, and empty bodies are
    skipped. Returns [] on any failure (caller degrades gracefully).
    """
    if not repo:
        logger.warning("REPO not set — skipping style examples")
        return []

    payload = _gh_api(
        f"https://api.github.com/repos/{repo}/releases?per_page=20", token
    )
    if not isinstance(payload, list):
        return []

    examples: list[tuple[str, str]] = []
    for rel in payload:
        if not isinstance(rel, dict):
            continue
        if rel.get("draft") or rel.get("prerelease"):
            continue
        tag = (rel.get("tag_name") or "").strip()
        body = (rel.get("body") or "").strip()
        if not body or tag == curr_tag:
            continue
        examples.append((tag, body))
        if len(examples) >= limit:
            break
    return examples


def _render_style_examples(examples: list[tuple[str, str]]) -> str:
    if not examples:
        return ""
    blocks = [
        f'<example release="{tag}">\n{body}\n</example>' for tag, body in examples
    ]
    return (
        "Below are REAL examples of our previously published release notes. "
        "Match their structure, section headings, tone, and level of detail "
        "exactly:\n\n" + "\n\n".join(blocks)
    )


def _call_openai(api_key: str, base_url: str, model: str, user_content: str) -> str:
    payload = {
        "model": model,
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
    gh_token = os.environ.get("GH_TOKEN", "").strip() or None

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

    style_examples = _collect_style_examples(repo, gh_token, curr_tag)
    logger.info("Style exemplars from past releases: %d", len(style_examples))
    style_examples_md = _render_style_examples(style_examples)

    user_parts: list[str] = []
    if repo:
        user_parts.append(f"Repository: {repo}")
    user_parts.append(f"Previous tag: {prev_tag or '(none)'}")
    user_parts.append(f"Current tag: {curr_tag}")
    if style_examples_md:
        user_parts.append("\n" + style_examples_md)
    user_parts.append("\nCommits in this release (most recent first):\n" + commits)
    user_content = "\n".join(user_parts)

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

    contributors = _collect_contributors(repo, prev_tag, curr_tag, gh_token)
    if contributors:
        logger.info("Contributors resolved: %s", ", ".join(contributors))
    contributors_md = _render_contributors_section(contributors)

    sys.stdout.write(notes + contributors_md + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

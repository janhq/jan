"""
demo/main.py — Orchestrator CLI for the Atomic-Chat concurrent multi-agent demo.

Flow:
    1. Parse CLI flags and materialise the requested scenario.
    2. Call the orchestrator prompt once to turn a free-form topic into a list
       of per-agent task dicts (JSON).
    3. Fan-out N specialist agents with ``asyncio.gather``; every agent pushes
       progress events onto a shared queue that drives the Rich dashboard.
    4. Render a static HTML gallery of the results and (optionally) open it
       in the default browser.

Usage:
    bash run.sh --scenario svg --topic "Technology and AI" --tasks 8
"""

from __future__ import annotations

import asyncio
import json
import math
import pathlib
import subprocess
import sys
import tempfile
import time
import webbrowser
from typing import Any

import httpx
import typer
from rich.console import Console
from rich.live import Live
from rich.panel import Panel
from rich.text import Text

from demo.client import ClientSettings, build_async_client, stream_chat
from demo.dashboard import DashboardState, render, run_dashboard
from demo.metrics import ServerMetrics, poll_metrics_loop
from demo.scenarios import get_scenario
from demo.templates import build_page

BUILD_DIR = pathlib.Path(__file__).resolve().parent.parent / "website_build"
SCRIPT_DIR = pathlib.Path(__file__).resolve().parent.parent
PREVIEW_TAIL = 160

app = typer.Typer(add_completion=False, no_args_is_help=False)

# ─── Multi-window mode helpers ─────────────────────────────────────────────

_STATUS_SYMBOL: dict[str, tuple[str, str]] = {
    "waiting": ("⏳ waiting", "dim"),
    "running": ("⚡ running", "yellow"),
    "done": ("✔ done", "green"),
    "error": ("✖ error", "red"),
}
_BORDER_FOR_STATUS: dict[str, str] = {
    "waiting": "white",
    "running": "cyan",
    "done": "green",
    "error": "red",
}


def _shell_quote(s: str) -> str:
    """POSIX-safe single-quote wrapping for embedding paths in shell commands."""
    return "'" + s.replace("'", "'\\''") + "'"


def _applescript_escape(s: str) -> str:
    """Escape a string for embedding inside an AppleScript string literal."""
    return s.replace("\\", "\\\\").replace('"', '\\"')


def _get_main_display_size() -> tuple[int, int]:
    """Return (width, height) of the main display on macOS, with a safe fallback."""
    try:
        result = subprocess.run(
            [
                "osascript",
                "-e",
                'tell application "Finder" to get bounds of window of desktop',
            ],
            capture_output=True,
            text=True,
            check=True,
            timeout=5,
        )
        parts = [int(p.strip()) for p in result.stdout.strip().split(",")]
        if len(parts) == 4:
            return parts[2], parts[3]
    except (subprocess.SubprocessError, ValueError, OSError):
        pass
    return 1440, 900


def _grid_bounds(
    n: int,
    screen_w: int,
    screen_h: int,
    *,
    top_offset: int = 30,
) -> list[tuple[int, int, int, int]]:
    """Compute N `(x1, y1, x2, y2)` rectangles arranged in a near-square grid.

    `top_offset` reserves vertical space at the top of the screen — used in
    `--multi-window` mode to leave room for the dashboard window above the
    agent grid.
    """
    cols = max(1, math.ceil(math.sqrt(n)))
    rows = max(1, math.ceil(n / cols))
    margin = 16
    cell_w = (screen_w - margin * (cols + 1)) // cols
    cell_h = (screen_h - top_offset - margin * (rows + 1)) // rows
    out: list[tuple[int, int, int, int]] = []
    for i in range(n):
        r, c = divmod(i, cols)
        x1 = margin + c * (cell_w + margin)
        y1 = top_offset + margin + r * (cell_h + margin)
        out.append((x1, y1, x1 + cell_w, y1 + cell_h))
    return out


def _open_terminal_window(
    cmd: str,
    title: str,
    bounds: tuple[int, int, int, int],
) -> None:
    """Open a single Terminal.app window running `cmd`, tiled to `bounds`."""
    x1, y1, x2, y2 = bounds
    ascript = (
        'tell application "Terminal"\n'
        "    activate\n"
        f'    set newTab to do script "{_applescript_escape(cmd)}"\n'
        "    delay 0.15\n"
        "    set newWin to window 1\n"
        f"    set bounds of newWin to {{{x1}, {y1}, {x2}, {y2}}}\n"
        f'    set custom title of newTab to "{_applescript_escape(title)}"\n'
        "end tell\n"
    )
    subprocess.run(["osascript", "-e", ascript], check=False)


def _spawn_dashboard_window(
    session_dir: pathlib.Path,
    *,
    bounds: tuple[int, int, int, int],
) -> None:
    """Open the dashboard window — full width, top of screen."""
    cmd = (
        f"cd {_shell_quote(str(SCRIPT_DIR))} && "
        f"clear && "
        f"uv run --no-sync python -m demo.main dashboard "
        f"--session-dir {_shell_quote(str(session_dir))}"
    )
    _open_terminal_window(cmd, "Dashboard", bounds)


def _spawn_terminal_windows(
    session_dir: pathlib.Path,
    n: int,
    *,
    top_offset: int,
) -> None:
    """Open N Terminal.app windows tiled in a grid, each running one agent."""
    screen_w, screen_h = _get_main_display_size()
    positions = _grid_bounds(n, screen_w, screen_h, top_offset=top_offset)

    for idx, bounds in enumerate(positions):
        cmd = (
            f"cd {_shell_quote(str(SCRIPT_DIR))} && "
            f"clear && "
            f"uv run --no-sync python -m demo.main agent "
            f"--session-dir {_shell_quote(str(session_dir))} "
            f"--agent-idx {idx}"
        )
        _open_terminal_window(cmd, f"Agent {idx + 1}", bounds)


def _set_window_title(title: str) -> None:
    """Best-effort OSC-0 escape to rename the host terminal's tab."""
    try:
        sys.stdout.write(f"\x1b]0;{title}\x07")
        sys.stdout.flush()
    except OSError:
        pass


# Min interval (seconds) between agent state-file writes; throttles disk I/O.
_STATE_WRITE_INTERVAL = 0.25


def _write_agent_state(
    session_dir: pathlib.Path,
    agent_idx: int,
    *,
    name: str,
    status: str,
    tokens: int,
    tps: float,
    elapsed: float,
    preview: str,
) -> None:
    """Atomically write a snapshot of one agent's state for the dashboard."""
    payload = {
        "name": name,
        "status": status,
        "tokens": tokens,
        "tps": tps,
        "elapsed": elapsed,
        "preview": preview[-PREVIEW_TAIL:] if preview else "",
    }
    target = session_dir / f"agent-{agent_idx}.state.json"
    tmp = session_dir / f"agent-{agent_idx}.state.json.tmp"
    try:
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        tmp.replace(target)
    except OSError:
        pass


async def _run_plan(
    client: httpx.AsyncClient,
    *,
    model: str,
    scenario: dict[str, Any],
    topic: str,
    n_agents: int,
) -> list[dict]:
    """Invoke the orchestrator agent to split the topic into per-agent tasks.

    Falls back to `direct_instruction` from the scenario agent definitions if
    the model produces invalid JSON — lets the demo still run on small models
    that occasionally mis-format structured output.
    """
    agents = scenario["agents"]
    plan = scenario["plan"]
    agent_list = ", ".join(a["name"] for a in agents)
    user_prompt = (
        plan["user"].replace("{topic}", topic).replace("{agent_list}", agent_list)
    )

    raw = ""
    async for chunk in stream_chat(
        client,
        model=model,
        system=plan["system"],
        user=user_prompt,
        max_tokens=max(1024, n_agents * 200),
    ):
        choices = chunk.get("choices") or []
        if not choices:
            continue
        delta = choices[0].get("delta") or {}
        content = delta.get("content") or ""
        if content:
            raw += content

    start = raw.find("[")
    end = raw.rfind("]")
    if start != -1 and end != -1:
        try:
            return json.loads(raw[start : end + 1])
        except json.JSONDecodeError:
            pass

    # Graceful degradation — fall back to per-agent canned instructions.
    return [
        {
            "name": agent["name"],
            "instruction": agent["direct_instruction"].replace("{topic}", topic),
        }
        for agent in agents
    ]


async def _run_agent(
    client: httpx.AsyncClient,
    *,
    model: str,
    agent: dict,
    task: dict,
    system_prompt: str,
    queue: asyncio.Queue,
) -> tuple[str, str, bool]:
    """Stream one specialist agent end-to-end, reporting progress to `queue`."""
    name = agent["name"]
    started = time.monotonic()
    tokens = 0
    content = ""
    server_tokens: int | None = None

    await queue.put({
        "name": name,
        "emoji": agent.get("emoji", "\U0001f916"),
        "color": agent.get("color", "1;37"),
        "status": "running",
        "tokens": 0,
        "tps": 0.0,
        "elapsed": 0.0,
        "preview": "",
    })

    try:
        async for chunk in stream_chat(
            client,
            model=model,
            system=system_prompt,
            user=task.get("instruction", ""),
            max_tokens=4000,
        ):
            usage = chunk.get("usage")
            if isinstance(usage, dict):
                server_tokens = usage.get("completion_tokens")
            choices = chunk.get("choices") or []
            if not choices:
                continue
            delta = choices[0].get("delta") or {}
            piece = delta.get("content") or ""
            if not piece:
                continue
            content += piece
            tokens += 1
            elapsed = time.monotonic() - started
            reported = server_tokens if server_tokens is not None else tokens
            tps = reported / elapsed if elapsed > 0 else 0.0
            await queue.put({
                "name": name,
                "status": "running",
                "tokens": reported,
                "tps": tps,
                "elapsed": elapsed,
                "preview": content[-PREVIEW_TAIL:],
            })
    except (httpx.HTTPError, OSError) as exc:
        elapsed = time.monotonic() - started
        await queue.put({
            "name": name,
            "status": "error",
            "elapsed": elapsed,
            "preview": f"[error] {exc}",
        })
        return name, "", False

    elapsed = time.monotonic() - started
    reported = server_tokens if server_tokens is not None else tokens
    tps = reported / elapsed if elapsed > 0 else 0.0
    await queue.put({
        "name": name,
        "status": "done",
        "tokens": reported,
        "tps": tps,
        "elapsed": elapsed,
        "preview": content[-PREVIEW_TAIL:],
    })
    return name, content, True


async def _run(
    *,
    scenario_name: str,
    topic: str,
    tasks: int | None,
    open_browser: bool,
) -> int:
    settings = ClientSettings.from_env()
    scenario = get_scenario(scenario_name, n_agents=tasks)
    agents: list[dict] = scenario["agents"]
    n = len(agents)

    client = build_async_client(settings)

    state = DashboardState.initial(
        agents,
        topic=topic,
        scenario=scenario_name,
        model_id=settings.model,
        slot_total=n,
    )
    queue: asyncio.Queue = asyncio.Queue()
    stop_event = asyncio.Event()
    server_snapshot: list[ServerMetrics] = [ServerMetrics()]

    async def _metrics_mirror() -> None:
        while not stop_event.is_set():
            state.server = server_snapshot[0]
            await asyncio.sleep(0.25)

    dashboard_task = asyncio.create_task(run_dashboard(state, queue, stop_event))
    metrics_task = asyncio.create_task(
        poll_metrics_loop(client, settings.model, server_snapshot, stop_event)
    )
    mirror_task = asyncio.create_task(_metrics_mirror())

    exit_code = 0
    try:
        task_specs = await _run_plan(
            client,
            model=settings.model,
            scenario=scenario,
            topic=topic,
            n_agents=n,
        )
        task_by_name = {t.get("name"): t for t in task_specs}

        agent_tasks = [
            _run_agent(
                client,
                model=settings.model,
                agent=agent,
                task=task_by_name.get(
                    agent["name"],
                    {"name": agent["name"], "instruction": agent[
                        "direct_instruction"
                    ].replace("{topic}", topic)},
                ),
                system_prompt=scenario.get("system_prompt", ""),
                queue=queue,
            )
            for agent in agents
        ]

        gathered = await asyncio.gather(*agent_tasks, return_exceptions=True)
        results: dict[str, str] = {}
        failed = 0
        for item in gathered:
            if isinstance(item, BaseException):
                failed += 1
                continue
            name, content, ok = item
            if ok:
                results[name] = content
            else:
                failed += 1

        if failed:
            exit_code = 1

        BUILD_DIR.mkdir(parents=True, exist_ok=True)
        html_path = BUILD_DIR / "index.html"
        html_path.write_text(
            build_page(topic, scenario, results, tasks=task_specs),
            encoding="utf-8",
        )

        if open_browser:
            _open_in_browser(html_path)
    finally:
        await queue.put(None)
        stop_event.set()
        for task in (mirror_task, metrics_task, dashboard_task):
            try:
                await task
            except asyncio.CancelledError:
                pass
        await client.aclose()

    print(f"\nHTML report: {html_path}")
    return exit_code


async def _run_solo_agent(
    session: dict[str, Any],
    agent_idx: int,
    session_dir: pathlib.Path,
) -> int:
    """Stream a single agent in the current terminal with a live Rich panel.

    Invoked by child processes spawned via `--multi-window`; reads the shared
    session.json, runs one agent end-to-end, and persists the result to disk so
    the parent orchestrator can collect it and render the HTML gallery.
    """
    settings = ClientSettings(
        base_url=session["base_url"],
        api_key=session["api_key"],
        model=session["model"],
    )
    agent = session["agents"][agent_idx]
    system_prompt = session.get("system_prompt", "")
    scenario_name = session.get("scenario_name", "demo")
    topic = session.get("topic", "")

    _set_window_title(f"Agent {agent_idx + 1} · {agent['name']} · {scenario_name}")
    console = Console()

    state: dict[str, Any] = {
        "status": "running",
        "tokens": 0,
        "tps": 0.0,
        "elapsed": 0.0,
        "preview": "",
    }
    started = time.monotonic()
    content = ""
    tokens = 0
    server_tokens: int | None = None

    def render() -> Panel:
        lines = state["preview"].splitlines() or [" "]
        body = Text("\n".join(lines[-200:]))
        label, style = _STATUS_SYMBOL[state["status"]]
        subtitle = Text.assemble(
            (f"{label}   ", style),
            (f"{state['tokens']} tok   ", "bold"),
            (f"{state['tps']:.1f} t/s   ", "cyan"),
            (f"{state['elapsed']:.1f}s", "dim"),
        )
        title = Text.assemble(
            (f"{agent.get('emoji', '🤖')}  ", ""),
            (f"Agent {agent_idx + 1} · {agent['name']}", "bold"),
            (f"   ·  {scenario_name}", "dim"),
        )
        return Panel(
            body,
            title=title,
            subtitle=subtitle,
            border_style=_BORDER_FOR_STATUS[state["status"]],
            padding=(1, 2),
        )

    last_state_write = 0.0

    def _flush_state(force: bool = False) -> None:
        nonlocal last_state_write
        now = time.monotonic()
        if not force and now - last_state_write < _STATE_WRITE_INTERVAL:
            return
        last_state_write = now
        _write_agent_state(
            session_dir,
            agent_idx,
            name=agent["name"],
            status=state["status"],
            tokens=state["tokens"],
            tps=state["tps"],
            elapsed=state["elapsed"],
            preview=state["preview"],
        )

    _flush_state(force=True)

    ok = False
    client = build_async_client(settings)
    try:
        with Live(render(), console=console, refresh_per_second=10, screen=False) as live:
            try:
                instruction = (
                    agent.get("instruction")
                    or agent.get("task", {}).get("instruction")
                    or ""
                )
                async for chunk in stream_chat(
                    client,
                    model=settings.model,
                    system=system_prompt,
                    user=instruction,
                    max_tokens=4000,
                ):
                    usage = chunk.get("usage")
                    if isinstance(usage, dict):
                        maybe = usage.get("completion_tokens")
                        if isinstance(maybe, int):
                            server_tokens = maybe
                    choices = chunk.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    piece = delta.get("content") or ""
                    if not piece:
                        continue
                    content += piece
                    tokens += 1
                    elapsed = time.monotonic() - started
                    reported = server_tokens if server_tokens is not None else tokens
                    state["status"] = "running"
                    state["tokens"] = reported
                    state["tps"] = reported / elapsed if elapsed > 0 else 0.0
                    state["elapsed"] = elapsed
                    state["preview"] = content
                    live.update(render())
                    _flush_state()
                state["status"] = "done"
                ok = True
            except (httpx.HTTPError, OSError) as exc:
                state["status"] = "error"
                state["preview"] = (content + f"\n\n[error] {exc}").strip()
            finally:
                state["elapsed"] = time.monotonic() - started
                reported = server_tokens if server_tokens is not None else tokens
                state["tokens"] = reported
                state["tps"] = (
                    reported / state["elapsed"] if state["elapsed"] > 0 else 0.0
                )
                live.update(render())
                _flush_state(force=True)
    finally:
        await client.aclose()

    result_path = session_dir / f"agent-{agent_idx}.result.json"
    result_path.write_text(
        json.dumps(
            {
                "idx": agent_idx,
                "name": agent["name"],
                "content": content,
                "ok": ok,
                "tokens": state["tokens"],
                "tps": state["tps"],
                "elapsed": state["elapsed"],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    console.print()
    console.print(f"[bold]Result →[/bold] [dim]{result_path}[/dim]")
    try:
        console.input("[dim]Press Enter to close this window...[/dim] ")
    except (EOFError, KeyboardInterrupt):
        pass
    return 0 if ok else 1


async def _run_multi_window(
    *,
    scenario_name: str,
    topic: str,
    tasks: int | None,
    open_browser: bool,
) -> int:
    """Parent orchestrator for `--multi-window` mode.

    Plans tasks once, materialises a shared session.json, spawns one Terminal
    window per agent and waits for each child to drop its result file.
    """
    if sys.platform != "darwin":
        print(
            "--multi-window is currently supported only on macOS "
            "(Terminal.app + osascript).",
            file=sys.stderr,
        )
        return 2

    settings = ClientSettings.from_env()
    scenario = get_scenario(scenario_name, n_agents=tasks)
    agents = scenario["agents"]
    n = len(agents)

    console = Console()
    console.print(
        "[bold cyan]⚡ Atomic-Chat · Concurrent Demo · multi-window mode[/bold cyan]"
    )
    console.print(
        f"  scenario=[bold]{scenario_name}[/bold]   "
        f"topic=[italic]{topic!r}[/italic]   "
        f"agents=[bold]{n}[/bold]   "
        f"model=[dim]{settings.model}[/dim]"
    )

    console.print("[dim]→ planning tasks with orchestrator agent...[/dim]")
    plan_client = build_async_client(settings)
    try:
        task_specs = await _run_plan(
            plan_client,
            model=settings.model,
            scenario=scenario,
            topic=topic,
            n_agents=n,
        )
    finally:
        await plan_client.aclose()

    task_by_name = {t.get("name"): t for t in task_specs}
    session_agents: list[dict[str, Any]] = []
    for agent in agents:
        task = task_by_name.get(
            agent["name"],
            {
                "name": agent["name"],
                "instruction": agent["direct_instruction"].replace("{topic}", topic),
            },
        )
        session_agents.append(
            {
                "name": agent["name"],
                "emoji": agent.get("emoji", "🤖"),
                "color": agent.get("color", "1;37"),
                "instruction": task.get("instruction", ""),
                "task": task,
            }
        )

    session_dir = pathlib.Path(tempfile.mkdtemp(prefix="atomic-chat-concurrent-"))
    payload = {
        "scenario_name": scenario_name,
        "topic": topic,
        "model": settings.model,
        "base_url": settings.base_url,
        "api_key": settings.api_key,
        "system_prompt": scenario.get("system_prompt", ""),
        "agents": session_agents,
    }
    (session_dir / "session.json").write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )
    console.print(f"[dim]→ session dir: {session_dir}[/dim]")

    # Reserve the top strip of the screen for the aggregate dashboard window
    # (full width, ~28% of the screen). The agent grid fills the rest below.
    screen_w, screen_h = _get_main_display_size()
    menu_bar = 30
    side_margin = 16
    dash_h = max(220, int(screen_h * 0.28))
    dash_bounds = (
        side_margin,
        menu_bar,
        screen_w - side_margin,
        menu_bar + dash_h,
    )
    agents_top_offset = menu_bar + dash_h + side_margin

    console.print("[dim]→ opening aggregate dashboard window...[/dim]")
    _spawn_dashboard_window(session_dir, bounds=dash_bounds)

    console.print(f"[dim]→ spawning {n} agent Terminal.app windows...[/dim]")
    _spawn_terminal_windows(session_dir, n, top_offset=agents_top_offset)

    console.print(f"[bold]Waiting for {n} agents to finish...[/bold]\n")
    deadline = time.monotonic() + 30 * 60
    results: dict[str, str] = {}
    done: set[int] = set()
    try:
        while len(done) < n and time.monotonic() < deadline:
            for idx, agent in enumerate(session_agents):
                if idx in done:
                    continue
                result_path = session_dir / f"agent-{idx}.result.json"
                if not result_path.exists():
                    continue
                try:
                    data = json.loads(result_path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                done.add(idx)
                if data.get("ok"):
                    results[agent["name"]] = data.get("content", "")
                    console.print(
                        f"  [green]✓[/green] "
                        f"Agent {idx + 1:>2} · {agent['name']:<24}  "
                        f"[dim]{data.get('tokens', 0)} tok   "
                        f"{data.get('tps', 0.0):.1f} t/s   "
                        f"{data.get('elapsed', 0.0):.1f}s[/dim]   "
                        f"[green]({len(done)}/{n})[/green]"
                    )
                else:
                    console.print(
                        f"  [red]✗[/red] Agent {idx + 1:>2} · "
                        f"{agent['name']:<24}  [red]failed[/red]"
                    )
            await asyncio.sleep(0.4)
    except KeyboardInterrupt:
        console.print("[yellow]Interrupted — rendering partial results.[/yellow]")

    # Signal the dashboard window that the show is over so it can exit its
    # poll loop (it will still wait for a final keypress before closing).
    try:
        (session_dir / "dashboard.stop").write_text("done", encoding="utf-8")
    except OSError:
        pass

    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    html_path = BUILD_DIR / "index.html"
    html_path.write_text(
        build_page(topic, scenario, results, tasks=task_specs),
        encoding="utf-8",
    )
    console.print(f"\n[bold]HTML report:[/bold] {html_path}")
    console.print(f"[dim]Session dir kept at:[/dim] {session_dir}")

    if open_browser:
        _open_in_browser(html_path)

    return 0 if len(results) == n else 1


async def _run_session_dashboard(
    session: dict[str, Any],
    session_dir: pathlib.Path,
) -> int:
    """Render the aggregate dashboard window in --multi-window mode.

    Polls each agent's `agent-N.state.json` and the upstream `/metrics`
    endpoint, then drives the same Rich `DashboardState`/`render()` pipeline
    used by the single-process mode. Exits when every agent has dropped a
    result file (terminal state) and the parent has signalled completion via
    `dashboard.stop` or after a long timeout.
    """
    settings = ClientSettings(
        base_url=session["base_url"],
        api_key=session["api_key"],
        model=session["model"],
    )
    scenario_name = session.get("scenario_name", "demo")
    topic = session.get("topic", "")
    session_agents = session.get("agents", [])
    n = len(session_agents)

    _set_window_title(f"{scenario_name} · dashboard · {n} agents")

    state = DashboardState.initial(
        session_agents,
        topic=topic,
        scenario=scenario_name,
        model_id=settings.model,
        slot_total=n,
        compact=True,
    )
    server_snapshot: list[ServerMetrics] = [ServerMetrics()]
    stop_event = asyncio.Event()

    client = build_async_client(settings)
    metrics_task = asyncio.create_task(
        poll_metrics_loop(client, settings.model, server_snapshot, stop_event)
    )

    console = Console()
    deadline = time.monotonic() + 30 * 60
    stop_flag = session_dir / "dashboard.stop"

    try:
        # `screen=False` keeps the rendered frames in the regular terminal
        # scrollback so the LAST live frame stays on screen after `Live`
        # exits — which is exactly what the marketing screencast wants.
        with Live(
            render(state),
            console=console,
            refresh_per_second=4,
            screen=False,
            transient=False,
        ) as live:
            while True:
                # Pull every agent's most recent state snapshot.
                for idx, agent_spec in enumerate(session_agents):
                    snap_path = session_dir / f"agent-{idx}.state.json"
                    if not snap_path.exists():
                        continue
                    try:
                        snap = json.loads(snap_path.read_text(encoding="utf-8"))
                    except (OSError, json.JSONDecodeError):
                        continue
                    name = snap.get("name") or agent_spec["name"]
                    target = state.agents.get(name)
                    if target is None:
                        continue
                    target.apply(snap)

                state.server = server_snapshot[0]
                live.update(render(state))

                # Exit condition: parent flag, or timeout, or all agents
                # have dropped a result file (stable terminal state).
                if stop_flag.exists():
                    break
                results_done = sum(
                    1
                    for idx in range(n)
                    if (session_dir / f"agent-{idx}.result.json").exists()
                )
                if results_done >= n:
                    # One last redraw to capture any final state writes.
                    await asyncio.sleep(0.4)
                    live.update(render(state))
                    break
                if time.monotonic() > deadline:
                    break

                await asyncio.sleep(0.25)
    except KeyboardInterrupt:
        pass
    finally:
        stop_event.set()
        try:
            await metrics_task
        except (asyncio.CancelledError, Exception):
            pass
        await client.aclose()

    # Keep the final live frame visible — no extra summary panel, no clear,
    # so the marketer's screen recording ends on the full dashboard.
    try:
        console.input("[dim]Press Enter to close this window...[/dim] ")
    except (EOFError, KeyboardInterrupt):
        pass
    return 0


def _open_in_browser(path: pathlib.Path) -> None:
    """Best-effort cross-platform `open` of the rendered gallery."""
    url = path.as_uri()
    try:
        if sys.platform == "darwin":
            subprocess.run(["open", str(path)], check=False)
            return
        if sys.platform == "win32":
            subprocess.run(["cmd", "/c", "start", "", str(path)], check=False)
            return
        webbrowser.open(url)
    except Exception:
        pass


@app.command()
def run(
    scenario: str = typer.Option(
        "ascii", "--scenario", "-s", help="Scenario name: svg | translate | code | ascii"
    ),
    topic: str = typer.Option(
        "animals",
        "--topic",
        "-t",
        help="Free-form topic passed to both the orchestrator and each agent.",
    ),
    tasks: int | None = typer.Option(
        8,
        "--tasks",
        "-n",
        min=1,
        max=20,
        help="Number of concurrent agents (should equal llama.cpp concurrent_slots).",
    ),
    no_browser: bool = typer.Option(
        False, "--no-browser", help="Do not auto-open the rendered HTML page."
    ),
    multi_window: bool = typer.Option(
        False,
        "--multi-window",
        "-w",
        help=(
            "macOS only: open each agent in its own Terminal.app window "
            "(tiled as a grid). Great for demos — each window streams one agent."
        ),
    ),
) -> None:
    """Fan out N concurrent agents against Atomic-Chat's local API server."""
    if multi_window:
        exit_code = asyncio.run(
            _run_multi_window(
                scenario_name=scenario,
                topic=topic,
                tasks=tasks,
                open_browser=not no_browser,
            )
        )
    else:
        exit_code = asyncio.run(
            _run(
                scenario_name=scenario,
                topic=topic,
                tasks=tasks,
                open_browser=not no_browser,
            )
        )
    raise typer.Exit(exit_code)


@app.command("agent")
def agent_cmd(
    session_dir: pathlib.Path = typer.Option(
        ...,
        "--session-dir",
        help="Shared session directory populated by the `--multi-window` parent.",
    ),
    agent_idx: int = typer.Option(
        ...,
        "--agent-idx",
        help="Zero-based index of the agent to run (matches session.json order).",
    ),
) -> None:
    """Run one agent in the host terminal (used internally by --multi-window).

    Not intended for direct invocation — but handy for debugging a single slot.
    """
    session_path = session_dir / "session.json"
    if not session_path.exists():
        print(f"session.json not found at {session_path}", file=sys.stderr)
        raise typer.Exit(2)
    session = json.loads(session_path.read_text(encoding="utf-8"))
    exit_code = asyncio.run(_run_solo_agent(session, agent_idx, session_dir))
    raise typer.Exit(exit_code)


@app.command("dashboard")
def dashboard_cmd(
    session_dir: pathlib.Path = typer.Option(
        ...,
        "--session-dir",
        help="Shared session directory populated by the `--multi-window` parent.",
    ),
) -> None:
    """Run the aggregate dashboard window (used internally by --multi-window).

    Polls per-agent state files and `/metrics` to render the same Rich
    dashboard as single-process mode in a dedicated Terminal window above
    the agent grid.
    """
    session_path = session_dir / "session.json"
    if not session_path.exists():
        print(f"session.json not found at {session_path}", file=sys.stderr)
        raise typer.Exit(2)
    session = json.loads(session_path.read_text(encoding="utf-8"))
    exit_code = asyncio.run(_run_session_dashboard(session, session_dir))
    raise typer.Exit(exit_code)


def _main() -> None:
    """Entrypoint that preserves backward-compatible single-command invocation.

    Before we added the `agent` subcommand, `run.sh` called
    `python -m demo.main --scenario ... --topic ...` (no subcommand). To keep
    that usage intact, inject an implicit `run` when the first argument is not
    one of the known subcommands.
    """
    known = {"run", "agent", "dashboard"}
    argv = sys.argv
    if len(argv) == 1:
        argv.insert(1, "run")
    elif argv[1] not in known and argv[1] not in {"--help", "-h"}:
        argv.insert(1, "run")
    app()


if __name__ == "__main__":
    _main()

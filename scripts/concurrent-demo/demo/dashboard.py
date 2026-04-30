"""
demo/dashboard.py — Rich Live grid for the multi-agent demo.

The dashboard consumes progress events pushed onto an ``asyncio.Queue`` by
agent coroutines and renders a grid of compact per-agent panels plus a footer
line with aggregate llama-server metrics (slots busy, KV usage, tokens/sec).

Event schema (dict on the queue):
    {
        "name":     str,          # agent name (== key used in results dict)
        "emoji":    str,
        "color":    str,          # "0;31" | "1;32" ... ANSI code
        "status":   str,          # "waiting" | "running" | "done" | "error"
        "tokens":   int,          # running total produced by this agent
        "tps":      float,        # server-reported or derived tokens/sec
        "elapsed":  float,        # wall-clock seconds since start
        "preview":  str,          # last ~120 chars of generated content
    }
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

import pyfiglet
from rich.align import Align
from rich.console import Console, Group
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from demo.metrics import ServerMetrics

REFRESH_PER_SECOND = 4
_HERO_FONT = "ansi_shadow"
# width=300 keeps long titles on a single 7-row figlet block instead of being
# wrapped into multi-row chunks (pyfiglet's default smart layout).
_HERO_FIGLET = pyfiglet.Figlet(font=_HERO_FONT, width=300)
_BRAND_ASCII = _HERO_FIGLET.renderText("Atomic Agent").rstrip("\n")

_ANSI_TO_RICH: dict[str, str] = {
    "1;31": "bold red", "1;32": "bold green", "1;33": "bold yellow",
    "1;34": "bold blue", "1;35": "bold magenta", "1;36": "bold cyan",
    "1;37": "bold white", "0;31": "red", "0;32": "green", "0;33": "yellow",
    "0;34": "blue", "0;35": "magenta", "0;36": "cyan", "0;37": "white",
}

_STATUS_STYLE: dict[str, tuple[str, str]] = {
    "waiting": ("\u23f3", "dim"),
    "running": ("\u26a1", "bold green"),
    "done": ("\u2705", "bold"),
    "error": ("\u274c", "bold red"),
}


@dataclass(slots=True)
class AgentState:
    """Accumulated UI state for a single agent panel."""

    name: str
    emoji: str
    color: str
    status: str = "waiting"
    tokens: int = 0
    tps: float = 0.0
    elapsed: float = 0.0
    preview: str = ""

    def apply(self, event: dict[str, Any]) -> None:
        self.status = event.get("status", self.status)
        if "tokens" in event:
            self.tokens = int(event["tokens"])
        if "tps" in event:
            self.tps = float(event["tps"])
        if "elapsed" in event:
            self.elapsed = float(event["elapsed"])
        if "preview" in event:
            self.preview = str(event["preview"])


@dataclass(slots=True)
class DashboardState:
    """Dashboard state shared between the renderer and the event pump."""

    agents: dict[str, AgentState] = field(default_factory=dict)
    topic: str = ""
    scenario: str = ""
    model_id: str = ""
    slot_total: int = 0
    server: ServerMetrics = field(default_factory=ServerMetrics)
    compact: bool = False
    peak_combined_tps: float = 0.0

    @classmethod
    def initial(
        cls,
        agents: list[dict],
        *,
        topic: str,
        scenario: str,
        model_id: str,
        slot_total: int,
        compact: bool = False,
    ) -> DashboardState:
        return cls(
            agents={
                a["name"]: AgentState(
                    name=a["name"],
                    emoji=a.get("emoji", "\U0001f916"),
                    color=a.get("color", "1;37"),
                )
                for a in agents
            },
            topic=topic,
            scenario=scenario,
            model_id=model_id,
            slot_total=slot_total,
            compact=compact,
        )


def _grid_columns(n: int) -> int:
    if n <= 2:
        return n
    if n <= 4:
        return 2
    if n <= 9:
        return 3
    return 4


def _render_agent_panel(state: AgentState, *, compact: bool = False) -> Panel:
    status_icon, status_style = _STATUS_STYLE.get(state.status, ("?", "dim"))
    rich_color = _ANSI_TO_RICH.get(state.color, "white")

    header = Text.from_markup(
        f"{state.emoji}  [{rich_color}]{state.name}[/]   "
        f"[{status_style}]{status_icon} {state.status}[/]"
    )

    stats = Text.from_markup(
        f"[bright_white]{state.tokens} tok[/]  "
        f"[bold bright_yellow]{state.tps:.1f} t/s[/]  "
        f"[dim]{state.elapsed:.1f}s[/]"
    )

    border = "cyan" if state.status == "running" else "bright_black"
    if compact:
        return Panel(Group(header, stats), border_style=border, padding=(0, 1))

    preview = state.preview.strip()
    if len(preview) > 200:
        preview = preview[-200:]
    preview_text = Text(preview or " ", style="white", no_wrap=False, overflow="fold")

    return Panel(
        Group(header, stats, preview_text),
        border_style=border,
        padding=(0, 1),
    )


def render(state: DashboardState) -> Group:
    """Build the full dashboard renderable for one frame."""
    agent_list = list(state.agents.values())

    # In `compact` mode (the multi-window dashboard) each agent already has
    # its own Terminal window, so the per-agent grid here is redundant and
    # eats vertical space — skip it. In single-window mode the grid is the
    # only place to see agents, so we still build it.
    grid: Table | None = None
    if not state.compact:
        cols = _grid_columns(len(agent_list))
        grid = Table(
            box=None, show_header=False, show_edge=False, padding=(0, 1), expand=True
        )
        for _ in range(cols):
            grid.add_column(ratio=1)

        row: list[Panel] = []
        for agent in agent_list:
            row.append(_render_agent_panel(agent, compact=state.compact))
            if len(row) == cols:
                grid.add_row(*row)
                row = []
        if row:
            while len(row) < cols:
                row.append(Panel(Text(""), border_style="bright_black"))
            grid.add_row(*row)

    done = sum(1 for a in agent_list if a.status == "done")
    running = sum(1 for a in agent_list if a.status == "running")
    errored = sum(1 for a in agent_list if a.status == "error")
    # Sum across all agents (not just `running`) and lock on to the peak so
    # the hero number stays meaningful after agents finish — otherwise a sum
    # filtered by `running` collapses to 0 and the marketer's recording ends
    # on an empty score.
    current_tps = sum(a.tps for a in agent_list)
    if current_tps > state.peak_combined_tps:
        state.peak_combined_tps = current_tps
    display_tps = max(current_tps, state.peak_combined_tps)
    total_tokens = sum(a.tokens for a in agent_list)

    header_text = Text.from_markup(
        f"[bold cyan]\u26a1 Atomic-Chat \u2014 Concurrent Demo[/]    "
        f"[white]scenario=[/][bold]{state.scenario}[/]  "
        f"[white]topic=[/]\"{state.topic}\"  "
        f"[white]model=[/][bold]{state.model_id}[/]",
        justify="left",
    )

    hero_ascii = _HERO_FIGLET.renderText(f"{display_tps:.1f} TPS").rstrip("\n")
    brand_text = Text(_BRAND_ASCII, style="bold bright_magenta", no_wrap=True)
    number_text = Text(hero_ascii, style="bold bright_yellow", no_wrap=True)

    # No `expand=True` — columns auto-fit to their contents so brand and TPS
    # block sit shoulder-to-shoulder. The whole row is then centred in the panel.
    hero_row = Table.grid(padding=(0, 2))
    hero_row.add_column()
    hero_row.add_column()
    hero_row.add_row(brand_text, number_text)

    # Compact total-tokens line directly under the hero so it never gets
    # clipped when the agent grid grows — kept as plain styled text (not
    # figlet) to stay within one row.
    tokens_caption = Text.from_markup(
        f"[bold bright_white]\u03a3 {total_tokens}[/] [dim]total tokens generated[/]",
        justify="center",
    )

    hero_block = Group(Align.center(hero_row), Align.center(tokens_caption))

    agg_text = Text.from_markup(
        f"[bold bright_green]{done}/{len(agent_list)} done[/]   "
        f"[bold green]{running} running[/]   "
        f"[bold red]{errored} errored[/]"
    )

    if state.server.available:
        server_text = Text.from_markup(
            f"[dim]server:[/] {state.server.summary_line(state.slot_total)}"
        )
    else:
        server_text = Text.from_markup(
            "[dim]server metrics: unavailable "
            "(enable Concurrent Mode or Expose Prometheus /metrics)[/]"
        )

    parts: list = [
        Panel(Align.left(header_text), border_style="cyan"),
        Panel(hero_block, border_style="bright_magenta", padding=(1, 2)),
    ]
    if grid is not None:
        parts.append(grid)
    parts.append(Panel(Group(agg_text, server_text), border_style="cyan"))
    return Group(*parts)


async def run_dashboard(
    state: DashboardState,
    queue: asyncio.Queue[dict | None],
    stop_event: asyncio.Event,
) -> None:
    """Pump events from `queue` into `state` and keep the Live renderer fresh.

    A ``None`` sentinel on the queue signals a terminal flush. `stop_event`
    lets `main.py` stop the dashboard even when no events are in flight (e.g.
    while the orchestrator is planning).
    """
    console = Console()
    with Live(
        render(state),
        console=console,
        refresh_per_second=REFRESH_PER_SECOND,
        screen=False,
        transient=False,
    ) as live:
        while not stop_event.is_set():
            try:
                event = await asyncio.wait_for(queue.get(), timeout=0.25)
            except asyncio.TimeoutError:
                live.update(render(state))
                continue

            if event is None:
                live.update(render(state))
                break

            name = event.get("name")
            if name in state.agents:
                state.agents[name].apply(event)
            live.update(render(state))

        live.update(render(state))

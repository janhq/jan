"""The harness the SDK suite drives: a stub provider on loopback and a scratch
home, so the tests need no credentials, no network and no Jan Desktop.

The provider is the same shape the Rust CLI tests use: the first request is
answered with a tool call, the second with prose, and the bodies are kept so a
test can assert what the model was actually sent.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Union

Reply = Union[str, Callable[["_Handler"], None]]


class _Handler(BaseHTTPRequestHandler):
    """The handler http.server builds per request, with the provider attached.

    Not a dataclass: http.server instantiates it as
    ``(request, client_address, server)``, so it must keep the base's
    ``__init__``.
    """

    provider: "Provider"

    def do_POST(self) -> None:  # noqa: N802 - the name http.server calls
        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length).decode("utf-8")
        reply = self.provider._next_reply(body)
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.send_header("connection", "close")
        self.end_headers()
        if callable(reply):
            # A reply the test drives: the socket stays open until it says so,
            # which is what an interrupt test needs to interrupt a live turn.
            reply(self)
            self.wfile.flush()
            self.provider._hold.wait(self.provider._hold_timeout)
            return
        self.wfile.write(reply.encode("utf-8"))
        self.wfile.flush()

    def log_message(self, *_: Any) -> None:
        """Silence: the suite's output is the tests', not the server's."""


class Provider:
    """Serve ``replies`` in order, one per request, repeating the last."""

    def __init__(self, replies: Sequence[Reply], hold_timeout: float = 10.0) -> None:
        self.replies = list(replies)
        self.bodies: List[str] = []
        self.connections = 0
        self._lock = threading.Lock()
        self._hold = threading.Event()
        self._hold_timeout = hold_timeout
        self._server: Optional[ThreadingHTTPServer] = None

    def start(self) -> str:
        handler = type("Handler", (_Handler,), {"provider": self})
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self._server.daemon_threads = True
        threading.Thread(target=self._server.serve_forever, name="stub-provider", daemon=True).start()
        host, port = self._server.server_address
        return f"http://{host}:{port}/v1"

    def _next_reply(self, body: str) -> Reply:
        with self._lock:
            body, index = body, self.connections
            self.bodies.append(body)
            self.connections += 1
            return self.replies[min(index, len(self.replies) - 1)]

    def release(self) -> None:
        """Let a held reply finish."""
        self._hold.set()

    def stop(self) -> None:
        self._hold.set()
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()


def tool_call(name: str, args: Dict[str, Any]) -> str:
    """A chunk the model asks for a tool with.

    ``host__`` is the advertised name; the host is told the bare one.
    """
    return "".join(
        [
            "data: "
            + json.dumps(
                {
                    "id": "stub-1",
                    "object": "chat.completion.chunk",
                    "created": 1,
                    "model": "stub-model",
                    "choices": [
                        {
                            "index": 0,
                            "delta": {
                                "role": "assistant",
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "id": "call-1",
                                        "type": "function",
                                        "function": {"name": name, "arguments": json.dumps(args)},
                                    }
                                ],
                            },
                            "finish_reason": None,
                        }
                    ],
                }
            )
            + "\n\n",
            "data: "
            + json.dumps(
                {
                    "id": "stub-1",
                    "object": "chat.completion.chunk",
                    "created": 1,
                    "model": "stub-model",
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}],
                    "usage": {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7},
                }
            )
            + "\n\n",
            "data: [DONE]\n\n",
        ]
    )


def prose(text: str) -> str:
    """Plain prose, which ends the run."""
    return "".join(
        [
            "data: "
            + json.dumps(
                {
                    "id": "stub-2",
                    "object": "chat.completion.chunk",
                    "created": 1,
                    "model": "stub-model",
                    "choices": [{"index": 0, "delta": {"role": "assistant", "content": text}, "finish_reason": None}],
                }
            )
            + "\n\n",
            "data: "
            + json.dumps(
                {
                    "id": "stub-2",
                    "object": "chat.completion.chunk",
                    "created": 1,
                    "model": "stub-model",
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 9, "completion_tokens": 4, "total_tokens": 13},
                }
            )
            + "\n\n",
            "data: [DONE]\n\n",
        ]
    )


def streamed(tokens: Sequence[str], delay: float = 0.010, burst: int = 1) -> Callable[[_Handler], None]:
    """One token per chunk, in bursts of ``burst`` with a pause between them.

    A turn long enough that its total output passes the buffer cap, bursty
    enough that a reader falls a few events behind inside a burst and catches up
    between them: what tells a cap on the *unread* buffer apart from a count of
    everything the turn ever buffered.
    """

    def write(handler: _Handler) -> None:
        for index, text in enumerate(tokens):
            handler.wfile.write(
                (
                    "data: "
                    + json.dumps(
                        {
                            "id": "stub-4",
                            "object": "chat.completion.chunk",
                            "created": 1,
                            "model": "stub-model",
                            "choices": [{"index": 0, "delta": {"role": "assistant", "content": text}, "finish_reason": None}],
                        }
                    )
                    + "\n\n"
                ).encode("utf-8")
            )
            handler.wfile.flush()
            if delay and (index + 1) % burst == 0:
                time.sleep(delay)
        handler.wfile.write(
            (
                "data: "
                + json.dumps(
                    {
                        "id": "stub-4",
                        "object": "chat.completion.chunk",
                        "created": 1,
                        "model": "stub-model",
                        "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                        "usage": {"prompt_tokens": 9, "completion_tokens": len(tokens), "total_tokens": 9 + len(tokens)},
                    }
                )
                + "\n\n"
                + "data: [DONE]\n\n"
            ).encode("utf-8")
        )
        handler.wfile.flush()

    return write


def holding(text: str) -> Callable[[_Handler], None]:
    """One token, then the socket stays open: a turn to interrupt mid-flight."""

    def write(handler: _Handler) -> None:
        handler.wfile.write(
            (
                "data: "
                + json.dumps(
                    {
                        "id": "stub-3",
                        "object": "chat.completion.chunk",
                        "created": 1,
                        "model": "stub-model",
                        "choices": [{"index": 0, "delta": {"role": "assistant", "content": text}, "finish_reason": None}],
                    }
                )
                + "\n\n"
            ).encode("utf-8")
        )

    return write


class Scratch:
    """A private home and project, removed by :meth:`cleanup`."""

    def __init__(self, bin: str) -> None:
        self.bin = bin
        self.root = Path(tempfile.mkdtemp(prefix="jan-sdk-py-"))
        self.home = self.root / "home"
        self.project = self.root / "project"
        self.home.mkdir(parents=True, exist_ok=True)
        self.project.mkdir(parents=True, exist_ok=True)

    @property
    def env(self) -> Dict[str, str]:
        return {**os.environ, "HOME": str(self.home), "JAN_CLI_NO_UPDATE_CHECK": "1"}

    def configure(self, base_url: str) -> None:
        """Point the runtime at the stub provider, so a session resolves a model."""
        subprocess.run(
            [
                self.bin,
                "config",
                "set",
                "--provider",
                "stub",
                "--api-key",
                "test-key",
                "--base-url",
                base_url,
                "--model",
                "stub-model",
            ],
            env=self.env,
            check=True,
            capture_output=True,
        )

    def start(self, **options: Any):
        from jan_agent_sdk import JanRuntime

        return JanRuntime.start(bin=self.bin, env=self.env, **options)

    def cleanup(self) -> None:
        import shutil

        shutil.rmtree(self.root, ignore_errors=True)

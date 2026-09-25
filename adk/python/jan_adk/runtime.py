"""The runtime process: one long-lived ``jan cli agent rpc``, spawned and owned.

Everything a client does goes through the JSON-RPC channel this object holds:
the handshake, one request at a time with an answer, and the notifications a
turn streams back. One reader thread owns the channel, so a turn's events never
wait on a request's answer, and a request never waits on a turn.
"""

from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
from collections import deque
from typing import Any, Callable, Deque, Dict, List, Optional, Sequence, Union

from ._generated import PROTOCOL_VERSION
from .errors import JanRpcError, JanRuntimeError
from .session import HostTool, JanSession

try:  # The version is for the handshake's clientInfo; a source checkout has no metadata.
    from importlib.metadata import PackageNotFoundError, version as _package_version

    try:
        CLIENT_VERSION = _package_version("jan-adk")
    except PackageNotFoundError:  # pragma: no cover - source checkout
        CLIENT_VERSION = "0.0.0+source"
except ImportError:  # pragma: no cover - Python < 3.8 has no importlib.metadata
    CLIENT_VERSION = "0.0.0+source"

CLIENT_NAME = "jan-adk"


class _Pending:
    """One request's slot: the reader thread fills it, the caller waits."""

    __slots__ = ("method", "done", "result", "error")

    def __init__(self, method: str) -> None:
        self.method = method
        self.done = threading.Event()
        self.result: Any = None
        self.error: Optional[BaseException] = None

    def resolve(self, result: Any) -> None:
        self.result = result
        self.done.set()

    def reject(self, error: BaseException) -> None:
        self.error = error
        self.done.set()

    def wait(self, timeout: Optional[float]) -> Any:
        if not self.done.wait(timeout):
            raise JanRuntimeError(f"{self.method!r} was not answered in time")
        if self.error is not None:
            raise self.error
        return self.result


class JanRuntime:
    """A Jan runtime process.

    :meth:`start` resolves once the handshake is done, so a runtime that cannot
    speak this protocol version fails before any work starts rather than
    mid-turn.
    """

    def __init__(
        self,
        *,
        bin: Optional[str] = None,
        args: Sequence[str] = ("cli", "agent", "rpc"),
        cwd: Optional[Union[str, os.PathLike]] = None,
        env: Optional[Dict[str, str]] = None,
        client_info: Optional[Dict[str, str]] = None,
        handshake_timeout: float = 20.0,
        shutdown_grace: float = 5.0,
        max_buffered_events: int = 100_000,
        on_stderr: Optional[Callable[[str], None]] = None,
    ) -> None:
        self.binary = bin or os.environ.get("JAN_BIN") or "jan"
        self.cwd = str(cwd) if cwd is not None else None
        self.max_buffered_events = max_buffered_events
        self._client_info = client_info or {"name": CLIENT_NAME, "version": CLIENT_VERSION}
        self._handshake_timeout = handshake_timeout
        self._shutdown_grace = shutdown_grace
        self._on_stderr = on_stderr
        self._stderr_tail: Deque[str] = deque(maxlen=256)
        self._lock = threading.Lock()
        # `queue` here is the standard library's, not `._queue` - the ADK's own
        # event queue - which is why no module of this package shadows it.
        self._dispatch_queue: "queue.Queue[Optional[Any]]" = queue.Queue()
        self._dispatch_thread = threading.Thread(target=self._run_dispatch, name="jan-adk-events", daemon=True)
        self._pending: Dict[int, _Pending] = {}
        self._next_id = 1
        self._sessions: Dict[str, JanSession] = {}
        self._listeners: Dict[str, List[Callable[[Any], None]]] = {}
        self._failure: Optional[JanRuntimeError] = None
        self._closing = False
        self._protocol_version: Optional[int] = None
        self._server_info: Optional[Dict[str, str]] = None
        self._capabilities: Optional[Dict[str, Any]] = None
        self._limits: Optional[Dict[str, Any]] = None

        environment = {
            **os.environ,
            # The ADK owns this process and its lifetime; an update check nobody
            # asked for is a network call inside a caller's turn.
            "JAN_CLI_NO_UPDATE_CHECK": "1",
            **(env or {}),
        }
        try:
            self._process = subprocess.Popen(
                [self.binary, *args],
                cwd=self.cwd,
                env=environment,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
        except OSError as error:
            # A binary that is not there is the channel failing to exist, which
            # is what `JanRuntimeError` is for - not a stray `FileNotFoundError`
            # from the spawn. No thread has been started yet, so nothing leaks.
            raise JanRuntimeError(f"could not start '{self.binary}': {error.strerror or error}") from None
        # Threads start only once the process exists: a failed spawn leaves
        # nothing behind to join, and the dispatcher never runs without events.
        self._dispatch_thread.start()
        self._reader = threading.Thread(target=self._read_stdout, name="jan-rpc-reader", daemon=True)
        self._reader.start()
        self._stderr_reader = threading.Thread(target=self._read_stderr, name="jan-rpc-stderr", daemon=True)
        self._stderr_reader.start()

    # -- construction ------------------------------------------------------

    @classmethod
    def start(cls, **options: Any) -> "JanRuntime":
        """Spawn a runtime and complete the handshake."""
        runtime = cls(**options)
        try:
            runtime._handshake()
        except BaseException:
            runtime._kill()
            raise
        return runtime

    def __enter__(self) -> "JanRuntime":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()

    # -- what the handshake said ------------------------------------------

    @property
    def protocol_version(self) -> Optional[int]:
        """The version the runtime answered with, or the handshake threw."""
        return self._protocol_version

    @property
    def server_info(self) -> Optional[Dict[str, str]]:
        return self._server_info

    @property
    def capabilities(self) -> Optional[Dict[str, Any]]:
        return self._capabilities

    @property
    def limits(self) -> Optional[Dict[str, Any]]:
        """The caps a content-part array is held to - a prompt's images and a
        host tool's answer alike. ``None`` when the runtime is too old to
        advertise them."""
        return self._limits

    @property
    def pid(self) -> Optional[int]:
        return self._process.pid

    @property
    def stderr(self) -> str:
        """The runtime's own stderr so far."""
        return "".join(self._stderr_tail)

    def on(self, kind: str, listener: Callable[[Any], None]) -> Callable[[], None]:
        """Observe ``'exit'``, a frame's ``'notification'``, or an ``'event'``
        for a session this runtime does not know."""
        self._listeners.setdefault(kind, []).append(listener)

        def off() -> None:
            self._listeners[kind] = [entry for entry in self._listeners.get(kind, []) if entry is not listener]

        return off

    # -- the surface -------------------------------------------------------

    def create_session(
        self,
        *,
        cwd: Optional[Union[str, os.PathLike]] = None,
        model: Optional[str] = None,
        ephemeral: Optional[bool] = None,
        builtins: Optional[bool] = None,
        permissions: Optional[str] = None,
        tools: Sequence[HostTool] = (),
    ) -> JanSession:
        """Start a session. ``tools`` are host tools this session may call.

        ``permissions`` says who gates a host tool call: ``"host"`` when this
        process runs and gates its own tools, so the runtime never prompts for
        them, and ``"jan"`` (the default) to leave the gate with the runtime -
        an actuator call then raises ``permission_request`` and the turn waits
        until ``session.respond_permission`` answers it.
        """
        params: Dict[str, Any] = {"cwd": str(cwd) if cwd is not None else self.cwd or os.getcwd()}
        if model is not None:
            params["model"] = model
        if ephemeral is not None:
            params["ephemeral"] = ephemeral
        if builtins is not None:
            params["builtins"] = builtins
        if permissions is not None and permissions != "jan":
            params["permissions"] = permissions
        if tools:
            params["tools"] = [tool.declaration() for tool in tools]
        session = self._session(self.request("session/start", params))
        if tools:
            session._declare(tools)
        return session

    def list_sessions(self) -> List[Dict[str, Any]]:
        """Sessions this process is serving, as the runtime sees them."""
        return self.request("session/list", {})["sessions"]

    def resume_session(self, session_id: str) -> JanSession:
        """Reopen a session of this process from its id.

        Host tools are not inherited: declare them again with
        :meth:`JanSession.set_tools`.
        """
        return self._session(self.request("session/resume", {"sessionId": session_id}))

    def fork_session(self, session_id: str, tools: Sequence[HostTool] = ()) -> JanSession:
        """A new session with another session's history.

        Host tools are not inherited - a declaration belongs to the session that
        made it - so they are re-declared here when given.
        """
        source = self._sessions.get(session_id)
        forked = self.request("session/fork", {"sessionId": session_id})["sessionId"]
        view = self.request("session/tools/get", {"sessionId": forked})
        # The tools view carries the tools and nothing else: the id and the
        # model have to come from the fork itself and from the session it was
        # forked from, which the runtime rebuilt it from.
        session = self._session({**view, "sessionId": forked, "model": source.model if source is not None else None})
        if tools:
            session.set_tools(tools)
        return session

    def request(self, method: str, params: Optional[Dict[str, Any]] = None, timeout: Optional[float] = None) -> Any:
        """One JSON-RPC request, answered or refused.

        The escape hatch for a verb this client has no wrapper for.
        """
        if self._failure is not None:
            raise self._failure
        if self._closing:
            raise JanRuntimeError("the runtime is closing")
        with self._lock:
            request_id = self._next_id
            self._next_id += 1
            pending = _Pending(method)
            self._pending[request_id] = pending
            try:
                assert self._process.stdin is not None
                self._process.stdin.write(json.dumps({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}}) + "\n")
                self._process.stdin.flush()
            except (BrokenPipeError, ValueError, OSError) as error:
                self._pending.pop(request_id, None)
                raise JanRuntimeError(f"could not write to the runtime: {error}", stderr=self.stderr) from None
        try:
            return pending.wait(timeout)
        finally:
            self._pending.pop(request_id, None)

    def close(self, *, force: bool = False) -> Optional[int]:
        """Close the channel, then the process.

        Closing stdin is the runtime's own shutdown signal, and a turn still
        running when it arrives is closed with ``stopReason: interrupted``
        before the process exits. ``force`` skips the grace period and kills.
        """
        if self._closing:
            return self._wait_or_kill()
        self._closing = True
        gone = JanRuntimeError("the runtime was closed")
        for session in list(self._sessions.values()):
            session._fail(gone)
        self._sessions.clear()
        if self._process.stdin is not None and not self._process.stdin.closed:
            try:
                self._process.stdin.close()
            except OSError:
                pass
        if force:
            self._kill()
            self._dispatch_queue.put(None)
            return self._process.wait()
        code = self._wait_or_kill()
        self._dispatch_queue.put(None)
        return code

    # -- internals ---------------------------------------------------------

    def _handshake(self) -> None:
        try:
            result = self.request(
                "initialize",
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "clientInfo": self._client_info,
                    "capabilities": {},
                },
                timeout=self._handshake_timeout,
            )
        except JanRpcError as error:
            raise JanRuntimeError(
                f"{self.binary!r} refused the handshake: {error}" + (f": {self.stderr.strip()}" if self.stderr else ""),
                stderr=self.stderr,
            ) from error
        if result.get("protocolVersion") != PROTOCOL_VERSION:
            raise JanRuntimeError(
                f"the runtime speaks protocol version {result.get('protocolVersion')}, "
                f"this client speaks {PROTOCOL_VERSION}",
                stderr=self.stderr,
            )
        self._protocol_version = result["protocolVersion"]
        self._server_info = result.get("serverInfo")
        self._capabilities = result.get("capabilities")
        self._limits = result.get("input_content_parts")
        with self._lock:
            assert self._process.stdin is not None
            self._process.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "initialized", "params": {}}) + "\n")
            self._process.stdin.flush()

    def _wait_or_kill(self) -> int:
        try:
            return self._process.wait(timeout=self._shutdown_grace)
        except subprocess.TimeoutExpired:
            self._kill()
            return self._process.wait()

    def _kill(self) -> None:
        self._closing = True
        try:
            self._process.kill()
        except (ProcessLookupError, OSError):
            pass

    def _session(self, view: Dict[str, Any]) -> JanSession:
        session = JanSession(self, view)
        self._sessions[session.id] = session
        return session

    def _release(self, session: JanSession) -> None:
        self._sessions.pop(session.id, None)

    def _read_stdout(self) -> None:
        assert self._process.stdout is not None
        for line in self._process.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                frame = json.loads(line)
            except ValueError:
                self._fail(JanRuntimeError(f"the runtime wrote a line that is not JSON: {line[:200]}", stderr=self.stderr))
                return
            try:
                self._dispatch(frame)
            except Exception as error:  # noqa: BLE001 - one bad frame must not stop the reader
                self._fail(JanRuntimeError(f"the ADK could not route a frame: {error}", stderr=self.stderr))
                return
        # EOF: the process is gone or going. Anything still parked has no answer
        # coming, which is exactly what the failure below says.
        code = self._process.wait()
        self._fail(
            JanRuntimeError(
                f"the jan runtime exited with code {code}" + (f": {self.stderr.strip()}" if self.stderr else ""),
                exit_code=code,
                stderr=self.stderr,
            ),
            notify_exit=True,
        )

    def _read_stderr(self) -> None:
        assert self._process.stderr is not None
        for line in self._process.stderr:
            self._stderr_tail.append(line)
            if self._on_stderr is not None:
                self._on_stderr(line)

    def _dispatch(self, frame: Dict[str, Any]) -> None:
        if "method" not in frame:
            pending = self._pending.get(frame.get("id"))
            if pending is None:
                return
            error = frame.get("error")
            if error:
                pending.reject(
                    JanRpcError(
                        error.get("message") or "the runtime refused the request",
                        code=error.get("code"),
                        data=error.get("data"),
                        method=pending.method,
                    )
                )
                return
            pending.resolve(frame.get("result"))
            return
        method = frame["method"]
        params = frame.get("params") or {}
        if method.startswith("item/"):
            session = self._sessions.get(params.get("sessionId"))
            if session is not None:
                session._deliver(method[len("item/") :], params)
            else:
                self._emit("event", {**params, "tag": method[len("item/") :]})
            return
        if method == "turn/completed":
            session = self._sessions.get(params.get("sessionId"))
            if session is not None:
                session._complete(params)
            return
        self._emit("notification", frame)

    def _emit(self, kind: str, payload: Any) -> None:
        for listener in list(self._listeners.get(kind, [])):
            self._notify(listener, payload)

    def _notify(self, listener: Callable[[Any], None], payload: Any) -> None:
        """Hand a listener its event on the dispatch thread.

        A listener is allowed to call back into the runtime - answering a
        permission request is the case that matters - so listeners never run on
        the reader, where the answer they are waiting for could not arrive.
        Order is kept: one thread drains the queue in the order events are read.
        """
        self._dispatch_queue.put((listener, payload))

    def _run_dispatch(self) -> None:
        while True:
            job = self._dispatch_queue.get()
            if job is None:
                return
            listener, payload = job
            try:
                listener(payload)
            except Exception as error:  # noqa: BLE001 - a listener chose to raise
                self._fail(JanRuntimeError(f"an event listener raised: {error}", stderr=self.stderr))
                return

    def _fail(self, error: JanRuntimeError, *, notify_exit: bool = False) -> None:
        if self._failure is not None:
            if notify_exit:
                self._emit("exit", {"code": error.exit_code})
            return
        self._failure = error
        for pending in self._pending.values():
            pending.reject(error)
        self._pending.clear()
        for session in list(self._sessions.values()):
            session._fail(error)
        self._sessions.clear()
        if notify_exit:
            self._emit("exit", {"code": error.exit_code})

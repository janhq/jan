"""Sessions, turns and the host tools they call."""

from __future__ import annotations

import base64
import mimetypes
import threading
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, List, Optional, Sequence, Union

from .errors import JanRuntimeError
from ._queue import EventQueue

#: What a host tool is told about the call it is running.
@dataclass
class HostToolCall:
    request_id: str
    """The id the answer is written against."""
    tool_name: str
    """The name the host declared, not the ``host__``-prefixed name the model calls."""
    run_id: Optional[str]
    """The child that called it, or ``None`` for the main run."""
    session: "JanSession"
    aborted: threading.Event
    """Set when the runtime withdraws the request; a late answer is refused."""


@dataclass
class HostTool:
    """A host tool: what the model sees, plus the handler that runs it here.

    ``capability`` is what the tool does, which decides how the loop treats it:
    ``read`` (a camera, a sensor) is never prompted, is advertised in Plan mode
    and runs concurrently; ``actuator`` is prompted even under ``auto_approve``
    unless the host owns the gate, runs sequentially, and is withheld in Plan
    mode.
    """

    name: str
    handler: Callable[[Any, HostToolCall], Any]
    description: Optional[str] = None
    parameters: Optional[Dict[str, Any]] = None
    capability: Optional[str] = None

    def declaration(self) -> Dict[str, Any]:
        """The wire form: the handler never crosses the process boundary."""
        declaration: Dict[str, Any] = {"name": self.name}
        if self.description is not None:
            declaration["description"] = self.description
        if self.parameters is not None:
            declaration["parameters"] = self.parameters
        if self.capability is not None:
            declaration["capability"] = self.capability
        return declaration


@dataclass
class TurnResult:
    """The terminal record of a turn."""

    stop_reason: str
    usage: Any = None
    error: Optional[str] = None


class JanTurn:
    """One turn of a session: what ``session.prompt()`` returns.

    Iterate it for the events as they stream, and call :meth:`result` for the
    terminal record. Both are safe in any order and more than once; events are
    buffered until read.
    """

    def __init__(self, session: "JanSession", turn_id: str) -> None:
        self.session = session
        self.id = turn_id
        #: Events dropped because nobody was draining this turn, oldest first.
        #: A reader that iterates the turn never drops any.
        self.dropped = 0
        self._queue = EventQueue()
        self._terminal = threading.Event()
        self._result: Optional[TurnResult] = None
        self._failure: Optional[BaseException] = None

    def __iter__(self) -> Iterator[Dict[str, Any]]:
        return iter(self._queue)

    def result(self, timeout: Optional[float] = None) -> TurnResult:
        """Block for ``{stop_reason, usage, error}``.

        Raises :class:`JanRuntimeError` when the channel dies first: a turn with
        no terminal record has no outcome to report.
        """
        if not self._terminal.wait(timeout):
            raise JanRuntimeError(f"the turn {self.id} did not finish within {timeout}s")
        if self._failure is not None:
            raise self._failure
        assert self._result is not None
        return self._result

    def interrupt(self) -> None:
        """Stop this turn; it still settles, with ``stopReason: interrupted``."""
        self.session.interrupt()

    # -- the session's own calls ------------------------------------------

    def _push(self, event: Dict[str, Any]) -> None:
        self._queue.push(event)
        # The cap is on what is still unread, not on the turn's own output: a
        # reader that keeps up takes events out, so the queue's depth is the
        # buffer. A running total would start dropping events a reader never
        # missed the moment the turn had emitted more than the cap in total.
        while len(self._queue) > self.session.max_buffered_events:
            if not self._queue.drop_oldest():
                return
            self.dropped += 1

    def _finish(self, result: TurnResult) -> None:
        self._result = result
        self._queue.end()
        self._terminal.set()

    def _fail(self, error: BaseException) -> None:
        self._failure = error
        self._queue.fail(error)
        self._terminal.set()


class JanSession:
    """A session on a runtime: a conversation, its model, and its host tools."""

    def __init__(self, runtime: Any, view: Dict[str, Any]) -> None:
        self.runtime = runtime
        self.id: str = view["sessionId"]
        self.model: Optional[str] = view.get("model")
        #: The names the runtime advertises, as it reports them: the declared
        #: ones with their ``host__`` prefix, which is what the model calls.
        self.tools: List[str] = list(view.get("tools") or [])
        self.tool_specs: List[Dict[str, Any]] = list(view.get("toolSpecs") or [])
        self.max_buffered_events = runtime.max_buffered_events
        self._turns: Dict[str, JanTurn] = {}
        self._tools: Dict[str, HostTool] = {}
        self._listeners: Dict[str, List[Callable[[Dict[str, Any]], None]]] = {}
        self._calls: Dict[str, threading.Event] = {}
        self._late: "OrderedDict[str, TurnResult]" = OrderedDict()
        self._closed = False

    # -- the surface ------------------------------------------------------

    def on(self, kind: str, listener: Callable[[Dict[str, Any]], None]) -> Callable[[], None]:
        """Observe every event of the session, one event tag, or ``'*'``.

        ``kind`` is ``"event"`` for the stream as a whole, ``"*"`` for
        everything the session reports, or an event tag such as
        ``"token"``, ``"tool_request"`` or ``"permission_request"``:
        ``on("tool_request", fn)`` observes host tool calls, which are
        answered from the declaration's handler either way.

        The listener runs on the ADK's own dispatch thread, in the order the
        runtime emitted the events, so it may call back into the runtime -
        answering a permission request from one is the case that matters -
        but it shares that thread and must not block for long.
        """
        self._listeners.setdefault(kind, []).append(listener)

        def off() -> None:
            self._listeners[kind] = [entry for entry in self._listeners.get(kind, []) if entry is not listener]

        return off

    def prompt(self, content: Union[str, List[Dict[str, Any]], Dict[str, Any]]) -> JanTurn:
        """Start a turn and return it for iteration.

        ``content`` is a string, or content parts for the images a vision model
        needs: ``[{"type": "text", "text": ...}, {"type": "image_url",
        "image_url": {"url": "data:image/png;base64,..."}}]``.
        """
        turn_id = self.runtime.request("turn/start", {"sessionId": self.id, "input": normalize_input(content)})["turnId"]
        return self._turn(turn_id, create=True)

    def steer(self, content: Union[str, Dict[str, Any]]) -> None:
        """Steer the active turn: the message joins the run already in flight."""
        self.runtime.request("turn/steer", {"sessionId": self.id, "input": extract_text(content)})

    def interrupt(self) -> None:
        """Stop the active turn and withdraw its outstanding host tool calls."""
        self.runtime.request("turn/interrupt", {"sessionId": self.id})

    def reset(self) -> None:
        """Clear the history, keeping the model and the tool set."""
        self.runtime.request("session/reset", {"sessionId": self.id})

    def get_tools(self) -> Dict[str, Any]:
        """The tool set the runtime currently advertises, read back from it."""
        return self.runtime.request("session/tools/get", {"sessionId": self.id})

    def set_tools(self, tools: Sequence[HostTool]) -> Dict[str, Any]:
        """Replace the host tools between turns; refused while a turn is active."""
        view = self.runtime.request(
            "session/tools/set",
            {"sessionId": self.id, "tools": [tool.declaration() for tool in tools]},
        )
        self._declare(tools)
        self.tools = list(view["tools"])
        self.tool_specs = list(view["toolSpecs"])
        return view

    def set_model(self, model: str) -> str:
        """Change the model between turns; refused while a turn is active."""
        current = self.runtime.request("session/model/set", {"sessionId": self.id, "model": model})["model"]
        self.model = current
        return current

    def fork(self, tools: Sequence[HostTool] = ()) -> "JanSession":
        """A new session with this one's history.

        Host tools are not inherited - a declaration belongs to the session that
        made it - so they are re-declared here when given.
        """
        return self.runtime.fork_session(self.id, tools)

    def archive(self) -> None:
        """Drop the session from the runtime."""
        self.runtime.request("session/archive", {"sessionId": self.id})
        self.runtime._release(self)
        self._closed = True
        self._abort(JanRuntimeError("the session was archived"))
        self._listeners.clear()

    def respond_permission(self, request_id: str, decision: str) -> None:
        """Answer a permission request: ``allow_once``, ``allow_always`` or ``deny``."""
        self.runtime.request("permission/respond", {"requestId": request_id, "decision": decision})

    # -- the runtime's own calls ------------------------------------------

    def _declare(self, tools: Sequence[HostTool]) -> None:
        self._tools = {tool.name: tool for tool in tools}

    def _deliver(self, tag: str, params: Dict[str, Any]) -> None:
        event = params.get("event") or {}
        self._emit("event", event)
        turn = self._turn(params.get("turnId"), create=True)
        if turn is not None:
            turn._push(event)
        # By tag as well, so ``on("tool_request")`` and
        # ``on("permission_request")`` hear what they were told they would.
        self._notify(tag, event)
        if tag == "tool_request":
            self._answer(event)
        elif tag == "tool_request_cancelled":
            self._abandon(event)

    def _complete(self, params: Dict[str, Any]) -> None:
        record = TurnResult(
            stop_reason=params.get("stopReason") or "completed",
            usage=params.get("usage"),
            error=params.get("error"),
        )
        turn = self._turns.pop(params.get("turnId"), None)
        if turn is None:
            # The runtime may close a turn before the client asked for it - a
            # run that ends with no events, or an immediate refusal. The record
            # is held so ``prompt()`` finds it on the turn it is about to
            # return, rather than a turn that never finishes.
            self._late[params.get("turnId") or ""] = record
            while len(self._late) > 64:
                self._late.popitem(last=False)
            return
        turn._finish(record)

    def _fail(self, error: BaseException) -> None:
        for turn in self._turns.values():
            turn._fail(error)
        self._turns.clear()
        self._abort(error)

    # -- internals ---------------------------------------------------------

    def _turn(self, turn_id: Optional[str], *, create: bool = False) -> Optional[JanTurn]:
        if not turn_id:
            return None
        existing = self._turns.get(turn_id)
        if existing is not None:
            return existing
        if not create:
            return None
        turn = JanTurn(self, turn_id)
        late = self._late.pop(turn_id, None)
        if late is None:
            self._turns[turn_id] = turn
        else:
            turn._finish(late)
        return turn

    def _emit(self, kind: str, event: Dict[str, Any]) -> None:
        """One emission, to that kind and to ``"*"``, which hears everything once."""
        self._notify(kind, event)
        self._notify("*", event)

    def _notify(self, kind: str, event: Dict[str, Any]) -> None:
        """Without the ``"*"`` fan-out, for a second tag on an already-emitted
        event: a tag listener hears it, and ``"*"`` does not hear it twice."""
        for listener in list(self._listeners.get(kind, [])):
            self.runtime._notify(listener, event)

    def _answer(self, event: Dict[str, Any]) -> None:
        """Run a host tool's handler, on its own thread.

        Serializing calls is the host's decision through its own queue, so the
        reader is never held and two children may be in flight at once.
        """
        if self._closed:
            return
        request_id = event.get("request_id") or ""
        tool = self._tools.get(event.get("tool_name") or "")
        aborted = threading.Event()
        self._calls[request_id] = aborted
        call = HostToolCall(
            request_id=request_id,
            tool_name=event.get("tool_name") or "",
            run_id=event.get("run_id"),
            session=self,
            aborted=aborted,
        )

        def run() -> None:
            if tool is None:
                self._respond(
                    request_id,
                    {"content": f"no host tool named '{call.tool_name}' is declared on this session", "isError": True},
                )
                return
            try:
                result = tool.handler(event.get("args"), call)
            except BaseException as error:  # noqa: BLE001 - the answer is the report
                self._respond(request_id, {"content": str(error), "isError": True})
                return
            self._respond(request_id, normalize_result(result))

        threading.Thread(target=run, name=f"jan-tool-{call.tool_name}", daemon=True).start()

    def _abandon(self, event: Dict[str, Any]) -> None:
        request_id = event.get("request_id") or ""
        flag = self._calls.pop(request_id, None)
        if flag is not None:
            flag.set()

    def _respond(self, request_id: str, params: Dict[str, Any]) -> None:
        flag = self._calls.get(request_id)
        if flag is None or flag.is_set():
            self._calls.pop(request_id, None)
            return
        self._calls.pop(request_id, None)
        try:
            self.runtime.request("tool/respond", {"requestId": request_id, **params})
        except Exception:  # noqa: BLE001 - the turn was interrupted or the channel closed
            pass

    def _abort(self, error: BaseException) -> None:
        for flag in self._calls.values():
            flag.set()
        self._calls.clear()


def normalize_input(content: Union[str, List[Dict[str, Any]], Dict[str, Any]]) -> Any:
    """``turn/start`` takes the text, the parts, or the record a stream-json
    client would write to a ``user`` line."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return {"type": "user", "content": content}
    if isinstance(content, dict):
        if isinstance(content.get("text"), str):
            return content["text"]
        if isinstance(content.get("content"), list):
            return {"type": "user", "content": content["content"]}
    raise TypeError("prompt() takes a string, content parts, or a {text} / {content} record")


def extract_text(content: Union[str, Dict[str, Any]]) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, dict) and isinstance(content.get("text"), str):
        return content["text"]
    raise TypeError("steer() takes a string or a {text} record")


def normalize_result(result: Any) -> Dict[str, Any]:
    """What a handler returned, as the ``tool/respond`` the runtime parses.

    A result that cannot be shaped is still answered: the model is never left
    parked on a call this client failed to format.
    """
    if result is None:
        return {"content": ""}
    if isinstance(result, str):
        return {"content": result}
    if not isinstance(result, dict):
        return {"content": str(result)}
    if result.get("isError") is True or isinstance(result.get("error"), str):
        return {"content": result.get("error") or str(result.get("content") or ""), "isError": True}
    parts: List[Dict[str, Any]] = []
    text = result.get("text")
    if text is None and isinstance(result.get("content"), str):
        text = result["content"]
    if text:
        parts.append({"type": "text", "text": str(text)})
    for key in ("parts", "content"):
        value = result.get(key)
        if isinstance(value, list):
            parts.extend(value)
            break
    for image in result.get("images") or []:
        parts.append(to_image_part(image))
    response: Dict[str, Any] = {"content": parts if parts else str(text or "")}
    if result.get("details") is not None:
        details = result["details"]
        # `details` is host-only data echoed back in `tool_details`, and the
        # runtime takes an object of values, so anything else is carried as one.
        response["details"] = details if isinstance(details, dict) else {"value": details}
    return response


def to_image_part(image: Any) -> Dict[str, Any]:
    """An image as the wire wants it: a path, a data URL, or bytes."""
    if isinstance(image, str):
        url = image if image.startswith("data:") else data_url_from_file(image)
        return {"type": "image_url", "image_url": {"url": url}}
    if isinstance(image, Path):
        return {"type": "image_url", "image_url": {"url": data_url_from_file(image)}}
    if isinstance(image, dict):
        if isinstance(image.get("url"), str):
            return {"type": "image_url", "image_url": {"url": image["url"]}}
        if isinstance(image.get("path"), str):
            return {
                "type": "image_url",
                "image_url": {"url": data_url_from_file(image["path"], image.get("mimeType"))},
            }
        if image.get("data") is not None:
            payload = image["data"]
            if isinstance(payload, (bytes, bytearray, memoryview)):
                encoded = base64.b64encode(bytes(payload)).decode("ascii")
            else:
                encoded = str(payload)
            return {
                "type": "image_url",
                "image_url": {"url": f"data:{image.get('mimeType') or 'image/png'};base64,{encoded}"},
            }
    raise TypeError("an image is a path, a data URL, or {data, mimeType}")


def data_url_from_file(path: Union[str, Path], mime_type: Optional[str] = None) -> str:
    resolved = Path(path)
    mime = mime_type or mimetypes.guess_type(resolved.name)[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(resolved.read_bytes()).decode('ascii')}"

"""The Python ADK, driven end to end against a real runtime.

The same conformance cases the JavaScript suite runs, because they are the same
client in a different runtime: the handshake and its caps, a session and its
turn, a host tool's answer becoming the tool message the model sees, an
image-bearing result, a handler that fails, an interrupt that settles once, two
sessions that never hear each other, and a channel that closes under a turn
instead of hanging.

Set ``JAN_BIN`` to the runtime binary; without it the suite skips rather than
fails. Nothing here needs Node.
"""

from __future__ import annotations

import json
import os
import sys
import time
import unittest
from pathlib import Path
from typing import Any, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jan_adk import PROTOCOL_VERSION, HostTool, JanRpcError, JanRuntime, JanRuntimeError  # noqa: E402
from tests.harness import Provider, Scratch, holding, prose, streamed, tool_call  # noqa: E402

BIN = os.environ.get("JAN_BIN")


@unittest.skipUnless(BIN, "set JAN_BIN to the jan binary to run the ADK suite")
class AdkTest(unittest.TestCase):
    def setUp(self) -> None:
        self.provider: Provider | None = None
        self.scratch: Scratch | None = None

    def tearDown(self) -> None:
        if self.provider is not None:
            self.provider.stop()
        if self.scratch is not None:
            self.scratch.cleanup()

    def prepare(self, replies) -> Scratch:
        provider = Provider(replies)
        url = provider.start()
        scratch = Scratch(BIN)
        scratch.configure(url)
        self.provider = provider
        self.scratch = scratch
        return scratch

    # -- the channel ------------------------------------------------------

    def test_a_runtime_handshakes_and_reports_its_caps(self) -> None:
        scratch = self.prepare([prose("unused")])
        with scratch.start() as runtime:
            self.assertEqual(runtime.protocol_version, PROTOCOL_VERSION)
            self.assertEqual(runtime.server_info["name"], "jan")
            self.assertTrue(runtime.capabilities["session"])
            # The caps are the handshake's business: a client that sends an
            # image learns the limits here rather than from a rejection.
            self.assertIsNotNone(runtime.limits, "the handshake advertises the content-part caps")
            self.assertGreaterEqual(runtime.limits["max_images"], 1)
            self.assertIn("image/png", runtime.limits["mime_types"])
            self.assertGreater(runtime.pid or 0, 0)

    def test_a_runtime_that_is_not_there_fails_before_any_work_starts(self) -> None:
        with self.assertRaises(JanRuntimeError):
            JanRuntime.start(bin=os.path.join(self._tmp(), "jan-does-not-exist"), env=os.environ)

    def test_a_request_with_no_runtime_behind_it_is_refused_not_hung(self) -> None:
        scratch = self.prepare([prose("unused")])
        with scratch.start() as runtime:
            with self.assertRaises(JanRpcError) as refusal:
                runtime.request("session/tools/get", {"sessionId": "not-a-session"})
            self.assertEqual(refusal.exception.code, -32602)
            self.assertIn("unknown session", str(refusal.exception))
            self.assertFalse(refusal.exception.retryable)

    # -- sessions and turns -----------------------------------------------

    def test_a_session_runs_a_turn_and_reports_its_own_state(self) -> None:
        scratch = self.prepare([prose("the arm reached bin")])
        with scratch.start() as runtime:
            session = runtime.create_session(
                cwd=scratch.project, model="stub-model", ephemeral=True, builtins=False
            )
            self.assertTrue(session.id)
            self.assertEqual(session.model, "stub-model")

            seen: list[str] = []
            session.on("event", lambda event: seen.append(event["type"]))

            turn = session.prompt("move the arm")
            events = list(turn)
            result = turn.result()

            self.assertEqual(result.stop_reason, "completed")
            self.assertEqual("".join(e["text"] for e in events if e["type"] == "token"), "the arm reached bin")
            self.assertTrue(any(e["type"] == "step" for e in events))
            # The session hears what the turn hears, so a host can observe a run
            # it is not the one iterating.
            self.assertIn("token", seen)

            self.assertEqual(session.get_tools()["tools"], [])
            sessions = {entry["id"]: entry for entry in runtime.list_sessions()}
            self.assertEqual(sessions[session.id]["turns"], 1)
            self.assertEqual(session.set_model("stub-model"), "stub-model")
            session.reset()
            session.archive()

    def test_a_permission_request_the_runtime_owns_is_answered_by_the_host(self) -> None:
        calls: list[dict] = []
        scratch = self.prepare([tool_call("host__robot_arm_move", {"position": "bin"}), prose("the arm reached bin")])
        with scratch.start() as runtime:
            # No `permissions="host"`: the runtime owns the gate, so an actuator
            # is prompted before the call reaches its handler.
            session = runtime.create_session(
                cwd=scratch.project,
                model="stub-model",
                ephemeral=True,
                builtins=False,
                tools=[
                    HostTool(
                        name="robot_arm_move",
                        description="Move the arm.",
                        capability="actuator",
                        handler=lambda args, _call: calls.append(args) or {"text": "moved to bin"},
                    )
                ],
            )
            seen: list[str] = []

            def on_event(event: dict) -> None:
                seen.append(event["type"])
                if event["type"] == "permission_request":
                    self.assertEqual(event["tool_name"], "host__robot_arm_move")
                    self.assertIsInstance(event["capability"], str)
                    session.respond_permission(event["request_id"], "allow_once")

            session.on("event", on_event)
            turn = session.prompt("move the arm")
            list(turn)
            result = turn.result()

            self.assertEqual(result.stop_reason, "completed")
            self.assertEqual(calls, [{"position": "bin"}], "the call ran once the host allowed it")
            self.assertIn("tool_request", seen)


    def test_a_steer_lands_in_the_models_next_request(self) -> None:
        # The steer has to be in before the tool's answer goes back: that answer
        # ends the window in which the runtime still sees the turn as
        # steerable. The handler runs inside that window; a listener does not,
        # because the ADK dispatches listeners asynchronously - a steer from one
        # races the answer, which is how this test used to fail on a slow runner.
        def observe(_args, _call):
            session.steer("also check the left bench")
            return {"text": "the bench"}

        scratch = self.prepare([tool_call("host__camera_observe", {"frame": 1}), prose("the left bench is clear")])
        with scratch.start() as runtime:
            session = runtime.create_session(
                cwd=scratch.project,
                model="stub-model",
                ephemeral=True,
                builtins=False,
                permissions="host",
                tools=[HostTool(name="camera_observe", capability="read", handler=observe)],
            )
            turn = session.prompt("look at the bench")
            events = list(turn)
            self.assertTrue(events, "the turn streamed")
            self.assertEqual(turn.result().stop_reason, "completed")
            # The steer is delivered at the turn's next safe point, which is the
            # request the runtime builds from the tool result.
            self.assertIn("also check the left bench", self.provider.bodies[1])


    def test_two_sessions_never_see_each_others_events(self) -> None:
        scratch = self.prepare([prose("alpha"), prose("beta")])
        with scratch.start() as runtime:
            first = runtime.create_session(cwd=scratch.project, model="stub-model", ephemeral=True)
            second = runtime.create_session(cwd=scratch.project, model="stub-model", ephemeral=True)

            noise: list[str] = []
            second.on("event", lambda event: noise.append(event["type"]))

            turn = first.prompt("say alpha")
            events = list(turn)
            turn.result()

            self.assertTrue(any(e["type"] == "token" and e["text"] == "alpha" for e in events))
            self.assertEqual(noise, [], "the other session heard nothing")

            # A fork is its own session, with its own id - and an address the
            # runtime answers for, which is what makes it usable rather than
            # merely named.
            fork = first.fork()
            self.assertIsInstance(fork.id, str)
            self.assertTrue(fork.id)
            self.assertNotEqual(fork.id, first.id)
            self.assertEqual(fork.model, "stub-model")
            self.assertIn("shell", fork.get_tools()["tools"])

    def test_a_turn_is_bounded_when_nobody_drains_it(self) -> None:
        scratch = self.prepare([prose("unread")])
        with scratch.start(max_buffered_events=0) as runtime:
            session = runtime.create_session(cwd=scratch.project, model="stub-model", ephemeral=True)
            turn = session.prompt("say something")
            result = turn.result()
            self.assertEqual(result.stop_reason, "completed")
            # Nothing was reading, so the events were dropped rather than held:
            # the terminal record still arrived, which is what a late reader
            # needs most.
            self.assertGreater(turn.dropped, 0)

    def test_a_drained_turn_keeps_every_event(self) -> None:
        """The cap bounds what is unread, not the turn's total output.

        Twenty bursts of four against a cap of 8: the reader falls a few events
        behind inside a burst and catches up between them, so nothing is ever
        further behind than the cap, while some 60 of the 80 events were
        buffered on the way. Counting the running total instead of the buffer
        would drop the events past the eighth, to a reader that missed none of
        them.
        """
        tokens = [f"token {index} " for index in range(80)]
        scratch = self.prepare([streamed(tokens, 0.010, 4)])
        with scratch.start(max_buffered_events=8) as runtime:
            session = runtime.create_session(cwd=scratch.project, model="stub-model", ephemeral=True)
            turn = session.prompt("ramble")
            seen = [event["text"] for event in turn if event.get("type") == "token"]
            self.assertEqual(turn.result().stop_reason, "completed")
            self.assertEqual(turn.dropped, 0, "a reader that keeps up must not lose events")
            self.assertEqual(len(seen), len(tokens))

    def test_a_listener_by_tag_hears_that_tag(self) -> None:
        scratch = self.prepare([tool_call("host__camera_observe", {"mode": "rgb"}), prose("a red cup")])
        with scratch.start() as runtime:
            session = runtime.create_session(
                cwd=scratch.project,
                model="stub-model",
                ephemeral=True,
                builtins=False,
                permissions="host",
                tools=[
                    HostTool(
                        name="camera_observe",
                        description="Look through the camera.",
                        parameters={"type": "object", "properties": {"mode": {"type": "string"}}, "required": ["mode"]},
                        capability="read",
                        handler=lambda args, call: {"text": "a red cup"},
                    )
                ],
            )
            calls: List[str] = []
            texts: List[str] = []
            prompts: List[Dict[str, Any]] = []
            every: List[Dict[str, Any]] = []
            stream: List[Dict[str, Any]] = []
            session.on("tool_request", lambda event: calls.append(event["tool_name"]))
            session.on("token", lambda event: texts.append(event["text"]))
            session.on("permission_request", lambda event: prompts.append(event))
            session.on("*", every.append)
            session.on("event", stream.append)

            turn = session.prompt("what is on the desk?")
            list(turn)
            self.assertEqual(turn.result().stop_reason, "completed")

            # The host is told the name it declared, not the `host__` name the
            # model calls, and a read never asks permission.
            self.assertEqual(calls, ["camera_observe"])
            self.assertEqual("".join(texts), "a red cup")
            self.assertEqual(prompts, [], "nothing was gated, so nothing may be reported")
            # A tag is a second name for an event already reported, not a
            # second event: `"*"` hears the stream once.
            self.assertEqual(every, stream)

    # -- host tools -------------------------------------------------------

    def test_a_host_tool_round_trips(self) -> None:
        scratch = self.prepare([tool_call("host__robot_arm_move", {"position": "bin"}), prose("the arm reached bin")])
        calls: list[tuple] = []
        with scratch.start() as runtime:
            session = runtime.create_session(
                cwd=scratch.project,
                model="stub-model",
                ephemeral=True,
                # Built-ins off, so the advertised set is exactly what this test
                # declared; the gate is the host's, so an actuator this client
                # runs itself is not prompted for twice.
                builtins=False,
                permissions="host",
                tools=[
                    HostTool(
                        name="robot_arm_move",
                        description="Move the arm.",
                        parameters={
                            "type": "object",
                            "properties": {"position": {"type": "string"}},
                            "required": ["position"],
                        },
                        capability="actuator",
                        handler=lambda args, call: (calls.append((args, call)) or {"text": "moved to bin", "details": {"joints": 3}}),
                    )
                ],
            )
            # The runtime advertises the model-facing name, which is the
            # declared one with its `host__` prefix; the host is told the name
            # it chose (asserted below, on the request it receives).
            self.assertEqual(session.tools, ["host__robot_arm_move"])
            self.assertEqual(session.tool_specs[0]["function"]["name"], "host__robot_arm_move")

            turn = session.prompt("move the arm")
            events = list(turn)
            self.assertEqual(turn.result().stop_reason, "completed")

            request = next(e for e in events if e["type"] == "tool_request")
            # The host dispatches on the name it declared, not the `host__` name
            # the model calls, and a main-run request carries no run id.
            self.assertEqual(request["tool_name"], "robot_arm_move")
            self.assertEqual(request["args"], {"position": "bin"})
            self.assertIsNone(request.get("run_id"))
            self.assertEqual(calls[0][0], {"position": "bin"})
            self.assertEqual(calls[0][1].tool_name, "robot_arm_move")
            self.assertIsNone(calls[0][1].run_id)
            self.assertIs(calls[0][1].session, session)

            # The tool's answer became the tool message of the next provider
            # request: that, not the handler call, is what makes it a round trip.
            self.assertEqual(len(self.provider.bodies), 2, "the model was asked twice")
            self.assertIn("moved to bin", self.provider.bodies[1])
            # `details` is host-only: echoed on the channel, never sent.
            self.assertNotIn("joints", self.provider.bodies[1])

    def test_an_image_bearing_host_result_reaches_the_model_as_an_image_part(self) -> None:
        scratch = self.prepare([tool_call("host__camera_observe", {"frame": 1}), prose("the bin is clear")])
        # A 1x1 PNG: a valid payload, small enough to inline.
        png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AARAAB/wDcH1jPAAAAAElFTkSuQmCC"
        with scratch.start() as runtime:
            session = runtime.create_session(
                cwd=scratch.project,
                model="stub-model",
                ephemeral=True,
                builtins=False,
                permissions="host",
                tools=[
                    HostTool(
                        name="camera_observe",
                        description="Look at the bench.",
                        capability="read",
                        handler=lambda _args, _call: {"text": "the bench", "images": [{"data": png, "mimeType": "image/png"}]},
                    )
                ],
            )
            turn = session.prompt("look at the bench")
            list(turn)
            turn.result()

            messages = json.loads(self.provider.bodies[1])["messages"]
            self.assertEqual(messages[-2]["role"], "tool", "the tool message reported the result")
            self.assertEqual(messages[-2]["content"], "the bench")
            # A tool message cannot carry an image, so the runtime labels the
            # user turn the result produces and leads it with the parts the host
            # wrote; the label names the call.
            message = messages[-1]
            self.assertEqual(message["role"], "user")
            self.assertIsInstance(message["content"], list, "the user message carries content parts")
            self.assertEqual(message["content"][0]["type"], "text")
            self.assertGreater(len(message["content"][0]["text"]), 0, "the user turn is labelled")
            self.assertEqual(message["content"][1]["type"], "image_url")
            self.assertEqual(message["content"][1]["image_url"]["url"], f"data:image/png;base64,{png}")

    def test_a_handler_that_raises_answers_the_call_and_the_turn_goes_on(self) -> None:
        scratch = self.prepare([tool_call("host__robot_arm_move", {"position": "bin"}), prose("the arm did not move")])

        def explode(_args, _call):
            raise RuntimeError("the emergency stop is engaged")

        with scratch.start() as runtime:
            session = runtime.create_session(
                cwd=scratch.project,
                model="stub-model",
                ephemeral=True,
                permissions="host",
                tools=[HostTool(name="robot_arm_move", capability="actuator", handler=explode)],
            )
            turn = session.prompt("move the arm")
            list(turn)
            self.assertEqual(turn.result().stop_reason, "completed")
            self.assertIn("the emergency stop is engaged", self.provider.bodies[1])

    def test_interrupting_a_turn_settles_it_once_and_abandons_its_parked_call(self) -> None:
        scratch = self.prepare([tool_call("host__robot_arm_move", {"position": "bin"}), holding("working on it")])
        aborted: list[bool] = []
        answered: list[bool] = []

        def wait_for_abort(_args, call):
            if call.aborted.wait(10):
                aborted.append(True)
                answered.append(True)
            return {"text": "too late"}

        with scratch.start() as runtime:
            session = runtime.create_session(
                cwd=scratch.project,
                model="stub-model",
                ephemeral=True,
                permissions="host",
                tools=[HostTool(name="robot_arm_move", capability="actuator", handler=wait_for_abort)],
            )
            turn = session.prompt("move the arm")
            events = []
            for event in turn:
                events.append(event)
                if event["type"] == "tool_request":
                    session.interrupt()

            self.assertEqual(turn.result().stop_reason, "interrupted")
            # The parked call is withdrawn rather than answered: the runtime
            # would refuse a late answer as not pending.
            self.assertTrue(any(e["type"] == "tool_request_cancelled" for e in events))
            # The handler is told on its own thread, so the terminal record can
            # arrive first; wait for the notice instead of racing it.
            deadline = time.monotonic() + 5
            while not aborted and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertEqual(aborted, [True], "the handler was told to stop")
            self.assertEqual(answered, [True], "the handler returned after the abort")
            self.assertEqual(turn.dropped, 0)

    # -- the channel under a turn -----------------------------------------

    def test_a_session_is_reopened_by_its_id(self) -> None:
        scratch = self.prepare([prose("one"), prose("two")])
        with scratch.start() as runtime:
            first = runtime.create_session(cwd=scratch.project, model="stub-model", ephemeral=True)
            list(first.prompt("say something"))

            # The runtime rebuilt this session from its own state, so the id it
            # answers for and the model it runs are the ones it had.
            again = runtime.resume_session(first.id)
            self.assertEqual(again.id, first.id)
            self.assertEqual(again.model, "stub-model")
            resumed = again.prompt("say something else")
            list(resumed)
            self.assertEqual(resumed.result().stop_reason, "completed")


    def test_closing_the_runtime_settles_an_open_turn(self) -> None:
        scratch = self.prepare([holding("still here")])
        runtime = scratch.start()
        session = runtime.create_session(cwd=scratch.project, model="stub-model", ephemeral=True)
        turn = session.prompt("say something")
        code = runtime.close()

        # Closing stdin is the runtime's own shutdown signal, and a turn that
        # was running is closed on the channel before the process exits.
        self.assertEqual(code, 0)
        with self.assertRaises(JanRuntimeError):
            turn.result(timeout=5)

    # -- host tools, inputs, forks and resumes --------------------------------

    def _echo(self, calls: list, label: str) -> HostTool:
        def handler(args: Any, call: Any) -> Dict[str, str]:
            calls.append(label)
            return {"text": f"echoed by {label}: {args['text']}"}

        return HostTool(name="echo", capability="read", handler=handler)

    def _last_user(self, body: str) -> Dict[str, Any]:
        return [message for message in json.loads(body)["messages"] if message["role"] == "user"][-1]

    def test_a_host_tool_declared_with_a_padded_name_is_still_called(self) -> None:
        scratch = self.prepare([tool_call("host__camera", {}), prose("seen")])
        calls: list[str] = []
        with scratch.start() as runtime:
            session = runtime.create_session(
                cwd=scratch.project,
                model="stub-model",
                ephemeral=True,
                builtins=False,
                permissions="host",
                tools=[HostTool(name=" camera ", capability="read", handler=lambda args, call: (calls.append("camera") or {"text": "CAMERA_RESULT"}))],
            )
            self.assertEqual(session.tools, ["host__camera"])

            turn = session.prompt("look")
            turn.result(timeout=4)
            # Advertised means callable: the handler ran, and the model got its
            # answer rather than "no host tool named".
            self.assertEqual(calls, ["camera"])
            self.assertIn("CAMERA_RESULT", self.provider.bodies[1])
            self.assertNotIn("no host tool named", self.provider.bodies[1])

            with self.assertRaises(TypeError):
                session.set_tools([HostTool(name="   ", handler=lambda args, call: "")])

    def test_a_host_result_that_cannot_be_shaped_is_answered_as_an_error_and_the_turn_goes_on(self) -> None:
        scratch = self.prepare([tool_call("host__camera_observe", {}), prose("no frame")])
        with scratch.start() as runtime:
            session = runtime.create_session(
                cwd=scratch.project,
                model="stub-model",
                ephemeral=True,
                builtins=False,
                permissions="host",
                tools=[
                    HostTool(
                        name="camera_observe",
                        capability="read",
                        # The handler succeeds; formatting its result is what fails.
                        handler=lambda args, call: {"text": "a frame", "images": [{"path": str(scratch.root / "missing-image.png")}]},
                    )
                ],
            )
            turn = session.prompt("look")
            self.assertEqual(turn.result(timeout=4).stop_reason, "completed")
            self.assertEqual(len(self.provider.bodies), 2, "the model was told, so it was asked again")
            self.assertRegex(self.provider.bodies[1], r"(?i)no such file")

            # The session is still usable afterwards.
            again = session.prompt("and now?")
            self.assertEqual(again.result(timeout=4).stop_reason, "completed")

    def test_structured_prompt_inputs_reach_the_model_as_content_parts(self) -> None:
        scratch = self.prepare([prose("seen")])
        png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AARAAB/wDcH1jPAAAAAElFTkSuQmCC"
        with scratch.start() as runtime:
            session = runtime.create_session(cwd=scratch.project, model="stub-model", ephemeral=True)

            session.prompt([{"type": "text", "text": "hello parts"}]).result(timeout=4)
            self.assertIn("hello parts", json.dumps(self._last_user(self.provider.bodies[0])["content"]))

            image = {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{png}"}}
            session.prompt([{"type": "text", "text": "what is this?"}, image]).result(timeout=4)
            mixed = self._last_user(self.provider.bodies[1])["content"]
            self.assertIsInstance(mixed, list)
            self.assertIn("what is this?", next(p for p in mixed if p["type"] == "text")["text"])
            self.assertEqual(next(p for p in mixed if p["type"] == "image_url")["image_url"]["url"], image["image_url"]["url"])

            # The documented record form is the same parts.
            session.prompt({"content": [{"type": "text", "text": "record form"}]}).result(timeout=4)
            self.assertIn("record form", json.dumps(self._last_user(self.provider.bodies[2])["content"]))

            # A refusal from the runtime stays an answer the caller can read.
            with self.assertRaises(JanRpcError):
                session.prompt([{"type": "audio", "data": "x"}])

    def test_a_fork_answers_for_its_sources_host_tools(self) -> None:
        scratch = self.prepare([tool_call("host__echo", {"text": "hi"}), prose("done")])
        calls: list[str] = []
        with scratch.start() as runtime:
            session = runtime.create_session(
                cwd=scratch.project,
                model="stub-model",
                ephemeral=True,
                builtins=False,
                permissions="host",
                tools=[self._echo(calls, "source")],
            )
            fork = session.fork()
            self.assertEqual(fork.tools, ["host__echo"])

            fork.prompt("echo hi").result(timeout=4)
            self.assertEqual(calls, ["source"])
            self.assertIn("echoed by source: hi", self.provider.bodies[1])
            self.assertNotIn("no host tool named", self.provider.bodies[1])

    def test_a_fork_given_its_own_tools_answers_with_those_and_one_given_none_has_none(self) -> None:
        scratch = self.prepare([tool_call("host__echo", {"text": "hi"}), prose("done")])
        calls: list[str] = []
        with scratch.start() as runtime:
            session = runtime.create_session(
                cwd=scratch.project,
                model="stub-model",
                ephemeral=True,
                builtins=False,
                permissions="host",
                tools=[self._echo(calls, "source")],
            )
            bare = session.fork(tools=[])
            self.assertEqual(bare.tools, [], "nothing is advertised that nothing can run")

            own = session.fork(tools=[self._echo(calls, "fork")])
            own.prompt("echo hi").result(timeout=4)
            self.assertEqual(calls, ["fork"], "the source's handler is not used by a fork that replaced it")
            self.assertIn("echoed by fork: hi", self.provider.bodies[1])

    def test_resuming_an_open_session_returns_it_and_its_turn_settles(self) -> None:
        scratch = self.prepare([holding("still here")])
        with scratch.start() as runtime:
            original = runtime.create_session(cwd=scratch.project, model="stub-model", ephemeral=True)
            turn = original.prompt("hold")
            for event in turn:
                if event["type"] == "token":
                    break

            resumed = runtime.resume_session(original.id)
            self.assertIs(resumed, original, "the session this client already holds, not a second object for the id")

            resumed.interrupt()
            self.assertEqual(turn.result(timeout=4).stop_reason, "interrupted")

    def test_resuming_an_open_session_does_not_orphan_its_turn_when_the_runtime_closes(self) -> None:
        scratch = self.prepare([holding("still here")])
        runtime = scratch.start()
        original = runtime.create_session(cwd=scratch.project, model="stub-model", ephemeral=True)
        turn = original.prompt("hold")
        for event in turn:
            if event["type"] == "token":
                break
        runtime.resume_session(original.id)

        runtime.close()
        # The runtime's own failure, not `result()` giving up on a turn that was
        # never settled: that is also a JanRuntimeError, so the message tells
        # the two apart.
        with self.assertRaises(JanRuntimeError) as failed:
            turn.result(timeout=4)
        self.assertNotIn("did not finish", str(failed.exception))

    def test_a_resumed_session_keeps_the_handlers_of_its_host_tools(self) -> None:
        scratch = self.prepare([tool_call("host__echo", {"text": "hi"}), prose("done")])
        calls: list[str] = []
        with scratch.start() as runtime:
            session = runtime.create_session(
                cwd=scratch.project,
                model="stub-model",
                ephemeral=True,
                builtins=False,
                permissions="host",
                tools=[self._echo(calls, "source")],
            )
            resumed = runtime.resume_session(session.id)
            resumed.prompt("echo hi").result(timeout=4)
            self.assertEqual(calls, ["source"])
            self.assertIn("echoed by source: hi", self.provider.bodies[1])

    def test_a_tool_result_the_runtime_refuses_is_answered_as_an_error_and_the_turn_goes_on(self) -> None:
        scratch = self.prepare([tool_call("host__camera", {}), prose("no frame")])
        with scratch.start() as runtime:
            session = runtime.create_session(
                cwd=scratch.project,
                model="stub-model",
                ephemeral=True,
                builtins=False,
                permissions="host",
                # Shapes cleanly here, and the runtime refuses the part: the
                # request is still pending on its side, so a swallowed refusal
                # parks the turn.
                tools=[HostTool(name="camera", capability="read", handler=lambda args, call: {"parts": [{"type": "audio", "data": "x"}]})],
            )
            turn = session.prompt("look")
            self.assertEqual(turn.result(timeout=4).stop_reason, "completed")
            self.assertEqual(len(self.provider.bodies), 2, "the model was told, so it was asked again")
            self.assertIn("refused this tool result", self.provider.bodies[1])

    def _fork_with_a_tools_change(self, change_first: bool) -> None:
        import threading

        scratch = self.prepare([tool_call("host__echo", {"text": "hi"}), prose("done")])
        calls: list[str] = []
        with scratch.start() as runtime:
            session = runtime.create_session(
                cwd=scratch.project,
                model="stub-model",
                ephemeral=True,
                builtins=False,
                permissions="host",
                tools=[self._echo(calls, "a")],
            )
            made: list = []
            request = runtime.request

            # The first call holds on after the runtime has answered it, so the
            # second starts inside the window between the runtime's read and the
            # SDK's: the order is the test's, not the scheduler's.
            held = "session/tools/set" if change_first else "session/fork"

            def slow(method, params=None, timeout=None):
                answer = request(method, params, timeout)
                if method == held:
                    time.sleep(0.4)
                return answer

            runtime.request = slow
            change = threading.Thread(target=lambda: session.set_tools([self._echo(calls, "b")]))
            fork = threading.Thread(target=lambda: made.append(session.fork()))
            first, second = (change, fork) if change_first else (fork, change)
            first.start()
            time.sleep(0.1)
            second.start()
            first.join(10)
            second.join(10)
            expected = "b" if change_first else "a"
            self.assertEqual(made[0].tools, ["host__echo"])
            made[0].prompt("echo hi").result(timeout=4)
            self.assertEqual(calls, [expected], "the fork ran the handler for the tools the runtime gave it")
            self.assertIn(f"echoed by {expected}: hi", self.provider.bodies[1])

    def test_a_fork_made_with_a_tools_change_keeps_matching_handlers_fork_first(self) -> None:
        self._fork_with_a_tools_change(change_first=False)

    def test_a_fork_made_with_a_tools_change_keeps_matching_handlers_change_first(self) -> None:
        self._fork_with_a_tools_change(change_first=True)

    def test_a_turn_started_as_the_runtime_fails_is_failed_not_left_pending(self) -> None:
        scratch = self.prepare([prose("hi")])
        with scratch.start() as runtime:
            session = runtime.create_session(cwd=scratch.project, model="stub-model", ephemeral=True)
            request = runtime.request

            # The runtime fails between the `turn/start` reply and `prompt()`
            # resuming with it.
            def request_then_fail(method, params=None, timeout=None):
                answer = request(method, params, timeout)
                if method == "turn/start":
                    runtime._fail(JanRuntimeError("QA_FAILS_FIRST"))
                return answer

            runtime.request = request_then_fail
            turn = session.prompt("hi")
            with self.assertRaises(JanRuntimeError) as failed:
                turn.result(timeout=4)
            self.assertIn("QA_FAILS_FIRST", str(failed.exception))

    def test_a_terminal_record_already_received_wins_over_a_runtime_failure(self) -> None:
        scratch = self.prepare([prose("hi")])
        with scratch.start() as runtime:
            session = runtime.create_session(cwd=scratch.project, model="stub-model", ephemeral=True)
            request = runtime.request

            # The runtime sent the turn's terminal record, and then failed, before
            # `prompt()` resumed with the reply.
            def answered_then_closed(method, params=None, timeout=None):
                answer = request(method, params, timeout)
                if method == "turn/start":
                    session._complete({"turnId": answer["turnId"], "stopReason": "interrupted"})
                    runtime._fail(JanRuntimeError("QA_CLOSED_AFTER"))
                return answer

            runtime.request = answered_then_closed
            self.assertEqual(session.prompt("hi").result(timeout=4).stop_reason, "interrupted")

    def test_a_handler_that_raises_an_unprintable_error_is_still_answered(self) -> None:
        class Unprintable(Exception):
            def __str__(self) -> str:
                raise ValueError("no text for this")

        def handler(args: Any, call: Any) -> None:
            raise Unprintable()

        scratch = self.prepare([tool_call("host__camera", {}), prose("no frame")])
        with scratch.start() as runtime:
            session = runtime.create_session(
                cwd=scratch.project,
                model="stub-model",
                ephemeral=True,
                builtins=False,
                permissions="host",
                tools=[HostTool(name="camera", capability="read", handler=handler)],
            )
            self.assertEqual(session.prompt("look").result(timeout=4).stop_reason, "completed")
            self.assertIn("Unprintable", self.provider.bodies[1])

    def test_a_tool_result_that_cannot_be_encoded_is_answered_as_an_error_and_the_turn_goes_on(self) -> None:
        from pathlib import Path

        scratch = self.prepare([tool_call("host__camera", {}), prose("no frame")])
        with scratch.start() as runtime:
            session = runtime.create_session(
                cwd=scratch.project,
                model="stub-model",
                ephemeral=True,
                builtins=False,
                permissions="host",
                # Shapes cleanly, and cannot be written as JSON: nothing reaches
                # the runtime, which is still waiting on the request.
                tools=[HostTool(name="camera", capability="read", handler=lambda args, call: {"text": "ok", "details": {"path": Path("/tmp/frame.png")}})],
            )
            turn = session.prompt("look")
            self.assertEqual(turn.result(timeout=4).stop_reason, "completed")
            self.assertEqual(len(self.provider.bodies), 2, "the model was told, so it was asked again")
            self.assertIn("could not be encoded", self.provider.bodies[1])

    def test_a_tool_result_whose_encoding_raises_another_error_is_answered_as_an_error(self) -> None:
        class Unencodable(dict):
            def items(self):  # the JSON encoder reads a dict subclass through this
                raise RuntimeError("no items for you")

        scratch = self.prepare([tool_call("host__camera", {}), prose("no frame")])
        with scratch.start() as runtime:
            session = runtime.create_session(
                cwd=scratch.project,
                model="stub-model",
                ephemeral=True,
                builtins=False,
                permissions="host",
                # Encoding this raises a RuntimeError, which is neither a TypeError
                # nor a ValueError, on every Python version: any failure to send the
                # answer is itself answered.
                tools=[HostTool(name="camera", capability="read", handler=lambda args, call: {"text": "ok", "details": {"value": Unencodable(a=1)}})],
            )
            self.assertEqual(session.prompt("look").result(timeout=4).stop_reason, "completed")
            self.assertIn("could not be encoded: no items for you", self.provider.bodies[1])

    def _tmp(self) -> str:
        import tempfile

        return tempfile.mkdtemp(prefix="jan-adk-missing-")


if __name__ == "__main__":
    unittest.main()

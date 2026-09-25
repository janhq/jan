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
            self.assertIn("bash", fork.get_tools()["tools"])

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

    def _tmp(self) -> str:
        import tempfile

        return tempfile.mkdtemp(prefix="jan-adk-missing-")


if __name__ == "__main__":
    unittest.main()

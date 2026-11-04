"""Pipe ownership at shutdown, against a fake runtime that needs no ``JAN_BIN``.

The reader threads own the runtime's stdout and stderr: each closes the stream
it reads, when it ends, and nobody else does. Closing a buffered stream from
another thread while one blocks reading it can deadlock, and reaping the child
does not guarantee EOF when a descendant inherited the pipes. These tests pin
both: no ``ResourceWarning`` after a runtime is closed and collected, and a
``close()`` that returns by its deadline even though a descendant holds the
pipes open. They also pin that a callback which raises, or a malformed frame,
leaves the pipes drained rather than closed under a live child, that ``close``
may be called from a callback, that ``close(force=True)`` does not wait out the
whole grace, and that a ``close`` cannot be wedged by a blocked stdin write.
"""

from __future__ import annotations

import gc
import json
import os
import signal
import sys
import tempfile
import textwrap
import threading
import time
import unittest
import warnings
from pathlib import Path
from typing import Callable, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jan_adk import JanRuntime, JanRuntimeError  # noqa: E402

# A runtime that answers the handshake, optionally leaves a descendant holding
# the inherited pipes (its pid is written to argv[1]), and exits on stdin EOF.
# argv[3] picks a misbehaviour: "silent" never answers the handshake, "deaf"
# stops reading stdin once the handshake is done. Past the handshake it also
# answers "say" (one stderr line), "flood" (200KB on stderr, under the 256-line stderr tail), "garbage" (a non-JSON line, then 300KB on
# stdout, then a stderr marker) and "notify" (a notification frame).
FAKE = textwrap.dedent(
    """
    import json, subprocess, sys, time

    pid_file, descendant_seconds, mode = sys.argv[1], float(sys.argv[2]), sys.argv[3]
    if descendant_seconds > 0:
        child = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(%r)" % descendant_seconds],
            stdin=subprocess.DEVNULL,  # stdout and stderr are inherited on purpose
        )
        with open(pid_file, "w") as handle:
            handle.write(str(child.pid))
    sys.stderr.write("fake runtime up\\n")
    sys.stderr.flush()
    for line in sys.stdin:
        frame = json.loads(line)
        method = frame.get("method")
        if method == "initialize" and mode != "silent":
            result = {"protocolVersion": __PROTOCOL__, "serverInfo": {"name": "fake"}, "capabilities": {}}
            sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": frame["id"], "result": result}) + "\\n")
            sys.stdout.flush()
        elif method == "initialized" and mode == "deaf":
            time.sleep(60)
        elif method == "say":
            sys.stderr.write("say\\n")
            sys.stderr.flush()
            sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": frame["id"], "result": {}}) + "\\n")
            sys.stdout.flush()
        elif method == "flood":
            for _ in range(200):
                sys.stderr.write("x" * 1023 + "\\n")
            sys.stderr.flush()
            sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": frame["id"], "result": {}}) + "\\n")
            sys.stdout.flush()
        elif method == "garbage":
            sys.stdout.write("this is not json\\n")
            for _ in range(300):
                sys.stdout.write("y" * 1023 + "\\n")
            sys.stdout.flush()
            sys.stderr.write("garbage done\\n")
            sys.stderr.flush()
        elif method == "notify":
            sys.stdout.write(json.dumps({"jsonrpc": "2.0", "method": "fake/ping", "params": {}}) + "\\n")
            sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": frame["id"], "result": {}}) + "\\n")
            sys.stdout.flush()
    """
)

# Every test is held to an outer deadline: a deadlock fails instead of hanging.
DEADLINE = 15.0


def _within_deadline(work: Callable[[], None]) -> None:
    errors: List[BaseException] = []

    def run() -> None:
        try:
            work()
        except BaseException as error:  # noqa: BLE001 - re-raised on the test thread
            errors.append(error)

    thread = threading.Thread(target=run, name="cleanup-test-body", daemon=True)
    thread.start()
    thread.join(DEADLINE)
    if thread.is_alive():
        raise AssertionError(f"the test body did not finish in {DEADLINE}s: a deadlock or an unbounded wait")
    if errors:
        raise errors[0]


class RuntimeCleanupTest(unittest.TestCase):
    def setUp(self) -> None:
        # A live descendant can keep the directory busy on Windows; cleanups run
        # last-in first, so the descendant is reaped before the directory goes.
        self._dir = tempfile.TemporaryDirectory(prefix="jan-adk-cleanup-", ignore_cleanup_errors=True)
        self.addCleanup(self._dir.cleanup)
        self.addCleanup(self._reap_descendant)
        self._runtimes: List[JanRuntime] = []
        self.addCleanup(self._force_close_all)
        self.pid_file = Path(self._dir.name) / "descendant.pid"
        self.script = Path(self._dir.name) / "fake_runtime.py"
        from jan_adk._generated import PROTOCOL_VERSION

        self.script.write_text(FAKE.replace("__PROTOCOL__", repr(PROTOCOL_VERSION)), encoding="utf-8")

    def _args(self, descendant_seconds: float, mode: str) -> List[str]:
        return [str(self.script), str(self.pid_file), str(descendant_seconds), mode]

    def _start(self, descendant_seconds: float = 0.0, mode: str = "", **options) -> JanRuntime:
        runtime = JanRuntime.start(bin=sys.executable, args=self._args(descendant_seconds, mode), **options)
        self._runtimes.append(runtime)
        return runtime

    def _force_close_all(self) -> None:
        for runtime in self._runtimes:
            try:
                runtime.close(force=True)
            except Exception:  # noqa: BLE001 - best effort, after the test's own verdict
                pass

    def _descendant(self) -> Optional[int]:
        try:
            return int(self.pid_file.read_text())
        except (OSError, ValueError):
            return None

    def _reap_descendant(self) -> None:
        pid = self._descendant()
        if pid:
            try:
                # SIGKILL does not exist on Windows, where any signal terminates.
                os.kill(pid, getattr(signal, "SIGKILL", signal.SIGTERM))
            except (AttributeError, OSError):  # ProcessLookupError is an OSError
                pass

    def _collect_warnings(self, work: Callable[[], None]) -> List[warnings.WarningMessage]:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always", ResourceWarning)
            work()
            gc.collect()
        return [entry for entry in caught if issubclass(entry.category, ResourceWarning)]

    def test_a_closed_runtime_leaves_no_unclosed_pipes(self) -> None:
        def body() -> None:
            runtime = self._start()
            self.assertEqual(runtime.close(), 0)
            process = runtime._process
            for thread in (runtime._reader, runtime._stderr_reader):
                thread.join(DEADLINE / 3)
                self.assertFalse(thread.is_alive())
            self.assertTrue(process.stdout.closed and process.stderr.closed and process.stdin.closed)
            self.assertIn("fake runtime up", runtime.stderr)
            del runtime, process

        found = self._collect_warnings(lambda: _within_deadline(body))
        self.assertEqual([str(entry.message) for entry in found], [])

    def test_a_forced_close_and_a_failed_handshake_leave_no_unclosed_pipes(self) -> None:
        def body() -> None:
            runtime = self._start()
            runtime.close(force=True)
            runtime._reader.join(DEADLINE / 3)
            runtime._stderr_reader.join(DEADLINE / 3)
            self.assertFalse(runtime._reader.is_alive())
            del runtime
            # A process that never answers the handshake: start() must reap it.
            with self.assertRaises(JanRuntimeError):
                JanRuntime.start(
                    bin=sys.executable,
                    args=["-c", "import sys; sys.stdin.read()"],
                    handshake_timeout=0.3,
                    shutdown_grace=1.0,
                )

        found = self._collect_warnings(lambda: _within_deadline(body))
        self.assertEqual([str(entry.message) for entry in found], [])

    def test_a_descendant_holding_the_pipes_cannot_hang_close_and_the_pipes_close_once_it_lets_go(self) -> None:
        def body() -> None:
            runtime = self._start(descendant_seconds=20.0, shutdown_grace=0.5)
            try:
                started = time.monotonic()
                code = runtime.close()
                elapsed = time.monotonic() - started
                self.assertEqual(code, 0, "the child itself exited cleanly")
                self.assertLess(elapsed, 5.0, "close() is bounded by its grace even when EOF never comes")
                # EOF has not come: the descendant holds the pipes, so the readers are
                # still blocked and, being the owners, nobody has closed their streams.
                self.assertTrue(runtime._reader.is_alive())
                self.assertFalse(runtime._process.stdout.closed)
                # A second close is as bounded as the first.
                started = time.monotonic()
                runtime.close()
                self.assertLess(time.monotonic() - started, 5.0)
            finally:
                self._reap_descendant()
            # The descendant is gone, EOF arrives, and each reader closes its own stream.
            for thread in (runtime._reader, runtime._stderr_reader):
                thread.join(DEADLINE / 3)
                self.assertFalse(thread.is_alive())
            self.assertTrue(runtime._process.stdout.closed and runtime._process.stderr.closed)
            del runtime

        found = self._collect_warnings(lambda: _within_deadline(body))
        self.assertEqual([str(entry.message) for entry in found], [])


    # -- callbacks that raise, and a close from inside one -------------------

    def test_a_raising_on_stderr_keeps_draining_so_the_child_is_not_wedged(self) -> None:
        calls: List[str] = []

        def on_stderr(line: str) -> None:
            calls.append(line)
            raise RuntimeError("callback boom")

        def body() -> None:
            runtime = self._start(on_stderr=on_stderr, shutdown_grace=3.0)
            # 200KB of stderr is far past a pipe's buffer: a stderr reader that
            # died on the callback would leave the child blocked mid-write and this
            # request would never be answered.
            runtime.request("flood", timeout=DEADLINE / 2)
            self.assertEqual(runtime.close(), 0, "the child exited by itself, it was not killed")
            runtime._reader.join(DEADLINE / 3)
            runtime._stderr_reader.join(DEADLINE / 3)
            self.assertFalse(runtime._stderr_reader.is_alive())
            self.assertTrue(runtime._process.stderr.closed)
            self.assertEqual(len(calls), 1, "a callback that raised is not called again")
            self.assertIn("on_stderr callback raised and was disabled", runtime.stderr)
            self.assertIn("callback boom", runtime.stderr)
            del runtime

        found = self._collect_warnings(lambda: _within_deadline(body))
        self.assertEqual([str(entry.message) for entry in found], [])

    def test_a_malformed_frame_fails_the_runtime_but_the_child_is_still_drained(self) -> None:
        def body() -> None:
            runtime = self._start(shutdown_grace=3.0)
            with self.assertRaises(JanRuntimeError) as raised:
                runtime.request("garbage", timeout=DEADLINE / 2)
            self.assertIn("not JSON", str(raised.exception))
            # The stdout reader keeps reading to EOF. Had it returned and closed the
            # pipe, the child's 300KB write would hit EPIPE or block, and it would
            # not exit with 0 on stdin EOF.
            self.assertEqual(runtime.close(), 0)
            runtime._reader.join(DEADLINE / 3)
            runtime._stderr_reader.join(DEADLINE / 3)
            self.assertFalse(runtime._reader.is_alive())
            self.assertTrue(runtime._process.stdout.closed)
            self.assertIn("garbage done", runtime.stderr)
            del runtime

        found = self._collect_warnings(lambda: _within_deadline(body))
        self.assertEqual([str(entry.message) for entry in found], [])

    def test_close_from_an_on_stderr_callback_and_from_an_event_listener_returns(self) -> None:
        def body() -> None:
            # From the stderr reader's own thread: it must not join itself.
            seen: List[Optional[int]] = []
            holder: List[JanRuntime] = []
            closed = threading.Event()

            def on_stderr(line: str) -> None:
                if line == "say\n" and holder and not closed.is_set():
                    closed.set()
                    seen.append(holder[0].close())

            runtime = self._start(on_stderr=on_stderr, shutdown_grace=2.0)
            holder.append(runtime)
            runtime.request("say", timeout=DEADLINE / 2)
            self.assertTrue(closed.wait(DEADLINE / 3))
            runtime._stderr_reader.join(DEADLINE / 3)
            self.assertFalse(runtime._stderr_reader.is_alive())
            self.assertEqual(seen, [0])

            # From an event listener, which runs on the dispatch thread.
            results: List[Optional[int]] = []
            second = self._start(shutdown_grace=2.0)
            second.on("notification", lambda _frame: results.append(second.close()))
            second.request("notify", timeout=DEADLINE / 2)
            deadline = time.monotonic() + DEADLINE / 3
            while not results and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertEqual(results, [0])
            second._reader.join(DEADLINE / 3)
            self.assertFalse(second._reader.is_alive())
            del runtime, second

        found = self._collect_warnings(lambda: _within_deadline(body))
        self.assertEqual([str(entry.message) for entry in found], [])

    def test_a_raising_event_listener_fails_the_runtime_and_close_still_returns(self) -> None:
        def body() -> None:
            runtime = self._start(shutdown_grace=2.0)

            def boom(_frame: object) -> None:
                raise RuntimeError("listener boom")

            runtime.on("notification", boom)
            try:
                runtime.request("notify", timeout=DEADLINE / 2)
            except JanRuntimeError:
                pass  # the listener may fail the runtime before the answer is read
            deadline = time.monotonic() + DEADLINE / 3
            while runtime._failure is None and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertIn("listener boom", str(runtime._failure))
            self.assertEqual(runtime.close(), 0)
            runtime._reader.join(DEADLINE / 3)
            self.assertFalse(runtime._reader.is_alive())
            del runtime

        found = self._collect_warnings(lambda: _within_deadline(body))
        self.assertEqual([str(entry.message) for entry in found], [])

    # -- a forced close is bounded by less than the grace --------------------

    def test_a_forced_close_with_a_descendant_does_not_wait_out_the_grace(self) -> None:
        def body() -> None:
            runtime = self._start(descendant_seconds=20.0, shutdown_grace=8.0)
            started = time.monotonic()
            runtime.close(force=True)
            elapsed = time.monotonic() - started
            self.assertLess(elapsed, 3.0, "a forced close must not spend the 8s grace on the readers")
            # Repeating a forced close remains safe; neither call hangs.
            started = time.monotonic()
            runtime.close(force=True)
            self.assertLess(time.monotonic() - started, 3.0)
            self._reap_descendant()
            runtime._reader.join(DEADLINE / 3)
            runtime._stderr_reader.join(DEADLINE / 3)
            self.assertTrue(runtime._process.stdout.closed and runtime._process.stderr.closed)
            del runtime

        found = self._collect_warnings(lambda: _within_deadline(body))
        self.assertEqual([str(entry.message) for entry in found], [])

    def test_a_failed_handshake_with_a_descendant_does_not_wait_out_the_grace(self) -> None:
        def body() -> None:
            started = time.monotonic()
            with self.assertRaises(JanRuntimeError):
                JanRuntime.start(
                    bin=sys.executable,
                    args=self._args(20.0, "silent"),
                    handshake_timeout=0.3,
                    shutdown_grace=8.0,
                )
            self.assertLess(time.monotonic() - started, 4.0)
            self._reap_descendant()

        found = self._collect_warnings(lambda: _within_deadline(body))
        self.assertEqual([str(entry.message) for entry in found], [])

    # -- a stdin write that cannot finish must not wedge close ---------------

    def test_close_is_not_wedged_by_a_request_blocked_writing_to_a_deaf_child(self) -> None:
        def body() -> None:
            runtime = self._start(mode="deaf", shutdown_grace=0.5)
            outcome: List[BaseException] = []

            def write() -> None:
                try:
                    # Far past the pipe buffer, to a child that stopped reading.
                    runtime.request("big", {"blob": "z" * 8_000_000}, timeout=DEADLINE)
                except BaseException as error:  # noqa: BLE001 - inspected below
                    outcome.append(error)

            writer = threading.Thread(target=write, name="blocked-writer", daemon=True)
            writer.start()
            deadline = time.monotonic() + DEADLINE / 3
            while not runtime._lock.locked() and time.monotonic() < deadline:
                time.sleep(0.02)
            time.sleep(0.3)  # let the write actually fill the pipe and block
            self.assertTrue(writer.is_alive(), "the write must still be blocked for this to prove anything")

            started = time.monotonic()
            runtime.close()
            self.assertLess(time.monotonic() - started, 6.0, "close() is bounded even with a write in flight")
            writer.join(DEADLINE / 3)
            self.assertFalse(writer.is_alive(), "killing the child breaks the pipe and frees the writer")
            self.assertEqual(len(outcome), 1)
            self.assertIsInstance(outcome[0], JanRuntimeError)
            runtime._reader.join(DEADLINE / 3)
            runtime._stderr_reader.join(DEADLINE / 3)
            self.assertTrue(runtime._process.stdin.closed)
            self.assertTrue(runtime._process.stdout.closed and runtime._process.stderr.closed)
            del runtime

        found = self._collect_warnings(lambda: _within_deadline(body))
        self.assertEqual([str(entry.message) for entry in found], [])


if __name__ == "__main__":
    unittest.main()

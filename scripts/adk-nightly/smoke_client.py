"""Copied into a clean environment and executed without Node on PATH."""
import os
import shutil
import subprocess

from jan_adk import HostTool, JanRuntime, install_runtime

assert shutil.which("node") is None, "Python smoke must not have Node available"
installed = install_runtime(
    manifest_url=os.environ["RUNTIME_MANIFEST"], version=os.environ["RUNTIME_VERSION"]
)
subprocess.run([
    installed.bin, "config", "set", "--provider", "stub", "--api-key", "smoke",
    "--base-url", os.environ["PROVIDER_URL"], "--model", "stub-model",
], check=True)
calls = []


def measure(args, call):
    calls.append(args)
    return {"text": "sensor=42"}


with JanRuntime.start(bin=installed.bin) as runtime:
    session = runtime.create_session(
        model="stub-model", ephemeral=True, builtins=False,
        tools=[HostTool(
            name="measure", description="Read the sensor.", capability="read",
            parameters={"type": "object", "properties": {}, "additionalProperties": False},
            handler=measure,
        )],
    )
    turn = session.prompt("Read the sensor.")
    text = "".join(event["text"] for event in turn if event["type"] == "token")
    assert turn.result().stop_reason == "completed"
    assert text == "The sensor is 42."
    assert calls == [{}]
# close() waits for the owned process; use its public pid for an independent check.
if os.name == "nt":
    import ctypes
    handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, runtime.pid)
    if handle:
        try:
            code = ctypes.c_ulong()
            assert ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
            assert code.value != 259, "runtime is still active"
        finally:
            ctypes.windll.kernel32.CloseHandle(handle)
else:
    try:
        os.kill(runtime.pid, 0)
    except ProcessLookupError:
        pass
    else:
        raise AssertionError("runtime was not reaped")
print("Python: installed wheel -> pinned runtime -> host callback -> streamed result -> reaped process; no Node")

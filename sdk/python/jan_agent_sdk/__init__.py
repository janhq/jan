"""The Jan agent SDK for Python.

One long-lived ``jan cli agent rpc`` runtime, many addressable sessions, and the
host tools your own process runs - with no Node and no third-party packages.

    from jan_agent_sdk import JanRuntime

    with JanRuntime.start() as runtime:
        session = runtime.create_session(model="gpt-4o-mini", ephemeral=True)
        turn = session.prompt("Summarise this table in one line.")
        for event in turn:
            if event["type"] == "token":
                print(event["text"], end="", flush=True)
        print(turn.result().stop_reason)

See ``README.md`` for host tools, images and process ownership.
"""

from ._generated import EVENT_TAGS, PROTOCOL_VERSION
from .errors import JanRpcError, JanRuntimeError
from .install import (
    MANIFEST_URL,
    PLATFORM_KEYS,
    InstalledRuntime,
    JanInstallError,
    bin_name,
    find_runtime,
    install_runtime,
    platform_key,
    runtime_root,
)
from .runtime import CLIENT_NAME, CLIENT_VERSION, JanRuntime
from .session import HostTool, HostToolCall, JanSession, JanTurn, TurnResult

__version__ = CLIENT_VERSION

__all__ = [
    "CLIENT_NAME",
    "CLIENT_VERSION",
    "EVENT_TAGS",
    "MANIFEST_URL",
    "PLATFORM_KEYS",
    "PROTOCOL_VERSION",
    "HostTool",
    "HostToolCall",
    "InstalledRuntime",
    "JanInstallError",
    "JanRpcError",
    "JanRuntime",
    "JanRuntimeError",
    "JanSession",
    "JanTurn",
    "TurnResult",
    "__version__",
    "bin_name",
    "find_runtime",
    "install_runtime",
    "platform_key",
    "runtime_root",
]

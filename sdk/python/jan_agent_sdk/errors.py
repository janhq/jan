"""Errors the SDK raises.

Two kinds, and the difference matters to a caller: an answer from the runtime,
and the channel itself.
"""

from __future__ import annotations

from typing import Any, Optional


class JanRpcError(Exception):
    """A method the runtime answered with a JSON-RPC error.

    ``code`` is the protocol's: ``-32602`` for malformed params, ``-32001``
    while another turn is active, ``-32002`` before the handshake, ``-32601``
    for a method this runtime does not have.
    """

    def __init__(
        self,
        message: str,
        *,
        code: Optional[int] = None,
        data: Any = None,
        method: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.data = data
        self.method = method

    @property
    def retryable(self) -> bool:
        """Whether retrying the same request could succeed.

        The runtime says so for "another turn is active", which is the one
        refusal a host is expected to wait out rather than treat as a bug.
        """
        return isinstance(self.data, dict) and self.data.get("retryable") is True


class JanRuntimeError(Exception):
    """The runtime process failed.

    It could not be spawned, it did not complete the handshake, it speaks a
    protocol version this client does not, or it exited - a channel failure,
    where :class:`JanRpcError` is an answer.
    """

    def __init__(
        self,
        message: str,
        *,
        exit_code: Optional[int] = None,
        stderr: str = "",
    ) -> None:
        super().__init__(message)
        self.exit_code = exit_code
        self.stderr = stderr

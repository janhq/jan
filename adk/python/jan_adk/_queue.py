"""One event queue, read by one consumer.

A turn's events, in the order the runtime emitted them. ``push`` reports whether
the event had to be buffered, which is what lets a turn nobody is draining stay
bounded.
"""

from __future__ import annotations

import threading
from collections import deque
from typing import Any, Deque, Iterator, Optional


# The end of the stream, distinct from every event an ``item/*`` record carries.
_END: Any = object()


class EventQueue:
    def __init__(self) -> None:
        self._items: Deque[Any] = deque()
        self._condition = threading.Condition()
        self._ended = False
        self._failure: Optional[BaseException] = None

    def __len__(self) -> int:
        """How many events are buffered - pushed and not yet taken."""
        with self._condition:
            return len(self._items)

    def push(self, item: Any) -> bool:
        """Append ``item``; ``True`` when it had to be buffered.

        A waiting reader takes it directly and the answer is ``False``, which is
        the signal that nobody is behind.
        """
        with self._condition:
            if self._ended:
                return False
            if self._items:
                self._items.append(item)
                return True
            self._items.append(item)
            self._condition.notify()
            return False

    def drop_oldest(self) -> bool:
        with self._condition:
            if not self._items:
                return False
            self._items.popleft()
            return True

    def end(self) -> None:
        with self._condition:
            self._ended = True
            self._condition.notify_all()

    def fail(self, error: BaseException) -> None:
        with self._condition:
            self._failure = error
            self._ended = True
            self._condition.notify_all()

    def __iter__(self) -> Iterator[Any]:
        while True:
            item = self._take()
            if item is _END:
                return
            # Handed over with the lock released: a consumer is allowed to call
            # back into the runtime from the loop body - interrupting the turn
            # it is iterating is the case that matters - and that call needs the
            # reader to keep reading, which needs this lock.
            yield item

    def _take(self) -> Any:
        with self._condition:
            while not self._items and not self._ended:
                self._condition.wait()
            if self._items:
                return self._items.popleft()
            if self._failure is not None:
                raise self._failure
            return _END

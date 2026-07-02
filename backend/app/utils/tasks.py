"""
Fire-and-forget task helper.

asyncio.create_task() only keeps a *weak* reference to the task via the event
loop, so a task whose result nobody awaits can be garbage-collected mid-flight —
silently dropping audit writes, session touches, log inserts, etc. under load.

spawn() keeps a strong reference in a module-level set until the task finishes,
then discards it. Use it for every "background, don't await" coroutine.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Coroutine, Set

logger = logging.getLogger("fintrack.tasks")

_background_tasks: Set[asyncio.Task] = set()


def spawn(coro: Coroutine[Any, Any, Any], *, name: str | None = None) -> asyncio.Task | None:
    """
    Schedule `coro` as a background task with a retained reference.

    Returns the Task, or None if there is no running event loop (in which case
    the coroutine is closed to avoid a "never awaited" warning).
    """
    try:
        task = asyncio.create_task(coro, name=name)
    except RuntimeError:
        # No running loop — close the coroutine so it doesn't warn.
        coro.close()
        return None
    _background_tasks.add(task)
    task.add_done_callback(_on_done)
    return task


def _on_done(task: asyncio.Task) -> None:
    _background_tasks.discard(task)
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.warning("background task %s failed: %s", task.get_name(), exc)

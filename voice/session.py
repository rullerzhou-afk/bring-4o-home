"""Voice session lifecycle — conversation creation, timeout, message caching."""

from __future__ import annotations

import time
from datetime import datetime

from memoria_client import MemoriaClient


class Session:
    """Manages a single voice conversation session.

    Automatically creates a new Memoria conversation when none exists or
    when the idle timeout has been exceeded.

    Usage::

        session = Session(client, timeout_m=30)
        await session.ensure_conversation()
        await session.add_user_message("你好")
    """

    def __init__(self, client: MemoriaClient, timeout_m: int = 30) -> None:
        self._client = client
        self._timeout_s = timeout_m * 60
        self._conv_id: str | None = None
        self._messages: list[dict] = []
        self._last_active: float = time.monotonic()

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def conv_id(self) -> str | None:
        return self._conv_id

    @property
    def messages(self) -> list[dict]:
        return self._messages

    # ------------------------------------------------------------------
    # Timeout
    # ------------------------------------------------------------------

    def is_expired(self) -> bool:
        if self._conv_id is None:
            return False
        return (time.monotonic() - self._last_active) > self._timeout_s

    def touch(self) -> None:
        self._last_active = time.monotonic()

    # ------------------------------------------------------------------
    # Conversation management
    # ------------------------------------------------------------------

    async def ensure_conversation(self) -> str:
        """Return current conv_id, creating a new conversation if needed."""
        if self._conv_id is None or self.is_expired():
            title = f"语音对话 {datetime.now():%m/%d}"
            cid = await self._client.create_conversation(title)
            self._conv_id = cid
            self._messages = []
            self._last_active = time.monotonic()
            print(f"[Session] 新对话: {cid}")
        return self._conv_id

    async def add_user_message(self, text: str) -> None:
        """Append a user message to local cache and persist to server."""
        msg = {"role": "user", "content": text}
        self._messages.append(msg)
        self.touch()
        if self._conv_id:
            await self._client.append_messages(self._conv_id, [msg])
        else:
            print("Warning: 无对话 ID，消息未持久化")

    async def add_assistant_message(self, text: str) -> None:
        """Append an assistant message to local cache (for Step 4)."""
        msg = {"role": "assistant", "content": text}
        self._messages.append(msg)
        self.touch()

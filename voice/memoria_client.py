"""Async HTTP client for the Memoria.chat server API."""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator

import httpx


class MemoriaClientError(Exception):
    """Raised when the Memoria API returns a non-2xx response."""

    def __init__(self, status: int, message: str) -> None:
        self.status = status
        super().__init__(f"HTTP {status}: {message}")


class MemoriaClient:
    """Lightweight async wrapper around Memoria REST endpoints.

    Usage::

        client = MemoriaClient("http://127.0.0.1:3000", admin_token="...")
        conv_id = await client.create_conversation("语音对话 03/04")
        text = await client.transcribe(wav_bytes, language="zh")
        await client.append_messages(conv_id, [{"role": "user", "content": text}])
        await client.close()
    """

    def __init__(
        self,
        base_url: str = "http://127.0.0.1:3000",
        admin_token: str = "",
        timeout: float = 30.0,
    ) -> None:
        headers: dict[str, str] = {}
        if admin_token:
            headers["Authorization"] = f"Bearer {admin_token}"
        # trust_env=False: bypass system proxy for localhost connections
        # (e.g. Clash/V2Ray on Windows would intercept and return 502)
        self._client = httpx.AsyncClient(
            base_url=base_url,
            headers=headers,
            timeout=timeout,
            trust_env=False,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _check(resp: httpx.Response) -> None:
        """Raise *MemoriaClientError* on non-2xx responses."""
        if resp.is_success:
            return
        try:
            body = resp.json()
            msg = body.get("error", resp.text)
        except Exception:
            msg = resp.text
        raise MemoriaClientError(resp.status_code, msg)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def create_conversation(self, title: str = "新对话") -> str:
        """POST /api/conversations → conversation id."""
        resp = await self._client.post(
            "/api/conversations",
            json={"title": title},
        )
        self._check(resp)
        return resp.json()["id"]

    async def append_messages(self, conv_id: str, messages: list[dict]) -> int:
        """PATCH /api/conversations/:id/messages → total message count."""
        resp = await self._client.patch(
            f"/api/conversations/{conv_id}/messages",
            json={"messages": messages},
        )
        self._check(resp)
        return resp.json().get("total", 0)

    async def transcribe(self, wav_bytes: bytes, language: str = "zh") -> str:
        """POST /api/voice/stt (multipart) → transcribed text."""
        resp = await self._client.post(
            "/api/voice/stt",
            files={"audio": ("recording.wav", wav_bytes, "audio/wav")},
            data={"language": language},
        )
        self._check(resp)
        return resp.json().get("text", "")

    async def chat_stream(self, messages: list[dict]) -> AsyncGenerator[dict, None]:
        """POST /api/chat — yield SSE event dicts as they arrive.

        Each yielded dict may contain one of:
          {"content": "..."}   — LLM text fragment (feed to SentenceBuffer)
          {"reasoning": "..."}  — reasoning chain (ignored by pipeline)
          {"status": "..."}    — status update
          {"meta": {...}}      — token usage / model info
          {"error": "..."}     — upstream error

        The generator ends when ``data: [DONE]`` is received or the stream
        closes.
        """
        async with self._client.stream(
            "POST",
            "/api/chat",
            json={"messages": messages},
            timeout=httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=10.0),
        ) as resp:
            if not resp.is_success:
                await resp.aread()
                self._check(resp)
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                payload = line[6:]
                if payload == "[DONE]":
                    break
                try:
                    yield json.loads(payload)
                except json.JSONDecodeError:
                    continue

    async def text_to_speech(
        self,
        text: str,
        voice: str = "alloy",
        speed: float = 1.0,
    ) -> bytes:
        """POST /api/voice/tts → WAV audio bytes."""
        resp = await self._client.post(
            "/api/voice/tts",
            json={"text": text, "voice": voice, "speed": speed, "format": "wav"},
        )
        self._check(resp)
        return resp.content

    async def close(self) -> None:
        """Shut down the underlying connection pool."""
        await self._client.aclose()

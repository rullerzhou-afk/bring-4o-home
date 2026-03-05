"""Three-stage async pipeline: SSE → sentences → TTS → playback."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

import audio_io
from memoria_client import MemoriaClient
from sentence_buffer import SentenceBuffer


class ChatError(Exception):
    """Raised when /api/chat returns an error event."""


@dataclass
class PipelineResult:
    """Outcome of a pipeline run."""

    full_text: str = ""          # Complete AI response text
    played_text: str = ""        # Text that was actually spoken
    meta: dict | None = None     # SSE meta event (model, token usage)


async def run_pipeline(
    client: MemoriaClient,
    messages: list[dict],
    cancel: asyncio.Event,
    tts_voice: str = "alloy",
    tts_speed: float = 1.0,
) -> PipelineResult:
    """Run the three-stage pipeline and return the result.

    Stages communicate via bounded ``asyncio.Queue`` instances.  Each stage
    guarantees its downstream sentinel (``None``) is emitted even on failure,
    preventing deadlocks.

    Stage 3 feeds decoded audio into a callback-driven ``TTSPlayer`` that
    keeps its OutputStream running at all times (outputting silence when
    idle), eliminating WASAPI output-start underflow.

    Args:
        client: Memoria API client (provides chat_stream / text_to_speech).
        messages: Conversation history to send to /api/chat.
        cancel: Set this event to abort the pipeline (Step 6 barge-in).
        tts_voice: OpenAI TTS voice name.
        tts_speed: TTS speed multiplier (0.25–4.0).
    """
    sentence_q: asyncio.Queue[str | None] = asyncio.Queue(maxsize=10)
    audio_q: asyncio.Queue[tuple[str, bytes] | None] = asyncio.Queue(maxsize=3)

    full_text_parts: list[str] = []
    played_parts: list[str] = []
    meta_holder: list[dict] = []  # length 0 or 1

    # ------------------------------------------------------------------
    # Stage 1: SSE stream → sentence queue
    # ------------------------------------------------------------------
    async def _sse_to_sentences() -> None:
        buffer = SentenceBuffer()
        try:
            async for event in client.chat_stream(messages):
                if cancel.is_set():
                    break
                if "error" in event:
                    raise ChatError(event["error"])
                if "content" in event:
                    full_text_parts.append(event["content"])
                    for sentence in buffer.add(event["content"]):
                        await sentence_q.put(sentence)
                if "meta" in event:
                    meta_holder.append(event["meta"])
            # Flush remaining tokens
            tail = buffer.flush()
            if tail:
                await sentence_q.put(tail)
        finally:
            await sentence_q.put(None)  # always signal downstream

    # ------------------------------------------------------------------
    # Stage 2: sentence queue → TTS → audio queue
    # ------------------------------------------------------------------
    async def _sentences_to_audio() -> None:
        try:
            while True:
                sentence = await sentence_q.get()
                if sentence is None:
                    break
                if cancel.is_set():
                    break
                try:
                    wav = await client.text_to_speech(
                        sentence, voice=tts_voice, speed=tts_speed,
                    )
                    await audio_q.put((sentence, wav))
                except Exception as exc:
                    print(f"  [TTS] 合成失败，跳过: {exc}")
        finally:
            await audio_q.put(None)  # always signal downstream

    # ------------------------------------------------------------------
    # Stage 3: audio queue → callback-driven TTSPlayer
    # ------------------------------------------------------------------
    #
    # TTSPlayer keeps an OutputStream running continuously (outputting
    # zeros when idle).  We decode WAV, enqueue numpy arrays, and the
    # PortAudio callback pulls data without any blocking-write underflow.

    async def _audio_player() -> None:
        player = audio_io.get_tts_player()
        player.begin_response()
        try:
            while True:
                item = await audio_q.get()
                if item is None:
                    break
                if cancel.is_set():
                    break
                text, wav_bytes = item
                try:
                    audio_np, _sr = audio_io.decode_wav_bytes(wav_bytes)
                    player.enqueue(audio_np)
                    played_parts.append(text)
                except Exception as exc:
                    print(f"  [播放] 失败，跳过: {exc}")
        finally:
            player.end_response()
            await asyncio.to_thread(player.wait_done)

    # ------------------------------------------------------------------
    # Run all three stages concurrently
    # ------------------------------------------------------------------
    await asyncio.gather(
        _sse_to_sentences(),
        _sentences_to_audio(),
        _audio_player(),
    )

    full_text = "".join(full_text_parts).strip()
    played_text = "".join(played_parts).strip()
    meta = meta_holder[0] if meta_holder else None

    return PipelineResult(
        full_text=full_text,
        played_text=played_text,
        meta=meta,
    )

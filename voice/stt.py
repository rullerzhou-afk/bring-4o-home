"""Speech-to-text — local (faster-whisper), local-torch (openai-whisper + PyTorch), or API backend."""

from __future__ import annotations

import asyncio

import numpy as np


# ---------------------------------------------------------------------------
# Base class — shared skeleton for local Whisper transcribers
# ---------------------------------------------------------------------------

class BaseTranscriber:
    """Common interface for local Whisper-based STT backends.

    Subclasses implement ``_load_model`` and ``_run_transcribe``.
    """

    _LOG_PREFIX = "[STT]"

    def __init__(self, model_size: str = "small", language: str = "auto") -> None:
        self._model_size = model_size
        self._language = language
        self._model = None

    def _load_model(self) -> None:
        """Load the backend-specific model. Called once on first transcription."""
        raise NotImplementedError

    def _run_transcribe(
        self, audio: np.ndarray, sr: int, lang: str | None, prompt: str | None,
    ) -> tuple[str, str | None]:
        """Run inference. Returns ``(text, detected_language_or_None)``."""
        raise NotImplementedError

    def _ensure_model(self) -> None:
        if self._model is not None:
            return
        self._load_model()

    def warm(self) -> None:
        """Pre-load the model so the first transcription is fast."""
        self._ensure_model()

    async def transcribe(self, audio: np.ndarray, sr: int = 16000) -> str:
        """Transcribe float32 audio array to text.

        Runs in a thread to avoid blocking the event loop.
        """
        return await asyncio.to_thread(self._transcribe_sync, audio, sr)

    def _transcribe_sync(self, audio: np.ndarray, sr: int) -> str:
        self._ensure_model()
        lang = self._language if self._language != "auto" else None
        # Nudge toward simplified Chinese when language is zh or auto-detected
        prompt = "以下是普通话的句子。" if lang in ("zh", None) else None
        text, detected = self._run_transcribe(audio, sr, lang, prompt)
        if lang is None and text and detected:
            print(f"{self._LOG_PREFIX} 检测到: {detected}")
        return text


# ---------------------------------------------------------------------------
# faster-whisper backend (CTranslate2 — NVIDIA CUDA or CPU)
# ---------------------------------------------------------------------------

class LocalTranscriber(BaseTranscriber):
    """Offline STT using faster-whisper (CTranslate2 Whisper).

    Best for CPU inference and NVIDIA GPUs.  Does NOT support AMD GPUs.
    """

    _LOG_PREFIX = "[STT]"

    def _load_model(self) -> None:
        from faster_whisper import WhisperModel

        print(f"{self._LOG_PREFIX} 加载 Whisper {self._model_size} 模型...")
        self._model = WhisperModel(
            self._model_size,
            device="auto",       # CUDA if available, else CPU
            compute_type="auto",  # float16 on GPU, int8 on CPU
        )
        device = getattr(getattr(self._model, "model", None), "device", "unknown")
        print(f"{self._LOG_PREFIX} 模型就绪 ({device})")

    def _run_transcribe(self, audio, sr, lang, prompt):
        segments, info = self._model.transcribe(
            audio,
            language=lang,
            beam_size=5,
            vad_filter=True,
            initial_prompt=prompt,
        )
        text = "".join(seg.text for seg in segments).strip()
        detected = f"{info.language} ({info.language_probability:.0%})" if lang is None else None
        return text, detected


# ---------------------------------------------------------------------------
# openai-whisper backend (PyTorch — AMD ROCm / NVIDIA CUDA / CPU)
# ---------------------------------------------------------------------------

class TorchTranscriber(BaseTranscriber):
    """Offline STT using openai-whisper + PyTorch.

    Designed for AMD GPU acceleration via ROCm — PyTorch's torch.cuda API
    works transparently with ROCm, so AMD GPUs appear as CUDA devices.
    Also works on NVIDIA CUDA and CPU as fallback.
    """

    _LOG_PREFIX = "[STT-torch]"

    def __init__(self, model_size: str = "small", language: str = "auto") -> None:
        super().__init__(model_size, language)
        self._device: str | None = None

    def _load_model(self) -> None:
        import torch
        import whisper

        self._device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"{self._LOG_PREFIX} 加载 Whisper {self._model_size} 模型 ({self._device})...")
        if self._device == "cuda":
            print(f"{self._LOG_PREFIX} GPU: {torch.cuda.get_device_name(0)}")
        self._model = whisper.load_model(self._model_size, device=self._device)
        print(f"{self._LOG_PREFIX} 模型就绪")

    def _run_transcribe(self, audio, sr, lang, prompt):
        result = self._model.transcribe(
            audio,
            language=lang,
            task="transcribe",
            fp16=(self._device == "cuda"),
            beam_size=5,
            initial_prompt=prompt,
            condition_on_previous_text=False,
        )
        text = result["text"].strip()
        detected = result.get("language") if lang is None else None
        return text, detected


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

_PROVIDERS: dict[str, type[BaseTranscriber]] = {
    "local": LocalTranscriber,
    "local-torch": TorchTranscriber,
}


def make_transcriber(
    provider: str, model_size: str, language: str,
) -> BaseTranscriber | None:
    """Create a transcriber for *provider*, or return ``None`` for API mode."""
    if provider == "api":
        return None
    cls = _PROVIDERS.get(provider)
    if cls is None:
        raise ValueError(f"Unknown stt_provider: {provider!r}")
    return cls(model_size=model_size, language=language)

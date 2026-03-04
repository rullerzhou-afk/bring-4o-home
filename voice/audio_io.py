"""Microphone recording and speaker playback via sounddevice."""

from __future__ import annotations

import numpy as np
import sounddevice as sd


def list_devices() -> None:
    """Print all available audio devices."""
    print(sd.query_devices())


def record(seconds: float, sample_rate: int = 16000, channels: int = 1) -> np.ndarray:
    """Record audio from the default input device (blocking).

    Returns:
        numpy array of shape (frames, channels), dtype float32.
    """
    frames = int(seconds * sample_rate)
    audio = sd.rec(frames, samplerate=sample_rate, channels=channels, dtype="float32")
    sd.wait()
    return audio


def play(audio_data: np.ndarray, sample_rate: int = 16000) -> None:
    """Play audio through the default output device (blocking)."""
    sd.play(audio_data, samplerate=sample_rate)
    sd.wait()


# ---------------------------------------------------------------------------
# Tone generation helpers
# ---------------------------------------------------------------------------

_PLAY_SR = 48000  # playback sample rate — most sound cards handle natively


def _generate_tone(
    freq_hz: int,
    duration_ms: int,
    amplitude: float = 0.35,
    harmonics: bool = False,
) -> np.ndarray:
    """Generate a single sine tone with 10 ms fade-in/out."""
    n_samples = int(_PLAY_SR * duration_ms / 1000)
    t = np.linspace(0, duration_ms / 1000, n_samples, endpoint=False, dtype=np.float32)
    tone = amplitude * np.sin(2 * np.pi * freq_hz * t)
    if harmonics:
        tone += 0.2 * np.sin(2 * np.pi * freq_hz * 2 * t)
    # 10 ms fade-in / fade-out to avoid click
    fade_len = int(_PLAY_SR * 0.01)
    if fade_len > 0 and fade_len * 2 < n_samples:
        tone[:fade_len] *= np.linspace(0, 1, fade_len, dtype=np.float32)
        tone[-fade_len:] *= np.linspace(1, 0, fade_len, dtype=np.float32)
    return tone


def _pad_and_play(signal: np.ndarray) -> None:
    """Prepend 50 ms silence (Windows audio warmup) and play blocking."""
    pad = np.zeros(int(_PLAY_SR * 0.05), dtype=np.float32)
    sd.play(np.concatenate([pad, signal]), samplerate=_PLAY_SR)
    sd.wait()


def play_tone(freq_hz: int = 880, duration_ms: int = 300) -> None:
    """Play a confirmation beep with octave harmonic."""
    _pad_and_play(_generate_tone(freq_hz, duration_ms, amplitude=0.45, harmonics=True))


def stream_record_with_vad(
    vad,
    sample_rate: int = 16000,
    silence_ms: int = 800,
    max_seconds: float = 60,
) -> np.ndarray:
    """Record from mic using VAD to detect end-of-speech.

    Args:
        vad: A SileroVAD instance (must have .process_chunk and .threshold).
        sample_rate: Sample rate in Hz (must be 16000 for Silero VAD).
        silence_ms: Milliseconds of silence after speech to stop recording.
        max_seconds: Hard cap on recording length.

    Returns:
        1-D float32 numpy array of the full recording.
    """
    if sample_rate != 16000:
        raise ValueError(
            f"Silero VAD requires 16000 Hz, got {sample_rate}. "
            "Do not override sample_rate when using VAD."
        )
    chunk_size = 512  # Silero VAD V5 expects 512 samples per call
    chunk_duration_ms = chunk_size / sample_rate * 1000  # ~32 ms
    silence_frames = int(silence_ms / chunk_duration_ms)
    max_chunks = int(max_seconds * sample_rate / chunk_size)

    chunks: list[np.ndarray] = []
    speech_started = False
    silent_count = 0

    with sd.InputStream(
        samplerate=sample_rate,
        channels=1,
        dtype="float32",
        blocksize=chunk_size,
    ) as stream:
        for _ in range(max_chunks):
            data, _overflowed = stream.read(chunk_size)
            chunk = data[:, 0]  # (chunk_size, 1) → (chunk_size,)
            chunks.append(chunk.copy())

            prob = vad.process_chunk(chunk)

            if prob >= vad.threshold:
                speech_started = True
                silent_count = 0
            elif speech_started:
                silent_count += 1
                if silent_count >= silence_frames:
                    break

    if not chunks:
        return np.array([], dtype=np.float32)
    return np.concatenate(chunks)


# ---------------------------------------------------------------------------
# Step 3 additions
# ---------------------------------------------------------------------------

def numpy_to_wav_bytes(audio: np.ndarray, sample_rate: int = 16000) -> bytes:
    """Convert a float32 [-1, 1] numpy array to in-memory WAV bytes.

    Returns raw bytes suitable for uploading to Whisper STT.
    """
    import io
    import wave

    # Clip and convert to 16-bit PCM
    clipped = np.clip(audio, -1.0, 1.0)
    pcm = (clipped * 32767).astype(np.int16)

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()


def play_wav(file_path: str) -> None:
    """Play a WAV file through the default output device.

    Silently returns if the file does not exist.
    """
    import os
    import wave

    if not os.path.isfile(file_path):
        print(f"Warning: WAV file not found: {file_path}")
        return

    with wave.open(file_path, "rb") as wf:
        sr = wf.getframerate()
        frames = wf.readframes(wf.getnframes())
        dtype = np.int16 if wf.getsampwidth() == 2 else np.float32
        audio = np.frombuffer(frames, dtype=dtype).astype(np.float32)
        if dtype == np.int16:
            audio = audio / 32768.0

    sd.play(audio, samplerate=sr)
    sd.wait()


# Pre-defined tone patterns: list of (freq_hz, duration_ms)
REMIND_PATTERN = [(440, 200), (554, 300)]       # gentle ascending — "still there?"
BYE_PATTERN = [(554, 200), (440, 200), (330, 400)]  # descending — "goodnight"


def play_tone_pattern(
    freqs: list[tuple[int, int]],
    gap_ms: int = 50,
) -> None:
    """Play a sequence of (freq_hz, duration_ms) tones with gaps and fades."""
    parts: list[np.ndarray] = []
    for freq_hz, duration_ms in freqs:
        parts.append(_generate_tone(freq_hz, duration_ms))
        if gap_ms > 0:
            parts.append(np.zeros(int(_PLAY_SR * gap_ms / 1000), dtype=np.float32))
    _pad_and_play(np.concatenate(parts))

"""Sound effects — load audio files from voice/sound/ and play via TTSPlayer."""

from __future__ import annotations

import os

import numpy as np


def _resample(audio: np.ndarray, src_sr: int, dst_sr: int) -> np.ndarray:
    """Simple linear interpolation resample (no extra dependencies)."""
    if src_sr == dst_sr:
        return audio
    ratio = dst_sr / src_sr
    new_len = int(len(audio) * ratio)
    indices = np.arange(new_len) / ratio
    indices = np.clip(indices, 0, len(audio) - 1)
    idx_floor = indices.astype(np.intp)
    idx_ceil = np.minimum(idx_floor + 1, len(audio) - 1)
    frac = (indices - idx_floor).astype(np.float32)
    return audio[idx_floor] * (1 - frac) + audio[idx_ceil] * frac


class SoundBank:
    """Pre-loaded sound effects for instant playback.

    Loads MP3 files from ``voice/sound/`` at startup, decodes to numpy
    arrays, and plays through the shared TTSPlayer.
    """

    def __init__(self) -> None:
        self._clips: dict[str, tuple[np.ndarray, int]] = {}
        self.available: bool = False

    def load(self) -> None:
        """Load all MP3 files from the sound directory."""
        sound_dir = os.path.join(os.path.dirname(__file__), "sound")
        if not os.path.isdir(sound_dir):
            print("[Sound] sound/ directory not found, sounds disabled")
            return

        import soundfile as sf

        count = 0
        for fname in os.listdir(sound_dir):
            if not fname.lower().endswith((".mp3", ".wav", ".ogg", ".flac")):
                continue
            name = os.path.splitext(fname)[0]  # "turn_on", "error", etc.
            fpath = os.path.join(sound_dir, fname)
            try:
                audio_np, sr = sf.read(fpath, dtype="float32")
                if audio_np.ndim > 1:
                    audio_np = audio_np[:, 0]  # mono
                # Resample to 24kHz (TTSPlayer singleton rate) if needed
                if sr != 24000:
                    audio_np = _resample(audio_np, sr, 24000)
                    sr = 24000
                self._clips[name] = (audio_np, sr)
                count += 1
            except Exception as e:
                print(f"[Sound] Failed to load {fname}: {e}")

        if count > 0:
            self.available = True
            print(f"[Sound] Loaded {count} clips: {', '.join(sorted(self._clips))}")

    def play(self, name: str, volume: float = 1.0, delay: float = 0.0) -> None:
        """Play a named sound clip. Blocking (waits until done).

        Args:
            volume: 0.0~1.0, scales amplitude.
            delay: seconds to wait before playing.
        """
        clip = self._clips.get(name)
        if clip is None:
            return
        if delay > 0:
            import time
            time.sleep(delay)
        audio_np, sr = clip
        if volume < 1.0:
            audio_np = audio_np * np.float32(volume)  # copy, don't mutate cached clip
        import audio_io
        audio_io.get_tts_player(sr).play_sync(audio_np)

    def has(self, name: str) -> bool:
        return name in self._clips


async def ensure_wake_response(tts, voice: str, speed: float) -> None:
    """Generate wake_response audio if it doesn't exist yet.

    Uses the configured TTS to synthesize "I'm here" and saves it
    as a WAV file in sound/.  Delete the file to regenerate
    (e.g. after changing TTS voice).
    """
    sound_dir = os.path.join(os.path.dirname(__file__), "sound")
    os.makedirs(sound_dir, exist_ok=True)

    # Check if any wake_response file already exists
    for fname in os.listdir(sound_dir):
        if os.path.splitext(fname)[0].lower() == "wake_response":
            return

    print("[Sound] Generating wake_response...")
    try:
        audio_np, sr = await tts.synthesize(
            "I'm here.", voice=voice, speed=speed, lang="en-us",
        )
        if len(audio_np) == 0:
            print("[Sound] wake_response generation returned empty audio")
            return

        import soundfile as sf
        out_path = os.path.join(sound_dir, "wake_response.wav")
        sf.write(out_path, audio_np, sr)
        print(f"[Sound] Saved wake_response.wav ({len(audio_np)/sr:.1f}s)")
    except Exception as e:
        print(f"[Sound] Failed to generate wake_response: {e}")

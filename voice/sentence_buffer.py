"""Sentence buffer — accumulate streaming tokens and split on punctuation."""

from __future__ import annotations

# Chinese sentence enders (unambiguous, always split)
_HARD_BREAKS = frozenset("。！？；\n")

# English sentence enders (split only when followed by space or at buffer end)
_EN_BREAKS = frozenset(".!?")

# Soft breaks — only used when buffer gets long
_SOFT_BREAKS = frozenset("，、,")

_SOFT_THRESHOLD = 40   # chars before soft breaks activate
_FORCE_THRESHOLD = 80  # chars before forced split


class SentenceBuffer:
    """Accumulate streaming tokens and emit complete sentences.

    Usage::

        buf = SentenceBuffer()
        for token in stream:
            for sentence in buf.add(token):
                process(sentence)
        tail = buf.flush()
        if tail:
            process(tail)
    """

    def __init__(self) -> None:
        self._buf = ""

    def add(self, token: str) -> list[str]:
        """Add a token, return list of complete sentences (may be empty)."""
        self._buf += token
        sentences: list[str] = []

        while True:
            pos = self._find_break()
            if pos < 0:
                break
            sentence = self._buf[: pos + 1].strip()
            self._buf = self._buf[pos + 1 :]
            if sentence:
                sentences.append(sentence)

        # Force split if buffer exceeds threshold
        if len(self._buf) >= _FORCE_THRESHOLD:
            # Try to find a soft break for a cleaner cut
            cut = -1
            for i in range(len(self._buf) - 1, -1, -1):
                if self._buf[i] in _SOFT_BREAKS:
                    cut = i
                    break
            if cut >= 0:
                sentence = self._buf[: cut + 1].strip()
                self._buf = self._buf[cut + 1 :]
            else:
                sentence = self._buf.strip()
                self._buf = ""
            if sentence:
                sentences.append(sentence)

        return sentences

    def flush(self) -> str | None:
        """Return remaining buffered text, if any."""
        text = self._buf.strip()
        self._buf = ""
        return text or None

    def _find_break(self) -> int:
        """Find the earliest sentence break position, or -1."""
        for i, ch in enumerate(self._buf):
            # Chinese hard breaks — always split
            if ch in _HARD_BREAKS:
                return i
            # English breaks — split if followed by space or at end of buffer
            if ch in _EN_BREAKS and i >= 1:
                if i + 1 >= len(self._buf) or self._buf[i + 1] == " ":
                    return i

        # Soft breaks only when buffer is long enough
        if len(self._buf) > _SOFT_THRESHOLD:
            for i, ch in enumerate(self._buf):
                if ch in _SOFT_BREAKS:
                    return i

        return -1

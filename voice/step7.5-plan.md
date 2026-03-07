# Step 7.5: Pre-generated Voice Feedback

## Goal

Eliminate the "dead air" between user action and AI response by playing pre-generated TTS audio:

1. **Wake response** -- User says wake word -> immediately play "I'm here" before recording starts
2. **Thinking filler** -- User finishes speaking -> play "Hmm..." while STT processes

Both use the same mechanism: TTS pre-generation -> disk cache -> load as numpy arrays -> random playback via TTSPlayer.

## Current Flow (with dead air)

```
Wake word ──────────────────────→ [LISTENING] 录音 → [PROCESSING] STT → AI → TTS
           ^~~~ silence ~~~^

Space ──→ [LISTENING] 录音 → ding → [PROCESSING] STT → AI → TTS
                                     ^~~~ dead air (1-4s) ~~~^
```

## Target Flow

```
Wake word → play_wake("我在") → pause wakeword → [LISTENING] 录音 → play_think("嗯...") + STT parallel → AI → TTS
                    ^阻塞播完^                                       ^--- filler 覆盖 STT ---^

Space → [LISTENING] 录音 → play_think("让我想想") + STT parallel → AI → TTS
                            ^--- filler 覆盖 STT 等待时间 ---^
```

**Important scope**: Filler only covers STT latency (1-4s), NOT AI response latency. After STT returns text, the pipeline takes over TTSPlayer for AI response, filler must have finished or be interrupted by then.

## Design

### New file: `voice/filler.py`

```python
class FillerCache:
    """Pre-generated TTS audio clips for instant playback."""

    def __init__(self):
        self.wake_clips: dict[str, list[np.ndarray]] = {"zh": [], "en": []}
        self.think_clips: dict[str, list[np.ndarray]] = {"zh": [], "en": []}
        self.sr: int = 24000
        self._last_wake_idx: dict[str, int] = {"zh": -1, "en": -1}
        self._last_think_idx: dict[str, int] = {"zh": -1, "en": -1}

    async def load_or_generate(self, tts, voice, speed, phrases_cfg):
        """Load from disk cache, or generate + cache on first run."""
        ...

    def play_wake(self, lang: str = "zh"):
        """Play a random (non-repeating) wake response clip. Blocking."""
        ...

    def play_think(self, lang: str = "zh"):
        """Play a random (non-repeating) thinking filler clip. Blocking."""
        ...
```

### Filler Phrases (configurable in `config.yaml`)

```yaml
filler_wake_phrases_zh: ["我在", "嗯？", "怎么了", "在呢", "来了"]
filler_wake_phrases_en: ["Yes?", "I'm here", "Hi there", "What's up"]
filler_think_phrases_zh: ["嗯......", "让我想想", "好的", "稍等一下"]
filler_think_phrases_en: ["Hmm...", "Let me think", "One moment", "Sure"]
```

Users can customize these to match their AI's personality (e.g., tsundere: "哼，我查一下").

### Disk Cache (avoid startup delay)

Directory: `voice/.cache/filler/`

Mechanism:
1. Compute hash from: `tts_provider + tts_voice + tts_speed + sorted(phrases)`
2. Cache path: `.cache/filler/{hash}/`
3. Each clip saved as `{category}_{lang}_{idx}.npy` (numpy array) + `meta.json` (sample rate, version)
4. Startup: if cache exists and hash matches -> load from disk (ms-level); otherwise generate via TTS and save

This means first startup with a new voice/phrases takes ~10s, subsequent starts are instant.

### Config additions (`config.yaml` + `config.py`)

```yaml
# --- Filler (Step 7.5) ---
filler_wake_enabled: true     # play voice clip on wake word trigger
filler_think_enabled: true    # play thinking filler after recording (replaces ding)

# Customizable phrases (default values shown)
filler_wake_phrases_zh: ["我在", "嗯？", "怎么了", "在呢", "来了"]
filler_wake_phrases_en: ["Yes?", "I'm here", "Hi there", "What's up"]
filler_think_phrases_zh: ["嗯......", "让我想想", "好的", "稍等一下"]
filler_think_phrases_en: ["Hmm...", "Let me think", "One moment", "Sure"]
```

Replace existing `filler_enabled` with the two new options. When `filler_think_enabled: true`, the ding is replaced by a voice filler. When `false`, keep the ding.

### Language selection logic

- **Wake response**: Detect from the wake word that triggered. CJK characters in keyword -> zh, else -> en.
- **Thinking filler**: Use `language` config. If `auto`, default to `zh`.

### Non-repeating playback

Track `_last_idx` per category+lang. Each `play_*` call picks a random index != last index. With 4-5 clips per category this ensures variety without complex LRU.

### Integration into `main.py`

#### 0. Prerequisite: `wait_for_trigger` returns trigger source

Current signature returns `bool`. Change to return which event fired:

```python
async def wait_for_trigger(events, timeout) -> asyncio.Event | None:
    """Returns the Event that fired, or None on timeout."""
```

This lets the caller distinguish wake_event vs space_event for language selection.

#### 1. Startup: load/generate cache

In `talk_loop()`, after TTS warmup:

```python
filler = FillerCache()
await filler.load_or_generate(tts_provider, tts_voice, tts_speed, phrases_from_cfg)
```

Generation failure is non-fatal: log warning, disable fillers for this session.

#### 2. Wake word trigger -> play wake clip (blocking, then record)

In the IDLE state block, after trigger fires:

```python
fired = await wait_for_trigger(triggers, timeout=idle_timeout)
if fired is None:
    # timeout path...

# Determine trigger source and play wake clip
if fired is wake_event and filler_wake_enabled:
    wake_lang = detect_lang_from_wakeword(wake_words_raw)
    # Pause wake listener BEFORE playing (prevent self-trigger from speaker)
    if wake_listener:
        wake_listener.pause()
    await asyncio.to_thread(filler.play_wake, wake_lang)
    # Wake listener stays paused — _listen_and_transcribe will resume it

sm.transition(State.LISTENING)
text = await _listen_and_transcribe(lc)
```

**Key**: play_wake is BLOCKING (uses `TTSPlayer.play_sync`). Wake listener is paused before playback to prevent speaker bleed re-triggering the detector. The listener stays paused because `_listen_and_transcribe` handles pause/resume in its try/finally.

#### 3. After recording -> play think filler WHILE STT runs

Inside `_listen_and_transcribe`, replace the ding with parallel filler+STT:

```python
# Old (sequential):
if lc.filler_enabled:
    await asyncio.to_thread(audio_io.play_tone)
text = await stt(audio)

# New (parallel):
if lc.filler and lc.filler.has_think_clips(lang):
    stt_task = asyncio.create_task(stt_coroutine(audio))
    filler_task = asyncio.create_task(
        asyncio.to_thread(lc.filler.play_think, lang)
    )
    # Wait for BOTH — filler is short (<1.5s), STT is 1-4s
    # If STT finishes first, filler naturally plays out
    await asyncio.gather(stt_task, filler_task)
    text = stt_task.result()
elif lc.filler_enabled:
    await asyncio.to_thread(audio_io.play_tone)  # fallback ding
    text = await stt(audio)
else:
    text = await stt(audio)
```

**Why this is safe**: `play_think` uses `TTSPlayer.play_sync()` which does `begin_response → enqueue → end_response → wait_done`. After `gather` completes, the player is idle. The pipeline's `begin_response()` in `_do_speak` runs after `_listen_and_transcribe` returns and `_log_and_save` completes, so there's no conflict.

**Edge case — STT finishes before filler**: `gather` waits for both, so filler plays out naturally. The extra 0.5s wait is acceptable (filler is <1.5s, STT min is ~1s, so max extra wait is ~0.5s).

**Edge case — need to abort filler**: If STT fails or returns empty, `_listen_and_transcribe` returns None. The filler is still playing via `play_sync` in the background thread. Since `gather` awaits both, filler completes before the function returns. This is fine — it's <1.5s.

#### 4. Barge-in path (in `_do_speak`)

Same logic applies. `_listen_and_transcribe` already handles filler internally, so no changes needed in `_do_speak`.

### Edge cases

1. **TTS provider fails at startup** -- Log warning, set `filler.available = False`, fall back to ding
2. **Disk cache corrupted** -- Delete cache dir, regenerate
3. **Edge TTS (async-only)** -- `load_or_generate()` is async, works with both API and Edge
4. **Config change (voice/phrases changed)** -- Hash mismatch -> regenerate cache automatically
5. **play_think replaces ding** -- When `filler_think_enabled`, skip `play_tone()`. When disabled, keep the ding
6. **wake_listener pause timing** -- Must pause BEFORE playing wake clip to prevent self-trigger

### Files to modify

| File | Change |
|------|--------|
| `voice/filler.py` | **New** -- FillerCache class with disk cache |
| `voice/config.py` | Add filler config defaults + env map |
| `voice/config.yaml` | Add filler config entries + phrase lists |
| `voice/main.py` | `wait_for_trigger` return type change, wake/think playback, ListenCfg gets filler ref |
| `voice/README.md` | Config table update |
| `voice/.gitignore` | Add `.cache/` |

### Validation

- [ ] First startup generates clips and caches to disk (`[Filler] Generating 9 clips...`)
- [ ] Subsequent startups load from cache instantly (`[Filler] Loaded 9 clips from cache`)
- [ ] Wake word trigger plays voice clip, then recording starts (no overlap)
- [ ] Wake clip does NOT re-trigger wake word detector (listener paused)
- [ ] After recording, voice filler plays while STT runs in parallel
- [ ] Filler finishes before AI response TTS starts (no player conflict)
- [ ] No two consecutive plays of the same clip
- [ ] `filler_wake_enabled: false` disables wake clips (silent, straight to recording)
- [ ] `filler_think_enabled: false` falls back to ding tone
- [ ] Both disabled: same behavior as before Step 7.5
- [ ] Custom phrases in config.yaml work correctly
- [ ] Voice/phrase change -> cache auto-regenerates
- [ ] TTS generation failure at startup doesn't crash the service

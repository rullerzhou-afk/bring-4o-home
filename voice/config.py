"""Configuration loader — YAML file + environment variable overrides."""

from __future__ import annotations

import os
import yaml

_DEFAULTS = {
    "sample_rate": 16000,
    "channels": 1,
    "memoria_url": "http://127.0.0.1:3000",
    "admin_token": "",
    "tts_voice": "alloy",
    "vad_threshold": 0.5,
    "silence_duration": 1.5,
    "max_recording": 60,
    "wake_word": "hey memoria",
    "language": "auto",
    "session_timeout": 30,
    "idle_remind_m": 2,
    "idle_remind_wait_s": 15,
    "stt_provider": "local",
    "stt_model": "small",
    "tts_speed": 1.0,
}

# Environment variable name → config key
_ENV_MAP = {
    "MEMORIA_URL": "memoria_url",
    "ADMIN_TOKEN": "admin_token",
    "TTS_VOICE": "tts_voice",
    "SAMPLE_RATE": "sample_rate",
    "CHANNELS": "channels",
    "VAD_THRESHOLD": "vad_threshold",
    "SILENCE_DURATION": "silence_duration",
    "MAX_RECORDING": "max_recording",
    "LANGUAGE": "language",
    "SESSION_TIMEOUT": "session_timeout",
    "IDLE_REMIND_M": "idle_remind_m",
    "IDLE_REMIND_WAIT_S": "idle_remind_wait_s",
    "STT_PROVIDER": "stt_provider",
    "STT_MODEL": "stt_model",
    "TTS_SPEED": "tts_speed",
}


_dotenv_loaded = False


def _load_dotenv() -> None:
    """Read the project root .env file into os.environ (once, won't overwrite)."""
    global _dotenv_loaded
    if _dotenv_loaded:
        return
    _dotenv_loaded = True
    dotenv_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if not os.path.isfile(dotenv_path):
        return
    with open(dotenv_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.split("#")[0].strip()  # strip inline comments
            # Strip surrounding quotes (dotenv-compatible)
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                value = value[1:-1]
            # Don't overwrite existing env vars (explicit > .env)
            if key and key not in os.environ:
                os.environ[key] = value


def load_config(path: str | None = None) -> dict:
    """Load config from YAML, fall back to defaults, apply env overrides."""
    _load_dotenv()
    cfg = dict(_DEFAULTS)

    yaml_path = path or os.path.join(os.path.dirname(__file__), "config.yaml")
    if os.path.isfile(yaml_path):
        with open(yaml_path, "r", encoding="utf-8") as f:
            from_file = yaml.safe_load(f) or {}
        cfg.update(from_file)

    # Environment variables take highest priority
    for env_key, cfg_key in _ENV_MAP.items():
        val = os.environ.get(env_key)
        if val is not None:
            # Coerce numeric values; skip bad input
            default = _DEFAULTS.get(cfg_key)
            try:
                if isinstance(default, int):
                    val = int(val)
                elif isinstance(default, float):
                    val = float(val)
            except ValueError:
                print(f"Warning: invalid {env_key}={val!r}, using default {default}")
                continue
            cfg[cfg_key] = val

    return cfg


cfg = load_config()

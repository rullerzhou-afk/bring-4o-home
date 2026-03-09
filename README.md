# Memoria.chat

[English](./README.md) | [中文](./README_CN.md)

**Ever switched AI models and realized it forgot everything about you?**

Your name, your preferences, your inside jokes — gone. Every new model starts as a stranger. Export your ChatGPT history? The new platform can't use it. Craft the perfect persona? It drifts after a few updates.

Memoria is a self-hosted AI chat client with **persistent, structured memory**. Your AI remembers who you are across model switches, platform changes, and conversation resets — and it gets better at being *your* AI over time.

## Why Memoria?

Most AI chat clients let you talk to models. Memoria lets you **build a relationship** with one.

| Feature | Memoria | LobeChat | ChatBox | NextChat |
|---------|:-------:|:--------:|:-------:|:--------:|
| Persistent memory across models | **Yes** | No | No | No |
| Auto-learns from conversations | **Yes** | No | No | No |
| Structured memory (identity / preferences / events) | **Yes** | No | No | No |
| Memory importance scoring & smart injection | **Yes** | No | No | No |
| Persona versioning & rollback | **Yes** | Masks | No | Masks |
| ChatGPT data import with memory fusion | **Yes** | No | No | No |
| Multi-provider (OpenAI / Volcengine / OpenRouter) | **Yes** | Yes | Yes | Yes |
| Voice conversation mode | **Yes** | No | No | No |
| File reading (PDF / Word / TXT) | **Yes** | Plugin | No | No |
| Web search | **Yes** | Plugin | No | Plugin |
| Self-hosted, no database | **Yes** | Needs DB | Desktop | Yes |
| Zero build step | **Yes** | Needs build | N/A | Needs build |

## Quick Start

**Prerequisites:** [Node.js](https://nodejs.org/) v18+ and [Git](https://git-scm.com/downloads)

```bash
git clone https://github.com/rullerzhou-afk/memoria-chat.git
cd memoria-chat
npm install
cp .env.example .env   # Add at least one API key
npm start              # Open http://127.0.0.1:3000
```

**Update:** `git pull && npm install && npm start`

### Docker

```bash
git clone https://github.com/rullerzhou-afk/memoria-chat.git
cd memoria-chat
cp .env.example .env    # Add API key + ADMIN_TOKEN (required for Docker)
docker compose up -d    # Open http://localhost:3000
```

Data persists in `data/` and `prompts/` on the host. Containers are disposable.

## How Memory Works

Memoria's memory system has three tiers, automatically maintained through conversations:

| Tier | What it stores | Example |
|------|---------------|---------|
| **Identity** | Core facts that rarely change | "Software engineer in Singapore" |
| **Preferences** | Habits, tastes, working style | "Prefers concise answers with code examples" |
| **Events** | Recent activities, current projects | "Preparing for a job interview this week" |

**Auto-learning:** After each conversation, Memoria extracts relevant facts — new info is added, outdated info is updated, contradictions are resolved automatically.

**Smart injection:** Not all memories are sent to the model every time. Memoria scores each memory by importance and recency, then selects within a token budget. Identity is always included; the rest competes on relevance.

**Reflection:** Manually trigger insight extraction from recent events — Memoria analyzes patterns across your recent activities and distills higher-level observations about your preferences and identity.

**Lifecycle:** Memories can be promoted (events → preferences → identity), demoted, or decayed over time based on usage patterns. Stale memories are flagged; low-importance idle memories are cleaned up.

## Features

### Persona Engine
- Fully customizable system prompt with built-in templates
- Automatic version snapshots — view history and rollback anytime
- Custom AI name and user nickname
- Clear priority rules: user instructions > persona > memory

### Chat
- **Three providers, one interface** — OpenAI, Volcengine, OpenRouter; auto-routed by model ID
- **Streaming responses** with SSE
- **Web search** via Serper.dev (AI decides when to search)
- **Chain-of-thought** display for reasoning models (collapsible)
- **Image understanding** for vision models
- **File reading** — drag in PDF, Word, TXT, Markdown, CSV, or JSON

### Voice
- **Full voice conversation mode** — click the mic, speak, hear AI respond out loud
- **Flexible STT** — Browser Web Speech API (free), OpenAI Whisper API, Groq Whisper (free & fast), or local Whisper (`pip install faster-whisper`)
- **Flexible TTS** — Edge TTS (free, 10+ voices), OpenAI TTS API, or any OpenAI-compatible TTS server
- **Smart auto-learn** — memories are extracted from voice conversations just like text chat
- **Conversation sync** — voice chats appear in the main page with full message history
- **Real-time orb visualizer** — reactive audio visualization during listening and speaking

### Data
- **ChatGPT import** — drop your full export folder; conversations, images, and memories are restored and fused
- **Conversation persistence** — server-side JSON, nothing is lost
- **Full-text search** across all conversations
- **Edit & regenerate** any message

### Polish
- Mobile-responsive layout
- Light / dark / system theme
- Token usage display per message (model, tokens, response time)
- Adjustable context window (4–500 messages)

## API Keys

Configure at least one provider in `.env`:

| Provider | Get a key | Models |
|----------|-----------|--------|
| **OpenRouter** (recommended) | [openrouter.ai/keys](https://openrouter.ai/keys) | GPT-4o, Claude, Gemini, and hundreds more with one key |
| **OpenAI** | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | GPT-4o, GPT-4.1, o3 series |
| **Volcengine** | [console.volcengine.com](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey) | GLM, Kimi series (direct connection in China) |
| **Serper** (search) | [serper.dev](https://serper.dev) | Free 2,500 Google searches; auto-enabled once configured |

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | One of three | OpenAI API key |
| `OPENAI_BASE_URL` | No | Custom OpenAI-compatible endpoint |
| `ARK_API_KEY` | One of three | Volcengine Ark API key |
| `ARK_BASE_URL` | No | Volcengine API endpoint |
| `OPENROUTER_API_KEY` | One of three | OpenRouter API key |
| `OPENROUTER_BASE_URL` | No | OpenRouter API endpoint |
| `OPENROUTER_SITE_URL` | No | `HTTP-Referer` header for OpenRouter |
| `OPENROUTER_APP_NAME` | No | `X-Title` header for OpenRouter |
| `ADMIN_TOKEN` | For remote/Docker | Auth token; **required** when not on localhost |
| `SERPER_API_KEY` | No | Serper.dev search API key |
| `HOST` / `PORT` | No | Listen address (default `127.0.0.1:3000`) |
| `MODEL` | No | Default model (fallback `gpt-4o`) |
| `AUTO_LEARN_MODEL` | No | Model for memory extraction (auto-selected if empty) |
| `AUTO_LEARN_COOLDOWN` | No | Memory extraction cooldown in seconds (default `300`) |
| `TTS_BASE_URL` | No | Custom TTS server (e.g. Kokoro-FastAPI); OpenAI-compatible |
| `TTS_API_KEY` | No | API key for custom TTS server |
| `STT_BASE_URL` | No | Custom STT server (e.g. [Groq](https://console.groq.com/) `https://api.groq.com/openai/v1`); OpenAI-compatible |
| `STT_API_KEY` | No | API key for custom STT server |
| `STT_MODEL` | No | STT model name (e.g. `whisper-large-v3` for Groq) |
| `WHISPER_MODEL` | No | Whisper model size for local Python STT (default `base`) |
| `PYTHON_PATH` | No | Python executable for local Whisper (default `python` / `python3`) |

## Remote Access

By default, Memoria only listens on localhost. For remote access, set `HOST=0.0.0.0` and `ADMIN_TOKEN` in `.env`. Recommended: expose via [Tailscale](https://tailscale.com/), [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), or ngrok.

## Tech Stack

- **Backend:** Node.js + Express + OpenAI SDK v4
- **Frontend:** Vanilla HTML/CSS/JS (no framework), marked.js + DOMPurify via CDN
- **Storage:** File system (JSON)

No build step. No database. No framework lock-in. One `npm start` and you're running.

## License

[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) — Free to use, modify, and share. Not for commercial use.

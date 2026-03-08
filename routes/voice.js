const router = require("express").Router();
const multer = require("multer");
const OpenAI = require("openai");
const { toFile } = require("openai");
const clients = require("../lib/clients");

// Optional dedicated TTS client (e.g. Kokoro-FastAPI at localhost:8880)
const TTS_BASE_URL = (process.env.TTS_BASE_URL || "").trim();
const ttsClient = TTS_BASE_URL
  ? new OpenAI({ apiKey: process.env.TTS_API_KEY || "not-needed", baseURL: TTS_BASE_URL })
  : null;

// multer: 内存存储，25MB 上限（Whisper API 限制）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const STT_TIMEOUT_MS = 30_000;
const TTS_TIMEOUT_MS = 30_000;
const EDGE_TTS_TIMEOUT_MS = 15_000;

// OpenAI TTS 支持的 voice 列表（不在列表中的 fallback 到 alloy）
const TTS_VOICES = new Set([
  "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse",
]);

// Edge TTS 常用 voice 白名单（不在列表中的 fallback 到默认）
const EDGE_TTS_VOICES = new Set([
  // 中文
  "zh-CN-YunxiNeural", "zh-CN-XiaoxiaoNeural", "zh-CN-YunyangNeural",
  "zh-CN-XiaoyiNeural", "zh-CN-YunjianNeural", "zh-CN-XiaochenNeural",
  // 英文
  "en-US-AndrewNeural", "en-US-AriaNeural", "en-US-GuyNeural",
  "en-US-JennyNeural", "en-US-ChristopherNeural",
  // 日文
  "ja-JP-NanamiNeural", "ja-JP-KeitaNeural",
]);
const EDGE_TTS_DEFAULT_VOICE = "zh-CN-YunxiNeural";

// ===== STT 代理：音频 → 文本 =====
router.post("/voice/stt", upload.single("audio"), async (req, res) => {
  if (!clients.openaiClient) {
    return res.status(503).json({ error: "STT unavailable: OPENAI_API_KEY not configured." });
  }
  if (!req.file) {
    return res.status(400).json({ error: "Missing `audio` file in multipart form." });
  }

  const language = typeof req.body?.language === "string" ? req.body.language.slice(0, 10) : undefined;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), STT_TIMEOUT_MS);

  try {
    // toFile: Node 18+ 兼容（不依赖全局 File，Node 20 才有）
    const file = await toFile(req.file.buffer, req.file.originalname || "audio.webm", {
      type: req.file.mimetype || "audio/webm",
    });

    const transcription = await clients.openaiClient.audio.transcriptions.create(
      {
        model: "whisper-1",
        file,
        ...(language ? { language } : {}),
      },
      { signal: abort.signal }
    );

    res.json({ text: transcription.text || "" });
  } catch (err) {
    if (err.name === "AbortError") {
      return res.status(504).json({ error: "STT request timed out." });
    }
    console.error("[voice/stt] error:", err);
    res.status(502).json({ error: clients.formatProviderError(err) });
  } finally {
    clearTimeout(timer);
  }
});

// ===== Edge TTS 合成 =====
async function synthesizeEdgeTts(text, voice, speed) {
  const { Communicate } = require("edge-tts-universal");
  const safeVoice = EDGE_TTS_VOICES.has(voice) ? voice : EDGE_TTS_DEFAULT_VOICE;
  // speed: 1.0 → "+0%", 1.5 → "+50%", 0.8 → "-20%"
  const pct = Math.round((speed - 1) * 100);
  const rateStr = (pct >= 0 ? "+" : "") + pct + "%";
  const communicate = new Communicate(text, { voice: safeVoice, rate: rateStr });
  const buffers = [];
  for await (const chunk of communicate.stream()) {
    if (chunk.type === "audio" && chunk.data) {
      buffers.push(chunk.data);
    }
  }
  return Buffer.concat(buffers);
}

// ===== TTS 代理：文本 → 音频 =====
router.post("/voice/tts", async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text || text.length > 4096) {
    return res.status(400).json({ error: "Text is required and must be ≤4096 characters." });
  }

  const provider = typeof req.body?.provider === "string" ? req.body.provider : "";
  const rawVoice = typeof req.body?.voice === "string" ? req.body.voice.slice(0, 60) : "";
  const speed = typeof req.body?.speed === "number" ? Math.max(0.25, Math.min(4.0, req.body.speed)) : 1.0;

  // ---- Edge TTS ----
  if (provider === "edge") {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), EDGE_TTS_TIMEOUT_MS);
    try {
      const buf = await Promise.race([
        synthesizeEdgeTts(text, rawVoice || EDGE_TTS_DEFAULT_VOICE, speed),
        new Promise((_, reject) => abort.signal.addEventListener("abort", () =>
          reject(Object.assign(new Error("Edge TTS timed out"), { name: "AbortError" }))
        )),
      ]);
      clearTimeout(timer);
      res.set("Content-Type", "audio/mpeg");
      return res.send(buf);
    } catch (edgeErr) {
      clearTimeout(timer);
      console.warn("[voice/tts] Edge TTS failed:", edgeErr.message);
      // 降级到 OpenAI TTS（如果有 key）
      if (clients.openaiClient) {
        console.log("[voice/tts] falling back to OpenAI TTS");
        try {
          const fallbackBuf = await synthesizeOpenaiTts(
            clients.openaiClient, text, rawVoice, speed
          );
          res.set("Content-Type", "audio/mpeg");
          res.set("X-TTS-Fallback", "api");
          return res.send(fallbackBuf);
        } catch (fallbackErr) {
          console.error("[voice/tts] OpenAI fallback also failed:", fallbackErr.message);
          return res.status(502).json({ error: "Edge TTS and OpenAI TTS both failed." });
        }
      }
      return res.status(502).json({ error: "Edge TTS failed: " + edgeErr.message });
    }
  }

  // ---- OpenAI / Local TTS (原有逻辑) ----
  const client = ttsClient || clients.openaiClient;
  if (!client) {
    return res.status(503).json({ error: "TTS unavailable: set TTS_BASE_URL or OPENAI_API_KEY." });
  }

  const voice = ttsClient ? rawVoice || "alloy" : (TTS_VOICES.has(rawVoice) ? rawVoice : "alloy");

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TTS_TIMEOUT_MS);

  try {
    const format = req.body.format === "wav" ? "wav" : "mp3";
    const contentType = format === "wav" ? "audio/wav" : "audio/mpeg";

    const response = await client.audio.speech.create(
      {
        model: ttsClient ? "kokoro" : "tts-1",
        input: text,
        voice,
        speed,
        response_format: format,
      },
      { signal: abort.signal }
    );

    res.set("Content-Type", contentType);

    // response.body 是 ReadableStream，pipe 到 res
    const nodeStream = response.body;
    if (nodeStream?.pipe) {
      nodeStream.on("error", (err) => {
        clearTimeout(timer);
        console.error("[voice/tts] stream error:", err);
        if (!res.headersSent) res.status(502).end();
        else res.destroy();
      });
      nodeStream.pipe(res);
      res.on("close", () => clearTimeout(timer));
      return;
    }
    // fallback: arrayBuffer
    const buf = Buffer.from(await response.arrayBuffer());
    res.send(buf);
  } catch (err) {
    if (err.name === "AbortError") {
      return res.status(504).json({ error: "TTS request timed out." });
    }
    console.error("[voice/tts] error:", err);
    res.status(502).json({ error: clients.formatProviderError(err) });
  } finally {
    clearTimeout(timer);
  }
});

// OpenAI TTS 辅助函数（用于 Edge TTS 降级）
async function synthesizeOpenaiTts(client, text, rawVoice, speed) {
  const voice = TTS_VOICES.has(rawVoice) ? rawVoice : "alloy";
  const response = await client.audio.speech.create({
    model: "tts-1",
    input: text,
    voice,
    speed,
    response_format: "mp3",
  });
  return Buffer.from(await response.arrayBuffer());
}

module.exports = router;

const router = require("express").Router();
const multer = require("multer");
const { toFile } = require("openai");
const clients = require("../lib/clients");

// multer: 内存存储，25MB 上限（Whisper API 限制）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const STT_TIMEOUT_MS = 30_000;
const TTS_TIMEOUT_MS = 30_000;

// OpenAI TTS 支持的 voice 列表（不在列表中的 fallback 到 alloy）
const TTS_VOICES = new Set([
  "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse",
]);

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

// ===== TTS 代理：文本 → 音频 =====
router.post("/voice/tts", async (req, res) => {
  if (!clients.openaiClient) {
    return res.status(503).json({ error: "TTS unavailable: OPENAI_API_KEY not configured." });
  }

  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text || text.length > 4096) {
    return res.status(400).json({ error: "Text is required and must be ≤4096 characters." });
  }

  const rawVoice = typeof req.body?.voice === "string" ? req.body.voice.slice(0, 20) : "alloy";
  const voice = TTS_VOICES.has(rawVoice) ? rawVoice : "alloy";
  const speed = typeof req.body?.speed === "number" ? Math.max(0.25, Math.min(4.0, req.body.speed)) : 1.0;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TTS_TIMEOUT_MS);

  try {
    const format = req.body.format === "wav" ? "wav" : "mp3";
    const contentType = format === "wav" ? "audio/wav" : "audio/mpeg";

    const response = await clients.openaiClient.audio.speech.create(
      {
        model: "tts-1",
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
      // pipe 是非阻塞的，timer 需要等流结束再清
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

module.exports = router;

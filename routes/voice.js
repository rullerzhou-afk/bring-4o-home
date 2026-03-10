const router = require("express").Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");
const OpenAI = require("openai");
const { toFile } = require("openai");
const clients = require("../lib/clients");

// Optional dedicated TTS client (e.g. Kokoro-FastAPI at localhost:8880)
const TTS_BASE_URL = (process.env.TTS_BASE_URL || "").trim();
const ttsClient = TTS_BASE_URL
  ? new OpenAI({ apiKey: process.env.TTS_API_KEY || "not-needed", baseURL: TTS_BASE_URL })
  : null;

// Optional dedicated local STT client (e.g. faster-whisper-server)
const STT_BASE_URL = (process.env.STT_BASE_URL || "").trim();
const localSttClient = STT_BASE_URL
  ? new OpenAI({ apiKey: process.env.STT_API_KEY || "not-needed", baseURL: STT_BASE_URL })
  : null;

const LOCAL_STT_SCRIPT = path.join(__dirname, "..", "scripts", "local-stt.py");
const LOCAL_STT_TIMEOUT_MS = 60_000;

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
  if (!req.file) {
    return res.status(400).json({ error: "Missing `audio` file in multipart form." });
  }

  const provider = typeof req.body?.provider === "string" ? req.body.provider : "api";
  const language = typeof req.body?.language === "string" ? req.body.language.slice(0, 10) : undefined;

  // ---- Local Whisper (STT_BASE_URL server or Python script) ----
  if (provider === "local") {
    // Prefer STT_BASE_URL (OpenAI-compatible local server)
    if (localSttClient) {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), LOCAL_STT_TIMEOUT_MS);
      try {
        const file = await toFile(req.file.buffer, req.file.originalname || "audio.webm", {
          type: req.file.mimetype || "audio/webm",
        });
        const transcription = await localSttClient.audio.transcriptions.create(
          { model: process.env.STT_MODEL || "whisper-1", file, ...(language ? { language } : {}) },
          { signal: abort.signal }
        );
        return res.json({ text: transcription.text || "" });
      } catch (err) {
        if (err.name === "AbortError") return res.status(504).json({ error: "Local STT timed out." });
        console.error("[voice/stt] local server error:", err);
        return res.status(502).json({ error: `Local STT server error: ${err.message}` });
      } finally {
        clearTimeout(timer);
      }
    }

    // Fallback: spawn Python script
    const tmpFile = path.join(os.tmpdir(), `stt_${Date.now()}_${Math.random().toString(36).slice(2)}.webm`);
    try {
      await fs.promises.writeFile(tmpFile, req.file.buffer);
      const pythonCmd = process.env.PYTHON_PATH || (process.platform === "win32" ? "python" : "python3");
      const args = [LOCAL_STT_SCRIPT, tmpFile];
      if (process.env.WHISPER_MODEL) args.push(process.env.WHISPER_MODEL);
      if (language) args.push(language);

      const result = await new Promise((resolve, reject) => {
        execFile(pythonCmd, args, {
          timeout: LOCAL_STT_TIMEOUT_MS,
          encoding: "utf8",
          env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        }, (err, stdout, stderr) => {
          if (err) {
            // Try to parse stderr for structured error
            try {
              const errData = JSON.parse(stderr.trim());
              return reject(new Error(errData.error || stderr));
            } catch {
              return reject(new Error(stderr || err.message));
            }
          }
          try {
            resolve(JSON.parse(stdout.trim()));
          } catch {
            reject(new Error(`Invalid output: ${stdout.slice(0, 200)}`));
          }
        });
      });
      return res.json({ text: result.text || "" });
    } catch (err) {
      console.error("[voice/stt] local script error:", err);
      return res.status(502).json({ error: `Local Whisper: ${err.message}` });
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }

  // ---- OpenAI Whisper API (default) ----
  if (!clients.openaiClient) {
    return res.status(503).json({ error: "STT unavailable: OPENAI_API_KEY not configured." });
  }

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), STT_TIMEOUT_MS);

  try {
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
async function synthesizeEdgeTts(text, voice, speed, signal) {
  const { Communicate } = require("edge-tts-universal");
  const safeVoice = EDGE_TTS_VOICES.has(voice) ? voice : EDGE_TTS_DEFAULT_VOICE;
  // speed: 1.0 → "+0%", 1.5 → "+50%", 0.8 → "-20%"
  const pct = Math.round((speed - 1) * 100);
  const rateStr = (pct >= 0 ? "+" : "") + pct + "%";
  const communicate = new Communicate(text, { voice: safeVoice, rate: rateStr });
  const buffers = [];
  const gen = communicate.stream();
  // When signal fires, force-close the generator so the WebSocket is released
  // and the for-await loop exits promptly instead of waiting for the next chunk.
  const onAbort = () => gen.return(undefined).catch(() => {});
  if (signal) {
    if (signal.aborted) { onAbort(); throw Object.assign(new Error("Edge TTS aborted"), { name: "AbortError" }); }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    for await (const chunk of gen) {
      if (signal?.aborted) break;
      if (chunk.type === "audio" && chunk.data) {
        buffers.push(chunk.data);
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  if (signal?.aborted) {
    throw Object.assign(new Error("Edge TTS aborted"), { name: "AbortError" });
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
      const buf = await synthesizeEdgeTts(
        text, rawVoice || EDGE_TTS_DEFAULT_VOICE, speed, abort.signal
      );
      clearTimeout(timer);
      res.set("Content-Type", "audio/mpeg");
      return res.send(buf);
    } catch (edgeErr) {
      clearTimeout(timer);
      console.warn("[voice/tts] Edge TTS failed:", edgeErr.message);
      // 降级到 OpenAI TTS（如果有 key）
      if (clients.openaiClient) {
        console.log("[voice/tts] falling back to OpenAI TTS");
        const fallbackAbort = new AbortController();
        const fallbackTimer = setTimeout(() => fallbackAbort.abort(), TTS_TIMEOUT_MS);
        try {
          const fallbackBuf = await synthesizeOpenaiTts(
            clients.openaiClient, text, rawVoice, speed, fallbackAbort.signal
          );
          res.set("Content-Type", "audio/mpeg");
          res.set("X-TTS-Fallback", "api");
          return res.send(fallbackBuf);
        } catch (fallbackErr) {
          if (fallbackErr.name === "AbortError") {
            return res.status(504).json({ error: "OpenAI TTS fallback timed out." });
          }
          console.error("[voice/tts] OpenAI fallback also failed:", fallbackErr.message);
          return res.status(502).json({ error: `Edge TTS failed: ${edgeErr.message}; OpenAI TTS fallback also failed: ${fallbackErr.message}` });
        } finally {
          clearTimeout(fallbackTimer);
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
async function synthesizeOpenaiTts(client, text, rawVoice, speed, signal) {
  const voice = TTS_VOICES.has(rawVoice) ? rawVoice : "alloy";
  const response = await client.audio.speech.create(
    { model: "tts-1", input: text, voice, speed, response_format: "mp3" },
    ...(signal ? [{ signal }] : []),
  );
  return Buffer.from(await response.arrayBuffer());
}

module.exports = router;

const crypto = require("crypto");
const fs = require("fs");
const fsp = fs.promises;
const router = require("express").Router();
const multer = require("multer");
const path = require("path");
const { IMAGES_DIR } = require("../lib/config");

const ALLOWED_MIME = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const ALLOWED_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: IMAGES_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".bin";
      const unique = crypto.randomBytes(8).toString("hex");
      cb(null, unique + ext);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_MIME.includes(file.mimetype) || !ALLOWED_EXTS.includes(ext)) {
      return cb(new Error("不支持的文件格式，仅限 PNG/JPG/GIF/WebP"));
    }
    cb(null, true);
  },
});

// Magic bytes 签名校验
const MAGIC = {
  png:  [0x89, 0x50, 0x4E, 0x47],
  jpeg: [0xFF, 0xD8, 0xFF],
  gif:  [0x47, 0x49, 0x46, 0x38],
  riff: [0x52, 0x49, 0x46, 0x46], // WebP 外层是 RIFF
};

function checkMagicBytes(buf) {
  if (buf.length < 12) return false;
  const match = (sig) => sig.every((b, i) => buf[i] === b);
  if (match(MAGIC.png)) return true;
  if (match(MAGIC.jpeg)) return true;
  if (match(MAGIC.gif)) return true;
  if (match(MAGIC.riff) && buf.toString("ascii", 8, 12) === "WEBP") return true;
  return false;
}

router.post("/images", (req, res, next) => {
  imageUpload.single("image")(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "文件大小超过 10MB 限制" });
      }
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "请选择一个图片文件" });
  }

  // 读取文件头校验 magic bytes
  try {
    const fd = await fsp.open(req.file.path, "r");
    const buf = Buffer.alloc(12);
    try {
      await fd.read(buf, 0, 12, 0);
    } finally {
      await fd.close();
    }
    if (!checkMagicBytes(buf)) {
      await fsp.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: "文件内容与声明的图片格式不匹配" });
    }
  } catch {
    await fsp.unlink(req.file.path).catch(() => {});
    return res.status(500).json({ error: "Internal server error" });
  }

  res.json({ ok: true, url: "/images/" + req.file.filename });
});

module.exports = router;

const router = require("express").Router();
const multer = require("multer");
const path = require("path");
const { IMAGES_DIR } = require("../lib/config");

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: IMAGES_DIR,
    filename: (req, file, cb) => {
      const safe = file.originalname
        .replace(/[^a-zA-Z0-9_.-]/g, "_")
        .replace(/\.{2,}/g, "_")
        .replace(/^\./, "_");
      cb(null, safe);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/png", "image/jpeg", "image/gif", "image/webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
    cb(null, allowed.includes(file.mimetype) && allowedExts.includes(ext));
  },
});

router.post("/images", imageUpload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No valid image file." });
  res.json({ ok: true, url: "/images/" + req.file.filename });
});

module.exports = router;

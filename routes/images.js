const crypto = require("crypto");
const router = require("express").Router();
const multer = require("multer");
const path = require("path");
const { IMAGES_DIR } = require("../lib/config");

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

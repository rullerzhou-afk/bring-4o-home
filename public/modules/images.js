import { state, imagePreview } from "./state.js";

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function createThumbnail(dataUrl, maxSize = 150) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ratio = Math.min(maxSize / img.width, maxSize / img.height, 1);
      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.6));
    };
    img.src = dataUrl;
  });
}

export function compressImage(dataUrl, maxBytes = 4 * 1024 * 1024) {
  return new Promise((resolve) => {
    if (dataUrl.length * 0.75 < maxBytes) {
      resolve(dataUrl);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const maxDim = 2048;
      const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1);
      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.src = dataUrl;
  });
}

export async function addImages(files) {
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    if (state.pendingImages.length >= 5) break;
    const dataUrl = await readFileAsDataUrl(file);
    const compressed = await compressImage(dataUrl);
    const thumbnail = await createThumbnail(dataUrl);
    state.pendingImages.push({ dataUrl: compressed, thumbnail });
  }
  renderImagePreview();
}

export function renderImagePreview() {
  imagePreview.innerHTML = "";
  if (state.pendingImages.length === 0) {
    imagePreview.classList.add("hidden");
    return;
  }
  imagePreview.classList.remove("hidden");
  state.pendingImages.forEach((img, idx) => {
    const thumb = document.createElement("div");
    thumb.className = "preview-thumb";
    const imgEl = document.createElement("img");
    imgEl.src = img.thumbnail;
    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.innerHTML = "&times;";
    removeBtn.onclick = () => {
      state.pendingImages.splice(idx, 1);
      renderImagePreview();
    };
    thumb.appendChild(imgEl);
    thumb.appendChild(removeBtn);
    imagePreview.appendChild(thumb);
  });
}

export function showLightbox(src) {
  const existing = document.getElementById("image-lightbox");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.id = "image-lightbox";
  const img = document.createElement("img");
  img.src = src;
  overlay.appendChild(img);
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}
export function showToast(message, type = "error") {
  if (!message) return;
  let container = document.getElementById("global-toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "global-toast-container";
    container.style.cssText = "position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:min(360px,calc(100vw - 32px));pointer-events:none;";
    (document.body || document.documentElement).appendChild(container);
  }
  const toast = document.createElement("div");
  const bg = type === "warning" ? "#b45309" : "#dc2626";
  toast.style.cssText = `background:${bg};color:#fff;padding:10px 12px;border-radius:8px;font-size:13px;line-height:1.4;box-shadow:0 6px 18px rgba(0,0,0,.2);opacity:0;transform:translateY(8px);transition:opacity .2s ease,transform .2s ease;pointer-events:auto;`;
  toast.textContent = String(message);
  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  });
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    setTimeout(() => toast.remove(), 200);
  }, 4000);
}

window.addEventListener("unhandledrejection", (event) => {
  const reason = event?.reason;
  const message = reason instanceof Error
    ? reason.message
    : typeof reason === "string"
      ? reason
      : "发生未处理异常，请稍后重试";
  showToast(message, "error");
});

export function formatMetaTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

marked.setOptions({
  breaks: true,
  gfm: true,
});

export function renderMarkdown(content) {
  const source = typeof content === "string" ? content : "";
  const unsafeHtml = marked.parse(source);
  if (window.DOMPurify?.sanitize) {
    return DOMPurify.sanitize(unsafeHtml, {
      ALLOWED_TAGS: [
        "p", "br", "h1", "h2", "h3", "h4", "h5", "h6",
        "a", "ul", "ol", "li", "blockquote", "pre", "code",
        "em", "strong", "del", "hr", "img", "table", "thead",
        "tbody", "tr", "th", "td", "details", "summary",
        "sup", "sub", "span", "div", "input",
      ],
      ALLOWED_ATTR: [
        "href", "target", "rel", "src", "alt", "class", "id",
        "type", "checked", "disabled",
      ],
      ALLOW_DATA_ATTR: false,
    });
  }

  // DOMPurify 加载失败时，降级到纯文本渲染，避免 XSS。
  const escaped = document.createElement("div");
  escaped.textContent = source;
  return escaped.innerHTML.replace(/\n/g, "<br>");
}

export function getApiToken() {
  return (localStorage.getItem("api_token") || "").trim();
}

// 页面加载时同步 localStorage token 到 cookie，确保 <img> 等非 fetch 请求也能通过鉴权
{
  const t = (localStorage.getItem("api_token") || "").trim();
  if (t) document.cookie = "api_token=" + encodeURIComponent(t) + "; path=/; SameSite=Strict";
}

export function withAuthHeaders(headers = {}) {
  const token = getApiToken();
  if (!token) return { ...headers };
  return {
    ...headers,
    Authorization: `Bearer ${token}`,
  };
}

export async function readErrorMessage(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await response.json().catch(() => null);
    if (data?.error) return data.error;
  }
  const text = await response.text().catch(() => "");
  return text || `HTTP ${response.status}`;
}

let _tokenPromptLock = null;

export async function apiFetch(url, options = {}, allowRetry = true) {
  if (navigator.onLine === false) {
    throw new Error("网络已断开，请检查网络连接后重试");
  }
  const finalOptions = {
    ...options,
    headers: withAuthHeaders(options.headers || {}),
  };
  const response = await fetch(url, finalOptions);

  if (response.status === 401) {
    if (allowRetry) {
      if (!_tokenPromptLock) {
        let _resolve;
        _tokenPromptLock = new Promise((r) => { _resolve = r; });
        const token = window.prompt("请输入 ADMIN_TOKEN 后继续");
        _resolve(token && token.trim() ? token.trim() : null);
      }
      const token = await _tokenPromptLock;
      if (token) {
        localStorage.setItem("api_token", token);
        document.cookie = "api_token=" + encodeURIComponent(token) + "; path=/; SameSite=Strict";
        return apiFetch(url, options, false);
      }
    } else {
      _tokenPromptLock = null;
      localStorage.removeItem("api_token");
      document.cookie = "api_token=; path=/; max-age=0";
      showToast("ADMIN_TOKEN 验证失败，请刷新页面重试");
    }
  }

  if (response.status === 403) {
    showToast("服务器拒绝访问，请在 .env 中设置 ADMIN_TOKEN 后重启服务");
  }

  return response;
}
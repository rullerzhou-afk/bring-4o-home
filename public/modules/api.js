import { t, getLocale } from "./i18n.js";

const TOAST_BG = { error: "#dc2626", warning: "#b45309", success: "#16a34a", info: "#2563eb" };

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
  const bg = TOAST_BG[type] || TOAST_BG.error;
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

export function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

window.addEventListener("unhandledrejection", (event) => {
  const reason = event?.reason;
  const message = reason instanceof Error
    ? reason.message
    : typeof reason === "string"
      ? reason
      : t("err_unhandled");
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
  const locale = getLocale();
  if (sameDay) {
    return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return d.toLocaleDateString(locale, { year: "numeric", month: "2-digit", day: "2-digit" });
}

if (typeof marked !== "undefined") {
  marked.setOptions({
    breaks: true,
    gfm: true,
  });
}

// ===== 数学公式渲染（KaTeX） =====

/**
 * 从文本中提取 $$...$$ 和 $...$ 数学表达式，替换为占位符。
 * 跳过代码块（```...```）和行内代码（`...`）内的内容。
 */
function extractMath(text) {
  const mathMap = [];
  const codeMap = [];
  let processed = text;

  // 1. 保护 fenced code blocks（```...``` 和 ~~~...~~~）
  processed = processed.replace(/(```|~~~)[\s\S]*?\1/g, (match) => {
    const idx = codeMap.length;
    codeMap.push(match);
    return `\uFFFC\uFFFC\uFFFCCODE${idx}\uFFFC\uFFFC\uFFFC`;
  });

  // 2. 保护 inline code（`...`）
  processed = processed.replace(/`[^`]+`/g, (match) => {
    const idx = codeMap.length;
    codeMap.push(match);
    return `\uFFFC\uFFFC\uFFFCCODE${idx}\uFFFC\uFFFC\uFFFC`;
  });

  // 3. 提取 \[...\] display math
  processed = processed.replace(/\\\[([\s\S]+?)\\\]/g, (_, expr) => {
    const idx = mathMap.length;
    mathMap.push({ expr: expr.trim(), displayMode: true });
    return `\uFFFC\uFFFC\uFFFCMATH${idx}\uFFFC\uFFFC\uFFFC`;
  });

  // 4. 提取 \(...\) inline math
  processed = processed.replace(/\\\(([\s\S]+?)\\\)/g, (_, expr) => {
    const idx = mathMap.length;
    mathMap.push({ expr: expr.trim(), displayMode: false });
    return `\uFFFC\uFFFC\uFFFCMATH${idx}\uFFFC\uFFFC\uFFFC`;
  });

  // 5. 提取 block math $$...$$ （可跨行）
  processed = processed.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => {
    const idx = mathMap.length;
    mathMap.push({ expr: expr.trim(), displayMode: true });
    return `\uFFFC\uFFFC\uFFFCMATH${idx}\uFFFC\uFFFC\uFFFC`;
  });

  // 6. 提取 inline math $...$
  //    - 不匹配转义 \$ 或连续 $$
  //    - 内容不能以空格开头/结尾（避免 "$10 + $20" 误匹配）
  //    - 闭合 $ 后不能紧跟数字（避免价格 "$10" 误匹配）
  processed = processed.replace(/(?<![\\\$])\$((?:[^\$\n\\]|\\.)+?)\$(?!\d)/g, (match, expr) => {
    if (expr.startsWith(" ") || expr.endsWith(" ")) return match;
    const idx = mathMap.length;
    mathMap.push({ expr, displayMode: false });
    return `\uFFFC\uFFFC\uFFFCMATH${idx}\uFFFC\uFFFC\uFFFC`;
  });

  // 7. 恢复代码块（代码内不做数学渲染）
  processed = processed.replace(/\uFFFC\uFFFC\uFFFCCODE(\d+)\uFFFC\uFFFC\uFFFC/g, (_, idx) => codeMap[parseInt(idx)]);

  return { text: processed, mathMap };
}

/**
 * 将占位符替换为 KaTeX 渲染结果。
 * 在 marked + DOMPurify 之后调用，KaTeX 输出绕过 sanitize（KaTeX 自身安全）。
 */
function restoreMath(html, mathMap) {
  if (!mathMap.length) return html;

  return html.replace(/\uFFFC\uFFFC\uFFFCMATH(\d+)\uFFFC\uFFFC\uFFFC/g, (_, idx) => {
    const entry = mathMap[parseInt(idx)];
    if (!entry) return _;

    // KaTeX 未加载时，回退显示原始表达式
    if (typeof window.katex === "undefined") {
      const escaped = escapeHtml(entry.expr);
      const delim = entry.displayMode ? "$$" : "$";
      return `<code>${delim}${escaped}${delim}</code>`;
    }

    try {
      return katex.renderToString(entry.expr, {
        displayMode: entry.displayMode,
        throwOnError: false,
      });
    } catch {
      const escaped = escapeHtml(entry.expr);
      return `<code class="katex-error" title="${escaped}">${escaped}</code>`;
    }
  });
}

export function renderMarkdown(content) {
  const source = typeof content === "string" ? content : "";

  // 数学公式提取（在 marked 解析前，避免反斜杠被吃掉）
  const { text: mathProtected, mathMap } = extractMath(source);

  const unsafeHtml = marked.parse(mathProtected);
  let html;
  if (window.DOMPurify?.sanitize) {
    html = DOMPurify.sanitize(unsafeHtml, {
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
  } else {
    // DOMPurify 加载失败时，降级到纯文本渲染，避免 XSS。
    // 跳过 math 渲染（KaTeX HTML 绕过 sanitize，无 DOMPurify 时不安全）
    const escaped = document.createElement("div");
    escaped.textContent = source;
    return escaped.innerHTML.replace(/\n/g, "<br>");
  }

  // 数学公式恢复（在 DOMPurify 之后，KaTeX 输出绕过 sanitize）
  html = restoreMath(html, mathMap);

  return html;
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
    throw new Error(t("err_offline"));
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
        const token = window.prompt(t("err_auth_prompt"));
        _resolve(token && token.trim() ? token.trim() : null);
      }
      const token = await _tokenPromptLock;
      _tokenPromptLock = null;          // 无论成功与否，释放锁，允许下次重新弹框
      if (token) {
        localStorage.setItem("api_token", token);
        document.cookie = "api_token=" + encodeURIComponent(token) + "; path=/; SameSite=Strict";
        return apiFetch(url, options, false);
      }
      showToast(t("err_auth_required"), "warning");
    } else {
      _tokenPromptLock = null;
      localStorage.removeItem("api_token");
      document.cookie = "api_token=; path=/; max-age=0";
      showToast(t("err_auth_failed"));
    }
  }

  if (response.status === 403) {
    showToast(t("err_forbidden"));
  }

  return response;
}
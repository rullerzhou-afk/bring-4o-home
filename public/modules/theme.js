import { t } from "./i18n.js";

const THEME_KEY = "theme_preference";

const SVG_ICONS = {
  light: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="5"></circle>
    <line x1="12" y1="1" x2="12" y2="3"></line>
    <line x1="12" y1="21" x2="12" y2="23"></line>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
    <line x1="1" y1="12" x2="3" y2="12"></line>
    <line x1="21" y1="12" x2="23" y2="12"></line>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
  </svg>`,
  dark: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
  </svg>`,
  system: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
    <line x1="8" y1="21" x2="16" y2="21"></line>
    <line x1="12" y1="17" x2="12" y2="21"></line>
  </svg>`,
};

function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(preference, toggle) {
  const effective = preference === "system" ? getSystemTheme() : preference;
  if (effective === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  if (toggle) {
    toggle.innerHTML = SVG_ICONS[preference] || SVG_ICONS.dark;
    toggle.title = t("title_theme_" + (preference || "dark"));
  }
}

/** 应用已存储的主题（纯函数，不绑定任何 DOM 事件），voice 页面可安全调用 */
export function applyStoredTheme() {
  applyTheme(localStorage.getItem(THEME_KEY) || "system", null);

  // 监听系统主题变化
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if ((localStorage.getItem(THEME_KEY) || "system") === "system") {
      applyTheme("system", null);
    }
  });
}

/** 绑定 #theme-toggle 按钮（仅主页 app.js 调用，voice 页面不调） */
export function bindThemeToggle() {
  const themeToggle = document.getElementById("theme-toggle");
  if (!themeToggle) return;

  applyTheme(localStorage.getItem(THEME_KEY) || "system", themeToggle);

  themeToggle.addEventListener("click", () => {
    const order = ["dark", "light", "system"];
    const current = localStorage.getItem(THEME_KEY) || "system";
    const next = order[(order.indexOf(current) + 1) % order.length];
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next, themeToggle);
  });

  document.addEventListener("lang-changed", () => {
    applyTheme(localStorage.getItem(THEME_KEY) || "system", themeToggle);
  });
}

// 保持向后兼容：cycleTheme 仍可导出
export function cycleTheme() {
  const themeToggle = document.getElementById("theme-toggle");
  const order = ["dark", "light", "system"];
  const current = localStorage.getItem(THEME_KEY) || "system";
  const next = order[(order.indexOf(current) + 1) % order.length];
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next, themeToggle);
}

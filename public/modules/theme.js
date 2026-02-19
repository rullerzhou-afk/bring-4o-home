const themeToggle = document.getElementById("theme-toggle");
const THEME_KEY = "theme_preference";

function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(preference) {
  const effective = preference === "system" ? getSystemTheme() : preference;
  if (effective === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  const labels = { light: "\u2600\uFE0F 亮色", dark: "\uD83C\uDF19 暗色", system: "\uD83D\uDCBB 跟随系统" };
  themeToggle.textContent = labels[preference] || labels.dark;
}

export function cycleTheme() {
  const order = ["dark", "light", "system"];
  const current = localStorage.getItem(THEME_KEY) || "system";
  const next = order[(order.indexOf(current) + 1) % order.length];
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

themeToggle.addEventListener("click", cycleTheme);

window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
  if ((localStorage.getItem(THEME_KEY) || "system") === "system") {
    applyTheme("system");
  }
});

applyTheme(localStorage.getItem(THEME_KEY) || "system");
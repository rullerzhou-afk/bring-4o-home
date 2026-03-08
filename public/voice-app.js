import { applyStoredTheme } from "./modules/theme.js";
import { setLang, applyI18n, t } from "./modules/i18n.js";
import { VoiceController } from "./modules/voice/controller.js";

// 主题（不绑定 toggle 按钮，voice 页面没有）
applyStoredTheme();

// 语言
const savedLang = localStorage.getItem("app_lang") || "zh";
setLang(savedLang);
applyI18n();

// 语言切换时重新应用
document.addEventListener("lang-changed", () => applyI18n());

// 启动语音控制器
const vc = new VoiceController();
vc.init();

// 页面离开时清理
window.addEventListener("beforeunload", () => vc.destroy());

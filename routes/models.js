const router = require("express").Router();
const { openaiClient, arkClient, openrouterClient, formatProviderError } = require("../lib/clients");

const OPENAI_ALLOW = /^(gpt-4o(-2024-(05-13|08-06|11-20))?|gpt-4\.1(-mini|-nano)?|o3(-mini)?)$/;
const ARK_ALLOW = ["glm", "kimi"];
const MAX_MODELS_SCAN = 500;

router.get("/models", async (req, res) => {
  try {
    // OpenAI 模型（白名单）
    const openaiModels = [];
    if (openaiClient) {
      try {
        let oc = 0;
        for await (const m of await openaiClient.models.list()) {
          if (++oc > MAX_MODELS_SCAN) break;
          if (OPENAI_ALLOW.test(m.id)) {
            openaiModels.push(m.id);
          }
        }
        openaiModels.sort();
      } catch (err) {
        console.error("获取 OpenAI 模型列表失败:", formatProviderError(err));
      }
    }

    // 火山引擎模型（白名单：GLM / Kimi）
    let arkModels = [];
    if (arkClient) {
      try {
        let ac = 0;
        for await (const m of await arkClient.models.list()) {
          if (++ac > MAX_MODELS_SCAN) break;
          if (ARK_ALLOW.some((kw) => m.id.toLowerCase().includes(kw))) {
            arkModels.push(m.id);
          }
        }
        arkModels.sort();
      } catch (err) {
        console.error("获取火山引擎模型列表失败:", formatProviderError(err));
      }
    }

    // OpenRouter 模型（同样只保留 GPT 系列，给无国际信用卡用户提供替代通道）
    let orModels = [];
    if (openrouterClient) {
      try {
        let rc = 0;
        for await (const m of await openrouterClient.models.list()) {
          if (++rc > MAX_MODELS_SCAN) break;
          const shortId = m.id.includes("/") ? m.id.split("/").pop() : m.id;
          if (OPENAI_ALLOW.test(shortId)) {
            orModels.push(m.id);
          }
        }
        orModels.sort();
      } catch (err) {
        console.error("获取 OpenRouter 模型列表失败:", formatProviderError(err));
      }
    }

    res.json([...openaiModels, ...arkModels, ...orModels]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

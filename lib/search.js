// ===== Web Search (Serper.dev) =====
const SERPER_API_KEY = process.env.SERPER_API_KEY || "";
const MAX_TOOL_ROUNDS = 3;

const SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the web using Google. Use this when the user asks about current events, real-time data, prices, news, weather, or anything that requires up-to-date information beyond your training data.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query string",
        },
      },
      required: ["query"],
    },
  },
};

async function executeWebSearch(query) {
  if (!SERPER_API_KEY) {
    return "Search is not configured on the server (missing SERPER_API_KEY).";
  }
  try {
    const resp = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: 5, hl: "zh-cn" }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return `Serper API error (${resp.status}): ${errText.slice(0, 200)}`;
    }
    const json = await resp.json();
    const items = json.organic || [];
    if (items.length === 0) {
      return `No results found for: ${query}`;
    }
    let text = `Search results for "${query}":\n\n`;
    items.forEach((item, i) => {
      text += `${i + 1}. ${item.title}\n   ${item.link}\n   ${item.snippet || ""}\n\n`;
    });
    return text;
  } catch (err) {
    console.error("Serper Search error:", err.message);
    return `Search failed: ${err.message}`;
  }
}

module.exports = {
  SERPER_API_KEY,
  MAX_TOOL_ROUNDS,
  SEARCH_TOOL,
  executeWebSearch,
};

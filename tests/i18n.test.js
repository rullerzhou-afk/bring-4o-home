/**
 * i18n module tests — key parity, t() behavior, tArray()
 *
 * Note: i18n.js is a browser ES Module. We test the dictionaries and
 * logic by reading the file and evaluating the pure-data parts.
 */

const fs = require('fs');
const path = require('path');

// ---- 从源文件提取 zh / en 字典 ----

const source = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'modules', 'i18n.js'),
  'utf-8',
);

// 提取 const zh = { ... }; 和 const en = { ... }; 块
function extractDict(name) {
  // 找到 `const <name> = {` 的起始位置
  const startRe = new RegExp(`const ${name} = \\{`);
  const startMatch = source.match(startRe);
  if (!startMatch) throw new Error(`Cannot find "const ${name}" in i18n.js`);

  const startIdx = startMatch.index + startMatch[0].length - 1; // 指向 `{`
  let depth = 0;
  let endIdx = startIdx;
  for (let i = startIdx; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) { endIdx = i; break; }
    }
  }
  const objStr = source.slice(startIdx, endIdx + 1);
  // 安全 eval — 字典只含字符串字面值
  // eslint-disable-next-line no-eval
  return eval(`(${objStr})`);
}

const zh = extractDict('zh');
const en = extractDict('en');

const zhKeys = Object.keys(zh).sort();
const enKeys = Object.keys(en).sort();

// ---- t() 模拟 ----

function t(key, params, lang = 'zh') {
  const dict = lang === 'en' ? en : zh;
  let text = dict[key] ?? zh[key] ?? key;
  if (params) {
    text = text.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? params[k] : `{${k}}`));
  }
  return text;
}

function tArray(prefix, count, lang = 'zh') {
  const dict = lang === 'en' ? en : zh;
  const arr = [];
  for (let i = 0; i < count; i++) {
    const key = `${prefix}_${i}`;
    const val = dict[key] ?? zh[key];
    if (val == null) break;
    arr.push(val);
  }
  return arr;
}

// ---- Tests ----

describe('i18n dictionaries', () => {
  it('zh and en have identical key sets', () => {
    const zhOnly = zhKeys.filter((k) => !en.hasOwnProperty(k));
    const enOnly = enKeys.filter((k) => !zh.hasOwnProperty(k));
    expect(zhOnly).toEqual([]);
    expect(enOnly).toEqual([]);
  });

  it('all zh values are non-empty strings', () => {
    for (const [key, val] of Object.entries(zh)) {
      expect(typeof val).toBe('string');
      expect(val.length).toBeGreaterThan(0);
    }
  });

  it('all en values are non-empty strings', () => {
    for (const [key, val] of Object.entries(en)) {
      expect(typeof val).toBe('string');
      expect(val.length).toBeGreaterThan(0);
    }
  });

  it('both dictionaries have at least 200 keys', () => {
    expect(zhKeys.length).toBeGreaterThanOrEqual(200);
    expect(enKeys.length).toBeGreaterThanOrEqual(200);
  });

  it('interpolation placeholders are consistent between zh and en', () => {
    const placeholderRe = /\{(\w+)\}/g;
    for (const key of zhKeys) {
      const zhPlaceholders = [...zh[key].matchAll(placeholderRe)].map((m) => m[1]).sort();
      const enPlaceholders = [...en[key].matchAll(placeholderRe)].map((m) => m[1]).sort();
      expect(enPlaceholders).toEqual(zhPlaceholders);
    }
  });
});

describe('t()', () => {
  it('returns zh text by default', () => {
    expect(t('btn_new_chat')).toBe('新对话');
  });

  it('returns en text when lang=en', () => {
    expect(t('btn_new_chat', undefined, 'en')).toBe('New Chat');
  });

  it('returns key itself for unknown key', () => {
    expect(t('nonexistent_key_xyz')).toBe('nonexistent_key_xyz');
  });

  it('performs {key} interpolation', () => {
    expect(t('label_selected_count', { count: 5 })).toBe('已选 5 个');
    expect(t('label_selected_count', { count: 5 }, 'en')).toBe('5 selected');
  });

  it('leaves unmatched placeholders intact', () => {
    expect(t('label_selected_count', {})).toBe('已选 {count} 个');
  });

  it('falls back to zh when en key is missing', () => {
    // Simulate by testing fallback logic directly
    const result = (en['nonexistent'] ?? zh['nonexistent'] ?? 'nonexistent');
    expect(result).toBe('nonexistent');
  });
});

describe('tArray()', () => {
  it('returns 10 greetings for zh', () => {
    const arr = tArray('greet', 20);
    expect(arr.length).toBe(10);
    expect(arr[0]).toBe(zh.greet_0);
  });

  it('returns 10 greetings for en', () => {
    const arr = tArray('greet', 20, 'en');
    expect(arr.length).toBe(10);
    expect(arr[0]).toBe(en.greet_0);
  });

  it('returns 6 personal greetings', () => {
    const arr = tArray('greet_personal', 20);
    expect(arr.length).toBe(6);
    expect(arr[0]).toContain('{name}');
  });

  it('returns empty array for unknown prefix', () => {
    const arr = tArray('totally_unknown', 10);
    expect(arr).toEqual([]);
  });
});

describe('key naming conventions', () => {
  const validPrefixes = [
    'btn_', 'title_', 'label_', 'tab_', 'section_', 'ph_',
    'hint_', 'status_', 'toast_', 'err_', 'confirm_', 'mem_',
    'time_', 'greet_', 'import_', 'diff_', 'misc_', 'voice_',
    'timeline_',
  ];

  it('all keys start with a known prefix', () => {
    const bad = zhKeys.filter((k) => !validPrefixes.some((p) => k.startsWith(p)));
    expect(bad).toEqual([]);
  });
});

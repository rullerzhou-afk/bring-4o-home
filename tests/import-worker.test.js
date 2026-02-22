const { readFileSync } = require('fs');
const path = require('path');

// ── Load worker code via new Function (avoids vm cross-context issues) ──

const workerCode = readFileSync(
  path.join(__dirname, '..', 'public', 'import-worker.js'),
  'utf-8'
);

let result;
const postMessageMock = (msg) => {
  result = msg;
};

const factory = new Function(
  'postMessage',
  `var onmessage;\n${workerCode}\nreturn onmessage;`
);
const handler = factory(postMessageMock);

function runWorker(inputData) {
  result = undefined;
  handler({ data: inputData });
  return result;
}

// ── Fixture helpers ─────────────────────────────────────────────

function textMsg(role, text, createTime) {
  return {
    author: { role },
    content: { content_type: 'text', parts: [text] },
    create_time: createTime || 0,
  };
}

function multimodalMsg(role, parts, createTime) {
  return {
    author: { role },
    content: { content_type: 'multimodal_text', parts },
    create_time: createTime || 0,
  };
}

/**
 * Build a minimal ChatGPT-export conversation object.
 * @param {Object} opts
 * @param {string} opts.title
 * @param {Array}  opts.msgs  - Array of message objects (from textMsg/multimodalMsg)
 * @param {number} opts.createTime - Unix timestamp (seconds)
 * @param {boolean} opts.noCurrentNode - Omit current_node so worker must find leaf
 */
function makeConv({ title, msgs, createTime = 1700000000, noCurrentNode = false }) {
  const mapping = {};
  const rootId = 'root';
  mapping[rootId] = {
    id: rootId,
    message: null,
    parent: null,
    children: [],
  };

  let prevId = rootId;
  const nodeIds = [];

  for (let i = 0; i < msgs.length; i++) {
    const nodeId = `node-${i}`;
    nodeIds.push(nodeId);
    mapping[prevId].children = [nodeId];
    mapping[nodeId] = {
      id: nodeId,
      message: { ...msgs[i], create_time: msgs[i].create_time || createTime + i },
      parent: prevId,
      children: [],
    };
    prevId = nodeId;
  }

  const conv = { title: title || 'Test', create_time: createTime, mapping };
  if (!noCurrentNode && nodeIds.length > 0) {
    conv.current_node = nodeIds[nodeIds.length - 1];
  }
  return conv;
}

// ── Tests ───────────────────────────────────────────────────────

describe('import-worker', () => {
  // ── Input format ──────────────────────────────────────────────

  describe('input format', () => {
    it('accepts a direct JSON array', () => {
      const conv = makeConv({
        msgs: [textMsg('user', 'hi'), textMsg('assistant', 'hello')],
      });
      const res = runWorker([conv]);
      expect(res.conversations).toHaveLength(1);
      expect(res.conversations[0].messages).toHaveLength(2);
    });

    it('accepts a stringified JSON array via e.data', () => {
      const conv = makeConv({
        msgs: [textMsg('user', 'hi'), textMsg('assistant', 'hello')],
      });
      const res = runWorker(JSON.stringify([conv]));
      expect(res.conversations).toHaveLength(1);
    });

    it('accepts { json, hasImages } wrapper', () => {
      const conv = makeConv({
        msgs: [textMsg('user', 'hi')],
      });
      const res = runWorker({ json: [conv], hasImages: false });
      expect(res.conversations).toHaveLength(1);
    });

    it('accepts { json: string, hasImages } wrapper', () => {
      const conv = makeConv({
        msgs: [textMsg('user', 'hi')],
      });
      const res = runWorker({ json: JSON.stringify([conv]), hasImages: false });
      expect(res.conversations).toHaveLength(1);
    });

    it('returns error for invalid JSON string', () => {
      const res = runWorker('not valid json {{{');
      expect(res.error).toBeTruthy();
    });

    it('returns error for non-array JSON', () => {
      const res = runWorker({ title: 'not an array' });
      expect(res.error).toContain('JSON 数组');
    });
  });

  // ── Basic parsing ─────────────────────────────────────────────

  describe('basic parsing', () => {
    it('extracts user and assistant messages', () => {
      const conv = makeConv({
        title: 'My Chat',
        msgs: [textMsg('user', 'Hello'), textMsg('assistant', 'Hi there!')],
      });
      const res = runWorker([conv]);
      const c = res.conversations[0];
      expect(c.title).toBe('My Chat');
      expect(c.messages).toEqual([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ]);
      expect(c.messageCount).toBe(2);
    });

    it('parses multiple conversations', () => {
      const c1 = makeConv({
        title: 'A',
        msgs: [textMsg('user', 'a')],
        createTime: 1700000000,
      });
      const c2 = makeConv({
        title: 'B',
        msgs: [textMsg('user', 'b')],
        createTime: 1700000100,
      });
      const res = runWorker([c1, c2]);
      expect(res.conversations).toHaveLength(2);
    });

    it('skips conversations without mapping', () => {
      const res = runWorker([{ title: 'No mapping' }]);
      expect(res.conversations).toHaveLength(0);
    });

    it('skips messages with unsupported roles (system)', () => {
      const conv = makeConv({
        msgs: [
          textMsg('system', 'You are helpful'),
          textMsg('user', 'hi'),
          textMsg('assistant', 'hello'),
        ],
      });
      const res = runWorker([conv]);
      // system message should be skipped
      expect(res.conversations[0].messages).toHaveLength(2);
      expect(res.conversations[0].messages[0].role).toBe('user');
    });

    it('maps tool role to assistant', () => {
      const conv = makeConv({
        msgs: [textMsg('user', 'Draw a cat'), textMsg('tool', 'Generated image')],
      });
      const res = runWorker([conv]);
      expect(res.conversations[0].messages[1].role).toBe('assistant');
    });

    it('skips conversations with zero valid messages', () => {
      const conv = makeConv({
        msgs: [textMsg('system', 'ignored')],
      });
      const res = runWorker([conv]);
      expect(res.conversations).toHaveLength(0);
    });
  });

  // ── Node traversal ────────────────────────────────────────────

  describe('node traversal', () => {
    it('uses current_node when available', () => {
      const conv = makeConv({
        msgs: [textMsg('user', 'hi'), textMsg('assistant', 'hello')],
      });
      const res = runWorker([conv]);
      expect(res.conversations[0].messages).toHaveLength(2);
    });

    it('finds latest leaf when current_node is missing', () => {
      const conv = makeConv({
        msgs: [textMsg('user', 'hi'), textMsg('assistant', 'hello')],
        noCurrentNode: true,
      });
      const res = runWorker([conv]);
      expect(res.conversations[0].messages).toHaveLength(2);
    });

    it('prefers longest message chain when current_node is missing', () => {
      // Build a branching tree manually:
      // root -> A(user) -> B(assistant) -> C(user) -> D(assistant)  [main branch, 4 msgs]
      //                 \-> E(assistant, newer time)                 [short branch, 1 msg]
      const mapping = {
        root: { id: 'root', message: null, parent: null, children: ['A'] },
        A: {
          id: 'A',
          message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['q1'] }, create_time: 100 },
          parent: 'root',
          children: ['B', 'E'],
        },
        B: {
          id: 'B',
          message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['a1'] }, create_time: 101 },
          parent: 'A',
          children: ['C'],
        },
        C: {
          id: 'C',
          message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['q2'] }, create_time: 102 },
          parent: 'B',
          children: ['D'],
        },
        D: {
          id: 'D',
          message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['a2'] }, create_time: 103 },
          parent: 'C',
          children: [],
        },
        E: {
          id: 'E',
          message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['regen'] }, create_time: 999 },
          parent: 'A',
          children: [],
        },
      };
      const conv = { title: 'Branch Test', create_time: 100, mapping };
      // No current_node → should pick D (longest chain: 4 msgs) over E (newest time but only 2 msgs)
      const res = runWorker([conv]);
      expect(res.conversations[0].messages).toHaveLength(4);
      expect(res.conversations[0].messages[3].content).toBe('a2');
    });

    it('handles circular references without infinite loop', () => {
      // Create a mapping with a cycle
      const mapping = {
        a: {
          id: 'a',
          message: textMsg('user', 'hello'),
          parent: 'b',
          children: [],
        },
        b: {
          id: 'b',
          message: textMsg('assistant', 'world'),
          parent: 'a', // cycle: b → a → b → ...
          children: ['a'],
        },
      };
      const conv = { title: 'Cycle', create_time: 1700000000, mapping, current_node: 'a' };
      // Should not hang
      const res = runWorker([conv]);
      expect(res.conversations).toHaveLength(1);
    });
  });

  // ── Text messages ─────────────────────────────────────────────

  describe('text messages', () => {
    it('joins multiple text parts with newline', () => {
      const msg = {
        author: { role: 'assistant' },
        content: { content_type: 'text', parts: ['Line 1', 'Line 2'] },
      };
      const conv = makeConv({ msgs: [textMsg('user', 'hi'), msg] });
      const res = runWorker([conv]);
      expect(res.conversations[0].messages[1].content).toBe('Line 1\nLine 2');
    });

    it('skips messages with empty text parts', () => {
      const msg = {
        author: { role: 'assistant' },
        content: { content_type: 'text', parts: ['', '  '] },
      };
      const conv = makeConv({ msgs: [textMsg('user', 'hi'), msg] });
      const res = runWorker([conv]);
      // Empty text message should be skipped
      expect(res.conversations[0].messages).toHaveLength(1);
    });

    it('ignores non-string parts in text content', () => {
      const msg = {
        author: { role: 'assistant' },
        content: { content_type: 'text', parts: ['hello', 42, null, 'world'] },
      };
      const conv = makeConv({ msgs: [textMsg('user', 'hi'), msg] });
      const res = runWorker([conv]);
      expect(res.conversations[0].messages[1].content).toBe('hello\nworld');
    });
  });

  // ── Multimodal messages ───────────────────────────────────────

  describe('multimodal messages', () => {
    it('creates image_asset_pointer when hasImages=true', () => {
      const parts = [
        'Check this out',
        { asset_pointer: 'file-service://file-abc123' },
      ];
      const conv = makeConv({
        msgs: [multimodalMsg('user', parts)],
      });
      const res = runWorker({ json: [conv], hasImages: true });
      const content = res.conversations[0].messages[0].content;
      expect(Array.isArray(content)).toBe(true);
      expect(content).toContainEqual({ type: 'text', text: 'Check this out' });
      expect(content).toContainEqual({
        type: 'image_asset_pointer',
        file_id: 'file-abc123',
      });
    });

    it('creates placeholder text when hasImages=false', () => {
      const parts = [{ asset_pointer: 'file-service://file-abc123' }];
      const conv = makeConv({
        msgs: [multimodalMsg('user', parts)],
      });
      const res = runWorker({ json: [conv], hasImages: false });
      const content = res.conversations[0].messages[0].content;
      // All parts are text → merged to string
      expect(typeof content).toBe('string');
      expect(content).toContain('需上传完整导出文件夹');
    });

    it('includes DALL-E prompt in placeholder', () => {
      const parts = [
        {
          asset_pointer: 'file-service://file-dalle',
          metadata: { dalle: { prompt: 'a cute cat' } },
        },
      ];
      const conv = makeConv({
        msgs: [multimodalMsg('tool', parts)],
      });
      const res = runWorker({ json: [conv], hasImages: false });
      const content = res.conversations[0].messages[0].content;
      expect(content).toContain('DALL-E');
      expect(content).toContain('a cute cat');
    });

    it('handles sediment:// protocol', () => {
      const parts = [{ asset_pointer: 'sediment://file-sed456' }];
      const conv = makeConv({
        msgs: [multimodalMsg('user', parts)],
      });
      const res = runWorker({ json: [conv], hasImages: true });
      const content = res.conversations[0].messages[0].content;
      expect(content).toContainEqual({
        type: 'image_asset_pointer',
        file_id: 'file-sed456',
      });
    });

    it('merges all-text multimodal parts into a string', () => {
      const parts = ['Hello', 'World'];
      const conv = makeConv({
        msgs: [multimodalMsg('user', parts)],
      });
      const res = runWorker([conv]);
      expect(res.conversations[0].messages[0].content).toBe('Hello\nWorld');
    });

    it('skips multimodal messages with zero valid parts', () => {
      const parts = ['', '  '];
      const conv = makeConv({
        msgs: [multimodalMsg('user', parts)],
      });
      const res = runWorker([conv]);
      expect(res.conversations).toHaveLength(0);
    });
  });

  // ── imageFileIds ──────────────────────────────────────────────

  describe('imageFileIds', () => {
    it('collects unique image file IDs', () => {
      const parts = [
        { asset_pointer: 'file-service://file-a' },
        { asset_pointer: 'file-service://file-b' },
        { asset_pointer: 'file-service://file-a' }, // duplicate
      ];
      const conv = makeConv({
        msgs: [multimodalMsg('user', parts)],
      });
      const res = runWorker({ json: [conv], hasImages: true });
      expect(res.conversations[0].imageFileIds).toEqual(['file-a', 'file-b']);
    });
  });

  // ── ID generation ─────────────────────────────────────────────

  describe('ID generation', () => {
    it('generates ID from create_time timestamp', () => {
      const conv = makeConv({
        msgs: [textMsg('user', 'hi')],
        createTime: 1700000000,
      });
      const res = runWorker([conv]);
      // Math.round(1700000000 * 1000) = 1700000000000 → "1700000000000" (13 digits)
      expect(res.conversations[0].id).toBe('1700000000000');
    });

    it('pads short IDs to at least 10 digits', () => {
      const conv = makeConv({
        msgs: [textMsg('user', 'hi')],
        createTime: 1000, // 1000 * 1000 = 1000000 → "1000000" (7 digits)
      });
      const res = runWorker([conv]);
      expect(res.conversations[0].id).toBe('0001000000');
      expect(res.conversations[0].id.length).toBe(10);
    });

    it('truncates IDs longer than 16 digits', () => {
      const conv = makeConv({
        msgs: [textMsg('user', 'hi')],
        createTime: 99999999999999, // very large timestamp
      });
      const res = runWorker([conv]);
      expect(res.conversations[0].id.length).toBeLessThanOrEqual(16);
    });

    it('increments duplicate IDs', () => {
      const c1 = makeConv({
        msgs: [textMsg('user', 'a')],
        createTime: 1700000000,
      });
      const c2 = makeConv({
        msgs: [textMsg('user', 'b')],
        createTime: 1700000000, // same timestamp → same ID
      });
      const res = runWorker([c1, c2]);
      const ids = res.conversations.map((c) => c.id);
      expect(new Set(ids).size).toBe(2); // all unique
    });
  });

  // ── Sorting ───────────────────────────────────────────────────

  describe('sorting', () => {
    it('sorts conversations by createTime descending', () => {
      const c1 = makeConv({
        title: 'Old',
        msgs: [textMsg('user', 'a')],
        createTime: 1700000000,
      });
      const c2 = makeConv({
        title: 'New',
        msgs: [textMsg('user', 'b')],
        createTime: 1700001000,
      });
      const res = runWorker([c1, c2]);
      expect(res.conversations[0].title).toBe('New');
      expect(res.conversations[1].title).toBe('Old');
    });
  });

  // ── Title handling ────────────────────────────────────────────

  describe('title handling', () => {
    it('uses conversation title', () => {
      const conv = makeConv({
        title: 'My Chat',
        msgs: [textMsg('user', 'hi')],
      });
      const res = runWorker([conv]);
      expect(res.conversations[0].title).toBe('My Chat');
    });

    it('defaults to "未命名对话" when title is missing', () => {
      const conv = makeConv({ msgs: [textMsg('user', 'hi')] });
      delete conv.title;
      const res = runWorker([conv]);
      expect(res.conversations[0].title).toBe('未命名对话');
    });

    it('truncates long titles to 200 characters', () => {
      const conv = makeConv({
        title: 'x'.repeat(300),
        msgs: [textMsg('user', 'hi')],
      });
      const res = runWorker([conv]);
      expect(res.conversations[0].title.length).toBe(200);
    });
  });
});

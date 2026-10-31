import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearOpenCodeApiCache,
  createSSEParser,
  fetchOpenCodeModels,
  flattenOpenCodeModels,
  getOpenCodePermissionPattern,
  normalizeOpenCodeBaseUrl,
  parseOpenCodeModel,
  resetOpenCodeConversation,
  streamFromOpenCode,
  testOpenCodeConnection
} from '../js/features/ai/opencode.js';
import { getAISettings, saveAISettings } from '../js/features/ai/core.js';

const SETTINGS = { baseUrl: 'http://127.0.0.1:4096', username: 'opencode', password: '' };

const API = {
  v1: {
    events: '/event',
    createSession: '/session',
    session: id => `/session/${id}`,
    abort: id => `/session/${id}/abort`,
    prompt: id => `/session/${id}/prompt_async`,
    permissionReply: (id, permissionId) => `/permission/${permissionId}/reply`,
    sessionBody: id => JSON.stringify({ id })
  },
  v2: {
    events: '/api/event',
    createSession: '/api/session',
    session: id => `/api/session/${id}`,
    abort: id => `/api/session/${id}/interrupt`,
    model: id => `/api/session/${id}/model`,
    prompt: id => `/api/session/${id}/prompt`,
    permissionReply: (id, permissionId) => `/api/session/${id}/permission/${permissionId}/reply`,
    sessionBody: id => JSON.stringify({ data: { id } })
  }
};

function promptEvents(version, sessionId, mode) {
  if (version === 'v1') {
    if (mode === 'closed-stream') {
      return [{ type: 'session.status', properties: { sessionID: sessionId, status: { type: 'busy' } } }];
    }
    if (mode === 'permission') {
      return [{ type: 'permission.asked', properties: { id: 'permission-1', sessionID: sessionId, permission: 'bash' } }];
    }
    if (mode === 'failed') {
      return [{ type: 'session.error', properties: { sessionID: sessionId, error: { data: { message: 'Model unavailable' } } } }];
    }
    return [
      { type: 'session.status', properties: { sessionID: sessionId, status: { type: 'busy' } } },
      { type: 'message.updated', properties: { info: { id: 'message-1', sessionID: sessionId, role: 'assistant' } } },
      { type: 'message.part.updated', properties: { part: { id: 'part-1', messageID: 'message-1', sessionID: sessionId, type: 'text', text: '' } } },
      { type: 'message.part.delta', properties: { sessionID: sessionId, partID: 'part-1', field: 'text', delta: 'hello' } },
      { type: 'session.status', properties: { sessionID: sessionId, status: { type: 'idle' } } }
    ];
  }

  const started = { type: 'session.execution.started', data: { sessionID: sessionId } };
  if (mode === 'closed-stream') return [started];
  if (mode === 'permission') {
    return [started, { type: 'permission.asked', data: { id: 'permission-1', sessionID: sessionId, action: 'bash', resources: ['ls'] } }];
  }
  if (mode === 'failed') {
    return [started, { type: 'session.execution.failed', data: { sessionID: sessionId, error: { type: 'provider.no-route', message: 'Model unavailable' } } }];
  }
  return [
    // Noise from another session must be ignored.
    { type: 'session.text.delta', data: { sessionID: 'other', assistantMessageID: 'message-9', ordinal: 0, delta: 'nope' } },
    started,
    { type: 'session.text.started', data: { sessionID: sessionId, assistantMessageID: 'message-1', ordinal: 0 } },
    { type: 'session.text.delta', data: { sessionID: sessionId, assistantMessageID: 'message-1', ordinal: 0, delta: 'hel' } },
    { type: 'session.text.delta', data: { sessionID: sessionId, assistantMessageID: 'message-1', ordinal: 0, delta: 'lo' } },
    { type: 'session.text.ended', data: { sessionID: sessionId, assistantMessageID: 'message-1', ordinal: 0, text: 'hello' } },
    { type: 'session.execution.succeeded', data: { sessionID: sessionId } }
  ];
}

// The client keeps one shared port; disconnect the previous mock so each test gets a fresh connection.
let disconnectActivePort = null;

function createMockPort(version, overrides = {}) {
  disconnectActivePort?.();
  const paths = API[version];
  const state = {
    sent: [],
    mode: 'success',
    sessionCounter: 0,
    currentSessionId: null,
    pendingSessionRequest: null,
    pendingDeleteRequests: [],
    streamRequestId: null,
    onMessage: null
  };
  const respond = (message, body) => state.onMessage({ type: 'opencode-response', requestId: message.requestId, body });
  const fail = (message, error, status) => state.onMessage({ type: 'opencode-error', requestId: message.requestId, error, status });
  const emit = events => events.forEach(event => state.onMessage({
    type: 'opencode-stream-chunk',
    requestId: state.streamRequestId,
    chunk: `data: ${JSON.stringify(event)}\n\n`
  }));

  const port = {
    onMessage: { addListener: listener => { state.onMessage = listener; } },
    onDisconnect: { addListener: listener => { disconnectActivePort = listener; } },
    postMessage(message) {
      state.sent.push(message);
      if (message.type !== 'opencode-request') return;
      const { path, method } = message;

      if (overrides[path]) {
        overrides[path](message, { respond, fail });
      } else if (path === '/api/info') {
        if (version === 'v2') respond(message, JSON.stringify({ version: '2.2.5' }));
        else fail(message, '404 Not Found', 404);
      } else if (path === '/global/health') {
        // 2.x serves its web UI for any non-API path.
        if (version === 'v2') respond(message, '<!doctype html><html></html>');
        else respond(message, JSON.stringify({ healthy: true, version: '1.0.0' }));
      } else if (path === '/api/model') {
        respond(message, JSON.stringify({ data: [{ id: 'big-pickle', providerID: 'opencode', name: 'Big Pickle', type: 'chat' }] }));
      } else if (path === '/api/provider') {
        respond(message, JSON.stringify({ data: [{ id: 'opencode', name: 'OpenCode Zen' }] }));
      } else if (path === '/config/providers') {
        respond(message, JSON.stringify({ providers: [{ id: 'opencode', name: 'OpenCode Zen', models: { pickle: { id: 'big-pickle', name: 'Big Pickle' } } }] }));
      } else if (path === paths.createSession && method === 'POST') {
        state.currentSessionId = `session-${++state.sessionCounter}`;
        if (state.mode === 'delayed-session') {
          state.pendingSessionRequest = message;
          return;
        }
        respond(message, paths.sessionBody(state.currentSessionId));
      } else if (path === paths.events) {
        state.streamRequestId = message.requestId;
        state.onMessage({ type: 'opencode-stream-start', requestId: message.requestId });
      } else if (path === paths.prompt(state.currentSessionId)) {
        respond(message, '');
        queueMicrotask(() => {
          emit(promptEvents(version, state.currentSessionId, state.mode));
          if (state.mode === 'closed-stream') {
            state.onMessage({ type: 'opencode-stream-done', requestId: state.streamRequestId });
          }
        });
      } else if (method === 'DELETE' && state.mode === 'delayed-delete') {
        state.pendingDeleteRequests.push(message);
      } else {
        respond(message, 'true');
      }
    }
  };
  vi.stubGlobal('chrome', { runtime: { connect: () => port, lastError: undefined } });
  return { state, paths };
}

describe('OpenCode provider', () => {
  beforeEach(() => {
    const values = new Map();
    vi.stubGlobal('localStorage', {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value))
    });
    clearOpenCodeApiCache();
  });

  it('normalizes supported loopback URLs', () => {
    expect(normalizeOpenCodeBaseUrl('http://127.0.0.1:4096/')).toBe('http://127.0.0.1:4096');
    expect(normalizeOpenCodeBaseUrl('https://localhost:4443')).toBe('https://localhost:4443');
  });

  it('rejects remote hosts and URL paths', () => {
    expect(() => normalizeOpenCodeBaseUrl('https://example.com')).toThrow(/localhost/);
    expect(() => normalizeOpenCodeBaseUrl('http://localhost:4096/api')).toThrow(/without a path/);
    expect(() => normalizeOpenCodeBaseUrl('http://user:pass@localhost:4096')).toThrow(/credentials/);
  });

  it('builds a least-specific localhost permission that covers custom ports', () => {
    expect(getOpenCodePermissionPattern('http://127.0.0.1:4096')).toBe('http://127.0.0.1/*');
  });

  it('keeps slashes inside OpenCode model IDs', () => {
    expect(parseOpenCodeModel('openrouter/vendor/model')).toEqual({
      providerID: 'openrouter',
      modelID: 'vendor/model'
    });
  });

  it('returns models only from connected providers', () => {
    const models = flattenOpenCodeModels({
      connected: ['anthropic'],
      all: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            sonnet: { id: 'claude-sonnet', name: 'Claude Sonnet' }
          }
        },
        {
          id: 'gemini',
          name: 'Google',
          models: {
            flash: { id: 'gemini-flash', name: 'Gemini Flash' }
          }
        }
      ]
    });

    expect(models).toEqual([
      { id: 'anthropic/claude-sonnet', label: 'Anthropic - Claude Sonnet' }
    ]);
    expect(flattenOpenCodeModels({ connected: [], all: [{ id: 'anthropic', models: { sonnet: { id: 'sonnet' } } }] })).toEqual([]);
    expect(flattenOpenCodeModels({
      providers: [{ id: 'opencode', name: 'OpenCode Zen', models: { pickle: { id: 'big-pickle', name: 'Big Pickle' } } }]
    })).toEqual([{ id: 'opencode/big-pickle', label: 'OpenCode Zen - Big Pickle' }]);
  });

  it('flattens the OpenCode 2.x model list with provider names', () => {
    const models = flattenOpenCodeModels(
      {
        data: [
          { id: 'gpt-6.1-terra', providerID: 'openai', name: 'GPT-6.1 Terra', type: 'chat' },
          { id: 'claude-sonnet', providerID: 'anthropic', name: 'Claude Sonnet', type: 'chat' },
          { id: 'embed', providerID: 'openai', name: 'Embedding', type: 'embedding' }
        ]
      },
      { data: [{ id: 'openai', name: 'OpenAI' }] }
    );

    expect(models).toEqual([
      { id: 'anthropic/claude-sonnet', label: 'anthropic - Claude Sonnet' },
      { id: 'openai/gpt-6.1-terra', label: 'OpenAI - GPT-6.1 Terra' }
    ]);
  });

  it('parses fragmented SSE events', () => {
    const events = [];
    const parser = createSSEParser(event => events.push(event));

    parser.feed('data: {"type":"message.part.');
    parser.feed('updated","properties":{"part":{"text":"hello"}}}\r\n');
    parser.feed('\r\ndata: {"type":"session.idle","properties":{"sessionID":"abc"}}\n\n');
    parser.feed('data: {"type":"message.part.delta","properties":{"partID":"part-1","field":"text","delta":"!"}}\n\n');

    expect(events).toEqual([
      { type: 'message.part.updated', properties: { part: { text: 'hello' } } },
      { type: 'session.idle', properties: { sessionID: 'abc' } },
      { type: 'message.part.delta', properties: { partID: 'part-1', field: 'text', delta: '!' } }
    ]);
  });

  it('round-trips OpenCode settings', () => {
    saveAISettings('opencode', 'http://127.0.0.1:4096', 'anthropic/claude-sonnet', {
      username: 'rep-user',
      password: 'secret'
    });

    expect(getAISettings()).toEqual({
      provider: 'opencode',
      apiKey: 'http://127.0.0.1:4096',
      baseUrl: 'http://127.0.0.1:4096',
      username: 'rep-user',
      password: 'secret',
      model: 'anthropic/claude-sonnet'
    });
  });

  it('explains web-page responses instead of dumping a JSON parse error', async () => {
    const html = (message, { respond }) => respond(message, '<!doctype html><html><body>OpenCode</body></html>');
    createMockPort('v1', { '/api/info': html, '/global/health': html });

    await expect(testOpenCodeConnection(SETTINGS)).rejects.toThrow(/web page instead of JSON/);
  });

  it('surfaces authentication failures without probing the legacy API', async () => {
    const { state } = createMockPort('v2', {
      '/api/info': (message, { fail }) => fail(message, 'Authentication required. OpenCode rejected the username or password.', 401)
    });

    await expect(testOpenCodeConnection(SETTINGS)).rejects.toThrow(/Authentication required/);
    expect(state.sent.some(message => message.path === '/global/health')).toBe(false);
  });

  describe.each(['v1', 'v2'])('%s API', version => {
    it('detects the API version once and loads models through it', async () => {
      const { state, paths } = createMockPort(version);

      const [health, models] = await Promise.all([
        testOpenCodeConnection(SETTINGS),
        fetchOpenCodeModels(SETTINGS)
      ]);

      expect(health).toEqual({ healthy: true, version: version === 'v2' ? '2.2.5' : '1.0.0', api: version });
      expect(models).toEqual([{ id: 'opencode/big-pickle', label: 'OpenCode Zen - Big Pickle' }]);
      expect(state.sent.filter(message => message.path === '/api/info')).toHaveLength(1);
      expect(state.sent.some(message => message.path === '/global/health')).toBe(version === 'v1');
      expect(state.sent.some(message => message.path === paths.events)).toBe(false);
    });

    it('creates, streams, and deletes a tool-disabled temporary session', async () => {
      const { state, paths } = createMockPort(version);
      const sent = state.sent;

      const updates = [];
      const result = await streamFromOpenCode(SETTINGS, 'opencode/big-pickle', 'system', 'prompt', text => updates.push(text));

      expect(result).toBe('hello');
      expect(updates).toContain('hello');
      const createRequest = sent.find(message => message.path === paths.createSession);
      const promptRequest = sent.find(message => message.path === paths.prompt('session-1'));
      if (version === 'v2') {
        expect(createRequest.body.permissions).toEqual([{ action: '*', resource: '*', effect: 'deny' }]);
        expect(sent.find(message => message.path === paths.model('session-1')).body).toEqual({
          model: { providerID: 'opencode', id: 'big-pickle' }
        });
        expect(promptRequest.body).toEqual({ text: 'system\n\n---\n\nprompt' });
      } else {
        expect(createRequest.body.permission).toEqual([{ permission: '*', pattern: '*', action: 'deny' }]);
        expect(promptRequest.body.tools).toEqual({ '*': false });
        expect(promptRequest.body.system).toBe('system');
      }
      expect(sent.some(message => message.path === paths.session('session-1') && message.method === 'DELETE')).toBe(true);
      expect(sent.some(message => message.type === 'opencode-track-session' && message.apiVersion === version)).toBe(true);

      state.mode = 'closed-stream';
      await expect(streamFromOpenCode(SETTINGS, 'opencode/big-pickle', 'system', 'prompt', vi.fn()))
        .rejects.toThrow(/closed the event stream/);

      state.mode = 'failed';
      await expect(streamFromOpenCode(SETTINGS, 'opencode/big-pickle', 'system', 'prompt', vi.fn()))
        .rejects.toThrow(/Model unavailable/);

      state.mode = 'permission';
      await expect(streamFromOpenCode(SETTINGS, 'opencode/big-pickle', 'system', 'prompt', vi.fn()))
        .rejects.toThrow(/"bash" permission/);
      const reply = sent.find(message => message.path === paths.permissionReply(state.currentSessionId, 'permission-1'));
      expect(reply?.body).toEqual(version === 'v2' ? { decision: 'reject' } : { reply: 'reject' });
      expect(sent.some(message => message.path === paths.abort(state.currentSessionId))).toBe(true);
    });

    it('validates, resets, and cancels persistent conversation sessions', async () => {
      const { state, paths } = createMockPort(version);
      const sent = state.sent;

      state.mode = 'delayed-session';
      const conversationKey = {};
      const pendingStream = streamFromOpenCode(SETTINGS, 'opencode/big-pickle', 'system', 'prompt', vi.fn(), { conversationKey });
      await vi.waitFor(() => expect(state.pendingSessionRequest).not.toBeNull());
      await resetOpenCodeConversation(conversationKey);
      state.onMessage({
        type: 'opencode-response',
        requestId: state.pendingSessionRequest.requestId,
        body: paths.sessionBody(state.currentSessionId)
      });

      await expect(pendingStream).rejects.toThrow(/creation was cancelled/);
      expect(sent.some(message => message.path === paths.prompt(state.currentSessionId))).toBe(false);
      expect(sent.some(message => message.path === paths.session(state.currentSessionId) && message.method === 'DELETE')).toBe(true);

      state.mode = 'success';
      const validationKey = {};
      await streamFromOpenCode(SETTINGS, 'opencode/big-pickle', 'system', 'prompt', vi.fn(), { conversationKey: validationKey });
      state.mode = 'closed-stream';
      await expect(streamFromOpenCode(SETTINGS, 'opencode/big-pickle', 'system', 'prompt', vi.fn(), { conversationKey: validationKey }))
        .rejects.toThrow(/closed the event stream/);

      state.mode = 'delayed-delete';
      const validationStream = streamFromOpenCode(SETTINGS, 'opencode/big-pickle', 'system', 'prompt', vi.fn(), { conversationKey: validationKey });
      await vi.waitFor(() => expect(state.pendingDeleteRequests).toHaveLength(1));
      const reset = resetOpenCodeConversation(validationKey);
      await vi.waitFor(() => expect(state.pendingDeleteRequests).toHaveLength(2));
      state.pendingDeleteRequests.forEach(message => state.onMessage({
        type: 'opencode-response',
        requestId: message.requestId,
        body: 'true'
      }));

      await reset;
      await expect(validationStream).rejects.toThrow(/validation was cancelled/);

      state.mode = 'success';
      const connectionChangeKey = {};
      await streamFromOpenCode(SETTINGS, 'opencode/big-pickle', 'system', 'prompt', vi.fn(), { conversationKey: connectionChangeKey });
      state.pendingDeleteRequests.length = 0;
      state.mode = 'delayed-delete';
      const controller = new AbortController();
      const sessionCountBeforeReset = state.sessionCounter;
      const replacementStream = streamFromOpenCode(
        { ...SETTINGS, password: 'changed' },
        'opencode/big-pickle',
        'system',
        'prompt',
        vi.fn(),
        { conversationKey: connectionChangeKey, signal: controller.signal }
      );
      await vi.waitFor(() => expect(state.pendingDeleteRequests).toHaveLength(1));
      controller.abort();
      state.onMessage({
        type: 'opencode-response',
        requestId: state.pendingDeleteRequests[0].requestId,
        body: 'true'
      });

      await expect(replacementStream).rejects.toThrow(/request was cancelled/);
      expect(state.sessionCounter).toBe(sessionCountBeforeReset);
    });
  });
});

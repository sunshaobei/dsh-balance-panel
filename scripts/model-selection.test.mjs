import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

function store(provider, model) {
  let value = { current: { provider, model } };
  const listeners = new Set();
  return {
    getSnapshot: () => value,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    select(provider, model) { value = { current: provider ? { provider, model } : null }; listeners.forEach(fn => fn()); },
    listeners,
  };
}

function harness(rows) {
  let entry, registration, index = 0, unsubscribe;
  const data = Object.fromEntries(rows.map(row => [row.id, { view: { kind: 'info', text: row.label } }]));
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState(initial) {
      const i = index++;
      return [i === 0 ? { rows } : i === 1 ? data : typeof initial === 'function' ? initial() : initial, () => {}];
    },
    useEffect() {}, useRef: () => ({ current: null }), useCallback: fn => fn,
    useSyncExternalStore(subscribe, snapshot) {
      unsubscribe?.();
      unsubscribe = subscribe(() => {});
      return snapshot();
    },
  };
  runInNewContext(code, {
    window: { __ModuleLoader__: { load: value => { entry = value; } } },
    document: { createElement: () => ({ dataset: {} }), head: { append() {} } },
  });
  const directories = { active: store('openai-codex', 'gpt-6.1'), background: store('zai-coding-cn', 'glm-5') };
  const ctx = {
    effect: fn => fn(), locale: { register() {}, bind: () => key => key },
    inject: (_deps, fn) => fn(ctx),
    modelDirectories: { directoryFor: id => ({ store: directories[id] }) },
    slots: { inject: (_name, fn) => fn(), register: (options, render) => { registration = { options, render }; } },
  };
  entry.factory(name => { assert.equal(name, 'react'); return React; }).apply(ctx);
  return {
    directories,
    render(id = 'active') {
      index = 0;
      const injected = registration.options.inject(id);
      const element = registration.render(injected);
      return JSON.stringify(element.type(element.props));
    },
  };
}

const rows = [
  { id: 'deepseek', label: 'DeepSeek quota', kind: 'info' },
  { id: 'zai-coding-cn', label: 'GLM quota', kind: 'info' },
  { id: 'chatgpt', label: 'GPT quota', kind: 'info' },
];

test('composer uses its session store, follows switches, and unsubscribes old sessions', () => {
  const h = harness(rows);
  assert.match(h.render(), /GPT quota/);
  h.directories.background.select('deepseek', 'deepseek-chat');
  assert.match(h.render(), /GPT quota/);
  h.directories.active.select('zai-coding-cn', 'glm-5');
  assert.match(h.render(), /GLM quota/);
  h.directories.active.select('openai-codex', 'gpt-6.1');
  assert.match(h.render(), /GPT quota/);
  assert.match(h.render('background'), /DeepSeek quota/);
  assert.equal(h.directories.active.listeners.size, 0);
  assert.equal(h.directories.background.listeners.size, 1);
  h.directories.background.select(null);
  assert.doesNotMatch(h.render('background'), /DeepSeek quota|GLM quota|GPT quota/);
});

test('unknown providers and missing GPT quota never fall back to GLM or DeepSeek', () => {
  const h = harness(rows.slice(0, 2));
  assert.doesNotMatch(h.render(), /GLM quota|DeepSeek quota/);
  h.directories.active.select('custom', 'gpt-6.1');
  assert.doesNotMatch(h.render(), /GLM quota|DeepSeek quota/);
});

test('provider identity wins over hosted model family and usage rank', () => {
  const h = harness([...rows, { id: 'openrouter', label: 'Router quota', kind: 'info' }]);
  h.directories.active.select('openrouter', 'deepseek/deepseek-chat');
  assert.match(h.render(), /Router quota/);
  assert.doesNotMatch(h.render(), /DeepSeek quota/);
});

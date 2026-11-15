import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as core from '../extension/core.js';
import * as pages from '../extension/page-actions.js';
import { createVideoCommandHandler, connectVideos } from '../extension/video-store.js';

const html = await readFile(new URL('../extension/panel.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../extension/panel.js', import.meta.url), 'utf8');
export const notebookId = '12345678-1234-1234-1234-123456789abc';
export const notebookUrl = `https://notebook.google.com/notebook/${notebookId}`;
export const video = (id, title = `Video ${id}`) => ({ url: `https://www.youtube.com/watch?v=${String(id).padStart(11, '0')}`, title });
export const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.children = []; this.listeners = new Map(); this.dataset = {}; this.attributes = {}; this.className = ''; this.value = ''; this.hidden = false; this._disabled = false; this._text = '';
    this.classList = { toggle: (name, enabled) => { const names = new Set(this.className.split(' ').filter(Boolean)); if (enabled) names.add(name); else names.delete(name); this.className = [...names].join(' '); } };
  }
  set disabled(value) { this._disabled = Boolean(value); if (value && this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  get disabled() { return this._disabled; }
  set textContent(value) { this._text = String(value); this.replaceChildren(); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  append(...children) { children.forEach(child => { child.parent = this; this.children.push(child); }); }
  prepend(child) { child.parent = this; this.children.unshift(child); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  replaceChildren(...children) { if (this.children.some(child => child.contains(this.ownerDocument.activeElement))) this.ownerDocument.activeElement = this.ownerDocument.body; this.children.forEach(child => { child.parent = null; }); this.children = []; this.append(...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  fire(type) { for (const listener of this.listeners.get(type) || []) Promise.resolve(listener({ target: this })).catch(error => this.ownerDocument.errors.push(error)); }
  click() { if (!this.disabled) this.fire('click'); }
  focus() { if (!this.disabled) this.ownerDocument.activeElement = this; }
}

function createDocument() {
  const document = { errors: [], elements: new Map(), createElement: tag => new Element(tag, document), getElementById: id => document.elements.get(id) };
  document.body = document.createElement('body'); document.activeElement = document.body;
  for (const [, tag, attributes, id, rest] of html.matchAll(/<(\w+)([^>]*?)\bid="([^"]+)"([^>]*)>/g)) {
    const element = document.createElement(tag); element.id = id; element.hidden = /\bhidden\b/.test(attributes + rest); document.elements.set(id, element); document.body.append(element);
  }
  document.getElementById('video-limit').value = '30';
  document.querySelectorAll = selector => {
    if (selector !== '.item input') throw new Error(`Unsupported selector ${selector}`);
    const found = [];
    const visit = element => { if (element.tagName === 'INPUT' && element.parent?.className.split(' ').includes('item')) found.push(element); element.children.forEach(visit); };
    visit(document.body); return found;
  };
  return document;
}

export function backend(initial = {}) {
  let stored = structuredClone(initial); const listeners = new Set();
  const storage = {
    get: async () => structuredClone(stored),
    set: async values => { const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { newValue: structuredClone(value) }])); stored = { ...stored, ...structuredClone(values) }; listeners.forEach(fn => fn(changes, 'local')); },
  };
  const handler = createVideoCommandHandler(storage);
  return { handler, listeners, storage, read: () => structuredClone(stored) };
}

export async function panel(options = {}) {
  const document = createDocument(), shared = options.shared || backend(options.initial);
  let now = Date.now(), timerId = 0; const timers = new Map();
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const f = { document, shared, calls: [], clipboard: '', tabs: options.tabs || [{ id: 20, active: true, url: notebookUrl, title: 'Notebook', windowId: 1 }], sourceCount: options.sourceCount ?? 2, omissions: options.omissions || [], script: null, queryHook: null, runtimeHook: null, created: [], errors: document.errors };
  const listeners = { activated: new Set(), updated: new Set(), removed: new Set() };
  const event = set => ({ addListener: fn => set.add(fn), removeListener: fn => set.delete(fn) });
  const chrome = {
    runtime: { id: 'fixture', sendMessage: async message => f.runtimeHook ? f.runtimeHook(message.command, shared.handler) : shared.handler(message.command) },
    storage: { local: shared.storage, onChanged: event(shared.listeners) },
    tabs: {
      query: async query => { if (f.queryHook) await f.queryHook(query); return structuredClone(f.tabs.filter(tab => (!query.currentWindow || (tab.windowId || 1) === 1) && (!query.active || tab.active))); },
      update: async (id, changes) => { f.tabs.forEach(tab => { tab.active = tab.id === id; }); const tab = f.tabs.find(tab => tab.id === id); Object.assign(tab, changes); listeners.activated.forEach(fn => fn({ tabId: id })); return tab; },
      create: async ({ url }) => { f.created.push(url); },
      onActivated: event(listeners.activated), onUpdated: event(listeners.updated), onRemoved: event(listeners.removed),
    },
    scripting: { executeScript: async request => {
      const call = { tabId: request.target.tabId, name: request.func.name, ...request.args[0] }; f.calls.push(call);
      const result = f.script ? await f.script(call) : f.defaultResult(call); return [{ result }];
    } },
  };
  f.defaultResult = call => {
    if (call.name === 'collectYouTube') return { videos: [video(1)], label: '검색 결과', single: true };
    if (call.operation === 'text') return { text: `Text ${call.sourceId}` };
    const tab = f.tabs.find(tab => tab.id === call.tabId), url = new URL(tab.url);
    const id = url.pathname.split('/').at(-1), urlAuthuser = url.searchParams.get('authuser') || '';
    return { notebook: { id, title: tab.title, url: tab.url, context: { origin: url.origin, notebookId: id, authuser: urlAuthuser || '0', urlAuthuser } }, sources: Array.from({ length: f.sourceCount }, (_, index) => ({ id: `s${index}`, title: `Source ${index}`, kind: '문서', url: '', channel: '' })), reportedCount: f.sourceCount + f.omissions.length, omissions: f.omissions };
  };
  const context = vm.createContext({ ...core, ...pages, connectVideos, document, chrome: options.readonly ? undefined : chrome, navigator: { clipboard: { writeText: async text => { f.clipboard = text; } } }, URL, Blob, Date: ClockDate, console, structuredClone,
    setTimeout: (fn, delay) => { const timer = { id: ++timerId, unref() {} }; timers.set(timer, { fn, at: now + delay }); return timer; }, clearTimeout: timer => timers.delete(timer), addEventListener() {},
  });
  f.get = id => document.getElementById(id);
  f.flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); if (f.errors.length) throw f.errors[0]; };
  f.click = async id => { f.get(id).click(); await f.flush(); };
  f.change = async (id, value, event = 'change') => { const element = typeof id === 'string' ? f.get(id) : id; if (typeof value === 'boolean') element.checked = value; else element.value = value; element.fire(event); await f.flush(); };
  f.advance = async ms => { now += ms; for (const [timer, value] of [...timers]) if (value.at <= now) { timers.delete(timer); value.fn(); } await f.flush(); };
  f.refresh = async () => { listeners.updated.forEach(fn => fn(0, { status: 'complete' })); await f.flush(); };
  vm.runInContext(script.replace(/^import .+;\r?\n/gm, ''), context, { filename: 'extension/panel.js' }); await f.flush();
  return f;
}

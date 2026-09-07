// Session lifecycle regressions. Run with: node --test tests/test_frontend.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../static/app.js"), "utf8");

class Element {
  constructor() {
    this.className = "";
    this.textContent = "";
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.handlers = {};
    this.selectors = {};
    this.disabled = false;
    this.open = false;
    this.options = [];
    this.classList = {
      contains: (name) => this.className.split(" ").includes(name),
      add: (...names) => names.forEach((name) => this.classList.toggle(name, true)),
      remove: (...names) => names.forEach((name) => this.classList.toggle(name, false)),
      toggle: (name, value) => {
        const names = new Set(this.className.split(" ").filter(Boolean));
        const include = value === undefined ? !names.has(name) : value;
        if (include) names.add(name); else names.delete(name);
        this.className = [...names].join(" ");
      },
    };
  }
  append(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children.flatMap((child) => child.fragment ? child.children : [child]); }
  querySelector(selector) { return this.selectors[selector] ||= new Element(); }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(event, handler) { (this.handlers[event] ||= []).push(handler); }
  emit(event, payload = {}) { for (const handler of this.handlers[event] || []) handler(payload); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  get firstElementChild() { return this.children[0]; }
  get lastElementChild() { return this.children.at(-1); }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function response(payload) { return { ok: true, json: async () => payload }; }
function session(id = "session-one") {
  return {
    session_id: id, n_level: 2, rounds: 5, interval_ms: 1500,
    trials: [0, 1, 0, 2, 0].map((position, index) => ({ position, letter: index % 2 ? "R" : "C" })),
  };
}
function result() {
  return { accuracy: 85, visual: { hits: 2, targets: 2 }, audio: { hits: 2, targets: 3 }, false_alarms: 0, recommendation: { n_level: 3, message: "Next level" } };
}

function harness({ audio = true, storage = null } = {}) {
  const nodes = new Map();
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id);
  };
  for (const [id, value, options] of [["n-level", "2", [1, 2, 3, 4, 5]], ["rounds", "20", [12, 20, 30, 40]], ["pace", "2500", [3000, 2500, 1900]]]) {
    get(id).value = value;
    get(id).options = options.map((option) => ({ value: String(option) }));
  }
  get("volume").value = "80";
  get("start-button").append(new Element());
  get("connection-status").append(new Element());
  const document = new Element();
  document.body = new Element();
  document.hidden = false;
  document.getElementById = get;
  document.querySelectorAll = () => Array.from({ length: 9 }, () => new Element());
  document.querySelector = () => get("sound-card");
  document.createElement = () => new Element();
  document.createDocumentFragment = () => Object.assign(new Element(), { fragment: true });
  const window = new Element();
  const timers = new Map();
  let now = 0;
  let nextTimer = 0;
  const addTimer = (fn, delay, interval = false) => {
    const id = ++nextTimer;
    timers.set(id, { fn, at: now + delay, interval: interval ? delay : null });
    return id;
  };
  window.setTimeout = (fn, delay) => addTimer(fn, delay);
  window.setInterval = (fn, delay) => addTimer(fn, delay, true);
  window.clearTimeout = window.clearInterval = (id) => timers.delete(id);
  const spoken = [];
  if (audio) {
    window.SpeechSynthesisUtterance = class { constructor(value) { this.text = value; } };
    window.speechSynthesis = { cancel() {}, speak(utterance) { spoken.push(utterance); } };
  }
  const requests = [];
  const localStorage = {
    getItem() { return storage; },
    setItem(_key, value) { storage = value; },
  };
  const context = vm.createContext({
    window, document, navigator: {}, localStorage, performance: { now: () => now },
    fetch: (url, options) => {
      if (url === "/api/health") return Promise.resolve(response({ status: "ready" }));
      if (url.startsWith("/api/history")) return Promise.resolve(response({ results: [] }));
      const request = { url, options, ...deferred() };
      requests.push(request);
      return request.promise;
    },
  });
  vm.runInContext(source, context);
  const run = (script) => vm.runInContext(script, context);
  return {
    get, document, window, spoken, requests, run,
    get state() { return run("state"); },
    advance(milliseconds) {
      const end = now + milliseconds;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next;
        now = timer.at;
        if (timer.interval === null) timers.delete(id); else timer.at += timer.interval;
        timer.fn();
      }
      now = end;
    },
  };
}

async function flush() { for (let index = 0; index < 8; index += 1) await Promise.resolve(); }
async function start(h, id) {
  const pending = h.run("startSession()");
  h.requests.at(-1).resolve(response(session(id)));
  await pending;
  h.advance(2100);
}

test("reset during session creation cannot revive an abandoned run", async () => {
  const h = harness();
  const pending = h.run("startSession()");
  h.run("resetSession()");
  h.requests[0].resolve(response(session()));
  await pending;
  h.advance(15000);
  assert.equal(h.state.status, "idle");
  assert.equal(h.state.session, null);
  assert.equal(h.spoken.length, 0);
  assert.equal(h.get("start-button").disabled, false);
  assert.equal(h.get("stage-message").querySelector("strong").textContent, "Ready when you are");
});

test("out-of-order creation responses preserve the newer session", async () => {
  const h = harness();
  const old = h.run("startSession()");
  h.run("resetSession()");
  const current = h.run("startSession()");
  h.requests[1].resolve(response(session("newer")));
  await current;
  h.requests[0].resolve(response(session("older")));
  await old;
  assert.equal(h.state.session.session_id, "newer");
  assert.equal(h.state.status, "countdown");
});

test("stale completion cannot unlock controls or open results in a new run", async () => {
  const h = harness();
  await start(h, "older");
  const completion = h.run("finishSession()");
  const oldRequest = h.requests.at(-1);
  h.run("resetSession()");
  const newer = h.run("startSession()");
  oldRequest.resolve(response(result()));
  await completion;
  assert.equal(h.state.status, "loading");
  assert.equal(h.get("start-button").disabled, true);
  assert.equal(h.get("results-dialog").open, false);
  assert.equal(h.state.recommendation, null);
  h.requests.at(-1).resolve(response(session("newer")));
  await newer;
});

test("pause freezes responses and resumes the same remaining window without replay", async () => {
  const h = harness();
  await start(h);
  h.advance(3300); // Trial 3, 300ms into its 1500ms response window.
  h.run("registerResponse('visual')");
  h.run("pauseSession()");
  const remaining = h.state.remaining;
  const played = h.spoken.length;
  assert.equal(remaining, 1200);
  h.run("registerResponse('audio')");
  h.advance(90000);
  assert.equal(h.state.currentIndex, 2);
  assert.equal(h.state.audioResponses.size, 0);
  assert.equal(h.get("visual-feedback").textContent, "Marked");
  h.run("resumeSession()");
  assert.equal(h.spoken.length, played);
  assert.equal(h.get("visual-feedback").textContent, "Marked");
  h.advance(remaining - 1);
  assert.equal(h.state.currentIndex, 2);
  h.advance(1);
  assert.equal(h.state.currentIndex, 3);
  assert.equal(h.spoken.length, played + 1);
  assert.equal(h.get("visual-feedback").textContent, "A");
});

test("hidden tabs pause during countdown and require an explicit resume", async () => {
  const h = harness();
  const pending = h.run("startSession()");
  h.requests[0].resolve(response(session()));
  await pending;
  h.advance(200);
  h.document.hidden = true;
  h.document.emit("visibilitychange");
  h.advance(90000);
  assert.equal(h.state.status, "paused");
  assert.equal(h.state.currentIndex, -1);
  h.document.hidden = false;
  h.document.emit("visibilitychange");
  assert.equal(h.state.status, "paused");
  h.run("resumeSession()");
  h.advance(1900);
  assert.equal(h.state.currentIndex, 0);
});

test("audio failures pause the timer and tell the player what happened", async () => {
  const h = harness();
  await start(h);
  h.spoken.at(-1).onerror({ error: "not-allowed" });
  h.advance(10000);
  assert.equal(h.state.status, "paused");
  assert.equal(h.state.currentIndex, 0);
  assert.match(h.get("toast").textContent, /could not play/);
  assert.equal(h.get("sound-state").textContent, "Audio needs attention");
});

test("unsupported audio prevents a visual-only session from starting", async () => {
  const h = harness({ audio: false });
  await h.run("startSession()");
  assert.equal(h.state.status, "idle");
  assert.equal(h.requests.length, 0);
  assert.match(h.get("toast").textContent, /spoken letters/);
});

test("a complete session submits both channels once and displays the saved result", async () => {
  const h = harness();
  await start(h);
  h.run("registerResponse('visual')"); // Warm-up responses must be ignored.
  h.advance(3000);
  h.run("registerResponse('visual'); registerResponse('visual'); registerResponse('audio')");
  h.advance(4500);
  assert.equal(h.state.status, "submitting");
  assert.equal(h.requests.length, 2);
  assert.deepEqual(JSON.parse(h.requests[1].options.body), { visual_responses: [2], audio_responses: [2] });
  h.requests[1].resolve(response(result()));
  await flush();
  assert.equal(h.state.status, "finished");
  assert.equal(h.get("results-dialog").open, true);
  assert.equal(h.get("result-accuracy").textContent, "85%");
  assert.equal(h.get("time-remaining").textContent, "00:00");
  assert.equal(h.get("start-button").disabled, false);
  assert.equal(h.document.body.classList.contains("session-active"), false);
});

test("reset clears response marks and all active timers", async () => {
  const h = harness();
  await start(h);
  h.advance(3000);
  h.run("registerResponse('visual'); registerResponse('audio'); resetSession()");
  h.advance(90000);
  assert.equal(h.state.currentIndex, -1);
  assert.equal(h.get("visual-feedback").textContent, "A");
  assert.equal(h.get("audio-feedback").textContent, "L");
  assert.equal(h.get("visual-match").attributes["aria-pressed"], "false");
  assert.equal(h.get("trial-current").textContent, "0");
  assert.equal(h.document.body.classList.contains("session-active"), false);
  await flush();
});

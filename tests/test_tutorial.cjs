// Guided-example regressions. Run with: node --test tests/test_tutorial.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const read = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
const html = read("main.html");
const tutorialSource = read("static/tutorial.js");

class Element {
  constructor(tag = "div") {
    Object.assign(this, { tagName: tag.toUpperCase(), attributes: {}, handlers: {}, children: [],
      selectors: {}, style: {}, dataset: {}, className: "", textContent: "", hidden: false,
      disabled: false, open: false, tabIndex: -1 });
    this.classList = {
      contains: (name) => this.className.split(" ").includes(name),
      add: (...names) => names.forEach((name) => this.classList.toggle(name, true)),
      remove: (...names) => names.forEach((name) => this.classList.toggle(name, false)),
      toggle: (name, force) => {
        const names = new Set(this.className.split(" ").filter(Boolean));
        const include = force === undefined ? !names.has(name) : force;
        if (include) names.add(name); else names.delete(name);
        this.className = [...names].join(" ");
      },
    };
  }
  append(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children.flatMap((child) => child.fragment ? child.children : [child]); }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, callback) { (this.handlers[type] ||= []).push(callback); }
  emit(type, event = {}) { for (const callback of this.handlers[type] || []) callback(event); }
  querySelector(selector) { return this.selectors[selector] ||= new Element(); }
  focus() { this.ownerDocument.activeElement = this; }
  closest() { return this.inHelp && this.ownerDocument.getElementById("help-dialog").open ? this.ownerDocument.getElementById("help-dialog") : null; }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit("close"); }
  get firstElementChild() { return this.children[0]; }
  get lastElementChild() { return this.children.at(-1); }
}

function harness({ audio = true, withApp = false } = {}) {
  const document = new Element("document");
  const nodes = new Map();
  const helpStart = html.indexOf('<dialog class="help-dialog"');
  const helpEnd = html.indexOf("</dialog>", helpStart);
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const node = new Element(match[1]);
    node.ownerDocument = document;
    node.inHelp = match.index >= helpStart && match.index < helpEnd;
    for (const attribute of match[0].matchAll(/([\w-]+)="([^"]*)"/g)) node.setAttribute(attribute[1], attribute[2]);
    node.className = node.attributes.class || "";
    node.hidden = /\shidden(?:\s|>)/.test(match[0]);
    node.disabled = /\sdisabled(?:\s|>)/.test(match[0]);
    node.tabIndex = Number(node.attributes.tabindex ?? -1);
    nodes.set(match[2], node);
  }
  const get = (id) => {
    assert.ok(nodes.has(id), `Missing element #${id} in main.html`);
    return nodes.get(id);
  };
  document.getElementById = get;
  document.body = new Element("body");
  document.createElement = (tag) => Object.assign(new Element(tag), { ownerDocument: document });
  document.createDocumentFragment = () => Object.assign(new Element(), { fragment: true });
  document.querySelectorAll = () => Array.from({ length: 9 }, () => new Element());
  document.querySelector = () => new Element();
  get("volume").value = "80";
  const window = new Element("window");
  const spoken = [];
  let cancelCount = 0;
  if (audio) {
    window.SpeechSynthesisUtterance = class { constructor(letter) { this.text = letter; } };
    window.speechSynthesis = { speak: (utterance) => spoken.push(utterance), cancel: () => { cancelCount += 1; } };
  }
  const timers = new Map();
  let nextTimer = 0;
  window.setTimeout = window.setInterval = (callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, { callback, delay });
    return id;
  };
  window.clearTimeout = window.clearInterval = (id) => timers.delete(id);
  const requests = [];
  const context = vm.createContext({ document, window, navigator: {}, performance: { now: () => 300 },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: async (url, options) => {
      requests.push({ url, options });
      assert.ok(["/api/health", "/api/history?limit=6"].includes(url), "The tutorial must never create or save a session");
      return { ok: true, json: async () => ({ status: "ready", results: [] }) };
    },
  });
  const run = (source) => vm.runInContext(source, context);
  if (withApp) {
    for (const [id, value, options] of [["n-level", "2", Array.from({ length: 20 }, (_, index) => index + 1)], ["rounds", "20", [12, 20, 30, 40]], ["pace", "2500", [3000, 2500, 1900]]]) {
      Object.assign(get(id), { value, options: options.map((option) => ({ value: String(option) })) });
    }
    get("start-button").append(new Element());
    get("connection-status").append(new Element());
    run(read("static/app.js"));
  } else {
    get("help-button").addEventListener("click", () => get("help-dialog").showModal());
    get("close-help").addEventListener("click", () => get("help-dialog").close());
  }
  run(tutorialSource);
  function key(id, key, overrides = {}) {
    const target = get(id);
    const event = { target, key, repeat: false, ctrlKey: false, metaKey: false, altKey: false,
      defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...overrides };
    target.emit("keydown", event);
    if (target.inHelp && target !== get("help-dialog")) get("help-dialog").emit("keydown", event);
    window.emit("keydown", event);
    return event;
  }
  const click = (id) => { if (!get(id).disabled) get(id).emit("click"); };
  const openExample = () => { click("help-button"); click("example-tab"); };
  return { get, click, key, run, document, window, spoken, requests, timers, openExample,
    get cancelCount() { return cancelCount; } };
}

function assertTab(h, index) {
  for (const [tabIndex, name] of ["rules", "example"].entries()) {
    const tab = h.get(`${name}-tab`);
    const panel = h.get(`${name}-panel`);
    assert.equal(tab.attributes.role, "tab");
    assert.equal(tab.attributes["aria-controls"], `${name}-panel`);
    assert.equal(panel.attributes.role, "tabpanel");
    assert.equal(panel.attributes["aria-labelledby"], `${name}-tab`);
    assert.equal(tab.attributes["aria-selected"], String(tabIndex === index));
    assert.equal(tab.tabIndex, tabIndex === index ? 0 : -1);
    assert.equal(panel.hidden, tabIndex !== index);
  }
}

test("help tabs expose one selected panel with click, arrow, Home, and End navigation", () => {
  const h = harness();
  assertTab(h, 0);
  h.click("help-button");
  h.click("example-tab");
  assertTab(h, 1);
  assert.equal(h.key("example-tab", "ArrowRight").defaultPrevented, true);
  assertTab(h, 0);
  assert.equal(h.document.activeElement, h.get("rules-tab"));
  h.key("rules-tab", "ArrowLeft");
  assertTab(h, 1);
  h.key("example-tab", "Home");
  assertTab(h, 0);
  h.key("rules-tab", "End");
  assertTab(h, 1);
  h.click("rules-tab");
  h.click("show-example");
  assertTab(h, 1);
  assert.equal(h.document.activeElement, h.get("example-tab"));
});

test("three cues reveal progressively, compare two back, and reset answers when stepping", () => {
  const h = harness();
  h.openExample();
  const letters = () => h.get("demo-sequence").children.map((card) => card.children[2].textContent);
  assert.deepEqual(letters(), ["C", "—", "—"]);
  assert.equal(h.get("demo-back").disabled, true);
  assert.equal(h.get("demo-answers").hidden, true);
  h.click("demo-next");
  assert.deepEqual(letters(), ["C", "R", "—"]);
  assert.equal(h.get("demo-step-count").textContent, "2 / 3");
  h.click("demo-next");
  assert.deepEqual(letters(), ["C", "R", "C"]);
  const cards = h.get("demo-sequence").children;
  assert.deepEqual(cards.map((card) => card.classList.contains("compared")), [true, false, true]);
  assert.deepEqual(cards.map((card) => card.children[1].children.findIndex((cell) => cell.className === "lit")), [0, 4, 0]);
  assert.equal(h.get("demo-comparison").hidden, false);
  assert.equal(h.get("demo-answers").hidden, false);
  assert.match(h.get("demo-explanation").textContent, /compare with cue 1, two cues ago/);
  h.click("demo-visual");
  h.click("demo-back");
  assert.equal(h.get("demo-step-count").textContent, "2 / 3");
  assert.equal(h.get("demo-visual").attributes["aria-pressed"], "false");
  assert.equal(h.get("demo-feedback").textContent, "");
  assert.equal(h.get("demo-comparison").hidden, true);
  h.click("demo-next");
  h.click("demo-next");
  assert.equal(h.get("demo-step-count").textContent, "1 / 3");
  assert.deepEqual(letters(), ["C", "—", "—"]);
  h.click("demo-next");
  h.click("close-help");
  h.click("help-button");
  assertTab(h, 0);
  assert.equal(h.get("demo-step-count").textContent, "1 / 3");
});

test("A and L explain independent matches and ignore early, hidden, repeated, or modified input", () => {
  const h = harness();
  h.openExample();
  h.key("demo-next", "a");
  assert.equal(h.get("demo-feedback").textContent, "");
  h.click("demo-next");
  h.click("demo-next");
  h.key("demo-next", "a", { repeat: true });
  h.key("demo-next", "a", { ctrlKey: true });
  assert.equal(h.get("demo-visual").attributes["aria-pressed"], "false");
  h.click("rules-tab");
  h.key("rules-tab", "a");
  assert.equal(h.get("demo-feedback").textContent, "");
  h.click("example-tab");
  assert.equal(h.key("demo-next", "A").defaultPrevented, true);
  assert.equal(h.get("demo-visual").attributes["aria-pressed"], "true");
  assert.equal(h.get("demo-audio").attributes["aria-pressed"], "false");
  assert.match(h.get("demo-feedback").textContent, /position repeats.*try L/);
  h.key("demo-next", "L");
  assert.equal(h.get("demo-audio").attributes["aria-pressed"], "true");
  assert.match(h.get("demo-feedback").textContent, /A \+ L is correct/);
  const finalFeedback = h.get("demo-feedback").textContent;
  h.key("demo-next", "a");
  assert.equal(h.get("demo-feedback").textContent, finalFeedback);
  h.click("demo-back");
  h.click("demo-next");
  h.click("demo-audio");
  assert.match(h.get("demo-feedback").textContent, /letter repeats.*try A/);
  h.click("demo-visual");
  assert.match(h.get("demo-feedback").textContent, /A \+ L is correct/);
});

test("tutorial actions and bubbled keyboard events leave an open training session and backend untouched", async () => {
  const h = harness({ withApp: true });
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  h.run(`state.status = "running";
    state.session = { session_id: "existing", n_level: 2, rounds: 20, interval_ms: 2500,
      trials: [{ position: 0, letter: "C" }, { position: 4, letter: "R" }, { position: 0, letter: "C" }] };
    state.currentIndex = 2; state.deadline = 1800; state.phase = "trial";
    state.visualResponses.add(2); state.recommendation = { n_level: 3 };`);
  h.openExample();
  assert.equal(h.run("state.status"), "paused");
  const snapshot = () => h.run("JSON.stringify({ ...state, visualResponses: [...state.visualResponses], audioResponses: [...state.audioResponses] })");
  const before = snapshot();
  const requestsBefore = h.requests.length;
  const timerCount = h.timers.size;
  h.click("demo-next");
  h.click("demo-listen");
  h.click("demo-next");
  h.key("demo-next", "a");
  h.key("demo-next", "l");
  h.click("demo-back");
  h.click("demo-next");
  h.click("demo-audio");
  h.click("demo-visual");
  h.click("close-help");
  assert.equal(snapshot(), before);
  assert.equal(h.requests.length, requestsBefore);
  assert.equal(h.timers.size, timerCount);
});

test("closing instructions or changing tabs only cancels audio owned by the demo", () => {
  const h = harness();
  h.openExample();
  assert.equal(h.cancelCount, 0);
  h.window.speechSynthesis.speak(new h.window.SpeechSynthesisUtterance("Training sound"));
  h.click("close-help");
  assert.equal(h.cancelCount, 0);
  h.openExample();
  h.click("demo-listen");
  assert.equal(h.spoken.at(-1).text, "C");
  assert.equal(h.spoken.at(-1).volume, 0.8);
  h.click("close-help");
  assert.equal(h.cancelCount, 1);
  h.openExample();
  h.click("demo-listen");
  const oldUtterance = h.spoken.at(-1);
  h.click("demo-next");
  assert.equal(h.cancelCount, 2);
  h.click("demo-listen");
  assert.equal(h.spoken.at(-1).text, "R");
  oldUtterance.onend(); // A stale callback must not release ownership of newer demo speech.
  h.click("rules-tab");
  assert.equal(h.cancelCount, 3);
  h.click("example-tab");
  h.click("demo-listen");
  h.spoken.at(-1).onend();
  h.click("close-help");
  assert.equal(h.cancelCount, 3);
});

test("missing or failed speech provides the letter and leaves the example usable", () => {
  const missing = harness({ audio: false });
  missing.openExample();
  missing.click("demo-listen");
  assert.match(missing.get("demo-feedback").textContent, /spoken letter is C/);
  missing.click("demo-next");
  assert.equal(missing.get("demo-step-count").textContent, "2 / 3");
  const failed = harness();
  failed.openExample();
  failed.click("demo-listen");
  failed.spoken.at(-1).onerror({ error: "audio-busy" });
  assert.match(failed.get("demo-feedback").textContent, /letter is C.*continue the example/);
  failed.click("close-help");
  assert.equal(failed.cancelCount, 0);
});

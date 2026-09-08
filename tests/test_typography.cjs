// Sentence punctuation regressions. Run with: node --test tests/test_typography.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const read = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");

function harness(build, { readyState = "complete" } = {}) {
  const observers = [];
  function notify(target, type) {
    for (const observer of observers) {
      if (!observer.root || !observer.options[type]) continue;
      if (target !== observer.root && !(observer.options.subtree && observer.root.contains(target))) continue;
      observer.pending.push({ target, type });
    }
  }
  class Node {
    static ELEMENT_NODE = 1;
    static TEXT_NODE = 3;
    constructor(nodeType) { this.nodeType = nodeType; this.parentNode = null; this.childNodes = []; }
    get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
    get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
    get textContent() { return this.childNodes.map((node) => node.textContent).join(""); }
    set textContent(value) {
      for (const child of this.childNodes) child.parentNode = null;
      this.childNodes = [];
      if (String(value)) this.append(new Text(String(value)));
      notify(this, "childList");
    }
    get firstChild() { return this.childNodes[0] || null; }
    get nextSibling() {
      return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null;
    }
    contains(node) { return this === node || this.childNodes.some((child) => child.contains(node)); }
    append(...nodes) {
      for (let node of nodes) {
        if (typeof node === "string") node = new Text(node);
        if (node.nodeType === 11) { this.append(...node.childNodes.slice()); continue; }
        if (node.parentNode) node.parentNode.childNodes.splice(node.parentNode.childNodes.indexOf(node), 1);
        node.parentNode = this;
        this.childNodes.push(node);
      }
      notify(this, "childList");
    }
    appendChild(node) { this.append(node); return node; }
    replaceWith(...nodes) {
      if (!this.parentNode) return;
      const parent = this.parentNode;
      const replacement = nodes.flatMap((node) => node.nodeType === 11 ? node.childNodes.slice() : [node]);
      const index = parent.childNodes.indexOf(this);
      parent.childNodes.splice(index, 1, ...replacement);
      for (const node of replacement) node.parentNode = parent;
      this.parentNode = null;
      notify(parent, "childList");
    }
  }
  class Text extends Node {
    constructor(value) { super(3); this._data = value; }
    get data() { return this._data; }
    set data(value) { this._data = String(value); notify(this, "characterData"); }
    get nodeValue() { return this.data; }
    set nodeValue(value) { this.data = value; }
    get textContent() { return this.data; }
    set textContent(value) { this.data = value; }
  }
  class Element extends Node {
    constructor(tag) {
      super(1);
      this.tagName = tag.toUpperCase();
      this.attributes = {};
      this.handlers = {};
      this.className = "";
      this.id = "";
      this.classList = { contains: (name) => this.className.split(/\s+/).includes(name),
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(" "); } };
    }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === "class") this.className = String(value);
      if (name === "id") this.id = String(value);
    }
    getAttribute(name) { return name === "class" ? this.className : name === "id" ? this.id : this.attributes[name] ?? null; }
    hasAttribute(name) { return name in this.attributes; }
    matches(selector) {
      return selector.split(",").some((entry) => {
        const part = entry.trim();
        if (part.startsWith(".")) return this.classList.contains(part.slice(1));
        if (part.startsWith("#")) return this.id === part.slice(1);
        if (/^\[[\w-]+\]$/.test(part)) return this.hasAttribute(part.slice(1, -1));
        return this.tagName.toLowerCase() === part.toLowerCase();
      });
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    querySelectorAll(selector) {
      return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, handler) { (this.handlers[type] ||= []).push(handler); }
    emit(type) { for (const handler of this.handlers[type] || []) handler({ target: this }); }
  }
  const document = new Element("document");
  document.readyState = readyState;
  document.body = new Element("body");
  document.documentElement = new Element("html");
  document.append(document.documentElement);
  document.documentElement.append(document.body);
  document.createElement = (tag) => new Element(tag);
  document.createTextNode = (value) => new Text(value);
  document.createDocumentFragment = () => new Node(11);
  document.createTreeWalker = (root) => {
    const texts = [];
    const visit = (node) => { if (node.nodeType === 3) texts.push(node); else node.childNodes.forEach(visit); };
    visit(root);
    let index = 0;
    return { nextNode: () => texts[index++] || null };
  };
  const el = (tag, ...children) => { const element = document.createElement(tag); element.append(...children); return element; };
  const refs = build({ document, el });
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.pending = []; this.root = null; this.observeCount = 0; observers.push(this); }
    observe(root, options) { this.root = root; this.options = options; this.observeCount += 1; }
    disconnect() { this.root = null; this.pending = []; }
  }
  const context = vm.createContext({ document, Node, NodeFilter: { SHOW_TEXT: 4 }, MutationObserver,
    window: { MutationObserver } });
  vm.runInContext(read("static/typography.js"), context);
  const initialize = () => { document.readyState = "interactive"; document.emit("DOMContentLoaded"); };
  const flush = () => {
    let rounds = 0;
    while (observers.some((observer) => observer.pending.length)) {
      assert.ok(++rounds <= 5, "The decorator must not trigger an endless MutationObserver loop");
      for (const observer of observers) {
        if (!observer.pending.length) continue;
        const records = observer.pending.splice(0);
        observer.callback(records, observer);
      }
    }
  };
  return { document, el, refs, observers, initialize, flush,
    periods: (root = document) => root.querySelectorAll(".sentence-period") };
}

test("sentence periods receive styling without rewriting the prose", () => {
  const h = harness(({ document, el }) => {
    const paragraph = el("p", "Look back two cues. Press the matching key. Wait if neither matches.");
    document.body.append(paragraph);
    return { paragraph, original: paragraph.textContent };
  });
  assert.equal(h.refs.paragraph.textContent, h.refs.original);
  assert.equal(h.periods().length, 3);
  assert.ok(h.periods().every((node) => node.textContent === "."));
});

test("inline emphasis and keyboard elements are kept intact", () => {
  const h = harness(({ document, el }) => {
    const keyA = el("kbd", "A");
    const keyL = el("kbd", "L");
    const emphasis = el("strong", "two cues back");
    const paragraph = el("p", "Compare with ", emphasis, ". Press ", keyA, " for position. Press ", keyL, " for sound.");
    document.body.append(paragraph);
    return { paragraph, emphasis, keyA, keyL, original: paragraph.textContent };
  });
  assert.equal(h.refs.paragraph.textContent, h.refs.original);
  assert.equal(h.refs.paragraph.querySelector("strong"), h.refs.emphasis);
  assert.equal(h.refs.paragraph.querySelectorAll("kbd")[0], h.refs.keyA);
  assert.equal(h.refs.paragraph.querySelectorAll("kbd")[1], h.refs.keyL);
  assert.equal(h.periods().length, 3);
});

test("links, controls, code, SVG, editable content and already styled punctuation are excluded", () => {
  const h = harness(({ document, el }) => {
    const excluded = ["a", "button", "script", "style", "textarea", "input", "select", "option", "code", "pre", "svg"]
      .map((tag) => el(tag, "Keep this untouched."));
    const editable = el("span", "Editable prose.");
    editable.setAttribute("contenteditable", "true");
    excluded.push(editable);
    const titleDot = el("span", ".");
    titleDot.className = "title-dot";
    const existing = el("span", "...");
    existing.className = "sentence-period";
    const paragraph = el("p", ...excluded, " End.", titleDot, existing);
    document.body.append(paragraph);
    return { paragraph, excluded, titleDot, existing, original: paragraph.textContent };
  });
  assert.equal(h.refs.paragraph.textContent, h.refs.original);
  for (const element of h.refs.excluded) assert.equal(h.periods(element).length, 0, `${element.tagName} must stay untouched`);
  assert.equal(h.periods(h.refs.titleDot).length, 0);
  assert.equal(h.periods(h.refs.existing).length, 0);
  assert.equal(h.periods().length, 2);
});

test("email and decimal dots stay intact and non-prose containers are not decorated", () => {
  const h = harness(({ document, el }) => {
    const paragraph = el("p", "Email thomas.w.kolencik@gmail.com and wait 1.5 seconds. Version 2.0 is ready.");
    const counter = el("div", "1.5");
    document.body.append(paragraph, counter);
    return { paragraph, counter, original: paragraph.textContent };
  });
  assert.equal(h.refs.paragraph.textContent, h.refs.original);
  assert.equal(h.periods(h.refs.paragraph).length, 2);
  assert.equal(h.periods(h.refs.counter).length, 0);
});

test("dynamic textContent replacements are decorated once without observer loops", () => {
  const h = harness(({ document, el }) => {
    const paragraph = el("p", "Ready.");
    document.body.append(paragraph);
    return { paragraph };
  });
  assert.equal(h.periods().length, 1);
  h.refs.paragraph.textContent = "Position missed. Sound was correct.";
  h.flush();
  assert.equal(h.refs.paragraph.textContent, "Position missed. Sound was correct.");
  assert.equal(h.periods().length, 2);
  const spans = h.periods();
  h.document.body.append(h.el("div", "Unrelated update"));
  h.flush();
  assert.deepEqual(h.periods(), spans, "Existing punctuation spans should not be replaced or nested");
  assert.ok(h.periods().every((span) => h.periods(span).length === 0));
  assert.ok(h.observers.some((observer) => observer.root && observer.observeCount > 1), "Keep observing after decorating dynamic prose");
});

test("new prose and character-data edits in live feedback are decorated", () => {
  const h = harness(({ document, el }) => {
    const feedback = el("div", "Waiting");
    feedback.className = "stage-message";
    document.body.append(feedback);
    return { feedback };
  });
  h.refs.feedback.firstChild.data = "Right.";
  h.flush();
  assert.equal(h.periods(h.refs.feedback).length, 1);
  const note = h.el("p", "A new note. Another sentence.");
  h.document.body.append(note);
  h.flush();
  assert.equal(h.periods(note).length, 2);
  assert.equal(note.textContent, "A new note. Another sentence.");
});

test("the page loads typography and the requested footer includes an accessible heart", () => {
  const html = read("main.html");
  assert.match(html, /<script\b[^>]*src="\/static\/typography\.js"[^>]*\bdefer\b[^>]*>/);
  assert.match(html, /Made with <span\b[^>]*class="footer-heart"[^>]*role="img"[^>]*aria-label="love"[^>]*>♥<\/span><span\b[^>]*class="sentence-period"[^>]*>\.\.\.<\/span>and HTML and Python\./);
});

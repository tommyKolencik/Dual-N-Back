// Appearance regressions. Run with: node --test tests/test_appearance.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const read = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
const appearanceKey = "nback.appearance.v1";
const trainingKey = "nback.preferences.v1";
const trainingPreferences = JSON.stringify({ n_level: "15", rounds: "40", pace: "3000", volume: 24 });

class Element {
  constructor(tag = "div") {
    Object.assign(this, { tagName: tag.toUpperCase(), attributes: {}, handlers: {}, children: [],
      dataset: {}, className: "", textContent: "", value: "", checked: false, disabled: false,
      open: false, customValidity: "" });
    this.properties = {};
    this.style = {
      setProperty: (name, value) => { this.properties[name] = String(value); },
      getPropertyValue: (name) => this.properties[name] || "",
    };
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
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, callback, options = {}) { (this.handlers[type] ||= []).push({ callback, once: options.once }); }
  emit(type, event = {}) {
    for (const handler of [...(this.handlers[type] || [])]) {
      handler.callback({ target: this, preventDefault() {}, ...event });
      if (handler.once) this.handlers[type] = this.handlers[type].filter((entry) => entry !== handler);
    }
  }
  setCustomValidity(value) { this.customValidity = value; }
  reportValidity() { return !this.customValidity; }
  focus() { this.ownerDocument.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit("close"); }
}

function harness({ stored = null, readBlocked = false, writeBlocked = false, readyState = "loading" } = {}) {
  const html = read("main.html");
  const document = new Element("document");
  const nodes = new Map();
  const allNodes = [];
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*>/g)) {
    const node = new Element(match[1]);
    node.ownerDocument = document;
    for (const attribute of match[0].matchAll(/([\w-]+)="([^"]*)"/g)) {
      node.setAttribute(attribute[1], attribute[2]);
      if (attribute[1].startsWith("data-")) node.dataset[attribute[1].slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = attribute[2];
    }
    node.className = node.attributes.class || "";
    node.value = node.attributes.value || "";
    node.checked = /\schecked(?:\s|>)/.test(match[0]);
    if (node.attributes.id) nodes.set(node.attributes.id, node);
    allNodes.push(node);
  }
  const get = (id) => {
    assert.ok(nodes.has(id), `Missing element #${id} in main.html`);
    return nodes.get(id);
  };
  const beforeDomQueries = [];
  document.readyState = readyState;
  document.documentElement = new Element("html");
  document.documentElement.ownerDocument = document;
  document.getElementById = (id) => {
    if (document.readyState === "loading") { beforeDomQueries.push(id); return null; }
    return nodes.get(id) || null;
  };
  const matches = (node, selector) => selector.startsWith(".")
    ? node.classList.contains(selector.slice(1))
    : selector === 'meta[name="theme-color"]' && node.tagName === "META" && node.attributes.name === "theme-color";
  document.querySelectorAll = (selector) => {
    if (document.readyState === "loading" && !selector.startsWith("meta")) { beforeDomQueries.push(selector); return []; }
    return allNodes.filter((node) => matches(node, selector));
  };
  document.querySelector = (selector) => document.querySelectorAll(selector)[0] || null;
  const entries = new Map([[trainingKey, trainingPreferences]]);
  if (stored !== null) entries.set(appearanceKey, stored);
  const reads = [];
  const writes = [];
  const localStorage = {
    getItem(key) {
      reads.push(key);
      if (readBlocked) throw new Error("Storage access denied");
      return entries.get(key) ?? null;
    },
    setItem(key, value) {
      if (writeBlocked) throw new Error("Storage quota exceeded");
      writes.push({ key, value });
      entries.set(key, value);
    },
    removeItem(key) {
      if (writeBlocked) throw new Error("Storage access denied");
      writes.push({ key, value: null });
      entries.delete(key);
    },
  };
  const window = new Element("window");
  window.localStorage = localStorage;
  const requests = [];
  const context = vm.createContext({ document, window, localStorage,
    fetch: (...args) => { requests.push(args); throw new Error("Appearance must not make network requests"); } });
  vm.runInContext(read("static/appearance.js"), context);
  const initialize = () => { document.readyState = "interactive"; document.emit("DOMContentLoaded"); };
  const click = (id) => get(id).emit("click");
  const input = (id, value, event = "input") => { get(id).value = value; get(id).emit(event); };
  const selectTheme = (theme) => {
    for (const option of ["light", "dark"]) get(`theme-${option}`).checked = option === theme;
    get(`theme-${theme}`).emit("change");
  };
  return { html, document, get, initialize, click, input, selectTheme, entries, reads, writes, requests,
    beforeDomQueries, swatches: allNodes.filter((node) => node.classList.contains("accent-swatch")),
    style: (name) => document.documentElement.style.getPropertyValue(name),
    saved: () => JSON.parse(entries.get(appearanceKey) || "null") };
}

function rgb(value) {
  const hex = /^#([a-f\d]{6})$/i.exec(value);
  if (hex) return hex[1].match(/../g).map((part) => parseInt(part, 16));
  const channels = /^rgba?\(([^)]+)\)$/.exec(value);
  assert.ok(channels, `Unexpected color format: ${value}`);
  return channels[1].split(/[,\s/]+/).filter(Boolean).slice(0, 3).map(Number);
}
function luminance(value) {
  const linear = rgb(value).map((part) => part / 255).map((part) => part <= .04045 ? part / 12.92 : ((part + .055) / 1.055) ** 2.4);
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + .05) / (values[1] + .05);
}

test("saved appearance is applied before CSS and before querying body controls", () => {
  const h = harness({ stored: JSON.stringify({ theme: "dark", accent: "#6478e5" }) });
  const script = h.html.match(/<script\b[^>]*\bsrc="\/static\/appearance\.js"[^>]*>/)?.[0];
  assert.ok(script, "Appearance script must be present in the document head");
  assert.ok(h.html.indexOf(script) < h.html.indexOf('<link rel="stylesheet"'), "Restore theme before loading the stylesheet");
  assert.doesNotMatch(script, /\s(?:defer|async)(?:\s|>)/);
  assert.equal(h.document.documentElement.dataset.theme, "dark");
  assert.equal(h.style("--accent"), "#6478e5");
  assert.deepEqual(h.beforeDomQueries, []);
  assert.equal(h.writes.length, 0, "Restoration should not overwrite saved preferences");
  h.initialize();
  assert.equal(h.get("theme-dark").checked, true);
  assert.equal(h.get("theme-light").checked, false);
  assert.equal(h.get("accent-color").value, "#6478e5");
  assert.equal(h.get("accent-hex").value.toLowerCase(), "#6478e5");
  assert.deepEqual(h.reads, [appearanceKey]);
});

test("theme radios update the palette and persist light/dark preferences", () => {
  const h = harness();
  assert.equal(h.document.documentElement.dataset.theme, "light");
  assert.equal(h.style("--accent"), "#ef754d");
  h.initialize();
  const lightInk = h.style("--accent-ink");
  h.selectTheme("dark");
  assert.equal(h.document.documentElement.dataset.theme, "dark");
  assert.notEqual(h.style("--accent-ink"), lightInk);
  assert.deepEqual(h.saved(), { theme: "dark", accent: "#ef754d" });
  h.selectTheme("light");
  assert.equal(h.document.documentElement.dataset.theme, "light");
  assert.deepEqual(h.saved(), { theme: "light", accent: "#ef754d" });
});

test("native picker and normalized three/six digit hex values update custom accent", () => {
  const h = harness();
  h.initialize();
  h.input("accent-color", "#5b67e8");
  assert.equal(h.style("--accent"), "#5b67e8");
  assert.equal(h.get("accent-hex").value.toLowerCase(), "#5b67e8");
  h.input("accent-hex", "AbC", "change");
  assert.equal(h.style("--accent"), "#aabbcc");
  assert.equal(h.get("accent-color").value, "#aabbcc");
  h.input("accent-hex", "#12ABef", "change");
  assert.equal(h.style("--accent"), "#12abef");
  assert.deepEqual(h.saved(), { theme: "light", accent: "#12abef" });
  assert.equal(h.entries.get(trainingKey), trainingPreferences);
  assert.equal(h.requests.length, 0);
});

test("accent presets expose selection and stay synchronized with custom input", () => {
  const h = harness();
  h.initialize();
  assert.ok(h.swatches.length >= 3, "Offer a useful selection of preset colors");
  for (const swatch of h.swatches) {
    swatch.emit("click");
    assert.equal(h.style("--accent"), swatch.dataset.color.toLowerCase());
    assert.equal(swatch.attributes["aria-pressed"], "true");
    assert.equal(h.swatches.filter((item) => item.attributes["aria-pressed"] === "true").length, 1);
    assert.equal(h.get("accent-color").value, swatch.dataset.color.toLowerCase());
    assert.equal(h.saved().accent, swatch.dataset.color.toLowerCase());
  }
  h.input("accent-color", "#123456");
  assert.equal(h.swatches.some((item) => item.attributes["aria-pressed"] === "true"), false);
});

test("invalid hex input never replaces or persists the active color", () => {
  const h = harness();
  h.initialize();
  h.input("accent-color", "#345678");
  const writes = h.writes.length;
  for (const invalid of ["", "red", "#12", "#12345g", "#12345678", "rgb(0,0,0)", "url(example)"]) {
    h.input("accent-hex", invalid, "change");
    assert.equal(h.style("--accent"), "#345678", invalid);
    assert.equal(h.writes.length, writes, invalid);
  }
  h.input("accent-hex", "#567", "change");
  assert.equal(h.style("--accent"), "#556677");
  assert.equal(h.saved().accent, "#556677");
});

test("appearance dialog opens/closes and reset changes only appearance preferences", () => {
  const h = harness({ stored: JSON.stringify({ theme: "dark", accent: "#00ff88" }) });
  h.initialize();
  h.click("appearance-button");
  assert.equal(h.get("appearance-dialog").open, true);
  h.click("close-appearance");
  assert.equal(h.get("appearance-dialog").open, false);
  h.click("appearance-button");
  h.click("reset-appearance");
  assert.equal(h.document.documentElement.dataset.theme, "light");
  assert.equal(h.style("--accent"), "#ef754d");
  assert.equal(h.get("theme-light").checked, true);
  assert.equal(h.get("accent-color").value, "#ef754d");
  assert.equal(h.entries.get(trainingKey), trainingPreferences);
  assert.ok(h.writes.every(({ key }) => key === appearanceKey));
  assert.equal(h.requests.length, 0);
});

test("corrupt storage and blocked reads/writes still leave functional appearance controls", () => {
  for (const stored of ["not json", "null", "[]", "42", '"dark"', '{"theme":"invalid","accent":"not a color"}']) {
    const h = harness({ stored });
    assert.equal(h.document.documentElement.dataset.theme, "light");
    assert.equal(h.style("--accent"), "#ef754d");
    h.initialize();
    h.selectTheme("dark");
    assert.equal(h.document.documentElement.dataset.theme, "dark");
  }
  for (const option of [{ readBlocked: true }, { writeBlocked: true }, { readBlocked: true, writeBlocked: true }]) {
    const h = harness(option);
    h.initialize();
    h.selectTheme("dark");
    h.input("accent-color", "#000000");
    assert.equal(h.document.documentElement.dataset.theme, "dark");
    assert.equal(h.style("--accent"), "#000000");
    h.click("reset-appearance");
    assert.equal(h.document.documentElement.dataset.theme, "light");
    assert.equal(h.style("--accent"), "#ef754d");
  }
});

test("custom colors preserve readable button text, accent text, and spatial cues in both modes", () => {
  const h = harness();
  h.initialize();
  for (const theme of ["light", "dark"]) {
    h.selectTheme(theme);
    for (const color of ["#ef754d", "#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#242b29", "#faf9f5"]) {
      h.input("accent-color", color);
      for (const name of ["--accent", "--accent-ink", "--accent-on", "--accent-hover", "--accent-soft", "--accent-border", "--accent-field", "--accent-glow"]) {
        assert.ok(h.style(name), `Missing ${name} for ${theme} ${color}`);
      }
      assert.ok(contrast(h.style("--accent-on"), color) >= 4.5, `Button text contrast: ${theme} ${color}`);
      assert.ok(contrast(h.style("--accent-ink"), theme === "light" ? "#faf9f5" : "#242a28") >= 4.5, `Accent text contrast: ${theme} ${color}`);
      assert.ok(contrast(h.style("--accent-field"), "#242b29") >= 4.5, `Spatial cue contrast: ${theme} ${color}`);
    }
  }
});

test("initialization after DOM ready installs controls without waiting for another event", () => {
  const h = harness({ readyState: "complete" });
  h.selectTheme("dark");
  assert.equal(h.document.documentElement.dataset.theme, "dark");
  h.click("appearance-button");
  assert.equal(h.get("appearance-dialog").open, true);
});

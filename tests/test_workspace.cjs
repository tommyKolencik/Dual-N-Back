const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const html = fs.readFileSync(path.join(__dirname, "../main.html"), "utf8");
const source = fs.readFileSync(path.join(__dirname, "../static/workspace.js"), "utf8");

class Element {
  constructor() {
    Object.assign(this, { handlers: {}, attributes: {}, styles: {}, value: "100", textContent: "", hidden: true, open: false, disabled: false });
    this.style = { setProperty: (key, value) => { this.styles[key] = value; } };
    const classes = new Set();
    this.classList = { contains: (name) => classes.has(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name) };
  }
  addEventListener(name, callback) { (this.handlers[name] ||= []).push(callback); }
  async emit(name) { for (const callback of this.handlers[name] || []) await callback({ target: this }); }
  setAttribute(name, value) { this.attributes[name] = value; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() { this.focused = true; }
  select() { this.selected = true; }
}

function harness({ stored = null, clipboard = "works", fullscreen = "works", blocked = false } = {}) {
  const document = new Element();
  const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map((match) => [match[1], new Element()]));
  const get = (id) => { assert.ok(nodes.has(id), `Missing #${id}`); return nodes.get(id); };
  document.getElementById = get;
  document.body = new Element();
  document.fullscreenElement = null;
  document.exitFullscreen = async () => { document.fullscreenElement = null; await document.emit("fullscreenchange"); };
  if (fullscreen !== "missing") get("game-panel").requestFullscreen = async () => {
    if (fullscreen === "rejected") throw new Error("Denied");
    document.fullscreenElement = get("game-panel");
    await document.emit("fullscreenchange");
  };
  const copies = [];
  const navigator = {};
  if (clipboard !== "missing") navigator.clipboard = { writeText: async (value) => {
    if (clipboard === "rejected") throw new Error("Denied");
    copies.push(value);
  } };
  const writes = [];
  const localStorage = {
    getItem: (key) => { assert.equal(key, "nback.view.v1"); if (blocked) throw new Error("Denied"); return stored; },
    setItem: (key, value) => { if (blocked) throw new Error("Denied"); writes.push({ key, value }); },
  };
  vm.runInNewContext(source, { document, navigator, localStorage });
  return { get, document, copies, writes };
}

test("game size restores, clamps, and saves only view preferences", async () => {
  const h = harness({ stored: JSON.stringify({ size: 125 }) });
  assert.equal(h.get("game-size-value").textContent, "125%");
  assert.equal(h.get("game-panel").styles["--board-size"], "400px");
  h.get("game-size").value = "999";
  await h.get("game-size").emit("input");
  assert.equal(h.get("game-size").value, "150");
  assert.deepEqual(h.writes, [{ key: "nback.view.v1", value: '{"size":150}' }]);
  h.get("game-size").value = "-10";
  await h.get("game-size").emit("input");
  assert.equal(h.get("game-size").value, "80");
});

test("invalid or blocked storage leaves the view controls usable", async () => {
  for (const options of [{ stored: "broken" }, { stored: '{"size":"bad"}' }, { blocked: true }]) {
    const h = harness(options);
    assert.equal(h.get("game-size").value, "100");
    h.get("game-size").value = "120";
    await h.get("game-size").emit("input");
    assert.equal(h.get("game-size-value").textContent, "120%");
  }
});

test("expanded layout can be restored without changing saved size", async () => {
  const h = harness();
  await h.get("expand-game").emit("click");
  assert.equal(h.document.body.classList.contains("game-expanded"), true);
  assert.equal(h.get("expand-game").textContent, "Restore layout");
  await h.get("expand-game").emit("click");
  assert.equal(h.document.body.classList.contains("game-expanded"), false);
  assert.equal(h.get("expand-game").attributes["aria-pressed"], "false");
  assert.equal(h.writes.length, 0);
});

test("native full screen targets only the game and follows exit state", async () => {
  const h = harness();
  await h.get("fullscreen-game").emit("click");
  assert.equal(h.document.fullscreenElement, h.get("game-panel"));
  assert.equal(h.get("fullscreen-game").textContent, "Exit full screen");
  assert.equal(h.get("expand-game").disabled, true);
  await h.get("fullscreen-game").emit("click");
  assert.equal(h.document.fullscreenElement, null);
  assert.equal(h.get("fullscreen-game").attributes["aria-pressed"], "false");
  assert.equal(h.get("expand-game").disabled, false);
});

test("unsupported or denied full screen falls back to expanded view with an explanation", async () => {
  for (const fullscreen of ["missing", "rejected"]) {
    const h = harness({ fullscreen });
    await h.get("fullscreen-game").emit("click");
    assert.equal(h.document.body.classList.contains("game-expanded"), true);
    assert.equal(h.get("game-view-message").hidden, false);
    assert.match(h.get("game-view-message").textContent, /Expanded view is ready/);
  }
});

test("email copies the exact address without a mailto navigation", async () => {
  const h = harness();
  await h.get("copy-email").emit("click");
  assert.deepEqual(h.copies, ["thomas.w.kolencik@gmail.com"]);
  assert.equal(h.get("contact-feedback").textContent, "Email copied.");
  assert.equal(h.get("email-copy-fallback").hidden, true);
  assert.doesNotMatch(html, /mailto:/i);
});

test("clipboard failure offers selected, accessible text without claiming success", async () => {
  for (const clipboard of ["missing", "rejected"]) {
    const h = harness({ clipboard });
    await h.get("copy-email").emit("click");
    assert.equal(h.copies.length, 0);
    assert.match(h.get("contact-feedback").textContent, /Clipboard access isn't available/);
    assert.equal(h.get("email-copy-fallback").hidden, false);
    assert.equal(h.get("email-copy-fallback").focused, true);
    assert.equal(h.get("email-copy-fallback").selected, true);
  }
});

test("Motivation opens and closes with the author's story and credited research", async () => {
  const h = harness();
  await h.get("motivation-button").emit("click");
  assert.equal(h.get("motivation-dialog").open, true);
  await h.get("close-motivation").emit("click");
  assert.equal(h.get("motivation-dialog").open, false);
  assert.match(html, /id="motivation-reading"/);
  assert.match(html, /I enjoyed playing it for a while and reached about N = 5/);
  assert.match(html, /All credit goes to the authors/);
  assert.doesNotMatch(html, /Article links will be added here|class="coming-soon"/);
});

test("Motivation contains four attributed academic papers with safe external links and evidence limits", () => {
  const papers = [...html.matchAll(/<li class="research-paper">([\s\S]*?)<\/li>/g)].map((match) => match[1]);
  assert.equal(papers.length, 4);
  const expectedUrls = [
    "https://pmc.ncbi.nlm.nih.gov/articles/PMC2383929/",
    "https://pmc.ncbi.nlm.nih.gov/articles/PMC5805159/",
    "https://www.nature.com/articles/s41598-021-82663-w",
    "https://link.springer.com/article/10.3758/s13423-016-1217-0",
  ];
  papers.forEach((paper, index) => {
    assert.ok(paper.includes(`href="${expectedUrls[index]}"`));
    assert.match(paper, /target="_blank" rel="noopener noreferrer"/);
    assert.match(paper, /opens in a new tab/);
    assert.match(paper, /class="research-authors">[^<]+ and colleagues<\/p>/);
    assert.match(paper, /class="research-meta"/);
  });
  assert.match(html, /Broader benefits for memory or intelligence are less certain/);
  assert.match(html, /These studies did not evaluate this website/);
});

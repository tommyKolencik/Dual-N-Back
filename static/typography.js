// Style punctuation without rewriting wording, links, controls, or live game values.
(() => {
  const prose = "p, h1, h2, h3, li, .site-footer, .history-footnote, .empty-history, #history-summary, #sound-state, .stage-message, .toast";
  const excluded = "script, style, textarea, input, select, option, code, pre, svg, a, button, .sentence-period, .title-dot, [contenteditable]";

  function decorateText(node) {
    const parent = node.parentElement;
    if (!parent?.closest(prose) || parent.closest(excluded)) return;
    const value = node.nodeValue || "";
    const endings = [...value.matchAll(/\.(?=[”’"')\]]*(?:\s|$))/g)]
      .filter((match) => value[match.index - 1] !== "." && value[match.index + 1] !== ".");
    if (!endings.length) return;
    const fragment = document.createDocumentFragment();
    let start = 0;
    for (const match of endings) {
      if (match.index > start) fragment.append(document.createTextNode(value.slice(start, match.index)));
      const period = document.createElement("span");
      period.className = "sentence-period";
      period.textContent = ".";
      fragment.append(period);
      start = match.index + 1;
    }
    if (start < value.length) fragment.append(document.createTextNode(value.slice(start)));
    node.replaceWith(fragment);
  }

  function decorate(scope) {
    if (scope.nodeType === 3) {
      decorateText(scope);
      return;
    }
    if (scope.nodeType !== 1 || scope.closest(excluded)) return;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let next;
    while ((next = walker.nextNode())) nodes.push(next);
    nodes.forEach(decorateText);
  }

  decorate(document.body);
  const options = { childList: true, characterData: true, subtree: true };
  const observer = new MutationObserver((records) => {
    // Do not observe the spans we create, or reprocess punctuation indefinitely.
    observer.disconnect();
    try {
      const scopes = new Set(records.map((record) => record.target));
      for (const scope of scopes) if (scope.isConnected !== false) decorate(scope);
    } finally {
      observer.observe(document.body, options);
    }
  });
  observer.observe(document.body, options);
})();

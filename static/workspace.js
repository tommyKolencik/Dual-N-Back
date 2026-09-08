// Page-only controls. No session creation, scoring, or training preference writes.
(() => {
  const get = (id) => document.getElementById(id);
  const panel = get("game-panel");
  const expand = get("expand-game");
  const fullscreen = get("fullscreen-game");
  const size = get("game-size");
  const sizeValue = get("game-size-value");
  const viewMessage = get("game-view-message");
  const viewKey = "nback.view.v1";
  const email = "thomas.w.kolencik@gmail.com";

  function reportView(message = "") {
    if (!viewMessage) return;
    viewMessage.textContent = message;
    viewMessage.hidden = !message;
  }

  function setExpanded(expanded) {
    document.body.classList.toggle("game-expanded", expanded);
    expand?.setAttribute("aria-pressed", String(expanded));
    if (expand) expand.textContent = expanded ? "Restore layout" : "Expand";
  }

  function resize(persist = false) {
    if (!size || !panel) return;
    const value = Math.max(80, Math.min(150, Math.round((Number(size.value) || 100) / 5) * 5));
    size.value = String(value);
    if (sizeValue) sizeValue.textContent = `${value}%`;
    panel.style.setProperty("--board-size", `${3.2 * value}px`);
    panel.style.setProperty("--board-expanded-size", `${4.2 * value}px`);
    if (persist) {
      try { localStorage.setItem(viewKey, JSON.stringify({ size: value })); }
      catch (_error) { /* Resizing still works when storage is unavailable. */ }
    }
  }

  try {
    const saved = JSON.parse(localStorage.getItem(viewKey) || "null");
    if (size && typeof saved?.size === "number" && Number.isFinite(saved.size)) size.value = String(saved.size);
  } catch (_error) { /* Ignore unavailable or malformed stored settings. */ }
  resize();
  size?.addEventListener("input", () => resize(true));
  expand?.addEventListener("click", () => {
    setExpanded(!document.body.classList.contains("game-expanded"));
    reportView();
  });

  fullscreen?.addEventListener("click", async () => {
    reportView();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (panel?.requestFullscreen) await panel.requestFullscreen();
      else throw new Error("Full screen unavailable");
    } catch (_error) {
      setExpanded(true);
      reportView("Full screen isn't available in this browser. Expanded view is ready instead.");
    }
  });
  document.addEventListener("fullscreenchange", () => {
    const active = document.fullscreenElement === panel;
    fullscreen?.setAttribute("aria-pressed", String(active));
    if (fullscreen) fullscreen.textContent = active ? "Exit full screen" : "Full screen";
    if (expand) expand.disabled = active;
    reportView();
  });

  const motivation = get("motivation-dialog");
  get("motivation-button")?.addEventListener("click", () => {
    if (motivation && !motivation.open) motivation.showModal();
  });
  get("close-motivation")?.addEventListener("click", () => motivation?.close());

  get("copy-email")?.addEventListener("click", async () => {
    const status = get("contact-feedback");
    const fallback = get("email-copy-fallback");
    try {
      await navigator.clipboard.writeText(email);
      if (status) status.textContent = "Email copied.";
      if (fallback) fallback.hidden = true;
    } catch (_error) {
      if (status) status.textContent = "Clipboard access isn't available. Select and copy the email below.";
      if (fallback) {
        fallback.hidden = false;
        fallback.focus();
        fallback.select();
      }
    }
  });
})();

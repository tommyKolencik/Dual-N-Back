// Apply saved colors before the stylesheet paints; bind controls once the DOM exists.
(() => {
  const storageKey = "nback.appearance.v1";
  const defaults = { theme: "light", accent: "#ef754d" };
  const root = document.documentElement;
  let preferences = { ...defaults };
  let storageAvailable = true;

  function normalizeColor(value) {
    if (typeof value !== "string") return null;
    const hex = value.trim().replace(/^#/, "").toLowerCase();
    if (/^[0-9a-f]{6}$/.test(hex)) return `#${hex}`;
    if (/^[0-9a-f]{3}$/.test(hex)) return `#${[...hex].map((digit) => digit + digit).join("")}`;
    return null;
  }

  function channels(hex) {
    return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  }

  function mix(from, to, amount) {
    const target = channels(to);
    return `#${channels(from).map((channel, index) => Math.round(channel + (target[index] - channel) * amount).toString(16).padStart(2, "0")).join("")}`;
  }

  function luminance(color) {
    const rgb = channels(color).map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  }

  function contrast(first, second) {
    const a = luminance(first);
    const b = luminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  function readableColor(color, backgrounds, minimum = 4.5) {
    const score = (candidate) => Math.min(...backgrounds.map((background) => contrast(candidate, background)));
    const target = score("#000000") > score("#ffffff") ? "#000000" : "#ffffff";
    for (let step = 0; step <= 100; step += 1) {
      const candidate = mix(color, target, step / 100);
      if (score(candidate) >= minimum) return candidate;
    }
    return target;
  }

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (saved && typeof saved === "object") {
      if (["light", "dark"].includes(saved.theme)) preferences.theme = saved.theme;
      preferences.accent = normalizeColor(saved.accent) || defaults.accent;
    }
  } catch (_error) {
    // Malformed or inaccessible storage must not prevent the app from loading.
  }

  function apply() {
    const dark = preferences.theme === "dark";
    const paper = dark ? "#181d1b" : "#f2f0e9";
    const surface = dark ? "#242a28" : "#faf9f5";
    const accent = preferences.accent;
    const soft = mix(surface, accent, dark ? 0.18 : 0.12);
    const ink = readableColor(accent, [paper, surface, soft]);
    const onAccent = contrast(accent, "#000000") > contrast(accent, "#ffffff") ? "#000000" : "#ffffff";
    const field = readableColor(accent, ["#242b29"]);
    root.dataset.theme = preferences.theme;
    root.style.colorScheme = preferences.theme;
    for (const [name, value] of Object.entries({
      accent,
      "accent-ink": ink,
      "accent-on": onAccent,
      "accent-hover": mix(accent, onAccent === "#000000" ? "#ffffff" : "#000000", 0.10),
      "accent-soft": soft,
      "accent-border": mix(surface, ink, 0.65),
      "accent-field": field,
      "accent-glow": `${field}33`,
    })) root.style.setProperty(`--${name}`, value);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", paper);
  }

  apply();

  function setupControls() {
    const get = (id) => document.getElementById(id);
    const dialog = get("appearance-dialog");
    const openButton = get("appearance-button");
    const picker = get("accent-color");
    const hex = get("accent-hex");
    const message = get("appearance-message");
    const persistence = get("appearance-persistence");
    const modes = [get("theme-light"), get("theme-dark")];
    const swatches = [...document.querySelectorAll(".accent-swatch")];
    if (!dialog || !openButton || !picker || !hex || modes.some((mode) => !mode)) return;

    function syncControls() {
      modes.forEach((mode) => { mode.checked = mode.value === preferences.theme; });
      picker.value = preferences.accent;
      hex.value = preferences.accent.toUpperCase();
      hex.removeAttribute("aria-invalid");
      swatches.forEach((swatch) => swatch.setAttribute("aria-pressed", String(swatch.dataset.color === preferences.accent)));
      if (message) message.textContent = "Text and cues adjust for contrast.";
      if (persistence) persistence.textContent = storageAvailable ? "Saved on this device" : "Changes apply to this visit only";
    }

    function commit() {
      apply();
      try {
        localStorage.setItem(storageKey, JSON.stringify(preferences));
        storageAvailable = true;
      } catch (_error) {
        storageAvailable = false;
      }
      syncControls();
    }

    function chooseColor(value) {
      const color = normalizeColor(value);
      if (!color) {
        hex.setAttribute("aria-invalid", "true");
        if (message) message.textContent = "Use a hex color such as #6699EE or #69E.";
        return;
      }
      preferences.accent = color;
      commit();
    }

    for (const mode of modes) mode.addEventListener("change", () => {
      if (!mode.checked) return;
      preferences.theme = mode.value;
      commit();
    });
    for (const swatch of swatches) swatch.addEventListener("click", () => chooseColor(swatch.dataset.color));
    picker.addEventListener("input", () => chooseColor(picker.value));
    hex.addEventListener("change", () => chooseColor(hex.value));
    hex.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        chooseColor(hex.value);
      }
    });
    get("reset-appearance")?.addEventListener("click", () => {
      preferences = { ...defaults };
      commit();
    });
    openButton.addEventListener("click", () => {
      syncControls();
      if (!dialog.open) dialog.showModal();
      openButton.setAttribute("aria-expanded", "true");
    });
    get("close-appearance")?.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => openButton.setAttribute("aria-expanded", "false"));
    syncControls();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setupControls, { once: true });
  else setupControls();
})();

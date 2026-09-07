/* A self-paced example, separate from training timers, responses, and scoring. */
(() => {
  const dialog = document.getElementById("help-dialog");
  if (!dialog) return;
  const get = (id) => document.getElementById(id);
  const tabs = [get("rules-tab"), get("example-tab")];
  const panels = [get("rules-panel"), get("example-panel")];
  const cues = [
    { position: 0, letter: "C", place: "top left" },
    { position: 4, letter: "R", place: "center" },
    { position: 0, letter: "C", place: "top left" },
  ];
  const explanations = [
    "Cue 1: remember the top-left square and the letter C. No answer yet.",
    "Cue 2: remember the center square and the letter R too. You still need one more cue before comparing.",
    "Cue 3: compare with cue 1, two cues ago. The top-left position repeats, and so does the letter C.",
  ];
  const answers = { visual: false, audio: false };
  let step = 0;
  let speechVersion = 0;
  let ownsSpeech = false;

  function stopExampleAudio() {
    speechVersion += 1;
    if (ownsSpeech && "speechSynthesis" in window) window.speechSynthesis.cancel();
    ownsSpeech = false;
  }

  function renderExample() {
    stopExampleAudio();
    answers.visual = false;
    answers.audio = false;
    const fragment = document.createDocumentFragment();
    cues.forEach((cue, index) => {
      const revealed = index <= step;
      const card = document.createElement("div");
      card.className = `demo-cue${index === step ? " current" : ""}${step === 2 && index !== 1 ? " compared" : ""}`;
      const label = document.createElement("span");
      label.className = "demo-cue-label";
      label.textContent = `Cue ${index + 1}`;
      const grid = document.createElement("div");
      grid.className = "demo-grid";
      grid.setAttribute("role", "img");
      grid.setAttribute("aria-label", revealed ? `Square at ${cue.place}` : "Cue not shown yet");
      for (let position = 0; position < 9; position += 1) {
        const cell = document.createElement("i");
        if (revealed && position === cue.position) cell.className = "lit";
        cell.setAttribute("aria-hidden", "true");
        grid.append(cell);
      }
      const letter = document.createElement("strong");
      letter.className = "demo-letter";
      letter.textContent = revealed ? cue.letter : "—";
      letter.setAttribute("aria-label", revealed ? `Spoken letter ${cue.letter}` : "Letter not shown yet");
      card.append(label);
      card.append(grid);
      card.append(letter);
      fragment.append(card);
    });
    get("demo-sequence").replaceChildren(fragment);
    get("demo-step-count").textContent = `${step + 1} / 3`;
    get("demo-explanation").textContent = explanations[step];
    get("demo-comparison").hidden = step !== 2;
    get("demo-answers").hidden = step !== 2;
    get("demo-feedback").textContent = "";
    get("demo-back").disabled = step === 0;
    get("demo-next").textContent = step === 2 ? "Start again ↻" : "Next cue →";
    for (const channel of ["visual", "audio"]) {
      const button = get(`demo-${channel}`);
      button.classList.remove("demo-hit");
      button.setAttribute("aria-pressed", "false");
    }
  }

  function selectTab(index, focus = false) {
    tabs.forEach((tab, tabIndex) => {
      tab.setAttribute("aria-selected", String(index === tabIndex));
      tab.tabIndex = index === tabIndex ? 0 : -1;
      panels[tabIndex].hidden = index !== tabIndex;
    });
    stopExampleAudio();
    if (focus) tabs[index].focus();
  }

  function answer(channel) {
    if (!dialog.open || panels[1].hidden || step !== 2 || answers[channel]) return;
    answers[channel] = true;
    get(`demo-${channel}`).classList.add("demo-hit");
    get(`demo-${channel}`).setAttribute("aria-pressed", "true");
    get("demo-feedback").textContent = answers.visual && answers.audio
      ? "Exactly! Both repeat two cues back, so A + L is correct. If only one repeats, press only its key. If neither repeats, wait."
      : channel === "visual"
        ? "Right — the position repeats. The letter C repeats too: try L."
        : "Right — the letter repeats. The position repeats too: try A.";
  }

  function playLetter() {
    if (!("speechSynthesis" in window) || typeof window.SpeechSynthesisUtterance !== "function") {
      get("demo-feedback").textContent = `Audio is unavailable here. The spoken letter is ${cues[step].letter}.`;
      return;
    }
    stopExampleAudio();
    const version = speechVersion;
    const utterance = new window.SpeechSynthesisUtterance(cues[step].letter);
    utterance.lang = "en-US";
    utterance.rate = 0.86;
    utterance.volume = Number(get("volume")?.value ?? 80) / 100;
    utterance.onend = () => { if (version === speechVersion) ownsSpeech = false; };
    utterance.onerror = (event) => {
      if (version !== speechVersion || ["canceled", "interrupted"].includes(event.error)) return;
      ownsSpeech = false;
      get("demo-feedback").textContent = `Audio could not play. The letter is ${cues[step].letter}. You can continue the example.`;
    };
    try {
      ownsSpeech = true;
      window.speechSynthesis.speak(utterance);
    } catch (_error) {
      ownsSpeech = false;
      get("demo-feedback").textContent = `Audio could not play. The letter is ${cues[step].letter}.`;
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(index));
    tab.addEventListener("keydown", (event) => {
      const target = { ArrowLeft: (index + 1) % 2, ArrowRight: (index + 1) % 2, Home: 0, End: 1 }[event.key];
      if (target === undefined) return;
      event.preventDefault();
      selectTab(target, true);
    });
  });
  get("help-button").addEventListener("click", () => { selectTab(0); step = 0; renderExample(); });
  get("show-example").addEventListener("click", () => selectTab(1, true));
  get("demo-next").addEventListener("click", () => { step = (step + 1) % cues.length; renderExample(); });
  get("demo-back").addEventListener("click", () => { step = Math.max(0, step - 1); renderExample(); });
  get("demo-visual").addEventListener("click", () => answer("visual"));
  get("demo-audio").addEventListener("click", () => answer("audio"));
  get("demo-listen").addEventListener("click", playLetter);
  dialog.addEventListener("close", stopExampleAudio);
  dialog.addEventListener("keydown", (event) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || panels[1].hidden || step !== 2) return;
    const channel = { a: "visual", l: "audio" }[event.key.toLowerCase()];
    if (channel) { event.preventDefault(); answer(channel); }
  });
  renderExample();
})();

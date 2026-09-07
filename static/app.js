const elements = Object.fromEntries([
  ["connection", "connection-status"], ["resetButton", "reset-button"],
  ["nLevel", "n-level"], ["rounds", "rounds"], ["pace", "pace"],
  ["levelHelp", "level-help"], ["levelDown", "level-down"], ["levelUp", "level-up"],
  ["levelDisplay", "level-display"], ["timeEstimate", "time-estimate"],
  ["startButton", "start-button"], ["pauseButton", "pause-button"],
  ["audioTest", "audio-test"], ["volume", "volume"], ["currentLevel", "current-level"],
  ["trialCurrent", "trial-current"], ["trialTotal", "trial-total"],
  ["progressBar", "progress-bar"], ["trialRail", "trial-rail"],
  ["sessionStatus", "session-status"], ["timeRemaining", "time-remaining"],
  ["stageMessage", "stage-message"], ["soundState", "sound-state"],
  ["responsePrompt", "response-prompt"], ["visualMatch", "visual-match"],
  ["audioMatch", "audio-match"], ["visualFeedback", "visual-feedback"],
  ["audioFeedback", "audio-feedback"], ["historyList", "history-list"],
  ["historySummary", "history-summary"], ["sessionCount", "session-count"],
  ["bestScore", "best-score"], ["lastScore", "last-score"],
  ["dialog", "results-dialog"], ["closeResults", "close-results"],
  ["resultMessage", "result-message"], ["resultAccuracy", "result-accuracy"],
  ["visualResult", "visual-result"], ["audioResult", "audio-result"],
  ["falseResult", "false-result"], ["recommendedButton", "recommended-button"],
  ["helpDialog", "help-dialog"], ["helpButton", "help-button"],
  ["closeHelp", "close-help"], ["toast", "toast"],
].map(([name, id]) => [name, document.getElementById(id)]));
elements.cells = [...document.querySelectorAll(".cell")];
elements.soundCard = document.querySelector(".sound-card");

const state = {
  status: "idle", session: null, currentIndex: -1,
  visualResponses: new Set(), audioResponses: new Set(),
  timer: null, flashTimer: null, clockTimer: null, toastTimer: null,
  deadline: 0, remaining: 0, phase: null, countdownNumber: 3,
  runToken: 0, speechToken: 0, historyToken: 0, recommendation: null,
};
const preferencesKey = "nback.preferences.v1";
const levelWords = ["one", "two", "three", "four", "five"];
const countdownInterval = 700;

function text(element, value) {
  if (element) element.textContent = String(value);
}

function startLabel(value) {
  text(elements.startButton.firstElementChild || elements.startButton, value);
}

function setStatus(status, label = status) {
  state.status = status;
  text(elements.sessionStatus, label);
  if (elements.sessionStatus) elements.sessionStatus.dataset.state = status;
  document.body.classList.toggle("session-active", !["idle", "finished"].includes(status));
  if (elements.pauseButton) {
    elements.pauseButton.disabled = !["running", "countdown", "paused"].includes(status);
    text(elements.pauseButton, status === "paused" ? "Resume" : "Pause");
    elements.pauseButton.setAttribute("aria-label", status === "paused" ? "Resume session" : "Pause session");
  }
}

function savePreferences() {
  try {
    localStorage.setItem(preferencesKey, JSON.stringify({
      level: elements.nLevel.value, rounds: elements.rounds.value,
      pace: elements.pace.value, volume: elements.volume?.value ?? "80",
    }));
  } catch (_error) {
    // Training remains available when device storage is disabled.
  }
}

function restorePreferences() {
  try {
    const preferences = JSON.parse(localStorage.getItem(preferencesKey) || "null");
    if (!preferences || typeof preferences !== "object") return;
    for (const [name, control] of [["level", elements.nLevel], ["rounds", elements.rounds], ["pace", elements.pace]]) {
      if ([...control.options].some((option) => option.value === String(preferences[name]))) {
        control.value = String(preferences[name]);
      }
    }
    const volume = Number(preferences.volume);
    if (elements.volume && Number.isFinite(volume) && volume >= 0 && volume <= 100) {
      elements.volume.value = String(volume);
    }
  } catch (_error) {
    // Ignore old or malformed preferences.
  }
}

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function updateClock() {
  if (!state.session) {
    text(elements.timeRemaining, formatTime(Number(elements.rounds.value) * Number(elements.pace.value)));
    return;
  }
  if (["finished", "submitting"].includes(state.status)) {
    text(elements.timeRemaining, "00:00");
    return;
  }
  const remaining = state.status === "paused" ? state.remaining : Math.max(0, state.deadline - performance.now());
  const futureTrials = state.phase === "countdown" ? state.session.rounds : state.session.rounds - state.currentIndex - 1;
  const futureCountdown = state.phase === "countdown" ? (state.countdownNumber - 1) * countdownInterval : 0;
  text(elements.timeRemaining, formatTime(futureTrials * state.session.interval_ms + futureCountdown + remaining));
}

function renderRail() {
  if (!elements.trialRail) return;
  const rounds = state.session?.rounds ?? Number(elements.rounds.value);
  const level = state.session?.n_level ?? Number(elements.nLevel.value);
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < rounds; index += 1) {
    const bar = document.createElement("span");
    bar.className = index < level ? "warmup" : "";
    bar.classList.toggle("past", index < state.currentIndex || state.status === "finished");
    bar.classList.toggle("current", index === state.currentIndex && state.status !== "finished");
    bar.setAttribute("aria-hidden", "true");
    fragment.append(bar);
  }
  elements.trialRail.replaceChildren(fragment);
}

function updateSetupCopy() {
  const level = Number(elements.nLevel.value);
  const rounds = Number(elements.rounds.value);
  const seconds = Math.ceil(rounds * Number(elements.pace.value) / 1000);
  elements.levelHelp.textContent = `Compare each cue with the one from ${levelWords[level - 1]} turn${level === 1 ? "" : "s"} earlier.`;
  elements.timeEstimate.textContent = seconds < 60 ? `${seconds} sec` : `${Math.floor(seconds / 60)} min${seconds % 60 ? ` ${seconds % 60} sec` : ""}`;
  text(elements.levelDisplay, level);
  elements.currentLevel.textContent = String(level);
  elements.trialTotal.textContent = String(rounds);
  stageCopy(level, "Ready when you are", "Watch the position. Listen to the letter.");
  if (elements.levelDown) elements.levelDown.disabled = elements.nLevel.disabled || level <= 1;
  if (elements.levelUp) elements.levelUp.disabled = elements.nLevel.disabled || level >= 5;
  renderRail();
  updateClock();
}

function stageCopy(number, title, detail) {
  text(elements.stageMessage.querySelector(".stage-number"), number);
  text(elements.stageMessage.querySelector("strong"), title);
  text(elements.stageMessage.querySelector("small"), detail);
}

function setControlsLocked(locked) {
  for (const control of [elements.nLevel, elements.rounds, elements.pace, elements.startButton, elements.audioTest]) {
    if (control) control.disabled = locked;
  }
  if (elements.levelDown) elements.levelDown.disabled = locked || Number(elements.nLevel.value) <= 1;
  if (elements.levelUp) elements.levelUp.disabled = locked || Number(elements.nLevel.value) >= 5;
}

function clearTimers() {
  window.clearTimeout(state.timer);
  window.clearTimeout(state.flashTimer);
  window.clearInterval(state.clockTimer);
  state.timer = null;
  state.flashTimer = null;
  state.clockTimer = null;
}

function setMatchControls(enabled) {
  elements.visualMatch.disabled = !enabled;
  elements.audioMatch.disabled = !enabled;
}

function clearMarks() {
  elements.visualMatch.classList.remove("registered");
  elements.audioMatch.classList.remove("registered");
  elements.visualMatch.setAttribute("aria-pressed", "false");
  elements.audioMatch.setAttribute("aria-pressed", "false");
  text(elements.visualFeedback, "A");
  text(elements.audioFeedback, "L");
}

function clearStimulus() {
  elements.cells.forEach((cell) => cell.classList.remove("active"));
  elements.soundCard.classList.remove("playing");
}

function hasAudio() {
  return "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";
}

function cancelAudio() {
  state.speechToken += 1;
  if (hasAudio()) window.speechSynthesis.cancel();
}

function speakLetter(letter, isTest = false) {
  if (!hasAudio()) {
    showToast("Audio is unavailable in this browser. Open the trainer in a browser with speech support.");
    return false;
  }
  cancelAudio();
  const runToken = state.runToken;
  const speechToken = state.speechToken;
  const utterance = new window.SpeechSynthesisUtterance(letter);
  utterance.rate = 0.86;
  utterance.pitch = 1;
  utterance.volume = Number(elements.volume?.value ?? 80) / 100;
  utterance.onerror = (event) => {
    if (runToken !== state.runToken || speechToken !== state.speechToken) return;
    if (!isTest) pauseSession();
    elements.soundState.textContent = "Audio needs attention";
    showToast("The letter could not play. Check your browser audio permissions, then resume or reset.");
  };
  try {
    window.speechSynthesis.speak(utterance);
    return true;
  } catch (_error) {
    if (!isTest) pauseSession();
    elements.soundState.textContent = "Audio needs attention";
    showToast("Audio could not start. Check your browser audio permissions.");
    return false;
  }
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  state.toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), 5500);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "The server could not complete that request.");
  return payload;
}

async function checkHealth() {
  try {
    await api("/api/health");
    elements.connection.className = "connection-status online";
    elements.connection.lastElementChild.textContent = "Connected";
  } catch (_error) {
    elements.connection.className = "connection-status offline";
    elements.connection.lastElementChild.textContent = "Server offline";
  }
}

function schedulePhase(milliseconds) {
  window.clearTimeout(state.timer);
  window.clearInterval(state.clockTimer);
  state.remaining = milliseconds;
  state.deadline = performance.now() + milliseconds;
  const token = state.runToken;
  state.timer = window.setTimeout(() => {
    if (token !== state.runToken || state.status === "paused") return;
    if (state.phase === "countdown") advanceCountdown();
    else advanceTrial();
  }, milliseconds);
  state.clockTimer = window.setInterval(updateClock, 100);
  updateClock();
}

function advanceCountdown() {
  if (state.countdownNumber > 1) {
    state.countdownNumber -= 1;
    text(elements.stageMessage.querySelector(".stage-number"), state.countdownNumber);
    schedulePhase(countdownInterval);
    return;
  }
  state.phase = "trial";
  setStatus("running", "Building memory");
  elements.stageMessage.classList.add("hidden");
  advanceTrial();
}

async function startSession() {
  if (!["idle", "finished"].includes(state.status)) return;
  if (!hasAudio()) {
    showToast("This trainer needs spoken letters. Please use a browser with speech synthesis support.");
    return;
  }
  // Invalidate older requests before the first await, including a pending reset.
  const token = ++state.runToken;
  state.historyToken += 1;
  clearTimers();
  cancelAudio();
  clearStimulus();
  clearMarks();
  state.session = null;
  state.currentIndex = -1;
  state.recommendation = null;
  state.visualResponses = new Set();
  state.audioResponses = new Set();
  state.phase = null;
  setStatus("loading", "Preparing");
  setControlsLocked(true);
  setMatchControls(false);
  resetStageMetrics();
  renderRail();
  startLabel("Preparing…");
  savePreferences();
  try {
    const session = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        n_level: Number(elements.nLevel.value),
        rounds: Number(elements.rounds.value),
        interval_ms: Number(elements.pace.value),
      }),
    });
    if (token !== state.runToken) return;
    state.session = session;
    state.phase = "countdown";
    state.countdownNumber = 3;
    elements.currentLevel.textContent = String(session.n_level);
    elements.trialTotal.textContent = String(session.rounds);
    startLabel("Session in progress");
    setStatus("countdown", "Get ready");
    elements.stageMessage.classList.remove("hidden");
    stageCopy(3, "Session starts in", "A for position · L for audio");
    renderRail();
    schedulePhase(countdownInterval);
    if (document.hidden || elements.helpDialog?.open) pauseSession(document.hidden);
  } catch (error) {
    if (token !== state.runToken) return;
    resetSession();
    showToast(error.message);
  }
}

function advanceTrial() {
  if (state.status !== "running") return;
  window.clearTimeout(state.flashTimer);
  clearStimulus();
  clearMarks();
  const nextIndex = state.currentIndex + 1;
  if (nextIndex >= state.session.trials.length) {
    finishSession();
    return;
  }
  state.currentIndex = nextIndex;
  const trial = state.session.trials[nextIndex];
  elements.cells[trial.position].classList.add("active");
  elements.soundCard.classList.add("playing");
  elements.soundState.textContent = "Letter playing";
  elements.trialCurrent.textContent = String(nextIndex + 1);
  elements.progressBar.style.width = `${((nextIndex + 1) / state.session.rounds) * 100}%`;
  const canRespond = nextIndex >= state.session.n_level;
  setStatus("running", canRespond ? "Running" : "Building memory");
  setMatchControls(canRespond);
  updateResponsePrompt();
  renderRail();
  schedulePhase(state.session.interval_ms);
  speakLetter(trial.letter);
  if (state.status !== "running") return;
  const token = state.runToken;
  state.flashTimer = window.setTimeout(() => {
    if (token !== state.runToken || state.status !== "running") return;
    clearStimulus();
    elements.soundState.textContent = "Listening for the next cue";
  }, Math.min(850, state.session.interval_ms * 0.45));
}

function updateResponsePrompt() {
  const canRespond = state.currentIndex >= state.session.n_level;
  elements.responsePrompt.textContent = canRespond
    ? `Compare with trial ${state.currentIndex + 1 - state.session.n_level}. Mark either match, or both.`
    : `Memory cue ${state.currentIndex + 1} of ${state.session.n_level}. Observe only.`;
}

function pauseSession(automatic = false) {
  if (!["running", "countdown"].includes(state.status)) return;
  state.remaining = Math.max(0, state.deadline - performance.now());
  clearTimers();
  clearStimulus();
  cancelAudio();
  setStatus("paused", "Paused");
  setMatchControls(false);
  elements.stageMessage.classList.remove("hidden");
  stageCopy("Ⅱ", "Session paused", automatic ? "Paused while this tab is in the background." : "Resume when you’re ready.");
  elements.soundState.textContent = "Audio paused";
  elements.responsePrompt.textContent = "Your place and responses are saved for this session.";
  updateClock();
}

function resumeSession() {
  if (state.status !== "paused" || document.hidden) return;
  if (state.phase === "countdown") {
    setStatus("countdown", "Get ready");
    stageCopy(state.countdownNumber, "Session starts in", "A for position · L for audio");
  } else {
    const canRespond = state.currentIndex >= state.session.n_level;
    setStatus("running", canRespond ? "Running" : "Building memory");
    elements.stageMessage.classList.add("hidden");
    setMatchControls(canRespond);
    elements.soundState.textContent = "Listening for the next cue";
    updateResponsePrompt();
  }
  // Continue the same response window without replaying its position or letter.
  schedulePhase(state.remaining);
}

function togglePause() {
  if (state.status === "paused") resumeSession();
  else pauseSession();
}

function registerResponse(channel) {
  if (state.status !== "running" || state.currentIndex < state.session.n_level) return;
  const responses = channel === "visual" ? state.visualResponses : state.audioResponses;
  const button = channel === "visual" ? elements.visualMatch : elements.audioMatch;
  if (responses.has(state.currentIndex)) return;
  responses.add(state.currentIndex);
  button.classList.add("registered");
  button.setAttribute("aria-pressed", "true");
  text(channel === "visual" ? elements.visualFeedback : elements.audioFeedback, "Marked");
  if (navigator.vibrate) navigator.vibrate(18);
}

async function finishSession() {
  if (state.status !== "running") return;
  const token = state.runToken;
  const session = state.session;
  setStatus("submitting", "Scoring");
  clearTimers();
  clearStimulus();
  cancelAudio();
  setMatchControls(false);
  updateClock();
  elements.soundState.textContent = "Scoring your session";
  elements.responsePrompt.textContent = "Saving your position and audio results…";
  try {
    const result = await api(`/api/sessions/${session.session_id}/complete`, {
      method: "POST",
      body: JSON.stringify({
        visual_responses: [...state.visualResponses], audio_responses: [...state.audioResponses],
      }),
    });
    if (token !== state.runToken) return;
    setStatus("finished", "Complete");
    state.recommendation = result.recommendation;
    elements.soundState.textContent = "Session complete";
    elements.responsePrompt.textContent = "Results saved. Start another session when you’re ready.";
    renderResults(result);
    loadHistory(token);
  } catch (error) {
    if (token !== state.runToken) return;
    setStatus("finished", "Save failed");
    elements.soundState.textContent = "Result could not be saved";
    elements.responsePrompt.textContent = "The server could not save this result. Reset to start a new session.";
    showToast(error.message);
  } finally {
    if (token === state.runToken) {
      setControlsLocked(false);
      startLabel("Start session");
      renderRail();
    }
  }
}

function openDialog(dialog) {
  if (!dialog || dialog.open) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function renderResults(result) {
  elements.resultAccuracy.textContent = `${result.accuracy}%`;
  elements.visualResult.textContent = `${result.visual.hits} / ${result.visual.targets}`;
  elements.audioResult.textContent = `${result.audio.hits} / ${result.audio.targets}`;
  elements.falseResult.textContent = String(result.false_alarms);
  elements.resultMessage.textContent = result.recommendation.message;
  elements.recommendedButton.textContent = result.recommendation.n_level === state.session.n_level
    ? `Repeat ${result.recommendation.n_level}-Back` : `Try ${result.recommendation.n_level}-Back`;
  openDialog(elements.dialog);
}

function resetStageMetrics() {
  elements.trialCurrent.textContent = "0";
  elements.progressBar.style.width = "0%";
  elements.responsePrompt.textContent = "Press A for a position match. Press L for an audio match.";
}

function resetSession({ keepRecommendation = false } = {}) {
  state.runToken += 1;
  state.historyToken += 1;
  clearTimers();
  clearStimulus();
  clearMarks();
  cancelAudio();
  state.session = null;
  state.currentIndex = -1;
  state.phase = null;
  state.remaining = 0;
  state.visualResponses = new Set();
  state.audioResponses = new Set();
  setStatus("idle", "Ready");
  setControlsLocked(false);
  setMatchControls(false);
  resetStageMetrics();
  startLabel("Start session");
  elements.stageMessage.classList.remove("hidden");
  elements.soundState.textContent = "Headphones recommended";
  closeDialog(elements.dialog);
  if (!keepRecommendation) state.recommendation = null;
  updateSetupCopy();
}

function formatDate(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(date);
}

async function loadHistory(runToken = state.runToken) {
  const historyToken = ++state.historyToken;
  try {
    const payload = await api("/api/history?limit=6");
    if (historyToken !== state.historyToken || runToken !== state.runToken) return;
    const results = payload.results;
    const average = results.length ? Math.round(results.reduce((sum, item) => sum + item.accuracy, 0) / results.length) : null;
    text(elements.sessionCount, results.length);
    text(elements.bestScore, results.length ? `${Math.max(...results.map((item) => item.accuracy))}%` : "—");
    text(elements.lastScore, results.length ? `${results[0].accuracy}%` : "—");
    elements.historySummary.textContent = average === null ? "Your completed sessions will appear here." : `${average}% average across ${results.length} recent session${results.length === 1 ? "" : "s"}`;
    if (!results.length) return;
    const fragment = document.createDocumentFragment();
    for (const item of results) {
      const row = document.createElement("div");
      row.className = "history-row";
      for (const [tag, className, value] of [
        ["strong", "history-level", `${item.n_level}-Back`],
        ["span", "history-date", formatDate(item.completed_at)],
        ["span", "history-detail", `${item.rounds} trials · ${item.visual_hits + item.audio_hits}/${item.visual_targets + item.audio_targets} targets · ${item.false_alarms} false alarms`],
        ["span", "history-accuracy", `${item.accuracy}%`],
      ]) {
        const child = document.createElement(tag);
        child.className = className;
        child.textContent = value;
        row.append(child);
      }
      fragment.append(row);
    }
    elements.historyList.replaceChildren(fragment);
  } catch (_error) {
    if (historyToken !== state.historyToken || runToken !== state.runToken) return;
    elements.historySummary.textContent = "History unavailable";
  }
}

elements.startButton.addEventListener("click", startSession);
elements.resetButton.addEventListener("click", () => resetSession());
elements.visualMatch.addEventListener("click", () => registerResponse("visual"));
elements.audioMatch.addEventListener("click", () => registerResponse("audio"));
elements.pauseButton?.addEventListener("click", togglePause);
elements.audioTest?.addEventListener("click", () => speakLetter("Audio check. C.", true));
elements.closeResults.addEventListener("click", () => closeDialog(elements.dialog));
elements.helpButton?.addEventListener("click", () => { pauseSession(); openDialog(elements.helpDialog); });
elements.closeHelp?.addEventListener("click", () => closeDialog(elements.helpDialog));
elements.recommendedButton.addEventListener("click", () => {
  const recommendedLevel = state.recommendation?.n_level || Number(elements.nLevel.value);
  closeDialog(elements.dialog);
  resetSession({ keepRecommendation: true });
  elements.nLevel.value = String(recommendedLevel);
  updateSetupCopy();
  startSession();
});

for (const [button, direction] of [[elements.levelDown, -1], [elements.levelUp, 1]]) {
  button?.addEventListener("click", () => {
    if (elements.nLevel.disabled) return;
    if (state.status === "finished") resetSession();
    elements.nLevel.value = String(Math.min(5, Math.max(1, Number(elements.nLevel.value) + direction)));
    updateSetupCopy();
    savePreferences();
  });
}
[elements.nLevel, elements.rounds, elements.pace].forEach((control) => {
  control.addEventListener("change", () => {
    if (state.status === "finished") resetSession();
    updateSetupCopy();
    savePreferences();
  });
});
elements.volume?.addEventListener("input", savePreferences);

window.addEventListener("keydown", (event) => {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target?.closest("input, select, textarea, [contenteditable='true'], dialog[open]")) return;
  const key = event.key.toLowerCase();
  if (key === "a") registerResponse("visual");
  if (key === "l") registerResponse("audio");
  if (event.code === "Space" && ["running", "countdown", "paused"].includes(state.status) && event.target?.tagName !== "BUTTON") {
    event.preventDefault();
    togglePause();
  }
});
document.addEventListener("visibilitychange", () => { if (document.hidden) pauseSession(true); });
window.addEventListener("beforeunload", () => { clearTimers(); cancelAudio(); });

restorePreferences();
setStatus("idle", "Ready");
setMatchControls(false);
updateSetupCopy();
checkHealth();
loadHistory();

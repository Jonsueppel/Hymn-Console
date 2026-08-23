const state = {
  hymns: [],
  selectedId: null,
  queue: [],
  queueIndex: -1,
  repeat: false,
  fadeTimer: null,
  segmentPlan: [],
  segmentIndex: -1,
  visibleHymns: 80,
  letterFilter: "",
  servicePlans: [],
  operatorMode: false,
  serviceLocked: false,
  audioOutput: "server",
  serverPaused: false,
  loadedPlanName: "",
  clientLogs: [],
  appSettings: null,
  authUser: null,
  pendingLookup: null,
  statusTimer: null,
  fadeActionTimer: null,
  serverTimelineTimer: null,
  livePlaybackTimer: null,
  serverVolumeTimer: null,
  serverRepeatRestarting: false,
  healthTimer: null,
  detectedNetwork: null,
  livePlaybackClientId: "",
  lastLivePlaybackPublish: 0,
  lastLivePlaybackCommandId: "",
  appStarted: false,
  lyricsVisible: false,
  lyricsMode: "lyrics",
  liveHymnId: "",
  pendingPasswordUser: null,
  pendingPermissionsUser: null,
  selectedBackupFile: null,
  pendingLogoFile: null,
  pendingLogoDataUri: "",
  permissionCatalog: {},
  pendingAuthMode: "",
  pendingAuthMessage: "",
  serverPlatform: ""
};

const $ = (id) => document.getElementById(id);
const audio = $("audio");
const hymnList = $("hymnList");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setPlayButtonState(stateName) {
  const button = $("playBtn");
  const playing = stateName === "pause";
  button.dataset.state = playing ? "pause" : "play";
  const canControl = hasPermission("playback.control");
  button.title = canControl ? (playing ? "Pause" : "Play") : "Your account cannot control playback.";
  button.setAttribute("aria-label", canControl ? (playing ? "Pause" : "Play") : "Your account cannot control playback.");
  updateDetailPlayButton();
}

function updateDetailPlayButton() {
  const button = $("playHymnBtn");
  if (!button) return;
  const isSelectedAudio = state.liveHymnId && state.liveHymnId === state.selectedId && !audio.paused;
  button.textContent = isSelectedAudio ? "Stop" : "Play";
  button.classList.toggle("is-playing", isSelectedAudio);
}

function readSetting(key, fallback = "") {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writeSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Some locked-down mobile browsers block local storage. The app still works without saved preferences.
  }
}

function setSplashStatus(message, progress = null) {
  const status = $("splashStatus");
  const bar = $("splashProgress");
  if (status) status.textContent = message;
  if (bar && progress !== null) bar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
}

function setSplashCheck(name, stateName) {
  const item = document.querySelector(`[data-splash-check="${name}"]`);
  if (!item) return;
  item.classList.toggle("done", stateName === "done");
  item.classList.toggle("bad", stateName === "bad");
}

function hideSplash() {
  const splash = $("splashScreen");
  if (!splash) return;
  splash.classList.add("hidden");
  setTimeout(() => splash.remove(), 320);
}

function showSplashReady() {
  setSplashStatus("Ready for service", 100);
  const start = $("splashStartBtn");
  if (start) start.hidden = false;
}

function showSplashError(message) {
  setSplashStatus(message, 100);
  ["server", "library", "queue", "audio"].forEach((name) => setSplashCheck(name, "bad"));
  const start = $("splashStartBtn");
  if (start) start.hidden = true;
  const retry = $("splashRetryBtn");
  if (retry) retry.hidden = false;
}

function makeId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  if (globalThis.crypto?.getRandomValues) {
    const values = globalThis.crypto.getRandomValues(new Uint32Array(4));
    const random = Array.from(values, (value) => value.toString(16)).join("");
    return `id-${Date.now().toString(36)}-${random}`;
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

window.addEventListener("error", (event) => {
  setStatus(`App error: ${event.message || "unknown error"}`);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason?.message || event.reason || "unknown error";
  setStatus(`App error: ${reason}`);
});
const queueEl = $("queue");
const LIBRARY_PAGE_SIZE = 80;
const CONTROL_DEFAULTS = {
  volume: 0.9,
  speed: 1,
  fadeIn: 1.5,
  fadeOut: 2
};
const DEFAULT_BRAND_THEME = {
  accent: "#2b7fc3",
  blue: "#155a91",
  paper: "#eaf3fb",
  panel: "#ffffff",
  ink: "#0b1f33"
};
const DEFAULT_PALETTE = "chapel-blue";
const COLOR_PALETTES = {
  "chapel-blue": {
    light: { accent: "#2b7fc3", blue: "#155a91", paper: "#eaf3fb", panel: "#ffffff", panelSoft: "#f5f9fd", ink: "#0b1f33", muted: "#55708b", line: "#b7d3e9", button: "#ffffff", player: "#d6eafa", queue: "#ffffff", danger: "#b94d5e" },
    dark: { accent: "#62c8ff", blue: "#8ed8ff", paper: "#071521", panel: "#0c1f34", panelSoft: "#112a46", ink: "#f7fbff", muted: "#b9cde2", line: "#4b79a2", button: "#0f2741", player: "#1f5a86", queue: "#071423", danger: "#ff6f86" }
  },
  "stained-glass": {
    light: { accent: "#7a3fd1", blue: "#3777c8", paper: "#f1ecff", panel: "#ffffff", panelSoft: "#f7f4ff", ink: "#1d1730", muted: "#6f628a", line: "#ccbdf1", button: "#ffffff", player: "#e4dcff", queue: "#ffffff", danger: "#b94d5e" },
    dark: { accent: "#a875ff", blue: "#6fb7ff", paper: "#130a22", panel: "#221438", panelSoft: "#2d1d48", ink: "#fbf7ff", muted: "#cab9e6", line: "#654b90", button: "#281942", player: "#35205a", queue: "#160d27", danger: "#ff7290" }
  },
  "morning-grace": {
    light: { accent: "#c49a59", blue: "#7f9462", paper: "#fbf7e8", panel: "#fffdf4", panelSoft: "#f7f0d9", ink: "#2f2a18", muted: "#7a7358", line: "#ded0a9", button: "#fffdf4", player: "#f4e8c6", queue: "#fffdf4", danger: "#a75a50" },
    dark: { accent: "#e1b86f", blue: "#a9c278", paper: "#171307", panel: "#2a2312", panelSoft: "#332b17", ink: "#fff9e8", muted: "#d6c89d", line: "#725d2d", button: "#302815", player: "#493818", queue: "#1c170b", danger: "#e07d72" }
  },
  "heritage-gold": {
    light: { accent: "#d4a64f", blue: "#425d66", paper: "#f8f1da", panel: "#ffffff", panelSoft: "#f4ead0", ink: "#2d2416", muted: "#75654b", line: "#dcc38b", button: "#fffdf7", player: "#f1dfb3", queue: "#ffffff", danger: "#8f3732" },
    dark: { accent: "#e6bd64", blue: "#83a5b0", paper: "#15100a", panel: "#281c14", panelSoft: "#342719", ink: "#fff8e8", muted: "#d4c0a0", line: "#80663b", button: "#302318", player: "#4d361e", queue: "#1d140e", danger: "#e56b64" }
  },
  "rosewood-hymnal": {
    light: { accent: "#b64a4a", blue: "#36556c", paper: "#fbefed", panel: "#ffffff", panelSoft: "#f9e4e1", ink: "#311717", muted: "#7d5a5a", line: "#e5b9b4", button: "#fffafa", player: "#f3d4cf", queue: "#ffffff", danger: "#9d303f" },
    dark: { accent: "#ff7a7a", blue: "#8cb7d0", paper: "#17090b", panel: "#2a1116", panelSoft: "#391922", ink: "#fff6f5", muted: "#e0b8b4", line: "#7e3b42", button: "#35161d", player: "#54242d", queue: "#1b0c0f", danger: "#ff7c96" }
  },
  "quiet-sage": {
    light: { accent: "#6f9278", blue: "#526d75", paper: "#eff5ee", panel: "#ffffff", panelSoft: "#f4f8f3", ink: "#18291e", muted: "#607365", line: "#c3d6c7", button: "#ffffff", player: "#dcebdc", queue: "#ffffff", danger: "#a65b5b" },
    dark: { accent: "#9cc9a8", blue: "#8bb7c2", paper: "#08140d", panel: "#13251a", panelSoft: "#1c3022", ink: "#f3fff6", muted: "#bdd4c1", line: "#4a6d51", button: "#182c20", player: "#284634", queue: "#0b1810", danger: "#ef8585" }
  },
  "sanctuary-slate": {
    light: { accent: "#4d6f9f", blue: "#283447", paper: "#eef3f8", panel: "#ffffff", panelSoft: "#f5f7fa", ink: "#111b2a", muted: "#637086", line: "#c7d3e4", button: "#ffffff", player: "#dae6f2", queue: "#ffffff", danger: "#a44d62" },
    dark: { accent: "#7aa3d8", blue: "#b6c9e4", paper: "#070b12", panel: "#111827", panelSoft: "#1f2937", ink: "#f8fbff", muted: "#c1cad8", line: "#46566d", button: "#182233", player: "#263852", queue: "#0b111c", danger: "#f27a95" }
  },
  "revival-sunset": {
    light: { accent: "#df7c2f", blue: "#bd3e3b", paper: "#fff2e4", panel: "#ffffff", panelSoft: "#fff7ef", ink: "#331c10", muted: "#815f48", line: "#efc7a5", button: "#fffaf5", player: "#ffd9b8", queue: "#ffffff", danger: "#c83d57" },
    dark: { accent: "#ff9a47", blue: "#ff6f6a", paper: "#160b06", panel: "#2b160d", panelSoft: "#3a2113", ink: "#fff7ef", muted: "#e6c1a5", line: "#875331", button: "#321b10", player: "#5d3219", queue: "#1d0f08", danger: "#ff6e8a" }
  },
  "communion-plum": {
    light: { accent: "#8c5cc7", blue: "#5a638f", paper: "#f4effb", panel: "#ffffff", panelSoft: "#faf7ff", ink: "#251934", muted: "#716180", line: "#d3c0eb", button: "#ffffff", player: "#e6d8f7", queue: "#ffffff", danger: "#b85070" },
    dark: { accent: "#c092ff", blue: "#9ca7df", paper: "#120a1b", panel: "#211331", panelSoft: "#2c1d3f", ink: "#fcf8ff", muted: "#d4c2ea", line: "#60447d", button: "#2a1a3c", player: "#442a63", queue: "#170d22", danger: "#ff7aa2" }
  },
  "mission-teal": {
    light: { accent: "#278c9d", blue: "#315f73", paper: "#eaf7f8", panel: "#ffffff", panelSoft: "#f3fbfb", ink: "#0e2730", muted: "#59747b", line: "#b9dde2", button: "#ffffff", player: "#d4eef2", queue: "#ffffff", danger: "#a94f61" },
    dark: { accent: "#56d5e2", blue: "#8fd7f0", paper: "#061416", panel: "#0d2529", panelSoft: "#15343a", ink: "#f4feff", muted: "#b7d7dc", line: "#41737a", button: "#123037", player: "#1d5963", queue: "#08191c", danger: "#ff7e98" }
  },
  "linen-and-cedar": {
    light: { accent: "#9a7b5b", blue: "#707966", paper: "#f7f2ea", panel: "#fffdf9", panelSoft: "#f1eadf", ink: "#2d251c", muted: "#756b5f", line: "#d8cab8", button: "#fffdf9", player: "#eadfce", queue: "#fffdf9", danger: "#9d5656" },
    dark: { accent: "#d1ad82", blue: "#a7b18f", paper: "#14100c", panel: "#282018", panelSoft: "#33291f", ink: "#fff9f1", muted: "#d8c8b5", line: "#705f4a", button: "#30261d", player: "#493928", queue: "#1b1510", danger: "#e48282" }
  },
  "joyful-bright": {
    light: { accent: "#e03d7a", blue: "#5b87ef", paper: "#fff2f8", panel: "#ffffff", panelSoft: "#fff7fb", ink: "#2b1531", muted: "#765d83", line: "#efbfd4", button: "#ffffff", player: "#ffd8e8", queue: "#ffffff", danger: "#bf3152" },
    dark: { accent: "#ff6aa5", blue: "#7fa3ff", paper: "#160716", panel: "#2b102d", panelSoft: "#39183b", ink: "#fff7fd", muted: "#e2bfe5", line: "#7c3c82", button: "#351538", player: "#5a235c", queue: "#1c0a1d", danger: "#ff7890" }
  }
};

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  writeSetting("hymn-theme", theme);
  $("themeToggle").textContent = theme === "dark" ? "Light" : "Dark";
  $("themeToggle").setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} mode`);
  if (state.appSettings) applyBrandSettings(state.appSettings);
}

function setCssVar(name, value) {
  if (value) {
    document.documentElement.style.setProperty(name, value);
  } else {
    document.documentElement.style.removeProperty(name);
  }
}

function clearBrandThemeVars() {
  ["--accent", "--blue", "--paper", "--panel", "--button", "--ink"].forEach((name) => setCssVar(name, ""));
}

function paletteColors(name, mode = "light") {
  const palette = COLOR_PALETTES[name] || COLOR_PALETTES[DEFAULT_PALETTE];
  return palette[mode] || palette.light;
}

function applyPaletteVars(colors) {
  setCssVar("--accent", colors.accent);
  setCssVar("--blue", colors.blue);
  setCssVar("--paper", colors.paper);
  setCssVar("--panel", colors.panel);
  setCssVar("--panel-soft", colors.panelSoft);
  setCssVar("--button", colors.button);
  setCssVar("--ink", colors.ink);
  setCssVar("--muted", colors.muted);
  setCssVar("--line", colors.line);
  setCssVar("--accent-2", colors.danger);
  setCssVar("--section-border", colors.line);
  setCssVar("--section-fill", colors.panelSoft);
  setCssVar("--section-accent", colors.accent);
  setCssVar("--app-paper", colors.paper);
  setCssVar("--app-panel", colors.panel);
  setCssVar("--app-panel-soft", colors.panelSoft);
  setCssVar("--app-ink", colors.ink);
  setCssVar("--app-muted", colors.muted);
  setCssVar("--app-line", colors.line);
  setCssVar("--app-button", colors.button);
  setCssVar("--app-accent", colors.accent);
  setCssVar("--app-blue", colors.blue);
  setCssVar("--app-player", colors.player);
  setCssVar("--app-queue", colors.queue);
  setCssVar("--app-danger", colors.danger);
}

function applyBrandSettings(settings) {
  const appName = settings.appName || "Hymn Console";
  const safeSettings = {
    appName,
    palette: settings.palette || settings.theme?.palette || DEFAULT_PALETTE,
    theme: settings.theme || { palette: settings.palette || DEFAULT_PALETTE },
    customLogo: Boolean(settings.customLogo),
    customLogoVersion: String(settings.customLogoVersion || ""),
    logoDataUri: settings.logoDataUri || ""
  };
  document.title = appName;
  const brandEyebrow = document.querySelector(".brand .eyebrow");
  if (brandEyebrow) brandEyebrow.textContent = appName;
  const splashEyebrow = document.querySelector(".splash-card .eyebrow");
  if (splashEyebrow) splashEyebrow.textContent = appName;
  const authEyebrow = document.querySelector(".auth-card .eyebrow");
  if (authEyebrow) authEyebrow.textContent = `${appName} Security`;
  if ($("customAppName")) $("customAppName").value = appName;
  const paletteName = safeSettings.palette;
  const mode = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const colors = paletteColors(paletteName, mode);
  applyPaletteVars(colors);
  const paletteSelect = $("colorPaletteSelect");
  if (paletteSelect) paletteSelect.value = COLOR_PALETTES[paletteName] ? paletteName : DEFAULT_PALETTE;
  const logoCache = encodeURIComponent(safeSettings.customLogoVersion || Date.now());
  const logoSrc = safeSettings.logoDataUri || `/api/logo?cache=${logoCache}`;
  document.querySelectorAll("[data-brand-logo]").forEach((logo) => {
    logo.dataset.logoRetried = "false";
    logo.onerror = null;
    logo.src = logoSrc;
    if (!safeSettings.logoDataUri) {
      logo.onerror = () => {
        if (logo.dataset.logoRetried === "default") return;
        if (logo.dataset.logoRetried === "true") {
          logo.dataset.logoRetried = "default";
          logo.src = "/mark.svg";
          return;
        }
        logo.dataset.logoRetried = "true";
        logo.src = `/api/logo?cache=retry-${Date.now()}`;
      };
    }
  });
}

async function loadPublicBranding() {
  try {
    const branding = await api("/api/branding");
    state.appSettings = branding;
    applyBrandSettings(branding);
    return branding;
  } catch {
    return null;
  }
}

function setActiveTab(name) {
  if (state.serviceLocked && name === "edit") {
    setStatus("Unlock service before admin changes");
    name = "service";
  }
  document.body.dataset.activeTab = name;
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === name);
  });
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    panel.classList.toggle("active-panel", panel.dataset.panel === name);
  });
  updateStickyShellHeight();
}

function updateStickyShellHeight() {
  const shell = document.querySelector(".app-sticky-shell");
  if (!shell) return;
  const height = Math.ceil(shell.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--app-sticky-height", `${height}px`);
}

function resetPlayerSelection() {
  state.queueIndex = -1;
  state.segmentPlan = [];
  state.segmentIndex = -1;
  state.liveHymnId = "";
  audio.pause();
  audio.removeAttribute("src");
  setPlayButtonState("play");
  $("currentTime").textContent = "0:00";
  $("duration").textContent = "0:00";
  $("seek").value = 0;
  $("nowTitle").textContent = "Choose a hymn";
  $("nowMeta").textContent = "Select a hymn from the service queue.";
  renderLyricsSheet();
}

function currentServiceHymn() {
  const queued = state.queue[state.queueIndex];
  return state.hymns.find((hymn) => hymn.id === queued?.hymnId)
    || state.hymns.find((hymn) => hymn.id === state.liveHymnId)
    || state.hymns.find((hymn) => hymn.id === state.selectedId)
    || null;
}

function lyricBlocks(lyrics) {
  return String(lyrics || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function lyricBlockLabel(block, index) {
  const firstLine = block.split("\n").find(Boolean) || "";
  const labelMatch = firstLine.match(/^\s*(?:\[|\()?((?:verse|chorus|refrain|bridge|intro|tag|ending)[^\])]*)(?:\]|\))?\s*:?/i);
  if (labelMatch) return labelMatch[1].trim();
  return `Section ${index + 1}`;
}

function stripLyricLabel(line) {
  return String(line || "").replace(/^\s*(?:\[|\()?(?:verse|chorus|refrain|bridge|intro|tag|ending)[^\])]*(?:\]|\))?\s*:?\s*/i, "");
}

function addLyricsParagraph(parent, text, className = "") {
  const paragraph = document.createElement("p");
  if (className) paragraph.className = className;
  paragraph.textContent = text;
  parent.append(paragraph);
}

function renderLyricsContent(hymn) {
  const content = $("lyricsContent");
  content.innerHTML = "";
  if (!hymn) {
    addLyricsParagraph(content, "Select a hymn from the service queue to view its lyrics.", "lyrics-empty");
    return;
  }
  if (!String(hymn.lyrics || "").trim()) {
    addLyricsParagraph(content, "No lyrics saved for this hymn.", "lyrics-empty");
    return;
  }
  const blocks = lyricBlocks(hymn.lyrics);
  content.classList.toggle("large-text", state.lyricsMode === "large");
  blocks.forEach((block) => {
    const stanza = document.createElement("div");
    stanza.className = "lyric-stanza";
    const title = document.createElement("h4");
    title.textContent = lyricBlockLabel(block, content.children.length);
    stanza.append(title);
    block.split("\n").forEach((line) => {
      const cleanLine = stripLyricLabel(line);
      if (cleanLine) addLyricsParagraph(stanza, cleanLine);
    });
    content.append(stanza);
  });
}

function renderLyricsSheet() {
  const sheet = $("lyricsSheet");
  if (!sheet) return;
  sheet.classList.toggle("collapsed", !state.lyricsVisible);
  document.body.classList.toggle("lyrics-open", state.lyricsVisible);
  $("lyricsToggle").textContent = "Lyrics";
  $("lyricsToggle").setAttribute("aria-expanded", String(state.lyricsVisible));
  document.querySelectorAll("[data-lyrics-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.lyricsMode === state.lyricsMode);
  });
  const hymn = currentServiceHymn();
  $("lyricsTitle").textContent = hymn?.title || "Choose a hymn";
  $("lyricsMeta").textContent = hymn ? hymnMeta(hymn) : "Lyrics will appear here when the selected hymn has them.";
  renderLyricsContent(hymn);
}

function setOperatorMode(enabled) {
  state.operatorMode = enabled;
  document.body.classList.toggle("operator-mode", enabled);
  const operatorLabel = enabled ? "Exit Operator Mode" : "Operator Mode";
  $("operatorModeBtn").textContent = operatorLabel;
  if ($("operatorModeMobileBtn")) $("operatorModeMobileBtn").textContent = operatorLabel;
  if (enabled) setActiveTab("service");
}

function setServiceLock(enabled) {
  state.serviceLocked = enabled;
  document.body.classList.toggle("service-locked", enabled);
  $("serviceLockBtn").textContent = enabled ? "Unlock Service" : "Lock Service";
  const editTab = document.querySelector('[data-tab="edit"]');
  if (editTab) editTab.disabled = enabled;
  document.querySelector('[data-tab="settings"]').disabled = false;
  $("clearQueueBtn").disabled = enabled;
  document.querySelectorAll(".queue-remove, .queue-move, .arrangement-controls input, .inline-control input").forEach((control) => {
    control.disabled = enabled;
  });
  if (enabled && document.querySelector('[data-panel="edit"]').classList.contains("active-panel")) {
    setActiveTab("service");
  }
  setStatus(enabled ? "Service locked" : "Service unlocked");
}

function isErrorStatus(message) {
  return /\b(error|failed|cannot|required|invalid|missing|unavailable|denied|not found|unlock|cancelled|could not|choose|enter|select)\b/i.test(String(message || ""));
}

function setStatus(message, forceError = false) {
  clearTimeout(state.statusTimer);
  const error = forceError || isErrorStatus(message);
  const status = $("status");
  status.textContent = message || "Ready";
  status.classList.toggle("error", error);
  status.classList.toggle("is-ready", !error && (!message || message === "Ready"));
  addClientLog("app", message);
  if (!error) {
    state.statusTimer = setTimeout(() => {
      status.textContent = "Ready";
      status.classList.remove("error");
      status.classList.add("is-ready");
    }, 2000);
  }
}

function addClientLog(type, message) {
  const report = $("logReport");
  if (!report) return;
  const entry = {
    time: new Date().toISOString(),
    type,
    message
  };
  renderLogEntries([entry, ...state.clientLogs].slice(0, 80));
}

function renderLogEntries(entries) {
  state.clientLogs = entries;
  const report = $("logReport");
  if (!report) return;
  if (!entries.length) {
    report.innerHTML = `<p class="muted">No recent log events.</p>`;
    return;
  }
  report.innerHTML = entries.map((entry) => `
    <div class="log-entry">
      <span class="log-time">${new Date(entry.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
      <span class="log-type">${entry.type || "app"}</span>
      <span class="log-message"></span>
    </div>
  `).join("");
  report.querySelectorAll(".log-message").forEach((node, index) => {
    node.textContent = entries[index].message || "";
  });
}

async function loadLogs() {
  const serverLogs = await api("/api/logs");
  const unique = new Map([...state.clientLogs, ...serverLogs].map((entry) => [`${entry.time}-${entry.type}-${entry.message}`, entry]));
  const merged = [...unique.values()]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 80);
  renderLogEntries(merged);
}

async function loadSystemLogDashboard() {
  const [resources, devices] = await Promise.all([
    api("/api/resources"),
    api("/api/controllers")
  ]);
  const usedMemory = resources.memory.total - resources.memory.free;
  const playback = resources.playback || {};
  renderStatGrid("systemLogStats", [
    { label: "Host", value: resources.hostname || "Unknown" },
    { label: "App Uptime", value: fmtDuration(resources.processUptime) },
    { label: "System Uptime", value: fmtDuration(resources.uptime) },
    { label: "Platform", value: `${resources.platform || "Unknown"} ${resources.arch || ""}`.trim() },
    { label: "Node", value: resources.nodeVersion || "Unknown" },
    { label: "Memory", value: `${fmtBytes(usedMemory)} used` },
    { label: "Storage Free", value: fmtBytes(resources.storage?.free) },
    { label: "Temp", value: resources.temperatureC === null ? "Unavailable" : `${((resources.temperatureC * 9) / 5 + 32).toFixed(1)} F` },
    { label: "Active Devices", value: String(resources.controllers?.active ?? devices.length) },
    { label: "Live Player", value: playback.liveTitle ? `${playback.liveStatus}: ${playback.liveTitle}` : (playback.liveStatus || "stopped") }
  ]);
  renderControllerList($("logDeviceList"), devices);
}

function setLoadedPlanName(name) {
  state.loadedPlanName = name || "";
  $("loadedPlanName").textContent = state.loadedPlanName ? `- ${state.loadedPlanName}` : "";
}

function updateControlValues() {
  $("volumeValue").textContent = `${Math.round(Number($("volume").value) * 100)}%`;
  $("speedValue").textContent = `${Number($("speed").value).toFixed(2)}x`;
}

function fmt(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${min}:${sec}`;
}

function fmtDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m ${total % 60}s`;
}

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      cache: "no-store",
      credentials: "same-origin",
      ...options
    });
  } catch {
    throw new Error("Cannot reach the hymn server. Check Wi-Fi and use the Raspberry Pi network address.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.startsWith("/api/auth/")) showAuthentication("login", body.error || "Your session has expired.");
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

function fileToDataUri(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not preview the selected logo file."));
    reader.readAsDataURL(file);
  });
}

function updateAppearanceLogoPreview(src = "") {
  const preview = $("appearanceLogoPreview");
  if (!preview) return;
  const savedLogo = state.appSettings?.logoDataUri || `/api/logo?cache=${encodeURIComponent(state.appSettings?.customLogoVersion || "current")}`;
  preview.src = src || state.pendingLogoDataUri || savedLogo;
}

function updateLogoControls() {
  const fileName = $("customLogoFileName");
  const saveButton = $("saveLogoBtn");
  const removeButton = $("removeCustomLogoBtn");
  if (fileName) fileName.textContent = state.pendingLogoFile?.name || (state.appSettings?.customLogo ? "Using saved custom logo" : "No new logo selected");
  if (saveButton) saveButton.disabled = !state.pendingLogoFile;
  if (removeButton) removeButton.disabled = !state.pendingLogoFile && !state.appSettings?.customLogo;
}

function showAuthentication(mode = "login", message = "") {
  const screen = $("authScreen");
  if (!screen) return;
  screen.hidden = false;
  $("loginForm").hidden = mode !== "login";
  $("setupAccountsForm").hidden = mode !== "setup";
  $("recoverAccountForm").hidden = mode !== "recover";
  $("recoveryCodeCard").hidden = mode !== "recovery-code";
  $("authTitle").textContent = mode === "setup" ? "Secure First-Time Setup" : mode === "recover" ? "Recover Administrator" : "Hymn Player";
  $("authMessage").textContent = message || (mode === "setup"
    ? "Create administrator and operator accounts before using Hymn Console."
    : "Use your operator or administrator account.");
}

function hideAuthentication() {
  $("authScreen").hidden = true;
}

function updateAccountDisplay() {
  const accountType = state.authUser?.role === "admin" ? "administrator" : "user";
  if ($("accountBadge")) {
    const badge = $("accountBadge");
    badge.replaceChildren();
    if (state.authUser) {
      const username = document.createElement("strong");
      username.textContent = state.authUser.username;
      badge.append(username);
      badge.title = `Signed in as ${state.authUser.username}`;
    } else {
      badge.title = "";
    }
  }
  if ($("securityCurrentUser")) $("securityCurrentUser").textContent = state.authUser ? `${state.authUser.username} (${accountType})` : "Signed out";
}

function setAccountMenu(open) {
  const badge = $("accountBadge");
  const menu = $("accountDropdown");
  if (!badge || !menu) return;
  badge.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    const rect = badge.getBoundingClientRect();
    menu.style.setProperty("--account-menu-top", `${Math.round(rect.bottom + 8)}px`);
    menu.style.setProperty("--account-menu-right", `${Math.max(12, Math.round(window.innerWidth - rect.right))}px`);
  }
  menu.hidden = !open;
}

function hasPermission(permission) {
  return state.authUser?.role === "admin" || Boolean(state.authUser?.permissions?.includes(permission));
}

async function bootstrapAuthentication() {
  try {
    applyTheme(readSetting("hymn-theme", "light"));
    await loadPublicBranding();
    setSplashStatus("Checking secure access...", 8);
    await api("/api/health");
    const status = await api("/api/auth/status");
    if (status.branding) {
      state.appSettings = status.branding;
      applyBrandSettings(status.branding);
    }
    state.permissionCatalog = status.permissions || {};
    if (status.setupRequired) {
      state.pendingAuthMode = "setup";
      state.pendingAuthMessage = "Create the built-in administrator account before using Hymn Console.";
      setSplashCheck("server", "done");
      setSplashStatus("Secure setup is ready", 100);
      $("splashStartBtn").hidden = false;
      return;
    }
    if (!status.authenticated) {
      state.pendingAuthMode = "login";
      state.pendingAuthMessage = "Sign in to continue.";
      setSplashCheck("server", "done");
      setSplashStatus("Secure sign-in is ready", 100);
      $("splashStartBtn").hidden = false;
      return;
    }
    state.authUser = status.user;
    updateAccountDisplay();
    hideAuthentication();
    initializeApp();
  } catch (error) {
    showSplashError(error.message || "Unable to reach Hymn Console.");
  }
}

async function loginAccount(event) {
  event.preventDefault();
  const result = await api("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: $("loginUsername").value.trim(), password: $("loginPassword").value })
  });
  state.authUser = result.user;
  window.location.reload();
}

async function setupAccounts(event) {
  event.preventDefault();
  const result = await api("/api/auth/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      adminUsername: $("setupAdminUsername").value.trim(),
      adminPassword: $("setupAdminPassword").value
    })
  });
  state.authUser = result.user;
  $("recoveryCodeOutput").textContent = result.recoveryCode;
  showAuthentication("recovery-code", "Accounts created successfully.");
}

async function recoverAccount(event) {
  event.preventDefault();
  const result = await api("/api/auth/recover", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: $("recoverUsername").value.trim(),
      recoveryCode: $("recoverCode").value.trim(),
      newPassword: $("recoverPassword").value
    })
  });
  $("recoveryCodeOutput").textContent = result.recoveryCode;
  showAuthentication("recovery-code", "Password reset. Save the replacement recovery code, then sign in.");
}

async function logoutAccount() {
  await api("/api/auth/logout", { method: "POST" });
  window.location.reload();
}

async function loadAccounts() {
  if (!canManageAccounts() || !$("accountList")) return;
  const result = await api("/api/auth/users");
  const users = result.users || [];
  state.permissionCatalog = result.permissions || state.permissionCatalog;
  renderPermissionPicker("newAccountPermissions", Object.keys(state.permissionCatalog), true);
  const list = $("accountList");
  list.innerHTML = "";
  for (const user of users) {
    const row = document.createElement("div");
    row.className = "account-row";
    row.innerHTML = `<div><strong></strong><span></span></div><div class="account-row-actions"><button type="button" data-password>Reset Password</button><button type="button" data-permissions>Edit Permissions</button><button class="danger" type="button" data-delete>Delete</button></div>`;
    row.querySelector("strong").textContent = user.username;
    row.querySelector("span").textContent = user.builtIn ? "Built-in Administrator - Full access" : `User - ${user.permissions.length} permission${user.permissions.length === 1 ? "" : "s"}`;
    row.querySelector("[data-password]").addEventListener("click", () => openAccountPasswordModal(user));
    row.querySelector("[data-password]").hidden = !hasPermission("accounts.resetPassword") || user.role === "admin" || user.builtIn || user.id === state.authUser?.id;
    row.querySelector("[data-permissions]").hidden = !hasPermission("accounts.editPermissions") || user.role === "admin" || user.builtIn;
    row.querySelector("[data-delete]").hidden = !hasPermission("accounts.delete") || user.role === "admin" || user.builtIn;
    row.querySelector("[data-permissions]").addEventListener("click", () => openAccountPermissionsModal(user));
    row.querySelector("[data-delete]").addEventListener("click", () => deleteAccount(user));
    list.append(row);
  }
}

function renderPermissionPicker(containerId, selected = [], useDefaults = false) {
  const container = $(containerId);
  if (!container) return;
  const defaultPermissions = ["playback.control", "playback.remote", "playback.adjust", "audio.device", "audio.soundSystem", "queue.manage", "plans.load", "plans.save", "lyrics.view"];
  const chosen = new Set(useDefaults ? defaultPermissions : selected);
  container.innerHTML = "";
  let currentGroup = "";
  let category = null;
  let categoryItems = null;
  for (const [permission, definition] of Object.entries(state.permissionCatalog)) {
    if (state.authUser?.role !== "admin" && !hasPermission(permission)) continue;
    const details = typeof definition === "string" ? { name: definition, description: definition, group: "Permissions" } : definition;
    if (details.group !== currentGroup) {
      currentGroup = details.group;
      category = document.createElement("details");
      category.className = "permission-category";
      const summary = document.createElement("summary");
      summary.innerHTML = `<span></span><strong>0 selected</strong>`;
      summary.querySelector("span").textContent = currentGroup;
      categoryItems = document.createElement("div");
      categoryItems.className = "permission-category-items";
      category.append(summary, categoryItems);
      container.append(category);
    }
    const control = document.createElement("label");
    control.className = "permission-control";
    control.innerHTML = `<input type="checkbox"><span></span>`;
    control.querySelector("input").value = permission;
    control.querySelector("input").checked = chosen.has(permission);
    control.querySelector("span").textContent = details.name;
    control.title = details.description;
    control.setAttribute("aria-label", `${details.name}. ${details.description}`);
    categoryItems.append(control);
  }
  container.querySelectorAll(".permission-category").forEach((group, index) => {
    const updateCount = () => {
      const count = group.querySelectorAll('input[type="checkbox"]:checked').length;
      group.querySelector("summary strong").textContent = `${count} selected`;
    };
    group.querySelectorAll('input[type="checkbox"]').forEach((input) => input.addEventListener("change", updateCount));
    const groupName = group.querySelector("summary span")?.textContent || "";
    group.open = index === 0 && groupName !== "Service Playback";
    updateCount();
  });
}

function selectedPermissions(containerId) {
  return [...document.querySelectorAll(`#${containerId} input:checked`)].map((input) => input.value);
}

function openAccountPermissionsModal(user) {
  state.pendingPermissionsUser = user;
  $("accountPermissionsTitle").textContent = `Permissions - ${user.username}`;
  renderPermissionPicker("editAccountPermissions", user.permissions);
  $("accountPermissionsModal").hidden = false;
}

function closeAccountPermissionsModal() {
  state.pendingPermissionsUser = null;
  $("accountPermissionsModal").hidden = true;
}

async function saveAccountPermissions() {
  const user = state.pendingPermissionsUser;
  if (!user) return;
  await permissionApi("accounts.editPermissions", `/api/auth/users/${encodeURIComponent(user.id)}/permissions`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ permissions: selectedPermissions("editAccountPermissions") })
  });
  closeAccountPermissionsModal();
  await loadAccounts();
  setStatus(`Permissions saved for ${user.username}`);
}

async function deleteAccount(user) {
  if (!confirm(`Delete user account "${user.username}"?`)) return;
  await permissionApi("accounts.delete", `/api/auth/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
  await loadAccounts();
  setStatus(`User ${user.username} deleted`);
}

function openAccountPasswordModal(user) {
  state.pendingPasswordUser = user;
  $("accountPasswordTitle").textContent = `Reset Password - ${user.username}`;
  $("accountPasswordInput").value = "";
  $("accountPasswordModal").hidden = false;
  $("accountPasswordInput").focus();
}

function closeAccountPasswordModal() {
  state.pendingPasswordUser = null;
  $("accountPasswordModal").hidden = true;
}

async function confirmAccountPassword() {
  const user = state.pendingPasswordUser;
  if (!user) return;
  await permissionApi("accounts.resetPassword", `/api/auth/users/${encodeURIComponent(user.id)}/password`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: $("accountPasswordInput").value })
  });
  closeAccountPasswordModal();
  setStatus(`Password reset for ${user.username}`);
}

async function createAccount() {
  await permissionApi("accounts.create", "/api/auth/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: $("newAccountUsername").value.trim(),
      password: $("newAccountPassword").value,
      permissions: selectedPermissions("newAccountPermissions")
    })
  });
  $("newAccountUsername").value = "";
  $("newAccountPassword").value = "";
  await loadAccounts();
  setStatus("Account created");
}

function fmtBytes(bytes) {
  if (bytes === null || bytes === undefined) return "Unavailable";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function fmtPercent(used, total) {
  if (!total) return "Unavailable";
  return `${Math.round((used / total) * 100)}%`;
}

function isSettingsUnlocked() {
  return state.authUser?.role === "admin";
}

function canManageAccounts() {
  return ["accounts.create", "accounts.delete", "accounts.resetPassword", "accounts.editPermissions"].some(hasPermission);
}

function applyPermissionUi() {
  const show = (id, allowed) => { if ($(id)) $(id).hidden = !allowed; };
  const any = (...permissions) => permissions.some(hasPermission);
  const canControl = hasPermission("playback.control");
  ["prevBtn", "playBtn", "stopBtn", "nextBtn", "repeatBtn"].forEach((id) => {
    if (!$(id)) return;
    $(id).disabled = !canControl;
    if (!canControl) {
      $(id).title = "Your account cannot control playback.";
      $(id).setAttribute("aria-label", "Your account cannot control playback.");
    }
  });
  ["volume", "speed", "fadeIn", "fadeOut", "seek"].forEach((id) => { if ($(id)) $(id).disabled = !hasPermission("playback.adjust"); });
  document.querySelectorAll(".reset-btn").forEach((button) => { button.disabled = !hasPermission("playback.adjust"); });
  if ($("lyricsToggle")) $("lyricsToggle").hidden = !hasPermission("lyrics.view");
  const canAccessPlans = any("plans.load", "plans.save", "plans.delete");
  document.body.classList.toggle("can-access-plans", canAccessPlans);
  if ($("plansBtn")) $("plansBtn").hidden = !canAccessPlans;
  const planControl = document.querySelector(".playback-plan-control");
  if (planControl) planControl.hidden = !canAccessPlans;
  if ($("savePlanBtn")) $("savePlanBtn").hidden = !hasPermission("plans.save");
  if ($("clearQueueBtn")) $("clearQueueBtn").hidden = !hasPermission("queue.manage");
  show("accountCreateTools", hasPermission("accounts.create"));
  show("serviceLockBtn", hasPermission("queue.manage"));
  show("playbackDefaultsPermissionGroup", hasPermission("settings.playback"));
  show("queueAlertsPermissionGroup", hasPermission("queue.alerts"));
  show("saveAudioDefaultsBtn", any("settings.playback", "queue.alerts"));
  show("uploadPermissionGroup", hasPermission("library.uploadMp3"));
  show("csvPermissionGroup", any("library.importCsv", "library.exportCsv"));
  show("downloadLibraryCsvBtn", hasPermission("library.exportCsv"));
  show("libraryCsvUploadLabel", hasPermission("library.importCsv"));
  show("uploadLibraryCsvBtn", hasPermission("library.importCsv"));
  show("lookupPermissionGroup", any("lookup.settings", "openai.clear"));
  show("lookupSettingsFields", hasPermission("lookup.settings"));
  show("saveLookupSettingsBtn", hasPermission("lookup.settings"));
  show("clearOpenAiKeyBtn", hasPermission("openai.clear"));
  show("trashPermissionGroup", any("trash.restore", "trash.empty"));
  show("emptyTrashBtn", hasPermission("trash.empty"));
  show("backupPermissionGroup", any("backups.settings", "backups.download", "backups.run", "backups.restore"));
  show("backupSettingsFields", hasPermission("backups.settings"));
  show("saveBackupSettingsBtn", hasPermission("backups.settings"));
  show("backupBtn", hasPermission("backups.download"));
  show("localBackupBtn", hasPermission("backups.run"));
  document.querySelectorAll(".restore-label").forEach((element) => { element.hidden = !hasPermission("backups.restore"); });
  show("restoreSelectedName", hasPermission("backups.restore"));
  show("restoreSelectedBackupBtn", hasPermission("backups.restore"));
  show("networkPermissionGroup", hasPermission("settings.network"));
  show("restartAppBtn", hasPermission("system.restartApp"));
  show("restartPiBtn", hasPermission("system.restartPi"));
  show("rustDeskStatus", hasPermission("remote.support"));
  show("resetLogBtn", hasPermission("logs.reset"));
  if (!isSettingsUnlocked()) {
    show("downloadDiagnosticsBtn", false);
    show("systemCheckBtn", false);
  }
  document.querySelectorAll("#audioOutput option").forEach((option) => {
    if (option.value === "device") option.disabled = !hasPermission("audio.device");
    if (option.value === "server") option.disabled = !hasPermission("audio.soundSystem");
  });
  $("audioOutput").disabled = !any("audio.device", "audio.soundSystem");
  if ((state.audioOutput === "device" && !hasPermission("audio.device")) || (state.audioOutput === "server" && !hasPermission("audio.soundSystem"))) {
    state.audioOutput = hasPermission("audio.soundSystem") ? "server" : hasPermission("audio.device") ? "device" : "";
    $("audioOutput").value = state.audioOutput;
    if (state.audioOutput) writeSetting("hymn-audio-output", state.audioOutput);
  }
  renderLibrary();
  renderQueue();
}

function isProtectedSettingsSection(section) {
  const title = section.querySelector("h3")?.textContent.trim();
  return ["Playback Defaults", "Library Management", "Network & System", "Appearance", "System Log"].includes(title);
}

function updateSettingsLockState() {
  const locked = !isSettingsUnlocked();
  document.body.classList.toggle("settings-locked", locked);
  document.body.classList.toggle("admin-mode", !locked);
  if ($("securityCurrentUser")) $("securityCurrentUser").textContent = state.authUser ? `${state.authUser.username} (${state.authUser.role})` : "Signed out";
  if ($("accountAdminTools")) $("accountAdminTools").hidden = !canManageAccounts();
  $("settingsSearch").hidden = false;
  const sectionPermissions = {
    "Playback Defaults": ["settings.playback", "queue.alerts"],
    "Library Management": ["library.uploadMp3", "library.importCsv", "library.exportCsv", "trash.restore", "trash.empty", "lookup.settings", "openai.clear", "backups.settings", "backups.download", "backups.run", "backups.restore"],
    "Network & System": ["settings.network", "system.restartApp", "system.restartPi", "remote.support"],
    "Appearance": ["settings.appearance"],
    "System Log": ["logs.reset"]
  };
  document.querySelectorAll(".settings-section").forEach((section) => {
    const title = section.querySelector("h3")?.textContent.trim();
    const required = sectionPermissions[title];
    section.dataset.permissionHidden = String(Boolean(required && !required.some(hasPermission)));
    section.hidden = section.dataset.permissionHidden === "true";
  });
  if (canManageAccounts()) loadAccounts().catch((error) => setStatus(error.message));
  loadRustDeskStatus().catch(() => {});
}

async function adminApi(path, options = {}) {
  if (!isSettingsUnlocked()) throw new Error("Administrator access required.");
  return api(path, options);
}

async function permissionApi(permission, path, options = {}) {
  if (!hasPermission(permission)) throw new Error("Your account does not have permission for this feature.");
  return api(path, options);
}

function playDeviceAudio() {
  const result = audio.play();
  if (!result || typeof result.then !== "function") {
    fadeTo(Number($("volume").value), Number($("fadeIn").value));
    setPlayButtonState("pause");
    publishLivePlayback("playing", true);
    return;
  }
  result
    .then(() => {
      fadeTo(Number($("volume").value), Number($("fadeIn").value));
      setPlayButtonState("pause");
      publishLivePlayback("playing", true);
    })
    .catch((error) => {
      setPlayButtonState("play");
      setStatus(error?.message ? `Audio did not start: ${error.message}` : "Tap Play again to start audio on this device");
    });
}

async function loadHymns() {
  state.hymns = await api("/api/hymns");
  renderLibrary();
  renderDetails();
  renderQueue();
  renderLyricsSheet();
  setStatus("Library loaded");
}

async function loadServicePlans() {
  state.servicePlans = await api("/api/service-plans");
  renderPlanManager();
}

async function loadServiceQueue() {
  state.queue = await api("/api/service-queue");
  if (state.queue.length && (state.queueIndex < 0 || state.queueIndex >= state.queue.length)) {
    const item = state.queue[0];
    const hymn = state.hymns.find((h) => h.id === item?.hymnId);
    if (hymn) {
      state.queueIndex = 0;
      playHymn(hymn, makeSegmentPlan(hymn, item), false);
    }
  }
  renderQueue();
}

function applyAppSettings(settings) {
  state.appSettings = settings;
  const network = settings.network || {};
  const storage = settings.storage || {};
  const backup = settings.backup || {};
  const defaults = settings.audioDefaults || CONTROL_DEFAULTS;
  CONTROL_DEFAULTS.volume = Number(defaults.volume ?? CONTROL_DEFAULTS.volume);
  CONTROL_DEFAULTS.speed = Number(defaults.speed ?? CONTROL_DEFAULTS.speed);
  CONTROL_DEFAULTS.fadeIn = Number(defaults.fadeIn ?? CONTROL_DEFAULTS.fadeIn);
  CONTROL_DEFAULTS.fadeOut = Number(defaults.fadeOut ?? CONTROL_DEFAULTS.fadeOut);
  $("defaultVolume").value = Math.round(CONTROL_DEFAULTS.volume * 100);
  $("defaultSpeed").value = CONTROL_DEFAULTS.speed.toFixed(2);
  $("defaultFadeIn").value = CONTROL_DEFAULTS.fadeIn;
  $("defaultFadeOut").value = CONTROL_DEFAULTS.fadeOut;
  $("serviceQueueAlertsEnabled").checked = settings.serviceQueueAlertsEnabled !== false;
  $("volume").value = CONTROL_DEFAULTS.volume;
  $("speed").value = CONTROL_DEFAULTS.speed;
  $("fadeIn").value = CONTROL_DEFAULTS.fadeIn;
  $("fadeOut").value = CONTROL_DEFAULTS.fadeOut;
  $("displayModeSelect").value = settings.displayMode || "standard";
  $("networkModeSelect").value = network.mode || "dhcp";
  $("customIpAddress").value = network.preferredUrl || state.detectedNetwork?.preferredUrl || "";
  $("customDnsName").value = settings.dnsName || network.dnsName || "hymnconsole";
  $("customSubnet").value = network.subnet || "";
  $("customGateway").value = network.gateway || "";
  $("customNetworkNotes").value = network.notes || "";
  $("storageModeSelect").value = storage.mode || "internal";
  $("usbStoragePath").value = storage.usbPath || "";
  $("backupTargetPath").value = backup.targetPath || "";
  $("backupRetentionDays").value = Number(backup.retentionDays || 14);
  $("autoLookupEnabled").checked = settings.autoLookup?.enabled !== false;
  $("builtInAiLookupEnabled").checked = Boolean(settings.autoLookup?.builtInAiEnabled);
  $("aiWebSearchEnabled").checked = settings.autoLookup?.webSearch !== false;
  $("aiSmartBuildEnabled").checked = settings.autoLookup?.smartBuild !== false;
  $("openAiModel").value = settings.autoLookup?.model || "gpt-4.1-mini";
  $("openAiApiKey").value = "";
  $("openAiKeyStatus").textContent = settings.openAiApiKeyConfigured ? "OpenAI API key is saved." : "No OpenAI API key saved.";
  $("autoLookupUpload").checked = settings.autoLookup?.enabled !== false;
  document.body.dataset.displayMode = settings.displayMode || "standard";
  const storedAudioOutput = readSetting("hymn-audio-output", "server");
  let savedAudioOutput = ["server", "device"].includes(storedAudioOutput) ? storedAudioOutput : "server";
  if (savedAudioOutput === "server" && state.serverPlatform && state.serverPlatform !== "linux" && hasPermission("audio.device")) {
    savedAudioOutput = "device";
    writeSetting("hymn-audio-output", savedAudioOutput);
  }
  state.audioOutput = savedAudioOutput;
  $("audioOutput").value = savedAudioOutput;
  applyBrandSettings(settings);
  updateAppearanceLogoPreview();
  updateLogoControls();
  updateSettingsLockState();
  applyPermissionUi();
  updateNetworkModeFields();
  updateStorageModeFields();
  updateControlValues();
  renderHealthPanel();
}

async function loadSettings() {
  applyAppSettings(await api("/api/settings"));
  loadRustDeskStatus().catch(() => {});
}

async function saveSettingsPatch(patch) {
  const saved = await api("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch)
  });
  applyAppSettings(saved);
  setStatus("Settings saved");
}

function updateUploadDestination(data) {
  const destination = $("uploadDestination");
  if (!destination || !data) return;
  const mode = data.storageMode === "usb" ? "USB storage" : "internal storage";
  destination.textContent = data.error
    ? `Upload destination problem: ${data.error}`
    : `Uploads will save to ${mode}: ${data.mediaPath}`;
  destination.classList.toggle("error-text", Boolean(data.error));
}

function comparableStoragePath(value) {
  return String(value || "").trim().replace(/[\\/]+$/, "");
}

async function getUploadStorageStatus() {
  const data = await api("/api/storage");
  updateUploadDestination(data);
  return data;
}

function setupSettingsAccordions() {
  const panel = document.querySelector(".settings-panel");
  const order = [
    "Accounts & Security",
    "Playback Defaults",
    "Library Management",
    "Network & System",
    "Appearance",
    "System Log"
  ];
  const summaries = {
    "Accounts & Security": "Create users and assign feature-by-feature permissions.",
    "Playback Defaults": "Set default volume, speed, and fades.",
    "Library Management": "Upload, restore, back up, and manage hymns.",
    "Network & System": "Check Raspberry Pi health, storage, and network.",
    "Appearance": "Choose palette, display size, logo, and app name.",
    "System Log": "Review recent app activity and maintenance events."
  };
  [...document.querySelectorAll(".settings-section")]
    .sort((a, b) => order.indexOf(a.querySelector("h3")?.textContent.trim()) - order.indexOf(b.querySelector("h3")?.textContent.trim()))
    .forEach((section) => panel.append(section));
  document.querySelectorAll(".settings-section").forEach((section, index) => {
    if (section.dataset.accordionReady) return;
    section.dataset.accordionReady = "true";
    let row = section.querySelector(":scope > .section-title-row");
    let title = row?.querySelector("h3") || section.querySelector(":scope > h3");
    if (!title) return;
    const existingHeaderActions = row
      ? [...row.children].filter((child) => child !== title && !child.classList.contains("collapse-btn"))
      : [];
    if (!row) {
      row = document.createElement("div");
      row.className = "section-title-row";
      title.replaceWith(row);
      row.append(title);
    }
    const body = document.createElement("div");
    body.className = "settings-body";
    const titleText = title.textContent.trim();
    const titleCopy = document.createElement("div");
    titleCopy.className = "settings-title-copy";
    const summary = document.createElement("p");
    summary.className = "settings-summary";
    summary.textContent = summaries[titleText] || "Manage this part of Hymn Console.";
    title.replaceWith(titleCopy);
    titleCopy.append(title, summary);
    const siblings = [...section.childNodes].filter((node) => node !== row);
    siblings.forEach((node) => body.append(node));
    existingHeaderActions.forEach((node) => body.prepend(node));
    section.append(body);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "collapse-btn";
    toggle.textContent = "Show";
    toggle.setAttribute("aria-expanded", "false");
    row.append(toggle);
    body.classList.add("collapsed");
    toggle.addEventListener("click", () => {
      const collapsed = body.classList.toggle("collapsed");
      toggle.textContent = collapsed ? "Show" : "Hide";
      toggle.setAttribute("aria-expanded", String(!collapsed));
    });
  });
}

function filterSettingsSections() {
  const query = $("settingsSearch").value.trim().toLowerCase();
  document.querySelectorAll(".settings-section").forEach((section) => {
    if (section.dataset.permissionHidden === "true") {
      section.hidden = true;
      return;
    }
    const text = section.textContent.toLowerCase();
    section.hidden = query && !text.includes(query);
  });
}

async function saveServiceQueue() {
  await api("/api/service-queue", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state.queue)
  });
}

function syncServiceQueue() {
  saveServiceQueue().catch((error) => setStatus(error.message));
}

function renderPlanManager() {
  const manager = $("planManager");
  if (!manager) return;
  manager.innerHTML = "";
  if (!state.servicePlans.length) {
    manager.innerHTML = `<p class="muted">No saved plans yet.</p>`;
    return;
  }
  for (const plan of state.servicePlans) {
    const canManagePlans = hasPermission("plans.delete");
    const row = document.createElement("article");
    row.className = "plan-row";
    row.innerHTML = `
      <div>
        <strong></strong>
        <span></span>
      </div>
      <div class="plan-row-actions">
        <button type="button" data-plan-load>Load</button>
        ${canManagePlans ? `<button class="danger" type="button" data-plan-delete>Delete</button>` : ""}
      </div>
    `;
    row.querySelector("strong").textContent = plan.name || "Untitled plan";
    row.querySelector("span").textContent = `${(plan.queue || []).length} hymns - ${new Date(plan.updatedAt || Date.now()).toLocaleDateString()}`;
    row.querySelector("[data-plan-load]").hidden = !hasPermission("plans.load");
    row.querySelector("[data-plan-load]").addEventListener("click", () => loadPlan(plan.id).catch((error) => setStatus(error.message)));
    const deleteButton = row.querySelector("[data-plan-delete]");
    if (deleteButton) {
      deleteButton.disabled = state.serviceLocked;
      deleteButton.title = state.serviceLocked ? "Unlock the service before deleting plans" : `Delete ${plan.name || "saved plan"}`;
      deleteButton.addEventListener("click", () => deletePlan(plan.id).catch((error) => setStatus(error.message)));
    }
    manager.append(row);
  }
}

function hymnMeta(hymn) {
  const bits = [];
  if (hymn.page) bits.push(`Page ${hymn.page}`);
  if (hymn.key) bits.push(`Key ${hymn.key}`);
  if (hymn.tempo) bits.push(`${hymn.tempo} bpm`);
  if (hymn.themes) bits.push(String(hymn.themes).split(",").map((item) => item.trim()).filter(Boolean).slice(0, 2).join(", "));
  return bits.join(" - ") || "No page info yet";
}

function pageNumber(value) {
  const found = String(value || "").match(/\d+/);
  return found ? Number(found[0]) : Number.MAX_SAFE_INTEGER;
}

function filteredHymns() {
  const query = $("searchInput").value.trim().toLowerCase();
  const themeQuery = $("themeSearchInput").value.trim().toLowerCase();
  const letter = state.letterFilter;
  return state.hymns
    .filter((hymn) => {
      const themes = String(hymn.themes || "").toLowerCase();
      const haystack = [hymn.title, hymn.page, hymn.key, hymn.tempo, hymn.themes, hymn.notes].join(" ").toLowerCase();
      const first = (hymn.title || "#").trim()[0]?.toUpperCase() || "#";
      const letterOk = !letter || (letter === "#" ? !/[A-Z]/.test(first) : first === letter);
      const themeOk = !themeQuery || themes.includes(themeQuery);
      return haystack.includes(query) && themeOk && letterOk;
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

function renderThemeOptions() {
  const options = $("themeOptions");
  if (!options) return;
  const themes = new Set();
  state.hymns.forEach((hymn) => {
    String(hymn.themes || "").split(",").map((item) => item.trim()).filter(Boolean).forEach((theme) => themes.add(theme));
  });
  options.innerHTML = "";
  [...themes].sort((a, b) => a.localeCompare(b)).forEach((theme) => {
    const option = document.createElement("option");
    option.value = theme;
    options.append(option);
  });
}

function renderAzJump(hymns) {
  const letters = new Set(hymns.map((hymn) => (hymn.title || "#").trim()[0]?.toUpperCase()).filter(Boolean));
  $("azJump").innerHTML = "";
  ["All", "#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].forEach((letter) => {
    const enabled = letter === "All" || Array.from(letters).some((item) => letter === "#" ? !/[A-Z]/.test(item) : item === letter);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = letter;
    button.classList.toggle("primary", state.letterFilter === letter || (letter === "All" && !state.letterFilter));
    button.disabled = !enabled;
    button.addEventListener("click", () => {
      state.letterFilter = letter === "All" ? "" : letter;
      state.visibleHymns = LIBRARY_PAGE_SIZE;
      renderLibrary();
    });
    $("azJump").append(button);
  });
}

function renderLibrary() {
  const hymns = filteredHymns();
  const visible = hymns.slice(0, state.visibleHymns);
  $("libraryCount").textContent = `${hymns.length} shown of ${state.hymns.length}`;
  renderThemeOptions();
  renderAzJump(state.hymns);
  hymnList.innerHTML = "";
  hymnList.classList.remove("compact");
  for (const hymn of visible) {
    const node = $("hymnTemplate").content.firstElementChild.cloneNode(true);
    const main = node.querySelector(".hymn-main");
    main.innerHTML = `<span class="hymn-title"></span><span class="hymn-meta"></span>`;
    main.querySelector(".hymn-title").textContent = hymn.title;
    main.querySelector(".hymn-meta").textContent = hymnMeta(hymn);
  if (hasPermission("hymns.edit")) main.addEventListener("click", () => selectHymn(hymn.id));
    else main.title = "Your account cannot edit hymns";
    const addButton = node.querySelector(".add");
    addButton.dataset.hymnId = hymn.id;
    addButton.hidden = !hasPermission("queue.manage");
    addButton.setAttribute("aria-label", `Add ${hymn.title} to service queue`);
    hymnList.append(node);
  }
  if (!visible.length) hymnList.innerHTML = `<p class="muted">No hymns match those filters.</p>`;
  $("loadMoreBtn").hidden = hymns.length <= state.visibleHymns;
}

async function saveBulkEditor() {
  const updates = [...document.querySelectorAll(".bulk-row[data-id]")].map((row) => ({
    id: row.dataset.id,
    title: row.querySelector('[data-field="title"]').value.trim(),
    page: row.querySelector('[data-field="page"]').value.trim(),
    key: row.querySelector('[data-field="key"]').value.trim(),
    tempo: row.querySelector('[data-field="tempo"]').value.trim(),
    themes: row.querySelector('[data-field="themes"]').value.trim(),
    defaultVerses: Number(row.querySelector('[data-field="defaultVerses"]').value || 3),
    hasChorus: row.querySelector('[data-field="hasChorus"]').checked
  }));
  state.hymns = await permissionApi("hymns.edit", "/api/hymns", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(updates)
  });
  renderLibrary();
  renderQueue();
  setStatus("Cleanup saved");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const LIBRARY_CSV_FIELDS = [
  { key: "id", label: "ID" },
  { key: "title", label: "Title" },
  { key: "page", label: "Page" },
  { key: "key", label: "Key" },
  { key: "tempo", label: "Tempo" },
  { key: "defaultVerses", label: "Default Verses" },
  { key: "themes", label: "Themes" },
  { key: "notes", label: "Notes" },
  { key: "lyrics", label: "Lyrics" },
  {
    key: "defaultVolume",
    label: "Default Volume",
    exportValue: (hymn) => Math.round(Number(hymn.defaultVolume ?? CONTROL_DEFAULTS.volume) * 100)
  },
  {
    key: "defaultSpeed",
    label: "Default Speed",
    exportValue: (hymn) => Number(hymn.defaultSpeed ?? CONTROL_DEFAULTS.speed).toFixed(2)
  },
  { key: "fadeIn", label: "Fade In" },
  { key: "fadeOut", label: "Fade Out" },
  { key: "duration", label: "Track Length" },
  { key: "hasChorus", label: "Has Chorus" }
];

function csvHeaderKey(header) {
  const normalized = String(header || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliases = {
    defaultverse: "defaultVerses",
    defaultverses: "defaultVerses",
    volume: "defaultVolume",
    defaultvolume: "defaultVolume",
    speed: "defaultSpeed",
    defaultspeed: "defaultSpeed",
    fadein: "fadeIn",
    fadeout: "fadeOut",
    tracklength: "duration",
    length: "duration",
    duration: "duration",
    haschorus: "hasChorus",
    chorus: "hasChorus"
  };
  return aliases[normalized] || LIBRARY_CSV_FIELDS.find((field) => field.key.toLowerCase() === normalized)?.key || normalized;
}

function parseVolumeCsvValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return CONTROL_DEFAULTS.volume;
  return Math.max(0, Math.min(1, number > 1 ? number / 100 : number));
}

function hasCsvField(item, field) {
  return Object.prototype.hasOwnProperty.call(item, field);
}

function downloadLibraryCsv() {
  const rows = [LIBRARY_CSV_FIELDS.map((field) => csvEscape(field.label)).join(",")].concat(state.hymns.map((hymn) => (
    LIBRARY_CSV_FIELDS.map((field) => csvEscape(field.exportValue ? field.exportValue(hymn) : hymn[field.key])).join(",")
  )));
  const blob = new Blob([`${rows.join("\r\n")}\r\n`], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `hymn-library-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  setStatus("Song CSV downloaded");
}

function parseCsvText(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      cell += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

async function uploadLibraryCsv() {
  const file = $("libraryCsvInput").files[0];
  if (!file) {
    setStatus("Choose a song CSV first");
    return;
  }
  const rows = parseCsvText(await file.text());
  const headers = rows.shift().map(csvHeaderKey);
  const updates = rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])))
    .filter((item) => item.id)
    .map((item) => {
      const update = {
        id: item.id,
        title: item.title,
        page: item.page,
        key: item.key,
        tempo: item.tempo,
        themes: item.themes,
        notes: item.notes
      };
      if (hasCsvField(item, "defaultVerses")) update.defaultVerses = Number(item.defaultVerses || 3);
      if (hasCsvField(item, "hasChorus")) update.hasChorus = String(item.hasChorus).toLowerCase() !== "false";
      if (hasCsvField(item, "lyrics")) update.lyrics = item.lyrics;
      if (hasCsvField(item, "defaultVolume")) update.defaultVolume = parseVolumeCsvValue(item.defaultVolume);
      if (hasCsvField(item, "defaultSpeed")) update.defaultSpeed = Number(item.defaultSpeed || CONTROL_DEFAULTS.speed);
      if (hasCsvField(item, "fadeIn")) update.fadeIn = Number(item.fadeIn || 0);
      if (hasCsvField(item, "fadeOut")) update.fadeOut = Number(item.fadeOut || 0);
      if (hasCsvField(item, "duration")) update.duration = Number(item.duration || 0);
      return update;
    });
  state.hymns = await permissionApi("library.importCsv", "/api/hymns?source=csv", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(updates)
  });
  $("libraryCsvInput").value = "";
  renderLibrary();
  renderQueue();
  setStatus(`Song CSV applied for ${updates.length} hymn${updates.length === 1 ? "" : "s"}`);
}

function selectHymn(id) {
  if (!hasPermission("hymns.edit")) {
    setStatus("Your account cannot edit hymns");
    return;
  }
  state.selectedId = id;
  renderDetails();
  setActiveTab("edit");
}

function addToQueue(id) {
  if (!hasPermission("queue.manage")) {
    setStatus("Your account cannot change the service queue");
    return;
  }
  const hymn = state.hymns.find((item) => item.id === id);
  if (!hymn) return;
  state.queue.push({
    id: makeId(),
    hymnId: id,
    title: hymn.title,
    verses: Number(hymn.defaultVerses || 3),
    includeIntro: true,
    includeVerses: true,
    includeChorus: hymn.hasChorus !== false
  });
  renderQueue();
  syncServiceQueue();
  setStatus(`${hymn.title} added`);
  setActiveTab("service");
}

function renderQueue() {
  queueEl.innerHTML = "";
  if (!state.queue.length) {
    queueEl.innerHTML = `<p class="muted">No hymns queued yet.</p>`;
    renderHealthPanel();
    return;
  }
  state.queue.forEach((item, index) => {
    const canManageQueue = hasPermission("queue.manage");
    const hymn = state.hymns.find((h) => h.id === item.hymnId);
    const row = document.createElement("article");
    row.className = "queue-item";
    row.classList.toggle("selected", index === state.queueIndex);
    row.innerHTML = `
      <div class="queue-order">
        <span class="queue-number">${index + 1}</span>
        <div class="queue-move-group">
          <button class="queue-move" type="button" data-move="up" title="Move up" aria-label="Move up">↑</button>
          <button class="queue-move" type="button" data-move="down" title="Move down" aria-label="Move down">↓</button>
        </div>
      </div>
      <div class="queue-main" role="button" tabindex="0">
        <div class="queue-title-row">
          <div>
            <span class="hymn-title"></span>
            <span class="hymn-meta"></span>
          </div>
          <label class="inline-control"><span>Verses</span><input type="number" min="0" max="12" value="${item.verses}"></label>
        </div>
        <div class="arrangement-controls" aria-label="Song parts">
          <label><input type="checkbox" data-part="intro" ${item.includeIntro !== false ? "checked" : ""}> <span>Intro</span></label>
          <label><input type="checkbox" data-part="verses" ${item.includeVerses !== false ? "checked" : ""}> <span>Verses</span></label>
          <label><input type="checkbox" data-part="chorus" ${item.includeChorus !== false ? "checked" : ""}> <span>Chorus</span></label>
        </div>
      </div>
      <button class="queue-remove" title="Remove" aria-label="Remove">&times;</button>
    `;
    row.querySelector(".hymn-title").textContent = item.title;
    row.querySelector(".hymn-meta").textContent = hymn ? `${hymnMeta(hymn)} - ${arrangementSummary(item)}` : "Missing hymn";
    row.querySelector(".queue-main").addEventListener("click", (event) => {
      if (!["INPUT", "BUTTON", "LABEL"].includes(event.target.tagName)) {
        if (hasPermission("playback.control")) selectQueueIndex(index);
        else setStatus("Your account cannot control playback");
      }
    });
    row.querySelector('[data-move="up"]').disabled = index === 0;
    row.querySelector('[data-move="down"]').disabled = index === state.queue.length - 1;
    row.querySelectorAll("[data-move], .inline-control input, [data-part], .queue-remove").forEach((control) => {
      control.disabled = control.disabled || !canManageQueue;
    });
    row.querySelectorAll("[data-move]").forEach((button) => {
      button.addEventListener("click", () => moveQueueItem(index, button.dataset.move === "up" ? -1 : 1));
    });
    row.querySelector(".inline-control input").addEventListener("change", (event) => {
      if (state.serviceLocked) return;
      item.verses = Number(event.target.value || 0);
      renderQueue();
      syncServiceQueue();
    });
    row.querySelectorAll("[data-part]").forEach((input) => {
      input.addEventListener("change", () => {
        if (state.serviceLocked) return;
        item.includeIntro = row.querySelector('[data-part="intro"]').checked;
        item.includeVerses = row.querySelector('[data-part="verses"]').checked;
        item.includeChorus = row.querySelector('[data-part="chorus"]').checked;
        renderQueue();
        syncServiceQueue();
      });
    });
    row.querySelector(".queue-remove").addEventListener("click", () => {
      if (state.serviceLocked) {
        setStatus("Unlock service before removing hymns");
        return;
      }
      if (!confirm(`Remove "${item.title}" from the service queue?`)) return;
      state.queue.splice(index, 1);
      if (state.queueIndex === index) {
        resetPlayerSelection();
      } else if (state.queueIndex > index) {
        state.queueIndex -= 1;
      }
      renderQueue();
      syncServiceQueue();
    });
    queueEl.append(row);
  });
  if (state.serviceLocked) setServiceLock(true);
  renderHealthPanel();
}

function moveQueueItem(index, direction) {
  if (state.serviceLocked) {
    setStatus("Unlock service before reordering");
    return;
  }
  const next = index + direction;
  if (next < 0 || next >= state.queue.length) return;
  const [item] = state.queue.splice(index, 1);
  state.queue.splice(next, 0, item);
  if (state.queueIndex === index) state.queueIndex = next;
  else if (state.queueIndex === next) state.queueIndex = index;
  renderQueue();
  syncServiceQueue();
}

function renderHealthPanel() {
  const panel = $("healthPanel");
  if (!panel) return;
  panel.innerHTML = "";
  if (state.appSettings?.serviceQueueAlertsEnabled === false) {
    clearTimeout(state.healthTimer);
    return;
  }
  const issues = queueHealthIssues();
  if (!state.queue.length) {
    return;
  }
  if (!issues.length) {
    clearTimeout(state.healthTimer);
    return;
  }
  clearTimeout(state.healthTimer);
  for (const issue of issues) {
    const item = document.createElement("div");
    item.className = `health-item ${issue.level}`;
    item.textContent = issue.message;
    panel.append(item);
  }
}

function queueHealthIssues() {
  const issues = [];
  const seen = new Set();
  state.queue.forEach((item, index) => {
    const hymn = state.hymns.find((candidate) => candidate.id === item.hymnId);
    const label = item.title || `Queue item ${index + 1}`;
    if (!hymn) {
      issues.push({ level: "bad", message: `${label}: hymn is missing from the library.` });
      return;
    }
    if (seen.has(hymn.id)) issues.push({ level: "warn", message: `${hymn.title}: appears more than once in the queue.` });
    seen.add(hymn.id);
    const segments = hymn.segments || [];
    if (!segments.length) {
      issues.push({ level: "warn", message: `${hymn.title}: no Smart Build structure saved, so arrangements play the full MP3.` });
      return;
    }
    if (item.includeIntro !== false && !segments.some((segment) => segment.type === "intro")) {
      issues.push({ level: "warn", message: `${hymn.title}: intro is selected but no intro segment exists.` });
    }
    if (item.includeVerses !== false && Number(item.verses || 0) > 0 && !segments.some((segment) => segment.type === "verse")) {
      issues.push({ level: "warn", message: `${hymn.title}: verses are selected but no verse segments exist.` });
    }
    if (item.includeChorus !== false && !segments.some((segment) => segment.type === "chorus")) {
      issues.push({ level: "warn", message: `${hymn.title}: chorus is selected but no chorus segment exists.` });
    }
    if (arrangementSummary(item) === "no parts selected") {
      issues.push({ level: "bad", message: `${hymn.title}: no parts are selected for playback.` });
    }
  });
  return issues.slice(0, 8);
}

function arrangementSummary(item) {
  const parts = [];
  if (item.includeIntro !== false) parts.push("intro");
  if (item.includeVerses !== false && Number(item.verses || 0) > 0) parts.push(`${item.verses} verse${Number(item.verses) === 1 ? "" : "s"}`);
  if (item.includeChorus !== false) parts.push("chorus");
  return parts.join(" + ") || "no parts selected";
}

function applyArrangementPreset(item, preset, hymn) {
  if (preset === "full") {
    item.includeIntro = true;
    item.includeVerses = true;
    item.includeChorus = hymn?.hasChorus !== false;
    item.verses = Number(item.verses || hymn?.defaultVerses || 3);
  }
  if (preset === "verses") {
    item.includeIntro = false;
    item.includeVerses = true;
    item.includeChorus = false;
    item.verses = Number(item.verses || hymn?.defaultVerses || 3);
  }
  if (preset === "chorus") {
    item.includeIntro = false;
    item.includeVerses = false;
    item.includeChorus = true;
    item.verses = 0;
  }
}

function renderDetails() {
  const panel = $("detailsPanel");
  const hymn = state.hymns.find((item) => item.id === state.selectedId);
  if (!hymn) {
    panel.innerHTML = `<h2>Hymn Details</h2><p class="muted">Select a hymn to edit page numbers, notes, and playback structure.</p>`;
    return;
  }
  panel.innerHTML = `
    <h2>Edit Hymn</h2>
    <label><span>Title</span><input id="editTitle"></label>
    <div class="edit-grid">
      <label><span>Page</span><input id="editPage"></label>
      <label><span>Key</span><input id="editKey"></label>
      <label><span>Tempo</span><input id="editTempo"></label>
      <label><span>Default Verses</span><input id="editVerses" type="number" min="1" max="12"></label>
    </div>
    <label><span>Themes</span><input id="editThemes" placeholder="Invitation, Christmas, Communion"></label>
    <label><span>Notes</span><textarea id="editNotes"></textarea></label>
    <label><span>Lyrics</span><textarea id="editLyrics" placeholder="Paste lyrics here"></textarea></label>
    <div class="structure-grid">
      <label><span>Default Volume</span><input id="editVolume" type="number" min="0" max="100" step="1"></label>
      <label><span>Default Speed</span><input id="editSpeed" type="number" min="0.75" max="1.25" step="0.01"></label>
      <label><span>Fade In</span><input id="editFadeIn" type="number" min="0" max="15" step="0.5"></label>
      <label><span>Fade Out</span><input id="editFadeOut" type="number" min="0" max="20" step="0.5"></label>
    </div>
    <div class="edit-lower-controls">
      <div class="track-actions-row">
        <label><span>Track Length</span><input id="editDuration" type="number" min="1" step="1" placeholder="Seconds"></label>
        <label class="edit-delete-slot"><span>&nbsp;</span><button id="deleteHymnBtn" class="danger" type="button">Delete</button></label>
      </div>
      <label class="check-control"><input id="editChorus" type="checkbox"><span>Has chorus between verses</span></label>
      <div class="detail-actions">
        <div class="detail-action-row primary-actions">
          <button id="saveHymnBtn" class="primary">Save Details</button>
          <button id="resetHymnAudioBtn">Reset Audio Defaults</button>
        </div>
        <div class="detail-action-row utility-actions">
          <button id="playHymnBtn">Play</button>
          <button id="queueHymnBtn">Add to Queue</button>
          <button id="lookupHymnBtn">Auto Lookup</button>
        </div>
      </div>
      <div class="structure-actions-card">
        <div>
          <h2>Structure Builder</h2>
          <p class="muted">Analyze the MP3 and create editable intro, verse, and chorus timings.</p>
        </div>
        <div class="segment-actions">
          <button id="buildSegmentsBtn">Smart Build</button>
          <button id="clearSegmentsBtn">Clear Segments</button>
        </div>
      </div>
      <div class="segments" id="segments"></div>
    </div>
  `;
  $("editTitle").value = hymn.title || "";
  $("editPage").value = hymn.page || "";
  $("editKey").value = hymn.key || "";
  $("editTempo").value = hymn.tempo || "";
  $("editVerses").value = hymn.defaultVerses || 3;
  $("editThemes").value = hymn.themes || "";
  $("editNotes").value = hymn.notes || "";
  $("editLyrics").value = hymn.lyrics || "";
  $("editVolume").value = Math.round(Number(hymn.defaultVolume ?? CONTROL_DEFAULTS.volume) * 100);
  $("editSpeed").value = Number(hymn.defaultSpeed ?? CONTROL_DEFAULTS.speed).toFixed(2);
  $("editFadeIn").value = hymn.fadeIn ?? 1.5;
  $("editFadeOut").value = hymn.fadeOut ?? 2;
  $("editDuration").value = hymn.duration || "";
  $("editChorus").checked = hymn.hasChorus !== false;
  $("deleteHymnBtn").hidden = !hasPermission("hymns.delete");
  $("queueHymnBtn").hidden = !hasPermission("queue.manage");
  $("playHymnBtn").hidden = !hasPermission("playback.control") || !hasPermission("audio.device");
  $("saveHymnBtn").addEventListener("click", saveSelectedHymn);
  $("resetHymnAudioBtn").addEventListener("click", resetSelectedHymnAudioDefaults);
  updateDetailPlayButton();
  $("playHymnBtn").addEventListener("click", () => {
    if (state.liveHymnId === hymn.id && !audio.paused) {
      stopDetailPreview();
      return;
    }
    playHymn(hymn);
  });
  $("queueHymnBtn").addEventListener("click", () => addToQueue(hymn.id));
  $("lookupHymnBtn").addEventListener("click", () => runLookupForHymn(hymn).catch((error) => setStatus(error.message)));
  $("deleteHymnBtn").addEventListener("click", deleteSelectedHymn);
  $("buildSegmentsBtn").addEventListener("click", buildSegments);
  $("clearSegmentsBtn").addEventListener("click", async () => {
    hymn.segments = [];
    await saveHymnPatch(hymn, { segments: [] });
  });
  renderSegments(hymn);
}

function renderSegments(hymn) {
  const wrap = $("segments");
  if (!wrap) return;
  wrap.innerHTML = "";
  if (!hymn.segments?.length) {
    wrap.innerHTML = `<p class="muted">No structure saved yet.</p>`;
    return;
  }
  hymn.segments.forEach((segment, index) => {
    const row = document.createElement("div");
    row.className = "segment-row";
    row.innerHTML = `<input value="${segment.label || segment.type}"><input type="number" step="0.1" value="${segment.start}"><input type="number" step="0.1" value="${segment.end}">`;
    row.querySelectorAll("input").forEach((input) => input.addEventListener("change", async () => {
      const inputs = row.querySelectorAll("input");
      hymn.segments[index] = { ...segment, label: inputs[0].value, start: Number(inputs[1].value), end: Number(inputs[2].value) };
      await saveHymnPatch(hymn, { segments: hymn.segments });
    }));
    wrap.append(row);
  });
}

async function saveHymnPatch(hymn, patch) {
  const saved = await updateHymnPatch(hymn, patch);
  renderLibrary();
  renderDetails();
  setStatus("Saved");
  return saved;
}

async function updateHymnPatch(hymn, patch) {
  const saved = await permissionApi("hymns.edit", `/api/hymns/${hymn.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch)
  });
  state.hymns = state.hymns.map((item) => item.id === saved.id ? saved : item);
  return saved;
}

async function saveSelectedHymn() {
  const hymn = state.hymns.find((item) => item.id === state.selectedId);
  await saveHymnPatch(hymn, {
    title: $("editTitle").value.trim(),
    page: $("editPage").value.trim(),
    key: $("editKey").value.trim(),
    tempo: $("editTempo").value.trim(),
    defaultVerses: Number($("editVerses").value || 3),
    themes: $("editThemes").value.trim(),
    notes: $("editNotes").value.trim(),
    lyrics: $("editLyrics").value.trim(),
    defaultVolume: Math.max(0, Math.min(1, Number($("editVolume").value || 90) / 100)),
    defaultSpeed: Math.max(0.75, Math.min(1.25, Number($("editSpeed").value || 1))),
    fadeIn: Number($("editFadeIn").value || 0),
    fadeOut: Number($("editFadeOut").value || 0),
    duration: Number($("editDuration").value || 0),
    hasChorus: $("editChorus").checked
  });
}

async function resetSelectedHymnAudioDefaults() {
  const hymn = state.hymns.find((item) => item.id === state.selectedId);
  if (!hymn) return;
  $("editVolume").value = Math.round(CONTROL_DEFAULTS.volume * 100);
  $("editSpeed").value = CONTROL_DEFAULTS.speed.toFixed(2);
  await saveHymnPatch(hymn, {
    defaultVolume: CONTROL_DEFAULTS.volume,
    defaultSpeed: CONTROL_DEFAULTS.speed
  });
}

async function deleteSelectedHymn() {
  const hymn = state.hymns.find((item) => item.id === state.selectedId);
  if (!hymn) return;
  if (state.serviceLocked) {
    setStatus("Unlock service before deleting audio");
    return;
  }
  const firstConfirm = confirm(`This will permanently delete the library record and MP3 file for "${hymn.title}". Continue?`);
  if (!firstConfirm) return;
  const typed = prompt('Type DELETE in all caps to delete the MP3.');
  if (typed !== "DELETE") {
    setStatus("Delete cancelled: confirmation text did not match");
    return;
  }
  await permissionApi("hymns.delete", `/api/hymns/${hymn.id}`, { method: "DELETE" });
  state.hymns = state.hymns.filter((item) => item.id !== hymn.id);
  state.selectedId = null;
  renderLibrary();
  renderDetails();
  setStatus("Deleted");
}

async function buildSegments() {
  const hymn = state.hymns.find((item) => item.id === state.selectedId);
  if (!hymn) return;
  const verses = Number($("editVerses").value || hymn.defaultVerses || 3);
  const hasChorus = $("editChorus").checked;
  $("buildSegmentsBtn").disabled = true;
  setStatus("Analyzing MP3");
  try {
    const analysis = await analyzeAudioStructure(hymn, verses, hasChorus);
    await saveHymnPatch(hymn, {
      segments: analysis.segments,
      defaultVerses: verses,
      hasChorus,
      duration: Math.round(analysis.duration),
      structureMethod: analysis.method,
      structureConfidence: analysis.confidence
    });
    setStatus(analysis.method === "audio-analysis" ? `Smart build saved (${analysis.confidence}% confidence)` : "Smart build saved");
  } catch (error) {
    setStatus(error.message || "Smart build failed");
  } finally {
    const button = $("buildSegmentsBtn");
    if (button) button.disabled = false;
  }
}

async function analyzeAudioStructure(hymn, verses, hasChorus) {
  try {
    const response = await fetch(`/media/${encodeURIComponent(hymn.fileName)}`);
    if (!response.ok) throw new Error("Could not read MP3");
    const bytes = await response.arrayBuffer();
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error("Audio analysis is not supported here");
    const context = new AudioContext();
    const buffer = await context.decodeAudioData(bytes.slice(0));
    await context.close?.();
    return buildAnalyzedSegments(buffer, verses, hasChorus);
  } catch {
    return buildEvenSegments(hymn, verses, hasChorus);
  }
}

function buildAnalyzedSegments(buffer, verses, hasChorus) {
  const duration = buffer.duration;
  const frameSeconds = 0.25;
  const frameSamples = Math.max(1, Math.floor(buffer.sampleRate * frameSeconds));
  const channel = buffer.getChannelData(0);
  const energies = [];
  for (let start = 0; start < channel.length; start += frameSamples) {
    let sum = 0;
    const end = Math.min(channel.length, start + frameSamples);
    for (let i = start; i < end; i += 1) sum += channel[i] * channel[i];
    energies.push(Math.sqrt(sum / Math.max(1, end - start)));
  }
  const smoothed = energies.map((value, index) => {
    const from = Math.max(0, index - 2);
    const to = Math.min(energies.length, index + 3);
    return energies.slice(from, to).reduce((sum, item) => sum + item, 0) / (to - from);
  });
  const targets = expectedBoundaries(duration, verses, hasChorus);
  const boundaries = [0];
  let confidenceSum = 0;
  for (const target of targets.slice(1, -1)) {
    const found = findBestBoundary(smoothed, target, duration, frameSeconds, boundaries[boundaries.length - 1]);
    boundaries.push(found.time);
    confidenceSum += found.confidence;
  }
  boundaries.push(duration);
  const confidence = Math.round(confidenceSum / Math.max(1, boundaries.length - 2));
  return {
    duration,
    method: "audio-analysis",
    confidence,
    segments: segmentsFromBoundaries(boundaries, verses, hasChorus)
  };
}

function expectedBoundaries(duration, verses, hasChorus) {
  const intro = Math.min(18, Math.max(6, duration * 0.08));
  const slots = verses + (hasChorus ? verses : 0);
  const unit = (duration - intro) / Math.max(1, slots);
  const boundaries = [0, intro];
  let cursor = intro;
  for (let i = 0; i < slots; i += 1) {
    cursor += unit;
    boundaries.push(cursor);
  }
  return boundaries.map((value) => Math.max(0, Math.min(duration, value)));
}

function findBestBoundary(energies, target, duration, frameSeconds, previous) {
  const targetIndex = Math.round(target / frameSeconds);
  const windowFrames = Math.max(8, Math.round(Math.min(14, duration * 0.08) / frameSeconds));
  const start = Math.max(Math.round((previous + 4) / frameSeconds), targetIndex - windowFrames);
  const end = Math.min(energies.length - 2, targetIndex + windowFrames);
  let best = { index: targetIndex, score: Number.POSITIVE_INFINITY };
  for (let index = start; index <= end; index += 1) {
    const energy = energies[index] || 0;
    const before = energies[Math.max(0, index - 4)] || energy;
    const after = energies[Math.min(energies.length - 1, index + 4)] || energy;
    const transition = Math.abs(after - before);
    const distancePenalty = Math.abs(index - targetIndex) / Math.max(1, windowFrames);
    const score = energy - transition * 0.35 + distancePenalty * 0.08;
    if (score < best.score) best = { index, score };
  }
  const confidence = Math.max(35, Math.min(95, Math.round(95 - Math.abs(best.index - targetIndex) * 2)));
  return { time: Number((best.index * frameSeconds).toFixed(1)), confidence };
}

function buildEvenSegments(hymn, verses, hasChorus) {
  const fromCurrentAudio = audio.src.includes(hymn.fileName) && Number.isFinite(audio.duration) ? audio.duration : 0;
  const duration = fromCurrentAudio || Number($("editDuration").value || hymn.duration || 180);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Add a track length first");
  const intro = Math.min(12, Math.max(5, duration * 0.08));
  const slots = verses + (hasChorus ? verses : 0);
  const unit = (duration - intro) / Math.max(1, slots);
  const boundaries = [0, intro];
  let cursor = intro;
  for (let i = 0; i < slots; i += 1) {
    cursor += unit;
    boundaries.push(cursor);
  }
  return {
    duration,
    method: "even-estimate",
    confidence: 45,
    segments: segmentsFromBoundaries(boundaries, verses, hasChorus)
  };
}

function segmentsFromBoundaries(boundaries, verses, hasChorus) {
  const clean = boundaries.map((value) => Number(value.toFixed(1)));
  const segments = [{ type: "intro", label: "Intro", start: clean[0], end: clean[1] }];
  let boundary = 1;
  for (let i = 1; i <= verses; i += 1) {
    segments.push({ type: "verse", label: `Verse ${i}`, start: clean[boundary], end: clean[boundary + 1] });
    boundary += 1;
    if (hasChorus) {
      segments.push({ type: "chorus", label: `Chorus ${i}`, start: clean[boundary], end: clean[boundary + 1] });
      boundary += 1;
    }
  }
  return segments.filter((segment) => Number(segment.end) > Number(segment.start));
}

function playHymn(hymn, plan = [], shouldPlay = true) {
  if (!hymn) return;
  state.segmentPlan = plan;
  state.segmentIndex = plan.length ? 0 : -1;
  state.selectedId = hymn.id;
  state.liveHymnId = hymn.id;
  if (plan.length) audio.addEventListener("loadedmetadata", startCurrentSegment, { once: true });
  audio.src = `/media/${encodeURIComponent(hymn.fileName)}`;
  $("volume").value = hymn.defaultVolume ?? CONTROL_DEFAULTS.volume;
  $("speed").value = hymn.defaultSpeed ?? CONTROL_DEFAULTS.speed;
  updateControlValues();
  audio.playbackRate = Number($("speed").value);
  audio.volume = 0;
  $("nowTitle").textContent = hymn.title;
  $("nowMeta").textContent = hymnMeta(hymn);
  renderLyricsSheet();
  $("fadeIn").value = hymn.fadeIn ?? $("fadeIn").value;
  $("fadeOut").value = hymn.fadeOut ?? $("fadeOut").value;
  if (shouldPlay) {
    playDeviceAudio();
  } else {
    audio.pause();
    audio.load();
    setPlayButtonState("play");
    publishLivePlayback("selected", true);
  }
}

function selectQueueIndex(index) {
  const item = state.queue[index];
  const hymn = state.hymns.find((h) => h.id === item?.hymnId);
  if (!hymn) return;
  state.queueIndex = index;
  const plan = makeSegmentPlan(hymn, item);
  playHymn(hymn, plan, false);
  renderQueue();
  setStatus(`${hymn.title} selected`);
}

function loadSelectedPlan() {
  openPlansModal();
}

function openPlansModal() {
  renderPlanManager();
  $("plansModal").hidden = false;
}

function closePlansModal() {
  $("plansModal").hidden = true;
}

function openSavePlanModal() {
  $("savePlanName").value = `Service ${new Date().toLocaleDateString()}`;
  $("savePlanModal").hidden = false;
  $("savePlanName").focus();
}

function closeSavePlanModal() {
  $("savePlanModal").hidden = true;
}

async function saveCurrentPlan() {
  if (!hasPermission("plans.save")) throw new Error("Your account cannot save service plans.");
  const name = $("savePlanName").value.trim() || `Service ${new Date().toLocaleDateString()}`;
  await api("/api/service-plans", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, queue: state.queue })
  });
  await loadServicePlans();
  setLoadedPlanName(name);
  closeSavePlanModal();
  setStatus("Service plan saved");
}

async function loadPlan(planId) {
  if (!hasPermission("plans.load")) {
    setStatus("Your account cannot load service plans");
    return;
  }
  if (state.serviceLocked) {
    setStatus("Unlock service before loading plans");
    return;
  }
  const plan = state.servicePlans.find((item) => item.id === planId);
  if (!plan) {
    setStatus("Choose a saved plan first");
    return;
  }
  const loaded = await permissionApi("plans.load", `/api/service-plans/${encodeURIComponent(plan.id)}`, { method: "POST" });
  resetPlayerSelection();
  state.queue = loaded.queue || [];
  setLoadedPlanName(loaded.plan?.name || plan.name || "Untitled plan");
  renderQueue();
  setActiveTab("service");
  closePlansModal();
  setStatus(`${plan.name || "Service plan"} loaded`);
}

async function deletePlan(planId) {
  if (!hasPermission("plans.delete")) throw new Error("Your account cannot delete service plans.");
  if (state.serviceLocked) {
    setStatus("Unlock service before deleting plans");
    return;
  }
  const plan = state.servicePlans.find((item) => item.id === planId);
  if (!plan) {
    setStatus("Choose a saved plan first");
    return;
  }
  if (!confirm(`Delete saved plan "${plan.name || "Untitled plan"}"?`)) return;
  await permissionApi("plans.delete", `/api/service-plans/${encodeURIComponent(plan.id)}`, { method: "DELETE" });
  await loadServicePlans();
  setStatus("Service plan deleted");
}

async function downloadBackup() {
  if (!hasPermission("backups.download")) throw new Error("Your account cannot download backups.");
  const response = await fetch("/api/backups/export", { method: "POST", credentials: "same-origin", cache: "no-store" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Complete backup export failed.");
  }
  const blob = await response.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  const disposition = response.headers.get("content-disposition") || "";
  link.download = disposition.match(/filename="([^"]+)"/)?.[1] || `hymn-console-backup-${new Date().toISOString().slice(0, 10)}.tar.gz`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function restoreBackup(file) {
  if (!hasPermission("backups.restore")) throw new Error("Your account cannot restore backups.");
  if (!file) return;
  if (/\.(?:tar\.gz|tgz)$/i.test(file.name)) {
    if (!confirm("Restore this complete backup? Current database and MP3 files will be replaced.")) return;
    const form = new FormData();
    form.append("backup", file);
    const response = await fetch("/api/backups/restore", { method: "POST", body: form, credentials: "same-origin" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Complete backup restore failed.");
    window.location.reload();
    return;
  }
  const backup = JSON.parse(await file.text());
  await permissionApi("backups.restore", "/api/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(backup)
  });
  await loadHymns();
  await loadServicePlans();
  setStatus("Backup restored");
}

function selectBackupForRestore(file) {
  state.selectedBackupFile = file || null;
  $("restoreSelectedName").textContent = file ? `Selected: ${file.name}` : "No backup selected.";
  $("restoreSelectedBackupBtn").disabled = !file;
}

async function restoreSelectedBackup() {
  const file = state.selectedBackupFile;
  if (!file) throw new Error("Choose a backup file first.");
  await restoreBackup(file);
  state.selectedBackupFile = null;
  $("restoreInput").value = "";
  selectBackupForRestore(null);
}

async function loadNetworkAddress() {
  const data = await api("/api/network");
  state.detectedNetwork = {
    preferredUrl: data.addresses[0] || "",
    subnet: data.primary?.subnet || "",
    gateway: ""
  };
  const network = state.appSettings?.network || {};
  const customName = state.appSettings?.dnsName ? ` (${state.appSettings.dnsName})` : "";
  updateNetworkModeFields();
  const preferred = (network.mode || "dhcp") === "dhcp"
    ? `DHCP: ${state.detectedNetwork.preferredUrl || "detecting"}${customName}. `
    : (network.preferredUrl ? `Static: ${network.preferredUrl}${customName}. ` : "");
  const details = [network.subnet && `Subnet ${network.subnet}`, network.gateway && `Gateway ${network.gateway}`, network.notes].filter(Boolean).join(" - ");
  $("networkAddress").textContent = data.addresses.length
    ? `${preferred}Detected address${customName}: ${data.addresses.join(" or ")}${details ? `. ${details}` : ""}`
    : "Network address unavailable. Check the Raspberry Pi network connection.";
}

function updateNetworkModeFields() {
  if (!$("networkModeSelect")) return;
  const dhcp = $("networkModeSelect").value === "dhcp";
  if (dhcp && state.detectedNetwork) {
    $("customIpAddress").value = state.detectedNetwork.preferredUrl || "";
    $("customSubnet").value = state.detectedNetwork.subnet || "";
    if (!$("customDnsName").value.trim()) $("customDnsName").value = "hymnconsole";
  }
  ["customIpAddress", "customSubnet", "customGateway"].forEach((id) => {
    $(id).disabled = dhcp || !isSettingsUnlocked();
  });
}

function updateStorageModeFields() {
  if (!$("storageModeSelect")) return;
  const usb = $("storageModeSelect").value === "usb";
  $("usbStoragePath").disabled = !usb || !isSettingsUnlocked();
}

async function loadControllers() {
  const devices = await api("/api/controllers");
  renderControllerList($("controllerList"), devices);
  renderControllerList($("logDeviceList"), devices);
}

function controllerBrowserLabel(userAgent = "") {
  const ua = String(userAgent);
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /CriOS|Chrome\//i.test(ua)
      ? "Chrome"
      : /FxiOS|Firefox\//i.test(ua)
        ? "Firefox"
        : /Safari\//i.test(ua)
          ? "Safari"
          : "Web browser";
  const device = /iPhone/i.test(ua)
    ? "iPhone"
    : (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua)))
      ? "iPad"
      : /Android/i.test(ua)
        ? (/Mobile/i.test(ua) ? "Android phone" : "Android tablet")
        : /Windows/i.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS/i.test(ua)
            ? "Mac"
            : /Linux/i.test(ua)
              ? "Linux"
              : "device";
  return `${browser} on ${device}`;
}

function renderControllerList(list, devices) {
  if (!list) return;
  list.innerHTML = devices.length ? "" : `<p class="muted">No controllers connected yet.</p>`;
  for (const device of devices.slice(0, 8)) {
    const row = document.createElement("div");
    row.className = "info-row";
    row.innerHTML = `<strong></strong><span></span>`;
    row.querySelector("strong").textContent = `${device.name || "Device"} - ${device.address}`;
    row.querySelector("span").textContent = `Last seen ${new Date(device.lastSeen).toLocaleTimeString()} - ${controllerBrowserLabel(device.userAgent)}`;
    row.title = device.userAgent || "";
    list.append(row);
  }
}

function renderStatGrid(id, items) {
  const grid = $(id);
  grid.innerHTML = "";
  for (const item of items) {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `<span></span><strong></strong>`;
    card.querySelector("span").textContent = item.label;
    card.querySelector("strong").textContent = item.value;
    grid.append(card);
  }
}

async function loadStorageStatus() {
  const data = await api("/api/storage");
  updateUploadDestination(data);
  renderStatGrid("storageStatus", [
    { label: "Storage Mode", value: data.storageMode === "usb" ? "USB Storage" : "Internal Storage" },
    { label: "Media Path", value: data.mediaPath },
    { label: "USB Path", value: data.usbPath || "Not set" },
    { label: "Free Space", value: fmtBytes(data.free) },
    { label: "MP3 Count", value: String(data.mp3Count) },
    { label: "Trash Size", value: `${fmtBytes(data.trashSize)} (${data.trashCount})` },
    { label: "Library Size", value: fmtBytes(data.mediaSize) },
    { label: "Status", value: data.error || "Ready" }
  ]);
}

async function loadResourceStats() {
  const data = await api("/api/resources");
  const usedMemory = data.memory.total - data.memory.free;
  const loadAverage = Array.isArray(data.loadAverage) ? data.loadAverage : [];
  const loadValue = loadAverage.some((value) => Number(value) > 0)
    ? `1m ${Number(loadAverage[0] || 0).toFixed(2)} / 5m ${Number(loadAverage[1] || 0).toFixed(2)} / 15m ${Number(loadAverage[2] || 0).toFixed(2)}`
    : (data.platform === "win32" ? "Unavailable on Windows" : "0.00");
  const networkSpeed = data.networkSpeed?.mbps
    ? `${data.networkSpeed.mbps} Mbps${data.networkSpeed.interface ? ` (${data.networkSpeed.interface})` : ""}`
    : `Unavailable${data.networkSpeed?.interface ? ` (${data.networkSpeed.interface})` : ""}`;
  renderStatGrid("resourceStats", [
    { label: "CPU", value: `${data.cpuCount} cores` },
    { label: "CPU Load", value: `${loadValue}${data.cpuCount ? ` (${Math.round((Number(loadAverage[0] || 0) / data.cpuCount) * 100)}% of cores)` : ""}` },
    { label: "Memory", value: `${fmtBytes(usedMemory)} used (${fmtPercent(usedMemory, data.memory.total)})` },
    { label: "Storage", value: `${fmtBytes(data.storage.free)} free` },
    { label: "Network Speed", value: networkSpeed },
    { label: "Temperature", value: data.temperatureC === null ? "Unavailable" : `${((data.temperatureC * 9) / 5 + 32).toFixed(1)} F` }
  ]);
}

async function loadRustDeskStatus() {
  const card = $("rustDeskStatus");
  if (!card) return;
  if (!hasPermission("remote.support")) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  try {
    const data = await permissionApi("remote.support", "/api/rustdesk");
    card.innerHTML = `
      <h4>RustDesk Remote Access</h4>
      <div class="remote-access-grid">
        <div><span>Status</span><strong></strong></div>
        <div><span>ID</span><strong></strong></div>
        <div><span>Password</span><strong></strong></div>
      </div>
      <p class="muted"></p>
    `;
    const values = card.querySelectorAll(".remote-access-grid strong");
    values[0].textContent = data.service || (data.installed ? "Installed" : "Not installed");
    values[1].textContent = data.id || "Waiting for RustDesk";
    values[2].textContent = data.password || "Not configured";
    card.querySelector("p").textContent = data.note || "Use these details for remote support.";
  } catch (error) {
    card.innerHTML = `<h4>RustDesk Remote Access</h4><p class="muted">${error.message || "RustDesk status unavailable."}</p>`;
  }
}

async function loadTrash() {
  const data = await api("/api/trash");
  const trash = Array.isArray(data) ? data : data.items || [];
  const totalSize = Array.isArray(data) ? trash.reduce((sum, item) => sum + item.size, 0) : data.totalSize || 0;
  $("trashSummary").textContent = `${trash.length} item${trash.length === 1 ? "" : "s"} in trash can - ${fmtBytes(totalSize)} used`;
  $("emptyTrashBtn").disabled = trash.length === 0;
  const list = $("trashList");
  list.innerHTML = trash.length ? "" : `<p class="muted">Trash is empty.</p>`;
  for (const file of trash) {
    const row = document.createElement("div");
    row.className = "info-row";
    row.innerHTML = `<div><strong></strong><span></span></div><button type="button">Restore</button>`;
    row.querySelector("strong").textContent = file.name;
    row.querySelector("span").textContent = `${fmtBytes(file.size)} - ${new Date(file.deletedAt).toLocaleString()}`;
    row.querySelector("button").hidden = !hasPermission("trash.restore");
    row.querySelector("button").addEventListener("click", () => restoreTrashFile(file.name));
    list.append(row);
  }
}

async function restoreTrashFile(name) {
  await permissionApi("trash.restore", "/api/trash/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name })
  });
  await loadTrash();
  await loadHymns();
  setStatus("MP3 restored");
}

async function emptyTrashCan() {
  const typed = prompt("Type EMPTY to permanently remove every MP3 in the trash can.");
  if (typed !== "EMPTY") {
    setStatus("Empty trash cancelled");
    return;
  }
  const result = await permissionApi("trash.empty", "/api/trash", { method: "DELETE" });
  await loadTrash();
  await loadStorageStatus();
  setStatus(`Trash can emptied: ${result.count} item${result.count === 1 ? "" : "s"} removed`);
}

async function runStartupCheck() {
  const checks = await api("/api/startup-check");
  const list = $("startupCheckList");
  list.innerHTML = "";
  for (const check of checks) {
    const row = document.createElement("div");
    row.className = `check-row ${check.ok ? "good" : "bad"}`;
    row.innerHTML = `<strong></strong><span></span>`;
    row.querySelector("strong").textContent = `${check.ok ? "OK" : "Check"} - ${check.name}`;
    row.querySelector("span").textContent = check.detail;
    list.append(row);
  }
}

async function saveLocalBackup() {
  const result = await permissionApi("backups.run", "/api/backups/local", { method: "POST" });
  setStatus(`Local backup saved: ${result.name}`);
}

async function downloadDiagnostics() {
  const response = await fetch("/api/diagnostics", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Could not create diagnostics report.");
  }
  const blob = await response.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] || "hymn-console-diagnostics.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

function renderAssistantReport(items) {
  const report = $("assistantReport");
  if (!items.length) {
    report.innerHTML = `<p class="muted">No issues found.</p>`;
    return;
  }
  report.innerHTML = items.map((item) => `
    <div class="info-row">
      <div><strong></strong><span></span></div>
      ${item.action ? "<button type=\"button\">Apply</button>" : ""}
    </div>
  `).join("");
  [...report.querySelectorAll(".info-row")].forEach((row, index) => {
    row.querySelector("strong").textContent = items[index].title;
    row.querySelector("span").textContent = items[index].detail;
    if (items[index].action) row.querySelector("button").addEventListener("click", items[index].action);
  });
}

function openLookupModal(hymn, suggestions) {
  state.pendingLookup = { hymnId: hymn.id, suggestions };
  const fields = [
    ["Title", "title"],
    ["Key", "key"],
    ["Tempo", "tempo"],
    ["Themes", "themes"],
    ["Lyrics", "lyrics"]
  ];
  const review = $("lookupReview");
  review.innerHTML = fields.map(([label, key]) => `
    <label>
      <span>${label}</span>
      ${key === "lyrics" ? `<textarea id="lookup-${key}"></textarea>` : `<input id="lookup-${key}">`}
    </label>
  `).join("") + `<div class="lookup-notes" id="lookupNotes"></div>`;
  fields.forEach(([, key]) => {
    $(`lookup-${key}`).value = suggestions[key] || "";
  });
  $("lookupNotes").innerHTML = (suggestions.notes || []).map((note) => `<p class="muted"></p>`).join("");
  [...$("lookupNotes").querySelectorAll("p")].forEach((node, index) => {
    node.textContent = suggestions.notes[index];
  });
  $("lookupModal").hidden = false;
}

function closeLookupModal() {
  $("lookupModal").hidden = true;
  state.pendingLookup = null;
}

async function applyLookupSuggestions() {
  if (!state.pendingLookup) return;
  const hymn = state.hymns.find((item) => item.id === state.pendingLookup.hymnId);
  if (!hymn) return;
  await saveHymnPatch(hymn, {
    title: $("lookup-title").value.trim() || hymn.title,
    key: $("lookup-key").value.trim(),
    tempo: $("lookup-tempo").value.trim(),
    themes: $("lookup-themes").value.trim(),
    lyrics: $("lookup-lyrics").value.trim()
  });
  closeLookupModal();
  setStatus("Lookup suggestions applied");
}

function estimateTempo(buffer) {
  const channel = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const frameSize = Math.max(512, Math.floor(sampleRate * 0.08));
  const energies = [];
  for (let start = 0; start < channel.length; start += frameSize) {
    let sum = 0;
    const end = Math.min(channel.length, start + frameSize);
    for (let index = start; index < end; index += 1) sum += channel[index] * channel[index];
    energies.push(Math.sqrt(sum / Math.max(1, end - start)));
  }
  const avg = energies.reduce((sum, value) => sum + value, 0) / Math.max(1, energies.length);
  const peaks = [];
  for (let index = 1; index < energies.length - 1; index += 1) {
    if (energies[index] > avg * 1.2 && energies[index] > energies[index - 1] && energies[index] >= energies[index + 1]) {
      peaks.push(index * frameSize / sampleRate);
    }
  }
  const intervals = [];
  for (let index = 1; index < peaks.length; index += 1) {
    const interval = peaks[index] - peaks[index - 1];
    if (interval >= 0.3 && interval <= 1.5) intervals.push(interval);
  }
  if (!intervals.length) return "";
  intervals.sort((a, b) => a - b);
  let bpm = Math.round(60 / intervals[Math.floor(intervals.length / 2)]);
  while (bpm < 60) bpm *= 2;
  while (bpm > 160) bpm = Math.round(bpm / 2);
  return String(bpm);
}

function estimateKey(buffer) {
  const noteNames = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  const bins = new Array(12).fill(0);
  const channel = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const size = 2048;
  const step = Math.max(size, Math.floor(channel.length / 80));
  for (let start = 0; start + size < channel.length; start += step) {
    let crossings = 0;
    let last = channel[start];
    let energy = 0;
    for (let index = start + 1; index < start + size; index += 1) {
      const current = channel[index];
      energy += current * current;
      if ((last <= 0 && current > 0) || (last >= 0 && current < 0)) crossings += 1;
      last = current;
    }
    const rms = Math.sqrt(energy / size);
    if (rms < 0.01) continue;
    const frequency = (crossings * sampleRate) / (2 * size);
    if (frequency < 80 || frequency > 1200) continue;
    const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
    bins[((midi % 12) + 12) % 12] += rms;
  }
  const best = bins.reduce((bestIndex, value, index) => value > bins[bestIndex] ? index : bestIndex, 0);
  return bins[best] ? noteNames[best] : "";
}

async function analyzeAudioMetadata(hymn) {
  const response = await fetch(`/media/${encodeURIComponent(hymn.fileName)}`);
  if (!response.ok) throw new Error("Could not read MP3");
  const bytes = await response.arrayBuffer();
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) throw new Error("Audio analysis is not supported here");
  const context = new AudioContext();
  const buffer = await context.decodeAudioData(bytes.slice(0));
  await context.close?.();
  return {
    tempo: estimateTempo(buffer),
    key: estimateKey(buffer),
    duration: Math.round(buffer.duration)
  };
}

function shouldRunAiSmartBuild() {
  return $("aiSmartBuildEnabled")?.checked ?? state.appSettings?.autoLookup?.smartBuild !== false;
}

async function runLookupForHymn(hymn) {
  setStatus("AI scanning hymn");
  const [lookup, audioMeta] = await Promise.all([
    api(`/api/smart/lookup/${hymn.id}`, { method: "POST" }),
    analyzeAudioMetadata(hymn).catch((error) => ({ notes: [error.message] }))
  ]);
  const notes = [
    ...(lookup.suggestions.notes || []),
    audioMeta.duration ? `Audio analysis found ${audioMeta.duration} seconds.` : "",
    audioMeta.tempo ? `Estimated tempo: ${audioMeta.tempo} BPM.` : "Tempo could not be estimated confidently.",
    audioMeta.key ? `Estimated key center: ${audioMeta.key}.` : "Key could not be estimated confidently."
  ].filter(Boolean);
  if (shouldRunAiSmartBuild()) {
    try {
      const structure = await analyzeAudioStructure(hymn, Number(hymn.defaultVerses || 3), hymn.hasChorus !== false);
      await updateHymnPatch(hymn, {
        segments: structure.segments,
        duration: Math.round(structure.duration),
        structureMethod: structure.method,
        structureConfidence: structure.confidence
      });
      notes.push(`AI Smart Build saved structure timing (${structure.confidence}% confidence).`);
    } catch (error) {
      notes.push(`AI Smart Build skipped: ${error.message}`);
    }
  }
  const suggestions = {
    ...lookup.suggestions,
    key: audioMeta.key || lookup.suggestions.key || hymn.key || "",
    tempo: audioMeta.tempo || lookup.suggestions.tempo || hymn.tempo || "",
    notes
  };
  renderLibrary();
  renderDetails();
  openLookupModal(hymn, suggestions);
  setStatus("Review lookup suggestions");
}

async function runSmartMetadata() {
  const results = await permissionApi("hymns.edit", "/api/smart/metadata", { method: "POST" });
  state.hymns = results.library;
  renderLibrary();
  renderAssistantReport(results.changes.map((change) => ({
    title: change.title,
    detail: `Updated from filename: ${change.fields.join(", ")}`
  })));
  setStatus(`Metadata cleanup updated ${results.changes.length} hymn${results.changes.length === 1 ? "" : "s"}`);
}

async function importMetadataCsv() {
  const file = $("metadataCsvInput").files[0];
  if (!file) {
    setStatus("Choose a metadata CSV first");
    return;
  }
  const form = new FormData();
  form.append("metadata", file);
  const results = await api("/api/smart/metadata-csv", {
    method: "POST",
    body: form
  });
  state.hymns = results.library;
  renderLibrary();
  $("metadataCsvInput").value = "";
  renderAssistantReport(results.changes.map((change) => ({
    title: change.title,
    detail: `Imported fields: ${change.fields.join(", ")}`
  })));
  setStatus(`CSV metadata imported for ${results.changes.length} hymn${results.changes.length === 1 ? "" : "s"}`);
}

async function runDuplicateFinder() {
  const groups = await api("/api/smart/duplicates");
  renderAssistantReport(groups.map((group) => ({
    title: `${group.title} (${group.items.length})`,
    detail: group.items.map((item) => item.fileName).join(" | ")
  })));
}

async function runPlanAssistant() {
  const plan = await api("/api/smart/service-plan");
  if (!plan.queue.length) {
    renderAssistantReport([]);
    setStatus("Add hymns before using the service plan assistant");
    return;
  }
  renderAssistantReport(plan.queue.map((item, index) => ({
    title: `${index + 1}. ${item.title}`,
    detail: item.reason
  })).concat({
    title: "Use Suggested Plan",
    detail: "Replace the current service queue with this suggested order.",
    action: () => {
      state.queue = plan.queue.map((item) => ({ id: makeId(), hymnId: item.hymnId, title: item.title, verses: item.verses, includeIntro: true, includeVerses: true, includeChorus: true }));
      setLoadedPlanName("Suggested service plan");
      renderQueue();
      syncServiceQueue();
      setActiveTab("service");
    }
  }));
}

async function runQualityCheck() {
  const base = await api("/api/smart/quality");
  const decodeChecks = [];
  for (const hymn of state.hymns.slice(0, 12)) {
    try {
      const analysis = await analyzeAudioStructure(hymn, Number(hymn.defaultVerses || 3), hymn.hasChorus !== false);
      const quality = await analyzeAudioQuality(hymn);
      decodeChecks.push({ title: hymn.title, detail: `Decoded successfully, structure confidence ${analysis.confidence}%. ${quality}` });
    } catch (error) {
      decodeChecks.push({ title: hymn.title, detail: `Decode warning: ${error.message}` });
    }
  }
  renderAssistantReport([...base.map((item) => ({ title: item.title, detail: item.detail })), ...decodeChecks]);
}

async function analyzeAudioQuality(hymn) {
  const response = await fetch(`/media/${encodeURIComponent(hymn.fileName)}`);
  if (!response.ok) throw new Error("Could not read MP3");
  const bytes = await response.arrayBuffer();
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) throw new Error("Audio analysis is not supported here");
  const context = new AudioContext();
  const buffer = await context.decodeAudioData(bytes.slice(0));
  await context.close?.();
  const channel = buffer.getChannelData(0);
  let sum = 0;
  let clipped = 0;
  let silent = 0;
  const step = Math.max(1, Math.floor(channel.length / 45000));
  let samples = 0;
  for (let index = 0; index < channel.length; index += step) {
    const value = Math.abs(channel[index]);
    sum += value * value;
    if (value > 0.98) clipped += 1;
    if (value < 0.002) silent += 1;
    samples += 1;
  }
  const rms = Math.sqrt(sum / Math.max(1, samples));
  const warnings = [];
  if (rms < 0.025) warnings.push("possible low volume");
  if (silent / Math.max(1, samples) > 0.65) warnings.push("possible long silence");
  if (clipped / Math.max(1, samples) > 0.01) warnings.push("possible clipping");
  return warnings.length ? warnings.join(", ") : "Audio level looks normal";
}

function setupVoiceSearch() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition || $("voiceSearchBtn")) return;
  const button = document.createElement("button");
  button.id = "voiceSearchBtn";
  button.type = "button";
  button.textContent = "Voice";
  button.addEventListener("click", () => {
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      $("searchInput").value = event.results[0][0].transcript.replace(/^find\s+/i, "");
      state.letterFilter = "";
      renderLibrary();
      setActiveTab("library");
    };
    recognition.start();
  });
  $("searchInput").after(button);
}

function playQueueIndex(index) {
  const item = state.queue[index];
  const hymn = state.hymns.find((h) => h.id === item?.hymnId);
  if (!hymn) return;
  state.queueIndex = index;
  const plan = makeSegmentPlan(hymn, item);
  playHymn(hymn, plan, true);
  renderQueue();
}

function makeSegmentPlan(hymn, item) {
  const segments = hymn.segments || [];
  if (!segments.length) return [];
  const plan = [];
  const intro = segments.find((segment) => segment.type === "intro");
  if (item.includeIntro !== false && intro) plan.push(intro);
  const firstChorus = segments.find((segment) => segment.type === "chorus");
  const verses = item.includeVerses === false ? 0 : Number(item.verses || hymn.defaultVerses || 1);
  for (let i = 1; i <= verses; i += 1) {
    const verse = segments.find((segment) => segment.type === "verse" && segment.label.endsWith(String(i))) || segments.find((segment) => segment.type === "verse");
    const chorus = segments.find((segment) => segment.type === "chorus" && segment.label.endsWith(String(i))) || firstChorus;
    if (verse) plan.push(verse);
    if (item.includeChorus !== false && chorus) plan.push(chorus);
  }
  if (!verses && item.includeChorus !== false && firstChorus) plan.push(firstChorus);
  return plan.filter((segment) => Number(segment.end) > Number(segment.start));
}

function startCurrentSegment() {
  const segment = state.segmentPlan[state.segmentIndex];
  if (!segment) return;
  audio.currentTime = Number(segment.start);
  if (!audio.paused && state.segmentIndex <= 0) fadeTo(Number($("volume").value), Number($("fadeIn").value));
}

function segmentDuration(segment) {
  return Math.max(0, Number(segment.end) - Number(segment.start));
}

function arrangementDuration() {
  if (!state.segmentPlan.length) return audio.duration || 0;
  return state.segmentPlan.reduce((sum, segment) => sum + segmentDuration(segment), 0);
}

function arrangementElapsed() {
  if (!state.segmentPlan.length) return audio.currentTime || 0;
  const before = state.segmentPlan
    .slice(0, Math.max(0, state.segmentIndex))
    .reduce((sum, segment) => sum + segmentDuration(segment), 0);
  const current = state.segmentPlan[state.segmentIndex];
  if (!current) return before;
  return before + Math.max(0, audio.currentTime - Number(current.start));
}

function currentQueuePayload() {
  const item = state.queue[state.queueIndex];
  const hymn = state.hymns.find((candidate) => candidate.id === item?.hymnId);
  if (!hymn) return null;
  return {
    action: "play",
    hymnId: hymn.id,
    queueIndex: state.queueIndex,
    title: hymn.title,
    meta: hymnMeta(hymn),
    fileName: hymn.fileName,
    segments: state.segmentPlan,
    duration: arrangementDuration(),
    volume: Number($("volume").value),
    speed: Number($("speed").value),
    fadeIn: Number($("fadeIn").value || 0),
    fadeOut: Number($("fadeOut").value || 0)
  };
}

function livePlaybackClientId() {
  if (!state.livePlaybackClientId) {
    state.livePlaybackClientId = readSetting("hymn-live-client-id", "");
    if (!state.livePlaybackClientId) {
      state.livePlaybackClientId = makeId();
      writeSetting("hymn-live-client-id", state.livePlaybackClientId);
    }
  }
  return state.livePlaybackClientId;
}

function currentLivePlaybackPayload(status = audio.paused ? "paused" : "playing") {
  const item = state.queue[state.queueIndex];
  const hymn = state.hymns.find((candidate) => candidate.id === item?.hymnId) || state.hymns.find((candidate) => candidate.id === state.selectedId);
  if (!hymn) return null;
  return {
    clientId: livePlaybackClientId(),
    status,
    currentTitle: hymn.title,
    currentMeta: hymnMeta(hymn),
    hymnId: hymn.id,
    index: state.queueIndex,
    elapsed: arrangementElapsed(),
    duration: arrangementDuration(),
    controls: {
      volume: Number($("volume").value),
      speed: Number($("speed").value),
      fadeIn: Number($("fadeIn").value || 0),
      fadeOut: Number($("fadeOut").value || 0)
    }
  };
}

function publishLivePlayback(status, force = false) {
  if (state.audioOutput === "server") return;
  const now = Date.now();
  if (!force && now - state.lastLivePlaybackPublish < 450) return;
  const payload = currentLivePlaybackPayload(status);
  if (!payload) return;
  state.lastLivePlaybackPublish = now;
  api("/api/live-playback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }).catch(() => {});
}

function renderServerTimeline(info) {
  const localBrowserPlaying = state.audioOutput === "device" && audio.src && !audio.paused;
  if (localBrowserPlaying && (!info?.source || info?.status === "stopped")) return;
  const duration = Number(info?.duration || arrangementDuration() || 0);
  const elapsed = Math.max(0, Math.min(duration || Number(info?.elapsed || 0), Number(info?.elapsed || 0)));
  const title = String(info?.currentTitle || "").trim();
  const meta = String(info?.currentMeta || "").trim();
  const queueIndex = Number(info?.index ?? info?.queueIndex);
  if (info?.hymnId) state.liveHymnId = info.hymnId;
  if (info?.controls) {
    if (Number.isFinite(Number(info.controls.volume))) $("volume").value = Number(info.controls.volume);
    if (Number.isFinite(Number(info.controls.speed))) $("speed").value = Number(info.controls.speed);
    if (Number.isFinite(Number(info.controls.fadeIn))) $("fadeIn").value = Number(info.controls.fadeIn);
    if (Number.isFinite(Number(info.controls.fadeOut))) $("fadeOut").value = Number(info.controls.fadeOut);
    updateControlValues();
  }
  if (title) {
    $("nowTitle").textContent = title;
    $("nowMeta").textContent = meta || (info?.status === "stopped" ? "Playback stopped." : "Playing from the sound system.");
  } else if (info?.status === "stopped" && !audio.src && state.queueIndex < 0) {
    $("nowTitle").textContent = "Choose a hymn";
    $("nowMeta").textContent = "Select a hymn from the service queue.";
  }
  if (Number.isInteger(queueIndex) && queueIndex >= 0 && queueIndex < state.queue.length && queueIndex !== state.queueIndex) {
    state.queueIndex = queueIndex;
    renderQueue();
  }
  renderLyricsSheet();
  $("currentTime").textContent = fmt(elapsed);
  $("duration").textContent = fmt(duration);
  $("seek").value = duration ? Math.round((elapsed / duration) * 1000) : 0;
  state.serverPaused = info?.status === "paused";
  if (info?.status === "playing") {
    setPlayButtonState("pause");
  } else if (info?.status === "stopped" && $("playBtn").dataset.state !== "play") {
    setPlayButtonState("play");
  } else if (info?.status === "paused") {
    setPlayButtonState("play");
  }
}

function handleLivePlaybackCommand(info) {
  const command = info?.command;
  if (!command || command.targetClientId !== state.livePlaybackClientId || command.id === state.lastLivePlaybackCommandId) return false;
  state.lastLivePlaybackCommandId = command.id;
  if (command.action === "pause" && !audio.paused) {
    pauseAudio();
    return true;
  }
  if (command.action === "stop") {
    stopAudio();
    return true;
  }
  if (command.action === "play" && audio.paused && audio.src) {
    playDeviceAudio();
    return true;
  }
  publishLivePlayback(audio.paused ? "paused" : "playing", true);
  return true;
}

async function refreshServerTimeline() {
  const info = await api("/api/live-playback");
  if (handleLivePlaybackCommand(info)) return;
  if (info?.source === "browser" && info?.clientId && info.clientId === state.livePlaybackClientId && !audio.paused) return;
  renderServerTimeline(info);
  if (info.source === "server" && info.status === "stopped") {
    if (state.repeat && state.queueIndex >= 0) {
      if (!state.serverRepeatRestarting) {
        state.serverRepeatRestarting = true;
        serverAudio("play")
          .then((ok) => {
            if (ok) setPlayButtonState("pause");
          })
          .catch((error) => setStatus(error.message))
          .finally(() => {
            state.serverRepeatRestarting = false;
          });
      }
    } else {
      stopServerTimeline();
      setPlayButtonState("play");
    }
  }
}

function startServerTimeline() {
  refreshServerTimeline().catch(() => {});
}

function stopServerTimeline() {
  clearInterval(state.serverTimelineTimer);
  state.serverTimelineTimer = null;
}

function startLivePlaybackSync() {
  clearInterval(state.livePlaybackTimer);
  refreshServerTimeline().catch(() => {});
  state.livePlaybackTimer = setInterval(() => refreshServerTimeline().catch(() => {}), 500);
}

async function serverAudio(action) {
  const payload = action === "play" ? currentQueuePayload() : { action };
  if (!payload) {
    setStatus("Select a hymn from the service queue first");
    return false;
  }
  const result = await api("/api/server-player", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (action === "pause") state.serverPaused = true;
  if (["play", "resume", "stop"].includes(action)) state.serverPaused = false;
  renderServerTimeline(result);
  if (["play", "resume"].includes(action)) startServerTimeline();
  if (action === "stop") stopServerTimeline();
  setStatus(action === "play" ? "Playing on sound system" : `Sound system audio ${result.status}`);
  return true;
}

async function sendLivePlaybackCommand(action) {
  await api("/api/live-playback/command", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action })
  });
  setStatus(`Remote ${action} sent`);
}

async function controlLiveBrowserPlayback(action) {
  if (!hasPermission("playback.remote")) return false;
  const info = await api("/api/live-playback");
  const watchingOtherBrowser = info?.source === "browser" && info.clientId && info.clientId !== state.livePlaybackClientId;
  if (!watchingOtherBrowser) return false;
  await sendLivePlaybackCommand(action);
  renderServerTimeline(info);
  return true;
}

function sendServerVolume(value) {
  clearTimeout(state.serverVolumeTimer);
  state.serverVolumeTimer = setTimeout(() => {
    api("/api/server-player", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "volume", volume: Number(value) })
    }).catch((error) => setStatus(error.message));
  }, 120);
}

function seekArrangement(position) {
  if (!state.segmentPlan.length) {
    if (audio.duration) audio.currentTime = position;
    return;
  }
  let remaining = position;
  for (let index = 0; index < state.segmentPlan.length; index += 1) {
    const segment = state.segmentPlan[index];
    const duration = segmentDuration(segment);
    if (remaining <= duration || index === state.segmentPlan.length - 1) {
      state.segmentIndex = index;
      audio.currentTime = Number(segment.start) + Math.max(0, Math.min(duration, remaining));
      fadeTo(Number($("volume").value), 0.2);
      return;
    }
    remaining -= duration;
  }
}

function advanceSegmentOrQueue() {
  if (state.segmentPlan.length && state.segmentIndex < state.segmentPlan.length - 1) {
    state.segmentIndex += 1;
    startCurrentSegment();
    return true;
  }
  state.segmentPlan = [];
  state.segmentIndex = -1;
  return false;
}

function fadeTo(target, seconds) {
  clearInterval(state.fadeTimer);
  if (!seconds) {
    audio.volume = target;
    return;
  }
  const start = audio.volume;
  const steps = Math.max(1, seconds * 20);
  let tick = 0;
  state.fadeTimer = setInterval(() => {
    tick += 1;
    audio.volume = Math.max(0, Math.min(1, start + ((target - start) * tick) / steps));
    if (tick >= steps) clearInterval(state.fadeTimer);
  }, 50);
}

function afterFadeOut(callback) {
  clearTimeout(state.fadeActionTimer);
  const fadeOut = Math.max(0, Number($("fadeOut").value || 0));
  fadeTo(0, fadeOut);
  state.fadeActionTimer = setTimeout(callback, fadeOut * 1000);
}

function resetControl(id) {
  const input = $(id);
  if (!input) return;
  input.value = CONTROL_DEFAULTS[id];
  if (id === "volume") audio.volume = CONTROL_DEFAULTS.volume;
  if (id === "speed") audio.playbackRate = CONTROL_DEFAULTS.speed;
  updateControlValues();
  setStatus(`${input.closest("label")?.querySelector("span")?.textContent || "Control"} reset`);
}

function stopAudio() {
  state.segmentPlan = [];
  state.segmentIndex = -1;
  if (state.audioOutput === "server") {
    serverAudio("stop").catch((error) => setStatus(error.message));
    setPlayButtonState("play");
    return;
  }
  afterFadeOut(() => {
    audio.pause();
    audio.currentTime = 0;
    setPlayButtonState("play");
    publishLivePlayback("stopped", true);
  });
}

function stopDetailPreview() {
  clearTimeout(state.fadeActionTimer);
  clearInterval(state.fadeTimer);
  state.segmentPlan = [];
  state.segmentIndex = -1;
  audio.pause();
  audio.currentTime = 0;
  audio.volume = Number($("volume").value || CONTROL_DEFAULTS.volume);
  setPlayButtonState("play");
  publishLivePlayback("stopped", true);
  updateDetailPlayButton();
  setStatus("Preview stopped");
}

function pauseAudio() {
  if (state.audioOutput === "server") {
    serverAudio("pause")
      .then((ok) => {
        if (ok) setPlayButtonState("play");
      })
      .catch((error) => setStatus(error.message));
    return;
  }
  afterFadeOut(() => {
    audio.pause();
    setPlayButtonState("play");
    publishLivePlayback("paused", true);
  });
}

$("uploadForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const fileCount = form.elements.audio?.files?.length || 0;
  if (!hasPermission("library.uploadMp3")) {
    setStatus("Your account cannot upload MP3 files.", true);
    return;
  }
  const storageStatus = await getUploadStorageStatus();
  const selectedStorageMode = $("storageModeSelect")?.value || storageStatus.storageMode || "internal";
  const selectedUsbPath = comparableStoragePath($("usbStoragePath")?.value);
  const savedUsbPath = comparableStoragePath(storageStatus.usbPath);
  const hasUnsavedStorage = selectedStorageMode !== storageStatus.storageMode
    || (selectedStorageMode === "usb" && selectedUsbPath !== savedUsbPath);
  if (hasUnsavedStorage) {
    setStatus("Storage changes are not saved. Select Save Network Info before uploading.", true);
    return;
  }
  if (storageStatus.error) {
    setStatus(storageStatus.error, true);
    return;
  }
  setStatus(fileCount > 1 ? `Uploading ${fileCount} MP3 files` : "Uploading");
  const result = await api("/api/upload", { method: "POST", body: new FormData(form) });
  form.reset();
  await loadHymns();
  await loadStorageStatus().catch(() => {});
  const uploaded = Array.isArray(result.uploaded) ? result.uploaded : [result];
  const firstUploaded = uploaded[0];
  const hymn = state.hymns.find((item) => item.id === firstUploaded?.id) || firstUploaded;
  state.selectedId = hymn.id;
  renderDetails();
  const uploadedTo = result.storage?.mode === "usb" ? "USB storage" : "internal storage";
  setStatus(uploaded.length > 1 ? `${uploaded.length} MP3 files uploaded to ${uploadedTo}` : `MP3 uploaded to ${uploadedTo}`);
  if (uploaded.length === 1 && state.appSettings?.autoLookup?.enabled !== false && $("autoLookupUpload").checked) {
    await runLookupForHymn(hymn);
  }
});

$("searchInput").addEventListener("input", () => {
  state.letterFilter = "";
  state.visibleHymns = LIBRARY_PAGE_SIZE;
  renderLibrary();
});
$("themeSearchInput").addEventListener("input", () => {
  state.visibleHymns = LIBRARY_PAGE_SIZE;
  renderLibrary();
});
$("clearThemeSearchBtn").addEventListener("click", () => {
  $("themeSearchInput").value = "";
  state.visibleHymns = LIBRARY_PAGE_SIZE;
  renderLibrary();
});
hymnList.addEventListener("click", (event) => {
  const addButton = event.target.closest(".add");
  if (!addButton) return;
  event.preventDefault();
  event.stopPropagation();
  addToQueue(addButton.dataset.hymnId);
});
$("loadMoreBtn").addEventListener("click", () => {
  state.visibleHymns += LIBRARY_PAGE_SIZE;
  renderLibrary();
});
$("uploadToggle").addEventListener("click", () => {
  const collapsed = $("uploadForm").classList.toggle("collapsed");
  $("uploadToggle").textContent = collapsed ? "Show Upload" : "Hide Upload";
  $("uploadToggle").setAttribute("aria-expanded", String(!collapsed));
});
$("playbackToggle").addEventListener("click", () => {
  const collapsed = $("playbackControls").classList.toggle("collapsed");
  $("playbackToggle").textContent = collapsed ? "Show" : "Hide";
  $("playbackToggle").setAttribute("aria-expanded", String(!collapsed));
});
$("lyricsToggle").addEventListener("click", () => {
  state.lyricsVisible = !state.lyricsVisible;
  renderLyricsSheet();
});
$("lyricsCloseBtn").addEventListener("click", () => {
  state.lyricsVisible = false;
  renderLyricsSheet();
});
document.querySelectorAll("[data-lyrics-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    state.lyricsMode = button.dataset.lyricsMode;
    state.lyricsVisible = true;
    renderLyricsSheet();
  });
});
$("refreshBtn").addEventListener("click", loadHymns);
$("playBtn").addEventListener("click", async () => {
  const remoteAction = $("playBtn").dataset.state === "pause" ? "pause" : "play";
  try {
    if (await controlLiveBrowserPlayback(remoteAction)) return;
  } catch (error) {
    setStatus(error.message);
    return;
  }
  if (!state.audioOutput) {
    setStatus("Choose an audio output first");
    return;
  }
  if (!audio.src && state.queueIndex < 0) {
    setStatus("Select a hymn from the service queue first");
    return;
  }
  if (state.audioOutput === "server") {
    if ($("playBtn").dataset.state === "pause") {
      pauseAudio();
    } else {
      serverAudio(state.serverPaused ? "resume" : "play")
        .then((ok) => {
          if (ok) setPlayButtonState("pause");
        })
        .catch((error) => setStatus(error.message));
    }
    return;
  }
  if (!audio.src && state.queueIndex >= 0) {
    playQueueIndex(state.queueIndex);
    return;
  }
  if (audio.paused) {
    playDeviceAudio();
  } else {
    pauseAudio();
  }
});
$("stopBtn").addEventListener("click", async () => {
  try {
    if (await controlLiveBrowserPlayback("stop")) return;
  } catch (error) {
    setStatus(error.message);
    return;
  }
  stopAudio();
});
$("nextBtn").addEventListener("click", () => {
  if (!state.queue.length) return;
  selectQueueIndex(Math.min(state.queue.length - 1, Math.max(0, state.queueIndex + 1)));
});
$("prevBtn").addEventListener("click", () => {
  if (!state.queue.length) return;
  selectQueueIndex(Math.max(0, state.queueIndex - 1));
});
$("repeatBtn").addEventListener("click", () => {
  state.repeat = !state.repeat;
  $("repeatBtn").classList.toggle("primary", state.repeat);
  setStatus(state.repeat ? "Repeating current hymn" : "Repeat off");
});
$("volume").addEventListener("input", (event) => {
  const value = Number(event.target.value);
  if (state.audioOutput === "server") {
    sendServerVolume(value);
  } else {
    audio.volume = value;
  }
  updateControlValues();
  publishLivePlayback(audio.paused ? "paused" : "playing", true);
});
$("speed").addEventListener("input", (event) => {
  audio.playbackRate = Number(event.target.value);
  updateControlValues();
  publishLivePlayback(audio.paused ? "paused" : "playing", true);
});
["fadeIn", "fadeOut"].forEach((id) => {
  $(id).addEventListener("input", () => publishLivePlayback(audio.paused ? "paused" : "playing", true));
});
$("audioOutput").addEventListener("change", (event) => {
  if ((event.target.value === "device" && !hasPermission("audio.device")) || (event.target.value === "server" && !hasPermission("audio.soundSystem"))) {
    event.target.value = state.audioOutput || "";
    setStatus("Your account cannot use that audio output");
    return;
  }
  state.audioOutput = event.target.value;
  writeSetting("hymn-audio-output", state.audioOutput);
  audio.pause();
  if (!state.audioOutput) {
    serverAudio("stop").catch(() => {});
    setPlayButtonState("play");
    stopServerTimeline();
    setStatus("Choose an audio output");
  } else if (state.audioOutput === "server") {
    setPlayButtonState("play");
    stopServerTimeline();
    setStatus("Sound system selected");
  } else {
    serverAudio("stop").catch(() => {});
    setPlayButtonState("play");
    stopServerTimeline();
    setStatus("This device selected");
  }
});
document.querySelectorAll("[data-reset]").forEach((control) => {
  control.addEventListener("dblclick", () => resetControl(control.dataset.reset));
  if (control.classList.contains("reset-btn")) {
    control.addEventListener("click", () => resetControl(control.dataset.reset));
  }
});
document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => setActiveTab(button.dataset.tab));
});
window.addEventListener("resize", updateStickyShellHeight);
window.addEventListener("orientationchange", updateStickyShellHeight);
$("themeToggle").addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});
$("seek").addEventListener("input", (event) => {
  if (state.audioOutput === "server") {
    setStatus("Seeking is not available for Sound System output");
    return;
  }
  const duration = arrangementDuration();
  if (duration) seekArrangement((Number(event.target.value) / 1000) * duration);
});
$("clearQueueBtn").addEventListener("click", () => {
  if (state.serviceLocked) {
    setStatus("Unlock service before clearing the queue");
    return;
  }
  if (!confirm("Clear the entire service queue?")) return;
  const typed = prompt("Type CLEAR to empty the service queue.");
  if (typed !== "CLEAR") {
    setStatus("Clear cancelled");
    return;
  }
  state.queue = [];
  setLoadedPlanName("");
  resetPlayerSelection();
  renderQueue();
  syncServiceQueue();
});
$("savePlanBtn").addEventListener("click", openSavePlanModal);
$("plansBtn").addEventListener("click", loadSelectedPlan);
$("closePlansBtn").addEventListener("click", closePlansModal);
$("plansModal").addEventListener("click", (event) => {
  if (event.target.id === "plansModal") closePlansModal();
});
$("closeSavePlanBtn").addEventListener("click", closeSavePlanModal);
$("confirmSavePlanBtn").addEventListener("click", () => saveCurrentPlan().catch((error) => setStatus(error.message)));
$("savePlanModal").addEventListener("click", (event) => {
  if (event.target.id === "savePlanModal") closeSavePlanModal();
});
$("operatorModeBtn").addEventListener("click", () => setOperatorMode(!state.operatorMode));
$("operatorModeMobileBtn")?.addEventListener("click", () => setOperatorMode(!state.operatorMode));
$("operatorExitBtn").addEventListener("click", () => setOperatorMode(false));
$("serviceLockBtn").addEventListener("click", () => {
  setServiceLock(!state.serviceLocked);
});
$("saveBackupSettingsBtn").addEventListener("click", () => saveSettingsPatch({
  backup: {
    targetPath: $("backupTargetPath").value.trim(),
    retentionDays: Number($("backupRetentionDays").value || 14)
  }
}).catch((error) => setStatus(error.message)));
$("backupBtn").addEventListener("click", () => downloadBackup().catch((error) => setStatus(error.message)));
$("localBackupBtn").addEventListener("click", () => saveLocalBackup().catch((error) => setStatus(error.message)));
$("restoreInput").addEventListener("change", (event) => selectBackupForRestore(event.target.files[0]));
$("restoreSelectedBackupBtn").addEventListener("click", () => restoreSelectedBackup().catch((error) => setStatus(error.message)));
$("refreshLogBtn").addEventListener("click", () => {
  Promise.all([loadLogs(), loadSystemLogDashboard()]).catch((error) => setStatus(error.message));
});
$("resetLogBtn").addEventListener("click", () => {
  if (!confirm("Reset the system log?")) return;
  permissionApi("logs.reset", "/api/logs", { method: "DELETE" })
    .then((entries) => {
      renderLogEntries(entries);
      setStatus("System log reset");
    })
    .catch((error) => setStatus(error.message));
});
$("refreshTrashBtn").addEventListener("click", () => loadTrash().catch((error) => setStatus(error.message)));
$("emptyTrashBtn").addEventListener("click", () => emptyTrashCan().catch((error) => setStatus(error.message)));
$("refreshNetworkBtn").addEventListener("click", () => {
  loadNetworkAddress().catch((error) => setStatus(error.message));
  loadControllers().catch((error) => setStatus(error.message));
  loadRustDeskStatus().catch((error) => setStatus(error.message));
});
$("downloadDiagnosticsBtn").addEventListener("click", () => downloadDiagnostics().catch((error) => setStatus(error.message)));
$("systemCheckBtn").addEventListener("click", () => {
  Promise.all([
    loadResourceStats(),
    loadStorageStatus(),
    runStartupCheck(),
    loadRustDeskStatus()
  ]).then(() => setStatus("System check refreshed")).catch((error) => setStatus(error.message));
});
$("restartAppBtn").addEventListener("click", () => {
  if (!confirm("Restart Hymn Console? Playback will stop for a few seconds.")) return;
  permissionApi("system.restartApp", "/api/system/restart-app", { method: "POST" })
    .then(() => setStatus("App restart requested"))
    .catch((error) => setStatus(error.message));
});
$("restartPiBtn").addEventListener("click", () => {
  if (!confirm("Restart the Raspberry Pi now? The app will be unavailable while it reboots.")) return;
  const typed = prompt("Type RESTART to restart the Raspberry Pi.");
  if (typed !== "RESTART") {
    setStatus("Raspberry Pi restart cancelled");
    return;
  }
  permissionApi("system.restartPi", "/api/system/restart-pi", { method: "POST" })
    .then(() => setStatus("Raspberry Pi restart requested"))
    .catch((error) => setStatus(error.message));
});
$("networkModeSelect").addEventListener("change", updateNetworkModeFields);
$("storageModeSelect").addEventListener("change", updateStorageModeFields);
$("saveNetworkBtn").addEventListener("click", () => saveSettingsPatch({
  dnsName: $("customDnsName").value.trim() || "hymnconsole",
  network: {
    mode: $("networkModeSelect").value,
    preferredUrl: $("customIpAddress").value.trim(),
    dnsName: $("customDnsName").value.trim() || "hymnconsole",
    subnet: $("customSubnet").value.trim(),
    gateway: $("customGateway").value.trim(),
    notes: $("customNetworkNotes").value.trim()
  },
  storage: {
    mode: $("storageModeSelect").value,
    usbPath: $("usbStoragePath").value.trim()
  }
}).then(() => Promise.all([loadNetworkAddress(), loadStorageStatus(), loadHymns()])).catch((error) => setStatus(error.message)));
$("settingsSearch").addEventListener("input", filterSettingsSections);
$("downloadLibraryCsvBtn").addEventListener("click", downloadLibraryCsv);
$("uploadLibraryCsvBtn").addEventListener("click", () => uploadLibraryCsv().catch((error) => setStatus(error.message)));
$("saveLookupSettingsBtn").addEventListener("click", () => saveSettingsPatch({
  autoLookup: {
    enabled: $("autoLookupEnabled").checked,
    builtInAiEnabled: $("builtInAiLookupEnabled").checked,
    webSearch: $("aiWebSearchEnabled").checked,
    smartBuild: $("aiSmartBuildEnabled").checked,
    model: $("openAiModel").value.trim() || "gpt-4.1-mini",
    webEnabled: false,
    lookupUrl: ""
  },
  newOpenAiApiKey: $("openAiApiKey").value.trim()
}).catch((error) => setStatus(error.message)));
$("clearOpenAiKeyBtn").addEventListener("click", () => {
  if (!confirm("Clear the saved OpenAI API key from this Raspberry Pi?")) return;
  saveSettingsPatch({ clearOpenAiApiKey: true })
    .then(() => setStatus("OpenAI API key cleared"))
    .catch((error) => setStatus(error.message));
});
$("saveAudioDefaultsBtn").addEventListener("click", () => {
  const patch = {};
  if (hasPermission("queue.alerts")) patch.serviceQueueAlertsEnabled = $("serviceQueueAlertsEnabled").checked;
  if (hasPermission("settings.playback")) {
    patch.audioDefaults = {
      volume: Number($("defaultVolume").value || 90) / 100,
      speed: Number($("defaultSpeed").value || 1),
      fadeIn: Number($("defaultFadeIn").value || 0),
      fadeOut: Number($("defaultFadeOut").value || 0)
    };
  }
  saveSettingsPatch(patch).catch((error) => setStatus(error.message));
});
$("colorPaletteSelect").addEventListener("change", (event) => {
  const mode = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  applyPaletteVars(paletteColors(event.target.value, mode));
  setStatus("Palette preview applied");
});
$("chooseLogoBtn").addEventListener("click", () => $("customLogoInput").click());
$("customLogoInput").addEventListener("change", async () => {
  const file = $("customLogoInput").files[0] || null;
  state.pendingLogoFile = null;
  state.pendingLogoDataUri = "";
  if (!file) {
    updateAppearanceLogoPreview();
    updateLogoControls();
    return;
  }
  try {
    state.pendingLogoDataUri = await fileToDataUri(file);
    state.pendingLogoFile = file;
    updateAppearanceLogoPreview(state.pendingLogoDataUri);
    updateLogoControls();
    setStatus("Logo preview ready. Select Save Logo to apply it.");
  } catch (error) {
    $("customLogoInput").value = "";
    updateAppearanceLogoPreview();
    updateLogoControls();
    setStatus(error.message);
  }
});
$("saveAppearanceBtn").addEventListener("click", () => saveSettingsPatch({
  displayMode: $("displayModeSelect").value,
  appName: $("customAppName").value.trim() || "Hymn Console",
  palette: $("colorPaletteSelect").value,
  theme: { palette: $("colorPaletteSelect").value, ...paletteColors($("colorPaletteSelect").value, "light") }
}).catch((error) => setStatus(error.message)));
$("saveLogoBtn").addEventListener("click", async () => {
  if (!state.pendingLogoFile) {
    setStatus("Choose a logo file first");
    return;
  }
  try {
    const form = new FormData();
    form.append("logo", state.pendingLogoFile);
    const saved = await api("/api/custom-logo", {
      method: "POST",
      body: form
    });
    applyAppSettings({
      ...saved,
      customLogo: true,
      logoDataUri: saved.logoDataUri || state.pendingLogoDataUri
    });
    state.pendingLogoFile = null;
    state.pendingLogoDataUri = "";
    $("customLogoInput").value = "";
    updateLogoControls();
    setStatus("Logo saved");
  } catch (error) {
    setStatus(error.message);
  }
});
$("removeCustomLogoBtn").addEventListener("click", async () => {
  if (!confirm("Remove the custom logo and restore the default logo?")) return;
  try {
    const saved = await api("/api/custom-logo", { method: "DELETE" });
    state.pendingLogoFile = null;
    state.pendingLogoDataUri = "";
    $("customLogoInput").value = "";
    applyAppSettings(saved);
    updateLogoControls();
    setStatus("Custom logo removed");
  } catch (error) {
    setStatus(error.message);
  }
});
$("closeLookupBtn").addEventListener("click", closeLookupModal);
$("applyLookupBtn").addEventListener("click", () => applyLookupSuggestions().catch((error) => setStatus(error.message)));
$("lookupModal").addEventListener("click", (event) => {
  if (event.target.id === "lookupModal") closeLookupModal();
});

audio.addEventListener("timeupdate", () => {
  const arrangedDuration = arrangementDuration();
  const arrangedElapsed = arrangementElapsed();
  $("currentTime").textContent = fmt(arrangedElapsed);
  $("duration").textContent = fmt(arrangedDuration);
  $("seek").value = arrangedDuration ? Math.round((arrangedElapsed / arrangedDuration) * 1000) : 0;
  publishLivePlayback(audio.paused ? "paused" : "playing");
  const segment = state.segmentPlan[state.segmentIndex];
  if (segment && audio.currentTime >= Number(segment.end)) {
    if (advanceSegmentOrQueue()) return;
    finishQueueItem();
    return;
  }
  const fadeOut = Number($("fadeOut").value);
  const endAt = arrangedDuration || audio.duration;
  const elapsedAt = arrangedDuration ? arrangedElapsed : audio.currentTime;
  if (fadeOut && endAt && endAt - elapsedAt < fadeOut + 0.1 && audio.volume > 0.02) {
    fadeTo(0, fadeOut);
  }
});
audio.addEventListener("ended", () => {
  finishQueueItem();
});

function finishQueueItem() {
  if (state.repeat && state.queueIndex >= 0) {
    playQueueIndex(state.queueIndex);
    setStatus("Repeating current hymn");
    return;
  }
  setPlayButtonState("play");
  state.segmentPlan = [];
  state.segmentIndex = -1;
  audio.pause();
  publishLivePlayback("stopped", true);
  setStatus("Finished. Select the next hymn when ready.");
}

async function initializeApp() {
  const minimumSplash = delay(1300);
  const retry = $("splashRetryBtn");
  const start = $("splashStartBtn");
  if (retry) retry.hidden = true;
  if (start) start.hidden = true;
  try {
    renderQueue();
    updateControlValues();
    setupSettingsAccordions();
    setupVoiceSearch();
    applyTheme(readSetting("hymn-theme", "light"));
    await loadPublicBranding();
    setActiveTab("service");

    setSplashStatus("Connecting to Hymn Console...", 12);
    const health = await api("/api/health");
    state.serverPlatform = health.platform || "";
    setSplashCheck("server", "done");

    setSplashStatus("Loading settings and library...", 34);
    await loadSettings();
    await loadHymns();
    setSplashCheck("library", "done");

    setSplashStatus("Preparing service queue...", 56);
    await Promise.all([loadServiceQueue(), loadServicePlans()]);
    setSplashCheck("queue", "done");

    setSplashStatus("Checking audio and live playback...", 76);
    await Promise.all([
      api("/api/live-playback").then(renderServerTimeline),
      loadNetworkAddress(),
      loadStorageStatus(),
      loadResourceStats()
    ]);
    setSplashCheck("audio", "done");

    setSplashStatus("Finishing setup...", 92);
    await Promise.all([
      loadControllers(),
      loadTrash(),
      loadLogs(),
      loadSystemLogDashboard()
    ]);

    await minimumSplash;
    showSplashReady();
  } catch (error) {
    showSplashError(error.message || "Unable to start Hymn Console. Check the network and retry.");
    setStatus(error.message || "Startup failed", true);
  }
}

function startAppFromSplash() {
  if (state.pendingAuthMode) {
    const mode = state.pendingAuthMode;
    const message = state.pendingAuthMessage;
    state.pendingAuthMode = "";
    state.pendingAuthMessage = "";
    hideSplash();
    showAuthentication(mode, message);
    return;
  }
  if (state.appStarted) return;
  state.appStarted = true;
  hideSplash();
  setInterval(() => loadLogs().catch(() => {}), 2000);
  setInterval(() => loadSystemLogDashboard().catch(() => {}), 3000);
  setInterval(() => loadResourceStats().catch(() => {}), 6000);
  setInterval(() => loadControllers().catch(() => {}), 4000);
  startLivePlaybackSync();
}

$("splashStartBtn")?.addEventListener("click", startAppFromSplash);
$("splashRetryBtn")?.addEventListener("click", bootstrapAuthentication);
$("loginForm")?.addEventListener("submit", (event) => loginAccount(event).catch((error) => {
  $("authMessage").textContent = error.message;
}));
$("setupAccountsForm")?.addEventListener("submit", (event) => setupAccounts(event).catch((error) => {
  $("authMessage").textContent = error.message;
}));
$("recoverAccountForm")?.addEventListener("submit", (event) => recoverAccount(event).catch((error) => {
  $("authMessage").textContent = error.message;
}));
$("showRecoveryBtn")?.addEventListener("click", () => showAuthentication("recover"));
$("cancelRecoveryBtn")?.addEventListener("click", () => showAuthentication("login"));
$("confirmRecoverySavedBtn")?.addEventListener("click", () => {
  if (state.authUser) window.location.reload();
  else showAuthentication("login", "Recovery code saved. Sign in with the new password.");
});
$("accountBadge")?.addEventListener("click", (event) => {
  event.stopPropagation();
  setAccountMenu($("accountDropdown")?.hidden ?? true);
});
$("logoutBtn")?.addEventListener("click", () => {
  setAccountMenu(false);
  logoutAccount().catch((error) => setStatus(error.message));
});
$("settingsLogoutBtn")?.addEventListener("click", () => logoutAccount().catch((error) => setStatus(error.message)));
$("createAccountBtn")?.addEventListener("click", () => createAccount().catch((error) => setStatus(error.message)));
$("closeAccountPasswordBtn")?.addEventListener("click", closeAccountPasswordModal);
$("confirmAccountPasswordBtn")?.addEventListener("click", () => confirmAccountPassword().catch((error) => setStatus(error.message)));
$("closeAccountPermissionsBtn")?.addEventListener("click", closeAccountPermissionsModal);
$("saveAccountPermissionsBtn")?.addEventListener("click", () => saveAccountPermissions().catch((error) => setStatus(error.message)));
$("accountPasswordInput")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("confirmAccountPasswordBtn").click();
});
document.addEventListener("click", (event) => {
  const account = $("accountMenu");
  const dropdown = $("accountDropdown");
  if (account?.contains(event.target) || dropdown?.contains(event.target)) return;
  setAccountMenu(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setAccountMenu(false);
});
window.addEventListener("resize", () => setAccountMenu(false));
window.addEventListener("scroll", () => setAccountMenu(false), true);
bootstrapAuthentication();


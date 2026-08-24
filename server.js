const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const net = require("node:net");
const { spawn } = require("node:child_process");
const storage = require("./lib/storage");
const auth = require("./lib/auth");

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = process.env.HYMN_DATA_DIR || path.join(ROOT, "data");
const INTERNAL_MEDIA_DIR = process.env.HYMN_MEDIA_DIR || path.join(ROOT, "media");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const LIBRARY_FILE = path.join(DATA_DIR, "library.json");
const PLANS_FILE = path.join(DATA_DIR, "service-plans.json");
const QUEUE_FILE = path.join(DATA_DIR, "service-queue.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const CUSTOM_LOGO_FILE = path.join(DATA_DIR, "custom-logo");
const DATABASE_FILE = path.join(DATA_DIR, "hymn-console.sqlite");
const BACKUP_TOKEN = process.env.HYMN_BACKUP_TOKEN || "";
const USER_PERMISSION_CATALOG = Object.freeze({
  "playback.control": { group: "Service Playback", name: "Playback Controls", description: "Control play, pause, stop, previous, next, and repeat on the device currently playing audio." },
  "playback.remote": { group: "Service Playback", name: "Remote Playback Control", description: "Allow this account to control audio that is currently playing from another connected browser." },
  "playback.adjust": { group: "Service Playback", name: "Playback Adjustments", description: "Adjust volume, speed, fade in, fade out, and the playback timeline." },
  "audio.device": { group: "Service Playback", name: "Audio Output: This Device", description: "Play hymn audio through this phone, tablet, or computer." },
  "audio.soundSystem": { group: "Service Playback", name: "Audio Output: Sound System", description: "Play hymn audio through the Raspberry Pi connected to the church sound system." },
  "queue.manage": { group: "Service Playback", name: "Manage Service Queue", description: "Add, remove, reorder, configure, and clear hymns in the service queue." },
  "queue.alerts": { group: "Service Playback", name: "Configure Service Queue Alerts", description: "Enable or disable service queue alerts, errors, and warning messages." },
  "lyrics.view": { group: "Service Playback", name: "View Lyrics", description: "Open the lyrics window for the selected hymn during a service." },

  "plans.load": { group: "Service Plans", name: "Load Service Plans", description: "View saved plans and load a plan into the service queue." },
  "plans.save": { group: "Service Plans", name: "Save Service Plans", description: "Create or update a saved service plan from the current queue." },
  "plans.delete": { group: "Service Plans", name: "Delete Service Plans", description: "Permanently delete saved service plans." },

  "hymns.edit": { group: "Hymn Library", name: "Edit Hymns", description: "Edit hymn details, lyrics, playback defaults, and Smart Build structure." },
  "hymns.delete": { group: "Hymn Library", name: "Delete Hymns", description: "Move hymn records and their MP3 files to the trash can." },
  "library.uploadMp3": { group: "Hymn Library", name: "Upload MP3 Files", description: "Upload one or more MP3 files into the hymn library." },
  "library.importCsv": { group: "Hymn Library", name: "Import Library CSV", description: "Apply hymn metadata changes from an uploaded library CSV file." },
  "library.exportCsv": { group: "Hymn Library", name: "Download Library CSV", description: "Download all hymn metadata as a CSV file for review or bulk editing." },
  "trash.restore": { group: "Hymn Library", name: "Restore Deleted Hymns", description: "Restore individual MP3 files from the trash can." },
  "trash.empty": { group: "Hymn Library", name: "Empty Trash Can", description: "Permanently remove every MP3 currently stored in the trash can." },

  "lookup.settings": { group: "AI & Lookup", name: "Save Lookup Settings", description: "Change automatic lookup, web search, Smart Build, and OpenAI model settings." },
  "openai.clear": { group: "AI & Lookup", name: "Clear OpenAI API Key", description: "Remove the saved OpenAI API key from the Raspberry Pi." },

  "backups.settings": { group: "Backups", name: "Save Backup Settings", description: "Change the off-device backup path and backup retention period." },
  "backups.download": { group: "Backups", name: "Download Complete Backup", description: "Download a complete backup containing the database, settings, plans, themes, and MP3 files." },
  "backups.run": { group: "Backups", name: "Run Complete Backup", description: "Create a complete backup now and copy it to the configured off-device destination." },
  "backups.restore": { group: "Backups", name: "Restore Complete Backup", description: "Replace current data and MP3 files with a selected complete backup after confirmation." },

  "settings.playback": { group: "Application Settings", name: "Save Playback Settings", description: "Save global default volume, speed, fade settings, and service queue alert behavior." },
  "settings.appearance": { group: "Application Settings", name: "Manage Appearance", description: "Change the app name, interface size, color palette, and custom logo." },
  "settings.network": { group: "Application Settings", name: "Save Network Information", description: "Change DHCP or static network information, hostname, and hymn storage location." },
  "logs.reset": { group: "Application Settings", name: "Reset System Log", description: "Clear the live Hymn Console system activity log." },
  "system.restartApp": { group: "Application Settings", name: "Restart App", description: "Restart the Hymn Console service without rebooting the Raspberry Pi." },
  "system.restartPi": { group: "Application Settings", name: "Restart Raspberry Pi", description: "Reboot the entire Raspberry Pi after a typed confirmation." },

  "accounts.create": { group: "User Administration", name: "Create Users", description: "Create new Hymn Console user accounts." },
  "accounts.delete": { group: "User Administration", name: "Delete Users", description: "Delete user accounts other than the protected built-in administrator." },
  "accounts.resetPassword": { group: "User Administration", name: "Reset User Passwords", description: "Set a new password for another user and sign out their existing sessions." },
  "accounts.editPermissions": { group: "User Administration", name: "Edit User Permissions", description: "Change another user's permissions. Their open browsers receive the changes on refresh without signing in again." }
});
const DEFAULT_USER_PERMISSIONS = Object.freeze([
  "playback.control", "playback.remote", "playback.adjust", "audio.device", "audio.soundSystem",
  "queue.manage", "plans.load", "plans.save", "lyrics.view"
]);

function sanitizePermissions(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((permission) => Object.hasOwn(USER_PERMISSION_CATALOG, permission)))];
}

function sessionUser(session) {
  return session ? {
    username: session.username,
    role: session.role,
    builtIn: Boolean(session.builtIn),
    permissions: session.role === "admin" ? Object.keys(USER_PERMISSION_CATALOG) : sanitizePermissions(session.permissions),
    expiresAt: session.expiresAt
  } : null;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

const serverPlayer = {
  process: null,
  helperProcess: null,
  queue: [],
  index: 0,
  status: "stopped",
  currentTitle: "",
  currentMeta: "",
  hymnId: "",
  queueIndex: -1,
  error: "",
  totalDuration: 0,
  elapsedBefore: 0,
  itemStartedAt: 0,
  pausedAt: 0,
  ipcPath: "",
  backend: "",
  lastOutput: "",
  cleanupFiles: [],
  controls: { volume: 0.9, speed: 1, fadeIn: 1.5, fadeOut: 2 }
};
const livePlayback = {
  source: "",
  clientId: "",
  status: "stopped",
  currentTitle: "",
  currentMeta: "",
  hymnId: "",
  queueIndex: -1,
  elapsed: 0,
  duration: 0,
  controls: { volume: 0.9, speed: 1, fadeIn: 1.5, fadeOut: 2 },
  command: null,
  updatedAt: 0
};
const eventLog = [];
const controllers = new Map();
const CONTROLLER_TIMEOUT_MS = 25000;
const DEFAULT_SETTINGS = {
  audioDefaults: { volume: 0.9, speed: 1, fadeIn: 1.5, fadeOut: 2 },
  serviceQueueAlertsEnabled: true,
  displayMode: "standard",
  highContrast: false,
  kioskMode: false,
  autoBackup: false,
  appName: "Hymn Console",
  palette: "chapel-blue",
  dnsName: "",
  network: {
    mode: "dhcp",
    preferredUrl: "",
    dnsName: "hymnconsole",
    subnet: "",
    gateway: "",
    notes: ""
  },
  storage: {
    mode: "internal",
    usbPath: ""
  },
  backup: {
    targetPath: "",
    retentionDays: 14
  },
  autoLookup: {
    enabled: true,
    webEnabled: false,
    lookupUrl: "",
    builtInAiEnabled: true,
    model: "gpt-4.1-mini",
    webSearch: true,
    smartBuild: true
  },
  openAiApiKey: "",
  customLogo: false,
  customLogoMime: "",
  customLogoVersion: "",
  customLogoDataUri: "",
  theme: {
    palette: "chapel-blue",
    accent: "#2b7fc3",
    blue: "#155a91",
    paper: "#eaf3fb",
    panel: "#ffffff",
    ink: "#0b1f33"
  }
};

function addLog(type, message) {
  eventLog.unshift({
    time: new Date().toISOString(),
    type,
    message
  });
  if (eventLog.length > 300) eventLog.length = 300;
}

function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

async function commandExists(command) {
  try {
    await runCommand(process.platform === "win32" ? "where" : "which", [command]);
    return true;
  } catch {
    return false;
  }
}

function cleanHostname(value) {
  const host = String(value || "").trim().toLowerCase().replace(/\.local$/i, "");
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(host) ? host : "";
}

async function applySystemHostname(name) {
  const host = cleanHostname(name);
  if (!host) throw new Error("DNS name must be a valid hostname.");
  if (process.platform !== "linux") {
    addLog("settings", `DNS name saved as ${host}.local. Hostname change only runs on Raspberry Pi/Linux.`);
    return false;
  }
  await runCommand("sudo", ["hostnamectl", "set-hostname", host]);
  addLog("settings", `Raspberry Pi hostname set to ${host}`);
  return true;
}

async function restartHymnConsole() {
  if (process.platform !== "linux") throw new Error("App restart is only available on Raspberry Pi/Linux.");
  setTimeout(() => {
    runCommand("sudo", ["systemctl", "restart", "hymn-console"]).catch((error) => addLog("error", `Restart failed: ${error.message}`));
  }, 250);
}

async function restartRaspberryPi() {
  if (process.platform !== "linux") throw new Error("Raspberry Pi restart is only available on Raspberry Pi/Linux.");
  setTimeout(() => {
    runCommand("sudo", ["reboot"]).catch((error) => addLog("error", `Reboot failed: ${error.message}`));
  }, 250);
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": Buffer.isBuffer(payload) ? "application/octet-stream" : "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), geolocation=(), payment=()",
    ...headers
  });
  res.end(payload);
}

function detectImageMime(buffer, fallback = "") {
  if (buffer.length >= 12 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  const textStart = buffer.subarray(0, Math.min(buffer.length, 256)).toString("utf8").trimStart().toLowerCase();
  if (textStart.startsWith("<svg") || textStart.startsWith("<?xml")) return "image/svg+xml";
  return fallback || "application/octet-stream";
}

function parseLogoDataUri(value) {
  const match = /^data:(image\/(?:svg\+xml|png|jpeg|webp));base64,([a-z0-9+/=]+)$/i.exec(String(value || ""));
  if (!match) return null;
  try {
    return { buffer: Buffer.from(match[2], "base64"), mime: match[1].toLowerCase(), custom: true };
  } catch {
    return null;
  }
}

async function readActiveLogo(settings) {
  if (settings?.customLogo) {
    const storedLogo = parseLogoDataUri(settings.customLogoDataUri);
    if (storedLogo?.buffer.length) return storedLogo;
  }
  try {
    const logo = await fsp.readFile(CUSTOM_LOGO_FILE);
    if (logo.length) {
      const mime = detectImageMime(logo, settings?.customLogoMime || "");
      return { buffer: logo, mime, custom: true };
    }
  } catch {}
  const fallback = await fsp.readFile(path.join(PUBLIC_DIR, "mark.svg"));
  return { buffer: fallback, mime: "image/svg+xml", custom: false };
}

function logoDataUri(logo) {
  return `data:${logo.mime};base64,${logo.buffer.toString("base64")}`;
}

let mutationTail = Promise.resolve();

async function withMutationLock(task) {
  let release;
  const previous = mutationTail;
  mutationTail = new Promise((resolve) => { release = resolve; });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

function needsMutationLock(req, url) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return false;
  return [
    "/api/auth/setup",
    "/api/auth/recover",
    "/api/auth/users",
    "/api/settings",
    "/api/custom-logo",
    "/api/trash",
    "/api/restore",
    "/api/upload",
    "/api/hymns/",
    "/api/smart/",
    "/api/service-queue",
    "/api/service-plans",
    "/api/backups/"
  ].some((prefix) => url.pathname === prefix || url.pathname.startsWith(prefix));
}

function assertSameOrigin(req) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return;
  const origin = req.headers.origin;
  if (!origin) return;
  const scheme = req.socket.encrypted || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https" ? "https" : "http";
  const expected = `${scheme}://${req.headers.host}`;
  if (origin !== expected) throw auth.httpError(403, "Cross-origin request rejected.");
}

function pdfEscape(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapPdfLine(text, max = 88) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function guideSections(kind) {
  if (kind === "installation-guide") {
    return {
      title: "Hymn Console Installation Guide",
      filename: "hymn-console-installation-guide.pdf",
      sections: [
        ["Purpose", [
          "This guide explains how to deploy Hymn Console on a Raspberry Pi so the church can run hymns from a browser and play audio through the sound system.",
          "Recommended hardware: Raspberry Pi 4 or newer, 32 GB or larger SD card, reliable power supply, wired Ethernet if possible, and a USB audio interface or HDMI audio output for the sound system."
        ]],
        ["Prepare Raspberry Pi OS", [
          "Install Raspberry Pi OS Lite or Desktop, enable SSH if remote administration is needed, connect to the church network, and run system updates before installing the app.",
          "The included installer installs Node.js, ffmpeg, mpv, rsync, curl, ALSA utilities, Avahi, and shairport-sync. These packages support the web app, Sound System playback, fades, Raspberry Pi volume control, friendly local network names, and AirPlay receiving from Apple devices."
        ]],
        ["How The System Connects", [
          "Phones, tablets, and laptops connect by browser to http://hymnconsole.local:8080 or the Raspberry Pi IP address. The devices are controllers; the Raspberry Pi is the server.",
          "Connection diagram:",
          "Phone / Tablet / Laptop browser -> Church Wi-Fi or Ethernet -> Raspberry Pi running Hymn Console -> MP3 storage on SD card or USB drive.",
          "For Sound System playback: Raspberry Pi -> USB audio, headphone jack, or HDMI audio -> mixer, amplifier, or powered speakers.",
          "For AirPlay playback: iPhone or iPad -> Wi-Fi AirPlay stream -> Shairport Sync on Raspberry Pi -> the same Raspberry Pi audio output -> sound system."
        ]],
        ["Install Hymn Console", [
          "Clone the GitHub repository or copy the deployment package onto the Raspberry Pi. From inside the app folder, run sudo RUN_USER=pi bash deployment/install-rpi.sh unless your Pi uses a different service user.",
          "The installer copies the app to /opt/hymn-console, creates the hymn-console systemd service, enables startup on boot, creates data/media/trash/backup folders, sets permissions, and preserves existing data and media folders during updates.",
          "The installer also configures a health-check timer, nightly midnight local backups, log rotation, firewall access for the app and AirPlay, a default hostname of hymnconsole, and AirPlay.",
          "After install, open http://hymnconsole.local:8080 or http://the-pi-ip-address:8080 from a device on the same network."
        ]],
        ["Storage Choices", [
          "Internal Storage uses the app media folder and is the simplest option for smaller hymn libraries.",
          "USB Storage stores MP3 files on a mounted USB drive. Mount the drive first, then open Settings, expand Network & System, choose USB Storage, enter the USB path, and save. Common paths include /media/pi/HYMNS and /mnt/hymns.",
          "Switching storage changes where Hymn Console looks for MP3 files. It does not automatically move existing hymns, so copy MP3 files to the new location before relying on it for a service."
        ]],
        ["Configure Startup", [
          "The installer creates a systemd service that runs node server.js from /opt/hymn-console.",
          "Use sudo systemctl status hymn-console to confirm it is running. The app listens on port 8080 by default."
        ]],
        ["Network Access", [
          "Open http://hymnconsole.local:8080 or the Raspberry Pi IP address from phones, tablets, laptops, and the local Pi browser.",
          "Use DHCP by default. For a church installation, reserve the Pi address in the router or configure a static address only after confirming the correct subnet, gateway, and DNS.",
          "The installer sets the Raspberry Pi hostname to hymnconsole by default. You can override it by running the installer with HOSTNAME_NAME=yourname.",
          "The short address http://hymnconsole:8080 requires router DNS support. The .local address is the recommended friendly address for Apple devices and many Windows devices."
        ]],
        ["Audio Setup", [
          "Connect the Raspberry Pi audio output to the church sound system. Test volume at a safe level before service.",
          "Use This Device when audio should play from the phone, tablet, or laptop. Use Sound System when the Raspberry Pi is connected to the church audio system.",
          "Sound System mode uses mpv and ffmpeg for smoother segment playback and fade control. The volume slider also attempts to adjust the Raspberry Pi output volume.",
          "The installer also enables an AirPlay receiver named from the app name plus AirPlay. With the default app name, select Hymn Console AirPlay from iPhone Control Center to stream iPhone audio wirelessly to the Raspberry Pi sound output.",
          "If AirPlay connects but no sound is heard after firewall or audio changes, reboot the Pi and confirm speaker-test can play through the selected audio output."
        ]],
        ["Backup And Recovery", [
          "Use Download Complete Backup before major changes. Keep a backup on a different computer, USB drive, or trusted network share.",
          "Deleted MP3s move to the trash can first. Empty the trash only after verifying the files are no longer needed.",
          "A systemd backup timer saves a local backup every night at midnight. Complete backups include the SQLite database, MP3 files, service plans, queue, settings, themes, and custom logo."
        ]],
        ["Maintenance Checklist", [
          "Before Sunday: confirm network access, refresh System Check, confirm the selected hymn storage location and audio output, load the service plan, and select the first hymn.",
          "Monthly: download a backup, check free storage, review the trash can, update Raspberry Pi OS, test Sound System playback, and test AirPlay."
        ]]
      ]
    };
  }
  return {
    title: "Hymn Console User Guide",
    filename: "hymn-console-user-guide.pdf",
    sections: [
      ["Overview", [
        "Hymn Console is a local web app for churches that need reliable hymn playback without a pianist. It stores MP3 hymns, builds service queues, and plays audio from either the device browser or the Raspberry Pi sound system.",
        "The app is designed for phones, tablets, laptops, and a Raspberry Pi connected to the church audio system.",
        "The Raspberry Pi is the server and sound-system player. Phones, tablets, and laptops are controllers that connect through the church network."
      ]],
      ["Running A Service", [
        "Open the Library, search for a hymn, and press Add to place it in the Service Queue. Add hymns in the order they will be used.",
        "Open the Service page, choose This Device or Sound System, select the first hymn in the queue, then press Play. The next hymn waits until it is selected.",
        "On phones, the player controls sit near the top of the Service page and the hymn queue is condensed for quick touch operation."
      ]],
      ["Service Queue", [
        "Use Save to store the current queue as a service plan. Use Plans to load a saved order of service.",
        "Use verse count and the Intro, Verses, and Chorus checkboxes to decide which sections should play for each hymn."
      ]],
      ["Playback Controls", [
        "Back and Forward select nearby queue items. Play and Pause start or pause playback. Stop fades out and resets the selected hymn to the beginning.",
        "Volume, speed, fade in, and fade out can be adjusted from Playback Settings. Defaults can be managed by an administrator.",
        "When Sound System is selected, volume changes are sent to the Raspberry Pi audio output when supported by the operating system."
      ]],
      ["AirPlay From iPhone", [
        "The Raspberry Pi installer enables an AirPlay receiver named from the app name plus AirPlay using shairport-sync.",
        "On iPhone, open Control Center, tap the audio output icon, and select Hymn Console AirPlay or your custom app name followed by AirPlay. Audio from the iPhone will play through the Raspberry Pi sound output.",
        "AirPlay is useful for occasional wireless audio from an Apple device. For the normal service queue, Sound System mode is still the most direct and reliable playback path.",
        "If AirPlay connects but no sound is heard, reboot the Pi and confirm the Pi audio output works before service."
      ]],
      ["Library", [
        "Use search, hymn theme search, and the alphabet bar to find hymns quickly. Signed-in operators can add hymns to the service queue.",
        "Administrator accounts can edit hymns, upload single or bulk MP3 files, import or export CSV data, recover trash, manage backups, and configure AI lookup.",
        "Bulk upload lets you select multiple MP3 files at one time. When multiple files are selected, Hymn Console names each hymn from its file name so one typed title is not copied to every hymn.",
        "Use Download Song CSV to review the library in a spreadsheet. Reupload the CSV after editing hymn metadata such as title, page, key, tempo, default verses, themes, notes, lyrics, defaults, fades, and track length."
      ]],
      ["Hymn Storage", [
        "In Settings, expand Network & System and choose Internal Storage or USB Storage. Internal Storage uses the app media folder. USB Storage uses the mounted USB path you provide.",
        "After changing storage, refresh Storage Status and confirm the Media Path, MP3 count, and free space. Existing MP3 files are not moved automatically when switching storage locations."
      ]],
      ["Accounts And Administrator Access", [
        "Hymn Console uses one protected built-in administrator plus user accounts with granular permissions. Browser refreshes keep the signed-in session for up to twelve hours.",
        "Administrators can manage playback defaults, library tools, network/system settings, appearance, logs, backups, and user accounts. Operators can run services without access to protected maintenance tools.",
        "The first administrator setup displays a unique recovery code once. Store it away from the Raspberry Pi. The old fixed recovery PIN is no longer used."
      ]],
      ["Service Lock", [
        "Lock Service prevents accidental queue edits during worship. It is separate from account authentication, so a signed-in operator can quickly lock or unlock the live queue as needed.",
        "Administrator-only maintenance remains protected by the signed-in account role."
      ]],
      ["Operator Mode", [
        "Operator Mode simplifies the screen for live worship. It keeps the focus on now playing, transport controls, and the service queue.",
        "Use the X button to exit Operator Mode."
      ]],
      ["Before Worship Checklist", [
        "Refresh System Check, verify Sound Output, load the saved plan, check the first hymn, confirm volume, and lock the service queue if desired.",
        "Test Sound System playback and AirPlay if either will be used during the service.",
        "Keep the Raspberry Pi powered, avoid unplugging the audio cable during playback, and use a wired network when possible for the most stable control experience."
      ]]
    ]
  };
}

function makeGuidePdf(kind) {
  const guide = guideSections(kind);
  const lines = [];
  lines.push({ text: guide.title, size: 18, gap: 10 });
  lines.push({ text: `Generated ${new Date().toLocaleDateString("en-US")}`, size: 10, gap: 18 });
  for (const [heading, paragraphs] of guide.sections) {
    lines.push({ text: heading, size: 14, gap: 8 });
    for (const paragraph of paragraphs) {
      for (const line of wrapPdfLine(paragraph)) lines.push({ text: line, size: 10, gap: 2 });
      lines.push({ text: "", size: 10, gap: 8 });
    }
  }

  const pages = [];
  let current = [];
  let y = 740;
  for (const item of lines) {
    if (y < 72 && current.length) {
      pages.push(current);
      current = [];
      y = 740;
    }
    current.push({ ...item, y });
    y -= item.size + item.gap;
  }
  if (current.length) pages.push(current);

  const objects = [];
  const addObject = (content) => {
    objects.push(content);
    return objects.length;
  };
  const pageIds = [];
  const fontId = 3;
  addObject("<< /Type /Catalog /Pages 2 0 R >>");
  addObject("");
  addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (const page of pages) {
    const stream = page.map((item) => `BT /F1 ${item.size} Tf 54 ${item.y} Td (${pdfEscape(item.text)}) Tj ET`).join("\n");
    const streamId = addObject(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    const pageId = addObject(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${streamId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return { buffer: Buffer.from(pdf, "utf8"), filename: guide.filename };
}

function safeJoin(base, target) {
  const resolved = path.resolve(base, target);
  if (!resolved.startsWith(path.resolve(base))) throw new Error("Invalid path");
  return resolved;
}

async function ensureStorage() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  try {
    await ensureMediaStorage();
  } catch (error) {
    addLog("error", `Media storage unavailable at startup: ${error.message}`);
  }
  await storage.secureFile(DATABASE_FILE);
}

async function readJson(file, fallback) {
  const documentKey = storage.documentKeyForFile(file);
  if (documentKey) return storage.readDocument(documentKey, fallback);
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") addLog("error", `Could not read ${path.basename(file)}: ${error.message}`);
    return fallback;
  }
}

async function writeJson(file, value) {
  const documentKey = storage.documentKeyForFile(file);
  if (documentKey) {
    storage.writeDocument(documentKey, value);
    return;
  }
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await fsp.rename(tmp, file);
}

async function readSettings() {
  const settings = await readJson(SETTINGS_FILE, DEFAULT_SETTINGS);
  const { adminPinHash: _legacyAdminPinHash, ...currentSettings } = settings;
  const merged = {
    ...DEFAULT_SETTINGS,
    ...currentSettings,
    audioDefaults: { ...DEFAULT_SETTINGS.audioDefaults, ...(currentSettings.audioDefaults || {}) },
    network: { ...DEFAULT_SETTINGS.network, ...(currentSettings.network || {}) },
    storage: { ...DEFAULT_SETTINGS.storage, ...(currentSettings.storage || {}) },
    backup: { ...DEFAULT_SETTINGS.backup, ...(currentSettings.backup || {}) },
    autoLookup: { ...DEFAULT_SETTINGS.autoLookup, ...(currentSettings.autoLookup || {}) },
    theme: { ...DEFAULT_SETTINGS.theme, ...(currentSettings.theme || {}) }
  };
  return backfillStoredLogo(merged);
}

async function backfillStoredLogo(settings) {
  if (settings.customLogo && !settings.customLogoDataUri) {
    try {
      const logo = await fsp.readFile(CUSTOM_LOGO_FILE);
      if (logo.length) {
        const mime = detectImageMime(logo, settings.customLogoMime || "");
        const repaired = {
          ...settings,
          customLogo: true,
          customLogoMime: mime,
          customLogoVersion: settings.customLogoVersion || String(Date.now()),
          customLogoDataUri: logoDataUri({ buffer: logo, mime })
        };
        await writeJson(SETTINGS_FILE, repaired);
        addLog("settings", "Imported existing custom logo into permanent settings");
        return repaired;
      }
    } catch {}
    const repaired = { ...settings, customLogo: false, customLogoMime: "", customLogoVersion: "", customLogoDataUri: "" };
    await writeJson(SETTINGS_FILE, repaired);
    addLog("settings", "Cleared stale custom logo setting");
    return repaired;
  }
  return settings;
}

async function getMediaDir(settings = null) {
  const appSettings = settings || await readSettings();
  const usbPath = String(appSettings.storage?.usbPath || "").trim();
  return appSettings.storage?.mode === "usb" && usbPath ? path.resolve(usbPath) : INTERNAL_MEDIA_DIR;
}

async function isReadableFile(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function findFileByName(baseDir, fileName, maxDepth = 5) {
  if (!baseDir || maxDepth < 0) return "";
  let entries;
  try {
    entries = await fsp.readdir(baseDir, { withFileTypes: true });
  } catch {
    return "";
  }
  for (const entry of entries) {
    const candidate = path.join(baseDir, entry.name);
    if (entry.isFile() && entry.name === fileName) return candidate;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === ".trash" || entry.name.startsWith(".")) continue;
    const found = await findFileByName(path.join(baseDir, entry.name), fileName, maxDepth - 1);
    if (found) return found;
  }
  return "";
}

async function resolveMediaFile(fileName) {
  const settings = await readSettings();
  const activeDir = await getMediaDir(settings);
  const candidates = [safeJoin(activeDir, fileName)];
  if (activeDir !== INTERNAL_MEDIA_DIR) candidates.push(safeJoin(INTERNAL_MEDIA_DIR, fileName));
  const usbPath = String(settings.storage?.usbPath || "").trim();
  if (usbPath && path.resolve(usbPath) !== activeDir) candidates.push(safeJoin(path.resolve(usbPath), fileName));
  for (const candidate of [...new Set(candidates)]) {
    if (await isReadableFile(candidate)) return { filePath: candidate, mediaDir: path.dirname(candidate), recovered: candidate !== candidates[0] };
  }
  if (process.platform === "linux") {
    for (const baseDir of ["/media", "/mnt"]) {
      const found = await findFileByName(baseDir, fileName);
      if (found) return { filePath: found, mediaDir: path.dirname(found), recovered: true };
    }
  }
  throw new Error(`MP3 file is missing from storage: ${fileName}. Check Settings > Network & System storage location, or upload/copy the MP3 to the selected storage.`);
}

async function resolveMediaRequest(target) {
  const fileName = path.basename(target || "");
  if (!fileName || target !== fileName) throw new Error("Invalid media path.");
  if (!fileName.toLowerCase().endsWith(".mp3")) throw new Error("Invalid media file.");
  return resolveMediaFile(fileName);
}

function getTrashDir(mediaDir) {
  return path.join(mediaDir, ".trash");
}

async function ensureMediaStorage(settings = null) {
  const activeSettings = settings || await readSettings();
  const mediaDir = await getMediaDir(activeSettings);
  if (activeSettings.storage?.mode === "usb") {
    try {
      const stat = await fsp.stat(mediaDir);
      if (!stat.isDirectory()) throw new Error("Configured USB storage path is not a directory.");
    } catch (error) {
      if (error.code === "ENOENT") throw new Error("USB hymn storage is unavailable. Reconnect the drive before continuing.");
      throw error;
    }
    if (process.platform === "linux" && await commandExists("findmnt")) {
      const mount = await runCommand("findmnt", ["-n", "-o", "TARGET", "--target", mediaDir]).catch(() => ({ stdout: "" }));
      const mountPoint = mount.stdout.trim();
      if (!mountPoint || mountPoint === "/") {
        throw new Error("USB hymn storage is not mounted. Writes are blocked to protect the Raspberry Pi SD card.");
      }
    }
  }
  await fsp.mkdir(mediaDir, { recursive: true });
  await fsp.mkdir(getTrashDir(mediaDir), { recursive: true });
  return mediaDir;
}

function publicSettings(settings) {
  const { openAiApiKey, ...safe } = settings;
  return { ...safe, openAiApiKeyConfigured: Boolean(openAiApiKey || process.env.OPENAI_API_KEY) };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeCssValue(value, fallback) {
  const text = String(value || "").trim();
  return /^#[0-9a-f]{3,8}$/i.test(text) || /^[a-z0-9(),.%\s-]+$/i.test(text) ? text : fallback;
}

function initialBrandColors(settings) {
  const theme = settings.theme || {};
  return {
    accent: safeCssValue(theme.accent, DEFAULT_SETTINGS.theme.accent),
    blue: safeCssValue(theme.blue, DEFAULT_SETTINGS.theme.blue),
    paper: safeCssValue(theme.paper, DEFAULT_SETTINGS.theme.paper),
    panel: safeCssValue(theme.panel, DEFAULT_SETTINGS.theme.panel),
    panelSoft: safeCssValue(theme.panelSoft, "#f5f9fd"),
    button: safeCssValue(theme.button, "#ffffff"),
    ink: safeCssValue(theme.ink, DEFAULT_SETTINGS.theme.ink),
    muted: safeCssValue(theme.muted, "#55708b"),
    line: safeCssValue(theme.line, "#b7d3e9"),
    player: safeCssValue(theme.player, "#d6eafa"),
    queue: safeCssValue(theme.queue, "#ffffff"),
    danger: safeCssValue(theme.danger, "#b94d5e")
  };
}

function initialBrandStyle(settings) {
  const colors = initialBrandColors(settings);
  const variables = {
    "--accent": colors.accent,
    "--blue": colors.blue,
    "--paper": colors.paper,
    "--panel": colors.panel,
    "--panel-soft": colors.panelSoft,
    "--button": colors.button,
    "--ink": colors.ink,
    "--muted": colors.muted,
    "--line": colors.line,
    "--accent-2": colors.danger,
    "--section-border": colors.line,
    "--section-fill": colors.panelSoft,
    "--section-accent": colors.accent,
    "--app-paper": colors.paper,
    "--app-panel": colors.panel,
    "--app-panel-soft": colors.panelSoft,
    "--app-ink": colors.ink,
    "--app-muted": colors.muted,
    "--app-line": colors.line,
    "--app-button": colors.button,
    "--app-accent": colors.accent,
    "--app-blue": colors.blue,
    "--app-player": colors.player,
    "--app-queue": colors.queue,
    "--app-danger": colors.danger
  };
  const body = Object.entries(variables).map(([name, value]) => `${name}:${value};`).join("");
  return `<style id="initialBrandTheme">:root{${body}}</style>`;
}

async function publicBranding(settings) {
  const logo = await readActiveLogo(settings);
  return {
    appName: settings.appName || DEFAULT_SETTINGS.appName,
    palette: settings.palette || settings.theme?.palette || DEFAULT_SETTINGS.palette,
    theme: settings.theme || DEFAULT_SETTINGS.theme,
    customLogo: logo.custom,
    customLogoVersion: logo.custom ? String(settings.customLogoVersion || "") : "",
    logoDataUri: logoDataUri(logo)
  };
}

async function publicAppSettings(settings) {
  return {
    ...publicSettings(settings),
    ...await publicBranding(settings)
  };
}

async function requireAdmin(req) {
  if (req.auth?.role !== "admin") auth.requireRole(storage, req, "admin");
  return readSettings();
}

function requireAnyPermission(req, permissions) {
  if (req.auth?.role === "admin") return req.auth;
  if (!permissions.some((permission) => auth.hasPermission(req.auth, permission))) {
    throw auth.httpError(403, "Your account does not have permission for this feature.");
  }
  return req.auth;
}

function requireSettingsPatchPermissions(req, patch) {
  if (req.auth?.role === "admin") return;
  const required = new Set();
  const known = new Set();
  const add = (permission, keys) => keys.forEach((key) => {
    if (Object.hasOwn(patch, key)) {
      required.add(permission);
      known.add(key);
    }
  });
  add("settings.playback", ["audioDefaults"]);
  add("queue.alerts", ["serviceQueueAlertsEnabled"]);
  add("backups.settings", ["backup"]);
  add("lookup.settings", ["autoLookup", "newOpenAiApiKey"]);
  add("openai.clear", ["clearOpenAiApiKey"]);
  add("settings.appearance", ["displayMode", "appName", "palette", "theme"]);
  add("settings.network", ["dnsName", "network", "storage"]);
  const unknown = Object.keys(patch).filter((key) => !known.has(key));
  if (unknown.length) throw auth.httpError(403, "Administrator access is required for these settings.");
  for (const permission of required) auth.requirePermission(storage, req, permission);
}

function delegatedPermissions(req, value) {
  const requested = sanitizePermissions(value);
  if (req.auth?.role === "admin") return requested;
  return requested.filter((permission) => auth.hasPermission(req.auth, permission));
}

function libraryForSession(req, library) {
  if (auth.hasPermission(req.auth, "lyrics.view") || auth.hasPermission(req.auth, "hymns.edit")) return library;
  return library.map(({ lyrics: _lyrics, ...hymn }) => hymn);
}

function deviceNameFromUserAgent(userAgent = "") {
  const ua = String(userAgent);
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua))) return "iPad";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Android phone" : "Android tablet";
  if (/Windows/i.test(ua)) return "Windows device";
  if (/Macintosh|Mac OS/i.test(ua)) return "Mac device";
  if (/Linux/i.test(ua)) return "Linux device";
  return "Device";
}

function trackController(req) {
  const address = req.socket.remoteAddress || "unknown";
  const key = address.replace(/^::ffff:/, "");
  const userAgent = req.headers["user-agent"] || "Unknown device";
  const existing = controllers.get(key);
  const now = Date.now();
  const firstSeen = existing?.firstSeen || new Date(now).toISOString();
  const name = deviceNameFromUserAgent(userAgent);
  if (!existing) addLog("device", `${name} connected from ${key}`);
  controllers.set(key, {
    address: key,
    name,
    firstSeen,
    lastSeen: new Date(now).toISOString(),
    lastSeenMs: now,
    active: true,
    userAgent
  });
}

function cleanupControllers() {
  const now = Date.now();
  for (const [key, controller] of controllers.entries()) {
    if (now - Number(controller.lastSeenMs || 0) > CONTROLLER_TIMEOUT_MS) {
      addLog("device", `${controller.name || "Device"} disconnected from ${key}`);
      controllers.delete(key);
    }
  }
}

async function pathSize(target) {
  try {
    const stat = await fsp.stat(target);
    if (stat.isFile()) return stat.size;
    const entries = await fsp.readdir(target, { withFileTypes: true });
    const sizes = await Promise.all(entries.map((entry) => pathSize(path.join(target, entry.name))));
    return sizes.reduce((sum, size) => sum + size, 0);
  } catch {
    return 0;
  }
}

async function getStorageStats() {
  const settings = await readSettings();
  let mediaDir;
  let storageError = "";
  try {
    mediaDir = await ensureMediaStorage(settings);
  } catch (error) {
    mediaDir = await getMediaDir(settings);
    storageError = error.message;
  }
  const trashDir = getTrashDir(mediaDir);
  const library = await syncLibrary();
  const trashEntries = await listTrash();
  let statfs = null;
  if (!storageError && typeof fsp.statfs === "function") {
    try {
      statfs = await fsp.statfs(mediaDir);
    } catch {}
  }
  const free = statfs ? Number(statfs.bavail) * Number(statfs.bsize) : null;
  const total = statfs ? Number(statfs.blocks) * Number(statfs.bsize) : null;
  return {
    dataPath: DATA_DIR,
    mediaPath: mediaDir,
    trashPath: trashDir,
    storageMode: settings.storage?.mode || "internal",
    internalPath: INTERNAL_MEDIA_DIR,
    usbPath: settings.storage?.usbPath || "",
    mp3Count: library.length,
    mediaSize: await pathSize(mediaDir),
    trashSize: trashEntries.reduce((sum, item) => sum + item.size, 0),
    trashCount: trashEntries.length,
    free,
    total,
    error: storageError
  };
}

async function readTemperature() {
  if (process.platform !== "linux") return null;
  try {
    const raw = await fsp.readFile("/sys/class/thermal/thermal_zone0/temp", "utf8");
    return Number(raw.trim()) / 1000;
  } catch {
    return null;
  }
}

function networkInterfacesWithNames() {
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, items]) => (items || []).filter(Boolean).map((item) => ({ name, ...item })));
}

async function getNetworkLinkSpeed() {
  const active = networkInterfacesWithNames().find((item) => item.family === "IPv4" && !item.internal);
  if (!active) return { interface: "", mbps: null };
  if (process.platform !== "linux") return { interface: active.name, mbps: null };
  try {
    const raw = await fsp.readFile(`/sys/class/net/${active.name}/speed`, "utf8");
    const mbps = Number(raw.trim());
    return { interface: active.name, mbps: Number.isFinite(mbps) && mbps > 0 ? mbps : null };
  } catch {
    return { interface: active.name, mbps: null };
  }
}

async function getResourceStats() {
  const cpus = os.cpus();
  const network = networkInterfacesWithNames().map((item) => ({
    name: item.name,
    address: item.address,
    family: item.family,
    internal: item.internal
  }));
  return {
    app: "Hymn Console",
    hostname: os.hostname(),
    platform: process.platform,
    arch: os.arch(),
    nodeVersion: process.version,
    uptime: os.uptime(),
    processUptime: process.uptime(),
    loadAverage: os.loadavg(),
    cpuCount: cpus.length,
    cpuModel: cpus[0]?.model || "Unknown CPU",
    memory: { free: os.freemem(), total: os.totalmem() },
    storage: await getStorageStats(),
    network,
    networkSpeed: await getNetworkLinkSpeed(),
    temperatureC: await readTemperature(),
    controllers: {
      active: controllers.size,
      timeoutSeconds: Math.round(CONTROLLER_TIMEOUT_MS / 1000)
    },
    playback: {
      soundSystem: serverPlayer.status,
      liveSource: serverPlayer.status !== "stopped" ? "server" : livePlayback.source || "",
      liveStatus: serverPlayer.status !== "stopped" ? serverPlayer.status : livePlayback.status,
      liveTitle: serverPlayer.status !== "stopped" ? serverPlayer.currentTitle : livePlayback.currentTitle
    },
    logs: {
      count: eventLog.length,
      latest: eventLog[0]?.time || ""
    }
  };
}

async function listTrash() {
  try {
    const mediaDir = await ensureMediaStorage();
    const trashDir = getTrashDir(mediaDir);
    const entries = await fsp.readdir(trashDir, { withFileTypes: true });
    const files = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".mp3"))
      .map(async (entry) => {
        const filePath = path.join(trashDir, entry.name);
        const stat = await fsp.stat(filePath);
        return { name: entry.name, size: stat.size, deletedAt: stat.mtime.toISOString() };
      }));
    return files.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
  } catch {
    return [];
  }
}

async function createBackupFile() {
  const settings = await readSettings();
  const createdAt = new Date().toISOString();
  const name = `hymn-console-backup-${createdAt.replace(/[:.]/g, "-")}`;
  const snapshotPath = path.join(BACKUP_DIR, name);
  const mediaDir = await ensureMediaStorage(settings);
  await fsp.mkdir(snapshotPath, { recursive: true });
  await fsp.mkdir(path.join(snapshotPath, "media"), { recursive: true });
  storage.snapshotDatabase(path.join(snapshotPath, "hymn-console.sqlite"));
  const mediaFiles = (await fsp.readdir(mediaDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".mp3"));
  for (const entry of mediaFiles) {
    await fsp.copyFile(path.join(mediaDir, entry.name), path.join(snapshotPath, "media", entry.name));
  }
  for (const [source, target] of [
    [CUSTOM_LOGO_FILE, "custom-logo"]
  ]) {
    try {
      await fsp.copyFile(source, path.join(snapshotPath, target));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  await writeJson(path.join(snapshotPath, "manifest.json"), {
    formatVersion: 2,
    app: "Hymn Console",
    createdAt,
    database: "hymn-console.sqlite",
    mediaFolder: "media",
    mediaFiles: mediaFiles.length,
    hostname: os.hostname(),
    nodeVersion: process.version
  });
  await storage.secureFile(path.join(snapshotPath, "hymn-console.sqlite"));

  let externalPath = "";
  const targetRoot = String(settings.backup?.targetPath || "").trim();
  if (targetRoot) {
    const resolvedTarget = path.resolve(targetRoot);
    if (resolvedTarget === path.resolve(BACKUP_DIR) || resolvedTarget.startsWith(`${path.resolve(BACKUP_DIR)}${path.sep}`)) {
      throw new Error("External backup target must be outside the internal backup folder.");
    }
    await fsp.mkdir(resolvedTarget, { recursive: true });
    externalPath = path.join(resolvedTarget, name);
    await fsp.cp(snapshotPath, externalPath, { recursive: true, errorOnExist: true, force: false });
  }

  const retentionDays = Math.max(1, Math.min(365, Number(settings.backup?.retentionDays || 14)));
  await pruneBackupFolders(BACKUP_DIR, retentionDays);
  if (targetRoot) await pruneBackupFolders(path.resolve(targetRoot), retentionDays);
  return { name, snapshotPath, externalPath, mediaFiles: mediaFiles.length };
}

async function pruneBackupFolders(root, retentionDays) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("hymn-console-backup-"))
    .map(async (entry) => {
      const target = path.join(root, entry.name);
      const stat = await fsp.stat(target);
      if (stat.mtimeMs < cutoff) await fsp.rm(target, { recursive: true, force: true });
    }));
}

function scheduleMidnightBackups() {
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    setTimeout(async () => {
      try {
        const saved = await createBackupFile();
        addLog("backup", `Automatic midnight backup saved: ${saved.name}`);
      } catch (error) {
        addLog("error", `Automatic backup failed: ${error.message}`);
      } finally {
        scheduleNext();
      }
    }, Math.max(1000, next - now));
  };
  scheduleNext();
}

async function syncLibrary() {
  await ensureStorage();
  const library = await readJson(LIBRARY_FILE, []);
  const known = new Set(library.map((hymn) => hymn.fileName));
  let mediaDir;
  try {
    mediaDir = await ensureMediaStorage();
  } catch {
    return library.sort((a, b) => a.title.localeCompare(b.title));
  }
  const files = (await fsp.readdir(mediaDir)).filter((name) => name.toLowerCase().endsWith(".mp3"));
  let changed = false;
  for (const fileName of files) {
    if (!known.has(fileName)) {
      const title = path.basename(fileName, path.extname(fileName)).replace(/[_-]+/g, " ");
      library.push(newHymn({ title, fileName }));
      changed = true;
    }
  }
  if (changed) await writeJson(LIBRARY_FILE, library);
  return library.sort((a, b) => a.title.localeCompare(b.title));
}

function newHymn({ title, fileName, page = "", key = "", tempo = "", themes = "", notes = "" }) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: title || "Untitled hymn",
    fileName,
    page,
    key,
    tempo,
    themes,
    notes,
    defaultVerses: 3,
    hasChorus: true,
    fadeIn: 1.5,
    fadeOut: 2,
    segments: [],
    createdAt: now,
    updatedAt: now
  };
}

function normalizeSmartText(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/-\d{10,}$/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b(page|pg|p|key)\b/g, " ")
    .replace(/\b\d{1,4}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferMetadataFromFileName(fileName) {
  const raw = path.basename(fileName || "", path.extname(fileName || "")).replace(/-\d{10,}$/, "");
  const cleaned = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const pageMatch = cleaned.match(/\b(?:page|pg|p)\s*#?\s*(\d{1,4})\b/i) || cleaned.match(/\b(?:hymn|song)\s*(\d{1,4})\b/i);
  const keyMatch = cleaned.match(/\bkey\s*([A-G](?:#|b)?m?)\b/i) || cleaned.match(/\b([A-G](?:#|b)?m?)\s*(?:major|minor)\b/i);
  const title = cleaned
    .replace(/\b(?:page|pg|p)\s*#?\s*\d{1,4}\b/ig, "")
    .replace(/\b(?:hymn|song)\s*\d{1,4}\b/ig, "")
    .replace(/\bkey\s*[A-G](?:#|b)?m?\b/ig, "")
    .replace(/\b[A-G](?:#|b)?m?\s*(?:major|minor)\b/ig, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    title: title || cleaned || "Untitled hymn",
    page: pageMatch?.[1] || "",
    key: keyMatch?.[1] || ""
  };
}

const HYMN_KNOWLEDGE = [
  {
    match: ["amazing grace"],
    title: "Amazing Grace",
    themes: "Grace, Salvation, Testimony, Invitation",
    lyrics: [
      "Amazing grace how sweet the sound",
      "That saved a wretch like me",
      "I once was lost but now am found",
      "Was blind but now I see"
    ].join("\n")
  },
  {
    match: ["holy holy holy"],
    title: "Holy, Holy, Holy",
    themes: "Worship, Trinity, Praise, Opening",
    lyrics: [
      "Holy holy holy Lord God Almighty",
      "Early in the morning our song shall rise to Thee"
    ].join("\n")
  },
  {
    match: ["it is well", "it is well with my soul"],
    title: "It Is Well With My Soul",
    themes: "Peace, Faith, Comfort, Assurance",
    lyrics: [
      "When peace like a river attendeth my way",
      "When sorrows like sea billows roll"
    ].join("\n")
  },
  {
    match: ["blessed assurance"],
    title: "Blessed Assurance",
    themes: "Assurance, Testimony, Praise",
    lyrics: [
      "Blessed assurance Jesus is mine",
      "O what a foretaste of glory divine"
    ].join("\n")
  },
  {
    match: ["just as i am"],
    title: "Just As I Am",
    themes: "Invitation, Salvation, Commitment",
    lyrics: [
      "Just as I am without one plea",
      "But that Thy blood was shed for me"
    ].join("\n")
  },
  {
    match: ["all hail king jesus"],
    title: "All Hail King Jesus",
    themes: "Praise, Worship, Majesty"
  }
];

function findKnownHymn(title) {
  const normalized = normalizeSmartText(title);
  return HYMN_KNOWLEDGE.find((item) => item.match.some((phrase) => normalized.includes(normalizeSmartText(phrase))));
}

function readTextFrame(data, encoding) {
  if (!data.length) return "";
  if (encoding === 1 || encoding === 2) {
    const body = data.subarray(1);
    const text = body.toString("utf16le").replace(/\0/g, "").trim();
    return text.replace(/^\uFEFF/, "");
  }
  return data.subarray(1).toString("utf8").replace(/\0/g, "").trim();
}

async function readMp3Tags(filePath) {
  try {
    const handle = await fsp.open(filePath, "r");
    const header = Buffer.alloc(10);
    await handle.read(header, 0, 10, 0);
    if (header.subarray(0, 3).toString("latin1") !== "ID3") {
      await handle.close();
      return {};
    }
    const size = ((header[6] & 0x7f) << 21) | ((header[7] & 0x7f) << 14) | ((header[8] & 0x7f) << 7) | (header[9] & 0x7f);
    const tag = Buffer.alloc(Math.min(size, 256 * 1024));
    await handle.read(tag, 0, tag.length, 10);
    await handle.close();
    const tags = {};
    let offset = 0;
    while (offset + 10 < tag.length) {
      const id = tag.subarray(offset, offset + 4).toString("latin1");
      const frameSize = tag.readUInt32BE(offset + 4);
      if (!/^[A-Z0-9]{4}$/.test(id) || frameSize <= 0) break;
      const frame = tag.subarray(offset + 10, Math.min(tag.length, offset + 10 + frameSize));
      if (id === "TIT2") tags.title = readTextFrame(frame, frame[0]);
      if (id === "TKEY") tags.key = readTextFrame(frame, frame[0]);
      if (id === "TBPM") tags.tempo = readTextFrame(frame, frame[0]);
      if (id === "TCON") tags.themes = readTextFrame(frame, frame[0]);
      if (id === "USLT") {
        const text = readTextFrame(frame, frame[0]);
        tags.lyrics = text.replace(/^.{0,3}\0/, "").trim();
      }
      offset += 10 + frameSize;
    }
    return tags;
  } catch {
    return {};
  }
}

async function buildLookupSuggestions(hymn) {
  const fileName = path.basename(hymn.fileName || "");
  const mediaDir = await ensureMediaStorage();
  const filePath = safeJoin(mediaDir, fileName);
  const tags = await readMp3Tags(filePath);
  const inferred = inferMetadataFromFileName(fileName);
  const known = findKnownHymn(tags.title || hymn.title || inferred.title || fileName);
  const suggestions = {
    title: tags.title || known?.title || inferred.title || hymn.title || "",
    key: tags.key || inferred.key || "",
    tempo: tags.tempo || "",
    themes: tags.themes || known?.themes || "",
    lyrics: tags.lyrics || known?.lyrics || "",
    notes: []
  };
  suggestions.notes.push(tags.title || tags.key || tags.tempo || tags.themes || tags.lyrics ? "Read metadata from MP3 tags." : "No usable MP3 tags found.");
  if (known) suggestions.notes.push("Matched a built-in/common hymn reference.");
  if (!suggestions.lyrics) suggestions.notes.push("No lyrics were found in tags or the built-in reference.");
  return suggestions;
}

async function fetchExternalLookup(settings, hymn, baseSuggestions) {
  if (!settings.autoLookup?.webEnabled || !settings.autoLookup?.lookupUrl) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(settings.autoLookup.lookupUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hymn, suggestions: baseSuggestions }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Lookup service returned ${response.status}`);
    return await response.json();
  } catch (error) {
    return { notes: [`Web/AI lookup unavailable: ${error.message}`] };
  } finally {
    clearTimeout(timeout);
  }
}

function extractResponseText(response) {
  if (response.output_text) return response.output_text;
  const parts = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function parseAiLookup(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { notes: ["AI lookup returned text, but it was not valid JSON."] };
    try {
      return JSON.parse(match[0]);
    } catch {
      return { notes: ["AI lookup returned text, but it could not be parsed."] };
    }
  }
}

function pickLookupValue(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
    if (value !== undefined && value !== null && typeof value !== "string") return value;
  }
  return "";
}

function mergeLookupSuggestions(local, ai, external) {
  return {
    title: pickLookupValue(external?.title, ai?.title, local?.title),
    key: pickLookupValue(external?.key, ai?.key, local?.key),
    tempo: pickLookupValue(external?.tempo, ai?.tempo, local?.tempo),
    themes: pickLookupValue(external?.themes, ai?.themes, local?.themes),
    lyrics: pickLookupValue(external?.lyrics, ai?.lyrics, local?.lyrics),
    notes: [...(local?.notes || []), ...((ai && ai.notes) || []), ...((external && external.notes) || [])]
  };
}

async function fetchBuiltInAiLookup(settings, hymn, baseSuggestions) {
  if (!settings.autoLookup?.builtInAiEnabled) return null;
  const apiKey = settings.openAiApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) return { notes: ["Built-in AI lookup is enabled, but no OpenAI API key is saved."] };
  const model = settings.autoLookup.model || "gpt-4.1-mini";
  const tools = settings.autoLookup.webSearch ? [{ type: "web_search_preview" }] : [];
  const prompt = [
    "You are helping maintain a church hymn MP3 library.",
    "Return only JSON with these string fields: title, key, tempo, themes, lyrics, notes.",
    "If lyrics are found in local metadata, provided suggestions, or configured lookup results, include them in the lyrics field for review.",
    "Do not invent lyrics. If lyrics are unavailable, leave lyrics empty and explain what was found in notes.",
    "Themes should be comma-separated worship planning tags.",
    "Prefer cautious suggestions over guessing.",
    "",
    `Current hymn record: ${JSON.stringify({
      title: hymn.title,
      fileName: hymn.fileName,
      page: hymn.page,
      key: hymn.key,
      tempo: hymn.tempo,
      themes: hymn.themes
    })}`,
    `Local suggestions: ${JSON.stringify(baseSuggestions)}`
  ].join("\n");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: prompt,
        tools,
        temperature: 0.2
      }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { notes: [`OpenAI lookup failed: ${data.error?.message || response.status}`] };
    }
    const parsed = parseAiLookup(extractResponseText(data));
    return {
      title: parsed.title || "",
      key: parsed.key || "",
      tempo: parsed.tempo || "",
      themes: parsed.themes || "",
      lyrics: parsed.lyrics || "",
      notes: Array.isArray(parsed.notes) ? parsed.notes : [parsed.notes].filter(Boolean)
    };
  } catch (error) {
    return { notes: [`OpenAI lookup unavailable: ${error.message}`] };
  } finally {
    clearTimeout(timeout);
  }
}

function servicePlanReason(index, hymn) {
  const page = hymn.page ? `Page ${hymn.page}` : "No page number";
  if (index === 0) return `Opening hymn - ${page}`;
  if (index === 1) return `Congregational hymn - ${page}`;
  if (index === 2) return `Offering or response hymn - ${page}`;
  if (index === 3) return `Closing hymn - ${page}`;
  return `Additional hymn - ${page}`;
}

function parseCsv(text) {
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

function csvRecords(text) {
  const rows = parseCsv(text);
  const headers = (rows.shift() || []).map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ""));
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
}

function csvField(record, ...names) {
  for (const name of names) {
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (record[key] !== undefined && record[key] !== "") return record[key];
  }
  return "";
}

function parseCsvNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseCsvVolume(value, fallback = 0.9) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number > 1 ? number / 100 : number));
}

function collectRequest(req, limitMb = 300) {
  const chunks = [];
  let size = 0;
  const limit = limitMb * 1024 * 1024;
  return new Promise((resolve, reject) => {
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Upload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parsePartHeaders(text) {
  const headers = {};
  for (const line of String(text).split("\r\n")) {
    const index = line.indexOf(":");
    if (index > 0) headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  const disposition = headers["content-disposition"] || "";
  const name = disposition.match(/(?:^|;)\s*name="([^"]*)"/i)?.[1] || "";
  const filename = disposition.match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1] || "";
  return { name, filename: path.basename(filename), type: headers["content-type"] || "application/octet-stream" };
}

async function writeStreamChunk(stream, chunk) {
  if (!chunk.length) return;
  if (stream.write(chunk)) return;
  await new Promise((resolve, reject) => {
    stream.once("drain", resolve);
    stream.once("error", reject);
  });
}

async function finishWriteStream(stream) {
  await new Promise((resolve, reject) => {
    stream.once("finish", resolve);
    stream.once("error", reject);
    stream.end();
  });
}

async function streamMultipart(req, { tempDir, limitMb = 1024, maxFiles = 200, maxFieldBytes = 1024 * 1024 }) {
  const boundaryValue = String(req.headers["content-type"] || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundaryText = boundaryValue?.[1] || boundaryValue?.[2];
  if (!boundaryText) throw auth.httpError(400, "Multipart boundary is missing.");
  const boundary = Buffer.from(`--${boundaryText}`);
  const delimiter = Buffer.from(`\r\n--${boundaryText}`);
  const headerEnd = Buffer.from("\r\n\r\n");
  const fields = {};
  const files = [];
  const temporaryFiles = [];
  let buffer = Buffer.alloc(0);
  let total = 0;
  let state = "boundary";
  let part = null;
  let fileStream = null;
  let fieldChunks = [];
  let fieldSize = 0;
  let fileSize = 0;

  const finishPart = async () => {
    if (!part) return;
    if (fileStream) {
      await finishWriteStream(fileStream);
      files.push({ ...part, tempPath: part.tempPath, size: fileSize });
    } else if (part.name) {
      fields[part.name] = Buffer.concat(fieldChunks).toString("utf8");
    }
    part = null;
    fileStream = null;
    fieldChunks = [];
    fieldSize = 0;
    fileSize = 0;
  };

  const writePart = async (chunk) => {
    if (!part || !chunk.length) return;
    if (fileStream) {
      fileSize += chunk.length;
      await writeStreamChunk(fileStream, chunk);
      return;
    }
    fieldSize += chunk.length;
    if (fieldSize > maxFieldBytes) throw auth.httpError(413, "Form field is too large.");
    fieldChunks.push(chunk);
  };

  try {
    await fsp.mkdir(tempDir, { recursive: true });
    for await (const chunk of req) {
      total += chunk.length;
      if (total > limitMb * 1024 * 1024) throw auth.httpError(413, `Upload exceeds ${limitMb} MB.`);
      buffer = Buffer.concat([buffer, chunk]);
      let progress = true;
      while (progress) {
        progress = false;
        if (state === "boundary") {
          const index = buffer.indexOf(boundary);
          if (index < 0) {
            if (buffer.length > boundary.length) buffer = buffer.subarray(buffer.length - boundary.length);
            continue;
          }
          buffer = buffer.subarray(index + boundary.length);
          state = "after-boundary";
          progress = true;
        } else if (state === "headers") {
          const index = buffer.indexOf(headerEnd);
          if (index < 0) {
            if (buffer.length > 64 * 1024) throw auth.httpError(400, "Multipart headers are too large.");
            continue;
          }
          part = parsePartHeaders(buffer.subarray(0, index).toString("utf8"));
          buffer = buffer.subarray(index + headerEnd.length);
          if (part.filename) {
            if (temporaryFiles.length >= maxFiles) throw auth.httpError(400, `Upload is limited to ${maxFiles} files at a time.`);
            part.tempPath = path.join(tempDir, `.upload-${crypto.randomUUID()}.tmp`);
            temporaryFiles.push(part.tempPath);
            fileStream = fs.createWriteStream(part.tempPath, { flags: "wx", mode: 0o600 });
          }
          state = "body";
          progress = true;
        } else if (state === "body") {
          const index = buffer.indexOf(delimiter);
          if (index >= 0) {
            await writePart(buffer.subarray(0, index));
            await finishPart();
            buffer = buffer.subarray(index + delimiter.length);
            if (buffer.length < 2) {
              state = "after-boundary";
              continue;
            }
            if (buffer.subarray(0, 2).toString() === "--") {
              state = "done";
              buffer = Buffer.alloc(0);
            } else if (buffer.subarray(0, 2).toString() === "\r\n") {
              buffer = buffer.subarray(2);
              state = "headers";
              progress = true;
            } else {
              throw auth.httpError(400, "Malformed multipart separator.");
            }
          } else {
            const safeLength = Math.max(0, buffer.length - delimiter.length - 4);
            if (safeLength) {
              await writePart(buffer.subarray(0, safeLength));
              buffer = buffer.subarray(safeLength);
            }
          }
        } else if (state === "after-boundary") {
          if (buffer.length < 2) continue;
          if (buffer.subarray(0, 2).toString() === "--") {
            state = "done";
            buffer = Buffer.alloc(0);
          } else if (buffer.subarray(0, 2).toString() === "\r\n") {
            buffer = buffer.subarray(2);
            state = "headers";
            progress = true;
          } else {
            throw auth.httpError(400, "Malformed multipart ending.");
          }
        }
      }
    }
    if (state !== "done") throw auth.httpError(400, "Upload ended before the multipart form completed.");
    return { fields, files, temporaryFiles };
  } catch (error) {
    if (fileStream && !fileStream.closed) fileStream.destroy();
    await Promise.all(temporaryFiles.map((file) => fsp.rm(file, { force: true }).catch(() => {})));
    throw error;
  }
}

async function isMp3File(file) {
  const handle = await fsp.open(file, "r");
  try {
    const header = Buffer.alloc(3);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead < 2) return false;
    return header.subarray(0, 3).toString("latin1") === "ID3" || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0);
  } finally {
    await handle.close();
  }
}

function stopServerAudio() {
  if (serverPlayer.status !== "stopped") addLog("audio", "Sound system playback stopped");
  serverPlayer.queue = [];
  serverPlayer.index = 0;
  serverPlayer.status = "stopped";
  serverPlayer.currentTitle = "";
  serverPlayer.currentMeta = "";
  serverPlayer.hymnId = "";
  serverPlayer.queueIndex = -1;
  serverPlayer.totalDuration = 0;
  serverPlayer.elapsedBefore = 0;
  serverPlayer.itemStartedAt = 0;
  serverPlayer.pausedAt = 0;
  serverPlayer.backend = "";
  serverPlayer.lastOutput = "";
  if (serverPlayer.process) {
    serverPlayer.process.removeAllListeners();
    try {
      serverPlayer.process.kill();
    } catch {}
    serverPlayer.process = null;
  }
  if (serverPlayer.helperProcess) {
    serverPlayer.helperProcess.removeAllListeners();
    try {
      serverPlayer.helperProcess.kill();
    } catch {}
    serverPlayer.helperProcess = null;
  }
  if (serverPlayer.ipcPath) {
    try {
      fs.rmSync(serverPlayer.ipcPath, { force: true });
    } catch {}
    serverPlayer.ipcPath = "";
  }
  for (const file of serverPlayer.cleanupFiles) {
    try {
      fs.rmSync(file, { force: true });
    } catch {}
  }
  serverPlayer.cleanupFiles = [];
}

function soundSystemPlayer() {
  return process.env.HYMN_AUDIO_PLAYER || (process.platform === "linux" ? "mpv" : "ffplay");
}

function isMpvPlayer(player) {
  return path.basename(player).toLowerCase().includes("mpv");
}

function mpvAudioOutputArgs() {
  const args = [];
  const audioOutput = String(process.env.HYMN_MPV_AO || "").trim();
  const audioDevice = String(process.env.HYMN_MPV_AUDIO_DEVICE || "").trim();
  if (audioOutput) args.push(`--ao=${audioOutput}`);
  if (audioDevice) args.push(`--audio-device=${audioDevice}`);
  return args;
}

function buildAudioFilters(item, isFirst = true, isLast = true) {
  const player = soundSystemPlayer();
  const filters = [];
  const speed = Math.max(0.5, Math.min(2, Number(item.speed || 1)));
  const volume = Math.max(0, Math.min(2, Number(item.volume ?? 1)));
  if (speed !== 1) filters.push(`atempo=${speed}`);
  if (volume !== 1) filters.push(`volume=${volume}`);
  if (isFirst && item.fadeIn) filters.push(`afade=t=in:st=0:d=${Number(item.fadeIn)}`);
  if (isLast && item.fadeOut && item.duration && item.duration > item.fadeOut) {
    filters.push(`afade=t=out:st=${Math.max(0, item.duration - item.fadeOut)}:d=${Number(item.fadeOut)}`);
  }
  return { player, filters };
}

function sendMpvCommand(command) {
  if (!serverPlayer.ipcPath) return Promise.reject(new Error("MPV control socket is not ready."));
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(serverPlayer.ipcPath);
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      error ? reject(error) : resolve();
    };
    socket.setTimeout(750, () => finish(new Error("MPV control timed out.")));
    socket.once("error", finish);
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ command })}\n`, () => finish());
    });
  });
}

async function setMpvVolume(volume) {
  await sendMpvCommand(["set_property", "volume", Math.max(0, Math.min(100, volume))]);
}

async function fadeMpvVolume(from, to, seconds) {
  const duration = Math.max(0, Number(seconds || 0));
  const steps = duration ? Math.max(4, Math.round(duration * 12)) : 1;
  for (let step = 0; step <= steps; step += 1) {
    const value = from + ((to - from) * step) / steps;
    await setMpvVolume(value).catch(() => {});
    if (step < steps) await new Promise((resolve) => setTimeout(resolve, (duration * 1000) / steps));
  }
}

async function waitForMpvSocket() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await fsp.access(serverPlayer.ipcPath);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  return false;
}

function startServerProcess(player, args, helperProcess = null) {
  let playerOutput = "";
  let helperOutput = "";
  const appendOutput = (current, chunk) => {
    const next = `${current}${chunk.toString()}`;
    return next.length > 4000 ? next.slice(-4000) : next;
  };
  const summarizeOutput = () => {
    const combined = [playerOutput, helperOutput].map((value) => value.trim()).filter(Boolean).join(" | ");
    return combined ? combined.replace(/\s+/g, " ").slice(0, 700) : "";
  };
  serverPlayer.status = "playing";
  serverPlayer.itemStartedAt = Date.now();
  serverPlayer.pausedAt = 0;
  serverPlayer.helperProcess = helperProcess;
  serverPlayer.backend = isMpvPlayer(player) ? "mpv" : "ffplay";
  serverPlayer.lastOutput = "";
  addLog("audio", `Playing on sound system: ${serverPlayer.currentTitle || "selected hymn"}`);
  if (isMpvPlayer(player)) addLog("audio", `Sound system player command: ${path.basename(player)} ${args.map((arg) => String(arg).includes(" ") ? `"${arg}"` : arg).join(" ")}`);
  serverPlayer.process = spawn(player, args, { stdio: [helperProcess ? "pipe" : "ignore", "ignore", "pipe"], windowsHide: true });
  serverPlayer.process.stderr?.on("data", (chunk) => {
    playerOutput = appendOutput(playerOutput, chunk);
    serverPlayer.lastOutput = summarizeOutput();
  });
  if (helperProcess) {
    helperProcess.stderr?.on("data", (chunk) => {
      helperOutput = appendOutput(helperOutput, chunk);
      serverPlayer.lastOutput = summarizeOutput();
    });
    serverPlayer.process.stdin?.on("error", (error) => {
      if (error.code !== "EPIPE") {
        serverPlayer.error = `Sound system input failed: ${error.message}`;
        addLog("error", serverPlayer.error);
      }
    });
    helperProcess.stdout?.on("error", (error) => {
      if (error.code !== "EPIPE") {
        serverPlayer.error = `ffmpeg output failed: ${error.message}`;
        addLog("error", serverPlayer.error);
      }
    });
    helperProcess.stdout.pipe(serverPlayer.process.stdin);
    helperProcess.once("error", (error) => {
      serverPlayer.error = `ffmpeg failed: ${error.message}`;
      addLog("error", serverPlayer.error);
      stopServerAudio();
    });
  }
  serverPlayer.process.once("error", (error) => {
    serverPlayer.error = `${player} failed: ${error.message}`;
    addLog("error", serverPlayer.error);
    stopServerAudio();
  });
  serverPlayer.process.once("exit", (code, signal) => {
    const output = summarizeOutput();
    serverPlayer.process = null;
    if (serverPlayer.helperProcess) {
      serverPlayer.helperProcess.removeAllListeners();
      try {
        serverPlayer.helperProcess.kill();
      } catch {}
      serverPlayer.helperProcess = null;
    }
    if (serverPlayer.status === "playing") {
      if (code && code !== 0) {
        serverPlayer.error = `${path.basename(player)} exited with code ${code}${output ? `: ${output}` : ""}`;
        addLog("error", serverPlayer.error);
      } else if (signal) {
        serverPlayer.error = `${path.basename(player)} stopped by signal ${signal}${output ? `: ${output}` : ""}`;
        addLog("error", serverPlayer.error);
      }
      serverPlayer.elapsedBefore = serverPlayer.totalDuration;
      stopServerAudio();
    }
  });
}

function startServerAudioQueue() {
  if (!serverPlayer.queue.length) {
    stopServerAudio();
    return;
  }
  const item = serverPlayer.queue[0];
  const { player, filters } = buildAudioFilters(item);
  if (isMpvPlayer(player)) {
    startServerAudioConcat();
    return;
  }

  const args = ["-nodisp", "-autoexit", "-loglevel", "quiet"];
  if (item.start) args.push("-ss", String(item.start));
  if (item.duration) args.push("-t", String(item.duration));
  args.push("-i", item.filePath);
  if (filters.length) args.push("-af", filters.join(","));
  startServerProcess(player, args);
}

function startDirectMpvFile(player, item, playbackFilePath = item.filePath, cleanupAfterPlay = false) {
  const itemVolume = Math.max(0, Math.min(2, Number(item.volume ?? 1)));
  const itemSpeed = Math.max(0.5, Math.min(2, Number(item.speed || 1)));
  serverPlayer.ipcPath = path.join(os.tmpdir(), `hymn-console-mpv-${process.pid}.sock`);
  try {
    fs.rmSync(serverPlayer.ipcPath, { force: true });
  } catch {}
  if (cleanupAfterPlay) serverPlayer.cleanupFiles.push(playbackFilePath);
  const targetVolume = Math.round(itemVolume * 100);
  const directArgs = [
    "--no-video",
    `--input-ipc-server=${serverPlayer.ipcPath}`,
    `--volume=${Number(item.fadeIn || 0) > 0 ? 0 : targetVolume}`,
    `--speed=${itemSpeed}`,
    ...mpvAudioOutputArgs(),
    playbackFilePath
  ];
  startServerProcess(player, directArgs);
  waitForMpvSocket()
    .then((ready) => {
      if (ready && Number(item.fadeIn || 0) > 0) return fadeMpvVolume(0, targetVolume, Number(item.fadeIn || 0));
      return null;
    })
    .catch(() => {});
}

function renderSegmentsThenPlay(player, item, filterGraph) {
  const ffmpeg = process.env.HYMN_FFMPEG || "ffmpeg";
  const tempWav = path.join(os.tmpdir(), `hymn-console-render-${process.pid}-${Date.now()}.wav`);
  const ffmpegArgs = ["-y", "-loglevel", "warning", "-i", item.filePath, "-filter_complex", filterGraph, "-map", "[out]", "-f", "wav", tempWav];
  let stderr = "";
  serverPlayer.status = "playing";
  serverPlayer.itemStartedAt = Date.now();
  serverPlayer.backend = "rendering";
  addLog("audio", `Preparing sound system arrangement: ${serverPlayer.currentTitle || "selected hymn"}`);
  const ffmpegProcess = spawn(ffmpeg, ffmpegArgs, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  serverPlayer.helperProcess = ffmpegProcess;
  ffmpegProcess.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-4000);
    serverPlayer.lastOutput = stderr.trim().replace(/\s+/g, " ").slice(0, 700);
  });
  ffmpegProcess.once("error", (error) => {
    serverPlayer.error = `ffmpeg failed: ${error.message}`;
    addLog("error", serverPlayer.error);
    fs.rmSync(tempWav, { force: true });
    stopServerAudio();
  });
  ffmpegProcess.once("exit", (code, signal) => {
    serverPlayer.helperProcess = null;
    if (serverPlayer.status === "stopped") {
      fs.rmSync(tempWav, { force: true });
      return;
    }
    if (code !== 0) {
      const detail = stderr.trim().replace(/\s+/g, " ").slice(0, 700);
      serverPlayer.error = `ffmpeg exited with code ${code || "unknown"}${signal ? ` signal ${signal}` : ""}${detail ? `: ${detail}` : ""}`;
      addLog("error", serverPlayer.error);
      fs.rmSync(tempWav, { force: true });
      stopServerAudio();
      return;
    }
    startDirectMpvFile(player, item, tempWav, true);
  });
}

function startServerAudioConcat() {
  if (!serverPlayer.queue.length) {
    stopServerAudio();
    return;
  }
  if (serverPlayer.queue.length === 1) {
    // A single segment still goes through ffmpeg when using mpv so live pause/stop fades can be controlled.
  }
  const item = serverPlayer.queue[0];
  const player = soundSystemPlayer();
  if (!isMpvPlayer(player)) {
    startServerAudioQueue();
    return;
  }
  if (serverPlayer.queue.length === 1 && item.fullFile) {
    startDirectMpvFile(player, item);
    return;
  }
  const trimFilters = serverPlayer.queue.map((segment, index) => {
    const start = Math.max(0, Number(segment.start || 0));
    const end = start + Math.max(0, Number(segment.duration || 0));
    return `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[s${index}]`;
  });
  const concatInputs = serverPlayer.queue.map((_, index) => `[s${index}]`).join("");
  const postFilters = buildAudioFilters({ ...item, duration: serverPlayer.totalDuration }, true, true).filters;
  const outputLabel = postFilters.length ? "[joined]" : "[out]";
  const joinFilter = serverPlayer.queue.length > 1
    ? `${concatInputs}concat=n=${serverPlayer.queue.length}:v=0:a=1${outputLabel}`
    : `[s0]anull${outputLabel}`;
  const filterGraph = [
    ...trimFilters,
    joinFilter,
    ...(postFilters.length ? [`[joined]${postFilters.join(",")}[out]`] : [])
  ].join(";");
  renderSegmentsThenPlay(player, item, filterGraph);
}

async function pauseServerAudio() {
  if (!serverPlayer.process) return false;
  if (process.platform === "win32") return false;
  const now = Date.now();
  if (serverPlayer.itemStartedAt) {
    serverPlayer.elapsedBefore += Math.max(0, (now - serverPlayer.itemStartedAt) / 1000);
  }
  serverPlayer.itemStartedAt = 0;
  serverPlayer.pausedAt = now;
  if (serverPlayer.backend === "mpv") {
    const fadeOut = Number(serverPlayer.queue[0]?.fadeOut || 0);
    await waitForMpvSocket();
    await fadeMpvVolume(100, 0, fadeOut);
    await sendMpvCommand(["set_property", "pause", true]).catch(() => {});
  } else {
    serverPlayer.process.kill("SIGSTOP");
    if (serverPlayer.helperProcess) serverPlayer.helperProcess.kill("SIGSTOP");
  }
  serverPlayer.status = "paused";
  addLog("audio", "Sound system playback paused");
  return true;
}

async function resumeServerAudio() {
  if (!serverPlayer.process) return false;
  if (process.platform === "win32") return false;
  if (serverPlayer.backend === "mpv") {
    const fadeIn = Number(serverPlayer.queue[0]?.fadeIn || 0);
    await waitForMpvSocket();
    await setMpvVolume(0).catch(() => {});
    await sendMpvCommand(["set_property", "pause", false]).catch(() => {});
    await fadeMpvVolume(0, 100, fadeIn);
  } else {
    if (serverPlayer.helperProcess) serverPlayer.helperProcess.kill("SIGCONT");
    serverPlayer.process.kill("SIGCONT");
  }
  serverPlayer.status = "playing";
  serverPlayer.itemStartedAt = Date.now();
  serverPlayer.pausedAt = 0;
  addLog("audio", "Sound system playback resumed");
  return true;
}

async function setServerAudioVolume(volume) {
  const percent = Math.round(Math.max(0, Math.min(1, Number(volume ?? 1))) * 100);
  let systemVolumeSet = false;
  if (process.platform === "linux") {
    try {
      if (await commandExists("wpctl")) {
        await runCommand("wpctl", ["set-volume", "@DEFAULT_AUDIO_SINK@", `${percent}%`]);
        systemVolumeSet = true;
      } else if (await commandExists("pactl")) {
        await runCommand("pactl", ["set-sink-volume", "@DEFAULT_SINK@", `${percent}%`]);
        systemVolumeSet = true;
      } else if (await commandExists("amixer")) {
        await runCommand("amixer", ["sset", "Master", `${percent}%`]);
        systemVolumeSet = true;
      }
    } catch (error) {
      addLog("error", `Raspberry Pi volume adjustment failed: ${error.message}`);
    }
  }
  if (serverPlayer.backend === "mpv" && serverPlayer.process) {
    await waitForMpvSocket();
    await setMpvVolume(percent);
    return true;
  }
  return systemVolumeSet;
}

async function gracefulStopServerAudio() {
  if (!serverPlayer.process) {
    stopServerAudio();
    return true;
  }
  if (serverPlayer.backend === "mpv" && process.platform !== "win32") {
    const fadeOut = Number(serverPlayer.queue[0]?.fadeOut || 0);
    await waitForMpvSocket();
    await fadeMpvVolume(100, 0, fadeOut);
    await sendMpvCommand(["quit"]).catch(() => {});
  }
  stopServerAudio();
  return true;
}

function serverPlayerElapsed() {
  if (serverPlayer.status === "playing" && serverPlayer.itemStartedAt) {
    return serverPlayer.elapsedBefore + Math.max(0, (Date.now() - serverPlayer.itemStartedAt) / 1000);
  }
  return serverPlayer.elapsedBefore;
}

async function probeAudioDuration(filePath) {
  const ffprobe = process.env.HYMN_FFPROBE || "ffprobe";
  if (!await commandExists(ffprobe)) return 0;
  try {
    const result = await runCommand(ffprobe, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath
    ]);
    const duration = Number.parseFloat(result.stdout.trim());
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch (error) {
    addLog("error", `Could not read MP3 duration: ${error.message}`);
    return 0;
  }
}

async function buildServerAudioQueue(payload) {
  const fileName = path.basename(payload.fileName || "");
  if (!fileName.toLowerCase().endsWith(".mp3")) throw new Error("Invalid MP3 file.");
  const resolved = await resolveMediaFile(fileName);
  const filePath = resolved.filePath;
  if (resolved.recovered) addLog("audio", `Recovered Sound System MP3 path: ${filePath}`);
  const segments = Array.isArray(payload.segments) ? payload.segments : [];
  const common = {
    filePath,
    volume: payload.volume,
    speed: payload.speed,
    fadeIn: payload.fadeIn,
    fadeOut: payload.fadeOut
  };
  if (!segments.length) {
    const duration = Number(payload.duration || 0) || await probeAudioDuration(filePath);
    return [{ ...common, start: 0, duration, fullFile: true }];
  }
  const queue = segments
    .map((segment) => ({
      ...common,
      start: Number(segment.start || 0),
      duration: Math.max(0, Number(segment.end) - Number(segment.start))
    }))
    .filter((segment) => segment.duration > 0);
  if (!queue.length) {
    const duration = Number(payload.duration || 0) || await probeAudioDuration(filePath);
    return [{ ...common, start: 0, duration, fullFile: true }];
  }
  return queue;
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!boundaryMatch) throw new Error("Missing multipart boundary");
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const parts = [];
  let cursor = buffer.indexOf(boundary) + boundary.length + 2;
  while (cursor > boundary.length) {
    const next = buffer.indexOf(boundary, cursor);
    if (next < 0) break;
    const raw = buffer.subarray(cursor, next - 2);
    const split = raw.indexOf(Buffer.from("\r\n\r\n"));
    if (split > -1) {
      const header = raw.subarray(0, split).toString("utf8");
      const data = raw.subarray(split + 4);
      const name = /name="([^"]+)"/i.exec(header)?.[1];
      const filename = /filename="([^"]*)"/i.exec(header)?.[1];
      const type = /content-type:\s*([^\r\n]+)/i.exec(header)?.[1];
      if (name) parts.push({ name, filename, type, data });
    }
    cursor = next + boundary.length + 2;
  }
  return parts;
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/auth/status") {
    const session = auth.sessionFromRequest(storage, req);
    const settings = await readSettings();
    return send(res, 200, {
      setupRequired: storage.countUsers() === 0,
      authenticated: Boolean(session),
      permissions: USER_PERMISSION_CATALOG,
      user: sessionUser(session),
      branding: await publicBranding(settings)
    });
  }

  if (req.method === "GET" && url.pathname === "/api/branding") {
    return send(res, 200, await publicBranding(await readSettings()));
  }

  if (req.method === "POST" && url.pathname === "/api/auth/setup") {
    if (storage.countUsers()) return send(res, 409, { error: "Accounts are already configured." });
    const payload = JSON.parse((await collectRequest(req, 1)).toString("utf8") || "{}");
    const adminUsername = auth.validateUsername(payload.adminUsername);
    const adminPassword = auth.validatePassword(payload.adminPassword);
    const adminCredential = auth.hashSecret(adminPassword);
    const recoveryCode = auth.createRecoveryCode();
    const recoveryCredential = auth.hashSecret(recoveryCode);
    const [adminUser] = storage.createInitialAccounts([
      { username: adminUsername, role: "admin", passwordHash: adminCredential.hash, passwordSalt: adminCredential.salt, builtIn: true }
    ], { codeHash: recoveryCredential.hash, codeSalt: recoveryCredential.salt });
    const session = auth.createSession(storage, req, adminUser);
    addLog("security", `Built-in administrator created: ${adminUsername}`);
    return send(res, 201, {
      ok: true,
      recoveryCode,
      user: sessionUser({ ...adminUser, builtIn: true, permissions: [], expiresAt: session.expiresAt })
    }, { "set-cookie": auth.sessionCookie(session.token, req) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const payload = JSON.parse((await collectRequest(req, 1)).toString("utf8") || "{}");
    const username = auth.normalizeUsername(payload.username);
    auth.assertLoginAllowed(req, username);
    const user = storage.getUserByUsername(username);
    if (!user || user.disabled || !auth.verifySecret(payload.password, user.password_hash, user.password_salt)) {
      auth.recordLoginFailure(req, username);
      addLog("security", `Failed login for ${username || "unknown user"} from ${auth.requestAddress(req)}`);
      return send(res, 401, { error: "Incorrect username or password." });
    }
    auth.clearLoginFailures(req, username);
    storage.pruneSessions();
    const session = auth.createSession(storage, req, user);
    addLog("security", `${user.username} signed in as ${user.role}`);
    return send(res, 200, {
      ok: true,
      user: sessionUser({
        ...user,
        builtIn: Boolean(user.built_in),
        permissions: sanitizePermissions(JSON.parse(user.permissions_json || "[]")),
        expiresAt: session.expiresAt
      })
    }, { "set-cookie": auth.sessionCookie(session.token, req) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const session = auth.sessionFromRequest(storage, req, { touch: false });
    if (session) {
      storage.deleteSession(session.tokenHash);
      addLog("security", `${session.username} signed out`);
    }
    return send(res, 200, { ok: true }, { "set-cookie": auth.clearSessionCookie(req) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/recover") {
    const payload = JSON.parse((await collectRequest(req, 1)).toString("utf8") || "{}");
    const username = auth.normalizeUsername(payload.username);
    auth.assertLoginAllowed(req, `recovery:${username}`);
    const user = storage.getUserByUsername(username);
    const recovery = storage.getRecoveryCredential();
    if (!user || user.role !== "admin" || !user.built_in || !recovery || !auth.verifySecret(payload.recoveryCode, recovery.codeHash, recovery.codeSalt)) {
      auth.recordLoginFailure(req, `recovery:${username}`);
      return send(res, 401, { error: "Invalid administrator recovery information." });
    }
    const password = auth.validatePassword(payload.newPassword);
    const passwordCredential = auth.hashSecret(password);
    const nextRecoveryCode = auth.createRecoveryCode();
    const nextRecoveryCredential = auth.hashSecret(nextRecoveryCode);
    storage.updateUserPassword(user.id, passwordCredential.hash, passwordCredential.salt);
    storage.deleteUserSessions(user.id);
    storage.setRecoveryCredential(nextRecoveryCredential.hash, nextRecoveryCredential.salt);
    auth.clearLoginFailures(req, `recovery:${username}`);
    addLog("security", `Administrator account ${user.username} recovered`);
    return send(res, 200, { ok: true, recoveryCode: nextRecoveryCode });
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    return send(res, 200, {
      ok: true,
      app: "Hymn Console",
      port: PORT,
      platform: process.platform,
      uptimeSeconds: Math.round(process.uptime()),
      dataDir: DATA_DIR,
      mediaDir: await getMediaDir(),
      serverPlayer: serverPlayer.status
    });
  }

  if (req.method === "GET" && url.pathname === "/api/custom-logo") {
    const settings = await readSettings();
    const storedLogo = settings.customLogo ? parseLogoDataUri(settings.customLogoDataUri) : null;
    if (storedLogo?.buffer.length) return send(res, 200, storedLogo.buffer, { "content-type": storedLogo.mime });
    try {
      const logo = await fsp.readFile(CUSTOM_LOGO_FILE);
      if (!logo.length) return send(res, 404, { error: "No custom logo." });
      return send(res, 200, logo, { "content-type": detectImageMime(logo, settings.customLogoMime) });
    } catch {
      return send(res, 404, { error: "No custom logo." });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/logo") {
    const settings = await readSettings();
    const logo = await readActiveLogo(settings);
    return send(res, 200, logo.buffer, { "content-type": logo.mime });
  }

  const address = auth.requestAddress(req);
  const loopback = address === "127.0.0.1" || address === "::1";
  const providedLocalPlayerToken = String(req.headers["x-local-player-token"] || "");
  const localPlayerControl = loopback && url.pathname === "/api/server-player" && BACKUP_TOKEN
    && providedLocalPlayerToken.length === BACKUP_TOKEN.length
    && crypto.timingSafeEqual(Buffer.from(providedLocalPlayerToken), Buffer.from(BACKUP_TOKEN));
  const providedBackupToken = String(req.headers["x-backup-token"] || "");
  const localBackup = loopback && url.pathname === "/api/backups/local" && BACKUP_TOKEN && providedBackupToken.length === BACKUP_TOKEN.length
    && crypto.timingSafeEqual(Buffer.from(providedBackupToken), Buffer.from(BACKUP_TOKEN));
  const session = localPlayerControl || localBackup
    ? { username: "system", role: "admin", userId: "system", expiresAt: "" }
    : auth.requireSession(storage, req);
  req.auth = session;
  trackController(req);

  if (req.method === "GET" && url.pathname.startsWith("/api/guides/")) {
    const match = /^\/api\/guides\/(user-guide|installation-guide)\.pdf$/.exec(url.pathname);
    if (!match) return send(res, 404, { error: "Guide not found." });
    const pdf = makeGuidePdf(match[1]);
    return send(res, 200, pdf.buffer, {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${pdf.filename}"`
    });
  }

  if (req.method === "GET" && url.pathname === "/api/hymns") {
    return send(res, 200, libraryForSession(req, await syncLibrary()));
  }

  if (req.method === "GET" && url.pathname === "/api/network") {
    const interfaces = Object.values(os.networkInterfaces())
      .flat()
      .filter((item) => item && item.family === "IPv4" && !item.internal);
    const addresses = interfaces.map((item) => `http://${item.address}:${PORT}`);
    const primary = interfaces[0] || {};
    return send(res, 200, {
      addresses,
      port: PORT,
      primary: {
        address: primary.address || "",
        subnet: primary.netmask || "",
        cidr: primary.cidr || ""
      }
    });
  }

  if (req.method === "GET" && url.pathname === "/api/logs") {
    return send(res, 200, eventLog.slice(0, 80));
  }

  if (req.method === "GET" && url.pathname === "/api/auth/users") {
    requireAnyPermission(req, ["accounts.create", "accounts.delete", "accounts.resetPassword", "accounts.editPermissions"]);
    return send(res, 200, { permissions: USER_PERMISSION_CATALOG, users: storage.listUsers() });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/users") {
    auth.requirePermission(storage, req, "accounts.create");
    const payload = JSON.parse((await collectRequest(req, 1)).toString("utf8") || "{}");
    const username = auth.validateUsername(payload.username);
    const password = auth.validatePassword(payload.password);
    const role = "operator";
    const permissions = Array.isArray(payload.permissions) ? delegatedPermissions(req, payload.permissions) : delegatedPermissions(req, DEFAULT_USER_PERMISSIONS);
    if (storage.getUserByUsername(username)) return send(res, 409, { error: "That username already exists." });
    const credential = auth.hashSecret(password);
    const user = storage.createUser({ username, role, passwordHash: credential.hash, passwordSalt: credential.salt, permissions });
    addLog("security", `${req.auth.username} created user account ${username}`);
    return send(res, 201, { id: user.id, username: user.username, role: user.role, permissions });
  }

  const userPermissionsMatch = /^\/api\/auth\/users\/([^/]+)\/permissions$/.exec(url.pathname);
  if (userPermissionsMatch && req.method === "PUT") {
    auth.requirePermission(storage, req, "accounts.editPermissions");
    const target = storage.getUserById(userPermissionsMatch[1]);
    if (!target) return send(res, 404, { error: "User not found." });
    if (target.built_in || target.role === "admin" || target.id === req.auth.userId) return send(res, 400, { error: "You cannot edit permissions for this account." });
    const payload = JSON.parse((await collectRequest(req, 1)).toString("utf8") || "{}");
    const permissions = delegatedPermissions(req, payload.permissions);
    storage.updateUserPermissions(target.id, permissions);
    addLog("security", `${req.auth.username} updated permissions for ${target.username}`);
    return send(res, 200, { ok: true, permissions });
  }

  const userMatch = /^\/api\/auth\/users\/([^/]+)$/.exec(url.pathname);
  if (userMatch && req.method === "DELETE") {
    auth.requirePermission(storage, req, "accounts.delete");
    const target = storage.getUserById(userMatch[1]);
    if (!target) return send(res, 404, { error: "User not found." });
    if (target.built_in || target.role === "admin" || target.id === req.auth.userId) return send(res, 400, { error: "You cannot delete this account." });
    storage.deleteUser(target.id);
    addLog("security", `${req.auth.username} deleted user account ${target.username}`);
    return send(res, 200, { ok: true });
  }

  const userPasswordMatch = /^\/api\/auth\/users\/([^/]+)\/password$/.exec(url.pathname);
  if (userPasswordMatch && req.method === "PUT") {
    auth.requirePermission(storage, req, "accounts.resetPassword");
    const target = storage.getUserById(userPasswordMatch[1]);
    if (!target) return send(res, 404, { error: "User not found." });
    if (target.built_in || target.role === "admin") return send(res, 400, { error: "Use administrator recovery to reset the built-in administrator password." });
    if (target.id === req.auth.userId) return send(res, 400, { error: "You cannot reset your own password from user management." });
    const payload = JSON.parse((await collectRequest(req, 1)).toString("utf8") || "{}");
    const password = auth.validatePassword(payload.password);
    const credential = auth.hashSecret(password);
    storage.updateUserPassword(target.id, credential.hash, credential.salt);
    storage.deleteUserSessions(target.id);
    addLog("security", `${req.auth.username} reset the password for ${target.username}`);
    return send(res, 200, { ok: true });
  }

  if (req.method === "DELETE" && url.pathname === "/api/logs") {
    auth.requirePermission(storage, req, "logs.reset");
    eventLog.length = 0;
    addLog("system", "System log reset");
    return send(res, 200, eventLog.slice(0, 80));
  }

  if (req.method === "GET" && url.pathname === "/api/settings") {
    return send(res, 200, await publicAppSettings(await readSettings()));
  }

  if (req.method === "PUT" && url.pathname === "/api/settings") {
    const patch = JSON.parse((await collectRequest(req, 1)).toString("utf8") || "{}");
    requireSettingsPatchPermissions(req, patch);
    const current = await readSettings();
    if (patch.storage?.mode === "usb" && !String(patch.storage?.usbPath || "").trim()) {
      return send(res, 400, { error: "Enter the USB storage path first." });
    }
    const next = {
      ...current,
      ...patch,
      audioDefaults: { ...current.audioDefaults, ...(patch.audioDefaults || {}) },
      network: { ...current.network, ...(patch.network || {}) },
      storage: { ...current.storage, ...(patch.storage || {}) },
      backup: { ...current.backup, ...(patch.backup || {}) },
      autoLookup: { ...current.autoLookup, ...(patch.autoLookup || {}) },
      openAiApiKey: patch.clearOpenAiApiKey ? "" : (patch.newOpenAiApiKey ? String(patch.newOpenAiApiKey).trim() : current.openAiApiKey)
    };
    if (patch.storage) await ensureMediaStorage(next);
    delete next.newOpenAiApiKey;
    delete next.clearOpenAiApiKey;
    await writeJson(SETTINGS_FILE, next);
    if (patch.dnsName) {
      try {
        await applySystemHostname(patch.dnsName);
      } catch (error) {
        addLog("error", `DNS hostname update failed: ${error.message}`);
      }
    }
    addLog("settings", "Settings updated");
    return send(res, 200, await publicAppSettings(next));
  }

  if (req.method === "POST" && url.pathname === "/api/system/restart-app") {
    auth.requirePermission(storage, req, "system.restartApp");
    await restartHymnConsole();
    return send(res, 200, { ok: true, message: "Hymn Console restart requested." });
  }

  if (req.method === "POST" && url.pathname === "/api/system/restart-pi") {
    auth.requirePermission(storage, req, "system.restartPi");
    await restartRaspberryPi();
    return send(res, 200, { ok: true, message: "Raspberry Pi restart requested." });
  }

  if (req.method === "POST" && url.pathname === "/api/custom-logo") {
    auth.requirePermission(storage, req, "settings.appearance");
    const parts = parseMultipart(await collectRequest(req, 15), req.headers["content-type"]);
    const file = parts.find((part) => part.name === "logo" && part.filename);
    const allowed = new Set(["image/svg+xml", "image/png", "image/jpeg", "image/webp"]);
    const actualMime = file ? detectImageMime(file.data, file.type) : "";
    if (!file || !allowed.has(actualMime)) return send(res, 400, { error: "Upload an SVG, PNG, JPG, or WebP logo." });
    await fsp.writeFile(CUSTOM_LOGO_FILE, file.data);
    const settings = await readSettings();
    const next = {
      ...settings,
      customLogo: true,
      customLogoMime: actualMime,
      customLogoVersion: String(Date.now()),
      customLogoDataUri: logoDataUri({ buffer: file.data, mime: actualMime })
    };
    await writeJson(SETTINGS_FILE, next);
    addLog("settings", "Custom logo uploaded");
    return send(res, 200, await publicAppSettings(next));
  }

  if (req.method === "DELETE" && url.pathname === "/api/custom-logo") {
    auth.requirePermission(storage, req, "settings.appearance");
    const settings = await readSettings();
    const next = { ...settings, customLogo: false, customLogoMime: "", customLogoVersion: "", customLogoDataUri: "" };
    await fsp.rm(CUSTOM_LOGO_FILE, { force: true });
    await writeJson(SETTINGS_FILE, next);
    addLog("settings", "Custom logo removed");
    return send(res, 200, await publicAppSettings(next));
  }

  if (req.method === "GET" && url.pathname === "/api/storage") {
    return send(res, 200, await getStorageStats());
  }

  if (req.method === "GET" && url.pathname === "/api/resources") {
    return send(res, 200, await getResourceStats());
  }

  if (req.method === "GET" && url.pathname === "/api/diagnostics") {
    await requireAdmin(req);
    const settings = await readSettings();
    const resources = await getResourceStats();
    const packageInfo = await readJson(path.join(ROOT, "package.json"), {});
    const report = {
      generatedAt: new Date().toISOString(),
      app: "Hymn Console",
      version: packageInfo.version || "unknown",
      database: {
        path: DATABASE_FILE,
        integrity: storage.integrityCheck(),
        revisions: {
          library: storage.documentRevision("library"),
          servicePlans: storage.documentRevision("servicePlans"),
          serviceQueue: storage.documentRevision("serviceQueue"),
          settings: storage.documentRevision("settings")
        }
      },
      accounts: storage.listUsers(),
      resources,
      configuration: publicSettings(settings),
      backup: {
        internalPath: BACKUP_DIR,
        externalTarget: settings.backup?.targetPath || "",
        retentionDays: settings.backup?.retentionDays || 14
      },
      tools: {
        mpv: await commandExists("mpv"),
        ffmpeg: await commandExists("ffmpeg"),
        tar: await commandExists("tar")
      },
      recentLogs: eventLog.slice(0, 100)
    };
    return send(res, 200, report, {
      "content-disposition": `attachment; filename="hymn-console-diagnostics-${new Date().toISOString().slice(0, 10)}.json"`
    });
  }

  if (req.method === "GET" && url.pathname === "/api/controllers") {
    cleanupControllers();
    return send(res, 200, [...controllers.values()].sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen)));
  }

  if (req.method === "GET" && url.pathname === "/api/trash") {
    const items = await listTrash();
    return send(res, 200, {
      items,
      count: items.length,
      totalSize: items.reduce((sum, item) => sum + item.size, 0)
    });
  }

  if (req.method === "POST" && url.pathname === "/api/smart/metadata") {
    auth.requirePermission(storage, req, "hymns.edit");
    const library = await syncLibrary();
    const changes = [];
    const next = library.map((hymn) => {
      const inferred = inferMetadataFromFileName(hymn.fileName);
      const patch = {};
      const fields = [];
      const currentTitleLooksRaw = normalizeSmartText(hymn.title) === normalizeSmartText(hymn.fileName);
      if ((!hymn.title || currentTitleLooksRaw) && inferred.title) {
        patch.title = inferred.title;
        fields.push("title");
      }
      if (!hymn.page && inferred.page) {
        patch.page = inferred.page;
        fields.push("page");
      }
      if (!hymn.key && inferred.key) {
        patch.key = inferred.key;
        fields.push("key");
      }
      if (!fields.length) return hymn;
      const updated = { ...hymn, ...patch, updatedAt: new Date().toISOString() };
      changes.push({ id: hymn.id, title: updated.title, fields });
      return updated;
    });
    if (changes.length) await writeJson(LIBRARY_FILE, next);
    addLog("assistant", `Auto metadata cleanup found ${changes.length} update${changes.length === 1 ? "" : "s"}`);
    return send(res, 200, { changes, library: next.sort((a, b) => a.title.localeCompare(b.title)) });
  }

  if (req.method === "POST" && url.pathname === "/api/smart/metadata-csv") {
    auth.requirePermission(storage, req, "library.importCsv");
    const parts = parseMultipart(await collectRequest(req, 20), req.headers["content-type"]);
    const file = parts.find((part) => part.name === "metadata" && part.filename);
    if (!file) return send(res, 400, { error: "Upload a CSV metadata file." });
    const records = csvRecords(file.data.toString("utf8"));
    const library = await syncLibrary();
    const changes = [];
    const next = library.map((hymn) => {
      const match = records.find((record) => {
        if (record.id && record.id === hymn.id) return true;
        const wanted = normalizeSmartText(record.filename || record.file || record.title || record.hymn || "");
        return wanted && (wanted === normalizeSmartText(hymn.fileName) || wanted === normalizeSmartText(hymn.title));
      });
      if (!match) return hymn;
      const patch = {};
      for (const field of ["title", "page", "key", "tempo", "themes", "notes", "lyrics"]) {
        const value = csvField(match, field);
        if (value) patch[field] = value;
      }
      const defaultVerses = csvField(match, "defaultVerses", "Default Verses");
      const defaultVolume = csvField(match, "defaultVolume", "Default Volume", "Volume");
      const defaultSpeed = csvField(match, "defaultSpeed", "Default Speed", "Speed");
      const fadeIn = csvField(match, "fadeIn", "Fade In");
      const fadeOut = csvField(match, "fadeOut", "Fade Out");
      const duration = csvField(match, "duration", "Track Length", "Length");
      const hasChorus = csvField(match, "hasChorus", "Has Chorus", "Chorus");
      if (defaultVerses) patch.defaultVerses = Math.max(1, parseCsvNumber(defaultVerses, hymn.defaultVerses || 3));
      if (defaultVolume) patch.defaultVolume = parseCsvVolume(defaultVolume, hymn.defaultVolume ?? 0.9);
      if (defaultSpeed) patch.defaultSpeed = parseCsvNumber(defaultSpeed, hymn.defaultSpeed || 1);
      if (fadeIn) patch.fadeIn = Math.max(0, parseCsvNumber(fadeIn, hymn.fadeIn || 0));
      if (fadeOut) patch.fadeOut = Math.max(0, parseCsvNumber(fadeOut, hymn.fadeOut || 0));
      if (duration) patch.duration = Math.max(0, parseCsvNumber(duration, hymn.duration || 0));
      if (hasChorus) patch.hasChorus = String(hasChorus).toLowerCase() !== "false";
      if (!Object.keys(patch).length) return hymn;
      const updated = { ...hymn, ...patch, updatedAt: new Date().toISOString() };
      changes.push({ id: hymn.id, title: updated.title, fields: Object.keys(patch) });
      return updated;
    });
    if (changes.length) await writeJson(LIBRARY_FILE, next);
    addLog("assistant", `Imported CSV metadata for ${changes.length} hymn${changes.length === 1 ? "" : "s"}`);
    return send(res, 200, { changes, library: next.sort((a, b) => a.title.localeCompare(b.title)) });
  }

  if (req.method === "GET" && url.pathname === "/api/smart/duplicates") {
    const groups = new Map();
    for (const hymn of await syncLibrary()) {
      const key = normalizeSmartText(hymn.title || hymn.fileName);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({
        id: hymn.id,
        title: hymn.title,
        fileName: hymn.fileName,
        page: hymn.page || "",
        key: hymn.key || ""
      });
    }
    const duplicates = [...groups.entries()]
      .filter(([, items]) => items.length > 1)
      .map(([title, items]) => ({ title, items }));
    return send(res, 200, duplicates);
  }

  if (req.method === "GET" && url.pathname === "/api/smart/service-plan") {
    const library = await syncLibrary();
    const chosen = library
      .slice()
      .sort((a, b) => {
        const aPage = Number(String(a.page || "").match(/\d+/)?.[0] || Number.MAX_SAFE_INTEGER);
        const bPage = Number(String(b.page || "").match(/\d+/)?.[0] || Number.MAX_SAFE_INTEGER);
        return aPage - bPage || a.title.localeCompare(b.title);
      })
      .slice(0, 4);
    return send(res, 200, {
      queue: chosen.map((hymn, index) => ({
        hymnId: hymn.id,
        title: hymn.title,
        verses: Number(hymn.defaultVerses || 3),
        reason: servicePlanReason(index, hymn)
      }))
    });
  }

  if (req.method === "GET" && url.pathname === "/api/smart/quality") {
    const library = await syncLibrary();
    const mediaDir = await ensureMediaStorage();
    const fileNameCounts = new Map();
    library.forEach((hymn) => fileNameCounts.set(hymn.fileName, (fileNameCounts.get(hymn.fileName) || 0) + 1));
    const checks = [];
    for (const hymn of library) {
      const fileName = path.basename(hymn.fileName || "");
      const filePath = safeJoin(mediaDir, fileName);
      if (!fileName.toLowerCase().endsWith(".mp3")) {
        checks.push({ title: hymn.title, detail: "Wrong file type. Upload MP3 audio." });
        continue;
      }
      if (fileNameCounts.get(hymn.fileName) > 1) {
        checks.push({ title: hymn.title, detail: "Same file name appears more than once in the library." });
      }
      try {
        const stat = await fsp.stat(filePath);
        if (stat.size < 100 * 1024) checks.push({ title: hymn.title, detail: "File is unusually small. It may be incomplete or silent." });
      } catch {
        checks.push({ title: hymn.title, detail: "MP3 file is missing from storage." });
      }
    }
    return send(res, 200, checks);
  }

  const lookupMatch = /^\/api\/smart\/lookup\/([^/]+)$/.exec(url.pathname);
  if (lookupMatch && req.method === "POST") {
    auth.requirePermission(storage, req, "hymns.edit");
    const library = await syncLibrary();
    const hymn = library.find((item) => item.id === lookupMatch[1]);
    if (!hymn) return send(res, 404, { error: "Hymn not found." });
    const settings = await readSettings();
    const local = await buildLookupSuggestions(hymn);
    const ai = await fetchBuiltInAiLookup(settings, hymn, local);
    const external = await fetchExternalLookup(settings, hymn, local);
    const merged = mergeLookupSuggestions(local, ai, external);
    addLog("assistant", `Auto lookup prepared suggestions for ${hymn.title}`);
    return send(res, 200, { hymnId: hymn.id, suggestions: merged });
  }

  if (req.method === "POST" && url.pathname === "/api/trash/restore") {
    auth.requirePermission(storage, req, "trash.restore");
    const mediaDir = await ensureMediaStorage();
    const trashDir = getTrashDir(mediaDir);
    const payload = JSON.parse((await collectRequest(req, 1)).toString("utf8") || "{}");
    const name = path.basename(payload.name || "");
    if (!name.toLowerCase().endsWith(".mp3")) return send(res, 400, { error: "Choose a deleted MP3 to restore." });
    const source = safeJoin(trashDir, name);
    const restoredName = name.replace(/^\d+-/, "");
    const destination = safeJoin(mediaDir, restoredName);
    await fsp.rename(source, destination);
    addLog("library", `Restored MP3: ${restoredName}`);
    await syncLibrary();
    return send(res, 200, { ok: true, fileName: restoredName });
  }

  if (req.method === "DELETE" && url.pathname === "/api/trash") {
    auth.requirePermission(storage, req, "trash.empty");
    const mediaDir = await ensureMediaStorage();
    const trashDir = getTrashDir(mediaDir);
    const items = await listTrash();
    await Promise.all(items.map((item) => fsp.rm(safeJoin(trashDir, item.name), { force: true })));
    addLog("library", `Emptied trash can: ${items.length} item${items.length === 1 ? "" : "s"} removed`);
    return send(res, 200, { ok: true, count: items.length });
  }

  if (req.method === "GET" && url.pathname === "/api/startup-check") {
    const checks = [];
    const addCheck = (name, ok, detail) => checks.push({ name, ok, detail });
    await ensureStorage();
    const storage = await getStorageStats();
    addCheck("SQLite integrity", storage.integrityCheck() === "ok", DATABASE_FILE);
    addCheck("Library database", Array.isArray(await readJson(LIBRARY_FILE, null)), "SQLite library document");
    addCheck("Queue database", Array.isArray(await readJson(QUEUE_FILE, null)), "SQLite service queue document");
    addCheck("Plans database", Array.isArray(await readJson(PLANS_FILE, null)), "SQLite service plans document");
    addCheck("MP3 folder", storage.mp3Count >= 0, `${storage.mp3Count} MP3 file${storage.mp3Count === 1 ? "" : "s"}`);
    addCheck("Storage free", storage.free === null || storage.free > 250 * 1024 * 1024, storage.free === null ? "Free space unavailable" : `${Math.round(storage.free / 1024 / 1024)} MB free`);
    const hasNetwork = Object.values(os.networkInterfaces()).flat().some((item) => item && item.family === "IPv4" && !item.internal);
    const hasMpv = process.platform === "win32" || Boolean(process.env.HYMN_AUDIO_PLAYER) || await commandExists("mpv");
    const hasFfmpeg = process.platform === "win32" || await commandExists("ffmpeg");
    addCheck("Network", hasNetwork, "LAN address check");
    addCheck("Sound system player", hasMpv && hasFfmpeg, hasMpv && hasFfmpeg ? "mpv and ffmpeg available" : "Install mpv and ffmpeg for Sound System playback");
    return send(res, 200, checks);
  }

  if (req.method === "POST" && url.pathname === "/api/backups/local") {
    if (!localBackup) auth.requirePermission(storage, req, "backups.run");
    const saved = await createBackupFile();
    addLog("backup", `Saved local backup: ${saved.name}`);
    return send(res, 200, { name: saved.name, externalPath: saved.externalPath, mediaFiles: saved.mediaFiles });
  }

  if (req.method === "POST" && url.pathname === "/api/backups/export") {
    auth.requirePermission(storage, req, "backups.download");
    if (!await commandExists("tar")) return send(res, 500, { error: "The tar utility is required to export a complete backup." });
    const saved = await createBackupFile();
    const archivePath = `${saved.snapshotPath}.tar.gz`;
    await runCommand("tar", ["-czf", archivePath, "-C", saved.snapshotPath, "."]);
    await storage.secureFile(archivePath);
    const stat = await fsp.stat(archivePath);
    res.writeHead(200, {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="${saved.name}.tar.gz"`,
      "content-length": stat.size,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    });
    const stream = fs.createReadStream(archivePath);
    const cleanupArchive = () => fsp.rm(archivePath, { force: true }).catch(() => {});
    stream.once("error", (error) => {
      cleanupArchive();
      if (!res.headersSent) send(res, 500, { error: error.message });
      else res.destroy(error);
    });
    res.once("close", cleanupArchive);
    stream.pipe(res);
    addLog("backup", `Exported complete backup: ${saved.name}`);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/server-player") {
    const elapsed = serverPlayerElapsed();
    return send(res, 200, {
      status: serverPlayer.status,
      currentTitle: serverPlayer.currentTitle,
      currentMeta: serverPlayer.currentMeta,
      hymnId: serverPlayer.hymnId,
      error: serverPlayer.error,
      lastOutput: serverPlayer.lastOutput,
      elapsed,
      duration: serverPlayer.totalDuration,
      controls: serverPlayer.controls,
      index: serverPlayer.queueIndex,
      queueLength: serverPlayer.queue.length,
      platform: process.platform
    });
  }

  if (req.method === "GET" && url.pathname === "/api/live-playback") {
    const serverElapsed = serverPlayerElapsed();
    if (serverPlayer.status !== "stopped") {
      return send(res, 200, {
        source: "server",
        status: serverPlayer.status,
        currentTitle: serverPlayer.currentTitle,
        currentMeta: serverPlayer.currentMeta,
        hymnId: serverPlayer.hymnId,
        error: serverPlayer.error,
        lastOutput: serverPlayer.lastOutput,
        elapsed: serverElapsed,
        duration: serverPlayer.totalDuration,
        controls: serverPlayer.controls,
        index: serverPlayer.queueIndex,
        queueLength: serverPlayer.queue.length,
        updatedAt: Date.now()
      });
    }
    const fresh = livePlayback.updatedAt && Date.now() - livePlayback.updatedAt < 15000;
    return send(res, 200, fresh ? {
      ...livePlayback,
      index: livePlayback.queueIndex,
      queueLength: livePlayback.queueIndex >= 0 ? 1 : 0
    } : {
      source: "",
      status: "stopped",
      currentTitle: "",
      currentMeta: "",
      hymnId: "",
      elapsed: 0,
      duration: 0,
      controls: livePlayback.controls,
      index: -1,
      queueLength: 0,
      updatedAt: 0
    });
  }

  if (req.method === "POST" && url.pathname === "/api/live-playback") {
    auth.requirePermission(storage, req, "playback.control");
    const payload = JSON.parse((await collectRequest(req, 2)).toString("utf8") || "{}");
    livePlayback.source = "browser";
    livePlayback.clientId = String(payload.clientId || "");
    livePlayback.status = ["playing", "paused", "stopped", "selected"].includes(payload.status) ? payload.status : "stopped";
    livePlayback.currentTitle = String(payload.currentTitle || "");
    livePlayback.currentMeta = String(payload.currentMeta || "");
    livePlayback.hymnId = String(payload.hymnId || "");
    livePlayback.queueIndex = Number.isFinite(Number(payload.index)) ? Number(payload.index) : -1;
    livePlayback.elapsed = Math.max(0, Number(payload.elapsed || 0));
    livePlayback.duration = Math.max(0, Number(payload.duration || 0));
    livePlayback.controls = {
      volume: Math.max(0, Math.min(1, Number(payload.controls?.volume ?? livePlayback.controls.volume))),
      speed: Math.max(0.5, Math.min(2, Number(payload.controls?.speed ?? livePlayback.controls.speed))),
      fadeIn: Math.max(0, Number(payload.controls?.fadeIn ?? livePlayback.controls.fadeIn)),
      fadeOut: Math.max(0, Number(payload.controls?.fadeOut ?? livePlayback.controls.fadeOut))
    };
    livePlayback.updatedAt = Date.now();
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/live-playback/command") {
    auth.requirePermission(storage, req, "playback.remote");
    const payload = JSON.parse((await collectRequest(req, 1)).toString("utf8") || "{}");
    const action = String(payload.action || "");
    if (!["play", "pause", "stop"].includes(action)) return send(res, 400, { error: "Unknown live playback command." });
    if (serverPlayer.status !== "stopped") return send(res, 409, { error: "Use Sound System controls for Raspberry Pi playback." });
    if (!livePlayback.clientId || !livePlayback.updatedAt || Date.now() - livePlayback.updatedAt > 15000) {
      return send(res, 409, { error: "No active browser player found." });
    }
    livePlayback.command = {
      id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(12).toString("hex"),
      action,
      targetClientId: livePlayback.clientId,
      createdAt: Date.now()
    };
    return send(res, 200, { ok: true, command: livePlayback.command });
  }

  if (req.method === "POST" && url.pathname === "/api/server-player") {
    if (!localPlayerControl) {
      auth.requirePermission(storage, req, "playback.control");
      auth.requirePermission(storage, req, "audio.soundSystem");
    }
    const payload = JSON.parse((await collectRequest(req, 5)).toString("utf8") || "{}");
    if (payload.action === "stop") {
      await gracefulStopServerAudio();
      return send(res, 200, { ok: true, status: serverPlayer.status, elapsed: 0, duration: 0, controls: serverPlayer.controls });
    }
    if (payload.action === "pause") {
      const ok = await pauseServerAudio();
      return send(res, ok ? 200 : 409, { ok, status: serverPlayer.status, elapsed: serverPlayerElapsed(), duration: serverPlayer.totalDuration, controls: serverPlayer.controls, error: ok ? "" : "Server pause requires Linux audio playback." });
    }
    if (payload.action === "resume") {
      const ok = await resumeServerAudio();
      return send(res, ok ? 200 : 409, { ok, status: serverPlayer.status, elapsed: serverPlayerElapsed(), duration: serverPlayer.totalDuration, controls: serverPlayer.controls, error: ok ? "" : "Server resume requires Linux audio playback." });
    }
    if (payload.action === "volume") {
      const ok = await setServerAudioVolume(payload.volume);
      serverPlayer.controls.volume = Math.max(0, Math.min(1, Number(payload.volume ?? serverPlayer.controls.volume)));
      return send(res, 200, { ok, status: serverPlayer.status, volume: serverPlayer.controls.volume, controls: serverPlayer.controls });
    }
    if (payload.action === "play") {
      const player = soundSystemPlayer();
      if (!await commandExists(player)) return send(res, 409, { error: `Sound System player "${player}" is not installed on this computer. Use This Device here, or run Sound System on the Raspberry Pi.` });
      if (isMpvPlayer(player) && !await commandExists(process.env.HYMN_FFMPEG || "ffmpeg")) return send(res, 409, { error: "Sound System playback requires ffmpeg. Install ffmpeg on the Raspberry Pi." });
      stopServerAudio();
      serverPlayer.queue = await buildServerAudioQueue(payload);
      serverPlayer.currentTitle = payload.title || "";
      serverPlayer.currentMeta = payload.meta || "";
      serverPlayer.hymnId = payload.hymnId || "";
      serverPlayer.queueIndex = Number.isFinite(Number(payload.queueIndex)) ? Number(payload.queueIndex) : -1;
      serverPlayer.controls = {
        volume: Math.max(0, Math.min(1, Number(payload.volume ?? serverPlayer.controls.volume))),
        speed: Math.max(0.5, Math.min(2, Number(payload.speed ?? serverPlayer.controls.speed))),
        fadeIn: Math.max(0, Number(payload.fadeIn ?? serverPlayer.controls.fadeIn)),
        fadeOut: Math.max(0, Number(payload.fadeOut ?? serverPlayer.controls.fadeOut))
      };
      serverPlayer.error = "";
      serverPlayer.totalDuration = Number(payload.duration || serverPlayer.queue.reduce((sum, item) => sum + Number(item.duration || 0), 0));
      serverPlayer.elapsedBefore = 0;
      serverPlayer.itemStartedAt = 0;
      serverPlayer.pausedAt = 0;
      startServerAudioConcat();
      return send(res, 200, { ok: true, status: serverPlayer.status, elapsed: 0, duration: serverPlayer.totalDuration, controls: serverPlayer.controls });
    }
    return send(res, 400, { error: "Unknown server player action." });
  }

  if (req.method === "GET" && url.pathname === "/api/backup") {
    auth.requirePermission(storage, req, "backups.download");
    return send(res, 200, {
      createdAt: new Date().toISOString(),
      library: await syncLibrary(),
      servicePlans: await readJson(PLANS_FILE, []),
      serviceQueue: await readJson(QUEUE_FILE, []),
      settings: publicSettings(await readSettings())
    });
  }

  if (req.method === "POST" && url.pathname === "/api/backups/restore") {
    auth.requirePermission(storage, req, "backups.restore");
    if (!await commandExists("tar")) return send(res, 500, { error: "The tar utility is required to restore a complete backup." });
    const multipart = await streamMultipart(req, { tempDir: BACKUP_DIR, limitMb: 4096, maxFiles: 1 });
    const archive = multipart.files.find((file) => file.name === "backup" && file.filename);
    const cleanupUpload = () => Promise.all(multipart.temporaryFiles.map((file) => fsp.rm(file, { force: true }).catch(() => {})));
    if (!archive || !/\.(?:tar\.gz|tgz)$/i.test(archive.filename)) {
      await cleanupUpload();
      return send(res, 400, { error: "Choose a Hymn Console .tar.gz backup." });
    }
    const listing = await runCommand("tar", ["-tzf", archive.tempPath]);
    const unsafeEntry = listing.stdout.split(/\r?\n/).filter(Boolean).find((entry) => {
      const normalized = entry.replace(/\\/g, "/").replace(/^\.\//, "");
      return normalized.startsWith("/") || normalized.split("/").includes("..");
    });
    if (unsafeEntry) {
      await cleanupUpload();
      return send(res, 400, { error: "Backup archive contains an unsafe path." });
    }
    const extractDir = path.join(BACKUP_DIR, `.restore-${crypto.randomUUID()}`);
    await fsp.mkdir(extractDir, { recursive: true });
    try {
      await runCommand("tar", ["-xzf", archive.tempPath, "-C", extractDir]);
      const manifest = JSON.parse(await fsp.readFile(path.join(extractDir, "manifest.json"), "utf8"));
      if (Number(manifest.formatVersion) !== 2) throw new Error("Unsupported complete backup format.");
      const backupDatabase = safeJoin(extractDir, manifest.database || "hymn-console.sqlite");
      const backupMedia = safeJoin(extractDir, manifest.mediaFolder || "media");
      const incomingFiles = (await fsp.readdir(backupMedia, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".mp3"));
      for (const entry of incomingFiles) {
        if (!await isMp3File(path.join(backupMedia, entry.name))) throw new Error(`Backup contains an invalid MP3: ${entry.name}`);
      }
      const mediaDir = await ensureMediaStorage();
      const rollbackDir = path.join(mediaDir, `.restore-rollback-${Date.now()}`);
      await fsp.mkdir(rollbackDir, { recursive: true });
      const currentFiles = (await fsp.readdir(mediaDir, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".mp3"));
      const installed = [];
      try {
        stopServerAudio();
        for (const entry of currentFiles) await fsp.rename(path.join(mediaDir, entry.name), path.join(rollbackDir, entry.name));
        for (const entry of incomingFiles) {
          const target = path.join(mediaDir, entry.name);
          await fsp.copyFile(path.join(backupMedia, entry.name), target);
          installed.push(target);
        }
        storage.replaceDatabase(backupDatabase);
        storage.clearAllSessions();
        for (const [sourceName, destination] of [
          ["custom-logo", CUSTOM_LOGO_FILE]
        ]) {
          try {
            await fsp.copyFile(path.join(extractDir, sourceName), destination);
            await storage.secureFile(destination);
          } catch (error) {
            if (error.code !== "ENOENT") {
              addLog("warning", `Complete backup restored without optional ${sourceName}: ${error.message}`);
            }
          }
        }
        await fsp.rm(rollbackDir, { recursive: true, force: true });
      } catch (error) {
        await Promise.all(installed.map((file) => fsp.rm(file, { force: true }).catch(() => {})));
        const rollbackFiles = await fsp.readdir(rollbackDir, { withFileTypes: true }).catch(() => []);
        for (const entry of rollbackFiles.filter((item) => item.isFile())) {
          await fsp.rename(path.join(rollbackDir, entry.name), path.join(mediaDir, entry.name)).catch(() => {});
        }
        await fsp.rm(rollbackDir, { recursive: true, force: true });
        throw error;
      }
      addLog("backup", `Restored complete backup from ${archive.filename}`);
      return send(res, 200, { ok: true, message: "Complete backup restored. Sign in again." }, { "set-cookie": auth.clearSessionCookie(req) });
    } finally {
      await cleanupUpload();
      await fsp.rm(extractDir, { recursive: true, force: true });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/restore") {
    auth.requirePermission(storage, req, "backups.restore");
    const backup = JSON.parse((await collectRequest(req, 25)).toString("utf8") || "{}");
    if (!Array.isArray(backup.library) || !Array.isArray(backup.servicePlans)) {
      return send(res, 400, { error: "Backup file must contain library and servicePlans arrays." });
    }
    await writeJson(LIBRARY_FILE, backup.library);
    await writeJson(PLANS_FILE, backup.servicePlans);
    if (Array.isArray(backup.serviceQueue)) await writeJson(QUEUE_FILE, backup.serviceQueue);
    if (backup.settings && typeof backup.settings === "object" && !Array.isArray(backup.settings)) {
      const currentSettings = await readSettings();
      await writeJson(SETTINGS_FILE, {
        ...currentSettings,
        ...backup.settings,
        openAiApiKey: currentSettings.openAiApiKey,
        network: { ...currentSettings.network, ...(backup.settings.network || {}) },
        storage: { ...currentSettings.storage, ...(backup.settings.storage || {}) },
        backup: { ...currentSettings.backup, ...(backup.settings.backup || {}) }
      });
    }
    addLog("backup", "Restored metadata backup");
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/upload") {
    auth.requirePermission(storage, req, "library.uploadMp3");
    const settings = await readSettings();
    const mediaDir = await ensureMediaStorage(settings);
    const multipart = await streamMultipart(req, { tempDir: mediaDir, limitMb: 2048, maxFiles: 200 });
    const fields = multipart.fields;
    const files = multipart.files.filter((file) => file.name === "audio" && file.filename);
    const cleanup = () => Promise.all(multipart.temporaryFiles.map((file) => fsp.rm(file, { force: true }).catch(() => {})));
    if (!files.length) {
      await cleanup();
      return send(res, 400, { error: "Please upload one or more MP3 files." });
    }
    for (const file of files) {
      if (!file.filename.toLowerCase().endsWith(".mp3") || !await isMp3File(file.tempPath)) {
        await cleanup();
        return send(res, 400, { error: `${file.filename} is not a valid MP3 file.` });
      }
    }
    const library = await readJson(LIBRARY_FILE, []);
    const uploaded = [];
    const promoted = [];
    try {
      for (const [index, file] of files.entries()) {
        const cleanBase = path.basename(file.filename, path.extname(file.filename)).replace(/[^a-z0-9-_\s]/gi, "").trim() || "hymn";
        const fileName = `${cleanBase.replace(/\s+/g, "-")}-${Date.now()}-${index + 1}.mp3`;
        const destination = path.join(mediaDir, fileName);
        await fsp.rename(file.tempPath, destination);
        promoted.push(destination);
        const hymn = newHymn({
          ...fields,
          title: files.length === 1 ? (fields.title || cleanBase) : cleanBase,
          fileName
        });
        library.push(hymn);
        uploaded.push(hymn);
        addLog("library", `Uploaded MP3: ${hymn.title}`);
      }
      await writeJson(LIBRARY_FILE, library);
    } catch (error) {
      await Promise.all(promoted.map((file) => fsp.rm(file, { force: true }).catch(() => {})));
      throw error;
    } finally {
      await cleanup();
    }
    return send(res, 201, {
      uploaded,
      count: uploaded.length,
      storage: {
        mode: settings.storage?.mode || "internal",
        mediaPath: mediaDir
      }
    });
  }

  const hymnMatch = /^\/api\/hymns\/([^/]+)$/.exec(url.pathname);
  if (hymnMatch && req.method === "PUT") {
    auth.requirePermission(storage, req, "hymns.edit");
    const patch = JSON.parse((await collectRequest(req, 5)).toString("utf8") || "{}");
    const library = await syncLibrary();
    const index = library.findIndex((hymn) => hymn.id === hymnMatch[1]);
    if (index < 0) return send(res, 404, { error: "Hymn not found." });
    library[index] = { ...library[index], ...patch, id: library[index].id, fileName: library[index].fileName, updatedAt: new Date().toISOString() };
    await writeJson(LIBRARY_FILE, library);
    addLog("library", `Updated hymn: ${library[index].title}`);
    return send(res, 200, library[index]);
  }

  if (req.method === "PUT" && url.pathname === "/api/hymns") {
    auth.requirePermission(storage, req, url.searchParams.get("source") === "csv" ? "library.importCsv" : "hymns.edit");
    const updates = JSON.parse((await collectRequest(req, 10)).toString("utf8") || "[]");
    if (!Array.isArray(updates)) return send(res, 400, { error: "Expected an array of hymn updates." });
    const library = await syncLibrary();
    const byId = new Map(updates.map((item) => [item.id, item]));
    const next = library.map((hymn) => {
      const patch = byId.get(hymn.id);
      if (!patch) return hymn;
      const hasChorus = patch.hasChorus === undefined ? hymn.hasChorus : String(patch.hasChorus).toLowerCase() !== "false";
      return {
        ...hymn,
        title: patch.title ?? hymn.title,
        page: patch.page ?? hymn.page,
        key: patch.key ?? hymn.key,
        tempo: patch.tempo ?? hymn.tempo,
        themes: patch.themes ?? hymn.themes,
        notes: patch.notes ?? hymn.notes,
        lyrics: patch.lyrics ?? hymn.lyrics,
        defaultVerses: Number(patch.defaultVerses || hymn.defaultVerses || 3),
        defaultVolume: patch.defaultVolume === undefined ? hymn.defaultVolume : parseCsvVolume(patch.defaultVolume, hymn.defaultVolume ?? 0.9),
        defaultSpeed: patch.defaultSpeed === undefined ? hymn.defaultSpeed : parseCsvNumber(patch.defaultSpeed, hymn.defaultSpeed || 1),
        fadeIn: patch.fadeIn === undefined ? hymn.fadeIn : Math.max(0, parseCsvNumber(patch.fadeIn, hymn.fadeIn || 0)),
        fadeOut: patch.fadeOut === undefined ? hymn.fadeOut : Math.max(0, parseCsvNumber(patch.fadeOut, hymn.fadeOut || 0)),
        duration: patch.duration === undefined ? hymn.duration : Math.max(0, parseCsvNumber(patch.duration, hymn.duration || 0)),
        hasChorus,
        updatedAt: new Date().toISOString()
      };
    });
    await writeJson(LIBRARY_FILE, next);
    addLog("library", `Import cleanup saved for ${updates.length} hymn${updates.length === 1 ? "" : "s"}`);
    return send(res, 200, next);
  }

  if (hymnMatch && req.method === "DELETE") {
    auth.requirePermission(storage, req, "hymns.delete");
    const mediaDir = await ensureMediaStorage();
    const trashDir = getTrashDir(mediaDir);
    const library = await syncLibrary();
    const hymn = library.find((item) => item.id === hymnMatch[1]);
    if (!hymn) return send(res, 404, { error: "Hymn not found." });
    await writeJson(LIBRARY_FILE, library.filter((item) => item.id !== hymn.id));
    const source = path.join(mediaDir, hymn.fileName);
    const trashed = path.join(trashDir, `${Date.now()}-${hymn.fileName}`);
    try {
      await fsp.rename(source, trashed);
    } catch {
      await fsp.rm(source, { force: true });
    }
    addLog("library", `Deleted hymn: ${hymn.title}`);
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/service-plans") {
    return send(res, 200, await readJson(PLANS_FILE, []));
  }

  if (req.method === "GET" && url.pathname === "/api/service-queue") {
    return send(res, 200, await readJson(QUEUE_FILE, []));
  }

  if (req.method === "PUT" && url.pathname === "/api/service-queue") {
    auth.requirePermission(storage, req, "queue.manage");
    const queue = JSON.parse((await collectRequest(req, 5)).toString("utf8") || "[]");
    if (!Array.isArray(queue)) return send(res, 400, { error: "Expected a queue array." });
    await writeJson(QUEUE_FILE, queue);
    addLog("service", `Service queue saved with ${queue.length} hymn${queue.length === 1 ? "" : "s"}`);
    return send(res, 200, queue);
  }

  if (req.method === "POST" && url.pathname === "/api/service-plans") {
    auth.requirePermission(storage, req, "plans.save");
    const plan = JSON.parse((await collectRequest(req, 5)).toString("utf8") || "{}");
    const plans = await readJson(PLANS_FILE, []);
    const saved = { ...plan, id: plan.id || crypto.randomUUID(), updatedAt: new Date().toISOString() };
    const next = [saved, ...plans.filter((item) => item.id !== saved.id)].slice(0, 20);
    await writeJson(PLANS_FILE, next);
    addLog("plan", `Saved service plan: ${saved.name || "Untitled plan"}`);
    return send(res, 200, saved);
  }

  const planMatch = /^\/api\/service-plans\/([^/]+)$/.exec(url.pathname);
  if (planMatch && req.method === "POST") {
    auth.requirePermission(storage, req, "plans.load");
    const plans = await readJson(PLANS_FILE, []);
    const plan = plans.find((item) => item.id === planMatch[1]);
    if (!plan) return send(res, 404, { error: "Service plan not found." });
    const queue = Array.isArray(plan.queue) ? plan.queue.map((item) => ({ ...item, id: crypto.randomUUID() })) : [];
    await writeJson(QUEUE_FILE, queue);
    addLog("plan", `Loaded service plan: ${plan.name || "Untitled plan"}`);
    return send(res, 200, { plan, queue });
  }
  if (planMatch && req.method === "DELETE") {
    auth.requirePermission(storage, req, "plans.delete");
    const plans = await readJson(PLANS_FILE, []);
    const next = plans.filter((item) => item.id !== planMatch[1]);
    await writeJson(PLANS_FILE, next);
    addLog("plan", "Deleted service plan");
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: "Not found." });
}

async function serveFile(req, res, url) {
  let filePath;
  let requested = "";
  if (url.pathname.startsWith("/media/")) {
    const resolved = await resolveMediaRequest(decodeURIComponent(url.pathname.replace("/media/", "")));
    filePath = resolved.filePath;
  } else {
    requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    filePath = safeJoin(PUBLIC_DIR, requested);
  }
  const stat = await fsp.stat(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    "content-type": MIME[ext] || "application/octet-stream",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), geolocation=(), payment=()",
    "content-security-policy": "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
  };
  if (ext === ".mp3") {
    headers["accept-ranges"] = "bytes";
    const range = req.headers.range;
    if (range) {
      const [startText, endText] = range.replace(/bytes=/, "").split("-");
      let start = startText ? Number(startText) : stat.size - Number(endText);
      let end = endText && startText ? Number(endText) : stat.size - 1;
      if (!Number.isFinite(start) || start < 0) start = 0;
      if (!Number.isFinite(end) || end >= stat.size) end = stat.size - 1;
      if (start > end || start >= stat.size) {
        res.writeHead(416, { ...headers, "content-range": `bytes */${stat.size}` });
        res.end();
        return;
      }
      res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${stat.size}`, "content-length": end - start + 1 });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
  }
  if (requested === "index.html") {
    const settings = await readSettings();
    const branding = await publicBranding(settings);
    const appName = escapeHtml(branding.appName || DEFAULT_SETTINGS.appName);
    const logoSrc = branding.logoDataUri || `/api/logo?cache=${encodeURIComponent(branding.customLogoVersion || "current")}`;
    let html = await fsp.readFile(filePath, "utf8");
    html = html
      .replace("<title>Hymn Console</title>", `<title>${appName}</title>`)
      .replace('<meta name="apple-mobile-web-app-title" content="Hymn Console">', `<meta name="apple-mobile-web-app-title" content="${appName}">`)
      .replace('<meta name="theme-color" content="#eaf3fb">', `<meta name="theme-color" content="${initialBrandColors(settings).paper}">`)
      .replace("</head>", `    ${initialBrandStyle(settings)}\n  </head>`)
      .replaceAll('src="/mark.svg" alt="" data-brand-logo', `src="${logoSrc}" alt="" data-brand-logo`)
      .replaceAll('src="/api/logo?cache=initial" alt="" data-brand-logo', `src="${logoSrc}" alt="" data-brand-logo`)
      .replaceAll(">Hymn Console<", `>${appName}<`)
      .replaceAll(">Hymn Console Security<", `>${appName} Security<`);
    const payload = Buffer.from(html);
    res.writeHead(200, { ...headers, "content-length": payload.length });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(payload);
    return;
  }
  res.writeHead(200, { ...headers, "content-length": stat.size });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    assertSameOrigin(req);
    if (url.pathname.startsWith("/api/")) {
      if (needsMutationLock(req, url)) return await withMutationLock(() => handleApi(req, res, url));
      return await handleApi(req, res, url);
    }
    if (url.pathname.startsWith("/media/")) {
      const session = auth.requireSession(storage, req);
      if (!auth.hasPermission(session, "audio.device")) throw auth.httpError(403, "This account cannot play audio on this device.");
    }
    await serveFile(req, res, url);
  } catch (error) {
    const status = error.statusCode || (error.code === "ENOENT" ? 404 : 500);
    send(res, status, { error: status === 404 ? "Not found." : error.message });
  }
});

storage.openStorage({
  dataDir: DATA_DIR,
  documents: {
    library: { file: LIBRARY_FILE, fallback: [] },
    servicePlans: { file: PLANS_FILE, fallback: [] },
    serviceQueue: { file: QUEUE_FILE, fallback: [] },
    settings: { file: SETTINGS_FILE, fallback: DEFAULT_SETTINGS }
  }
});

ensureStorage().then(() => {
  scheduleMidnightBackups();
  setInterval(cleanupControllers, 5000);
  setInterval(() => storage.pruneSessions(), 15 * 60 * 1000);
  server.listen(PORT, "0.0.0.0", () => {
    addLog("system", `Hymn Console started on port ${PORT}`);
    console.log(`Hymn Console running at http://localhost:${PORT}`);
    getMediaDir().then((mediaDir) => console.log(`Media folder: ${mediaDir}`)).catch(() => {});
  });
});

function shutdown(signal) {
  addLog("system", `Received ${signal}; shutting down`);
  try {
    stopServerAudio();
    storage.closeStorage();
  } finally {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  }
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

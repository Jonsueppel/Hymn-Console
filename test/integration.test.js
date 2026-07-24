const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function randomPort() {
  return 19000 + Math.floor(Math.random() * 20000);
}

async function waitForServer(url, process, output) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`Test server exited early.\n${output()}`);
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Test server did not start.\n${output()}`);
}

test("production API integration", async (t) => {
  const root = path.resolve(__dirname, "..");
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "hymn-console-test-"));
  const dataDir = path.join(temp, "data");
  const mediaDir = path.join(temp, "media");
  const port = randomPort();
  const base = `http://127.0.0.1:${port}`;
  let stdout = "";
  let stderr = "";
  const child = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HYMN_DATA_DIR: dataDir,
      HYMN_MEDIA_DIR: mediaDir,
      HYMN_BACKUP_TOKEN: "integration-backup-token"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve)).catch(() => {});
    await fsp.rm(temp, { recursive: true, force: true });
  });
  await waitForServer(base, child, () => `${stdout}\n${stderr}`);

  let adminCookie = "";
  let operatorCookie = "";
  let recoveryCode = "";
  const request = async (route, { cookie = "", json, ...options } = {}) => {
    const headers = { ...(options.headers || {}) };
    if (cookie) headers.cookie = cookie;
    let body = options.body;
    if (json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(json);
    }
    const response = await fetch(`${base}${route}`, { ...options, headers, body });
    const type = response.headers.get("content-type") || "";
    const value = type.includes("json") ? await response.json() : await response.arrayBuffer();
    return { response, value, cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
  };

  await t.test("first-run setup creates the built-in administrator and a persistent session", async () => {
    const before = await request("/api/auth/status");
    assert.equal(before.value.setupRequired, true);
    assert.equal(before.value.branding.appName, "Hymn Console");
    assert.equal(before.value.branding.palette, "chapel-blue");
    assert.equal(before.value.branding.customLogo, false);
    assert.equal("openAiApiKey" in before.value.branding, false);
    const publicBranding = await request("/api/branding");
    assert.equal(publicBranding.response.status, 200);
    assert.equal(publicBranding.value.appName, "Hymn Console");
    assert.equal(publicBranding.value.palette, "chapel-blue");
    assert.equal(publicBranding.value.customLogo, false);
    assert.equal("openAiApiKey" in publicBranding.value, false);
    const setup = await request("/api/auth/setup", {
      method: "POST",
      json: {
        adminUsername: "admin",
        adminPassword: "AdminPass1234"
      }
    });
    assert.equal(setup.response.status, 201);
    assert.match(setup.value.recoveryCode, /^[A-Z0-9-]+$/);
    recoveryCode = setup.value.recoveryCode;
    adminCookie = setup.cookie;
    const refreshed = await request("/api/auth/status", { cookie: adminCookie });
    assert.equal(refreshed.value.authenticated, true);
    assert.equal(refreshed.value.user.role, "admin");
    assert.equal(refreshed.value.user.builtIn, true);
    const accountList = await request("/api/auth/users", { cookie: adminCookie });
    const builtInAdmin = accountList.value.users.find((user) => user.builtIn);
    assert.ok(builtInAdmin);
    assert.equal((await request(`/api/auth/users/${builtInAdmin.id}`, { method: "DELETE", cookie: adminCookie })).response.status, 400);
    assert.equal((await request(`/api/auth/users/${builtInAdmin.id}/password`, {
      method: "PUT",
      cookie: adminCookie,
      json: { password: "ChangedAdminPass1234" }
    })).response.status, 400);
    const created = await request("/api/auth/users", {
      method: "POST",
      cookie: adminCookie,
      json: { username: "operator", password: "OperatorPass1234" }
    });
    assert.equal(created.response.status, 201);
  });

  await t.test("fixed recovery PIN is rejected and login attempts are rate-limited", async () => {
    const recovery = await request("/api/auth/recover", {
      method: "POST",
      json: { username: "admin", recoveryCode: "1102", newPassword: "DifferentPass1234" }
    });
    assert.equal(recovery.response.status, 401);
    let status = 0;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const failed = await request("/api/auth/login", { method: "POST", json: { username: "nobody", password: "WrongPass1234" } });
      status = failed.response.status;
    }
    assert.equal(status, 429);
    assert.ok(recoveryCode);
  });

  await t.test("operator can run services but cannot change administrator settings", async () => {
    const login = await request("/api/auth/login", { method: "POST", json: { username: "operator", password: "OperatorPass1234" } });
    assert.equal(login.response.status, 200);
    operatorCookie = login.cookie;
    const denied = await request("/api/settings", { method: "PUT", cookie: operatorCookie, json: { appName: "Denied" } });
    assert.equal(denied.response.status, 403);
    const queue = [{ id: "q1", hymnId: "h1", title: "Test Hymn", verses: 2 }];
    assert.equal((await request("/api/service-queue", { method: "PUT", cookie: operatorCookie, json: queue })).response.status, 200);
    assert.deepEqual((await request("/api/service-queue", { cookie: operatorCookie })).value, queue);
  });

  await t.test("custom logo file is used even when the saved flag is stale", async () => {
    const logoPath = path.join(dataDir, "custom-logo");
    await fsp.mkdir(dataDir, { recursive: true });
    await fsp.writeFile(logoPath, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]));
    const branding = await request("/api/branding");
    assert.equal(branding.response.status, 200);
    assert.equal(branding.value.customLogo, true);
    assert.match(branding.value.logoDataUri, /^data:image\/jpeg;base64,/);
    const logo = await request("/api/custom-logo");
    assert.equal(logo.response.status, 200);
    assert.equal(logo.response.headers.get("content-type"), "image/jpeg");
    const lockScreenLogo = await request("/api/logo");
    assert.equal(lockScreenLogo.response.status, 200);
    assert.equal(lockScreenLogo.response.headers.get("content-type"), "image/jpeg");
    const brandedIndex = await request("/");
    assert.match(Buffer.from(brandedIndex.value).toString("utf8"), /src="data:image\/jpeg;base64,/);
    assert.doesNotMatch(Buffer.from(brandedIndex.value).toString("utf8"), /<img[^>]+mark\.svg[^>]+data-brand-logo/);
    await fsp.rm(logoPath, { force: true });
  });

  await t.test("legacy custom logo settings are backfilled into permanent settings", async () => {
    const logoPath = path.join(dataDir, "custom-logo");
    await fsp.mkdir(dataDir, { recursive: true });
    await fsp.writeFile(logoPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]));
    const stale = await request("/api/settings", {
      method: "PUT",
      cookie: adminCookie,
      json: { customLogo: true, customLogoMime: "image/png", customLogoVersion: "legacy", customLogoDataUri: "" }
    });
    assert.equal(stale.response.status, 200);
    const branding = await request("/api/branding");
    assert.equal(branding.response.status, 200);
    assert.equal(branding.value.customLogo, true);
    assert.match(branding.value.logoDataUri, /^data:image\/png;base64,/);
    const settings = await request("/api/settings", { cookie: adminCookie });
    assert.match(settings.value.customLogoDataUri, /^data:image\/png;base64,/);
    assert.equal((await request("/api/custom-logo", { method: "DELETE", cookie: adminCookie })).response.status, 200);
  });

  await t.test("granular audio and queue permissions are enforced by the server", async () => {
    const created = await request("/api/auth/users", {
      method: "POST",
      cookie: adminCookie,
      json: { username: "limited", password: "LimitedPass1234", permissions: ["playback.control", "audio.device"] }
    });
    assert.equal(created.response.status, 201);
    const login = await request("/api/auth/login", { method: "POST", json: { username: "limited", password: "LimitedPass1234" } });
    assert.equal(login.response.status, 200);
    assert.deepEqual(login.value.user.permissions.sort(), ["audio.device", "playback.control"]);
    fs.writeFileSync(path.join(mediaDir, "permission-test.mp3"), Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64)]));
    assert.equal((await request("/media/permission-test.mp3", { cookie: login.cookie })).response.status, 200);
    assert.equal((await request("/api/service-queue", { method: "PUT", cookie: login.cookie, json: [] })).response.status, 403);
    assert.equal((await request("/api/server-player", { method: "POST", cookie: login.cookie, json: { action: "stop" } })).response.status, 403);
    assert.equal((await request("/api/live-playback/command", { method: "POST", cookie: login.cookie, json: { action: "pause" } })).response.status, 403);
    const changed = await request(`/api/auth/users/${created.value.id}/permissions`, {
      method: "PUT",
      cookie: adminCookie,
      json: { permissions: ["playback.control", "audio.soundSystem"] }
    });
    assert.equal(changed.response.status, 200);
    const refreshedSession = await request("/api/auth/status", { cookie: login.cookie });
    assert.equal(refreshedSession.value.authenticated, true);
    assert.deepEqual(refreshedSession.value.user.permissions.sort(), ["audio.soundSystem", "playback.control"]);
    assert.equal((await request("/api/server-player", { method: "POST", cookie: login.cookie, json: { action: "stop" } })).response.status, 200);
    assert.equal((await request("/media/permission-test.mp3", { cookie: login.cookie })).response.status, 403);
  });

  await t.test("settings permissions allow only their assigned settings category", async () => {
    const created = await request("/api/auth/users", {
      method: "POST",
      cookie: adminCookie,
      json: { username: "designer", password: "DesignerPass1234", permissions: ["settings.appearance"] }
    });
    assert.equal(created.response.status, 201);
    const login = await request("/api/auth/login", { method: "POST", json: { username: "designer", password: "DesignerPass1234" } });
    assert.equal((await request("/api/settings", { method: "PUT", cookie: login.cookie, json: { appName: "Permission Test" } })).response.status, 200);
    const logoForm = new FormData();
    logoForm.append("logo", new Blob([Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\"><rect width=\"10\" height=\"10\"/></svg>")], { type: "image/svg+xml" }), "logo.svg");
    const logoUpload = await request("/api/custom-logo", { method: "POST", cookie: login.cookie, body: logoForm });
    assert.equal(logoUpload.response.status, 200);
    assert.equal(logoUpload.value.customLogo, true);
    assert.match(logoUpload.value.logoDataUri, /^data:image\/svg\+xml;base64,/);
    await fsp.rm(path.join(dataDir, "custom-logo"), { force: true });
    const settingsAfterLogo = await request("/api/settings", { cookie: login.cookie });
    assert.match(settingsAfterLogo.value.logoDataUri, /^data:image\/svg\+xml;base64,/);
    assert.equal((await request("/api/settings", { method: "PUT", cookie: login.cookie, json: { appName: "Permission Test Saved" } })).response.status, 200);
    const publicBranding = await request("/api/branding");
    assert.equal(publicBranding.response.status, 200);
    assert.equal(publicBranding.value.customLogo, true);
    assert.match(publicBranding.value.customLogoVersion, /^\d+$/);
    assert.match(publicBranding.value.logoDataUri, /^data:image\/svg\+xml;base64,/);
    const publicLogo = await request(`/api/custom-logo?cache=${publicBranding.value.customLogoVersion}`);
    assert.equal(publicLogo.response.status, 200);
    assert.equal(publicLogo.response.headers.get("content-type"), "image/svg+xml");
    const brandedIndex = await request("/");
    const brandedHtml = Buffer.from(brandedIndex.value).toString("utf8");
    assert.equal(brandedIndex.response.status, 200);
    assert.match(brandedHtml, /<title>Permission Test Saved<\/title>/);
    assert.match(brandedHtml, /--app-accent:/);
    assert.match(brandedHtml, /src="data:image\/svg\+xml;base64,/);
    assert.doesNotMatch(brandedHtml, /<img[^>]+mark\.svg[^>]+data-brand-logo/);
    const removedLogo = await request("/api/custom-logo", { method: "DELETE", cookie: login.cookie });
    assert.equal(removedLogo.response.status, 200);
    assert.equal(removedLogo.value.customLogo, false);
    assert.equal(removedLogo.value.appName, "Permission Test Saved");
    assert.match(removedLogo.value.logoDataUri, /^data:image\/svg\+xml;base64,/);
    assert.equal((await request("/api/settings", { method: "PUT", cookie: login.cookie, json: { network: { mode: "dhcp" } } })).response.status, 403);
    assert.equal((await request("/api/system/restart-pi", { method: "POST", cookie: login.cookie, json: {} })).response.status, 403);
  });

  await t.test("operator is denied every administrator-only system and data operation", async () => {
    const protectedRequests = [
      ["/api/settings", { method: "PUT", json: { dnsName: "blocked" } }],
      ["/api/system/restart-app", { method: "POST", json: {} }],
      ["/api/system/restart-pi", { method: "POST", json: {} }],
      ["/api/custom-logo", { method: "POST", body: new FormData() }],
      ["/api/custom-logo", { method: "DELETE" }],
      ["/api/rustdesk", {}],
      ["/api/upload", { method: "POST", body: new FormData() }],
      ["/api/hymns/not-a-hymn", { method: "DELETE" }],
      ["/api/trash/restore", { method: "POST", json: { name: "nothing.mp3" } }],
      ["/api/trash", { method: "DELETE" }],
      ["/api/backups/restore", { method: "POST", body: new FormData() }],
      ["/api/restore", { method: "POST", json: {} }]
    ];
    for (const [endpoint, options] of protectedRequests) {
      const denied = await request(endpoint, { ...options, cookie: operatorCookie });
      assert.equal(denied.response.status, 403, `${options.method || "GET"} ${endpoint} must require an administrator`);
    }
  });

  await t.test("concurrent queue updates remain valid and SQLite passes integrity checks", async () => {
    const updates = Array.from({ length: 12 }, (_, index) => request("/api/service-queue", {
      method: "PUT",
      cookie: operatorCookie,
      json: [{ id: `q-${index}`, hymnId: `h-${index}`, title: `Hymn ${index}`, verses: 1 }]
    }));
    const results = await Promise.all(updates);
    assert.ok(results.every((result) => result.response.ok));
    const finalQueue = (await request("/api/service-queue", { cookie: operatorCookie })).value;
    assert.equal(finalQueue.length, 1);
    assert.match(finalQueue[0].id, /^q-\d+$/);
    const diagnostics = await request("/api/diagnostics", { cookie: adminCookie });
    assert.equal(diagnostics.value.database.integrity, "ok");
  });

  await t.test("playback state synchronizes controls, fades, and remote commands", async () => {
    const publish = await request("/api/live-playback", {
      method: "POST",
      cookie: operatorCookie,
      json: {
        clientId: "browser-a",
        status: "playing",
        currentTitle: "Test Hymn",
        hymnId: "h1",
        index: 0,
        elapsed: 12,
        duration: 120,
        controls: { volume: 0.8, speed: 1.1, fadeIn: 1.5, fadeOut: 2.5 }
      }
    });
    assert.equal(publish.response.status, 200);
    const live = (await request("/api/live-playback", { cookie: operatorCookie })).value;
    assert.equal(live.status, "playing");
    assert.equal(live.controls.fadeIn, 1.5);
    assert.equal(live.controls.fadeOut, 2.5);
    const command = await request("/api/live-playback/command", { method: "POST", cookie: operatorCookie, json: { action: "pause" } });
    assert.equal(command.response.status, 200);
    assert.equal(command.value.command.targetClientId, "browser-a");
  });

  let uploadedHymn;
  await t.test("MP3 upload streams to disk and deletion moves it to trash", async () => {
    const bytes = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(4096, 1)]);
    const form = new FormData();
    form.append("audio", new Blob([bytes], { type: "audio/mpeg" }), "integration.mp3");
    form.append("title", "Integration Hymn");
    const upload = await request("/api/upload", { method: "POST", cookie: adminCookie, body: form });
    assert.equal(upload.response.status, 201);
    uploadedHymn = upload.value.uploaded[0];
    assert.ok(fs.existsSync(path.join(mediaDir, uploadedHymn.fileName)));
    const remove = await request(`/api/hymns/${uploadedHymn.id}`, { method: "DELETE", cookie: adminCookie });
    assert.equal(remove.response.status, 200);
    const trash = (await request("/api/trash", { cookie: adminCookie })).value;
    assert.equal(trash.count, 1);
  });

  await t.test("plans save, load, and delete under role enforcement", async () => {
    const saved = await request("/api/service-plans", { method: "POST", cookie: operatorCookie, json: { name: "Sunday", queue: [] } });
    assert.equal(saved.response.status, 200);
    const loaded = await request(`/api/service-plans/${saved.value.id}`, { method: "POST", cookie: operatorCookie });
    assert.equal(loaded.response.status, 200);
    assert.deepEqual(loaded.value.queue, []);
    const denied = await request(`/api/service-plans/${saved.value.id}`, { method: "DELETE", cookie: operatorCookie });
    assert.equal(denied.response.status, 403);
    const removed = await request(`/api/service-plans/${saved.value.id}`, { method: "DELETE", cookie: adminCookie });
    assert.equal(removed.response.status, 200);
  });

  await t.test("complete backup includes database and media archive", async () => {
    const local = await request("/api/backups/local", {
      method: "POST",
      headers: { "x-backup-token": "integration-backup-token" }
    });
    assert.equal(local.response.status, 200, JSON.stringify(local.value));
    assert.ok(fs.existsSync(path.join(dataDir, "backups", local.value.name, "hymn-console.sqlite")));
    const exported = await request("/api/backups/export", { method: "POST", cookie: adminCookie });
    assert.equal(exported.response.status, 200, exported.value instanceof ArrayBuffer ? "binary response" : JSON.stringify(exported.value));
    assert.ok(exported.value.byteLength > 100);
    const restoreForm = new FormData();
    restoreForm.append("backup", new Blob([exported.value], { type: "application/gzip" }), "integration-backup.tar.gz");
    const restored = await request("/api/backups/restore", { method: "POST", cookie: adminCookie, body: restoreForm });
    assert.equal(restored.response.status, 200, JSON.stringify(restored.value));
    const expired = await request("/api/auth/status", { cookie: adminCookie });
    assert.equal(expired.value.authenticated, false);
    const login = await request("/api/auth/login", { method: "POST", json: { username: "admin", password: "AdminPass1234" } });
    assert.equal(login.response.status, 200);
    adminCookie = login.cookie;
    const diagnostics = await request("/api/diagnostics", { cookie: adminCookie });
    assert.equal(diagnostics.value.database.integrity, "ok");
  });

  await t.test("logout invalidates the session", async () => {
    assert.equal((await request("/api/auth/logout", { method: "POST", cookie: operatorCookie })).response.status, 200);
    assert.equal((await request("/api/service-queue", { cookie: operatorCookie })).response.status, 401);
  });
});

test("SQLite survives an abrupt process stop without losing the service queue", async (t) => {
  const root = path.resolve(__dirname, "..");
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "hymn-console-crash-"));
  const port = randomPort();
  const base = `http://127.0.0.1:${port}`;
  let child;
  let output = "";
  const start = async () => {
    output = "";
    child = spawn(process.execPath, [path.join(root, "server.js")], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        HYMN_DATA_DIR: path.join(temp, "data"),
        HYMN_MEDIA_DIR: path.join(temp, "media")
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    await waitForServer(base, child, () => output);
  };
  const jsonRequest = async (route, { cookie = "", method = "GET", body } = {}) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { response, value: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
  };
  t.after(async () => {
    if (child?.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await fsp.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  await start();
  const setup = await jsonRequest("/api/auth/setup", {
    method: "POST",
    body: {
      adminUsername: "admin",
      adminPassword: "AdminPass1234"
    }
  });
  assert.equal(setup.response.status, 201);
  const expected = [{ id: "survives", hymnId: "hymn", title: "Crash Test", verses: 1 }];
  assert.equal((await jsonRequest("/api/service-queue", { method: "PUT", cookie: setup.cookie, body: expected })).response.status, 200);
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));

  await start();
  const login = await jsonRequest("/api/auth/login", { method: "POST", body: { username: "admin", password: "AdminPass1234" } });
  assert.equal(login.response.status, 200, output);
  const queue = await jsonRequest("/api/service-queue", { cookie: login.cookie });
  assert.deepEqual(queue.value, expected);
  const diagnostics = await jsonRequest("/api/diagnostics", { cookie: login.cookie });
  assert.equal(diagnostics.value.database.integrity, "ok");
});

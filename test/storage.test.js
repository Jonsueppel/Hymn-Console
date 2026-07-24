const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const storage = require("../lib/storage");
const auth = require("../lib/auth");

test("legacy JSON migrates once into SQLite with revisions", async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "hymn-storage-"));
  const libraryFile = path.join(temp, "library.json");
  await fsp.writeFile(libraryFile, JSON.stringify([{ id: "legacy", title: "Legacy Hymn" }]));
  storage.openStorage({
    dataDir: temp,
    documents: {
      library: { file: libraryFile, fallback: [] },
      servicePlans: { file: path.join(temp, "plans.json"), fallback: [] },
      serviceQueue: { file: path.join(temp, "queue.json"), fallback: [] },
      settings: { file: path.join(temp, "settings.json"), fallback: {} }
    }
  });
  assert.equal(storage.readDocument("library", [])[0].title, "Legacy Hymn");
  assert.ok(fs.existsSync(`${libraryFile}.migrated`));
  const firstRevision = storage.documentRevision("library").revision;
  storage.writeDocument("library", [{ id: "updated" }]);
  assert.equal(storage.documentRevision("library").revision, firstRevision + 1);
  assert.equal(storage.integrityCheck(), "ok");
  storage.closeStorage();
  await fsp.rm(temp, { recursive: true, force: true });
});

test("corrupt legacy JSON is preserved and startup fails visibly", async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "hymn-corrupt-"));
  const libraryFile = path.join(temp, "library.json");
  await fsp.writeFile(libraryFile, "{not valid json");
  assert.throws(() => storage.openStorage({
    dataDir: temp,
    documents: {
      library: { file: libraryFile, fallback: [] }
    }
  }), /Cannot migrate corrupt JSON file/);
  assert.ok((await fsp.readdir(temp)).some((name) => name.startsWith("library.json.corrupt-")));
  storage.closeStorage();
  await fsp.rm(temp, { recursive: true, force: true });
});

test("corrupt stored user permissions fail visibly instead of falling back empty", async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "hymn-permissions-"));
  storage.openStorage({
    dataDir: temp,
    documents: {
      library: { file: path.join(temp, "library.json"), fallback: [] }
    }
  });
  const secret = auth.hashSecret("SecurePass123");
  const user = storage.createUser({
    username: "operator1",
    role: "operator",
    passwordHash: secret.hash,
    passwordSalt: secret.salt,
    permissions: ["playback.control"]
  });
  storage.closeStorage();

  const db = new DatabaseSync(path.join(temp, "hymn-console.sqlite"));
  db.prepare("UPDATE users SET permissions_json = ? WHERE id = ?").run("{bad json", user.id);
  db.close();

  assert.throws(() => storage.openStorage({
    dataDir: temp,
    documents: {
      library: { file: path.join(temp, "library.json"), fallback: [] }
    }
  }), /Stored permissions for user .* contains invalid JSON/);
  storage.closeStorage();
  await fsp.rm(temp, { recursive: true, force: true });
});

test("password and generated recovery credentials use salted scrypt", () => {
  const first = auth.hashSecret("SecurePass123");
  const second = auth.hashSecret("SecurePass123");
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
  assert.equal(auth.verifySecret("SecurePass123", first.hash, first.salt), true);
  assert.equal(auth.verifySecret("WrongPass123", first.hash, first.salt), false);
  assert.notEqual(auth.createRecoveryCode(), "1102");
});

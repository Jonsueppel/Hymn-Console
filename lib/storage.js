const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const DOCUMENT_KEYS = new Map();
const LEGACY_USER_PERMISSIONS = [
  "playback.control", "playback.remote", "playback.adjust", "audio.device", "audio.soundSystem",
  "queue.manage", "plans.load", "plans.save", "lyrics.view"
];
const PERMISSION_ALIASES = {
  "library.edit": "hymns.edit",
  "library.delete": "hymns.delete",
  "library.upload": "library.uploadMp3"
};
let database = null;
let databasePath = "";
let openConfig = null;

function openStorage({ dataDir, documents }) {
  openConfig = { dataDir, documents };
  fs.mkdirSync(dataDir, { recursive: true });
  databasePath = path.join(dataDir, "hymn-console.sqlite");
  database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      key TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('operator', 'admin')),
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      address TEXT,
      user_agent TEXT
    );

    CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS auth_recovery (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      code_hash TEXT NOT NULL,
      code_salt TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const userColumns = new Set(database.prepare("PRAGMA table_info(users)").all().map((column) => column.name));
  if (!userColumns.has("permissions_json")) database.exec("ALTER TABLE users ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '[]'");
  if (!userColumns.has("built_in")) database.exec("ALTER TABLE users ADD COLUMN built_in INTEGER NOT NULL DEFAULT 0");
  database.prepare(`UPDATE users SET permissions_json = ? WHERE role = 'operator' AND permissions_json = '[]'`)
    .run(JSON.stringify(LEGACY_USER_PERMISSIONS));
  for (const row of database.prepare("SELECT id, permissions_json FROM users WHERE role = 'operator'").all()) {
    const permissions = parseJsonArrayField(row.permissions_json, `Stored permissions for user ${row.id}`);
    const migrated = [...new Set(permissions.map((permission) => PERMISSION_ALIASES[permission] || permission))];
    if (migrated.includes("playback.control") && !migrated.includes("playback.remote")) migrated.push("playback.remote");
    database.prepare("UPDATE users SET permissions_json = ? WHERE id = ?").run(JSON.stringify(migrated), row.id);
  }
  if (!database.prepare("SELECT 1 FROM users WHERE built_in = 1").get()) {
    const firstAdmin = database.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1").get();
    if (firstAdmin) database.prepare("UPDATE users SET built_in = 1 WHERE id = ?").run(firstAdmin.id);
  }
  database.prepare("UPDATE users SET role = 'operator', permissions_json = ? WHERE role = 'admin' AND built_in = 0")
    .run(JSON.stringify(LEGACY_USER_PERMISSIONS));

  const integrity = database.prepare("PRAGMA quick_check").get();
  if (!integrity || integrity.quick_check !== "ok") {
    database.close();
    database = null;
    throw new Error(`SQLite integrity check failed: ${integrity?.quick_check || "unknown error"}`);
  }

  for (const [key, config] of Object.entries(documents)) {
    DOCUMENT_KEYS.set(path.resolve(config.file), key);
    migrateDocument(key, config.file, config.fallback);
  }
  recordMigration(1);
  recordMigration(2);
  recordMigration(3);
  return { databasePath };
}

function replaceDatabase(source) {
  const candidate = new DatabaseSync(source, { readOnly: true });
  const check = candidate.prepare("PRAGMA integrity_check").get();
  candidate.close();
  if (!check || check.integrity_check !== "ok") throw new Error(`Backup database integrity check failed: ${check?.integrity_check || "unknown error"}`);
  const rollback = `${databasePath}.rollback-${Date.now()}`;
  closeStorage();
  fs.copyFileSync(databasePath, rollback);
  try {
    fs.copyFileSync(source, databasePath);
    openStorage(openConfig);
    return rollback;
  } catch (error) {
    fs.copyFileSync(rollback, databasePath);
    openStorage(openConfig);
    throw error;
  }
}

function requireDatabase() {
  if (!database) throw new Error("SQLite storage has not been initialized.");
  return database;
}

function recordMigration(version) {
  requireDatabase().prepare(`
    INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)
  `).run(version, new Date().toISOString());
}

function parseLegacyJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const raw = fs.readFileSync(file, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    const corruptCopy = `${file}.corrupt-${Date.now()}`;
    fs.copyFileSync(file, corruptCopy);
    throw new Error(`Cannot migrate corrupt JSON file ${path.basename(file)}. A copy was saved as ${path.basename(corruptCopy)}. ${error.message}`);
  }
}

function parseJsonArrayField(value, label) {
  let parsed;
  try {
    parsed = JSON.parse(value || "[]");
  } catch (error) {
    throw new Error(`${label} contains invalid JSON: ${error.message}`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array.`);
  return parsed;
}

function migrateDocument(key, file, fallback) {
  const db = requireDatabase();
  if (db.prepare("SELECT 1 FROM documents WHERE key = ?").get(key)) return;
  const value = parseLegacyJson(file, fallback);
  db.prepare(`
    INSERT INTO documents(key, json, revision, updated_at) VALUES (?, ?, 1, ?)
  `).run(key, JSON.stringify(value), new Date().toISOString());
  if (fs.existsSync(file)) {
    const migrated = `${file}.migrated`;
    if (!fs.existsSync(migrated)) fs.copyFileSync(file, migrated);
  }
}

function documentKeyForFile(file) {
  return DOCUMENT_KEYS.get(path.resolve(file)) || "";
}

function readDocument(key, fallback) {
  const row = requireDatabase().prepare("SELECT json FROM documents WHERE key = ?").get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.json);
  } catch (error) {
    throw new Error(`Stored SQLite document '${key}' is invalid: ${error.message}`);
  }
}

function writeDocument(key, value) {
  requireDatabase().prepare(`
    INSERT INTO documents(key, json, revision, updated_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      json = excluded.json,
      revision = documents.revision + 1,
      updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), new Date().toISOString());
}

function documentRevision(key) {
  return requireDatabase().prepare("SELECT revision, updated_at FROM documents WHERE key = ?").get(key) || null;
}

function listUsers() {
  return requireDatabase().prepare(`
    SELECT id, username, role, disabled, permissions_json AS permissionsJson,
      built_in AS builtIn, created_at AS createdAt, updated_at AS updatedAt
    FROM users ORDER BY role DESC, username COLLATE NOCASE
  `).all().map(publicUser);
}

function publicUser(row) {
  if (!row) return null;
  const permissions = parseJsonArrayField(row.permissionsJson ?? row.permissions_json, `Stored permissions for user ${row.id || row.username || "unknown"}`);
  return {
    ...row,
    disabled: Boolean(row.disabled),
    builtIn: Boolean(row.builtIn ?? row.built_in),
    permissions
  };
}

function countUsers() {
  return Number(requireDatabase().prepare("SELECT COUNT(*) AS count FROM users").get().count || 0);
}

function getUserByUsername(username) {
  return requireDatabase().prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(String(username || "").trim()) || null;
}

function getUserById(id) {
  return requireDatabase().prepare("SELECT * FROM users WHERE id = ?").get(id) || null;
}

function createUser({ username, role, passwordHash, passwordSalt, permissions = [], builtIn = false }) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  requireDatabase().prepare(`
    INSERT INTO users(id, username, role, password_hash, password_salt, permissions_json, built_in, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, username, role, passwordHash, passwordSalt, JSON.stringify(permissions), builtIn ? 1 : 0, now, now);
  return getUserById(id);
}

function createInitialAccounts(users, recovery) {
  const db = requireDatabase();
  if (countUsers()) throw new Error("Accounts are already configured.");
  db.exec("BEGIN IMMEDIATE");
  try {
    const created = users.map((user) => createUser(user));
    setRecoveryCredential(recovery.codeHash, recovery.codeSalt);
    db.exec("COMMIT");
    return created;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function updateUserPassword(id, passwordHash, passwordSalt) {
  requireDatabase().prepare(`
    UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?
  `).run(passwordHash, passwordSalt, new Date().toISOString(), id);
}

function updateUserPermissions(id, permissions) {
  requireDatabase().prepare("UPDATE users SET permissions_json = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(permissions), new Date().toISOString(), id);
}

function deleteUser(id) {
  requireDatabase().prepare("DELETE FROM users WHERE id = ? AND built_in = 0").run(id);
}

function createSession({ tokenHash, userId, expiresAt, address, userAgent }) {
  const now = new Date().toISOString();
  requireDatabase().prepare(`
    INSERT INTO sessions(token_hash, user_id, created_at, last_seen_at, expires_at, address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(tokenHash, userId, now, now, expiresAt, address || "", userAgent || "");
}

function getSession(tokenHash) {
  return requireDatabase().prepare(`
    SELECT s.*, u.username, u.role, u.disabled, u.permissions_json, u.built_in
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).get(tokenHash) || null;
}

function touchSession(tokenHash) {
  requireDatabase().prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?")
    .run(new Date().toISOString(), tokenHash);
}

function deleteSession(tokenHash) {
  requireDatabase().prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

function deleteUserSessions(userId) {
  requireDatabase().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

function clearAllSessions() {
  requireDatabase().prepare("DELETE FROM sessions").run();
}

function pruneSessions() {
  requireDatabase().prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
}

function getRecoveryCredential() {
  return requireDatabase().prepare("SELECT code_hash AS codeHash, code_salt AS codeSalt, updated_at AS updatedAt FROM auth_recovery WHERE id = 1").get() || null;
}

function setRecoveryCredential(codeHash, codeSalt) {
  requireDatabase().prepare(`
    INSERT INTO auth_recovery(id, code_hash, code_salt, updated_at)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      code_hash = excluded.code_hash,
      code_salt = excluded.code_salt,
      updated_at = excluded.updated_at
  `).run(codeHash, codeSalt, new Date().toISOString());
}

function integrityCheck() {
  const result = requireDatabase().prepare("PRAGMA integrity_check").get();
  return result?.integrity_check || "unknown";
}

function snapshotDatabase(target) {
  requireDatabase().exec("PRAGMA wal_checkpoint(FULL)");
  fs.copyFileSync(databasePath, target);
}

async function secureFile(file, mode = 0o600) {
  try {
    await fsp.chmod(file, mode);
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
}

function closeStorage() {
  if (!database) return;
  database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  database.close();
  database = null;
}

module.exports = {
  openStorage,
  closeStorage,
  documentKeyForFile,
  readDocument,
  writeDocument,
  documentRevision,
  listUsers,
  countUsers,
  getUserByUsername,
  getUserById,
  createUser,
  createInitialAccounts,
  updateUserPassword,
  updateUserPermissions,
  deleteUser,
  createSession,
  getSession,
  touchSession,
  deleteSession,
  deleteUserSessions,
  clearAllSessions,
  pruneSessions,
  getRecoveryCredential,
  setRecoveryCredential,
  integrityCheck,
  snapshotDatabase,
  replaceDatabase,
  secureFile,
  parseJsonArrayField
};

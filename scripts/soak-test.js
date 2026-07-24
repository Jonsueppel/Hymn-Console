const fs = require("node:fs/promises");

const base = process.env.HYMN_CONSOLE_URL || "http://127.0.0.1:8080";
let cookie = process.env.HYMN_CONSOLE_COOKIE || "";
const username = process.env.HYMN_CONSOLE_USERNAME || "";
const password = process.env.HYMN_CONSOLE_PASSWORD || "";
const hours = Math.max(1, Number(process.env.SOAK_HOURS || 4));
const intervalMs = 5000;
const end = Date.now() + hours * 60 * 60 * 1000;
const samples = [];

async function authenticate() {
  if (cookie) return;
  if (!username || !password) {
    throw new Error("Set HYMN_CONSOLE_COOKIE or HYMN_CONSOLE_USERNAME and HYMN_CONSOLE_PASSWORD.");
  }
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  if (!response.ok) throw new Error(`Soak-test login failed with ${response.status}`);
  const setCookie = response.headers.get("set-cookie") || "";
  cookie = setCookie.split(";")[0];
  if (!cookie) throw new Error("Soak-test login did not return a session cookie.");
}

async function sample() {
  const started = Date.now();
  const response = await fetch(`${base}/api/resources`, { headers: cookie ? { cookie } : {} });
  if (!response.ok) throw new Error(`Resource check failed with ${response.status}`);
  const resources = await response.json();
  samples.push({
    time: new Date().toISOString(),
    latencyMs: Date.now() - started,
    freeMemory: resources.memory?.free,
    loadAverage: resources.loadAverage,
    temperatureC: resources.temperatureC,
    playback: resources.playback
  });
  process.stdout.write(`\r${samples.length} samples | ${samples.at(-1).latencyMs} ms | ${Math.max(0, Math.ceil((end - Date.now()) / 60000))} min remaining`);
}

(async () => {
  await authenticate();
  while (Date.now() < end) {
    try {
      await sample();
    } catch (error) {
      samples.push({ time: new Date().toISOString(), error: error.message });
      console.error(`\n${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  const file = `hymn-console-soak-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await fs.writeFile(file, `${JSON.stringify(samples, null, 2)}\n`);
  console.log(`\nSoak report saved to ${file}`);
  if (samples.some((item) => item.error)) process.exitCode = 1;
})();

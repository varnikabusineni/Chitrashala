// scripts/env.js — tiny .env reader shared by the other scripts.
// We avoid the "dotenv" package so the project needs no npm install.

const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) {
    stop("No .env file found. Copy .env.example to .env and fill it in.");
  }
  const values = {};
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const equalsAt = line.indexOf("=");
    if (equalsAt === -1) continue;
    const key = line.slice(0, equalsAt).trim();
    let value = line.slice(equalsAt + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

// Print a friendly message (no scary stack trace) and exit.
function stop(message) {
  console.error("ERROR: " + message);
  process.exit(1);
}

// Stop with a clear message if a variable is missing or still a placeholder.
function requireVars(env, names) {
  const missing = names.filter((name) => !env[name] || env[name].startsWith("your-"));
  if (missing.length > 0) {
    stop("Please set these in .env: " + missing.join(", "));
  }
}

module.exports = { loadEnv, requireVars };

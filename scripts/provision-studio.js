// scripts/provision-studio.js
// ---------------------------------------------------------------------
// Creates (or finds) the studio admin account from seed.json in
// Supabase Auth and gives it the 'studio' role.
//
//   node scripts/provision-studio.js
//
// Reads from .env (never committed):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STUDIO_EMAIL, STUDIO_PASSWORD
//
// Why a script with the service role key? Customers can never give
// themselves a role (no UPDATE grant + a trigger block it). Only a
// trusted server-side key can. This script runs on YOUR computer only.
// Prefer the dashboard? See README "Option A".
// Needs Node 18+ (built-in fetch). No npm packages.
// ---------------------------------------------------------------------

const { loadEnv, requireVars } = require("./env");

const env = loadEnv();
requireVars(env, ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "STUDIO_EMAIL", "STUDIO_PASSWORD"]);

const baseUrl = env.SUPABASE_URL.replace(/\/+$/, "");
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const studioEmail = env.STUDIO_EMAIL.trim().toLowerCase();

function headers() {
  const result = { apikey: serviceKey, "Content-Type": "application/json" };
  // Legacy JWT keys also go in the Authorization header.
  if (serviceKey.startsWith("eyJ")) result.Authorization = "Bearer " + serviceKey;
  return result;
}

async function callApi(method, urlPath, body) {
  const response = await fetch(baseUrl + urlPath, {
    method,
    headers: { ...headers(), Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return { ok: response.ok, status: response.status, data };
}

async function findUserByEmail(email) {
  for (let page = 1; page <= 20; page++) {
    const result = await callApi("GET", `/auth/v1/admin/users?page=${page}&per_page=100`);
    if (!result.ok) throw new Error("Could not list users: " + JSON.stringify(result.data));
    const users = result.data.users || [];
    const match = users.find((user) => (user.email || "").toLowerCase() === email);
    if (match) return match;
    if (users.length < 100) return null;
  }
  return null;
}

async function main() {
  // 1. Create the Auth user (email already confirmed), or reuse it.
  let user = await findUserByEmail(studioEmail);
  if (user) {
    console.log("Studio user already exists:", studioEmail);
  } else {
    const created = await callApi("POST", "/auth/v1/admin/users", {
      email: studioEmail,
      password: env.STUDIO_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Studio Admin" },
    });
    if (!created.ok) throw new Error("Could not create user: " + JSON.stringify(created.data));
    user = created.data;
    console.log("Created studio user:", studioEmail);
  }

  // 2. Promote the profile to 'studio'. The service role key is allowed
  //    to do this; a logged-in customer is not.
  const promoted = await callApi(
    "PATCH",
    `/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`,
    { role: "studio" }
  );
  if (!promoted.ok || !promoted.data || promoted.data.length !== 1) {
    throw new Error(
      "Could not set role. Did you run all 4 migrations BEFORE creating the user? " + JSON.stringify(promoted.data)
    );
  }
  console.log("Role set to 'studio'. You can now log in as", studioEmail);
}

main().catch((error) => {
  console.error("ERROR:", error.message);
  process.exit(1);
});

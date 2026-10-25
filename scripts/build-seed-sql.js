// scripts/build-seed-sql.js
// ---------------------------------------------------------------------
// Reads seed/seed.json (the source of truth) and writes supabase/seed.sql.
//
//   node scripts/build-seed-sql.js
//
// The generated SQL is IDEMPOTENT: running it twice never creates
// duplicates, because every insert uses "ON CONFLICT (id) ...".
// Paintings use DO NOTHING so a re-run never resets a painting that has
// since been bought or edited, and seeded 'sold' paintings stay sold.
//
// The studio account password is NOT read or written here — see
// scripts/provision-studio.js and the README.
// No npm packages needed: only Node's built-in fs and path modules.
// ---------------------------------------------------------------------

const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const seedPath = path.join(projectRoot, "seed", "seed.json");
const outputPath = path.join(projectRoot, "supabase", "seed.sql");

// Turn a JS value into a safe SQL literal ('it''s' style escaping).
function sqlText(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function sqlNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("Not a number: " + value);
  return String(number);
}

// Fail loudly if seed.json is missing something we rely on.
function checkSeed(seed) {
  const problems = [];
  if (seed.currency !== "INR") problems.push("currency should be INR");
  if (!seed.mural || !(seed.mural.ratePerSqFt > 0)) problems.push("mural.ratePerSqFt missing");
  for (const p of seed.paintings || []) {
    for (const field of ["id", "title", "artist", "description", "price", "imageUrl", "status"]) {
      if (p[field] === undefined) problems.push(`painting ${p.id} is missing ${field}`);
    }
    if (!["available", "sold"].includes(p.status)) problems.push(`painting ${p.id} has bad status`);
    const imageFile = path.join(projectRoot, p.imageUrl);
    if (!fs.existsSync(imageFile)) problems.push(`image not found: ${p.imageUrl}`);
  }
  if (problems.length > 0) {
    throw new Error("seed.json problems:\n - " + problems.join("\n - "));
  }
}

function buildSql(seed) {
  const lines = [];
  lines.push("-- =====================================================================");
  lines.push("-- seed.sql — GENERATED from seed/seed.json by scripts/build-seed-sql.js");
  lines.push("-- Safe to run many times (idempotent). Run AFTER the 4 migrations.");
  lines.push("-- =====================================================================");
  lines.push("begin;");
  lines.push("");

  lines.push("-- Studio settings: currency and mural rate (" + seed.currency + " " + seed.mural.ratePerSqFt + " / sq ft)");
  lines.push("insert into public.studio_settings (id, currency, mural_rate_per_sqft)");
  lines.push(`values (true, ${sqlText(seed.currency)}, ${sqlNumber(seed.mural.ratePerSqFt)})`);
  lines.push("on conflict (id) do update set currency = excluded.currency,");
  lines.push("  mural_rate_per_sqft = excluded.mural_rate_per_sqft;");
  lines.push("");

  lines.push(`-- ${seed.paintings.length} paintings (DO NOTHING: never overwrite live status)`);
  lines.push("insert into public.paintings (id, title, artist, description, price, image_url, status) values");
  const paintingRows = seed.paintings.map((p) =>
    `  (${sqlText(p.id)}, ${sqlText(p.title)}, ${sqlText(p.artist)}, ${sqlText(p.description)}, ` +
    `${sqlNumber(p.price)}, ${sqlText(p.imageUrl)}, ${sqlText(p.status)})`
  );
  lines.push(paintingRows.join(",\n"));
  lines.push("on conflict (id) do nothing;");
  lines.push("");

  lines.push(`-- ${seed.potteryItems.length} pottery items`);
  lines.push("insert into public.pottery_items (id, name) values");
  lines.push(seed.potteryItems.map((i) => `  (${sqlText(i.id)}, ${sqlText(i.name)})`).join(",\n"));
  lines.push("on conflict (id) do update set name = excluded.name;");
  lines.push("");

  lines.push(`-- ${seed.glazes.length} glazes`);
  lines.push("insert into public.glazes (id, name) values");
  lines.push(seed.glazes.map((g) => `  (${sqlText(g.id)}, ${sqlText(g.name)})`).join(",\n"));
  lines.push("on conflict (id) do update set name = excluded.name;");
  lines.push("");

  lines.push("commit;");
  lines.push("");
  lines.push("-- Studio account (" + seed.studioAccount.email + "): created through Supabase Auth,");
  lines.push("-- NOT here. See README section 'Provision the studio admin account'.");
  return lines.join("\n") + "\n";
}

const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
checkSeed(seed);
fs.writeFileSync(outputPath, buildSql(seed));
console.log(
  `Wrote ${path.relative(projectRoot, outputPath)}: ${seed.paintings.length} paintings, ` +
  `${seed.potteryItems.length} pottery items, ${seed.glazes.length} glazes.`
);

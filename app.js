/* =====================================================================
   app.js — all the website's behaviour, in plain JavaScript.

   How it is organised (read top to bottom):
     1. Setup & constants
     2. Small helpers (dates, money, safe HTML)
     3. UI building blocks (toasts, dialogs, loading/empty/error states)
     4. Talking to the database (one wrapper for every RPC call)
     5. Login state (who is logged in, and their role)
     6. Router (which page to show for the URL #/something)
     7. Pages: home, paintings, orders, murals, pottery, login/signup, admin
     8. Click handling (one listener, a map of actions)
     9. Start the app

   SECURITY NOTE: everything in this file runs in the visitor's browser,
   so anyone can change it. That is why hiding buttons here is only for
   convenience. The REAL rules (prices, dates, roles, ownership) are
   enforced by the database in supabase/migrations/*.sql.
   ===================================================================== */
"use strict";

/* ---------------------------------------------------------------------
   1. SETUP & CONSTANTS
   --------------------------------------------------------------------- */
const STUDIO_TIME_ZONE = "Asia/Kolkata";

// Same numbers as the database checks; used here only to give quick feedback.
const MURAL_RULES = { minDaysAhead: 7, maxDaysAhead: 90, minSize: 10, maxSize: 500, cancelDaysBefore: 3 };
const POTTERY_RULES = { minQuantity: 1, maxQuantity: 12, minDaysAhead: 14 };

// seed.json gives glaze NAMES only; these colours are just for the swatches.
const GLAZE_COLOURS = {
  "g-01": "#C2362B", // Kumkum Red
  "g-02": "#E8B324", // Haldi Yellow
  "g-03": "#6C7F38", // Mehendi Green
  "g-04": "#2A3E92", // Indigo Blue
  "g-05": "#D9BE94", // Sandalwood Beige
  "g-06": "#2D2B29", // Charcoal Black
};

// Tiny drawings for each pottery item (decorative, so aria-hidden).
const CLAY = 'fill="#D97B4F" stroke="#20201E" stroke-width="2.5" stroke-linejoin="round"';
const POTTERY_ICONS = {
  "i-01": `<path ${CLAY} d="M14 18h36l-5 31a4 4 0 0 1-4 3H23a4 4 0 0 1-4-3z"/>`,
  "i-02": `<path ${CLAY} d="M27 7h10v7c0 4 3 5 6 8 5 5 7 10 7 16 0 10-8 18-18 18s-18-8-18-18c0-6 2-11 7-16 3-3 6-4 6-8z"/>`,
  "i-03": `<path ${CLAY} d="M24 10h16v6c9 3 14 10 14 18 0 11-10 20-22 20S10 45 10 34c0-8 5-15 14-18z"/>`,
  "i-04": `<path ${CLAY} d="M8 34h48c-2 9-12 16-24 16S10 43 8 34z"/><path fill="#F4D44D" stroke="#20201E" stroke-width="2.5" d="M32 11c6 7 6 13 0 18-6-5-6-11 0-18z"/>`,
  "i-05": `<path ${CLAY} d="M15 32h34l-5 21H20z"/><path ${CLAY} d="M12 27h40v6H12z"/><path fill="#B9DCA7" stroke="#20201E" stroke-width="2.5" d="M32 27c0-9 5-14 13-16-1 8-5 13-13 16zM32 27c-1-7-5-11-12-12 1 7 5 10 12 12z"/>`,
};

const appEl = document.getElementById("app");
const config = window.APP_CONFIG || null;
const db = createDatabaseClient();

// Everything the app remembers while it runs.
const state = {
  user: null,          // the Supabase Auth user, or null when logged out
  profile: null,       // { id, email, full_name, role } from the profiles table
  settings: null,      // { currency, mural_rate_per_sqft }
  paintings: [],
  paintingFilter: "all",
  potteryItems: [],
  glazes: [],
  bookedDates: [],
  editingPotteryId: null,
  admin: { tab: "bookings", bookingFilter: "requested", potteryFilter: "requested", data: null },
};

function createDatabaseClient() {
  const looksConfigured =
    config && config.SUPABASE_URL && config.SUPABASE_ANON_KEY && !config.SUPABASE_URL.includes("your-project");
  if (!window.supabase || !looksConfigured) return null;
  return window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
}

/* ---------------------------------------------------------------------
   2. SMALL HELPERS
   --------------------------------------------------------------------- */

// ALWAYS use this before putting database text into HTML. It stops a
// painting title like "<script>..." from running as code (XSS).
function escapeHtml(value) {
  const replacements = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value ?? "").replace(/[&<>"']/g, (char) => replacements[char]);
}

const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2,
});
function formatMoney(amount) {
  return rupees.format(Number(amount) || 0);
}

// Today's date in India as "YYYY-MM-DD" (the same "today" the database uses).
function todayInStudio() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: STUDIO_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

// Date maths on "YYYY-MM-DD" strings, done in UTC so time zones can't shift the day.
function addDays(isoDate, days) {
  const date = new Date(isoDate + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(toIso + "T00:00:00Z") - Date.parse(fromIso + "T00:00:00Z")) / 86400000);
}

function formatDate(isoDate) {
  return new Date(isoDate + "T00:00:00Z").toLocaleDateString("en-IN", {
    timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}
function formatDateTime(timestamp) {
  return new Date(timestamp).toLocaleString("en-IN", {
    timeZone: STUDIO_TIME_ZONE, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

// Only allow images from our own images/ folder or a secure https:// link.
function safeImageUrl(url) {
  const value = String(url || "").trim();
  if (/^images\/[\w.\-]+$/.test(value) || /^https:\/\/[^\s"'<>]+$/i.test(value)) return value;
  return "";
}

function routeQuery() {
  const query = location.hash.split("?")[1] || "";
  return new URLSearchParams(query);
}

function isCustomer() {
  return state.profile && state.profile.role === "customer";
}
function isStudio() {
  return state.profile && state.profile.role === "studio";
}

/* ---------------------------------------------------------------------
   3. UI BUILDING BLOCKS
   --------------------------------------------------------------------- */

function showToast(message, type = "info") {
  const icons = { success: "✓", error: "!", info: "✦" };
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${icons[type]}</span>
    <span>${escapeHtml(message)}</span>
    <button class="toast-close" aria-label="Dismiss message">×</button>`;
  toast.querySelector(".toast-close").addEventListener("click", () => toast.remove());
  document.getElementById("toastArea").appendChild(toast);
  setTimeout(() => toast.remove(), type === "error" ? 9000 : 5000);
}

// A "Are you sure?" popup. Returns a Promise that resolves to true/false.
function confirmAction({ title, message, confirmLabel = "Yes" }) {
  const dialog = document.getElementById("confirmDialog");
  document.getElementById("confirmTitle").textContent = title;
  document.getElementById("confirmMessage").textContent = message;
  document.getElementById("confirmOk").textContent = confirmLabel;
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
  });
}

// Shows a spinner in a button and stops double-clicks while waiting.
function setBusy(button, isBusy) {
  if (!button) return;
  button.disabled = isBusy;
  button.classList.toggle("is-busy", isBusy);
  button.setAttribute("aria-busy", String(isBusy));
}

function statusBadge(status) {
  return `<span class="badge badge-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

// <img> for a painting, or a deliberate fallback if there is no usable image.
function paintingImage(painting) {
  const url = safeImageUrl(painting.image_url);
  if (!url) return imageFallback(painting.title);
  return `<img src="${escapeHtml(url)}" alt="${escapeHtml(painting.title)} by ${escapeHtml(painting.artist)}"
            loading="lazy" data-fallback-title="${escapeHtml(painting.title)}">`;
}
function imageFallback(title) {
  return `<div class="art-fallback" role="img" aria-label="Image not available for ${escapeHtml(title)}">
            <span aria-hidden="true">✶</span>Image coming soon</div>`;
}

function potteryIcon(itemId) {
  return `<svg viewBox="0 0 64 64" aria-hidden="true">${POTTERY_ICONS[itemId] || POTTERY_ICONS["i-03"]}</svg>`;
}

function skeletonGallery(count) {
  const card = `<div class="art-card" aria-hidden="true"><div class="skeleton skeleton-art"></div>
                <div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div></div>`;
  return `<div class="gallery" aria-busy="true"><span class="sr-only">Loading…</span>${card.repeat(count)}</div>`;
}
function skeletonList(count) {
  return `<div class="record-list" aria-busy="true"><span class="sr-only">Loading…</span>
          ${'<div class="skeleton skeleton-record" aria-hidden="true"></div>'.repeat(count)}</div>`;
}

// Empty / locked / error panels share one look.
function stateBlock({ icon = "✦", title, text = "", actions = "", variant = "" }) {
  return `<div class="state ${variant}">
            <div class="state-icon" aria-hidden="true">${icon}</div>
            <h3>${escapeHtml(title)}</h3>
            ${text ? `<p>${escapeHtml(text)}</p>` : ""}
            ${actions ? `<div class="hero-actions">${actions}</div>` : ""}
          </div>`;
}
function errorBlock(message) {
  return stateBlock({
    icon: "!", variant: "state-error", title: "Something went wrong",
    text: message, actions: `<button class="btn btn-primary" data-action="retry">Try again</button>`,
  });
}

function fieldError(inputId, message) {
  const input = document.getElementById(inputId);
  const errorEl = document.getElementById(inputId + "Error");
  if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
  if (errorEl) errorEl.textContent = message || "";
}

function formMessage(elementId, message, type) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (!message) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.className = `form-message is-${type}`;
  el.textContent = message;
}

/* ---------------------------------------------------------------------
   4. TALKING TO THE DATABASE
   Every change goes through a database FUNCTION (supabase.rpc). The
   function checks the login, the role, ownership and all the rules.
   --------------------------------------------------------------------- */

// Turns a Supabase error into a message a visitor can understand.
function friendlyError(result) {
  const error = result.error;
  if (!error) return "";
  // Our SQL functions raise codes like PT409 with a ready-made message.
  if (String(error.code || "").startsWith("PT")) return error.message;
  if (result.status === 401) return "Please log in to continue.";
  if (result.status === 403) return "You don't have permission to do that.";
  if (result.status === 404) return "We couldn't find that record.";
  if (result.status === 409) return "Someone else just changed this. Please refresh and try again.";
  if (!result.status || /fetch|network/i.test(error.message || "")) {
    return "Can't reach the studio server. Check your connection and try again.";
  }
  return error.message || "Something went wrong. Please try again.";
}

// Calls a database function. Always returns { ok, data, message, status }.
async function callFunction(name, params) {
  try {
    const result = await db.rpc(name, params);
    if (result.error) {
      if (result.status === 401) refreshAuthState(); // session may have expired
      return { ok: false, status: result.status, message: friendlyError(result) };
    }
    return { ok: true, data: result.data };
  } catch (error) {
    return { ok: false, status: 0, message: "Can't reach the studio server. Check your connection and try again." };
  }
}

// Reads rows with a Supabase query. RLS makes sure customers only get their own rows.
async function readRows(query) {
  try {
    const result = await query;
    if (result.error) return { ok: false, message: friendlyError(result) };
    return { ok: true, data: result.data || [] };
  } catch (error) {
    return { ok: false, message: "Can't reach the studio server. Check your connection and try again." };
  }
}

async function loadSettings() {
  if (state.settings) return state.settings;
  const result = await readRows(db.from("studio_settings").select("currency, mural_rate_per_sqft").limit(1));
  if (result.ok && result.data.length > 0) state.settings = result.data[0];
  return state.settings;
}

async function loadPotteryOptions() {
  if (state.potteryItems.length > 0 && state.glazes.length > 0) return { ok: true };
  const [items, glazes] = await Promise.all([
    readRows(db.from("pottery_items").select("id, name").order("id")),
    readRows(db.from("glazes").select("id, name").order("id")),
  ]);
  if (!items.ok) return items;
  if (!glazes.ok) return glazes;
  state.potteryItems = items.data;
  state.glazes = glazes.data;
  return { ok: true };
}

/* ---------------------------------------------------------------------
   5. LOGIN STATE
   Supabase Auth handles passwords and sessions. The ROLE comes from our
   own profiles table, which customers cannot change.
   --------------------------------------------------------------------- */

async function refreshAuthState() {
  const { data } = await db.auth.getSession();
  state.user = data.session ? data.session.user : null;
  state.profile = null;

  if (state.user) {
    const result = await readRows(
      db.from("profiles").select("id, email, full_name, role").eq("id", state.user.id).limit(1)
    );
    state.profile = result.ok && result.data.length > 0 ? result.data[0] : null;
  }

  // The role only changes what we SHOW. The database decides what is ALLOWED.
  document.body.dataset.role = state.profile ? state.profile.role : "guest";
  renderAccountArea();
}

function renderAccountArea() {
  const area = document.getElementById("navAccount");
  if (!state.user) {
    area.innerHTML = `
      <a class="btn btn-small" href="#/login">Log in</a>
      <a class="btn btn-primary btn-small" href="#/signup">Sign up</a>`;
    return;
  }
  const name = (state.profile && state.profile.full_name) || state.user.email;
  const roleLabel = isStudio() ? `<span class="tag tag-cobalt">Studio</span>` : `<span class="tag tag-green">Customer</span>`;
  area.innerHTML = `
    <span class="account-chip"><span>${escapeHtml(name)}</span>${roleLabel}</span>
    <button class="btn btn-small" id="logoutButton">Log out</button>`;
  document.getElementById("logoutButton").addEventListener("click", logOut);
}

async function logOut() {
  await db.auth.signOut();
  await refreshAuthState();
  showToast("You're logged out. See you soon!", "info");
  location.hash = "#/";
}

// Pages for customers call this first. Returns false (and shows a friendly
// panel) when the visitor is logged out or is the studio account.
function guardCustomerPage(pageName) {
  if (!state.user) {
    appEl.innerHTML = `<div class="container section">${stateBlock({
      icon: "🔒", variant: "state-locked", title: `Log in to see ${pageName}`,
      text: "Your orders, bookings and requests are private to your account.",
      actions: `<a class="btn btn-primary" href="#/login?next=${encodeURIComponent(currentPath())}">Log in</a>
                <a class="btn" href="#/signup">Create an account</a>`,
    })}</div>`;
    return false;
  }
  if (!isCustomer()) {
    appEl.innerHTML = `<div class="container section">${stateBlock({
      icon: "✦", variant: "state-locked", title: "This page is for customers",
      text: "You're signed in as the studio. Manage everything from the dashboard.",
      actions: `<a class="btn btn-primary" href="#/admin">Open studio dashboard</a>`,
    })}</div>`;
    return false;
  }
  return true;
}

/* ---------------------------------------------------------------------
   6. ROUTER — "#/paintings" shows the paintings page, and so on.
   --------------------------------------------------------------------- */
const routes = {
  "/": renderHomePage,
  "/paintings": renderPaintingsPage,
  "/orders": renderOrdersPage,
  "/murals": renderMuralsPage,
  "/pottery": renderPotteryPage,
  "/login": renderLoginPage,
  "/signup": renderSignupPage,
  "/admin": renderAdminPage,
};

function currentPath() {
  return (location.hash.replace(/^#/, "").split("?")[0]) || "/";
}

async function renderCurrentRoute() {
  const path = currentPath();
  stopHeroTimer(); // the home carousel only runs on the home page
  closeMobileNav();
  document.querySelectorAll(".main-nav a[data-route]").forEach((link) => {
    link.classList.toggle("active", link.dataset.route === path);
  });
  window.scrollTo(0, 0);

  if (!db) {
    renderSetupNeeded();
    return;
  }
  const renderPage = routes[path] || renderNotFoundPage;
  await renderPage();
}

function renderSetupNeeded() {
  appEl.innerHTML = `<div class="container section">${stateBlock({
    icon: "⚙", variant: "state-locked", title: "Connect your Supabase project",
    text: window.supabase
      ? "config.js is missing or still has placeholder values. Fill in .env and run: node scripts/generate-config.js (see README)."
      : "The Supabase library could not be loaded. Check your internet connection and reload.",
  })}</div>`;
}

function renderNotFoundPage() {
  appEl.innerHTML = `<div class="container section">${stateBlock({
    icon: "?", title: "Page not found", text: "That page doesn't exist.",
    actions: `<a class="btn btn-primary" href="#/">Go home</a>`,
  })}</div>`;
}

function closeMobileNav() {
  document.getElementById("mainNav").classList.remove("is-open");
  document.getElementById("navToggle").setAttribute("aria-expanded", "false");
}

/* ---------------------------------------------------------------------
   7a. HOME PAGE
   --------------------------------------------------------------------- */

// "Madhubani style. Natural pigments…" -> "Madhubani". Used as a museum-style label.
function paintingTradition(painting) {
  const match = /^(.+?) style\b/i.exec(painting.description || "");
  return match ? match[1] : "Original work";
}

// Three ways in, shown as white cards over a painting on the home page.
const HOME_WAYS = [
  { title: "Collect", text: "Bring home an original folk painting — one of a kind, never printed, chosen slowly." },
  { title: "Commission", text: "Invite a painter to your home for a day and watch a bare wall bloom into a mural." },
  { title: "Create", text: "Pick a clay form and a glaze you love; we throw, dry and fire it just for you." },
];

// The four rounded picture cards in the sage "Wander through the studio" section.
const HOME_ROOMS = [
  { label: "Original paintings", link: "#/paintings", image: "images/p-003.jpg", alt: "Tanjore Lakshmi with Gold Leaf by Revathi Iyer" },
  { label: "Hand-painted murals", link: "#/murals", image: "images/p-007.jpg", alt: "Cheriyal Panel: Bonalu Procession by Ramesh Naidu" },
  { label: "Custom pottery", link: "#/pottery", image: "", alt: "" },
  { label: "Your collection", link: "#/orders", image: "images/p-010.jpg", alt: "Nirmal-Style Court Musicians by Lakshmi Prasad" },
];

async function renderHomePage() {
  const ribbon = `<span>Paintings</span><i>✿</i><span>Murals</span><i>✿</i><span>Pottery</span><i>✿</i><span>Folk art house</span><i>✿</i>`;
  appEl.innerHTML = `
    <section class="hero">
      <div class="hero-stage" id="heroStage">
        <div class="hero-strip" id="heroStrip" aria-roledescription="carousel" aria-label="Paintings from the studio"></div>
        <!-- Invisible side zones: hover one and a small arrow appears; click to slide -->
        <button class="hero-nav prev" data-action="hero-step" data-step="-1" aria-label="Previous painting"><span aria-hidden="true">‹</span></button>
        <button class="hero-nav next" data-action="hero-step" data-step="1" aria-label="Next painting"><span aria-hidden="true">›</span></button>
      </div>
      <div class="hero-text">
        <h1 class="hero-title">Art that feels like a slow morning</h1>
        <p>Step into Chitrashala, a gentle house of Indian folk art made for slow looking.</p>
        <p>Here, original paintings, hand-painted murals and kiln-fired pottery are waiting to become part of your home.</p>
        <a class="btn btn-outline" href="#/paintings">Begin exploring</a>
      </div>
    </section>

    <div class="ribbon" aria-hidden="true"><div class="ribbon-track">${ribbon.repeat(6)}</div></div>

    <section class="ways" style="--ways-image: url('images/p-012.jpg')">
      <h2 class="ways-title">Three Ways To Bring Art Home</h2>
      <div class="ways-grid">
        ${HOME_WAYS.map((way) => `<div class="way-card"><h3>${way.title}</h3><p>${way.text}</p></div>`).join("")}
      </div>
    </section>

    <section class="section container">
      <h2 class="section-title center">Which painting calls to you?</h2>
      <div id="featuredArea"><div class="skeleton feature-skeleton" aria-busy="true"><span class="sr-only">Loading…</span></div></div>
    </section>

    <section class="rooms">
      <div class="container">
        <h2 class="section-title center light">Wander Through The Studio</h2>
        <div class="room-grid">
          ${HOME_ROOMS.map((room) => `
            <a class="room-card" href="${room.link}">
              <div class="room-img${room.image ? "" : " is-kiln"}">
                ${room.image ? `<img src="${room.image}" alt="${escapeHtml(room.alt)}" loading="lazy" data-fallback-title="${escapeHtml(room.label)}">` : potteryIcon("i-02")}
              </div>
              <span class="room-label"><i aria-hidden="true">✿</i> ${room.label}</span>
            </a>`).join("")}
        </div>
      </div>
    </section>`;

  state.heroIndex = 0;
  renderHeroStrip();
  startHeroTimer();
  const stage = document.getElementById("heroStage");
  stage.addEventListener("mouseenter", stopHeroTimer);   // pause while the visitor is looking
  stage.addEventListener("mouseleave", startHeroTimer);

  const area = document.getElementById("featuredArea");
  const result = await readRows(
    db.from("paintings").select("id, title, artist, description, price, image_url, status")
      .eq("status", "available").order("id").limit(6)
  );
  if (!document.body.contains(area)) return; // the visitor moved to another page
  if (!result.ok) {
    area.innerHTML = errorBlock(result.message);
  } else if (result.data.length === 0) {
    area.innerHTML = stateBlock({ title: "The walls are resting", text: "New works are being framed. Come back soon." });
  } else {
    state.featured = result.data;
    state.featureIndex = 0;
    renderFeature();
  }
}

// Real seed paintings that slide through the hero, three at a time.
const HERO_SLIDES = [
  { image: "images/p-006.jpg", title: "Gond Forest Spirits", artist: "Mohan Markam" },
  { image: "images/p-001.jpg", title: "Madhubani Peacock Garden", artist: "Meera Kumari" },
  { image: "images/p-008.jpg", title: "Rajasthani Miniature: Courtyard at Dusk", artist: "Kishan Singh Rathore" },
  { image: "images/p-005.jpg", title: "Kalamkari Tree of Life", artist: "Padma Reddy" },
  { image: "images/p-003.jpg", title: "Tanjore Lakshmi with Gold Leaf", artist: "Revathi Iyer" },
  { image: "images/p-007.jpg", title: "Cheriyal Panel: Bonalu Procession", artist: "Ramesh Naidu" },
  { image: "images/p-010.jpg", title: "Nirmal-Style Court Musicians", artist: "Lakshmi Prasad" },
];
let heroTimer = null;

// Draws the previous, current and next painting; the middle one is the star.
function renderHeroStrip() {
  const strip = document.getElementById("heroStrip");
  if (!strip) return;
  const count = HERO_SLIDES.length;
  const slideAt = (offset) => HERO_SLIDES[(state.heroIndex + offset + count) % count];
  const img = (slide, extra) =>
    `<img ${extra} src="${slide.image}" alt="${escapeHtml(slide.title)} by ${escapeHtml(slide.artist)}" data-fallback-title="${escapeHtml(slide.title)}">`;
  const current = slideAt(0);
  strip.innerHTML = `
    ${img(slideAt(-1), 'class="hero-side"')}
    <figure class="hero-main">
      ${img(current, "")}
      <figcaption>${escapeHtml(current.title)} · ${escapeHtml(current.artist)}</figcaption>
      <span class="flower-badge" aria-hidden="true">✿</span>
    </figure>
    ${img(slideAt(1), 'class="hero-side"')}`;
}

// Moves to the next painting every few seconds (skipped if the visitor prefers less motion).
function startHeroTimer() {
  stopHeroTimer();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  heroTimer = setInterval(() => {
    if (!document.getElementById("heroStrip")) return stopHeroTimer();
    state.heroIndex = (state.heroIndex + 1) % HERO_SLIDES.length;
    renderHeroStrip();
  }, 4500);
}

function stopHeroTimer() {
  clearInterval(heroTimer);
  heroTimer = null;
}

function stepHero(button) {
  const count = HERO_SLIDES.length;
  state.heroIndex = (state.heroIndex + Number(button.dataset.step) + count) % count;
  renderHeroStrip();
  startHeroTimer(); // restart the countdown after a manual click
}

// The "Which painting calls to you?" slider: one painting at a time, live from the database.
function renderFeature() {
  const area = document.getElementById("featuredArea");
  if (!area) return;
  const painting = state.featured[state.featureIndex];
  area.innerHTML = `
    <div class="feature">
      <button class="arrow" data-action="feature-step" data-step="-1" aria-label="Previous painting">‹</button>
      <article class="feature-card">
        <div class="feature-img">${paintingImage(painting)}</div>
        <div class="feature-text">
          <p class="eyebrow">${escapeHtml(paintingTradition(painting))}</p>
          <h3>${escapeHtml(painting.title)}</h3>
          <p>by ${escapeHtml(painting.artist)}</p>
          <p class="feature-desc">${escapeHtml(painting.description)}</p>
          <p class="feature-price">${formatMoney(painting.price)}</p>
          <a class="btn btn-butter" href="#/paintings">View in gallery</a>
        </div>
      </article>
      <button class="arrow" data-action="feature-step" data-step="1" aria-label="Next painting">›</button>
    </div>
    <div class="dots" role="group" aria-label="Choose a painting">
      ${state.featured.map((p, index) => `<button class="dot" data-action="feature-go" data-index="${index}"
          aria-label="Show ${escapeHtml(p.title)}" aria-pressed="${index === state.featureIndex}"></button>`).join("")}
    </div>`;
}

function stepFeature(button) {
  const count = state.featured.length;
  state.featureIndex = (state.featureIndex + Number(button.dataset.step) + count) % count;
  renderFeature();
}

function goToFeature(button) {
  state.featureIndex = Number(button.dataset.index);
  renderFeature();
}

/* ---------------------------------------------------------------------
   7b. PAINTINGS CATALOGUE
   --------------------------------------------------------------------- */
async function renderPaintingsPage() {
  appEl.innerHTML = `
    <section class="container page-head gallery-head">
      <p class="script-label">Our collection</p>
      <h1 class="page-title">The <em>Gallery</em></h1>
      <p class="lede">Every work on these walls is the only one of its kind. Once it's collected, it's gone —
        unless the collector changes their mind.</p>
      <div class="gallery-filters" role="group" aria-label="Filter paintings">
        ${["all", "available", "sold"].map((filter) => `
          <button class="pill" data-action="filter-paintings" data-filter="${filter}"
            aria-pressed="${state.paintingFilter === filter}">${filter[0].toUpperCase() + filter.slice(1)} <sup data-count="${filter}"></sup></button>`).join("")}
      </div>
    </section>
    <section class="container">
      <div id="galleryArea">${skeletonGallery(6)}</div>
    </section>`;
  await loadAndRenderGallery();
}

async function loadAndRenderGallery() {
  const result = await readRows(
    db.from("paintings").select("id, title, artist, description, price, image_url, status").order("id")
  );
  const area = document.getElementById("galleryArea");
  if (!area) return; // the visitor already moved to another page
  if (!result.ok) {
    area.innerHTML = errorBlock(result.message);
    return;
  }
  state.paintings = result.data;
  renderGallery();
}

function renderGallery() {
  const area = document.getElementById("galleryArea");
  document.querySelectorAll("sup[data-count]").forEach((sup) => {
    const filter = sup.dataset.count;
    sup.textContent = state.paintings.filter((p) => filter === "all" || p.status === filter).length;
  });
  const visible = state.paintings.filter((p) => state.paintingFilter === "all" || p.status === state.paintingFilter);

  if (state.paintings.length === 0) {
    area.innerHTML = stateBlock({ title: "No paintings yet", text: "The studio hasn't added any paintings. Check back soon!" });
    return;
  }
  if (visible.length === 0) {
    area.innerHTML = stateBlock({
      title: `No ${state.paintingFilter} paintings`, text: "Try another filter.",
      actions: `<button class="btn" data-action="filter-paintings" data-filter="all">Show all</button>`,
    });
    return;
  }
  area.innerHTML = `<div class="gallery">${visible.map(paintingCard).join("")}</div>`;
}

function paintingCard(painting) {
  const isSold = painting.status === "sold";
  const longText = painting.description.length > 140;
  return `
    <article class="art-card ${isSold ? "is-sold" : ""}">
      <div class="art-frame">
        ${isSold ? `<span class="tag tag-coral art-flag">Sold</span>` : `<span class="tag tag-green art-flag">Available</span>`}
        ${paintingImage(painting)}
      </div>
      <div class="art-meta">
        <div style="min-width:0">
          <p class="art-label">${escapeHtml(paintingTradition(painting))}</p>
          <h2 class="art-title">${escapeHtml(painting.title)}</h2>
          <p class="art-artist">by ${escapeHtml(painting.artist)}</p>
        </div>
        <span class="art-price">${formatMoney(painting.price)}</span>
      </div>
      <p class="art-desc" id="desc-${escapeHtml(painting.id)}">${escapeHtml(painting.description)}</p>
      ${longText ? `<button class="link-btn" data-action="toggle-desc" data-id="${escapeHtml(painting.id)}" aria-expanded="false">Read more</button>` : ""}
      <div class="art-actions">${paintingActions(painting)}</div>
    </article>`;
}

// Which button a painting shows depends on who is looking. (The database
// still re-checks everything when the button is pressed.)
function paintingActions(painting) {
  const price = formatMoney(painting.price);
  if (painting.status === "sold") {
    return `<button class="btn" disabled>Sold</button><span class="art-note">This piece has found its home.</span>`;
  }
  if (!state.user) {
    return `<a class="btn btn-primary" href="#/login?next=/paintings">Log in to buy</a>`;
  }
  if (isStudio()) {
    return `<a class="btn" href="#/admin">Edit in dashboard</a><span class="art-note">Studio accounts can't buy.</span>`;
  }
  return `<button class="btn btn-primary" data-action="buy" data-id="${escapeHtml(painting.id)}">Buy for ${price}</button>`;
}

// THE PURCHASE FLOW: button click -> confirm -> database function
// purchase_painting -> it atomically marks the painting sold and creates
// the order (or fails with "already sold") -> we refresh the gallery.
async function handleBuy(button) {
  const painting = state.paintings.find((p) => p.id === button.dataset.id);
  if (!painting) return;
  const confirmed = await confirmAction({
    title: "Make it yours?",
    message: `"${painting.title}" by ${painting.artist} for ${formatMoney(painting.price)}. You can cancel later from My orders.`,
    confirmLabel: `Buy for ${formatMoney(painting.price)}`,
  });
  if (!confirmed) return;

  setBusy(button, true);
  // We send ONLY the painting id. The price and buyer come from the database.
  const result = await callFunction("purchase_painting", { p_painting_id: painting.id });
  setBusy(button, false);

  if (result.ok) {
    showToast(`Collected. "${painting.title}" now hangs in your collection.`, "success");
  } else {
    showToast(result.message, "error");
  }
  await loadAndRenderGallery(); // show the latest sold/available status either way
}

/* ---------------------------------------------------------------------
   7c. MY ORDERS
   --------------------------------------------------------------------- */
async function renderOrdersPage() {
  if (!guardCustomerPage("your orders")) return;
  appEl.innerHTML = `
    <section class="container page-head">
      <p class="eyebrow">My orders</p>
      <h1 class="page-title">Your <em>collection</em></h1>
      <p class="lede">The works you've brought home. Change your mind, and the piece quietly returns to the gallery wall.</p>
    </section>
    <section class="container"><div id="ordersArea">${skeletonList(3)}</div></section>`;
  await loadAndRenderOrders();
}

async function loadAndRenderOrders() {
  // RLS policy: a customer only ever receives THEIR OWN orders here.
  const result = await readRows(
    db.from("orders")
      .select("id, status, price, created_at, cancelled_at, painting:paintings(id, title, artist, image_url)")
      .order("created_at", { ascending: false })
  );
  const area = document.getElementById("ordersArea");
  if (!area) return;
  if (!result.ok) {
    area.innerHTML = errorBlock(result.message);
    return;
  }
  if (result.data.length === 0) {
    area.innerHTML = stateBlock({
      icon: "✦", title: "Nothing collected yet", text: "Your first original is waiting in the gallery.",
      actions: `<a class="btn btn-primary" href="#/paintings">Browse the gallery</a>`,
    });
    return;
  }
  area.innerHTML = `<ul class="record-list">${result.data.map(orderRecord).join("")}</ul>`;
}

function orderRecord(order) {
  const painting = order.painting || { title: "Painting", artist: "", image_url: "" };
  const actions = order.status === "placed"
    ? `<button class="btn btn-small btn-coral" data-action="cancel-order" data-id="${order.id}">Cancel order</button>`
    : `<p class="record-note">Cancelled ${escapeHtml(formatDateTime(order.cancelled_at))}</p>`;
  return `
    <li class="record">
      <div class="record-thumb">${paintingImage(painting)}</div>
      <div>
        <h3 class="record-title">${escapeHtml(painting.title)}</h3>
        <p class="record-meta">
          <span>by ${escapeHtml(painting.artist)}</span>
          <strong>${formatMoney(order.price)}</strong>
          <span>Ordered ${escapeHtml(formatDateTime(order.created_at))}</span>
          ${statusBadge(order.status)}
        </p>
      </div>
      <div class="record-actions">${actions}</div>
    </li>`;
}

async function handleCancelOrder(button) {
  const confirmed = await confirmAction({
    title: "Cancel this order?",
    message: "The painting goes back on sale, and someone else may buy it.",
    confirmLabel: "Yes, cancel order",
  });
  if (!confirmed) return;
  setBusy(button, true);
  const result = await callFunction("cancel_order", { p_order_id: button.dataset.id });
  setBusy(button, false);
  showToast(result.ok ? "Order cancelled. The painting is available again." : result.message, result.ok ? "success" : "error");
  await loadAndRenderOrders();
}

/* ---------------------------------------------------------------------
   7d. WALL MURAL BOOKINGS (form + live price + history)
   --------------------------------------------------------------------- */
async function renderMuralsPage() {
  const today = todayInStudio();
  const minDate = addDays(today, MURAL_RULES.minDaysAhead);
  const maxDate = addDays(today, MURAL_RULES.maxDaysAhead);

  appEl.innerHTML = `
    <section class="container page-head">
      <p class="eyebrow">Chapter II · The Wall</p>
      <h1 class="page-title">Commission a <em>wall</em></h1>
      <p class="lede">One painter, one day, one home. Choose a date between a week and three months away —
        each day on our calendar belongs to a single wall.</p>
    </section>
    <section class="container split">
      <form class="form-card form-grid" id="bookingForm" novalidate>
        <h2>Reserve a painting day</h2>
        <div class="field">
          <label for="bookingDate">Painting date</label>
          <input class="input" type="date" id="bookingDate" min="${minDate}" max="${maxDate}" required aria-describedby="bookingDateHint bookingDateError">
          <p class="field-hint" id="bookingDateHint">Between ${formatDate(minDate)} and ${formatDate(maxDate)}.</p>
          <p class="field-error" id="bookingDateError"></p>
          <div id="bookedDatesArea"></div>
        </div>
        <div class="field">
          <label for="wallSize">Wall size (square feet)</label>
          <input class="input" type="number" id="wallSize" min="${MURAL_RULES.minSize}" max="${MURAL_RULES.maxSize}" step="0.01" inputmode="decimal" placeholder="e.g. 120" required aria-describedby="wallSizeHint wallSizeError">
          <p class="field-hint" id="wallSizeHint">From ${MURAL_RULES.minSize} to ${MURAL_RULES.maxSize} sq ft. Width × height of the wall.</p>
          <p class="field-error" id="wallSizeError"></p>
        </div>
        <div class="field">
          <label for="wallAddress">Address of the wall</label>
          <textarea class="textarea" id="wallAddress" maxlength="500" placeholder="House / flat, street, area, city, PIN" required aria-describedby="wallAddressError"></textarea>
          <p class="field-error" id="wallAddressError"></p>
        </div>
        <p class="form-message" id="bookingMessage" hidden></p>
        <div id="bookingSubmitArea"></div>
      </form>

      <aside class="calc" aria-live="polite">
        <span class="tag tag-butter">Your estimate</span>
        <p class="calc-total" id="calcTotal">—</p>
        <p class="calc-sum" id="calcSum">Enter a wall size to see your price.</p>
        <ul class="calc-list">
          <li>Rate: <strong id="calcRate">loading…</strong> per sq ft</li>
          <li>Free cancellation until 3 days before</li>
          <li>The studio confirms every booking</li>
        </ul>
      </aside>
    </section>
    <section class="container section" id="bookingHistorySection"></section>`;

  renderBookingSubmitArea();
  document.getElementById("wallSize").addEventListener("input", updatePriceCalculator);
  document.getElementById("bookingDate").addEventListener("change", checkChosenDate);
  document.getElementById("bookingForm").addEventListener("submit", handleBookingSubmit);

  const settings = await loadSettings();
  const rateEl = document.getElementById("calcRate");
  if (rateEl) rateEl.textContent = settings ? formatMoney(settings.mural_rate_per_sqft) : "unavailable";
  updatePriceCalculator();

  if (isCustomer()) {
    loadBookedDates();
    document.getElementById("bookingHistorySection").innerHTML = `
      <h2 class="section-title">Your <span class="script">bookings</span></h2><div id="bookingsArea">${skeletonList(2)}</div>`;
    await loadAndRenderBookings();
  }
}

function renderBookingSubmitArea() {
  const area = document.getElementById("bookingSubmitArea");
  if (!state.user) {
    area.innerHTML = `<a class="btn btn-primary btn-block" href="#/login?next=/murals">Log in to book</a>`;
  } else if (isStudio()) {
    area.innerHTML = `<p class="form-message is-info">Studio accounts manage bookings from the <a href="#/admin">dashboard</a>.</p>`;
  } else {
    area.innerHTML = `<button class="btn btn-primary btn-block" type="submit" id="bookingSubmit">Reserve this date</button>`;
  }
}

// Live preview only — the database recalculates the real price itself.
function updatePriceCalculator() {
  const totalEl = document.getElementById("calcTotal");
  const sumEl = document.getElementById("calcSum");
  if (!totalEl || !state.settings) return;
  const rate = Number(state.settings.mural_rate_per_sqft);
  const size = Number(document.getElementById("wallSize").value);
  if (!size || size < MURAL_RULES.minSize || size > MURAL_RULES.maxSize) {
    totalEl.textContent = "—";
    sumEl.textContent = `Enter a size between ${MURAL_RULES.minSize} and ${MURAL_RULES.maxSize} sq ft.`;
    return;
  }
  const roundedSize = Math.round(size * 100) / 100;
  totalEl.textContent = formatMoney(Math.round(rate * roundedSize * 100) / 100);
  sumEl.textContent = `${roundedSize} sq ft × ${formatMoney(rate)}`;
}

async function loadBookedDates() {
  const result = await callFunction("booked_wall_dates", {});
  state.bookedDates = result.ok ? result.data : [];
  const area = document.getElementById("bookedDatesArea");
  if (!area || state.bookedDates.length === 0) return;
  area.innerHTML = `<p class="field-hint">Already booked:</p>
    <div class="date-chips">${state.bookedDates.map((d) => `<span class="date-chip">${escapeHtml(formatDate(d))}</span>`).join("")}</div>`;
}

function checkChosenDate() {
  const value = document.getElementById("bookingDate").value;
  fieldError("bookingDate", state.bookedDates.includes(value) ? "That date is already booked. Please choose another date." : "");
}

// Quick checks in the browser for instant feedback. The database repeats them.
function validateBookingForm() {
  const today = todayInStudio();
  const date = document.getElementById("bookingDate").value;
  const size = Number(document.getElementById("wallSize").value);
  const address = document.getElementById("wallAddress").value.trim();
  let isValid = true;

  const daysAhead = date ? daysBetween(today, date) : NaN;
  if (!date) {
    fieldError("bookingDate", "Please choose a date.");
    isValid = false;
  } else if (daysAhead < MURAL_RULES.minDaysAhead || daysAhead > MURAL_RULES.maxDaysAhead) {
    fieldError("bookingDate", "Please choose a date between 7 and 90 days from today.");
    isValid = false;
  } else if (state.bookedDates.includes(date)) {
    fieldError("bookingDate", "That date is already booked. Please choose another date.");
    isValid = false;
  } else {
    fieldError("bookingDate", "");
  }

  if (!size || size < MURAL_RULES.minSize || size > MURAL_RULES.maxSize) {
    fieldError("wallSize", `Wall size must be between ${MURAL_RULES.minSize} and ${MURAL_RULES.maxSize} sq ft.`);
    isValid = false;
  } else {
    fieldError("wallSize", "");
  }

  if (address.length < 5) {
    fieldError("wallAddress", "Please enter the full wall address.");
    isValid = false;
  } else {
    fieldError("wallAddress", "");
  }
  return isValid ? { date, size, address } : null;
}

async function handleBookingSubmit(event) {
  event.preventDefault();
  formMessage("bookingMessage", "");
  const values = validateBookingForm();
  if (!values) return;

  const button = document.getElementById("bookingSubmit");
  setBusy(button, true);
  // No price is sent: the database multiplies the size by the seeded rate.
  const result = await callFunction("create_wall_booking", {
    p_booking_date: values.date, p_wall_size_sqft: values.size, p_address: values.address,
  });
  setBusy(button, false);

  if (!result.ok) {
    if (result.status === 409) fieldError("bookingDate", result.message);
    formMessage("bookingMessage", result.message, "error");
    loadBookedDates();
    return;
  }
  document.getElementById("bookingForm").reset();
  updatePriceCalculator();
  formMessage("bookingMessage",
    `Requested for ${formatDate(result.data.booking_date)} — total ${formatMoney(result.data.total_price)}. The studio will confirm soon.`, "success");
  showToast("Booking requested!", "success");
  loadBookedDates();
  await loadAndRenderBookings();
}

async function loadAndRenderBookings() {
  const result = await readRows(
    db.from("wall_bookings")
      .select("id, booking_date, wall_size_sqft, address, total_price, status, created_at")
      .order("booking_date", { ascending: false })
  );
  const area = document.getElementById("bookingsArea");
  if (!area) return;
  if (!result.ok) {
    area.innerHTML = errorBlock(result.message);
    return;
  }
  if (result.data.length === 0) {
    area.innerHTML = stateBlock({ icon: "✦", title: "No walls booked yet", text: "Reserve your first painting day with the form above." });
    return;
  }
  area.innerHTML = `<ul class="record-list">${result.data.map(bookingRecord).join("")}</ul>`;
}

function dateThumb(isoDate) {
  const date = new Date(isoDate + "T00:00:00Z");
  const day = date.getUTCDate();
  const month = date.toLocaleDateString("en-IN", { timeZone: "UTC", month: "short" });
  return `<div class="record-thumb is-date">${day}<small>${escapeHtml(month)}</small></div>`;
}

function bookingRecord(booking) {
  const lastCancelDay = addDays(booking.booking_date, -MURAL_RULES.cancelDaysBefore);
  const isActive = booking.status === "requested" || booking.status === "confirmed";
  const canCancel = isActive && todayInStudio() <= lastCancelDay;
  let actions = "";
  if (canCancel) {
    actions = `<button class="btn btn-small btn-coral" data-action="cancel-booking" data-id="${booking.id}">Cancel booking</button>
               <p class="record-note">Free cancellation until ${escapeHtml(formatDate(lastCancelDay))}</p>`;
  } else if (isActive) {
    actions = `<p class="record-note">Cancellation closed on ${escapeHtml(formatDate(lastCancelDay))}</p>`;
  }
  return `
    <li class="record">
      ${dateThumb(booking.booking_date)}
      <div>
        <h3 class="record-title">${escapeHtml(formatDate(booking.booking_date))} · ${Number(booking.wall_size_sqft)} sq ft</h3>
        <p class="record-meta">
          <strong>${formatMoney(booking.total_price)}</strong>
          <span>${escapeHtml(booking.address)}</span>
          ${statusBadge(booking.status)}
        </p>
      </div>
      <div class="record-actions">${actions}</div>
    </li>`;
}

async function handleCancelBooking(button) {
  const confirmed = await confirmAction({
    title: "Cancel this booking?", message: "The date will be released for other customers.", confirmLabel: "Yes, cancel booking",
  });
  if (!confirmed) return;
  setBusy(button, true);
  const result = await callFunction("cancel_wall_booking", { p_booking_id: button.dataset.id });
  setBusy(button, false);
  showToast(result.ok ? "Booking cancelled." : result.message, result.ok ? "success" : "error");
  loadBookedDates();
  await loadAndRenderBookings();
}

/* ---------------------------------------------------------------------
   7e. CUSTOM POTTERY (form with item cards + glaze swatches + history)
   --------------------------------------------------------------------- */
async function renderPotteryPage() {
  state.editingPotteryId = null;
  appEl.innerHTML = `
    <section class="container page-head">
      <p class="eyebrow">Chapter III · The Kiln</p>
      <h1 class="page-title">From the <em>kiln</em></h1>
      <p class="lede">Pick a form and a glaze, then tell us how many and by when. Clay keeps its own time —
        allow us at least two weeks to throw, dry and fire.</p>
    </section>
    <section class="container"><div id="potteryFormArea">${skeletonList(2)}</div></section>
    <section class="container section" id="potteryHistorySection"></section>`;

  const options = await loadPotteryOptions();
  const formArea = document.getElementById("potteryFormArea");
  if (!formArea) return;
  if (!options.ok) {
    formArea.innerHTML = errorBlock(options.message);
    return;
  }
  if (state.potteryItems.length === 0 || state.glazes.length === 0) {
    formArea.innerHTML = stateBlock({ title: "Pottery menu not loaded", text: "The studio hasn't imported pottery items and glazes yet (run supabase/seed.sql)." });
    return;
  }
  formArea.innerHTML = potteryFormHtml();
  setupPotteryForm();

  if (isCustomer()) {
    document.getElementById("potteryHistorySection").innerHTML = `
      <h2 class="section-title">Your <span class="script">requests</span></h2><div id="potteryArea">${skeletonList(2)}</div>`;
    await loadAndRenderPottery();
  }
}

function potteryFormHtml() {
  const minDate = addDays(todayInStudio(), POTTERY_RULES.minDaysAhead);
  return `
    <form class="form-card form-grid" id="potteryForm" novalidate>
      <h2 id="potteryFormTitle">Place an order</h2>
      <fieldset class="field" style="border:0;padding:0;margin:0">
        <legend class="label">1. Choose a piece</legend>
        <div class="choice-grid">
          ${state.potteryItems.map((item, index) => `
            <label class="choice">
              <input type="radio" name="potteryItem" value="${escapeHtml(item.id)}" ${index === 0 ? "checked" : ""}>
              <span class="choice-card">${potteryIcon(item.id)}${escapeHtml(item.name)}</span>
            </label>`).join("")}
        </div>
      </fieldset>
      <fieldset class="field" style="border:0;padding:0;margin:0">
        <legend class="label">2. Pick a glaze — <span id="glazeName"></span></legend>
        <div class="swatches">
          ${state.glazes.map((glaze, index) => `
            <label class="swatch">
              <input type="radio" name="potteryGlaze" value="${escapeHtml(glaze.id)}" data-name="${escapeHtml(glaze.name)}" ${index === 0 ? "checked" : ""}>
              <span class="swatch-label"><span class="swatch-dot" style="--glaze:${GLAZE_COLOURS[glaze.id] || "#999"}"></span>${escapeHtml(glaze.name)}</span>
            </label>`).join("")}
        </div>
      </fieldset>
      <div class="form-row">
        <div class="field">
          <label for="potteryQuantity">3. How many?</label>
          <div class="stepper">
            <button type="button" data-action="quantity-step" data-step="-1" aria-label="One fewer">−</button>
            <input type="number" id="potteryQuantity" value="1" min="1" max="12" inputmode="numeric" aria-describedby="potteryQuantityError">
            <button type="button" data-action="quantity-step" data-step="1" aria-label="One more">+</button>
          </div>
          <p class="field-hint">From 1 to 12 pieces.</p>
          <p class="field-error" id="potteryQuantityError"></p>
        </div>
        <div class="field">
          <label for="potteryNeededBy">4. Needed by</label>
          <input class="input" type="date" id="potteryNeededBy" min="${minDate}" required aria-describedby="potteryNeededByHint potteryNeededByError">
          <p class="field-hint" id="potteryNeededByHint">${formatDate(minDate)} or later.</p>
          <p class="field-error" id="potteryNeededByError"></p>
        </div>
      </div>
      <div class="field">
        <label for="potteryNotes">Notes (optional)</label>
        <textarea class="textarea" id="potteryNotes" maxlength="500" placeholder="Sizes, names to paint, occasion…"></textarea>
      </div>
      <p class="form-message" id="potteryMessage" hidden></p>
      <div class="hero-actions" style="margin-top:0" id="potterySubmitArea"></div>
    </form>`;
}

function setupPotteryForm() {
  const area = document.getElementById("potterySubmitArea");
  if (!state.user) {
    area.innerHTML = `<a class="btn btn-primary" href="#/login?next=/pottery">Log in to request</a>`;
  } else if (isStudio()) {
    area.innerHTML = `<p class="form-message is-info">Studio accounts review requests from the <a href="#/admin">dashboard</a>.</p>`;
  } else {
    area.innerHTML = `
      <button class="btn btn-primary" type="submit" id="potterySubmit">Send to the kiln</button>
      <button class="btn btn-ghost" type="button" data-action="stop-editing" id="stopEditing" hidden>Stop editing</button>`;
  }
  const form = document.getElementById("potteryForm");
  form.addEventListener("submit", handlePotterySubmit);
  form.addEventListener("change", updateGlazeName);
  updateGlazeName();
}

function updateGlazeName() {
  const checked = document.querySelector('input[name="potteryGlaze"]:checked');
  const label = document.getElementById("glazeName");
  if (checked && label) label.textContent = checked.dataset.name;
}

function readPotteryForm() {
  const item = document.querySelector('input[name="potteryItem"]:checked');
  const glaze = document.querySelector('input[name="potteryGlaze"]:checked');
  const quantity = Number(document.getElementById("potteryQuantity").value);
  const neededBy = document.getElementById("potteryNeededBy").value;
  const notes = document.getElementById("potteryNotes").value.trim();
  let isValid = true;

  if (!Number.isInteger(quantity) || quantity < POTTERY_RULES.minQuantity || quantity > POTTERY_RULES.maxQuantity) {
    fieldError("potteryQuantity", "Quantity must be a whole number from 1 to 12.");
    isValid = false;
  } else {
    fieldError("potteryQuantity", "");
  }
  if (!neededBy || daysBetween(todayInStudio(), neededBy) < POTTERY_RULES.minDaysAhead) {
    fieldError("potteryNeededBy", "The needed-by date must be at least 14 days from today.");
    isValid = false;
  } else {
    fieldError("potteryNeededBy", "");
  }
  if (!item || !glaze) {
    formMessage("potteryMessage", "Please choose a piece and a glaze.", "error");
    isValid = false;
  }
  return isValid ? { itemId: item.value, glazeId: glaze.value, quantity, neededBy, notes } : null;
}

async function handlePotterySubmit(event) {
  event.preventDefault();
  formMessage("potteryMessage", "");
  const values = readPotteryForm();
  if (!values) return;

  const params = {
    p_item_id: values.itemId, p_glaze_id: values.glazeId, p_quantity: values.quantity,
    p_needed_by: values.neededBy, p_notes: values.notes,
  };
  const isEditing = Boolean(state.editingPotteryId);
  if (isEditing) params.p_request_id = state.editingPotteryId;

  const button = document.getElementById("potterySubmit");
  setBusy(button, true);
  const result = await callFunction(isEditing ? "update_pottery_request" : "create_pottery_request", params);
  setBusy(button, false);

  if (!result.ok) {
    formMessage("potteryMessage", result.message, "error");
    if (result.status === 404 || result.status === 409) await loadAndRenderPottery();
    return;
  }
  showToast(isEditing ? "Request updated." : "Request sent! The studio will reply soon.", "success");
  resetPotteryForm();
  await loadAndRenderPottery();
}

function resetPotteryForm() {
  state.editingPotteryId = null;
  document.getElementById("potteryForm").reset();
  document.getElementById("potteryFormTitle").textContent = "Place an order";
  document.getElementById("potterySubmit").textContent = "Send to the kiln";
  document.getElementById("stopEditing").hidden = true;
  formMessage("potteryMessage", "");
  updateGlazeName();
}

async function loadAndRenderPottery() {
  const result = await readRows(
    db.from("pottery_requests")
      .select("id, item_id, glaze_id, quantity, needed_by, notes, status, created_at, item:pottery_items(name), glaze:glazes(name)")
      .order("created_at", { ascending: false })
  );
  const area = document.getElementById("potteryArea");
  if (!area) return;
  if (!result.ok) {
    area.innerHTML = errorBlock(result.message);
    return;
  }
  state.potteryRequests = result.data;
  if (result.data.length === 0) {
    area.innerHTML = stateBlock({ icon: "✦", title: "Nothing in the kiln yet", text: "Your pottery orders will appear here." });
    return;
  }
  area.innerHTML = `<ul class="record-list">${result.data.map((request) => potteryRecord(request)).join("")}</ul>`;
}

function potteryRecord(request, showCustomer = false) {
  const itemName = request.item ? request.item.name : request.item_id;
  const glazeName = request.glaze ? request.glaze.name : request.glaze_id;
  let actions = "";
  if (!showCustomer && request.status === "requested") {
    actions = `<button class="btn btn-small" data-action="edit-pottery" data-id="${request.id}">Edit</button>
               <button class="btn btn-small btn-coral" data-action="cancel-pottery" data-id="${request.id}">Cancel</button>`;
  } else if (showCustomer && request.status === "requested") {
    actions = `<button class="btn btn-small btn-green" data-action="pottery-status" data-status="accepted" data-id="${request.id}">Accept</button>
               <button class="btn btn-small btn-coral" data-action="pottery-status" data-status="declined" data-id="${request.id}">Decline</button>`;
  }
  return `
    <li class="record">
      <div class="record-thumb is-pot">${potteryIcon(request.item_id)}</div>
      <div>
        <h3 class="record-title">${request.quantity} × ${escapeHtml(itemName)}</h3>
        <p class="record-meta">
          <span class="glaze-pill" style="--glaze:${GLAZE_COLOURS[request.glaze_id] || "#999"}">${escapeHtml(glazeName)}</span>
          <span>Needed by <strong>${escapeHtml(formatDate(request.needed_by))}</strong></span>
          ${showCustomer ? `<span>${customerLabel(request.customer)}</span>` : ""}
          ${statusBadge(request.status)}
        </p>
        ${request.notes ? `<p class="record-meta" style="margin-top:4px">“${escapeHtml(request.notes)}”</p>` : ""}
      </div>
      <div class="record-actions">${actions}</div>
    </li>`;
}

function startEditingPottery(button) {
  const request = (state.potteryRequests || []).find((r) => r.id === button.dataset.id);
  if (!request) return;
  state.editingPotteryId = request.id;
  document.querySelector(`input[name="potteryItem"][value="${CSS.escape(request.item_id)}"]`).checked = true;
  document.querySelector(`input[name="potteryGlaze"][value="${CSS.escape(request.glaze_id)}"]`).checked = true;
  document.getElementById("potteryQuantity").value = request.quantity;
  document.getElementById("potteryNeededBy").value = request.needed_by;
  document.getElementById("potteryNotes").value = request.notes || "";
  document.getElementById("potteryFormTitle").textContent = "Edit request";
  document.getElementById("potterySubmit").textContent = "Save changes";
  document.getElementById("stopEditing").hidden = false;
  formMessage("potteryMessage", "You're editing a request. You can change it until the studio responds.", "info");
  updateGlazeName();
  document.getElementById("potteryForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

function stepQuantity(button) {
  const input = document.getElementById("potteryQuantity");
  const next = (Number(input.value) || 0) + Number(button.dataset.step);
  input.value = Math.min(POTTERY_RULES.maxQuantity, Math.max(POTTERY_RULES.minQuantity, next));
}

async function handleCancelPottery(button) {
  const confirmed = await confirmAction({
    title: "Cancel this request?", message: "The studio won't make this order.", confirmLabel: "Yes, cancel request",
  });
  if (!confirmed) return;
  setBusy(button, true);
  const result = await callFunction("cancel_pottery_request", { p_request_id: button.dataset.id });
  setBusy(button, false);
  showToast(result.ok ? "Request cancelled." : result.message, result.ok ? "success" : "error");
  if (state.editingPotteryId === button.dataset.id) resetPotteryForm();
  await loadAndRenderPottery();
}

/* ---------------------------------------------------------------------
   7f. LOGIN & SIGN UP (Supabase Auth)
   --------------------------------------------------------------------- */
function authArt() {
  return `<figure class="auth-art" aria-hidden="true">
            <div class="ornate-frame"><img src="images/p-010.jpg" alt=""></div>
            <figcaption><span class="script">Nirmal</span> Court Musicians · Lakshmi Prasad</figcaption>
          </figure>`;
}

function renderLoginPage() {
  if (state.user) {
    location.hash = isStudio() ? "#/admin" : "#/paintings";
    return;
  }
  appEl.innerHTML = `
    <section class="container auth-wrap">
      <form class="form-card form-grid" id="loginForm" novalidate>
        <p class="eyebrow">Welcome back</p>
        <h1 class="auth-title">Return to the <em>studio</em></h1>
        <div class="field">
          <label for="loginEmail">Email</label>
          <input class="input" type="email" id="loginEmail" autocomplete="email" required>
        </div>
        <div class="field">
          <label for="loginPassword">Password</label>
          <input class="input" type="password" id="loginPassword" autocomplete="current-password" required>
        </div>
        <p class="form-message" id="loginMessage" hidden></p>
        <button class="btn btn-primary btn-block" type="submit" id="loginSubmit">Log in</button>
        <p class="field-hint">New here? <a href="#/signup">Create a customer account</a></p>
      </form>
      ${authArt()}
    </section>`;
  document.getElementById("loginForm").addEventListener("submit", handleLogin);
}

async function handleLogin(event) {
  event.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  if (!email || !password) {
    formMessage("loginMessage", "Please enter your email and password.", "error");
    return;
  }
  const button = document.getElementById("loginSubmit");
  setBusy(button, true);
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    setBusy(button, false);
    const message = /invalid login/i.test(error.message)
      ? "Email or password is incorrect."
      : /not confirmed/i.test(error.message)
        ? "Please confirm your email first (check your inbox), then log in."
        : error.message;
    formMessage("loginMessage", message, "error");
    return;
  }
  await refreshAuthState();
  showToast(`Welcome back${state.profile && state.profile.full_name ? ", " + state.profile.full_name : ""}!`, "success");
  const next = routeQuery().get("next");
  location.hash = isStudio() ? "#/admin" : `#${routes[next] ? next : "/paintings"}`;
}

function renderSignupPage() {
  if (state.user) {
    location.hash = "#/paintings";
    return;
  }
  appEl.innerHTML = `
    <section class="container auth-wrap">
      <form class="form-card form-grid" id="signupForm" novalidate>
        <p class="eyebrow">New here</p>
        <h1 class="auth-title">Join the <em>studio</em></h1>
        <div class="field">
          <label for="signupName">Your name</label>
          <input class="input" type="text" id="signupName" autocomplete="name" maxlength="100" required aria-describedby="signupNameError">
          <p class="field-error" id="signupNameError"></p>
        </div>
        <div class="field">
          <label for="signupEmail">Email</label>
          <input class="input" type="email" id="signupEmail" autocomplete="email" required aria-describedby="signupEmailError">
          <p class="field-error" id="signupEmailError"></p>
        </div>
        <div class="field">
          <label for="signupPassword">Password</label>
          <input class="input" type="password" id="signupPassword" autocomplete="new-password" minlength="8" required aria-describedby="signupPasswordError">
          <p class="field-hint">At least 8 characters.</p>
          <p class="field-error" id="signupPasswordError"></p>
        </div>
        <p class="form-message" id="signupMessage" hidden></p>
        <button class="btn btn-primary btn-block" type="submit" id="signupSubmit">Sign up</button>
        <p class="field-hint">Already have an account? <a href="#/login">Log in</a></p>
      </form>
      ${authArt()}
    </section>`;
  document.getElementById("signupForm").addEventListener("submit", handleSignup);
}

async function handleSignup(event) {
  event.preventDefault();
  const fullName = document.getElementById("signupName").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;

  fieldError("signupName", fullName ? "" : "Please tell us your name.");
  fieldError("signupEmail", /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "" : "Please enter a valid email.");
  fieldError("signupPassword", password.length >= 8 ? "" : "Password must be at least 8 characters.");
  if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) return;

  const button = document.getElementById("signupSubmit");
  setBusy(button, true);
  // Only the NAME is sent as metadata. The database ignores any "role" and
  // always creates the profile as a customer (see handle_new_user in 002).
  const { data, error } = await db.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
  setBusy(button, false);

  if (error) {
    formMessage("signupMessage", error.message, "error");
    return;
  }
  if (!data.session) {
    formMessage("signupMessage", "Almost there! Check your email for a confirmation link, then log in.", "success");
    return;
  }
  await refreshAuthState();
  showToast("Welcome to Chitrashala!", "success");
  location.hash = "#/paintings";
}

/* ---------------------------------------------------------------------
   7g. STUDIO ADMIN DASHBOARD
   --------------------------------------------------------------------- */
async function renderAdminPage() {
  if (!state.user) {
    appEl.innerHTML = `<div class="container section">${stateBlock({
      icon: "🔒", variant: "state-locked", title: "Studio login required",
      actions: `<a class="btn btn-primary" href="#/login?next=/admin">Log in</a>`,
    })}</div>`;
    return;
  }
  if (!isStudio()) {
    appEl.innerHTML = `<div class="container section">${stateBlock({
      icon: "✋", variant: "state-locked", title: "Studio staff only",
      text: "This dashboard is only for the studio admin account. (The database blocks these actions for customers too.)",
      actions: `<a class="btn btn-primary" href="#/paintings">Back to the gallery</a>`,
    })}</div>`;
    return;
  }

  appEl.innerHTML = `
    <section class="container page-head admin-head">
      <div>
        <p class="eyebrow">Studio dashboard</p>
        <h1 class="page-title" style="max-width:none">The studio <em>ledger</em></h1>
      </div>
      <button class="btn btn-butter" data-action="add-painting">+ Add painting</button>
    </section>
    <section class="container"><div id="adminArea">${skeletonList(4)}</div></section>
    ${paintingDialogHtml()}`;
  document.getElementById("paintingForm").addEventListener("submit", handlePaintingSubmit);
  document.getElementById("paintingImage").addEventListener("input", updatePaintingPreview);
  await loadAdminData();
}

async function loadAdminData() {
  // The studio's RLS policies return ALL rows; customer names come from profiles.
  const [paintings, orders, bookings, pottery] = await Promise.all([
    readRows(db.from("paintings").select("id, title, artist, description, price, image_url, status").order("id")),
    readRows(db.from("orders")
      .select("id, status, price, created_at, cancelled_at, painting:paintings(id, title, artist, image_url), customer:profiles(full_name, email)")
      .order("created_at", { ascending: false })),
    readRows(db.from("wall_bookings")
      .select("id, booking_date, wall_size_sqft, address, total_price, status, created_at, customer:profiles(full_name, email)")
      .order("booking_date", { ascending: true })),
    readRows(db.from("pottery_requests")
      .select("id, item_id, glaze_id, quantity, needed_by, notes, status, created_at, item:pottery_items(name), glaze:glazes(name), customer:profiles(full_name, email)")
      .order("needed_by", { ascending: true })),
  ]);
  const area = document.getElementById("adminArea");
  if (!area) return;
  const failed = [paintings, orders, bookings, pottery].find((result) => !result.ok);
  if (failed) {
    area.innerHTML = errorBlock(failed.message);
    return;
  }
  state.paintings = paintings.data;
  state.admin.data = { paintings: paintings.data, orders: orders.data, bookings: bookings.data, pottery: pottery.data };
  renderAdminDashboard();
}

function renderAdminDashboard() {
  const data = state.admin.data;
  const pendingBookings = data.bookings.filter((b) => b.status === "requested").length;
  const pendingPottery = data.pottery.filter((p) => p.status === "requested").length;
  const tabs = [
    { id: "bookings", label: "Bookings", count: pendingBookings },
    { id: "pottery", label: "Pottery", count: pendingPottery },
    { id: "paintings", label: "Paintings", count: 0 },
    { id: "orders", label: "Orders", count: 0 },
  ];
  document.getElementById("adminArea").innerHTML = `
    <div class="stat-grid">
      <div class="stat"><div class="stat-num">${data.paintings.filter((p) => p.status === "available").length}</div><p class="stat-label">Paintings available</p></div>
      <div class="stat"><div class="stat-num">${data.orders.filter((o) => o.status === "placed").length}</div><p class="stat-label">Active orders</p></div>
      <div class="stat"><div class="stat-num">${pendingBookings}</div><p class="stat-label">Bookings to review</p></div>
      <div class="stat"><div class="stat-num">${pendingPottery}</div><p class="stat-label">Pottery to review</p></div>
    </div>
    <div class="tabs" role="tablist" aria-label="Dashboard sections">
      ${tabs.map((tab) => `
        <button class="tab" role="tab" data-action="admin-tab" data-tab="${tab.id}" aria-selected="${state.admin.tab === tab.id}">
          ${tab.label}${tab.count ? `<span class="count">${tab.count}</span>` : ""}
        </button>`).join("")}
    </div>
    <div role="tabpanel" id="adminPanel">${adminPanelHtml()}</div>`;
}

function adminPanelHtml() {
  const data = state.admin.data;
  if (state.admin.tab === "bookings") {
    const list = data.bookings.filter((b) => state.admin.bookingFilter === "all" || b.status === "requested");
    return adminPanel("Wall bookings", "booking", list, adminBookingRecord, "No bookings waiting", "New booking requests will show up here.");
  }
  if (state.admin.tab === "pottery") {
    const list = data.pottery.filter((p) => state.admin.potteryFilter === "all" || p.status === "requested");
    return adminPanel("Pottery requests", "pottery", list, (r) => potteryRecord(r, true), "No requests waiting", "New pottery requests will show up here.");
  }
  if (state.admin.tab === "paintings") {
    return adminPanel("Paintings", null, data.paintings, adminPaintingRecord, "No paintings", "Add the first painting with the button above.");
  }
  return adminPanel("All orders", null, data.orders, adminOrderRecord, "No orders yet", "Orders appear here when customers buy paintings.");
}

function adminPanel(title, filterKey, list, renderRecord, emptyTitle, emptyText) {
  let filters = "";
  if (filterKey) {
    const current = state.admin[filterKey + "Filter"];
    filters = `<div class="filter-bar" style="margin:0" role="group" aria-label="Filter">
      <button class="chip" data-action="admin-filter" data-key="${filterKey}" data-filter="requested" aria-pressed="${current === "requested"}">Needs review</button>
      <button class="chip" data-action="admin-filter" data-key="${filterKey}" data-filter="all" aria-pressed="${current === "all"}">All</button>
    </div>`;
  }
  const body = list.length === 0
    ? stateBlock({ title: emptyTitle, text: emptyText })
    : `<ul class="record-list">${list.map((item) => renderRecord(item)).join("")}</ul>`;
  return `<div class="panel-head"><h2>${title}</h2>${filters}</div>${body}`;
}

function customerLabel(customer) {
  if (!customer) return "Customer";
  return escapeHtml(customer.full_name ? `${customer.full_name} (${customer.email})` : customer.email);
}

function adminBookingRecord(booking) {
  const actions = booking.status === "requested"
    ? `<button class="btn btn-small btn-green" data-action="booking-status" data-status="confirmed" data-id="${booking.id}">Confirm</button>
       <button class="btn btn-small btn-coral" data-action="booking-status" data-status="declined" data-id="${booking.id}">Decline</button>`
    : "";
  return `
    <li class="record">
      ${dateThumb(booking.booking_date)}
      <div>
        <h3 class="record-title">${escapeHtml(formatDate(booking.booking_date))} · ${Number(booking.wall_size_sqft)} sq ft · ${formatMoney(booking.total_price)}</h3>
        <p class="record-meta"><span>${customerLabel(booking.customer)}</span><span>${escapeHtml(booking.address)}</span>${statusBadge(booking.status)}</p>
      </div>
      <div class="record-actions">${actions}</div>
    </li>`;
}

function adminPaintingRecord(painting) {
  const actions = painting.status === "available"
    ? `<button class="btn btn-small" data-action="edit-painting" data-id="${escapeHtml(painting.id)}">Edit</button>`
    : `<p class="record-note">Sold paintings are locked</p>`;
  return `
    <li class="record">
      <div class="record-thumb">${paintingImage(painting)}</div>
      <div>
        <h3 class="record-title">${escapeHtml(painting.title)}</h3>
        <p class="record-meta"><span>${escapeHtml(painting.id)}</span><span>${escapeHtml(painting.artist)}</span>
          <strong>${formatMoney(painting.price)}</strong>${statusBadge(painting.status)}</p>
      </div>
      <div class="record-actions">${actions}</div>
    </li>`;
}

function adminOrderRecord(order) {
  const painting = order.painting || { title: "Painting", artist: "", image_url: "" };
  return `
    <li class="record">
      <div class="record-thumb">${paintingImage(painting)}</div>
      <div>
        <h3 class="record-title">${escapeHtml(painting.title)}</h3>
        <p class="record-meta"><span>${customerLabel(order.customer)}</span><strong>${formatMoney(order.price)}</strong>
          <span>${escapeHtml(formatDateTime(order.created_at))}</span>${statusBadge(order.status)}</p>
      </div>
      <div class="record-actions"></div>
    </li>`;
}

async function handleBookingStatus(button) {
  const newStatus = button.dataset.status;
  if (newStatus === "declined") {
    const confirmed = await confirmAction({
      title: "Decline this booking?", message: "The customer will see it as declined and the date becomes free.", confirmLabel: "Decline",
    });
    if (!confirmed) return;
  }
  setBusy(button, true);
  const result = await callFunction("studio_set_booking_status", { p_booking_id: button.dataset.id, p_new_status: newStatus });
  setBusy(button, false);
  showToast(result.ok ? `Booking ${newStatus}.` : result.message, result.ok ? "success" : "error");
  await loadAdminData();
}

async function handlePotteryStatus(button) {
  const newStatus = button.dataset.status;
  if (newStatus === "declined") {
    const confirmed = await confirmAction({ title: "Decline this request?", message: "This can't be undone.", confirmLabel: "Decline" });
    if (!confirmed) return;
  }
  setBusy(button, true);
  const result = await callFunction("studio_set_pottery_status", { p_request_id: button.dataset.id, p_new_status: newStatus });
  setBusy(button, false);
  showToast(result.ok ? `Request ${newStatus}.` : result.message, result.ok ? "success" : "error");
  await loadAdminData();
}

// --- Add / edit painting dialog ---
function paintingDialogHtml() {
  return `
    <dialog class="dialog dialog-wide" id="paintingDialog" aria-labelledby="paintingDialogTitle">
      <form class="dialog-body form-grid" id="paintingForm" novalidate>
        <h2 class="dialog-title" id="paintingDialogTitle">Add painting</h2>
        <div class="form-row">
          <div class="field"><label for="paintingTitle">Title</label><input class="input" id="paintingTitle" maxlength="200" required></div>
          <div class="field"><label for="paintingArtist">Artist</label><input class="input" id="paintingArtist" maxlength="120" required></div>
        </div>
        <div class="field"><label for="paintingDescription">Description</label><textarea class="textarea" id="paintingDescription" maxlength="2000"></textarea></div>
        <div class="form-row">
          <div class="field"><label for="paintingPrice">Price (₹)</label><input class="input" type="number" id="paintingPrice" min="1" step="0.01" required></div>
          <div class="field">
            <label for="paintingImage">Image path or https link</label>
            <input class="input" id="paintingImage" placeholder="images/p-013.jpg" maxlength="500">
            <p class="field-hint">Put the file in the images/ folder, or paste an https:// URL.</p>
          </div>
        </div>
        <div class="record-thumb" id="paintingPreview" style="width:120px;height:120px"></div>
        <p class="form-message" id="paintingMessage" hidden></p>
        <div class="dialog-actions">
          <button class="btn btn-ghost" type="button" data-action="close-painting-dialog">Close</button>
          <button class="btn btn-primary" type="submit" id="paintingSubmit">Save painting</button>
        </div>
      </form>
    </dialog>`;
}

function openPaintingDialog(painting) {
  const dialog = document.getElementById("paintingDialog");
  dialog.dataset.paintingId = painting ? painting.id : "";
  document.getElementById("paintingDialogTitle").textContent = painting ? `Edit ${painting.id}` : "Add painting";
  document.getElementById("paintingTitle").value = painting ? painting.title : "";
  document.getElementById("paintingArtist").value = painting ? painting.artist : "";
  document.getElementById("paintingDescription").value = painting ? painting.description : "";
  document.getElementById("paintingPrice").value = painting ? painting.price : "";
  document.getElementById("paintingImage").value = painting ? painting.image_url : "";
  formMessage("paintingMessage", "");
  updatePaintingPreview();
  dialog.showModal();
}

function updatePaintingPreview() {
  const value = document.getElementById("paintingImage").value;
  const title = document.getElementById("paintingTitle").value || "New painting";
  document.getElementById("paintingPreview").innerHTML = paintingImage({ title, artist: "", image_url: value });
}

async function handlePaintingSubmit(event) {
  event.preventDefault();
  const dialog = document.getElementById("paintingDialog");
  const paintingId = dialog.dataset.paintingId;
  const values = {
    p_title: document.getElementById("paintingTitle").value.trim(),
    p_artist: document.getElementById("paintingArtist").value.trim(),
    p_description: document.getElementById("paintingDescription").value.trim(),
    p_price: Number(document.getElementById("paintingPrice").value),
    p_image_url: document.getElementById("paintingImage").value.trim(),
  };
  if (!values.p_title || !values.p_artist || !(values.p_price > 0)) {
    formMessage("paintingMessage", "Title, artist and a price above ₹0 are required.", "error");
    return;
  }
  if (values.p_image_url && !safeImageUrl(values.p_image_url)) {
    formMessage("paintingMessage", "Image must be like images/my-file.jpg or start with https://", "error");
    return;
  }

  const button = document.getElementById("paintingSubmit");
  setBusy(button, true);
  const result = paintingId
    ? await callFunction("studio_update_painting", { p_painting_id: paintingId, ...values })
    : await callFunction("studio_add_painting", values);
  setBusy(button, false);

  if (!result.ok) {
    formMessage("paintingMessage", result.message, "error");
    return;
  }
  dialog.close();
  showToast(paintingId ? "Painting updated." : "Painting added to the gallery.", "success");
  state.admin.tab = "paintings";
  await loadAdminData();
}

/* ---------------------------------------------------------------------
   8. CLICK HANDLING — one listener; each button says what it does with
   data-action="...", and this map runs the matching function.
   --------------------------------------------------------------------- */
const clickActions = {
  "buy": handleBuy,
  "cancel-order": handleCancelOrder,
  "cancel-booking": handleCancelBooking,
  "edit-pottery": startEditingPottery,
  "cancel-pottery": handleCancelPottery,
  "stop-editing": resetPotteryForm,
  "quantity-step": stepQuantity,
  "booking-status": handleBookingStatus,
  "pottery-status": handlePotteryStatus,
  "retry": renderCurrentRoute,
  "add-painting": () => openPaintingDialog(null),
  "edit-painting": (button) => openPaintingDialog(state.paintings.find((p) => p.id === button.dataset.id)),
  "close-painting-dialog": () => document.getElementById("paintingDialog").close(),
  "hero-step": stepHero,
  "feature-step": stepFeature,
  "feature-go": goToFeature,
  "filter-paintings": (button) => {
    state.paintingFilter = button.dataset.filter;
    document.querySelectorAll('[data-action="filter-paintings"]').forEach((chip) => {
      chip.setAttribute("aria-pressed", String(chip.dataset.filter === state.paintingFilter));
    });
    renderGallery();
  },
  "toggle-desc": (button) => {
    const description = document.getElementById("desc-" + button.dataset.id);
    const isOpen = description.classList.toggle("is-open");
    button.textContent = isOpen ? "Show less" : "Read more";
    button.setAttribute("aria-expanded", String(isOpen));
  },
  "admin-tab": (button) => {
    state.admin.tab = button.dataset.tab;
    renderAdminDashboard();
  },
  "admin-filter": (button) => {
    state.admin[button.dataset.key + "Filter"] = button.dataset.filter;
    document.getElementById("adminPanel").innerHTML = adminPanelHtml();
  },
};

appEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button || !clickActions[button.dataset.action]) return;
  event.preventDefault();
  clickActions[button.dataset.action](button);
});

// Missing painting image? Swap in the designed fallback instead of a broken icon.
document.addEventListener("error", (event) => {
  const image = event.target;
  if (image.tagName === "IMG" && image.dataset.fallbackTitle !== undefined) {
    image.outerHTML = imageFallback(image.dataset.fallbackTitle);
  }
}, true);

document.getElementById("navToggle").addEventListener("click", () => {
  const nav = document.getElementById("mainNav");
  const isOpen = nav.classList.toggle("is-open");
  document.getElementById("navToggle").setAttribute("aria-expanded", String(isOpen));
});

/* ---------------------------------------------------------------------
   9. START THE APP
   --------------------------------------------------------------------- */
async function startApp() {
  if (!db) {
    renderCurrentRoute();
    return;
  }
  await refreshAuthState();

  // Login/logout in another tab, or a session that expired.
  db.auth.onAuthStateChange((event, session) => {
    const newUserId = session ? session.user.id : null;
    const oldUserId = state.user ? state.user.id : null;
    if (newUserId === oldUserId) return; // just a token refresh
    // setTimeout avoids calling Supabase from inside its own callback.
    setTimeout(async () => {
      await refreshAuthState();
      renderCurrentRoute();
    }, 0);
  });

  window.addEventListener("hashchange", renderCurrentRoute);
  renderCurrentRoute();
}

startApp();

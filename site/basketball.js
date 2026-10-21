import { BASKETBALL_FAVORITE, CHANNELS } from "./config.js";
import { channelLabel, howToWatch } from "./rules.js";

const STORAGE_KEY = "gameday-guide:viewer"; // shared with the football page
const PREFS_KEY = "gameday-guide:basketball";
const HOUR = 3600e3;
const LIVE_WINDOW = 3 * HOUR;
const FINISHED_AFTER = 4 * HOUR;

const $ = (id) => document.getElementById(id);

const state = {
  games: [],
  viewer: loadViewer(),
  day: dayKey(new Date()), // selected day, "YYYY-MM-DD" in the viewer's time zone
  michigan: false,
  playersOnly: false,
  players: [], // every NBA player, from data/nba-players.json
  myPlayers: [], // ids of the players being followed
  league: "all",
  top25: false,
  tvOnly: true,
  query: "",
};

// ---------- storage ----------

function loadViewer() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { huluHome: Boolean(saved?.huluHome), saved };
  } catch {}
  return { huluHome: false, saved: null };
}

function saveHuluHome() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state.viewer.saved, huluHome: state.viewer.huluHome }));
  } catch {}
}

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY));
    if (p) Object.assign(state, { michigan: Boolean(p.michigan), playersOnly: Boolean(p.playersOnly), myPlayers: Array.isArray(p.myPlayers) ? p.myPlayers : [], league: p.league ?? "all", top25: Boolean(p.top25), tvOnly: p.tvOnly !== false });
  } catch {}
}

function savePrefs() {
  const { michigan, playersOnly, myPlayers, league, top25, tvOnly } = state;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ michigan, playersOnly, myPlayers, league, top25, tvOnly }));
  } catch {}
}

// ---------- dates ----------

function pad(n) {
  return String(n).padStart(2, "0");
}
function dayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const fromKey = (key) => new Date(`${key}T12:00:00`);
function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

const fmtTime = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const fmtLong = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
const fmtDow = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const fmtMonth = new Intl.DateTimeFormat(undefined, { month: "short" });
const fmtShort = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });

function relativeTime(date) {
  const minutes = Math.round((Date.now() - date) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return fmtShort.format(date);
}

// ---------- game helpers ----------

const isFinished = (g, now = Date.now()) => g.state === "post" || (!g.timeTBD && now - Date.parse(g.date) > FINISHED_AFTER);
const isLive = (g, now = Date.now()) => {
  const start = Date.parse(g.date);
  return !g.timeTBD && !isFinished(g, now) && (g.state === "in" || (now >= start && now - start < LIVE_WINDOW));
};
const isMichigan = (g) =>
  g.league === BASKETBALL_FAVORITE.league && (g.home.id === BASKETBALL_FAVORITE.id || g.away.id === BASKETBALL_FAVORITE.id);
// Followed players whose team is in this NBA game.
function myPlayersIn(game) {
  if (game.league !== "nba" || !state.myPlayers.length) return [];
  return state.players.filter((p) => state.myPlayers.includes(p.id) && (p.team === game.home.id || p.team === game.away.id));
}
const isMine = (g) => isMichigan(g) || myPlayersIn(g).length > 0;
// "Focus" mode: only Michigan and/or my players' games.
const focusOn = () => state.michigan || state.playersOnly;
const inFocus = (g) => (state.michigan && isMichigan(g)) || (state.playersOnly && myPlayersIn(g).length > 0);
const isPlaceholder = (g) => g.home.id.startsWith("-") && g.away.id.startsWith("-");

function matchesQuery(game, query) {
  const haystack = [
    game.home.fullName, game.home.name, game.home.abbr, game.away.fullName, game.away.name, game.away.abbr,
    game.note ?? "", ...game.channels, ...game.channels.map(channelLabel),
  ].join(" ").toLowerCase();
  return query.split(/\s+/).every((word) => haystack.includes(word));
}

// Everything except the date, so the calendar can show per-day counts.
function passesFilters(g) {
  if (focusOn() && !inFocus(g)) return false;
  if (state.league !== "all" && g.league !== state.league) return false;
  if (state.top25 && (g.league !== "cbb" || (!g.home.rank && !g.away.rank))) return false;
  if (state.tvOnly && !focusOn() && g.channels.length === 0) return false;
  const query = state.query.trim().toLowerCase();
  return !query || matchesQuery(g, query);
}

// ---------- how to watch ----------

// Only channels the config knows about get app instructions. Regional TV
// networks (NBA teams' local channels) are listed as plain text instead.
function watchHtml(game) {
  if (game.channels.length === 0) {
    return `<div class="watch watch-none"><span class="app">No TV listed yet</span></div>`;
  }
  const known = game.channels.filter((c) => CHANNELS[c]).sort((a, b) => (a === "NBA League Pass") - (b === "NBA League Pass"));
  const local = game.channels.filter((c) => !CHANNELS[c]);
  const { options } = howToWatch({ ...game, channels: known.length ? known : local }, { huluHome: state.viewer.huluHome, local: null });
  const [primary, ...others] = options;
  const chan = known.length ? channelLabel(known[0]) : local[0];
  const also = others.length ? `<p class="also">Also on ${others.map((o) => `<strong>${escapeHtml(o.app)}</strong>`).join(", ")}</p>` : "";
  const regional = known.length && local.length
    ? `<p class="also">Local TV: ${local.map(escapeHtml).join(", ")}</p>`
    : "";
  return `
    <div class="watch${primary.unknown ? " watch-unknown" : ""}">
      <span class="chan">${escapeHtml(chan)}</span><span class="app">${escapeHtml(primary.app)}</span>
      <span class="detail">${escapeHtml(primary.detail)}</span>${also}${regional}
    </div>`;
}

// ---------- rendering ----------

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function teamHtml(team, league) {
  const logo = team.logo
    ? `<img class="logo" src="${escapeHtml(team.logo)}" alt="" loading="lazy" onerror="this.remove()">`
    : `<span class="logo logo-blank" aria-hidden="true"></span>`;
  const rank = league === "cbb" && team.rank ? `<span class="rank">#${team.rank}</span>` : "";
  return `<div class="team">${logo}${rank}<span class="team-name">${escapeHtml(team.name)}</span></div>`;
}

function gameCard(game, { showTime = false } = {}) {
  const fav = isMichigan(game);
  const badges = [];
  if (isLive(game)) badges.push(`<span class="badge badge-live">Live</span>`);
  else if (isFinished(game)) badges.push(`<span class="badge">Final</span>`);
  if (fav) badges.push(`<span class="badge badge-fav">★ ${escapeHtml(BASKETBALL_FAVORITE.label)}</span>`);

  const matchup = isPlaceholder(game)
    ? `<div class="team team-placeholder">${escapeHtml(game.note ?? "Matchup TBD")}</div>`
    : `${teamHtml(game.away, game.league)}<span class="at">${game.neutralSite ? "vs" : "at"}</span>${teamHtml(game.home, game.league)}`;
  const note = game.note && !isPlaceholder(game) ? ` · ${escapeHtml(game.note)}` : "";
  const mine = myPlayersIn(game);
  const roster = mine.length
    ? `<div class="roster-line">${mine.map((p) => `<span class="pbadge">🏀 ${escapeHtml(p.name)}${p.injury && p.injury !== "Active" ? ` <span class="hurt">${escapeHtml(p.injury)}</span>` : ""}</span>`).join("")}</div>`
    : "";
  const time = showTime ? ` · ${game.timeTBD ? "Time TBD" : fmtTime.format(new Date(game.date))}` : "";
  return `
    <article class="bgame${fav ? " game-fav" : ""}${isFinished(game) ? " game-done" : ""}">
      <div>
        <div class="teams">${matchup}${badges.join("")}</div>
        <span class="meta">${game.league === "nba" ? "NBA" : "College"}${note}${time}</span>
        ${roster}
      </div>
      ${watchHtml(game)}
    </article>`;
}

// Day view: games grouped by tip-off time.
function renderDay(games) {
  const slots = new Map();
  for (const g of games) {
    const label = g.timeTBD ? "Time TBD" : fmtTime.format(new Date(g.date));
    if (!slots.has(label)) slots.set(label, []);
    slots.get(label).push(g);
  }
  return [...slots].map(([label, list]) => `<h3 class="slot-title">${escapeHtml(label)}</h3>${list.map((g) => gameCard(g)).join("")}`).join("");
}

// Michigan view: the whole schedule, one heading per day.
function renderSeason(games) {
  const days = new Map();
  for (const g of games) {
    const key = dayKey(g.date);
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(g);
  }
  return [...days]
    .map(([key, list]) => `
      <h3 class="day-title${key === state.day ? " is-picked" : ""}" id="day-${key}">${fmtLong.format(fromKey(key))}</h3>
      ${list.map((g) => gameCard(g, { showTime: true })).join("")}`)
    .join("");
}

function renderGames() {
  const all = state.games.filter(passesFilters);
  let html;
  if (focusOn()) {
    const what = [state.michigan && BASKETBALL_FAVORITE.label, state.playersOnly && "My players"].filter(Boolean).join(" + ");
    $("list-title").textContent = `${what} schedule`;
    $("list-count").textContent = `${all.length} game${all.length === 1 ? "" : "s"}`;
    html = all.length ? renderSeason(all) : "";
  } else {
    const games = all.filter((g) => dayKey(g.date) === state.day);
    $("list-title").textContent = fmtLong.format(fromKey(state.day));
    $("list-count").textContent = `${games.length} game${games.length === 1 ? "" : "s"}`;
    html = games.length ? renderDay(games) : "";
  }
  if (!html) {
    const hint = state.playersOnly && !state.myPlayers.length ? " Add some players above to build your list." : state.tvOnly && !focusOn() ? " Games with no TV listed are hidden. Untick <strong>On TV or streaming</strong> to see them." : "";
    html = `<p class="empty">No games match this day.${hint}</p>`;
  }
  $("games").innerHTML = html;
}

// ---------- calendar ----------

function dayRange() {
  const keys = state.games.map((g) => dayKey(g.date)).sort();
  return { first: keys[0], last: keys.at(-1) };
}

function renderStrip({ scroll = true } = {}) {
  const { first, last } = dayRange();
  const counts = new Map();
  const michDays = new Set();
  const focusDays = new Set();
  for (const g of state.games) {
    const key = dayKey(g.date);
    if (isMine(g)) michDays.add(key);
    if (focusOn() && inFocus(g)) focusDays.add(key);
    if (passesFilters(g)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const today = dayKey(new Date());
  const chips = [];
  for (let key = first; key <= last; key = addDays(key, 1)) {
    const d = fromKey(key);
    const n = counts.get(key) ?? 0;
    const classes = ["day-chip"];
    if (key === today) classes.push("is-today");
    if (d.getDate() === 1 || key === first) classes.push("month-start");
    if (focusOn() ? !focusDays.has(key) : n === 0) classes.push(focusOn() ? "is-dim" : "is-empty");
    chips.push(`
      <button type="button" class="${classes.join(" ")}" role="tab" data-day="${key}" aria-selected="${key === state.day}">
        ${classes.includes("month-start") ? `<span class="mon">${fmtMonth.format(d)}</span>` : ""}
        <span class="dow">${key === today ? "Today" : fmtDow.format(d)}</span>
        <span class="num">${d.getDate()}</span>
        <span class="cnt">${n ? `${n} game${n === 1 ? "" : "s"}` : "–"}</span>
        ${!focusOn() && michDays.has(key) ? `<span class="mdot" title="Michigan or one of your players plays" aria-label="Michigan or one of your players plays"></span>` : ""}
      </button>`);
  }
  $("strip").innerHTML = chips.join("");
  $("cal-title").textContent = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(fromKey(state.day));
  $("jump-date").min = first;
  $("jump-date").max = last;
  $("jump-date").value = state.day;
  $("prev-day").disabled = state.day <= first;
  $("next-day").disabled = state.day >= last;
  $("today").hidden = state.day === today;
  $("next-mich").hidden = focusOn() || !nextMine();
  if (scroll) $("strip").querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "center" });
}

function nextMine() {
  const now = Date.now();
  return state.games.find((g) => isMine(g) && !isFinished(g, now));
}

function selectDay(key, { scrollList = false } = {}) {
  const { first, last } = dayRange();
  state.day = key < first ? first : key > last ? last : key;
  try { history.replaceState(null, "", `#${state.day}`); } catch {}
  render();
  if (scrollList && focusOn()) {
    // In the Michigan schedule, jump to the nearest game on or after the picked day.
    const target = [...document.querySelectorAll(".day-title")].find((el) => el.id.slice(4) >= state.day) ?? document.querySelector(".day-title:last-of-type");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function render() {
  $("mich-toggle").setAttribute("aria-pressed", String(state.michigan));
  $("players-toggle").setAttribute("aria-pressed", String(state.playersOnly));
  renderPlayerChips();
  renderStrip();
  renderGames();
}

// ---------- my players ----------

function playerTeamName(player) {
  const game = state.games.find((g) => g.league === "nba" && (g.home.id === player.team || g.away.id === player.team));
  const t = game && (game.home.id === player.team ? game.home : game.away);
  return t?.name ?? "";
}

function renderPlayerChips() {
  const chips = state.myPlayers.map((id) => state.players.find((p) => p.id === id)).filter(Boolean);
  $("player-chips").innerHTML = chips
    .map((p) => `<li class="pchip">${escapeHtml(p.name)} <span class="muted">${escapeHtml(playerTeamName(p))}</span>${p.injury && p.injury !== "Active" ? ` <span class="hurt">${escapeHtml(p.injury)}</span>` : ""}
      <button type="button" data-remove="${escapeHtml(p.id)}" aria-label="Remove ${escapeHtml(p.name)}">×</button></li>`)
    .join("");
  $("players-hint").hidden = chips.length > 0;
}

function scrollToNextMine() {
  const next = nextMine();
  if (next) document.getElementById(`day-${dayKey(next.date)}`)?.scrollIntoView({ block: "start" });
}

const normalizeName = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f.'’-]/g, "");

function setupPlayerSearch() {
  const input = $("player-input");
  const list = $("player-results");
  let matches = [];
  let active = -1;

  const close = () => { list.hidden = true; active = -1; };
  const paint = () => {
    list.innerHTML = matches.length
      ? matches.map((p, i) => `<li role="option" data-id="${escapeHtml(p.id)}" aria-selected="${i === active}">${escapeHtml(p.name)}<span class="pmeta">${escapeHtml(p.pos)} · ${escapeHtml(playerTeamName(p))}</span></li>`).join("")
      : `<li class="none">No player found</li>`;
    list.hidden = false;
  };
  const add = (id) => {
    if (!state.myPlayers.includes(id)) state.myPlayers.push(id);
    state.playersOnly = true; // adding a player means you want to see their games
    savePrefs();
    input.value = "";
    close();
    render();
    scrollToNextMine();
  };

  input.addEventListener("input", () => {
    const q = normalizeName(input.value.trim());
    if (!q) return close();
    matches = state.players
      .filter((p) => !state.myPlayers.includes(p.id) && q.split(/\s+/).every((w) => normalizeName(p.name).includes(w)))
      .slice(0, 8);
    active = matches.length ? 0 : -1;
    paint();
  });
  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
      paint();
    } else if (e.key === "Enter" && matches[active]) {
      e.preventDefault();
      add(matches[active].id);
    } else if (e.key === "Escape") close();
  });
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("[data-id]");
    if (li) { e.preventDefault(); add(li.dataset.id); }
  });
  input.addEventListener("blur", close);
  $("player-chips").addEventListener("click", (e) => {
    const id = e.target.closest("[data-remove]")?.dataset.remove;
    if (!id) return;
    state.myPlayers = state.myPlayers.filter((x) => x !== id);
    savePrefs();
    render();
  });
}

// ---------- wiring ----------

function setupControls() {
  $("hulu-home").checked = state.viewer.huluHome;
  $("hulu-home").addEventListener("change", (e) => {
    state.viewer.huluHome = e.target.checked;
    saveHuluHome();
    renderGames();
  });

  $("mich-toggle").addEventListener("click", () => {
    state.michigan = !state.michigan;
    savePrefs();
    render();
    if (state.michigan) scrollToNextMine();
  });
  $("players-toggle").addEventListener("click", () => {
    state.playersOnly = !state.playersOnly;
    savePrefs();
    render();
    if (state.playersOnly) scrollToNextMine();
  });
  setupPlayerSearch();

  for (const button of document.querySelectorAll("[data-league]")) {
    button.addEventListener("click", () => {
      state.league = button.dataset.league;
      syncControls();
      savePrefs();
      render();
    });
  }
  $("top25").addEventListener("change", (e) => { state.top25 = e.target.checked; savePrefs(); render(); });
  $("tv-only").addEventListener("change", (e) => { state.tvOnly = e.target.checked; savePrefs(); render(); });
  $("search").addEventListener("input", (e) => { state.query = e.target.value; render(); });

  $("strip").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-day]");
    if (chip) selectDay(chip.dataset.day, { scrollList: true });
  });
  $("prev-day").addEventListener("click", () => selectDay(addDays(state.day, -1)));
  $("next-day").addEventListener("click", () => selectDay(addDays(state.day, 1)));
  $("today").addEventListener("click", () => selectDay(dayKey(new Date())));
  $("jump-date").addEventListener("change", (e) => e.target.value && selectDay(e.target.value));
  $("next-mich").addEventListener("click", () => {
    const next = nextMine();
    if (next) selectDay(dayKey(next.date));
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowLeft") selectDay(addDays(state.day, -1));
    if (e.key === "ArrowRight") selectDay(addDays(state.day, 1));
  });
}

function syncControls() {
  for (const b of document.querySelectorAll("[data-league]")) b.setAttribute("aria-pressed", String(b.dataset.league === state.league));
  $("top25").checked = state.top25;
  $("tv-only").checked = state.tvOnly;
}

async function init() {
  loadPrefs();
  setupControls();
  syncControls();
  try {
    const res = await fetch("data/basketball.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.games = data.games;
    try {
      const pres = await fetch("data/nba-players.json", { cache: "no-cache" });
      if (pres.ok) state.players = (await pres.json()).players;
    } catch {}
    // Players the saved list names that have since left the league just drop off.
    if (state.players.length) state.myPlayers = state.myPlayers.filter((id) => state.players.some((p) => p.id === id));
    const hash = location.hash.slice(1);
    if (/^\d{4}-\d{2}-\d{2}$/.test(hash)) state.day = hash;
    // Before the season starts, open on the first day with games.
    const { first, last } = dayRange();
    if (state.day < first) state.day = first;
    if (state.day > last) state.day = last;
    const zone = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value;
    $("footer-info").textContent =
      `Times are shown in your time zone (${zone}). Schedule from ESPN, updated ${relativeTime(new Date(data.updatedAt))}. Use ← → to change the day.`;
    render();
    setInterval(renderGames, 5 * 60e3);
  } catch (err) {
    $("games").innerHTML = `<p class="empty">Couldn't load the schedule (${escapeHtml(err.message)}). Try refreshing.</p>`;
  }
}

init();

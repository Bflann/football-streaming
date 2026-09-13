import { FAVORITE_TEAMS } from "./config.js";
import { cachedListings, fetchListings, matchShows, rememberListings } from "./listings.js";
import { findMarket, locateMarket } from "./market.js";
import { channelLabel, dateKeyET, howToWatch, isSundayTicketGame } from "./rules.js";

const STORAGE_KEY = "gameday-guide:viewer";
const HOUR = 3600e3;
const LIVE_WINDOW = 4 * HOUR; // treat a game as live for this long after kickoff
const FINISHED_AFTER = 5 * HOUR; // ...and finished after this, even if the data is stale

const $ = (id) => document.getElementById(id);

const state = {
  games: [],
  viewer: loadViewer(),
  // Local-station listings for the viewer's market, filled in per NFL Sunday.
  listings: { games: new Map(), dates: new Set(), pending: new Set(), unavailable: new Set(), error: null },
  league: "all",
  query: "",
  favoritesOnly: false,
  top25: false,
  showFinished: false,
  weekStart: startOfWeek(new Date()),
};

// ---------- storage ----------

// viewer.market is { zip, name, headendId } or null before setup.
function loadViewer() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.market?.headendId) return { market: saved.market, huluHome: Boolean(saved.huluHome) };
  } catch {}
  return { market: null, huluHome: false };
}

function saveViewer() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ market: state.viewer.market, huluHome: state.viewer.huluHome }));
  } catch {}
}

function rulesViewer() {
  const { market, huluHome } = state.viewer;
  return { huluHome, local: market ? { games: state.listings.games, dates: state.listings.dates } : null };
}

// ---------- dates ----------

// Football weeks run Tuesday through Monday.
function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 5) % 7));
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

const fmtTime = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" });
const fmtShortDay = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const fmtMonthDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function relativeTime(date) {
  const minutes = Math.round((Date.now() - date) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return fmtShortDay.format(date);
}

// ---------- game helpers ----------

function isFinished(game, now = Date.now()) {
  return game.state === "post" || (!game.timeTBD && now - Date.parse(game.date) > FINISHED_AFTER);
}

function isLive(game, now = Date.now()) {
  const start = Date.parse(game.date);
  return !game.timeTBD && !isFinished(game, now) && (game.state === "in" || (now >= start && now - start < LIVE_WINDOW));
}

function favoriteFor(game) {
  return FAVORITE_TEAMS.find((f) => f.league === game.league && (f.id === game.home.id || f.id === game.away.id));
}

function isPlaceholder(game) {
  return game.home.id.startsWith("-") && game.away.id.startsWith("-");
}

function matchesQuery(game, query) {
  const haystack = [
    game.home.fullName, game.home.name, game.home.abbr,
    game.away.fullName, game.away.name, game.away.abbr,
    game.note ?? "", ...game.channels, ...game.channels.map(channelLabel),
  ].join(" ").toLowerCase();
  return query.split(/\s+/).every((word) => haystack.includes(word));
}

function nextFavoriteGames() {
  const now = Date.now();
  return FAVORITE_TEAMS.map((fav) => state.games.find((g) => favoriteFor(g) === fav && !isFinished(g, now))).filter(Boolean);
}

// ---------- local listings ----------

// Fetches local-station listings for every NFL Sunday that's on screen.
async function ensureListings(games) {
  const market = state.viewer.market;
  if (!market) return;
  const sundays = new Map();
  for (const game of games) {
    if (!isSundayTicketGame(game)) continue;
    const key = dateKeyET(game.date);
    if (!sundays.has(key)) sundays.set(key, []);
    sundays.get(key).push(game);
  }
  const jobs = [];
  for (const [key, dayGames] of sundays) {
    const { dates, pending, unavailable } = state.listings;
    if (dates.has(key) || pending.has(key) || unavailable.has(key)) continue;
    pending.add(key);
    jobs.push(loadSunday(market, key, dayGames));
  }
  if (jobs.length) {
    await Promise.all(jobs);
    render();
  }
}

async function loadSunday(market, key, dayGames) {
  const kickoffs = dayGames.map((g) => Date.parse(g.date));
  try {
    let result = cachedListings(market, key);
    if (!result) {
      result = await fetchListings(market, Math.min(...kickoffs), Math.max(...kickoffs));
      rememberListings(market, key, result);
    }
    if (!result.available) {
      state.listings.unavailable.add(key);
      return;
    }
    for (const [id, airing] of matchShows(result.shows, dayGames)) state.listings.games.set(id, airing);
    state.listings.dates.add(key);
    state.listings.error = null;
  } catch (err) {
    state.listings.error = err.message;
  } finally {
    state.listings.pending.delete(key);
  }
}

function resetListings() {
  state.listings = { games: new Map(), dates: new Set(), pending: new Set(), unavailable: new Set(), error: null };
}

// ---------- rendering ----------

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function teamHtml(team, league) {
  const logo = team.logo
    ? `<img class="logo" src="${escapeHtml(team.logo)}" alt="" loading="lazy" onerror="this.remove()">`
    : `<span class="logo logo-blank" aria-hidden="true"></span>`;
  const rank = league === "cfb" && team.rank ? `<span class="rank">#${team.rank}</span>` : "";
  return `<div class="team">${logo}${rank}<span class="team-name">${escapeHtml(team.name)}</span></div>`;
}

function watchHtml(game) {
  const watch = howToWatch(game, rulesViewer());
  if (watch.status === "tba") {
    return `<div class="watch watch-tba"><span class="watch-kicker">How to watch</span><span class="app">Channel not announced yet</span></div>`;
  }
  const localNetwork = channelLabel(game.channels.find((c) => c === "CBS" || c === "FOX") ?? "");
  const kicker = {
    blackout: "📺 On your local station · not on Sunday Ticket",
    "sunday-ticket": "Sunday Ticket",
    "listings-pending": "Sunday Ticket, unless it's local",
    "unknown-market": "Sunday Ticket, unless it's local",
    ok: "How to watch",
  }[watch.status];
  const [primary, ...others] = watch.options;
  const also = others.length
    ? `<p class="also">Also on ${others.map((o) => `<strong>${escapeHtml(o.app)}</strong>`).join(", ")}</p>`
    : "";
  const note = {
    blackout: `<p class="also">Your local ${escapeHtml(localNetwork)} station (${escapeHtml(watch.station)}) is airing this game, so it won't be on Sunday Ticket where you are.</p>`,
    "sunday-ticket": `<p class="also">Your local ${escapeHtml(localNetwork)} station is showing a different game.</p>`,
    "listings-pending": state.listings.pending.has(dateKeyET(game.date))
      ? `<p class="also">Checking your local station listings…</p>`
      : `<p class="also">Local station listings for this Sunday aren't published yet (they usually appear about a week ahead). Check back closer to game day.</p>`,
    "unknown-market": `<p class="also">Set your location above to check whether your local ${escapeHtml(localNetwork)} station is airing this game.</p>`,
  }[watch.status] ?? "";
  return `
    <div class="watch watch-${watch.status}${primary.unknown ? " watch-unknown" : ""}">
      <span class="watch-kicker">${kicker}</span>
      <span class="app">${escapeHtml(primary.app)}</span>
      <span class="detail">${escapeHtml(primary.detail)}</span>
      ${also}${note}
    </div>`;
}

function gameCard(game, { showDate = false } = {}) {
  const start = new Date(game.date);
  const favorite = favoriteFor(game);
  const time = game.timeTBD ? "Time TBD" : fmtTime.format(start);
  const leagueLabel = game.league === "nfl" ? "NFL" : "College";

  const badges = [];
  if (isLive(game)) badges.push(`<span class="badge badge-live">Live</span>`);
  else if (isFinished(game)) badges.push(`<span class="badge">Final</span>`);
  if (favorite) badges.push(`<span class="badge badge-fav">★ ${escapeHtml(favorite.label)}</span>`);

  const matchup = isPlaceholder(game)
    ? `<div class="team team-placeholder">${escapeHtml(game.note ?? "Matchup TBD")}</div>`
    : `${teamHtml(game.away, game.league)}
       <span class="at">${game.neutralSite ? "vs" : "at"}</span>
       ${teamHtml(game.home, game.league)}`;
  const note = game.note && !isPlaceholder(game) ? ` · ${escapeHtml(game.note)}` : "";
  const channels = game.channels.length ? game.channels.map(channelLabel).join(" / ") : "TV TBA";

  return `
    <article class="game${favorite ? " game-fav" : ""}${isFinished(game) ? " game-done" : ""}">
      <div class="when">
        ${showDate ? `<span class="date">${fmtShortDay.format(start)}</span>` : ""}
        <span class="time">${time}</span>
        <span class="meta">${leagueLabel} · ${escapeHtml(game.week)}</span>
        ${badges.length ? `<span class="badges">${badges.join("")}</span>` : ""}
      </div>
      <div class="matchup">
        <div class="teams">${matchup}</div>
        <span class="meta">${escapeHtml(channels)}${note}</span>
      </div>
      ${watchHtml(game)}
    </article>`;
}

function renderNextUp() {
  const next = nextFavoriteGames();
  const cards = FAVORITE_TEAMS.map((fav) => {
    const game = next.find((g) => favoriteFor(g) === fav);
    return game
      ? gameCard(game, { showDate: true })
      : `<article class="game game-empty">No upcoming ${escapeHtml(fav.label)} games on the schedule.</article>`;
  });
  $("next-up").innerHTML = cards.join("");
}

// The "your local stations this Sunday" panel for the week being viewed.
function renderLocalPanel(weekGames) {
  const panel = $("local-panel");
  const market = state.viewer.market;
  const sunday = weekGames.filter(isSundayTicketGame);
  if (!market || !sunday.length) {
    panel.hidden = true;
    return;
  }
  const key = dateKeyET(sunday[0].date);
  const day = fmtShortDay.format(new Date(sunday[0].date));
  let body;
  if (state.listings.dates.has(key)) {
    const airing = sunday
      .filter((g) => state.listings.games.has(g.id))
      .map((g) => {
        const { station, network } = state.listings.games.get(g.id);
        return `<li><strong>${escapeHtml(channelLabel(network))}</strong> ${escapeHtml(station)} · ${fmtTime.format(new Date(g.date))} · ${escapeHtml(g.away.name)} at ${escapeHtml(g.home.name)}</li>`;
      });
    body = airing.length
      ? `<ul class="local-list">${airing.join("")}</ul><p class="muted">Watch these on the station's app (Sunday Ticket won't carry them where you are). Every other Sunday-afternoon game is on Sunday Ticket.</p>`
      : `<p class="muted">No Sunday-afternoon games matched your local listings, so everything is on Sunday Ticket.</p>`;
  } else if (state.listings.pending.has(key)) {
    body = `<p class="muted">Checking your local station listings…</p>`;
  } else if (state.listings.error) {
    body = `<p class="muted">Couldn't load local listings (${escapeHtml(state.listings.error)}). Refresh to try again.</p>`;
  } else {
    body = `<p class="muted">Local listings for this Sunday aren't published yet. They usually appear about a week ahead.</p>`;
  }
  panel.innerHTML = `<h3 class="local-title">On your local stations · ${escapeHtml(day)}</h3>${body}`;
  panel.hidden = false;
}

function filteredGames() {
  const query = state.query.trim().toLowerCase();
  const seasonWide = Boolean(query) || state.favoritesOnly;
  const weekEnd = addDays(state.weekStart, 7);
  return {
    seasonWide,
    weekGames: state.games.filter((g) => {
      const start = new Date(g.date);
      return start >= state.weekStart && start < weekEnd;
    }),
    games: state.games.filter((g) => {
      const start = new Date(g.date);
      if (!seasonWide && (start < state.weekStart || start >= weekEnd)) return false;
      if (state.league !== "all" && g.league !== state.league) return false;
      if (!state.showFinished && isFinished(g)) return false;
      if (state.favoritesOnly && !favoriteFor(g)) return false;
      if (state.top25 && (g.league !== "cfb" || (!g.home.rank && !g.away.rank))) return false;
      if (query && !matchesQuery(g, query)) return false;
      return true;
    }),
  };
}

function renderGames() {
  const { seasonWide, weekGames, games } = filteredGames();

  $("week-nav").classList.toggle("is-hidden", seasonWide);
  $("games-title").textContent = seasonWide ? "Whole season" : "All games";
  $("week-label").textContent = `${fmtMonthDay.format(state.weekStart)} – ${fmtMonthDay.format(addDays(state.weekStart, 6))}`;
  $("this-week").hidden = state.weekStart.getTime() === startOfWeek(new Date()).getTime();
  if (state.games.length) {
    $("prev-week").disabled = state.weekStart <= startOfWeek(new Date(state.games[0].date));
    $("next-week").disabled = addDays(state.weekStart, 7) > new Date(state.games.at(-1).date);
  }

  renderLocalPanel(seasonWide ? [] : weekGames);
  ensureListings([...games, ...nextFavoriteGames()]);

  if (!games.length) {
    const hint = !state.showFinished && !seasonWide ? " Finished games are hidden. Tick <strong>Show finished</strong> to see them." : "";
    $("games").innerHTML = `<p class="empty">No games match.${hint}</p>`;
    return;
  }

  const days = new Map();
  for (const game of games) {
    const key = new Date(game.date).toDateString();
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(game);
  }
  $("games").innerHTML = [...days.values()]
    .map((dayGames) => `
      <section class="day">
        <h3 class="day-title">${fmtDay.format(new Date(dayGames[0].date))}
          <span class="count">${dayGames.length} game${dayGames.length === 1 ? "" : "s"}</span></h3>
        ${dayGames.map((g) => gameCard(g)).join("")}
      </section>`)
    .join("");
}

function renderPlace() {
  const market = state.viewer.market;
  $("place-summary").hidden = !market;
  $("place-form").hidden = Boolean(market);
  $("setup-banner").hidden = Boolean(market);
  if (market) $("place-label").textContent = `${market.name} (${market.zip})`;
}

function render() {
  renderPlace();
  renderNextUp();
  renderGames();
}

// ---------- wiring ----------

async function setMarket(lookup) {
  const error = $("place-error");
  error.hidden = true;
  for (const b of $("place-form").querySelectorAll("button")) b.disabled = true;
  try {
    state.viewer.market = await lookup();
    resetListings();
    saveViewer();
    render();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    for (const b of $("place-form").querySelectorAll("button")) b.disabled = false;
  }
}

function setupControls() {
  $("hulu-home").checked = state.viewer.huluHome;
  $("favorites-label").textContent = `★ ${FAVORITE_TEAMS.map((f) => f.label).join(" & ")}`;

  $("place-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const query = $("place-input").value;
    setMarket(() => findMarket(query));
  });
  $("use-location").addEventListener("click", () => setMarket(locateMarket));
  $("change-place").addEventListener("click", () => {
    state.viewer.market = null;
    resetListings();
    saveViewer();
    render();
    $("place-input").focus();
  });
  $("hulu-home").addEventListener("change", (e) => {
    state.viewer.huluHome = e.target.checked;
    saveViewer();
    render();
  });

  for (const button of document.querySelectorAll("[data-league]")) {
    button.addEventListener("click", () => {
      state.league = button.dataset.league;
      for (const b of document.querySelectorAll("[data-league]")) b.setAttribute("aria-pressed", String(b === button));
      renderGames();
    });
  }
  $("search").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderGames();
  });
  for (const [id, key] of [["favorites-only", "favoritesOnly"], ["top25", "top25"], ["show-finished", "showFinished"]]) {
    $(id).addEventListener("change", (e) => {
      state[key] = e.target.checked;
      renderGames();
    });
  }
  $("prev-week").addEventListener("click", () => {
    state.weekStart = addDays(state.weekStart, -7);
    renderGames();
  });
  $("next-week").addEventListener("click", () => {
    state.weekStart = addDays(state.weekStart, 7);
    renderGames();
  });
  $("this-week").addEventListener("click", () => {
    state.weekStart = startOfWeek(new Date());
    renderGames();
  });
}

async function init() {
  setupControls();
  try {
    const res = await fetch("data/games.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.games = data.games;
    const zone = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
      .formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value;
    $("footer-info").textContent =
      `Times are shown in your time zone (${zone}). Schedule from ESPN, updated ${relativeTime(new Date(data.updatedAt))}. Local station listings from Gracenote.`;
    render();
    // Keep "Live" and "Final" labels current if the page stays open.
    setInterval(render, 5 * 60e3);
  } catch (err) {
    $("games").innerHTML = `<p class="empty">Couldn't load the schedule (${escapeHtml(err.message)}). Try refreshing.</p>`;
  }
}

init();

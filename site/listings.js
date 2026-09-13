// What the local CBS and FOX stations in a ZIP code are actually airing.
// Uses Gracenote's TV-listings service (the data behind zap2it-style grids).
// It's not an official API, so everything here fails soft.

const API = "https://tvlistings.gracenote.com";
const AID = "orbebb";
const CACHE_KEY = "gameday-guide:listings";
const CACHE_TTL_MS = 6 * 3600e3;
const WINDOW_HOURS = 6; // the grid endpoint rejects longer spans

const NETWORKS = { "CBS TELEVISION NETWORK": "CBS", "FOX ENTERTAINMENT": "FOX" };

// ---------- market lookup ----------

// Finds the TV market for a ZIP code: { zip, name, headendId }.
export async function lookupMarket(zip) {
  const res = await fetch(`${API}/gapzap_webapi/api/Providers/getPostalCodeProviders/USA/${zip}/${AID}/en-us`);
  if (!res.ok) throw new Error(`The TV-listings service returned ${res.status}.`);
  const data = await res.json();
  const providers = (data.Providers ?? []).filter(
    (p) => p.postalCode === zip && (p.type === "SATELLITE" || p.type === "CABLE"),
  );
  // DIRECTV lineups are named after the market ("DIRECTV Detroit") and carry
  // that market's local stations, which is all we need.
  const provider = providers.find((p) => p.headendId.startsWith("DITV")) ?? providers[0];
  if (!provider) throw new Error(`No TV listings found for ZIP ${zip}.`);
  return { zip, name: provider.location || zip, headendId: provider.headendId };
}

// ---------- listings ----------

export function parseMatchup(text) {
  const m = (text ?? "").match(/^(.+?)\s+(?:at|vs\.?|@)\s+(.+)$/i);
  return m ? [m[1].trim(), m[2].trim()] : null;
}

// Turns a grid response into [{ network, station, start, teams }].
export function parseGrid(data) {
  const shows = [];
  const seen = new Set();
  for (const channel of data.channels ?? []) {
    const network = NETWORKS[(channel.affiliateName ?? "").toUpperCase()];
    if (!network) continue;
    for (const event of channel.events ?? []) {
      const program = event.program ?? {};
      if (!/^NFL Football\b/i.test(program.title ?? "")) continue;
      const teams = parseMatchup(program.episodeTitle) ?? parseMatchup((program.title ?? "").split(":")[1]);
      const key = `${network}|${event.startTime}|${teams?.join("|") ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      shows.push({
        network,
        station: (channel.callSign ?? "").replace(/DT\d*$/, ""),
        start: event.startTime,
        teams,
      });
    }
  }
  return shows;
}

async function fetchWindow(market, startMs) {
  const url = new URL(`${API}/api/grid`);
  const params = {
    lineupId: "",
    timespan: String(WINDOW_HOURS),
    headendId: market.headendId,
    country: "USA",
    timezone: "",
    device: "X",
    postalCode: market.zip,
    isOverride: "true",
    time: String(Math.floor(startMs / 3600e3) * 3600),
    pref: "16,128",
    userId: "-",
    aid: AID,
    languagecode: "en-us",
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (res.status === 400) return null; // beyond the listings horizon
  if (!res.ok) throw new Error(`The TV-listings service returned ${res.status}.`);
  return parseGrid(await res.json());
}

// Fetches local CBS/FOX NFL shows covering kickoffs between firstMs and lastMs.
// Returns { available, shows }. available=false means the matchups for those
// dates aren't published yet: either the service has no listings that far out,
// or it only has "NFL Football" placeholders with no teams named.
export async function fetchListings(market, firstMs, lastMs) {
  const shows = [];
  let start = Math.floor(firstMs / 3600e3) * 3600e3;
  while (start <= lastMs) {
    const batch = await fetchWindow(market, start);
    if (batch === null) return { available: false, shows: [] };
    shows.push(...batch);
    start += WINDOW_HOURS * 3600e3;
  }
  return { available: hasMatchups(shows), shows };
}

export function hasMatchups(shows) {
  return shows.some((s) => s.teams);
}

// ---------- matching to ESPN games ----------

const normalize = (s) => s.toLowerCase().replace(/[^a-z]/g, "");
const nickname = (s) => normalize(s.trim().split(/\s+/).at(-1));

function sameTeam(listed, team) {
  const n = normalize(listed);
  return n === normalize(team.fullName) || n === normalize(team.name) || nickname(listed) === nickname(team.fullName);
}

// Returns Map<gameId, { station, network }> for games airing on a local station.
export function matchShows(shows, games) {
  const matches = new Map();
  for (const show of shows) {
    if (!show.teams) continue;
    const game = games.find(
      (g) =>
        g.channels.includes(show.network) &&
        !matches.has(g.id) &&
        ((sameTeam(show.teams[0], g.away) && sameTeam(show.teams[1], g.home)) ||
          (sameTeam(show.teams[0], g.home) && sameTeam(show.teams[1], g.away))),
    );
    if (game) matches.set(game.id, { station: show.station, network: show.network });
  }
  return matches;
}

// ---------- cache (per device) ----------

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY)) ?? {};
  } catch {
    return {};
  }
}

export function cachedListings(market, dateKey) {
  const entry = readCache()[`${market.zip}|${dateKey}`];
  if (!entry || Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;
  return entry;
}

export function rememberListings(market, dateKey, result) {
  try {
    const cache = readCache();
    for (const key of Object.keys(cache)) if (Date.now() - cache[key].fetchedAt > 7 * 24 * 3600e3) delete cache[key];
    cache[`${market.zip}|${dateKey}`] = { ...result, fetchedAt: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

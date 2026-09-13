// Downloads the full NFL and FBS college schedules from ESPN and writes
// site/data/games.json for the page to read.
import { mkdir, writeFile } from "node:fs/promises";
import { CHANNELS } from "../site/config.js";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/football";
const LEAGUES = [
  { key: "nfl", path: "nfl", params: {} },
  { key: "cfb", path: "college-football", params: { groups: "80" } }, // 80 = FBS
];
const SEASON_TYPES = new Set(["2", "3"]); // regular season, postseason
const OUT_DIR = new URL("../site/data/", import.meta.url);

function scoreboardUrl(league, params) {
  const url = new URL(`${BASE}/${league.path}/scoreboard`);
  // ESPN quietly falls back to 25 results when limit is above 500.
  for (const [key, value] of Object.entries({ ...league.params, ...params, limit: "500" })) {
    url.searchParams.set(key, value);
  }
  return url;
}

async function getJson(url, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= attempts) throw new Error(`Failed to fetch ${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

function team(competition, side) {
  const competitor = competition.competitors.find((c) => c.homeAway === side);
  const t = competitor.team;
  const rank = competitor.curatedRank?.current;
  return {
    id: t.id,
    name: t.shortDisplayName ?? t.name ?? "TBD",
    fullName: t.displayName ?? t.shortDisplayName ?? "TBD",
    abbr: t.abbreviation ?? "",
    logo: t.logo ?? null,
    rank: rank && rank < 99 ? rank : null,
  };
}

function normalize(event, leagueKey, weekLabel) {
  const competition = event.competitions[0];
  const channels = (competition.broadcasts ?? []).flatMap((b) => b.names ?? []);
  return {
    id: event.id,
    league: leagueKey,
    date: event.date,
    timeTBD: competition.timeValid === false,
    state: event.status?.type?.state ?? "pre",
    seasonType: event.season?.type,
    week: weekLabel,
    away: team(competition, "away"),
    home: team(competition, "home"),
    channels: [...new Set(channels)],
    neutralSite: Boolean(competition.neutralSite),
    note: competition.notes?.[0]?.headline ?? null,
  };
}

async function fetchLeague(league) {
  const current = await getJson(scoreboardUrl(league, {}));
  const season = current.season?.year ?? current.leagues[0].season.year;
  const games = new Map();
  for (const period of current.leagues[0].calendar) {
    if (!SEASON_TYPES.has(period.value)) continue;
    for (const week of period.entries ?? []) {
      const data = await getJson(scoreboardUrl(league, { dates: season, seasontype: period.value, week: week.value }));
      for (const event of data.events ?? []) games.set(event.id, normalize(event, league.key, week.label));
    }
  }
  if (games.size === 0) throw new Error(`No ${league.key} games found for ${season}`);
  console.log(`${league.key}: ${games.size} games (${season} season)`);
  return { season, games: [...games.values()] };
}

const results = {};
for (const league of LEAGUES) results[league.key] = await fetchLeague(league);

const games = Object.values(results)
  .flatMap((r) => r.games)
  .sort((a, b) => a.date.localeCompare(b.date));

const unknown = [...new Set(games.flatMap((g) => g.channels))].filter((c) => !CHANNELS[c]);
if (unknown.length) console.warn(`Channels missing from site/config.js: ${unknown.join(", ")}`);

await mkdir(OUT_DIR, { recursive: true });
await writeFile(
  new URL("games.json", OUT_DIR),
  JSON.stringify({
    updatedAt: new Date().toISOString(),
    seasons: Object.fromEntries(Object.entries(results).map(([k, r]) => [k, r.season])),
    games,
  }),
);
console.log(`Wrote ${games.length} games to site/data/games.json`);

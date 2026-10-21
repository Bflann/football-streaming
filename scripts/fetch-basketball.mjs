// Downloads NBA and Division I men's college basketball schedules from ESPN
// and writes site/data/basketball.json for the basketball page to read.
// ESPN's scoreboard rejects date ranges, so this fetches one day at a time.
import { mkdir, writeFile } from "node:fs/promises";
import { CHANNELS } from "../site/config.js";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball";
const OUT_DIR = new URL("../site/data/", import.meta.url);
const CONCURRENCY = 6;

// The season that's in progress (or about to start) as of today.
const today = new Date();
const startYear = today.getUTCMonth() >= 7 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;

const LEAGUES = [
  { key: "nba", path: "nba", params: {}, from: `${startYear}-10-15`, to: `${startYear + 1}-06-30` },
  { key: "cbb", path: "mens-college-basketball", params: { groups: "50" }, from: `${startYear}-10-20`, to: `${startYear + 1}-04-10` }, // 50 = Division I
];

function* days(from, to) {
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    yield d.toISOString().slice(0, 10).replaceAll("-", "");
  }
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

function normalize(event, leagueKey) {
  const competition = event.competitions[0];
  const channels = (competition.broadcasts ?? []).flatMap((b) => b.names ?? []);
  return {
    id: event.id,
    league: leagueKey,
    date: event.date,
    timeTBD: competition.timeValid === false,
    state: event.status?.type?.state ?? "pre",
    seasonType: event.season?.type,
    away: team(competition, "away"),
    home: team(competition, "home"),
    channels: [...new Set(channels)],
    neutralSite: Boolean(competition.neutralSite),
    note: competition.notes?.[0]?.headline ?? null,
  };
}

async function fetchLeague(league) {
  const dates = [...days(league.from, league.to)];
  const games = new Map();
  let next = 0;
  async function worker() {
    while (next < dates.length) {
      const date = dates[next++];
      const url = new URL(`${BASE}/${league.path}/scoreboard`);
      for (const [key, value] of Object.entries({ ...league.params, dates: date, limit: "500" })) url.searchParams.set(key, value);
      const data = await getJson(url);
      for (const event of data.events ?? []) {
        if (event.competitions?.[0]?.competitors?.length === 2) games.set(event.id, normalize(event, league.key));
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (games.size === 0) throw new Error(`No ${league.key} games found for ${startYear}-${startYear + 1}`);
  console.log(`${league.key}: ${games.size} games (${startYear}-${String(startYear + 1).slice(2)} season)`);
  return [...games.values()];
}

const all = (await Promise.all(LEAGUES.map(fetchLeague))).flat().sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

// NBA rosters (for the page's player filter): who plays for which team, and who's hurt.
const teamList = await getJson(`${BASE}/nba/teams`);
const nbaTeams = teamList.sports[0].leagues[0].teams.map((t) => t.team.id);
const players = [];
for (let i = 0; i < nbaTeams.length; i += CONCURRENCY) {
  const rosters = await Promise.all(nbaTeams.slice(i, i + CONCURRENCY).map((id) => getJson(`${BASE}/nba/teams/${id}/roster`)));
  rosters.forEach((roster, j) => {
    for (const a of roster.athletes ?? []) {
      players.push({
        id: a.id,
        name: a.displayName ?? a.fullName,
        team: nbaTeams[i + j],
        pos: a.position?.abbreviation ?? "",
        injury: a.injuries?.[0]?.status ?? null,
      });
    }
  });
}
players.sort((a, b) => a.name.localeCompare(b.name));

const unknown = [...new Set(all.flatMap((g) => g.channels))].filter((c) => !CHANNELS[c]);
if (unknown.length) console.warn(`Channels missing from site/config.js: ${unknown.join(", ")}`);

await mkdir(OUT_DIR, { recursive: true });
await writeFile(
  new URL("basketball.json", OUT_DIR),
  JSON.stringify({ updatedAt: new Date().toISOString(), season: startYear + 1, games: all }),
);
await writeFile(new URL("nba-players.json", OUT_DIR), JSON.stringify({ updatedAt: new Date().toISOString(), players }));
console.log(`Wrote ${players.length} NBA players to site/data/nba-players.json`);
console.log(`Wrote ${all.length} games to site/data/basketball.json`);

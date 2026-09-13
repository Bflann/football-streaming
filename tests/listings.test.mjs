import assert from "node:assert/strict";
import { test } from "node:test";
import { hasMatchups, matchShows, parseGrid, parseMatchup } from "../site/listings.js";

const team = (fullName, abbr) => ({ id: abbr, abbr, name: fullName.split(" ").at(-1), fullName, logo: null, rank: null });
const games = [
  { id: "1", channels: ["FOX"], away: team("New Orleans Saints", "NO"), home: team("Detroit Lions", "DET") },
  { id: "2", channels: ["CBS"], away: team("Buffalo Bills", "BUF"), home: team("Houston Texans", "HOU") },
  { id: "3", channels: ["FOX"], away: team("Washington Commanders", "WSH"), home: team("Philadelphia Eagles", "PHI") },
  { id: "4", channels: ["CBS"], away: team("Miami Dolphins", "MIA"), home: team("Las Vegas Raiders", "LV") },
];

const grid = {
  channels: [
    {
      callSign: "WJBKDT",
      affiliateName: "FOX ENTERTAINMENT",
      events: [
        { startTime: "2026-09-13T16:00:00Z", program: { title: "FOX NFL Sunday" } },
        { startTime: "2026-09-13T17:00:00Z", program: { title: "NFL Football", episodeTitle: "New Orleans Saints at Detroit Lions" } },
        { startTime: "2026-09-13T20:25:00Z", program: { title: "NFL Football", episodeTitle: "Washington Commanders at Philadelphia Eagles" } },
        { startTime: "2026-09-13T23:30:00Z", program: { title: "NFL on FOX Postgame" } },
      ],
    },
    // Same station's SD feed: must not produce duplicates.
    {
      callSign: "WJBK",
      affiliateName: "FOX ENTERTAINMENT",
      events: [{ startTime: "2026-09-13T17:00:00Z", program: { title: "NFL Football", episodeTitle: "New Orleans Saints at Detroit Lions" } }],
    },
    {
      callSign: "WWJDT",
      affiliateName: "CBS TELEVISION NETWORK",
      events: [
        { startTime: "2026-09-13T16:00:00Z", program: { title: "The NFL Today" } },
        { startTime: "2026-09-13T17:00:00Z", program: { title: "NFL Football", episodeTitle: "Buffalo Bills at Houston Texans" } },
        { startTime: "2026-09-20T17:00:00Z", program: { title: "NFL Football" } }, // matchup not posted yet
      ],
    },
    { callSign: "WDIVDT", affiliateName: "NATIONAL BROADCASTING COMPANY", events: [{ startTime: "2026-09-14T00:20:00Z", program: { title: "NFL Football", episodeTitle: "x at y" } }] },
  ],
};

test("parseMatchup handles at / vs / @", () => {
  assert.deepEqual(parseMatchup("Buffalo Bills at Houston Texans"), ["Buffalo Bills", "Houston Texans"]);
  assert.deepEqual(parseMatchup("Jacksonville Jaguars vs. Los Angeles Rams"), ["Jacksonville Jaguars", "Los Angeles Rams"]);
  assert.equal(parseMatchup("Week 1"), null);
  assert.equal(parseMatchup(undefined), null);
});

test("parseGrid keeps only CBS/FOX game broadcasts, deduped", () => {
  const shows = parseGrid(grid);
  assert.deepEqual(
    shows.map((s) => [s.network, s.station, s.start.slice(11, 16), s.teams?.[1] ?? null]),
    [
      ["FOX", "WJBK", "17:00", "Detroit Lions"],
      ["FOX", "WJBK", "20:25", "Philadelphia Eagles"],
      ["CBS", "WWJ", "17:00", "Houston Texans"],
      ["CBS", "WWJ", "17:00", null],
    ],
  );
});

test("matchShows maps local broadcasts to ESPN games on the same network", () => {
  const matches = matchShows(parseGrid(grid), games);
  assert.deepEqual([...matches.keys()].sort(), ["1", "2", "3"]);
  assert.deepEqual(matches.get("1"), { station: "WJBK", network: "FOX" });
  assert.equal(matches.has("4"), false);
});

test("placeholder listings with no teams don't count as published", () => {
  assert.equal(hasMatchups(parseGrid(grid)), true);
  const placeholders = { channels: [{ callSign: "WWJDT", affiliateName: "CBS TELEVISION NETWORK", events: [{ startTime: "2026-09-27T17:00:00Z", program: { title: "NFL Football" } }] }] };
  assert.equal(hasMatchups(parseGrid(placeholders)), false);
});

test("matchShows tolerates nickname-only and flipped listings", () => {
  const shows = [{ network: "CBS", station: "WFOR", start: "", teams: ["Raiders", "Dolphins"] }];
  assert.equal(matchShows(shows, games).get("4")?.station, "WFOR");
});

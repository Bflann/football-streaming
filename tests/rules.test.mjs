import assert from "node:assert/strict";
import { test } from "node:test";
import { dateKeyET, howToWatch } from "../site/rules.js";

const team = (abbr, id = abbr) => ({ id, abbr, name: abbr, fullName: abbr, logo: null, rank: null });
const nflGame = (overrides) => ({
  id: "g1",
  league: "nfl",
  seasonType: 2,
  timeTBD: false,
  date: "2026-09-13T17:00Z", // Sunday 1:00 PM ET
  away: team("NO"),
  home: team("DET"),
  channels: ["FOX"],
  ...overrides,
});

const local = (games, dates = ["2026-09-13"]) => ({ games: new Map(Object.entries(games)), dates: new Set(dates) });
const detroitHulu = { huluHome: true, local: local({ g1: { station: "WJBK", network: "FOX" } }) };
const detroitOther = { huluHome: false, local: local({ g1: { station: "WJBK", network: "FOX" } }) };
const chicagoOther = { huluHome: false, local: local({}) };
const noListingsYet = { huluHome: false, local: local({}, []) };
const noLocation = { huluHome: false, local: null };

test("dateKeyET groups by Eastern-time date", () => {
  assert.equal(dateKeyET("2026-09-13T17:00Z"), "2026-09-13");
  assert.equal(dateKeyET("2026-09-14T00:20Z"), "2026-09-13"); // 8:20 PM ET Sunday
});

test("game on a local station is a blackout and uses that station's app", () => {
  const home = howToWatch(nflGame(), detroitHulu);
  assert.equal(home.status, "blackout");
  assert.equal(home.station, "WJBK");
  assert.equal(home.options[0].app, "Hulu app");
  const other = howToWatch(nflGame(), detroitOther);
  assert.equal(other.status, "blackout");
  assert.equal(other.options[0].app, "FOX Sports app");
});

test("game not on a local station is on Sunday Ticket", () => {
  const result = howToWatch(nflGame(), chicagoOther);
  assert.equal(result.status, "sunday-ticket");
  assert.deepEqual(result.options.map((o) => o.app), ["YouTube app"]);
});

test("Sunday listings not published yet, or no location set", () => {
  assert.equal(howToWatch(nflGame(), noListingsYet).status, "listings-pending");
  assert.equal(howToWatch(nflGame(), noLocation).status, "unknown-market");
  assert.equal(howToWatch(nflGame({ date: "2026-09-14T00:20Z", channels: ["NBC"] }), noLocation).status, "ok");
});

test("primetime and weekday games are not Sunday Ticket", () => {
  const snf = nflGame({ date: "2026-09-14T00:20Z", channels: ["NBC"] }); // Sun 8:20 PM ET
  assert.equal(howToWatch(snf, chicagoOther).options[0].app, "NBC Sports app");
  const thanksgiving = nflGame({ date: "2026-11-26T18:00Z", channels: ["CBS"] }); // Thursday
  assert.equal(howToWatch(thanksgiving, chicagoOther).status, "ok");
  assert.equal(howToWatch(thanksgiving, detroitHulu).options[0].app, "Hulu app");
});

test("streaming games use the streaming app for everyone", () => {
  const tnf = nflGame({ date: "2026-09-18T00:15Z", channels: ["Prime Video"] });
  assert.equal(howToWatch(tnf, detroitHulu).options[0].app, "Prime Video app");
  assert.equal(howToWatch(tnf, chicagoOther).options[0].app, "Prime Video app");
});

test("college games ignore Sunday Ticket and dedupe apps", () => {
  const game = { ...nflGame({ channels: ["ABC", "ESPN", "ESPN+"] }), league: "cfb" };
  const result = howToWatch(game, chicagoOther);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.options.map((o) => o.app), ["ESPN app"]);
});

test("missing and unknown channels", () => {
  assert.equal(howToWatch(nflGame({ channels: [] }), chicagoOther).status, "tba");
  const unknown = howToWatch(nflGame({ league: "cfb", channels: ["MW+"] }), chicagoOther);
  assert.equal(unknown.options[0].unknown, true);
});

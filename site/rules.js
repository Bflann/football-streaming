// Decides how a given viewer should watch a given game, using config.js.
import { CHANNELS, SUNDAY_TICKET } from "./config.js";

const easternParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "numeric",
  hourCycle: "h23",
});
const easternDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// "YYYY-MM-DD" in Eastern time; used to group games by NFL Sunday.
export function dateKeyET(date) {
  return easternDate.format(new Date(date));
}

export function channelLabel(channel) {
  return CHANNELS[channel]?.label ?? channel;
}

function watchOn(channel, viewer) {
  const entry = CHANNELS[channel];
  if (!entry) {
    return { channel, app: `${channel}`, detail: `Look for ${channel} in its own app`, unknown: true };
  }
  const step = (viewer.huluHome && entry.huluHome) || entry.everyone;
  return { channel, app: step.app, detail: step.detail.replace("{channel}", entry.label) };
}

export function isSundayTicketGame(game) {
  if (game.league !== "nfl" || game.seasonType !== 2 || game.timeTBD) return false;
  if (!game.channels.some((c) => SUNDAY_TICKET.channels.includes(c))) return false;
  const parts = Object.fromEntries(easternParts.formatToParts(new Date(game.date)).map((p) => [p.type, p.value]));
  return parts.weekday === "Sun" && Number(parts.hour) < SUNDAY_TICKET.lastKickoffHourET;
}

// viewer: {
//   huluHome: boolean,
//   local: null | {                       null until a location is set
//     games: Map<gameId, { station, network }>,  games on a local station
//     dates: Set<"YYYY-MM-DD">,           Sundays whose listings were checked
//   },
// }
// Returns { status, options, station? } where status is one of
//   "tba"              no channel announced yet
//   "blackout"         on a local station, so blacked out on Sunday Ticket
//   "sunday-ticket"    not on a local station: it's on Sunday Ticket
//   "listings-pending" local listings for that Sunday aren't published yet
//   "unknown-market"   viewer has no location set
//   "ok"               everything else (national TV / streaming)
export function howToWatch(game, viewer) {
  if (game.channels.length === 0) return { status: "tba", options: [] };

  if (isSundayTicketGame(game)) {
    const sundayTicket = { channel: SUNDAY_TICKET.label, ...SUNDAY_TICKET.watch };
    const local = viewer.local;
    if (!local) return { status: "unknown-market", options: [sundayTicket] };
    const airing = local.games.get(game.id);
    if (airing) {
      return { status: "blackout", station: airing.station, options: [watchOn(airing.network, viewer)] };
    }
    if (!local.dates.has(dateKeyET(game.date))) return { status: "listings-pending", options: [sundayTicket] };
    return { status: "sunday-ticket", options: [sundayTicket] };
  }

  const options = [];
  for (const channel of game.channels) {
    const option = watchOn(channel, viewer);
    if (!options.some((o) => o.app === option.app)) options.push(option);
  }
  return { status: "ok", options };
}

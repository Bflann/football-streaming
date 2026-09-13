// ============================================================================
//  Game Day Guide settings
//  This is the only file you should need to edit to change what the page says.
// ============================================================================

// Teams pinned to the top of the page. IDs are ESPN's team IDs.
export const FAVORITE_TEAMS = [
  { league: "nfl", id: "8", label: "Lions" },
  { league: "cfb", id: "130", label: "Michigan" },
];

// ----------------------------------------------------------------------------
//  How to watch each channel
//  Keys are the channel names exactly as ESPN lists them. `huluHome` is what
//  the Hulu home household sees; `everyone` is what everyone else sees (and
//  what the Hulu home sees when there's no `huluHome` entry).
//  "{channel}" in a detail is replaced with the channel's label.
// ----------------------------------------------------------------------------

const hulu = { app: "Hulu app", detail: "Live TV guide → {channel}" };
const huluSignIn = (app) => ({ app, detail: "Choose Hulu as your TV provider and use the household login" });
const sharedLogin = (app) => ({ app, detail: "Use the shared household login" });

const tv = (label, app) => ({ label, huluHome: hulu, everyone: huluSignIn(app) });
const streaming = (label, app) => ({ label, everyone: sharedLogin(app) });

export const CHANNELS = {
  // Broadcast networks
  CBS: tv("CBS", "CBS app"),
  FOX: tv("FOX", "FOX Sports app"),
  NBC: tv("NBC", "NBC Sports app"),
  ABC: tv("ABC", "ESPN app"),

  // Cable networks
  ESPN: tv("ESPN", "ESPN app"),
  ESPN2: tv("ESPN2", "ESPN app"),
  "NFL Net": tv("NFL Network", "NFL app"),
  BTN: tv("Big Ten Network", "FOX Sports app"),

  // Best guesses: these weren't on the list we confirmed. Double-check them.
  ESPNU: tv("ESPNU", "ESPN app"),
  ESPNEWS: tv("ESPNews", "ESPN app"),
  "SEC Network": tv("SEC Network", "ESPN app"),
  "ACC Network": tv("ACC Network", "ESPN app"),
  FS1: tv("FS1", "FOX Sports app"),
  FS2: tv("FS2", "FOX Sports app"),
  CBSSN: tv("CBS Sports Network", "CBS Sports app"),
  CW: tv("The CW", "The CW app"),
  TNT: tv("TNT", "HBO Max app"),
  truTV: tv("truTV", "HBO Max app"),
  "USA Net": tv("USA Network", "USA Network app"),

  // Streaming services
  "Prime Video": streaming("Prime Video", "Prime Video app"),
  Netflix: streaming("Netflix", "Netflix app"),
  Peacock: streaming("Peacock", "Peacock app"),
  YouTube: streaming("YouTube", "YouTube app"),
  "ESPN+": streaming("ESPN+", "ESPN app"),
  "SECN+": streaming("SEC Network+", "ESPN app"),
  ACCNX: streaming("ACC Network Extra", "ESPN app"),
  "Disney+": streaming("Disney+", "Disney+ app"),
};

// Sunday-afternoon NFL games on these networks are on Sunday Ticket, except
// the ones the viewer's local CBS/FOX stations are airing (those are blacked
// out on Sunday Ticket; the page checks the local listings to find them).
export const SUNDAY_TICKET = {
  label: "NFL Sunday Ticket",
  channels: ["CBS", "FOX"],
  lastKickoffHourET: 19, // games kicking off at/after 7 PM ET are primetime
  watch: { app: "YouTube app", detail: "NFL Sunday Ticket, using the shared household login" },
};

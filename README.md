# Game Day Guide

A web page listing every NFL and FBS college football game, with instructions for how to watch each one. The instructions depend on where the viewer is watching from and whether they're at the Hulu home.

- **Lions and Michigan** are pinned under "Next up".
- **Filters:** league, College Top 25, finished games, and search. Searching or turning on the favorites filter shows the whole season.
- **Settings stay on each device.** Everyone enters their ZIP code once (or "Use my location") on their own phone or computer.
- **Real blackout info.** For each NFL Sunday, the page looks up what the viewer's local CBS and FOX stations are actually airing and marks those games **on your local station** (Sunday Ticket doesn't carry them in-market), pointing to the station's app. Everything else on Sunday afternoon is on Sunday Ticket. A panel at the top lists that Sunday's local games.

## How it works

| Piece | What it does |
| --- | --- |
| [site/config.js](site/config.js) | **The file to edit.** Favorite teams, locations, and which app to use for each channel. |
| [site/listings.js](site/listings.js) | Looks up the TV market for a ZIP code and what its local CBS/FOX stations are airing, from Gracenote's TV-listings service (the data behind zap2it-style grids). Matches those listings to the schedule. |
| [site/market.js](site/market.js) | Turns "Use my location" or a typed city into a ZIP code (via OpenStreetMap's Nominatim), then into a market. |
| [site/rules.js](site/rules.js) | Picks the right instructions for a viewer and game, including Sunday Ticket vs. blacked-out local games. |
| [scripts/fetch-schedule.mjs](scripts/fetch-schedule.mjs) | Downloads the season schedule from ESPN into `site/data/games.json`. |
| [.github/workflows/deploy.yml](.github/workflows/deploy.yml) | Every 3 hours, and on every push, refreshes the schedule and publishes the site to GitHub Pages. |

The Sunday Ticket rule: an NFL regular-season game on CBS or FOX that kicks off on Sunday before 7 PM ET is a Sunday Ticket game. For each such Sunday, the page fetches the viewer's local CBS and FOX listings (live, in the browser; cached on the device for 6 hours) and matches the listed matchups to the schedule. Games on a local station point to that station's app (or Hulu at the Hulu home); the rest say Sunday Ticket on YouTube.

Listings are published roughly a week ahead. For Sundays further out, the page says so instead of guessing. The listings service isn't an official API; if it ever stops working, those games fall back to the same "not published yet" message.

## Put it online (one time)

1. Create a new repository on GitHub and push this folder to its `main` branch.
2. In the repository, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Go to **Actions → Update schedule and deploy → Run workflow**, or just push a commit.
4. The site appears at `https://<your-username>.github.io/<repo-name>/`. Share that link with the family.

GitHub turns off scheduled workflows in repositories with no activity for 60 days. If the schedule stops updating after the offseason, re-enable the workflow on the Actions tab or push any commit.

## Run it locally

```bash
npm run fetch
```

```bash
npm run serve
```

Then open http://localhost:8000. Run the rule tests with `npm test`. Node 22+ is required; there are no dependencies to install.

## Common edits

- **Change an app for a channel:** edit its line in `CHANNELS` in `site/config.js`.
- **New channel shows up:** the fetch step prints `Channels missing from site/config.js: …`. Add an entry for it; until then the page tells people to look for that channel's own app.
- **Blackouts look wrong for someone:** the page uses the DIRECTV lineup for their ZIP code, which carries that market's local stations. Have them check the "On your local stations" panel against what their FOX/CBS station is actually showing.
- **Add a favorite team:** add it to `FAVORITE_TEAMS`. You can find the team's ID in its ESPN team page URL (for example `.../team/_/id/130/michigan-wolverines`).

// Turns what the viewer typed (or their device location) into a TV market.
import { lookupMarket } from "./listings.js";

const NOMINATIM = "https://nominatim.openstreetmap.org";

async function nominatim(path, params) {
  const url = new URL(`${NOMINATIM}/${path}`);
  for (const [k, v] of Object.entries({ format: "jsonv2", addressdetails: "1", countrycodes: "us", ...params })) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Location service returned ${res.status}`);
  return res.json();
}

async function zipForCoords(lat, lon) {
  const result = await nominatim("reverse", { lat, lon, zoom: "18" });
  const zip = (result.address?.postcode ?? "").slice(0, 5);
  if (!/^\d{5}$/.test(zip)) throw new Error("Couldn't work out a ZIP code for that spot. Type your ZIP instead.");
  return zip;
}

// Looks up a ZIP code, or a city ("Grand Rapids, MI") which is turned into one.
export async function findMarket(query) {
  const q = query.trim();
  if (!q) throw new Error("Type a ZIP code or a city.");
  if (/^\d{5}$/.test(q)) return lookupMarket(q);
  const results = await nominatim("search", { q, limit: "1" });
  if (!results.length) throw new Error(`Couldn't find "${q}". Try a city and state, or a ZIP code.`);
  return lookupMarket(await zipForCoords(results[0].lat, results[0].lon));
}

// Uses the device's location.
export function locateMarket() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This device can't share its location."));
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          resolve(await lookupMarket(await zipForCoords(coords.latitude, coords.longitude)));
        } catch (err) {
          reject(err);
        }
      },
      () => reject(new Error("Location access was turned down. Type a ZIP code instead.")),
      { timeout: 10000, maximumAge: 600000 },
    );
  });
}

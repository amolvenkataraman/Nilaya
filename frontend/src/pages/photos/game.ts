// Geoguessr scoring (tested in game.test.ts); distances come from lib/map/geo.

/** GeoGuessr-style score: 5000 for a perfect guess, about 1840 at 2000 km. */
export const score = (m: number) => Math.round(5000 * Math.exp(-m / 1000 / 2000))

/** Classic colours: close under 10 km, far over 100 km. */
export const closeness = (m: number): 'close' | 'far' | 'mid' => (m < 10_000 ? 'close' : m > 100_000 ? 'far' : 'mid')

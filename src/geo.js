// Small geometry helpers shared by the app and the precompute script (scripts/).
// Map metres: x = east, y = north, origin at the kit centre.

// Metres per degree at the latitude of the kit centre. Over 2 km the error is far below 1 m.
export function makeProjection([lon0, lat0]) {
  const phi = (lat0 * Math.PI) / 180
  const mPerLat = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi)
  const mPerLon = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi)
  return ([lon, lat]) => [(lon - lon0) * mPerLon, (lat - lat0) * mPerLat]
}

// A ring of [x, y] points, without the repeated closing point.
export function openRing(ring) {
  const n = ring.length
  if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) return ring.slice(0, -1)
  return ring
}

export function pointInRing(x, y, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// Inside the outer ring and outside every hole.
export function pointInPolygon(x, y, [outer, ...holes]) {
  return pointInRing(x, y, outer) && !holes.some((h) => pointInRing(x, y, h))
}

export function distToSegment(x, y, [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0
  return Math.hypot(x - ax - t * dx, y - ay - t * dy)
}

// A small seeded random generator, so the same seed always gives the same result.
export function seededRandom(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Points every `step` metres along a polyline, starting half a step in.
export function pointsAlong(line, step) {
  const out = []
  let carry = step / 2
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1]
    const [bx, by] = line[i]
    const len = Math.hypot(bx - ax, by - ay)
    let s = carry
    while (s <= len) {
      const t = s / len
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t])
      s += step
    }
    carry = s - len
  }
  return out
}

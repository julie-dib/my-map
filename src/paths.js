// Paths for people in Around 2050 and Around 2100 (scenario.paths), shared by the app and the
// precompute script (scripts/), so the planting keeps off exactly the path that is drawn.
// Map metres: x = east, y = north. "Left" of a street is to the left when walking from its
// first point to its last.
import { SpatialGrid } from './grid.js'
import { seededRandom } from './geo.js'
import { FIGURE_GAP_M, JUNCTION_CLEARANCE_M } from './look.js'

// A street line as a walkable path: the point and direction at distance s from its start.
export function walker(line) {
  const cum = [0]
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]))
  const length = cum[cum.length - 1]
  const at = (s) => {
    let i = 1
    while (i < line.length - 1 && cum[i] < s) i++
    const seg = cum[i] - cum[i - 1] || 1
    const t = Math.max(0, Math.min(1, (s - cum[i - 1]) / seg))
    const [ax, ay] = line[i - 1]
    const [bx, by] = line[i]
    return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, ux: (bx - ax) / seg, uy: (by - ay) / seg }
  }
  return { length, at }
}

// The spot at distance s along the street, `lateral` metres to the left (+) or right (-).
export function spotAt(w, s, lateral) {
  const p = w.at(s)
  return [p.x - p.uy * lateral, p.y + p.ux * lateral]
}

const SAMPLE_M = 2

// One curving path per street. Its centre line is the street line shifted sideways by a slow
// wave of up to curve_amplitude_m; the shift fades to nothing at both ends, so the paths of
// neighbouring streets meet at the junctions.
// Returns, per street: { walk, shift(s), line } with shift the sideways offset at distance s
// along the street and line the curved centre line as [x, y] points every 2 m.
export function curvedPaths(streets, scenario) {
  const p = scenario.paths
  const rand = seededRandom(scenario.random_seed + 61)
  return streets.map((street) => {
    const walk = walker(street)
    const L = walk.length
    const wave = p.curve_wavelength_m[0] + (p.curve_wavelength_m[1] - p.curve_wavelength_m[0]) * rand()
    const phase = rand() * Math.PI * 2
    const sign = rand() < 0.5 ? 1 : -1
    // Smooth fade over half a wavelength at each end.
    const ramp = wave / 2
    const fade = (s) => {
      const t = Math.max(0, Math.min(1, s / ramp, (L - s) / ramp))
      return t * t * (3 - 2 * t)
    }
    const shift = (s) => sign * p.curve_amplitude_m * Math.sin((2 * Math.PI * s) / wave + phase) * fade(s)
    const n = Math.max(1, Math.ceil(L / SAMPLE_M))
    const line = []
    for (let i = 0; i <= n; i++) {
      const s = (L * i) / n
      line.push(spotAt(walk, s, shift(s)))
    }
    return { walk, shift, line }
  })
}

// Static people, bikes and robots standing on the paths: spots every few metres along the
// curved lines (clear of the junctions), shuffled with the seed, at a random place across the
// path, kept apart. Each figure: { x, y, turn, height: 1 } (turn: facing, radians from east).
export function placeFigures(paths, scenario) {
  const p = scenario.paths
  const rand = seededRandom(scenario.random_seed + 67)
  const spots = []
  for (const path of paths) {
    const { walk, shift } = path
    for (let s = JUNCTION_CLEARANCE_M; s <= walk.length - JUNCTION_CLEARANCE_M; s += 3) {
      const d = walk.at(s)
      spots.push({ walk, shift, s, angle: Math.atan2(d.uy, d.ux) })
    }
  }
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[spots[i], spots[j]] = [spots[j], spots[i]]
  }
  const grid = new SpatialGrid(10)
  const across = p.width_m / 2 - 0.5
  let next = 0
  const take = (count, gap, facing) => {
    const out = []
    while (out.length < count && next < spots.length) {
      const { walk, shift, s, angle } = spots[next++]
      const [x, y] = spotAt(walk, s, shift(s) + (rand() * 2 - 1) * across)
      if (grid.anyWithin(x, y, gap)) continue
      grid.add(x, y, true)
      out.push({ x, y, turn: facing(angle), height: 1 })
    }
    return out
  }
  const along = (angle) => angle + (rand() < 0.5 ? 0 : Math.PI)
  return {
    robots: take(p.robots, FIGURE_GAP_M.robot, along),
    bikes: take(p.bikes, FIGURE_GAP_M.bike, along),
    people: take(p.people, FIGURE_GAP_M.person, () => rand() * Math.PI * 2),
  }
}

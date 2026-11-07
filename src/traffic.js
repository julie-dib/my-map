// Parked cars, buses and bikes for the Today layout, standing on the street segments.
// Counts, colours and the random seed come from scenario.json; sizes and offsets are in look.js.
import { SpatialGrid } from './grid.js'
import { seededRandom } from './geo.js'
import {
  BIKE_SIDE_OFFSET_M,
  BUS_LANE_OFFSET_M,
  BUS_LENGTH_M,
  CAR_LANE_OFFSET_M,
  CAR_LENGTH_M,
  JUNCTION_CLEARANCE_M,
  MAIN_ROAD_SHARE,
} from './look.js'

const lengthOf = (line) => line.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]) : 0), 0)

// Candidate spots every `step` metres along every street, kept clear of the junctions.
// Each spot: { x, y, angle } with angle the street direction (radians, from east towards north).
function spotsAlong(streets, step, clearance) {
  const spots = []
  for (const line of streets)
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = line[i - 1]
      const [bx, by] = line[i]
      const len = Math.hypot(bx - ax, by - ay)
      const first = i === 1 ? clearance : step / 2
      const last = i === line.length - 1 ? len - clearance : len - step / 2
      const angle = Math.atan2(by - ay, bx - ax)
      for (let s = first; s <= last; s += step) {
        const t = s / len
        spots.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t, angle })
      }
    }
  return spots
}

// Shuffle the spots with the seed, then take them in order, skipping any too close to one
// already taken. That spreads the vehicles over the map with random gaps.
function pick(spots, count, rand, sideOffset, minGap, grid) {
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[spots[i], spots[j]] = [spots[j], spots[i]]
  }
  const out = []
  for (const s of spots) {
    if (out.length >= count) break
    // Facing one way or the other along the street; always on the right-hand side.
    const angle = s.angle + (rand() < 0.5 ? 0 : Math.PI)
    const x = s.x + Math.sin(angle) * sideOffset
    const y = s.y - Math.cos(angle) * sideOffset
    if (grid.anyWithin(x, y, minGap)) continue
    grid.add(x, y, true)
    out.push({ x, y, turn: angle, height: 1 })
  }
  return out
}

export function placeTraffic(city) {
  const { cars, buses = 0, bikes } = city.scenario.traffic
  const rand = seededRandom(city.scenario.random_seed + 1)
  const grid = new SpatialGrid(CAR_LENGTH_M * 2)

  // Buses first, so the cars fit in around them: one at every stop (derived/people.json: the
  // street next to each transport building, where the rings float in the later layouts), the
  // rest far apart on the main roads, the longest segments.
  const atStops = city.people.stops.slice(0, buses).map((st) => {
    const angle = st.angle + (rand() < 0.5 ? 0 : Math.PI)
    const x = st.x + Math.sin(angle) * BUS_LANE_OFFSET_M
    const y = st.y - Math.cos(angle) * BUS_LANE_OFFSET_M
    grid.add(x, y, true)
    return { x, y, turn: angle, height: 1 }
  })
  const byLength = [...city.streets].sort((a, b) => lengthOf(b) - lengthOf(a))
  const main = byLength.slice(0, Math.max(1, Math.round(byLength.length * MAIN_ROAD_SHARE)))
  const busList = [...atStops, ...pick(spotsAlong(main, BUS_LENGTH_M * 2, JUNCTION_CLEARANCE_M + BUS_LENGTH_M / 2), buses - atStops.length, rand, BUS_LANE_OFFSET_M, BUS_LENGTH_M * 4, grid)]
  // A bus is long: mark points towards both ends as taken too, so no car stands on it.
  for (const b of busList)
    for (const f of [-0.35, 0.35]) grid.add(b.x + Math.cos(b.turn) * BUS_LENGTH_M * f, b.y + Math.sin(b.turn) * BUS_LENGTH_M * f, true)

  const step = CAR_LENGTH_M * 1.5
  return {
    buses: busList,
    cars: pick(spotsAlong(city.streets, step, JUNCTION_CLEARANCE_M), cars, rand, CAR_LANE_OFFSET_M, CAR_LENGTH_M * 1.3, grid),
    bikes: pick(spotsAlong(city.streets, step, JUNCTION_CLEARANCE_M), bikes, rand, BIKE_SIDE_OFFSET_M, 2, grid),
  }
}

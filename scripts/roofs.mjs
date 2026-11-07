// Green roofs on the service buildings (Around 2100): the roof minus a white rim along its edge,
// and small bushes and flower clumps scattered on the green. Every number comes from
// scenario.json (green_roofs, random_seed).
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js'
import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate.js'
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js'
import { SpatialGrid } from '../src/grid.js'
import { openRing, pointInPolygon, seededRandom } from '../src/geo.js'

const factory = new GeometryFactory()

function jstsRing(ring) {
  const pts = ring.map(([x, y]) => new Coordinate(x, y))
  pts.push(new Coordinate(ring[0][0], ring[0][1]))
  return factory.createLinearRing(pts)
}

// A polygon (outer ring and holes) shrunk inwards by d metres: zero or more polygons.
function inset(rings, d) {
  const [outer, ...holes] = rings
  const poly = factory.createPolygon(jstsRing(outer), holes.filter((h) => h.length >= 3).map(jstsRing))
  // A zero buffer first repairs self-touching outlines; it leaves good ones as they are.
  const g = BufferOp.bufferOp(BufferOp.bufferOp(poly, 0), -d)
  const out = []
  for (let i = 0; i < g.getNumGeometries(); i++) {
    const p = g.getGeometryN(i)
    if (p.getGeometryType() !== 'Polygon' || p.isEmpty()) continue
    const r = [openRing(p.getExteriorRing().getCoordinates().map((c) => [c.x, c.y]))]
    for (let k = 0; k < p.getNumInteriorRing(); k++) r.push(openRing(p.getInteriorRingN(k).getCoordinates().map((c) => [c.x, c.y])))
    out.push({ rings: r, area: p.getArea() })
  }
  return out
}

function box(rings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of rings[0]) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x)
    y0 = Math.min(y0, y); y1 = Math.max(y1, y)
  }
  return [x0, y0, x1, y1]
}

export function computeRoofs(kit) {
  const { scenario, buildings } = kit
  const gr = scenario.green_roofs
  const rand = seededRandom(scenario.random_seed + 41)
  const roofs = []
  const bushes = []
  const flowers = []
  const taken = new SpatialGrid(5)
  let greenArea = 0

  for (const b of buildings) {
    if (!b.service || !b.rings[0] || b.rings[0].length < 3) continue
    const green = inset(b.rings, gr.rim_m)
    if (!green.length) continue // too narrow for a rim and a green inside
    const z = Math.max(b.height, 0.3)
    roofs.push({ z, outline: b.rings, green: green.map((g) => g.rings) })
    const area = green.reduce((s, g) => s + g.area, 0)
    greenArea += area

    // Scatter bushes and flower clumps on the green, clear of the rim and of each other, so
    // open green stays between them.
    const plantable = inset(b.rings, gr.rim_m + gr.keep_off_rim_m)
    if (!plantable.length) continue
    const scatter = (count, list) => {
      let placed = 0
      for (let t = 0; t < count * 25 && placed < count; t++) {
        const g = plantable[Math.floor(rand() * plantable.length)]
        const [x0, y0, x1, y1] = box(g.rings)
        const x = x0 + (x1 - x0) * rand()
        const y = y0 + (y1 - y0) * rand()
        if (!pointInPolygon(x, y, g.rings) || taken.anyWithin(x, y, gr.min_gap_m)) continue
        taken.add(x, y, true)
        list.push({ x, y, z })
        placed++
      }
    }
    // Round by chance, so small roofs still get a plant now and then.
    const howMany = (perHundred) => {
      const n = (area / 100) * perHundred
      return Math.floor(n) + (rand() < n % 1 ? 1 : 0)
    }
    scatter(howMany(gr.bushes_per_100m2), bushes)
    scatter(howMany(gr.flower_clumps_per_100m2), flowers)
  }
  return { roofs, bushes, flowers, greenArea }
}

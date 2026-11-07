// Reads the city kit from public/data/ and turns it into metres (x = east, y = north, origin at
// the kit centre), the same way the app does in src/data.js.
import fs from 'node:fs'
import path from 'node:path'
import { makeProjection, openRing, pointsAlong } from '../src/geo.js'

export const DATA = path.resolve(import.meta.dirname, '../public/data')
const read = (name) => JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'))

const polygonsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [])

export function loadKit() {
  const kit = read('kit.json')
  const scenario = read('scenario.json')
  const species = read('species.json')
  const project = makeProjection(kit.center)

  const [w, s, e, n] = kit.bbox
  const [x0, y0] = project([w, s])
  const [x1, y1] = project([e, n])

  // Service buildings as in the app (src/data.js): use compared without case.
  const serviceUses = new Set(scenario.rings.service_uses.map((u) => u.toLowerCase()))
  const buildings = read('buildings.geojson').features.flatMap((f) =>
    polygonsOf(f.geometry).map((poly) => ({
      id: f.properties.id,
      use: f.properties.use ?? 'undefined',
      height: f.properties.height,
      service: serviceUses.has((f.properties.use ?? 'undefined').toLowerCase()),
      rings: poly.map((ring) => openRing(ring.map(project))),
    })),
  )

  const graph = read('streets.graph.json')
  const walkable = graph.edges.filter((e) => e.walkable)
  const streets = walkable.map((e) => e.coords.map(project))
  // The same edges for routing: node ids, length in metres, and the line (index = streets index).
  const edges = walkable.map((e, i) => ({ from: e.from, to: e.to, length: e.length, line: streets[i] }))
  const degree = new Map()
  for (const e of graph.edges) for (const id of [e.from, e.to]) degree.set(id, (degree.get(id) ?? 0) + 1)
  const nodes = graph.nodes.map((nd) => ({ id: nd.id, p: project([nd.lon, nd.lat]), degree: degree.get(nd.id) ?? 0 }))

  const squares = read('plots.geojson').features
    .filter((f) => f.properties.landuse === 'square')
    .flatMap((f) => polygonsOf(f.geometry).map((poly) => poly.map((ring) => openRing(ring.map(project)))))

  const greenAreas = []
  const trees = []
  for (const f of read('greenery.geojson').features) {
    const p = f.properties
    if (f.geometry.type === 'Point') {
      if (p.class === 'tree') trees.push({ p: project(f.geometry.coordinates), genus: p.genus ?? null })
      continue
    }
    // Tree rows: a tree every planned_tree_spacing_m, as the app draws them.
    if (f.geometry.type === 'LineString') {
      if (p.class === 'tree_row')
        for (const pt of pointsAlong(f.geometry.coordinates.map(project), scenario.planned_tree_spacing_m)) trees.push({ p: pt, genus: null })
      continue
    }
    for (const poly of polygonsOf(f.geometry))
      greenAreas.push({ class: p.class, name: p.name ?? null, private: p.access === 'private', rings: poly.map((ring) => openRing(ring.map(project))) })
  }

  return { kit, scenario, species, project, bounds: { x0, y0, x1, y1 }, buildings, streets, edges, nodes, squares, greenAreas, trees }
}

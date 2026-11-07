// Loads the city kit and the scenario, and turns longitude/latitude into metres on a flat
// local map (x = east, y = north, origin at the kit centre). Everything later works in metres.
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js'
import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate.js'
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js'
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js'
import { SpatialGrid } from './grid.js'
import { makeProjection, openRing, pointsAlong } from './geo.js'

const factory = new GeometryFactory()

async function getJSON(name) {
  const r = await fetch(`${import.meta.env.BASE_URL}data/${name}`)
  if (!r.ok) throw new Error(`data/${name}: ${r.status}`)
  return r.json()
}

async function getDerived(name) {
  // The dev server answers a missing file with the app's own page, so a failed parse also
  // means "missing".
  const missing = new Error(`data/derived/${name} is missing: run npm run precompute`)
  const r = await fetch(`${import.meta.env.BASE_URL}data/derived/${name}`)
  if (!r.ok) throw missing
  try {
    return JSON.parse(await r.text())
  } catch {
    throw missing
  }
}

// planting.json stores one list per field; here every plant becomes one object, in metres.
// They stay sorted by planting year.
function unpackPlanting(p) {
  const { x_dm, y_dm, kind, year } = p.plants
  // The index stays the same in every layout, so each plant can get its own fixed random shape.
  const plants = x_dm.map((x, i) => ({ index: i, x: x / 10, y: y_dm[i] / 10, kind: p.kinds[kind[i]], year: year[i] }))
  const meadow = p.meadow.rings.map((r, i) => ({ year: p.meadow.year[i], ring: ringFromDm(r) }))
  return { ...p, plants, meadow }
}

// A flat list x, y, x, y, … in decimetres as a ring of [x, y] points in metres.
function ringFromDm(flat) {
  const ring = []
  for (let i = 0; i < flat.length; i += 2) ring.push([flat[i] / 10, flat[i + 1] / 10])
  return ring
}

// routes.json: every species route once, with its fixed line, and per layout whether it is
// shown, where it is cut and its potential homes; the habitat arrows; a summary per species.
// Positions come in decimetres; here they become metres.
function unpackRoutes(j) {
  const groups = (a, n) => {
    const out = []
    for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n).map((v) => v / 10))
    return out
  }
  const anchors = Object.fromEntries(j.anchors.map((a) => [a.id, { ...a, x: a.x_dm / 10, y: a.y_dm / 10 }]))
  return {
    habitats: j.habitats.map((h) => ({ ...h, x: h.x_dm / 10, y: h.y_dm / 10 })),
    anchors,
    missingInside: j.missing_inside,
    summary: j.summary,
    list: j.routes.map((r) => ({
      ...r,
      pts: groups(r.xyz_dm, 3),
      layouts: Object.fromEntries(Object.entries(r.layouts).map(([k, v]) => [k, v && { ...v, homes: groups(v.homes_dm, 2) }])),
    })),
  }
}

// people.json: teleport stations, the Today bus stops, pressure zones, main paths, gathering places
// and interaction points, in metres.
function unpackPeople(p) {
  const m = (v) => v / 10
  return {
    rings: p.rings.map((r) => ({ ...r, x: m(r.x_dm), y: m(r.y_dm) })),
    stops: p.stops.map((s) => ({ x: m(s.x_dm), y: m(s.y_dm), angle: s.angle })),
    zones: p.zones.map((z) => ({ minutes: z.minutes, polygons: z.polygons_dm.map((poly) => poly.map(ringFromDm)) })),
    mainEdges: p.main_edges,
    mainLength: p.main_length_m,
    gathering: p.gathering_dm.map(([x, y]) => [m(x), m(y)]),
    interactions: p.interactions.map((it) => ({ x: m(it.x_dm), y: m(it.y_dm), z: m(it.z_dm), members: it.members.map(([route, k]) => ({ route, k })) })),
  }
}

// roofs.json: the green roofs with their rims, and the bushes and flower clumps on them.
function unpackRoofs(r) {
  const points = ({ x_dm, y_dm, z_dm }) => x_dm.map((x, i) => ({ x: x / 10, y: y_dm[i] / 10, z: z_dm[i] / 10 }))
  return {
    ...r,
    roofs: r.roofs.map((roof) => ({ z: roof.z_dm / 10, outline: roof.outline.map(ringFromDm), green: roof.green.map((poly) => poly.map(ringFromDm)) })),
    bushes: points(r.bushes),
    flowers: points(r.flower_clumps),
  }
}

function jstsRing(ring) {
  const pts = ring.map(([x, y]) => new Coordinate(x, y))
  pts.push(new Coordinate(ring[0][0], ring[0][1]))
  return factory.createLinearRing(pts)
}

const ringFromJsts = (lr) => openRing(lr.getCoordinates().map((c) => [c.x, c.y]))

// Cuts a polygon (list of rings in metres) to the kit box. Returns zero or more polygons.
function clipToBox(rings, box, boxEnv) {
  const [outer, ...holes] = rings
  if (outer.length < 3) return []
  const inside = outer.every(([x, y]) => boxEnv.contains(x, y))
  if (inside) return [rings]
  let poly = factory.createPolygon(jstsRing(outer), holes.filter((h) => h.length >= 3).map(jstsRing))
  if (!poly.getEnvelopeInternal().intersects(boxEnv)) return []
  let cut
  try {
    cut = OverlayOp.intersection(poly, box)
  } catch {
    // OpenStreetMap polygons are sometimes self-touching; a zero buffer repairs them.
    poly = BufferOp.bufferOp(poly, 0)
    cut = OverlayOp.intersection(poly, box)
  }
  const out = []
  for (let i = 0; i < cut.getNumGeometries(); i++) {
    const g = cut.getGeometryN(i)
    if (g.getGeometryType() !== 'Polygon' || g.isEmpty()) continue
    const r = [ringFromJsts(g.getExteriorRing())]
    for (let k = 0; k < g.getNumInteriorRing(); k++) r.push(ringFromJsts(g.getInteriorRingN(k)))
    out.push(r)
  }
  return out
}

export async function loadCity() {
  const [kit, scenario, species, buildingsGJ, graph, greeneryGJ] = await Promise.all([
    getJSON('kit.json'),
    getJSON('scenario.json'),
    getJSON('species.json'),
    getJSON('buildings.geojson'),
    getJSON('streets.graph.json'),
    getJSON('greenery.geojson'),
  ])
  // Written by npm run precompute; the app only reads them.
  const [light, plantingJson, roofsJson, routesJson, peopleJson, numbers] = await Promise.all([
    getDerived('light.json'),
    getDerived('planting.json'),
    getDerived('roofs.json'),
    getDerived('routes.json'),
    getDerived('people.json'),
    getDerived('numbers.json'),
  ])
  const project = makeProjection(kit.center)

  // The kit box in metres.
  const [w, s, e, n] = kit.bbox
  const [x0, y0] = project([w, s])
  const [x1, y1] = project([e, n])
  const bounds = { x0, y0, x1, y1 }
  const box = factory.createPolygon(jstsRing([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]))
  const boxEnv = box.getEnvelopeInternal()
  const inBox = ([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1

  // Buildings. scenario.json writes the service uses with a capital letter, the buildings
  // in lower case, so they are compared without case.
  const serviceUses = new Set(scenario.rings.service_uses.map((u) => u.toLowerCase()))
  const buildings = buildingsGJ.features.map((f) => {
    const use = f.properties.use ?? 'undefined'
    return {
      id: f.properties.id,
      height: f.properties.height,
      use,
      service: serviceUses.has(use.toLowerCase()),
      rings: f.geometry.coordinates.map((ring) => openRing(ring.map(project))),
    }
  })

  // Streets: every walkable edge as a straight line in metres.
  const streets = graph.edges.filter((e) => e.walkable).map((e) => e.coords.map(project))

  // Greenery, cut to the kit box. Areas keep their class and access for later phases.
  const greenAreas = []
  const trees = []
  const rows = []
  for (const f of greeneryGJ.features) {
    const p = f.properties
    const g = f.geometry
    if (g.type === 'Point') {
      const pt = project(g.coordinates)
      // Some mapped heights are text like "10 m"; only a real number counts.
      const height = Number.parseFloat(p.height)
      if (p.class === 'tree' && inBox(pt))
        trees.push({ x: pt[0], y: pt[1], height: Number.isFinite(height) && height > 0 ? height : null, genus: p.genus ?? null, leafType: p.leaf_type ?? null })
    } else if (g.type === 'LineString') {
      if (p.class === 'tree_row') rows.push(g.coordinates.map(project))
    } else {
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
      for (const poly of polys) {
        const rings = poly.map((ring) => openRing(ring.map(project)))
        for (const r of clipToBox(rings, box, boxEnv)) {
          greenAreas.push({ class: p.class, private: p.access === 'private', rings: r })
        }
      }
    }
  }

  // Tree rows are lines in OpenStreetMap. Draw a tree along them every planned_tree_spacing_m,
  // unless a single tree is already mapped within half that distance.
  const spacing = scenario.planned_tree_spacing_m
  const treeGrid = new SpatialGrid(spacing)
  trees.forEach((t) => treeGrid.add(t.x, t.y, t))
  for (const line of rows) {
    for (const [x, y] of pointsAlong(line, spacing)) {
      if (!inBox([x, y]) || treeGrid.anyWithin(x, y, spacing / 2)) continue
      const t = { x, y, height: null, genus: null }
      trees.push(t)
      treeGrid.add(x, y, t)
    }
  }

  return { kit, scenario, species, bounds, buildings, streets, greenAreas, trees, light, planting: unpackPlanting(plantingJson), roofs: unpackRoofs(roofsJson), routes: unpackRoutes(routesJson), people: unpackPeople(peopleJson), numbers }
}

// People in the later layouts, and the numbers per layout. Every value comes from scenario.json
// (rings, people, paths, habitat_buffer_for_residents_m, habitat_min_piece_m2).
//
// 1. Teleport stations: one above every bus stop (the kit has none, so above every transport
//    building) and above every large service building; stations closer than rings.merge_within_m
//    become one at their midpoint. Today a bus stands at the street next to every stop.
// 2. Pressure zones: from the walkable node nearest each ring, walk the street network at
//    walking speed; the reached segments (and the reached part of the last one), widened by
//    reach_band_m on each side, joined into one shape per time (5, 10, 15 minutes).
// 3. Main paths: the shortest connections between the rings along the paths, as a minimum
//    spanning network; gathering places where three or more main paths meet.
// 4. Interaction points: where a species route, at its computed height (not the drawn arcs),
//    runs within path_height_band_m and crosses a street line (a road Today, a path later).
//    Computed once on the fixed route lines, so they never move between layouts; points closer
//    than interactions.merge_within_m become one.
// 5. Numbers per layout: unsealed green area, habitat pieces, residents near habitat (Zensus),
//    and per species its routes, how they end, potential homes and interaction points.
import fs from 'node:fs'
import path from 'node:path'
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js'
import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate.js'
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js'
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js'
import { SpatialGrid } from '../src/grid.js'
import { distToSegment, openRing, pointInPolygon } from '../src/geo.js'
import { curvedPaths } from '../src/paths.js'
import { DATA } from './load.mjs'

const factory = new GeometryFactory()
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])

function ringArea(r) {
  let a = 0
  for (let i = 0; i < r.length; i++) {
    const p = r[i]
    const q = r[(i + 1) % r.length]
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a / 2
}
function ringCentroid(r) {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < r.length; i++) {
    const p = r[i]
    const q = r[(i + 1) % r.length]
    const f = p[0] * q[1] - q[0] * p[1]
    a += f
    cx += (p[0] + q[0]) * f
    cy += (p[1] + q[1]) * f
  }
  return a ? [cx / (3 * a), cy / (3 * a)] : r[0]
}

// Dijkstra on the street graph from several start nodes: walking distance in metres to every node.
function walk(nodeIds, adj, starts) {
  const d = new Map(nodeIds.map((id) => [id, Infinity]))
  const prev = new Map()
  // A binary min-heap of [distance, node].
  const queue = []
  const push = (item) => {
    let i = queue.push(item) - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (queue[p][0] <= item[0]) break
      ;[queue[i], queue[p]] = [queue[p], queue[i]]
      i = p
    }
  }
  const pop = () => {
    const top = queue[0]
    const last = queue.pop()
    if (queue.length) {
      queue[0] = last
      for (let i = 0; ; ) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < queue.length && queue[l][0] < queue[m][0]) m = l
        if (r < queue.length && queue[r][0] < queue[m][0]) m = r
        if (m === i) break
        ;[queue[i], queue[m]] = [queue[m], queue[i]]
        i = m
      }
    }
    return top
  }
  starts.forEach((s) => (d.set(s, 0), push([0, s])))
  while (queue.length) {
    const [du, u] = pop()
    if (du > d.get(u)) continue
    for (const { to, len, edge } of adj.get(u) ?? []) {
      const nd = du + len
      if (nd < d.get(to)) {
        d.set(to, nd)
        prev.set(to, { from: u, edge })
        push([nd, to])
      }
    }
  }
  return { d, prev }
}

// The part of a line from distance a to distance b along it (in the line's own length).
function subLine(line, a, b) {
  const out = []
  let acc = 0
  for (let i = 1; i < line.length; i++) {
    const p = line[i - 1]
    const q = line[i]
    const L = dist(p, q)
    const lo = Math.max(a, acc)
    const hi = Math.min(b, acc + L)
    if (hi > lo && L > 0) {
      const at = (s) => [p[0] + ((q[0] - p[0]) * (s - acc)) / L, p[1] + ((q[1] - p[1]) * (s - acc)) / L]
      if (!out.length) out.push(at(lo))
      out.push(at(hi))
    }
    acc += L
  }
  return out
}
const lineLength = (line) => line.reduce((s, p, i) => (i ? s + dist(line[i - 1], p) : 0), 0)

// Polygons of a jsts geometry as rings of [x, y].
function polygonsOf(g) {
  const out = []
  for (let i = 0; i < g.getNumGeometries(); i++) {
    const p = g.getGeometryN(i)
    if (p.getGeometryType() !== 'Polygon' || p.isEmpty()) continue
    const ring = (r) => openRing(r.getCoordinates().map((c) => [c.x, c.y]))
    const rings = [ring(p.getExteriorRing())]
    for (let k = 0; k < p.getNumInteriorRing(); k++) rings.push(ring(p.getInteriorRingN(k)))
    out.push(rings)
  }
  return out
}

// Where segment a–b crosses segment c–d: the share t along a–b, or null.
function crossing(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]]
  const s = [d[0] - c[0], d[1] - c[1]]
  const den = r[0] * s[1] - r[1] * s[0]
  if (Math.abs(den) < 1e-9) return null
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null
}

// Squared distances (in cells) to the nearest zero cell, in place: one pass along the columns,
// one along the rows (Felzenszwalb and Huttenlocher's exact method).
function edt1(f, n) {
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    d[q] = (q - v[k]) ** 2 + f[v[k]]
  }
  return d
}
function edt(g, W, H) {
  const col = new Float64Array(H)
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) col[y] = g[y * W + x]
    const d = edt1(col, H)
    for (let y = 0; y < H; y++) g[y * W + x] = d[y]
  }
  for (let y = 0; y < H; y++) g.set(edt1(g.subarray(y * W, (y + 1) * W), W), y * W)
}

// Points closer than `within` to each other become one, at the middle of the points it replaces:
// again and again the closest pair is joined (weighted by how many points each stands for),
// until no two are closer. Each result keeps its members.
function mergeClose(items, within) {
  const groups = items.map((it) => ({ x: it.x, y: it.y, members: [it] }))
  for (;;) {
    let best = null
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++) {
        const d = Math.hypot(groups[i].x - groups[j].x, groups[i].y - groups[j].y)
        if (d < within && (!best || d < best.d)) best = { i, j, d }
      }
    if (!best) return groups
    const [a, b] = [groups[best.i], groups[best.j]]
    const na = a.members.length
    const nb = b.members.length
    groups[best.i] = { x: (a.x * na + b.x * nb) / (na + nb), y: (a.y * na + b.y * nb) / (na + nb), members: [...a.members, ...b.members] }
    groups.splice(best.j, 1)
  }
}

export function computePeople(kit, light, routes) {
  const { scenario: sc, buildings, edges, nodes, streets, greenAreas, bounds } = kit
  const P = sc.people
  const layoutKeys = Object.keys(sc.layouts)

  // ---- 1. Rings ---------------------------------------------------------------------------------
  const stopUses = new Set(sc.rings.stop_uses.map((u) => u.toLowerCase()))
  const rings = []
  for (const b of buildings) {
    const outer = b.rings[0]
    if (!outer || outer.length < 3) continue
    const [x, y] = ringCentroid(outer)
    if (stopUses.has(b.use.toLowerCase())) rings.push({ kind: 'stop', building: b.id, x, y })
    else if (b.service && Math.abs(ringArea(outer)) > sc.rings.min_service_footprint_m2) rings.push({ kind: 'service', building: b.id, x, y })
  }
  // A building can come in several parts: one ring per building, on its first part.
  const seen = new Set()
  const perBuilding = rings.filter((r) => (seen.has(r.building) ? false : seen.add(r.building)))
  // Stations closer than merge_within_m become one.
  const ringList = mergeClose(perBuilding, sc.rings.merge_within_m).map((g) => ({
    kind: g.members.length > 1 ? 'merged' : g.members[0].kind,
    buildings: g.members.map((m) => m.building),
    kinds: g.members.map((m) => m.kind),
    x: g.x,
    y: g.y,
  }))

  // The street point next to each stop, where the Today bus stands.
  const segGrid = new SpatialGrid(50)
  streets.forEach((line, i) => {
    for (let k = 1; k < line.length; k++) segGrid.add((line[k - 1][0] + line[k][0]) / 2, (line[k - 1][1] + line[k][1]) / 2, [i, k])
  })
  const nearestOnStreet = (x, y) => {
    let best = null
    for (let r = 60; !best && r < 2000; r *= 2)
      for (const e of segGrid.near(x, y, r)) {
        const [i, k] = e.item
        const a = streets[i][k - 1]
        const b = streets[i][k]
        const d = distToSegment(x, y, a, b)
        if (!best || d < best.d) {
          const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1
          const t = Math.max(0, Math.min(1, ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / L2))
          best = { d, x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) }
        }
      }
    return best
  }
  const stops = perBuilding.filter((r) => r.kind === 'stop').map((r) => nearestOnStreet(r.x, r.y))

  // ---- 2. Pressure zones ------------------------------------------------------------------------
  const nodeIds = nodes.map((n) => n.id)
  const nodeP = new Map(nodes.map((n) => [n.id, n.p]))
  const adj = new Map()
  edges.forEach((e, i) => {
    for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
      if (!adj.has(a)) adj.set(a, [])
      adj.get(a).push({ to: b, len: e.length, edge: i })
    }
  })
  const walkable = nodes.filter((n) => adj.has(n.id))
  const nearestNode = (x, y) => walkable.reduce((a, n) => (dist(n.p, [x, y]) < dist(a.p, [x, y]) ? n : a)).id
  ringList.forEach((r) => (r.node = nearestNode(r.x, r.y)))
  const { d } = walk(nodeIds, adj, [...new Set(ringList.map((r) => r.node))])

  const reachedLines = (R) => {
    const out = []
    edges.forEach((e) => {
      const du = d.get(e.from)
      const dv = d.get(e.to)
      const geo = lineLength(e.line)
      const k = geo / (e.length || geo || 1) // the edge's length in metres, on its drawn line
      const a = Math.max(0, Math.min(e.length, R - du))
      const b = Math.max(0, Math.min(e.length, R - dv))
      if (a + b >= e.length) out.push(e.line)
      else {
        if (a > 0) out.push(subLine(e.line, 0, a * k))
        if (b > 0) out.push(subLine(e.line, geo - b * k, geo))
      }
    })
    return out.filter((l) => l.length >= 2)
  }
  const toJsts = (lines) => factory.createMultiLineString(lines.map((l) => factory.createLineString(l.map(([x, y]) => new Coordinate(x, y)))))
  const zoneGeoms = P.reach_minutes.map((m) => BufferOp.bufferOp(toJsts(reachedLines(P.walking_speed_m_per_min * m)), P.reach_band_m, 4))
  // Each time as a band: the 10-minute zone without the 5-minute one, and so on.
  const zones = P.reach_minutes.map((minutes, i) => {
    const g = i ? OverlayOp.difference(zoneGeoms[i], zoneGeoms[i - 1]) : zoneGeoms[i]
    return { minutes, polygons: polygonsOf(g), area_m2: Math.round(zoneGeoms[i].getArea()) }
  })

  // ---- 3. Main paths ----------------------------------------------------------------------------
  // Walking distances between all rings, then a minimum spanning network (Prim): each step adds
  // the shortest connection from the linked rings to an unlinked one, along the street network.
  const ringNodes = [...new Set(ringList.map((r) => r.node))]
  const trees = ringNodes.map((n) => walk(nodeIds, adj, [n]))
  const inTree = new Set([0])
  const mainEdges = new Set()
  while (inTree.size < ringNodes.length) {
    let best = null
    for (const i of inTree)
      for (let j = 0; j < ringNodes.length; j++) {
        if (inTree.has(j)) continue
        const dj = trees[i].d.get(ringNodes[j])
        if (!best || dj < best.d) best = { i, j, d: dj }
      }
    if (!best || best.d === Infinity) break
    for (let u = ringNodes[best.j]; u !== ringNodes[best.i]; ) {
      const step = trees[best.i].prev.get(u)
      mainEdges.add(step.edge)
      u = step.from
    }
    inTree.add(best.j)
  }
  const degree = new Map()
  for (const i of mainEdges) for (const n of [edges[i].from, edges[i].to]) degree.set(n, (degree.get(n) ?? 0) + 1)
  const gathering = [...degree].filter(([, k]) => k >= 3).map(([n]) => nodeP.get(n))
  const curved = curvedPaths(streets, sc)
  const mainLength = [...mainEdges].reduce((s, i) => s + lineLength(curved[i].line), 0)

  // ---- 4. Interaction points --------------------------------------------------------------------
  const [hLo, hHi] = P.path_height_band_m
  const raw = []
  for (const r of routes.routes) {
    const mine = []
    for (let k = 1; k < r.pts.length; k++) {
      const z = (r.z[k - 1] + r.z[k]) / 2
      if (z < hLo || z > hHi) continue
      const a = r.pts[k - 1]
      const b = r.pts[k]
      for (const e of segGrid.near((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 60)) {
        const [i, j] = e.item
        const t = crossing(a, b, streets[i][j - 1], streets[i][j])
        if (t == null) continue
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        // The same crossing found twice (two touching street segments, or the way back of a
        // loop) counts once.
        if (mine.some((q) => dist(q.p, p) < 10)) continue
        mine.push({ route: r.id, species: r.s.id, k: k - 1, p, z })
      }
    }
    raw.push(...mine)
  }
  // Dense crossings: points closer than merge_within_m become one.
  const interactions = mergeClose(
    raw.map((it) => ({ ...it, x: it.p[0], y: it.p[1] })),
    sc.interactions.merge_within_m,
  ).map((g) => ({ p: [g.x, g.y], z: g.members.reduce((a, m) => a + m.z, 0) / g.members.length, members: g.members.map((m) => ({ route: m.route, species: m.species, k: m.k })) }))
  // A member is shown where its route is drawn up to that point.
  const memberShown = (m, key) => {
    const v = routes.routes[m.route].per[key]
    return v && (v.cut == null || m.k < v.cut)
  }
  const shownIn = (it, key, species) => it.members.some((m) => (!species || m.species === species) && memberShown(m, key))

  // ---- 5. Numbers -------------------------------------------------------------------------------
  const { cols, rows, cell } = light
  const [ox, oy] = light.origin
  const n = cols * rows
  const xy = (i) => [ox + ((i % cols) + 0.5) * cell, oy + (Math.floor(i / cols) + 0.5) * cell]
  const fillPolygon = (rings, fn) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const [x, y] of rings[0]) (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (y0 = Math.min(y0, y)), (y1 = Math.max(y1, y))
    for (let r = Math.max(0, Math.floor((y0 - oy) / cell)); r <= Math.min(rows - 1, Math.floor((y1 - oy) / cell)); r++)
      for (let c = Math.max(0, Math.floor((x0 - ox) / cell)); c <= Math.min(cols - 1, Math.floor((x1 - ox) / cell)); c++) {
        const i = r * cols + c
        const [x, y] = xy(i)
        if (pointInPolygon(x, y, rings)) fn(i)
      }
  }
  const fillNear = (lines, hw, fn) => {
    for (const line of lines)
      for (let k = 1; k < line.length; k++) {
        const a = line[k - 1]
        const b = line[k]
        for (let r = Math.max(0, Math.floor((Math.min(a[1], b[1]) - hw - oy) / cell)); r <= Math.min(rows - 1, Math.floor((Math.max(a[1], b[1]) + hw - oy) / cell)); r++)
          for (let c = Math.max(0, Math.floor((Math.min(a[0], b[0]) - hw - ox) / cell)); c <= Math.min(cols - 1, Math.floor((Math.max(a[0], b[0]) + hw - ox) / cell)); c++) {
            const i = r * cols + c
            const [x, y] = xy(i)
            if (distToSegment(x, y, a, b) <= hw) fn(i)
          }
      }
  }
  const building = new Uint8Array(n)
  for (const b of buildings) fillPolygon(b.rings, (i) => (building[i] = 1))
  const osmGreen = new Uint8Array(n)
  for (const a of greenAreas) fillPolygon(a.rings, (i) => (osmGreen[i] = 1))
  const band = new Uint8Array(n)
  fillNear(streets, sc.street_green_band_width_m / 2, (i) => (band[i] = 1))
  const paved = new Uint8Array(n)
  fillNear(curved.map((p) => p.line), sc.paths.width_m / 2, (i) => (paved[i] = 1))

  // Zensus cells, in metres.
  const zensus = JSON.parse(fs.readFileSync(path.join(DATA, 'zensus.geojson'), 'utf8')).features.map((f) => ({
    population: f.properties.population,
    rings: (f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates[0]).map((r) => openRing(r.map(kit.project))),
  }))

  const numbers = {}
  for (const key of layoutKeys) {
    const greenStreets = sc.layouts[key].streets !== 'roads'
    const unsealed = new Uint8Array(n)
    let count = 0
    for (let i = 0; i < n; i++) {
      const u = !building[i] && (osmGreen[i] || (greenStreets && band[i] && !paved[i]))
      if (u) (unsealed[i] = 1), count++
    }
    // Habitat pieces: connected unsealed cells (8 neighbours) of at least habitat_min_piece_m2.
    const piece = new Int32Array(n).fill(-1)
    const sizes = []
    for (let s = 0; s < n; s++) {
      if (!unsealed[s] || piece[s] >= 0) continue
      const id = sizes.length
      let size = 0
      const stack = [s]
      piece[s] = id
      while (stack.length) {
        const i = stack.pop()
        size++
        const c = i % cols
        const r = (i / cols) | 0
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const cc = c + dc
            const rr = r + dr
            if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue
            const j = rr * cols + cc
            if (unsealed[j] && piece[j] < 0) (piece[j] = id), stack.push(j)
          }
      }
      sizes.push(size)
    }
    const minCells = sc.habitat_min_piece_m2 / (cell * cell)
    const habitatPieces = sizes.filter((s) => s >= minCells)
    const isHabitat = (i) => piece[i] >= 0 && sizes[piece[i]] >= minCells

    // Residents within the buffer: the exact distance from every grid cell (extended by the
    // buffer and a census cell beyond the map) to the nearest habitat cell; a point counts if
    // its cell lies within the buffer.
    const buf = sc.habitat_buffer_for_residents_m
    const M = Math.ceil((buf + 150) / cell)
    const W = cols + 2 * M
    const Hh = rows + 2 * M
    const d2 = new Float64Array(W * Hh).fill(1e20)
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (isHabitat(r * cols + c)) d2[(r + M) * W + c + M] = 0
    edt(d2, W, Hh)
    const near = (x, y) => {
      const c = Math.floor((x - ox) / cell) + M
      const r = Math.floor((y - oy) / cell) + M
      if (c < 0 || r < 0 || c >= W || r >= Hh) return false
      return Math.sqrt(d2[r * W + c]) * cell <= buf
    }
    let residents = 0
    let nullCells = 0
    let cellsCounted = 0
    for (const z of zensus) {
      // The cell's share inside the area, from sample points every 10 m.
      const xs = z.rings[0].map((p) => p[0])
      const ys = z.rings[0].map((p) => p[1])
      let inside = 0
      let total = 0
      for (let x = Math.min(...xs) + 5; x < Math.max(...xs); x += 10)
        for (let y = Math.min(...ys) + 5; y < Math.max(...ys); y += 10) {
          if (!pointInPolygon(x, y, z.rings)) continue
          total++
          if (near(x, y)) inside++
        }
      if (!inside) continue
      if (z.population == null) {
        nullCells++
        continue
      }
      cellsCounted++
      residents += (z.population * inside) / total
    }

    // Per species.
    const species = {}
    for (const s of kit.species.species) {
      const S = routes.summary[s.id].layouts[key]
      const mine = routes.routes.filter((r) => r.s.id === s.id && r.per[key])
      const working = mine.filter((r) => r.per[key].cut == null)
      species[s.id] = {
        routes: mine.length,
        broken: mine.length - working.length,
        cross: working.filter((r) => r.et === 'cross').length,
        loop: working.filter((r) => r.et === 'loop').length,
        stay: working.filter((r) => r.et === 'stay').length,
        homes: S.homes,
        interactions: interactions.filter((it) => shownIn(it, key, s.id)).length,
      }
    }

    numbers[key] = {
      unsealed_m2: Math.round(count * cell * cell),
      habitat_pieces: habitatPieces.length,
      largest_piece_m2: Math.round(Math.max(0, ...habitatPieces) * cell * cell),
      residents_near_habitat: Math.round(residents / 10) * 10,
      residents_cells: cellsCounted,
      cells_without_count: nullCells,
      species,
    }
  }

  return { rings: ringList, stationsBeforeMerge: perBuilding.length, rawInteractions: raw.length, stops, zones, mainEdges: [...mainEdges].sort((a, b) => a - b), mainLength, gathering, interactions, numbers }
}

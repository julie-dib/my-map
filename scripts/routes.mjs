// Species routes: models of how each of the 14 species could move through the city, not
// tracked movements. Every number and rule comes from scenario.json (routes, ground_cost,
// broken_rule, max_gap_m, arc_clears_roofs_by_m, high_flyer_loop, maturity_years, drawing,
// species_circle, paths) and species.json (groups, heights, behaviour).
//
// Routes grow from layout to layout and never move:
// 1. Habitats and anchors: an arrow on the map edge for each large habitat around Weimar, the
//    large green areas inside (Ilmpark), and the largest existing green areas as further anchors.
// 2. The city on the 5 m light grid, as it is Around 2100 (and Today's roads, for the checks).
// 3. Candidates: for every species, routes between pairs of anchors, searched once on the
//    Around 2100 city, where new planting costs a little more than existing greenery:
//    ground: cheapest way on the grid (ground_cost), buildings are barriers;
//    hopping, canopy, low flyers: shortest chain through trees, shrubs, green roofs or stepping
//    stones, no hop longer than max_gap_m;
//    bats: cheapest way along tree lines, woodland edges and the green bands;
//    high flyers: big loops from an edge arrow over two feeding areas and back.
// 4. For each candidate and layout, the first barrier: Today's roads for ground species; a gap
//    wider than max_gap_m where the trees, shrubs or stepping stones are not there yet; a stretch
//    without tree lines, woodland edge or green band longer than max_gap_m for bats. A route
//    ending in a home works only once that home has grown up.
// 5. Selection: Today 2–3 routes per species through existing greenery, then 1–2 more opened in
//    Around 2050, then 1–2 more opened in Around 2100 (routes.per_layout), kept apart.
// 6. Drawing data, fixed once: the line (ending as species.json says for the layout it appears
//    in), lanes for parallel routes, heights over the roofs, and the species circle centred on
//    the line at a free spot. Per layout only where the line is cut (broken) and the homes change.
import { SpatialGrid } from '../src/grid.js'
import { distToSegment, pointInPolygon, seededRandom } from '../src/geo.js'
import { curvedPaths } from '../src/paths.js'

// ---- Small helpers ---------------------------------------------------------------------------

// A binary min-heap of (key, value) pairs; pop() returns the value and sets lastKey.
class Heap {
  constructor() {
    this.k = []
    this.v = []
    this.lastKey = 0
  }
  get size() {
    return this.k.length
  }
  push(key, val) {
    const { k, v } = this
    let i = k.length
    k.push(key)
    v.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p] <= key) break
      k[i] = k[p]
      v[i] = v[p]
      i = p
    }
    k[i] = key
    v[i] = val
  }
  pop() {
    const { k, v } = this
    const topK = k[0]
    const top = v[0]
    const lk = k.pop()
    const lv = v.pop()
    const n = k.length
    if (n > 0) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        if (l >= n) break
        const r = l + 1
        const c = r < n && k[r] < k[l] ? r : l
        if (k[c] >= lk) break
        k[i] = k[c]
        v[i] = v[c]
        i = c
      }
      k[i] = lk
      v[i] = lv
    }
    this.lastKey = topK
    return top
  }
}

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])

function lengthOf(pts) {
  let s = 0
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i])
  return s
}

// Points every `step` metres along a polyline, keeping its first and last point.
function resample(pts, step) {
  if (pts.length < 2) return pts.map((p) => [...p])
  const out = [[...pts[0]]]
  let need = step
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const L = dist(a, b)
    let s = 0
    while (L - s >= need) {
      s += need
      const t = s / L
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
      need = step
    }
    need -= L - s
  }
  const last = pts[pts.length - 1]
  if (dist(out[out.length - 1], last) > 0.01) out.push([...last])
  return out
}

// Corner cutting: rounds the corners, keeps both ends.
function chaikin(pts, times = 2) {
  let p = pts
  for (let k = 0; k < times; k++) {
    if (p.length < 3) break
    const q = [p[0]]
    for (let i = 0; i < p.length - 1; i++) {
      const [a, b] = [p[i], p[i + 1]]
      q.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]])
    }
    q.push(p[p.length - 1])
    p = q
  }
  return p
}

// The unit normal to the left of the line at point i.
function normalAt(pts, i) {
  const a = pts[Math.max(0, i - 1)]
  const b = pts[Math.min(pts.length - 1, i + 1)]
  const L = dist(a, b) || 1
  return [-(b[1] - a[1]) / L, (b[0] - a[0]) / L]
}

// Shift every point sideways; d(i) gives the shift at point i (left +).
function offsetLine(pts, d) {
  return pts.map((p, i) => {
    const [nx, ny] = normalAt(pts, i)
    const s = d(i)
    return [p[0] + nx * s, p[1] + ny * s]
  })
}

// The polyline up to distance s along it.
function cutAt(pts, s) {
  const out = [pts[0]]
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    const L = dist(pts[i - 1], pts[i])
    if (acc + L >= s) {
      const t = L ? (s - acc) / L : 0
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t])
      return out
    }
    acc += L
    out.push(pts[i])
  }
  return out
}

// ---- The grid --------------------------------------------------------------------------------

function makeGrid(light) {
  const { cols, rows, cell } = light
  const [ox, oy] = light.origin
  return {
    cols,
    rows,
    cell,
    ox,
    oy,
    n: cols * rows,
    idx: (x, y) => {
      const c = Math.floor((x - ox) / cell)
      const r = Math.floor((y - oy) / cell)
      return c < 0 || r < 0 || c >= cols || r >= rows ? -1 : r * cols + c
    },
    xy: (i) => [ox + ((i % cols) + 0.5) * cell, oy + (Math.floor(i / cols) + 0.5) * cell],
  }
}

function cellRange(G, x0, y0, x1, y1) {
  return [
    Math.max(0, Math.floor((x0 - G.ox) / G.cell)),
    Math.min(G.cols - 1, Math.floor((x1 - G.ox) / G.cell)),
    Math.max(0, Math.floor((y0 - G.oy) / G.cell)),
    Math.min(G.rows - 1, Math.floor((y1 - G.oy) / G.cell)),
  ]
}

function fillPolygon(G, rings, fn) {
  if (!rings[0] || rings[0].length < 3) return
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of rings[0]) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x)
    y0 = Math.min(y0, y); y1 = Math.max(y1, y)
  }
  const [c0, c1, r0, r1] = cellRange(G, x0, y0, x1, y1)
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      const i = r * G.cols + c
      const [x, y] = G.xy(i)
      if (pointInPolygon(x, y, rings)) fn(i)
    }
}

function fillNearLines(G, lines, hw, fn) {
  for (const line of lines)
    for (let k = 1; k < line.length; k++) {
      const a = line[k - 1]
      const b = line[k]
      const [c0, c1, r0, r1] = cellRange(G, Math.min(a[0], b[0]) - hw, Math.min(a[1], b[1]) - hw, Math.max(a[0], b[0]) + hw, Math.max(a[1], b[1]) + hw)
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const i = r * G.cols + c
          const [x, y] = G.xy(i)
          if (distToSegment(x, y, a, b) <= hw) fn(i)
        }
    }
}

function fillDisc(G, x, y, rad, fn) {
  const [c0, c1, r0, r1] = cellRange(G, x - rad, y - rad, x + rad, y + rad)
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      const i = r * G.cols + c
      const [cx, cy] = G.xy(i)
      if (Math.hypot(cx - x, cy - y) <= rad) fn(i)
    }
}

const DC = [1, -1, 0, 0, 1, 1, -1, -1]
const DR = [0, 0, 1, -1, 1, -1, 1, -1]

// Cheapest ways over the grid from the source cells to every cell (8 neighbours; a step costs
// its length times the mean cost of the two cells; Infinity = barrier).
function gridTree(G, cost, sources) {
  const d = new Float64Array(G.n).fill(Infinity)
  const prev = new Int32Array(G.n).fill(-1)
  const h = new Heap()
  for (const s of sources) if (cost[s] < Infinity && d[s] > 0) (d[s] = 0), h.push(0, s)
  while (h.size) {
    const u = h.pop()
    if (h.lastKey > d[u]) continue
    const c = u % G.cols
    const r = (u / G.cols) | 0
    for (let k = 0; k < 8; k++) {
      const nc = c + DC[k]
      const nr = r + DR[k]
      if (nc < 0 || nr < 0 || nc >= G.cols || nr >= G.rows) continue
      const v = nr * G.cols + nc
      if (cost[v] === Infinity) continue
      const nd = d[u] + (k < 4 ? 1 : Math.SQRT2) * G.cell * 0.5 * (cost[u] + cost[v])
      if (nd < d[v]) {
        d[v] = nd
        prev[v] = u
        h.push(nd, v)
      }
    }
  }
  return { d, prev }
}

// Shortest chains through a network of points to every point, no hop longer than `hop`. A hop
// costs its length × (1 + length / maxGap) × (1 + pen of the point it lands on), so short hops
// and existing greenery are preferred.
function networkTree(pts, pen, grid, hop, maxGap, sources) {
  const d = new Float64Array(pts.length).fill(Infinity)
  const prev = new Int32Array(pts.length).fill(-1)
  const h = new Heap()
  for (const s of sources) if (d[s] > 0) (d[s] = 0), h.push(0, s)
  while (h.size) {
    const u = h.pop()
    if (h.lastKey > d[u]) continue
    const [ux, uy] = pts[u]
    for (const e of grid.near(ux, uy, hop)) {
      const v = e.item
      const L = Math.hypot(e.x - ux, e.y - uy)
      if (L > hop || v === u) continue
      const nd = d[u] + L * (1 + L / maxGap) * (1 + pen[v])
      if (nd < d[v]) {
        d[v] = nd
        prev[v] = u
        h.push(nd, v)
      }
    }
  }
  return { d, prev }
}

const trace = (prev, end) => {
  const out = []
  for (let u = end; u >= 0; u = prev[u]) out.push(u)
  return out.reverse()
}
const argminOf = (d, set) => {
  let best = -1
  for (const i of set) if (d[i] < Infinity && (best < 0 || d[i] < d[best])) best = i
  return best
}

// ---- The routes ------------------------------------------------------------------------------

const LAND = ['other', 'building', 'road', 'path', 'green_band', 'garden', 'private_garden', 'park', 'meadow', 'scrub', 'woodland', 'allotments', 'cemetery']
const L = Object.fromEntries(LAND.map((k, i) => [k, i]))
const COST_KEY = { other: 'other_open_ground', road: 'road_today', path: 'path_with_bikes' }
const RAW = ['garden', 'private_garden', 'park', 'meadow', 'grass', 'scrub', 'woodland', 'allotments', 'cemetery', 'recreation_ground']
const RAW_BIT = Object.fromEntries(RAW.map((k, i) => [k, 1 << i]))
const LIGHT = { shade: 1, partial: 2, full_sun: 3 }
const CLASS_WORD = { park: 'park', cemetery: 'cemetery', allotments: 'allotments', woodland: 'woodland', garden: 'gardens', meadow: 'meadow', scrub: 'scrub', recreation_ground: 'sports ground', grass: 'green' }
const STEP = 3 // metres between route points

export function computeRoutes(kit, light, planting, roofs) {
  const { scenario, species: speciesJson, buildings, streets, squares, greenAreas, bounds } = kit
  const R = scenario.routes
  const C = R.candidates
  const mat = scenario.maturity_years
  const groups = speciesJson.groups
  const species = speciesJson.species
  const G = makeGrid(light)
  const { x0, y0, x1, y1 } = bounds
  const inBox = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1
  const paths = curvedPaths(streets, scenario)

  const layoutKeys = Object.keys(scenario.layouts)
  const LAST = layoutKeys[layoutKeys.length - 1]
  const yearOf = (key) => scenario.layouts[key].year
  const order = (key) => layoutKeys.indexOf(key)
  const hasRoads = (key) => scenario.layouts[key].streets === 'roads'
  const hasPaths = (key) => scenario.paths.layouts.includes(key)
  const hasRoofs = (key) => scenario.green_roofs.layouts.includes(key)
  // The year from which something is there: existing greenery 0, planting its year, green
  // roofs and green bands the first layout that has them.
  const roofYear = Math.min(...layoutKeys.filter(hasRoofs).map(yearOf))
  const bandYear = Math.min(...layoutKeys.filter((k) => !hasRoads(k)).map(yearOf))
  const layoutFor = (y) => layoutKeys.find((k) => yearOf(k) >= y) ?? LAST
  const penaltyOf = (y) => (y <= yearOf(layoutKeys[0]) ? 0 : C.newer_penalty[layoutFor(y)] ?? 0)

  // ---- 2. The city on the grid ----------------------------------------------------------------
  const groundCost = (li) => {
    const v = scenario.ground_cost[COST_KEY[LAND[li]] ?? LAND[li]]
    return v == null ? Infinity : v
  }
  const base = new Uint8Array(G.n).fill(L.other)
  const raw = new Uint16Array(G.n)
  const named = new Map() // OSM name → cell indices inside the kit
  for (const a of greenAreas) {
    let cls = R.ground_cost_aliases[a.class] ?? a.class
    if (cls === 'garden' && a.private) cls = 'private_garden'
    const li = L[cls]
    const bit = RAW_BIT[a.class === 'garden' && a.private ? 'private_garden' : a.class] ?? 0
    const cells = a.name ? named.get(a.name) ?? (named.set(a.name, []), named.get(a.name)) : null
    fillPolygon(G, a.rings, (i) => {
      raw[i] |= bit
      if (li !== undefined && groundCost(li) < groundCost(base[i])) base[i] = li
      if (cells) cells.push(i)
    })
  }
  const H = new Float32Array(G.n)
  for (const b of buildings)
    fillPolygon(G, b.rings, (i) => {
      base[i] = L.building
      H[i] = Math.max(H[i], b.height ?? 0)
    })
  const square = new Uint8Array(G.n)
  for (const s of squares) fillPolygon(G, s, (i) => (square[i] = 1))
  const roofAt = (x, y) => {
    let h = 0
    const c = Math.floor((x - G.ox) / G.cell)
    const r = Math.floor((y - G.oy) / G.cell)
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc
        const rr = r + dr
        if (cc >= 0 && rr >= 0 && cc < G.cols && rr < G.rows) h = Math.max(h, H[rr * G.cols + cc])
      }
    return h
  }

  // Area samples by OpenStreetMap class, every `spacing` metres (inside the kit, not on buildings).
  const sampleCache = new Map()
  const samples = (classes, spacing) => {
    const key = classes.join() + '@' + spacing
    if (sampleCache.has(key)) return sampleCache.get(key)
    const mask = classes.reduce((m, c) => m | RAW_BIT[c], 0)
    const k = Math.max(1, Math.round(spacing / G.cell))
    const out = []
    for (let r = 0; r < G.rows; r += k)
      for (let c = 0; c < G.cols; c += k) {
        const i = r * G.cols + c
        if (raw[i] & mask && base[i] !== L.building) out.push(G.xy(i))
      }
    sampleCache.set(key, out)
    return out
  }

  const existingTrees = kit.trees.map((t) => t.p).filter(([x, y]) => inBox(x, y))
  const plannedOf = (kind, year) => planting.list.filter((p) => p.kind === kind && p.year <= year)
  const plannedAll = (kind) => planting.list.filter((p) => p.kind === kind)

  // Today's roads: every street segment, except footpaths whose middle lies inside a park,
  // woodland, meadow, scrub, cemetery or allotments (there the street network is a path).
  const GREEN_PATHS = new Set([L.park, L.woodland, L.meadow, L.scrub, L.cemetery, L.allotments])
  const roadLines = []
  for (const line of streets)
    for (let k = 1; k < line.length; k++) {
      const i = G.idx((line[k - 1][0] + line[k][0]) / 2, (line[k - 1][1] + line[k][1]) / 2)
      if (i >= 0 && !GREEN_PATHS.has(base[i])) roadLines.push([line[k - 1], line[k]])
    }

  // The street network stops short of the map edge (in the corners by a few hundred metres).
  // The land beyond its outermost streets (reached from the map edge without crossing a street)
  // has no known roads, so ground routes may use it only near the habitat arrows.
  const wall = new Uint8Array(G.n)
  fillNearLines(G, streets, G.cell * 0.75, (i) => (wall[i] = 1))
  const outside = new Uint8Array(G.n)
  const stack = []
  for (let c = 0; c < G.cols; c++) stack.push(c, (G.rows - 1) * G.cols + c)
  for (let r = 0; r < G.rows; r++) stack.push(r * G.cols, r * G.cols + G.cols - 1)
  while (stack.length) {
    const i = stack.pop()
    if (outside[i] || wall[i]) continue
    outside[i] = 1
    const c = i % G.cols
    const r = (i / G.cols) | 0
    if (c > 0) stack.push(i - 1)
    if (c < G.cols - 1) stack.push(i + 1)
    if (r > 0) stack.push(i - G.cols)
    if (r < G.rows - 1) stack.push(i + G.cols)
  }

  const lands = {}
  for (const key of layoutKeys) {
    const land = base.slice()
    if (hasRoads(key)) fillNearLines(G, roadLines, R.road_half_width_m + G.cell / 2, (i) => land[i] !== L.building && (land[i] = L.road))
    else {
      fillNearLines(G, streets, scenario.street_green_band_width_m / 2, (i) => {
        if (land[i] !== L.building && groundCost(land[i]) > groundCost(L.green_band)) land[i] = L.green_band
      })
      if (hasPaths(key)) fillNearLines(G, paths.map((p) => p.line), scenario.paths.width_m / 2, (i) => land[i] !== L.building && (land[i] = L.path))
    }
    lands[key] = land
  }
  const landLast = lands[LAST]

  // ---- 1. Habitats and anchors -------------------------------------------------------------------
  const greenNow = new Uint8Array(G.n)
  for (let i = 0; i < G.n; i++) if (base[i] >= L.garden) greenNow[i] = 1
  for (const [x, y] of existingTrees) fillDisc(G, x, y, 8, (i) => base[i] !== L.building && (greenNow[i] = 1))
  const hb = R.habitats
  const sideGeom = {
    north: (a) => ({ p: [a, y1], out: [0, 1] }),
    south: (a) => ({ p: [a, y0], out: [0, -1] }),
    east: (a) => ({ p: [x1, a], out: [1, 0] }),
    west: (a) => ({ p: [x0, a], out: [-1, 0] }),
  }
  const probe = (p, out) => {
    // Share of green cells in a strip probe_width_m wide, probe_depth_m deep, inwards from p.
    let n = 0
    let g = 0
    const tx = -out[1]
    const ty = out[0]
    for (let d = 2.5; d < hb.probe_depth_m; d += G.cell)
      for (let w = -hb.probe_width_m / 2; w <= hb.probe_width_m / 2; w += G.cell) {
        const i = G.idx(p[0] - out[0] * d + tx * w, p[1] - out[1] * d + ty * w)
        if (i < 0) continue
        n++
        g += greenNow[i]
      }
    return n ? g / n : 0
  }
  const habitats = {}
  const chosen = []
  for (const h of hb.edges) {
    let best = null
    for (const w of h.windows)
      for (let a = w.from_m; a <= w.to_m; a += 10) {
        const lo = w.side === 'north' || w.side === 'south' ? x0 : y0
        const hi = w.side === 'north' || w.side === 'south' ? x1 : y1
        const along = Math.max(lo + hb.probe_width_m / 2, Math.min(hi - hb.probe_width_m / 2, a))
        const { p, out } = sideGeom[w.side](along)
        if (chosen.some((c) => dist(c, p) < hb.min_arrow_gap_m)) continue
        const score = probe(p, out)
        if (!best || score > best.score + 1e-9) best = { p, out, score }
      }
    chosen.push(best.p)
    habitats[h.id] = { id: h.id, label: h.label, kind: 'edge', x: best.p[0], y: best.p[1], dir: best.out, green_share: +best.score.toFixed(2) }
  }
  const middleOf = (cells) => {
    const mx = cells.reduce((s, i) => s + G.xy(i)[0], 0) / cells.length
    const my = cells.reduce((s, i) => s + G.xy(i)[1], 0) / cells.length
    let best = cells[0]
    for (const i of cells) if (dist(G.xy(i), [mx, my]) < dist(G.xy(best), [mx, my])) best = i
    return G.xy(best)
  }
  const maskOf = (cells) => {
    const m = new Uint8Array(G.n)
    cells.forEach((i) => (m[i] = 1))
    return m
  }
  const missingInside = []
  for (const h of hb.inside) {
    const cells = [...new Set(h.osm_names.flatMap((n) => named.get(n) ?? []))].filter((i) => base[i] !== L.building)
    if (!cells.length) {
      missingInside.push(h.label)
      continue
    }
    const [x, y] = middleOf(cells)
    habitats[h.id] = { id: h.id, label: h.label, kind: 'inside', x, y, cells, isIn: maskOf(cells), area_m2: cells.length * G.cell * G.cell }
  }

  // Anchors: the habitats, then the largest existing green areas, spread over the map.
  const anchors = Object.values(habitats).map((h) => ({ ...h }))
  const insideMask = new Uint8Array(G.n)
  for (const a of anchors) if (a.kind === 'inside') a.cells.forEach((i) => (insideMask[i] = 1))
  const areas = greenAreas
    .filter((a) => C.anchor_classes.includes(a.class))
    .map((a) => {
      const cells = []
      fillPolygon(G, a.rings, (i) => base[i] !== L.building && !insideMask[i] && cells.push(i))
      return { a, cells }
    })
    .filter((x) => x.cells.length * G.cell * G.cell >= C.anchor_min_area_m2)
    .sort((p, q) => q.cells.length - p.cells.length)
  let gk = 0
  for (const { a, cells } of areas) {
    if (gk >= C.anchor_count) break
    const [x, y] = middleOf(cells)
    if (anchors.some((b) => dist([b.x, b.y], [x, y]) < C.anchor_min_spacing_m)) continue
    anchors.push({ id: 'green' + ++gk, label: a.name ?? CLASS_WORD[a.class] ?? a.class, kind: 'green', x, y, cells, isIn: maskOf(cells), area_m2: cells.length * G.cell * G.cell })
  }
  const anchorById = Object.fromEntries(anchors.map((a) => [a.id, a]))

  // Start or end cells of an anchor on the grid.
  const anchorCells = (a) => {
    if (a.kind !== 'edge') return a.cells.filter((i) => landLast[i] !== L.building)
    for (let rad = R.source_radius_m; ; rad *= 2) {
      const out = []
      fillDisc(G, a.x, a.y, rad, (i) => landLast[i] !== L.building && out.push(i))
      if (out.length || rad > 400) return out
    }
  }
  // Start or end points of an anchor in a network.
  const anchorNodes = (a, pts, reach) => {
    const out = []
    pts.forEach((p, i) => {
      const c = G.idx(p[0], p[1])
      if (a.kind === 'edge' ? dist(p, [a.x, a.y]) <= reach : c >= 0 && a.isIn[c]) out.push(i)
    })
    if (!out.length) {
      let best = 0
      pts.forEach((p, i) => dist(p, [a.x, a.y]) < dist(pts[best], [a.x, a.y]) && (best = i))
      out.push(best)
    }
    return out
  }

  // ---- Habitat points per layout (for homes) -------------------------------------------------
  const sp = R.homes.sample_spacing_m
  const buildingEdge = []
  for (const b of buildings)
    for (const ring of b.rings)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]
        const c = ring[(i + 1) % ring.length]
        const n = Math.max(1, Math.round(dist(a, c) / 10))
        for (let k = 0; k < n; k++) {
          const p = [a[0] + ((c[0] - a[0]) * k) / n, a[1] + ((c[1] - a[1]) * k) / n]
          if (inBox(p[0], p[1])) buildingEdge.push(p)
        }
      }
  const centroid = (ring) => [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length]
  const habitatPoints = (key) => {
    const year = yearOf(key)
    const aged = (kind, m) => plannedOf(kind, year).filter((p) => year - p.year >= m).map((p) => [p.x, p.y])
    const meadowStrips = planting.meadow.filter((m) => year - m.year >= mat.meadow).map((m) => centroid(m.ring))
    return {
      old_tree: [...existingTrees, ...aged('tree', mat.tree)],
      dead_wood: [...samples(['woodland'], sp), ...aged('tree', mat.dead_wood)],
      shrub: [...samples(['scrub', 'garden', 'private_garden', 'allotments'], sp), ...aged('shrub', mat.shrub)],
      lawn: [...samples(['park', 'grass', 'recreation_ground'], sp), ...meadowStrips],
      meadow: [...samples(['meadow', 'grass'], sp), ...meadowStrips],
      pond: aged('pond', mat.pond),
      green_roof: hasRoofs(key) ? roofs.bushes.map((b) => [b.x, b.y]) : [],
      building_edge: buildingEdge,
    }
  }
  const pointGrid = (pts) => {
    const g = new SpatialGrid(20)
    pts.forEach(([x, y]) => g.add(x, y, true))
    return g
  }
  const HP = {}
  for (const key of layoutKeys) {
    const hp = habitatPoints(key)
    HP[key] = { hp, grids: Object.fromEntries(Object.entries(hp).map(([t, pts]) => [t, pointGrid(pts)])), pathLines: hasPaths(key) ? paths.map((p) => p.line) : streets }
  }

  // ---- Potential homes along a line ------------------------------------------------------------
  const homeRules = R.homes.rules
  const findHomes = (s, key, pts) => {
    const rule = homeRules[s.id]
    if (!rule || pts.length < 2) return []
    const { hp, grids, pathLines } = HP[key]
    const routeGrid = new SpatialGrid(R.homes.search_m)
    pts.forEach(([x, y], i) => routeGrid.add(x, y, i))
    const countNear = (types, x, y, r) => {
      let n = 0
      for (const t of types) for (const e of grids[t].near(x, y, r)) if (Math.hypot(e.x - x, e.y - y) < r && Math.hypot(e.x - x, e.y - y) > 0.01) n++
      return n
    }
    let pathGrid = null
    if (rule.away_from_paths_m) {
      pathGrid = new SpatialGrid(20)
      pathLines.forEach((line) => {
        for (let k = 1; k < line.length; k++) pathGrid.add((line[k - 1][0] + line[k][0]) / 2, (line[k - 1][1] + line[k][1]) / 2, [line[k - 1], line[k]])
      })
    }
    const found = []
    for (const [x, y] of hp[rule.at]) {
      let along = -1
      let dmin = Infinity
      for (const e of routeGrid.near(x, y, R.homes.search_m)) {
        const d = Math.hypot(e.x - x, e.y - y)
        if (d < dmin) (dmin = d), (along = e.item)
      }
      if (dmin > R.homes.search_m) continue
      if (rule.light) {
        const i = G.idx(x, y)
        if (i < 0 || !rule.light.some((l) => light.classes[i] === LIGHT[l])) continue
      }
      if (rule.near && !rule.near.every((n) => countNear(n.types, x, y, n.within_m) >= (n.count ?? 1))) continue
      if (rule.none_near && rule.none_near.some((n) => countNear(n.types, x, y, n.within_m) > 0)) continue
      if (pathGrid) {
        let close = false
        for (const e of pathGrid.near(x, y, rule.away_from_paths_m + 20)) if (distToSegment(x, y, e.item[0], e.item[1]) < rule.away_from_paths_m) close = true
        if (close) continue
      }
      found.push({ x, y, along })
    }
    // Homes closer than min_spacing_m count once; ordered along the line.
    found.sort((a, b) => a.along - b.along)
    const kept = []
    const g = new SpatialGrid(R.homes.min_spacing_m)
    for (const h of found) {
      if (g.anyWithin(h.x, h.y, R.homes.min_spacing_m)) continue
      g.add(h.x, h.y, true)
      kept.push(h)
    }
    return kept
  }

  // ---- 3. Candidates -------------------------------------------------------------------------------
  // A candidate: { from, to (anchor ids), pts (STEP apart, from the start), total, barrierAt(key):
  // distance along pts of the first barrier in that layout (Infinity: none), existing: share of
  // the route through existing greenery }.
  const toLine = (cells) => resample(chaikin(cells.filter((_, k) => k % 2 === 0 || k === cells.length - 1).map((i) => G.xy(i)), 3), STEP)
  const withEdges = (a, b, pts) => {
    const out = [...pts]
    if (a.kind === 'edge') out.unshift([a.x, a.y])
    if (b.kind === 'edge') out.push([b.x, b.y])
    return out
  }
  const pairs = []
  for (let i = 0; i < anchors.length; i++)
    for (let j = i + 1; j < anchors.length; j++) if (dist([anchors[i].x, anchors[i].y], [anchors[j].x, anchors[j].y]) >= C.min_length_m) pairs.push([i, j])
  const existingShareOf = (pts) => pts.filter(([x, y]) => greenNow[G.idx(x, y)] === 1).length / (pts.length || 1)

  // Grid candidates for one cost grid; check(pts) gives the barrier function.
  const gridCandidates = (cost, check) => {
    const out = []
    const cellsOf = anchors.map(anchorCells)
    for (let i = 0; i < anchors.length; i++) {
      const js = pairs.filter((p) => p[0] === i).map((p) => p[1])
      if (!js.length) continue
      const { d, prev } = gridTree(G, cost, cellsOf[i])
      for (const j of js) {
        const end = argminOf(d, cellsOf[j])
        if (end < 0) continue
        const pts = resample(withEdges(anchors[i], anchors[j], toLine(trace(prev, end))), STEP)
        const total = lengthOf(pts)
        if (total < C.min_length_m) continue
        out.push({ from: anchors[i].id, to: anchors[j].id, pts, total, barrierAt: check(pts), existing: existingShareOf(pts) })
      }
    }
    return out
  }

  // Ground: cost on the Around 2100 land; Today's roads stop the route (broken_rule).
  const nearEdge = new Uint8Array(G.n)
  for (const a of anchors) if (a.kind === 'edge') fillDisc(G, a.x, a.y, R.outside_network_reach_m, (i) => (nearEdge[i] = 1))
  let groundCands = null
  const groundCandidates = () => {
    if (groundCands) return groundCands
    const cost = new Float32Array(G.n)
    for (let i = 0; i < G.n; i++) cost[i] = outside[i] && !nearEdge[i] ? Infinity : groundCost(landLast[i])
    groundCands = gridCandidates(cost, (pts) => {
      const memo = {}
      return (key) => {
        if (key in memo) return memo[key]
        const land = lands[key]
        let s = Infinity
        for (let k = 0; k < pts.length; k++) {
          const i = G.idx(pts[k][0], pts[k][1])
          if (i >= 0 && land[i] === L.road) {
            s = k * STEP
            break
          }
        }
        return (memo[key] = s)
      }
    })
    return groundCands
  }

  // Bats: tree lines (by the year their trees are there), woodland edges and green bands support
  // the route; a stretch without support longer than max_gap_m breaks it.
  const bc = R.bat_cost
  const batCandidates = (maxGap) => {
    const treeYear = new Float32Array(G.n).fill(Infinity)
    const trees = [...existingTrees.map((p) => [p, 0]), ...plannedAll('tree').map((p) => [[p.x, p.y], p.year])]
    for (const [[x, y], yr] of trees) fillDisc(G, x, y, bc.tree_line_within_m, (i) => yr < treeYear[i] && (treeYear[i] = yr))
    const edge = new Uint8Array(G.n)
    for (let i = 0; i < G.n; i++) {
      if (base[i] !== L.woodland) continue
      const c = i % G.cols
      const r = (i / G.cols) | 0
      let border = false
      for (let k = 0; k < 4 && !border; k++) {
        const nc = c + DC[k]
        const nr = r + DR[k]
        if (nc >= 0 && nr >= 0 && nc < G.cols && nr < G.rows && base[nr * G.cols + nc] !== L.woodland) border = true
      }
      if (border) fillDisc(G, ...G.xy(i), bc.woodland_edge_within_m, (j) => (edge[j] = 1))
    }
    const band = (i) => landLast[i] === L.green_band || landLast[i] === L.path
    const support = new Float32Array(G.n)
    const cost = new Float32Array(G.n)
    for (let i = 0; i < G.n; i++) {
      const li = landLast[i]
      support[i] = Math.min(treeYear[i], edge[i] ? 0 : Infinity, band(i) ? bandYear : Infinity)
      cost[i] =
        li === L.building ? bc.building
        : treeYear[i] < Infinity ? bc.tree_line * (1 + penaltyOf(treeYear[i]))
        : edge[i] ? bc.woodland_edge
        : band(i) ? bc.green_band * (1 + penaltyOf(bandYear))
        : li === L.woodland ? bc.woodland
        : square[i] ? bc.open_square
        : li === L.meadow || li === L.park ? bc.open_green
        : bc.other
    }
    return gridCandidates(cost, (pts) => {
      const memo = {}
      return (key) => {
        if (key in memo) return memo[key]
        const yr = yearOf(key)
        let runStart = -1
        let s = Infinity
        for (let k = 0; k < pts.length; k++) {
          const i = G.idx(pts[k][0], pts[k][1])
          const ok = i < 0 || support[i] <= yr
          if (ok) runStart = -1
          else if (runStart < 0) runStart = k
          else if ((k - runStart) * STEP > maxGap) {
            s = runStart * STEP + maxGap / 2
            break
          }
        }
        return (memo[key] = s)
      }
    })
  }

  // Networks: points with the year they are there.
  const networkCandidates = (s) => {
    const g = s.group
    const maxGap = scenario.max_gap_m[s.id]
    // Species with a very short largest gap still get routes: the search may bridge wider gaps
    // (at a high cost), and the barrier check then breaks the route there.
    const hop = Math.min(Math.max(maxGap, C.min_search_hop_m), C.search_hop_m)
    const P = []
    const Y = []
    const add = (pts, yr) => pts.forEach((p) => (P.push(p), Y.push(yr)))
    const addPlanted = (kind) => plannedAll(kind).forEach((p) => (P.push([p.x, p.y]), Y.push(p.year)))
    const roofPts = roofs.bushes.map((b) => [b.x, b.y])
    if (g === 'canopy') {
      add(existingTrees, 0)
      addPlanted('tree')
      add(samples(['woodland'], Math.max(G.cell, Math.min(15, Math.floor(maxGap / 4 / G.cell) * G.cell))), 0)
    } else if (g === 'hopping') {
      add(existingTrees, 0)
      addPlanted('tree')
      add(samples(['woodland'], sp), 0)
      addPlanted('shrub')
      add(samples(['scrub', 'garden', 'private_garden', 'allotments'], sp), 0)
      add(roofPts, roofYear)
    } else {
      planting.meadow.forEach((m) => (P.push(centroid(m.ring)), Y.push(m.year)))
      add(samples(['park', 'garden', 'private_garden', 'meadow', 'grass', 'recreation_ground', 'allotments', 'cemetery'], 30), 0)
      add(roofPts, roofYear)
    }
    const pen = Float32Array.from(Y, penaltyOf)
    const grid = new SpatialGrid(hop)
    P.forEach((p, i) => grid.add(p[0], p[1], i))
    const reach = Math.max(R.source_radius_m, hop)
    const nodesOf = anchors.map((a) => anchorNodes(a, P, reach))
    const out = []
    for (let i = 0; i < anchors.length; i++) {
      const js = pairs.filter((p) => p[0] === i).map((p) => p[1])
      if (!js.length) continue
      const { d, prev } = networkTree(P, pen, grid, hop, maxGap, nodesOf[i])
      for (const j of js) {
        const end = argminOf(d, nodesOf[j])
        if (end < 0) continue
        const chain = trace(prev, end)
        const [a, b] = [anchors[i], anchors[j]]
        // Supports: the chain points with their year; an edge arrow is always there.
        const sup = chain.map((n) => ({ p: P[n], y: Y[n] }))
        if (a.kind === 'edge') sup.unshift({ p: [a.x, a.y], y: 0 })
        if (b.kind === 'edge') sup.push({ p: [b.x, b.y], y: 0 })
        if (sup.length < 2) continue
        const pts = resample(chaikin(sup.map((q) => q.p), 2), STEP)
        const total = lengthOf(pts)
        if (total < C.min_length_m) continue
        let acc = 0
        sup.forEach((q, k) => (k && (acc += dist(sup[k - 1].p, q.p)), (q.s = acc)))
        const scale = total / (acc || 1)
        sup.forEach((q) => (q.s *= scale))
        const memo = {}
        const barrierAt = (key) => {
          if (key in memo) return memo[key]
          const yr = yearOf(key)
          let last = sup[0]
          let s = Infinity
          for (let k = 1; k < sup.length; k++) {
            const q = sup[k]
            const isLast = k === sup.length - 1
            if (q.y > yr && !isLast) continue
            if (dist(last.p, q.p) > maxGap) {
              s = last.s + Math.min(maxGap / 2, (q.s - last.s) / 2)
              break
            }
            last = q
          }
          return (memo[key] = s)
        }
        out.push({ from: a.id, to: b.id, pts, total, barrierAt, existing: sup.filter((q) => q.y === 0).length / sup.length })
      }
    }
    return out
  }

  // High flyers: loops from each edge arrow over two feeding places and back. Feeding places:
  // the largest existing feeding areas, the new meadow strips (grouped) and the green roofs
  // (grouped); a loop is there from the year both its feeding places are.
  const hfl = scenario.high_flyer_loop
  const feeding = greenAreas
    .filter((a) => hfl.feeding_areas.includes(a.class))
    .map((a) => {
      const cells = []
      fillPolygon(G, a.rings, (i) => base[i] !== L.building && cells.push(i))
      if (!cells.length) return null
      const pts = cells.map((i) => G.xy(i))
      return { area: cells.length * G.cell * G.cell, c: [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length], y: 0 }
    })
    .filter(Boolean)
    .sort((a, b) => b.area - a.area)
    .slice(0, 30)
  const clusters = (pts, cellM, n) => {
    const m = new Map()
    for (const { p, y, w } of pts) {
      const k = `${Math.floor(p[0] / cellM)},${Math.floor(p[1] / cellM)}`
      const c = m.get(k) ?? { sx: 0, sy: 0, w: 0, y: 0 }
      c.sx += p[0] * w
      c.sy += p[1] * w
      c.w += w
      c.y = Math.max(c.y, y)
      m.set(k, c)
    }
    return [...m.values()]
      .sort((a, b) => b.w - a.w)
      .slice(0, n)
      .map((c) => ({ c: [c.sx / c.w, c.sy / c.w], area: c.w, y: c.y }))
  }
  feeding.push(...clusters(planting.meadow.map((m) => ({ p: centroid(m.ring), y: m.year, w: 50 })), 150, 15))
  feeding.push(...clusters(roofs.bushes.map((b) => ({ p: [b.x, b.y], y: roofYear, w: 10 })), 150, 15))
  // A smooth loop through the control points: corner cutting (high_flyer_loop.smoothing rounds).
  const smoothLoop = (ctrl) => resample(chaikin(ctrl, hfl.smoothing), STEP)
  const highFlyerCandidates = () => {
    const out = []
    for (const a of anchors.filter((x) => x.kind === 'edge')) {
      const S = [a.x, a.y]
      const best = new Map() // newest year → best loop
      for (let i = 0; i < feeding.length; i++)
        for (let j = 0; j < feeding.length; j++) {
          if (i === j) continue
          const [fa, fb] = [feeding[i], feeding[j]]
          // At most max_radius_m across, and open: no two of the three points too close.
          const sides = [dist(S, fa.c), dist(fa.c, fb.c), dist(fb.c, S)]
          if (Math.max(...sides) > hfl.max_radius_m || Math.min(...sides) < hfl.min_side_m) continue
          const yr = Math.max(fa.y, fb.y)
          const score = Math.min(...sides) + Math.min(fa.area, 20000) / 200
          if (!best.has(yr) || score > best.get(yr).score) best.set(yr, { score, fa, fb, yr })
        }
      for (const { fa, fb, yr } of best.values()) {
        // The loop leaves the edge inwards first, so it does not run along the map edge.
        const inward = [S[0] - a.dir[0] * 60, S[1] - a.dir[1] * 60]
        const ctrl = [S, inward, fa.c, fb.c, inward, S]
        const pts = smoothLoop(ctrl)
        out.push({ from: a.id, to: a.id, pts, total: lengthOf(pts), barrierAt: (key) => (yr <= yearOf(key) ? Infinity : 0), existing: yr === 0 ? 1 : 0, hf: { ctrl, feed: [fa.c, fb.c], dir: a.dir } })
      }
    }
    return out
  }

  // ---- 4 and 5. Selection per species ---------------------------------------------------------------
  const cellKey = ([x, y]) => `${Math.floor(x / 20)},${Math.floor(y / 20)}`
  const picks = [] // { s, c, appears, plan, fallback }
  const notes = {} // species id → notes
  const homesMemo = new Map()
  const homesOf = (s, c, key) => {
    const k = `${s.id}|${c.from}|${c.to}|${c.total.toFixed(1)}|${key}`
    if (!homesMemo.has(k)) homesMemo.set(k, findHomes(s, key, c.pts))
    return homesMemo.get(k)
  }
  const candidateCount = {}
  species.forEach((s, si) => {
    const g = s.group
    const cands =
      g === 'ground' ? groundCandidates()
      : g === 'bat' ? batCandidates(scenario.max_gap_m[s.id])
      : g === 'high_flyer' ? highFlyerCandidates()
      : networkCandidates(s)
    candidateCount[s.id] = cands.length
    const rand = seededRandom(R.seed + 101 * (si + 1))
    notes[s.id] = []
    // How a route that appears in layout X ends once it works: the behaviour in X, or in the
    // next layout where it is not broken.
    const endTypeFor = (X) => layoutKeys.slice(order(X)).map((k) => s.behaviour[k]).find((b) => b !== 'broken') ?? 'stay'
    // The drawn part of the route (S, distance along pts) and, for stay, its home.
    const planMemo = new Map()
    const plan = (c, X) => {
      const k = cands.indexOf(c) + '|' + X
      if (planMemo.has(k)) return planMemo.get(k)
      const et = endTypeFor(X)
      let p
      if (et === 'loop') p = { et, S: c.hf ? c.total - 60 : R.loop_turn_share * c.total }
      else if (et === 'cross') p = { et, S: c.total }
      else {
        const Lh = layoutKeys.slice(order(X)).find((key) => homesOf(s, c, key).length)
        if (!Lh) p = { et, S: R.home_target_share * c.total, home: null, Lh: null }
        else {
          const hs = homesOf(s, c, Lh)
          const target = c.hf ? null : R.home_target_share * c.total
          const home = c.hf
            ? hs.reduce((a, b) => (dist([a.x, a.y], c.hf.feed[1]) < dist([b.x, b.y], c.hf.feed[1]) ? a : b))
            : hs.reduce((a, b) => (Math.abs(a.along * STEP - target) < Math.abs(b.along * STEP - target) ? a : b))
          p = { et, S: home.along * STEP, home, Lh }
        }
      }
      planMemo.set(k, p)
      return p
    }
    const works = (c, key, p) => c.barrierAt(key) > p.S && (p.et !== 'stay' || (p.home && order(key) >= order(p.Lh)))
    const mine = []
    const used = new Set()
    const overlapOk = (c) => {
      const cells = new Set(c.pts.map(cellKey))
      let shared = 0
      cells.forEach((k) => used.has(k) && shared++)
      return shared <= C.max_overlap_share * cells.size
    }
    const take = (c, X, fallback) => {
      mine.push(c)
      c.pts.forEach((p) => used.add(cellKey(p)))
      picks.push({ s, c, appears: X, plan: plan(c, X), fallback })
    }
    const shuffled = (list) => list.map((c) => [rand(), c]).sort((a, b) => a[0] - b[0]).map((x) => x[1])
    for (const X of layoutKeys) {
      const [lo, hi] = R.per_layout[X]
      const n = lo + Math.floor(rand() * (hi - lo + 1))
      const prevKey = layoutKeys[order(X) - 1]
      const free = cands.filter((c) => !mine.includes(c))
      let pools
      if (!prevKey) {
        // Today: through existing greenery; broken where species.json says so (and working
        // from the next layout on), else working.
        const sorted = [...free].sort((a, b) => b.existing - a.existing)
        const next = layoutKeys[1]
        if (s.behaviour[X] === 'broken')
          pools = [
            sorted.filter((c) => {
              const b = c.barrierAt(X)
              return b < plan(c, X).S && b >= Math.min(150, 0.3 * plan(c, X).S) && works(c, next, plan(c, X))
            }),
            sorted.filter((c) => c.barrierAt(X) < plan(c, X).S),
            sorted,
          ]
        else pools = [sorted.filter((c) => works(c, X, plan(c, X))), sorted.filter((c) => c.barrierAt(X) > plan(c, X).S), sorted]
      } else {
        // Later layouts: routes this layout opens (they work now, not in the layout before).
        const list = shuffled(free)
        pools = [list.filter((c) => works(c, X, plan(c, X)) && !works(c, prevKey, plan(c, X))), list.filter((c) => works(c, X, plan(c, X))), list]
      }
      let got = 0
      pools.forEach((pool, level) => {
        for (const c of pool) {
          if (got >= n) break
          if (mine.includes(c) || !overlapOk(c)) continue
          take(c, X, level)
          got++
        }
      })
      const label = scenario.layouts[X].label
      const firstLevel = picks.filter((p) => p.s === s && p.appears === X).map((p) => p.fallback)
      if (got < n) notes[s.id].push(`${label}: only ${got} of ${n} routes found apart from the others`)
      if (firstLevel.some((l) => l > 0))
        notes[s.id].push(
          !prevKey
            ? `${label}: not enough routes ${s.behaviour[X] === 'broken' ? 'broken by a barrier' : 'that work'} through existing greenery; others were added`
            : `${label}: ${firstLevel.filter((l) => l > 0).length} of the new routes already worked before (no other new route opens here)`,
        )
    }
  })

  // ---- 6. Drawing data -----------------------------------------------------------------------------
  const D = scenario.drawing
  const SC = scenario.species_circle
  const off = D.parallel_route_offset_m
  const routes = picks
    .sort((a, b) => order(a.appears) - order(b.appears) || species.indexOf(a.s) - species.indexOf(b.s))
    .map(({ s, c, appears, plan: p, fallback }, id) => {
      const g = s.group
      const from = anchorById[c.from]
      const to = anchorById[c.to]
      let pts
      let exit = null
      if (p.et === 'loop') {
        const fwd = cutAt(c.pts, p.S)
        // The way back follows the same streets, so the loop is drawn as the way out only,
        // with an arrowhead at each end (Routes.jsx).
        pts = resample(fwd, STEP)
      } else if (p.et === 'stay') {
        if (c.hf && p.home) pts = smoothLoop([...c.hf.ctrl.slice(0, 4), [p.home.x, p.home.y]])
        else if (p.home) pts = resample([...c.pts.slice(0, p.home.along + 1), [p.home.x, p.home.y]], STEP)
        else pts = resample(cutAt(c.pts, p.S), STEP)
      } else {
        pts = c.pts.map((q) => [...q])
        const a = pts[pts.length - 2] ?? pts[0]
        const b = pts[pts.length - 1]
        exit = c.hf ? c.hf.dir : to.kind === 'edge' ? to.dir : [(b[0] - a[0]) / (dist(a, b) || 1), (b[1] - a[1]) / (dist(a, b) || 1)]
      }
      // Per layout from the one it appears in: where it is cut (index into pts) or null.
      const per = {}
      for (const key of layoutKeys) {
        if (order(key) < order(appears)) {
          per[key] = null
          continue
        }
        const b = c.barrierAt(key)
        const cut = b <= p.S ? Math.max(1, Math.min(pts.length - 1, Math.round(b / STEP))) : null
        // home: the home at the end of a stay route has grown up here.
        per[key] = { cut, home: p.et === 'stay' && !!p.home && order(key) >= order(p.Lh) }
      }
      return { id, s, g, appears, from, to, et: p.et, home: !!p.home, pts, exit, per, total: lengthOf(pts), fallback }
    })

  // Parallel routes: each species gets a lane (0, +1, -1, +2, …) so that its routes overlap
  // little with the other species already in that lane; the lane shifts all its routes by
  // parallel_route_offset_m. Routes of one species share their lane, so where they use the same
  // street they lie on one line. Done once for all layouts, in the order the species first
  // appear, so no route moves.
  const laneCells = new Map()
  const laneOf = new Map()
  for (const r of routes) {
    if (laneOf.has(r.s.id)) continue
    const cells = new Set(routes.filter((q) => q.s.id === r.s.id).flatMap((q) => q.pts.map(cellKey)))
    let lane = 0
    for (const cand of [0, 1, -1, 2, -2, 3, -3]) {
      const used = laneCells.get(cand) ?? new Set()
      let shared = 0
      cells.forEach((c) => used.has(c) && shared++)
      lane = cand
      if (shared < 0.25 * cells.size) break
    }
    const used = laneCells.get(lane) ?? new Set()
    cells.forEach((c) => used.add(c))
    laneCells.set(lane, used)
    laneOf.set(r.s.id, lane)
  }
  for (const r of routes) {
    const lane = laneOf.get(r.s.id)
    r.lane = lane
    if (lane) r.pts = offsetLine(r.pts, () => lane * off)
    // Inside the map (smooth curves can overshoot the edge); only the exit of a cross leaves it.
    r.pts = r.pts.map(([x, y]) => [Math.max(x0 + 1, Math.min(x1 - 1, x)), Math.max(y0 + 1, Math.min(y1 - 1, y))])
    if (r.exit) {
      const b = r.pts[r.pts.length - 1]
      r.pts = resample([...r.pts, [b[0] + r.exit[0] * R.exit_m, b[1] + r.exit[1] * R.exit_m]], STEP)
    }
  }

  // Heights: ground species on the ground; the others at the bottom of their height band, high
  // flyers in its middle, and over any roof taller than that by arc_clears_roofs_by_m.
  for (const r of routes) {
    const [lo, hi] = groups[r.g].height_m
    const baseZ = r.g === 'high_flyer' ? (lo + hi) / 2 : lo
    if (r.g === 'ground') {
      r.z = r.pts.map(() => 0)
      continue
    }
    const need = r.pts.map(([x, y]) => {
      const roof = roofAt(x, y)
      return roof >= lo ? Math.max(baseZ, roof + scenario.arc_clears_roofs_by_m) : baseZ
    })
    const w = 4 // points either side (12 m): rise before the roof, come down after it
    const lifted = need.map((_, i) => Math.max(...need.slice(Math.max(0, i - w), i + w + 1)))
    r.z = lifted.map((_, i) => {
      const part = lifted.slice(Math.max(0, i - w), i + w + 1)
      return part.reduce((a, b) => a + b, 0) / part.length
    })
  }

  // Homes per layout, along the part of the route that is drawn there.
  for (const r of routes)
    for (const key of layoutKeys) {
      const v = r.per[key]
      if (!v) continue
      const shown = v.cut == null ? r.pts : r.pts.slice(0, v.cut + 1)
      v.homes = findHomes(r.s, key, shown)
    }

  // Species circles, once for all layouts, centred on the route line: one on a route shorter
  // than routes.circle_long_route_m (stay: at the end, the home; others: in the middle), two on
  // a longer one (stay: at the end and a third of the way; others: at a third and two thirds).
  // If a spot falls on a crossing (another route through the middle of the circle, a cross, or
  // another circle), the circle moves a little along the route, at most SHIFT points either way.
  const Rc = SC.map_size_m / 2
  const crossClear = Rc / SC.ring_share_of_image + SC.clearance_m
  const SHIFT = Math.round(60 / STEP)
  const others = new SpatialGrid(60)
  routes.forEach((r, k) => r.pts.forEach(([x, y], i) => i % 2 === 0 && others.add(x, y, k)))
  for (const r of routes) for (const v of Object.values(r.per)) if (v && v.cut != null) others.add(...r.pts[v.cut], -1)
  const placed = []
  for (const [k, r] of routes.entries()) {
    const n = r.pts.length - (r.exit ? Math.round(R.exit_m / STEP) : 0)
    const stay = r.et === 'stay'
    const long = lengthOf(r.pts.slice(0, n)) >= R.circle_long_route_m
    const targets = stay ? (long ? [[n - 1, 'end'], [Math.round(n / 3), 'key']] : [[n - 1, 'end']]) : long ? [[Math.round(n / 3), 'key'], [Math.round((2 * n) / 3), 'key']] : [[Math.round(n / 2), 'key']]
    // How free a spot is: positive when nothing crosses it.
    const free = ([x, y]) => {
      let worst = Infinity
      for (const e of others.near(x, y, crossClear)) {
        if (e.item === k) continue
        const d = Math.hypot(e.x - x, e.y - y)
        worst = Math.min(worst, e.item === -1 ? d - crossClear : d - Rc / 2)
      }
      for (const c of placed) worst = Math.min(worst, Math.hypot(c[0] - x, c[1] - y) - (2 * Rc + SC.clearance_m))
      return inBox(x, y) ? worst : -Infinity
    }
    r.circles = targets.map(([t, kind]) => {
      let best = t
      let bestScore = -Infinity
      for (let step = 0; step <= SHIFT; step++) {
        // The end circle only moves back along the route; the others both ways.
        for (const i of kind === 'end' ? [t - step] : [t + step, t - step]) {
          if (i < 0 || i > n - 1) continue
          const sc = free(r.pts[i])
          if (sc > bestScore) (bestScore = sc), (best = i)
        }
        if (bestScore >= 0) break
      }
      placed.push(r.pts[best])
      return { idx: best, kind }
    })
  }

  // Shared stretches: where a route runs within same_species_merge_m of an earlier route of the
  // same species for at least same_species_min_shared_m, that stretch is drawn once, by the
  // earlier route. Stored as runs [i0, i1, other route id, j0, j1]: points i0..i1 of this route
  // lie along points j0..j1 of the other; the app hides them wherever the other is drawn there.
  const tol = D.same_species_merge_m
  const minRun = Math.max(2, Math.round(D.same_species_min_shared_m / STEP))
  let sharedM = 0
  for (const [k, r] of routes.entries()) {
    r.shared = []
    for (let o = 0; o < k; o++) {
      const q = routes[o]
      if (q.s.id !== r.s.id) continue
      const grid = new SpatialGrid(20)
      q.pts.forEach(([x, y], j) => grid.add(x, y, j))
      const match = r.pts.map(([x, y]) => {
        let best = -1
        let bd = tol
        for (const e of grid.near(x, y, tol)) {
          const d = Math.hypot(e.x - x, e.y - y)
          if (d <= bd) (bd = d), (best = e.item)
        }
        return best
      })
      for (let i = 0; i < match.length; ) {
        if (match[i] < 0) {
          i++
          continue
        }
        let e = i
        while (e + 1 < match.length && match[e + 1] >= 0) e++
        if (e - i + 1 >= minRun) {
          const js = match.slice(i, e + 1)
          r.shared.push([i, e, o, Math.min(...js), Math.max(...js)])
          sharedM += (e - i) * STEP
        }
        i = e + 1
      }
    }
  }

  // ---- Summary per species and layout ------------------------------------------------------------
  const summary = {}
  for (const s of species) {
    summary[s.id] = { candidates: candidateCount[s.id], notes: notes[s.id], layouts: {} }
    for (const key of layoutKeys) {
      const mineHere = routes.filter((r) => r.s === s && r.per[key])
      const g = new SpatialGrid(R.homes.min_spacing_m)
      let homes = 0
      for (const r of mineHere)
        for (const h of r.per[key].homes)
          if (!g.anyWithin(h.x, h.y, R.homes.min_spacing_m)) {
            g.add(h.x, h.y, true)
            homes++
          }
      summary[s.id].layouts[key] = {
        behaviour: s.behaviour[key],
        routes: mineHere.length,
        new: mineHere.filter((r) => r.appears === key).length,
        broken: mineHere.filter((r) => r.per[key].cut != null).length,
        homes,
      }
    }
  }

  return { sharedM, habitats, anchors, missingInside, routes, summary }
}

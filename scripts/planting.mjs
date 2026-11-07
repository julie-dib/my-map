// Planned planting for Around 2050 and Around 2100: where trees, shrubs, meadow strips and
// ponds go, and when each is planted. It does not decide plant species.
// Every number comes from scenario.json: planned_tree_spacing_m, min_tree_distance_to_building_m,
// street_green_band_width_m, planned_shrub_spacing_m, trees.placement, trees.second_wave_year,
// trees.spacing_2100_m, planting, paths, pond_count_growing, planting_start_year,
// maturity_years and random_seed.
//
// Two waves:
// - First wave (planting_start_year, 2050): ponds first (nothing is planted where a pond will
//   be), then the open meadow clearings, street trees, tree clusters in the squares, shrubs
//   and meadow strips.
// - Second wave (trees.second_wave_year, 2075): more trees in between, along the green bands
//   and in the squares, with its own random numbers, so the first wave stays exactly the same.
//
// Every green band keeps a curving path (src/paths.js). Trees, shrubs and meadow strips are
// placed sideways from that path, never on it.
import { SpatialGrid } from '../src/grid.js'
import { distToSegment, pointInPolygon, seededRandom } from '../src/geo.js'
import { curvedPaths, spotAt } from '../src/paths.js'
import { CLASS, lightAt } from './light.mjs'

// Kinds of single plants in the plants list; meadow is stored separately as strips.
export const KINDS = ['shrub', 'tree', 'pond']

function polygonBox(rings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of rings[0]) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x)
    y0 = Math.min(y0, y); y1 = Math.max(y1, y)
  }
  return [x0, y0, x1, y1]
}

const ringArea = (ring) =>
  Math.abs(ring.reduce((s, [x, y], i) => {
    const [nx, ny] = ring[(i + 1) % ring.length]
    return s + x * ny - nx * y
  }, 0)) / 2

// The second wave walks a band at most this often to reach its spacing (a search limit, not an assumption).
const MAX_PASSES = 16

// Random helpers on one random stream.
function tools(rand) {
  const between = ([lo, hi]) => lo + (hi - lo) * rand()
  return {
    rand,
    between,
    intIn: ([lo, hi]) => lo + Math.floor(rand() * (hi - lo + 1)),
    yearIn: (r) => Math.round(between(r)),
    weighted: (w) => {
      const e = Object.entries(w).filter(([k]) => !k.startsWith('_'))
      let r = rand() * e.reduce((s, [, v]) => s + v, 0)
      for (const [k, v] of e) if ((r -= v) <= 0) return k
      return e[e.length - 1][0]
    },
  }
}

export function computePlanting(kit, light) {
  const { scenario, buildings, streets, squares, greenAreas, bounds } = kit
  const pl = scenario.planting
  const P = scenario.trees.placement
  const first = tools(seededRandom(scenario.random_seed))
  const { rand, between, yearIn } = first
  const start = scenario.planting_start_year
  const secondYear = scenario.trees.second_wave_year
  const band = scenario.street_green_band_width_m
  const spacing = scenario.planned_tree_spacing_m
  const shrubSpacing = scenario.planned_shrub_spacing_m
  const paths = curvedPaths(streets, scenario)
  // Plants keep this far from the path's centre line: half its width plus keep_plants_off_m.
  const pathClear = scenario.paths.width_m / 2 + scenario.paths.keep_plants_off_m

  // ---- Lookups: buildings, streets, paths, existing trees ---------------------------------
  const buildingGrid = new SpatialGrid(50)
  for (const b of buildings) {
    if (!b.rings[0] || b.rings[0].length < 3) continue
    b.box = polygonBox(b.rings)
    buildingGrid.addBox(...b.box, b)
  }
  const inBuilding = (x, y) => {
    for (const b of buildingGrid.candidates(x, y, 0)) {
      const [x0, y0, x1, y1] = b.box
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && pointInPolygon(x, y, b.rings)) return true
    }
    return false
  }
  // Inside a building, or closer than d to one.
  const nearBuilding = (x, y, d) => {
    for (const b of buildingGrid.candidates(x, y, d)) {
      if (pointInPolygon(x, y, b.rings)) return true
      for (const ring of b.rings)
        for (let i = 0; i < ring.length; i++) if (distToSegment(x, y, ring[i], ring[(i + 1) % ring.length]) < d) return true
    }
    return false
  }

  // The street lines: they say which band a spot belongs to.
  const lineGrid = (lines) => {
    const grid = new SpatialGrid(50)
    lines.forEach((line, k) => {
      for (let i = 1; i < line.length; i++) {
        const [a, b] = [line[i - 1], line[i]]
        grid.addBox(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), { k, a, b })
      }
    })
    return grid
  }
  const streetGrid = lineGrid(streets)
  const lineDistance = (grid, x, y, r) => {
    let d = Infinity
    for (const s of grid.candidates(x, y, r)) d = Math.min(d, distToSegment(x, y, s.a, s.b))
    return d
  }
  const nearPath = (x, y, d) => lineDistance(streetGrid, x, y, d) < d
  // A spot beside street k belongs to another street if that street's line is nearer.
  const onOtherStreet = (x, y, k, offset) => {
    for (const s of streetGrid.candidates(x, y, offset)) if (s.k !== k && distToSegment(x, y, s.a, s.b) < offset - 1e-6) return true
    return false
  }
  // The curved paths themselves: on the path, or closer than `extra` to its edge.
  const pathGrid = lineGrid(paths.map((p) => p.line))
  const onPath = (x, y, extra = 0) => lineDistance(pathGrid, x, y, pathClear + extra) < pathClear + extra

  const { x0, y0, x1, y1 } = bounds
  const inBox = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1
  const inSquare = (x, y) => squares.some((rings) => pointInPolygon(x, y, rings))

  const existingGrid = new SpatialGrid(spacing)
  kit.trees.forEach((t) => existingGrid.add(t.p[0], t.p[1], t))
  const treeGrid = new SpatialGrid(10)
  const shrubGrid = new SpatialGrid(5)
  const out = []
  const add = (x, y, kind, year) => out.push({ x, y, kind, year })

  // ---- Ponds --------------------------------------------------------------------------------
  const pc = pl.ponds
  const pondPlaces = [
    ...(pc.places.includes('square') ? squares : []),
    ...greenAreas.filter((a) => !a.private && pc.places.includes(a.class)).map((a) => a.rings),
  ]
  const pondOuter = pc.radius_m * (1 + pc.soft_edge_share)
  const candidates = []
  for (const rings of pondPlaces) {
    const [bx0, by0, bx1, by1] = polygonBox(rings)
    const step = pc.candidate_spacing_m
    for (let x = Math.ceil(bx0 / step) * step; x <= bx1; x += step)
      for (let y = Math.ceil(by0 / step) * step; y <= by1; y += step) {
        if (!inBox(x, y) || !pointInPolygon(x, y, rings)) continue
        if (nearBuilding(x, y, pc.radius_m + pc.keep_off_buildings_m)) continue
        if (nearPath(x, y, pc.radius_m + pc.keep_off_paths_m)) continue
        if (onPath(x, y, pondOuter)) continue
        candidates.push([x, y])
      }
  }
  // Spread over the map: a random first pond, then always the candidate farthest from the
  // ponds chosen so far.
  const ponds = []
  if (candidates.length) ponds.push(candidates[Math.floor(rand() * candidates.length)])
  while (ponds.length < Math.min(scenario.pond_count_growing, candidates.length)) {
    let best = null
    let bestD = -1
    for (const c of candidates) {
      const d = Math.min(...ponds.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])))
      if (d > bestD) (bestD = d), (best = c)
    }
    ponds.push(best)
  }
  for (const [x, y] of ponds) add(x, y, 'pond', yearIn(pc.years))
  const inPond = (x, y, margin) => ponds.some(([px, py]) => Math.hypot(px - x, py - y) < pondOuter + margin)

  // ---- Open meadow clearings ------------------------------------------------------------
  // The plantable ground: light cells in a green band or a square. Squares of clearings.cell_m
  // are picked at random until they hold share_of_full_sun of its full-sun cells.
  const cl = P.clearings
  const cc = (x, y) => `${Math.floor(x / cl.cell_m)},${Math.floor(y / cl.cell_m)}`
  const sunnyPerCell = new Map()
  let sunnyTotal = 0
  for (let r = 0; r < light.rows; r++)
    for (let c = 0; c < light.cols; c++) {
      if (light.classes[r * light.cols + c] !== CLASS.full_sun) continue
      const x = light.origin[0] + (c + 0.5) * light.cell
      const y = light.origin[1] + (r + 0.5) * light.cell
      if (!nearPath(x, y, band / 2) && !inSquare(x, y)) continue
      sunnyTotal++
      sunnyPerCell.set(cc(x, y), (sunnyPerCell.get(cc(x, y)) ?? 0) + 1)
    }
  const cells = [...sunnyPerCell.keys()]
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[cells[i], cells[j]] = [cells[j], cells[i]]
  }
  const clearings = new Set()
  let inClearings = 0
  for (const key of cells) {
    if (inClearings >= cl.share_of_full_sun * sunnyTotal) break
    clearings.add(key)
    inClearings += sunnyPerCell.get(key)
  }
  const inClearing = (x, y) => clearings.has(cc(x, y))

  // ---- Trees ------------------------------------------------------------------------------
  // One rule set for both waves. wave: { t: random helpers, year: fixed year (second wave), offShrubs }.
  const acceptance = { [CLASS.full_sun]: P.light_acceptance.full_sun, [CLASS.partial]: P.light_acceptance.partial_shade, [CLASS.shade]: P.light_acceptance.shade }
  const treeYear = () => (rand() < pl.later_tree_share ? yearIn(pl.later_tree_years) : start)
  const placeTree = (x, y, wave) => {
    const r = wave?.t.rand ?? rand
    if (!inBox(x, y) || inPond(x, y, 2) || inClearing(x, y)) return false
    if (r() > (acceptance[lightAt(light, x, y)] ?? 0)) return false
    if (treeGrid.anyWithin(x, y, P.min_tree_gap_m) || existingGrid.anyWithin(x, y, P.min_tree_gap_m)) return false
    if (nearBuilding(x, y, scenario.min_tree_distance_to_building_m)) return false
    if (onPath(x, y)) return false
    if (wave?.offShrubs && shrubGrid.anyWithin(x, y, P.shrubs.keep_off_trees_m)) return false
    add(x, y, 'tree', wave ? wave.year : treeYear())
    treeGrid.add(x, y, true)
    return true
  }

  // A sideways place in the band: `rel` metres from the path's centre line (at least pathClear),
  // kept inside the band. Returns the offset from the street line.
  const bandEdge = band / 2 - 0.5
  const fromPath = (k, d, rel) => {
    const r = Math.sign(rel) * Math.max(pathClear, Math.abs(rel))
    return Math.max(-bandEdge, Math.min(bandEdge, paths[k].shift(d) + r))
  }
  // Keeps a band spot between the path (keep_off_path_m) and the band's edge.
  const clampLateral = (l) => Math.sign(l) * Math.min(band / 2 - 0.5, Math.max(P.keep_off_path_m, Math.abs(l)))

  // Planned trees standing in each band (both waves), to measure their spacing.
  const bandTrees = new Array(streets.length).fill(0)

  // Walks the band of street k and plants trees in the given patterns. base: the spacing the
  // steps and gaps are shares of; minStep: smallest step within a group; stop: stop once
  // bandTrees[k] reaches it.
  const walkBand = (k, t, { patterns, base, minStep = 0, wave, stop = Infinity }) => {
    const w = paths[k].walk
    const treeLateral = (side) => clampLateral(side * (band * P.lateral_offset_share_of_band + t.between([-P.lateral_jitter_m, P.lateral_jitter_m])))
    const step = () => Math.max(minStep, base * t.between(P.step_share_of_spacing))
    const jitterAlong = (d) => d * (1 + t.between([-P.along_jitter_share, P.along_jitter_share]))
    const end = w.length - P.junction_clear_m
    let s = P.junction_clear_m + t.rand() * base * P.gap_share_of_spacing[0]
    while (s < end && bandTrees[k] < stop) {
      const side = t.rand() < 0.5 ? 1 : -1
      const spots = [] // [distance along, offset from the path]
      const pattern = t.weighted(patterns)
      if (pattern === 'row') {
        const n = t.intIn(P.row_trees)
        const d = step()
        for (let i = 0; i < n; i++) spots.push([s + jitterAlong(d) * i, treeLateral(side)])
      } else if (pattern === 'rhythm') {
        const n = t.intIn(P.rhythm_steps)
        const d = step()
        for (let i = 0; i < n; i++) if (i === 0 || t.rand() < P.rhythm_tree_share) spots.push([s + jitterAlong(d) * i, treeLateral(t.rand() < 0.75 ? side : -side)])
      } else if (pattern === 'cluster') {
        const n = t.intIn(P.cluster_trees)
        for (let i = 0; i < n; i++) spots.push([s + t.between([0, 2 * P.cluster_radius_m]), treeLateral(t.rand() < 0.7 ? side : -side)])
      } else spots.push([s, treeLateral(side)])

      let last = s
      for (const [d, rel] of spots) {
        if (d > end) continue
        last = Math.max(last, d)
        const lateral = fromPath(k, d, rel)
        const [x, y] = spotAt(w, d, lateral)
        if (!onOtherStreet(x, y, k, Math.abs(lateral)) && placeTree(x, y, wave)) bandTrees[k]++
      }
      s = last + base * t.between(P.gap_share_of_spacing)
    }
  }

  // Tree groups in the squares.
  const sq = pl.square_groups
  const squareGroups = (t, wave) => {
    for (const rings of squares) {
      const area = ringArea(rings[0]) - rings.slice(1).reduce((a, h) => a + ringArea(h), 0)
      const groups = Math.max(1, Math.round(area / sq.area_per_group_m2))
      const [bx0, by0, bx1, by1] = polygonBox(rings)
      const ok = (x, y) => pointInPolygon(x, y, rings) && !nearPath(x, y, sq.keep_off_paths_m)
      for (let g = 0; g < groups; g++) {
        let centre = null
        for (let i = 0; i < 40 && !centre; i++) {
          const x = t.between([bx0, bx1])
          const y = t.between([by0, by1])
          if (ok(x, y)) centre = [x, y]
        }
        if (!centre) continue
        const want = t.intIn(sq.trees_per_group)
        let placed = 0
        for (let i = 0; i < want * 10 && placed < want; i++) {
          const a = t.rand() * Math.PI * 2
          const r = Math.sqrt(t.rand()) * sq.group_radius_m
          const x = centre[0] + Math.cos(a) * r
          const y = centre[1] + Math.sin(a) * r
          if (ok(x, y) && placeTree(x, y, wave)) placed++
        }
      }
    }
  }

  // First wave: street trees, then the square groups.
  streets.forEach((_, k) => walkBand(k, first, { patterns: P.patterns, base: spacing }))
  squareGroups(first)
  const firstWaveBandTrees = bandTrees.reduce((a, b) => a + b, 0)

  // ---- Shrubs: small irregular groups along the bands --------------------------------------
  const sh = P.shrubs
  streets.forEach((line, k) => {
    const w = paths[k].walk
    const end = w.length - P.junction_clear_m
    let s = P.junction_clear_m + rand() * shrubSpacing
    while (s < end) {
      const side = rand() < 0.5 ? 1 : -1
      const n = first.intIn(sh.group_size)
      for (let i = 0; i < n; i++) {
        const d = s + i * between(sh.step_m)
        if (d > end) break
        const lateral = fromPath(k, d, clampLateral(side * (band * P.lateral_offset_share_of_band + between([-P.lateral_jitter_m, P.lateral_jitter_m]))))
        const [x, y] = spotAt(w, d, lateral)
        if (!inBox(x, y) || inPond(x, y, 1) || inBuilding(x, y) || nearBuilding(x, y, 1) || onOtherStreet(x, y, k, Math.abs(lateral))) continue
        if (treeGrid.anyWithin(x, y, sh.keep_off_trees_m) || shrubGrid.anyWithin(x, y, sh.min_gap_m)) continue
        if (inClearing(x, y) && rand() > sh.in_clearings) continue
        if (onPath(x, y)) continue
        add(x, y, 'shrub', start)
        shrubGrid.add(x, y, true)
      }
      s += n * sh.step_m[1] + shrubSpacing * between(sh.gap_share_of_spacing)
    }
  })

  // ---- Meadow: flat strips along the bands, with gaps; shorter gaps in the clearings ---------
  // Each strip runs from inner_m off the path's edge to the band edge on one side, with a
  // slightly uneven outer edge, so it follows the curving path. It is stored as an outline
  // (drawn hatched in the app).
  const md = P.meadow
  const meadow = []
  const pathHalf = scenario.paths.width_m / 2
  streets.forEach((line, k) => {
    const w = paths[k].walk
    const end = w.length - P.junction_clear_m / 2
    let s = P.junction_clear_m / 2 + rand() * md.gap_m[0]
    while (s < end) {
      const len = Math.min(between(md.patch_length_m), end - s)
      const side = rand() < 0.5 ? 1 : -1
      const [mx, my] = spotAt(w, s + len / 2, side * band / 4)
      if (len > 3 && inBox(mx, my) && !inBuilding(mx, my) && !onOtherStreet(mx, my, k, band / 4)) {
        const inner = []
        const outer = []
        const n = Math.max(2, Math.ceil(len / 2))
        const edge = side * (band / 2 - md.outer_margin_m)
        for (let i = 0; i <= n; i++) {
          const d = s + (len * i) / n
          // The two ends taper a little, so the strip does not look cut off.
          const taper = i === 0 || i === n ? 0.6 : 1
          const innerLat = paths[k].shift(d) + side * (pathHalf + md.inner_m)
          inner.push(spotAt(w, d, innerLat))
          outer.push(spotAt(w, d, innerLat + (edge - innerLat) * taper - side * rand() * 0.6))
        }
        // Keep only strips that still have room between the path and the band edge.
        if (inner.every((_, i) => Math.abs(paths[k].shift(s + (len * i) / n)) + pathHalf + md.inner_m < band / 2 - md.outer_margin_m - 0.6))
          meadow.push({ year: start, ring: [...inner, ...outer.reverse()] })
      }
      s += len + between(md.gap_m) * (inClearing(mx, my) ? md.in_clearings_gap_scale : 1)
    }
  })

  // ---- Second wave (trees.second_wave_year): more trees in between ---------------------------
  // Along each band, the planned trees should end up about spacing_2100_m apart over the
  // plantable length (outside the junctions and the clearings). The band is walked again in
  // the second-wave patterns, up to MAX_PASSES times, until that many trees stand in it. The same
  // rules apply as in the first wave, and the new trees keep off the shrubs.
  const second = tools(seededRandom(scenario.random_seed + 75))
  const spacing2 = scenario.trees.spacing_2100_m
  const wave2 = { t: second, year: secondYear, offShrubs: true }
  let plantableLength = 0
  streets.forEach((_, k) => {
    const w = paths[k].walk
    let free = 0
    for (let s = P.junction_clear_m; s <= w.length - P.junction_clear_m; s += 1) {
      const p = w.at(s)
      if (inBox(p.x, p.y) && !inClearing(p.x, p.y)) free++
    }
    plantableLength += free
    const target = Math.round(free / spacing2)
    for (let pass = 0; pass < MAX_PASSES && bandTrees[k] < target; pass++)
      walkBand(k, second, { patterns: P.patterns_second_wave, base: spacing2, minStep: P.min_tree_gap_m, wave: wave2, stop: target })
  })
  const before = out.filter((p) => p.kind === 'tree').length
  squareGroups(second, wave2)
  const allBandTrees = bandTrees.reduce((a, b) => a + b, 0)

  return {
    list: out,
    meadow,
    clearings: { cells: clearings.size, cell_m: cl.cell_m, share_of_full_sun: sunnyTotal ? inClearings / sunnyTotal : 0 },
    waves: {
      first_band_trees: firstWaveBandTrees,
      second_band_trees: allBandTrees - firstWaveBandTrees,
      second_square_trees: out.filter((p) => p.kind === 'tree').length - before,
      plantable_band_length_m: plantableLength,
      band_spacing_m: allBandTrees ? plantableLength / allBandTrees : 0,
      first_wave_band_spacing_m: firstWaveBandTrees ? plantableLength / firstWaveBandTrees : 0,
    },
  }
}

// How much is planted, and how much already counts (older than maturity_years), per layout.
export function summarise(kit, planting) {
  const { scenario } = kit
  const out = {}
  for (const [key, l] of Object.entries(scenario.layouts)) {
    const planted = Object.fromEntries(['meadow', ...KINDS].map((k) => [k, 0]))
    const counting = Object.fromEntries(['meadow', ...KINDS].map((k) => [k, 0]))
    const all = [...planting.list, ...planting.meadow.map((m) => ({ kind: 'meadow', year: m.year }))]
    for (const p of all) {
      if (p.year > l.year) continue
      planted[p.kind]++
      if (l.year - p.year > scenario.maturity_years[p.kind]) counting[p.kind]++
    }
    out[key] = { year: l.year, planted, counting }
  }
  return { layouts: out }
}

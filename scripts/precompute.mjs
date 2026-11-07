// npm run precompute — the heavy work, done once instead of in the browser.
// Reads public/data/ (scenario.json, species.json and the city kit) and writes
// public/data/derived/light.json, planting.json, roofs.json, routes.json, people.json and numbers.json.
// Run it again after changing scenario.json, species.json or the kit.
import fs from 'node:fs'
import path from 'node:path'
import { DATA, loadKit } from './load.mjs'
import { computeLight } from './light.mjs'
import { KINDS, computePlanting, summarise } from './planting.mjs'
import { computeRoofs } from './roofs.mjs'
import { computeRoutes } from './routes.mjs'
import { computePeople } from './people.mjs'

const t0 = performance.now()
const seconds = (a, b) => ((b - a) / 1000).toFixed(1) + ' s'

const kit = loadKit()
const tLoad = performance.now()

const light = computeLight(kit)
const tLight = performance.now()

const planting = computePlanting(kit, light)
const summary = summarise(kit, planting)
const tPlant = performance.now()

const roofs = computeRoofs(kit)
const tRoofs = performance.now()

const routes = computeRoutes(kit, light, planting, roofs)
const tRoutes = performance.now()

const people = computePeople(kit, light, routes)
const tPeople = performance.now()

const outDir = path.join(DATA, 'derived')
fs.mkdirSync(outDir, { recursive: true })

// ---- light.json --------------------------------------------------------------------------
const L = kit.scenario.light
const lightJson = {
  _note:
    'Written by npm run precompute; do not edit. Average hours of direct sun per day, ' +
    `${L.sample_days.join(', ')}, every ${L.sample_every_minutes} min, buildings as the only shade. ` +
    'Grid cells row by row from the south-west corner (origin_m, map metres from the kit centre), west to east, then northwards. ' +
    'classes: one character per cell, 0 = building, 1 = shade, 2 = partial shade, 3 = full sun. hours_x10: sun hours × 10 per cell (0 for buildings).',
  grid_cell_m: light.cell,
  origin_m: light.origin.map((v) => +v.toFixed(2)),
  cols: light.cols,
  rows: light.rows,
  thresholds_hours: { full_sun: L.full_sun_min_hours, partial_shade: L.partial_shade_min_hours },
  sun_samples: light.samples,
  classes: Array.from(light.classes).join(''),
  hours_x10: Array.from(light.hours, (h) => Math.round(h * 10)),
}

// ---- planting.json -----------------------------------------------------------------------
const list = [...planting.list].sort((a, b) => a.year - b.year || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind))
const plantingJson = {
  _note:
    'Written by npm run precompute; do not edit. Planned planting for Around 2050 and Around 2100. ' +
    `First wave in ${kit.scenario.planting_start_year} (trees, shrubs, meadow, ponds); second wave of trees in ${kit.scenario.trees.second_wave_year} (waves: counts and spacing along the green bands). ` +
    'plants: one column per field, the same index is the same plant, sorted by planting year. ' +
    'x_dm, y_dm: position in decimetres from the kit centre (east, north). kind: index into kinds. ' +
    'Plant species are not decided here. A plant counts once it is older than maturity_years for its kind. ' +
    'clearings: open meadow clearings kept free of planned trees. ' +
    'meadow: strips along the green bands, drawn hatched; rings are outlines as flat lists x, y, x, y, … in decimetres.',
  random_seed: kit.scenario.random_seed,
  kinds: KINDS,
  maturity_years: Object.fromEntries(KINDS.map((k) => [k, kit.scenario.maturity_years[k]])),
  clearings: planting.clearings,
  waves: planting.waves,
  plants: {
    x_dm: list.map((p) => Math.round(p.x * 10)),
    y_dm: list.map((p) => Math.round(p.y * 10)),
    kind: list.map((p) => KINDS.indexOf(p.kind)),
    year: list.map((p) => p.year),
  },
  meadow: {
    year: planting.meadow.map((m) => m.year),
    rings: planting.meadow.map((m) => m.ring.flatMap(([x, y]) => [Math.round(x * 10), Math.round(y * 10)])),
  },
  summary,
}

// ---- roofs.json --------------------------------------------------------------------------
const dm = (ring) => ring.flatMap(([x, y]) => [Math.round(x * 10), Math.round(y * 10)])
const gr = kit.scenario.green_roofs
const roofsJson = {
  _note:
    'Written by npm run precompute; do not edit. Green roofs on the service buildings, shown in ' + gr.layouts.join(', ') + '. ' +
    'roofs: z_dm roof height; outline: the whole roof (drawn as the white rim); green: the roof minus the rim, one entry per polygon, each a list of rings. ' +
    'Rings are flat lists x, y, x, y, … in decimetres from the kit centre. bushes and flower_clumps: positions on the green, z_dm their roof height. ' +
    'habitat_for_groups: species groups for which green roofs count as habitat in the route steps.',
  habitat_for_groups: gr.habitat_for_groups.groups,
  green_area_m2: Math.round(roofs.greenArea),
  roofs: roofs.roofs.map((r) => ({ z_dm: Math.round(r.z * 10), outline: r.outline.map(dm), green: r.green.map((poly) => poly.map(dm)) })),
  bushes: { x_dm: roofs.bushes.map((p) => Math.round(p.x * 10)), y_dm: roofs.bushes.map((p) => Math.round(p.y * 10)), z_dm: roofs.bushes.map((p) => Math.round(p.z * 10)) },
  flower_clumps: { x_dm: roofs.flowers.map((p) => Math.round(p.x * 10)), y_dm: roofs.flowers.map((p) => Math.round(p.y * 10)), z_dm: roofs.flowers.map((p) => Math.round(p.z * 10)) },
}

const write = (name, data) => {
  const file = path.join(outDir, name)
  fs.writeFileSync(file, JSON.stringify(data))
  return `${name} ${(fs.statSync(file).size / 1024).toFixed(0)} KB`
}
// ---- routes.json -------------------------------------------------------------------------
const d10 = (v) => Math.round(v * 10)
const flat = (pts) => pts.flatMap((p) => p.map(d10))
const routesJson = {
  _note:
    'Written by npm run precompute; do not edit. Species routes: models, not tracked movements. Positions in decimetres from the kit centre (east, north, up). ' +
    'habitats: the arrows on the map edge (dir: outward) and the green areas inside the map that are sources. anchors: every place routes run between (habitats and the largest existing green areas). ' +
    'routes: each computed once on the Around 2100 city and drawn with the same line (xyz_dm, already offset to its lane and lifted over roofs) in every layout from the one it appears in. ' +
    'end_type: how it ends where it works (stay: the species circle at a potential home; loop: back with an arrowhead near its start; cross: an arrowhead leaving the map). ' +
    'layouts.<key>: null before the route appears; cut: index into the line where it is broken there (a small cross), null when it works; home: the home at the end of a stay route has grown up; homes_dm: potential homes along the drawn part, x, y pairs. ' +
    'shared: runs [i0, i1, other route id, j0, j1] where points i0..i1 lie along points j0..j1 of an earlier route of the same species; drawn once, by that route, wherever it is drawn. Loop routes hold the way out only (the way back is the same). circles: one or two per route, idx: the line point the species circle is centred on; kind end (stay routes, shown where they work) or key (shown where the route is drawn past it). summary: per species and layout.',
  habitats: Object.values(routes.habitats).map((h) => ({ id: h.id, label: h.label, kind: h.kind, x_dm: d10(h.x), y_dm: d10(h.y), dir: h.dir ?? null, green_share: h.green_share ?? null, area_m2: h.area_m2 ?? null })),
  anchors: routes.anchors.map((a) => ({ id: a.id, label: a.label, kind: a.kind, x_dm: d10(a.x), y_dm: d10(a.y) })),
  missing_inside: routes.missingInside,
  routes: routes.routes.map((r) => ({
    id: r.id,
    species: r.s.id,
    group: r.g,
    appears: r.appears,
    end_type: r.et,
    from: r.from.id,
    to: r.to.id,
    lane: r.lane,
    length_m: Math.round(r.total),
    xyz_dm: flat(r.pts.map((p, i) => [p[0], p[1], r.z[i]])),
    layouts: Object.fromEntries(Object.entries(r.per).map(([k, v]) => [k, v && { cut: v.cut, home: v.home, homes_dm: flat(v.homes.map((h) => [h.x, h.y])) }])),
    circles: r.circles,
    shared: r.shared,
  })),
  summary: routes.summary,
}

// ---- people.json and numbers.json ---------------------------------------------------------------
const ringsDm = (rings) => rings.map((r) => r.flatMap(([x, y]) => [d10(x), d10(y)]))
const peopleJson = {
  _note:
    'Written by npm run precompute; do not edit. Positions in decimetres from the kit centre. rings: teleport stations (kind stop: above a transport building, the kit has no bus stops; service: above a large service building; merged: stations closer than rings.merge_within_m joined at their midpoint, buildings and kinds list them), node: the walkable node they start from. stops: where the Today bus stands, next to each stop (angle: street direction, radians). ' +
    'zones: pressure zones per walking time, as bands (the 10-minute band without the 5-minute zone, …), polygons of rings (outer first, then holes). main_edges: indices of streets.graph.json walkable edges (in file order) that carry the main paths; gathering: gathering places. ' +
    'interactions: where species routes cross a road or path at a height within people.path_height_band_m, points closer than interactions.merge_within_m merged; members: [route id in routes.json, line point k]; shown in a layout where one of its routes is drawn past its point k.',
  rings: people.rings.map((r) => ({ kind: r.kind, buildings: r.buildings, kinds: r.kinds, node: r.node, x_dm: d10(r.x), y_dm: d10(r.y) })),
  stops: people.stops.map((p) => ({ x_dm: d10(p.x), y_dm: d10(p.y), angle: +p.angle.toFixed(4) })),
  zones: people.zones.map((z) => ({ minutes: z.minutes, area_m2: z.area_m2, polygons_dm: z.polygons.map(ringsDm) })),
  main_edges: people.mainEdges,
  main_length_m: Math.round(people.mainLength),
  gathering_dm: people.gathering.map(([x, y]) => [d10(x), d10(y)]),
  interactions: people.interactions.map((it) => ({ x_dm: d10(it.p[0]), y_dm: d10(it.p[1]), z_dm: d10(it.z), members: it.members.map((m) => [m.route, m.k]) })),
}
const numbersJson = {
  _note:
    'Written by npm run precompute; do not edit. Per layout: unsealed_m2 (OpenStreetMap greenery, and the green bands without their paths where the streets are green; buildings, roads, paths and green roofs are sealed); habitat_pieces and largest_piece_m2 (connected unsealed areas of at least habitat_min_piece_m2); residents_near_habitat (Zensus residents within habitat_buffer_for_residents_m of a habitat piece, each cell counted by the share of its area inside, rounded to 10; cells_without_count: overlapping cells with no published resident count, left out); per species: routes shown, broken, and of the working ones crossing, looping and staying, potential homes and interaction points.',
  layouts: people.numbers,
}

const files = [write('light.json', lightJson), write('planting.json', plantingJson), write('roofs.json', roofsJson), write('routes.json', routesJson), write('people.json', peopleJson), write('numbers.json', numbersJson)]
const tEnd = performance.now()

// ---- Report ------------------------------------------------------------------------------
const count = (arr, v) => arr.reduce((n, x) => n + (x === v ? 1 : 0), 0)
const cells = light.cols * light.rows
const ground = cells - count(light.classes, 0)
const share = (c) => ((100 * count(light.classes, c)) / ground).toFixed(0) + '%'
console.log(`Grid: ${light.cols} × ${light.rows} = ${cells} cells of ${light.cell} m (${ground} outside buildings)`)
console.log(`Light: full sun ${share(3)}, partial shade ${share(2)}, shade ${share(1)}  (${light.samples} sun positions)`)
const byKind = KINDS.map((k) => `${k} ${planting.list.filter((p) => p.kind === k).length}`).join(', ')
console.log(`Clearings: ${(100 * planting.clearings.share_of_full_sun).toFixed(0)}% of the full-sun ground in bands and squares, ${planting.clearings.cells} squares of ${planting.clearings.cell_m} m`)
console.log(`Planting: ${planting.list.length} plants: ${byKind}; ${planting.meadow.length} meadow strips`)
const W = planting.waves
console.log(
  `Trees in the green bands: first wave ${W.first_band_trees} (one every ${W.first_wave_band_spacing_m.toFixed(1)} m), second wave ${W.second_band_trees}, ` +
    `together one every ${W.band_spacing_m.toFixed(1)} m of plantable band (target ${kit.scenario.trees.spacing_2100_m} m); second wave in the squares: ${W.second_square_trees}`,
)
console.log(`Green roofs: ${roofs.roofs.length} roofs, ${Math.round(roofs.greenArea)} m² green, ${roofs.bushes.length} bushes, ${roofs.flowers.length} flower clumps`)
console.log('Habitats: ' + Object.values(routes.habitats).map((h) => `${h.label} (${h.kind}${h.kind === 'edge' ? ', ' + Math.round(h.green_share * 100) + '% green' : ''} at ${Math.round(h.x)}, ${Math.round(h.y)})`).join('; '))
if (routes.missingInside.length) console.log('Not inside the map: ' + routes.missingInside.join(', '))
console.log('Anchors: ' + routes.anchors.map((a) => a.label).join(', '))
console.log('Routes per species (routes shown, of them broken, potential homes; species.json behaviour):')
const pad = (v, n) => String(v).padEnd(n)
const layoutKeys = Object.keys(kit.scenario.layouts)
console.log('  ' + pad('species', 26) + pad('cands', 7) + layoutKeys.map((k) => pad(k, 28)).join(''))
for (const sp of kit.species.species) {
  const S = routes.summary[sp.id]
  const cellsOf = layoutKeys.map((k) => {
    const v = S.layouts[k]
    return pad(`${v.routes} (+${v.new}) ${v.broken} br, ${v.homes} h; ${v.behaviour}`, 28)
  })
  console.log('  ' + pad(sp.id, 26) + pad(S.candidates, 7) + cellsOf.join(''))
  for (const n of S.notes) console.log('      note: ' + n)
}
console.log(`Same-species shared stretches drawn once: ${Math.round(routes.sharedM)} m`)
console.log(`Teleport stations: ${people.stationsBeforeMerge} (above transport buildings, the kit has no bus stops, and service buildings over ${kit.scenario.rings.min_service_footprint_m2} m²), merged within ${kit.scenario.rings.merge_within_m} m into ${people.rings.length}`)
console.log(`Interaction points: ${people.rawInteractions}, merged within ${kit.scenario.interactions.merge_within_m} m into ${people.interactions.length}`)
console.log('Pressure zones: ' + people.zones.map((z, i) => `${z.minutes} min ${Math.round(z.area_m2 / 10000)} ha`).join(', '))
console.log(`Main paths: ${people.mainEdges.length} segments, ${(people.mainLength / 1000).toFixed(1)} km; ${people.gathering.length} gathering places`)
console.log('Numbers (Today / 2050 / 2100):')
const N = people.numbers
const row = (label, f) => console.log('  ' + pad(label, 34) + layoutKeys.map((k) => pad(f(N[k]), 16)).join(''))
row('unsealed green m²', (v) => v.unsealed_m2)
row('habitat pieces', (v) => v.habitat_pieces)
row('largest piece m²', (v) => v.largest_piece_m2)
row('residents near habitat', (v) => v.residents_near_habitat)
row('cells without resident count', (v) => v.cells_without_count)
for (const sp of kit.species.species) row(sp.id + ' (r br cr lo st h i)', (v) => { const x = v.species[sp.id]; return [x.routes, x.broken, x.cross, x.loop, x.stay, x.homes, x.interactions].join(' ') })
console.log(`Time: load ${seconds(t0, tLoad)}, light ${seconds(tLoad, tLight)}, planting ${seconds(tLight, tPlant)}, roofs ${seconds(tPlant, tRoofs)}, routes ${seconds(tRoofs, tRoutes)}, people and numbers ${seconds(tRoutes, tPeople)}, total ${seconds(t0, tEnd)}`)
console.log(`Files: ${files.join(', ')}`)

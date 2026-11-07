// Tree variety: which of the five tree types each tree is, and its own height, crown width,
// crown squash and shade of green. Every rule and range comes from scenario.json (trees,
// colours.tree_*); the fixed random seed makes it the same on every load.
import * as THREE from 'three'
import { seededRandom } from './geo.js'

const between = (rand, [lo, hi]) => lo + (hi - lo) * rand()

// Picks a key from { key: weight }, ignoring keys starting with "_".
function weighted(rand, weights) {
  const entries = Object.entries(weights).filter(([k, w]) => !k.startsWith('_') && w > 0)
  const total = entries.reduce((s, [, w]) => s + w, 0)
  let r = rand() * total
  for (const [k, w] of entries) if ((r -= w) <= 0) return k
  return entries[entries.length - 1][0]
}

// A shade around the base colour, so no two trees are exactly alike.
function shade(rand, base, v) {
  const c = new THREE.Color(base)
  return c.offsetHSL(((rand() * 2 - 1) * v.hue_deg) / 360, (rand() * 2 - 1) * v.saturation, (rand() * 2 - 1) * v.lightness)
}

// The type for a mapped tree: by genus if known, else by leaf type, else at random by weight.
function existingType(t, cfg, genusType, rand) {
  const genus = t.genus?.split(/\s+/)[0]
  if (genus && genusType[genus]) return genusType[genus]
  const byLeaf = cfg.leaf_type[t.leafType]
  if (byLeaf) return byLeaf
  const weights = { ...cfg.existing_type_weights }
  if (t.leafType === 'broadleaved') delete weights.conifer
  return weighted(rand, weights)
}

// One tree, shrub or meadow clump: its type, size, slight squash, turn and colour.
function sized(rand, x, y, type, height, widthShare, colour, squash = [0.9, 1.1]) {
  return { x, y, type, height, width: height * widthShare, squash: between(rand, squash), turn: rand() * Math.PI * 2, colour }
}

// Mapped (existing) trees, in lighter greens. A mapped height is kept as data, but never lower
// than a shrub.
export function existingTrees(city) {
  const { scenario } = city
  const cfg = scenario.trees
  const rand = seededRandom(scenario.random_seed + 11)
  const genusType = {}
  for (const [type, t] of Object.entries(cfg.types)) for (const g of t.genera) genusType[g] = type
  const minHeight = cfg.shrub.height_m[1] + 0.5

  return city.trees.map((t) => {
    const type = existingType(t, cfg, genusType, rand)
    const range = cfg.types[type]
    const height = t.height ? Math.max(t.height, minHeight) : between(rand, range.height_m)
    return sized(rand, t.x, t.y, type, height, between(rand, range.crown_width_share), shade(rand, scenario.colours.tree_existing, cfg.colour_variation))
  })
}

// Planned planting as it stands in the given year (derived/planting.json, city.planting): trees
// and shrubs in darker greens, and ponds. Planned trees take the same size ranges as existing
// trees of their type, times trees.scale_<year> for the first wave (1.6 in both later layouts)
// and trees.scale_second_wave for the trees planted in trees.second_wave_year (25 years old
// in 2100, so smaller). Each plant has its own fixed random numbers (from the seed and its
// index), so it keeps its type and shape in every layout.
export function plannedPlanting(city, year) {
  const { scenario, planting } = city
  const cfg = scenario.trees
  const col = scenario.colours
  const firstScale = cfg[`scale_${year}`] ?? 1
  const treeScale = (planted) => (planted >= cfg.second_wave_year ? cfg.scale_second_wave : firstScale)
  const minTree = cfg.shrub.height_m[1] + 0.5
  const out = { trees: [], shrubs: [], ponds: [] }

  for (const pl of planting.plants) {
    if (pl.year > year) break // sorted by planting year
    const rand = seededRandom(Math.imul(scenario.random_seed + 23, 100003) + pl.index)
    if (pl.kind === 'tree') {
      const type = weighted(rand, cfg.planned_type_weights)
      const range = cfg.types[type]
      const height = Math.max(between(rand, range.height_m) * treeScale(pl.year), minTree)
      out.trees.push(sized(rand, pl.x, pl.y, type, height, between(rand, range.crown_width_share), shade(rand, col.tree_planned, cfg.colour_variation)))
    } else if (pl.kind === 'shrub') {
      const young = year - pl.year < scenario.maturity_years.shrub ? cfg.shrub.young_scale : 1
      const height = between(rand, cfg.shrub.height_m) * young
      out.shrubs.push(sized(rand, pl.x, pl.y, 'shrub', height, between(rand, cfg.shrub.crown_width_share), shade(rand, col.tree_planned, cfg.colour_variation), cfg.shrub.squash))
    } else if (pl.kind === 'pond') {
      out.ponds.push({ x: pl.x, y: pl.y, seed: Math.floor(rand() * 1e9) })
    }
  }
  return out
}

// Bushes and flower clumps on the green roofs (derived/roofs.json, city.roofs), each with its own
// size, turn and colour from the seed; base is the roof height plus the green's raise.
export function roofPlants(city) {
  const { scenario, roofs } = city
  const gr = scenario.green_roofs
  const col = scenario.colours
  const rand = seededRandom(scenario.random_seed + 43)
  const bushes = roofs.bushes.map((b) => {
    const h = between(rand, gr.bush_height_m)
    return { ...sized(rand, b.x, b.y, 'shrub', h, between(rand, gr.bush_width_share), shade(rand, col.tree_planned, scenario.trees.colour_variation), scenario.trees.shrub.squash), base: b.z + gr.raise_m }
  })
  const flowers = roofs.flowers.map((f) => {
    const h = between(rand, gr.flower_height_m)
    const colour = new THREE.Color(col.roof_flowers[Math.floor(rand() * col.roof_flowers.length)])
    return { ...sized(rand, f.x, f.y, 'roofFlowers', h, between(rand, gr.flower_width_m) / h, colour, [0.8, 1.2]), base: f.z + gr.raise_m }
  })
  return { bushes, flowers }
}

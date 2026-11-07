// The 3D city. Map metres: x = east, z = minus north, y = up.
// Colours, widths and spacings come from scenario.json; see look.js for drawing-only choices.
import { useCallback, useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { existingTrees, plannedPlanting, roofPlants } from './trees.js'
import { seededRandom } from './geo.js'
import {
  BUS_HEIGHT_M,
  BUS_LENGTH_M,
  BUS_WIDTH_M,
  CAR_HEIGHT_M,
  CAR_LENGTH_M,
  CAR_WIDTH_M,
  LIGHT_LAYER_OPACITY,
  PERSON_HEIGHT_M,
  ROBOT_HEIGHT_M,
} from './look.js'
import { placeTraffic } from './traffic.js'
import { curvedPaths, placeFigures } from './paths.js'
import Routes from './Routes.jsx'
import { GatheringPlaces, Interactions, PressureZones, Stations } from './People.jsx'

// Heights above the ground for the flat layers, so they never flicker into each other.
// `shadow` is the see-through layer that shows the building shadows on the ground and greenery.
// `path` is the paved path on the green bands, just above the meadow hatching.
// `pond` lies on the green bands and under the shadows. `light` is the light layer, above the
// shadows so they never darken it. Species routes, circles, rings and markers go at `overlay`
// or higher, with unlit (Basic) materials and without receiveShadow, so the shadows never
// darken them.
// `zones` (pressure zones) lie on the ground and greenery, below the meadow and all planting;
// `mainPath` and `gathering` lie on the paths.
const Y = { green: 0.2, band: 0.4, zones: 0.405, meadow: 0.41, path: 0.415, mainPath: 0.417, gathering: 0.419, pondRim: 0.42, pond: 0.45, shadow: 0.5, light: 0.6, line: 0.7, overlay: 1.0 }

// The light layer from derived/light.json: one pixel per grid cell in the light colours of
// scenario.json; cells inside buildings stay see-through. Row 0 of the grid is the south edge,
// which is also the bottom row of the texture.
function lightTexture(light, col) {
  const palette = { 1: col.light_shade, 2: col.light_partial, 3: col.light_full_sun }
  const rgb = Object.fromEntries(Object.entries(palette).map(([k, hex]) => [k, [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))]))
  const data = new Uint8Array(light.cols * light.rows * 4)
  for (let i = 0; i < light.classes.length; i++) {
    const c = rgb[light.classes[i]]
    if (!c) continue
    data.set([...c, 255], i * 4)
  }
  const tex = new THREE.DataTexture(data, light.cols, light.rows, THREE.RGBAFormat)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.needsUpdate = true
  return tex
}

// Ponds: flat, soft-edged shapes. Each outline is a circle bent by two slow waves (wobble), so
// no two ponds look alike; a slightly larger, paler rim (soft_edge_share) softens the edge.
// Returns two merged geometries: the water and the rim.
function buildPonds(ponds, cfg) {
  const water = []
  const rim = []
  for (const p of ponds) {
    const rand = seededRandom(p.seed)
    const ph1 = rand() * Math.PI * 2
    const ph2 = rand() * Math.PI * 2
    const stretch = 0.8 + 0.4 * rand()
    const outline = (scale) => {
      const pts = []
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2
        const r = cfg.radius_m * scale * (1 + cfg.wobble * (0.6 * Math.sin(2 * a + ph1) + 0.4 * Math.sin(3 * a + ph2)))
        pts.push(new THREE.Vector2(p.x + Math.cos(a) * r * stretch, p.y + Math.sin(a) * r / stretch))
      }
      return new THREE.ShapeGeometry(new THREE.Shape(pts)).rotateX(-Math.PI / 2)
    }
    water.push(outline(1))
    rim.push(outline(1 + cfg.soft_edge_share))
  }
  const merge = (list) => (list.length ? mergeGeometries(list, false) : new THREE.BufferGeometry())
  return { water: merge(water), rim: merge(rim) }
}

// One small repeating tile for the meadow hatching: the greenery fill with one diagonal line
// in meadow_hatch. The tile is hatch_spacing_m × √2 wide, so the lines lie hatch_spacing_m
// apart; hatch_width_m is the line width.
function hatchTexture(fill, line, md) {
  const px = 64
  const tile = md.hatch_spacing_m * Math.SQRT2
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = px
  const g = canvas.getContext('2d')
  g.fillStyle = fill
  g.fillRect(0, 0, px, px)
  g.strokeStyle = line
  g.lineWidth = ((md.hatch_width_m * Math.SQRT2) / tile) * px
  // The line and its two wrapped corner pieces, so the tiles join without seams.
  for (const o of [-px, 0, px]) {
    g.beginPath()
    g.moveTo(o, px)
    g.lineTo(o + px, 0)
    g.stroke()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  tex.userData.tile = tile
  return tex
}

// Meadow strips as one flat mesh. Texture coordinates follow the map in metres, so the
// hatching runs the same way and at the same spacing everywhere.
function buildMeadow(rings, md) {
  if (!rings.length) return new THREE.BufferGeometry()
  const g = new THREE.ShapeGeometry(rings.map((r) => new THREE.Shape(vec2(r))), 1)
  const pos = g.attributes.position
  const uv = g.attributes.uv
  const tile = md.hatch_spacing_m * Math.SQRT2
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / tile, pos.getY(i) / tile)
  return g.rotateX(-Math.PI / 2)
}

// Green roofs: the whole roof as the white rim, and the green inside it lifted by raise_m
// (the rim by half that), so neither flickers against the building's own roof.
function buildRoofs(roofs, raise) {
  const rim = []
  const green = []
  for (const r of roofs) {
    rim.push(new THREE.ShapeGeometry(shapeOf(r.outline)).rotateX(-Math.PI / 2).translate(0, r.z + raise / 2, 0))
    for (const poly of r.green) green.push(new THREE.ShapeGeometry(shapeOf(poly)).rotateX(-Math.PI / 2).translate(0, r.z + raise, 0))
  }
  const merge = (list) => {
    if (!list.length) return new THREE.BufferGeometry()
    list.forEach((g) => g.deleteAttribute('uv'))
    return mergeGeometries(list, false)
  }
  return { rim: merge(rim), green: merge(green) }
}

const vec2 = (ring) => ring.map(([x, y]) => new THREE.Vector2(x, y))

function shapeOf([outer, ...holes]) {
  const shape = new THREE.Shape(vec2(outer))
  for (const h of holes) if (h.length >= 3) shape.holes.push(new THREE.Path(vec2(h)))
  return shape
}

// Buildings in two meshes, without any outline: ordinary buildings white (colours.building),
// service buildings in the pastel colours.service_building. Light and shadow alone set them
// apart from the ground.
function buildBuildings(buildings) {
  const plain = []
  const service = []
  for (const b of buildings) {
    if (b.rings[0].length < 3) continue
    const g = new THREE.ExtrudeGeometry(shapeOf(b.rings), { depth: Math.max(b.height, 0.3), bevelEnabled: false })
    g.deleteAttribute('uv')
    g.rotateX(-Math.PI / 2)
    if (b.service) service.push(g)
    else plain.push(g)
  }
  const merge = (list) => {
    const m = list.length ? mergeGeometries(list, false) : new THREE.BufferGeometry()
    list.forEach((g) => g.dispose())
    return m
  }
  return { plain: merge(plain), service: merge(service) }
}

// The display sun from scenario.json (display.sun: azimuth and altitude in degrees), plus a soft
// sky light. Light strengths are chosen so that roofs come out the full building colour, walls
// facing the sun a little darker, and walls facing away clearly darker: roofs are always the
// lightest face. The sky light's ground colour is what darkens the walls.
const SKY_LIGHT = 2.45
const SKY_GROUND_COLOUR = '#A0A0A0'
const SUN_LIGHT = 1.2
function buildSun(display, bounds) {
  const { azimuth_deg, altitude_deg } = display.sun
  const altitude = altitude_deg
  const alt = (altitude_deg * Math.PI) / 180
  const az = (azimuth_deg * Math.PI) / 180
  // Towards the sun, in scene axes (x = east, y = up, z = minus north).
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt))

  const { x0, y0, x1, y1 } = bounds
  const centre = new THREE.Vector3((x0 + x1) / 2, 0, -(y0 + y1) / 2)
  const reach = Math.hypot(x1 - x0, y1 - y0) / 2 + 100

  const up = altitude > 0
  const light = new THREE.DirectionalLight('#ffffff', up ? SUN_LIGHT : 0)
  light.position.copy(centre).addScaledVector(dir, reach * 2)
  light.target.position.copy(centre)
  light.castShadow = up
  const cam = light.shadow.camera
  cam.left = -reach
  cam.right = reach
  cam.top = reach
  cam.bottom = -reach
  cam.near = 1
  cam.far = reach * 4
  light.shadow.mapSize.set(4096, 4096)
  light.shadow.radius = 4 // soft edges
  light.shadow.bias = -0.0005
  light.shadow.normalBias = 0.6
  return light
}

function buildGreen(areas) {
  const g = new THREE.ShapeGeometry(areas.map((a) => shapeOf(a.rings)), 2)
  g.rotateX(-Math.PI / 2)
  return g
}

// Thin lines along every street.
function buildLines(streets) {
  const pos = []
  for (const line of streets)
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = line[i - 1]
      const [bx, by] = line[i]
      pos.push(ax, Y.line, -ay, bx, Y.line, -by)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return g
}

// Flat bands of the given width along every line, at height y: a strip per segment and a
// round patch (seg corners) at every point, so the bands join without gaps. Used for the
// green bands along the streets and for the curving paths on them.
function buildBands(streets, width, y = Y.band, SEG = 16) {
  const h = width / 2
  const pos = []
  const tri = (a, b, c) => pos.push(a[0], y, -a[1], b[0], y, -b[1], c[0], y, -c[1])
  const disc = ([x, y]) => {
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI * 2
      const a1 = ((i + 1) / SEG) * Math.PI * 2
      tri([x, y], [x + h * Math.cos(a0), y + h * Math.sin(a0)], [x + h * Math.cos(a1), y + h * Math.sin(a1)])
    }
  }
  for (const line of streets) {
    line.forEach(disc)
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = line[i - 1]
      const [bx, by] = line[i]
      const len = Math.hypot(bx - ax, by - ay)
      if (!len) continue
      const nx = (-(by - ay) / len) * h
      const ny = ((bx - ax) / len) * h
      const p1 = [ax + nx, ay + ny]
      const p2 = [bx + nx, by + ny]
      const p3 = [bx - nx, by - ny]
      const p4 = [ax - nx, ay - ny]
      tri(p1, p4, p3)
      tri(p1, p3, p2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
}

function coloured(geometry, colour) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry
  const c = new THREE.Color(colour)
  const n = g.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return g
}

// ---- Trees -------------------------------------------------------------------------------
// Every tree shape is 1 m tall and its crown 1 m wide; each copy is stretched to its own
// height and crown width. Crown parts carry tint 1 and take the copy's own green; trunks carry
// tint 0 and keep the trunk colour.
function part(geometry, colour, tint) {
  const g = coloured(geometry, colour)
  g.setAttribute('tint', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill(tint), 1))
  return g
}
const trunkPart = (geometry, trunk) => part(geometry, trunk, 0)
const crownPart = (geometry) => part(geometry, '#ffffff', 1)
const trunkOf = (h, r = 0.035) => new THREE.CylinderGeometry(r * 0.7, r, h, 5).translate(0, h / 2, 0)

const TREE_SHAPES = {
  // Round broadleaf: short trunk, wide low crown.
  round: (trunk) => [trunkPart(trunkOf(0.4), trunk), crownPart(new THREE.IcosahedronGeometry(0.5, 0).scale(1, 0.62, 1).translate(0, 0.69, 0))],
  // Tall oval broadleaf: a higher, egg-shaped crown.
  oval: (trunk) => [trunkPart(trunkOf(0.3), trunk), crownPart(new THREE.IcosahedronGeometry(0.5, 0).scale(1, 0.8, 1).translate(0, 0.6, 0))],
  // Narrow columnar: a long crown from low down.
  columnar: (trunk) => [trunkPart(trunkOf(0.15, 0.06), trunk), crownPart(new THREE.DodecahedronGeometry(0.5, 0).scale(1, 0.9, 1).translate(0, 0.55, 0))],
  // Conifer: two stacked cones.
  conifer: (trunk) => [
    trunkPart(trunkOf(0.15, 0.05), trunk),
    crownPart(new THREE.ConeGeometry(0.5, 0.6, 7).translate(0, 0.42, 0)),
    crownPart(new THREE.ConeGeometry(0.36, 0.55, 7).translate(0, 0.725, 0)),
  ],
  // Small multi-stem tree: three leaning stems, three crown lumps.
  multi_stem: (trunk) => [
    ...[-0.35, 0.05, 0.4].map((lean, i) =>
      trunkPart(trunkOf(0.55, 0.05).rotateZ(lean).rotateY((i * Math.PI * 2) / 3), trunk),
    ),
    crownPart(new THREE.IcosahedronGeometry(0.3, 0).scale(1, 0.75, 1).translate(-0.2, 0.62, 0.05)),
    crownPart(new THREE.IcosahedronGeometry(0.3, 0).scale(1, 0.75, 1).translate(0.2, 0.65, -0.08)),
    crownPart(new THREE.IcosahedronGeometry(0.3, 0).scale(1, 0.75, 1).translate(0, 0.78, 0.1)),
  ],
  // Shrub: three uneven lumps, no trunk (its height and width make it lower and wider than any tree).
  shrub: () => [
    crownPart(new THREE.DodecahedronGeometry(0.5, 0).scale(1, 0.85, 1).translate(0, 0.43, 0)),
    crownPart(new THREE.IcosahedronGeometry(0.36, 0).translate(0.33, 0.33, 0.12)),
    crownPart(new THREE.DodecahedronGeometry(0.32, 0).translate(-0.3, 0.3, -0.15)),
  ],
  // Flower clump on a green roof: a handful of small flower heads at different heights.
  roofFlowers: () =>
    [
      [0, 0.6, 0, 0.3],
      [0.35, 0.4, 0.15, 0.25],
      [-0.3, 0.45, -0.2, 0.27],
      [0.1, 0.3, -0.38, 0.22],
      [-0.15, 0.3, 0.35, 0.22],
    ].map(([x, y, z, r]) => crownPart(new THREE.IcosahedronGeometry(r, 0).translate(x, y, z))),
}

// Shapes that are fitted to exactly 1 m tall and 1 m wide after building them.
const FIT_TO_UNIT = new Set(['shrub', 'roofFlowers'])
function unitShape(type, trunk) {
  const g = mergeGeometries(TREE_SHAPES[type](trunk), false)
  if (!FIT_TO_UNIT.has(type)) return g
  g.computeBoundingBox()
  const { min, max } = g.boundingBox
  const w = Math.max(max.x - min.x, max.z - min.z)
  return g.translate(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2).scale(1 / w, 1 / (max.y - min.y), 1 / w)
}

// The usual flat-shaded material, except that a copy's own colour only tints the parts marked
// with tint 1 (the crown).
function treeMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
  mat.onBeforeCompile = (shader) => {
    const chunk = THREE.ShaderChunk.color_vertex.replace('vColor.rgb *= instanceColor.rgb;', 'vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, tint );')
    shader.vertexShader = 'attribute float tint;\n' + shader.vertexShader.replace('#include <color_vertex>', chunk)
  }
  return mat
}

// One instanced mesh for all plants of one shape.
// items: { x, y, height, width, squash, turn, colour, base? } (base: height above the ground).
function treeMesh(type, items, trunk) {
  const geometry = unitShape(type, trunk)
  const mesh = new THREE.InstancedMesh(geometry, treeMaterial(), Math.max(items.length, 1))
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  items.forEach((it, i) => {
    q.setFromAxisAngle(up, it.turn)
    m.compose(new THREE.Vector3(it.x, it.base ?? 0, -it.y), q, new THREE.Vector3(it.width * it.squash, it.height, it.width / it.squash))
    mesh.setMatrixAt(i, m)
    mesh.setColorAt(i, it.colour)
  })
  mesh.count = items.length
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.computeBoundingSphere()
  mesh.receiveShadow = true
  mesh.raycast = () => {}
  return mesh
}

// A low-poly parked car, facing along x: a rounded body and a smaller rounded cabin.
function carGeometry(colour) {
  const L = CAR_LENGTH_M
  const W = CAR_WIDTH_M
  const H = CAR_HEIGHT_M
  const body = new RoundedBoxGeometry(L, H * 0.55, W, 1, 0.25).translate(0, H * 0.3, 0)
  const cabin = new RoundedBoxGeometry(L * 0.55, H * 0.45, W * 0.85, 1, 0.2).translate(-L * 0.05, H * 0.75, 0)
  return mergeGeometries([coloured(body, colour), coloured(cabin, colour)], false)
}

// A low-poly parked bus, facing along x: one long box with slightly rounded edges.
function busGeometry(colour) {
  return coloured(new RoundedBoxGeometry(BUS_LENGTH_M, BUS_HEIGHT_M, BUS_WIDTH_M, 1, 0.2).translate(0, BUS_HEIGHT_M / 2, 0), colour)
}

// A thin, low-poly bike, facing along x: two upright wheels, a frame bar, seat post and handlebar.
function bikeGeometry(colour) {
  const wheel = (x) => new THREE.TorusGeometry(0.33, 0.03, 4, 12).translate(x, 0.33, 0)
  const parts = [
    wheel(-0.52),
    wheel(0.52),
    new THREE.BoxGeometry(1.0, 0.05, 0.05).translate(0, 0.62, 0),
    new THREE.BoxGeometry(0.05, 0.4, 0.05).translate(-0.3, 0.75, 0),
    new THREE.BoxGeometry(0.05, 0.5, 0.05).translate(0.45, 0.8, 0),
    new THREE.BoxGeometry(0.05, 0.04, 0.55).translate(0.45, 1.05, 0),
  ]
  return mergeGeometries(parts.map((g) => coloured(g, colour)), false)
}

// A standing person, low-poly: a slightly tapered body and a round head, PERSON_HEIGHT_M tall.
function personGeometry(colour) {
  const H = PERSON_HEIGHT_M
  const body = new THREE.CylinderGeometry(0.17, 0.22, H * 0.78, 6).translate(0, (H * 0.78) / 2, 0)
  const head = new THREE.IcosahedronGeometry(H * 0.1, 0).translate(0, H * 0.9, 0)
  return mergeGeometries([coloured(body, colour), coloured(head, colour)], false)
}

// A small path robot, facing along x: a low rounded body and a little sensor head, ROBOT_HEIGHT_M tall.
function robotGeometry(colour) {
  const H = ROBOT_HEIGHT_M
  const body = new RoundedBoxGeometry(0.8, H * 0.6, 0.55, 1, 0.08).translate(0, H * 0.1 + (H * 0.6) / 2, 0)
  const head = new RoundedBoxGeometry(0.25, H * 0.3, 0.3, 1, 0.05).translate(0.15, H * 0.7 + (H * 0.3) / 2, 0)
  return mergeGeometries([coloured(body, colour), coloured(head, colour)], false)
}

// One instanced mesh for many copies of the same plant. items: { x, y, height, turn }.
function instanced(geometry, items) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
  const mesh = new THREE.InstancedMesh(geometry, mat, items.length)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  items.forEach((it, i) => {
    q.setFromAxisAngle(up, it.turn)
    m.compose(new THREE.Vector3(it.x, 0, -it.y), q, new THREE.Vector3(it.height, it.height, it.height))
    mesh.setMatrixAt(i, m)
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
  mesh.raycast = () => {}
  return mesh
}

function useDispose(...things) {
  useEffect(() => () => things.forEach((t) => t?.dispose?.()), things) // eslint-disable-line react-hooks/exhaustive-deps
}

// layers: which layers are on (App.jsx): groups (species group → on), rings, zones, paths,
// interactions, light, planting, buildings.
function Scene({ city, layout, layers, selection, onSelect, highlightNew }) {
  const { scenario, bounds } = city
  const col = scenario.colours
  const display = scenario.display

  // Greenery drawn as a solid fill: greenery_fill mixed with the ground at greenery_opacity
  // (at opacity 1 that is greenery_fill itself), so overlapping areas look the same as single ones.
  const green = useMemo(
    () => '#' + new THREE.Color(col.ground_plane).lerp(new THREE.Color(col.greenery_fill), col.greenery_opacity).getHexString(),
    [col],
  )

  const buildingGeo = useMemo(() => buildBuildings(city.buildings), [city])
  const sun = useMemo(() => buildSun(display, bounds), [display, bounds])
  useEffect(() => () => sun.dispose(), [sun])
  const greenGeo = useMemo(() => buildGreen(city.greenAreas), [city])
  const lineGeo = useMemo(() => buildLines(city.streets), [city])
  const bandGeo = useMemo(() => buildBands(city.streets, scenario.street_green_band_width_m), [city, scenario])

  // Planting, as it stands in the layout's year: one instanced mesh per tree type (existing
  // trees in lighter greens and planned trees in darker greens together), one for shrubs; the
  // hatched meadow strips; and the ponds. Rebuilt when the layout changes, because planned
  // plants grow from one layout to the next.
  const year = scenario.layouts[layout].year
  const existing = useMemo(() => existingTrees(city), [city])
  const planting = useMemo(() => {
    const planned = plannedPlanting(city, year)
    const meshes = {}
    for (const type of Object.keys(scenario.trees.types))
      meshes[type] = treeMesh(type, [...existing.filter((t) => t.type === type), ...planned.trees.filter((t) => t.type === type)], col.tree_trunk)
    meshes.shrub = treeMesh('shrub', planned.shrubs, col.tree_trunk)
    return {
      meshes,
      ponds: buildPonds(planned.ponds, scenario.planting.ponds),
      meadow: buildMeadow(city.planting.meadow.filter((m) => m.year <= year).map((m) => m.ring), scenario.trees.placement.meadow),
    }
  }, [city, existing, year, scenario, col])
  useEffect(
    () => () => {
      for (const m of Object.values(planting.meshes)) (m.geometry.dispose(), m.material.dispose(), m.dispose())
      planting.ponds.water.dispose()
      planting.ponds.rim.dispose()
      planting.meadow.dispose()
    },
    [planting],
  )
  const pondRim = useMemo(() => '#' + new THREE.Color(col.pond).lerp(new THREE.Color(green), 0.5).getHexString(), [col, green])
  const hatch = useMemo(() => hatchTexture(green, col.meadow_hatch, scenario.trees.placement.meadow), [green, col, scenario])
  useEffect(() => () => hatch.dispose(), [hatch])

  // Green roofs on the service buildings, only in the layouts listed in green_roofs.layouts:
  // the white rim, the raised green, and one instanced mesh each for bushes and flower clumps.
  const showRoofs = scenario.green_roofs.layouts.includes(layout)
  const roofs = useMemo(() => {
    const plants = roofPlants(city)
    return {
      ...buildRoofs(city.roofs.roofs, scenario.green_roofs.raise_m),
      bushes: treeMesh('shrub', plants.bushes, col.tree_trunk),
      flowers: treeMesh('roofFlowers', plants.flowers, col.tree_trunk),
    }
  }, [city, scenario, col])
  useEffect(
    () => () => {
      roofs.rim.dispose()
      roofs.green.dispose()
      for (const m of [roofs.bushes, roofs.flowers]) (m.geometry.dispose(), m.material.dispose(), m.dispose())
    },
    [roofs],
  )

  // The light layer.
  const lightTex = useMemo(() => lightTexture(city.light, col), [city, col])
  const { cols, rows, grid_cell_m: cell, origin_m: origin } = city.light

  // Parked cars, buses and bikes for the Today layout: one instanced mesh each.
  const traffic = useMemo(() => {
    const { cars, buses, bikes } = placeTraffic(city)
    const out = {
      cars: instanced(carGeometry(col.car), cars),
      buses: instanced(busGeometry(col.bus), buses),
      bikes: instanced(bikeGeometry(col.bike), bikes),
    }
    Object.values(out).forEach((m) => (m.receiveShadow = true))
    return out
  }, [city, col])

  // Paths for people (paths.layouts): the curving 4 m path on every green band, and the
  // people, bikes and robots standing on it, one instanced mesh each.
  const showPaths = scenario.paths.layouts.includes(layout)
  const pathWays = useMemo(() => {
    const curved = curvedPaths(city.streets, scenario)
    const { people, bikes, robots } = placeFigures(curved, scenario)
    const figures = {
      people: instanced(personGeometry(col.person), people),
      bikes: instanced(bikeGeometry(col.path_bike), bikes),
      robots: instanced(robotGeometry(col.robot), robots),
    }
    Object.values(figures).forEach((m) => (m.receiveShadow = true))
    return {
      ribbon: buildBands(curved.map((p) => p.line), scenario.paths.width_m, Y.path, 8),
      // The main paths: the shortest connections between the rings, main_width_m wide.
      main: buildBands(city.people.mainEdges.map((i) => curved[i].line), scenario.paths.main_width_m, Y.mainPath, 8),
      figures,
    }
  }, [city, scenario, col])

  useDispose(
    pathWays.ribbon,
    pathWays.main,
    pathWays.figures.people,
    pathWays.figures.bikes,
    pathWays.figures.robots,
    buildingGeo.plain,
    buildingGeo.service,
    greenGeo,
    lineGeo,
    bandGeo,
    lightTex,
    traffic.cars,
    traffic.buses,
    traffic.bikes,
  )

  const { x0, y0, x1, y1 } = bounds
  const cx = (x0 + x1) / 2
  const cz = -(y0 + y1) / 2

  const roads = layout === 'today'
  const showRings = scenario.layouts[layout].rings
  const showLight = layers.light
  // Interaction points of the routes that are shown: their group is on and, with a selection,
  // they belong to it. Shown only when at least one species group is on.
  const anyGroup = Object.values(layers.groups).some(Boolean)
  const interactionVisible = useCallback(
    (r) => {
      if (!layers.groups[r.group]) return false
      return !selection || selection.species === r.species || selection.group === r.group
    },
    [city, layers.groups, selection],
  )

  return (
    <>
      <hemisphereLight args={['#ffffff', SKY_GROUND_COLOUR, SKY_LIGHT]} />
      <primitive object={sun} />
      <primitive object={sun.target} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]}>
        <planeGeometry args={[x1 - x0, y1 - y0]} />
        <meshBasicMaterial color={col.ground_plane} />
      </mesh>

      {/* Flat layers are unlit, so they show exactly the colours in scenario.json. */}
      <mesh geometry={greenGeo} position={[0, Y.green, 0]}>
        <meshBasicMaterial color={green} />
      </mesh>

      {!roads && (
        <mesh geometry={bandGeo}>
          <meshBasicMaterial color={green} />
        </mesh>
      )}

      {/* Pressure zones around the rings: light, flat fills below the planting. */}
      {showRings && layers.zones && <PressureZones city={city} y={Y.zones} />}

      {/* Meadow strips along the green bands: the greenery fill with diagonal hatching. */}
      {!roads && layers.planting && (
        <mesh geometry={planting.meadow} position={[0, Y.meadow, 0]}>
          <meshBasicMaterial map={hatch} />
        </mesh>
      )}

      {/* Ponds (Around 2050 and 2100): a paler rim under the water, so the edge looks soft. */}
      {layers.planting && (
        <>
          <mesh geometry={planting.ponds.rim} position={[0, Y.pondRim, 0]}>
            <meshBasicMaterial color={pondRim} />
          </mesh>
          <mesh geometry={planting.ponds.water} position={[0, Y.pond, 0]}>
            <meshBasicMaterial color={col.pond} />
          </mesh>
        </>
      )}

      {/* Building shadows on the ground and greenery: see-through, shadow_strength dark, never black.
          Drawn first among see-through things, so later overlays always sit on top of it. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, Y.shadow, cz]} receiveShadow renderOrder={-1}>
        <planeGeometry args={[x1 - x0, y1 - y0]} />
        <shadowMaterial color="#000000" opacity={display.shadow_strength} depthWrite={false} />
      </mesh>

      {/* Light: average sun hours April–September, from derived/light.json. Above the shadows. */}
      {showLight && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[origin[0] + (cols * cell) / 2, Y.light, -(origin[1] + (rows * cell) / 2)]}>
          <planeGeometry args={[cols * cell, rows * cell]} />
          <meshBasicMaterial map={lightTex} transparent opacity={LIGHT_LAYER_OPACITY} depthWrite={false} />
        </mesh>
      )}

      {/* Today: the roads as thin lines. Around 2050 and 2100: the paved, curving path on each band. */}
      {!showPaths && (
        <lineSegments geometry={lineGeo}>
          <lineBasicMaterial color={col.human_path} />
        </lineSegments>
      )}
      {showPaths && (
        <mesh geometry={pathWays.ribbon}>
          <meshBasicMaterial color={col.path} />
        </mesh>
      )}
      {/* The main paths between the rings, and the gathering places where three or more meet. */}
      {showPaths && layers.paths && (
        <>
          <mesh geometry={pathWays.main}>
            <meshBasicMaterial color={col.main_path} />
          </mesh>
          <GatheringPlaces city={city} y={Y.gathering} />
        </>
      )}

      {/* Buildings: no outlines. White, or pastel for service buildings; lit by the sun and sky. */}
      {layers.buildings && (
        <>
          <mesh geometry={buildingGeo.plain} castShadow receiveShadow>
            <meshLambertMaterial color={col.building} />
          </mesh>
          <mesh geometry={buildingGeo.service} castShadow receiveShadow>
            <meshLambertMaterial color={col.service_building} />
          </mesh>
        </>
      )}

      {/* Green roofs on the service buildings: white rim, green inside, bushes and flower clumps. */}
      {showRoofs && layers.buildings && (
        <>
          <mesh geometry={roofs.rim} receiveShadow>
            <meshLambertMaterial color={col.green_roof_rim} />
          </mesh>
          <mesh geometry={roofs.green} receiveShadow>
            <meshLambertMaterial color={col.green_roof} />
          </mesh>
          <primitive object={roofs.bushes} />
          <primitive object={roofs.flowers} />
        </>
      )}

      {/* Trees and shrubs, as low-poly shapes. */}
      {layers.planting && Object.entries(planting.meshes).map(([type, mesh]) => <primitive key={type} object={mesh} />)}

      {/* Cars, buses and these parked bikes only exist in the Today layout. */}
      {roads && layers.paths && <primitive object={traffic.cars} />}
      {roads && layers.paths && <primitive object={traffic.buses} />}
      {roads && layers.paths && <primitive object={traffic.bikes} />}

      {/* People, bikes and robots on the paths (Around 2050 and 2100). */}
      {showPaths && layers.paths && Object.entries(pathWays.figures).map(([kind, mesh]) => <primitive key={kind} object={mesh} />)}

      {/* Species routes, homes, circles and habitat arrows (derived/routes.json). */}
      <Routes city={city} layout={layout} groups={layers.groups} selection={selection} onSelect={onSelect} highlightNew={highlightNew} />

      {/* Teleport stations, and the interaction points where species routes meet roads or paths. */}
      {showRings && layers.rings && <Stations city={city} groundY={Y.overlay} />}
      {layers.interactions && anyGroup && <Interactions city={city} layout={layout} visible={interactionVisible} y={Y.overlay} />}

      <OrbitControls makeDefault target={[cx, 0, cz]} maxPolarAngle={1.45} minDistance={40} maxDistance={6000} enableDamping />
    </>
  )
}

export default function City({ city, layout, layers, selection, onSelect, highlightNew }) {
  const { x0, y0, x1, y1 } = city.bounds
  const cx = (x0 + x1) / 2
  const cz = -(y0 + y1) / 2
  const background = '#' + new THREE.Color(city.scenario.colours.ground_plane).lerp(new THREE.Color('#ffffff'), 0.6).getHexString()
  return (
    // `flat`: colours as written in scenario.json, without film-like tone mapping.
    <Canvas flat shadows="percentage" dpr={[1, 2]} camera={{ position: [cx - 300, 1500, cz + 1700], fov: 35, near: 10, far: 20000 }} gl={{ antialias: true }} onPointerMissed={() => onSelect(null)}>
      <color attach="background" args={[background]} />
      <Scene city={city} layout={layout} layers={layers} selection={selection} onSelect={onSelect} highlightNew={highlightNew} />
    </Canvas>
  )
}

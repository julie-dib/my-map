// Species routes on the 3D map, read from derived/routes.json (city.routes): nothing here is
// computed, only drawn. Every route keeps the same line in every layout; a layout only decides
// whether it is shown and where it is cut (broken). Each route is a smooth line in its species colour, shaped by its group's
// line (species.json groups: solid, low_arcs, small_dots, zigzag, high_arcs, big_loop) and
// lying on a faint corridor band; it ends as its behaviour says (a cross, an arrowhead, or the
// species circle). Potential homes are small rings on the ground. The species circles are the
// ready-made images in public/data/images/circles, as camera-facing sprites.
// Map metres: x = east, y = north; scene: x = east, y = up, z = minus north.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import { ARROWHEAD_M, CROSS_M, HABITAT_ARROW_M, ROUTE_DOT_PX, ROUTE_LINE_PX } from './look.js'

// Height of the corridor bands and home rings: above the light layer (0.6) and the street lines (0.7).
const BAND_Y = 0.85
const scene = (x, y, z) => new THREE.Vector3(x, z, -y)

// Points every `step` metres along the route, heights in between; s: distance along, (ux, uy): direction.
function densify(pts, step) {
  const out = []
  let s = 0
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay, az] = pts[i - 1]
    const [bx, by, bz] = pts[i]
    const L = Math.hypot(bx - ax, by - ay)
    if (!L) continue
    const ux = (bx - ax) / L
    const uy = (by - ay) / L
    if (!out.length) out.push({ x: ax, y: ay, z: az, s: 0, ux, uy })
    const n = Math.max(1, Math.round(L / step))
    for (let k = 1; k <= n; k++) {
      const t = k / n
      out.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t, z: az + (bz - az) * t, s: s + L * t, ux, uy })
    }
    s += L
  }
  return out
}

// The route in its group's line shape: a list of scene points for a line, or dot positions.
function shapeRoute(pts, group, D) {
  const [lo, hi] = group.height_m
  const band = hi - lo
  switch (group.line) {
    case 'low_arcs':
    case 'high_arcs': {
      // Arcs of arc_length_* metres, each rising through the group's height band.
      const A = group.line === 'low_arcs' ? D.arc_length_low_m : D.arc_length_high_m
      return { line: densify(pts, A / 10).map((p) => scene(p.x, p.y, p.z + band * Math.sin(Math.PI * ((p.s % A) / A)))) }
    }
    case 'small_dots':
      return { dots: densify(pts, D.dot_spacing_m).map((p) => scene(p.x, p.y, p.z + band / 2)) }
    case 'zigzag': {
      const a = D.zigzag_amplitude_m
      return {
        line: densify(pts, a * 1.5).map((p, i) => {
          const side = i % 2 ? a : -a
          return scene(p.x - p.uy * side, p.y + p.ux * side, p.z + band * 0.3)
        }),
      }
    }
    case 'big_loop':
      return { line: densify(pts, 6).map((p) => scene(p.x, p.y, p.z + (band / 2) * Math.sin(p.s / 150))) }
    default:
      // solid: on the ground, just above the corridor band.
      return { line: densify(pts, 3).map((p) => scene(p.x, p.y, p.z + BAND_Y + 0.3)) }
  }
}

// A flat, faint band under the route.
function corridorGeometry(pts, width) {
  const h = width / 2
  const pos = []
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]
    const [bx, by] = pts[i]
    const L = Math.hypot(bx - ax, by - ay)
    if (!L) continue
    const nx = (-(by - ay) / L) * h
    const ny = ((bx - ax) / L) * h
    const q = [
      [ax + nx, ay + ny],
      [bx + nx, by + ny],
      [bx - nx, by - ny],
      [ax - nx, ay - ny],
    ].map(([x, y]) => [x, BAND_Y, -y])
    pos.push(...q[0], ...q[3], ...q[2], ...q[0], ...q[2], ...q[1])
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return g
}

// Round dots for the small_dots line.
const dotTexture = (() => {
  let tex = null
  return () => {
    if (tex) return tex
    const c = document.createElement('canvas')
    c.width = c.height = 32
    const g = c.getContext('2d')
    g.fillStyle = '#fff'
    g.beginPath()
    g.arc(16, 16, 14, 0, Math.PI * 2)
    g.fill()
    tex = new THREE.CanvasTexture(c)
    return tex
  }
})()

// The species circle images, loaded once. A missing image becomes a plain disc in the species
// colour with its English name.
const circleCache = new Map()
export const missingCircleImages = new Set()
function fallbackTexture(sp) {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')
  g.fillStyle = sp.colour
  g.beginPath()
  g.arc(128, 128, 0.77 * 128, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#fff'
  g.font = '600 26px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const words = sp.name_en.split(' ')
  words.forEach((w, i) => g.fillText(w, 128, 128 + (i - (words.length - 1) / 2) * 30))
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
function useCircleTexture(sp, version) {
  const [tex, setTex] = useState(() => circleCache.get(sp.id) ?? null)
  useEffect(() => {
    if (circleCache.has(sp.id)) return setTex(circleCache.get(sp.id))
    new THREE.TextureLoader().load(
      `${import.meta.env.BASE_URL}data/images/${encodeURI(sp.circle_image)}?v=${encodeURIComponent(version)}`,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace
        circleCache.set(sp.id, t)
        setTex(t)
      },
      undefined,
      () => {
        console.warn(`Species circle image missing: public/data/images/${sp.circle_image}`)
        missingCircleImages.add(sp.circle_image)
        const t = fallbackTexture(sp)
        circleCache.set(sp.id, t)
        setTex(t)
      },
    )
  }, [sp, version])
  return tex
}

// The species circle: a camera-facing sprite that shrinks with distance, centred on the route
// line; the ring is species_circle.map_size_m across. Faded circles are greyed and see-through.
function SpeciesCircle({ sp, at, SC, faded, onClick }) {
  const tex = useCircleTexture(sp, SC.image_version)
  if (!tex) return null
  const size = SC.map_size_m / SC.ring_share_of_image
  return (
    <sprite
      position={scene(...at)}
      scale={[size, size, 1]}
      renderOrder={faded ? 20 : 30}
      onClick={(e) => (e.stopPropagation(), onClick?.())}
    >
      <spriteMaterial map={tex} transparent depthTest={false} color={faded ? '#d0d2d4' : '#ffffff'} opacity={faded ? 0.35 : 1} />
    </sprite>
  )
}

// End of a route: an arrowhead along the last direction, or a small cross facing the camera.
function RouteEnd({ type, line, at, colour }) {
  if (type === 'arrow' && line.length > 1) {
    const b = line[line.length - 1]
    const a = line[Math.max(0, line.length - 4)]
    const dir = b.clone().sub(a).normalize()
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
    return (
      <mesh position={b.clone().addScaledVector(dir, ARROWHEAD_M / 2)} quaternion={q} renderOrder={25}>
        <coneGeometry args={[ARROWHEAD_M / 2.6, ARROWHEAD_M, 12]} />
        <meshBasicMaterial color={colour} depthTest={false} />
      </mesh>
    )
  }
  if (type === 'cross' && at) {
    const p = line.length ? line[line.length - 1] : scene(at[0], at[1], 1)
    return (
      <Billboard position={p}>
        {[Math.PI / 4, -Math.PI / 4].map((r) => (
          <mesh key={r} rotation={[0, 0, r]} renderOrder={25}>
            <planeGeometry args={[CROSS_M, CROSS_M / 5]} />
            <meshBasicMaterial color={colour} depthTest={false} />
          </mesh>
        ))}
      </Billboard>
    )
  }
  return null
}

// Potential homes: small flat rings on the ground, one instanced mesh per species.
function HomeRings({ homes, colour, size }) {
  const mesh = useMemo(() => {
    const g = new THREE.RingGeometry(size * 0.3, size / 2, 20).rotateX(-Math.PI / 2)
    const m = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.9, depthWrite: false }), Math.max(homes.length, 1))
    const mat = new THREE.Matrix4()
    homes.forEach(([x, y], i) => m.setMatrixAt(i, mat.makeTranslation(x, BAND_Y + 0.05, -y)))
    m.count = homes.length
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
    m.raycast = () => {}
    return m
  }, [homes, colour, size])
  useEffect(() => () => (mesh.geometry.dispose(), mesh.material.dispose()), [mesh])
  return <primitive object={mesh} />
}

// Height of the circle centre at line point idx: the middle of the drawn line shape there.
function circleHeight(pts, idx, group) {
  const [lo, hi] = group.height_m
  const band = hi - lo
  const z = pts[idx][2]
  if (group.line === 'solid') return z + BAND_Y + 0.3
  if (group.line === 'zigzag') return z + band * 0.3
  if (group.line === 'big_loop') {
    let s = 0
    for (let i = 1; i <= idx; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    return z + (band / 2) * Math.sin(s / 150)
  }
  return z + band / 2
}

// The corridor band of a new route pulses while it is highlighted.
function PulsingBand({ geometry, colour, opacity }) {
  const mat = useRef()
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = opacity * (2.5 + 1.5 * Math.sin(clock.elapsedTime * Math.PI * 3))
  })
  return (
    <mesh geometry={geometry} renderOrder={2}>
      <meshBasicMaterial ref={mat} color={colour} transparent opacity={opacity * 2.5} depthWrite={false} />
    </mesh>
  )
}

// One route as shown in a layout: corridor band, shaped line or dots, end marker and circle.
// state: normal, selected, faded or new (new in this layout, highlighted).
// One drawn piece of a route: corridor band and shaped line or dots.
function RoutePiece({ pts, group, D, sp, colour, state, order, lineOpacity, select }) {
  const faded = state === 'faded'
  const shaped = useMemo(() => shapeRoute(pts, group, D), [pts, group, D])
  const corridor = useMemo(() => corridorGeometry(pts, D.corridor_band_width_m), [pts, D])
  useEffect(() => () => corridor.dispose(), [corridor])
  const dots = useMemo(() => (shaped.dots ? new THREE.BufferGeometry().setFromPoints(shaped.dots) : null), [shaped])
  useEffect(() => () => dots?.dispose(), [dots])
  return (
    <>
      {!faded && state !== 'new' && (
        <mesh geometry={corridor} renderOrder={1}>
          <meshBasicMaterial color={sp.colour} transparent opacity={D.corridor_band_opacity} depthWrite={false} />
        </mesh>
      )}
      {state === 'new' && <PulsingBand geometry={corridor} colour={sp.colour} opacity={D.corridor_band_opacity} />}
      {shaped.line && (
        <Line
          points={shaped.line}
          color={colour}
          lineWidth={ROUTE_LINE_PX[state]}
          transparent={lineOpacity < 1}
          opacity={lineOpacity}
          renderOrder={order}
          depthTest={state === 'normal' || faded}
          onClick={(e) => (e.stopPropagation(), select())}
        />
      )}
      {dots && (
        <points geometry={dots} renderOrder={order}>
          <pointsMaterial color={colour} size={ROUTE_DOT_PX[state]} sizeAttenuation={false} map={dotTexture()} alphaTest={0.5} transparent depthTest={state === 'normal' || faded} />
        </points>
      )}
    </>
  )
}

// The visible stretches of a route as index ranges [a, b]; each reaches one point into a hidden
// stretch, so it joins the line of the route that draws the shared part.
function piecesOf(vis) {
  const out = []
  for (let i = 0; i < vis.length; ) {
    if (!vis[i]) {
      i++
      continue
    }
    let e = i
    while (e + 1 < vis.length && vis[e + 1]) e++
    out.push([Math.max(0, i - 1), Math.min(vis.length - 1, e + 1)])
    i = e + 1
  }
  return out
}

// Which points of each route are drawn in a layout (route id → booleans): up to its cut, and
// not where an earlier route of the same species is already drawn along the same stretch.
// Routes are visited in id order, so the earlier routes are known first.
function visibleMasks(list, layout) {
  const masks = new Map()
  for (const r of [...list].sort((a, b) => a.id - b.id)) {
    const here = r.layouts[layout]
    const last = here.cut == null ? r.pts.length - 1 : here.cut
    const vis = r.pts.map((_, i) => i <= last)
    for (const [i0, i1, o, j0, j1] of r.shared ?? []) {
      const m = masks.get(o)
      if (!m) continue
      let drawn = true
      for (let j = j0; j <= j1 && drawn; j++) drawn = m.drawnTo[j]
      if (drawn) for (let i = i0; i <= i1; i++) vis[i] = false
    }
    // drawnTo: where this route's line is on the map (shown here, hidden or not), so a later
    // route can rely on it being drawn by this one or the one this one gives way to.
    masks.set(r.id, { vis, drawnTo: r.pts.map((_, i) => i <= last) })
  }
  return masks
}

function Route({ r, vis, layout, sp, group, D, SC, col, state, onSelect, hflOpacity }) {
  const faded = state === 'faded'
  const colour = faded ? col.route_faded : sp.colour
  const here = r.layouts[layout]
  const pts = useMemo(() => (here.cut == null ? r.pts : r.pts.slice(0, here.cut + 1)), [r, here])
  // The arrowheads and the cross follow the whole drawn route.
  const shaped = useMemo(() => shapeRoute(pts, group, D), [pts, group, D])
  const pieces = useMemo(() => piecesOf(vis).map(([a, b]) => r.pts.slice(a, b + 1)), [r, vis])
  const order = state === 'selected' || state === 'new' ? 15 : faded ? 5 : 10
  const line = shaped.line ?? shaped.dots
  const startLine = useMemo(() => (line ? [...line].reverse() : []), [line])
  const select = () => onSelect({ species: sp.id })
  // Broken here: a cross where it is cut. Works: an arrowhead (loop, cross) or the circle (stay).
  const endType = here.cut != null ? 'cross' : r.end_type === 'stay' ? 'none' : 'arrow'
  // The species circles (one or two per route): an end circle where the route works and has a
  // home here, the others where the route is drawn past them.
  const circles = r.circles.filter(({ idx, kind }) => (kind === 'end' ? here.cut == null && here.home : here.cut == null || idx <= here.cut))
  // High flyers: their loops are drawn see-through (high_flyer_loop.opacity).
  const lineOpacity = r.group === 'high_flyer' && state !== 'selected' && state !== 'new' ? hflOpacity : 1

  // A loop that comes back the same way is one line: an arrowhead at each end.
  const bothEnds = endType === 'arrow' && r.end_type === 'loop' && r.group !== 'high_flyer'
  return (
    <group>
      {pieces.map((p, i) => (
        <RoutePiece key={i} pts={p} group={group} D={D} sp={sp} colour={colour} state={state} order={order} lineOpacity={lineOpacity} select={select} />
      ))}
      <RouteEnd type={endType} line={line} at={pts[pts.length - 1]} colour={colour} />
      {bothEnds && <RouteEnd type="arrow" line={startLine} colour={colour} />}
      {circles.map(({ idx }) => (
        <SpeciesCircle key={idx} sp={sp} at={[r.pts[idx][0], r.pts[idx][1], circleHeight(r.pts, idx, group)]} SC={SC} faded={faded} onClick={select} />
      ))}
    </group>
  )
}

// A habitat arrow on the map edge, pointing outwards, with the habitat's name; green areas
// inside the map get their name only.
function HabitatMark({ h, col }) {
  const shape = useMemo(() => {
    const { length: L, width: W } = HABITAT_ARROW_M
    const s = new THREE.Shape()
    s.moveTo(-W * 0.18, -L)
    s.lineTo(W * 0.18, -L)
    s.lineTo(W * 0.18, -L * 0.4)
    s.lineTo(W / 2, -L * 0.4)
    s.lineTo(0, 0)
    s.lineTo(-W / 2, -L * 0.4)
    s.lineTo(-W * 0.18, -L * 0.4)
    return new THREE.ShapeGeometry(s)
  }, [])
  useEffect(() => () => shape.dispose(), [shape])
  if (h.kind !== 'edge')
    return (
      <Html position={scene(h.x, h.y, 2)} center zIndexRange={[100, 50]}>
        <div className="habitat-label inside">{h.label}</div>
      </Html>
    )
  // The arrow's tip sits on the edge; it lies flat and points along dir (map x, y).
  const angle = Math.atan2(h.dir[1], h.dir[0]) - Math.PI / 2
  return (
    <group position={[h.x, BAND_Y + 0.1, -h.y]}>
      <mesh geometry={shape} rotation={[-Math.PI / 2, 0, angle]}>
        <meshBasicMaterial color={col.edge_arrow} side={THREE.DoubleSide} />
      </mesh>
      <Html position={[-h.dir[0] * HABITAT_ARROW_M.length * 1.4, 2, h.dir[1] * HABITAT_ARROW_M.length * 1.4]} center zIndexRange={[100, 50]}>
        <div className="habitat-label">{h.label}</div>
      </Html>
    </group>
  )
}

// groups: species group → shown; selection: null, { species: id } or { group: id };
// highlightNew: show the routes that are new in this layout highlighted.
export default function Routes({ city, layout, groups, selection, onSelect, highlightNew }) {
  const { scenario, species: speciesJson, routes } = city
  const D = scenario.drawing
  const SC = scenario.species_circle
  const col = scenario.colours
  const byId = useMemo(() => Object.fromEntries(speciesJson.species.map((s) => [s.id, s])), [speciesJson])
  const list = useMemo(() => routes.list.filter((r) => r.layouts[layout] && groups[r.group]), [routes, layout, groups])
  const masks = useMemo(() => visibleMasks(list, layout), [list, layout])
  const stateOf = (r) => {
    if (selection && selection.species !== r.species && selection.group !== r.group) return 'faded'
    if (highlightNew && r.appears === layout) return 'new'
    return selection ? 'selected' : 'normal'
  }
  const rank = ['faded', 'normal', 'selected', 'new']
  // Faded routes first, the selected and new ones last, so they lie on top.
  const ordered = [...list].sort((a, b) => rank.indexOf(stateOf(a)) - rank.indexOf(stateOf(b)))
  // Potential homes per species, of the routes that are not faded.
  const homes = useMemo(() => {
    const m = new Map()
    for (const r of list) {
      if (selection && selection.species !== r.species && selection.group !== r.group) continue
      m.set(r.species, [...(m.get(r.species) ?? []), ...r.layouts[layout].homes])
    }
    return [...m]
  }, [list, layout, selection])
  return (
    <group>
      {routes.habitats.map((h) => (
        <HabitatMark key={h.id} h={h} col={col} />
      ))}
      {ordered.map((r) => (
        <Route hflOpacity={scenario.high_flyer_loop.opacity} key={r.id} r={r} vis={masks.get(r.id).vis} layout={layout} sp={byId[r.species]} group={speciesJson.groups[r.group]} D={D} SC={SC} col={col} state={stateOf(r)} onSelect={onSelect} />
      ))}
      {homes.map(([id, pts]) => (
        <HomeRings key={'h' + id} homes={pts} colour={byId[id].colour} size={D.home_marker_m} />
      ))}
    </group>
  )
}

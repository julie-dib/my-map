// People in the later layouts, read from derived/people.json (city.people): the teleport stations,
// the pressure zones around them, the gathering places on the main paths, and the interaction
// points where species routes meet roads or paths. Nothing is computed here, only drawn.
// Map metres: x = east, y = north; scene: x = east, y = up, z = minus north.
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { Billboard } from '@react-three/drei'

// Flat shapes (rings of [x, y]) as one geometry lying on the ground.
function flatShapes(polygons) {
  if (!polygons.length) return new THREE.BufferGeometry()
  const shapes = polygons.map(([outer, ...holes]) => {
    const s = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)))
    s.holes = holes.map((h) => new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))))
    return s
  })
  return new THREE.ShapeGeometry(shapes, 2).rotateX(-Math.PI / 2)
}

// Several copies of one geometry and see-through material, at the given scene positions.
function instanced(geometry, material, positions, renderOrder) {
  const m = new THREE.InstancedMesh(geometry, material, Math.max(positions.length, 1))
  const mat = new THREE.Matrix4()
  positions.forEach(([x, y, z], i) => m.setMatrixAt(i, mat.makeTranslation(x, y, z)))
  m.count = positions.length
  m.instanceMatrix.needsUpdate = true
  m.computeBoundingSphere()
  m.renderOrder = renderOrder
  return m
}
const seeThrough = (colour, opacity) => new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity, depthWrite: false })

// A soft round spot: full colour in the middle, fading to nothing at the rim.
function spotTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.6)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

// Teleport stations: neon spheres floating at rings.height_m, made only of see-through layers
// (rings.glow): the core sphere, a soft halo around it, a beam of nested columns down to the
// ground with a thin bright core, and a soft spot where the beam meets the ground. Nothing here
// lights the scene. The white highlight on the upper left faces the camera.
export function Stations({ city, groundY }) {
  const R = city.scenario.rings
  const G = R.glow
  const parts = useMemo(() => {
    const at = city.people.rings.map((r) => [r.x, R.height_m, -r.y])
    const out = []
    out.push(instanced(new THREE.SphereGeometry(R.radius_m, 32, 20), new THREE.MeshBasicMaterial({ color: G.core_colour }), at, 30))
    G.halo_layers.forEach((h, i) => out.push(instanced(new THREE.SphereGeometry(R.radius_m * h.scale, 32, 20), seeThrough(G.halo_colour, h.opacity), at, 31 + i)))
    // Beam: from the ground to the bottom of the sphere.
    const len = R.height_m - R.radius_m * 0.9
    const beamAt = city.people.rings.map((r) => [r.x, len / 2, -r.y])
    G.beam_layers.forEach((b, i) => out.push(instanced(new THREE.CylinderGeometry(b.radius_m, b.radius_m, len, 20, 1, true), seeThrough(b.colour, b.opacity), beamAt, 25 + i)))
    const tex = spotTexture()
    const spot = new THREE.MeshBasicMaterial({ color: G.ground_spot.colour, map: tex, transparent: true, opacity: G.ground_spot.opacity, depthWrite: false })
    const spotAt = city.people.rings.map((r) => [r.x, groundY, -r.y])
    out.push(instanced(new THREE.CircleGeometry(G.ground_spot.radius_m, 40).rotateX(-Math.PI / 2), spot, spotAt, 24))
    return { meshes: out, tex }
  }, [city, R, G, groundY])
  useEffect(
    () => () => {
      parts.meshes.forEach((m) => (m.geometry.dispose(), m.material.dispose(), m.dispose()))
      parts.tex.dispose()
    },
    [parts],
  )
  const hl = G.highlight
  return (
    <>
      {parts.meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
      {city.people.rings.map((r, i) => (
        <Billboard key={i} position={[r.x, R.height_m, -r.y]}>
          <mesh position={[hl.offset_share[0] * R.radius_m, hl.offset_share[1] * R.radius_m, R.radius_m * 0.92]} renderOrder={32}>
            <circleGeometry args={[hl.size_share * R.radius_m, 24]} />
            <meshBasicMaterial color={hl.colour} transparent opacity={hl.opacity} depthWrite={false} />
          </mesh>
        </Billboard>
      ))}
    </>
  )
}

// Pressure zones: one pale pink, flat fill per walking time, without outlines (as bands, so they
// never stack), at height y: on the ground, below the planting, paths and routes.
export function PressureZones({ city, y }) {
  const col = city.scenario.colours.pressure_zones
  const opacity = city.scenario.people.pressure_zone_opacity
  const geos = useMemo(() => city.people.zones.map((z) => flatShapes(z.polygons)), [city])
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos])
  return geos.map((g, i) => (
    <mesh key={i} geometry={g} position={[0, y, 0]}>
      <meshBasicMaterial color={col[i]} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  ))
}

// Gathering places: round paved places where three or more main paths meet.
export function GatheringPlaces({ city, y }) {
  const { gathering_radius_m: r } = city.scenario.paths
  const geo = useMemo(() => {
    const parts = city.people.gathering.map(([x, gy]) => new THREE.CircleGeometry(r, 24).rotateX(-Math.PI / 2).translate(x, 0, -gy))
    if (!parts.length) return new THREE.BufferGeometry()
    const pos = parts.flatMap((p) => Array.from(p.toNonIndexed().attributes.position.array))
    parts.forEach((p) => p.dispose())
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return g
  }, [city, r])
  useEffect(() => () => geo.dispose(), [geo])
  return (
    <mesh geometry={geo} position={[0, y, 0]}>
      <meshBasicMaterial color={city.scenario.colours.gathering_place} />
    </mesh>
  )
}

// Interaction points: white dots of interactions.radius_m at map scale (shrinking with distance,
// never smaller than a few pixels) with an outline of outline_px in colours.interaction_outline,
// where a shown species route meets a road (Today) or a path (later). A merged point is shown
// when one of its routes is drawn past it here and visible(route) says it is shown.
const DOT_VERTEX = `
uniform float uDiameter;
uniform float uHalfHeight;
uniform float uOutline;
varying float vPx;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = max(uDiameter * projectionMatrix[1][1] * uHalfHeight / -mv.z, 4.0);
  gl_PointSize = px + 2.0 * uOutline;
  vPx = gl_PointSize;
}`
const DOT_FRAGMENT = `
uniform vec3 uFill;
uniform vec3 uLine;
uniform float uOutline;
varying float vPx;
void main() {
  float d = length(gl_PointCoord - 0.5) * vPx;
  float r = vPx * 0.5;
  if (d > r) discard;
  gl_FragColor = vec4(d > r - uOutline ? uLine : uFill, 1.0);
}`
const rawColour = (hex) => new THREE.Color().setHex(parseInt(hex.slice(1), 16), THREE.LinearSRGBColorSpace)

export function Interactions({ city, layout, visible, y }) {
  const I = city.scenario.interactions
  const { size, gl } = useThree()
  const dpr = gl.getPixelRatio()
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uDiameter: { value: 2 * I.radius_m },
          uHalfHeight: { value: 1 },
          uOutline: { value: I.outline_px },
          uFill: { value: rawColour('#ffffff') },
          uLine: { value: rawColour(city.scenario.colours.interaction_outline) },
        },
        vertexShader: DOT_VERTEX,
        fragmentShader: DOT_FRAGMENT,
        depthTest: false,
        transparent: true,
      }),
    [city, I],
  )
  material.uniforms.uHalfHeight.value = (size.height * dpr) / 2
  material.uniforms.uOutline.value = I.outline_px * dpr
  useEffect(() => () => material.dispose(), [material])
  const geo = useMemo(() => {
    const pts = city.people.interactions.filter((it) =>
      it.members.some(({ route, k }) => {
        const r = city.routes.list[route]
        const v = r.layouts[layout]
        return v && (v.cut == null || k < v.cut) && visible(r)
      }),
    )
    return new THREE.BufferGeometry().setFromPoints(pts.map((it) => new THREE.Vector3(it.x, it.z + y, -it.y)))
  }, [city, layout, visible, y])
  useEffect(() => () => geo.dispose(), [geo])
  return <points geometry={geo} material={material} renderOrder={40} />
}

// Sun hours on a grid: for every cell, the average hours of direct sun per day over the sample
// days in scenario.json (light.sample_days, every light.sample_every_minutes), with the
// buildings as the only things that cast shade. Then each cell gets a light class.
import { sunPosition } from '../src/sun.js'
import { pointInPolygon } from '../src/geo.js'

export const CLASS = { building: 0, shade: 1, partial: 2, full_sun: 3 }

// The buildings as a height map on a finer grid (half a light cell), so that narrow buildings
// and gaps between them are not lost. Each fine cell holds the height of the building over its
// centre, or 0.
function heightMap(buildings, origin, cols, rows, fine) {
  const H = new Float32Array(cols * rows)
  for (const b of buildings) {
    const outer = b.rings[0]
    if (!outer || outer.length < 3) continue
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const [x, y] of outer) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x)
      minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    }
    const c0 = Math.max(0, Math.floor((minX - origin[0]) / fine))
    const c1 = Math.min(cols - 1, Math.floor((maxX - origin[0]) / fine))
    const r0 = Math.max(0, Math.floor((minY - origin[1]) / fine))
    const r1 = Math.min(rows - 1, Math.floor((maxY - origin[1]) / fine))
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const x = origin[0] + (c + 0.5) * fine
        const y = origin[1] + (r + 0.5) * fine
        const i = r * cols + c
        if (b.height > H[i] && pointInPolygon(x, y, b.rings)) H[i] = b.height
      }
  }
  return H
}

// Sun positions above the horizon for the sample days. Times are taken in the middle of each
// step across the whole day (in UTC; over a whole day the clock offset makes no difference).
function sunSamples(light, lon, lat) {
  const step = light.sample_every_minutes
  const days = light.sample_days.map((date) => {
    const out = []
    for (let m = step / 2; m < 24 * 60; m += step) {
      // "HH:MM", where the minutes may have a fraction (e.g. a 25-minute step gives 12.5).
      const time = `${Math.floor(m / 60)}:${m % 60}`
      const { altitude, azimuth } = sunPosition({ date, time, utcOffset: 0, lon, lat })
      if (altitude <= 0) continue
      const az = (azimuth * Math.PI) / 180
      out.push({ dx: Math.sin(az), dy: Math.cos(az), tanAlt: Math.tan((altitude * Math.PI) / 180) })
    }
    return out
  })
  return { days, hoursPerSample: step / 60 }
}

export function computeLight(kit) {
  const { scenario, bounds, buildings } = kit
  const light = scenario.light
  const cell = scenario.grid_cell_m
  const fine = cell / 2
  const origin = [bounds.x0, bounds.y0]
  const cols = Math.ceil((bounds.x1 - bounds.x0) / cell)
  const rows = Math.ceil((bounds.y1 - bounds.y0) / cell)
  const fCols = cols * 2
  const fRows = rows * 2

  const H = heightMap(buildings, origin, fCols, fRows, fine)
  let maxH = 0
  for (const h of H) maxH = Math.max(maxH, h)

  const [lon, lat] = kit.kit.center
  const { days, hoursPerSample } = sunSamples(light, lon, lat)

  const hours = new Float32Array(cols * rows)
  const classes = new Uint8Array(cols * rows)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      // A cell whose centre stands inside a building is "building": no ground light there.
      const fc = c * 2 + 1
      const fr = r * 2 + 1
      if (H[fr * fCols + fc] > 0) {
        classes[i] = CLASS.building
        continue
      }
      const x = origin[0] + (c + 0.5) * cell
      const y = origin[1] + (r + 0.5) * cell
      let lit = 0
      for (const samples of days)
        for (const { dx, dy, tanAlt } of samples) {
          // Walk from the cell towards the sun; shaded if a building is taller than the ray.
          const reach = maxH / tanAlt
          let shaded = false
          for (let s = fine; s <= reach; s += fine) {
            const gc = Math.floor((x + dx * s - origin[0]) / fine)
            const gr = Math.floor((y + dy * s - origin[1]) / fine)
            if (gc < 0 || gr < 0 || gc >= fCols || gr >= fRows) break
            if (H[gr * fCols + gc] > s * tanAlt) {
              shaded = true
              break
            }
          }
          if (!shaded) lit++
        }
      const h = (lit * hoursPerSample) / days.length
      hours[i] = h
      classes[i] = h >= light.full_sun_min_hours ? CLASS.full_sun : h >= light.partial_shade_min_hours ? CLASS.partial : CLASS.shade
    }

  const samples = days.reduce((s, d) => s + d.length, 0)
  return { cell, origin, cols, rows, hours, classes, samples }
}

// The light class at a point in metres, from the computed grid.
export function lightAt(grid, x, y) {
  const c = Math.floor((x - grid.origin[0]) / grid.cell)
  const r = Math.floor((y - grid.origin[1]) / grid.cell)
  if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return null
  return grid.classes[r * grid.cols + c]
}

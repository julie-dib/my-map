// A simple bucket grid for "what is near this point?" questions, so the app never has to
// compare every point with every building or street.
export class SpatialGrid {
  constructor(cell) {
    this.cell = cell
    this.map = new Map()
  }

  key(i, j) {
    return i * 100003 + j
  }

  bucket(i, j, create) {
    const k = this.key(i, j)
    let b = this.map.get(k)
    if (!b && create) this.map.set(k, (b = []))
    return b
  }

  // A point item.
  add(x, y, item) {
    this.bucket(Math.floor(x / this.cell), Math.floor(y / this.cell), true).push({ x, y, item })
  }

  // An item with an extent, stored in every bucket its box covers.
  addBox(minX, minY, maxX, maxY, item) {
    const c = this.cell
    for (let i = Math.floor(minX / c); i <= Math.floor(maxX / c); i++)
      for (let j = Math.floor(minY / c); j <= Math.floor(maxY / c); j++) this.bucket(i, j, true).push({ item })
  }

  *near(x, y, r) {
    const c = this.cell
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++)
      for (let j = Math.floor((y - r) / c); j <= Math.floor((y + r) / c); j++) {
        const b = this.bucket(i, j, false)
        if (b) yield* b
      }
  }

  // True if a point item lies closer than r.
  anyWithin(x, y, r) {
    for (const e of this.near(x, y, r)) if (Math.hypot(e.x - x, e.y - y) < r) return true
    return false
  }

  // The boxed items whose buckets touch the circle; duplicates removed.
  candidates(x, y, r) {
    const s = new Set()
    for (const e of this.near(x, y, r)) s.add(e.item)
    return s
  }
}

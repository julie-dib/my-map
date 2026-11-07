// Where the sun stands in the sky for a date and local clock time (NOAA approximation,
// good to a fraction of a degree). Used only to light the 3D map.

const RAD = Math.PI / 180

// date "MM-DD", time "HH:MM", utcOffset in hours, lon/lat in degrees.
// Returns altitude (degrees above the horizon) and azimuth (degrees clockwise from north).
export function sunPosition({ date, time, utcOffset, lon, lat }) {
  const [month, day] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const daysBefore = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
  const dayOfYear = daysBefore[month - 1] + day
  const utcHour = hh + mm / 60 - utcOffset

  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (utcHour - 12) / 24)
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g))
  const decl =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g)

  const solarMinutes = (hh * 60 + mm) + eqTime + 4 * lon - 60 * utcOffset
  const hourAngle = (solarMinutes / 4 - 180) * RAD
  const phi = lat * RAD

  const altitude = Math.asin(Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(hourAngle))
  const azimuth = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) + Math.PI
  return { altitude: altitude / RAD, azimuth: ((azimuth / RAD) % 360 + 360) % 360 }
}

// Weimar scenario map: the city in three layouts — Today, Around 2050, Around 2100 — with the
// species routes, the planting (existing and planned), people (rings, pressure zones, paths,
// interactions), a light layer and the numbers per layout, precomputed by npm run precompute.
import { useEffect, useMemo, useRef, useState } from 'react'
import City from './City.jsx'
import { loadCity } from './data.js'

// Worded as in public/data/SOURCES.md.
const ATTRIBUTION = [
  'Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).',
  'Greenery: © OpenStreetMap contributors, ODbL 1.0.',
  'Species records: GBIF.org (5 Nov 2026), https://doi.org/10.15468/dl.778bqm.',
  'Species illustrations: generated with ChatGPT (OpenAI).',
].join(' ')

const BEHAVIOUR = {
  broken: 'stops at a barrier',
  cross: 'flies over without staying',
  loop: 'comes in and goes back',
  stay: 'settles: a potential new home',
}
const LIGHT_WORD = { sun: 'sun', partial: 'partial shade', shade: 'shade' }

// The limits of the method, in plain words (also in README.md).
const LIMITS = [
  'The routes are models, not tracked movements.',
  'The ground is flat: the map has no terrain.',
  'The Ilm is outside the map data, so the large habitats around Weimar are shown as arrows on the edge.',
  'OpenStreetMap trees and gardens are mapped unevenly: some streets have every tree, others none.',
  'GBIF records show where people observed a species, not where it is most numerous.',
  'The bat comes from a detector survey.',
  'Planned planting is not yet established.',
  'Light is computed from buildings only, not from trees.',
  'The species pictures are illustrations generated with ChatGPT, not photos.',
  'All years and numbers in scenario.json are assumptions.',
]

// The numbers per layout, side by side (derived/numbers.json). The species table shows one
// measure at a time.
const MEASURES = {
  routes: 'routes',
  broken: 'broken routes',
  cross: 'crossing routes',
  loop: 'looping routes',
  stay: 'staying routes',
  homes: 'potential homes',
  interactions: 'interaction points',
}
function Numbers({ city, layout }) {
  const sc = city.scenario
  const N = city.numbers.layouts
  const keys = Object.keys(sc.layouts)
  const [measure, setMeasure] = useState('routes')
  const fmt = (v) => v.toLocaleString('en-GB')
  const row = (label, f, key) => (
    <tr key={key ?? label}>
      <th>{label}</th>
      {keys.map((k) => (
        <td key={k} className={k === layout ? 'now' : ''}>
          {f(N[k])}
        </td>
      ))}
    </tr>
  )
  return (
    <>
      <table className="numbers">
        <thead>
          <tr>
            <th />
            {keys.map((k) => (
              <th key={k} className={k === layout ? 'now' : ''}>
                {sc.layouts[k].label.replace('Around ', '')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {row('unsealed green, m²', (v) => fmt(v.unsealed_m2))}
          {row('habitat pieces', (v) => fmt(v.habitat_pieces))}
          {row('largest piece, m²', (v) => fmt(v.largest_piece_m2))}
          {row('residents near habitat', (v) => fmt(v.residents_near_habitat))}
          {row('census cells without count', (v) => v.cells_without_count)}
        </tbody>
      </table>
      <p className="hint">
        Unsealed: greenery, and the green bands without their paths; green roofs are not counted. Habitat pieces: connected unsealed areas of at least {fmt(sc.habitat_min_piece_m2)} m². Residents
        (Zensus 2022) within {sc.habitat_buffer_for_residents_m} m of a habitat piece inside the map, each 100 m cell by the share of its area, rounded to 10; cells without a resident
        count are left out.
      </p>
      <label className="measure">
        Per species:{' '}
        <select value={measure} onChange={(e) => setMeasure(e.target.value)}>
          {Object.entries(MEASURES).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <table className="numbers">
        <tbody>{city.species.species.map((sp) => row(sp.name_en, (v) => v.species[sp.id][measure], sp.id))}</tbody>
      </table>
    </>
  )
}

// A layer switch with its legend sample.
function Toggle({ checked, onChange, children }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {children}
    </label>
  )
}
const imageUrl = (file) => `${import.meta.env.BASE_URL}data/images/${encodeURI(file)}`

// Small samples of the six route line shapes (species.json groups.*.line).
function LineSample({ line, colour }) {
  const common = { fill: 'none', stroke: colour, strokeWidth: 1.6, strokeLinecap: 'round' }
  return (
    <svg className="sample" viewBox="0 0 20 20" aria-hidden="true">
      {line === 'solid' && <path d="M1 13 L19 13" {...common} />}
      {line === 'low_arcs' && <path d="M1 14 Q4 9 7 14 Q10 9 13 14 Q16 9 19 14" {...common} />}
      {line === 'high_arcs' && <path d="M1 16 Q5.5 3 10 16 Q14.5 3 19 16" {...common} />}
      {line === 'small_dots' && [2, 6, 10, 14, 18].map((x) => <circle key={x} cx={x} cy="12" r="1.3" fill={colour} />)}
      {line === 'zigzag' && <path d="M1 12 L4 8 L7 14 L10 8 L13 14 L16 8 L19 12" {...common} strokeLinejoin="round" />}
      {line === 'big_loop' && <path d="M3 15 C1 4, 17 2, 17 10 C17 16, 9 17, 7 12" {...common} />}
    </svg>
  )
}

// The panel for the selected species: illustration, names, how it moves, its behaviour and
// potential homes in each layout (species.json, and the model where it differs), planting
// recommendations and its source.
function SpeciesPanel({ sp, city, layout, onClose }) {
  const sc = city.scenario
  const R = sc.routes
  const group = city.species.groups[sp.group]
  const S = city.routes.summary[sp.id]
  const label = (id) => city.routes.anchors[id]?.label ?? id
  const mine = city.routes.list.filter((r) => r.species === sp.id)
  const short = (l) => l.label.replace('Around ', '')
  const gap = sc.max_gap_m[sp.id]
  return (
    <aside className="species-panel">
      <button className="close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="species-head">
        <img src={imageUrl(sp.image)} alt={sp.name_en} onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
        <div>
          <h2 style={{ color: sp.colour }}>{sp.name_en}</h2>
          <p>
            {sp.name_de} · <i>{sp.scientific}</i>
          </p>
        </div>
      </div>

      <h3>How it moves</h3>
      <p>
        <LineSample line={group.line} colour={sp.colour} /> {group.label}, {group.height_m[0]}–{group.height_m[1]} m: {R.group_text[sp.group]}
        {gap ? `; largest gap ${gap} m` : ''}.
      </p>
      <p className="hint">Models, not tracked movements.</p>

      <h3>Routes</h3>
      <p className="route-counts">
        {Object.entries(sc.layouts)
          .map(([key, l]) => `${short(l)} ${S.layouts[key].routes}`)
          .join(' · ')}
      </p>
      <table className="behaviour">
        <tbody>
          {Object.entries(sc.layouts).map(([key, l]) => {
            const v = S.layouts[key]
            return (
              <tr key={key} className={key === layout ? 'now' : ''}>
                <th>{l.label}</th>
                <td>
                  {BEHAVIOUR[v.behaviour]}
                  <span className="hint">
                    {' '}
                    ({v.new} new{v.broken ? `, ${v.broken} broken` : ''})
                  </span>
                </td>
                <td className="num">
                  {v.homes} {v.homes === 1 ? 'home' : 'homes'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <ul className="route-list">
        {mine.map((r) => (
          <li key={r.id} className={r.layouts[layout] ? '' : 'later'}>
            {label(r.from)}
            {r.to !== r.from ? ` – ${label(r.to)}` : ' (loop)'} <span className="hint">from {short(sc.layouts[r.appears])}</span>
          </li>
        ))}
      </ul>
      <p className="hint">Needs: {sp.home_needs}. A potential home is a place along the routes where this is met by what has grown up in the layout.</p>
      {S.notes.map((n) => (
        <p key={n} className="hint">
          Note: {n}.
        </p>
      ))}

      <h3>Plant for it</h3>
      <ul className="plants">
        {sp.food_plants.map((p) => (
          <li key={p.en}>
            {p.en}
            {p.scientific && (
              <>
                {' '}
                (<i>{p.scientific}</i>)
              </>
            )}{' '}
            <span className="light">{p.light.map((l) => LIGHT_WORD[l]).join(', ')}</span>
          </li>
        ))}
      </ul>
      {R.homes.mowing_rule_for.includes(sp.id) && <p className="hint">Mowing: {sc.people.mowing_rule}.</p>}

      <h3>Source</h3>
      <p className="hint">
        {sp.source}
        {sp.gbif_records ? `: ${sp.gbif_records} records in central Weimar, 2010–2026` : ''}.
      </p>
    </aside>
  )
}

function Swatch({ colour }) {
  return <span className="swatch" style={{ background: colour }} />
}

// Small sample shapes for the legends, drawn like the low-poly shapes on the map.
function Sample({ shape, colour, trunk, fill, rim, bush, flowers, figures }) {
  return (
    <svg className="sample" viewBox="0 0 20 20" aria-hidden="true">
      {shape === 'tree' && (
        <>
          <rect x="9.2" y="12" width="1.6" height="6" fill={trunk} />
          <polygon points="10,2 16,6 16,12 10,15 4,12 4,6" fill={colour} />
        </>
      )}
      {shape === 'youngTree' && (
        <>
          <rect x="9.3" y="13" width="1.4" height="5" fill={trunk} />
          <polygon points="10,6 14,8.5 14,12.5 10,14.5 6,12.5 6,8.5" fill={colour} />
        </>
      )}
      {shape === 'shrub' && <polygon points="2,17 3,12 7,9 11,10 13,8 17,10 18,17" fill={colour} />}
      {shape === 'meadow' && (
        <>
          <rect x="1" y="4" width="18" height="12" rx="2" fill={fill} />
          <path d="M1 10 L7 4 M1 16 L13 4 M7 16 L19 4 M13 16 L19 10" stroke={colour} strokeWidth="1.4" />
        </>
      )}
      {shape === 'roof' && (
        <>
          <rect x="1" y="5" width="18" height="12" fill={rim} stroke="#c9c9c9" strokeWidth="0.6" />
          <rect x="3" y="7" width="14" height="8" fill={colour} />
          <polygon points="5,14 5.5,11 8,10 10,11.5 10,14" fill={bush} />
          <polygon points="12,9 13.5,8.2 15,9 14.5,10.5 12.5,10.5" fill={flowers[0]} />
          <polygon points="13,12 14.5,11.2 16,12 15.5,13.5 13.5,13.5" fill={flowers[1]} />
        </>
      )}
      {shape === 'pond' && (
        <>
          <ellipse cx="10" cy="12" rx="9" ry="6" fill={colour} opacity="0.45" />
          <ellipse cx="10" cy="12" rx="7" ry="4.5" fill={colour} />
        </>
      )}
      {shape === 'box' && (
        // A small box seen from above at an angle: the roof, and two walls a little darker.
        <g stroke="#9a9a9a" strokeWidth="0.5" strokeLinejoin="round">
          <polygon points="10,3 17,6.5 10,10 3,6.5" fill={colour} />
          <polygon points="3,6.5 10,10 10,18 3,14.5" fill={colour} />
          <polygon points="3,6.5 10,10 10,18 3,14.5" fill="#000" opacity="0.1" />
          <polygon points="10,10 17,6.5 17,14.5 10,18" fill={colour} />
          <polygon points="10,10 17,6.5 17,14.5 10,18" fill="#000" opacity="0.2" />
        </g>
      )}
      {shape === 'car' && (
        <>
          <rect x="2" y="9" width="16" height="5" rx="2" fill={colour} />
          <rect x="5" y="5.5" width="8" height="4.5" rx="1.5" fill={colour} />
        </>
      )}
      {shape === 'bus' && <rect x="1" y="6" width="18" height="9" rx="1.5" fill={colour} />}
      {shape === 'station' && (
        <>
          <ellipse cx="10" cy="18.5" rx="5" ry="1.4" fill={colour} opacity="0.35" />
          <rect x="8.6" y="8" width="2.8" height="10.5" fill={colour} opacity="0.25" />
          <rect x="9.6" y="8" width="0.8" height="10.5" fill="#FFC4E1" />
          <circle cx="10" cy="6" r="5.6" fill={colour} opacity="0.2" />
          <circle cx="10" cy="6" r="4" fill={colour} />
          <circle cx="8.4" cy="4.4" r="1" fill="#fff" opacity="0.9" />
        </>
      )}
      {shape === 'dot' && <circle cx="10" cy="10" r="3" fill="#fff" stroke={colour} strokeWidth="1" />}
      {shape === 'mainPath' && <path d="M0 13 C6 9, 12 15, 20 9" fill="none" stroke={colour} strokeWidth="4.5" />}
      {shape === 'gathering' && <circle cx="10" cy="10" r="6" fill={colour} />}
      {shape === 'path' && (
        <>
          <path d="M0 16 C6 12, 12 18, 20 12 L20 7 C12 13, 6 7, 0 11 Z" fill={colour} stroke="#c9c4ba" strokeWidth="0.5" />
          <rect x="4.2" y="5" width="1.8" height="5" rx="0.9" fill={figures.person} />
          <circle cx="5.1" cy="4" r="1.1" fill={figures.person} />
          <circle cx="9.3" cy="11.5" r="1.6" fill="none" stroke={figures.bike} strokeWidth="0.7" />
          <circle cx="12.6" cy="11.5" r="1.6" fill="none" stroke={figures.bike} strokeWidth="0.7" />
          <rect x="15.2" y="9" width="3.4" height="2.2" rx="0.6" fill={figures.robot} />
        </>
      )}
    </svg>
  )
}

// A legend section that folds open and shut; open at first unless open is false.
function Section({ title, children, open = true }) {
  return (
    <details className="layer" open={open}>
      <summary>{title}</summary>
      {children}
    </details>
  )
}

export default function App() {
  const [city, setCity] = useState(null)
  // The address can pick the first layout, e.g. ?layout=growing, and switch the light layer
  // on with ?light=1; the check against scenario.layouts happens once the data is loaded.
  const params = new URLSearchParams(location.search)
  const [layout, setLayout] = useState(() => params.get('layout') ?? 'today')
  // Which layers are on. groupsOff: species groups switched off. ?light=1 switches the light layer on.
  const [layers, setLayers] = useState(() => ({
    groupsOff: {},
    rings: false,
    zones: false,
    paths: true,
    interactions: true,
    light: params.get('light') === '1',
    planting: true,
    buildings: true,
  }))
  const setLayer = (k) => (v) => setLayers((l) => ({ ...l, [k]: v }))
  const setGroup = (g, on) => setLayers((l) => ({ ...l, groupsOff: { ...l.groupsOff, [g]: !on } }))
  const [error, setError] = useState(null)
  // The selected species or group: null, { species: id } or { group: id }; the address can
  // pick one, e.g. ?species=great_tit or ?group=canopy.
  const [selection, setSelection] = useState(() =>
    params.get('species') ? { species: params.get('species') } : params.get('group') ? { group: params.get('group') } : null,
  )
  // Routes that are new in a layout are highlighted for routes.highlight_new_s after switching
  // to it, or all the time with the "highlight new routes" toggle (also ?new=1).
  const [keepNew, setKeepNew] = useState(() => params.get('new') === '1')
  const [pulse, setPulse] = useState(false)
  const lastLayout = useRef(null)
  useEffect(() => {
    if (!city) return
    const switched = lastLayout.current !== null && lastLayout.current !== layout
    lastLayout.current = layout
    if (!switched) return
    setPulse(true)
    const t = setTimeout(() => setPulse(false), city.scenario.routes.highlight_new_s * 1000)
    return () => clearTimeout(t)
  }, [layout, city])

  useEffect(() => {
    loadCity()
      .then((c) => {
        setLayout((l) => (l in c.scenario.layouts ? l : 'today'))
        setCity(c)
      })
      .catch((e) => setError(e.message))
  }, [])

  const layouts = city ? Object.entries(city.scenario.layouts) : []
  const current = city?.scenario.layouts[layout]
  const sc = city?.scenario
  const lightCfg = sc?.light
  const col = sc?.colours

  // What exists in the selected layout, so the legends show only that.
  const year = current?.year ?? 0
  const has = sc && {
    planned: year >= sc.planting_start_year,
    ponds: year >= sc.planting.ponds.years[0],
    secondWave: year >= sc.trees.second_wave_year,
    roofs: sc.green_roofs.layouts.includes(layout),
    traffic: current.streets === 'roads',
    paths: sc.paths.layouts.includes(layout),
    rings: current.rings,
  }
  // The layers as the map needs them: every species group on unless switched off.
  const mapLayers = useMemo(() => city && { ...layers, groups: Object.fromEntries(Object.keys(city.species.groups).map((g) => [g, !layers.groupsOff[g]])) }, [city, layers])
  const stationBuildings = city ? city.people.rings.reduce((n, r) => n + r.buildings.length, 0) : 0

  return (
    <div className="app">
      {city && <City city={city} layout={layout} layers={mapLayers} selection={selection} onSelect={setSelection} highlightNew={keepNew || pulse} />}
      {city && selection?.species && (
        <SpeciesPanel sp={city.species.species.find((s) => s.id === selection.species)} city={city} layout={layout} onClose={() => setSelection(null)} />
      )}

      <div className="panel">
        <h1>Weimar Grows Wild</h1>
        {error && <p className="error">Could not load the data: {error}</p>}
        {!city && !error && <p className="status">Loading the city…</p>}
        {city && (
          <>
            <div className="switch" role="tablist">
              {layouts.map(([key, l]) => (
                <button key={key} role="tab" aria-selected={layout === key} className={layout === key ? 'on' : ''} onClick={() => setLayout(key)}>
                  {l.label}
                </button>
              ))}
            </div>
            <ul className="facts">
              <li><b>Streets:</b> {current.streets}</li>
              <li><b>Planting:</b> {current.planting}</li>
              <li><b>People:</b> {current.people.join(', ')}</li>
            </ul>

            <Section title="Species">
              <p className="hint">Switch groups on and off; click a species or a group to bring its routes forward.</p>
              <Toggle checked={keepNew} onChange={setKeepNew}>
                highlight new routes
              </Toggle>
              {Object.entries(city.species.groups).map(([gid, g]) => (
                <div key={gid} className="species-group">
                  <input type="checkbox" checked={!layers.groupsOff[gid]} onChange={(e) => setGroup(gid, e.target.checked)} aria-label={`show ${g.label}`} />
                  <button className={'group-head' + (selection?.group === gid ? ' on' : '')} onClick={() => setSelection(selection?.group === gid ? null : { group: gid })}>
                    <LineSample line={g.line} colour="#555" /> {g.label}
                  </button>
                  <ul className="legend species-list">
                    {city.species.species
                      .filter((s) => s.group === gid)
                      .map((s) => (
                        <li key={s.id}>
                          <button className={selection?.species === s.id ? 'on' : ''} onClick={() => setSelection(selection?.species === s.id ? null : { species: s.id })}>
                            <LineSample line={g.line} colour={s.colour} /> {s.name_en}
                          </button>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </Section>

            <Section title="People">
              {has.rings && (
                <>
                  <Toggle checked={layers.rings} onChange={setLayer('rings')}>
                    <Sample shape="station" colour={sc.rings.glow.core_colour} /> teleport station
                  </Toggle>
                  <p className="hint">
                    {city.people.rings.length} stations, {sc.rings.height_m} m up: one for every transport building (the data has no bus stops) and service building over{' '}
                    {sc.rings.min_service_footprint_m2} m², {stationBuildings} in all, joined where closer than {sc.rings.merge_within_m} m.
                  </p>
                  <Toggle checked={layers.zones} onChange={setLayer('zones')}>
                    pressure zones: on foot from a station
                  </Toggle>
                  {layers.zones && (
                    <ul className="legend">
                      {sc.people.reach_minutes.map((m, i) => (
                        <li key={m}>
                          <Swatch colour={col.pressure_zones[i]} /> {m} min
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              <Toggle checked={layers.paths} onChange={setLayer('paths')}>
                {has.paths ? 'paths, people, bikes and robots' : 'cars, buses and bikes on the roads'}
              </Toggle>
              {layers.paths && (
                <ul className="legend">
                  {has.traffic && <li><Sample shape="car" colour={col.car} /> car</li>}
                  {has.traffic && <li><Sample shape="bus" colour={col.bus} /> bus at a stop</li>}
                  {has.paths && (
                    <li className="wide">
                      <Sample shape="path" colour={col.path} figures={{ person: col.person, bike: col.path_bike, robot: col.robot }} /> path ({sc.paths.width_m} m) with people, bikes and robots
                    </li>
                  )}
                  {has.paths && <li className="wide"><Sample shape="mainPath" colour={col.main_path} /> main path between the stations ({sc.paths.main_width_m} m)</li>}
                  {has.paths && <li className="wide"><Sample shape="gathering" colour={col.gathering_place} /> gathering place (3 or more main paths)</li>}
                </ul>
              )}
              <Toggle checked={layers.interactions} onChange={setLayer('interactions')}>
                <Sample shape="dot" colour={col.interaction_outline} /> interaction points
              </Toggle>
              <p className="hint">
                Where a species route, {sc.people.path_height_band_m[0]}–{sc.people.path_height_band_m[1]} m high, crosses a {has.paths ? 'path' : 'road'}. Shown with at least one species group on.
              </p>
            </Section>

            <Section title="Light">
              <Toggle checked={layers.light} onChange={setLayer('light')}>
                show sun hours
              </Toggle>
              {layers.light && (
                <>
                  <p className="hint">Average sun hours per day, April to September; only buildings cast shade.</p>
                  <ul className="legend">
                    <li><Swatch colour={col.light_full_sun} /> full sun ({lightCfg.full_sun_min_hours} h or more)</li>
                    <li><Swatch colour={col.light_partial} /> partial shade ({lightCfg.partial_shade_min_hours}–{lightCfg.full_sun_min_hours} h)</li>
                    <li><Swatch colour={col.light_shade} /> shade (under {lightCfg.partial_shade_min_hours} h)</li>
                  </ul>
                </>
              )}
            </Section>

            <Section title="Planting">
              <Toggle checked={layers.planting} onChange={setLayer('planting')}>
                show planting
              </Toggle>
              <ul className="legend">
                <li><Sample shape="tree" colour={col.tree_existing} trunk={col.tree_trunk} /> existing tree</li>
                {has.planned && <li><Sample shape="tree" colour={col.tree_planned} trunk={col.tree_trunk} /> new tree, {sc.planting_start_year}</li>}
                {has.secondWave && <li><Sample shape="youngTree" colour={col.tree_planned} trunk={col.tree_trunk} /> new tree, {sc.trees.second_wave_year}</li>}
                {has.planned && <li><Sample shape="shrub" colour={col.tree_planned} /> new shrub</li>}
                {has.planned && <li><Sample shape="meadow" colour={col.meadow_hatch} fill={col.greenery_fill} /> meadow</li>}
                {has.ponds && <li><Sample shape="pond" colour={col.pond} /> pond</li>}
              </ul>
            </Section>

            <Section title="Buildings">
              <Toggle checked={layers.buildings} onChange={setLayer('buildings')}>
                show buildings
              </Toggle>
              <ul className="legend">
                <li><Sample shape="box" colour={col.building} /> building</li>
                <li><Sample shape="box" colour={col.service_building} /> service building</li>
                {has.roofs && <li><Sample shape="roof" colour={col.green_roof} rim={col.green_roof_rim} bush={col.tree_planned} flowers={col.roof_flowers} /> green roof</li>}
              </ul>
            </Section>

            <Section title="Numbers" open={false}>
              <Numbers city={city} layout={layout} />
            </Section>

            <Section title="Limits" open={false}>
              <ul className="limits">
                {LIMITS.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </Section>
          </>
        )}
      </div>

      <div className="bottom">
        <p className="nav-hint">Drag to orbit, right-drag to pan, scroll to zoom.</p>
        <p className="attribution">{ATTRIBUTION}</p>
      </div>
    </div>
  )
}

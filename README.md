# Weimar Grows Wild

An interactive 3D scenario map of central Weimar (about 1.3 × 2 km around the Markt) that shows how 14 animal species could move through the city, where they could find new homes, and where they meet people.

Today, the streets are roads with parked cars and buses, and the species move through the existing parks, gardens, cemeteries and tree rows, often stopped by a road or a gap. Around 2050 the streets become meadow bands with paths, new trees, shrubs and ponds and teleport rings for people; Around 2100 a second wave of trees and green roofs on the service buildings join them, and more routes open.

## What the app shows

- **Species:** 14 species in six groups (ground, hopping, low flyers, bats, canopy, high flyers), each with its own line shape and height. Every route ends as it does in that layout: a small cross where it is broken, an arrowhead where it crosses the map edge or loops back, or the species circle where it can settle. Potential homes are small rings on the ground. Routes that are new in a layout pulse for two seconds after switching to it. Click a species or a group to bring its routes forward and open its panel: picture, names, how it moves, routes and homes per layout, plants to plant for it, and its source.
- **People:** Today, roads with static cars, buses and bikes. Around 2050 and 2100: teleport rings 40 m up, the areas reached on foot from them in 5, 10 and 15 minutes (pressure zones), the 2 m paths in the green bands with people, bikes and robots, the main paths between the rings with gathering places, and interaction points where species routes meet roads or paths.
- **Light, planting, buildings:** average sun hours (from buildings only), existing and planned planting, and the buildings, with green roofs Around 2100.
- **Numbers:** for Today, 2050 and 2100 side by side: unsealed green area, habitat pieces, residents near habitat, and per species its routes, how they end, potential homes and interaction points.
- Every layer can be switched on and off in the panel. Drag to orbit, right-drag to pan, scroll to zoom. The address can open a layout or a species, for example `?layout=growing&species=hedgehog`.

## Run it

You need [Node.js](https://nodejs.org), version 20 or newer.

```
npm install          install the packages (once)
npm run precompute   compute the light, planting, routes, people and numbers (about 15 s)
npm run dev          start the app at http://localhost:5173
```

`npm run precompute` writes `public/data/derived/`. Run it again after changing `scenario.json`, `species.json` or the city kit, and commit the files in `derived/`: the published site reads them as they are. `npm run build` makes the published version in `dist/`. Every push to `main` publishes the app on GitHub Pages at `https://<user>.github.io/<repo>/`, through `.github/workflows/deploy.yml`; every file is loaded through `import.meta.env.BASE_URL`, so it works there as on localhost.

## Method

Everything heavy is computed once by `npm run precompute` (`scripts/`); the app only reads the results. All assumptions are in `public/data/scenario.json` (table below); species, groups and behaviours are in `public/data/species.json`.

1. **Light** (`light.json`): average hours of direct sun per day on a 5 m grid, April to September, with the buildings as the only shade; three classes: full sun, partial shade, shade.
2. **Planting** (`planting.json`): in 2050, trees, shrubs, meadow strips and ponds along the green bands and in the squares, placed by light and kept off the paths and buildings; in 2075, a second wave of trees in between. Green roofs (`roofs.json`) on every service building, Around 2100.
3. **Routes** (`routes.json`): every route is computed once, on the Around 2100 city, between the habitats at the map edge (Ettersberg, the Ilm toward Tiefurt, the Webicht, the Ilm valley toward Belvedere, Paradies), the Ilmpark and the largest existing green areas. Ground species take the cheapest way on the grid (`ground_cost`); hopping, canopy and low-flying species hop through trees, shrubs, green roofs or stepping stones, never further than their largest gap (`max_gap_m`); the bat follows tree lines, woodland edges and green bands; high flyers fly big loops over feeding areas. Each route keeps its line in every layout: where a road (Today), a gap that the planting has not yet closed, or a stretch without tree lines breaks it, it is cut there. Today has 2–3 routes per species through existing greenery; 2050 and 2100 add 1–2 each, opened by the new planting. Potential homes are places along a route where the species' needs (`routes.homes.rules`) are met by what has grown up in that layout.
4. **People** (`people.json`): one ring above every transport building (the data has no bus stops) and every service building over 800 m². Pressure zones: walking from the nearest node of the pedestrian network at 80 m per minute, the reached street segments widened by 25 m on each side and joined. Main paths: the shortest network along the paths that links all rings. Interaction points: where a route at 0–3 m height crosses a road or path, computed from the route lines, not from the drawn arcs.
5. **Numbers** (`numbers.json`): unsealed green area on the 5 m grid; habitat pieces as connected unsealed areas of at least 500 m²; residents of the Zensus 100 m cells within 200 m of a habitat piece, each cell by the share of its area inside, rounded to 10; cells without a published resident count are left out and counted.

## Limits

- The routes are models, not tracked movements.
- The ground is flat: the map has no terrain.
- The Ilm is outside the map data, so the large habitats around Weimar are shown as arrows on the edge.
- OpenStreetMap trees and gardens are mapped unevenly: some streets have every tree, others none.
- GBIF records show where people observed a species, not where it is most numerous.
- The bat comes from a detector survey.
- Planned planting is not yet established.
- Light is computed from buildings only, not from trees.
- The species pictures are illustrations generated with ChatGPT, not photos.
- All years and numbers in `scenario.json` are assumptions.

## Every value in scenario.json

Notes (`_note`) are left out here; they explain each block in the file itself.

| Setting | Value |
| --- | --- |
| `layouts.today.label` | Today |
| `layouts.today.streets` | roads |
| `layouts.today.planting` | existing only |
| `layouts.today.people` | walking, bikes, cars, buses |
| `layouts.today.rings` | false |
| `layouts.today.year` | 2026 |
| `layouts.opening.label` | Around 2050 |
| `layouts.opening.streets` | meadow and paths |
| `layouts.opening.planting` | new trees, shrubs, meadows, ponds |
| `layouts.opening.people` | walking, bikes, robots, teleport rings |
| `layouts.opening.rings` | true |
| `layouts.opening.year` | 2050 |
| `layouts.growing.label` | Around 2100 |
| `layouts.growing.streets` | green with trees |
| `layouts.growing.planting` | as 2050 + more trees (2075) + green roofs |
| `layouts.growing.people` | walking, bikes, robots, teleport rings |
| `layouts.growing.rings` | true |
| `layouts.growing.year` | 2100 |
| `maturity_years.meadow` | 2 |
| `maturity_years.shrub` | 8 |
| `maturity_years.tree` | 30 |
| `maturity_years.dead_wood` | 50 |
| `maturity_years.pond` | 3 |
| `planting_start_year` | 2050 |
| `street_green_band_width_m` | 12 |
| `planned_tree_spacing_m` | 24 |
| `min_tree_distance_to_building_m` | 3 |
| `planned_shrub_spacing_m` | 6 |
| `planting.later_tree_share` | 0 |
| `planting.later_tree_years` | 2060, 2080 |
| `planting.square_groups.area_per_group_m2` | 1500 |
| `planting.square_groups.trees_per_group` | 3, 5 |
| `planting.square_groups.group_radius_m` | 7 |
| `planting.square_groups.keep_off_paths_m` | 2 |
| `planting.ponds.places` | square, park, grass, meadow, recreation_ground |
| `planting.ponds.radius_m` | 4 |
| `planting.ponds.keep_off_buildings_m` | 3 |
| `planting.ponds.keep_off_paths_m` | 3 |
| `planting.ponds.years` | 2050, 2050 |
| `planting.ponds.candidate_spacing_m` | 5 |
| `planting.ponds.wobble` | 0.2 |
| `planting.ponds.soft_edge_share` | 0.3 |
| `green_roofs.layouts` | growing |
| `green_roofs.rim_m` | 1 |
| `green_roofs.raise_m` | 0.05 |
| `green_roofs.keep_off_rim_m` | 0.4 |
| `green_roofs.min_gap_m` | 1.6 |
| `green_roofs.bushes_per_100m2` | 1.2 |
| `green_roofs.flower_clumps_per_100m2` | 3 |
| `green_roofs.bush_height_m` | 0.5, 1.1 |
| `green_roofs.bush_width_share` | 1.2, 1.8 |
| `green_roofs.flower_height_m` | 0.25, 0.45 |
| `green_roofs.flower_width_m` | 0.5, 0.9 |
| `green_roofs.habitat_for_groups.groups` | hopping, canopy, high_flyer, low_flyer, bat |
| `trees.types.round.label` | round broadleaf (oak, lime, maple) |
| `trees.types.round.height_m` | 8, 18 |
| `trees.types.round.crown_width_share` | 0.6, 0.85 |
| `trees.types.round.genera` | Quercus, Tilia, Acer, Platanus, Aesculus, Castanea, Robinia, Acacia, Juglans, Ulmus |
| `trees.types.oval.label` | tall oval broadleaf (beech, ash) |
| `trees.types.oval.height_m` | 14, 26 |
| `trees.types.oval.crown_width_share` | 0.4, 0.55 |
| `trees.types.oval.genera` | Fagus, Fraxinus, Betula, Ginkgo, Prunus, Alnus |
| `trees.types.columnar.label` | narrow columnar (poplar, hornbeam) |
| `trees.types.columnar.height_m` | 12, 25 |
| `trees.types.columnar.crown_width_share` | 0.18, 0.3 |
| `trees.types.columnar.genera` | Populus, Carpinus |
| `trees.types.conifer.label` | conifer (cone) |
| `trees.types.conifer.height_m` | 8, 22 |
| `trees.types.conifer.crown_width_share` | 0.3, 0.45 |
| `trees.types.conifer.genera` | Pinus, Picea, Abies, Larix, Taxus, Thuja, Taxodium, Taxodum, Pseudotsuga |
| `trees.types.multi_stem.label` | small multi-stem tree or large shrub (hazel, hawthorn, rowan) |
| `trees.types.multi_stem.height_m` | 4, 8 |
| `trees.types.multi_stem.crown_width_share` | 0.75, 1 |
| `trees.types.multi_stem.genera` | Corylus, Crataegus, Sorbus, Sambucus, Cornus, Salix, Ligustrum, Malus |
| `trees.leaf_type.needleleaved` | conifer |
| `trees.existing_type_weights.round` | 0.5 |
| `trees.existing_type_weights.oval` | 0.2 |
| `trees.existing_type_weights.columnar` | 0.1 |
| `trees.existing_type_weights.conifer` | 0.1 |
| `trees.existing_type_weights.multi_stem` | 0.1 |
| `trees.shrub.height_m` | 1.2, 2.5 |
| `trees.shrub.crown_width_share` | 1.3, 1.9 |
| `trees.shrub.squash` | 0.7, 1.3 |
| `trees.shrub.young_scale` | 1 |
| `trees.planned_type_weights.round` | 0.35 |
| `trees.planned_type_weights.oval` | 0.2 |
| `trees.planned_type_weights.columnar` | 0.1 |
| `trees.planned_type_weights.conifer` | 0.05 |
| `trees.planned_type_weights.multi_stem` | 0.3 |
| `trees.colour_variation.hue_deg` | 6 |
| `trees.colour_variation.saturation` | 0.06 |
| `trees.colour_variation.lightness` | 0.05 |
| `trees.placement.junction_clear_m` | 8 |
| `trees.placement.lateral_offset_share_of_band` | 0.33 |
| `trees.placement.lateral_jitter_m` | 1.2 |
| `trees.placement.keep_off_path_m` | 2 |
| `trees.placement.along_jitter_share` | 0.15 |
| `trees.placement.min_tree_gap_m` | 5 |
| `trees.placement.patterns.row` | 0.3 |
| `trees.placement.patterns.rhythm` | 0.25 |
| `trees.placement.patterns.cluster` | 0.2 |
| `trees.placement.patterns.single` | 0.25 |
| `trees.placement.row_trees` | 2, 4 |
| `trees.placement.rhythm_steps` | 3, 5 |
| `trees.placement.rhythm_tree_share` | 0.65 |
| `trees.placement.cluster_trees` | 3, 5 |
| `trees.placement.cluster_radius_m` | 5 |
| `trees.placement.step_share_of_spacing` | 0.35, 0.5 |
| `trees.placement.gap_share_of_spacing` | 0.8, 2 |
| `trees.placement.light_acceptance.full_sun` | 1 |
| `trees.placement.light_acceptance.partial_shade` | 0.45 |
| `trees.placement.light_acceptance.shade` | 0.12 |
| `trees.placement.clearings.share_of_full_sun` | 0.33 |
| `trees.placement.clearings.cell_m` | 40 |
| `trees.placement.shrubs.group_size` | 1, 4 |
| `trees.placement.shrubs.step_m` | 1.8, 3 |
| `trees.placement.shrubs.gap_share_of_spacing` | 1.5, 4 |
| `trees.placement.shrubs.keep_off_trees_m` | 2.5 |
| `trees.placement.shrubs.min_gap_m` | 1.5 |
| `trees.placement.shrubs.in_clearings` | 0.3 |
| `trees.placement.meadow.patch_length_m` | 8, 25 |
| `trees.placement.meadow.gap_m` | 6, 20 |
| `trees.placement.meadow.in_clearings_gap_scale` | 0.5 |
| `trees.placement.meadow.inner_m` | 0.5 |
| `trees.placement.meadow.outer_margin_m` | 0.3 |
| `trees.placement.meadow.hatch_spacing_m` | 1.6 |
| `trees.placement.meadow.hatch_width_m` | 0.35 |
| `trees.placement.patterns_second_wave.row` | 0.25 |
| `trees.placement.patterns_second_wave.rhythm` | 0.2 |
| `trees.placement.patterns_second_wave.cluster` | 0.4 |
| `trees.placement.patterns_second_wave.single` | 0.15 |
| `trees.scale_2050` | 1.6 |
| `trees.scale_2100` | 1.6 |
| `trees.second_wave_year` | 2075 |
| `trees.spacing_2100_m` | 8 |
| `trees.scale_second_wave` | 1.2 |
| `pond_count_growing` | 12 |
| `random_seed` | 2100 |
| `grid_cell_m` | 5 |
| `light.full_sun_min_hours` | 6 |
| `light.partial_shade_min_hours` | 3 |
| `light.sample_days` | 04-15, 06-21, 08-15 |
| `light.sample_every_minutes` | 30 |
| `ground_cost.building` | null |
| `ground_cost.road_today` | 1000 |
| `ground_cost.path_with_bikes` | 8 |
| `ground_cost.green_band` | 2 |
| `ground_cost.garden` | 1 |
| `ground_cost.private_garden` | 1 |
| `ground_cost.park` | 1 |
| `ground_cost.meadow` | 1 |
| `ground_cost.scrub` | 1 |
| `ground_cost.woodland` | 1 |
| `ground_cost.allotments` | 2 |
| `ground_cost.cemetery` | 2 |
| `ground_cost.other_open_ground` | 10 |
| `broken_rule` | In the Today layout a ground route stops at the first road it would have to cross; mark the stop with a small cross. |
| `max_gap_m.red_squirrel` | 6 |
| `max_gap_m.blue_tit` | 50 |
| `max_gap_m.great_tit` | 60 |
| `max_gap_m.great_spotted_woodpecker` | 120 |
| `max_gap_m.blackbird` | 30 |
| `max_gap_m.house_sparrow` | 25 |
| `max_gap_m.peacock_butterfly` | 400 |
| `max_gap_m.common_carder_bee` | 300 |
| `max_gap_m.pipistrelle` | 50 |
| `flying_species_ignore_buildings` | true |
| `arc_clears_roofs_by_m` | 3 |
| `high_flyer_loop.feeding_areas` | meadow, park, grass |
| `high_flyer_loop.min_radius_m` | 300 |
| `people.walking_speed_m_per_min` | 80 |
| `people.reach_minutes` | 5, 10, 15 |
| `people.reach_band_m` | 25 |
| `people.path_height_band_m` | 0, 3 |
| `people.robots_work` | daytime only |
| `people.mowing_rule` | robots mow by day only, cut high, and mow one patch at a time |
| `people.pressure_zone_opacity` | 0.55 |
| `paths.layouts` | opening, growing |
| `paths.width_m` | 2 |
| `paths.curve_amplitude_m` | 1.5 |
| `paths.curve_wavelength_m` | 30, 60 |
| `paths.keep_plants_off_m` | 0.5 |
| `paths.people` | 300 |
| `paths.bikes` | 80 |
| `paths.robots` | 30 |
| `paths.main_width_m` | 3 |
| `paths.gathering_radius_m` | 6 |
| `traffic.cars` | 400 |
| `traffic.buses` | 20 |
| `traffic.bikes` | 40 |
| `rings.height_m` | 40 |
| `rings.colour` | #FF2E93 |
| `rings.glow` | false |
| `rings.stop_uses` | Transport |
| `rings.service_uses` | Service, Civic, Health, Education, Retail |
| `rings.min_service_footprint_m2` | 800 |
| `rings.radius_m` | 12 |
| `rings.tube_m` | 1 |
| `habitat_buffer_for_residents_m` | 200 |
| `drawing.dot_spacing_m` | 4 |
| `drawing.arc_length_low_m` | 6 |
| `drawing.arc_length_high_m` | 15 |
| `drawing.zigzag_amplitude_m` | 2 |
| `drawing.parallel_route_offset_m` | 4 |
| `drawing.corridor_band_opacity` | 0.15 |
| `drawing.corridor_band_width_m` | 14 |
| `drawing.home_marker_m` | 6 |
| `colours.ground_plane` | #E5E9EB |
| `colours.building` | #FFFFFF |
| `colours.service_building` | #E9DCC8 |
| `colours.greenery_fill` | #B9C7A3 |
| `colours.greenery_opacity` | 1 |
| `colours.tree_existing` | #9AAE84 |
| `colours.tree_planned` | #4F6B45 |
| `colours.tree_trunk` | #8A7F72 |
| `colours.pond` | #BFD8DC |
| `colours.meadow_hatch` | #8FA673 |
| `colours.green_roof` | #9FB57E |
| `colours.green_roof_rim` | #FFFFFF |
| `colours.roof_flowers` | #F4D892, #F2B6A3, #C9B6D9 |
| `colours.light_full_sun` | #F4D892 |
| `colours.light_partial` | #F2B6A3 |
| `colours.light_shade` | #94BEBB |
| `colours.interaction_outline` | #E36559 |
| `colours.human_path` | #9A9893 |
| `colours.pressure_zones` | #D9DADB, #CDCECF, #C1C2C3 |
| `colours.car` | #8E9296 |
| `colours.bike` | #4A4D50 |
| `colours.bus` | #6F7478 |
| `colours.path` | #EDE9E1 |
| `colours.person` | #A3A6A9 |
| `colours.path_bike` | #7F8387 |
| `colours.robot` | #B9BCBF |
| `colours.route_faded` | #D3D5D8 |
| `colours.edge_arrow` | #6B6E72 |
| `colours.main_path` | #E2DACB |
| `colours.gathering_place` | #D9CFBC |
| `display.sun.azimuth_deg` | 255 |
| `display.sun.altitude_deg` | 35 |
| `display.shadow_strength` | 0.3 |
| `species_circle.ring_width_share` | 0.07 |
| `species_circle.disc_radius_share` | 0.67 |
| `species_circle.disc_tint_white_share` | 0.75 |
| `species_circle.animal_fit_share.overflow_groups` | hopping, canopy, high_flyer, bat |
| `species_circle.animal_fit_share.overflow` | 1.18 |
| `species_circle.animal_fit_share.inside` | 0.9 |
| `species_circle.map_size_m` | 40 |
| `species_circle.ring_share_of_image` | 0.77 |
| `species_circle.clearance_m` | 6 |
| `species_circle.image_version` | 2026-11-07 |
| `routes.habitats.probe_width_m` | 60 |
| `routes.habitats.probe_depth_m` | 150 |
| `routes.habitats.min_arrow_gap_m` | 200 |
| `routes.habitats.edges[0].id` | ettersberg |
| `routes.habitats.edges[0].label` | Ettersberg |
| `routes.habitats.edges[0].toward` | north to northwest |
| `routes.habitats.edges[0].windows[0].side` | north |
| `routes.habitats.edges[0].windows[0].from_m` | -670 |
| `routes.habitats.edges[0].windows[0].to_m` | 150 |
| `routes.habitats.edges[0].windows[1].side` | west |
| `routes.habitats.edges[0].windows[1].from_m` | 750 |
| `routes.habitats.edges[0].windows[1].to_m` | 971 |
| `routes.habitats.edges[1].id` | tiefurt |
| `routes.habitats.edges[1].label` | Ilm toward Tiefurt |
| `routes.habitats.edges[1].toward` | northeast |
| `routes.habitats.edges[1].windows[0].side` | north |
| `routes.habitats.edges[1].windows[0].from_m` | 250 |
| `routes.habitats.edges[1].windows[0].to_m` | 670 |
| `routes.habitats.edges[1].windows[1].side` | east |
| `routes.habitats.edges[1].windows[1].from_m` | 450 |
| `routes.habitats.edges[1].windows[1].to_m` | 971 |
| `routes.habitats.edges[2].id` | webicht |
| `routes.habitats.edges[2].label` | Webicht |
| `routes.habitats.edges[2].toward` | east |
| `routes.habitats.edges[2].windows[0].side` | east |
| `routes.habitats.edges[2].windows[0].from_m` | -350 |
| `routes.habitats.edges[2].windows[0].to_m` | 400 |
| `routes.habitats.edges[3].id` | belvedere |
| `routes.habitats.edges[3].label` | Ilm valley toward Belvedere |
| `routes.habitats.edges[3].toward` | south |
| `routes.habitats.edges[3].windows[0].side` | south |
| `routes.habitats.edges[3].windows[0].from_m` | -670 |
| `routes.habitats.edges[3].windows[0].to_m` | 670 |
| `routes.habitats.edges[4].id` | paradies |
| `routes.habitats.edges[4].label` | Paradies |
| `routes.habitats.edges[4].toward` | west |
| `routes.habitats.edges[4].windows[0].side` | west |
| `routes.habitats.edges[4].windows[0].from_m` | -300 |
| `routes.habitats.edges[4].windows[0].to_m` | 700 |
| `routes.habitats.inside[0].id` | ilmpark |
| `routes.habitats.inside[0].label` | Ilmpark |
| `routes.habitats.inside[0].osm_names` | Ilmpark |
| `routes.habitats.inside[1].id` | webicht_inside |
| `routes.habitats.inside[1].label` | Webicht |
| `routes.habitats.inside[1].osm_names` | Webicht |
| `routes.source_radius_m` | 60 |
| `routes.road_half_width_m` | 3.5 |
| `routes.ground_cost_aliases.grass` | meadow |
| `routes.ground_cost_aliases.recreation_ground` | park |
| `routes.bat_cost.tree_line_within_m` | 10 |
| `routes.bat_cost.woodland_edge_within_m` | 15 |
| `routes.bat_cost.tree_line` | 1 |
| `routes.bat_cost.woodland_edge` | 1 |
| `routes.bat_cost.green_band` | 2 |
| `routes.bat_cost.woodland` | 3 |
| `routes.bat_cost.building` | 8 |
| `routes.bat_cost.open_square` | 30 |
| `routes.bat_cost.open_green` | 12 |
| `routes.bat_cost.other` | 6 |
| `routes.loop_turn_share` | 0.6 |
| `routes.home_target_share` | 0.6 |
| `routes.exit_m` | 40 |
| `routes.homes.search_m` | 60 |
| `routes.homes.min_spacing_m` | 50 |
| `routes.homes.sample_spacing_m` | 15 |
| `routes.homes.rules.blackbird.at` | shrub |
| `routes.homes.rules.blackbird.near[0].types` | lawn |
| `routes.homes.rules.blackbird.near[0].within_m` | 20 |
| `routes.homes.rules.great_tit.at` | old_tree |
| `routes.homes.rules.great_tit.near[0].types` | old_tree |
| `routes.homes.rules.great_tit.near[0].within_m` | 15 |
| `routes.homes.rules.great_tit.near[0].count` | 2 |
| `routes.homes.rules.blue_tit.at` | old_tree |
| `routes.homes.rules.blue_tit.near[0].types` | old_tree |
| `routes.homes.rules.blue_tit.near[0].within_m` | 15 |
| `routes.homes.rules.blue_tit.near[0].count` | 2 |
| `routes.homes.rules.great_spotted_woodpecker.at` | old_tree |
| `routes.homes.rules.great_spotted_woodpecker.near[0].types` | dead_wood |
| `routes.homes.rules.great_spotted_woodpecker.near[0].within_m` | 30 |
| `routes.homes.rules.woodpigeon.at` | old_tree |
| `routes.homes.rules.woodpigeon.near[0].types` | old_tree |
| `routes.homes.rules.woodpigeon.near[0].within_m` | 25 |
| `routes.homes.rules.woodpigeon.near[0].count` | 4 |
| `routes.homes.rules.carrion_crow.at` | old_tree |
| `routes.homes.rules.carrion_crow.near[0].types` | old_tree |
| `routes.homes.rules.carrion_crow.near[0].within_m` | 25 |
| `routes.homes.rules.carrion_crow.near[0].count` | 4 |
| `routes.homes.rules.house_sparrow.at` | shrub |
| `routes.homes.rules.house_sparrow.near[0].types` | building_edge |
| `routes.homes.rules.house_sparrow.near[0].within_m` | 8 |
| `routes.homes.rules.red_squirrel.at` | old_tree |
| `routes.homes.rules.red_squirrel.near[0].types` | old_tree |
| `routes.homes.rules.red_squirrel.near[0].within_m` | 6 |
| `routes.homes.rules.red_squirrel.near[0].count` | 3 |
| `routes.homes.rules.peacock_butterfly.at` | meadow |
| `routes.homes.rules.peacock_butterfly.light` | full_sun |
| `routes.homes.rules.common_carder_bee.at` | meadow |
| `routes.homes.rules.common_carder_bee.light` | full_sun, partial |
| `routes.homes.rules.common_carder_bee.away_from_paths_m` | 4 |
| `routes.homes.rules.hedgehog.at` | shrub |
| `routes.homes.rules.hedgehog.near[0].types` | shrub |
| `routes.homes.rules.hedgehog.near[0].within_m` | 20 |
| `routes.homes.rules.hedgehog.near[0].count` | 2 |
| `routes.homes.rules.hedgehog.near[1].types` | old_tree, dead_wood |
| `routes.homes.rules.hedgehog.near[1].within_m` | 20 |
| `routes.homes.rules.common_toad.at` | pond |
| `routes.homes.rules.common_toad.near[0].types` | shrub, old_tree |
| `routes.homes.rules.common_toad.near[0].within_m` | 20 |
| `routes.homes.rules.sand_lizard.at` | meadow |
| `routes.homes.rules.sand_lizard.light` | full_sun |
| `routes.homes.rules.sand_lizard.none_near[0].types` | old_tree |
| `routes.homes.rules.sand_lizard.none_near[0].within_m` | 8 |
| `routes.homes.rules.pipistrelle.at` | building_edge |
| `routes.homes.rules.pipistrelle.near[0].types` | old_tree |
| `routes.homes.rules.pipistrelle.near[0].within_m` | 15 |
| `routes.homes.rules.pipistrelle.near[0].count` | 3 |
| `routes.homes.habitat_types.old_tree` | existing trees, and planned trees older than maturity_years.tree |
| `routes.homes.habitat_types.dead_wood` | woodland, and planned trees older than maturity_years.dead_wood |
| `routes.homes.habitat_types.shrub` | scrub, gardens and allotments, and planned shrubs older than maturity_years.shrub |
| `routes.homes.habitat_types.lawn` | parks, grass, recreation grounds, and planned meadow older than maturity_years.meadow |
| `routes.homes.habitat_types.meadow` | meadow and grass, and planned meadow older than maturity_years.meadow |
| `routes.homes.habitat_types.pond` | planned ponds older than maturity_years.pond |
| `routes.homes.habitat_types.green_roof` | green roofs, in the layouts of green_roofs.layouts |
| `routes.homes.habitat_types.building_edge` | points along the outlines of buildings |
| `routes.homes.mowing_rule_for` | peacock_butterfly, common_carder_bee, house_sparrow, carrion_crow, woodpigeon, sand_lizard |
| `routes.group_text.ground` | walks on the ground along the cheapest way (ground_cost); buildings are barriers; today it stops at the first road |
| `routes.group_text.hopping` | hops from tree to tree, shrub and green roof, never further than its largest gap |
| `routes.group_text.canopy` | moves through the tree crowns, never further than its largest gap; rises over tall roofs |
| `routes.group_text.low_flyer` | flies low from meadow to park and garden (and green roofs in 2100), within its largest gap |
| `routes.group_text.bat` | flies at night along tree lines, woodland edges and the green bands, and avoids wide open squares |
| `routes.group_text.high_flyer` | flies a big loop above the roofs, from the edge to the feeding areas and back |
| `routes.outside_network_reach_m` | 150 |
| `routes.seed` | 2100 |
| `routes.per_layout.today` | 2, 3 |
| `routes.per_layout.opening` | 1, 2 |
| `routes.per_layout.growing` | 1, 2 |
| `routes.highlight_new_s` | 2 |
| `routes.candidates.anchor_classes` | park, cemetery, allotments, woodland, garden, meadow, scrub, recreation_ground, grass |
| `routes.candidates.anchor_min_area_m2` | 4000 |
| `routes.candidates.anchor_min_spacing_m` | 200 |
| `routes.candidates.anchor_count` | 12 |
| `routes.candidates.min_length_m` | 350 |
| `routes.candidates.max_overlap_share` | 0.35 |
| `routes.candidates.newer_penalty.opening` | 0.15 |
| `routes.candidates.newer_penalty.growing` | 0.3 |
| `routes.candidates.search_hop_m` | 80 |
| `routes.candidates.min_search_hop_m` | 30 |
| `habitat_min_piece_m2` | 500 |

## Data sources

All data is in `public/data/`; `public/data/SOURCES.md` describes every file and field. The app loads nothing from the internet.

| Data | Source | Licence |
| --- | --- | --- |
| Building footprints and heights (`buildings.geojson`) | 3D building models LoD2 of Thuringia, © GDI-Th; uses added by Egor Gaydukov | dl-de/by-2-0 |
| Land use (`plots.geojson`) and pedestrian network (`streets.geojson`, `streets.graph.json`) | Egor Gaydukov, InfAU, Bauhaus-Universität Weimar | |
| Census grid (`zensus.geojson`) | Zensus 2022, 100 m grid, © Statistische Ämter des Bundes und der Länder | dl-de/by-2-0 |
| Greenery (`greenery.geojson`) | © OpenStreetMap contributors | ODbL 1.0 |
| Species list (`species.json`) | GBIF.org (5 November 2026) GBIF Occurrence Download https://doi.org/10.15468/dl.778bqm | |
| Species illustrations (`images/`) | generated with ChatGPT (OpenAI); see `public/data/images/CREDITS.md` | |

Attribution, as shown on the map:

> Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0). Greenery: © OpenStreetMap contributors, ODbL 1.0. Species records: GBIF.org (5 Nov 2026), https://doi.org/10.15468/dl.778bqm. Species illustrations: generated with ChatGPT (OpenAI).

## How this was made

Tools: Claude Code, with the model Claude Opus 5.5 (`claude-opus-5-5`).
I decided:
The agent did: it wrote the precompute scripts and the React Three Fiber app (layouts, planting, species routes, people, numbers and panel) from scenario.json and species.json, checked them in a headless browser, and wrote this README.
I checked:

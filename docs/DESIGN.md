# Timmaz Hard — design and architecture

Working title: **Timmaz Hard** ("Canterbury, 1995"). An original third-person open-world crime sandbox for the browser.

All decisions below were made without sign-off so work could proceed; each is cheap to revisit.

## 1. Pillars

1. **The place is the star.** Compressed but recognisable Christchurch (pre-quake) and Timaru, joined by SH1 across the plains. Real street, suburb and landmark names. Invented businesses, brands, stations, gangs and people.
2. **Driving feels good first.** Raycast-vehicle physics with distinct vehicle classes; everything else hangs off that.
3. **One art direction.** "Sunlit scale-model realism": clean, purpose-built geometry with PBR materials and procedural textures, lit by a physically plausible sky with haze, cascaded shadows, AO and a restrained film grade. No photoscanned assets, so nothing clashes. Every asset is generated in code (see ASSETS.md).

## 2. Map

Axes: +x east, −z north, y up, metres. World is 6.1 km × 12.3 km (x ∈ ±3072, z ∈ ±6144), in 256 m chunks. The real geography is rotated so SH1 runs roughly north–south and the coast is always on the east; the Alps are always on the western horizon.

| Area | Centre (x, z) | Notes |
|---|---|---|
| Christchurch central | (0, −4300) | Four avenues ≈ 1.25 km square: Bealey (N), Fitzgerald (E), Moorhouse (S), Deans/Harper (W, beyond Hagley Park). Cathedral Square at the centre; Colombo St N–S; Cashel Mall; Worcester Blvd to the Arts Centre and museum; Avon winding SW→NE; tram loop. |
| Christchurch suburbs | ring around centre | Riccarton Rd (W, not SH1), Merivale/St Albans villas (N), Linwood/Waltham state houses + Lancaster Park (SE), Sydenham/Moorhouse industrial strip with the old station building (S), Addington with the new station (SW). |
| New Brighton | (2300, −4400) | Pages Rd from the city, Seaview Rd mall, beach. No pier in 1995. |
| Port Hills | ridge z ≈ −2900, x −200…2200 | Cashmere, Dyers Pass Rd to the Sign of the Kiwi, Summit Rd along the crest, Lyttelton road tunnel from Heathcote. |
| Lyttelton | (1500, −2350) | Port town on the harbour (sea inlet from the east). |
| SH1 north plains | x ≈ −1300, z −3500…−900 | Main South Rd: Sockburn, Hornby, Templeton, Rolleston, Burnham, Dunsandel as signs/short strips. |
| Rakaia | z ≈ −900 | Long narrow bridge over the braided river; rail bridge alongside. |
| Ashburton | (−1200, 300) | SH1 is West St; East St (shops) across the railway; clock tower. |
| Rangitata | z ≈ 1700 | Two bridges via Rangitata Island. |
| Temuka | (−700, 2900) | King St main street. |
| Washdyke | (−100, 4100) | Industrial, raceway, saleyards; freezing works at Smithfield just south. |
| Timaru | (350, 5000) | SH1 = Evans St → Theodosia St. Stafford St, the Bay Hill, Caroline Bay (sound shell, tearooms, carnival; no Piazza yet), port + silos, basilica on Craigie Ave, rail along the waterfront, downs to the west. |

Compression: SH1 Christchurch→Timaru ≈ 9.5 km of road ≈ 5–6 minutes at open-road speed.

Terrain: analytic height function = plains base + Port Hills ridge + Timaru downs + western foothills, cut by coast, harbour, rivers; then blended to road profiles so roads are always drivable. The Southern Alps are a non-playable backdrop mesh beyond the western edge.

## 3. Architecture

Vite + TypeScript + Three.js (WebGL2) + Rapier (WASM). Client only.

```
src/
  main.ts            title screen; lazy-loads game/ (three + rapier) on Start
  core/              types.ts (ALL shared interfaces), events, input, settings, save, math, rng
  game/              game.ts (loop, context), systems.ts (wiring — the only file that imports every module)
  render/            renderer + post stack, materials library, procedural textures, sky, weather
  physics/           Rapier wrapper, collision groups, raycasts, owner lookup
  world/             mapdata/ (authored map), map compile, height, chunk streaming, terrain, roads,
                     lots, buildings/, landmarks/, props, vegetation
  actors/            humanoid rig + procedural animation (shared by player, peds, police)
  player/            on-foot controller, camera, enter/exit
  combat/            weapons (data), firing, damage, pickups
  vehicles/          vehicle physics, specs (data), procedural models, autopilot
  ai/                pedestrians, traffic, navigation
  police/            wanted level, pursuit, roadblocks
  missions/          mission runner, definitions (data), story, shops
  ui/                HUD, minimap, pause/map, menus, controls screen
  audio/             synth SFX, engines, radio stations, ambience
```

Rules that keep modules independent:

- Every system implements `System` and receives the single `GameContext`. Systems talk through the context's typed APIs and the typed event bus only; no module imports another module's internals. `core/types.ts` is the contract.
- All materials come from `ctx.gfx.materials` so cascaded shadows, wetness and quality settings apply everywhere. No `onBeforeCompile` outside `render/`.
- Static world content is generated per chunk into merged/instanced geometry via `ChunkBuilder`; nothing adds loose meshes to the scene for static content.
- Data-driven: vehicles, weapons, missions, radio stations, building archetypes and the map are plain data files.
- Fixed 60 Hz physics step, variable render step.

## 4. Rendering

- HDR pipeline (half-float), ACES tone mapping, bloom, SMAA, vignette + subtle grain and grade (`postprocessing`), N8AO ambient occlusion.
- Cascaded shadow maps (three CSM addon) from the sun/moon.
- Procedural sky dome (scattering-style gradient, sun/moon discs, stars, fbm cloud layer incl. the nor'west arch), re-captured to a PMREM environment map for image-based lighting as the time of day changes.
- Exponential height-tinted fog driven by weather (clear, nor'wester, southerly rain, fog).
- Terrain: near chunks 4 m cells with skirts; a 32 m far mesh to the horizon, clipped out where near chunks are ready.
- Quality presets Low / Medium / High / Ultra + dynamic resolution scale targeting 60 fps.

## 5. Performance budget (Medium, 1080p, integrated GPU)

| Item | Budget |
|---|---|
| Frame | 16.6 ms: render ≤ 11 ms, JS game logic ≤ 3 ms, physics ≤ 2 ms |
| Draw calls | ≤ 350 |
| Visible triangles | ≤ 800 k |
| Shadow maps | 2 cascades × 1024² |
| Near chunk radius | 3 (≈ 768 m), built at most one stage per frame |
| Active vehicles / pedestrians | ≤ 24 / ≤ 30 |
| Initial download | title screen ≤ 150 kB gzip; game bundle lazy-loaded |
| Memory | no retained geometry for unloaded chunks |

## 6. Milestones

1. Design doc, scaffold, research.
2. **Vertical slice** (solo): Cathedral Square block, player on foot, one car, final lighting + post stack. Tune look and handling.
3. Freeze interfaces (`core/types.ts`), stub every module.
4. **Parallel fan-out**: map data · building archetypes · Christchurch landmarks · Timaru + rural landmarks/props · vehicle roster · pedestrians + traffic · combat · police · missions + save · UI · audio.
5. Integrate, review, playtest the full loop, fix.
6. Performance pass, README, ASSETS.md, final report.

## 7. Story thread (missions agent refines)

Player: **Mack Tully**, laid off from the freezing works at Smithfield. Fixer: **Aunty Rena**, who runs a chip shop on the Bay Hill. Six short jobs carry him from pinching a ute in Timaru, up SH1, into the boy-racer scene on the four avenues, and over the Port Hills to a finale at Lyttelton port. All characters, crews and businesses are invented.

## 8. What changed after the first build

The plan above is the one the game was started from. These are the decisions made later, once it could be played and looked at, with the reasons.

**Assets.** The original rule was "everything generated in code". It gave a world that read as low-poly however carefully it was lit, so the rule became "CC0 photographs for surfaces, leaves and people; code for everything else". Surface materials are photographic PBR sets tinted towards each building's own colour, every leaf comes from one atlas of photographed leaves, and the figures are CC0 rigged models with generated clothing. Vehicles and buildings stay procedural: no CC0 set of period New Zealand cars or buildings exists. `ASSETS.md` lists every file.

**Light.** Calibrated rather than tuned by eye: clear-sky sun to sky fill is about five to one on flat ground, the ground bounce in the environment map is the brightness of sunlit ground rather than of the sky, and overcast weather swaps the balance so the sky does the lighting. Shade is properly dark, which is what makes Canterbury summer light look like itself. Ambient occlusion was eased back to suit.

**Frame cost.** Two changes paid for the whole realism pass:
- The ambient-occlusion pass was, by default, walking the entire scene every frame looking for transparent materials and then rendering the scene twice more, shadow maps included. That is now switched off. Central Christchurch went from about 2,200 draw calls and 4.1 M triangles a frame to about 1,000 and 1.3 M with no visible difference.
- The three shadow cascades no longer all redraw every frame. The nearest does; the other two take turns, so at most two shadow maps are drawn per frame.
- Pedestrians more than 40 m from the camera stop casting shadows.

**Measured** on an Apple M2 Max MacBook Pro at 1920 × 1080, quality High, frame rate uncapped (`node scripts/shot.mjs … --fps 6 --size 1920x1080`):

| Place | Frames per second | Draw calls | Triangles (with shadow passes) |
|---|---|---|---|
| The Bay Hill, Timaru (where the game starts) | 164–174 | 920–1,160 | 1.4–1.8 M |
| Linwood (suburban street) | 124–126 | 790–980 | 1.2–1.6 M |
| Moorhouse Avenue at night in southerly rain, in a car | 112–120 | 1,300 | 3.2 M |
| Hagley Park and the Avon | 104–106 | 1,080–1,580 | 2.5–3.7 M |
| Cathedral Square | 95–97 | 1,120–1,300 | 2.6–3.0 M |
| State Highway 1 at about 100 km/h, 22 s of driving | 158 average; 99th-percentile frame 13 ms, worst 19 ms | | |

Cathedral Square at the other quality settings: Low 227, Medium 129, Ultra 60 with the render resolution scaled down to 70 %. These are development-server numbers from the finished build (`zsh scripts/playtest/measure.sh`); the production build measures the same within the 10 % spread between runs. Nothing has been measured on an integrated GPU, which is what the budget in section 5 was written for; Medium is the setting to try there, and dynamic resolution will take up some of the slack.

**Police.** A pursuit that depends only on officers' line of sight is trivially outrun in a town of straight avenues, so two things were added. Patrol cars that already have a fleeing car in view can hold it from 260 m, not 120 m. And at two lights and above, the public phone it in: a car matching the description near bystanders, or anything doing over 72 km/h through a built-up area, gives the pursuit a fresh (slightly wrong) position every few seconds and stops the trail going cold. Out on the plains it takes another road user to see you, so the open highway is where a fast car gets away; in town the way out is to slow down in a car they have not seen, or a respray.

**Things you can hit.** Street furniture, lamp posts, fences and signs are instanced props with a physics overlay (`src/world/props/physics.ts`): each kind is solid to everything, solid to vehicles only (wire fences, so people and bullets pass), or nothing; and each can have a break speed. A vehicle about to hit a breakable prop at or above that speed has the prop swapped for a tumbling piece of debris a moment before contact and pays for it in speed (`src/world/breakables.ts`). Below the break speed a lamp post is as solid as a wall. Parked scenery cars and hedges became solid at the same time.

**Coast.** The open coast now has a cross-section (bank, 25 m of dry sand, swash, shallow shelf) instead of a plateau that dropped into deep water, so New Brighton and Caroline Bay have beaches you can walk and drive on. Harbours keep the old quay profile.

**The tram.** One heritage tram works the 1.6 km city loop from the map data: it cruises at 23 km/h, crawls round corners, stops every 240 m, rings its gong, and waits for anything on the track rather than pushing through (`src/rail/tram.ts`). It registers itself as a road obstacle (`src/ai/obstacles.ts`), so traffic autopilots treat it as a long slow vehicle and queue behind it. Trains on the Main South Line were left static: level crossings would need traffic that understands them.

**People in cars.** Once the vehicles had clear glass, empty-looking traffic was obvious. A full figure is about 17,000 triangles, so traffic and police drivers are a 130-triangle seated stand-in in one draw call that casts no shadow (`src/vehicles/occupant.ts`); the player, and anyone else who has a real figure, is shown as themselves.

**Bridges.** Guard rails used to run the full length of a bridge, straight across any side street that met it, and traffic drove into them. Rails are now clipped where another road crosses or joins (`src/world/roadmesh.ts`, tested against every bridge in the map).

**Familiar faces.** The owner also asked for versions of real people. They went in as cameos: look-alike parodies under invented names, with house rules written at the top of the cast file (`src/missions/defs/cameos.ts`): no real names, nobody shown as a criminal or run down, original lines only, and nobody can be hurt. A cameo is an ordinary scripted pedestrian marked invulnerable, so damage, blood, death and police reports all stop at one flag in `src/ai/ped.ts`; struck by a car they are bundled aside rather than knocked down. `src/missions/cameos.ts` puts each one at their spot when the player is within 110 m, takes them away beyond 150 m, keeps them out of the way while mission hostiles are near, and has them speak only when no mission conversation is on screen. Story lines reach the cast through helpers in `cast.ts`, so deleting a cameo from the file removes their lines from the missions too.

**Live radio.** The original rule was that nothing in the game is real except place names, and the radio was six invented stations whose music is generated as it plays. The owner asked for real stations as well, so the dial now starts with ten of them (`src/audio/radio/live.ts`), each played from the station's own public stream by one `<audio>` element. The streams send permissive cross-origin headers, so the element is wired into the WebAudio mixer like everything else: the car-speaker filter, the music volume setting and the pause ducking all apply, and the level is trimmed to sit with the generated stations. Nothing is shipped or relayed. A stream that never starts is retried once and then reported as "no signal"; a setting takes the live stations off the dial altogether.

**Damage to the player.** Other people's bullets do 55 % and their bats 75 % of what the player's own do. Without a cover system a four-against-one shoot-out was otherwise a coin toss even with perfect aim.

**Testing by playing.** `scripts/shot.mjs` drives the running game in the Chrome already on the machine, headless, for screenshots, frame-rate measurements and scripted play (`scripts/playtest/`): all six missions back to back, a three-star pursuit, a gunfight fought without cheats, taking and hijacking cars, losing a two-light pursuit, a traffic-crash watch, and save and continue. That is how the soft lock where a mission vehicle could never spawn because the player had parked on its spot was found, and it is the quickest way to check a change did not break a mission.

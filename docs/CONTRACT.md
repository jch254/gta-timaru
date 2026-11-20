# Module contract

Read this with `docs/DESIGN.md`, `docs/RESEARCH.md` and **`src/core/types.ts`** (the single source of truth for every interface). The vertical slice already runs: world streaming, rendering, physics, the player on foot, one drivable car.

## Ground rules

1. **Own only your files.** The table below says who owns what. Never edit a file you do not own, including `src/core/types.ts`, `src/game/game.ts`, anything in `src/render/`, `src/physics/`, `src/core/`. If the contract is missing something you need, work around it inside your module and say so in your final report.
2. **Talk only through the contract.** Import types from `src/core/types.ts`. Use `ctx` (the `GameContext`) and `ctx.events` to reach other systems. Do not import another module's internals. Allowed shared helpers: `src/core/math.ts`, `src/core/rng.ts`, `src/core/vec3.ts`, `src/core/lanes.ts`, `src/core/async.ts`, `src/actors/humanoid.ts` (`createHumanoid`), `src/world/props/index.ts` (`registerProp`, `mergeGeometries`, `appendVertices`, `canopy`), `src/render/textures.ts` (`canvasTexture`, `dataTexture`), `src/render/materials.ts` (`batchHint`, `setBatchHint`, `patchable` — world modules lean on these for draw-call batching and shader patches).
3. **Keep your module's entry point signature.** Each stub `index.ts` exports a factory (e.g. `createPolice(ctx): PoliceApi & System`). `src/game/game.ts` already calls it. Replace the stub's body, keep the export.
4. **Materials only from `ctx.gfx.materials`** (or the `materials` passed to you). Never call `new THREE.MeshStandardMaterial` for world geometry and never use `onBeforeCompile`; if you truly need a custom material, pass it through `materials.register()`. For dynamic objects (vehicles, effects) `register()` is fine. `MeshBasicMaterial` / `SpriteMaterial` / `PointsMaterial` / `LineBasicMaterial` for effects need no registration.
5. **No assets, no network.** Everything is generated in code. No image, model, font or audio files; no fetches. Audio is synthesised with WebAudio.
6. **Original content only.** Real place, street and public landmark names are fine. Every business, brand, radio station, gang, vehicle make/model and character must be invented, and no real people. Do not imitate the name, HUD, fonts, mission structure or characters of any existing game. Affectionate Kiwi tone, Canterbury flavour, no caricature.
7. **Performance.** No per-frame allocations in hot loops where avoidable; no per-frame `scene.traverse`. Static world content goes through `ChunkBuilder` (merged per material). Budgets: ≤ 24 active vehicles, ≤ 30 pedestrians, physics ≤ 2 ms.
8. **Verify before reporting.** Run `pnpm exec tsc --noEmit` from the project root and fix every error in files you own (errors in other owners' files may appear while they are mid-work: ignore those and mention them). Pure-logic unit tests with vitest are welcome next to your code (`*.test.ts`); run them with `pnpm exec vitest run <path>`. Do **not** start the dev server or use a browser: the lead does all in-browser verification. Do not commit, do not run `git`.
9. **Final report** (short): what you built, the files, anything you could not verify, any contract gaps or assumptions, and anything another module must do for yours to work.

## Conventions

- Metres, seconds, radians. **+x east, −z north, +y up.**
- Heading `h`: forward = `(sin h, 0, cos h)`; `h = 0` faces +z (south); increasing `h` turns left (towards +x). An object modelled facing local +z shows heading `h` with `rotation.y = h`. Left of a direction `(tx, tz)` is `(tz, −tx)`.
- **Left-hand traffic, right-hand drive.** Vehicles keep left; the driver sits on the vehicle's right (local −x).
- Update order each frame: `fixedUpdate` (60 Hz, before the physics step) → `update` → `lateUpdate`. While `ctx.clock.paused` only `lateUpdate` runs.
- `ctx.player.position` is always the world position (it follows the vehicle while driving). `ctx.player.vehicle` is the car being driven or `null`.
- Clock: `ctx.clock.hour` 0–24; night when `ctx.env.night > 0.5`. A game day lasts 24 real minutes.

## Ownership

| Owner | Files | Entry point |
|---|---|---|
| Lead | `src/core/**`, `src/game/**`, `src/render/**`, `src/physics/**`, `src/player/**`, `src/actors/**`, `src/main.ts`, `index.html`, `src/style.css`, `src/world/*.ts`, `src/world/props/index.ts`, `src/vehicles/vehicle.ts`, `src/vehicles/index.ts`, `docs/**` | — |
| Map | `src/world/mapdata/**` | `buildMap(): MapSource` in `mapdata/index.ts` |
| Buildings | `src/world/buildings/**`, `src/world/props/extra.ts` | `LOT_BUILDERS`, `buildLot` in `buildings/index.ts` |
| Christchurch landmarks | `src/world/landmarks/christchurch/**`, `src/world/scatter/urban.ts` | registers into `LANDMARKS` |
| Timaru + rural landmarks | `src/world/landmarks/timaru/**`, `src/world/landmarks/rural/**`, `src/world/scatter/rural.ts` | registers into `LANDMARKS` |
| Vehicles | `src/vehicles/specs.ts`, `src/vehicles/models/**` | `VEHICLE_SPECS`, `VEHICLE_MODELS` |
| Pedestrians + traffic | `src/ai/**` | `createPeds`, `createTraffic` |
| Combat + effects | `src/combat/**`, `src/fx/**` | `createCombat` |
| Police | `src/police/**` | `createPolice` |
| Missions | `src/missions/**` | `createMissions` |
| UI | `src/ui/**` | `createUi` |
| Audio | `src/audio/**` | `createAudio` |

Registries: `src/world/landmarks/registry.ts` exports `LANDMARKS` and `src/world/scatter/registry.ts` exports `SCATTERERS`. The lead-owned `index.ts` beside each already imports `./christchurch`, `./timaru`, `./rural` (landmarks) and `./urban`, `./rural` (scatter), so your folder's `index.ts` / your scatter file only has to register: `LANDMARKS['chch-cathedral'] = …`, `SCATTERERS.push(…)`. Import the registry from `registry.ts`, never from `index.ts` (that would be a circular import).

## Shared identifiers (fixed; everyone uses exactly these)

### Vehicle spec ids (`VehicleSpec.id`)

Forty-two ids: thirty since the Canterbury-1995 roster pass, and twelve quick cars and old classics added
after it. The original eleven keep their ids (missions, saves, dev
tools and playtests use them); each now stands for one specific real vehicle, recorded with years and source
in a comment on its spec and in docs/RESEARCH.md. Names in the game stay invented.

| id | class | stands for (real vehicle, never named in game) |
|---|---|---|
| `statesman` | sedan | Holden Commodore VN six, 1988 to 1991 |
| `v8sedan` | sedan | Ford Falcon XD/XE 5.0 V8, 1979 to 1984, the boy racer's and the gang's car |
| `coupe` | coupe | Nissan Skyline R32 GTS-t, 1989 to 1993, used import |
| `hatch` | hatch | Ford Laser KA/KB, 1981 to 1985 |
| `wagon` | wagon | Ford Falcon XF wagon, 1984 to 1988 |
| `ute` | ute | Toyota Hilux fourth generation, 1983 to 1988 |
| `farmtruck` | truck | Bedford TK with a timber stock crate, 1960s to 1970s |
| `van` | van | Toyota Hiace H50, 1982 to 1989 |
| `bike` | bike | Suzuki GSX-R750 class sports bike, 1985 on |
| `police` | police | Holden Commodore VR patrol car, 1993 to 1995, white with the blue chequer band |
| `bus` | bus | MAN SL202, 1986 to 1990, red with a white band |
| `trafficcar` | police | Mitsubishi V3000 ex-traffic car, 1988 to 1992, black and white, Police door graphics |
| `taxi` | sedan | Ford Falcon XF as a cab, white, door decal and roof sign |
| `kingswood` | sedan | Holden HQ to HZ Kingswood, 1971 to 1980 |
| `valiant` | sedan | Chrysler Valiant, early to mid 1970s |
| `cortina` | sedan | Ford Cortina Mk IV/V, 1976 to 1983 |
| `mini` | hatch | Mini, 1960s to 1970s |
| `triumph` | sedan | Triumph 2500, Nelson-assembled, to 1979 |
| `corolla` | hatch | Toyota Corolla AE80/AE82, 1983 to 1987 |
| `corona` | sedan | Toyota Corona T140, 1982 to 1987 |
| `sigma` | sedan | Mitsubishi Sigma (NZ Galant), 1980 to 1987 |
| `accord` | sedan | Honda Accord third generation, 1985 to 1989, Nelson-assembled |
| `datsun` | sedan | Datsun 120Y, 1973 to 1978 |
| `leone` | wagon | Subaru Leone 4WD wagon, 1979 to 1984 |
| `hothatch` | hatch | Mazda Familia BF turbo 4WD, 1985 to 1989, used import |
| `import` | sedan | Toyota Cresta/Mark II GX71, 1984 to 1988, used import with guard mirrors |
| `lada` | sedan | Lada Riva, 1980s, Dairy Board trade |
| `landrover` | ute | Land Rover Series III, 1971 to 1985 |
| `stocktruck` | truck | Hino-class cab-over with multi-deck stock crate, late 1980s |
| `farmbike` | bike | Honda XR200 class farm bike |
| `commodore` | sedan | Holden Commodore VR SS 5.0 V8, 1993 to 1995: body kit, boot spoiler, alloys |
| `falcon` | sedan | Ford Falcon EF XR8 5.0 V8, 1994 to 1996: four round lamps, no grille, red bumper strips |
| `gtr` | coupe | Nissan Skyline R32 GT-R, 1989 to 1994, sold new here in 1991 |
| `rx7` | coupe | Mazda RX-7 FC turbo, 1985 to 1991, used import |
| `ae86` | coupe | Toyota Sprinter Trueno / Corolla Levin AE86 twin cam, 1983 to 1987, used import |
| `crx` | coupe | Honda CR-X second generation, 1987 to 1991, used import |
| `legacy` | sedan | Subaru Legacy RS turbo 4WD, 1989 to 1994 |
| `m325` | sedan | BMW E30 M325i, the New Zealand-only model, 1986 to 1990 |
| `escort` | sedan | Ford Escort Mk II 1600 Sport, 1975 to 1980, Seaview-assembled |
| `monaro` | coupe | Holden HQ Monaro GTS, 1971 to 1974 |
| `charger` | coupe | Chrysler Valiant Charger 770, 1971 to 1973, Petone-assembled |
| `morrie` | sedan | Morris Minor 1000, assembled here to 1974 |

`VEHICLE_SPECS` is composed from five files so lanes do not collide: `specs.ts` (Australian and British cars
and the patrol cars), `specs-cars.ts` (the other cars), `specs-sports.ts` (the quick imports),
`specs-classics.ts` (the old classics and the European), `specs-working.ts` (utes, vans, trucks, bus, bikes).
`VEHICLE_MODELS` likewise from `models/cars.ts`, `models/compact.ts`, `models/sports.ts`,
`models/classics.ts`, `models/working.ts`.
`VehicleSpec.spawnBy` multiplies `spawn` per town (`CityId` or `'country'`), so Timaru's mix differs from
Christchurch's. Engine sounds: `four | six | v6 | v8 | boxer | turbo | diesel | bike | single | electric`.

### Weapon ids (`WeaponSpec.id`)

`fists`, `knife` (boning knife, melee), `bat` (cricket bat, melee), `katana` (melee, never sold: found only), `pistol`, `shotgun`, `rifle`.
The knife and the katana are blades (`WeaponSpec.blade`): they cut rather than club, so more blood, less
knock-back and no dent in a car.

Thirty weapons are hidden round the back of buildings (`src/missions/stashes.ts`): pickups spawned with
`options.stash`, which lie on the ground with a faint glint instead of floating in a halo, are drawn only
from close by and have no blip. Guns come back fifteen minutes after being taken; the two katanas are found once.

### Scenery cars

The prop kinds `car-parked`, `car-parked-wagon` and `van-parked` (car parks, car yards, marked bays) are
stand-ins: within about 40 m of the player each becomes a real vehicle of a fitting class, the same one
every time, and goes back to scenery when left untouched (`src/world/standins.ts`). Do not lay a separate
collider over them.

### Place ids (map places them; missions, police, UI rely on them)

Tags in brackets. Every place must sit on dry land within a few metres of a drivable road unless noted. The `yard` tag keeps generated building plots out of the ground around the point: fights and vehicle deliveries happen there, and a lot built over the spot walls the player off from mission peds and parks deliveries a building short of the mark.

| id | where | tags |
|---|---|---|
| `timaru-spawn` | the Bay Hill, Timaru, outside the chip shop | `spawn` |
| `timaru-chipshop` | Aunty Rena's chip shop, the Bay Hill | `safehouse`, `mission` |
| `smithfield-carpark` | freezing works car park, Smithfield | `mission` |
| `timaru-port-lockup` | lock-up shed at the port, Timaru | `mission` |
| `timaru-hospital` | Timaru Hospital | `hospital` |
| `timaru-police` | Timaru police station | `police` |
| `timaru-gunshop` | sports / gun shop, Stafford St | `gunshop` |
| `timaru-panelbeater` | panel & paint shop, Timaru | `spray` |
| `caroline-bay` | Caroline Bay sound shell | `mission` |
| `washdyke-saleyards` | Washdyke saleyards | `mission` |
| `temuka-pub` | country pub on King St, Temuka | `mission` |
| `rangitata-layby` | lay-by north of the Rangitata bridges on SH1 | `mission` |
| `hinds-woolshed` | woolshed on a gravel road between the Rangitata and Ashburton | `mission` |
| `ashburton-stock-agent` | stock agent's office, East St, Ashburton | `mission`, `yard` |
| `ashburton-police` | Ashburton police station | `police` |
| `ashburton-panelbeater` | panel & paint shop, Ashburton | `spray` |
| `rakaia-salmon` | by the big salmon, Rakaia township | `mission` |
| `chch-garage` | Dazza's workshop, Sydenham (Moorhouse Ave strip) | `safehouse`, `mission`, `yard` |
| `four-aves-start` | corner of Moorhouse Ave and Deans Ave | `mission` |
| `cathedral-square` | Cathedral Square | `mission` |
| `arts-centre` | the Arts Centre, Worcester Blvd | `mission` |
| `antigua-boatsheds` | Antigua Boat Sheds on the Avon | `mission` |
| `chch-hospital` | Christchurch Hospital (Riccarton Ave) | `hospital` |
| `chch-police` | central police station (Hereford St) | `police` |
| `chch-gunshop` | sports / gun shop, central city | `gunshop` |
| `chch-panelbeater` | panel & paint shop, Sydenham | `spray` |
| `lancaster-park` | Lancaster Park gates | `mission` |
| `new-brighton-beach` | New Brighton, end of Seaview Rd | `mission` |
| `sign-of-the-kiwi` | Sign of the Kiwi, top of Dyers Pass Rd | `mission` |
| `lyttelton-wharf` | Lyttelton port, on the wharf | `mission` |

### Landmark kinds (`LandmarkPlacement.kind`; map places them, landmark owners build them)

Christchurch owner: `chch-cathedral` (skyline), `cathedral-square`, `arts-centre`, `canterbury-museum`, `bridge-of-remembrance`, `town-hall`, `victoria-square`, `old-railway-station` (Moorhouse Ave clock tower), `addington-station`, `lancaster-park`, `antigua-boatsheds`, `tram-stop` (with a parked heritage tram), `chch-hospital`, `chch-police`, `new-brighton-mall`, `sign-of-the-takahe`, `sign-of-the-kiwi`, `sugarloaf-tower` (skyline), `gondola-base`, `gondola-summit` (skyline), `tunnel-portal`, `lyttelton-port` (skyline), `timeball-station`.

Timaru + rural owner: `timaru-basilica` (skyline), `caroline-bay-soundshell`, `caroline-bay-carnival`, `caroline-bay-tearooms`, `timaru-port` (skyline: silos, cranes, fishing boats), `timaru-lighthouse`, `landing-service-building`, `timaru-station`, `timaru-hospital`, `timaru-police`, `smithfield-works` (skyline: freezing works and chimney), `washdyke-saleyards`, `phar-lap-raceway`, `ashburton-clock-tower`, `rakaia-salmon`, `woolshed`, `grain-silo`, `service-station`, `country-pub`, `country-church`, `war-memorial`, `school` (with rugby posts on the field), `rugby-field`, `rail-station-small`.

Clear radius per kind (metres). The map owner uses exactly these for `clearRadius`; landmark owners keep everything inside it:

`chch-cathedral` 40 · `cathedral-square` 75 · `arts-centre` 70 · `canterbury-museum` 40 · `bridge-of-remembrance` 22 · `town-hall` 55 · `victoria-square` 60 · `old-railway-station` 50 · `addington-station` 40 · `lancaster-park` 110 · `antigua-boatsheds` 30 · `tram-stop` 14 · `chch-hospital` 70 · `chch-police` 40 · `new-brighton-mall` 60 · `sign-of-the-takahe` 30 · `sign-of-the-kiwi` 25 · `sugarloaf-tower` 20 · `gondola-base` 30 · `gondola-summit` 30 · `tunnel-portal` 25 · `lyttelton-port` 120 · `timeball-station` 22

`timaru-basilica` 45 · `caroline-bay-soundshell` 40 · `caroline-bay-carnival` 70 · `caroline-bay-tearooms` 25 · `timaru-port` 130 · `timaru-lighthouse` 14 · `landing-service-building` 30 · `timaru-station` 40 · `timaru-hospital` 60 · `timaru-police` 35 · `smithfield-works` 110 · `washdyke-saleyards` 70 · `phar-lap-raceway` 150 · `ashburton-clock-tower` 14 · `rakaia-salmon` 14 · `woolshed` 30 · `grain-silo` 25 · `service-station` 30 · `country-pub` 25 · `country-church` 25 · `war-memorial` 12 · `school` 80 · `rugby-field` 70 · `rail-station-small` 30

The cathedral stands inside Cathedral Square, so those two placements overlap by design (`cathedral-square` is paving and street furniture only; leave the cathedral's footprint clear).

A placement's local frame: origin at `(x, groundHeight, z)`, front faces `heading`. `clearRadius` keeps generated buildings out, so size your landmark to fit inside it (map owner: give big landmarks 40–90 m). Unknown kinds are ignored, so a missing builder never breaks the game.

### Prop kinds available to everyone (`ChunkBuilder.instance(kind, …)`)

Core (exist now): `tree-oak`, `tree-willow`, `tree-cabbage`, `tree-pine`, `tree-poplar`, `bush`, `flax`, `lamp`.

Buildings owner adds in `props/extra.ts`: `phone-box`, `bus-shelter`, `bin`, `bench`, `postbox`, `power-pole`, `road-sign`, `rugby-posts`, `fence-post`, `hedge`, `tree-norfolk-pine`, `tree-phoenix-palm`. Other owners should only rely on the core kinds, or register their own kinds from their own files.

## Events you will want

Defined in `GameEvents` (`src/core/types.ts`). Who emits what:

- Player: `crime` (`carTheft`, `carjacking`), `playerDied`, `playerRespawned`, `zoneChanged`, `moneyChanged`, `actorDamaged`/`actorDied` for itself.
- Vehicles: `vehicleEntered`, `vehicleExited`, `vehicleCrash`, `vehicleDamaged`, `vehicleDestroyed`, `horn`.
- Combat: `gunshot`, `impact`, `weaponChanged`, `pickup`, and `crime` (`gunfire`, `assault`, `murder`, `copAssault`, `copKilled`, `vehicleDamage`) when the offender is the player. A death is `murder` (`copKilled` for an officer) whatever the player did it with: a gun, a swing, a blast, or a car (combat hears the `actorDied` from whichever system dealt the blow).
- Pedestrians / traffic: `actorDamaged`, `actorDied` for their actors; `crime` `hitAndRun` when the player's vehicle hits a pedestrian (or runs over one lying in the road); `vehicleHitActor` whenever a vehicle strikes a pedestrian, or rolls over one who is down, alive or dead (`under`). Effects (blood) and audio (the crunch) listen for it.
- Police: `wantedChanged`, `playerBusted`, and `crime` (`recklessDriving`) when the player speeds in sight of a patrol; `vehicleHitActor` when a car strikes an officer.
- Missions: `missionStarted`, `missionCompleted`, `missionFailed`.
- Lead (game loop / atmosphere): `hourChanged`, `weatherChanged`, `qualityChanged`, `pausedChanged` (UI emits this too when it pauses).

Glossary: the **wanted level** is the whole number of lights (0–5); **heat** is the police module's fraction of progress towards the next light. `wantedChanged` fires on whole-level changes; `PoliceApi.heat` exposes the fraction.

`System.dispose` is honoured for sub-objects a system creates and tears down during play (chunk unloads, mission entities, vehicle paint); the game itself starts once per page and has no teardown path, so nothing calls the systems' own `dispose` methods today.

## How the pieces meet

- **Damage**: anything that can be hurt is an `Actor` with `takeDamage(info)`. Vehicles have `applyDamage`. Combat resolves hits with `ctx.physics.raycast`, whose `owner` is the `Actor` or `Vehicle` registered for the collider (`ctx.physics.setOwner`). Whoever creates an actor's collider registers its owner and adds the actor to `ctx.actors.all` (and removes it on despawn).
- **Vehicles**: `ctx.vehicles.spawn(specId, x, z, heading, { controller, tags })`. Set `vehicle.controller` to claim it (`'traffic'`, `'police'`, `'mission'`); only the claimant writes `vehicle.controls`. `ctx.vehicles.enter(actor, vehicle, seat)` / `exit(actor)` handle seating and emit events; the actor's own system positions and poses its humanoid (`vehicle.seatPosition`, `vehicle.doorPosition`). When the player hijacks an occupied car the previous driver arrives in `vehicleEntered.ejected`; its owner system must put it back on the street.
- **Autopilot**: the traffic module implements `Autopilot` and exposes it via `ctx.traffic.createAutopilot(vehicle)`; police and missions use it for pursuit, roadblocks, races and convoys.
- **Wanted level**: police listens to `crime` and decides. Others read `ctx.police.level` (0–5). Respray places (tag `spray`) and staying unseen are how heat is lost; the police module owns both.
- **Money**: `ctx.player.addMoney(delta)`. **Save**: register a slice with `ctx.save.register(key, serialize, deserialize)` in your constructor; UI and missions call `ctx.save.save()`.
- **Prompts and messages**: `ctx.ui.prompt()` must be called every frame it applies. Use `ctx.ui.subtitle()` for speech, `ctx.ui.banner()` for big moments, `ctx.ui.objective()` / `ctx.ui.timer()` / `ctx.ui.setBlip()` for missions.
- **Audio**: `ctx.audio.play(id, { at })`. The audio module also reacts to events itself (gunshots, crashes, horns, engine of the player's vehicle), so callers only trigger sounds no event describes.
- **Spawning near the player**: only where `ctx.world.isLoaded(x, z)` is true. Use `ctx.world.groundAt(x, z)` for the height to stand or drive on (includes bridge decks).

## Addendum: decisions from the project owner (made after the build started)

These override anything above where they differ.

1. **Target hardware is Apple-silicon Macs.** Default quality is High. Budgets relax a little (≤ 28 active vehicles, ≤ 36 pedestrians), but keep everything streamable.
2. **Maximum realism, sourced assets allowed.** CC0 photographic PBR textures replace the procedural ones when present (`src/assets/textures/manifest.json`; loaded by `src/render/phototextures.ts`, transparent to everyone: keep using `materials.get(surface, { color })`). CC0 rigged, animated character models replace the code-built figure when present (`createHumanoid` picks automatically; the `Humanoid` interface is unchanged). Every third-party file is recorded in `ASSETS.md` with source URL and licence. Rule 5 ("no assets, no network") now applies at *runtime* only: nothing is fetched from the internet by the game; all assets ship in the bundle.
3. **Grittier violence.** Blood is in: impact sprays on hits, blood decals / pools under bodies that linger, visible wounds on damaged pedestrians are optional. No dismemberment, no torture, nothing sexual. Owner: combat + effects.
4. **Te ao Māori** is part of the game, done with care:
   - `District.teReo` / `Place.teReo` (optional) and `src/core/names.ts` (`CITY_TE_REO`, `FEATURE_TE_REO`, `CITY_NAMES`) carry te reo Māori names. The UI shows them alongside the English names (HUD location line, map labels). In-world 1995 road signs stay English-only (official dual names came in 1998). Use macrons correctly; only use names you are sure of.
   - New landmark kind **`marae`** (clear radius 50; owner: Timaru + rural landmarks): a generic marae complex: wharenui (meeting house) with a carved-style gable (maihi, amo, tekoteko suggested with simple original geometry and red-ochre paint, not copied from any real wharenui), wharekai (dining hall), marae ātea (open lawn), waharoa (gateway), flagpole. The map places three: Arowhenua marae just south of Temuka, Rehua Marae in St Albans (Christchurch) and Ngā Hau e Whā on Pages Rd, Aranui (Christchurch). Marae are places of respect: no missions, combat set-pieces, pickups, police roadblocks or hostile spawns inside a marae's clear radius.
   - Māori characters are part of the cast and the street population, and te reo Māori appears in everyday speech the way it did in 1995 Canterbury (kia ora, whānau, kai, ka pai, e hoa, aroha, mahi, tamariki…). Written with respect: no caricature, no mock accents, no stereotyped roles. Aunty Rena is Ngāi Tahu with whānau at Arowhenua.
5. **Priorities for polish:** driving feel, then chases and combat.

### Additional ownership

| Owner | Files |
|---|---|
| Textures | `scripts/assets/**`, `src/assets/textures/**`, the textures section of `ASSETS.md` |
| Characters | `src/actors/gltf/**`, `src/assets/models/characters/**`, `dev/**`, the characters section of `ASSETS.md` |

---

# Round 2: realism pass

The game is playable end to end. This round is about how it looks and feels. The target the owner set is **"the most realistic, polished look a browser can sustain"**: photographic materials, believable silhouettes, dense and lived-in streets. At the start of this round the world still read as low-poly and sparse (see `shots/s*.png` for the "before").

Everything in round 1 still applies except rules 5 and 8, which are replaced by:

**5. Assets.** CC0 (or equally permissive) third-party assets are allowed: Poly Haven, ambientCG, Kenney, Quaternius. Fetch them with a script under `scripts/assets/` (see `fetch-textures.mjs`), keep raw downloads in `assets-staging/` (git-ignored), ship optimised files under `src/assets/**`, and record every one in `ASSETS.md` (name, source URL, author, licence) in a section of your own. Keep what you add small: this round's total budget for new shipped assets is 12 MB across everyone, so ask yourself whether a 1K texture will do (it usually will). No real brand names or logos anywhere.

**8. Verify by looking.** The dev server is already running at `http://localhost:5195/` (do not start another, do not stop it). Take your own screenshots with the headless tool and look at them:

```
node scripts/shot.mjs --place cathedral-square --time 15 --look 3.4,0.12,1 --out shots/<you>-<name>.png
node scripts/shot.mjs --at 1150,-4200 --heading 1.2 --car v8sedan --time 17.5 --weather norwester --fps 5
```

Read the header of `scripts/shot.mjs` for every option (`--eval` runs JavaScript with the `dev` console helpers from `src/game/dev.ts`). It prints draw calls, triangles, frame rate and any console error or failed request; a non-zero exit means the page logged an error. Write shots to `shots/` with your own prefix. **Do not use the Browser pane / preview tools**: the owner is watching the game there. Other agents are editing at the same time, so if the game fails to load because of someone else's half-finished change, wait a minute and try again. Before each shot make sure `pnpm exec tsc --noEmit` is clean for your files, and keep `pnpm exec vitest run <your folder>` green (update tests that encode budgets you were told to change). Never commit; never run `git`.

**Performance is part of the job.** The game must hold 60 fps at 1080p on an Apple-silicon laptop at High quality. Central Christchurch was already at ~2,200 draw calls and ~4.1 M triangles (shadow passes included) before this round, which is over budget. Whatever you add has to pay for itself: merge geometry, instance, share materials, use alpha test instead of blending, give distant things less. Report `--fps` numbers before and after from the same spot.

## Round 2 ownership

| Owner | Files | Brief |
|---|---|---|
| Lead | everything not listed, including `src/world/world.ts`, `src/render/**`, `scripts/shot.mjs` | lighting, sky, post, performance, gameplay |
| Vegetation | tree / bush / flax definitions in `src/world/props/index.ts` and `src/world/props/extra.ts` (tree and hedge kinds only), new `src/world/props/vegetation.ts`, `scripts/assets/**` and `src/assets/**` for foliage | trees and plants that look real |
| Buildings | `src/world/buildings/**`, the non-plant kinds in `src/world/props/extra.ts`, `windows()` in `src/render/materials.ts` | facades, glass, roofs, shopfronts |
| Vehicles | `src/vehicles/models/**`, names/colours in `src/vehicles/specs.ts` | car bodies, glass, wheels, lights |
| Ground + water | ground colouring and materials in `src/world/world.ts` (`colorAt`, ground / far-terrain / sea materials) and `src/world/roadmesh.ts` (rivers, road surface, markings), `src/render/textures.ts` | terrain, riverbeds, beaches, sea, road surfaces |
| Dressing | `src/world/scatter/**`, `src/world/landmarks/**` | street life, squares, parks, the Bay, set dressing |

`src/world/world.ts` has two editors this round (Lead: prop instancing, colliders, streaming; Ground + water: colours and ground materials). Make small targeted edits there, re-read before each edit, and never rewrite the file wholesale.

# Round 3: art pass

The game is finished, deployed and playable (six missions, live radio, cameos). This round is about how it looks and how fast it runs. Everything in rounds 1 and 2 still applies, including: never run git, never commit, never deploy, CC0 assets only (tell the lead so `ASSETS.md` gets a row), and verify by looking.

## The look

**Canterbury in 1995, as if shot on 35 mm film.** Realism, not stylisation.

- Hard summer light and long shadows; warm dust haze over the plains under a nor'wester; cold blue-grey under a southerly; white glare off wet roads.
- Nothing is new. A provincial town in 1995: sun-bleached paint, patched and re-patched tarmac, rust runs on corrugated iron, weeds along fence lines, hand-painted signs gone chalky. Dirt gathers where it would: under sills, at the foot of walls, in gutters, behind wheels.
- Variety. No two neighbouring buildings, cars or trees should read as the same object in a different colour.
- Night is sodium-orange pools with dark between them, warm windows, and reflections on wet seal.
- Detail goes where the player looks: at the car they are driving, the street they are standing in, the landmark they came to see. Far things stay cheap.

## Rules for this round

1. **Before and after.** `zsh scripts/gallery.sh shots/round3/<lane>` takes the same 24 views every time (`... <lane> square` takes only the views with "square" in the name). The untouched set is in `shots/round3/before/` and its numbers in `shots/round3-before.log`. Open your after-shots next to the before-shots with the Read tool and judge them honestly. Add your own close-ups with `node scripts/shot.mjs` (read its header).
2. **Cost.** The gallery prints draw calls and triangles for each view; those do not depend on how busy the machine is. No view may grow by more than 10 % in draw calls or 15 % in triangles over the before log unless your brief says otherwise, and anything you add has to pay for itself (merge, instance, share materials, alpha-test instead of blend, cheaper at distance, off at Low quality). **Do not measure or report frame rate**: several agents share one GPU and the numbers are meaningless. The lead measures at the end.
3. **Quality levels.** `src/render/quality.ts` has Low, Medium, High and Ultra. A new effect must be off or at its cheapest at Low, and must not change what Low looks like for the worse.
4. **Do not break the game.** `pnpm exec tsc --noEmit` clean and `pnpm test` passing (vite.config.ts already excludes the stray folder; CI runs plain `pnpm test` too). Do not touch missions, cameos, police, audio or saves. Update tests that encode something you were asked to change, never delete one to get past it.
5. **Stay in your lane.** Edit only the files in your row below. If you need something outside it, say so in your report rather than doing it. `src/core/types.ts` changes must be small and additive.
6. **Others are editing at the same time.** If a shot fails or looks broken because of someone else's half-finished change, wait a minute and retry. Never "fix" a file outside your lane.
7. **Do not use the Browser pane or preview tools, and do not start or stop servers.** The dev server is at `http://localhost:5195/`. `scripts/shot.mjs` keeps the live radio stations switched off; leave that alone.
8. **Report.** Write your full notes to `shots/round3/<lane>-report.md` (scratch, not committed). Hand back at most 250 words: what changed, which gallery views show it best, draw-call and triangle changes for the views you touched, test results, and what you did not finish or could not verify.

## Round 3 ownership

| Lane | Wave | Files | Brief |
|---|---|---|---|
| Light | 1 | `src/render/**` except `glazing.ts`, `textures.ts` and `windows()` in `materials.ts` | film grade, haze, sky and cloud shadows, night lighting, wet reflections, anti-aliasing |
| Buildings | 1 | `src/world/buildings/**`, `src/render/glazing.ts`, `windows()` in `src/render/materials.ts` | weathering, variety, backs and sides, roofs and rooftop clutter, shopfront depth, aged signs |
| Vehicles | 1 | `src/vehicles/models/**`, `src/vehicles/occupant.ts` | body shape, lamps, glass and interiors, wheels, dirt, the figure in the seat |
| Ground + water | 1 | `src/world/ground.ts`, `src/world/roadmesh.ts`, `src/world/height.ts`, `src/render/textures.ts` | road wear and markings, kerbs, cliffs, quays, rivers, sea |
| Plants | 1 | `src/world/props/vegetation.ts`, `src/world/props/foliage.ts`, the plant kinds in `src/world/props/index.ts` and `extra.ts`, `scripts/assets/foliage/**`, `src/assets/foliage/**` | species variety, distant versions, shrubs and hedges, grass |
| Landmarks + dressing | 2 | `src/world/landmarks/**`, `src/world/scatter/**`, the non-plant kinds in `src/world/props/**` | hero landmarks, the Square's edges, street furniture, yards |
| Characters | 2 | `src/actors/**`, `src/ai/looks.ts` | figures, clothing, distant versions, movement |
| Presentation | 2 | `index.html`, `src/style.css`, `src/ui/**`, `src/main.ts` | title screen, loading, HUD, map |
| Lead | | everything else, including `src/world/world.ts`, `src/game/**`, `scripts/**`, docs | integration, performance, measurement |

Materials: the shared library is `src/render/materials.ts` (Light's file). Other lanes get new looks through `registerPatched` or a shader patch kept in their own folder, as round 2 did, not by editing the library.

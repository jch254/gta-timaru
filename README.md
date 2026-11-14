# Timmaz Hard

An original third-person open-world crime sandbox for the browser, set in a compressed Canterbury, New Zealand, around 1995: pre-earthquake Christchurch and the port town of Timaru, joined by State Highway 1 across the plains.

Built with Vite, TypeScript, Three.js and Rapier. Client-only: no backend, no accounts, no analytics. Geometry, sound and music are generated in code; surface textures and the human figures are CC0 assets, every one of them listed with its source and licence in [ASSETS.md](ASSETS.md).

## Run

```bash
pnpm installfir
```

```bash
pnpm dev
```

Then open the URL Vite prints. `pnpm build` type-checks and writes a self-contained `dist/` with relative asset paths and hashed filenames, suitable for an S3 bucket behind CloudFront. `pnpm preview` serves that build locally. `pnpm test` runs the unit tests.

## Controls

| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| Move / steer | W A S D or arrow keys | Left stick |
| Look | Mouse | Right stick |
| Sprint | Shift | Click left stick |
| Jump / handbrake | Space | A |
| Enter or leave a vehicle, interact | F or Enter | Y |
| Aim | Right mouse button | LB |
| Fire | Left mouse button | RB |
| Reload / next radio station | R | X / D-pad left |
| Melee | Q | B |
| Next / previous weapon | E / Z or mouse wheel | D-pad right |
| Accelerate / brake and reverse | W / S | RT / LT |
| Horn | H | D-pad down |
| Look behind | C | Click right stick |
| Camera distance | V | D-pad up |
| Skip a line of talk | X or Backspace | |
| Map | M or Tab | Back |
| Pause | Esc or P | Start |

The mouse is captured when you start; if the browser refuses pointer lock (for example inside an embedded frame), hold any mouse button and drag to look.

## Playing

- **New game** starts you on the Bay Hill in Timaru. Yellow markers on the minimap are jobs: walk into one and press F. There are six, and they take you up State Highway 1 to Christchurch and back. Everything else is free roam.
- **Cars**: F beside any vehicle. Taking one with a driver in it is a crime if anybody sees it. Fast cars knock over lamp posts, fences and street furniture; trees, buildings and slow speeds do not forgive.
- **Police**: the lights at the top right are your heat, one to five. Crimes only count when somebody sees them. To lose the police, get out of their sight and stop drawing attention: slow down, swap to a car they have not seen you in, or pay a panelbeater (spray-can icon) for new paint and plates. Speeding through town in the car they are looking for keeps the calls coming in. From three lights they shoot and set roadblocks.
- **Dying or being arrested** costs a fee and puts you back at the nearest hospital or police station.
- **Saving**: Esc, then Save. It is written to this browser's local storage. Quality, sound and control settings are in the same menu.

## Project layout

```
docs/                design, research notes and the module contract
src/main.ts          title screen; lazy-loads the game on Start
src/core/            shared interfaces (types.ts), events, input, settings, save, maths
src/game/            game loop and system wiring
src/render/          renderer, post-processing, materials, procedural textures, sky and weather
src/physics/         Rapier wrapper
src/world/           map data, road graph, terrain, chunk streaming, roads, buildings, landmarks, props
src/actors/          skinned human figure and procedural animation
src/player/          on-foot controller, camera, entering and leaving vehicles
src/vehicles/        vehicle physics, roster (data) and procedural models
src/ai/              pedestrians, traffic, autopilot
src/combat/, src/fx/ weapons, damage, pickups, particles
src/police/          heat level, pursuit, roadblocks
src/missions/        mission runner, mission definitions, shops and safehouses
src/ui/              HUD, minimap, pause menu, map, settings, controls screen
src/rail/            the heritage tram that runs the city loop
src/audio/           synthesised sound effects, engines, ambience and radio stations
src/assets/          shipped third-party assets (CC0 textures and character models; see ASSETS.md)
scripts/assets/      scripts that fetch and optimise those assets (not needed to build or run)
scripts/shot.mjs     headless screenshots and frame-rate measurements of the running dev server
scripts/playtest/    scripted play sessions for shot.mjs (missions, a police chase, a gunfight)
```

`docs/DESIGN.md` explains the architecture, the performance budget and (section 8) what changed after the first build, with measured frame rates. `docs/CONTRACT.md` is the interface contract between modules. `docs/REPORT.md` is the plain account of what works, what is rough and what was cut, with screenshots.

## Development helpers

In `pnpm dev`, or on any build with `?dev` added to the URL, a `dev` object is available in the browser console: `dev.tp('cathedral-square')` teleports, `dev.time(22)` sets the hour, `dev.weather('southerly')`, `dev.car('v8sedan')`, `dev.heat(3)`, `dev.arm()`, `dev.stats()`. The full list is in `src/game/dev.ts`.

`node scripts/shot.mjs --place cathedral-square --time 15 --fps 5` takes a screenshot of the running dev server with the Chrome already installed on the machine and prints draw calls, triangles and frame rate; its header lists the options.

`scripts/playtest/` holds scripted play sessions for that tool: `missions.js` plays all six missions back to back, `chase.js` runs a three-star pursuit across Christchurch, `fight.js` plays a mission up to its first shoot-out and fights it without cheats, `carjack.js` walks, takes a parked car, drives it and pulls a driver out of another, `escape.js` loses a two-light pursuit by ditching the car, `soak.js` stands in town counting traffic crashes, `highway.js` records frame times along State Highway 1, and `continue.mjs` (run directly with node) saves, reloads and continues. `zsh scripts/playtest/measure.sh` reproduces the frame-rate table in the report. For example:

```bash
node scripts/shot.mjs --place timaru-spawn --hud --eval "$(cat scripts/playtest/missions.js)"
```

## Deploying

Upload the contents of `dist/` to the bucket. All asset URLs are relative, so it works from the bucket root or any prefix. Hashed files under `assets/` can be cached forever; serve `index.html` with a short cache lifetime.

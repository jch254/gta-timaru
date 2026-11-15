# Timmaz Hard

An original third-person open-world crime sandbox for the browser, set in a compressed Canterbury, New Zealand, around 1995: pre-earthquake Christchurch and the port town of Timaru, joined by State Highway 1 across the plains.

Built with Vite, TypeScript, Three.js and Rapier. Client-only: no backend, no accounts, no analytics. The one thing that reaches outside is the car radio, which can play real New Zealand stations live from their own streams ([Live radio](#live-radio)); switch that off and the game is entirely offline. Geometry, sound and the six invented stations' music are generated in code; surface textures and the human figures are CC0 assets, every one of them listed with its source and licence in [ASSETS.md](ASSETS.md).

## Run

```bash
pnpm install
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
| Previous radio station | T | |
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

### On a phone

The game runs in a phone browser, held sideways, with an on-screen controller that appears on touch devices and goes away again if a keyboard or gamepad is used.

- **Always, top left:** pause, MAP, VIEW (camera distance), and SKIP while someone is talking.
- **On foot:** a thumb-stick wherever your left thumb lands (push it to the rim to sprint); drag anywhere else to look. On the right: PUNCH or FIRE (hold to keep firing), JUMP, USE when there is something to use, and AIM, RELOAD and WEAPON once you are armed.
- **Driving:** the stick steers; GO and BRAKE pedals on the right, with HAND BRAKE, OUT, HORN, RADIO and BEHIND around them.
- Phones start at Low quality, which on a phone is its own lighter tier. Add the page to the home screen to run it full screen.

It has been tested in Chrome's phone emulation with real touch events (`node scripts/playtest/phone.mjs`), not yet in Safari on an iPhone.

## Playing

- **New game** starts you on the Bay Hill in Timaru. Yellow markers on the minimap are jobs: walk into one and press F. There are six, and they take you up State Highway 1 to Christchurch and back. Everything else is free roam.
- **Cars**: F beside any vehicle. Taking one with a driver in it is a crime if anybody sees it. Fast cars knock over lamp posts, fences and street furniture; trees, buildings and slow speeds do not forgive.
- **Police**: the lights at the top right are your heat, one to five. Crimes only count when somebody sees them. To lose the police, get out of their sight and stop drawing attention: slow down, swap to a car they have not seen you in, or pay a panelbeater (spray-can icon) for new paint and plates. Speeding through town in the car they are looking for keeps the calls coming in. From three lights they shoot and set roadblocks.
- **Dying or being arrested** costs a fee and puts you back at the nearest hospital or police station.
- **Familiar faces**: eleven people you may feel you have seen before stand about the two towns and the road between: on a ladder in Cathedral Square, at the gates of Lancaster Park, on the sand at New Brighton. Walk up and they talk. They are look-alike parodies under invented names, they keep daytime hours, and they cannot be hurt.
- **Radio**: R in a car moves along the dial and T moves back: ten live stations, then six invented ones, then off.
- **Saving**: Esc, then Save. It is written to this browser's local storage. Quality, sound and control settings are in the same menu.

## Live radio

In a car the dial starts with real stations, streamed live from each station's own server: The Rock, ZM, The Edge, Brian FM, More FM, The Breeze, The Hits, Radio Hauraki, The Sound and RNZ National. After those come the six invented, generated stations, which need no network.

- The game ships no audio from these stations and relays none: your browser connects straight to the station, which sends whatever is on air now, today's news and ads included. The station sees that connection like any other listener.
- **Settings → Live radio stations → Off** takes them off the dial and stops the game making any outside connection.
- The list is `LIVE_STATIONS` in `src/audio/radio/live.ts`: a name and a stream address each. A stream has to be HTTPS, a plain AAC or MP3 stream rather than an HLS playlist, and has to allow other sites to play it (an `Access-Control-Allow-Origin` header), because the sound goes through the game's mixer. If a stream stops answering, the HUD says "no signal" and the dial stays put.
- These are the stations' public stream addresses, used without any arrangement with the stations. Their names belong to their owners. If a station objects or changes its address, delete its line.

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
src/missions/        mission runner, mission definitions, shops and safehouses, and the cameo cast (defs/cameos.ts)
src/ui/              HUD, minimap, pause menu, map, settings, controls screen
src/rail/            the heritage tram that runs the city loop
src/audio/           synthesised sound effects, engines, ambience and radio stations
src/touch/           the on-screen controller for phones and what Mobile Safari needs
src/assets/          shipped third-party assets (CC0 textures and character models; see ASSETS.md)
scripts/assets/      scripts that fetch and optimise those assets (not needed to build or run)
scripts/shot.mjs     headless screenshots and frame-rate measurements of the running dev server
scripts/gallery.sh   the same 24 views every time, for before-and-after comparisons
scripts/playtest/    scripted play sessions for shot.mjs (missions, a police chase, a gunfight)
infrastructure/      Terraform for S3, CloudFront, certificate, DNS and the CodeBuild deploy project
buildspec.yml        what CodeBuild runs on a push to main: apply Terraform, build, upload, invalidate
```

`docs/DESIGN.md` explains the architecture, the performance budget and (section 8) what changed after the first build, with measured frame rates. `docs/CONTRACT.md` is the interface contract between modules. `docs/REPORT.md` is the plain account of what works, what is rough and what was cut, with screenshots.

## Development helpers

In `pnpm dev`, or on any build with `?dev` added to the URL, a `dev` object is available in the browser console: `dev.tp('cathedral-square')` teleports, `dev.time(22)` sets the hour, `dev.weather('southerly')`, `dev.car('v8sedan')`, `dev.heat(3)`, `dev.arm()`, `dev.stats()`. The full list is in `src/game/dev.ts`.

`node scripts/shot.mjs --place cathedral-square --time 15 --fps 5` takes a screenshot of the running dev server with the Chrome already installed on the machine and prints draw calls, triangles and frame rate; its header lists the options.

`scripts/playtest/` holds scripted play sessions for that tool: `missions.js` plays all six missions back to back, `chase.js` runs a three-star pursuit across Christchurch, `fight.js` plays a mission up to its first shoot-out and fights it without cheats, `carjack.js` walks, takes a parked car, drives it and pulls a driver out of another, `escape.js` loses a two-light pursuit by ditching the car, `radio.js` tunes through every station and reports which live streams connect, `soak.js` stands in town counting traffic crashes, `highway.js` records frame times along State Highway 1, and `continue.mjs` (run directly with node) saves, reloads and continues. `phone.mjs` (run directly with node) plays it as a phone would, with touch events. `zsh scripts/playtest/measure.sh` reproduces the frame-rate table in the report, and `zsh scripts/gallery.sh shots/now` takes the same 24 views every time for comparing looks. `shot.mjs` keeps the live radio stations off unless given `--live`, and `--mobile` makes it a phone. For example:

```bash
node scripts/shot.mjs --place timaru-spawn --hud --eval "$(cat scripts/playtest/missions.js)"
```

## Deploying

`infrastructure/` holds the Terraform for a private S3 bucket behind CloudFront, its certificate, the Cloudflare DNS record and a CodeBuild project; `buildspec.yml` is what that project runs on each push to `main`: apply the Terraform, `pnpm run build`, sync `dist/` to the bucket, invalidate CloudFront. [infrastructure/README.md](infrastructure/README.md) has the settings and the one-off first deploy.

To host it some other way, upload the contents of `dist/`. All asset URLs are relative, so it works from a bucket root or any prefix. Hashed files under `assets/` can be cached forever; serve `index.html` with a short cache lifetime.

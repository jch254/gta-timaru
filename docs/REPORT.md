# Timmaz Hard: where it stands

Canterbury, 1995. An original open-world crime sandbox for the browser: Vite, TypeScript, Three.js, Rapier. This is the plain account: what works, what is rough, what was cut, and what was measured.

`pnpm dev` runs it. `pnpm build` type-checks and writes a self-contained `dist/` (21 MB, 135 files, hashed names, relative paths). 1,232 unit tests pass.

It is live at <https://timmaz-hard.603.nz>: a private S3 bucket behind CloudFront, deployed from `main` by CodeBuild (`infrastructure/README.md`).

## What works

Checked by running the game, mostly through the headless playtest scripts in `scripts/playtest/` (the commands are in the README).

- **Start to finish.** New game starts on the Bay Hill in Timaru. All six missions complete back to back in one session with the scripted test player, ending with NZ$12,100 and no console errors. Saving, reloading and Continue bring back money and position (`scripts/playtest/continue.mjs`); dying and being arrested each cost a fee and put you back at the hospital or police station.
- **On foot.** Walk, run, jump, punch, aim over the shoulder and shoot. Fists, cricket bat, pistol, pump shotgun and .22 rifle; health, armour, cash and weapon pickups.
- **Vehicles.** Eleven: two big sedans, a coupe, a hatch, a wagon, a ute, a farm truck, a van, a motorbike, a police car and a bus. Parked ones can be taken and occupied ones hijacked (seen by a bystander, that is one light of heat). They take damage, catch fire and explode; they skid, smoke and leave marks. Fast vehicles knock over lamp posts, signs, bins, benches and fences; slow ones are stopped by them.
- **Police.** Five levels. Crimes count only when witnessed. A three-light pursuit in Christchurch was sighted within ten seconds, had a roadblock across Moorhouse Avenue in about twenty, and had wrecked the test driver's car by thirty-five (`scripts/playtest/chase.js`). From three lights they shoot.
- **Losing the police.** At two lights, in the car they were looking for: run until no patrol car has eyes on you, ditch it for another, drive off quietly, and the lights are out 35 seconds after they came on (`scripts/playtest/escape.js`). It was an easy case, and nobody has tried it by hand at three lights and up, where they shoot and block roads.
- **Combat.** A four-against-one shoot-out fought by an aim-and-fire bot with only what the mission hands out (pistol, half armour) was won in 11 seconds for 29 points of damage (`scripts/playtest/fight.js`). That figure is from before the art pass and was not re-run.
- **The world.** A compressed Christchurch (the four avenues, Cathedral Square with the cathedral standing, Colombo Street, the Avon, Hagley Park, the Arts Centre, suburbs, Lancaster Park, New Brighton, the Port Hills and Summit Road, the tunnel to Lyttelton) and Timaru (Stafford Street, the Bay Hill, Caroline Bay with its sound shell and carnival, the port, the basilica, Washdyke, Smithfield), joined by State Highway 1 across the plains through Rakaia, Ashburton and Temuka, with the Rakaia and Rangitata bridges and the Alps on the western horizon. Real place and street names, te reo names in the HUD and map, marae in the landscape.
- **How it looks.** A film-style grade that shifts with the weather, haze in the distance, clouds that cast moving shadows, and nights that are dark between sodium lamps. Buildings carry grime, streaks, rust and faded paint, and shop windows show goods. Roads have wheel tracks, patches, cracks and the painted furniture of a 1995 town: STOP and GIVE WAY, zebra crossings, parking bays, cat's-eyes. Cars have shaped bodies, real lamps, cabins, road film and trim that differs from car to car. Trees come in several shapes, and there are flower beds, hedges and long grass. Streets have meters, signs and name blades with the real street names.
- **Life.** Pedestrians and traffic that follow the roads, keep left and react; drivers you can see at the wheel; boy racers at night; a heritage tram working the city loop, which traffic queues behind and which stops for anything on its track.
- **Familiar faces.** Eleven look-alike parodies of 1995's public figures, under invented names, stand at set places in daytime and say their lines as you walk up; the weatherman comments on the weather the game is actually having. Three have a line in a mission. They cannot be hurt. The cast is one file, `src/missions/defs/cameos.ts`.
- **Sky and sound.** Day and night, clear, nor'wester (with the arch), overcast, southerly rain and fog; wet roads with puddles; ten real New Zealand radio stations streamed live in cars (all ten connected and played when tested with `scripts/playtest/radio.js`), six synthesised stations after them on the dial; synthesised engines, effects and ambience.
- **Interface.** A title screen that is a photograph of the game, a HUD in one type system, a paper minimap, the island map as a page from a road atlas with grid, scale and key, and a pause menu with jobs, controls, settings (four quality levels) and save.
- **Phones.** An on-screen controller on touch devices (stick, look by dragging, and buttons that change between walking, driving and being armed), a lighter quality tier, a "turn your phone" card in portrait, and home-screen support. Chrome's phone emulation, driven with real touch events, passes 63 of 63 checks: walking, looking, taking a car, driving, weapons, every pause screen and the map (`node scripts/playtest/phone.mjs`).

## What is rough

- **Nobody has played it through by hand.** The scripted player teleports the long drives and, except in the one fight tested honestly, wins fights by cheating. Mission difficulty, timers and police lethality are therefore unbalanced guesses. Mouse look under pointer lock and gamepads are untested.
- **It has not been run on a phone.** There is no iPhone or simulator on the machine it was built on. Chrome's emulation is not Safari: safe areas on both rotations, the left-edge swipe, zoom and bounce, sound starting on the first tap, the live radio starting by itself in a car, sound returning after the phone is locked, pinch zoom on the map, installing to the home screen, and ten minutes without the tab reloading all need checking on a real one. How fast it runs on a phone is unknown.
- **Landmarks got weather but no new detail.** The cathedral, the Arts Centre, Lancaster Park and the rest have no new stonework, entrances or signage. Suburban yards are empty and Stafford Street is still sparse. (Traffic signals are lit now: the aspects glow and the whole town runs one controller cycle — green one axis while the other holds red, amber and a beat of all-red between — with crossing roads on opposite phases.)
- **People.** Each figure now has its own face tone, stubble or age, and clothes with collars and cuffs, but brows, eyes and lips are the same on everyone, hair is the same few shapes, and nobody turns their head. (The dark patch at the women's mouth is gone: it was the normal map, not the skin — the philtrum groove, corner curls and chin fold were cut too deep in the source map, and the build now calms them around the mouth.)
- **Things that switch at a distance.** Trees dissolve to a cheaper version at 120 m with a faint stipple. Their trunks used to pop (the wood had no part in the dissolve); they now fade with the crown, and in a drive past Hagley Park the worst tree switch changed the picture 1.12 times what the motion alone did, down from 1.23 before the fix (`scripts/playtest/lodwatch.js`). Cars and figures were watched while driving and showed no pop after the car glass was matched.
- **Vehicles.** Drivers are seated properly now: the stand-in occupant grew shins and shoes that reach the footwell (deeper in a bus or truck cab), and the motorbike rider's knees go out round the tank with the shins dropping to the footpegs — which moved back to where a rider's feet actually sit — instead of vanishing into the engine. The motorbike and the bus themselves are still the plainest of the eleven.
- **Buildings.** Streaks are not tied to individual sills or downpipes, and old painted signs do not show brick through the paint.
- **Ground.** No painted driveway crossings. Far hillsides still streak. There are no reflections of lights in wet roads beyond the shine of the surface itself.
- **A glitch seen twice and not found.** During the art pass two screenshots came back covered in large dark planes. 138 reruns and four drives did not reproduce it; the likeliest cause is a page that loaded while another agent was half-way through an edit, but that is unproven.
- **One long frame.** The 43 ms frame after a teleport was a single chunk-build step too big for the 4 ms budget: the whole Arts Centre built in one go. Heavy work is now sliced — the Arts Centre and Cathedral Square builders go a stage per frame, roads an edge per frame and rails a line per frame — and the worst single step fell from 20 ms to 10 ms (`world.slowJob` records it; the chunk system's whole cost in the worst frame of a town drive after a teleport is now 12 ms). The slowest frames left are the browser compiling a shader the first time an effect appears — up to 135 ms, once per session each — which is a different problem and still open.
- **The familiar faces are simple.** The likeness is in the name, the place and the lines, not the face. Nobody carries a prop. (The two who used to raise both arms to speak — which read like a stick-up — now hold forth with one open hand raised, a new `orate` pose.)
- **Live radio leans on other people.** The ten real stations play from their own public streams with no arrangement in place: an address can change or a station can object, and then that line in `src/audio/radio/live.ts` has to go. What they broadcast is today's radio, not 1995's.
- **AI driving.** The cars that left the road are fixed: a degenerate junction connector could pin a car at the end of an edge and send it across the riverbank on full lock, sharp-turn curves could swing across City Mall, and a car knocked off its lane had no way back. Cars now avoid hairpin exits when wandering, rejoin the road when they find themselves well off it, and parked cars keep 22 m clear of junctions, which ends the clipping at corners. Watched for four minutes at each of the two worst corners (`scripts/playtest/roadwatch.js`), off-road events fell from 32 to 4 and 26 to 3, none further than a wheel over the seal at walking pace, and no parked car was touched.
- **Integrated graphics are unmeasured.** Every number below is from one M2 Max.

## What was cut

- Real map data. The first idea was to build from OpenStreetMap; the map is hand-authored and compressed instead.
- Moving trains on the Main South Line (the line, stations and bridges are there; level crossings would need traffic that understands them) and moving punts on the Avon.
- Building interiors, apart from what shows through shop windows.
- A submachine gun and swimming.
- CC0 vehicle models: none exist for period New Zealand cars, so vehicles are procedural.

## Measured frame rate

Apple M2 Max MacBook Pro, 1920 × 1080, quality High unless stated, frame rate uncapped, development server. `zsh scripts/playtest/measure.sh` reproduces the table (each place is `node scripts/shot.mjs … --fps 6 --size 1920x1080`, run twice). "Before" is the same script before the art pass.

| Place | Before | Now | Draw calls now | Triangles now |
|---|---|---|---|---|
| The Bay Hill, Timaru (start) | 164–174 | 225–230 | 580–880 | 0.7–1.0 M |
| Linwood (suburban street) | 124–126 | 165–175 | 730–760 | 1.1 M |
| Moorhouse Avenue, night, southerly rain, in a car | 112–120 | 145–188 | 1,000 | 1.7 M |
| Hagley Park and the Avon | 104–106 | 110–135 | 910–1,050 | 1.4–1.6 M |
| Cathedral Square | 95–97 | 115–130 | 880–1,040 | 1.6–2.0 M |
| Cathedral Square, Low | 227 | 342 | 490 | 1.0 M |
| Cathedral Square, Medium | 129 | 150 | 700 | 1.3 M |
| Cathedral Square, Ultra | 60, at 70 % render scale | 76, at full scale | 1,300 | 2.3 M |
| State Highway 1 at about 100 km/h for 22 s | 158 average; 99th-percentile frame 13 ms; worst 19 ms | 224 average; 99th-percentile frame 10 ms; worst 17 ms | | |

The slowest single frame in the ten standing runs was 18 ms. A second pass on the same code, by the agent that did the performance work, gave lower figures in two places (113–115 at Hagley, 105–108 in the Square) and the same or higher elsewhere; runs on this machine differ by ten per cent or more, so read the table as "faster everywhere, by a fifth to a third", not to the frame.

Where the saving came from: figures have four levels of detail (thirty pedestrians went from 1.46 M triangles to 0.22 M), trees and cars have cheap distant versions, and small props are drawn only in chunks near the camera. The street dressing costs about a tenth of the frame rate on Christchurch's one-way parking streets (Kilmore Street: 115–117 with it, 128–160 without).

## Screenshots

The same view before and after the art pass (`zsh scripts/gallery.sh` takes all 24).

| Before | After |
|---|---|
| ![Stafford Street before](screenshots/round3/02-stafford-street-before.jpg) | ![Stafford Street after](screenshots/round3/02-stafford-street-after.jpg) Stafford Street, Timaru |
| ![Shopfront before](screenshots/round3/24-shopfront-close-before.jpg) | ![Shopfront after](screenshots/round3/24-shopfront-close-after.jpg) A shopfront on Stafford Street |
| ![Square before](screenshots/round3/08-square-before.jpg) | ![Square after](screenshots/round3/08-square-after.jpg) Cathedral Square |
| ![Square at night before](screenshots/round3/09-square-night-before.jpg) | ![Square at night after](screenshots/round3/09-square-night-after.jpg) The Square at dusk |
| ![Linwood before](screenshots/round3/13-linwood-before.jpg) | ![Linwood after](screenshots/round3/13-linwood-after.jpg) A Linwood street |
| ![Avon before](screenshots/round3/12-avon-hagley-before.jpg) | ![Avon after](screenshots/round3/12-avon-hagley-after.jpg) The Avon and Hagley Park |
| ![Plains before](screenshots/round3/06-plains-norwester-before.jpg) | ![Plains after](screenshots/round3/06-plains-norwester-after.jpg) The plains under a nor'wester |
| ![Car before](screenshots/round3/22-car-very-close-before.jpg) | ![Car after](screenshots/round3/22-car-very-close-after.jpg) A car, close up |

| | |
|---|---|
| ![Title](screenshots/round3/title.jpg) The title screen | ![Map](screenshots/round3/map.jpg) The island map |
| ![Phone, driving](screenshots/round3/phone-driving.jpg) On a phone, driving | ![Phone, on foot](screenshots/round3/phone-on-foot.jpg) On a phone, on foot and armed |
| ![Rain](screenshots/round3/moorhouse-rain.jpg) Moorhouse Avenue at night in a southerly | ![Cars](screenshots/round3/cars.jpg) Six of the eleven vehicles |

Earlier screenshots, from before the art pass, are still in `docs/screenshots/` (`01` to `16`): among them the roadblock that ended the test pursuit, the boat-shed fight, aiming, and the Warlock of the Square.

## Housekeeping

`shots/` (about 2.2 GB of working screenshots, plus each agent's notes from the art pass in `shots/round3/*-report.md`) and `assets-staging/` (about 1.4 GB of raw asset downloads) are scratch, ignored by `.gitignore`, and can be deleted; neither has been. `dev/` holds two viewer pages for the figures and the plants; they are not part of the build. (`src/vehicles/models/common.ts`, which nothing imported, is gone.)

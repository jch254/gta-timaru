# Code-quality pass, November 2026

A refactor-only pass over the whole repo: tidy it, remove duplication, bring it in line with standard practice. The rule throughout was that the game must look, play and perform exactly the same afterwards — seeded random sequences included. This is the record of what was found, what changed, how it was verified, and what was deliberately left alone.

The work sits on the branch `refactor/code-quality-pass`, 24 commits off `e104cab` ("Run the unit tests in CodeBuild before anything deploys"). One theme per commit, so each is easy to review and revert.

## Baseline (recorded before any change)

- `tsc` clean, 1,232 unit tests passing, build clean. No linter or formatter exists in the repo — only `tsc` (already `strict` with `noUnusedLocals`/`noUnusedParameters`), vitest and the Vite build.
- All six missions complete back-to-back with the scripted player, ending on NZ$12,100. Save/continue round-trips.
- The phone playtest is flaky at one check regardless of version: "nothing to tap at fire button" failed 2 of 3 baseline runs (once on a quiet machine) and passed the third 63/63. The report's wording was updated to say so.
- Frame rates at the report's locations and 24 fixed gallery views (draw calls + triangles per view) were captured for comparison.

## Bugs found and fixed

The audit found four concrete corruption-to-brick paths at the localStorage trust boundary, all fixed with validation and covered by new tests in `src/core/save.test.ts` / `settings.test.ts`:

1. A save key holding a valid-JSON primitive (`"null"`, `"5"`) threw outside `load()`'s try and bricked Continue forever. Now treated as no save.
2. A corrupted `quality` setting (`"potato"`) indexed `QUALITY[...]` into undefined and bricked every start path, recoverable only by clearing localStorage. Stored settings are now sanitised per key against the defaults' types; quality must be a real level.
3. A corrupt clock slice went through `Object.assign(clock, …)`, could overwrite the clock's methods, and hard-froze the game after a "successful" load. The slice now copies the two numbers only.
4. A truncated player slice fed NaN coordinates into Rapier and `world.loadAround`, soft-bricking Continue with no error. Only finite numbers come back in; a bad position leaves the player at spawn.

Two smaller ones: a load that skips a damaged slice now tells the player ("The save file was damaged; some progress may be missing") instead of returning silently, and a failed `?dev` tools chunk no longer paints "Could not start" over a game that is already running.

No lead was found on the dark-planes glitch, and no resource leaks: chunk, vehicle and mission-entity cleanup were all verified working. The first-use shader-compile stall is inherent compilation; precompiling at load would be a behaviour change and is left as a possible follow-up.

## What changed, by theme

**Duplication.** One home each, with golden-value tests pinning the exact outputs so every seeded sequence and eased value stays bit-identical:

- `core/rng.ts` — the mulberry32 RNG (vegetation's local copy was byte-identical, so sequences are unchanged) and the FNV-1a string hash (three provably-identical copies in scatter, roadmesh and the rural kit; `buildings/names.ts` has a genuinely different hash and keeps it).
- `core/vec3.ts` — the `V3` tuple type (declared five times) and the add/sub/dot/cross/len/norm/mix helpers (vehicles kit, vegetation, ground).
- `core/lanes.ts` — the lane-offset formula (`RoadGraph.lanePoint` and the AI's allocation-free copy, which a test already asserted agree) and the 1.7 m footpath offset (three independent constants).
- `core/async.ts` — `settle()`, duplicated in respray and mission services.
- `world/mapsource.ts` — segment–segment intersection (×3, callers keep their own tolerances), point-in-shape (×2, byte-identical), and `packCell` (the `(c+512)*1024` key packing, inlined six times — the world-bounds coupling now lives in one place).
- `fx/glsl.ts` — the fog-factor GLSL block, interpolated so the compiled shader text is unchanged.
- `render/textures.ts` `dataTexture()` — exported and used by the two sites whose settings were exactly the house defaults (air, weathering). Sites with genuinely different wrap/filter choices keep their own helpers.
- `world/props/index.ts` `appendVertices()` — the de-index-and-append loop shared by `mergeGeometries` and `landmarks/paint.ts`'s `painted()`, both outputs byte-identical.
- `LAMP_WARM` (`world/scatter/util.ts`) — the warm sodium-white that was 36 bare `0xffe2b0` literals across 17 files.
- Dead default respray rates removed; call sites and tests pass the tuning values.

**Tuning values** (moves only — every value verbatim; the balance numbers remain the untested guesses the report says they are):

- New `src/player/tuning.ts`: max health, incoming-damage scaling, armour share, death timer, hospital/bail fee, hours lost, jump speed, gravity, fall-damage curve, aim/sprint/walk speeds, wading and drowning depths, vehicle-enter reach.
- New `src/vehicles/tuning.ts`: crash thresholds and damage curve, engine drown rule, burn fuse, the burnt-out explosion (9 m / 120).
- `ai/tuning.ts` gains the strays: NPC health 100 (was in three files), ped melee scale, bail speed, dead-end despawn, bark chance, ambient cruise share.
- `NIGHT_HEADLIGHTS` in `core/types.ts`: the 0.35 threshold traffic and police both hardcoded (the player's own beams still come on at 0.3, unchanged).

**Structure.**

- `touch/feed.ts` and `touch/device.ts` moved into `core/` — they were core utilities, and their old home made core import from a module, the only contract-boundary inversion in the codebase.
- `registerPatched` is feature-detected via a shared `patchable()` guard (`render/materials.ts`) instead of two files casting `MaterialLibrary` to the concrete class.
- `qualityChanged` is now actually emitted when the quality changes; the no-op listener that kept the dead declaration company is gone.
- The figure/occupant material caches are `WeakMap`s keyed by `MaterialLibrary`, matching the 27 conforming caches, so a test double's materials can never be served to the real library. (`rig.ts`'s shadow material is never registered against a library and correctly stays global.)
- `missions.talking` is on the contract; the touch overlay and pause menu drop their reach-through casts (`as unknown as`, `as never`).

**Infrastructure and scripts.**

- `pnpm dev` now serves port 5195 — the port every script and doc already dialled. (The gap was real: a fresh `pnpm dev` used to serve 5173 and every tool connected to nothing.)
- Package renamed from the stale `south-island-90s` to `timmaz-hard`.
- `@dimforge/rapier3d-compat` moved to devDependencies — it is type-only plus the node-side physics tests and ships nothing.
- New `scripts/lib.mjs`: the Chrome path, dev address, iPhone UA, GPU flags and `--flag` parser that were copy-pasted across five scripts, plus the `timmaz-hard.settings.v2` key that three scripts hardcoded (a settings-schema bump would have silently broken their presets). Launch flags beyond the shared prefix stay per-script on purpose.

**Docs** brought in line with the code: CONTRACT's allowed-helpers list covers what world modules actually lean on (`batchHint`, the new core modules), the deleted `vehicles/models/common.ts` references are gone, the stale `--dir src` test advice is fixed, `recklessDriving` joins the crime list, a heat-vs-wanted glossary line and a note that nothing calls the systems' own `dispose()` (the game starts once per page and has no teardown path); DESIGN's tree no longer claims `systems.ts` exists or puts autopilot under vehicles; ASSETS names the right physics package and the full dev-dependency list; both READMEs mention the CI test gate; the README documents all 22 playtest scripts; `title-still`'s usage strings use its real name.

## Verification

Everything below was run after the last commit; typecheck, build and all **1,254** tests (1,232 + 22 new) pass with no new warnings.

- **Missions:** all six complete back-to-back, ending NZ$12,100 — identical to baseline. Save/continue round-trips. Phone playtest **63/63**.
- **Frame rates**, `main` vs branch back-to-back on an idle M2 Max (1920×1080, High, two runs each):

| Place | main | branch |
|---|---|---|
| The Bay Hill, Timaru | 216–237 | 139–218 |
| Linwood | 132 | 128–132 |
| Antigua boatsheds | 98–99 | 102–103 |
| Cathedral Square | 88–91 | 96–98 |
| Moorhouse Ave, night rain, in car | 84–90 | 135–141 |
| Cathedral Square Low / Medium / Ultra | 195 / 134 / 56 | 347 / 142 / 73 |
| SH1 at ~100 km/h, 22 s | 157 avg, worst 21.8 ms | 213 avg, worst 16.6 ms |

  No location regressed. Where the branch reads much higher, the same lines show the main run had simply spawned heavier ambient traffic (e.g. Ultra: 1,951 draw calls on main vs 1,366 on the branch) — run variance, not a speedup claim.
- **Screenshots:** the 24 gallery views vary by ±20–34 % in draw calls *between two runs of identical code* wherever ambient traffic or figures are in frame, so those views cannot distinguish versions. The decisive checks: the static views (Caroline Bay, Timaru port, the plains, the shopfront close-up) are byte-stable in calls and triangles across the baseline and both branch runs; the mean pixel difference between versions (2.5–5.9/255) equals the same-code run-to-run figure (3.2–6.0 — film grain and JPEG); and a side-by-side of the shopfront close-up is indistinguishable. One measurement artefact worth knowing: a cold Vite cache under-streams textures and makes the first gallery pass read low — warm the cache before comparing numbers.
- **Still untested**, as before this pass: playing by hand, pointer-lock mouse look, gamepads, and a real phone.

## Deliberately left alone

Each of these was found by the audit and deferred on purpose — they need care a refactor-only pass shouldn't spend, or they change behaviour:

- The tileable-noise quadruplication (`render/textures`, `render/air`, `weathering`, `gltf/looks`): three share a byte-identical hash but differ in fade curve and divisor; consolidation must be parameterised to stay bit-identical. Visual risk.
- The river proximity index duplicated between `world/height.ts` and `world/ground.ts` (terrain-sampling hot path).
- Police numbers still outside `police/tuning.ts` (speeding threshold, phone-in rules, gun-threat cone, recall timers) — mechanical but interleaved with state machines.
- `missions/spots.ts` `JUNCTION_PAD = 12` contradicts `ai/tuning.ts` `parkClearance: 22` (mission cars may stand inside the documented 15 m turning sweep). Aligning it changes where mission cars spawn — a balance decision, not a refactor.
- The global seeded `dice` RNG in `vehicles/models/kit.ts`: every car's look depends on global spawn order; per-vehicle seeding would be sturdier but recolours every car.
- Big-file splits (`buildChunkRoads` at ~565 lines, `fullmap.draw`, `missions/runner.ts`, `vegetation.ts`) — clean seams exist, but they are the riskiest diff-for-diff's-sake items.
- The two parallel landmark kits (christchurch vs rural) — parallel evolution, not copy-paste; merging changes visuals.
- ~160 symbols exported but used only in their own file (de-exporting is safe but a large diff).
- Infra decisions: committing `.terraform.lock.hcl` (pins providers in CI deploys), adding a `packageManager` pin (CI runs pnpm 10, local 11; `pnpm-workspace.yaml`'s `allowBuilds` key is pnpm-11-only and inert in CI), and deduplicating the deploy config that is defined in buildspec, bash defaults and README.
- The known rough content items (sparse Stafford Street, plain motorbike and bus, simple faces) — content work, out of scope.

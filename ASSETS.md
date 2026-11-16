# Assets

**Third-party art in the game, all of it CC0 (public domain dedication):** photographic surface textures ([Photographic textures](#photographic-textures), [Ground and water](#ground-and-water)), one atlas of photographed leaves ([Vegetation](#vegetation)), and the human figures and their animations ([Character models](#character-models)). Each section lists every asset with its source, author and licence. There is no third-party audio, music or font.

Shipped size: 14 MB under `src/assets/` (textures 11 MB, character models 2.7 MB, foliage atlas 1.0 MB). Nothing is fetched at runtime; the scripts under `scripts/assets/` that downloaded and optimised these files are not needed to build or run the game.

Everything else is generated at runtime by code in this repository:

| Kind | How it is made | Where |
|---|---|---|
| Signs, shop names, number plates, window glazing and lit rooms, road markings | Canvas 2D drawing with system fonts, packed into atlases, and shader code | `src/render/materials.ts`, `src/render/glazing.ts` |
| Fallback surface textures and the detail noise layered over the photographs | Tileable procedural noise drawn to canvases | `src/render/textures.ts` |
| Sky, clouds, stars, rain | GLSL shaders | `src/render/sky.ts` |
| Terrain, coast, rivers, roads, bridges, tunnels | Analytic height function and generated meshes | `src/world/` |
| Buildings, landmarks, street furniture | Procedural geometry | `src/world/buildings`, `src/world/landmarks`, `src/world/props` |
| Trees and plants | Procedural trunks and limbs carrying cards cut from the leaf atlas | `src/world/props/vegetation.ts` |
| Vehicles, the tram | Procedural geometry | `src/vehicles/models`, `src/rail/tram.ts` |
| People | The CC0 figures below, with generated clothing colours and poses; a code-built figure remains as the fallback | `src/actors/` |
| Sound effects, engines, ambience, radio stations and their music | WebAudio synthesis | `src/audio` |

## Photographic textures

Eighteen surfaces use photographic PBR texture sets (albedo, normal, roughness) from [Poly Haven](https://polyhaven.com) and [ambientCG](https://ambientcg.com) in place of their procedural textures. Every asset on both sites is published under CC0 1.0 Universal (public domain dedication): see <https://polyhaven.com/license> and <https://docs.ambientcg.com/license/>. The procedural textures in `src/render/textures.ts` remain as the fallback, and for `cloth`.

The files ship in `src/assets/textures/` (54 JPEGs, 10.2 MB) with a `manifest.json` that `src/render/phototextures.ts` loads; nothing is fetched at runtime.

| Surface | Asset (id) | Library | Source | Author | Licence | Tint | Tile (m) | Files |
|---|---|---|---|---|---|---|---|---|
| `asphalt` | Asphalt 015 (`Asphalt015`) | ambientCG | <https://ambientcg.com/a/Asphalt015> | ambientCG | CC0-1.0 | natural | 2 × 2 | `asphalt_col.jpg`, `asphalt_nor.jpg`, `asphalt_rgh.jpg` (1012 kB) |
| `concrete` | Concrete Floor Worn 001 (`concrete_floor_worn_001`) | Poly Haven | <https://polyhaven.com/a/concrete_floor_worn_001> | Dimitrios Savva, Rico Cilliers | CC0-1.0 | neutral | 3 × 3 | `concrete_col.jpg`, `concrete_nor.jpg`, `concrete_rgh.jpg` (203 kB) |
| `footpath` | Paving Stones 136 (`PavingStones136`) | ambientCG | <https://ambientcg.com/a/PavingStones136> | ambientCG | CC0-1.0 | natural | 2.4 × 2.4 | `footpath_col.jpg`, `footpath_nor.jpg`, `footpath_rgh.jpg` (228 kB) |
| `gravel` | Gravel Floor 02 (`gravel_floor_02`) | Poly Haven | <https://polyhaven.com/a/gravel_floor_02> | Jenelle van Heerden, Dimitrios Savva | CC0-1.0 | natural | 2 × 2 | `gravel_col.jpg`, `gravel_nor.jpg`, `gravel_rgh.jpg` (1133 kB) |
| `shingle` | Ganges River Pebbles (`ganges_river_pebbles`) | Poly Haven | <https://polyhaven.com/a/ganges_river_pebbles> | Amal Kumar | CC0-1.0 | natural | 2.16 × 2.16 | `shingle_col.jpg`, `shingle_nor.jpg`, `shingle_rgh.jpg` (731 kB) |
| `grass` | Grass 004 (`Grass004`) | ambientCG | <https://ambientcg.com/a/Grass004> | ambientCG | CC0-1.0 | neutral | 2 × 2 | `grass_col.jpg`, `grass_nor.jpg`, `grass_rgh.jpg` (1160 kB) |
| `sand` | Sand 03 (`sand_03`) | Poly Haven | <https://polyhaven.com/a/sand_03> | Charlotte Baglioni | CC0-1.0 | neutral | 2 × 2 | `sand_col.jpg`, `sand_nor.jpg`, `sand_rgh.jpg` (391 kB) |
| `weatherboard` | Brown Planks 05 (`brown_planks_05`) | Poly Haven | <https://polyhaven.com/a/brown_planks_05> | Rob Tuytel | CC0-1.0 | neutral | 1.35 × 1.35 | `weatherboard_col.jpg`, `weatherboard_nor.jpg`, `weatherboard_rgh.jpg` (297 kB) |
| `brick` | Red Brick (`red_brick`) | Poly Haven | <https://polyhaven.com/a/red_brick> | Rob Tuytel | CC0-1.0 | natural | 1.44 × 1.72 | `brick_col.jpg`, `brick_nor.jpg`, `brick_rgh.jpg` (510 kB) |
| `bluestone` | Rock Wall 16 (`rock_wall_16`) | Poly Haven | <https://polyhaven.com/a/rock_wall_16> | Amal Kumar | CC0-1.0 | natural | 2.4 × 2.4 | `bluestone_col.jpg`, `bluestone_nor.jpg`, `bluestone_rgh.jpg` (524 kB) |
| `limestone` | Sandstone Blocks 08 (`sandstone_blocks_08`) | Poly Haven | <https://polyhaven.com/a/sandstone_blocks_08> | Rob Tuytel | CC0-1.0 | natural | 2.2 × 2.2 | `limestone_col.jpg`, `limestone_nor.jpg`, `limestone_rgh.jpg` (102 kB) |
| `plaster` | White Stucco (`white_stucco`) | Poly Haven | <https://polyhaven.com/a/white_stucco> | Amal Kumar | CC0-1.0 | neutral | 2 × 2 | `plaster_col.jpg`, `plaster_nor.jpg`, `plaster_rgh.jpg` (318 kB) |
| `corrugated` | Corrugated Iron (`corrugated_iron`) | Poly Haven | <https://polyhaven.com/a/corrugated_iron> | Jenelle van Heerden, Dimitrios Savva | CC0-1.0 | neutral | 1.14 × 1.14 | `corrugated_col.jpg`, `corrugated_nor.jpg`, `corrugated_rgh.jpg` (330 kB) |
| `rooftile` | Clay Roof Tiles 03 (`clay_roof_tiles_03`) | Poly Haven | <https://polyhaven.com/a/clay_roof_tiles_03> | Amal Kumar | CC0-1.0 | neutral | 2.6 × 2.6 | `rooftile_col.jpg`, `rooftile_nor.jpg`, `rooftile_rgh.jpg` (564 kB) |
| `slate` | Grey Roof Tiles 02 (`grey_roof_tiles_02`) | Poly Haven | <https://polyhaven.com/a/grey_roof_tiles_02> | Rob Tuytel | CC0-1.0 | neutral | 1.8 × 1.8 | `slate_col.jpg`, `slate_nor.jpg`, `slate_rgh.jpg` (446 kB) |
| `timber` | Brown Planks 03 (`brown_planks_03`) | Poly Haven | <https://polyhaven.com/a/brown_planks_03> | Rob Tuytel | CC0-1.0 | neutral | 1.35 × 1.35 | `timber_col.jpg`, `timber_nor.jpg`, `timber_rgh.jpg` (420 kB) |
| `foliage` | Scattered Leaves 008 (`ScatteredLeaves008`) | ambientCG | <https://ambientcg.com/a/ScatteredLeaves008> | ambientCG | CC0-1.0 | neutral | 2.3 × 2.3 | `foliage_col.jpg`, `foliage_nor.jpg`, `foliage_rgh.jpg` (706 kB) |
| `bark` | Bark Willow 02 (`bark_willow_02`) | Poly Haven | <https://polyhaven.com/a/bark_willow_02> | Charlotte Baglioni | CC0-1.0 | natural | 2.15 × 2.15 | `bark_col.jpg`, `bark_nor.jpg`, `bark_rgh.jpg` (872 kB) |

ambientCG lists no author per asset, so the library is given. Tile is the ground one repeat covers, set so features are life-size (230 × 76 mm bricks, 76 mm corrugations, 150 mm boards, 600 mm paving slabs).

The shipped files are derived from the libraries' 1K JPEG maps by `scripts/assets/fetch-textures.mjs`, which documents every setting. Nothing is cropped. What differs from the sources:

- **Size and format.** Albedo and OpenGL normal maps are 1024 × 1024 JPEG, roughness 512 × 512 greyscale JPEG.
- **Neutral albedos** (the game multiplies them by a paint or vertex colour) keep 15 % of their saturation (10 % for `foliage`) and are moved to a mean sRGB luminance of 0.78, keeping their local contrast.
- **Natural albedos** keep their photographed colour, with three corrections: `footpath` is desaturated to concrete grey, `bluestone` loses half its brown cast and is lightened from near-black, `limestone` is paled towards Oamaru stone.
- **Blotches** much wider than the features are evened out on all but `footpath`, `bluestone`, `limestone` and `bark`, so the repeat does not show across a road, a paddock or a wall.
- **Roughness** is shifted to a matt outdoor level where the source is too glossy for the game's lighting (`asphalt`, `concrete`, `footpath`, `gravel`, `grass`, `limestone`, `timber`, `foliage`, `bark`: sources 0.26–0.69, shipped 0.80–0.94); `weatherboard` goes the other way, 0.93 to 0.78. The variation within each map is kept.
- **Scale.** Where the source states a size it is used, except: `brick` is stretched 23 % in v to the New Zealand brick module; `grass`, `weatherboard`, `timber`, `bluestone` and `slate` are scaled up 20–43 % and `limestone` down 27 % to suit what they stand for here (pasture blades, 150 mm boards, larger blocks and slates, 440 mm ashlar courses).

To rebuild: `node scripts/assets/fetch-textures.mjs` (downloads are cached in the git-ignored `assets-staging/textures/`), then `node scripts/assets/check-textures.mjs`.

## Ground and water

The terrain blends eight photographic layers (`src/world/ground.ts`). Five reuse maps listed above (`grass`, `shingle`, `sand`, `concrete`, and `gravel`, which is laid at 4.6 m a repeat, more than twice its true size, to stand for 20 mm road metal on shoulders, yards and railway ballast); three more were added for surfaces that had no photograph. All three are from [Poly Haven](https://polyhaven.com), published under CC0 1.0 Universal (<https://polyhaven.com/license>).

| Layer | Asset (id) | Source | Author | Licence | Used for | Files |
|---|---|---|---|---|---|---|
| `dry` | Withered Grass (`withered_grass`) | <https://polyhaven.com/a/withered_grass> | Charlotte Baglioni | CC0-1.0 | long dry grass: road verges, Port Hills tussock, browned-off paddocks, stubble, marram on the dunes | `ground/dry_col.jpg`, `ground/dry_nor.jpg` (379 kB) |
| `soil` | Farm Soil (`farm_soil`) | <https://polyhaven.com/a/farm_soil> | Amal Kumar | CC0-1.0 | ploughed paddocks, bare yards, stream beds | `ground/soil_col.jpg`, `ground/soil_nor.jpg` (283 kB) |
| `rock` | Rock Boulder Dry (`rock_boulder_dry`) | <https://polyhaven.com/a/rock_boulder_dry> | Dimitrios Savva, Rico Cilliers | CC0-1.0 | outcrops on the hills, steep faces, harbour shores | `ground/rock_col.jpg`, `ground/rock_nor.jpg` (212 kB) |

The files ship in `src/assets/textures/ground/` (6 JPEGs, 0.87 MB) and are bundled; nothing is fetched at runtime. They are derived from the 1K JPEG maps by `scripts/assets/fetch-ground-textures.mjs`. Nothing is cropped. What differs from the sources: albedo is 1024 × 1024 and the OpenGL normal map 512 × 512, both JPEG; roughness maps are not shipped (the layers use a fixed roughness); and light and dark blotches wider than about a sixth of the tile are evened out so the repeat does not show across a paddock. The albedos keep their photographed colour: at load the game divides each layer by its own average colour and multiplies the ground colour back in, so only the variation inside the photograph is used.

Everything else on the ground and water is made by code: the paddock patchwork, the landform noise that shades distant hills, the water's wave pattern (`groundNoiseTexture`, `waterNormalTexture` in `src/render/textures.ts`), surf, wheel tracks, reseal patches and worn paint.

To rebuild: `node scripts/assets/fetch-ground-textures.mjs` (downloads are cached in the git-ignored `assets-staging/textures/polyhaven/`).

## Vegetation

Every leaf in the game comes from one texture, `src/assets/foliage/atlas.webp` (2048 × 2048 RGBA, lossy WebP, 1.0 MB), with its cell table and credits in `atlas.json` beside it. It is built from twelve CC0 photo-scanned leaf and sprig sheets (colour and opacity maps, 1K): nine from [ambientCG](https://ambientcg.com) and three from the texture sets of [Poly Haven](https://polyhaven.com) plant models. Both libraries publish everything under CC0 1.0 Universal (<https://docs.ambientcg.com/license/>, <https://polyhaven.com/license>). Nothing is fetched at runtime; `src/world/props/foliage.ts` loads the atlas and `src/world/props/vegetation.ts` maps its cells onto leaf cards. Bark uses the `bark` surface listed under Photographic textures.

| Asset (id) | Library | Source | Author | Licence | Used for |
|---|---|---|---|---|---|
| Leaf Set 016 (`LeafSet016`) | ambientCG | <https://ambientcg.com/a/LeafSet016> | ambientCG | CC0-1.0 | English oak leaves: `oak-a`, `oak-b` |
| Leaf Set 004 (`LeafSet004`) | ambientCG | <https://ambientcg.com/a/LeafSet004> | ambientCG | CC0-1.0 | heart-shaped leaves: `poplar` |
| Leaf Set 013 (`LeafSet013`) | ambientCG | <https://ambientcg.com/a/LeafSet013> | ambientCG | CC0-1.0 | narrow leaves: `willow-bough`, `willow-curtain` |
| Leaf Set 002 (`LeafSet002`) | ambientCG | <https://ambientcg.com/a/LeafSet002> | ambientCG | CC0-1.0 | small-leaved sprigs: `shrub`, `hedge` |
| Leaf Set 019 (`LeafSet019`) | ambientCG | <https://ambientcg.com/a/LeafSet019> | ambientCG | CC0-1.0 | conifer sprays: `macrocarpa`, `norfolk` |
| Leaf Set 025 (`LeafSet025`) | ambientCG | <https://ambientcg.com/a/LeafSet025> | ambientCG | CC0-1.0 | palmate leaves: `lupin` |
| Foliage 001 (`Foliage001`) | ambientCG | <https://ambientcg.com/a/Foliage001> | ambientCG | CC0-1.0 | grass blades: `toetoe`, `grass`, `palm` |
| Foliage 002 (`Foliage002`) | ambientCG | <https://ambientcg.com/a/Foliage002> | ambientCG | CC0-1.0 | seed heads: `toetoe` plumes, `grass` |
| Foliage 008 (`Foliage008`) | ambientCG | <https://ambientcg.com/a/Foliage008> | ambientCG | CC0-1.0 | strap leaves: `flax`, `flax-flower`, `cabbage`, `palm` |
| Pine Tree 01 (`pine_tree_01`), twig maps | Poly Haven | <https://polyhaven.com/a/pine_tree_01> | Rob Tuytel, Rico Cilliers | CC0-1.0 | pine needle sprigs: `pine-a` |
| Fir Tree 01 (`fir_tree_01`), twig maps | Poly Haven | <https://polyhaven.com/a/fir_tree_01> | Rob Tuytel, Rico Cilliers | CC0-1.0 | prickly sprigs: `gorse` |
| Shrub 02 (`shrub_02`), colour and alpha maps | Poly Haven | <https://polyhaven.com/a/shrub_02> | Rico Cilliers | CC0-1.0 | long leaves: `willow-bough`, `willow-curtain` |

ambientCG lists no author per asset, so the library is given. Only the leaf and sprig cut-outs of each sheet are used (the Poly Haven model geometry is not).

The atlas is derived, not copied: `scripts/assets/fetch-foliage.mjs` cuts each sheet into its separate leaves or sprigs, then arranges them into eighteen pictures of whole boughs, fronds, fans and tufts (the names in the last column). What is photographed is the leaves; what is made by the script is their arrangement, the twigs and stalks, the flowers (flax pods, gorse and lupin flowers, drawn as plain shapes), and the colour: each set of leaves is shifted to the green of the plant it stands for, and darkened towards the back and edges of a bough for depth.

To rebuild: `node scripts/assets/fetch-foliage.mjs --preview` (downloads are cached in the git-ignored `assets-staging/foliage/`; `--preview` also writes a viewable sheet there). `dev/vegetation.html` shows every plant kind on a lawn, and `scripts/assets/foliage/view.mjs` takes a headless screenshot of it.

A second, smaller sheet, `src/assets/foliage/extra.webp` (251 kB), was added in the round 3 art pass for the new plant kinds (flower beds, roses, shrubs, long grass, the distant stand-ins for trees). It is cut and arranged from the same CC0 leaf sources listed above by the scripts in `scripts/assets/foliage/`; no new third-party source was used.

## Made for the game

| File | What it is |
|---|---|
| `src/assets/ui/` (title photograph, 156 kB) | A screenshot of the game itself, the Bay Hill at dusk, treated as a faded print. Retake with `zsh scripts/title-still.sh` (dev server running). |
| `public/manifest.webmanifest`, `public/icon-512.png`, `public/apple-touch-icon.png` | Home-screen manifest and icons, drawn for the game. |

## Character models

People are rigged, animated models built from two asset packs by [Quaternius](https://quaternius.com), both published under CC0 1.0 Universal (public domain dedication, <https://creativecommons.org/publicdomain/zero/1.0/>). Copies of the packs' licence files ship beside the models. The code-built figure in `src/actors/humanoid.ts` remains as the fallback if the models fail to load.

| Asset | Source | Author | Licence | Used for |
|---|---|---|---|---|
| Universal Base Characters [Standard] (August 2025) | <https://quaternius.com/packs/universalbasecharacters.html> · download <https://quaternius.itch.io/universal-base-characters> | Quaternius | CC0-1.0 | The male and female bodies (`Superhero_Male_FullBody`, `Superhero_Female_FullBody`), their 53-bone skeleton, skin albedo and normal maps, eyes, eyebrows, and two hairpieces (`Hair_SimpleParted`, `Hair_Long`) |
| Universal Animation Library [Standard] (v3.0) | <https://quaternius.com/packs/universalanimationlibrary.html> · download <https://quaternius.itch.io/universal-animation-library> | Quaternius, with animator Gonzalo Furnier | CC0-1.0 | Thirteen animation clips: `Idle_Loop`, `Walk_Loop`, `Jog_Fwd_Loop`, `Sprint_Loop`, `Jump_Start`, `Jump_Loop`, `Pistol_Aim_Neutral`, `Punch_Jab`, `Punch_Cross`, `Crouch_Idle_Loop`, `Driving_Loop`, `Sitting_Idle_Loop`, `Death01` |

Files shipped in `src/assets/models/characters/` (2.71 MB; loaded by `src/actors/gltf/`, nothing is fetched at runtime):

| File | Size | Contents |
|---|---|---|
| `male.glb` | 1232 kB | One skinned mesh (24 614 vertices, 30 829 triangles, 53 joints), 1024 × 1024 JPEG skin albedo and normal map |
| `female.glb` | 1261 kB | One skinned mesh (26 332 vertices, 33 455 triangles, 53 joints), 1024 × 1024 JPEG skin albedo and normal map |
| `anims.glb` | 280 kB | The skeleton and the thirteen clips on one 30 Hz timeline (612 frames), sliced by name at load |
| `LICENSE-universal-base-characters.txt`, `LICENSE-universal-animation-library.txt` | 1 kB | The packs' own licence files, unaltered |

The shipped models are derived from the packs by `scripts/assets/characters/build.mjs`. What differs from the sources:

- **Clothes are generated.** The base bodies come in underwear. The build cuts the covered skin away and grows a top (sleeveless, short or long sleeves), trousers (or shorts) and socks from the body's own surface (smoothed, pushed outwards, hung straight below the chest and knee, hems closed), lofts shoes around the feet, and unwraps the shells for tiling fabric patterns. Skin weights are inherited from the body underneath. None of this geometry is in the packs.
- **One mesh, selectable parts.** Body, clothes, eyes, brows and four hairstyles share one vertex buffer; the game draws the index ranges a look needs (listed in each file's `extras`).
- **Hair.** `Hair_SimpleParted` and `Hair_Long` are fitted to both heads; the long and mullet styles are made by lengthening and combining them. Hair shading is baked from the packs' hair textures into vertex colours, so those textures are not shipped. The game tints hair, brows and clothes; eyes are painted by code.
- **Skin.** The light skin albedo is divided by its own average tone so the game can multiply any skin colour back in; albedo and OpenGL normal maps are resized from 2048 to 1024 and stored as JPEG. The roughness maps are not shipped.
- **Skeleton.** The twelve `_leaf` end bones are folded into their parents (65 joints become 53).
- **Animations.** Rotations are copied to the base-character skeleton as they are; only the hips keep a translation track, scaled to the body's leg length; scale tracks and root motion are dropped; the seated clips are re-centred over the origin; rotations are stored as 16-bit normalised quaternions.

Not from the packs, and made by code at load time (`src/actors/gltf/`): the relaxed standing pose, hands-up, cowering, shouldering a long gun and riding a motorbike (library clips re-posed with two-bone IK), hats, fabric patterns and the eye texture.

To rebuild: `sh scripts/assets/characters/fetch.sh` (downloads the two Standard zips from itch.io into the git-ignored `assets-staging/characters/` and unpacks them), then `node scripts/assets/characters/build.mjs`. The build uses the dev dependencies `@gltf-transform/core`, `@gltf-transform/extensions`, `@gltf-transform/functions` (MIT) and `sharp` (Apache-2.0). `dev/characters.html` shows every look and pose.

## Third-party code (npm dependencies, bundled)

| Package | Licence | Use |
|---|---|---|
| three | MIT | rendering |
| @dimforge/rapier3d-compat | Apache-2.0 | physics |
| postprocessing | Zlib | post-processing stack |
| n8ao | ISC | ambient occlusion |

Development only: vite (MIT), typescript (Apache-2.0), vitest (MIT), @types/three (MIT).

Fonts: system font stacks only; nothing is downloaded.

## Names

Real place, street and public landmark names are used. Every business, brand, vehicle make and organisation in the world is invented, and so are six of the radio stations. Every character is invented too. Eleven of them (`src/missions/defs/cameos.ts`) are look-alike parodies of the kind of public figure New Zealand knew in 1995, under invented names; no real person's name appears in the game.

## Live radio streams

Ten real stations are on the car radio dial. Nothing of theirs is in this repository or in the build: the player's browser connects to the station's own public stream. The names are the stations' own and are used only to label the dial. The addresses are in `src/audio/radio/live.ts`.

| Station | Stream host |
|---|---|
| The Rock, The Edge, More FM, The Breeze, The Sound | `mediaworks.streamguys1.com` |
| ZM, The Hits, Radio Hauraki | `playerservices.streamtheworld.com` |
| Brian FM | `ais-sa1.streamon.fm` |
| RNZ National | `stream-ice.radionz.co.nz` |

No licence or agreement covers this use; see "Live radio" in the README.

# Exercise demonstrations: how the viewer works and how to add real 3D media

## What is built

Every exercise page uses one reusable viewer (`src/client/visuals/viewer.ts`). It provides:
- a large demo area with play/pause, replay and slow motion (0.5×);
- camera-angle buttons, shown when an exercise has more than one angle;
- a source switch between Demo, Movement (KYVO illustration) and Photo, showing only the sources that exist;
- a poster image and a loading indicator;
- a graceful fallback (illustration plus a message) when a file is missing or fails to load;
- a legend of the main and assisting muscles, with a note that the highlighting is illustrative, not measured muscle activity.

Reduced-motion users start paused. The steps, cues, mistakes, equipment, sets/reps/rest and alternatives come from `data/exercises.json`, as before.

The viewer reads its media only from data files, so assets can be swapped without code changes. It uses the first of these that has media for an exercise:

1. `public/data/demos.json`: hand-picked demos per exercise, which can have several angles.
2. `public/data/media-pack.json`: created by the pack importer from a purchased library.
3. The KYVO movement illustration (`public/data/figures.json`) and photos (`public/data/photos.json`).

**Free demos in use now:** 52 exercises have looping clips made from the free Everkinetic drawings (CC BY-SA 4.0, credited on each clip). Each clip cross-fades the start and end drawings. They are built by `scripts/media/build-everkinetic.mjs`, which only uses exact name matches plus the hand-checked `scripts/media/everkinetic-map.json`. The CC BY-SA licence requires the credit line, and adapted clips must stay under CC BY-SA. The other 125 exercises use the KYVO movement illustration. Everkinetic has no drawing for lat pulldown, chin-up or the shoulder-press machine.

## Live 3D demos

Twenty-one exercises have a real-time 3D demo, rendered in the browser with three.js. It is the first source on their page ("3D"), with Rear, Side and Front camera views (each exercise sets the order, the first is the default), play/pause, replay and 0.5× speed. Main muscles are `#E8552B`, assisting muscles `#F2A65A`, skin light grey, with dark-grey shorts. Highlighting is illustrative, not measured muscle activity. If WebGL is unavailable or a file fails to load, the viewer shows the movement illustration and a message, and hides the 3D controls.

| Part | File | Source and licence |
|---|---|---|
| Body (rigged anatomical male) | `public/models/body.glb` | OpenGym3D exercise pack v1 (MIT, `public/models/LICENSE-opengym3d.txt`), built on the MakeHuman/MPFB2 male (CC0). Shared by every 3D demo. |
| Imported movements and muscle paint | `public/models/og3d/<pack-id>.json` | OpenGym3D pack animations, converted by `scripts/media/import-opengym3d.mjs` |
| Lat pulldown movement | `public/models/lat-pulldown/motion.json` | KYVO keyframes (format `kyvo-aim/1`) |
| Lat pulldown machine, lighting, colours | `src/client/visuals/viewer3d.ts` | KYVO code |
| 3D engine | `public/vendor/three/` | three.js r170 (MIT), self-hosted so the CSP stays `script-src 'self'` |

### Imported from OpenGym3D (20 exercises)

All 24 pack exercises use the same body, so the importer keeps one body and writes a small file per exercise (about 50–110 KB) with the animation tracks and the per-vertex muscle paint. All 24 are converted; only the hand-checked pairs in `scripts/media/opengym3d-map.json` are shown:

| KYVO exercise | Pack motion | Default view |
|---|---|---|
| Bodyweight squat | squat | Front |
| Forward lunge | lunge | Side |
| Reverse lunge | reverse_lunge | Side |
| Conventional deadlift | deadlift | Side |
| Romanian deadlift, Dumbbell Romanian deadlift | romanian_deadlift | Side |
| Good morning | good_morning | Side |
| Standing calf raise | calf_raise | Side |
| Wall sit | wall_sit | Side |
| Plank | plank | Side |
| Dumbbell lateral raise | lateral_raise | Front |
| Hammer curl | hammer_curl | Front |
| Standing barbell overhead press | overhead_press | Front |
| Standing dumbbell shoulder press* | dumbbell_shoulder_press | Front |
| Standing overhead dumbbell extension* | overhead_tricep_extension | Side |
| Dumbbell sumo squat* | sumo_squat | Front |
| Crunch* | crunch | Side |
| Superman* | superman | Side |
| Jumping jacks* | jumping_jack | Front |
| High knees* | high_knees | Side |

\* Added to KYVO as new exercises (October 2026) because the pack had these movements and KYVO did not. Each has full instructions, cues, mistakes, safety notes, programming and a KYVO movement illustration. Shoulder press, overhead extension and sumo squat are Premium; the other four are Free.

Limits: the pack draws **no equipment** (no bar, dumbbells, wall or machine), and the caption says so. The muscle paint comes from the pack, so it can differ slightly from the KYVO muscle list in the legend.

Not shown:
- Rejected after rendering each motion frame by frame, because they would teach the wrong movement: bent-over row (only one arm pulls, torso nearly upright), front raise (one arm, raised out to the side), glute bridge (the shoulders float above the floor and the arms reach through it), push-up (the chest barely lowers), bicep curl (the arms alternate and the resting arm swings out to the side; KYVO already has curl exercises).

To re-import (for example from a newer pack): unzip `dist/opengym3d-exercise-pack-v1.zip` from the OpenGym3D repository and run `node scripts/media/import-opengym3d.mjs --pack <folder>/pack`. To show another pack motion on a KYVO exercise, add it to the map and re-run; check it frame by frame first.

### Lat pulldown (KYVO motion and machine)

- `motion.json` lists body segments (for example `upperarm: [upperarm01.*, lowerarm01.*]`, where `.*` means both sides, mirrored) and, at a few keyframes over one 3.2 s loop, the world direction each segment points in. The viewer aims each bone along its segment and bakes the result into a normal three.js animation clip, so pause, replay and speed are exact.
- The movement: seated with the thighs under the pads, a slightly wider than shoulder-width grip, a pull to the upper chest with the elbows driving down and back, a short pause, then a slower controlled return. The bar stays in front of the face throughout; a unit test checks that the hands never go behind the shoulders.
- The machine is built from simple shapes and fitted to the seated body. The bar follows the hands every frame.
- Limits: the movement is hand-keyed, not motion capture, and the machine is simplified.

### Tests

A unit test checks every 3D entry in `demos.json`: the body exists, each imported clip was made for this body, every animated bone is in the skeleton and the paint has one entry per vertex. End-to-end tests open the lat pulldown and the bodyweight squat in the real app and check that the model loads, moves, shows the muscle colours (main on the back for the lat pulldown), and that the controls and fallback work.

## Adding hand-picked demos (any exercise)

Put the files in `public/media/demos/` and add an entry to `public/data/demos.json`:

```json
"lat-pulldown": { "angles": [
  { "label": "Rear", "video": [{ "src": "media/demos/lat-pulldown-rear.webm", "type": "video/webm" },
                               { "src": "media/demos/lat-pulldown-rear.mp4",  "type": "video/mp4" }],
    "poster": "media/demos/lat-pulldown-rear.jpg", "credit": "© Vendor, licensed for KYVO", "sample": false },
  { "label": "Side", "image": "media/demos/lat-pulldown-side.jpg", "still": true, "credit": "…" }
]}
```

Use MP4 (H.264) for every browser, with WebM as an optional smaller first source. Keep clips short and looping (2–6 s), 720–1080 px wide, with no audio. `still: true` marks a still image so the app never presents it as an animation. A unit test checks that every file named in `demos.json` exists.

## Importing a licensed library (all 170 exercises at once)

```
node scripts/media/import-pack.mjs --manifest pack.json --dir pack/media \
  --vendor "ExerciseDB" --license "Commercial licence, order #1234"
```

- The manifest can be JSON or CSV with a name column and a media column (GIF, WebP, MP4 or WebM). Common field names are detected automatically.
- Exact name and alias matches are applied, including names that only add the exercise's own equipment ("Cable lat pulldown" = "Lat pulldown").
- Near matches are **not** applied, because a wrong demo is worse than none. They are listed in `storage/media-pack-review.json`. Confirm them in a map file (`{"kyvo-id": "Vendor name"}`) and re-run with `--map`.
- The output goes to `public/media/pack/` and `public/data/media-pack.json`. Both are git-ignored: licensed media must not be published in the repository. Run the import as part of each deploy.
- The CSP already allows self-hosted media (`media-src 'self'`).

## Where to get the 3D anatomy style

The reference screenshots use commercial 3D renders (grey body, red/orange muscles, white background). Those must be licensed, not copied. Options checked on 15 October 2026 (prices are from vendor pages and comparison sites; confirm before buying):

| Source | What you get | Price | Licence | Fit |
|---|---|---|---|---|
| ExerciseDB (exercisedb.io) | ~1,394 exercises, GIF animations (Starter 180/360 px; Pro up to 1080 px) plus metadata | $199 Starter / $599 Pro, one-time | Commercial, self-hosted | **Recommended:** one-time cost, self-hosted, works with the importer |
| MoveKit | 3D clips with muscle highlights, ~582 exercises | $4.99/clip or $299 complete pack | Commercial use included | Good look; API still on a waitlist |
| Gym Animations | Grey 3D model, red highlighted muscles | Not published | Non-exclusive royalty-free | Ask for a quote |
| MuscleWiki API | Filmed real-person videos (not 3D), 1,900+ exercises | $10–$199.99/month | Commercial use in your own app; no redistribution | Ongoing cost; real people, not anatomy |
| Commissioned 3D (Upwork/Fiverr) | Custom renders in exactly KYVO's style | Per clip, quoted | Buy full commercial rights in writing | Best for the 5–10 hero exercises |

Suggested path: buy ExerciseDB Pro (or Starter to test), import it for coverage, and commission or license premium 3D loops for the 5–10 most-used exercises in `demos.json`. Get the licence terms in writing before launch, and keep the receipt with the deploy secrets.

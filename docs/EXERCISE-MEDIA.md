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

**Free demos in use now:** 52 exercises have looping clips made from the free Everkinetic drawings (CC BY-SA 4.0, credited on each clip). Each clip cross-fades the start and end drawings. They are built by `scripts/media/build-everkinetic.mjs`, which only uses exact name matches plus the hand-checked `scripts/media/everkinetic-map.json`. The CC BY-SA licence requires the credit line, and adapted clips must stay under CC BY-SA. The other 118 exercises use the KYVO movement illustration. Everkinetic has no drawing for lat pulldown, chin-up or the shoulder-press machine.

## Live 3D demo: lat pulldown

The lat pulldown has a real-time 3D demo, rendered in the browser with three.js. It is the first source on that exercise's page ("3D"), with Rear, Side and Front camera views, play/pause, replay and 0.5× speed.

| Part | File | Source and licence |
|---|---|---|
| Body (anatomical male, muscle paint) | `public/models/lat-pulldown/body.glb` | OpenGym3D exercise pack (MIT, `LICENSE-opengym3d.txt`) built on the MakeHuman/MPFB2 male (CC0). The pack's `bent_over_row.glb`, used only for its rigged, painted body; its row animation is not used. |
| Lat pulldown movement | `public/models/lat-pulldown/motion.json` | KYVO keyframes (format `kyvo-aim/1`) |
| Machine, lighting, colours | `src/client/visuals/viewer3d.ts` | KYVO code |
| 3D engine | `public/vendor/three/` | three.js r170 (MIT), self-hosted so the CSP stays `script-src 'self'` |

How it works:
- `motion.json` lists body segments (for example `upperarm: [upperarm01.*, lowerarm01.*]`, where `.*` means both sides, mirrored) and, at a few keyframes over one 3.2 s loop, the world direction each segment points in. The viewer aims each bone along its segment, bakes the result into a normal three.js animation clip and plays it with an `AnimationMixer`, so pause, replay and speed are exact.
- The movement: seated with the thighs under the pads, a slightly wider than shoulder-width grip, a pull to the upper chest with the elbows driving down and back, a short pause, then a slower controlled return. The bar stays in front of the face throughout; a unit test checks that the hands never go behind the shoulders.
- The machine is built from simple shapes and fitted to the seated body. The bar follows the hands every frame, and the cable runs from the pulley above the bar.
- The pack's muscle paint is re-coloured at load time: main muscles (upper back, lats) `#E8552B`, assisting (biceps, forearms) `#F2A65A`, skin light grey, and dark-grey shorts. Highlighting is illustrative, not measured muscle activity.
- If WebGL is unavailable or a file fails to load, the viewer shows the movement illustration and a message, and hides the 3D controls.

Limits: the movement is hand-keyed, not motion capture, and the machine is a simplified model. The body is the same for every exercise, so further 3D exercises only need a new `motion.json` (and, for other machines, a machine builder).

To add another exercise in 3D, add `"model3d": { "glb": …, "motion": …, "equipment": …, "credit": … }` to its entry in `demos.json`. The unit test checks that the files exist and that every bone the motion uses is in the model.

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

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

Lat pulldown is the reference exercise. Its current demo is a **placeholder** video rendered from the KYVO illustration, labelled "Sample asset" in the app, to show that playback works. It is not a 3D anatomy render.

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

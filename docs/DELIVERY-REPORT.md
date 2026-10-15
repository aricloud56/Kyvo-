# KYVO — Delivery Report

Date: 15 October 2026. Version 0.1.0.

Status words used throughout:
- **Tested**: implemented and exercised by an automated test that was actually run and passed on this date.
- **Implemented**: built and checked by hand (in the browser or the preview), but no automated test covers it.
- **Partial**: works, with a stated gap.
- **Unverified**: code exists but has not been run against the real external service.

**KYVO is not production-ready yet.** Real Stripe test-mode payments, the Supabase photo storage driver and the legal documents are unverified, and there is no email verification or password reset. Section 10 lists everything.

---

## 1. Summary of what was built

KYVO is a mobile-first web app whose main screen is the **Daily Plan**. Each day it shows:
- today's workout, or a rest day;
- breakfast, lunch, dinner and snack suggestions that fit the user's calorie and protein targets;
- calories and macros eaten against target;
- a checklist and an end-of-day summary.

Onboarding (goal, body stats, experience, equipment, training days, diet, allergies, exclusions) creates the profile, targets, a weekly program and the first Daily Plan straight away.

Around the Daily Plan:
- **Training:** an exercise library (177 exercises), a planner and a live workout logger with progressive overload.
- **Nutrition:** a food diary, 39 recipes and meal swaps.
- **Progress:** analytics from logged data and private progress photos.
- **Billing:** Free and Premium tiers with Stripe.
- **Operations:** an admin dashboard, a landing page with a TikTok attribution funnel, and draft legal pages.

A self-contained interactive **preview** (in-memory sample data, same engine) is published at https://claude.ai/artifact/7Xk5jxSUdH5S6C42AeGChd.

## 2. Technology stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 22, TypeScript 6.0.2, ES modules |
| Server | Node `http` with a small router; no runtime npm dependencies |
| Database | PostgreSQL 16 (tested). Built-in Postgres wire-protocol client. **Row Level Security** on every user table; the app connects as the non-owner `kyvo_app` role |
| Auth | Email + password (scrypt), HTTP-only `SameSite=Lax` session cookies (Secure in production), CSRF header check, per-IP and per-email rate limiting |
| Client | TypeScript SPA, hash routing, no framework; CSS in `public/css/kyvo.css` using the brand tokens |
| Payments | Stripe Checkout, Customer Portal and webhooks over the REST API (HMAC-SHA256 signature check) |
| Storage | Private photo storage: local disk (tested) or Supabase Storage (unverified) |
| Tests | `node:test` (unit and integration), Playwright 1.56.1 driving Chromium at phone size (end-to-end), a local Stripe API mock |
| Lint | `tsc` with unused-code checks, plus ESLint 10 core rules on compiled output (typescript-eslint was not installable here) |

## 3. Completed features

| Area | Feature | Status |
|---|---|---|
| Brand | #111111 / #1C1C1C / #B8F36B / #FFFFFF / #A5A5A5, mobile-first layout, no horizontal overflow at phone width | Tested (e2e checks overflow) |
| Auth | Register (18+ and terms confirmation), sign in, sign out, change password, enumeration-safe login, rate limit | Tested |
| Onboarding | Profile, targets (estimated or manual), weekly program, first Daily Plan | Tested (scenario A) |
| Daily Plan | Workout or rest day, meals for each slot, targets, checklist (auto-ticks on logging), end-of-day summary | Tested (A, D, E) |
| Daily Plan | Regenerate from today after profile changes, keeping past plans and history | Tested |
| Exercises | 177 exercises with steps, cues, mistakes, safety, programming, alternatives; search and filters; favourites; media with fallback | Tested (count, content); UI implemented |
| Workouts | Templates (8), custom workouts, live logger with rest timer, pain flag, review, history, personal records | Tested (B; unit tests for progression and records) |
| Progression | Increase only when all planned work was met; hold after failed work; never increase after pain; reduce after three failures | Tested (unit) |
| Nutrition | Food search (93 foods), custom foods, servings and grams, edit and delete entries, copy yesterday, saved meals, water | Tested (C); other parts implemented |
| Recipes | 39 recipes, filters, servings scaling, allergens, add to diary, meal swaps | Tested (unit, D) |
| Progress | Weight trend with 7-day average, measurements, workouts and volume per week, calorie consistency, records, private photos | Implemented; photo isolation tested |
| Billing | Free vs Premium entitlements, checkout, portal, cancellation, past-due grace, webhook signature, duplicates and out-of-order events | Tested against a mock Stripe API; **real Stripe unverified** |
| Account | Data export (JSON), password-confirmed deletion (cancels the Stripe subscription, removes rows and photos) | Tested |
| Admin | Funnel, subscriptions, campaigns, content quality, exercise and recipe editing, media status, errors, billing events | Access control tested; screens implemented |
| Marketing | Landing page, campaign pages, first-touch UTM attribution, consent-gated TikTok pixel | Tested (attribution); pixel loading implemented |
| Legal | Privacy, terms, subscription terms, health disclaimer, contact (drafts) and a legal review checklist | Implemented as drafts; **needs a lawyer** |

## 4. Exercise count

**177 published exercises** (65 available on Free, 112 Premium). Each has instructions, cues, common mistakes, safety notes and alternatives. The integration test asserts exactly 177 with unique ids and names.

Media: 90 exercises have a demonstration.
- 87 are YouTube videos from the Renaissance Periodization channel. Each was matched by exact title and channel on 14 October 2026; the embed ids are stored, not invented. Re-check them before launch, because videos can be removed.
- 3 are local CC BY clips with attribution.
- The other 80 show a written "video demonstration unavailable" fallback with the step-by-step instructions.
- The admin dashboard lists exercises without media.

Illustrations (added after the first preview):
- Every one of the 177 exercises has an animated start-to-end movement illustration with the primary muscles highlighted, plus a front and back muscle map. 149 are drawn for that exercise; 28 use a close stand-in figure from a similar movement (marked `approx` in `public/data/figures.json`). They are drawn by `scripts/figures/build_figures.py` from the Rep & Plate pose library.
- 12 exercises and 10 recipes have real photos from Wikimedia Commons. Each shows its author, licence and source link in the app (`public/data/photos.json`). Recipe photos are labelled as a serving suggestion of a similar dish.
- A unit test checks that every exercise has a figure and every credited photo file exists.

## 5. Daily Plan generation and personalisation

Code: `src/core/dailyPlan.ts`, `src/core/workouts.ts`, `src/core/meals.ts`, `src/server/services/plan.ts`.

1. **Program**
   - From goal, experience, location, equipment and chosen days, `recommendTemplate` picks one of 8 templates. Free users get the beginner, full-body and home-dumbbell templates.
   - `generateProgram` fills each slot with exercises the user's equipment allows (`exerciseAvailable`). It avoids excluded exercises and sets sets, reps and rest per goal and level (`prescribe`).
   - Training days are the user's chosen weekdays; other days are rest days.
2. **Today**
   - `buildDailyPlan` takes the date's workout (or none), the targets, the recipe catalogue and recent history.
   - Each exercise gets a load suggestion from the last completed sessions (`suggestLoad`).
     - It increases only when every planned set reached the top of the rep range.
     - It holds after missed reps, never increases after reported pain, and reduces by about 10% after three failed sessions.
3. **Meals**
   - `planMeals` splits the day's calories and protein across slots.
   - Candidate recipes are filtered by diet, allergens, exclusions and plan tier.
   - Each candidate is scored on distance from the slot's calorie target, any protein shortfall, recent repetition and prep time, with a small seeded random term so plans vary day to day but are stable on reload.
   - Portions are scaled in steps to fit.
   - Swaps (`swapOptions`) rank alternatives of similar calories and protein.
4. **Checklist**
   - The checklist holds: the workout (or an optional recovery walk), the three main meals, water (if turned on) and a day review.
   - Logging a workout or meal ticks the matching item automatically.
5. **Summary**
   - `summariseDay` compares calories and protein eaten with the targets, plus checklist completion and new records.
6. **Persistence**
   - Plans are stored per user per date.
   - Profile changes offer to regenerate from today forward. Past plans and all logs are kept.

## 6. Nutrition data and calculation method

- **Targets.** Code: `src/core/nutrition.ts`.
  - BMR uses the **Mifflin-St Jeor** equation, with the midpoint of the age range and the midpoint of the two sex equations when sex is unspecified.
  - TDEE = BMR × (activity factor + 0.025 per training day, up to +0.15).
  - Goal adjustment: −18% for fat loss, +8% for muscle gain, +5% for strength.
  - There is no deficit when BMI is under 18.5, and calories never drop below 1200 (female), 1500 (male) or 1350 (unspecified).
  - Protein is 2.0 g/kg for fat loss and 1.8 g/kg otherwise, using a reference weight when BMI is over 30.
  - Fat is at least 25% of calories or 0.6 g/kg. Carbs are the remainder.
  - Users can enter manual targets instead; these are checked for consistency.
  - Every estimate carries a "not medical or dietetic advice" note.
- **Food data.** 93 generic foods with values per 100 g, modelled on typical Australian (FSANZ AFCD) and USDA FoodData Central values. **They are approximate generic values, not a licensed database import**, and each is labelled so in the data. Users can add their own foods.
- **Recipes.** Nutrition is calculated from the ingredient grams and the food data (`recipeNutrition`), never typed in by hand, and scales with servings. Allergens are derived from ingredient tags.
- **Not built:** barcode scanning, photo food recognition and AI estimation. None of these is claimed anywhere in the app.

## 7. Payment integration status

| Item | Status |
|---|---|
| Prices: A$9.99/month, A$79.99/year (`src/core/plans.ts`) | Implemented |
| Checkout session, Customer Portal, cancellation on account deletion | Tested against the mock Stripe API |
| Webhook signature check, forged-signature rejection | Tested |
| Duplicate events ignored (`billing_events`), stale out-of-order events ignored | Tested |
| Cancel at period end keeps Premium until the end; `past_due` 3-day grace; `unpaid`/`canceled` end access | Tested |
| Premium only from server-side subscription records; users cannot set it themselves (RLS) | Tested |
| **Real Stripe test mode** | **Unverified**: no Stripe keys were available. Follow README section 4 before any live payment. |
| GST / tax configuration | Not done: needs an accountant's decision |

## 8. Test commands and actual results

All of these were run on 15 October 2026 against PostgreSQL 16 and Chromium (Playwright 1.56.1). The results are from that run:

| Command | Result |
|---|---|
| `npm run lint` | Passed (strict TypeScript, build, ESLint: 0 problems) |
| `npm run typecheck` | Passed |
| `npm run test:unit` | **19 / 19 passed** |
| `npm run test:integration` | **19 / 19 passed** |
| `npm run test:e2e` | **7 / 7 passed** |

The end-to-end tests cover the required scenarios:
- A: register, onboard and see a populated Daily Plan.
- B: start the workout, log sets, finish, refresh, and the session is still saved.
- C: log a food, change the serving, and the totals update.
- D: swap a meal, and the plan and totals update.
- E: a rest day has no workout requirement.
- F: test checkout grants Premium; cancelling keeps it to the period end; then access ends.
- G: another user's data and the admin pages are unreachable.

Integration tests also cover:
- direct-SQL RLS isolation;
- users cannot self-grant admin or Premium;
- cross-user 404s, including photos;
- Free-tier limits;
- export and deletion;
- the auth rate limit;
- that admin is only granted by an operator, never by email.

Bugs found by the tests and fixed:
- logging the first meal returned a 500 (an RLS policy was missing);
- a stale UI event handler after re-rendering;
- the subscription interval was stored in Stripe's words rather than the app's.

## 9. Production build status

`npm run build` **succeeds**: server and client compile into `dist/`. `npm run preview` builds the static preview, which was published and loaded headless without console errors.

## 10. Known bugs and limitations

- Real Stripe test-mode payments have not been run (mock only).
- The Supabase Storage driver for photos has not been run against a real project; local disk storage is tested.
- No email verification and no password reset email: there is no email provider configured. Users who forget their password currently need support.
- Progress photos are not resized or compressed (5 MB limit); there is no EXIF stripping.
- Lists cap at 200 rows; there is no pagination for very long histories.
- Rate limiting is in memory, so it only works per process; use a shared limiter before running more than one instance.
- Food values are approximate generic values (section 6).
- 87 of 177 exercises have no video, only written instructions. The YouTube links should be re-checked before launch.
- ESLint runs without typescript-eslint (unavailable here); type safety relies on strict `tsc`.
- In the preview only: data lives in memory and resets on reload, the history is labelled sample data, YouTube demos open as links, and sign-in, photo upload and admin are switched off.

## 11. Environment variables and credentials

See `.env.example` and README section 3. Credentials still needed from you:
- a PostgreSQL database (Supabase or similar), with owner and app passwords;
- Stripe test keys, the two Price ids and a webhook secret (live keys later);
- optionally Supabase Storage keys and a TikTok pixel id.

No secrets are in the repository.

## 12. Local setup

README section 2, in short:
1. Install Node 22 and Postgres.
2. Run `npm install`, then `npm run build`.
3. `createdb`, then `db:migrate` with `DATABASE_ADMIN_URL`.
4. `alter role kyvo_app login password ...`
5. `db:seed`.
6. `node --env-file=.env dist/src/server/main.js`.
7. `make-admin` for the operator.

## 13. Deployment

README section 6 covers it: any Node 22 host plus managed Postgres. The steps are:
1. Build with `npm ci && npm run build`.
2. Start with `node dist/src/server/main.js`.
3. Run migrate and seed once with the owner connection.
4. Serve over HTTPS only.
5. Configure the Stripe webhook to `/api/stripe/webhook`.
6. Turn on daily database backups and a restore test.

## 14. Remaining legal and launch checks

Full list: `docs/LEGAL-REVIEW.md`.
- Have an Australian lawyer review the privacy policy, terms, subscription terms and health disclaimer.
  - The privacy documents must cover the Privacy Act 1988 and the APPs; sensitive health information needs consent.
  - The terms must comply with the Australian Consumer Law, including auto-renewal disclosure and refunds.
- Fill in the placeholders: business name, ABN, address, governing State, and real support and privacy emails.
- Decide GST with an accountant.
- Confirm the crisis line in the disclaimer (the Butterfly Foundation number) and the halal note on prawns in recipes.
- Confirm the TikTok pixel setup and cookie consent wording. The pixel only sends page and button events: no health, diary or body data.
- Run the Stripe test checklist (README section 4) before switching to live keys.
- Re-check the YouTube links. Choose an email provider and add verification and password reset.
- Do an accessibility pass with a screen reader on a real phone.

## 15. Acceptance checklist (prompt section 19)

| # | Criterion | Status | Evidence / what is missing |
|---|---|---|---|
| 1 | Brand styling is consistent | Implemented | Brand tokens in `kyvo.css`; e2e checks phone-width layout |
| 2 | Authentication works | Tested | Integration auth tests; e2e scenario A |
| 3 | Onboarding creates a usable profile | Tested | Scenario A; integration onboarding test |
| 4 | Daily Plan is the main screen | Tested | App opens on Today; scenario A |
| 5 | Daily Plan has a workout or an appropriate rest day | Tested | Scenarios A and E; unit rest-day test |
| 6 | Daily Plan has meal suggestions | Tested | Scenario A; integration plan test |
| 7 | Calories and macros come from actual data | Tested | Unit tests on targets and recipe nutrition; scenario C totals |
| 8 | Users can log and swap meals | Tested | Scenarios C and D |
| 9 | Workout and nutrition changes persist | Tested | Scenario B (refresh), C, D |
| 10 | At least 150 exercises | Tested | 177, asserted in integration test |
| 11 | Instructions and media fallbacks work | Implemented | Every exercise has steps; 80 without video show the fallback (checked in the preview) |
| 12 | Users can complete and review workouts | Tested | Scenario B |
| 13 | Checklists persist | Tested | Integration auto-checklist test; scenario A |
| 14 | Progress analytics use real data | Implemented | Computed from logs in `services/progress.ts`; no automated chart test |
| 15 | User data is isolated | Tested | RLS direct-SQL test; cross-user 404s; scenario G |
| 16 | Entitlements are enforced securely | Tested | Free-limit 402s; users cannot set Premium; webhook-only grants |
| 17 | Subscription test flows work | Partial | Tested with a mock Stripe API (scenario F, integration). **Real Stripe test mode not run: no keys.** |
| 18 | Admin access is restricted | Tested | 401/403 tests; operator-only grant |
| 19 | Account deletion exists | Tested | Integration export/delete test |
| 20 | Privacy and legal pages exist | Implemented (drafts) | `legal/*.html`; **need legal review and placeholders filled** |
| 21 | TikTok attribution is appropriate | Tested | First-touch UTM attribution tested in e2e; pixel consent-gated with no health data (code review) |
| 22 | Automated tests have actually been run | Tested | 17 + 19 + 7 passed on 15 Oct 2026 |
| 23 | Production build succeeds | Tested | `npm run build` passed |
| 24 | Deployment documentation is complete | Implemented | README sections 2–8 and `.env.example` |
| 25 | Unfinished features and dependencies are documented | Implemented | Sections 7, 10, 11 and 14 of this report |

**Incomplete criteria:**
- #17 needs Stripe test keys, which were not available in this environment.
- #20 needs a lawyer and your business details.

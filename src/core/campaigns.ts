// Campaign landing pages for TikTok traffic (/l/<slug>). Copy is factual: no statistics, testimonials or result promises.

export interface Campaign {
  slug: string;
  headline: string;
  sub: string;
  bullets: string[];
  cta: string;
  goal?: 'muscle_gain' | 'fat_loss' | 'strength' | 'general';
  experience?: 'beginner';
}

export const CAMPAIGNS: Campaign[] = [
  { slug: 'daily-plan', headline: 'Know exactly what to train and eat today.', sub: 'KYVO builds one personalised Daily Plan: your workout, your meals, your calorie and protein targets, and a simple checklist.', bullets: ['Today’s workout with sets, reps and weights', 'Meals portioned to your calorie and protein targets', 'A checklist that keeps the day simple'], cta: 'Get my free plan' },
  { slug: 'beginner', headline: 'New to the gym? Start with a plan made for you.', sub: 'Simple workouts with clear instructions for every exercise, and meals that fit your goal.', bullets: ['Beginner-friendly exercises with step-by-step instructions', 'Clear sets, reps and rest times', 'Weight suggestions that progress gradually'], cta: 'Build my beginner plan', experience: 'beginner' },
  { slug: 'high-protein', headline: 'Hit your protein without overthinking it.', sub: 'KYVO plans high-protein meals around your target and shows what’s left for the day as you log.', bullets: ['High-protein breakfasts, lunches, dinners and snacks', 'Recipes with ingredient quantities and macros', 'One-tap logging for planned meals'], cta: 'See my protein plan' },
  { slug: 'fat-loss', headline: 'A fat-loss plan you can actually follow.', sub: 'Strength training to keep muscle, and meals portioned to a sensible calorie target. Estimates, not crash diets.', bullets: ['Calorie and macro targets you can adjust', 'Meals you can swap without breaking your plan', 'Weight trend that smooths day-to-day swings'], cta: 'Start my fat-loss plan', goal: 'fat_loss' },
  { slug: 'muscle', headline: 'Build muscle with a plan that adds up.', sub: 'Progressive workouts that tell you when to add weight, plus meals that fuel your training.', bullets: ['Hypertrophy-focused programs', 'Progressive overload suggestions after each session', 'Calorie surplus and protein targets set for you'], cta: 'Build my muscle plan', goal: 'muscle_gain' },
];

export const CAMPAIGN_BY_SLUG = new Map(CAMPAIGNS.map((c) => [c.slug, c]));

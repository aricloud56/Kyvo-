// Entry point for the KYVO web app.
import { route, start } from './app.js';

route(/^\/(login|signup)/, async () => (await import('./screens/auth.js')).authScreen, { public: true, bare: true });
route(/^\/onboarding/, async () => (await import('./screens/onboarding.js')).onboardingScreen, { bare: true });
route(/^\/today$/, async () => (await import('./screens/today.js')).todayScreen, { tab: 'today' });
route(/^\/day\/(\d{4}-\d{2}-\d{2})$/, async () => (await import('./screens/today.js')).todayScreen, { tab: 'today' });
route(/^\/workout$/, async () => (await import('./screens/workout.js')).liveWorkoutScreen, { bare: true });
route(/^\/session\/([0-9a-f-]{36})$/, async () => (await import('./screens/workout.js')).sessionScreen, { tab: 'train' });
route(/^\/train$/, async () => (await import('./screens/train.js')).trainScreen, { tab: 'train' });
route(/^\/train\/workout\/([0-9a-f-]{36}|new)$/, async () => (await import('./screens/train.js')).editWorkoutScreen, { tab: 'train' });
route(/^\/train\/history$/, async () => (await import('./screens/train.js')).historyScreen, { tab: 'train' });
route(/^\/library$/, async () => (await import('./screens/library.js')).libraryScreen, { tab: 'train' });
route(/^\/exercise\/([a-z0-9-]+)$/, async () => (await import('./screens/library.js')).exerciseScreen, { tab: 'train' });
route(/^\/nutrition$/, async () => (await import('./screens/nutrition.js')).nutritionScreen, { tab: 'food' });
route(/^\/nutrition\/(\d{4}-\d{2}-\d{2})$/, async () => (await import('./screens/nutrition.js')).nutritionScreen, { tab: 'food' });
route(/^\/recipes$/, async () => (await import('./screens/recipes.js')).recipesScreen, { tab: 'food' });
route(/^\/recipe\/([a-z0-9-]+)$/, async () => (await import('./screens/recipes.js')).recipeScreen, { tab: 'food' });
route(/^\/progress$/, async () => (await import('./screens/progress.js')).progressScreen, { tab: 'progress' });
route(/^\/profile$/, async () => (await import('./screens/profile.js')).profileScreen, { tab: 'profile' });
route(/^\/premium$/, async () => (await import('./screens/profile.js')).premiumScreen, { tab: 'profile' });
route(/^\/admin$/, async () => (await import('./screens/admin.js')).adminScreen, { tab: 'profile' });

start();

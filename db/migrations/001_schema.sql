-- KYVO schema. All application tables live in the "kyvo" schema (not exposed by Supabase's REST API).
-- Planned activities (daily_plans, user_workouts, user_schedule) are stored separately from what the
-- user actually did (workout_sessions, session_sets, food_logs, checklist_items, body_metrics).

create extension if not exists pgcrypto;
create schema if not exists kyvo;

-- Request context set by the server at the start of every transaction.
create or replace function kyvo.uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;
create or replace function kyvo.is_system() returns boolean language sql stable as $$
  select coalesce(current_setting('app.system', true), '') = 'on'
$$;

-- ---------- accounts ----------
create table kyvo.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  analytics_consent boolean not null default false,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index users_email_lower on kyvo.users (lower(email));

create table kyvo.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references kyvo.users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user on kyvo.sessions (user_id);

create table kyvo.profiles (
  user_id uuid primary key references kyvo.users(id) on delete cascade,
  display_name text not null default '' check (length(display_name) <= 60),
  age_range text check (age_range in ('18-24','25-34','35-44','45-54','55-64','65+')),
  sex text not null default 'unspecified' check (sex in ('male','female','unspecified')),
  height_cm numeric(5,1) check (height_cm between 120 and 230),
  weight_kg numeric(5,1) check (weight_kg between 35 and 300),
  goal text not null default 'general' check (goal in ('muscle_gain','fat_loss','strength','general')),
  experience text not null default 'beginner' check (experience in ('beginner','intermediate','advanced')),
  location text not null default 'gym' check (location in ('gym','home','both')),
  equipment text[] not null default '{}',
  training_days smallint[] not null default '{1,3,5}',
  session_minutes smallint not null default 60 check (session_minutes between 15 and 150),
  training_style text not null default 'balanced' check (training_style in ('balanced','machines','free_weights')),
  diet text not null default 'none' check (diet in ('none','vegetarian','vegan','pescatarian','halal')),
  allergies text[] not null default '{}',
  exclusions text[] not null default '{}',
  units text not null default 'metric' check (units in ('metric','imperial')),
  activity text not null default 'light' check (activity in ('sedentary','light','moderate','high')),
  hydration_enabled boolean not null default false,
  hydration_target_ml integer not null default 2500 check (hydration_target_ml between 500 and 6000),
  template_pref text not null default 'auto',
  timezone text not null default 'Australia/Sydney',
  onboarding_completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table kyvo.nutrition_targets (
  id bigint generated always as identity primary key,
  user_id uuid not null references kyvo.users(id) on delete cascade,
  kcal integer not null check (kcal between 1000 and 6000),
  protein_g integer not null check (protein_g between 0 and 400),
  carbs_g integer not null check (carbs_g between 0 and 900),
  fat_g integer not null check (fat_g between 0 and 300),
  source text not null check (source in ('estimated','manual')),
  notes jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index nutrition_targets_user on kyvo.nutrition_targets (user_id, created_at desc);

-- ---------- content ----------
create table kyvo.exercises (
  id text primary key,
  name text not null,
  category text not null,
  groups text[] not null,
  primary_muscles text[] not null,
  secondary_muscles text[] not null default '{}',
  equipment text[] not null,
  difficulty text not null check (difficulty in ('beginner','intermediate','advanced')),
  mechanic text not null,
  logging text not null check (logging in ('weight_reps','reps','time','distance_time')),
  increment numeric(4,1) not null default 0,
  pattern text not null,
  premium boolean not null default false,
  content jsonb not null,
  published boolean not null default true,
  updated_at timestamptz not null default now()
);
create unique index exercises_name_lower on kyvo.exercises (lower(name));
create index exercises_groups on kyvo.exercises using gin (groups);

create table kyvo.exercise_media (
  id bigint generated always as identity primary key,
  exercise_id text not null references kyvo.exercises(id) on delete cascade,
  kind text not null check (kind in ('youtube','video','image')),
  ref text not null,
  title text not null default '',
  source text not null default '',
  license text not null default '',
  attribution text not null default '',
  verified_note text not null default '',
  status text not null default 'active' check (status in ('active','hidden','broken')),
  created_at timestamptz not null default now()
);
create index exercise_media_ex on kyvo.exercise_media (exercise_id);

create table kyvo.foods (
  id text primary key,
  owner_id uuid references kyvo.users(id) on delete cascade, -- null = curated KYVO food
  name text not null,
  kcal numeric(6,1) not null check (kcal >= 0 and kcal <= 950),
  protein numeric(5,1) not null check (protein >= 0 and protein <= 100),
  carbs numeric(5,1) not null check (carbs >= 0 and carbs <= 100),
  fat numeric(5,1) not null check (fat >= 0 and fat <= 100),
  fibre numeric(5,1) not null default 0,
  serving_label text not null default '100 g',
  serving_g numeric(6,1) not null default 100 check (serving_g > 0),
  tags text[] not null default '{}',
  source text not null default '',
  created_at timestamptz not null default now()
);
create index foods_owner on kyvo.foods (owner_id);

create table kyvo.recipes (
  id text primary key,
  name text not null,
  description text not null default '',
  servings smallint not null check (servings between 1 and 20),
  prep_min smallint not null default 0,
  cook_min smallint not null default 0,
  steps jsonb not null,
  storage text not null default '',
  subs jsonb not null default '[]',
  meal_types text[] not null,
  tags text[] not null default '{}',
  premium boolean not null default false,
  image text,
  published boolean not null default true,
  updated_at timestamptz not null default now()
);

create table kyvo.recipe_ingredients (
  recipe_id text not null references kyvo.recipes(id) on delete cascade,
  position smallint not null,
  food_id text not null references kyvo.foods(id),
  grams numeric(7,1) not null check (grams > 0),
  primary key (recipe_id, position)
);

create table kyvo.workout_templates (
  id text primary key,
  name text not null,
  description text not null default '',
  days smallint not null,
  premium boolean not null default false,
  definition jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------- planned ----------
create table kyvo.user_workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references kyvo.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  focus text not null default '',
  exercises jsonb not null default '[]',
  source text not null default 'generated' check (source in ('generated','custom')),
  template_id text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index user_workouts_user on kyvo.user_workouts (user_id) where not archived;

create table kyvo.user_schedule (
  user_id uuid not null references kyvo.users(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  workout_id uuid references kyvo.user_workouts(id) on delete set null,
  primary key (user_id, weekday)
);

create table kyvo.schedule_overrides (
  user_id uuid not null references kyvo.users(id) on delete cascade,
  plan_date date not null,
  workout_id uuid references kyvo.user_workouts(id) on delete set null, -- null = rest
  primary key (user_id, plan_date)
);

create table kyvo.daily_plans (
  id bigint generated always as identity primary key,
  user_id uuid not null references kyvo.users(id) on delete cascade,
  plan_date date not null,
  plan jsonb not null,
  version integer not null default 1,
  generated_at timestamptz not null default now(),
  unique (user_id, plan_date)
);

-- ---------- actual ----------
create table kyvo.checklist_items (
  user_id uuid not null references kyvo.users(id) on delete cascade,
  plan_date date not null,
  key text not null,
  done boolean not null default false,
  done_at timestamptz,
  primary key (user_id, plan_date, key)
);

create table kyvo.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references kyvo.users(id) on delete cascade,
  plan_date date not null,
  workout_id uuid references kyvo.user_workouts(id) on delete set null,
  name text not null,
  planned jsonb not null default '[]',
  status text not null default 'in_progress' check (status in ('in_progress','completed','discarded')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  notes text not null default '' check (length(notes) <= 2000),
  pain_reported boolean not null default false
);
create index workout_sessions_user on kyvo.workout_sessions (user_id, plan_date desc);
create unique index workout_sessions_one_active on kyvo.workout_sessions (user_id) where status = 'in_progress';

create table kyvo.session_sets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references kyvo.workout_sessions(id) on delete cascade,
  user_id uuid not null references kyvo.users(id) on delete cascade,
  exercise_id text not null references kyvo.exercises(id),
  set_index smallint not null check (set_index between 0 and 49),
  weight_kg numeric(6,2) check (weight_kg between 0 and 1000),
  reps smallint check (reps between 0 and 1000),
  duration_sec integer check (duration_sec between 0 and 86400),
  distance_m integer check (distance_m between 0 and 500000),
  completed boolean not null default true,
  pain boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (session_id, exercise_id, set_index)
);
create index session_sets_user_ex on kyvo.session_sets (user_id, exercise_id);

create table kyvo.personal_records (
  id bigint generated always as identity primary key,
  user_id uuid not null references kyvo.users(id) on delete cascade,
  exercise_id text not null references kyvo.exercises(id),
  kind text not null check (kind in ('weight','e1rm','reps','duration')),
  value numeric(8,2) not null,
  session_id uuid references kyvo.workout_sessions(id) on delete cascade,
  achieved_on date not null
);
create index personal_records_user on kyvo.personal_records (user_id, achieved_on desc);

create table kyvo.food_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references kyvo.users(id) on delete cascade,
  log_date date not null,
  meal_slot text not null check (meal_slot in ('breakfast','lunch','dinner','snack')),
  food_id text references kyvo.foods(id) on delete set null,
  recipe_id text references kyvo.recipes(id) on delete set null,
  name text not null,
  grams numeric(7,1),
  portion numeric(5,2),
  -- Nutrition is snapshotted at log time so history never changes when content is edited.
  kcal numeric(7,1) not null check (kcal >= 0),
  protein numeric(6,1) not null check (protein >= 0),
  carbs numeric(6,1) not null check (carbs >= 0),
  fat numeric(6,1) not null check (fat >= 0),
  from_plan boolean not null default false,
  created_at timestamptz not null default now(),
  check ((food_id is not null and grams is not null) or (recipe_id is not null and portion is not null) or (food_id is null and recipe_id is null))
);
create index food_logs_user_date on kyvo.food_logs (user_id, log_date);

create table kyvo.favourites (
  user_id uuid not null references kyvo.users(id) on delete cascade,
  kind text not null check (kind in ('exercise','food','recipe')),
  ref_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, ref_id)
);

create table kyvo.saved_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references kyvo.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  items jsonb not null,
  created_at timestamptz not null default now()
);

create table kyvo.hydration_logs (
  user_id uuid not null references kyvo.users(id) on delete cascade,
  log_date date not null,
  ml integer not null default 0 check (ml between 0 and 20000),
  primary key (user_id, log_date)
);

create table kyvo.body_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references kyvo.users(id) on delete cascade,
  measured_on date not null,
  weight_kg numeric(5,1) check (weight_kg between 30 and 350),
  waist_cm numeric(5,1) check (waist_cm between 30 and 250),
  chest_cm numeric(5,1) check (chest_cm between 40 and 250),
  hips_cm numeric(5,1) check (hips_cm between 40 and 250),
  arm_cm numeric(5,1) check (arm_cm between 10 and 80),
  thigh_cm numeric(5,1) check (thigh_cm between 20 and 120),
  created_at timestamptz not null default now(),
  unique (user_id, measured_on)
);

create table kyvo.progress_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references kyvo.users(id) on delete cascade,
  taken_on date not null,
  storage_key text not null unique,
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp')),
  bytes integer not null,
  created_at timestamptz not null default now()
);

-- ---------- billing ----------
create table kyvo.billing_customers (
  user_id uuid primary key references kyvo.users(id) on delete cascade,
  stripe_customer_id text not null unique
);

create table kyvo.subscriptions (
  stripe_subscription_id text primary key,
  user_id uuid references kyvo.users(id) on delete set null,
  stripe_customer_id text not null,
  status text not null,
  price_id text,
  plan_interval text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  stripe_updated_at bigint not null default 0, -- event "created" time, to ignore out-of-order events
  updated_at timestamptz not null default now()
);
create index subscriptions_user on kyvo.subscriptions (user_id);

create table kyvo.billing_events (
  id text primary key, -- Stripe event id; the primary key makes processing idempotent
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  summary jsonb not null default '{}'
);

-- ---------- growth & operations ----------
create table kyvo.attribution (
  user_id uuid primary key references kyvo.users(id) on delete cascade,
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  landing_path text, referrer_host text,
  first_seen_at timestamptz
);

-- First-party funnel events. Never contains health, food, body or workout details.
create table kyvo.product_events (
  id bigint generated always as identity primary key,
  user_id uuid references kyvo.users(id) on delete set null,
  name text not null check (name in ('landing_view','signup','onboarding_complete','first_workout','workout_complete','first_meal_log','checkout_started','subscribed','canceled')),
  campaign text,
  created_at timestamptz not null default now()
);
create index product_events_name on kyvo.product_events (name, created_at);

create table kyvo.error_logs (
  id bigint generated always as identity primary key,
  request_id text not null,
  route text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create table kyvo.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  target text not null,
  created_at timestamptz not null default now()
);

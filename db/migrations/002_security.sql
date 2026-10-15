-- Row Level Security. The application connects as the non-owner role "kyvo_app"; every request runs in a
-- transaction that sets app.user_id (the signed-in user) or app.system = 'on' (trusted server jobs such as
-- sign-in lookups, Stripe webhooks and admin aggregates). FORCE makes the policies apply to the owner too.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'kyvo_app') then
    create role kyvo_app nologin;
  end if;
end $$;

grant usage on schema kyvo to kyvo_app;
grant select, insert, update, delete on all tables in schema kyvo to kyvo_app;
grant usage, select on all sequences in schema kyvo to kyvo_app;
grant execute on all functions in schema kyvo to kyvo_app;

-- Tables owned by one user through a user_id column.
do $$
declare t text;
begin
  foreach t in array array['profiles','nutrition_targets','user_workouts','user_schedule','schedule_overrides','daily_plans',
    'checklist_items','workout_sessions','session_sets','personal_records','food_logs','favourites','saved_meals',
    'hydration_logs','body_metrics','progress_photos','attribution'] loop
    execute format('alter table kyvo.%I enable row level security', t);
    execute format('alter table kyvo.%I force row level security', t);
    execute format('create policy owner_all on kyvo.%I for all using (user_id = kyvo.uid() or kyvo.is_system()) with check (user_id = kyvo.uid() or kyvo.is_system())', t);
  end loop;
end $$;

-- Accounts: a user can read and update only their own row; creation and sessions are server-only.
alter table kyvo.users enable row level security;
alter table kyvo.users force row level security;
create policy self_select on kyvo.users for select using (id = kyvo.uid() or kyvo.is_system());
create policy self_update on kyvo.users for update using (id = kyvo.uid() or kyvo.is_system()) with check (id = kyvo.uid() or kyvo.is_system());
create policy system_insert on kyvo.users for insert with check (kyvo.is_system());
create policy self_delete on kyvo.users for delete using (id = kyvo.uid() or kyvo.is_system());

-- Users may never change their own role: only trusted server code (app.system) can.
create or replace function kyvo.protect_role() returns trigger language plpgsql as $$
begin
  if new.role is distinct from old.role and not kyvo.is_system() then
    raise exception 'role can only be changed by the system';
  end if;
  return new;
end $$;
create trigger users_protect_role before update on kyvo.users for each row execute function kyvo.protect_role();

do $$
declare t text;
begin
  foreach t in array array['sessions','billing_events','error_logs','audit_log','product_events'] loop
    execute format('alter table kyvo.%I enable row level security', t);
    execute format('alter table kyvo.%I force row level security', t);
    execute format('create policy system_only on kyvo.%I for all using (kyvo.is_system()) with check (kyvo.is_system())', t);
  end loop;
end $$;

-- Billing: users can read their own records; only verified webhooks (system) write them.
do $$
declare t text;
begin
  foreach t in array array['billing_customers','subscriptions'] loop
    execute format('alter table kyvo.%I enable row level security', t);
    execute format('alter table kyvo.%I force row level security', t);
    execute format('create policy owner_read on kyvo.%I for select using (user_id = kyvo.uid() or kyvo.is_system())', t);
    execute format('create policy system_write on kyvo.%I for all using (kyvo.is_system()) with check (kyvo.is_system())', t);
  end loop;
end $$;

-- Shared content: everyone signed in can read published content; only the system/admin path can write.
do $$
declare t text;
begin
  foreach t in array array['exercises','exercise_media','recipes','recipe_ingredients','workout_templates'] loop
    execute format('alter table kyvo.%I enable row level security', t);
    execute format('alter table kyvo.%I force row level security', t);
    execute format('create policy read_all on kyvo.%I for select using (true)', t);
    execute format('create policy system_write on kyvo.%I for all using (kyvo.is_system()) with check (kyvo.is_system())', t);
  end loop;
end $$;

-- Foods: curated foods are public; custom foods belong to their creator.
alter table kyvo.foods enable row level security;
alter table kyvo.foods force row level security;
create policy read_foods on kyvo.foods for select using (owner_id is null or owner_id = kyvo.uid() or kyvo.is_system());
create policy own_foods on kyvo.foods for all using (owner_id = kyvo.uid() or kyvo.is_system()) with check (owner_id = kyvo.uid() or kyvo.is_system());

-- Supabase: keep the kyvo schema away from the public REST API roles if they exist.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on schema kyvo from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on schema kyvo from authenticated; end if;
end $$;

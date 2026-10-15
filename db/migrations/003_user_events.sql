-- Let the app record a signed-in user's own product milestones (e.g. first meal logged) inside that user's
-- transaction. Users still cannot read, change or delete any product event; only the system role can.
create policy own_insert on kyvo.product_events for insert
  with check (user_id = kyvo.uid() and name in ('first_meal_log', 'first_workout', 'workout_complete', 'onboarding_complete'));

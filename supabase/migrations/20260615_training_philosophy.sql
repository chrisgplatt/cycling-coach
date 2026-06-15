alter table training_plans
  add column if not exists training_philosophy jsonb;

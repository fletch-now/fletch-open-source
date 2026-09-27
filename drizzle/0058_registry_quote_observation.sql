-- Preserve the input used for each pool's USD conversion alongside its pinned state.
alter table registry_priority_pools add column if not exists quote_observation jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='registry_priority_pools'::regclass
    and conname='registry_priority_pools_quote_observation_check') then
    alter table registry_priority_pools add constraint registry_priority_pools_quote_observation_check
      check (quote_observation is null or jsonb_typeof(quote_observation)='object');
  end if;
end $$;

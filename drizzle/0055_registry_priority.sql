-- Additive priority observations. Existing catalog, history and holder ledger stay intact.
create table if not exists registry_priority_tokens (
  chain_id integer not null,
  address text not null,
  asset_id text,
  role text not null check (role in ('listed','community','alternative')),
  group_key text not null,
  dominant_address text,
  selection_reason text not null,
  close_call boolean not null default false,
  rank integer not null check (rank >= 0),
  selected_at timestamptz not null,
  primary key(chain_id,address),
  check (address ~ '^0x[0-9a-f]{40}$'),
  check (dominant_address is null or dominant_address ~ '^0x[0-9a-f]{40}$')
);
create index if not exists registry_priority_tokens_display_idx on registry_priority_tokens(chain_id,role,rank);
create index if not exists registry_priority_tokens_group_idx on registry_priority_tokens(chain_id,group_key);

create table if not exists registry_priority_pools (
  chain_id integer not null,
  pool_id text not null,
  address text not null,
  selected boolean not null default false,
  selected_at timestamptz,
  method text not null check (method in ('v3_quote_holdings','v4_bounded_one_percent')),
  depth_usd numeric check (depth_usd >= 0),
  price_usd numeric check (price_usd >= 0),
  source text not null,
  reason text,
  observed_at timestamptz,
  attempted_at timestamptz not null,
  block_number bigint,
  block_hash text,
  factory_created_block bigint not null,
  factory_created_hash text,
  quote_price_source text,
  primary key(chain_id,pool_id),
  check (address ~ '^0x[0-9a-f]{40}$')
);
create index if not exists registry_priority_pools_selected_idx on registry_priority_pools(chain_id,selected,address);

create table if not exists registry_token_observations (
  chain_id integer not null,
  address text not null,
  metadata jsonb,
  holders jsonb,
  holder_scan jsonb,
  metadata_attempted_at timestamptz,
  holders_attempted_at timestamptz,
  primary key(chain_id,address),
  check (address ~ '^0x[0-9a-f]{40}$'),
  check (metadata is null or jsonb_typeof(metadata)='object'),
  check (holders is null or jsonb_typeof(holders)='object'),
  check (holder_scan is null or jsonb_typeof(holder_scan)='object')
);

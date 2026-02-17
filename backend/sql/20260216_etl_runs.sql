create extension if not exists "pgcrypto";

create table if not exists etl_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  status text not null check (status in ('RUNNING', 'SUCCESS', 'FAILED')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_sec numeric,
  error text,
  stats jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists etl_runs_job_name_idx on etl_runs (job_name);
create index if not exists etl_runs_started_at_idx on etl_runs (started_at desc);

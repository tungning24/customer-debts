create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sort_order integer,
  active boolean not null default true
);

create table if not exists public.debt_entries (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  date date not null,
  amount numeric(12, 2) not null check (amount > 0),
  status text not null default 'open' check (status in ('open', 'paid')),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at date
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  date date not null,
  amount numeric(12, 2) not null check (amount > 0),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'close'))
);

create index if not exists customers_sort_order_idx on public.customers (sort_order, name);
create index if not exists debt_entries_customer_status_idx on public.debt_entries (customer_id, status, date, created_at);
create index if not exists payments_customer_status_idx on public.payments (customer_id, status, date, created_at);

alter table public.customers enable row level security;
alter table public.debt_entries enable row level security;
alter table public.payments enable row level security;

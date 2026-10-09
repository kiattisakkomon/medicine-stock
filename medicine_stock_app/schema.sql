-- Medicine Stock System / Supabase PostgreSQL
-- Run in SQL Editor on a NEW project. Existing tables with same names may require migration.
create extension if not exists pgcrypto;

create table if not exists public.medicines (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  generic_name text,
  unit text not null default 'เม็ด',
  min_stock numeric(14,2) not null default 0 check (min_stock >= 0),
  note text,
  created_at timestamptz not null default now()
);
create table if not exists public.lots (
  id uuid primary key default gen_random_uuid(),
  medicine_id uuid not null references public.medicines(id) on delete restrict,
  lot_number text not null,
  expiry_date date not null,
  created_at timestamptz not null default now(),
  unique (medicine_id, lot_number)
);
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.lots(id) on delete restrict,
  transaction_type text not null check (transaction_type in ('IN','OUT','ADJUST_IN','ADJUST_OUT','DISPOSE')),
  quantity numeric(14,2) not null check (quantity > 0),
  note text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.lots(id) on delete restrict,
  system_qty numeric(14,2) not null,
  counted_qty numeric(14,2) not null check (counted_qty >= 0),
  status text not null default 'Pending' check (status in ('Pending','Adjusted')),
  adjustment_txn_id uuid references public.transactions(id),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  adjusted_at timestamptz
);

create index if not exists idx_lots_medicine on public.lots(medicine_id);
create index if not exists idx_lots_expiry on public.lots(expiry_date);
create index if not exists idx_transactions_lot on public.transactions(lot_id);
create index if not exists idx_stock_counts_lot on public.stock_counts(lot_id);

create or replace view public.lot_stock with (security_invoker = true) as
select l.id, l.medicine_id, l.lot_number, l.expiry_date, l.created_at,
  coalesce(sum(case when t.transaction_type in ('IN','ADJUST_IN') then t.quantity
                    when t.transaction_type in ('OUT','ADJUST_OUT','DISPOSE') then -t.quantity
                    else 0 end),0)::numeric(14,2) as current_qty
from public.lots l left join public.transactions t on t.lot_id=l.id
group by l.id;

-- Single trusted transaction entry point; prevents negative inventory under concurrent requests.
create or replace function public.record_stock(p_lot_id uuid, p_type text, p_qty numeric, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_current numeric; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_type not in ('IN','OUT','ADJUST_IN','ADJUST_OUT','DISPOSE') or p_type is null then raise exception 'Invalid transaction type'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be positive'; end if;
  perform 1 from public.lots where id=p_lot_id for update;
  if not found then raise exception 'Lot not found'; end if;
  select current_qty into v_current from public.lot_stock where id=p_lot_id;
  if p_type in ('OUT','ADJUST_OUT','DISPOSE') and v_current < p_qty then raise exception 'Insufficient stock (available: %)', v_current; end if;
  insert into public.transactions(lot_id,transaction_type,quantity,note,created_by)
  values(p_lot_id,p_type,p_qty,p_note,auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.create_stock_count(p_lot_id uuid, p_counted_qty numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_current numeric; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_counted_qty is null or p_counted_qty < 0 then raise exception 'Invalid counted quantity'; end if;
  perform 1 from public.lots where id=p_lot_id for update;
  if not found then raise exception 'Lot not found'; end if;
  select current_qty into v_current from public.lot_stock where id=p_lot_id;
  insert into public.stock_counts(lot_id,system_qty,counted_qty,created_by)
  values(p_lot_id,v_current,p_counted_qty,auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.approve_stock_count(p_count_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_count public.stock_counts%rowtype; v_current numeric; v_diff numeric; v_txn uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into v_count from public.stock_counts where id=p_count_id for update;
  if not found then raise exception 'Count not found'; end if;
  if v_count.status <> 'Pending' then raise exception 'Count already adjusted'; end if;
  perform 1 from public.lots where id=v_count.lot_id for update;
  select current_qty into v_current from public.lot_stock where id=v_count.lot_id;
  if v_current <> v_count.system_qty then raise exception 'Stock changed since count. Create a new count.'; end if;
  v_diff := v_count.counted_qty - v_current;
  if v_diff <> 0 then
    insert into public.transactions(lot_id,transaction_type,quantity,note,created_by)
    values(v_count.lot_id,case when v_diff > 0 then 'ADJUST_IN' else 'ADJUST_OUT' end,
           abs(v_diff),'Stock count adjustment '||p_count_id::text,auth.uid()) returning id into v_txn;
  end if;
  update public.stock_counts set status='Adjusted',adjustment_txn_id=v_txn,adjusted_at=now() where id=p_count_id;
  return v_txn;
end $$;

-- RLS: authenticated users can read; writes only via controlled functions where appropriate.
alter table public.medicines enable row level security;
alter table public.lots enable row level security;
alter table public.transactions enable row level security;
alter table public.stock_counts enable row level security;
create policy "read medicines" on public.medicines for select to authenticated using (true);
create policy "add medicines" on public.medicines for insert to authenticated with check (true);
create policy "edit medicines" on public.medicines for update to authenticated using (true) with check (true);
create policy "read lots" on public.lots for select to authenticated using (true);
create policy "add lots" on public.lots for insert to authenticated with check (true);
create policy "read transactions" on public.transactions for select to authenticated using (true);
create policy "read counts" on public.stock_counts for select to authenticated using (true);
revoke all on function public.record_stock(uuid,text,numeric,text) from public;
revoke all on function public.create_stock_count(uuid,numeric) from public;
revoke all on function public.approve_stock_count(uuid) from public;
grant execute on function public.record_stock(uuid,text,numeric,text) to authenticated;
grant execute on function public.create_stock_count(uuid,numeric) to authenticated;
grant execute on function public.approve_stock_count(uuid) to authenticated;
grant select on public.lot_stock to authenticated;

-- Gato Gastos: esquema de Supabase.
-- Pégalo completo en Supabase > SQL Editor y ejecútalo una vez.
-- Los correos permitidos NO van aquí: se agregan aparte (ver README).

-- 1) Correos que pueden usar la app y su rol
create table if not exists public.permitidos (
  email text primary key,
  rol   text not null check (rol in ('gato','gata'))
);
alter table public.permitidos enable row level security;

create or replace function public.es_miembro() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.permitidos
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

drop policy if exists "miembros ven permitidos" on public.permitidos;
create policy "miembros ven permitidos" on public.permitidos
  for select to authenticated using (public.es_miembro());

-- 2) Datos de la app. owner nulo = compartido; owner = usuario = privado (colecciones "p:...").
create table if not exists public.docs (
  col        text not null,
  id         text not null,
  owner      uuid references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (col, id),
  constraint privado_con_dueno check ((col like 'p:%') = (owner is not null))
);
alter table public.docs enable row level security;
alter table public.docs replica identity full;

drop policy if exists "leer docs" on public.docs;
drop policy if exists "crear docs" on public.docs;
drop policy if exists "editar docs" on public.docs;
drop policy if exists "borrar docs" on public.docs;
create policy "leer docs" on public.docs for select to authenticated
  using (public.es_miembro() and (owner is null or owner = auth.uid()));
create policy "crear docs" on public.docs for insert to authenticated
  with check (public.es_miembro() and (owner is null or owner = auth.uid()));
create policy "editar docs" on public.docs for update to authenticated
  using (public.es_miembro() and (owner is null or owner = auth.uid()))
  with check (public.es_miembro() and (owner is null or owner = auth.uid()));
create policy "borrar docs" on public.docs for delete to authenticated
  using (public.es_miembro() and (owner is null or owner = auth.uid()));

-- Cambios en vivo entre los dos teléfonos
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- 3) Solo los correos permitidos pueden crear cuenta
create or replace function public.solo_permitidos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.permitidos where lower(email) = lower(new.email)) then
    raise exception 'Este correo no tiene acceso a Gato Gastos';
  end if;
  return new;
end $$;
drop trigger if exists solo_permitidos on auth.users;
create trigger solo_permitidos before insert on auth.users
  for each row execute function public.solo_permitidos();

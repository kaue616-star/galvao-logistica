-- Execute este arquivo no SQL Editor do Supabase.
-- O bucket é privado: fotos não ficam públicas.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('admin','driver')),
  created_at timestamptz not null default now()
);

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  protocol text not null,
  storage_path text not null unique,
  driver_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  downloaded_at timestamptz null
);

create index if not exists receipts_created_at_idx on public.receipts(created_at desc);
create index if not exists receipts_protocol_idx on public.receipts(protocol);

alter table public.profiles enable row level security;
alter table public.receipts enable row level security;

-- Função SECURITY DEFINER evita recursão de políticas ao verificar o perfil admin.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Usuários autenticados podem ler o próprio perfil; administradores leem todos.
create policy "profiles_read_self_or_admin" on public.profiles
for select to authenticated using (
  id = auth.uid() or public.is_admin()
);

-- Somente administrador gerencia perfis.
create policy "profiles_admin_manage" on public.profiles
for all to authenticated using (
  public.is_admin()
) with check (
  public.is_admin()
);

-- Motoboy insere comprovante em seu próprio nome; administrador vê e gerencia todos.
create policy "receipts_insert_own" on public.receipts
for insert to authenticated with check (driver_id = auth.uid());

create policy "receipts_admin_read" on public.receipts
for select to authenticated using (
  public.is_admin()
);

create policy "receipts_admin_update" on public.receipts
for update to authenticated using (
  public.is_admin()
) with check (
  public.is_admin()
);

-- Bucket privado para comprovantes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprovantes', 'comprovantes', false, 10485760, array['image/jpeg'])
on conflict (id) do nothing;

-- Motoboy só envia dentro da própria pasta (UUID do usuário).
create policy "driver_upload_own_folder" on storage.objects
for insert to authenticated with check (
  bucket_id = 'comprovantes'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Administrador pode visualizar e baixar todas as fotos.
create policy "admin_read_receipt_files" on storage.objects
for select to authenticated using (
  bucket_id = 'comprovantes'
  and public.is_admin()
);

-- Motoboy pode apagar somente arquivo que ele mesmo enviou, se necessário.
create policy "driver_delete_own_files" on storage.objects
for delete to authenticated using (
  bucket_id = 'comprovantes'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- IMPORTANTE: crie os usuários em Authentication > Users no painel Supabase.
-- Depois cadastre cada perfil abaixo, usando o UUID do usuário criado:
-- insert into public.profiles (id, full_name, role)
-- values ('UUID-DO-USUARIO', 'Nome do motoboy', 'driver');
-- Para o administrador, use role 'admin'.

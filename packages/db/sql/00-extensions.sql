-- Extensões e emulação local do Supabase.
--
-- Roda em dois lugares: no init do container local (montado em
-- docker-entrypoint-initdb.d) e no começo de `pnpm db:migrate`.
--
-- ⚠️ Por isso TUDO aqui precisa ser idempotente E seguro contra um Supabase
-- real. Um `create or replace function auth.uid()` sem guarda sobrescreveria a
-- função de verdade do Supabase e derrubaria a autenticação inteira.

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- pgvector habilitado desde o dia 1, mesmo sem uso.
-- O assistente RAG da Fase 4 (§6.3-A da documentação) vira uma coluna e um
-- índice — não uma migração de dados históricos.
create extension if not exists vector;

-- -----------------------------------------------------------------------------
-- Emulação local do schema `auth` do Supabase
--
-- Existe só para que `sql/rls.sql` seja EXATAMENTE o mesmo arquivo em
-- desenvolvimento e em produção. Testar RLS contra um schema diferente do de
-- produção é testar a coisa errada.
--
-- A guarda abaixo é essencial: se `auth.uid()` já existe, estamos num Supabase
-- de verdade e não encostamos em nada.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    raise notice 'auth.uid() já existe — Supabase real, emulação ignorada';
    return;
  end if;

  raise notice 'criando emulação local do schema auth';
  execute 'create schema if not exists auth';
  execute $fn$
    create function auth.uid() returns uuid
      language sql stable
    as $body$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $body$;
  $fn$;
end
$$;

-- Papéis equivalentes aos do Supabase.
-- `service_role` ignora RLS e é usado APENAS pelo worker, nunca pelo cliente.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role bypassrls nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

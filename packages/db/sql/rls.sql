-- =============================================================================
-- Row Level Security — o isolamento multi-tenant
--
-- A documentação (§6.3) exige que a filtragem por dono aconteça "no nível de
-- dados, não só na interface". Este arquivo É esse requisito.
--
-- Leia com atenção antes de mudar qualquer coisa aqui: um erro neste arquivo
-- é vazamento de dado de saúde entre profissionais — incidente grave de LGPD,
-- não bug de funcionalidade.
--
-- Aplicar DEPOIS de cada migration do Drizzle:
--     psql "$DATABASE_URL" -f packages/db/sql/rls.sql
--
-- É idempotente: pode rodar quantas vezes quiser.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Resolve o profissional logado a partir do usuário autenticado.
--
-- SECURITY DEFINER porque precisa ler `professionals` ignorando a própria RLS
-- daquela tabela — senão a política se referenciaria em recursão infinita.
-- `search_path` fixo impede sequestro da função por schema malicioso.
-- -----------------------------------------------------------------------------
create or replace function auth.professional_id() returns uuid
  language sql
  stable
  security definer
  set search_path = public, auth, pg_temp
as $$
  select id
  from public.professionals
  where auth_user_id = auth.uid()
    and deleted_at is null
  limit 1;
$$;

-- -----------------------------------------------------------------------------
-- Aplica a política padrão de isolamento a uma tabela.
--
-- Toda tabela com dado de paciente carrega `professional_id` DIRETO — sem
-- JOIN. É por isso que a política é sempre esta mesma linha, e é por isso que
-- ela é rápida e difícil de errar. Ver o comentário no topo de src/schema.ts.
-- -----------------------------------------------------------------------------
create or replace procedure apply_tenant_isolation(target regclass)
  language plpgsql
as $$
declare
  policy_name text := format('%s_tenant_isolation', target::text);
begin
  execute format('alter table %s enable row level security', target);
  -- FORCE é essencial: sem ele, o dono da tabela ignora as políticas, e a
  -- conexão da aplicação frequentemente É o dono.
  execute format('alter table %s force row level security', target);
  execute format('drop policy if exists %I on %s', policy_name, target);
  execute format(
    'create policy %I on %s for all to authenticated
       using (professional_id = auth.professional_id())
       with check (professional_id = auth.professional_id())',
    policy_name, target
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- professionals — o tenant em si, ancorado no usuário autenticado
-- -----------------------------------------------------------------------------
alter table public.professionals enable row level security;
alter table public.professionals force row level security;

drop policy if exists professionals_self_access on public.professionals;
create policy professionals_self_access on public.professionals
  for all to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Tabelas de dado clínico — política idêntica, sem exceção
-- -----------------------------------------------------------------------------
call apply_tenant_isolation('public.patients');
call apply_tenant_isolation('public.sessions');
call apply_tenant_isolation('public.transcript_segments');
call apply_tenant_isolation('public.documents');

-- -----------------------------------------------------------------------------
-- objective_templates — professional_id NULO significa template global
--
-- Leitura: os seus mais os globais.
-- Escrita: só os seus. `with check (professional_id = ...)` impede que alguém
-- crie um template global, que seria visível a todos os profissionais.
-- -----------------------------------------------------------------------------
alter table public.objective_templates enable row level security;
alter table public.objective_templates force row level security;

drop policy if exists templates_read on public.objective_templates;
create policy templates_read on public.objective_templates
  for select to authenticated
  using (professional_id is null or professional_id = auth.professional_id());

drop policy if exists templates_write on public.objective_templates;
create policy templates_write on public.objective_templates
  for all to authenticated
  using (professional_id = auth.professional_id())
  with check (professional_id = auth.professional_id());

-- -----------------------------------------------------------------------------
-- Tabelas somente-leitura para o cliente
--
-- Ausência de política de INSERT/UPDATE/DELETE = negado. Só o worker, com
-- service_role (BYPASSRLS), escreve aqui.
--
-- Auditoria que o próprio auditado pode editar não é auditoria.
-- -----------------------------------------------------------------------------
alter table public.usage_events enable row level security;
alter table public.usage_events force row level security;

drop policy if exists usage_read_own on public.usage_events;
create policy usage_read_own on public.usage_events
  for select to authenticated
  using (professional_id = auth.professional_id());

alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

drop policy if exists audit_read_own on public.audit_log;
create policy audit_read_own on public.audit_log
  for select to authenticated
  using (professional_id = auth.professional_id());

alter table public.jobs enable row level security;
alter table public.jobs force row level security;

drop policy if exists jobs_read_own on public.jobs;
create policy jobs_read_own on public.jobs
  for select to authenticated
  using (professional_id = auth.professional_id());

-- -----------------------------------------------------------------------------
-- Permissões de base
--
-- RLS filtra LINHAS; GRANT controla o acesso à TABELA. Precisa dos dois.
-- -----------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;

-- A política chama `auth.professional_id()`, e a expressão da política é
-- avaliada com as permissões de quem consulta. Sem USAGE no schema `auth`,
-- TODA consulta falha com "permission denied for schema auth" — falha fechada,
-- portanto segura, mas a aplicação inteira para.
--
-- No Supabase gerenciado essas concessões já existem; em qualquer outro
-- Postgres, não. Por isso ficam explícitas aqui.
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant execute on function auth.professional_id() to authenticated;

-- =============================================================================
-- LEMBRETE: o Marco 6 exige uma suíte automatizada que tente ler dados de
-- outro profissional e FALHE O BUILD se conseguir. Política escrita não é
-- política testada.
-- =============================================================================

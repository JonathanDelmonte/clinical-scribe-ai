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
--
-- Mora no schema `app`, e não em `auth`. No Supabase gerenciado o schema
-- `auth` é do próprio Supabase, e o usuário `postgres` não pode criar nada lá:
-- `create function auth.professional_id()` falha com "permission denied for
-- schema auth" — e com ela, todas as políticas abaixo. Um schema nosso
-- funciona igual no banco local e no de produção.
-- -----------------------------------------------------------------------------
create schema if not exists app;

create or replace function app.professional_id() returns uuid
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
       using (professional_id = app.professional_id())
       with check (professional_id = app.professional_id())',
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
  using (professional_id is null or professional_id = app.professional_id());

drop policy if exists templates_write on public.objective_templates;
create policy templates_write on public.objective_templates
  for all to authenticated
  using (professional_id = app.professional_id())
  with check (professional_id = app.professional_id());

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
  using (professional_id = app.professional_id());

alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

drop policy if exists audit_read_own on public.audit_log;
create policy audit_read_own on public.audit_log
  for select to authenticated
  using (professional_id = app.professional_id());

-- -----------------------------------------------------------------------------
-- Como a trilha de auditoria é ESCRITA — e por que não por uma política
--
-- A aplicação precisa registrar quem viu e quem editou o quê (§10, NGS1). Mas
-- quem roda a aplicação é o próprio auditado: a conexão da web carrega a
-- identidade dele e nenhuma outra.
--
-- A saída óbvia seria uma política de INSERT. Ela funcionaria, e abriria uma
-- porta pequena e feia: o cliente escolheria `professional_id`, `actor_id`,
-- `ip` e `created_at` de cada linha. Não daria para forjar em nome de outro
-- profissional — o `with check` barraria —, mas daria para forjar a própria
-- trilha com carimbo e origem à escolha, que é metade do estrago.
--
-- A outra saída seria a aplicação web carregar uma credencial `service_role`,
-- que IGNORA todas as políticas. Trocar "pode escrever a própria auditoria"
-- por "pode ler os dados de todo mundo" é um péssimo negócio.
--
-- Esta função é o meio-termo correto: o cliente diz O QUE aconteceu; QUEM e
-- QUANDO são preenchidos aqui dentro, a partir da sessão autenticada, sem
-- passar pelo chamador. Nenhuma política de INSERT é criada — a tabela
-- continua negando escrita direta, e `update`/`delete` seguem impossíveis.
--
-- ⚠️ `p_metadata` NUNCA recebe conteúdo clínico. IDs e rótulos, como manda a
--    regra nº 4 do README. Log é o vazamento de dado de saúde mais fácil de
--    cometer, e a trilha de auditoria é justamente onde dá vontade de gravar
--    "o que mudou".
-- -----------------------------------------------------------------------------
create or replace function public.audit_append(
  p_action     text,
  p_entity     text,
  p_entity_id  uuid    default null,
  p_metadata   jsonb   default null,
  p_ip         text    default null,
  p_user_agent text    default null
) returns uuid
  language plpgsql
  security definer
  set search_path = public, auth, pg_temp
as $$
declare
  dono uuid := app.professional_id();
  novo uuid;
begin
  -- Falha fechada: sem profissional resolvido não existe a quem atribuir o
  -- registro, e uma linha de auditoria sem dono é ruído que atrapalha a
  -- leitura da trilha justamente no dia em que ela for lida a sério.
  if dono is null then
    raise exception 'audit_append chamada sem profissional autenticado'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.audit_log
    (actor_id, professional_id, action, entity, entity_id, metadata, ip, user_agent)
  values
    (auth.uid(), dono, p_action, p_entity, p_entity_id, p_metadata, p_ip, p_user_agent)
  returning id into novo;

  return novo;
end;
$$;

revoke all on function public.audit_append(text, text, uuid, jsonb, text, text)
  from public;
grant execute on function public.audit_append(text, text, uuid, jsonb, text, text)
  to authenticated;

-- `jobs` é o caso que exige precisão: a aplicação PRECISA enfileirar (é ela
-- quem recebe o upload e dispara o processamento), mas não pode tocar em job
-- nenhum depois disso.
--
--   INSERT  ✔ apenas para si mesma
--   SELECT  ✔ apenas os seus (a tela de sessão consulta o andamento)
--   UPDATE  ✘ mudar status é do worker; permitir aqui deixaria o cliente
--             marcar job como concluído sem nada ter sido processado
--   DELETE  ✘ apagar job da fila é sabotar o próprio processamento
alter table public.jobs enable row level security;
alter table public.jobs force row level security;

drop policy if exists jobs_read_own on public.jobs;
create policy jobs_read_own on public.jobs
  for select to authenticated
  using (professional_id = app.professional_id());

drop policy if exists jobs_enqueue_own on public.jobs;
create policy jobs_enqueue_own on public.jobs
  for insert to authenticated
  with check (professional_id = app.professional_id());

-- -----------------------------------------------------------------------------
-- Permissões de base
--
-- RLS filtra LINHAS; GRANT controla o acesso à TABELA. Precisa dos dois.
-- -----------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;

-- A política chama `app.professional_id()`, que chama `auth.uid()`, e a
-- expressão da política é avaliada com as permissões de quem consulta. Sem
-- USAGE nos dois schemas, TODA consulta falha com "permission denied" — falha
-- fechada, portanto segura, mas a aplicação inteira para.
grant usage on schema app to authenticated;
grant execute on function app.professional_id() to authenticated;

-- O schema `auth` é do Supabase: lá essas concessões já existem, e o usuário
-- `postgres` nem sempre pode repeti-las. No banco local — onde `auth` é a
-- nossa emulação — elas são necessárias. Por isso a tentativa, e a recusa do
-- Supabase não derruba a migração.
do $$
begin
  grant usage on schema auth to authenticated;
  grant execute on function auth.uid() to authenticated;
exception when insufficient_privilege then
  raise notice 'concessões em auth mantidas pelo próprio Supabase';
end
$$;

-- -----------------------------------------------------------------------------
-- service_role — a identidade que IGNORA as políticas
--
-- O papel já era criado em `00-extensions.sql` e não tinha concessão nenhuma:
-- funcionava porque, em desenvolvimento, a conexão é superusuário e nunca
-- precisou trocar de papel. Isso deixava uma armadilha pronta — o dia em que
-- alguém rodasse o worker com um papel comum, tudo falharia com "permission
-- denied", longe daqui.
--
-- Quem precisa dele, e por quê:
--   • o worker, que escreve trechos e notas de TODOS os profissionais;
--   • a conferência de e-mail e senha no login, que precisa encontrar uma
--     conta ANTES de saber de quem ela é — ver lib/auth/accounts.ts.
--
-- ⚠️ `set local role service_role` desliga o isolamento multi-tenant inteiro
--    pelo resto da transação. Toda vez que aparecer, o comentário ao lado
--    precisa dizer por que não deu para fazer sob RLS.
-- -----------------------------------------------------------------------------
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage on all sequences in schema public to service_role;
grant usage on schema app to service_role;
grant execute on function app.professional_id() to service_role;
do $$
begin
  grant usage on schema auth to service_role;
  grant execute on function auth.uid() to service_role;
exception when insufficient_privilege then
  raise notice 'concessões em auth mantidas pelo próprio Supabase';
end
$$;

-- A função antiga, `auth.professional_id()`, só chegou a existir no banco
-- local — no Supabase ela nunca pôde ser criada. Sai agora que todas as
-- políticas acima já apontam para a nova; se alguma política esquecida ainda
-- dependesse dela, a remoção é recusada e a migração segue avisando.
do $$
begin
  drop function if exists auth.professional_id();
exception when insufficient_privilege or dependent_objects_still_exist then
  raise notice 'auth.professional_id() mantida: %', sqlerrm;
end
$$;

-- =============================================================================
-- LEMBRETE: o Marco 6 exige uma suíte automatizada que tente ler dados de
-- outro profissional e FALHE O BUILD se conseguir. Política escrita não é
-- política testada.
-- =============================================================================

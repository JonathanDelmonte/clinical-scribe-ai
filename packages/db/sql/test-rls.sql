-- =============================================================================
-- Teste de isolamento multi-tenant
--
-- Política escrita não é política testada. Este arquivo tenta ativamente ler,
-- escrever e alterar dados de OUTRO profissional e falha com exceção se
-- qualquer tentativa tiver sucesso.
--
-- Roda no CI a cada PR. Se alguém afrouxar uma política sem perceber, o build
-- quebra aqui — e não num incidente de LGPD depois.
--
--     docker exec -i scribe-postgres psql -U postgres -d scribe \
--       -v ON_ERROR_STOP=1 < packages/db/sql/test-rls.sql
--
-- Roda dentro de uma transação que termina em ROLLBACK: não deixa resíduo.
-- =============================================================================


begin;

-- -----------------------------------------------------------------------------
-- Cenário: duas profissionais que não devem se enxergar
-- -----------------------------------------------------------------------------
insert into professionals (id, auth_user_id, name, specialty) values
  ('11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Dra. Ana',   'nutrição'),
  ('22222222-2222-2222-2222-222222222222',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Dr. Bruno',  'psicologia');

insert into patients (id, professional_id, name) values
  ('a1a1a1a1-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'Paciente da Ana'),
  ('b1b1b1b1-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222', 'Paciente do Bruno');

insert into sessions (id, professional_id, patient_id, status) values
  ('a2a2a2a2-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'a1a1a1a1-0000-0000-0000-000000000001', 'approved'),
  ('b2b2b2b2-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222',
   'b1b1b1b1-0000-0000-0000-000000000001', 'approved');

insert into transcript_segments
  (session_id, professional_id, speaker_label, start_ms, end_ms, text) values
  ('a2a2a2a2-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'SPEAKER_00', 0, 1000,
   'segredo clínico da Ana'),
  ('b2b2b2b2-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222', 'SPEAKER_00', 0, 1000,
   'segredo clínico do Bruno');

insert into documents (session_id, professional_id, type, content) values
  ('a2a2a2a2-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'clinical_note', '{"nota":"da Ana"}'),
  ('b2b2b2b2-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222', 'clinical_note', '{"nota":"do Bruno"}');

insert into objective_templates (professional_id, name, prompt) values
  (null,                                    'Global: SOAP',   'prompt global'),
  ('22222222-2222-2222-2222-222222222222',  'Privado Bruno',  'prompt do Bruno');

insert into audit_log (professional_id, action, entity) values
  ('22222222-2222-2222-2222-222222222222', 'view', 'sessions');

-- -----------------------------------------------------------------------------
-- A partir daqui somos a Ana, autenticada. Nada de superusuário: RLS é
-- ignorada por superusuário, então testar como `postgres` não testaria nada.
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub',
                  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

do $$
declare
  n bigint;
  txt text;
  registro uuid;
begin
  -- Sanidade: a resolução de identidade funciona?
  if auth.professional_id() <> '11111111-1111-1111-1111-111111111111' then
    raise exception 'FALHA: auth.professional_id() devolveu %, esperado o da Ana',
      auth.professional_id();
  end if;

  -- LEITURA -------------------------------------------------------------------
  select count(*) into n from patients;
  if n <> 1 then raise exception 'FALHA: Ana vê % pacientes, deveria ver 1', n; end if;

  select name into txt from patients;
  if txt <> 'Paciente da Ana' then
    raise exception 'FALHA: Ana vê o paciente "%"', txt;
  end if;

  select count(*) into n from sessions;
  if n <> 1 then raise exception 'FALHA: Ana vê % sessões, deveria ver 1', n; end if;

  select count(*) into n from transcript_segments;
  if n <> 1 then raise exception 'FALHA: Ana vê % trechos, deveria ver 1', n; end if;

  select count(*) into n from documents;
  if n <> 1 then raise exception 'FALHA: Ana vê % documentos, deveria ver 1', n; end if;

  -- O vazamento mais perigoso: buscar pelo ID exato do outro profissional.
  select count(*) into n from transcript_segments
   where session_id = 'b2b2b2b2-0000-0000-0000-000000000001';
  if n <> 0 then
    raise exception 'FALHA GRAVE: Ana leu % trechos da consulta do Bruno', n;
  end if;

  select count(*) into n from professionals;
  if n <> 1 then
    raise exception 'FALHA: Ana vê % profissionais, deveria ver só a si mesma', n;
  end if;

  -- TEMPLATES: os globais mais os seus; os privados do Bruno, não ----------------
  select count(*) into n from objective_templates;
  if n <> 1 then
    raise exception 'FALHA: Ana vê % templates, deveria ver só o global', n;
  end if;

  -- AUDITORIA: só a própria -----------------------------------------------------
  select count(*) into n from audit_log;
  if n <> 0 then
    raise exception 'FALHA: Ana vê % registros de auditoria do Bruno', n;
  end if;

  -- ESCRITA: não pode criar registro em nome de outro --------------------------
  begin
    insert into patients (professional_id, name)
    values ('22222222-2222-2222-2222-222222222222', 'Injetado pela Ana');
    raise exception 'FALHA GRAVE: Ana criou um paciente em nome do Bruno';
  exception
    when insufficient_privilege then null;  -- esperado
  end;

  -- ALTERAÇÃO: update no registro alheio não pode atingir linha alguma ---------
  update patients set name = 'Sequestrado'
   where id = 'b1b1b1b1-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FALHA GRAVE: Ana alterou % pacientes do Bruno', n;
  end if;

  -- EXCLUSÃO ------------------------------------------------------------------
  delete from patients where id = 'b1b1b1b1-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FALHA GRAVE: Ana apagou % pacientes do Bruno', n;
  end if;

  -- AUDITORIA: ESCRITA DIRETA É NEGADA ------------------------------------------
  -- A aplicação registra a trilha através de `audit_append()`, que preenche
  -- dono, ator e carimbo a partir da sessão autenticada. Escrever direto na
  -- tabela permitiria escolher esses três — que é metade do estrago de uma
  -- auditoria forjada.
  begin
    insert into audit_log (professional_id, action, entity)
    values ('11111111-1111-1111-1111-111111111111', 'forjado', 'sessions');
    raise exception 'FALHA: auditoria que o auditado pode escrever não é auditoria';
  exception
    when insufficient_privilege then null;  -- esperado
  end;

  -- AUDITORIA: A FUNÇÃO ESCREVE, E ATRIBUI A QUEM CHAMOU ------------------------
  registro := audit_append('view', 'sessions',
                           'a2a2a2a2-0000-0000-0000-000000000001',
                           '{"segments":3}'::jsonb, '203.0.113.7', 'teste');
  if registro is null then
    raise exception 'FALHA: audit_append não registrou nada';
  end if;

  select count(*) into n from audit_log
   where id = registro
     and professional_id = '11111111-1111-1111-1111-111111111111'
     and actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     and action = 'view';
  if n <> 1 then
    raise exception 'FALHA: audit_append não atribuiu o registro à Ana';
  end if;

  -- AUDITORIA É IMUTÁVEL --------------------------------------------------------
  -- Sem política de UPDATE e sem política de DELETE, a linha existe, é lida
  -- pela dona, e não pode ser reescrita nem apagada por ela. É esta ausência
  -- que transforma um log num registro de auditoria.
  update audit_log set action = 'reescrito' where id = registro;
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FALHA GRAVE: Ana reescreveu % registros da própria auditoria', n;
  end if;

  delete from audit_log where id = registro;
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FALHA GRAVE: Ana apagou % registros da própria auditoria', n;
  end if;

  -- FILA ------------------------------------------------------------------------
  -- Esta seção existe porque a falta dela deixou passar um bug real: a tabela
  -- `jobs` só tinha política de SELECT, e a aplicação não conseguia enfileirar
  -- nada. O upload gravava o áudio e a transação revertia em silêncio.

  -- Enfileirar para si mesma: permitido, é o que a aplicação faz no upload.
  insert into jobs (professional_id, session_id, kind)
  values ('11111111-1111-1111-1111-111111111111',
          'a2a2a2a2-0000-0000-0000-000000000001', 'transcribe');

  -- Enfileirar em nome de outro: não.
  begin
    insert into jobs (professional_id, kind)
    values ('22222222-2222-2222-2222-222222222222', 'transcribe');
    raise exception 'FALHA GRAVE: Ana enfileirou trabalho na conta do Bruno';
  exception
    when insufficient_privilege then null;  -- esperado
  end;

  -- Alterar job é do worker. Se o cliente pudesse, marcaria como concluído
  -- sem nada ter sido processado.
  update jobs set status = 'done' where professional_id = auth.professional_id();
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FALHA: Ana alterou % jobs — mudar status é só do worker', n;
  end if;

  -- Apagar job da fila seria sabotar o próprio processamento.
  delete from jobs where professional_id = auth.professional_id();
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FALHA: Ana apagou % jobs da fila', n;
  end if;

  -- E não enxerga a fila alheia.
  select count(*) into n from jobs
   where professional_id = '22222222-2222-2222-2222-222222222222';
  if n <> 0 then
    raise exception 'FALHA: Ana vê % jobs do Bruno', n;
  end if;

  raise notice 'OK — isolamento multi-tenant verificado (21 asserções)';
end
$$;

reset role;
rollback;

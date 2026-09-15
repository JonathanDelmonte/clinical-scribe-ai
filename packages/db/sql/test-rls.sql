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

  -- AUDITORIA É SOMENTE LEITURA ------------------------------------------------
  begin
    insert into audit_log (professional_id, action, entity)
    values ('11111111-1111-1111-1111-111111111111', 'forjado', 'sessions');
    raise exception 'FALHA: auditoria que o auditado pode escrever não é auditoria';
  exception
    when insufficient_privilege then null;  -- esperado
  end;

  raise notice 'OK — isolamento multi-tenant verificado (12 asserções)';
end
$$;

reset role;
rollback;

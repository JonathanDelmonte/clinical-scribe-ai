import "server-only";

import { headers } from "next/headers";
import { sql } from "drizzle-orm";

import { asCurrentUser, type Tx } from "./auth";
import { getDb, withProfessional } from "./db";

/**
 * A trilha de auditoria — quem viu e quem editou o quê, e quando.
 *
 * É requisito de prontuário eletrônico (§10 da documentação, nível NGS1 da
 * certificação SBIS/CFM). A tabela `audit_log` existe no schema desde o Marco
 * 0 e estava vazia: ninguém escrevia nela.
 *
 * ## Como a escrita acontece
 *
 * Através de `public.audit_append()`, uma função `SECURITY DEFINER`. A tabela
 * **não tem política de INSERT** — o cliente não consegue escrever nela
 * diretamente, e nem `UPDATE` nem `DELETE` existem para ninguém. O chamador
 * diz O QUE aconteceu; QUEM e QUANDO são preenchidos dentro da função, a
 * partir da sessão autenticada. Ver o comentário longo em `sql/rls.sql`.
 *
 * ## ⚠️ IDs, nunca conteúdo
 *
 * É a regra nº 5 do README, e é aqui que a tentação aparece: registrar "o que
 * mudou" numa trilha de auditoria parece uma boa ideia até alguém notar que a
 * tabela virou uma segunda cópia do prontuário, sem as políticas que protegem
 * a primeira. `metadata` recebe contagens, rótulos e identificadores. Nunca
 * texto de consulta, nome de paciente, nem trecho de nota.
 */

/**
 * O vocabulário de ações.
 *
 * Fechado de propósito: uma trilha em que cada chamada inventa o próprio verbo
 * é uma trilha que não dá para consultar. `entrou` e `entrou_no_sistema` seriam
 * o mesmo evento em duas grafias, e a consulta que procura um acharia metade.
 */
export const ACOES = {
  entrar: "auth.entrar",
  sair: "auth.sair",
  cadastrar: "auth.cadastrar",
  perfilAtualizado: "perfil.atualizado",
  retencaoAlterada: "perfil.retencao_alterada",

  pacienteCriado: "paciente.criado",
  pacienteAberto: "paciente.aberto",
  pacienteEditado: "paciente.editado",
  pacienteArquivado: "paciente.arquivado",

  sessaoCriada: "sessao.criada",
  sessaoAberta: "sessao.aberta",
  sessaoDescartada: "sessao.descartada",
  sessaoCancelada: "sessao.cancelada",
  sessaoApagada: "sessao.apagada",
  audioEnviado: "sessao.audio_enviado",
  audioBaixado: "sessao.audio_baixado",
  audioApagado: "sessao.audio_apagado",
  reprocessada: "sessao.reprocessada",
  trechoCorrigido: "transcricao.trecho_corrigido",

  notaAprovada: "documento.nota_aprovada",
  documentoExportado: "documento.exportado",

  dadosExportados: "lgpd.dados_exportados",
  contaExcluida: "lgpd.conta_excluida",
} as const;

export type Acao = (typeof ACOES)[keyof typeof ACOES];

/**
 * O que esta trilha ainda NÃO registra, e por quê.
 *
 * **Tentativa de login que falhou.** Todo registro tem dono, e o dono vem da
 * sessão autenticada — que, por definição, não existe numa tentativa que
 * falhou. Escrever esses eventos exigiria um caminho em que a aplicação
 * escolhe o `professional_id`, que é exatamente a porta que `audit_append`
 * fecha. E a defesa contra força bruta não é registrar as tentativas: é
 * limitá-las (Fase 11). Quando houver motivo para o registro, ele merece uma
 * tabela própria, com outras regras.
 */

export interface EventoDeAuditoria {
  readonly acao: Acao;
  /** A tabela ou recurso: `patients`, `sessions`, `documents`, `auth`. */
  readonly entidade: string;
  readonly entidadeId?: string | null;
  /** Só contagens, rótulos e identificadores. Nunca conteúdo clínico. */
  readonly metadados?: Record<string, string | number | boolean | null>;
}

/**
 * De onde a requisição veio.
 *
 * O IP é dado pessoal, e entra aqui por uma razão específica: sem ele, a
 * trilha responde "esta conta acessou o prontuário" e não responde "de onde" —
 * que é justamente a pergunta de um incidente de acesso indevido. Fica
 * declarado na política de privacidade como dado de segurança.
 *
 * `x-forwarded-for` pode trazer uma cadeia de proxies; o primeiro é o cliente.
 * Truncado porque um cabeçalho forjado pode vir com quilobytes dentro.
 */
async function contextoDaRequisicao(): Promise<{
  ip: string | null;
  agente: string | null;
}> {
  try {
    const h = await headers();
    const encaminhado = h.get("x-forwarded-for");
    const ip = (encaminhado?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim();
    const agente = h.get("user-agent");
    return {
      ip: ip === "" ? null : ip.slice(0, 64),
      agente: agente === null ? null : agente.slice(0, 256),
    };
  } catch {
    // Fora de um contexto de requisição (um job, um script). A trilha ainda
    // vale sem origem.
    return { ip: null, agente: null };
  }
}

/**
 * Registra um evento. **Participa da transação de quem chamou.**
 *
 * Use em operações de ESCRITA. Se a escrita for desfeita, o registro de
 * auditoria é desfeito junto — e é isso que se quer: uma trilha que afirma uma
 * alteração que não aconteceu é pior que nenhuma trilha.
 *
 * Pelo mesmo motivo, uma falha aqui derruba a operação. Numa tabela sem
 * `UPDATE` e sem `DELETE`, com a função preenchendo dono e carimbo, a única
 * falha plausível é o banco estar fora do ar — caso em que a operação também
 * ia falhar.
 */
export async function auditar(tx: Tx, evento: EventoDeAuditoria): Promise<void> {
  const { ip, agente } = await contextoDaRequisicao();

  await tx.execute(sql`
    select public.audit_append(
      ${evento.acao},
      ${evento.entidade},
      ${evento.entidadeId ?? null}::uuid,
      ${evento.metadados === undefined ? null : JSON.stringify(evento.metadados)}::jsonb,
      ${ip},
      ${agente}
    )
  `);
}

/**
 * Registra sem deixar a falha escapar.
 *
 * Use em operações de LEITURA. Abrir a ficha de um paciente é auditável, e
 * também é a coisa mais comum que o produto faz — recusar a leitura porque a
 * trilha falhou transformaria um problema de registro num produto quebrado, no
 * meio de uma consulta.
 *
 * A assimetria é deliberada e é a regra: **escrita não acontece sem trilha;
 * leitura não para por causa dela.**
 *
 * ## Por que um `savepoint`, e não só um `catch`
 *
 * Um erro dentro de uma transação do Postgres **aborta a transação inteira**:
 * a partir dali, todo comando seguinte falha com "current transaction is
 * aborted". Um `try/catch` em volta da chamada engoliria a exceção do
 * JavaScript e deixaria a transação envenenada — e o sintoma apareceria na
 * consulta seguinte, longe daqui, como se fosse outro bug.
 *
 * O savepoint é o que torna o `catch` verdadeiro: `rollback to savepoint`
 * desfaz só a tentativa de auditar e devolve a transação utilizável.
 */
/**
 * Registra um evento quando ainda não há transação aberta.
 *
 * Existe para o login: naquele instante o cookie acabou de ser gravado e
 * nenhuma consulta foi feita ainda. Abre a própria transação com a identidade
 * recém-autenticada, e engole a falha — a pessoa entrou; recusar isso porque a
 * trilha falhou seria trancar a porta depois de abri-la.
 */
export async function auditarComIdentidade(
  authUserId: string,
  evento: EventoDeAuditoria,
): Promise<void> {
  await withProfessional(getDb(), authUserId, (tx) => auditar(tx, evento)).catch(
    () => undefined,
  );
}

/** Registra um evento do usuário logado, fora de uma transação. */
export async function auditarSessaoAtual(evento: EventoDeAuditoria): Promise<void> {
  await asCurrentUser((tx) => auditar(tx, evento)).catch(() => undefined);
}

export async function auditarLeitura(tx: Tx, evento: EventoDeAuditoria): Promise<void> {
  try {
    await tx.execute(sql`savepoint auditoria`);
  } catch {
    // Sem savepoint não há como isolar a falha. Melhor não tentar auditar do
    // que arriscar derrubar a leitura.
    return;
  }

  try {
    await auditar(tx, evento);
    await tx.execute(sql`release savepoint auditoria`);
  } catch {
    await tx.execute(sql`rollback to savepoint auditoria`).catch(() => undefined);
  }
}

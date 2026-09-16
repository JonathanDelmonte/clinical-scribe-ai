/**
 * Uma consulta inteira, pronta, sem precisar de GPU.
 *
 *     pnpm db:demo
 *
 * Existe para desacoplar quem trabalha no PRODUTO de quem trabalha no MOTOR.
 *
 * Sem isto, mexer na tela de revisão exige Docker com CUDA, o modelo large-v3
 * baixado, token do Hugging Face, chave de LLM e dez minutos de processamento
 * — para então ver um botão desalinhado. Com isto, `pnpm db:demo` põe no banco
 * uma sessão transcrita, com papéis atribuídos e nota gerada, e o trabalho de
 * interface começa em trinta segundos numa máquina sem placa de vídeo.
 *
 * TODO O CONTEÚDO É INVENTADO. Não é paciente, não é gravação, não é consulta
 * real de ninguém — é texto escrito à mão para parecer uma. Isso importa: um
 * "dado de exemplo" tirado de uma consulta verdadeira viraria dado de saúde
 * dentro do repositório, versionado para sempre.
 *
 * Idempotente: roda quantas vezes quiser.
 */

import { and, eq } from "drizzle-orm";

import { createServiceClient } from "./client";
import {
  documents,
  patients,
  professionals,
  sessions,
  transcriptSegments,
} from "./schema";

const url = process.env["DATABASE_URL"];
if (url === undefined || url === "") {
  console.error("DATABASE_URL não definida — copie .env.example para .env");
  process.exit(1);
}

/** O mesmo da Dra. Ana em `seed.ts`. */
const DEV_AUTH_USER = "aaaaaaaa-0000-4000-8000-000000000001";
/** Fixo para o seed ser idempotente e o link da sessão não mudar. */
const SESSAO_ID = "5eeded00-0000-4000-8000-000000000001";

type Papel = "professional" | "patient";

/**
 * A consulta.
 *
 * Nutrição, porque é a especialidade da Dra. Ana no seed — e porque é um dos
 * nichos que a §4 da documentação recomenda: menos disputado que medicina e
 * com a mesma dor de registro.
 *
 * Repare no que NÃO tem: ninguém examina ninguém. É deliberado. A nota abaixo
 * omite a seção de exame físico, e essa omissão é o comportamento correto que
 * o produto inteiro existe para garantir — seção vazia é melhor que seção
 * plausível.
 */
const FALAS: { papel: Papel; t: number; texto: string }[] = [
  {
    papel: "professional",
    t: 0,
    texto: "Bom dia, Marina. Pode sentar. Me conta o que te trouxe aqui hoje.",
  },
  {
    papel: "patient",
    t: 6,
    texto:
      "Bom dia, doutora. É que eu tô me sentindo muito cansada, sabe? Principalmente de tarde.",
  },
  { papel: "professional", t: 14, texto: "Há quanto tempo você sente isso?" },
  {
    papel: "patient",
    t: 17,
    texto: "Acho que uns dois meses, mais ou menos. Não sei precisar direito.",
  },
  {
    papel: "professional",
    t: 23,
    texto: "E tem algum horário que piora, ou é o dia todo?",
  },
  {
    papel: "patient",
    t: 28,
    texto:
      "Piora bastante depois do almoço. Umas duas da tarde eu não consigo mais render no trabalho.",
  },
  { papel: "professional", t: 37, texto: "Me conta o que você costuma almoçar." },
  {
    papel: "patient",
    t: 41,
    texto:
      "Ah, geralmente eu peço alguma coisa por aplicativo. Bastante massa, às vezes lanche mesmo.",
  },
  { papel: "professional", t: 50, texto: "E café da manhã, você faz?" },
  {
    papel: "patient",
    t: 53,
    texto: "Quase nunca. Só um café preto antes de sair correndo.",
  },
  {
    papel: "professional",
    t: 59,
    texto: "Entendi. E o sono, como está? Quantas horas você dorme por noite?",
  },
  {
    papel: "patient",
    t: 65,
    texto: "Umas cinco, seis horas. Durmo tarde por causa do trabalho.",
  },
  {
    papel: "professional",
    t: 72,
    texto: "Você tem alguma doença diagnosticada, ou faz uso de algum medicamento?",
  },
  {
    papel: "patient",
    t: 78,
    texto:
      "Tenho hipotireoidismo. Tomo levotiroxina cinquenta micro todo dia de manhã.",
  },
  {
    papel: "professional",
    t: 87,
    texto: "Certo. E fez exame de tireoide recentemente?",
  },
  {
    papel: "patient",
    t: 91,
    texto: "Faz uns oito meses que eu não faço. O último tava normal.",
  },
  {
    papel: "professional",
    t: 98,
    texto: "Alguma alergia alimentar, ou alimento que você não tolera?",
  },
  {
    papel: "patient",
    t: 103,
    texto: "Leite me dá desconforto. Eu evito, mas não fui investigar.",
  },
  {
    papel: "professional",
    t: 111,
    texto: "Na sua família tem alguém com diabetes ou problema de tireoide?",
  },
  {
    papel: "patient",
    t: 116,
    texto: "Minha mãe tem tireoide também. Diabetes eu acho que não.",
  },
  {
    papel: "professional",
    t: 123,
    texto:
      "Vou pedir um hemograma, ferritina, TSH e T4 livre. Quero descartar anemia antes de mexer na dieta.",
  },
  {
    papel: "patient",
    t: 134,
    texto: "Tá bom. Posso fazer no laboratório do convênio?",
  },
  {
    papel: "professional",
    t: 139,
    texto:
      "Pode. E até lá eu quero que você comece a fazer café da manhã, mesmo que simples: uma fruta e uma fonte de proteína.",
  },
  { papel: "patient", t: 149, texto: "Ovo serve?" },
  {
    papel: "professional",
    t: 151,
    texto:
      "Serve muito bem. E vamos marcar o retorno em quinze dias com os exames em mãos.",
  },
  { papel: "patient", t: 158, texto: "Combinado, doutora. Obrigada." },
];

const DURACAO_MS = 165_000;

const db = createServiceClient(url);

try {
  const [dona] = await db
    .select({ id: professionals.id })
    .from(professionals)
    .where(eq(professionals.authUserId, DEV_AUTH_USER))
    .limit(1);

  if (dona === undefined) {
    console.error("Rode `pnpm db:seed` antes — o profissional de exemplo não existe.");
    process.exit(1);
  }

  // Apagar e recriar em vez de atualizar: a nota cita IDs de trechos, e trechos
  // recriados têm IDs novos. Uma atualização parcial deixaria a nota apontando
  // para trechos que não existem mais — exatamente o defeito que o produto
  // existe para detectar, introduzido pelo próprio seed.
  await db.delete(sessions).where(eq(sessions.id, SESSAO_ID));

  // `onConflictDoNothing` não serve aqui: ele depende de uma restrição de
  // unicidade, e não existe uma sobre o nome do paciente — nem deveria, já que
  // dois pacientes podem se chamar igual. Sem restrição, o conflito nunca
  // acontece e cada execução do seed criava outra Marina.
  const NOME_EXEMPLO = "Marina Alves (exemplo)";

  const [existente] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.professionalId, dona.id), eq(patients.name, NOME_EXEMPLO)))
    .limit(1);

  const pacienteId =
    existente?.id ??
    (
      await db
        .insert(patients)
        .values({
          professionalId: dona.id,
          name: NOME_EXEMPLO,
          birthDate: new Date("1991-08-23"),
          notes: "Paciente fictícia, criada por `pnpm db:demo`.",
        })
        .returning({ id: patients.id })
    )[0]?.id;

  if (pacienteId === undefined) throw new Error("não foi possível criar o paciente");

  await db.insert(sessions).values({
    id: SESSAO_ID,
    professionalId: dona.id,
    patientId: pacienteId,
    status: "ready_for_review",
    durationMs: DURACAO_MS,
    engineUsed: "local",
    objectiveText: "Avaliar fadiga vespertina e orientar ajuste alimentar inicial.",
    // A mesma forma que `identifyRolesByContent` produz, evidência inclusa —
    // senão a tela de papéis mostraria um caminho que não existe em produção.
    roleAssignment: [
      {
        speakerLabel: "SPEAKER_00",
        role: "professional",
        confidence: 0.91,
        evidence: [
          {
            signal: "vou pedir/solicitar",
            excerpt: "Vou pedir um hemograma…",
            weight: 5,
          },
          {
            signal: "há quanto tempo",
            excerpt: "Há quanto tempo você sente isso?",
            weight: 4,
          },
          {
            signal: "retorno/rever",
            excerpt: "vamos marcar o retorno em quinze dias",
            weight: 4,
          },
        ],
      },
      {
        speakerLabel: "SPEAKER_01",
        role: "patient",
        confidence: 0.91,
        evidence: [
          { signal: "doutor/doutora", excerpt: "Bom dia, doutora.", weight: 5 },
          {
            signal: "eu tô/estou com",
            excerpt: "eu tô me sentindo muito cansada",
            weight: 4,
          },
        ],
      },
    ],
  });

  const inseridos = await db
    .insert(transcriptSegments)
    .values(
      FALAS.map((f, i) => ({
        sessionId: SESSAO_ID,
        professionalId: dona.id,
        speakerLabel: f.papel === "professional" ? "SPEAKER_00" : "SPEAKER_01",
        role: f.papel,
        roleSource: "llm" as const,
        startMs: f.t * 1000,
        endMs: (FALAS[i + 1]?.t ?? DURACAO_MS / 1000) * 1000 - 200,
        text: f.texto,
        confidence: 0.93,
      })),
    )
    .returning({ id: transcriptSegments.id });

  /** Índice na lista de falas → ID real gravado no banco. */
  const id = (indice: number): string => {
    const gerado = inseridos[indice]?.id;
    if (gerado === undefined) throw new Error(`trecho ${indice} não foi inserido`);
    return gerado;
  };

  const secoes = [
    {
      key: "queixaPrincipal",
      statements: [
        {
          path: "queixaPrincipal[0]",
          text: "Cansaço, principalmente no período da tarde.",
          sources: [id(1), id(5)],
        },
      ],
    },
    {
      key: "historiaDoencaAtual",
      statements: [
        {
          path: "historiaDoencaAtual[0]",
          text: "Início há cerca de dois meses, sem data precisa.",
          sources: [id(3)],
        },
        {
          path: "historiaDoencaAtual[1]",
          text: "Piora após o almoço, com queda de rendimento no trabalho por volta das 14h.",
          sources: [id(5)],
        },
        {
          path: "historiaDoencaAtual[2]",
          text: "Refere omitir o café da manhã, consumindo apenas café preto.",
          sources: [id(9)],
        },
        {
          path: "historiaDoencaAtual[3]",
          text: "Almoço habitual por delivery, com predomínio de massas e lanches.",
          sources: [id(7)],
        },
        {
          path: "historiaDoencaAtual[4]",
          text: "Dorme cinco a seis horas por noite.",
          sources: [id(11)],
        },
      ],
    },
    {
      key: "antecedentes",
      statements: [
        { path: "antecedentes[0]", text: "Hipotireoidismo.", sources: [id(13)] },
        {
          path: "antecedentes[1]",
          text: "Último exame de tireoide há cerca de oito meses, referido como normal.",
          sources: [id(15)],
        },
        {
          path: "antecedentes[2]",
          text: "Desconforto com leite, sem investigação prévia.",
          sources: [id(17)],
        },
        {
          path: "antecedentes[3]",
          text: "Mãe com doença tireoidiana.",
          sources: [id(19)],
        },
      ],
    },
    {
      key: "medicamentosEmUso",
      statements: [
        {
          path: "medicamentosEmUso[0]",
          text: "Levotiroxina 50 mcg, uma vez ao dia, pela manhã.",
          sources: [id(13)],
        },
      ],
    },
    // Sem `exameFisico`: ninguém examinou ninguém nesta consulta, e a seção
    // ausente É a resposta certa. Preenchê-la com o que "normalmente" apareceria
    // é a fabricação que mais passa despercebida (§11 da documentação).
    {
      key: "conduta",
      statements: [
        {
          path: "conduta[0]",
          text: "Solicitados hemograma, ferritina, TSH e T4 livre.",
          sources: [id(20)],
        },
        {
          path: "conduta[1]",
          text: "Orientado iniciar café da manhã com uma fruta e uma fonte de proteína.",
          sources: [id(22), id(24)],
        },
        {
          path: "conduta[2]",
          text: "Retorno em quinze dias com os exames.",
          sources: [id(24)],
        },
        // ⚠️ DEFEITO PROPOSITAL, e vale explicar por quê.
        //
        // Quem trabalha na interface precisa ver o estado de erro, e o estado
        // de erro é o que mais importa nesta tela. Sem uma afirmação quebrada
        // no exemplo, a marcação vermelha seria construída às cegas — ou só
        // apareceria no dia em que um modelo de verdade inventasse uma fonte,
        // que é o pior dia possível para descobrir que o aviso não funciona.
        //
        // Esta afirmação cita um trecho que não existe. A tela deve mostrá-la
        // em vermelho, com "cita trecho que não existe".
        {
          path: "conduta[3]",
          text: "Suplementação de vitamina D 2000 UI ao dia.",
          sources: ["seg_fabricado_para_teste"],
        },
      ],
    },
  ];

  await db.insert(documents).values({
    sessionId: SESSAO_ID,
    professionalId: dona.id,
    type: "clinical_note",
    content: { sections: secoes, provider: "seed-demo", dataPolicy: "contractual" },
    model: "exemplo",
    promptVersion: "nota-v1",
    citationIssues: [
      {
        kind: "unknown_segment",
        path: "conduta[3]",
        segmentId: "seg_fabricado_para_teste",
      },
    ],
  });

  console.log(`  ✓ paciente de exemplo`);
  console.log(`  ✓ sessão com ${inseridos.length} trechos e 2 falantes`);
  console.log(`  ✓ nota clínica com 5 seções (exame físico corretamente omitido)`);
  console.log(`  ✓ 1 citação fabricada de propósito, para exercitar o aviso da tela`);
  console.log(`\n  http://localhost:3000/sessoes/${SESSAO_ID}\n`);
  console.log(`  Sem áudio: o botão de ouvir a citação não toca nada, e é esperado.`);
} catch (error) {
  console.error("✗ falha no seed de demonstração:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  process.exit(0);
}

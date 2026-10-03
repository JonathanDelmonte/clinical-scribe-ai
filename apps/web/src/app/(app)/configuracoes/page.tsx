import { PLAN_DEFAULT_ENGINE, resolveEngine, type Account } from "@scribe/core";
import { cofreDisponivel } from "@scribe/auth";
import { helpers, sessions } from "@scribe/db";
import { AJUDANTE_LIGADO_SEGUNDOS } from "@scribe/processamento";
import { and, desc, isNotNull, isNull } from "drizzle-orm";
import Link from "next/link";

import {
  AjudanteDoComputador,
  type ComputadorConectado,
} from "@/components/AjudanteDoComputador";
import { ChaveDeIA } from "@/components/ChaveDeIA";
import { IconeAvancar } from "@/components/Icones";
import { RetencaoDeAudio } from "@/components/RetencaoDeAudio";
import { VoiceEnrollment } from "@/components/VoiceEnrollment";
import { linkDoAjudante } from "@/lib/ajudante/download";
import { asCurrentProfessional, exigirProfissional } from "@/lib/auth";
import { FORNECEDORES } from "@/lib/ia/fornecedores";
import { NOME_DO_PLANO } from "@/lib/plano";
import { haQuanto } from "@/lib/saudacao";

export const dynamic = "force-dynamic";

/** Espelha AUDIO_RETENTION_DAYS do worker. Só para exibir qual é o padrão. */
const RETENCAO_PADRAO = Number(process.env["AUDIO_RETENTION_DAYS"] ?? 30);
const MODELO_DO_SISTEMA = process.env["LLM_MODEL"] ?? "gemini-3.8-flash";

export default async function Configuracoes() {
  const me = await exigirProfissional();

  const account: Account = {
    role: me.role,
    plan: me.plan,
    preferredEngine: me.preferredEngine,
  };
  const decisao = resolveEngine(account);

  /**
   * Quantas consultas perderiam o áudio em cada escolha de retenção.
   *
   * Contado no servidor, antes de a tela aparecer, porque o número é o que
   * transforma "1 dia" de um rótulo abstrato numa consequência concreta. Sem
   * ele, encurtar a retenção é um clique inofensivo até o áudio sumir.
   */
  const OPCOES_DE_DIAS = [0, 1, 7, 30, 90, 365];
  const afetadasPorOpcao = await asCurrentProfessional(async (tx) => {
    const linhas = await tx
      .select({ endedAt: sessions.endedAt })
      .from(sessions)
      .where(and(isNotNull(sessions.audioPath), isNull(sessions.audioDeletedAt)));

    const agora = Date.now();
    return Object.fromEntries(
      OPCOES_DE_DIAS.map((dias) => {
        const corte = agora - dias * 24 * 60 * 60 * 1000;
        const n = linhas.filter(
          (l) => l.endedAt !== null && l.endedAt.getTime() < corte,
        ).length;
        return [dias, n];
      }),
    );
  }).catch(() => ({}));

  /**
   * Os computadores conectados, com a situação já em palavras. "Ligado" é o
   * mesmo critério da fila: visto há pouco E com o motor pronto — em pausa
   * pelo Docker, ele não processa.
   */
  const agora = new Date();
  const computadores: ComputadorConectado[] =
    (await asCurrentProfessional(async (tx) => {
      const linhas = await tx.select().from(helpers).orderBy(desc(helpers.lastSeenAt));
      return linhas.map((h) => {
        const recente =
          h.lastSeenAt !== null &&
          agora.getTime() - h.lastSeenAt.getTime() < AJUDANTE_LIGADO_SEGUNDOS * 1000;
        return {
          id: h.id,
          nome: h.name,
          motor: h.device === "cuda" ? "Placa de vídeo" : "Processador",
          ligado: recente && h.ready,
          situacao: recente
            ? h.ready
              ? "Ligado agora"
              : "Em pausa (o Docker está ligado nele)"
            : h.lastSeenAt === null
              ? "Ainda não ligou"
              : `Visto ${haQuanto(h.lastSeenAt, agora)}`,
        };
      });
    }).catch(() => [])) ?? [];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="titulo-pagina">Ajustes</h1>
        <p className="text-[15.5px] text-grafite">
          Sua voz, o ajudante, a IA que escreve as notas, o tempo de guarda do áudio e a
          sua conta.
        </p>
      </header>

      <VoiceEnrollment
        enrolledAt={me.voiceEnrolledAt?.toISOString() ?? null}
        nome={me.name}
        especialidade={me.specialty}
      />

      <AjudanteDoComputador
        computadores={computadores}
        linkDeDownload={linkDoAjudante()}
      />

      {/*
       * Só o que a tela precisa. A chave cifrada não atravessa esta fronteira
       * nem por descuido: o componente recebe a dica, nunca o segredo.
       */}
      <ChaveDeIA
        fornecedores={FORNECEDORES.map((f) => ({
          id: f.id,
          nome: f.nome,
          ondeConseguir: f.ondeConseguir,
          exemploModelo: f.exemploModelo,
          aceitaBaseUrl: f.aceitaBaseUrl,
        }))}
        atual={{
          provider: me.llmProvider,
          model: me.llmModel,
          hint: me.llmKeyHint,
          baseUrl: me.llmBaseUrl,
          dataPolicy: me.llmDataPolicy,
        }}
        cofreDisponivel={cofreDisponivel()}
        modeloDoSistema={MODELO_DO_SISTEMA}
      />

      <RetencaoDeAudio
        atual={me.audioRetentionDays}
        padraoDoServidor={RETENCAO_PADRAO}
        afetadasPorOpcao={afetadasPorOpcao ?? {}}
      />

      <section className="vidro flex flex-col gap-4 rounded-[26px] px-6 py-6">
        <h2 className="titulo-secao">Conta</h2>
        <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-2.5 text-[15px]">
          <dt className="text-[13px] font-semibold text-grafite">Nome</dt>
          <dd>{me.name}</dd>
          <dt className="text-[13px] font-semibold text-grafite">E-mail</dt>
          <dd className="break-all">{me.email ?? "não informado"}</dd>
          <dt className="text-[13px] font-semibold text-grafite">Especialidade</dt>
          <dd>{me.specialty ?? "não informada"}</dd>
          <dt className="text-[13px] font-semibold text-grafite">Cargo</dt>
          <dd>{me.role}</dd>
          <dt className="text-[13px] font-semibold text-grafite">Plano</dt>
          <dd>{NOME_DO_PLANO[me.plan] ?? me.plan}</dd>
          <dt className="text-[13px] font-semibold text-grafite">Motor</dt>
          <dd>
            {decisao.engine}{" "}
            <span className="text-nevoa">
              (
              {decisao.reason === "plan-default"
                ? `padrão do plano ${me.plan}`
                : "escolha do desenvolvedor"}
              )
            </span>
          </dd>
        </dl>
        {me.role === "developer" && (
          <p className="legenda">
            Como desenvolvedor você escolhe o motor em cada sessão. No plano {me.plan} o
            padrão é <code>{PLAN_DEFAULT_ENGINE[me.plan]}</code>.
          </p>
        )}
      </section>

      <nav aria-label="Mais ajustes" className="flex flex-col gap-2">
        {[
          {
            href: "/bem-vindo",
            titulo: "Perfil e assinatura",
            detalhe: "Nome nos documentos, especialidade, registro e assinatura",
          },
          {
            href: "/auditoria",
            titulo: "Trilha de auditoria",
            detalhe: "Tudo o que aconteceu na sua conta, em ordem",
          },
          {
            href: "/configuracoes/dados",
            titulo: "Seus dados",
            detalhe: "Baixar tudo o que está guardado, ou excluir a conta",
          },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="vidro flex items-center gap-4 rounded-[20px] px-5 py-4 text-tinta no-underline transition-colors hover:bg-white/80"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-semibold">{l.titulo}</span>
              <span className="text-[13.5px] text-nevoa">{l.detalhe}</span>
            </span>
            <IconeAvancar tamanho={18} className="shrink-0 text-nevoa" />
          </Link>
        ))}
      </nav>
    </div>
  );
}

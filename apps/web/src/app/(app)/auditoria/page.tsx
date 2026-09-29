import { auditLog } from "@scribe/db";
import { desc } from "drizzle-orm";
import Link from "next/link";

import { IconeAvancar } from "@/components/Icones";
import { asCurrentUser, exigirProfissional } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Rótulos legíveis para as ações registradas.
 *
 * Uma ação nova que ainda não tenha rótulo aparece com o código cru. É o
 * comportamento certo: o evento existe na trilha e some da tela seria pior que
 * feio — seria uma trilha incompleta que parece completa.
 */
const ROTULO: Record<string, string> = {
  "auth.entrar": "entrou no sistema",
  "auth.sair": "saiu do sistema",
  "auth.cadastrar": "criou a conta",
  "perfil.atualizado": "atualizou o perfil",

  "paciente.criado": "cadastrou um paciente",
  "paciente.aberto": "abriu a ficha de um paciente",
  "paciente.editado": "editou a ficha de um paciente",
  "paciente.arquivado": "arquivou um paciente",

  "sessao.criada": "iniciou uma consulta",
  "sessao.aberta": "abriu uma consulta",
  "sessao.descartada": "descartou uma consulta sem gravação",
  "sessao.audio_enviado": "enviou o áudio de uma consulta",
  "sessao.audio_baixado": "ouviu ou baixou o áudio de uma consulta",
  "sessao.audio_apagado": "áudio apagado pela política de retenção",
  "sessao.reprocessada": "mandou processar de novo",

  "documento.nota_aprovada": "aprovou uma nota clínica",
  "documento.exportado": "exportou um documento",

  "lgpd.dados_exportados": "exportou todos os seus dados",
  "lgpd.conta_excluida": "pediu a exclusão da conta",
};

/** Ações que merecem destaque: são as que tiram dado do sistema. */
const SENSIVEIS = new Set([
  "sessao.audio_baixado",
  "documento.exportado",
  "lgpd.dados_exportados",
  "lgpd.conta_excluida",
]);

export default async function Auditoria() {
  await exigirProfissional();

  const linhas =
    (await asCurrentUser((tx) =>
      tx.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(200),
    ).catch(() => null)) ?? [];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <nav
          aria-label="Caminho"
          className="flex items-center gap-1.5 text-sm text-grafite"
        >
          <Link
            href="/configuracoes"
            className="text-grafite no-underline hover:text-tinta"
          >
            Ajustes
          </Link>
          <IconeAvancar tamanho={14} className="text-nevoa" />
          <span className="text-tinta">Auditoria</span>
        </nav>
        <h1 className="titulo-pagina">Trilha de auditoria</h1>
        {/*
         * A frase é precisa de propósito. "Nem por nós" seria mentira: quem tem
         * acesso administrativo ao banco tem acesso administrativo ao banco. O
         * que dá para afirmar é o que está implementado — a aplicação não tem
         * caminho para alterar nem apagar —, e num produto cujo argumento é
         * confiança, prometer a mais é pior que prometer de menos.
         */}
        <p className="text-[15.5px] leading-relaxed text-grafite">
          Tudo o que aconteceu na sua conta. A aplicação só sabe acrescentar: não existe
          caminho, nem para você nem para ela, que altere ou apague um registro daqui.
        </p>
      </header>

      {linhas.length === 0 ? (
        <p className="px-1 text-[15px] text-grafite">Nada registrado ainda.</p>
      ) : (
        <ul className="vidro flex flex-col rounded-[26px] p-2">
          {linhas.map((l) => (
            <li
              key={l.id}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 rounded-[16px] px-4 py-3 text-[14.5px] odd:bg-white/45"
            >
              <span className="w-[9.5rem] shrink-0 text-[13px] text-nevoa tabular-nums">
                {l.createdAt.toLocaleString("pt-BR", {
                  dateStyle: "short",
                  timeStyle: "medium",
                  timeZone: "America/Sao_Paulo",
                })}
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                {SENSIVEIS.has(l.action) && (
                  <span
                    aria-hidden="true"
                    title="Tirou dados do sistema"
                    className="size-2 shrink-0 rounded-full bg-pessego"
                  />
                )}
                <span className={SENSIVEIS.has(l.action) ? "font-semibold" : undefined}>
                  {ROTULO[l.action] ?? l.action}
                  {SENSIVEIS.has(l.action) && (
                    <span className="sr-only"> (tirou dados do sistema)</span>
                  )}
                </span>
              </span>
              {l.ip !== null && (
                <span className="text-[13px] text-nevoa tabular-nums">{l.ip}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {linhas.length === 200 && (
        <p className="legenda px-1">Mostrando os 200 eventos mais recentes.</p>
      )}

      <div className="alerta alerta-info mt-2">
        <p>
          <strong className="font-semibold text-tinta">
            Por que a trilha guarda IDs e não conteúdo.
          </strong>{" "}
          Registrar o que mudou transformaria esta tabela numa segunda cópia do
          prontuário, sem as proteções que a primeira tem. Aqui ficam a ação, o
          identificador do registro afetado, o horário e a origem do acesso: o
          suficiente para reconstruir o que aconteceu, sem duplicar o que foi dito.
        </p>
      </div>
    </div>
  );
}

import { auditLog } from "@scribe/db";
import { desc } from "drizzle-orm";
import Link from "next/link";

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
    <main className="mx-auto max-w-3xl px-5 py-10">
      <nav className="mb-6 text-sm text-muted">
        <Link href="/configuracoes" className="hover:text-ink">
          ← configurações
        </Link>
      </nav>

      <h1 className="text-2xl font-semibold tracking-tight">Trilha de auditoria</h1>
      {/*
       * A frase é precisa de propósito. "Nem por nós" seria mentira: quem tem
       * acesso administrativo ao banco tem acesso administrativo ao banco. O
       * que dá para afirmar é o que está implementado — a aplicação não tem
       * caminho para alterar nem apagar —, e num produto cujo argumento é
       * confiança, prometer a mais é pior que prometer de menos.
       */}
      <p className="mt-1 mb-8 text-sm text-muted">
        Tudo o que aconteceu na sua conta. A aplicação só sabe acrescentar: não existe
        caminho, nem para você nem para ela, que altere ou apague um registro daqui.
      </p>

      {linhas.length === 0 ? (
        <p className="text-sm text-muted">Nada registrado ainda.</p>
      ) : (
        <ul className="space-y-1.5">
          {linhas.map((l) => (
            <li
              key={l.id}
              className={`flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-lg border px-4 py-2.5 text-sm ${
                SENSIVEIS.has(l.action) ? "border-accent/40" : "border-line"
              }`}
            >
              <span className="text-xs text-muted tabular-nums">
                {l.createdAt.toLocaleString("pt-BR", {
                  dateStyle: "short",
                  timeStyle: "medium",
                })}
              </span>
              <span className="min-w-0 flex-1">{ROTULO[l.action] ?? l.action}</span>
              {l.ip !== null && (
                <span className="text-xs text-muted tabular-nums">{l.ip}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {linhas.length === 200 && (
        <p className="mt-4 text-xs text-muted">
          Mostrando os 200 eventos mais recentes.
        </p>
      )}

      <div className="mt-10 rounded-lg border border-line px-4 py-3 text-xs text-muted">
        <p>
          <strong className="text-ink">
            Por que a trilha guarda IDs e não conteúdo.
          </strong>{" "}
          Registrar o que mudou transformaria esta tabela numa segunda cópia do
          prontuário, sem as proteções que a primeira tem. Aqui ficam a ação, o
          identificador do registro afetado, o horário e a origem do acesso — o
          suficiente para reconstruir o que aconteceu, sem duplicar o que foi dito.
        </p>
      </div>
    </main>
  );
}

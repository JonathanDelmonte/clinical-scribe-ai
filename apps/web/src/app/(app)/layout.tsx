import { PLAN_MONTHLY_MINUTES, type Account } from "@scribe/core";

import { Atmosfera } from "@/components/Atmosfera";
import { BarraInferior } from "@/components/BarraInferior";
import { BarraLateral } from "@/components/BarraLateral";
import { asCurrentUser, currentProfessional } from "@/lib/auth";
import { quotaDoMes } from "@/lib/quota";
import { periodoDoDia } from "@/lib/saudacao";

/**
 * A casca da aplicação: a luz ao fundo, a barra lateral no computador e a
 * barra inferior no celular.
 *
 * Este layout NÃO exige perfil completo — só lê quem está entrando. Quem
 * decide para onde mandar é cada página (`exigirProfissional`), e é assim que
 * `/bem-vindo` pode morar aqui dentro sem cair num redirecionamento para si
 * mesma.
 *
 * Sem navegação enquanto o primeiro passo não termina: com o perfil
 * incompleto, todo destino da barra devolveria a pessoa para `/bem-vindo`, e
 * uma barra cheia de caminhos que não levam a lugar nenhum é pior que
 * nenhuma.
 */
export default async function LayoutDoApp({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const me = await currentProfessional().catch(() => null);

  const account: Account | null =
    me === null
      ? null
      : { role: me.role, plan: me.plan, preferredEngine: me.preferredEngine };

  const navegacao = me !== null && me.onboardedAt !== null;

  const quota =
    account === null
      ? null
      : await asCurrentUser((tx) => quotaDoMes(tx, account)).catch(() => null);

  return (
    <>
      <Atmosfera luz={periodoDoDia(new Date())} />

      <div className="mx-auto flex min-h-dvh max-w-[1560px] gap-8 px-4 pt-4 pb-32 sm:px-6 lg:px-5 lg:py-5">
        {navegacao && (
          <BarraLateral
            className="sticky top-5 hidden h-[calc(100dvh-2.5rem)] lg:flex"
            profissional={{
              id: me.id,
              nome: me.name,
              detalhe: [
                me.specialty === null
                  ? null
                  : me.specialty.charAt(0).toLocaleUpperCase("pt-BR") +
                    me.specialty.slice(1),
                me.professionalRegistry,
              ]
                .filter((parte) => parte !== null && parte !== "")
                .join(" · "),
              plano: me.plan,
            }}
            minutosUsados={quota?.usados ?? 0}
            tetoMinutos={
              quota?.restantes === null ? null : PLAN_MONTHLY_MINUTES[me.plan]
            }
          />
        )}

        <main className="min-w-0 flex-1 lg:pt-3">{children}</main>
      </div>

      {navegacao && <BarraInferior />}
    </>
  );
}

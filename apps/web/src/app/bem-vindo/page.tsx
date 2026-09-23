import { OnboardingForm } from "@/components/OnboardingForm";
import { exigirSessao } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function BemVindo() {
  // `exigirSessao` e não `exigirProfissional`: esta é justamente a tela de
  // quem ainda não tem perfil. Exigir o perfil aqui criaria o laço de
  // redirecionamento mais clássico que existe.
  const me = await exigirSessao();

  return (
    <main className="mx-auto max-w-md px-5 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">
        {me.onboardedAt === null ? "Bem-vindo" : "Seu perfil"}
      </h1>
      <p className="mt-1 mb-8 text-sm text-muted">
        {me.onboardedAt === null
          ? "Passo 1 de 2. Três campos e a gente começa — dá para mudar tudo depois."
          : "Altere o que precisar. As mudanças valem para os próximos documentos."}
      </p>

      <OnboardingForm
        nomeInicial={me.name}
        especialidadeInicial={me.specialty}
        primeiraVez={me.onboardedAt === null}
      />
    </main>
  );
}

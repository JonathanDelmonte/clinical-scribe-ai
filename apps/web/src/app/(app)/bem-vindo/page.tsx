import { OnboardingForm } from "@/components/OnboardingForm";
import { Passos } from "@/components/Passos";
import { exigirSessao } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function BemVindo() {
  // `exigirSessao` e não `exigirProfissional`: esta é justamente a tela de
  // quem ainda não tem perfil. Exigir o perfil aqui criaria o laço de
  // redirecionamento mais clássico que existe.
  const me = await exigirSessao();

  const primeiraVez = me.onboardedAt === null;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-7 py-2 lg:py-8">
      <header className="surgir flex flex-col gap-3">
        {primeiraVez && <Passos atual={1} />}
        <h1 className="titulo-pagina">{primeiraVez ? "Boas-vindas." : "Seu perfil"}</h1>
        <p className="text-[16px] leading-relaxed text-grafite">
          {primeiraVez
            ? "Três campos e a gente começa. Dá para mudar tudo depois."
            : "Altere o que precisar. As mudanças valem para os próximos documentos."}
        </p>
      </header>

      <div className="vidro surgir surgir-2 rounded-[30px] px-6 py-7 sm:px-8">
        <OnboardingForm
          nomeInicial={me.name}
          especialidadeInicial={me.specialty}
          primeiraVez={primeiraVez}
        />
      </div>
    </div>
  );
}

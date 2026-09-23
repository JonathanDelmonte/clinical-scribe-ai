import { redirect } from "next/navigation";

import { PassoDeVoz } from "@/components/PassoDeVoz";
import { exigirProfissional } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Segundo passo da chegada: a voz.
 *
 * Numa rota própria e não dentro do formulário de perfil porque os dois pedem
 * coisas de naturezas diferentes. O perfil é digitar; a voz é dar permissão de
 * microfone e falar em voz alta — e falar em voz alta é algo que a pessoa pode
 * não poder fazer agora, por estar num lugar público ou com alguém ao lado.
 *
 * Passos separados deixam o perfil salvo mesmo quando a voz não acontece.
 * Juntos, um microfone negado levaria embora os dados já digitados.
 */
export default async function PassoDeVozPage() {
  const me = await exigirProfissional();

  // Quem já cadastrou não precisa ser perguntado de novo. Chegar aqui com a
  // voz pronta significa link antigo, botão de voltar, ou recarregar depois
  // de gravar — em todos os casos, o lugar certo é a aplicação.
  if (me.voiceEnrolledAt !== null) redirect("/");

  return (
    <main className="mx-auto max-w-md px-5 py-12">
      <p className="mb-1 text-xs tracking-widest text-muted uppercase">passo 2 de 2</p>
      <h1 className="text-2xl font-semibold tracking-tight">Sua voz (opcional)</h1>
      <p className="mt-1 mb-8 text-sm text-muted">
        Se o sistema conhecer sua voz, ele acerta mais quando decide quais falas são
        suas e quais são do paciente. Leva meio minuto — e dá para deixar para depois.
      </p>

      <PassoDeVoz enrolledAt={null} />
    </main>
  );
}

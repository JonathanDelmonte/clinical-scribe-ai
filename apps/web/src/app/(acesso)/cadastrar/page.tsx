import Link from "next/link";

import { AuthForm } from "@/components/AuthForm";
import { CartaoDeAcesso } from "@/components/CartaoDeAcesso";

export const dynamic = "force-dynamic";

export default function Cadastrar() {
  return (
    <CartaoDeAcesso
      aba="cadastrar"
      titulo="Vamos começar."
      subtitulo="Leva menos de um minuto. O perfil você completa em seguida."
    >
      <AuthForm modo="cadastrar" destino="/bem-vindo" />

      <p className="legenda mt-5">
        O áudio das consultas é processado para gerar a sua documentação e mais nada,
        pelo motor local, sem fornecedor externo no caminho. Ao criar a conta você
        aceita os{" "}
        <Link href="/termos" className="font-medium text-viva-texto hover:underline">
          termos de uso
        </Link>{" "}
        e a{" "}
        <Link
          href="/privacidade"
          className="font-medium text-viva-texto hover:underline"
        >
          política de privacidade
        </Link>
        .
      </p>
    </CartaoDeAcesso>
  );
}

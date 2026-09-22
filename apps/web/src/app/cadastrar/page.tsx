import Link from "next/link";

import { AuthForm } from "@/components/AuthForm";

export const dynamic = "force-dynamic";

export default function Cadastrar() {
  return (
    <main className="mx-auto max-w-sm px-5 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Criar conta</h1>
      <p className="mt-1 mb-8 text-sm text-muted">
        Leva menos de um minuto. O perfil você completa em seguida.
      </p>

      <AuthForm modo="cadastrar" destino="/bem-vindo" />

      {/*
       * A promessa de dados fica na tela de cadastro, não escondida nos
       * termos. É o momento em que a pessoa decide confiar, e é o argumento
       * que a §10 da documentação transforma em recurso de produto.
       */}
      <div className="mt-8 rounded-lg border border-line px-4 py-3 text-xs text-muted">
        <p>
          <strong className="text-ink">Seus dados não treinam nenhuma IA.</strong> O
          áudio das consultas é processado para gerar a sua documentação e mais nada.
        </p>
        <p className="mt-2">
          O áudio fica no Brasil e é processado pelo motor local — sem fornecedor
          externo no caminho.
        </p>
        <p className="mt-2">
          Ao criar a conta você aceita os{" "}
          <Link href="/termos" className="text-accent hover:underline">
            termos de uso
          </Link>{" "}
          e a{" "}
          <Link href="/privacidade" className="text-accent hover:underline">
            política de privacidade
          </Link>
          .
        </p>
      </div>

      <p className="mt-6 text-sm text-muted">
        Já tem conta?{" "}
        <Link href="/entrar" className="text-accent hover:underline">
          Entrar
        </Link>
      </p>
    </main>
  );
}

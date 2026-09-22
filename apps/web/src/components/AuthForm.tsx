"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Modo = "entrar" | "cadastrar";

/**
 * Entrar e cadastrar — o mesmo formulário, dois modos.
 *
 * Um componente e não dois porque a diferença entre eles é um campo e um
 * endereço. Duplicar traria, de brinde, duas versões do tratamento de erro,
 * do estado de envio e do foco — e elas divergem na primeira correção.
 *
 * `router.replace` e não `push` depois de entrar: voltar para a tela de login
 * com o botão de voltar, já logado, é um beco sem saída de que só se sai
 * digitando o endereço.
 */
export function AuthForm({ modo, destino }: { modo: Modo; destino: string }) {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const cadastro = modo === "cadastrar";

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (enviando) return;

    setEnviando(true);
    setErro(null);
    try {
      const resposta = await fetch(`/api/auth/${modo}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cadastro ? { nome, email, senha } : { email, senha }),
      });

      if (!resposta.ok) {
        const corpo: unknown = await resposta.json().catch(() => null);
        setErro(
          typeof corpo === "object" && corpo !== null && "error" in corpo
            ? String((corpo as { error: unknown }).error)
            : "Não foi possível continuar.",
        );
        return;
      }

      router.replace(cadastro ? "/bem-vindo" : destino);
      router.refresh();
    } catch {
      setErro("Sem conexão com o servidor.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      {cadastro && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium tracking-widest text-muted uppercase">
            Seu nome
          </span>
          <input
            className="w-full rounded-lg border border-line bg-transparent px-3 py-2.5 text-sm"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            autoComplete="name"
            maxLength={200}
            required
          />
        </label>
      )}

      <label className="block">
        <span className="mb-1 block text-xs font-medium tracking-widest text-muted uppercase">
          E-mail
        </span>
        <input
          type="email"
          className="w-full rounded-lg border border-line bg-transparent px-3 py-2.5 text-sm"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          inputMode="email"
          maxLength={320}
          required
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium tracking-widest text-muted uppercase">
          Senha
        </span>
        <input
          type="password"
          className="w-full rounded-lg border border-line bg-transparent px-3 py-2.5 text-sm"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          // `new-password` no cadastro faz o gerenciador de senhas OFERECER uma
          // forte; `current-password` no login faz ele PREENCHER a salva. O
          // valor errado aqui é o motivo mais comum de "meu cofre não
          // reconhece este site".
          autoComplete={cadastro ? "new-password" : "current-password"}
          minLength={cadastro ? 10 : undefined}
          maxLength={500}
          required
        />
        {cadastro && (
          <span className="mt-1 block text-xs text-muted">
            Pelo menos 10 caracteres. Uma frase que só você saiba vale mais que símbolos
            difíceis de digitar no celular.
          </span>
        )}
      </label>

      <button
        type="submit"
        disabled={enviando}
        className="w-full rounded-lg bg-accent px-5 py-2.5 font-medium text-surface disabled:opacity-40"
      >
        {enviando ? "Aguarde…" : cadastro ? "Criar conta" : "Entrar"}
      </button>

      {erro !== null && (
        <p role="alert" className="text-sm text-red-500">
          {erro}
        </p>
      )}
    </form>
  );
}

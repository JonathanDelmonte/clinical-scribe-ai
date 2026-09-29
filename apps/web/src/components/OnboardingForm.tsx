"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { IconeSeta } from "./Icones";
import { SignaturePad } from "./SignaturePad";

/**
 * Especialidades que o produto já sabe documentar.
 *
 * A lista é curta de propósito, e a documentação (§4) explica por quê: o
 * caminho é dominar o template de uma especialidade antes de oferecer trinta
 * pela metade. "Outra" existe para não barrar quem chegou antes da sua vez.
 */
const ESPECIALIDADES = [
  "nutrição",
  "psicologia",
  "psiquiatria",
  "clínica médica",
  "fisioterapia",
  "fonoaudiologia",
  "odontologia",
  "outra",
];

/** Os conselhos mais comuns. O número é texto: cada conselho formata o seu. */
const CONSELHOS = ["CRM", "CRN", "CRP", "CREFITO", "CRFa", "CRO", "outro"];

export function OnboardingForm({
  nomeInicial,
  especialidadeInicial,
  primeiraVez,
}: {
  nomeInicial: string;
  especialidadeInicial: string | null;
  /** Chegando agora, ou voltando para corrigir o perfil? */
  primeiraVez: boolean;
}) {
  const router = useRouter();
  const [nome, setNome] = useState(nomeInicial);
  const [especialidade, setEspecialidade] = useState(especialidadeInicial ?? "");
  const [conselho, setConselho] = useState("");
  const [registro, setRegistro] = useState("");
  const [assinatura, setAssinatura] = useState<Blob | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (enviando) return;

    setEnviando(true);
    setErro(null);
    try {
      // Multipart e não JSON: a assinatura é um PNG. Embutir binário em JSON
      // custaria 33% a mais em base64, num formulário que às vezes é enviado
      // por rede de celular.
      const form = new FormData();
      form.append("nome", nome.trim());
      form.append("especialidade", especialidade);
      form.append(
        "registro",
        conselho === "" || registro.trim() === ""
          ? ""
          : `${conselho} ${registro.trim()}`,
      );
      if (assinatura !== null) form.append("assinatura", assinatura, "assinatura.png");

      const resposta = await fetch("/api/perfil", { method: "POST", body: form });
      if (!resposta.ok) {
        const corpo: unknown = await resposta.json().catch(() => null);
        setErro(
          typeof corpo === "object" && corpo !== null && "error" in corpo
            ? String((corpo as { error: unknown }).error)
            : "Não foi possível salvar.",
        );
        return;
      }

      /**
       * Primeira vez vai para o passo da voz; edição de perfil, direto para a
       * aplicação.
       *
       * A mesma tela serve aos dois casos — chegar e corrigir o registro
       * profissional depois — e mandar quem só trocou o nome para uma tela de
       * cadastro de voz seria oferecer algo que ela não pediu, no meio de uma
       * tarefa que já terminou.
       */
      router.replace(primeiraVez ? "/bem-vindo/voz" : "/");
      router.refresh();
    } catch {
      setErro("Sem conexão com o servidor.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-6">
      <label className="block">
        <span className="rotulo">Como você assina</span>
        <input
          className="campo"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          maxLength={200}
          required
        />
        <span className="legenda mt-1.5 block">
          É o nome que aparece nos documentos exportados.
        </span>
      </label>

      <label className="block">
        <span className="rotulo">Especialidade</span>
        <select
          className="campo"
          value={especialidade}
          onChange={(e) => setEspecialidade(e.target.value)}
          required
        >
          <option value="">selecione…</option>
          {ESPECIALIDADES.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <span className="legenda mt-1.5 block">Define o modelo da nota clínica.</span>
      </label>

      <div>
        <span className="rotulo">Registro profissional (opcional)</span>
        <div className="flex gap-2">
          <select
            className="campo w-36 shrink-0"
            value={conselho}
            onChange={(e) => setConselho(e.target.value)}
            aria-label="Conselho"
          >
            <option value="">conselho</option>
            {CONSELHOS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            className="campo min-w-0 flex-1"
            placeholder="número e UF"
            value={registro}
            onChange={(e) => setRegistro(e.target.value)}
            maxLength={60}
            aria-label="Número do registro"
          />
        </div>
      </div>

      <div>
        <span className="rotulo">Assinatura (opcional)</span>
        <SignaturePad onChange={setAssinatura} />
        <span className="legenda mt-1.5 block">
          Aparece no rodapé do PDF. Não substitui assinatura digital ICP-Brasil: o
          produto exporta para o prontuário que você já usa.
        </span>
      </div>

      {erro !== null && (
        <p role="alert" className="alerta alerta-erro">
          {erro}
        </p>
      )}

      <button type="submit" disabled={enviando} className="botao-principal self-start">
        {enviando ? "Salvando…" : primeiraVez ? "Continuar" : "Salvar perfil"}
        <span className="botao-icone" aria-hidden="true">
          <IconeSeta tamanho={18} />
        </span>
      </button>
    </form>
  );
}

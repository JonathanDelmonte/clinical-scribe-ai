"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { dataParaExibicao, idadeEmAnos } from "@/lib/patients";

export interface PatientDetailsProps {
  id: string;
  nome: string;
  /** `YYYY-MM-DD`, já normalizado no servidor. Vazio quando não há data. */
  nascimento: string;
  observacoes: string;
  /** Quantas consultas ficam preservadas se o paciente for arquivado. */
  sessoes: number;
}

/**
 * Ficha do paciente — ver, editar e arquivar.
 *
 * Abre em modo de leitura. Um formulário sempre editável convida ao toque
 * errado, e num aparelho na mesa do consultório o toque errado acontece —
 * especialmente no campo que decide de quem é o prontuário que está aberto.
 */
export function PatientDetails(props: PatientDetailsProps) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(props.nome);
  const [nascimento, setNascimento] = useState(props.nascimento);
  const [observacoes, setObservacoes] = useState(props.observacoes);
  const [confirmandoArquivar, setConfirmandoArquivar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const idade =
    props.nascimento === ""
      ? null
      : idadeEmAnos(new Date(`${props.nascimento}T00:00:00Z`));

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    if (ocupado) return;

    setOcupado(true);
    setErro(null);
    try {
      const resposta = await fetch(`/api/patients/${props.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nome.trim(),
          birthDate: nascimento === "" ? null : nascimento,
          notes: observacoes.trim() === "" ? null : observacoes.trim(),
        }),
      });

      if (!resposta.ok) {
        const corpo: unknown = await resposta.json().catch(() => null);
        setErro(
          typeof corpo === "object" && corpo !== null && "error" in corpo
            ? String((corpo as { error: unknown }).error)
            : "Não foi possível salvar.",
        );
        return;
      }

      setEditando(false);
      router.refresh();
    } finally {
      setOcupado(false);
    }
  }

  async function arquivar() {
    if (!confirmandoArquivar) {
      setConfirmandoArquivar(true);
      return;
    }
    if (ocupado) return;

    setOcupado(true);
    setErro(null);
    try {
      const resposta = await fetch(`/api/patients/${props.id}`, { method: "DELETE" });
      if (!resposta.ok) {
        setErro("Não foi possível arquivar.");
        return;
      }
      router.replace("/");
      router.refresh();
    } finally {
      setOcupado(false);
    }
  }

  if (!editando) {
    return (
      <div className="rounded-lg border border-line px-5 py-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-muted">nascimento</dt>
          <dd>
            {props.nascimento === ""
              ? "—"
              : `${dataParaExibicao(props.nascimento)}${idade === null ? "" : ` · ${idade} anos`}`}
          </dd>
          <dt className="text-muted">observações</dt>
          <dd className="whitespace-pre-wrap">
            {props.observacoes === "" ? "—" : props.observacoes}
          </dd>
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button
            onClick={() => setEditando(true)}
            className="text-sm text-accent hover:underline"
          >
            editar ficha
          </button>

          <button
            onClick={() => void arquivar()}
            disabled={ocupado}
            className={`text-sm ${
              confirmandoArquivar
                ? "font-medium text-red-500"
                : "text-muted underline underline-offset-2 hover:text-ink"
            }`}
          >
            {confirmandoArquivar
              ? `Confirmar: arquivar ${props.nome}`
              : "arquivar paciente"}
          </button>

          {confirmandoArquivar && (
            <button
              onClick={() => setConfirmandoArquivar(false)}
              className="text-sm text-muted underline underline-offset-2 hover:text-ink"
            >
              cancelar
            </button>
          )}
        </div>

        {confirmandoArquivar && (
          <p className="mt-2 text-xs text-muted">
            O paciente sai da lista.{" "}
            {props.sessoes === 0
              ? "Não há consultas gravadas."
              : `As ${props.sessoes} consultas gravadas são preservadas — registro clínico não some por causa de uma lista.`}
          </p>
        )}

        {erro !== null && (
          <p role="alert" className="mt-2 text-sm text-red-500">
            {erro}
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={salvar}
      className="space-y-4 rounded-lg border border-line px-5 py-4"
    >
      <label className="block">
        <span className="mb-1 block text-xs font-medium tracking-widest text-muted uppercase">
          Nome
        </span>
        <input
          className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          maxLength={200}
          required
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium tracking-widest text-muted uppercase">
          Nascimento
        </span>
        <input
          type="date"
          className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm"
          value={nascimento}
          onChange={(e) => setNascimento(e.target.value)}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium tracking-widest text-muted uppercase">
          Observações
        </span>
        <textarea
          className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm"
          rows={3}
          value={observacoes}
          onChange={(e) => setObservacoes(e.target.value)}
          maxLength={5000}
        />
        <span className="mt-1 block text-xs text-muted">
          Contexto permanente do paciente — alergias, preferências, o que você quer ter
          à mão em toda consulta. Não substitui a nota clínica.
        </span>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={ocupado}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface disabled:opacity-40"
        >
          {ocupado ? "Salvando…" : "Salvar"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditando(false);
            setNome(props.nome);
            setNascimento(props.nascimento);
            setObservacoes(props.observacoes);
            setErro(null);
          }}
          className="text-sm text-muted underline underline-offset-2 hover:text-ink"
        >
          cancelar
        </button>
      </div>

      {erro !== null && (
        <p role="alert" className="text-sm text-red-500">
          {erro}
        </p>
      )}
    </form>
  );
}

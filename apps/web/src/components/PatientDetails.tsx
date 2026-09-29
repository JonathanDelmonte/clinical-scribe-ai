"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { dataParaExibicao, idadeEmAnos } from "@/lib/patients";

import { IconeEditar } from "./Icones";

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
      <div className="rounded-[20px] border border-white/85 bg-white/50 px-5 py-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[15px]">
          <dt className="text-[13px] font-semibold text-grafite">Nascimento</dt>
          <dd>
            {props.nascimento === ""
              ? "—"
              : `${dataParaExibicao(props.nascimento)}${idade === null ? "" : ` · ${idade} anos`}`}
          </dd>
          <dt className="text-[13px] font-semibold text-grafite">Observações</dt>
          <dd className="leading-relaxed whitespace-pre-wrap">
            {props.observacoes === "" ? "—" : props.observacoes}
          </dd>
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-5">
          <button
            type="button"
            onClick={() => setEditando(true)}
            className="botao-texto"
          >
            <IconeEditar tamanho={16} />
            Editar ficha
          </button>

          <button
            type="button"
            onClick={() => void arquivar()}
            disabled={ocupado}
            className={`botao-texto ${confirmandoArquivar ? "perigo font-semibold" : ""}`}
          >
            {confirmandoArquivar
              ? `Confirmar: arquivar ${props.nome}`
              : "Arquivar paciente"}
          </button>

          {confirmandoArquivar && (
            <button
              type="button"
              onClick={() => setConfirmandoArquivar(false)}
              className="botao-texto"
            >
              Cancelar
            </button>
          )}
        </div>

        {confirmandoArquivar && (
          <p className="legenda mt-2">
            O paciente sai da lista.{" "}
            {props.sessoes === 0
              ? "Não há consultas gravadas."
              : `As ${props.sessoes} consultas gravadas são preservadas — registro clínico não some por causa de uma lista.`}
          </p>
        )}

        {erro !== null && (
          <p role="alert" className="alerta alerta-erro mt-3">
            {erro}
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={salvar}
      className="space-y-4 rounded-[20px] border border-white/85 bg-white/50 px-5 py-5"
    >
      <label className="block">
        <span className="rotulo">Nome</span>
        <input
          className="campo"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          maxLength={200}
          required
        />
      </label>

      <label className="block">
        <span className="rotulo">Nascimento</span>
        <input
          type="date"
          className="campo"
          value={nascimento}
          onChange={(e) => setNascimento(e.target.value)}
        />
      </label>

      <label className="block">
        <span className="rotulo">Observações</span>
        <textarea
          className="campo"
          rows={3}
          value={observacoes}
          onChange={(e) => setObservacoes(e.target.value)}
          maxLength={5000}
        />
        <span className="legenda mt-1.5 block">
          Contexto permanente do paciente — alergias, preferências, o que você quer ter
          à mão em toda consulta. Não substitui a nota clínica.
        </span>
      </label>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={ocupado}
          className="botao-principal botao-pequeno"
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
          className="botao-texto"
        >
          Cancelar
        </button>
      </div>

      {erro !== null && (
        <p role="alert" className="alerta alerta-erro">
          {erro}
        </p>
      )}
    </form>
  );
}

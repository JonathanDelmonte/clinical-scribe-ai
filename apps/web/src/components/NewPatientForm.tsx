"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { IconeMais } from "./Icones";

/**
 * Cadastrar paciente: um botão que abre um campo, e o campo é só o nome.
 *
 * O resto da ficha (nascimento, observações) fica para a pasta, depois — o
 * cadastro que pede tudo de uma vez é o que a recepção pula. Criado, o
 * paciente abre direto na pasta, pronto para a primeira consulta.
 *
 * `?novo=1` no endereço abre o campo já aberto: é o link do Início quando
 * ainda não há ninguém cadastrado.
 */
export function NewPatientForm() {
  const router = useRouter();
  const parametros = useSearchParams();
  const [aberto, setAberto] = useState(parametros.get("novo") === "1");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const campoRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (aberto) campoRef.current?.focus();
  }, [aberto]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (name.trim() === "" || busy) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error: unknown }).error)
            : "não foi possível criar";
        setError(message);
        return;
      }
      setName("");
      setAberto(false);
      const id =
        typeof body === "object" &&
        body !== null &&
        "patient" in body &&
        typeof (body as { patient: { id?: unknown } }).patient.id === "string"
          ? (body as { patient: { id: string } }).patient.id
          : null;
      if (id !== null) router.push(`/pacientes/${id}`);
      router.refresh();
    } catch {
      setError("sem conexão com o servidor");
    } finally {
      setBusy(false);
    }
  }

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className="botao-principal">
        Novo paciente
        <span className="botao-icone">
          <IconeMais tamanho={19} traco={1.9} />
        </span>
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="vidro flex w-full flex-wrap items-center gap-2 rounded-full p-1.5 sm:w-auto"
    >
      <input
        ref={campoRef}
        className="min-w-0 flex-1 bg-transparent px-4 text-[15px] text-tinta outline-none placeholder:text-[#66747f] sm:w-64"
        placeholder="Nome do paciente"
        value={name}
        maxLength={200}
        onChange={(e) => setName(e.target.value)}
        aria-label="Nome do paciente"
      />
      <button
        type="submit"
        disabled={busy || name.trim() === ""}
        className="botao-principal botao-pequeno"
      >
        {busy ? "Criando…" : "Adicionar"}
      </button>
      <button
        type="button"
        onClick={() => {
          setAberto(false);
          setError(null);
        }}
        className="botao-texto px-2 no-underline"
      >
        Cancelar
      </button>
      {error !== null && (
        <p role="alert" className="alerta alerta-erro w-full">
          {error}
        </p>
      )}
    </form>
  );
}

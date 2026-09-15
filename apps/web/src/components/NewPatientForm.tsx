"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function NewPatientForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        const message =
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error: unknown }).error)
            : "não foi possível criar";
        setError(message);
        return;
      }
      setName("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap gap-2">
      <input
        className="min-w-0 flex-1 rounded-lg border border-line bg-transparent px-3 py-2 text-sm placeholder:text-muted"
        placeholder="Nome do paciente"
        value={name}
        maxLength={200}
        onChange={(e) => setName(e.target.value)}
        aria-label="Nome do paciente"
      />
      <button
        type="submit"
        disabled={busy || name.trim() === ""}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface disabled:opacity-40"
      >
        {busy ? "Criando…" : "Adicionar"}
      </button>
      {error !== null && (
        <p role="alert" className="w-full text-sm text-red-500">
          {error}
        </p>
      )}
    </form>
  );
}

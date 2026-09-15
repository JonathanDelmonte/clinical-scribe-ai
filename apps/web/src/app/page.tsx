const MILESTONES = [
  { id: 0, name: "Fundação", state: "doing", note: "monorepo, CI, schema, RLS" },
  {
    id: 1,
    name: "Spike de ASR e diarização",
    state: "next",
    note: "⭐ decide se o produto existe",
    critical: true,
  },
  { id: 2, name: "Esqueleto andante", state: "todo", note: "tubo ponta a ponta" },
  { id: 3, name: "Identificação de papel", state: "todo", note: "médico × paciente" },
  {
    id: 4,
    name: "Nota ancorada",
    state: "todo",
    note: "⭐ citações e anti-alucinação",
    critical: true,
  },
  { id: 5, name: "Produto ao redor", state: "todo", note: "auth, gravação, export" },
  {
    id: 6,
    name: "Endurecimento e LGPD",
    state: "todo",
    note: "testes de RLS, retenção",
  },
] as const;

const STATE_STYLES: Record<string, string> = {
  doing: "bg-accent/15 text-accent border-accent/30",
  next: "bg-accent/5 text-ink border-line",
  todo: "text-muted border-line",
};

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16">
      <header className="mb-10">
        <p className="text-xs font-medium tracking-widest text-muted uppercase">
          pré-MVP
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Consulta Viva</h1>
        <p className="mt-3 text-balance leading-relaxed text-muted">
          Escriba clínico com IA. Grava a consulta, transcreve, separa quem fala e
          devolve a nota estruturada — com cada afirmação ancorada no trecho de áudio
          que a originou.
        </p>
      </header>

      <section aria-labelledby="marcos">
        <h2
          id="marcos"
          className="mb-4 text-xs font-medium tracking-widest text-muted uppercase"
        >
          Marcos
        </h2>
        <ol className="space-y-2">
          {MILESTONES.map((m) => (
            <li
              key={m.id}
              className={`flex items-baseline gap-3 rounded-lg border px-4 py-3 ${
                STATE_STYLES[m.state] ?? STATE_STYLES["todo"]
              }`}
            >
              <span className="w-5 shrink-0 font-mono text-sm tabular-nums">
                {m.id}
              </span>
              <span className="font-medium">{m.name}</span>
              <span className="ml-auto text-right text-sm text-muted">{m.note}</span>
            </li>
          ))}
        </ol>
      </section>

      <footer className="mt-10 border-t border-line pt-5 text-sm text-muted">
        <p>
          Plano completo em{" "}
          <code className="text-ink">docs/PLANO-DE-DESENVOLVIMENTO.md</code>.
        </p>
        <p className="mt-1">
          Estado da API:{" "}
          <a className="text-accent underline underline-offset-2" href="/api/health">
            /api/health
          </a>
        </p>
      </footer>
    </main>
  );
}

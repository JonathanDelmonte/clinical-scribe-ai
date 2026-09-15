"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export interface DevUser {
  authUserId: string;
  name: string;
  role: string;
  plan: string;
}

/**
 * Troca o profissional ativo — apenas desenvolvimento.
 *
 * Existe para deixar visível o que `resolveEngine()` decide. Alternando entre
 * a profissional no plano grátis e o desenvolvedor, o motor exibido muda, e a
 * escolha de motor aparece ou some da tela de gravação.
 */
export function UserSwitcher({
  users,
  currentAuthUserId,
}: {
  users: DevUser[];
  currentAuthUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function switchTo(authUserId: string) {
    await fetch("/api/dev-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authUserId }),
    });
    startTransition(() => router.refresh());
  }

  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <span className="hidden sm:inline">modo dev</span>
      <select
        aria-label="Trocar profissional (desenvolvimento)"
        className="rounded-md border border-line bg-transparent px-2 py-1 text-ink disabled:opacity-50"
        value={currentAuthUserId}
        disabled={pending}
        onChange={(e) => void switchTo(e.target.value)}
      >
        {users.map((u) => (
          <option key={u.authUserId} value={u.authUserId}>
            {u.name} · {u.role === "developer" ? "dev" : u.plan}
          </option>
        ))}
      </select>
    </label>
  );
}

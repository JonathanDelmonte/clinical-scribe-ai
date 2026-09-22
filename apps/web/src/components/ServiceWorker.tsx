"use client";

import { useEffect, useState } from "react";

/**
 * Registra o service worker e avisa quando a rede cai.
 *
 * O registro acontece depois do `load` de propósito: durante o carregamento
 * inicial, o navegador está buscando JavaScript, CSS e a primeira renderização
 * ao mesmo tempo, e baixar mais um arquivo no meio disso atrasa exatamente a
 * tela que a pessoa está esperando. O PWA não precisa estar pronto no primeiro
 * segundo; ele precisa estar pronto na segunda visita.
 *
 * Em desenvolvimento ele NÃO é registrado. Um service worker servindo módulos
 * antigos contra um servidor com recarga a quente produz erros que não
 * reproduzem — e a saída é sempre a mesma meia hora perdida até alguém lembrar
 * de limpar o armazenamento do site.
 */
export function ServiceWorker() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const atualizar = () => setOffline(!navigator.onLine);
    atualizar();
    window.addEventListener("online", atualizar);
    window.addEventListener("offline", atualizar);
    return () => {
      window.removeEventListener("online", atualizar);
      window.removeEventListener("offline", atualizar);
    };
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const registrar = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // Navegador com armazenamento bloqueado, janela anônima, política de
        // empresa. A aplicação funciona inteira sem service worker — ela só
        // deixa de ser instalável.
      });
    };

    if (document.readyState === "complete") {
      registrar();
      return;
    }
    window.addEventListener("load", registrar);
    return () => window.removeEventListener("load", registrar);
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="bg-amber-500/15 px-5 py-2 text-center text-xs text-amber-700 dark:text-amber-300"
    >
      Sem conexão. Você pode continuar gravando — a consulta fica guardada neste
      aparelho e é enviada quando a rede voltar.
    </div>
  );
}

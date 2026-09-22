/**
 * Service worker — o que torna o PWA instalável e utilizável sem rede.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  REGRA INEGOCIÁVEL: NENHUMA RESPOSTA DE `/api/` É CACHEADA. NUNCA.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O cache de um service worker vive no disco do aparelho, fora do controle da
 * aplicação. Ele sobrevive ao logout, não é apagado por trocar de usuário, e
 * é lido por qualquer aba do mesmo domínio.
 *
 * Cachear `/api/sessions/<id>` seria gravar a transcrição de uma consulta no
 * disco do celular — uma cópia de dado sensível de saúde que ninguém sabe que
 * existe, que continua lá depois de o profissional sair, e que aparece para a
 * próxima pessoa que usar o aparelho compartilhado do consultório.
 *
 * O ganho seria abrir uma consulta já vista sem rede. Não vale. O que este
 * arquivo cacheia é **só o esqueleto estático**: JavaScript, CSS, fontes e
 * ícones — coisas idênticas para todo mundo e sem nada de ninguém dentro.
 *
 * ## O que isso NÃO tenta resolver
 *
 * Gravar offline não depende daqui. O áudio vai para o IndexedDB assim que o
 * `MediaRecorder` o entrega (`lib/recording/buffer.ts`), e o envio retoma
 * quando a rede volta. O service worker não precisa participar disso, e
 * tentar participar — com Background Sync, por exemplo — traria uma segunda
 * cópia do áudio num lugar diferente, para resolver um problema já resolvido.
 */

const VERSAO = "v1";
const CACHE_ESTATICO = `consulta-viva-estatico-${VERSAO}`;
const PAGINA_OFFLINE = "/offline.html";

/** Só o que é igual para todo mundo. */
const PRECARREGAR = [PAGINA_OFFLINE, "/icones/icone-192.png"];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE_ESTATICO)
      .then((cache) => cache.addAll(PRECARREGAR))
      // `skipWaiting` porque a versão nova precisa valer já: um service worker
      // antigo servindo JavaScript antigo contra uma API nova produz erros que
      // não reproduzem em lugar nenhum.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((chaves) =>
        Promise.all(
          chaves
            .filter((c) => c.startsWith("consulta-viva-") && c !== CACHE_ESTATICO)
            .map((c) => caches.delete(c)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function ehEstatico(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icones/") ||
    url.pathname === "/icon.svg" ||
    url.pathname === "/manifest.webmanifest"
  );
}

self.addEventListener("fetch", (evento) => {
  const { request } = evento;

  // Só GET. Um POST cacheado seria um envio de áudio que "deu certo" sem ter
  // saído do aparelho.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Outro domínio: passa direto, sem opinião.
  if (url.origin !== self.location.origin) return;

  // ⚠️ A regra que não se negocia.
  if (url.pathname.startsWith("/api/")) return;

  if (ehEstatico(url)) {
    // Cache primeiro: estes arquivos têm hash no nome, então um acerto de
    // cache é sempre o arquivo certo, e uma versão nova tem nome novo.
    evento.respondWith(
      caches.match(request).then(
        (guardado) =>
          guardado ??
          fetch(request).then((resposta) => {
            if (resposta.ok) {
              const copia = resposta.clone();
              void caches.open(CACHE_ESTATICO).then((c) => c.put(request, copia));
            }
            return resposta;
          }),
      ),
    );
    return;
  }

  /**
   * Navegação: rede primeiro, e a página offline como último recurso.
   *
   * Nunca a versão cacheada de uma página: as páginas deste produto trazem
   * dado de paciente renderizado no servidor. Mostrar uma cópia guardada seria
   * o mesmo problema de cachear a API, com outro nome.
   */
  if (request.mode === "navigate") {
    evento.respondWith(
      fetch(request).catch(() =>
        caches.match(PAGINA_OFFLINE).then(
          (pagina) =>
            pagina ??
            new Response("Sem conexão.", {
              status: 503,
              headers: { "content-type": "text/plain; charset=utf-8" },
            }),
        ),
      ),
    );
  }
});

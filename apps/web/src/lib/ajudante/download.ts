import "server-only";

/**
 * De onde se baixa o ajudante — decidido aqui, no servidor, para o link do
 * site nunca mudar (`/api/ajudante/baixar`) quando o arquivo mudar de lugar.
 *
 * 1. `AJUDANTE_DOWNLOAD_URL`, se definida: qualquer endereço (um armazenamento,
 *    um drive) — trocar de lugar é trocar a variável.
 * 2. Senão, a versão mais recente publicada nas Releases do GitHub
 *    (`AJUDANTE_RELEASES_REPO`, por padrão o próprio repositório), pela API.
 *    Repositório público, sem nada; privado, com `GITHUB_TOKEN_RELEASES` — um
 *    token de leitura só deste repositório. A API devolve um link temporário
 *    do próprio GitHub, e o arquivo (116 MB) vai direto de lá para o
 *    navegador, sem passar pela função do site.
 */

const NOME_DO_ARQUIVO = "ConsultaViva-Ajudante.exe";
const REPOSITORIO_PADRAO = "JonathanDelmonte/clinical-scribe-ai";

/** O id do arquivo na Release mais recente, guardado por cinco minutos. */
let memoria: { readonly id: number; readonly ate: number } | null = null;

function cabecalhos(): Record<string, string> {
  const token = process.env["GITHUB_TOKEN_RELEASES"]?.trim();
  return {
    // A API do GitHub recusa pedido sem User-Agent.
    "user-agent": "consulta-viva-site",
    "x-github-api-version": "2022-11-28",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

/** O endereço para mandar o navegador baixar — ou `null` se não há o que baixar. */
export async function enderecoDoDownload(): Promise<string | null> {
  const fixo = process.env["AJUDANTE_DOWNLOAD_URL"]?.trim();
  if (fixo) return fixo;

  const repo = process.env["AJUDANTE_RELEASES_REPO"]?.trim() || REPOSITORIO_PADRAO;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;

  let id = memoria !== null && memoria.ate > Date.now() ? memoria.id : null;
  if (id === null) {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { ...cabecalhos(), accept: "application/vnd.github+json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (res === null || !res.ok) return null;
    const release = (await res.json().catch(() => null)) as {
      assets?: { id: number; name: string }[];
    } | null;
    const arquivo = release?.assets?.find((a) => a.name === NOME_DO_ARQUIVO);
    if (arquivo === undefined) return null;
    id = arquivo.id;
    memoria = { id, ate: Date.now() + 5 * 60 * 1000 };
  }

  // Pedido o arquivo em si, a API responde com um redirecionamento para um
  // link temporário — que vale também para repositório privado.
  const res = await fetch(
    `https://api.github.com/repos/${repo}/releases/assets/${id}`,
    {
      headers: { ...cabecalhos(), accept: "application/octet-stream" },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  ).catch(() => null);
  const destino = res?.headers.get("location") ?? null;
  if (destino === null) memoria = null;
  return destino;
}

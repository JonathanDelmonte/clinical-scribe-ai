/**
 * De onde se baixa o ajudante.
 *
 * O padrão é a versão mais recente publicada no GitHub, por um nome fixo de
 * arquivo — o link não muda a cada versão. `AJUDANTE_DOWNLOAD_URL` troca o
 * lugar sem mexer em código.
 */
export function linkDoAjudante(): string {
  return (
    process.env["AJUDANTE_DOWNLOAD_URL"]?.trim() ||
    "https://github.com/JonathanDelmonte/clinical-scribe-ai/releases/latest/download/ConsultaViva-Ajudante.exe"
  );
}

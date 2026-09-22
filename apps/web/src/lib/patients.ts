/**
 * Regras de pacientes que não dependem de banco — e por isso são testáveis
 * sem um.
 */

/**
 * Transforma o que a pessoa digitou num padrão de `ILIKE`.
 *
 * Os três caracteres escapados não são teoria. `%` e `_` são curingas do
 * `LIKE`: digitar `%` na busca traria TODOS os pacientes, e `_` casaria com
 * qualquer letra — comportamento que ninguém pediu e que parece defeito. A
 * barra invertida precisa vir junto porque é ela que faz o escape dos outros
 * dois; sem escapá-la, `\` no texto quebraria o padrão inteiro.
 *
 * Devolve `null` para busca vazia, que é diferente de "não encontrou nada":
 * quem chama usa isso para listar tudo.
 */
export function padraoDeBusca(termo: string): string | null {
  const limpo = termo.trim();
  if (limpo === "") return null;

  const escapado = limpo.replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${escapado}%`;
}

/**
 * Idade em anos completos.
 *
 * A conta é feita em partes de data (ano, mês, dia) e não em milissegundos:
 * subtrair carimbos e dividir por 365,25 erra por um dia perto do aniversário
 * e em anos bissextos, e "a idade do paciente está errada" é o tipo de erro
 * que destrói a confiança num prontuário inteiro.
 */
export function idadeEmAnos(nascimento: Date, hoje: Date = new Date()): number | null {
  if (Number.isNaN(nascimento.getTime())) return null;

  let anos = hoje.getFullYear() - nascimento.getFullYear();
  const mes = hoje.getMonth() - nascimento.getMonth();
  if (mes < 0 || (mes === 0 && hoje.getDate() < nascimento.getDate())) {
    anos -= 1;
  }

  return anos < 0 ? null : anos;
}

/** `1985-04-12` → `12/04/1985`, sem passar por fuso nenhum. */
export function dataParaExibicao(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  if (ano === undefined || mes === undefined || dia === undefined) return iso;
  return `${dia}/${mes}/${ano}`;
}

/**
 * A data de nascimento como `YYYY-MM-DD`, lendo os campos de UTC.
 *
 * A coluna é `date`, sem fuso, e o driver a entrega como um `Date` à
 * meia-noite UTC. Formatar isso com métodos locais devolve o dia ANTERIOR em
 * qualquer fuso a oeste de Greenwich — que inclui o Brasil inteiro. O sintoma
 * é um paciente que envelhece um dia a cada ida e volta pelo formulário.
 */
export function dataParaFormulario(valor: Date | null): string {
  if (valor === null || Number.isNaN(valor.getTime())) return "";
  return valor.toISOString().slice(0, 10);
}

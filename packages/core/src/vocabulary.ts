/**
 * Vocabulário do domínio — os termos que o reconhecimento de fala erra.
 *
 * O Whisper foi treinado em áudio geral da internet. Ele ouve "losartana" e
 * escreve "lozartana", ouve "arder" e escreve "azar", porque essas palavras são
 * raras no que ele viu. Dar a ele, antes de cada trecho, uma lista dos termos
 * que costumam aparecer numa consulta daquela especialidade inclina a
 * transcrição para a grafia certa.
 *
 * ## Por que `hotwords` e não `initial_prompt`
 *
 * `initial_prompt` é o jeito clássico, e aqui ele valeria só para os primeiros
 * 30 segundos. Desligamos `condition_on_previous_text` porque ele truncava o
 * fim das consultas e alucinava "Obrigado." — e no faster-whisper, com essa
 * opção desligada, o contexto é zerado depois de cada janela, levando o
 * `initial_prompt` junto. `hotwords` entra no prompt de TODA janela.
 *
 * ## A ordem é a prioridade
 *
 * A biblioteca corta pelo FIM, em silêncio, quando o vocabulário passa de 223
 * tokens. Então o que vem primeiro sobrevive: termos do próprio profissional,
 * depois os da especialidade, e os comuns por último.
 *
 * ## O risco que esta lista carrega
 *
 * Inclinar o modelo para um termo aumenta a chance de ele aparecer ONDE NÃO
 * FOI DITO — num trecho de ruído, numa palavra parecida. Para um nome de
 * remédio, isso é um medicamento fabricado no prontuário. Por isso a lista é
 * feita de termos que costumam ser ditos e mal escritos, não de tudo que
 * "poderia" aparecer — e por isso ela foi medida antes de ser ligada. Ver o
 * ADR-0002.
 */

/**
 * Termos por especialidade.
 *
 * Critério de entrada: palavra que aparece em consulta E que o reconhecimento
 * geral erra — siglas (TSH, IMC, ECG), nomes de remédio, termos técnicos
 * raros. Palavra comum não entra: não ajuda, e ocupa o espaço de uma que
 * ajudaria.
 */
export const VOCABULARIO_POR_ESPECIALIDADE: Readonly<
  Record<string, readonly string[]>
> = {
  nutricao: [
    "hipotireoidismo",
    "levotiroxina",
    "ferritina",
    "hemograma",
    "TSH",
    "T4 livre",
    "vitamina D",
    "vitamina B12",
    "hemoglobina glicada",
    "glicemia de jejum",
    "triglicerídeos",
    "resistência à insulina",
    "esteatose hepática",
    "SOP",
    "dislipidemia",
    "sarcopenia",
    "IMC",
    "bioimpedância",
    "circunferência abdominal",
    "recordatório alimentar",
    "plano alimentar",
    "metformina",
    "semaglutida",
    "whey protein",
    "creatina",
  ],
  "clinica medica": [
    "eletrocardiograma",
    "troponina",
    "ecocardiograma",
    "retroesternal",
    "precordial",
    "dispneia",
    "sudorese",
    "hipertensão arterial",
    "diabetes mellitus",
    "infarto agudo do miocárdio",
    "angina",
    "losartana",
    "enalapril",
    "anlodipino",
    "hidroclorotiazida",
    "sinvastatina",
    "atorvastatina",
    "AAS",
    "metformina",
    "omeprazol",
    "amoxicilina",
    "azitromicina",
    "prednisona",
  ],
  psicologia: [
    "ansiedade generalizada",
    "TDAH",
    "TOC",
    "transtorno bipolar",
    "burnout",
    "ideação suicida",
    "crise de pânico",
    "ruminação",
    "psicoterapia",
    "terapia cognitivo-comportamental",
    "luto",
    "autoestima",
  ],
  psiquiatria: [
    "sertralina",
    "escitalopram",
    "fluoxetina",
    "venlafaxina",
    "desvenlafaxina",
    "bupropiona",
    "quetiapina",
    "olanzapina",
    "risperidona",
    "aripiprazol",
    "carbonato de lítio",
    "clonazepam",
    "alprazolam",
    "zolpidem",
    "metilfenidato",
    "lisdexanfetamina",
    "lamotrigina",
    "ideação suicida",
    "transtorno bipolar",
    "esquizofrenia",
    "TDAH",
  ],
  fisioterapia: [
    "lombalgia",
    "cervicalgia",
    "hérnia de disco",
    "tendinite",
    "bursite",
    "fascite plantar",
    "condromalácia",
    "ligamento cruzado anterior",
    "manguito rotador",
    "amplitude de movimento",
    "cinesioterapia",
    "propriocepção",
    "RPG",
    "TENS",
  ],
  fonoaudiologia: [
    "disfagia",
    "disfonia",
    "afasia",
    "dislexia",
    "gagueira",
    "deglutição",
    "audiometria",
    "processamento auditivo",
    "apraxia",
    "motricidade orofacial",
  ],
  odontologia: [
    "periodontite",
    "gengivite",
    "endodontia",
    "tratamento de canal",
    "terceiro molar",
    "implante",
    "bruxismo",
    "ATM",
    "disfunção temporomandibular",
    "restauração",
    "profilaxia",
    "radiografia panorâmica",
  ],
};

/**
 * Termos de qualquer consulta. Por último, porque são os que menos dependem de
 * ajuda: o que é comum a todas as especialidades tende a ser mais comum no
 * português geral também.
 */
export const VOCABULARIO_COMUM: readonly string[] = [
  "dipirona",
  "paracetamol",
  "ibuprofeno",
  "anamnese",
  "encaminhamento",
];

/**
 * Teto em caracteres, como aproximação dos 223 tokens do modelo.
 *
 * O limite real é em tokens, e o tokenizador do Whisper vive no serviço
 * Python — este pacote não tem como contar. Então aqui vai uma estimativa
 * conservadora, e o serviço devolve a contagem de verdade junto com a
 * transcrição, dizendo se cortou. A estimativa evita o corte; a contagem
 * prova se evitou.
 */
export const LIMITE_CARACTERES = 500;

/**
 * "Clínica Médica" → "clinica medica". A chave não pode depender de acento.
 *
 * NFD separa cada letra acentuada em letra + acento; `\p{M}` apaga os acentos.
 * Escrito como classe Unicode e não como faixa hexadecimal (de U+0300 a U+036F)
 * de propósito: uma ferramenta decodificou a faixa hexadecimal para os próprios
 * caracteres de acento, invisíveis no arquivo. Continuava funcionando — e
 * qualquer editor que normalizasse Unicode ao salvar a apagaria sem aviso.
 */
export function normalizarEspecialidade(especialidade: string): string {
  return especialidade.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

export interface VocabularioMontado {
  /** O texto que vai para o Whisper, ou `null` quando não há o que mandar. */
  readonly texto: string | null;
  readonly termos: readonly string[];
  /** Termos que ficaram de fora por não caber. */
  readonly descartados: readonly string[];
}

/**
 * Monta o vocabulário de uma consulta, na ordem de prioridade.
 *
 * Termos repetidos entre as listas aparecem uma vez só, na posição mais alta.
 * "metformina" está em nutrição e em clínica médica; mandá-la duas vezes
 * gastaria espaço sem inclinar nada a mais.
 */
export function montarVocabulario(opcoes: {
  especialidade: string | null;
  extras?: readonly string[];
}): VocabularioMontado {
  const daEspecialidade =
    opcoes.especialidade === null
      ? []
      : (VOCABULARIO_POR_ESPECIALIDADE[normalizarEspecialidade(opcoes.especialidade)] ??
        []);

  const vistos = new Set<string>();
  const ordenados: string[] = [];
  for (const termo of [
    ...(opcoes.extras ?? []),
    ...daEspecialidade,
    ...VOCABULARIO_COMUM,
  ]) {
    const limpo = termo.trim();
    const chave = limpo.toLowerCase();
    if (limpo === "" || vistos.has(chave)) continue;
    vistos.add(chave);
    ordenados.push(limpo);
  }

  const termos: string[] = [];
  const descartados: string[] = [];
  let tamanho = 0;
  for (const termo of ordenados) {
    const custo = termo.length + (termos.length > 0 ? 2 : 0);
    if (tamanho + custo <= LIMITE_CARACTERES) {
      termos.push(termo);
      tamanho += custo;
    } else {
      descartados.push(termo);
    }
  }

  return {
    texto: termos.length > 0 ? termos.join(", ") : null,
    termos,
    descartados,
  };
}

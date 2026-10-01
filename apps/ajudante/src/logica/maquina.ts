/**
 * O que este computador consegue, e como o motor vai rodar nele.
 *
 * Lógica pura: recebe o que o Windows respondeu e decide. Quem pergunta ao
 * Windows é `src/main/sistema.ts`.
 */

export interface PlacaDeVideo {
  readonly nome: string;
  readonly memoriaMb: number;
  /** Versão do driver da NVIDIA, como o `nvidia-smi` a escreve ("581.57"). */
  readonly driver: string;
}

export interface PlanoDoMotor {
  readonly dispositivo: "cuda" | "cpu";
  readonly computeType: "float16" | "int8_float16" | "int8";
  readonly indiceDoTorch: string;
  /**
   * Quanto o cache do uv cresce ao instalar o motor, para a barra de
   * progresso: os pacotes já desempacotados, maiores que o download. Medido
   * com a placa (torch cu124): 4,9 GB.
   */
  readonly bytesDoMotor: number;
  /** A frase que a pessoa lê na tela de instalação. */
  readonly explicacao: string;
}

const INDICE_CUDA = "https://download.pytorch.org/whl/cu124";
const INDICE_CPU = "https://download.pytorch.org/whl/cpu";

/** Driver mínimo para o CUDA 12 no Windows (compatibilidade de versão menor). */
const DRIVER_MINIMO = 528.33;

/**
 * Quanto de memória de vídeo o motor precisa. O Whisper large-v3 em float16
 * ocupa ~3,5 GB, a separação de vozes ~1,5 GB, e as duas trabalham juntas na
 * mesma consulta. Com 4 a 6 GB, o Whisper vai em int8 sobre float16, que ocupa
 * metade com perda que não se mede na prática; abaixo disso, a CPU.
 */
const MEMORIA_FOLGADA_MB = 6 * 1024;
const MEMORIA_MINIMA_MB = 4 * 1024;

/** Lê a saída de `nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits`. */
export function lerNvidiaSmi(saida: string): PlacaDeVideo[] {
  return saida
    .split(/\r?\n/)
    .map((linha) => linha.split(",").map((parte) => parte.trim()))
    .filter((partes) => partes.length >= 3 && partes[0] !== "")
    .map(([nome, memoria, driver]) => ({
      nome: nome ?? "",
      memoriaMb: Number(memoria),
      driver: driver ?? "",
    }))
    .filter((placa) => Number.isFinite(placa.memoriaMb));
}

function gigas(mb: number): string {
  return `${Math.round(mb / 1024)} GB`;
}

export function planejarMotor(placas: readonly PlacaDeVideo[]): PlanoDoMotor {
  const melhor = [...placas].sort((a, b) => b.memoriaMb - a.memoriaMb)[0];
  const cpu: PlanoDoMotor = {
    dispositivo: "cpu",
    computeType: "int8",
    indiceDoTorch: INDICE_CPU,
    bytesDoMotor: 1.5 * 1024 ** 3,
    explicacao:
      "Este computador não tem placa de vídeo NVIDIA compatível. O ajudante vai " +
      "usar o processador: funciona, só que mais devagar.",
  };
  if (melhor === undefined) return cpu;

  if (Number(melhor.driver) < DRIVER_MINIMO) {
    return {
      ...cpu,
      explicacao:
        `A placa ${melhor.nome} precisa de um driver mais novo (este é o ` +
        `${melhor.driver}). Enquanto isso, o ajudante usa o processador. Atualize ` +
        `o driver da NVIDIA e escolha Reinstalar para usar a placa.`,
    };
  }
  if (melhor.memoriaMb < MEMORIA_MINIMA_MB) {
    return {
      ...cpu,
      explicacao:
        `A placa ${melhor.nome} tem ${gigas(melhor.memoriaMb)} de memória, menos ` +
        `do que o motor precisa. O ajudante vai usar o processador: mais devagar.`,
    };
  }
  const folgada = melhor.memoriaMb >= MEMORIA_FOLGADA_MB;
  return {
    dispositivo: "cuda",
    computeType: folgada ? "float16" : "int8_float16",
    indiceDoTorch: INDICE_CUDA,
    bytesDoMotor: 4.8 * 1024 ** 3,
    explicacao: folgada
      ? `Vai usar a placa ${melhor.nome} (${gigas(melhor.memoriaMb)}): rápido.`
      : `Vai usar a placa ${melhor.nome} (${gigas(melhor.memoriaMb)}), em modo ` +
        `econômico de memória.`,
  };
}

/**
 * Espaço livre que a instalação exige. Medido com a placa: o cache do uv com
 * o torch (4,9 GB; o ambiente do motor aponta para os mesmos arquivos), os
 * modelos (2,9 GB), o programa (0,4 GB) e o Python (0,1 GB) — 8,3 GB. Pede
 * um pouco mais, de folga.
 */
export function espacoNecessario(plano: PlanoDoMotor): number {
  const modelos = 3.5 * 1024 ** 3;
  const motor = plano.dispositivo === "cuda" ? 6 * 1024 ** 3 : 2 * 1024 ** 3;
  return motor + modelos;
}

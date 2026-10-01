/**
 * A janela do ajudante: escolher, acompanhar, concluir.
 *
 * Sem Node aqui dentro — tudo o que a janela faz passa por `window.ajudante`
 * (ver `preload.ts`).
 */

import type { ModoDaInstalacao, Progresso, Situacao } from "../compartilhado";
import { ETAPAS, tamanhoLegivel } from "../logica/etapas";

type Tela =
  | "escolha"
  | "progresso"
  | "pronto"
  | "confirmar-desinstalar"
  | "desinstalado"
  | "erro";
type Opcao = ModoDaInstalacao | "desinstalar";

const api = window.ajudante;

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const elemento = document.getElementById(id);
  if (elemento === null) throw new Error(`#${id} não existe`);
  return elemento as T;
}

function mostrar(tela: Tela): void {
  for (const secao of document.querySelectorAll<HTMLElement>("[data-tela]")) {
    secao.hidden = secao.dataset["tela"] !== tela;
  }
}

let situacao: Situacao | null = null;
let ultimaOpcao: Opcao = "instalar";
let detalhesDoErro = "";

function opcaoEscolhida(): Opcao {
  const marcada = document.querySelector<HTMLInputElement>(
    'input[name="opcao"]:checked',
  );
  return (marcada?.value as Opcao | undefined) ?? "instalar";
}

function marcar(opcao: Opcao): void {
  const alvo = document.querySelector<HTMLInputElement>(
    `input[name="opcao"][value="${opcao}"]`,
  );
  if (alvo !== null && !alvo.disabled) alvo.checked = true;
}

async function carregarSituacao(): Promise<void> {
  situacao = await api.situacao();
  el("maquina-placa").textContent = situacao.placa.explicacao;
  const falta = situacao.espacoLivre < situacao.espacoNecessario;
  el("maquina-espaco").textContent =
    `Precisa de ${tamanhoLegivel(situacao.espacoNecessario)} livres no disco` +
    (Number.isFinite(situacao.espacoLivre)
      ? ` (há ${tamanhoLegivel(situacao.espacoLivre)}).`
      : ".") +
    (falta ? " Libere espaço antes de instalar." : "");

  const desinstalar = document.querySelector<HTMLInputElement>(
    'input[value="desinstalar"]',
  );
  if (desinstalar !== null) {
    desinstalar.disabled = !situacao.instalado;
    el("desinstalar-texto").textContent = situacao.instalado
      ? "Remove o ajudante, o motor e os modelos baixados."
      : "Nada instalado neste computador.";
  }
  marcar(situacao.instalado ? "reinstalar" : "instalar");

  if (situacao.abertaPara === "desinstalar" && situacao.instalado) {
    mostrar("confirmar-desinstalar");
  } else {
    mostrar("escolha");
  }
}

function desenharEtapas(atual: string | null, rotuloDesinstalar = false): void {
  const lista = el("etapas");
  lista.replaceChildren();
  if (rotuloDesinstalar) return;
  let passou = atual === null;
  for (const etapa of ETAPAS) {
    const item = document.createElement("li");
    item.textContent = etapa.rotulo;
    if (etapa.id === atual) {
      item.className = "atual";
      passou = true;
    } else if (!passou) {
      item.className = "feita";
    }
    lista.append(item);
  }
}

function aplicarProgresso(p: Progresso): void {
  el("progresso-titulo").textContent = p.rotulo;
  el("progresso-detalhe").textContent = p.detalhe;
  el("progresso-cheio").style.width = `${p.percentual}%`;
  el("progresso-barra").setAttribute("aria-valuenow", String(Math.round(p.percentual)));
  el("progresso-percentual").textContent = `${Math.round(p.percentual)}%`;
  if (p.rotulo !== "Desinstalando") desenharEtapas(p.etapa);
}

async function executar(opcao: Opcao): Promise<void> {
  ultimaOpcao = opcao;
  const desinstalando = opcao === "desinstalar";
  el("progresso-titulo").textContent = desinstalando ? "Desinstalando" : "Preparando";
  el("progresso-detalhe").textContent = "";
  el("progresso-cheio").style.width = "0%";
  el("progresso-percentual").textContent = "0%";
  el("progresso-nota").hidden = desinstalando;
  desenharEtapas(desinstalando ? null : "conferir", desinstalando);
  mostrar("progresso");

  const resultado = desinstalando ? await api.desinstalar() : await api.instalar(opcao);
  if (resultado.ok) {
    if (desinstalando) {
      mostrar("desinstalado");
    } else {
      el("pronto-placa").textContent =
        situacao?.placa.dispositivo === "cuda"
          ? "O motor usa a placa de vídeo deste computador."
          : "O motor usa o processador deste computador.";
      mostrar("pronto");
    }
    return;
  }
  el("erro-mensagem").textContent = resultado.mensagem;
  detalhesDoErro = resultado.detalhes;
  mostrar("erro");
}

api.aoProgresso(aplicarProgresso);
api.aoPedido((opcao) => void carregarSituacao().then(() => executar(opcao)));

el("continuar").addEventListener("click", () => {
  const opcao = opcaoEscolhida();
  if (opcao === "desinstalar") {
    mostrar("confirmar-desinstalar");
    return;
  }
  void executar(opcao);
});
el("confirmar-desinstalar").addEventListener(
  "click",
  () => void executar("desinstalar"),
);
el("voltar").addEventListener("click", () => mostrar("escolha"));
el("concluir").addEventListener("click", () => api.concluir());
el("fechar").addEventListener("click", () => api.sair());
el("tentar-de-novo").addEventListener("click", () => {
  void carregarSituacao().then(() => {
    marcar(ultimaOpcao);
    mostrar("escolha");
  });
});
el("copiar").addEventListener("click", () => {
  api.copiar(detalhesDoErro);
  el("copiar").textContent = "Copiado";
  setTimeout(() => {
    el("copiar").textContent = "Copiar detalhes";
  }, 2000);
});

void carregarSituacao();

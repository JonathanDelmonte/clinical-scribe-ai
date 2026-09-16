/**
 * Derivação do áudio do microfone, para o rascunho ao vivo.
 *
 * Roda na thread de áudio do navegador — a mesma que alimenta a placa de som.
 * Isso importa: se este código demorar, o áudio falha. Por isso ele não faz
 * nada além de agrupar amostras e repassar.
 *
 * O navegador entrega blocos de 128 amostras; o detector de fala trabalha em
 * quadros de 30 ms (480 amostras a 16 kHz). Juntar aqui, e não do outro lado,
 * evita mandar uma mensagem entre threads a cada 8 milissegundos.
 *
 * É um arquivo solto em `public/` porque `AudioWorklet` exige uma URL própria:
 * o código roda em outro contexto e não pode ser empacotado junto com a página.
 */

const AMOSTRAS_POR_QUADRO = 480;

class AudioTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(AMOSTRAS_POR_QUADRO);
    this.escrito = 0;
  }

  process(inputs) {
    const canal = inputs[0]?.[0];
    // Sem entrada acontece normalmente entre trocas de dispositivo. Devolver
    // `true` mantém o nó vivo; devolver `false` o encerraria de vez.
    if (canal === undefined) return true;

    for (let i = 0; i < canal.length; i++) {
      this.buffer[this.escrito++] = canal[i];

      if (this.escrito === AMOSTRAS_POR_QUADRO) {
        // Cópia, não a referência: o buffer é reaproveitado no próximo quadro,
        // e mandar a referência entregaria do outro lado um array que muda
        // sozinho enquanto está sendo lido.
        this.port.postMessage(this.buffer.slice());
        this.escrito = 0;
      }
    }
    return true;
  }
}

registerProcessor("audio-tap", AudioTap);

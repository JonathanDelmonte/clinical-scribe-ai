import { describe, expect, it } from "vitest";

import { podeCancelar, temConteudoClinico } from "./sessoes";

/**
 * Os dois predicados decidem o que a tela oferece, e errar qualquer um dos
 * dois custa caro em direções opostas: oferecer "cancelar" onde não há nada
 * para cancelar ensina a pessoa a desconfiar do botão; deixar de oferecer
 * onde há processamento acontecendo é a tela sem saída que motivou o pedido.
 */
describe("quando dá para cancelar", () => {
  it.each(["uploaded", "transcribing", "generating"])(
    "%s ainda tem trabalho para interromper",
    (status) => {
      expect(podeCancelar(status)).toBe(true);
    },
  );

  it.each(["ready_for_review", "approved", "failed"])(
    "%s já terminou — não há o que cancelar",
    (status) => {
      expect(podeCancelar(status)).toBe(false);
    },
  );

  /**
   * `draft` é o caso sutil: a sessão existe, mas foi criada no instante em
   * que a gravação começou e nunca recebeu áudio. Não há job, não há custo,
   * não há nada rodando. O que ela pede é "apagar".
   */
  it.each(["draft", "recording"])("%s nunca chegou à fila", (status) => {
    expect(podeCancelar(status)).toBe(false);
  });
});

describe("quando apagar joga fora documentação clínica", () => {
  it.each(["ready_for_review", "approved"])("%s tem transcrição", (status) => {
    expect(temConteudoClinico(status)).toBe(true);
  });

  /**
   * Uma sessão que falhou ou foi cancelada tem gravação, e só. Apagá-la é
   * jogar fora um upload — merece confirmação, não o aviso sobre guarda de
   * prontuário, que perderia o sentido se aparecesse toda vez.
   */
  it.each(["draft", "uploaded", "transcribing", "generating", "failed"])(
    "%s ainda não virou registro",
    (status) => {
      expect(temConteudoClinico(status)).toBe(false);
    },
  );
});

"use client";

import { useRouter } from "next/navigation";

import { VoiceEnrollment } from "./VoiceEnrollment";

/**
 * O convite para cadastrar a voz, na chegada — e o botão de recusar, do lado.
 *
 * ## Por que é oferecido, e por que não é exigido
 *
 * Oferecido porque este é o único momento em que a pessoa está disposta a
 * configurar coisas. Depois de começar a atender, "vá em configurações e grave
 * trinta segundos da sua voz" é uma tarefa que nunca chega ao topo da lista —
 * e o recurso fica existindo sem ser usado.
 *
 * Não exigido porque a impressão vocal pressupõe **uma voz por conta**, e essa
 * premissa nem sempre vale. Numa sala alugada por mais de uma profissional, ou
 * numa conta que a recepção também usa, a voz cadastrada seria a de alguém que
 * às vezes não é quem está atendendo — e aí ela não ajuda a separar as vozes:
 * atrapalha, porque dá ao sistema uma referência confiante e errada.
 *
 * Exigir também cobraria permissão de microfone antes de a pessoa ter visto o
 * produto funcionar, que é o pior momento possível para pedir.
 */
export function PassoDeVoz({ enrolledAt }: { enrolledAt: string | null }) {
  const router = useRouter();

  function seguir() {
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <VoiceEnrollment enrolledAt={enrolledAt} aoConcluir={seguir} />

      {/*
       * "Pular" tem o mesmo peso visual de um link, não de um botão apagado.
       *
       * Um pular escondido ou cinza-claro transforma "opcional" em "opcional
       * no papel": a pessoa procura a saída, não acha, e grava a voz contra a
       * vontade. Quem tem motivo para pular — sala compartilhada, microfone
       * ruim, pressa — precisa achar a saída na primeira olhada.
       */}
      <div className="flex flex-col items-center gap-2">
        <button
          onClick={seguir}
          className="text-sm text-muted underline underline-offset-4 hover:text-ink"
        >
          Pular por enquanto
        </button>
        <span className="text-center text-xs text-muted">
          Dá para cadastrar depois em configurações, quando quiser. Sem a voz, a
          separação entre profissional e paciente continua funcionando pelo conteúdo da
          conversa.
        </span>
      </div>
    </div>
  );
}

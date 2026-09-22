"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Assinatura desenhada na tela.
 *
 * Desenhar e não enviar arquivo, e isso é decisão de produto: pedir upload de
 * imagem no celular significa pedir para a pessoa achar o aplicativo de
 * câmera, fotografar um papel, recortar e localizar o arquivo — quatro passos
 * em que a maioria desiste. No celular, o dedo já é a caneta.
 *
 * `pointer events` e não `mouse`/`touch` separados: um só conjunto de eventos
 * cobre dedo, caneta e mouse, e evita o par de listeners que sempre diverge.
 */
export function SignaturePad({
  onChange,
  className,
}: {
  onChange: (png: Blob | null) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const desenhando = useRef(false);
  const [temTraco, setTemTraco] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    /**
     * O canvas tem dois tamanhos: o de CSS (o que se vê) e o de buffer (o que
     * se grava). Sem multiplicar o buffer pelo `devicePixelRatio`, a
     * assinatura fica serrilhada em qualquer tela moderna — e uma assinatura
     * serrilhada num documento clínico parece falsificação.
     */
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);

    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Preto fixo, e não a cor do tema: o PDF é branco, e um traço claro
    // desenhado no modo escuro sairia invisível no documento impresso.
    ctx.strokeStyle = "#111111";
  }, []);

  function posicao(evento: React.PointerEvent<HTMLCanvasElement>) {
    const rect = evento.currentTarget.getBoundingClientRect();
    return { x: evento.clientX - rect.left, y: evento.clientY - rect.top };
  }

  function comecar(evento: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx === undefined || ctx === null) return;
    evento.currentTarget.setPointerCapture(evento.pointerId);
    desenhando.current = true;
    const { x, y } = posicao(evento);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function mover(evento: React.PointerEvent<HTMLCanvasElement>) {
    if (!desenhando.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx === undefined || ctx === null) return;
    const { x, y } = posicao(evento);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!temTraco) setTemTraco(true);
  }

  function terminar() {
    if (!desenhando.current) return;
    desenhando.current = false;
    canvasRef.current?.toBlob((blob) => onChange(blob), "image/png");
  }

  function limpar() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas === null || ctx === undefined || ctx === null) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setTemTraco(false);
    onChange(null);
  }

  return (
    <div className={className}>
      <canvas
        ref={canvasRef}
        // `touch-none` é o que impede o navegador de rolar a página enquanto o
        // dedo desenha. Sem isso, no celular, assinar move a tela.
        className="h-40 w-full touch-none rounded-lg border border-line bg-white"
        onPointerDown={comecar}
        onPointerMove={mover}
        onPointerUp={terminar}
        onPointerLeave={terminar}
        onPointerCancel={terminar}
        aria-label="Área para desenhar a assinatura"
      />
      <div className="mt-1.5 flex items-center justify-between text-xs text-muted">
        <span>{temTraco ? "Assinado" : "Assine com o dedo ou o mouse"}</span>
        <button
          type="button"
          onClick={limpar}
          className="underline underline-offset-2 hover:text-ink"
        >
          limpar
        </button>
      </div>
    </div>
  );
}

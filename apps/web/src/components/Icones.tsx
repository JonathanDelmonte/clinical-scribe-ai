/**
 * Os ícones da interface — traço de 1,8 px, pontas redondas, sem preenchimento.
 *
 * Desenhados aqui, e não trazidos de uma biblioteca: são poucos, precisam ter
 * o mesmo traço entre si, e cada dependência a mais é uma que precisa ser
 * atualizada e auditada. Sempre decorativos (`aria-hidden`): o texto ou o
 * `aria-label` do botão é quem diz o que ele faz.
 */

interface PropsDoIcone {
  readonly tamanho?: number | undefined;
  readonly className?: string | undefined;
  readonly traco?: number | undefined;
}

function Svg({
  tamanho = 20,
  className,
  traco = 1.8,
  children,
}: PropsDoIcone & { readonly children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={tamanho}
      height={tamanho}
      fill="none"
      stroke="currentColor"
      strokeWidth={traco}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

export function IconeInicio(p: PropsDoIcone) {
  return (
    <Svg {...p}>
      <path d="M4 10.2 12 4l8 6.2V19a1.5 1.5 0 0 1-1.5 1.5H15v-5.2H9v5.2H5.5A1.5 1.5 0 0 1 4 19z" />
    </Svg>
  );
}

export function IconePacientes(p: PropsDoIcone) {
  return (
    <Svg {...p}>
      <circle cx="9.5" cy="8.5" r="3.5" />
      <path d="M3.5 19.5c.7-3.3 3.1-5 6-5s5.3 1.7 6 5" />
      <path d="M16 5.3a3.2 3.2 0 0 1 0 6.3" />
      <path d="M18.2 14.6c1.4.6 2.3 2.1 2.6 4.4" />
    </Svg>
  );
}

export function IconeUso(p: PropsDoIcone) {
  return (
    <Svg {...p}>
      <path d="M4 20h16" />
      <path d="M7 16v-5" />
      <path d="M12 16V6" />
      <path d="M17 16v-8" />
    </Svg>
  );
}

export function IconeAjustes(p: PropsDoIcone) {
  return (
    <Svg {...p}>
      <path d="M4 8h9" />
      <path d="M17 8h3" />
      <circle cx="15" cy="8" r="2" />
      <path d="M4 16h3" />
      <path d="M11 16h9" />
      <circle cx="9" cy="16" r="2" />
    </Svg>
  );
}

export function IconeMicrofone(p: PropsDoIcone) {
  return (
    <Svg {...p}>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v2.5" />
    </Svg>
  );
}

export function IconeEnviarArquivo(p: PropsDoIcone) {
  return (
    <Svg {...p}>
      <path d="M12 15V4.5" />
      <path d="m7.5 9 4.5-4.5L16.5 9" />
      <path d="M5 19.5h14" />
    </Svg>
  );
}

export function IconeBusca(p: PropsDoIcone) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </Svg>
  );
}

export function IconeMais(p: PropsDoIcone) {
  return (
    <Svg {...p}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Svg>
  );
}

export function IconeSeta(p: PropsDoIcone) {
  return (
    <Svg {...p}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </Svg>
  );
}

export function IconeAvancar(p: PropsDoIcone) {
  return (
    <Svg {...p}>
      <path d="m9.5 6 6 6-6 6" />
    </Svg>
  );
}

export function IconeVoltar(p: PropsDoIcone) {
  return (
    <Svg {...p}>
      <path d="m14.5 6-6 6 6 6" />
    </Svg>
  );
}

export function IconeCheck(p: PropsDoIcone) {
  return (
    <Svg {...p}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function IconeEscudo(p: PropsDoIcone) {
  return (
    <Svg {...p}>
      <path d="M12 3.5 5.5 6v5.2c0 4.1 2.8 7.5 6.5 8.8 3.7-1.3 6.5-4.7 6.5-8.8V6z" />
      <path d="m9.2 12 2 2 3.8-3.8" />
    </Svg>
  );
}

export function IconeSair(p: PropsDoIcone) {
  return (
    <Svg {...p}>
      <path d="M14 4.5h3.5A1.5 1.5 0 0 1 19 6v12a1.5 1.5 0 0 1-1.5 1.5H14" />
      <path d="m10 16-4-4 4-4" />
      <path d="M6 12h9.5" />
    </Svg>
  );
}

export function IconeAlerta(p: PropsDoIcone) {
  return (
    <Svg {...p}>
      <path d="M12 4.5 3.5 19h17z" />
      <path d="M12 10v4" />
      <path d="M12 16.8v.2" />
    </Svg>
  );
}

export function IconeTocar({ tamanho = 14, className }: PropsDoIcone) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={tamanho}
      height={tamanho}
      className={className}
    >
      <path d="M8 5.5v13L18.5 12z" fill="currentColor" />
    </svg>
  );
}

export function IconeDocumento(p: PropsDoIcone) {
  return (
    <Svg {...p}>
      <path d="M7 3.5h6.5L18 8v11.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z" />
      <path d="M13.5 3.5V8H18" />
      <path d="M9 13h6" />
      <path d="M9 16.5h4" />
    </Svg>
  );
}

export function IconeExportar(p: PropsDoIcone) {
  return (
    <Svg {...p}>
      <path d="M12 14.5V4" />
      <path d="m8 8 4-4 4 4" />
      <path d="M6 12.5v6a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5v-6" />
    </Svg>
  );
}

export function IconeCopiar(p: PropsDoIcone) {
  return (
    <Svg {...p}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
      <path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </Svg>
  );
}

export function IconeLixeira(p: PropsDoIcone) {
  return (
    <Svg {...p}>
      <path d="M5 7h14" />
      <path d="M10 4h4" />
      <path d="M7 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h5.4a1.5 1.5 0 0 0 1.5-1.4L17 7" />
    </Svg>
  );
}

export function IconeAparelho(p: PropsDoIcone) {
  return (
    <Svg {...p}>
      <rect x="6.5" y="3" width="11" height="18" rx="2.5" />
      <path d="m9.5 12 1.8 1.8 3.2-3.3" />
    </Svg>
  );
}

export function IconeMandar(p: PropsDoIcone) {
  return (
    <Svg {...p}>
      <path d="M12 19V5" />
      <path d="m6 11 6-6 6 6" />
    </Svg>
  );
}

export function IconeFechar(p: PropsDoIcone) {
  return (
    <Svg {...p}>
      <path d="m7 7 10 10" />
      <path d="M17 7 7 17" />
    </Svg>
  );
}

export function IconeEditar(p: PropsDoIcone) {
  return (
    <Svg {...p}>
      <path d="M4.5 19.5h4l10-10a2.1 2.1 0 0 0-3-3l-10 10z" />
      <path d="m14 7 3 3" />
    </Svg>
  );
}

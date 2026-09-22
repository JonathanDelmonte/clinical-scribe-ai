import Link from "next/link";

import { Item, Lista, PaginaLegal, Secao } from "@/components/PaginaLegal";

export const dynamic = "force-static";

export const metadata = {
  title: "Termos de uso — Consulta Viva",
};

/**
 * Termos de uso.
 *
 * O documento existe para dizer três coisas que o produto precisa que estejam
 * ditas, e que não são detalhes jurídicos:
 *
 * 1. **A nota é rascunho até você assinar.** É o que sustenta o mecanismo
 *    anti-alucinação inteiro — se o profissional achar que a saída da IA é
 *    documento pronto, a revisão vira leitura, e é aí que 62% dos achados
 *    fabricados passam (§11 da documentação).
 * 2. **Isto não é prontuário eletrônico certificado.** A §10 da documentação
 *    define a posição do MVP: assistente que exporta para o prontuário
 *    certificado que o profissional já usa. Deixar ambíguo seria vender uma
 *    certificação que não existe.
 * 3. **O paciente precisa estar ciente da gravação.** A obrigação é do
 *    profissional, e ele precisa saber que é dele.
 */
export default function Termos() {
  return (
    <PaginaLegal
      titulo="Termos de uso"
      resumo="O que este produto faz, o que ele não é, e o que continua sendo responsabilidade sua."
    >
      <Secao titulo="O que o serviço faz">
        <p>
          A Consulta Viva grava a consulta, transcreve, separa quem falou e devolve uma
          nota clínica estruturada, com cada afirmação ancorada no trecho de áudio que a
          originou. A partir daí você revisa, corrige, aprova e exporta.
        </p>
      </Secao>

      <Secao titulo="A nota nasce rascunho, e é você quem a transforma em documento">
        <p>
          Esta é a cláusula mais importante do documento, e ela não é formalidade
          jurídica — é como o produto funciona.
        </p>
        <Lista>
          <Item>
            <strong>
              Nada é gravado como documento sem a sua aprovação explícita.
            </strong>{" "}
            A nota gerada é uma proposta.
          </Item>
          <Item>
            <strong>Escribas de IA inventam informação que soa plausível.</strong>{" "}
            Medicação que ninguém mencionou, achado de exame que não houve, ordem dos
            fatos trocada. Por isso cada afirmação aponta o segundo do áudio que a
            sustenta, e por isso o sistema <strong>recusa</strong> aprovar uma nota com
            afirmação sem âncora — a menos que você assuma aquela afirmação
            explicitamente, o que fica registrado.
          </Item>
          <Item>
            <strong>A revisão é sua, e a responsabilidade clínica também.</strong> O
            documento que sai daqui leva o seu nome porque foi você quem conferiu.
          </Item>
        </Lista>
      </Secao>

      <Secao titulo="O que este produto não é">
        <Lista>
          <Item>
            <strong>Não é prontuário eletrônico certificado.</strong> Não temos
            certificação SBIS/CFM (NGS1 ou NGS2). O produto é um assistente de
            documentação que <strong>exporta</strong> para o prontuário que você já usa
            — e é assim de propósito, não por omissão.
          </Item>
          <Item>
            <strong>A assinatura no PDF não é assinatura digital ICP-Brasil.</strong> É
            a imagem da sua assinatura e a sua identificação profissional. Para validade
            jurídica plena, o documento precisa ir para um sistema que assine
            digitalmente.
          </Item>
          <Item>
            <strong>Não damos conduta clínica.</strong> O sistema documenta o que foi
            dito na consulta. Ele não sugere diagnóstico, não indica tratamento e não
            fala com o seu paciente.
          </Item>
          <Item>
            <strong>Não substitui o seu julgamento.</strong> Se a nota discordar do que
            aconteceu na sala, o que aconteceu na sala é que vale.
          </Item>
        </Lista>
      </Secao>

      <Secao titulo="O que continua sendo responsabilidade sua">
        <Lista>
          <Item>
            <strong>Informar o paciente de que a consulta será gravada.</strong> A
            transparência é obrigação sua, e o sistema exige que você confirme que a
            cumpriu antes de habilitar a gravação. Confirmar sem ter informado é
            registrar algo falso num documento clínico.
          </Item>
          <Item>
            <strong>Revisar antes de aprovar.</strong> Ver a cláusula acima.
          </Item>
          <Item>
            <strong>Guardar o que precisa ser guardado.</strong> A documentação clínica
            que você produz aqui pode estar sujeita a prazo de guarda (Resolução CFM
            1.821/2007). Exportar e arquivar é decisão sua — e a exclusão da conta apaga
            tudo, sem desfazer.
          </Item>
          <Item>
            <strong>Cuidar da sua conta.</strong> A senha é sua; quem entrar com ela
            enxerga os prontuários dos seus pacientes.{" "}
            <Link href="/auditoria" className="text-accent hover:underline">
              A trilha de auditoria
            </Link>{" "}
            mostra todos os acessos.
          </Item>
        </Lista>
      </Secao>

      <Secao titulo="Planos, quota e custo">
        <Lista>
          <Item>
            O plano grátis tem um teto mensal de minutos processados. Ele é conferido{" "}
            <strong>antes</strong> do processamento.
          </Item>
          <Item>
            <strong>Estourar a quota nunca perde uma gravação.</strong> O áudio é
            guardado e fica esperando: ele é processado quando o mês virar ou quando o
            plano mudar. A consulta aconteceu uma vez; o limite é sobre custo, não sobre
            o seu trabalho.
          </Item>
          <Item>
            <Link href="/uso" className="text-accent hover:underline">
              O seu consumo e o custo de cada consulta
            </Link>{" "}
            ficam visíveis o tempo todo.
          </Item>
        </Lista>
      </Secao>

      <Secao titulo="Disponibilidade e limites">
        <p>
          O serviço é oferecido no estado em que se encontra. Transcrição automática
          erra, principalmente com áudio ruim, sotaque, jargão e várias pessoas falando
          ao mesmo tempo — é por isso que a transcrição fica visível e editável, e é por
          isso que a nota aponta o áudio.
        </p>
        <p>
          Fazemos o possível para manter tudo no ar e íntegro, sem prometer
          disponibilidade contínua. Gravações feitas no seu aparelho ficam guardadas
          nele até serem enviadas, então uma queda de rede ou do serviço não perde a
          consulta.
        </p>
      </Secao>

      <Secao titulo="Encerramento">
        <p>
          Você pode{" "}
          <Link href="/configuracoes/dados" className="text-accent hover:underline">
            exportar seus dados e excluir a conta
          </Link>{" "}
          a qualquer momento, sem pedir autorização a ninguém. A exclusão é imediata e
          não tem desfazer.
        </p>
      </Secao>

      <Secao titulo="Privacidade">
        <p>
          O que guardamos, por quê e por quanto tempo está na{" "}
          <Link href="/privacidade" className="text-accent hover:underline">
            política de privacidade
          </Link>
          , que faz parte destes termos.
        </p>
      </Secao>
    </PaginaLegal>
  );
}

import Link from "next/link";

import { Item, Lista, PaginaLegal, Secao } from "@/components/PaginaLegal";

export const dynamic = "force-static";

export const metadata = {
  title: "Política de privacidade — Consulta Viva",
};

/**
 * Política de privacidade.
 *
 * Escrita para ser **lida**, e escrita para ser **verdadeira** — o que neste
 * produto é a mesma coisa, porque o argumento de venda é confiança (§10 da
 * documentação). Uma política que promete mais do que o código faz é uma
 * reclamação na ANPD esperando acontecer; uma que ninguém entende não informa
 * ninguém, que é o oposto do que a LGPD pede.
 *
 * ⚠️ **Cada afirmação daqui corresponde a algo implementado.** Ao mudar o
 * comportamento do produto, mude este texto junto — e a data em
 * `PaginaLegal.tsx`. A lista de subprocessadores é a parte que envelhece mais
 * rápido: ver `docs/PRIVACIDADE.md` para o procedimento.
 */
export default function Privacidade() {
  return (
    <PaginaLegal
      titulo="Política de privacidade"
      resumo="O que guardamos, por quê, por quanto tempo, e o que você pode fazer a respeito."
    >
      <Secao titulo="Quem é responsável pelo quê">
        <p>
          Esta é a distinção mais importante do documento, porque ela decide quem
          responde por cada dado.
        </p>
        <Lista>
          <Item>
            <strong>Você, profissional, é o controlador</strong> dos dados dos seus
            pacientes. É você quem decide gravar a consulta, o que documentar e por
            quanto tempo manter. As obrigações profissionais que já valem para o seu
            prontuário continuam valendo aqui.
          </Item>
          <Item>
            <strong>Nós somos o operador</strong>: tratamos esses dados seguindo as suas
            instruções, para produzir a documentação que você pediu. Não usamos para
            mais nada.
          </Item>
          <Item>
            Sobre os <strong>seus</strong> dados de conta — nome, e-mail, registro
            profissional, consumo — nós somos o controlador.
          </Item>
        </Lista>
      </Secao>

      <Secao titulo="O que é guardado">
        <Lista>
          <Item>
            <strong>Sua conta:</strong> nome, e-mail, senha (guardada como hash scrypt,
            nunca em texto), especialidade, conselho e número de registro, imagem da
            assinatura.
          </Item>
          <Item>
            <strong>Sua voz, se você cadastrar:</strong> um vetor de 256 números que
            representa o timbre. Não é áudio e não reconstrói fala — serve para o
            sistema saber qual voz na gravação é a sua.
          </Item>
          <Item>
            <strong>Seus pacientes:</strong> nome, data de nascimento e as observações
            que você escrever.
          </Item>
          <Item>
            <strong>As consultas:</strong> o áudio gravado, a transcrição com os papéis
            atribuídos, os documentos gerados, o registro de que o paciente foi
            informado da gravação (com o texto exato e o horário).
          </Item>
          <Item>
            <strong>Uso:</strong> minutos processados e custo por consulta. É o que
            controla a quota do seu plano.
          </Item>
          <Item>
            <strong>Trilha de auditoria:</strong> ação, horário, identificador do
            registro afetado, endereço de IP e navegador.{" "}
            <strong>Nunca o conteúdo</strong> das consultas — a trilha registra que você
            abriu uma ficha, não o que estava escrito nela.{" "}
            <Link href="/auditoria" className="text-accent hover:underline">
              Você pode ler a sua
            </Link>
            .
          </Item>
        </Lista>
      </Secao>

      <Secao titulo="Com que base legal">
        <p>
          Existe um mito de que tudo em saúde depende de consentimento. Não depende — e
          fingir que depende atrapalha mais do que ajuda.
        </p>
        <Lista>
          <Item>
            <strong>Documentar o atendimento</strong> tem base na tutela da saúde (LGPD,
            Art. 11, II, &ldquo;f&rdquo;). O profissional documenta a consulta
            independentemente de consentimento — é o trabalho dele.
          </Item>
          <Item>
            <strong>Gravar</strong> a consulta para produzir essa documentação segue a
            mesma base, somada à obrigação de <strong>transparência</strong>: o paciente
            precisa estar ciente. O sistema exige que você confirme isso antes de
            gravar, e guarda o texto do que foi comunicado.
          </Item>
          <Item>
            <strong>Sua conta e sua cobrança</strong>: execução do contrato.
          </Item>
          <Item>
            <strong>A trilha de auditoria</strong>: obrigação legal e legítimo interesse
            na segurança do registro clínico.
          </Item>
          <Item>
            <strong>Uso secundário</strong> — treinar modelos, pesquisa, compartilhar
            com terceiros — <strong>não acontece</strong>. Exigiria consentimento
            específico, e não o coletamos porque não fazemos.
          </Item>
        </Lista>
      </Secao>

      <Secao titulo="Seus dados não treinam nenhuma IA">
        <p>
          O áudio e a transcrição servem para produzir a sua documentação, e nada além
          disso. Nenhum trecho de consulta alimenta treinamento de modelo, nosso ou de
          terceiro.
        </p>
        <p>
          Isso não é só uma promessa de texto: a configuração do sistema{" "}
          <strong>recusa por padrão</strong> fornecedores de IA cujos termos permitem
          treinar com o que recebem. Usar um desses exige alterar a configuração
          explicitamente, e isso só é aceitável com áudio de teste.
        </p>
      </Secao>

      <Secao titulo="Quem mais toca nesses dados (subprocessadores)">
        <p>
          A resposta honesta depende de como a sua instalação está configurada, e as
          duas configurações são bem diferentes:
        </p>
        <Lista>
          <Item>
            <strong>Transcrição com o motor local</strong> — o padrão do plano grátis. O
            áudio é processado no próprio servidor, por software que roda ali.{" "}
            <strong>Nenhum subprocessador, nenhuma transferência internacional.</strong>
          </Item>
          <Item>
            <strong>Transcrição com o motor de nuvem</strong> — o áudio vai para um
            fornecedor externo de reconhecimento de fala. O fornecedor ainda não foi
            escolhido; quando for, o nome, o país e os termos entram nesta lista{" "}
            <strong>antes</strong> de o motor ser oferecido a alguém.
          </Item>
          <Item>
            <strong>Geração da nota clínica</strong> — a transcrição (não o áudio) é
            enviada a um provedor de modelo de linguagem, sob termos que proíbem o uso
            para treinamento. É a única saída de dado que existe no caminho padrão, e é
            por isso que ela está escrita aqui em vez de escondida.
          </Item>
        </Lista>
      </Secao>

      <Secao titulo="Por quanto tempo">
        <Lista>
          <Item>
            <strong>O áudio da consulta é apagado automaticamente</strong> depois do
            prazo de retenção configurado na sua instalação — 30 dias por padrão. É
            minimização (LGPD, Art. 6º) e é a defesa mais barata que existe: dado
            apagado não vaza. A transcrição e a nota permanecem.
          </Item>
          <Item>
            Transcrições, notas e fichas ficam enquanto a conta existir, ou até você
            apagá-las.
          </Item>
          <Item>
            A trilha de auditoria sobrevive à exclusão da conta, porque o registro de
            que ela existiu é o que uma auditoria precisa guardar. O que identificava
            você nela — IP e navegador — é anulado no mesmo instante.
          </Item>
        </Lista>
      </Secao>

      <Secao titulo="Como esses dados são protegidos">
        <Lista>
          <Item>
            <strong>Isolamento no banco de dados, não na tela.</strong> Cada consulta ao
            banco é filtrada por dono por políticas do próprio Postgres. Um erro de
            programação numa tela não expõe dado de outro profissional, porque não é a
            tela que decide.
          </Item>
          <Item>
            <strong>Senhas</strong> guardadas com scrypt e sal por usuário. Nem nós
            conseguimos lê-las.
          </Item>
          <Item>
            <strong>Sessões</strong> em cookie assinado, inacessível a JavaScript, com
            validade de sete dias.
          </Item>
          <Item>
            <strong>Limite de tentativas</strong> no login e nas operações caras.
          </Item>
          <Item>
            <strong>O registro de acesso</strong> guarda IDs e horários, nunca conteúdo
            clínico — inclusive nos logs do servidor.
          </Item>
        </Lista>
      </Secao>

      <Secao titulo="O que você pode fazer">
        <p>
          Os direitos do Art. 18 da LGPD, com botão em vez de formulário de contato:
        </p>
        <Lista>
          <Item>
            <strong>Acesso e portabilidade:</strong> baixar tudo o que é seu num arquivo
            JSON, a qualquer momento.
          </Item>
          <Item>
            <strong>Correção:</strong> editar perfil, fichas de paciente e as notas
            geradas, direto na interface.
          </Item>
          <Item>
            <strong>Eliminação:</strong> apagar a conta e tudo o que veio com ela.
            Imediato, sem período de espera.
          </Item>
        </Lista>
        <p>
          <Link href="/configuracoes/dados" className="text-accent hover:underline">
            Exercer esses direitos →
          </Link>
        </p>
      </Secao>

      <Secao titulo="Onde os dados ficam">
        <p>
          O banco de dados e o armazenamento de áudio ficam no Brasil. Com o motor
          local, o áudio não sai da mesma máquina. A geração da nota envolve um provedor
          que pode estar fora do país — declarado acima, como manda o Art. 33.
        </p>
      </Secao>

      <Secao titulo="Mudanças neste documento">
        <p>
          Quando este texto mudar, a data de vigência no topo muda junto. Mudanças que
          afetem como os dados são tratados são comunicadas antes de valerem.
        </p>
      </Secao>
    </PaginaLegal>
  );
}

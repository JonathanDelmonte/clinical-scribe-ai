# Privacidade e termos — como manter os documentos verdadeiros

> O texto que o usuário lê **não está aqui**. Ele vive em
> [`apps/web/src/app/privacidade/page.tsx`](../apps/web/src/app/privacidade/page.tsx)
> e [`apps/web/src/app/termos/page.tsx`](../apps/web/src/app/termos/page.tsx).
>
> Este arquivo é o procedimento operacional: **o que precisa ser reconferido, e
> quando.**

---

## Por que o texto mora no código, e não numa cópia em Markdown aqui

Duas versões de um documento legal são uma versão certa e uma errada, e nunca
se sabe qual é qual. O texto que vale é o que a pessoa leu ao criar a conta —
então ele mora onde é servido, versionado no Git como qualquer outro arquivo, e
revisável em diff.

O que sobra para este arquivo é o que uma página não consegue carregar: o
procedimento de quem opera o sistema.

---

## A regra que sustenta os dois documentos

> **Cada afirmação naqueles textos corresponde a algo implementado.**

É o que separa uma política de privacidade de uma peça de marketing. "Seus
dados não treinam nenhuma IA" só pode estar escrito porque
`LLM_DATA_POLICY="contractual"` é o padrão e recusa fornecedor que treina com
os prompts. "O áudio é apagado automaticamente" só pode estar escrito porque a
varredura de retenção existe e roda.

Mudou o comportamento, muda o texto. Na mesma PR.

---

## Quando mexer no texto

| Mudou isto… | …reconferir |
|---|---|
| Fornecedor de ASR (o motor `cloud`) | A lista de subprocessadores. **Nome, país e termos entram antes de o motor ser oferecido a alguém.** |
| Provedor do LLM da nota | Idem. A transcrição sai do sistema por aí. |
| `AUDIO_RETENTION_DAYS` como padrão do produto | A seção "Por quanto tempo" cita 30 dias. |
| Qualquer campo novo guardado sobre paciente ou profissional | A seção "O que é guardado". |
| Onde o banco ou o áudio ficam hospedados | A seção "Onde os dados ficam" e, se houver transferência internacional, o Art. 33. |
| Autenticação (ADR-0004) | A seção "Como esses dados são protegidos" cita scrypt e cookie assinado. |
| Certificação SBIS/CFM, se algum dia houver | Os termos dizem, hoje, que **não** temos. |

**E sempre:** a data de vigência, em `VIGENCIA` dentro de
[`PaginaLegal.tsx`](../apps/web/src/components/PaginaLegal.tsx). Um documento
legal sem data não diz o que valia quando a pessoa aceitou.

---

## A lista de subprocessadores

Hoje o texto descreve três situações em vez de listar empresas, e isso é
proposital — a instalação padrão do plano grátis **não tem subprocessador de
áudio**, e essa é a afirmação mais forte que o produto tem a fazer sobre
privacidade.

Quando houver nome:

1. Acrescente **nome, papel, país e o link dos termos** na seção de
   subprocessadores.
2. Se o país não for o Brasil, confirme a salvaguarda do Art. 33 (cláusulas
   contratuais padrão, em geral) **antes** de ligar o fornecedor.
3. Atualize a seção "Onde os dados ficam".
4. Mude a data de vigência.
5. Avise quem já tem conta, antes de passar a valer.

O passo 5 não é firula: mudar quem processa dado de saúde de paciente sem
avisar o profissional que é controlador desse dado o coloca em falta com uma
obrigação que é dele.

---

## O que estes documentos deliberadamente não fazem

- **Não pedem consentimento para o tratamento.** A base é a tutela da saúde
  (Art. 11, II, "f") somada à transparência. Pedir consentimento onde ele não é
  a base legal confunde o titular e enfraquece o consentimento onde ele
  realmente importa.
- **Não prometem disponibilidade.** Não há SLA, e inventar um seria assumir uma
  obrigação que a operação de hoje não sustenta.
- **Não afirmam que ninguém pode alterar a trilha de auditoria.** Quem tem
  acesso administrativo ao banco tem acesso administrativo ao banco. O que
  afirmam é o que está implementado: a aplicação só sabe acrescentar.

---

## Revisão de segurança

O documento irmão deste é
[`REVISAO-DE-SEGURANCA.md`](./REVISAO-DE-SEGURANCA.md) — o que foi conferido, o
que foi corrigido, o que continua aberto, e o checklist de implantação.

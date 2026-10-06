# Pendências — o que foi adiado, de propósito

> Estado em 01/10/2026. O projeto está **em fase de teste, sem paciente real**,
> e nada aqui atrapalha os testes. A primeira lista, porém, **bloqueia o
> primeiro paciente real**: nenhum item dela pode ficar para depois disso.
>
> Ao resolver um item, risque-o aqui e registre onde está a solução.

## Não funciona no site publicado (ainda)

Nada, desde 06/10: o **cadastro da voz** passou a ir pela fila, como as
consultas, e funciona com o ajudante da pessoa ligado ou com a estação no ar.
Ver [ADR-0005, etapa 2](./adr/0005-ajudante.md#etapa-2-o-site-manda-o-trabalho-para-o-ajudante).

## Antes do primeiro paciente real

1. **Nota clínica num provedor que não treina com os dados.** Hoje a produção
   usa o Gemini gratuito com `LLM_DATA_POLICY=training` — aceitável só para
   conversa de teste. A API paga do Google, por exemplo, não usa os dados para
   treino. É decisão de custo. Desde 27/09 cada profissional também pode
   cadastrar a própria chave com esses termos (ADR-0003) — o que resolve para
   ele, não para quem usa a da instalação.
2. **Política de privacidade** (`/privacidade` e `docs/PRIVACIDADE.md`). Hoje
   ela afirma que o provedor da nota não treina com os dados — falso na
   configuração atual (item 1) — e não cita quem de fato toca nos dados:
   Supabase (banco e gravações, São Paulo), Vercel (site, funções em São
   Paulo) e Google (nota clínica — transferência internacional), além da
   estação de processamento, que é o computador de quem opera o sistema.
3. **Backup do banco.** O Supabase gratuito não faz backup automático — só os
   planos pagos. Para o gratuito, a própria documentação recomenda exportar
   com `supabase db dump` regularmente. Decidir: plano pago, ou exportação
   agendada no computador da estação, guardada cifrada.
4. **Cadastro aberto.** Qualquer pessoa cria conta, sem verificação de e-mail,
   e passa a usar o processamento e a chave de IA da instalação. Enquanto for
   teste: lista de e-mails permitidos.
5. **Limite de tentativas na memória do processo** (pendência 4 da
   [revisão de segurança](./REVISAO-DE-SEGURANCA.md)). Na Vercel cada instância
   conta sozinha, o que enfraquece o limite de login contra força bruta. Levar
   para o Postgres, atrás da mesma interface.
6. **Retenção de áudio depende do computador ligado.** A varredura roda no
   worker; com a estação desligada por dias, nada é apagado no prazo. Mover o
   agendamento para fora do computador (cron da Vercel ou do banco).

## Segurança — nomeadas na revisão, sem risco imediato

Detalhes e justificativas em [REVISAO-DE-SEGURANCA.md](./REVISAO-DE-SEGURANCA.md#️-o-que-continua-aberto).

- **1 — `script-src` fora da CSP.** Exige nonce por requisição.
- **3 — Sem revogação de sessão.** Sete dias de validade limitam o estrago.
- **5 — `documentEncrypted` sem uso.** Nenhum risco enquanto nada escrever nela.
- **6 — O build leva o projeto inteiro para o servidor.** É o aviso que aparece
  no build da Vercel (a linha dele que fala em "failures" é contada como
  erro, mas o build passa). Correção de uma linha: `/*turbopackIgnore: true*/`
  na chamada de `resolve` em `packages/storage/src/local.ts` — em produção o
  armazenamento é o S3, e esse caminho só existe no disco local.
- **7 — Sem verificação de e-mail nem "esqueci minha senha".** Exige envio de
  e-mail, que o produto ainda não tem.
- **8 — Sem segundo fator.** Vira requisito com clínica e equipe.

## Resolvidas pela implantação

- **Pendência 2 (`x-forwarded-for` confiável demais):** a Vercel sobrescreve o
  cabeçalho com o IP real e descarta o que o cliente mandou — é a forma
  documentada de ela impedir falsificação de IP.
- **Do checklist de implantação:** HTTPS (Vercel), criptografia em repouso
  (Supabase), `SUPABASE_SERVICE_ROLE_KEY` fora da aplicação web (o site usa
  chaves S3 que só abrem os arquivos), retenção configurada em 30 dias.

## Implantação — conferir ao mexer nas chaves

- **`SEGREDO_MESTRE` igual no site e na estação.** O site cifra as chaves de
  IA com a dele; a estação abre com a dela. Diferentes, a chave própria de
  ninguém abre — a sessão avisa, e nada é enviado. Na Vercel ela é "Secret" e
  não se lê de volta: na dúvida, cole de novo o valor do `.env.producao`.

## O ajudante

Detalhes em [ADR-0005](./adr/0005-ajudante.md#o-que-falta).

- **Executável sem assinatura digital.** Na primeira vez o SmartScreen avisa
  "O Windows protegeu o computador", e a pessoa precisa clicar em "Mais
  informações" → "Executar assim mesmo". Some com um certificado de
  assinatura de código (pago, por ano). Antes de distribuir para quem não é
  da equipe.
- **Atualização manual.** Uma versão nova entra baixando o arquivo e
  escolhendo Reinstalar.
- **A quota do que o ajudante processa — decisão de negócio.** Hoje os
  minutos transcritos no computador da pessoa contam na quota do plano, como
  os da estação (o uso fica registrado como `ajudante:large-v3`, custo zero).
  Para nós eles não custam nada: decidir se continuam contando, ou se o
  ajudante vira um motivo para usar o plano grátis sem limite de minutos.
- **Repositório privado → token do download.** O botão "Baixar o ajudante"
  busca a Release mais recente pela API do GitHub. Ao tornar o repositório
  privado, crie um token de acesso refinado (*fine-grained*), só deste
  repositório, com permissão de leitura em *Contents*, e cole-o na Vercel como
  `GITHUB_TOKEN_RELEASES`. Sem ele, o download passa a dizer "ainda não está
  disponível". Ver ADR-0005, "O download". Atualização automática exige onde publicar as
  versões e, de novo, a assinatura.

## Limites do plano gratuito, para não esquecer

- **Supabase:** 500 MB de banco e 1 GB de arquivos. A 14,7 MB por hora de
  áudio guardado, 1 GB são ~68 horas — com a retenção de 30 dias, cabe o mês
  de uma agenda leve, não a de várias pessoas. O projeto **pausa depois de 7
  dias sem atividade**.
- **Vercel Hobby:** uso não comercial.
- **Estação de processamento:** com o computador desligado, as consultas
  esperam na fila — nada se perde, mas nada é processado.

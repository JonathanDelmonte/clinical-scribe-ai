# Pendências — o que foi adiado, de propósito

> Estado em 27/09/2026. O projeto está **em fase de teste, sem paciente real**,
> e nada aqui atrapalha os testes. A primeira lista, porém, **bloqueia o
> primeiro paciente real**: nenhum item dela pode ficar para depois disso.
>
> Ao resolver um item, risque-o aqui e registre onde está a solução.

## Antes do primeiro paciente real

1. **Nota clínica num provedor que não treina com os dados.** Hoje a produção
   usa o Gemini gratuito com `LLM_DATA_POLICY=training` — aceitável só para
   conversa de teste. A API paga do Google, por exemplo, não usa os dados para
   treino. É decisão de custo.
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

## Limites do plano gratuito, para não esquecer

- **Supabase:** 500 MB de banco e 1 GB de arquivos. A 14,7 MB por hora de
  áudio guardado, 1 GB são ~68 horas — com a retenção de 30 dias, cabe o mês
  de uma agenda leve, não a de várias pessoas. O projeto **pausa depois de 7
  dias sem atividade**.
- **Vercel Hobby:** uso não comercial.
- **Estação de processamento:** com o computador desligado, as consultas
  esperam na fila — nada se perde, mas nada é processado.

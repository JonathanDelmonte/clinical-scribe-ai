# Revisão de segurança — antes do primeiro usuário real

> Último item do Marco 6 · Trilha B.
> Revisão feita em 22/09/2026, sobre o estado da branch ao fim da Fase 12.

Este documento não é um selo. É a lista do que foi conferido, do que foi
corrigido, e — a parte que importa — **do que continua aberto e por quê**.

Uma revisão de segurança que só lista o que está bom não serve para decidir
nada. A tabela de pendências no fim é o motivo deste arquivo existir.

---

## O modelo de ameaça, em três frases

O ativo é **áudio e transcrição de consulta**: dado pessoal sensível de saúde
(LGPD Art. 11), de pessoas que não são usuárias do sistema e nunca vão
auditá-lo.

O atacante realista não é um invasor sofisticado: é **um bug de programação
que faz um profissional enxergar o prontuário de outro**, e é **o aparelho
compartilhado do consultório**, onde a pessoa seguinte abre o navegador.

O pior resultado possível não é indisponibilidade. É vazamento silencioso —
aquele que ninguém percebe porque tudo continua funcionando.

---

## O que foi conferido

### Isolamento entre profissionais

| Conferido | Como |
|---|---|
| Toda tabela com dado clínico tem política RLS de dono | `packages/db/sql/rls.sql` |
| As políticas são testadas contra tentativa ativa de leitura, escrita e alteração alheia | `pnpm db:test-rls` — 21 asserções, roda no CI a cada PR |
| A aplicação nunca filtra por `professional_id` na mão | as consultas não têm `where` de dono; quem filtra é o banco |
| `force row level security` está ligado | senão o dono da tabela — que muitas vezes é a conexão da aplicação — ignoraria tudo |

**O ponto que sustenta o resto:** o isolamento não depende de nenhuma linha de
código da aplicação estar certa. Um `where` esquecido numa tela nova não vaza
dado, porque não é a tela que decide.

### Identidade e sessão

| Conferido | Resultado |
|---|---|
| Senha guardada com derivação lenta | scrypt, sal por usuário, parâmetros dentro do hash |
| Comparação de senha e de assinatura em tempo constante | `timingSafeEqual` nos dois |
| Token de sessão resiste a adulteração | HMAC-SHA256; teste dedicado troca o `sub` mantendo a assinatura e exige recusa |
| Cookie inacessível a JavaScript | `HttpOnly`, `SameSite=Lax`, `Secure` em produção |
| Resposta de login não revela se o e-mail existe | mensagem única **e** tempo de resposta igualado com um hash de isca |
| Sair usa `POST` | um `GET` seria disparado por `<img>` de terceiro |
| Redirecionamento pós-login não aceita destino externo | `?de=` precisa começar com `/` e não com `//` |

### Entrada e armazenamento

| Conferido | Resultado |
|---|---|
| Travessia de caminho no armazenamento | bloqueada e testada, inclusive nas chaves compostas com nome vindo do navegador |
| Upload de assinatura confere os bytes, não o `content-type` | os oito bytes mágicos do PNG |
| Formato de áudio validado por lista fechada | `EXTENSOES_ACEITAS` |
| Tamanho máximo de arquivo e de pedaço | 200 MB e 8 MB |
| Montagem do áudio exige todos os pedaços | um buraco produziria arquivo válido com pedaço de consulta faltando, **sem erro nenhum** |
| Corpo cortado pelo buffer do proxy é recusado, não aceito pela metade | `content-length` conferido contra o que chegou — ver a correção 3 |
| SQL sempre parametrizado | regra do ESLint que recusa interpolação em `WHERE` |
| Conteúdo de documento lido defensivamente na exportação | é `jsonb` produzido por LLM, possivelmente por versão antiga do prompt |

### Vazamento por caminhos indiretos

| Conferido | Resultado |
|---|---|
| Log nunca registra conteúdo clínico | regra do projeto + redação no logger |
| Trilha de auditoria guarda IDs, nunca conteúdo | é onde a tentação é maior |
| Service worker não cacheia resposta de API | cache de SW vive no disco do aparelho, sobrevive ao logout e é lido por qualquer aba |
| Áudio e documento nunca em cache compartilhado | `cache-control: private, no-store` nas rotas que os entregam |
| Assinatura só é servida ao próprio dono | a rota não aceita parâmetro de chave |
| Exportação de dados roda sob RLS | não alcança nada além do que a interface já mostrava |

### Limites e abuso

| Conferido | Resultado |
|---|---|
| Login limitado por IP **e por e-mail** | o segundo é o que não dá para contornar |
| Rotas que custam dinheiro limitadas por profissional | upload, pedaços, geração, exportação |
| Tentativa negada não adia a própria recuperação | senão quem insiste sem parar nunca sai do bloqueio |
| Quota conferida **antes** de processar | e o áudio é preservado quando ela estoura |

### Ciclo de vida do dado

| Conferido | Resultado |
|---|---|
| Áudio apagado automaticamente após a retenção | varredura no worker, autocorretiva |
| Exclusão de conta apaga arquivos e registros | verificada ponta a ponta, incluindo pedaços de upload e assinatura |
| Trilha de auditoria sobrevive à exclusão, anonimizada | IP e navegador anulados no mesmo instante |
| Buffer de gravação no aparelho tem validade | sete dias; aparelho de consultório não acumula consulta |

---

## Corrigido durante esta revisão

1. **`document.write` na cópia para o prontuário.** A saída do LLM era
   interpolada numa string de HTML com escape manual de `<`, `>` e `&`. Estava
   correta, e escape manual é exatamente o que deixa de estar correto quando
   alguém acrescenta um atributo. Trocado por `textContent`, que não tem como
   interpretar nada como marcação.

2. **Cabeçalhos ausentes.** Acrescentados `Content-Security-Policy` (na parte
   que dá para apertar sem nonce), e `Strict-Transport-Security` apenas em
   produção — em `localhost` ele gruda no navegador por meses e quebra outros
   projetos na mesma porta.

3. **Corpo de requisição cortado em silêncio** *(23/09/2026)*. Porque existe
   um `proxy.ts`, o Next clona e bufferiza o corpo de toda requisição, e ao
   passar de 10 MB ele **entrega o corpo cortado sem erro nenhum** — a
   documentação do `proxyClientMaxBodySize` é explícita: *"the request will
   not fail or return an error to the client"*.

   O sintoma foi o envio de arquivo pela tela recusando todo áudio com mais
   de cinco minutos (`formData()` lançava por falta da fronteira final do
   `multipart`). O risco maior era outro, e silencioso: num corpo cru, um
   corte não lança nada — grava menos bytes. Um pedaço de áudio cortado vira
   uma consulta remontada com um buraco no meio, transcrita sem reclamação,
   com um trecho da conversa ausente da nota.

   Três correções, e a terceira é a que sustenta as outras duas:

   - A tela passou a enviar **todo** áudio em pedaços de 512 KB, inclusive o
     arquivo escolhido no seletor — o mesmo caminho da gravação, com
     progresso e retomada.
   - As rotas que recebem corpo conferem `content-length` **antes** de
     confiar no que chegou, e recusam com uma mensagem que diz o que fazer.
   - O teto saiu do padrão invisível do framework e virou uma constante
     (`apps/web/src/lib/audio.ts`) que o `next.config.ts` usa para configurar
     o Next e as rotas usam para conferir. Um teste falha se o tamanho do
     pedaço chegar perto dela.

---

## ⚠️ O que continua aberto

| # | Item | Risco | O que falta |
|---|---|---|---|
| 1 | **`script-src` não está na CSP** | XSS teria execução livre | Exige nonce por requisição no `proxy.ts` e no layout. Uma CSP com `unsafe-inline` escrita só para "ter uma CSP" dá impressão de proteção sem dar proteção — por isso a ausência é explícita, e não disfarçada. |
| 2 | **`x-forwarded-for` é confiável demais** | Limite por IP contornável trocando o cabeçalho | O proxy reverso na frente precisa **sobrescrever** o cabeçalho, não repassá-lo. Mitigado hoje porque o login também é limitado por e-mail, que o atacante não pode variar. **Conferir na configuração do deploy.** |
| 3 | **Não há revogação de sessão** | Token roubado vale até expirar | Sete dias de validade limitam o estrago. Uma tabela de sessões resolve; ver ADR-0004. |
| 4 | **Rate limit vive na memória do processo** | Com N instâncias, o limite vira N vezes maior | Implementação em Postgres atrás da mesma interface. Aceitável enquanto o desenho for de um processo. |
| 5 | **`documentEncrypted` não é usado** | Nenhum — a coluna está vazia | A coluna de CPF/RG cifrado existe no schema e nenhuma tela escreve nela. Se um dia escrever, **a cifra precisa existir antes**. |
| 6 | **Build arrasta o projeto inteiro para o bundle do servidor** | Arquivos-fonte e `public/` no artefato de deploy | `resolveStorageRoot()` sobe diretórios procurando a raiz do monorepo, e o Turbopack avisa que isso força o rastreamento de tudo. Não vaza dado de paciente; aumenta o artefato e a superfície. É código compartilhado com o worker — merece uma conversa entre as duas trilhas. |
| 7 | **Sem verificação de e-mail no cadastro** | Conta criada com e-mail de terceiro | Sem envio de e-mail no produto ainda. Entra junto com "esqueci minha senha", que também não existe. |
| 8 | **Sem segundo fator** | Senha única protege prontuário | Esperado para o MVP; vira requisito quando houver clínica com equipe. |

---

## Antes de apontar isto para a internet

Checklist de implantação — nada aqui é código, tudo é configuração, e todos os
itens são obrigatórios:

- [ ] **`AUTH_SECRET`** definida, com 32+ caracteres aleatórios. Sem ela a
      aplicação recusa assinar sessão em produção — é o comportamento certo, e
      é uma falha de partida, não um aviso.
- [ ] **HTTPS obrigatório**, com redirecionamento de HTTP. O cookie de sessão
      só é `Secure` em produção, e `Secure` sem HTTPS significa "sem cookie".
- [ ] **Proxy reverso sobrescrevendo `x-forwarded-for`** (pendência 2).
- [ ] **`LLM_DATA_POLICY="contractual"`** — é o padrão; confirmar que ninguém
      trocou para `training`, que aceita fornecedor que treina com os prompts.
- [ ] **`AUDIO_RETENTION_DAYS`** com valor não negativo. Negativo desliga a
      retenção, e isso existe só para desenvolvimento.
- [ ] **Backup do banco**, com restauração testada. Exclusão de conta é
      imediata e sem desfazer — o backup é a única rede.
- [ ] **Criptografia em repouso** no volume do banco e no do áudio.
- [ ] **`SUPABASE_SERVICE_ROLE_KEY` fora da aplicação web.** Ela ignora todas
      as políticas RLS.
- [ ] **A lista de subprocessadores** na política de privacidade conferida
      contra o que a instalação realmente usa — ver `docs/PRIVACIDADE.md`.

---

## Como manter isto vivo

Esta revisão vale para o estado de hoje. O que a mantém útil:

- `pnpm check` e `pnpm db:test-rls` a cada PR, no CI. Os testes de RLS são a
  parte automatizada desta revisão.
- Tabela nova com dado de paciente ⇒ **política RLS + asserção no
  `test-rls.sql`**, no mesmo PR. É a regra nº 3 do README.
- Rota nova que entrega dado clínico ⇒ auditoria e, se custar dinheiro ou
  abrir porta, limite de taxa.
- Mudou o que o produto faz com os dados ⇒ mudou a política de privacidade, e
  a data de vigência junto.

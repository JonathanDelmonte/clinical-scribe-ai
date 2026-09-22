# ADR-0004 — Autenticação: senha própria agora, Supabase Auth atrás de uma costura

> Status: **aceito e implementado** (provedor `password`) · 22/09/2026
> Contexto: Marco 5, primeiro item. Ver [PLANO-TRILHA-B.md](../PLANO-TRILHA-B.md).

---

## O que havia antes

`apps/web/src/lib/auth.ts` lia um cookie com o `auth_user_id` do profissional.
Sem senha, sem assinatura, sem validade. Um seletor no cabeçalho trocava de
usuário, e digitar o UUID de outra pessoa no cookie dava acesso completo ao
prontuário dela.

Isso foi uma decisão consciente e correta do Marco 2: fechar o esqueleto
andante sem esperar provisionar um projeto de Auth. O comentário no arquivo
dizia o que era e quando trocar.

O prazo chegou. Quota por profissional, trilha de auditoria e exclusão de conta
são três recursos que respondem "quem" — e "quem" não pode ser um campo que o
próprio usuário edita.

## O que o plano de desenvolvimento manda fazer

> **Supabase, região São Paulo (`sa-east-1`)** — ver ADR-0001. Banco, Auth e
> Storage numa escolha só.

A decisão segue certa para produção, e nada aqui a contradiz.

## O problema de implementá-la hoje

Dois custos concretos, os dois sobre o trabalho de outras pessoas:

1. **A partida de todo mundo passaria a exigir um projeto provisionado.** Hoje
   `pnpm install && pnpm db:up && pnpm dev` sobe a aplicação inteira, e o
   `atalhos/iniciar.bat` faz isso com dois cliques. Um login que fala com o
   Auth do Supabase quebra isso para quem trabalha na Trilha A — que não tem
   nada a ver com autenticação e ficaria bloqueado por ela.

2. **Não é possível testar contra o que não se pode subir.** Este repositório
   já tem uma regra sobre isso, escrita no ADR-0002: *não decidir por leitura
   de site, decidir por medição*. Código de integração escrito contra uma API
   nunca chamada é rascunho com aparência de implementação — e a aparência é o
   problema, porque ninguém revisa duas vezes o que parece pronto.

## A decisão

**Construir a costura, e por ela passar um provedor só.**

O próprio arquivo que foi substituído já dizia onde a costura ficava:

> *"Quando o Auth real entrar, muda a origem do `authUserId` — o resto do
> código fica igual."*

Então é exatamente a origem do `authUserId` que virou uma peça trocável:

```
   /entrar · /cadastrar · /sair
             │
             ▼
   lib/auth/session.ts        cookie assinado (HMAC-SHA256), HttpOnly,
             │                SameSite=Lax, validade de 7 dias
             ▼
   lib/auth/accounts.ts       ┌── password  → scrypt, hash no próprio Postgres
   (provedor `password`)      └── supabase  → verifica o token do Auth  ⟵ falta
             │
             ▼
   currentAuthUserId()        contrato inalterado — tudo abaixo continua igual
```

`AUTH_PROVIDER=supabase` é **reconhecido e recusado**, com uma mensagem que
aponta para este documento. Um `if` que ninguém executou seria pior do que um
"ainda não" dito em voz alta.

### O que falta para o provedor `supabase`

Pequeno de propósito. Quando houver projeto em `sa-east-1`:

1. Verificar o token de acesso com `supabase.auth.getUser(token)` —
   `@supabase/supabase-js` já é dependência da aplicação, não entra pacote novo.
2. Mapear `user.id` para `professionals.auth_user_id`. A coluna já existe e já
   é um UUID; foi desenhada como chave lógica para `auth.users` desde o
   Marco 0.
3. `professionals.password_hash` fica nulo nessas contas. `autenticar()` já
   trata hash ausente como "não confere", então uma conta do Supabase não
   consegue entrar pelo caminho de senha nem por engano.
4. Trocar as telas `/entrar` e `/cadastrar` pelo fluxo do Supabase.

Nada disso toca em rota de API, página de paciente, consulta ou política RLS.

## As escolhas menores, e o que cada uma custa

| Escolha | Por quê | O que custa |
|---|---|---|
| **scrypt** (`node:crypto`) | Memory-hard, recomendado pelo OWASP, e sem dependência nativa. bcrypt e argon2 compilam binário na instalação e quebram a cada troca de versão do Node. | Não é a derivação mais moderna que existe. É a mais moderna que não cobra uma toolchain de compilação no CI e no contêiner. |
| **Parâmetros dentro do hash** (`scrypt$16384$8$1$…`) | Subir o custo no futuro não invalida os hashes antigos. | Nada. |
| **Sessão em cookie assinado**, sem tabela | Zero consulta ao banco por requisição, zero infra nova. | **Não há revogação imediata.** Um token roubado vale até expirar; sair apaga o cookie do navegador e nada mais. Mitigado pela validade de 7 dias. Quando houver motivo — um painel de "encerrar sessões", um suporte que precise derrubar acesso —, é uma tabela e uma checagem. |
| **`exp` e `sub` e mais nada no token** | Cargo e plano mudam; token é fotografia. Autorização decidida por fotografia é autorização defasada. | Uma consulta ao banco por requisição para saber cargo e plano — que já acontecia. |
| **`proxy.ts` confere, mas não decide** | Redireciona cedo quem não entrou, sem piscar tela. | A conferência acontece duas vezes. Se divergirem, a de `lib/auth.ts` é a que vale — e é a que roda perto do dado. |
| **Uma mensagem só para "e-mail não existe" e "senha errada"**, com o mesmo tempo de resposta | A lista de quem tem conta num escriba clínico já é informação sobre a pessoa. | Um usuário que errou o e-mail não é avisado disso. |

## A consulta que ignora o isolamento

Encontrar uma conta pelo e-mail acontece **antes** de existir identidade para
filtrar — `auth.professional_id()` resolve a partir de quem já entrou. É o ovo
e a galinha do login, e não tem saída elegante.

A saída adotada: `lib/auth/accounts.ts` abre uma transação com
`set local role service_role` e faz **uma** consulta, de três colunas, por
e-mail. As alternativas eram piores:

- Uma função `SECURITY DEFINER` que devolvesse o hash a qualquer usuário
  autenticado exporia o hash de todo mundo a quem já tem conta.
- A aplicação web carregar credencial de serviço para tudo trocaria "pode
  escrever a própria auditoria" por "pode ler os dados de todo mundo".

Com `AUTH_PROVIDER=supabase`, esse trecho deixa de ser chamado: quem procura a
conta é o Auth do Supabase, num serviço separado.

## O que foi removido junto

`UserSwitcher` e `/api/dev-user`. Um seletor de usuário sem senha convivendo
com um login com senha é pior que qualquer um dos dois sozinho: a porta dos
fundos continua aberta e agora está escondida atrás de uma porta trancada.

Em troca, `pnpm db:seed` passa a criar as duas contas de desenvolvimento **com
senha** — a mesma para as duas, impressa no fim do comando. Os UUIDs continuam
fixos, porque `pnpm db:demo` (Trilha A) procura a Ana por um deles.

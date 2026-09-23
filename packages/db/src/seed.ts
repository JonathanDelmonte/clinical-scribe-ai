/**
 * Popula o banco local com dois profissionais de desenvolvimento.
 *
 * Dois, e não um, de propósito: eles diferem no CARGO, e isso torna visível na
 * interface a regra que `resolveEngine()` implementa. Entrando com um e com o
 * outro você vê o motor mudar — e vê o pedido de motor ser descartado para
 * quem não pode escolher. Uma regra de negócio que você consegue observar é
 * uma regra que você confia.
 *
 *     pnpm db:seed
 *
 * Idempotente: pode rodar quantas vezes quiser.
 *
 * ## Por que estas contas têm senha de verdade
 *
 * Até o Marco 5, trocar de profissional era escolher num seletor, sem senha.
 * Agora existe login, e o seed precisa produzir contas nas quais se consiga
 * ENTRAR — senão o caminho para desenvolver seria criar uma conta nova a cada
 * banco recriado, e o `pnpm db:demo` da Trilha A, que procura estes UUIDs
 * fixos, passaria a apontar para uma conta que ninguém usa.
 *
 * A senha é pública e está impressa aqui embaixo. Isso é seguro porque estas
 * contas só existem em banco de desenvolvimento — e é por isso que o e-mail
 * delas termina em `.local`, um domínio que não resolve em lugar nenhum.
 */

import { sql } from "drizzle-orm";

import { hashPassword } from "@scribe/auth";

import { createServiceClient } from "./client";

const url = process.env["DATABASE_URL"];
if (url === undefined || url === "") {
  console.error("DATABASE_URL não definida — copie .env.example para .env");
  process.exit(1);
}

/**
 * A senha das duas contas de desenvolvimento.
 *
 * Uma só, e conhecida, porque o objetivo aqui é entrar rápido — não simular
 * segredo. Trocá-la não protege nada: quem tem acesso ao banco local já tem
 * acesso ao banco local.
 */
export const DEV_PASSWORD = "consulta-viva-dev";

/**
 * IDs fixos para que o seed seja idempotente — e porque `pnpm db:demo`
 * (Trilha A) procura a Ana por este UUID. Mudá-lo quebra a consulta de
 * exemplo, que é a peça que permite trabalhar na interface sem GPU.
 */
export const DEV_USERS = [
  {
    authUserId: "aaaaaaaa-0000-4000-8000-000000000001",
    email: "ana@consultaviva.local",
    name: "Dra. Ana Ribeiro",
    specialty: "nutrição",
    registry: "CRN-3 12345",
    role: "developer",
    plan: "free",
  },
] as const;

/**
 * Uma conta só, e `developer`.
 *
 * Antes eram duas: a Ana como `professional` e uma `Dev Local` como
 * `developer`, para que a diferença entre os cargos ficasse VISÍVEL trocando
 * de usuário. Isso fazia sentido enquanto havia um seletor de usuário no topo
 * da tela; com login de verdade, trocar de cargo virou sair e entrar de novo,
 * e a segunda conta passou a ser só mais uma senha para lembrar.
 *
 * O cargo `developer` foi para a Ana junto: é ele que libera a escolha do
 * motor em cada sessão, e perder isso ao apagar a segunda conta seria perder
 * um recurso sem ter pedido.
 *
 * O que se perde: não dá mais para ver, lado a lado, o motor sendo decidido
 * pelo plano em vez de pela escolha. Quem precisar disso muda o cargo da Ana
 * para `professional` aqui e roda o seed de novo.
 */

const db = createServiceClient(url);

try {
  for (const u of DEV_USERS) {
    // Um hash por usuário, e não um compartilhado: o sal é por conta, e um
    // seed que gravasse o mesmo hash nas duas contradiria, no próprio banco de
    // desenvolvimento, a propriedade que o teste de `password.ts` garante.
    const passwordHash = await hashPassword(DEV_PASSWORD);

    await db.execute(sql`
      insert into professionals
        (auth_user_id, email, password_hash, onboarded_at,
         name, specialty, professional_registry, role, plan)
      values
        (${u.authUserId}, ${u.email}, ${passwordHash}, now(),
         ${u.name}, ${u.specialty}, ${u.registry},
         ${u.role}::user_role, ${u.plan}::plan)
      on conflict (auth_user_id) do update
        set email = excluded.email,
            password_hash = excluded.password_hash,
            onboarded_at = coalesce(professionals.onboarded_at, excluded.onboarded_at),
            name = excluded.name,
            specialty = excluded.specialty,
            role = excluded.role,
            plan = excluded.plan
    `);
    console.log(`  ✓ ${u.name}  (${u.role} · plano ${u.plan})  ${u.email}`);
  }

  // Um paciente de exemplo para a Ana, para a tela não abrir vazia.
  await db.execute(sql`
    insert into patients (professional_id, name, birth_date)
    select id, 'Paciente de Exemplo', date '1985-04-12'
      from professionals
     where auth_user_id = ${DEV_USERS[0].authUserId}
       and not exists (
         select 1 from patients p
          where p.professional_id = professionals.id
            and p.name = 'Paciente de Exemplo'
       )
  `);

  console.log("");
  console.log(`✓ seed aplicado — entre em /entrar com a senha: ${DEV_PASSWORD}`);
} catch (error) {
  console.error("✗ falha no seed:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  process.exit(0);
}

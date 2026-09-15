/**
 * Popula o banco local com dois profissionais de desenvolvimento.
 *
 * Dois, e não um, de propósito: eles diferem no CARGO, e isso torna visível na
 * interface a regra que `resolveEngine()` implementa. Trocando de usuário você
 * vê o motor mudar — e vê o pedido de motor ser descartado para quem não pode
 * escolher. Uma regra de negócio que você consegue observar é uma regra que
 * você confia.
 *
 *     pnpm db:seed
 *
 * Idempotente: pode rodar quantas vezes quiser.
 */

import { sql } from "drizzle-orm";

import { createServiceClient } from "./client";

const url = process.env["DATABASE_URL"];
if (url === undefined || url === "") {
  console.error("DATABASE_URL não definida — copie .env.example para .env");
  process.exit(1);
}

/** IDs fixos para que o seed seja idempotente e o cookie de dev não quebre. */
export const DEV_USERS = [
  {
    authUserId: "aaaaaaaa-0000-4000-8000-000000000001",
    name: "Dra. Ana Ribeiro",
    specialty: "nutrição",
    registry: "CRN-3 12345",
    role: "professional",
    plan: "free",
  },
  {
    authUserId: "dddddddd-0000-4000-8000-000000000002",
    name: "Dev Local",
    specialty: "desenvolvimento",
    registry: null,
    role: "developer",
    plan: "free",
  },
] as const;

const db = createServiceClient(url);

try {
  for (const u of DEV_USERS) {
    await db.execute(sql`
      insert into professionals
        (auth_user_id, name, specialty, professional_registry, role, plan)
      values
        (${u.authUserId}, ${u.name}, ${u.specialty}, ${u.registry},
         ${u.role}::user_role, ${u.plan}::plan)
      on conflict (auth_user_id) do update
        set name = excluded.name,
            specialty = excluded.specialty,
            role = excluded.role,
            plan = excluded.plan
    `);
    console.log(`  ✓ ${u.name}  (${u.role} · plano ${u.plan})`);
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

  console.log("✓ seed aplicado");
} catch (error) {
  console.error("✗ falha no seed:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  process.exit(0);
}

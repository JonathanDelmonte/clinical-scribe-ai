import { professionals } from "@scribe/db";
import { professionalFileKey } from "@scribe/storage";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { ACOES, auditar } from "@/lib/audit";
import { asCurrentProfessional } from "@/lib/auth";
import { storage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Uma assinatura desenhada à mão cabe em muito menos que isto. */
const MAX_ASSINATURA_BYTES = 512 * 1024;

/** Os oito bytes que abrem todo arquivo PNG. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Salva o perfil — o onboarding e as edições posteriores.
 *
 * A mesma rota para os dois porque são a mesma operação: "estes são os meus
 * dados". `onboardedAt` só é gravado na primeira vez, e é o que distingue
 * "conta criada" de "pronta para atender" sem depender de adivinhar por campo
 * preenchido.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (form === null) {
    return NextResponse.json({ error: "envio inválido" }, { status: 400 });
  }

  const nome = String(form.get("nome") ?? "").trim();
  const especialidade = String(form.get("especialidade") ?? "").trim();
  const registro = String(form.get("registro") ?? "").trim();

  if (nome === "" || nome.length > 200) {
    return NextResponse.json({ error: "Informe seu nome." }, { status: 400 });
  }
  if (especialidade === "" || especialidade.length > 80) {
    return NextResponse.json({ error: "Escolha a especialidade." }, { status: 400 });
  }
  if (registro.length > 80) {
    return NextResponse.json({ error: "Registro longo demais." }, { status: 400 });
  }

  const assinatura = form.get("assinatura");

  const resultado = await asCurrentProfessional(async (tx, me) => {
    let signatureKey = me.signatureUrl;

    if (assinatura instanceof File && assinatura.size > 0) {
      if (assinatura.size > MAX_ASSINATURA_BYTES) {
        return { error: "Assinatura grande demais." } as const;
      }

      const bytes = new Uint8Array(await assinatura.arrayBuffer());

      /**
       * Confere os bytes, não o `content-type` declarado.
       *
       * O tipo vem do cliente e não custa nada mentir. Esta imagem é servida
       * de volta pela aplicação e embutida num PDF: aceitar qualquer conteúdo
       * com nome de PNG seria transformar o campo de assinatura em um lugar
       * para hospedar arquivo arbitrário sob o domínio do produto.
       */
      const assinaturaValida = PNG_MAGIC.every((b, i) => bytes[i] === b);
      if (!assinaturaValida) {
        return { error: "A assinatura precisa ser um PNG." } as const;
      }

      signatureKey = professionalFileKey(me.id, "assinatura.png");
      await storage.put(signatureKey, bytes);
    }

    const [atualizado] = await tx
      .update(professionals)
      .set({
        name: nome,
        specialty: especialidade,
        professionalRegistry: registro === "" ? null : registro,
        signatureUrl: signatureKey,
        onboardedAt: me.onboardedAt ?? new Date(),
      })
      .where(eq(professionals.id, me.id))
      .returning({ id: professionals.id });

    await auditar(tx, {
      acao: ACOES.perfilAtualizado,
      entidade: "professionals",
      entidadeId: me.id,
      metadados: {
        primeiraVez: me.onboardedAt === null,
        assinatura: signatureKey !== me.signatureUrl,
      },
    });

    return { ok: true, id: atualizado?.id } as const;
  });

  if (resultado === null) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  if ("error" in resultado) {
    return NextResponse.json({ error: resultado.error }, { status: 400 });
  }
  return NextResponse.json(resultado);
}

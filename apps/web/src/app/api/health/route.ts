import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Sonda de saúde.
 *
 * Reporta apenas QUAIS variáveis estão configuradas, nunca os valores — este
 * endpoint é público, e vazar a existência de uma chave é diferente de vazar
 * a chave.
 */
export function GET() {
  const configured = (name: string): boolean => {
    const value = process.env[name];
    return value !== undefined && value !== "";
  };

  return NextResponse.json({
    status: "ok",
    service: "@scribe/web",
    milestone: 0,
    timestamp: new Date().toISOString(),
    config: {
      database: configured("DATABASE_URL"),
      supabase: configured("NEXT_PUBLIC_SUPABASE_URL"),
      asrProvider: process.env["ASR_PROVIDER"] ?? null,
      llm: configured("ANTHROPIC_API_KEY"),
    },
  });
}

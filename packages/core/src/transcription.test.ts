import { describe, expect, it } from "vitest";

import type { RawSegment, TranscriptionResult } from "./transcription";
import { isUsableForRoleIdentification, speakerCount } from "./transcription";

function segment(overrides: Partial<RawSegment> = {}): RawSegment {
  return {
    startMs: 0,
    endMs: 1000,
    text: "texto",
    speakerLabel: "SPEAKER_00",
    confidence: 0.9,
    ...overrides,
  };
}

function result(overrides: Partial<TranscriptionResult> = {}): TranscriptionResult {
  return {
    engine: "local",
    model: "large-v3",
    language: "pt",
    durationMs: 60_000,
    processingMs: 5_000,
    realtimeFactor: 12,
    diarizationApplied: true,
    diarizationError: null,
    truncated: false,
    uncoveredMs: 0,
    speakers: ["SPEAKER_00", "SPEAKER_01"],
    segments: [
      segment({ speakerLabel: "SPEAKER_00" }),
      segment({ speakerLabel: "SPEAKER_01", startMs: 2000, endMs: 3000 }),
    ],
    ...overrides,
  };
}

describe("isUsableForRoleIdentification", () => {
  it("aceita transcrição completa com dois falantes", () => {
    expect(isUsableForRoleIdentification(result())).toEqual({ usable: true });
  });

  it("recusa áudio sem fala reconhecida", () => {
    const check = isUsableForRoleIdentification(result({ segments: [] }));
    expect(check.usable).toBe(false);
  });

  // A falha mais perigosa deste pipeline: o serviço responde com sucesso,
  // devolve texto coerente, e omite o final da consulta — onde costuma estar a
  // conduta. Se esta regra sumir numa refatoração, o produto volta a gerar
  // notas sem a prescrição, sem avisar ninguém.
  it("recusa transcrição truncada, mesmo com tudo o mais em ordem", () => {
    const check = isUsableForRoleIdentification(
      result({ truncated: true, uncoveredMs: 42_000 }),
    );
    expect(check.usable).toBe(false);
    if (!check.usable) {
      expect(check.reason).toContain("42s");
      expect(check.reason).toContain("incompleta");
    }
  });

  it("truncamento tem precedência sobre a falta de diarização", () => {
    // As duas falhas juntas: a mensagem precisa ser a do truncamento, que é a
    // mais grave — dado que falta é pior que dado sem rótulo.
    const check = isUsableForRoleIdentification(
      result({
        truncated: true,
        uncoveredMs: 30_000,
        diarizationApplied: false,
        diarizationError: "sem token",
      }),
    );
    expect(check.usable).toBe(false);
    if (!check.usable) expect(check.reason).toContain("incompleta");
  });

  it("recusa quando o motor não separou as vozes", () => {
    const check = isUsableForRoleIdentification(
      result({ diarizationApplied: false, diarizationError: "HF_TOKEN ausente" }),
    );
    expect(check.usable).toBe(false);
    if (!check.usable) expect(check.reason).toContain("HF_TOKEN");
  });

  it("recusa quando só um falante foi detectado", () => {
    const check = isUsableForRoleIdentification(
      result({
        segments: [segment(), segment({ startMs: 2000 })],
        speakers: ["SPEAKER_00"],
      }),
    );
    expect(check.usable).toBe(false);
    if (!check.usable) expect(check.reason).toContain("um falante");
  });
});

describe("speakerCount", () => {
  it("conta rótulos distintos, não trechos", () => {
    expect(speakerCount(result())).toBe(2);
  });

  it("conta 1 quando a diarização não rodou", () => {
    expect(
      speakerCount(result({ segments: [segment(), segment({ startMs: 2000 })] })),
    ).toBe(1);
  });
});

# Design — conceito "Respiro"

> **Status:** conceito para aprovação · 29/09/2026 · nenhuma tela do código mudou ainda
> **Protótipo navegável:** [canvas "Consulta Viva — Conceito"](https://claude.ai/artifact/9oUpFoYkXSKS6xRXWH9VJ6) (privado até ser compartilhado pelo menu *Share*)

Este documento guarda as decisões do conceito visual, para que a aplicação no
código siga uma régua só. O protótipo mostra; este arquivo explica e dá os
números.

---

## A ideia em uma frase

Em design, **respiro** é o espaço vazio que deixa a tela respirar. Aqui a
palavra vira três coisas ao mesmo tempo:

1. **A calma da tela** — muito espaço, pouca informação, uma ação por vez.
2. **A IA que respira** — a Viva tem um corpo, o *Orbe*, que respira devagar
   quando está em repouso e reage quando ouve, pensa e fala.
3. **A promessa do produto** — o profissional volta a olhar para o paciente.
   Na tela de entrada: *"Olhe para o paciente. A gente escreve."*

Premium pela calma; artístico pelos detalhes. Vidro sobre luz, nenhuma palavra
a mais.

## Por que assim — a psicologia por trás

| Decisão | Motivo |
|---|---|
| Espaço em branco generoso | Estudos de percepção ligam espaço vazio a valor percebido e a luxo; a NN/g mede ganho de compreensão. |
| Uma ação principal por tela | *Fluência de processamento*: o que é fácil de processar parece mais bonito, mais familiar e menos arriscado. Tela carregada cansa a memória de trabalho e piora a impressão estética. |
| Base fria (azul-petróleo, menta, névoa) + um toque quente (pêssego) | Paletas frias passam confiança e calma em saúde; o quente acolhe e marca o humano (a voz do paciente). |
| Vidro com contraste garantido | O risco do vidro é o texto ilegível. Regra: texto ≥ 4,5:1, borda de 1 px sempre, nada "movimentado" atrás de texto. |
| Serifa nos momentos humanos, sans no resto | Serifa comunica autoridade e atemporalidade; em itálico, calor. A sans cuida de tudo o que se lê e se toca. |
| Estados sempre em palavras | "Pronta para revisar" é entendido por qualquer pessoa; um ícone sozinho, não. |

## As regras que mantêm o premium

1. **Uma ação principal por tela** — sempre o botão escuro (Tinta) com o
   círculo de menta. Tudo o mais é vidro ou texto.
2. **No máximo três blocos de informação por tela** no computador, dois no
   celular.
3. **Nada de jargão na tela.** "cargo professional · plano free · motor local"
   sai da tela inicial; plano e uso vão para a navegação e para *Uso e plano*.
4. **A IA só aparece onde está trabalhando.** O Orbe grande é reservado à
   consulta ao vivo, à Viva e ao cartão "Pronta para ouvir".
5. **Movimento lento e com propósito** — respiração de 6,5 s, uma entrada
   orquestrada por tela. Tudo desliga com *reduzir movimento* do sistema.
6. **Toque ≥ 44 px**, sempre `<button>`, `<a>` e `<label>` de verdade.

## Cor

| Nome | Valor | Uso |
|---|---|---|
| Pérola | `#F2F5F6` | fundo |
| Tinta | `#0F1B24` | texto principal e a ação principal |
| Grafite | `#445561` | texto secundário |
| Névoa | `#5B6B77` | legendas (≥ 4,5:1 sobre o vidro) |
| Viva | `#2BB5AC` · texto `#0B7B7A` | a IA, o foco, a voz do profissional |
| Pêssego | `#F09A72` · texto `#A4532B` | a voz do paciente, o acolhimento |
| Lavanda | `#BBB2FF` | a luz da IA "pensando" |
| Menta luminosa | `#A8EEE2` | só o círculo de ícone da ação principal |

**Estados** (fundo · texto · ponto):

| Estado do sistema | Na tela | Cores |
|---|---|---|
| `recording` | Gravando | `#FFE3DC` · `#A8321C` · `#EE5A3C` (pisca) |
| `uploaded` | Na fila | `#E9E6FF` · `#4A3FB0` |
| `transcribing` | Ouvindo a gravação | `#E9E6FF` · `#4A3FB0` (brilho passando) |
| `generating` | Escrevendo a nota | `#E9E6FF` · `#4A3FB0` (brilho passando) |
| `ready_for_review` | Pronta para revisar | `#FFF0D1` · `#7A5200` · `#E9A21F` |
| `approved` | Aprovada | `#DAF4E6` · `#17603E` + ✓ |
| `failed` | Algo deu errado | `#FDE2E7` · `#A61B3F` |

**Atmosfera ("luz do dia").** O fundo são 3–4 manchas de luz desfocadas e um
grão de 8 % por cima. A luz muda com a hora: manhã puxa para o pêssego, tarde
para o turquesa, noite para a lavanda — e a saudação acompanha ("Bom dia",
"Boa tarde", "Boa noite"). Continua sendo tema claro; um modo escuro fica para
depois da aprovação.

## Tipografia

- **Instrument Serif** — títulos e momentos humanos: saudação, nomes, o
  cronômetro da consulta. Itálico para o toque pessoal (*Ana*, *Viva*).
- **Instrument Sans** — interface, textos, números.
- Escala: 80 · 52 · 32 · 24 · 16 · 13 px. Corpo em 15–16 px, legenda em 12,5–13 px.

## Vidro — dois acabamentos, nunca mais

```css
/* Fosco — painéis, cartões, navegação */
background: linear-gradient(160deg, rgba(255,255,255,.80), rgba(255,255,255,.50));
backdrop-filter: blur(26px) saturate(1.5);
border: 1px solid rgba(255,255,255,.85);
box-shadow: inset 0 1px 0 rgba(255,255,255,.95),
            0 1px 1px rgba(15,27,36,.03),
            0 22px 44px -26px rgba(22,52,70,.30);
border-radius: 28px;

/* Polido — botões secundários, fichas, item ativo, barra da Viva */
background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(255,255,255,.66));
border: 1px solid rgba(255,255,255,.95);
box-shadow: inset 0 1px 0 #fff, 0 10px 22px -14px rgba(22,52,70,.45);
border-radius: 999px;
```

Raios: 28–32 px painéis, 20 px linhas de lista, 16 px campos, pílula para
botões.

## As três assinaturas

**O Orbe.** Esfera de vidro com luz iridescente por dentro, feita só com CSS
(gradientes radial e cônico, sem imagem). Cinco estados: *em repouso* (respira),
*ouvindo* (ondas a cada fala), *pensando* (a luz gira mais rápido), *falando*
(pulsa com a voz), *pausado* (perde a cor). É o rosto da Viva.

**A Linha Viva.** Uma linha só que começa como batimento, vira onda de voz e
termina em escrita cursiva: a consulta virando texto. Aparece na entrada, em
estados vazios e enquanto a nota é escrita — nunca em tela de trabalho.

**A Hélice da conversa.** Cada consulta ganha uma assinatura visual: duas fitas
entrelaçadas, uma turquesa (você) e uma pêssego (paciente), que engrossam quando
aquela pessoa fala. As contas no meio são os momentos citados pela nota. Na
revisão, tocar numa frase marca o ponto exato na hélice. **Não precisa de dado
novo:** `transcript_segments` já guarda `role`, `start_ms` e `end_ms`, e as
citações da nota já apontam para os trechos.

## Navegação

- **Computador:** barra lateral de vidro flutuante — *Nova consulta* (ação
  principal), **Início**, **Pacientes**, **Viva** (IA); depois *Uso e plano* e
  *Ajustes*; no pé, os minutos do plano, o perfil e o selo "Seus dados não
  treinam nenhuma IA".
- **Celular:** barra inferior com o botão de gravar no centro, porque a consulta
  é gravada no celular, muitas vezes com o aparelho na mesa.
- **Barra da Viva:** no rodapé do Início, "Pergunte à Viva" leva direto ao
  assistente, digitando ou falando.

## As telas e o que elas mudam no código

| Tela do conceito | Hoje | O que muda |
|---|---|---|
| Entrar / Criar conta | `/entrar`, `/cadastrar` (`AuthForm`) | Uma tela com duas abas, arte à esquerda, cartão de vidro à direita. |
| Início | `/` lista pacientes | Vira o painel: saudação, "Pronta para ouvir", "Para revisar", vistos por último, barra da Viva. |
| Pacientes | `/` + `/pacientes/[id]` | Lista e pasta lado a lado (busca, filtros "Para revisar" e "Sem consulta"). No celular, a pasta abre por cima da lista. |
| Consulta ao vivo | `SessionRecorder` dentro da página do paciente | Modo foco em tela cheia: Orbe, cronômetro, quem está falando, rascunho ao vivo (`LiveDraft`), documentos extras (`SessionObjectives`), ciência da gravação antes de começar. |
| Revisão da nota | `/sessoes/[id]` (`SessionView`, `ClinicalNote`) | Hélice no topo; nota e conversa lado a lado; frase sem fonte bloqueia a aprovação até ser removida ou confirmada — a mesma regra de `checkApproval`, agora visível. |
| Viva | não existe | Tela nova, texto e voz. **Depende de backend:** o assistente sobre o histórico (RAG, §6.3-A da documentação; a coluna `embedding` ainda está comentada no schema). |
| Uso e plano, Ajustes | `/uso`, `/configuracoes` | Mesmas peças (vidro, fichas, botões); sem tela própria no conceito. |

## Ordem sugerida para aplicar

1. **Base:** tokens no `@theme` do `globals.css`, fontes com `next/font`,
   peças comuns (vidro, botão, ficha de estado, avatar, Orbe).
2. **Casca:** layout com a barra lateral e a barra inferior do celular.
3. **Telas:** Entrar → Início → Pacientes → Consulta ao vivo → Revisão →
   Uso e Ajustes.
4. **Viva:** quando o assistente existir no backend; até lá, o item pode ficar
   escondido ou como "em breve".

## Fontes

- Pracejus, Olsen & O'Guinn — espaço em branco e valor percebido (*Journal of Consumer Research*), via [Flaredot — The Psychology of Luxury Web Design](https://flaredot.com/the-psychology-of-luxury-web-design/)
- [Evoke Studio — What makes a website look expensive](https://madebyevoke.com/blog/what-makes-a-website-look-expensive)
- [Techelix — Editorial UI: typography and whitespace for luxury brands](https://studio.techelix.co/the-art-of-editorial-ui-leveraging-typography-and-whitespace-for-luxury-brands-ui/)
- [CHI 2023 — Processing fluency and the aesthetic-usability effect](https://dl.acm.org/doi/10.1145/3544549.3585739)
- [The Design Journal (2026) — Colour psychology in UI and UX design](https://www.tandfonline.com/doi/abs/10.1080/14606925.2026.2663037)
- [UXmatters — Psychology of color in health and wellness apps](https://www.uxmatters.com/mt/archives/2024/07/leveraging-the-psychology-of-color-in-ux-design-for-health-and-wellness-apps.php)
- [NN/g — Glassmorphism: definition and best practices](https://www.nngroup.com/articles/glassmorphism/)
- [Axess Lab — Glassmorphism meets accessibility](https://axesslab.com/glassmorphism-meets-accessibility-can-frosted-glass-be-inclusive/)

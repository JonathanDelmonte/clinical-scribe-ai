# Medições do motor — para repetir

Scripts das duas medições que **desligaram** recursos do motor: o vocabulário do
domínio e a limpeza de áudio. Os números e a decisão estão no
[ADR-0002](../../docs/adr/0002-fornecedor-asr.md); aqui fica como reproduzi-los.

Existem porque as duas conclusões dependem da versão do modelo. Um Whisper ou um
pyannote novo pode mudar o resultado — e repetir a medição precisa ser rodar dois
comandos, não reconstruir o raciocínio.

**Nenhum áudio fica aqui.** O `.gitignore` bloqueia `*.mp3` e `*.wav`, e os
scripts leem a consulta de onde ela estiver no disco.

---

## A regra que as duas medições ensinaram

**Toda comparação precisa de um controle, antes de qualquer conclusão.**

Nas duas, a primeira métrica mentiu:

| Medição | O que a métrica sem controle disse | O que o controle mostrou |
|---|---|---|
| Vocabulário | "zero alucinações" | inventou "xarope", "emagrecimento" ×4 e um sintoma — só não os termos *da lista* |
| Limpeza branda | "+20% de separação entre as vozes" | 0% — o ganho vinha do pyannote ter reagrupado as falas, não de vozes mais nítidas |

O controle de cada uma:

- **Vocabulário:** transcrever a mesma consulta duas vezes **sem** vocabulário.
  Deu 1.000 de semelhança — então toda diferença com vocabulário é do vocabulário.
- **Limpeza:** fixar a divisão de falantes do áudio cru e trocar só o áudio de
  onde sai a impressão vocal. Separa "vozes mais nítidas" de "falas agrupadas de
  outro jeito".

---

## Vocabulário do domínio

Roda do lado de fora, contra o serviço no ar (`http://localhost:8001`).

```bash
python medir_vocabulario.py caminho/da/consulta.mp3   # 3 rodadas: sem, clínica, nutrição
python comparar.py                                     # o que mudou, e o que foi inventado
```

`medir_vocabulario.py` espera um `vocab.json` ao lado, com as chaves `clinica` e
`nutricao` — o texto que `montarVocabulario()` produz para cada especialidade.

Para o controle, rode a rodada sem vocabulário **duas vezes** e compare as duas.

## Limpeza de áudio

Roda **dentro** do container do motor, importando as funções do próprio serviço
— então mede o caminho de produção — mas em processo separado, sem tocar no
serviço em execução.

```bash
# instala os limpadores numa pasta à parte, sem mexer no torch do pyannote
docker exec scribe-asr-local pip install --target /tmp/df --no-deps deepfilternet deepfilterlib loguru appdirs
docker exec scribe-asr-local pip install --target /tmp/nr --no-deps noisereduce

# limpa: a neural com a GPU ESCONDIDA (ver abaixo), a branda direto
docker exec -e PYTHONPATH=/tmp/df -e CUDA_VISIBLE_DEVICES= scribe-asr-local python3 /tmp/limpar.py        /tmp/consulta.mp3 /tmp/limpo.npy
docker exec -e PYTHONPATH=/tmp/nr                          scribe-asr-local python3 /tmp/limpar_brando.py /tmp/consulta.mp3 /tmp/brando.npy

# mede: diarização e impressão vocal, cru contra limpo
docker exec scribe-asr-local python3 /tmp/medir_limpeza.py    /tmp/consulta.mp3 /tmp/trechos.json /tmp/limpeza.json /tmp/limpo.npy
docker exec scribe-asr-local python3 /tmp/margem_controlada.py
```

`trechos.json` é uma transcrição feita **sem** diarização (a rodada A do
vocabulário serve). O Whisper não roda de novo: a limpeza só iria para o caminho
das vozes, então o texto é o mesmo nas duas condições.

**Apague as cópias do áudio do `/tmp` do container ao terminar.**

### Três armadilhas do DeepFilterNet, para não redescobrir

1. **Quebra sem `git` instalado.** Ele lê o hash do commit para escrever no log e
   só trata "git falhou", não "git não existe". Os scripts neutralizam
   `df.utils.get_git_root`.
2. **Na GPU, recusa a consulta inteira** (`CUDNN_STATUS_NOT_SUPPORTED` no GRU):
   onze minutos a 48 kHz é uma sequência longa demais. E pedir CPU não basta — a
   biblioteca guarda a escolha de dispositivo em mais de um módulo. Por isso a
   limpeza roda em processo separado com `CUDA_VISIBLE_DEVICES` vazio. Na CPU,
   11 minutos saem em ~28 s.
3. **Importa `torchaudio.backend.common`**, removido nas versões novas. O
   torchaudio 2.5.1 ainda mantém um atalho e só avisa; uma versão futura quebra.

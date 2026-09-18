---
name: TTS local do bot
description: Estratégia de síntese local em português do Brasil sem API ou cota.
---

O bot usa Piper localmente com o modelo `dii_pt-BR.onnx`, uma voz feminina brasileira, gera WAV e converte para MP3 antes de enviar a resposta ao Discord.

**Why:** O XTTS-v2 exigia PyTorch, Coqui, ambiente Python separado e amostra de voz; Piper entrega fala neural mais natural com uma instalação menor e sem API ou limite por caracteres. O catálogo padrão não tinha uma voz feminina brasileira adequada; Dii atende essa necessidade, mas tem licença CC BY-NC-ND 4.0.

**Como aplicar:** Instale `piper-tts` no ambiente virtual do deploy, baixe o modelo Dii e a configuração JSON durante o build e aponte `PIPER_MODEL_PATH` apenas se usar outro arquivo. Preserve o fallback textual da IA se a síntese falhar. O uso do modelo Dii deve respeitar a licença e a atribuição à TigreGotico Lda.

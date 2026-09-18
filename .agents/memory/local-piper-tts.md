---
name: TTS local do bot
description: Estratégia de síntese local em português do Brasil sem API ou cota.
---

O bot usa Piper localmente com a voz neural brasileira `pt_BR-faber-medium`, gera WAV e converte para MP3 antes de enviar a resposta ao Discord.

**Why:** O XTTS-v2 exigia PyTorch, Coqui, ambiente Python separado e amostra de voz; Piper entrega fala neural mais natural com uma instalação menor e sem API ou limite por caracteres.

**Como aplicar:** Instale `piper-tts` no ambiente virtual do deploy, baixe `pt_BR-faber-medium` durante o build e aponte `PIPER_MODEL_PATH` apenas se usar outro arquivo. Se a síntese falhar, preserve o fallback textual da IA em vez de tentar uma API com cota.

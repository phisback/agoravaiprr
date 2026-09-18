---
name: TTS local do bot
description: Estratégia de síntese local em português do Brasil sem API ou cota.
---

O bot usa `espeak-ng` localmente com a voz `pt-br`, gera WAV e converte para MP3 antes de enviar a resposta ao Discord.

**Why:** O XTTS-v2 exigia PyTorch, Coqui, ambiente Python separado, download de modelo e amostra de voz; `espeak-ng` elimina esses pontos de falha e não tem limite por caracteres.

**Como aplicar:** Mantenha `espeak-ng` instalado no build/runtime do Railway e use `VOICE_TTS_VOICE` e `VOICE_TTS_SPEED` apenas para ajustes opcionais. Se a síntese falhar, preserve o fallback textual da IA em vez de tentar uma API com cota.

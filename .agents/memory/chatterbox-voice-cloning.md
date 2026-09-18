---
name: Chatterbox V3 voice cloning
description: Decisões e limitações da síntese clonada usada nas respostas de voz do bot.
---

O motor principal deve ser o Chatterbox Multilingual V3, carregado em um worker Python persistente e isolado do processo Node. O áudio de referência é um trecho WAV mono de aproximadamente 12 segundos. Edge TTS é o único fallback permitido para preservar disponibilidade quando o modelo local falhar ou exceder o limite de tempo.

**Why:** O sistema anterior usava uma voz genérica e não atendia à clonagem da voz fornecida. O pacote publicado no PyPI não expõe a seleção V3; a implementação V3 precisa acompanhar uma revisão específica do repositório oficial.

**Como aplicar:** Preserve o worker separado, o cache local do Hugging Face e o fallback Edge. Não reintroduza Kokoro, XTTS ou Piper no fluxo de voz sem um pedido explícito.
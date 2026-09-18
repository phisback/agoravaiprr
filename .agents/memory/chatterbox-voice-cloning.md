---
name: Chatterbox V3 voice cloning
description: Decisões e limitações da síntese clonada usada nas respostas de voz do bot.
---

O motor de voz deve ser exclusivamente o Chatterbox Multilingual V3, carregado em um worker Python persistente e isolado do processo Node. O áudio de referência é um trecho WAV mono de aproximadamente 12 segundos. Falhas do Chatterbox devem ser expostas diretamente, sem fallback, para confirmar o comportamento real do sistema.

**Why:** O sistema anterior usava uma voz genérica e não atendia à clonagem da voz fornecida. O pacote publicado no PyPI não expõe a seleção V3; a implementação V3 precisa acompanhar uma revisão específica do repositório oficial. O fallback foi removido para não mascarar falhas da clonagem.

**Como aplicar:** Preserve o worker separado, use wheels CPU-only do PyTorch no Railway e mantenha o cache local do Hugging Face. Não reintroduza Edge TTS, Kokoro, XTTS ou Piper no fluxo de voz sem um pedido explícito.
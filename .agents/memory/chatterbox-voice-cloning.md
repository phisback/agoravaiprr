---
name: Cartesia voice synthesis
description: Decisões e configuração da síntese de voz usada nas respostas de voz do bot.
---

O motor de voz atual é a API de Text-to-Speech da Cartesia, chamada diretamente pelo processo Node e retornando MP3 para o Discord. A chave fica em `CARTESIA_API_KEY`; modelo, idioma, voz e timeout podem ser ajustados por variáveis `CARTESIA_*`. O ID padrão é uma voz pública compatível com português brasileiro, mas uma voz própria deve ser configurada por `CARTESIA_VOICE_ID`.

**Why:** O Chatterbox exigia um worker Python pesado, cache de modelo e áudio local de referência, enquanto a Cartesia fornece síntese gerenciada por API e elimina essa infraestrutura do caminho de produção.

**Como aplicar:** Mantenha a síntese via Cartesia e não reintroduza Chatterbox, Edge TTS, Kokoro, XTTS ou Piper sem um pedido explícito. Para pausar as menções de voz, use `VOICE_AI_MENTIONS_ENABLED=false`; para desligar a síntese, use `VOICE_TTS_DISABLED=true`.
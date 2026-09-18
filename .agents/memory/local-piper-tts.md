---
name: TTS do bot
description: Estratégia de síntese em português do Brasil sem API pública ou cota de fornecedor.
---

O bot usa Kokoro-ONNX localmente com a voz feminina brasileira `pf_dora`, gera WAV e converte para MP3 antes de enviar a resposta ao Discord. O runtime fica em um worker Python persistente acionado pelo processo Node.

**Why:** O Piper/Dii ainda soava robotizado para o usuário. Kokoro oferece uma voz brasileira mais natural e expressiva, com pesos Apache 2.0, sem depender de um serviço público sujeito a 403, quota ou cobrança.

**Como aplicar:** Instale `kokoro-onnx` no ambiente virtual do deploy, baixe `kokoro-v1.0.onnx` e `voices-v1.0.bin` durante o build e use a voz `pf_dora` com `lang=pt-br`. Preserve o fallback textual da IA se a síntese falhar.

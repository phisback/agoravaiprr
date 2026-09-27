---
name: Templates PNG da economia
description: Compatibilidade dos templates visuais de cards com o carregador de imagens do bot.
---

Templates PNG exportados com metadados C2PA podem ser rejeitados pelo `@napi-rs/canvas` como “Invalid SVG image”, apesar de serem PNGs válidos para ferramentas comuns.

**Why:** o carregador usado pelo bot não processa corretamente esse tipo de chunk/metadado e cai no fundo de fallback, fazendo o card aparecer quase todo preto.

**How to apply:** ao receber um PNG gerado por ferramenta de imagem para um card do bot, remova os metadados e regrave o PNG antes de colocá-lo em `discord-bot/assets`; valide também com `loadImage` e uma renderização real.
---
name: Uploads opcionais em modais Discord
description: Regra para campos FileUpload opcionais em modais Discord.js.
---

Um FileUpload opcional deve aceitar zero arquivos (`minValues(0)`) e ser lido com `getUploadedFiles(customId, false)` ou sem o segundo argumento. Usar `minValues(1)` ou `required=true` faz o envio sem arquivo falhar antes de o handler responder.

**Why:** O Discord pode exibir apenas “Something went wrong” quando o parser lança uma exceção por campo ausente, ocultando a causa real do bot.

**How to apply:** Ao criar ou revisar modais com upload opcional, mantenha a configuração visual e a leitura do campo opcionais em conjunto.
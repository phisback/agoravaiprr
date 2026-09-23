---
name: Discord Components V2 message edits
description: Mensagens com Components V2 não podem voltar a payloads legados durante a navegação de um painel.
---

Mensagens do Discord marcadas com `MessageFlags.IsComponentsV2` precisam continuar usando payloads V2 em todas as edições da mesma navegação; não misture `content`/componentes legados depois que o painel foi criado.

**Why:** O Discord rejeita a troca de uma mensagem V2 para o formato legado, e a interação aparece para o usuário como se o botão ou menu não tivesse feito nada.

**How to apply:** Quando um painel usa `ContainerBuilder` ou `MediaGalleryBuilder`, mantenha `flags: MessageFlags.IsComponentsV2`, `content: null` e componentes V2 também nas telas de detalhe, retorno, paginação e confirmação.
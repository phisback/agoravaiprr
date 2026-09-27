---
name: Crash and penalty card templates
description: Regras visuais para atualizar os templates PNG dos jogos sem deixar valores de exemplo na arte final
---

Os templates de Crash e Pênaltis são artes completas com valores de exemplo já impressos. Toda alteração de estado precisa limpar as regiões dinâmicas antes de redesenhar os valores atuais, preservando molduras e ícones fixos.

**Why:** Uma primeira composição que apenas desenhava os valores novos deixava textos antigos duplicados; limpar regiões grandes demais também removia partes importantes da arte.

**How to apply:** Ao mudar os cards, renderize pelo menos um estado ao vivo e um encerrado de cada jogo e confira visualmente textos, valores, molduras, ícones e mensagens de resultado.

Nos painéis Discord desses jogos, o `MediaGallery` deve permanecer como primeiro componente do container V2, seguido apenas por uma linha de status curta; não use `setAccentColor()` nesses containers.

**Why:** O texto longo fazia a imagem parecer secundária no celular, e o accent color criava a barra lateral que não pertence à arte do template.

**How to apply:** Deixe estado, retorno e resultado resumidos em uma única linha abaixo da imagem e mantenha os botões como os únicos controles adicionais.
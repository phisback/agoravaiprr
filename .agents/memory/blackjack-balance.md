---
name: Blackjack balance
description: Regras de retorno usadas para manter progressão de apostas negativa no Blackjack
---

O Blackjack usa retornos abaixo de 2x incluindo a devolução da aposta: vitória comum 1,75x, blackjack natural 1,90x e seguro 2x. O dealer compra no 17 suave.

**Why:** A progressão de dobrar apostas estava recuperando perdas com uma única vitória e permitindo farm de coins.

**How to apply:** Ao rebalancear o Blackjack, preserve uma vantagem da casa transparente nos multiplicadores e avalie a progressão 100 → 200 → 400 → 800; não altere Crash, Mines ou Pênaltis sem pedido específico.
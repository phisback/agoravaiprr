---
name: Top ranking alignment
description: Âncoras e espaçamento do bloco de coins no template Top Elite/Top Coins
---

O template do ranking usa duas âncoras horizontais diferentes para os valores: a coluna Elite termina perto de x=720 e a coluna Top Coins perto de x=1410. O número fica imediatamente acima da legenda “Coins”, não no centro vertical da linha.

**Why:** Usar a mesma margem da borda nos dois lados e posicionar o número no centro deixava o bloco do bot desalinhado em relação à arte fornecida.

**How to apply:** Preserve as âncoras assimétricas e use fonte base próxima de 30 px com redução automática para números longos; valide sempre com uma renderização usando valores curtos e longos.
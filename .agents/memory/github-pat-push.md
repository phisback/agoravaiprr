---
name: GitHub PAT push authentication
description: Formato de autenticação necessário para usar o PAT armazenado em secrets no push HTTPS do GitHub.
---

Para push HTTPS via Git, use autenticação Basic com `x-access-token:<PAT>` em `http.extraHeader`; o formato Bearer pode ser rejeitado pelo Git Smart HTTP mesmo quando o PAT é válido.

**Why:** O GitHub aceitou o mesmo secret imediatamente quando enviado como Basic, enquanto a tentativa com Bearer retornou credenciais inválidas.

**How to apply:** Gere o header Basic em memória/processo para fetch, push e verificação final; nunca imprima o token nem grave a URL autenticada no remote. Se o hook LFS falhar por endpoint incompatível, desative-o apenas para o push de código quando não houver novos binários LFS a publicar.
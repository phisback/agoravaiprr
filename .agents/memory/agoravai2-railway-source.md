---
name: AgoraVai Railway source
description: Fonte GitHub confirmada para o serviço de produção do bot AgoraVai
---

O serviço Railway de produção do bot AgoraVai está conectado ao repositório `replit2207-jpg/agoravai2`, branch `main`.

**Why:** Uma implantação antiga continuou exibindo códigos internos mesmo depois de a correção estar no branch correto; investigar o repositório `agoravai` leva a uma fonte diferente.

**Como aplicar:** Para alterações do bot em produção, enviar para `agoravai2/main` e confirmar o novo build no Railway; não assumir que o remoto `origin` deste workspace é a fonte do serviço.

O banco usado pela Railway é separado do banco de desenvolvimento do Replit. Para operações autorizadas no banco de produção, a conexão deve ser fornecida como secret `RAILWAY_DATABASE_URL`, nunca em um campo público do painel.

**Why:** O reset feito apenas no banco de desenvolvimento não alterou os saldos exibidos pelo bot em produção.

**Como aplicar:** Confirme o agregado no banco externo antes da alteração e verifique novamente depois; altere somente `Economy.balance` e `Economy.bank` quando o objetivo for zerar coins.
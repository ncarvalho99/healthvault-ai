# Roteiro de Teste — commit `b22a02f`

Ambiente: produção `https://healthai.nclabs.dev` (LXC 133), implantado em 25/09/2026 18:04 BRT.

Pré-requisitos:

- **Usuário A**: sua conta normal.
- **Usuário B**: uma conta comum de teste (crie em *Usuários* com o admin, papel `USER`). Não use duas contas ADMIN.
- Antes de cada bloco de chat, abra uma **conversa nova** (evita herdar ofertas de turnos anteriores).
- Após cada gravação, confira em *Auditoria* / *Linha do tempo* o que foi realmente persistido — a resposta do chat não é prova.

---

## Parte 1 — Isolamento entre usuários (automatizado)

Roda contra a instância e limpa tudo o que cria.

```bash
BASE_URL=https://healthai.nclabs.dev \
USER_A=<usuario_a> PASS_A=<senha_a> \
USER_B=<usuario_b> PASS_B=<senha_b> \
pnpm tsx scripts/tenant-isolation-smoke.ts
```

No PowerShell: defina `$env:BASE_URL="..."`, `$env:USER_A="..."` etc. e rode `pnpm tsx scripts/tenant-isolation-smoke.ts`.

Esperado: todas as linhas `PASS` e código de saída 0. O script verifica:

| # | Tentativa do usuário A | Esperado |
|---|---|---|
| 1.1 | Criar recomendação na conversa de B | 404 `FOREIGN_KEY_NOT_OWNED` |
| 1.2 | Criar medicamento ligado à recomendação de B | 404 |
| 1.3 | Criar medicamento na conversa de B | 404 |
| 1.4 | Criar sintoma ligado ao medicamento de B | 404 |
| 1.5 | Criar sintoma / métrica / exame / dieta na conversa de B | 404 |
| 1.6 | Mover a própria recomendação para a conversa de B | 404 |
| 1.7 | Ler conversa / recomendação de B; filtrar recomendações por conversa de B | 404 / lista vazia |
| 1.8 | B abre a própria conversa | nenhum registro de A aparece |
| 1.9 | PUT status `DOCTOR_RECOMMENDATION` / `CONFIRMED` | 403 `STATUS_REQUIRES_TRUSTED_ORIGIN` |
| 1.10 | PUT status `ARCHIVED` | 200 |
| 1.11 | POST com status `DOCTOR_RECOMMENDATION` | 400 |
| 1.12 | Medicamento enviado com `actorType: DOCTOR`, `actorName: "Dr. Fake"` | versão gravada como `USER` / seu username |

Se algo falhar, copie a saída inteira do script.

---

## Parte 2 — Negação e escopo de gravação (chat, usuário A)

Para cada caso: conversa nova, envie a mensagem e confira na Auditoria o que foi gravado.

| # | Mensagem | Deve gravar | NÃO deve gravar |
|---|---|---|---|
| 2.1 | "Estou com X kg. Monte uma dieta de 2000 kcal. Salve a dieta, não o peso." | dieta | métrica de peso |
| 2.2 | "Monte uma dieta de 2000 kcal e salve a dieta, não o protocolo." | dieta | recomendação/protocolo |
| 2.3 | "Atualize o peso para X kg, menos a medicação." | peso | medicamento |
| 2.4 | "Salve a dieta com menos carboidrato." (após o assistente propor uma dieta) | dieta | — (não pode ser lido como exclusão) |
| 2.5 | "Não salve minha dieta, só me mostre a sugestão." | nada | dieta |
| 2.6 | "Salve a dieta mas não o peso e a medicação." | dieta | peso, medicamento |

> Use em X um peso próximo do registrado no Vault (diferença < 4 kg); uma diferença maior aciona o bloqueio de conflito de peso, que é outro comportamento.

---

## Parte 3 — Oferta de salvamento e "sim"

| # | Passo | Esperado |
|---|---|---|
| 3.1 | Peça "Monte uma sugestão de dieta de 1800 kcal". Se o assistente perguntar "Quer que eu salve…?", responda **"sim"**. | Grava só o domínio oferecido (dieta). |
| 3.2 | Peça "Monte uma dieta, mas não salve nada ainda". O assistente deve dizer algo como "Não vou salvar sem sua autorização" **sem** perguntar se quer salvar. Responda **"sim"**. | Nada é gravado. O assistente pede um comando explícito. |
| 3.3 | Em conversa nova, envie apenas **"sim"**. | Nada é gravado. |

O 3.2 depende da redação do modelo: se ele fizer uma pergunta de oferta na mesma mensagem, o "sim" passa a valer para essa oferta — nesse caso anote o texto exato da resposta.

---

## Parte 4 — Status e origem das recomendações (tela *Recomendações*)

| # | Passo | Esperado |
|---|---|---|
| 4.1 | Crie um protocolo manual. | Selo "Nota Pessoal"; origem "Registro manual — <seu usuário>". |
| 4.2 | Edite esse protocolo e abra o seletor de status. | Opções: Rascunho, Nota Pessoal, Arquivado. **Sem** "Recomendação Médica" e "Confirmado / Validado". |
| 4.3 | Edite um protocolo criado pela IA. | Opções incluem "Sugestão de IA" + Rascunho / Nota Pessoal / Arquivado. |
| 4.4 | Protocolos antigos que já estavam como "Recomendação Médica" ou "Confirmado" sem origem médica. | Selo "Validação não verificada" (também no Dashboard, no painel da conversa e no histórico de versões). |
| 4.5 | Edite um protocolo antigo do item 4.4 mudando só o texto. | Salva normalmente (o status atual é mantido). |

---

## Parte 5 — Protocolo automático junto com a dieta

| # | Passo | Esperado |
|---|---|---|
| 5.1 | Conversa nova: peça um protocolo de **medicação** e peça para salvá-lo como protocolo. Depois, na mesma conversa: "Monte uma dieta de 2000 kcal e salve a dieta e o protocolo." | O protocolo de medicação **não** recebe "Plano nutricional vigente". Aparece (ou é atualizado) um "Protocolo Nutricional" separado. |
| 5.2 | Na mesma conversa, peça um ajuste: "Ajuste a dieta para 1900 kcal e salve a dieta e o protocolo." | O mesmo "Protocolo Nutricional" ganha nova versão com a seção atualizada; o de medicação continua intacto. |
| 5.3 | "Monte uma dieta de 2000 kcal e salve a dieta." (sem citar protocolo) | Grava só a dieta; nenhuma versão de protocolo. |

Em 5.1/5.2, confira no histórico de versões que o protocolo de medicação não ganhou versão nova.

---

## Parte 6 — Regressão rápida

- [ ] Dashboard carrega sem erros; selo do último protocolo aparece.
- [ ] Tabelas Markdown nas notas do protocolo continuam renderizando.
- [ ] Criar/editar medicamento, métrica, sintoma e exame pela interface funciona (sem erro 404 indevido).
- [ ] Histórico de versões e diff de recomendações abrem.
- [ ] Reverter uma versão de medicamento/dieta funciona.

---

## Como reportar

Para cada falha: número do caso, mensagem enviada, resposta do assistente, e o que a Auditoria mostra como gravado. Para a Parte 1, a saída completa do script.

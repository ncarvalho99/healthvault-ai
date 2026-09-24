# HealthVault AI — Web-First Research Architecture & Exploit Hardening

Data de Referência: **24 de Setembro de 2026**  
Status: **Produção / Ativo (Refactor v2 — OmniRoute Search Gateway + SearXNG Fallback)**

---

## 1. Princípio Arquitetural Web-First (v2)

Para modelos de inferência cujos dados de treinamento podem estar desatualizados ou incompletos (como o combo `exploit` hospedado no OmniRoute), o **HealthVault AI** atua como Autoridade Soberana de Execução e Segurança (Tool Host).

O gateway de metabusca do **OmniRoute** (`POST /v1/search` com provedor primário `firecrawl` e `ollama-search`) atua como o caminho primário de busca de alta fidelidade, com failover e agregação automática para o **SearXNG** local (Proxmox LXC 131) e **Brave Search API**.

```text
Mensagem do Usuário
        ↓
HealthVault API (/api/ai/chat)
        ↓
ResearchPolicy Resolver
        ├── exploit: REQUIRED (Modo Web-First Obrigatório)
        └── outros combos: AUTO
        ↓
ResearchIntentAnalyzer
        ├── LOCAL_VAULT_ONLY: Não dispara pesquisa web (preserva dados pessoais)
        └── EXTERNAL_KNOWLEDGE / CURRENT_INFO: Dispara Web Research Preflight
                 ├── Query Expansion (3 queries determinísticas)
                 └── Domain-Targeted Queries (site:clinicaltrials.gov, site:fda.gov, site:pubmed...)
        ↓
Cadeia de Provedores com Failover & Agregação (ResearchOrchestrator)
        ├── 1. OmniRoute Search Gateway (/v1/search) -> Firecrawl, Ollama Search
        ├── 2. SearXNG Homelab Fallback (LXC 131) -> categories: general (fallback: science)
        └── 3. Brave Search API (se configurado)
        ↓
Filtro & Ranking de Autoridade Médica (SourceRanking)
        ├── Tier 1: FDA, EMA, ANVISA, PubMed, ClinicalTrials.gov, Lilly/Novo Trials
        ├── Tier 2: Centros Acadêmicos (Mayo, Hopkins, Harvard) e Sociedades Médicas
        ├── Tier 3: Referências Secundárias (WebMD, Drugs.com, Medscape)
        └── Tier 4: Fontes Anedóticas (Reddit, Fóruns) — penalizadas e sinalizadas
        ↓
Minimum Evidence Policy
        ├── >= 1 Tier 1/2/3: Aprovado para Grounded Answer
        └── Apenas Tier 4 em pergunta de segurança/dosagem: FAIL-CLOSED seguro (INSUFFICIENT_EVIDENCE)
        ↓
ResearchContextBuilder (<web_research> sanitizado contra prompt injection)
        ↓
OmniRoute Gateway (/v1/chat/completions)
        ↓
Modelo 'exploit' (Grounded Answer baseada nas evidências fornecidas)
        ↓
AssistantResponseProcessor (Sanitização de reasoning + Telemetria de tokens)
        ↓
Persistência no DB (Message + metadata.sources) & Interface do Usuário (Fontes Consultadas)
```

---

## 2. Diagnóstico Seguro & Zero Exposição de Infraestrutura

- **No Chat do Usuário**: A mensagem de erro em caso de fail-closed é 100% genérica e amigável ao paciente, orientando a reformulação da pergunta ou reiteração do pedido. Nenhum IP interno (`172.x.x.x`, `100.x.x.x`), porta (`8888`, `20128`), nome de container Proxmox (`LXC 131`, `LXC 133`) ou chave de API é exposto.
- **No Painel Administrativo (`/settings/runtime`)**: Exibe diagnóstico transparente por provedor:
  - OmniRoute `/v1/search` (Status, Latência, Provedores Ativos).
  - SearXNG Fallback (Status, Categorias ativas).
  - Métricas da última execução (Fontes Brutas, Fontes Válidas, Código de Motivo de Fail-Closed como `NO_RAW_RESULTS` ou `INSUFFICIENT_EVIDENCE`).

---

## 2. Políticas de Pesquisa (`ResearchPolicy`)

Centralizada em `src/lib/ai/research/research-policy.ts`:

| Política | Combos | Comportamento |
|---|---|---|
| **REQUIRED** | `exploit`, `exploit-v2` | Pesquisa na web obrigatória para qualquer pergunta que dependa de conhecimento factual externo. Em caso de falha ou ausência de fontes, aciona **Fail-Closed**. |
| **AUTO** | `demigod-flash`, `demigod-high`, `claude-sonnet` | Pesquisa ativada sob demanda quando a pergunta expressa explicitamente busca por novidades, guidelines ou estudos recentes. |
| **OFF** | Customizado | Desativa completamente qualquer consulta externa na internet. |

---

## 3. Classificação de Intenção (`ResearchIntentAnalyzer`)

Módulo: `src/lib/ai/research/research-intent.ts`

- **`LOCAL_VAULT_ONLY`**:
  Perguntas voltadas ao histórico de saúde do próprio usuário ("qual minha dieta atual?", "meus medicamentos registrados", "meu peso de ontem", "adicione 5mg de rosuvastatina").
  *Comportamento:* Acesso direto aos serviços de domínio do HealthVault via ferramentas clínicas. **Zero tráfego externo desnecessário.**
- **`EXTERNAL_KNOWLEDGE`**:
  Perguntas clínicas sobre posologia, mecanismos de ação, segurança, interações medicamentosas, ensaios clínicos de fase I/II/III e compostos experimentais (ex: *retatrutide*, *SLU-PP-332*, *MOTS-c*, *peptídeos*, *GLP-1s*).
  *Comportamento:* Preflight de pesquisa web obrigatório.
- **`CURRENT_INFORMATION`**:
  Perguntas sobre notícias, consensos ou guidelines de 2025/2026.
  *Comportamento:* Preflight de pesquisa web com sufixos temporais dinâmicos.

---

## 4. Provedores Homelab e Externos

Configuração no `.env` ou variáveis de ambiente do container:

```env
# Provedor ativo: searxng ou brave
WEB_RESEARCH_PROVIDER="searxng"

# Instância SearXNG Homelab (LXC 131)
SEARXNG_BASE_URL="http://172.26.128.61:8888"

# Provedor Externo Opcional
BRAVE_SEARCH_API_KEY=""
```

### SearXNG (Self-Hosted Homelab)
- Instância dedicada no Proxmox LXC 131 (`172.26.128.61:8888`) com backend Valkey.
- Conexão direta via rede local homelab (`172.26.128.0/24`) com latência inferior a 150ms.
- Retorno de resultados agregados de múltiplos motores de busca em JSON estruturado sem rastreamento.

### Brave Search API
- Provedor externo alternativo, consultado quando configurado `WEB_RESEARCH_PROVIDER=brave` e fornecida chave válida.

---

## 5. Política de Autoridade de Fontes Médicas (`SourceRanking`)

Módulo: `src/lib/ai/research/source-ranking.ts`

1. **Tier 1 (Órgãos Regulatórios e Estudos Primários)**:
   - `fda.gov`, `ema.europa.eu`, `anvisa.gov.br`, `who.int`, `saude.gov.br`, `clinicaltrials.gov`, `ncbi.nlm.nih.gov`, `pubmed.ncbi.nlm.nih.gov`, `dailymed.nlm.nih.gov`, `nejm.org`, `thelancet.com`, `jamanetwork.com`, `bmj.com`.
   - Pontuação base máxima (`1000 pts`), com bônus para ensaios clínicos fase 3 randomizados e aprovações formais.
2. **Tier 2 (Centros Médicos Acadêmicos e Sociedades Científicas)**:
   - `mayoclinic.org`, `hopkinsmedicine.org`, `clevelandclinic.org`, `health.harvard.edu`, `cochranelibrary.com`, `endocrine.org`, `diabetes.org`, `heart.org`, `nature.com`, `cell.com`.
   - Pontuação base elevada (`700 pts`).
3. **Tier 3 (Referências Secundárias Idôneas)**:
   - `webmd.com`, `drugs.com`, `medscape.com`, `healthline.com`, `rxlist.com`, `examine.com`, `statpearls.com`.
   - Pontuação base moderada (`400 pts`).
4. **Tier 4 / Fontes Anedóticas (Baixa Confiabilidade)**:
   - `reddit.com`, `twitter.com`, `x.com`, fóruns de biohacking, blogs pessoais.
   - Pontuação penalizada (`50 pts`), categorizada como anedótica (`isAnecdotal: true`). Nunca utilizada como base primária para recomendações clínicas de dosagem ou segurança.

---

## 6. Comportamento Fail-Closed do `exploit`

Quando uma consulta exige conhecimento factual e a política for `REQUIRED`:
- Se nenhum provedor estiver configurado;
- Se a requisição de busca sofrer timeout ou falha de conectividade;
- Se nenhuma fonte confiável for encontrada;

O HealthVault **interrompe a geração e recusa o fallback para a memória de treinamento do modelo**. Em vez disso, responde de forma controlada e segura:

> *"Não consegui validar informações atuais na internet para responder a esta solicitação. O modo exploit opera sob a política Web-First (REQUIRED) e não possui autorização para formular respostas sobre fatos clínicos baseando-se em sua memória de treinamento interna potencialmente desatualizada."*

---

## 7. Segurança Defensiva & Proteção contra Injeção

Módulos: `SearXNGProvider`, `ResearchContextBuilder`

1. **Proteção contra SSRF**:
   - Validação estrita de protocolos (`http:` e `https:` exclusivamente).
   - Bloqueio rígido de endpoints de metadados de nuvem e loopback (`169.254.169.254`, `metadata.google.internal`, `100.100.100.200`).
   - Rejeição de injeção CRLF (`\r`, `\n`, `\t`).
   - URLs de provedor são parametrizadas exclusivamente pelo operador via ambiente, nunca a partir de entradas de usuários.
2. **Mitigação de Indirect Prompt Injection**:
   - O bloco `<web_research>` é delimitado e contém aviso de segurança explícito declarando o conteúdo como dado externo não-confiável.
   - Remoção de tags `<script>`, `<style>`, `<iframe>`, delimitadores de sistema (`<|im_start|>`, `<|system|>`, `[INST]`) e tags de reasoning (`<think>`).
   - Limite de caracteres estrito (`6000 chars`) para evitar exaustão de contexto.
3. **Privacidade e Auditoria**:
   - Chaves de API e cabeçalhos de autorização nunca são registrados em logs ou persistidos.
   - Logs de auditoria (`AI_WEB_RESEARCH_EXECUTED`) gravam apenas o hash criptográfico da consulta (`queryHash`), identificador de execução (`runId`), latência e quantidade de fontes.

---

## 8. Interface com o Usuário

- **Chat Messenger**: Respostas que utilizam dados da web exibem o componente retrátil `ResearchSourcesCollapsible`, com contador de fontes, links diretos (`target="_blank" rel="noopener noreferrer"`), selos de domínio e indicação de autoridade médica (Tier 1 vs Anedótico).
- **Settings Runtime (`/settings/runtime`)**: Exibe para cada combo suas políticas operacionais:
  - Tool Calling (`✓ Suportado`)
  - Reasoning Policy (`DISABLED (Filtered)`)
  - Web Research Policy (`REQUIRED (Web-First)`)
  - Provedor Ativo (`SearXNG` / `Brave`)
  - Métricas da última pesquisa (timestamp, status, quantidade de fontes).

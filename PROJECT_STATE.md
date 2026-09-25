# HealthVault AI — Project State & Architectural Snapshot

Data de Referência: **25 de Setembro de 2026**  
Status Operacional: **Produção / Ativo**  
Repositório Público: **[https://github.com/ncarvalho99/healthvault-ai](https://github.com/ncarvalho99/healthvault-ai)**

---

## 1. Estado Atual da Arquitetura

HealthVault AI é um sistema pessoal de registro de saúde, histórico de conversas e versionamento clínico, com integração direta ao OmniRoute (OpenAI-compatible AI Gateway) atuando como Tool Host:

```text
Browser / Web Client
       ↓ HTTPS (Cookie HttpOnly / Next.js Edge Middleware)
Cloudflare Zero Trust Edge (healthai.nclabs.dev)
       ↓ Encrypted Wireguard Bridge (cloudflared-b, LXC 109)
HealthVault Container (LXC 133 — 172.26.128.58:3000)
       ├── Next.js 14 App Router (React 18, Tailwind CSS, Lucide)
       ├── Edge Middleware (src/middleware.ts — proteção total de rotas)
       ├── Response Pipeline (AssistantResponseProcessor, ReasoningFilter, MarkdownNormalizer)
       ├── Agent Tool Runtime:
       │     ├── ToolRegistry (27 ferramentas clínicas e de sistema)
       │     ├── ToolSelector (Scoping inteligente por intenção da mensagem)
       │     ├── PermissionEngine & ApprovalEngine (Políticas AUTO_APPLY vs REVIEW_FIRST)
       │     ├── IdempotencyEngine (Imutabilidade via toolCallId)
       │     └── Tool Loop Server-Side (Máximo de 8 iterações com detecção de repetição)
       ├── Domain Services (MedicationService, DietService, RecommendationService, HealthService, TimelineService, SearchService, RevertService)
       └── PostgreSQL 17 (Prisma ORM — Tabelas relacionais e versionamento _versions)
       ↓
OmniRoute Gateway (Local / Homelab — Combos de Inferência: exploit, demigod-flash, etc.)
```

---

## 2. Versão Implantada

- **Versão da Aplicação**: `1.0.0`
- **Ambiente de Hospedagem**: Proxmox VE 9.2.3 (`homeLAB`, Tailscale `100.79.12.77`)
- **Container LXC**: ID `133` (`healthvault`), Debian 13 unprivileged
- **Endereço Interno**: `172.26.128.58:3000`
- **Endereço Público Seguro**: `https://healthai.nclabs.dev/`
- **Gerenciador de Processos**: PM2 (`pm2-root.service`) rodando o build de produção Next.js otimizado (35 páginas) com auto-start no boot.
- **Banco de Dados**: PostgreSQL 17 local no container LXC 133 (`127.0.0.1:5432/healthvault`).

---

## 3. Comandos de Teste, Build e Operação

| Ação | Comando | Descrição |
|---|---|---|
| **Testes Unitários** | `pnpm test` ou `pnpm run test:unit` | Executa a suíte de 114 testes unitários (`node:test` + `tsx` em 34 suítes) |
| **Testes E2E** | `pnpm run test:e2e` | Executa a suíte de testes E2E com gateway |
| **Todos os Testes** | `pnpm run test:all` | Roda testes unitários e E2E consolidados |
| **Limpeza de Reasoning** | `pnpm run clean:reasoning -- --dry-run` | Varre o banco em busca de tags de reasoning legadas (modo seguro) |
| **Aplicação da Limpeza** | `pnpm run clean:reasoning -- --apply` | Higieniza mensagens históricas arquivando versões em `MessageVersion` |
| **Build de Produção** | `pnpm run build` | Gera o cliente Prisma e compila o bundle de produção Next.js |
| **Inicialização Prod** | `pnpm start` | Inicia o servidor Next.js em porta configurada (default: 3000) |
| **Desenvolvimento** | `pnpm dev` | Inicia o ambiente de desenvolvimento local |
| **Sincronização DB** | `npx prisma db push` | Sincroniza o schema Prisma com o PostgreSQL sem perda de dados |

---

## 4. Variáveis de Ambiente Necessárias (Template Sanitizado)

```env
# Banco de Dados PostgreSQL
DATABASE_URL="postgresql://<DB_USER>:<DB_PASSWORD>@127.0.0.1:5432/<DB_NAME>?schema=public"

# Sessão Web e Middleware (Chave randômica de no mínimo 32 caracteres)
JWT_SECRET="replace_with_a_cryptographically_secure_random_64_character_string"

# Chave Criptográfica para Segredos do OmniRoute (AES-256-GCM - Opcional, herda de JWT_SECRET se omitida)
APP_ENCRYPTION_KEY="replace_with_a_cryptographically_secure_random_32_byte_key"

# Políticas de Timeout e Resiliência de IA
AI_REQUEST_TIMEOUT_MS=120000
AI_MAX_TOOL_ITERATIONS=8
AI_APPROVAL_TTL_MINUTES=60
AI_MAX_CONTEXT_CHARS=24000

# Porta e Ambiente
NODE_ENV="production"
PORT=3000

# Web-First Research Gateway & Retrieval
WEB_RESEARCH_GATEWAY="omniroute"
WEB_RESEARCH_PROVIDER_PRIORITY="firecrawl,ollama-search,searxng"
WEB_RESEARCH_STRATEGY="aggregate"
SEARXNG_BASE_URL="http://<SEARXNG_HOST>:8888" # Fallback local opcional (sem hardcode)
BRAVE_SEARCH_API_KEY="" # Fallback externo opcional

# Credenciais E2E Live (Opcional, apenas para execução de pnpm run test:e2e)
E2E_REQUIRE_LIVE="false"
E2E_AI_BASE_URL=""
E2E_AI_API_KEY=""
E2E_AI_MODEL="exploit"
```

---

## 5. Funcionalidades Concluídas

1. **Autenticação & Segurança de Borda**:
   - Next.js Edge Middleware (`src/middleware.ts`) que bloqueia acessos não autenticados e redireciona automaticamente com `HTTP 307` para `/login`.
   - Cookies `HttpOnly`, `SameSite=lax` e flag `Secure` respeitando cabeçalhos de proxy reverso (`X-Forwarded-Proto`).
   - Criptografia autenticada AES-256-GCM para armazenamento seguro de API keys do OmniRoute.
   - Proteção de prompt injection via encapsulamento de registros em `<healthvault_data><records>`.
2. **Interface Messenger (Conversas & Chat)**:
   - Layout WhatsApp/ChatGPT-style com balões diferenciados para usuário e IA.
   - Suporte completo a **Markdown rico** (`MessageContent.tsx` com `react-markdown` e `remark-gfm`).
   - Seletor de modelo exibindo com precisão os **7 combos do OmniRoute** (`exploit`, `demigod-flash`, `demigod-high`, `demigod-audit`, `claude-opus`, `claude-sonnet`, `github-student`) com alternador para catálogo completo.
   - Alternador de modo operacional: **`[⚡ Modo Agente]`** (executa ferramentas) vs **`[💬 Chat Apenas]`** (conversação sem mutações).
   - Indicador de status de alto nível em tempo real.
   - Cards de confirmação/proposta interativos para ações `REVIEW_FIRST` (`[Aprovar & Gravar no Vault]` e `[Rejeitar]`).
   - Cards visuais compactos de sucesso de ferramentas com link direto para o recurso modificado.
   - Rastreamento e arquivamento de edições de mensagens (`MessageVersion`).
3. **Supressão e Filtragem de Raciocínio (Chain-of-Thought)**:
   - Política upstream via OmniRoute (`reasoning_effort: "none"`, `thinking: { type: "disabled" }` no combo `exploit`).
   - `ReasoningFilter` server-side que elimina blocos `<think>`, `<thinking>` e `<reasoning>` (multiline, variantes e unclosed tags).
   - `AssistantResponseProcessor` garantindo que o banco de dados armazene apenas o texto final destinado ao usuário.
4. **Módulos Clínicos com Versionamento Imutável**:
   - **Recomendações**: Criação, edição gerando nova versão incremental (`v1 → v2`), exclusão e modal de comparação visual lado a lado (diff de dosagens e macros).
   - **Medicamentos**: Listagem, cadastro inicial, titulação de doses com motivo clínico obrigatório, encerramento e exclusão.
   - **Nutrição & Dieta**: Metas diárias de calorias e macros (P/C/G), versionamento alimentar e exclusão.
   - **Métricas Corporais**: Registro, edição e exclusão de pesagens e percentual de gordura.
   - **Sintomas**: Registro, edição e exclusão com escala de gravidade de 1 a 10 e gatilhos.
   - **Exames Laboratoriais**: Cadastro, edição e exclusão de biomarcadores e valores de referência.
   - **Linha do Tempo**: Visualização cronológica integrada de todos os eventos com suporte a exclusão individual ou limpeza completa.
   - **Auditoria**: Tabela imutável (`audit_logs`) com rastreamento de ações, IPs, timestamps e metadados sanitizados.
5. **Experiência do Usuário (Design System Clínico)**:
   - Substituição de 100% dos popups genéricos do navegador (`alert`, `confirm`) pelos componentes nativos do sistema: `<ConfirmDialog />` e `<Toast />`.
   - Ícones de lixeira padronizados em todos os cards e tabelas.
6. **Agent Tool Runtime Completo**:
   - 27 ferramentas estruturadas implementadas no `ToolRegistry`.
   - Tool Scoping por intenção semântica (`ToolSelector`).
   - Concorrência otimista com prevenção de aprovação obsoleta (`VERSION_CONFLICT`).
   - Expiração temporal de propostas (TTL).
   - Serviço de reversão de versões (`RevertService` / `POST /api/ai/revert`).
   - Tela administrativa de diagnóstico de runtime em `/settings/runtime`.
7. **Web-First Exploit Mode & Hardening de Reasoning (Refactor v2)**:
   - Modo **Web-First (REQUIRED)** server-side para o combo `exploit` com fail-closed estrito e seguro (sem vazamento de infraestrutura no chat).
   - Gateway primário de metabusca **OmniRoute Search Gateway** (`POST /v1/search`) com suporte a `firecrawl` e `ollama-search`.
   - Fallback de alta resiliência para o **SearXNG** local (Proxmox LXC 131) com suporte a alternância dinâmica de categorias (`general` -> `science`).
   - Expansão determinística de queries com direcionamento de autoridade médica (`site:clinicaltrials.gov`, `site:fda.gov`, `site:pubmed...`).
   - Política de Evidência Mínima (`MinimumEvidencePolicy`) que avalia suficiência clínica antes do envio ao modelo.
   - Painel `/settings/runtime` com telemetria por provedor (OmniRoute Search vs SearXNG Fallback) e contador de fontes brutas vs válidas.
8. **Controle de Acesso (RBAC) & Gestão de Usuários**:
   - Dois papéis de usuário: **`ADMIN`** (acesso completo ao painel, configurações de IA, criação/gerenciamento de usuários e auditoria) e **`USER`** (acesso restrito exclusivamente aos seus próprios registros clínicos, sem acesso a configurações de IA, auditoria ou outros usuários).
   - **Autorização Granular de Modelos**: O admin define explicitamente quais modelos e combos do OmniRoute cada usuário `USER` pode utilizar.
   - **Isolamento de Dados**: Usuários normais visualizam e excluem apenas suas próprias recomendações, medicamentos, dietas, métricas e conversas.
   - **Alteração de Senha Segura**: Página dedicada em `/settings/password` com validação de senha atual, hash Bcrypt e registro imutável em auditoria.
   - **Interface Mobile Responsiva**: Drawer deslizante (slide-over) com botão hambúrguer responsivo nos cabeçalhos (`Header.tsx` e tela de chat), eliminando sobreposição da barra lateral em dispositivos móveis.
9. **Integração Especializada do Combo `health-ai` (ANON + HealthVault-Aware)**:
   - Sucessor especializado do combo `exploit`, adotando a persona ANON, voz direta e assinatura `[MAHI68]`, enquanto preserva o `exploit` original 100% intacto.
   - **Contrato de Runtime no Topo do Prompt**: O HealthVault é definido como autoridade máxima factual e operacional; dados estruturados (`<healthvault_data>`) e evidências externas (`<web_research>`) prevalecem sobre memórias de treinamento e estilo.
   - **Persistência entre Sessões**: O modelo não exige que dados pessoais sejam repetidos no chat atual, acessando o estado do prontuário diretamente.
   - **Resolução de Referências Pessoais**: Desambiguação inteligente de múltiplos medicamentos ativos e grounding automático.
   - **Chat Apenas Read-Only com Trava de Defesa em Profundidade**: No modo `CHAT_ONLY`, ferramentas de leitura (`healthvault_get_context`, `healthvault_search`, etc.) são fornecidas para consulta ao prontuário, enquanto mutações de escrita são bloqueadas no `ToolDispatcher` com código `READ_ONLY_MODE`.
   - **Políticas Web-First e Reasoning**: `ResearchPolicy = REQUIRED` e `ReasoningPolicy = DISABLED` aplicadas centralmente.
10. **Grounding Funcional & Consistência de UI do Chat**:
    - **Reconciliação Otimista de Mensagens Sem Perda de Histórico**: Substituição cirúrgica do ID temporário (`tempId`) pelo registro real persistido no PostgreSQL retornado em `data.userMessage`, eliminando o filtro destrutivo que expurgava mensagens anteriores do usuário.
    - **Cards de Ferramentas Associados por Mensagem**: Removido o bloco global de tool cards no rodapé do chat. Agora as execuções de ferramentas são associadas à mensagem de IA específica (`msg.metadata.toolExecutions`), persistindo com a conversa.
    - **Semântica e Rótulos Amigáveis de Ferramentas**:
      - `healthvault_ping` oculto da timeline do chat.
      - Ferramentas de leitura (`access === "read"`) exibidas de forma compacta e discreta (*"Consultado no HealthVault"*), sem gerar falsos cards de sucesso *"HealthVault Atualizado"*.
      - Mutações reais de escrita (`access === "write"`) identificadas com nomes claros (*"Métrica Corporal"*, *"Ajuste de Medicamento"*, *"Dieta"*).
    - **Classificação `MIXED` em Pesquisa Web**: Perguntas combinando contexto pessoal e validação externa (ex: *"Meu medicamento atual possui alguma interação conhecida com metformina?"*) são classificadas como `MIXED` com `requiresExternalResearch = true`.
    - **Defesa em Profundidade contra `SKIPPED` em `REQUIRED`**: Perguntas com termos clínicos externos (interações, bulas, guidelines, efeitos adversos) nunca sofrem fallback silencioso para a memória do modelo.
    - **Preservação de Operadores `site:` e Prioridade de Query Direcionada**: Sanitizador preserva operadores como `site:clinicaltrials.gov` e garante execução de ao menos uma query domain-targeted nas 3 requisições principais.
11. **Vault Entity Resolution, Desambiguação & Persistência Transacional de Aprovação**:
    - **Vault Entity Resolution Server-Side para Intent `MIXED`**: Resolução prévia e minimalista de referências do prontuário (medicamentos ativos, doses, dietas) antes da formulação de buscas externas na web, gerando queries reais (`semaglutide metformin drug interaction`, `site:fda.gov semaglutide metformin`).
    - **Reconhecimento de Segurança Clínica (`CLINICAL_SAFETY_PATTERNS`)**: Detecção completa de variações ortográficas com e sem acento e plurais para `interações` / `interacoes`, `contraindicações` / `contraindicacoes`, `efeitos adversos`, `segurança` / `seguranca`, `toxicidade`, `dose`, `dosagem` e `titulação` / `titulacao`.
    - **Tratamento de Múltiplos Medicamentos sem Slice Silencioso**: Referências ambíguas a múltiplos medicamentos ativos retornam estado explícito `NEEDS_DISAMBIGUATION` com lista completa de medicamentos ativos e suspendem pesquisas externas específicas até a escolha do usuário.
    - **Minimização Estrita de Privacidade**: Sanitizador elimina narrativas e PIIs, transmitindo apenas conceitos clínicos essenciais (`[entity] [condition] [guideline]`) e preservando sintaxe `site:`.
    - **Preservação de Consultas Locais**: Perguntas estritamente pessoais (`LOCAL_VAULT_ONLY`) continuam sem efetuar pesquisa externa desnecessária.
    - **Sincronização Atômica via Transação Prisma (`db.$transaction`)**: Endpoints de aprovação e rejeição atualizam atomicamente `ai_tool_executions` e a mensagem associada (`Message.metadata.toolExecutions`), prevenindo inconsistências e garantindo rollback automático caso a atualização do metadata falhe.
    - **Estado Terminal para Conflito de Versão e Expiração**: `VERSION_CONFLICT` e `PROPOSAL_EXPIRED` gravam `AiToolExecution` como `FAILED` com seu respectivo `errorCode` (não permanecendo em `PENDING_APPROVAL`) e metadata correspondente no chat.

---

## 6. Limitações Conhecidas

1. **Gestão de Sessão**: Cada usuário autenticado opera em seu próprio contexto isolado com cookie `HttpOnly` e RBAC. O usuário `admin` padrão é provisionado automaticamente no seed inicial.
2. **Pipeline Síncrono Non-Streaming no Chat**: O loop de execução de ferramentas e o filtro de supressão de raciocínio operam de forma síncrona no backend (com indicador visual de status de passos no frontend). Isso garante proteção 100% à prova de vazamento de reasoning e atomicidade de transações antes de entregar a resposta final ao navegador.
3. **Resolução de Modelos em Redes Privadas**: O endpoint do OmniRoute precisa ser acessível pela rede onde o container do HealthVault está hospedado (validado via túnel ou rede local homelab).

---

## 7. Pendências Técnicas e Monitoramento

1. **Monitoramento do Tailscale no Proxmox Host (`homeLAB`)**:
   - Verificar periodicamente ou desabilitar a expiração da chave do nó Proxmox no console do Tailscale para evitar desconexões da interface de gerenciamento remoto (`100.79.12.77`).
2. **Rotinas de Backup Automático**:
   - As rotinas de dump lógico via `pg_dump` e snapshots Proxmox (`vzdump`) documentadas em `backup-restore.md` estão prontas para agendamento via cron no Proxmox host.

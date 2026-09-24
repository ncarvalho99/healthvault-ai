/**
 * OpenAI-compatible Tool Definitions for HealthVault AI
 */
export const HEALTHVAULT_TOOLS = [
  {
    type: "function",
    function: {
      name: "healthvault_get_context",
      description: "Consulta dados clínicos específicos do paciente no HealthVault.",
      parameters: {
        type: "object",
        properties: {
          include: {
            type: "array",
            items: {
              type: "string",
              enum: ["medications", "diet", "recommendations", "metrics", "symptoms", "labs"],
            },
            description: "Lista de blocos clínicos a serem incluídos na consulta.",
          },
        },
        required: ["include"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "healthvault_list_medications",
      description: "Lista os medicamentos cadastrados e suas dosagens vigentes.",
      parameters: {
        type: "object",
        properties: {
          active_only: {
            type: "boolean",
            description: "Se verdadeiro, lista apenas os medicamentos atualmente ativos. Padrão: true.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "healthvault_create_medication",
      description: "Cadastra um novo medicamento no HealthVault com dose inicial.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nome comercial ou princípio ativo (ex: Semaglutida)." },
          generic_name: { type: "string", description: "Nome genérico opcional." },
          category: { type: "string", description: "Categoria terapêutica (ex: GLP-1 RA, Suplemento, Hormônio)." },
          form: { type: "string", description: "Forma farmacêutica (ex: Subcutâneo, Cápsula, Comprimido)." },
          dose_value: { type: "number", description: "Valor numérico da dose (ex: 0.25)." },
          dose_unit: { type: "string", description: "Unidade de medida (ex: mg, mcg, UI, ml)." },
          frequency: { type: "string", description: "Frequência de administração (ex: 1x/semana, 2x/dia)." },
          schedule: { type: "string", description: "Horário ou condição (ex: Manhã em jejum)." },
          reason: { type: "string", description: "Justificativa clínica da prescrição ou sugestão." },
          information_origin: {
            type: "string",
            enum: ["USER_REPORTED", "AI_SUGGESTED", "PROFESSIONAL_REPORTED"],
            description: "Origem da informação: relatado pelo usuário, sugerido por IA ou orientação médica direta.",
          },
        },
        required: ["name", "dose_value", "dose_unit", "frequency", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "healthvault_update_medication",
      description: "Ajusta a dose ou posologia de um medicamento existente, gerando uma nova versão imutável.",
      parameters: {
        type: "object",
        properties: {
          medication_id: { type: "string", description: "ID do medicamento (ou nome caso ID não esteja disponível)." },
          dose_value: { type: "number", description: "Novo valor numérico da dosagem." },
          dose_unit: { type: "string", description: "Unidade de medida (ex: mg, mcg)." },
          frequency: { type: "string", description: "Nova frequência (ex: 1x/semana)." },
          schedule: { type: "string", description: "Novo horário ou rotina." },
          reason: { type: "string", description: "Motivo clínico da alteração de dose (obrigatório para auditoria)." },
          information_origin: {
            type: "string",
            enum: ["USER_REPORTED", "AI_SUGGESTED", "PROFESSIONAL_REPORTED"],
          },
        },
        required: ["medication_id", "dose_value", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "healthvault_stop_medication",
      description: "Descontinua o uso de um medicamento ativo no HealthVault, registrando a data e o motivo.",
      parameters: {
        type: "object",
        properties: {
          medication_id: { type: "string", description: "ID do medicamento a ser encerrado." },
          reason: { type: "string", description: "Motivo da suspensão (ex: atingimento do objetivo, efeito adverso)." },
        },
        required: ["medication_id", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "healthvault_get_current_diet",
      description: "Obtém as metas calóricas, distribuição de macronutrientes e plano alimentar ativo.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "healthvault_update_diet",
      description: "Atualiza as metas de calorias e macronutrientes diários, gerando uma nova versão da dieta.",
      parameters: {
        type: "object",
        properties: {
          target_calories: { type: "number", description: "Total de calorias diárias (kcal)." },
          target_protein_g: { type: "number", description: "Meta de proteína diária em gramas (g)." },
          target_carbs_g: { type: "number", description: "Meta de carboidratos diários em gramas (g)." },
          target_fat_g: { type: "number", description: "Meta de gorduras diárias em gramas (g)." },
          reason: { type: "string", description: "Justificativa da alteração (ex: avanço para déficit calórico)." },
          information_origin: {
            type: "string",
            enum: ["USER_REPORTED", "AI_SUGGESTED", "PROFESSIONAL_REPORTED"],
          },
        },
        required: ["target_calories", "target_protein_g", "target_carbs_g", "target_fat_g", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "healthvault_create_recommendation",
      description: "Cria um novo protocolo clínico consolidado (snapshot de medicamentos e metas).",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Título do protocolo (ex: Fase Cutting 2026)." },
          notes: { type: "string", description: "Diretrizes e observações clínicas." },
          reason: { type: "string", description: "Motivo da criação do protocolo." },
        },
        required: ["title", "notes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "healthvault_add_body_metric",
      description: "Registra uma nova pesagem ou medição corporal no HealthVault.",
      parameters: {
        type: "object",
        properties: {
          weight_kg: { type: "number", description: "Peso corporal em quilogramas (kg)." },
          body_fat_pct: { type: "number", description: "Percentual de gordura corporal estimado (% BF)." },
          waist_cm: { type: "number", description: "Circunferência da cintura em centímetros." },
          notes: { type: "string", description: "Observação (ex: Em jejum ao acordar)." },
        },
        required: ["weight_kg"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "healthvault_add_symptom",
      description: "Registra a ocorrência de um sintoma ou efeito colateral relatado pelo usuário.",
      parameters: {
        type: "object",
        properties: {
          symptom: { type: "string", description: "Nome do sintoma (ex: Náusea, Cefaleia, Refluxo)." },
          severity: { type: "number", description: "Gravidade em escala de 1 (muito leve) a 10 (severo)." },
          possible_trigger: { type: "string", description: "Possível gatilho relatado (ex: 24h pós-dose)." },
          description: { type: "string", description: "Descrição detalhada do episódio." },
        },
        required: ["symptom", "severity"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "healthvault_add_lab_result",
      description: "Registra o valor de um biomarcador laboratorial.",
      parameters: {
        type: "object",
        properties: {
          test_name: { type: "string", description: "Nome do exame (ex: Perfil Glicêmico)." },
          marker_name: { type: "string", description: "Nome do analito/marcador (ex: Glicemia de Jejum, HbA1c, TSH)." },
          result_value: { type: "number", description: "Valor medido numérico." },
          unit: { type: "string", description: "Unidade de medida (ex: mg/dL, %, ng/dL)." },
          reference_range_low: { type: "number", description: "Limite inferior de referência normal." },
          reference_range_high: { type: "number", description: "Limite superior de referência normal." },
        },
        required: ["test_name", "marker_name", "result_value", "unit"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "healthvault_create_reminder",
      description: "Agenda um lembrete ou revisão futura de dosagem/exame no painel do usuário.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Título do lembrete (ex: Reavaliar dose de Semaglutida em 14 dias)." },
          due_date: { type: "string", description: "Data de vencimento no formato ISO ou YYYY-MM-DD." },
          notes: { type: "string", description: "Detalhes do que deve ser avaliado." },
        },
        required: ["title", "due_date"],
      },
    },
  },
];

// JSON Schema (draft-07) for the criteria bulk-upload file. Downloaded from the
// Data tab and handed to an AI agent so it can generate conformant upload files.
// This is the single source of truth for the upload format; keep it in sync with
// the server's /api/criteria/bulk-upload validation.
export const CRITERIA_UPLOAD_SPEC = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://talkoot.evalmvp/criteria-bulk-upload.schema.json",
  title: "EvalMVP — Criteria Bulk Upload",
  description:
    "A file that bulk-upserts evaluation criteria. Upload it on the Data tab. Each criterion is matched by `id` (or, when `id` is omitted, by a slug derived from `criteria_name` + `content_type`): an existing match is updated, otherwise a new criterion is created. The upload is validated as a whole — if any criterion is invalid, nothing is applied.",
  type: "object",
  required: ["criteria"],
  additionalProperties: false,
  properties: {
    source: {
      type: "string",
      description: "Optional label recorded as the provenance of every criterion in this file (e.g. a project or agent name). If omitted, the filename is used.",
    },
    criteria: {
      type: "array",
      minItems: 1,
      description: "The criteria to upsert.",
      items: { $ref: "#/definitions/criterion" },
    },
  },
  definitions: {
    criterion: {
      type: "object",
      required: ["criteria_name", "content_type", "criteria_type"],
      additionalProperties: false,
      properties: {
        id: {
          type: "string",
          description: "Stable id. Omit to derive it as slug(criteria_name)-slug(content_type). Provide it to reliably update a specific existing criterion.",
        },
        criteria_name: { type: "string", description: "Display name. REQUIRED." },
        content_type: {
          type: "string",
          enum: ["Title", "Description", "Bullets/Specs", "Meta Description"],
          description: "What copy this criterion applies to. REQUIRED.",
        },
        criteria_type: {
          type: "string",
          enum: ["yes-no", "numerical-scale", "numerical-count"],
          description: "Scoring type; determines the shape of eval_definition. REQUIRED.",
        },
        context: {
          type: "string",
          enum: ["Universal", "Industry", "Marketplace", "Brand"],
          description: "Scope dimension. Defaults to \"\" if omitted.",
        },
        criteria_category: { type: ["string", "null"], description: "Freeform grouping label." },
        criteria_definition: { type: "string", description: "Prose description of what is judged." },
        eval_definition: {
          type: "object",
          description:
            "The rubric. Its shape MUST match criteria_type: use YesNoDefinition for yes-no, ScaleDefinition for numerical-scale, CountDefinition for numerical-count (see definitions below).",
        },
        weight: { type: "number", description: "Relative importance. Defaults to 1.0.", default: 1.0 },
        active: { type: "boolean", description: "Whether the criterion is active. Defaults to true.", default: true },
        marketplace_tag: { type: ["string", "null"] },
        brand_tag: { type: ["string", "null"] },
        industry_tag: { type: ["string", "null"] },
        customer: { type: ["string", "null"] },
        brand: { type: ["string", "null"] },
        custom_tags: {
          type: "object",
          description: "Extensible tags: a map of tag-category -> list of values.",
          additionalProperties: { type: "array", items: { type: "string" } },
        },
        notes: { type: ["string", "null"] },
      },
    },
    YesNoDefinition: {
      type: "object",
      description: "eval_definition shape when criteria_type = yes-no.",
      properties: {
        definition_yes: { type: "string", description: "What earns a Yes." },
        definition_no: { type: "string", description: "What earns a No." },
        yes_examples: { type: "array", items: { type: "string" } },
        no_examples: { type: "array", items: { type: "string" } },
      },
    },
    ScaleDefinition: {
      type: "object",
      description: "eval_definition shape when criteria_type = numerical-scale (scores 1-4; 4 is the target/pass).",
      properties: {
        score_1: { $ref: "#/definitions/ScaleRow" },
        score_2: { $ref: "#/definitions/ScaleRow" },
        score_3: { $ref: "#/definitions/ScaleRow" },
        score_4: { $ref: "#/definitions/ScaleRow" },
      },
    },
    ScaleRow: {
      type: "object",
      properties: {
        title: { type: "string" },
        definition: { type: "string" },
        example_1: { type: "string" },
        example_2: { type: "string" },
      },
    },
    CountDefinition: {
      type: "object",
      description: "eval_definition shape when criteria_type = numerical-count (the last bucket is the target/pass).",
      properties: {
        buckets: { type: "array", items: { type: "string" }, description: 'e.g. ["0", "1", "2", "3+"]' },
        bucket_titles: { type: "object", additionalProperties: { type: "string" } },
        bucket_definitions: { type: "object", additionalProperties: { type: "string" } },
        bucket_examples: { type: "object", additionalProperties: { type: "array", items: { type: "string" } } },
      },
    },
  },
  examples: [
    {
      source: "my-agent-batch-2026-07",
      criteria: [
        {
          criteria_name: "Title includes the brand name",
          content_type: "Title",
          criteria_type: "yes-no",
          context: "Universal",
          criteria_category: "Product Identification",
          criteria_definition: "The title must contain the product's brand name.",
          eval_definition: {
            definition_yes: "The brand name appears in the title.",
            definition_no: "The brand name is missing from the title.",
            yes_examples: ["Gold Peak Iced Tea, 18.5 fl oz"],
            no_examples: ["Iced Tea, 18.5 fl oz"],
          },
          weight: 1.0,
          active: true,
        },
        {
          criteria_name: "Description reads naturally",
          content_type: "Description",
          criteria_type: "numerical-scale",
          context: "Universal",
          criteria_category: "Structure and Readability",
          criteria_definition: "How naturally the description reads, 1 (poor) to 4 (excellent).",
          eval_definition: {
            score_1: { title: "Poor", definition: "Keyword-stuffed or incoherent.", example_1: "tea drink tea beverage cold tea" },
            score_2: { title: "Weak", definition: "Choppy or awkward phrasing." },
            score_3: { title: "Good", definition: "Reads clearly with minor issues." },
            score_4: { title: "Excellent", definition: "Fluent, natural, on-brand." },
          },
        },
        {
          criteria_name: "Number of concrete product specs",
          content_type: "Bullets/Specs",
          criteria_type: "numerical-count",
          criteria_definition: "How many concrete, verifiable specs are present.",
          eval_definition: {
            buckets: ["0", "1", "2", "3+"],
            bucket_titles: { "0": "None", "3+": "Rich" },
            bucket_definitions: {
              "0": "No concrete specs.",
              "1": "One concrete spec.",
              "2": "Two concrete specs.",
              "3+": "Three or more concrete specs.",
            },
          },
        },
      ],
    },
  ],
} as const;

import type { Criterion, EvalSuite, ProductCopy, EvalRun, Category, EvalRunScoreNode, EvalRunTaxonomySnapshot } from "@/types";

export const MOCK_CATEGORIES: Category[] = [
  { id: "all-copy", name: "All product copy" },
  { id: "amazon-platform", name: "Amazon Platform specific" },
  { id: "shopify", name: "Shopify specific" },
];

export const MOCK_CRITERIA: Criterion[] = [
  {
    id: "product-type-stated",
    customer: "Adidas",
    brand: "Main Brand",
    context: "Universal",
    content_type: "Title",
    criteria_category: "Product Identification",
    criteria_name: "Product Type Stated",
    criteria_definition: "The product type is explicitly stated in the title, making it immediately clear what the product is.",
    criteria_type: "yes-no",
    eval_definition: {
      definition_yes: "The product type (e.g., 'wireless earbuds', 'yoga mat') is clearly mentioned.",
      definition_no: "The product type is missing or vague.",
      yes_examples: [
        "ProFit Wireless Earbuds X3 with ANC, multipoint pairing, and IPX5 sweat resistance for all-day commuting.",
        "EcoFlex Yoga Mat - Non-Slip, extra wide, and dual-density cushioning for joint support during long sessions.",
      ],
      no_examples: [
        "ProFit X3",
        "Premium Quality Product with no clear product type, no use-case context, and no specific category language.",
      ],
    },
    weight: 1.0,
    active: true,
    created_at: "2025-01-15T10:00:00Z",
    updated_at: "2025-01-15T10:00:00Z",
  },
  {
    id: "customer-benefit",
    customer: "Puma",
    brand: "Main Brand",
    context: "Universal",
    content_type: "Description",
    criteria_category: "Relevant Product Attributes",
    criteria_name: "Customer Benefit",
    criteria_definition: "The copy outlines specific benefits to the customer, rather than just enumerating features.",
    criteria_type: "yes-no",
    eval_definition: {
      definition_yes: "Benefits are clearly articulated from the customer's perspective.",
      definition_no: "Only features are listed without customer benefit framing.",
      yes_examples: [
        "Keeps your coffee hot for 8 hours so your commute stays hassle-free, without needing reheating at work or in transit.",
      ],
      no_examples: [
        "Stainless steel body with 500ml capacity and screw cap, listed as specs only with no explanation of customer outcome or convenience.",
      ],
    },
    weight: 1.2,
    active: true,
    created_at: "2025-01-15T10:00:00Z",
    updated_at: "2025-01-15T10:00:00Z",
  },
  {
    id: "legal-compliance",
    customer: "Nike",
    brand: "Sub-Brand A",
    context: "Industry",
    content_type: "Description",
    criteria_category: "Claim Integrity",
    criteria_name: "Legal Compliance",
    criteria_definition: "Claims are supported by credible brand or third-party references.",
    criteria_type: "numerical-scale",
    eval_definition: {
      score_1: { title: "Non-compliant", definition: "Contains unsupported health or performance claims.", example_1: "'Cures back pain instantly' with no citation, study details, or qualifying language provided anywhere in the copy.", example_2: "'FDA approved' without evidence, certificate number, or approved product class context." },
      score_2: { title: "Partially compliant", definition: "Some claims lack proper substantiation.", example_1: "'Clinically tested' without source, sample size, methodology, or date.", example_2: "'Doctor recommended' without attribution to organization, practitioner credentials, or published review." },
      score_3: { title: "Mostly compliant", definition: "Most claims are properly supported.", example_1: "'Dermatologist tested (study, 2024)' with summary findings and linked method notes.", example_2: "'BPA-free certified by SGS' with certificate identifier and testing standard." },
      score_4: { title: "Fully compliant", definition: "All claims are verifiable and properly attributed." },
    },
    weight: 1.5,
    active: true,
    created_at: "2025-01-15T10:00:00Z",
    updated_at: "2025-01-15T10:00:00Z",
  },
  {
    id: "keywords-used",
    customer: "Reebok",
    brand: "Private Label",
    context: "Marketplace",
    marketplace_tag: "Amazon",
    content_type: "Title",
    criteria_category: "Relevant Product Attributes",
    criteria_name: "Number of Keywords Used",
    criteria_definition: "Number of SEO keywords naturally included in the copy.",
    criteria_type: "numerical-count",
    eval_definition: {
      buckets: ["0", "1", "2", "3+"],
      bucket_definitions: {
        "0": "No relevant keywords detected.",
        "1": "Only one keyword present.",
        "2": "Good keyword coverage without stuffing.",
        "3+": "Excellent keyword integration.",
      },
      bucket_examples: {
        "0": ["\"Great quality product\" with broad language only and no category-specific search terms for discoverability."],
        "1": ["\"Wireless earbuds with long battery\" including just one obvious keyword but limited long-tail query coverage."],
        "2": ["\"Wireless earbuds with noise cancelling and Bluetooth 5.3\" including two clear target terms used naturally."],
        "3+": ["\"Wireless earbuds, Bluetooth 5.3, ANC, deep bass, IPX5 waterproof\" covering multiple high-intent keywords without obvious stuffing."],
      },
    },
    weight: 0.8,
    active: true,
    created_at: "2025-01-15T10:00:00Z",
    updated_at: "2025-01-15T10:00:00Z",
  },
  {
    id: "logical-hierarchy",
    customer: "New Balance",
    brand: "Sub-Brand B",
    context: "Universal",
    content_type: "Bullets/Specs",
    criteria_category: "Structure and Readability",
    criteria_name: "Logical Hierarchy",
    criteria_definition: "Information is organized in a logical hierarchy for scannability.",
    criteria_type: "numerical-scale",
    eval_definition: {
      score_1: { title: "Disorganized", definition: "No logical structure; information scattered randomly.", example_1: "Mixing dimensions, materials, and benefits randomly", example_2: "Key specs buried within marketing language" },
      score_2: { title: "Weakly structured", definition: "Some grouping but inconsistent.", example_1: "Some related items grouped but no clear pattern", example_2: "Headers used but sections overlap" },
      score_3: { title: "Well structured", definition: "Clear logical groupings, mostly scannable.", example_1: "Specs grouped: dimensions, materials, care", example_2: "Benefits clearly separated from technical specs" },
      score_4: { title: "Excellently structured", definition: "Perfect hierarchy with clear visual and logical flow." },
    },
    weight: 1.0,
    active: true,
    created_at: "2025-01-15T10:00:00Z",
    updated_at: "2025-01-15T10:00:00Z",
  },
  {
    id: "reads-naturally",
    customer: "Under Armour",
    brand: "Main Brand",
    context: "Universal",
    content_type: "Description",
    criteria_category: "Structure and Readability",
    criteria_name: "Reads Naturally",
    criteria_definition: "The copy reads naturally and feels like it was written for a human audience.",
    criteria_type: "numerical-scale",
    eval_definition: {
      score_1: { title: "Robotic", definition: "Reads like keyword stuffing or machine-generated content.", example_1: "'Premium quality best wireless earbuds Bluetooth 5.0 noise cancelling'", example_2: "'Buy now best price yoga mat exercise fitness'" },
      score_2: { title: "Stilted", definition: "Grammatically correct but awkward phrasing.", example_1: "'This product features the capability of noise reduction'", example_2: "'The mat is made of material that provides comfort'" },
      score_3: { title: "Natural", definition: "Reads smoothly with minor awkward spots.", example_1: "'These earbuds deliver crystal-clear sound with active noise cancelling'", example_2: "'Our yoga mat keeps you comfortable and grounded'" },
      score_4: { title: "Polished", definition: "Reads like professionally crafted copy, engaging and effortless." },
    },
    weight: 1.0,
    active: false,
    created_at: "2025-01-15T10:00:00Z",
    updated_at: "2025-01-15T10:00:00Z",
  },
  {
    id: "audience-fit",
    customer: "Adidas",
    brand: "Main Brand",
    context: "Universal",
    content_type: "Description",
    criteria_category: "Relevant Product Attributes",
    criteria_name: "Audience Fit",
    criteria_definition: "The message is tailored to the intended shopper audience.",
    criteria_type: "yes-no",
    eval_definition: {
      definition_yes: "Language and emphasis align with target customer needs.",
      definition_no: "Copy is generic and not audience-specific.",
      yes_examples: [
        "Designed for daily commuters who need all-day comfort, fast pairing, and reliable battery life between meetings and travel.",
      ],
      no_examples: [
        "A great product for everyone, every lifestyle, and every use case, with no audience-specific language or differentiated benefit.",
      ],
    },
    weight: 1.0,
    active: true,
    created_at: "2025-01-16T10:00:00Z",
    updated_at: "2025-01-16T10:00:00Z",
  },
  {
    id: "feature-priority",
    customer: "Adidas",
    brand: "Main Brand",
    context: "Universal",
    content_type: "Bullets/Specs",
    criteria_category: "Relevant Product Attributes",
    criteria_name: "Feature Priority",
    criteria_definition: "The most important features appear first.",
    criteria_type: "numerical-scale",
    eval_definition: {
      score_1: { title: "Poor", definition: "Low-priority details come first.", example_1: "Warranty line first, core benefit buried." },
      score_2: { title: "Fair", definition: "Some important features appear early." },
      score_3: { title: "Good", definition: "Important features are mostly prioritized.", example_1: "Battery and comfort first, then dimensions." },
      score_4: { title: "Excellent", definition: "Critical decision-driving features are consistently first." },
    },
    weight: 1.1,
    active: true,
    created_at: "2025-01-16T10:00:00Z",
    updated_at: "2025-01-16T10:00:00Z",
  },
  {
    id: "benefit-density",
    customer: "Puma",
    brand: "Sub-Brand A",
    context: "Marketplace",
    marketplace_tag: "Amazon",
    content_type: "Description",
    criteria_category: "Relevant Product Attributes",
    criteria_name: "Benefit Density",
    criteria_definition: "The copy includes an appropriate number of distinct customer benefits.",
    criteria_type: "numerical-count",
    eval_definition: {
      buckets: ["0", "1", "2", "3+"],
      bucket_definitions: {
        "0": "No clear benefits are present.",
        "1": "Only one clear benefit is present.",
        "2": "Good number of benefits with clarity.",
        "3+": "Excellent breadth of benefits without clutter.",
      },
      bucket_examples: {
        "0": ["Only technical specs listed, with no statement of practical user outcomes or everyday shopper benefit."],
        "1": ["Mentions comfort only, without connecting it to commute, exercise, travel, or other real usage contexts."],
        "2": ["Mentions comfort, durability, and portability with clear but concise links to day-to-day customer value."],
        "3+": ["Mentions comfort, durability, portability, and easy maintenance, each tied to a specific shopper use case and buying motivation."],
      },
    },
    weight: 0.9,
    active: true,
    created_at: "2025-01-16T10:00:00Z",
    updated_at: "2025-01-16T10:00:00Z",
  },
  {
    id: "category-specific-claims",
    customer: "Nike",
    brand: "Sub-Brand B",
    context: "Industry",
    industry_tag: "Consumer Electronics",
    content_type: "Description",
    criteria_category: "Claim Integrity",
    criteria_name: "Category Specific Claims",
    criteria_definition: "Claims use category-appropriate language and substantiation.",
    criteria_type: "yes-no",
    eval_definition: {
      definition_yes: "Claims are specific, realistic, and supportable for the category.",
      definition_no: "Claims are vague, exaggerated, or unsupported.",
      yes_examples: ["Sweat-resistant for workouts with IPX5 rating."],
      no_examples: ["Completely waterproof in any condition."],
    },
    weight: 1.2,
    active: true,
    created_at: "2025-01-16T10:00:00Z",
    updated_at: "2025-01-16T10:00:00Z",
  },
  {
    id: "proof-presence",
    customer: "Nike",
    brand: "Sub-Brand B",
    context: "Industry",
    industry_tag: "Consumer Electronics",
    content_type: "Bullets/Specs",
    criteria_category: "Claim Integrity",
    criteria_name: "Proof Presence",
    criteria_definition: "Claims are paired with proof points or references.",
    criteria_type: "numerical-scale",
    eval_definition: {
      score_1: { title: "None", definition: "No supporting proof is provided." },
      score_2: { title: "Limited", definition: "Some claims include weak proof." },
      score_3: { title: "Strong", definition: "Most claims are backed by clear proof." },
      score_4: { title: "Complete", definition: "All claims include credible proof references." },
    },
    weight: 1.3,
    active: true,
    created_at: "2025-01-16T10:00:00Z",
    updated_at: "2025-01-16T10:00:00Z",
  },
  {
    id: "scan-optimized-headings",
    customer: "Reebok",
    brand: "Private Label",
    context: "Universal",
    content_type: "Bullets/Specs",
    criteria_category: "Structure and Readability",
    criteria_name: "Scan-Optimized Headings",
    criteria_definition: "Section headers aid quick scanning and comprehension.",
    criteria_type: "yes-no",
    eval_definition: {
      definition_yes: "Sections have concise, descriptive headings.",
      definition_no: "Sections are unlabelled or headings are unclear.",
      yes_examples: ["Battery Life", "Comfort & Fit", "Durability"],
      no_examples: ["Features", "More Info", "Details"],
    },
    weight: 0.8,
    active: true,
    created_at: "2025-01-16T10:00:00Z",
    updated_at: "2025-01-16T10:00:00Z",
  },
  {
    id: "sentence-length-balance",
    customer: "Reebok",
    brand: "Private Label",
    context: "Universal",
    content_type: "Description",
    criteria_category: "Structure and Readability",
    criteria_name: "Sentence Length Balance",
    criteria_definition: "Sentence lengths are varied for readability.",
    criteria_type: "numerical-scale",
    eval_definition: {
      score_1: { title: "Monotone", definition: "Uniform sentence lengths reduce readability." },
      score_2: { title: "Basic", definition: "Some variation but repetitive rhythm." },
      score_3: { title: "Balanced", definition: "Good variation with clear flow." },
      score_4: { title: "Excellent", definition: "Strong rhythm and readability throughout." },
    },
    weight: 0.9,
    active: true,
    created_at: "2025-01-16T10:00:00Z",
    updated_at: "2025-01-16T10:00:00Z",
  },
  // Universal / Title / Product Identification (expanded)
  {
    id: "model-name-clarity",
    context: "Universal",
    content_type: "Title",
    criteria_category: "Product Identification",
    criteria_name: "Model Name Clarity",
    criteria_definition: "Specific model/version naming is explicit and easy to parse.",
    criteria_type: "yes-no",
    eval_definition: { definition_yes: "Model naming is clear.", definition_no: "Model naming is missing or ambiguous." },
    weight: 2,
    active: true,
    created_at: "2025-01-20T10:00:00Z",
    updated_at: "2025-01-20T10:00:00Z",
  },
  {
    id: "variant-identifier",
    context: "Universal",
    content_type: "Title",
    criteria_category: "Product Identification",
    criteria_name: "Variant Identifier",
    criteria_definition: "Variant markers (size/color/edition) are clearly identified when relevant.",
    criteria_type: "yes-no",
    eval_definition: { definition_yes: "Variant is clear.", definition_no: "Variant context is unclear." },
    weight: 2,
    active: true,
    created_at: "2025-01-20T10:00:00Z",
    updated_at: "2025-01-20T10:00:00Z",
  },
  {
    id: "brand-leading-placement",
    context: "Universal",
    content_type: "Title",
    criteria_category: "Product Identification",
    criteria_name: "Brand Leading Placement",
    criteria_definition: "Brand appears in a clear, expected position.",
    criteria_type: "numerical-scale",
    eval_definition: {
      score_1: { title: "Missing", definition: "Brand is absent." },
      score_2: { title: "Late", definition: "Brand appears too late." },
      score_3: { title: "Visible", definition: "Brand is visible and understandable." },
      score_4: { title: "Excellent", definition: "Brand placement is clear and immediate." },
    },
    weight: 3,
    active: true,
    created_at: "2025-01-20T10:00:00Z",
    updated_at: "2025-01-20T10:00:00Z",
  },
  {
    id: "title-product-form-factor",
    context: "Universal",
    content_type: "Title",
    criteria_category: "Product Identification",
    criteria_name: "Product Form Factor",
    criteria_definition: "Form factor is unambiguous in the title.",
    criteria_type: "yes-no",
    eval_definition: { definition_yes: "Form factor is clear.", definition_no: "Form factor is vague." },
    weight: 2,
    active: true,
    created_at: "2025-01-20T10:00:00Z",
    updated_at: "2025-01-20T10:00:00Z",
  },
  {
    id: "pack-size-clarity",
    context: "Universal",
    content_type: "Title",
    criteria_category: "Product Identification",
    criteria_name: "Pack Size Clarity",
    criteria_definition: "Pack count or unit count is clearly stated where applicable.",
    criteria_type: "yes-no",
    eval_definition: { definition_yes: "Pack size is clear.", definition_no: "Pack size is missing." },
    weight: 0.7,
    active: true,
    created_at: "2025-01-20T10:00:00Z",
    updated_at: "2025-01-20T10:00:00Z",
  },
  {
    id: "unit-size-presence",
    context: "Universal",
    content_type: "Title",
    criteria_category: "Product Identification",
    criteria_name: "Unit Size Presence",
    criteria_definition: "Size/capacity is present when required by category.",
    criteria_type: "yes-no",
    eval_definition: { definition_yes: "Unit size is present.", definition_no: "Unit size is missing." },
    weight: 0.7,
    active: true,
    created_at: "2025-01-20T10:00:00Z",
    updated_at: "2025-01-20T10:00:00Z",
  },
  {
    id: "identifier-elements-count",
    context: "Universal",
    content_type: "Title",
    criteria_category: "Product Identification",
    criteria_name: "Identifier Elements Count",
    criteria_definition: "Counts how many essential identifying elements are present in title (brand/model/type/variant).",
    criteria_type: "numerical-count",
    eval_definition: {
      buckets: ["0", "1", "2", "3+"],
      bucket_titles: {
        "0": "None",
        "1": "Limited",
        "2": "Good",
        "3+": "Comprehensive",
      },
      bucket_definitions: {
        "0": "No key identifiers are present.",
        "1": "Only one key identifier is present.",
        "2": "Two key identifiers are present.",
        "3+": "Three or more identifiers are present.",
      },
      bucket_examples: {
        "0": ["Generic product title with no identifiable details."],
        "1": ["Only product type is present."],
        "2": ["Brand + product type included."],
        "3+": ["Brand + model + product type + variant included."],
      },
    },
    weight: 2,
    active: true,
    created_at: "2025-01-20T10:00:00Z",
    updated_at: "2025-01-20T10:00:00Z",
  },
  // Marketplace / Title / Relevant Product Attributes (expanded)
  {
    id: "title-core-benefit",
    context: "Marketplace",
    marketplace_tag: "Amazon",
    content_type: "Title",
    criteria_category: "Relevant Product Attributes",
    criteria_name: "Core Benefit Visibility",
    criteria_definition: "Primary shopper benefit is visible in the title.",
    criteria_type: "numerical-scale",
    eval_definition: {
      score_1: { title: "Hidden", definition: "No clear benefit." },
      score_2: { title: "Weak", definition: "Benefit mention is weak." },
      score_3: { title: "Clear", definition: "Benefit is clear." },
      score_4: { title: "Strong", definition: "Benefit is explicit and differentiated." },
    },
    weight: 1.0,
    active: true,
    created_at: "2025-01-20T10:00:00Z",
    updated_at: "2025-01-20T10:00:00Z",
  },
  {
    id: "title-technical-coverage",
    context: "Marketplace",
    marketplace_tag: "Amazon",
    content_type: "Title",
    criteria_category: "Relevant Product Attributes",
    criteria_name: "Technical Coverage",
    criteria_definition: "Essential technical attributes are included in title.",
    criteria_type: "yes-no",
    eval_definition: { definition_yes: "Core technical attributes are covered.", definition_no: "Technical coverage is missing." },
    weight: 0.9,
    active: true,
    created_at: "2025-01-20T10:00:00Z",
    updated_at: "2025-01-20T10:00:00Z",
  },
  {
    id: "title-differentiator",
    context: "Marketplace",
    marketplace_tag: "Amazon",
    content_type: "Title",
    criteria_category: "Relevant Product Attributes",
    criteria_name: "Differentiator Presence",
    criteria_definition: "A unique differentiator is present.",
    criteria_type: "yes-no",
    eval_definition: { definition_yes: "Differentiator is present.", definition_no: "No clear differentiator." },
    weight: 0.9,
    active: true,
    created_at: "2025-01-20T10:00:00Z",
    updated_at: "2025-01-20T10:00:00Z",
  },
  {
    id: "title-priority-order",
    context: "Marketplace",
    marketplace_tag: "Amazon",
    content_type: "Title",
    criteria_category: "Relevant Product Attributes",
    criteria_name: "Priority Attribute Order",
    criteria_definition: "Highest-value attributes appear first.",
    criteria_type: "numerical-scale",
    eval_definition: {
      score_1: { title: "Poor", definition: "Low-value attributes lead." },
      score_2: { title: "Fair", definition: "Mixed priority order." },
      score_3: { title: "Good", definition: "Mostly prioritized correctly." },
      score_4: { title: "Excellent", definition: "Consistently prioritized." },
    },
    weight: 1.0,
    active: true,
    created_at: "2025-01-20T10:00:00Z",
    updated_at: "2025-01-20T10:00:00Z",
  },
  {
    id: "title-keyword-balance",
    context: "Marketplace",
    marketplace_tag: "Amazon",
    content_type: "Title",
    criteria_category: "Relevant Product Attributes",
    criteria_name: "Keyword Balance",
    criteria_definition: "Keyword density is useful without stuffing.",
    criteria_type: "numerical-scale",
    eval_definition: {
      score_1: { title: "Stuffed", definition: "Reads spammy." },
      score_2: { title: "Heavy", definition: "Slightly over-optimized." },
      score_3: { title: "Balanced", definition: "Good balance." },
      score_4: { title: "Natural", definition: "Strong and natural integration." },
    },
    weight: 0.8,
    active: true,
    created_at: "2025-01-20T10:00:00Z",
    updated_at: "2025-01-20T10:00:00Z",
  },
  {
    id: "title-attribute-specificity",
    context: "Marketplace",
    marketplace_tag: "Amazon",
    content_type: "Title",
    criteria_category: "Relevant Product Attributes",
    criteria_name: "Attribute Specificity",
    criteria_definition: "Attribute claims are specific rather than generic.",
    criteria_type: "yes-no",
    eval_definition: { definition_yes: "Attributes are specific.", definition_no: "Attributes are generic." },
    weight: 0.8,
    active: true,
    created_at: "2025-01-20T10:00:00Z",
    updated_at: "2025-01-20T10:00:00Z",
  },
  // Industry / Description / Claim Integrity (expanded)
  {
    id: "substantiation-depth",
    context: "Industry",
    industry_tag: "Consumer Electronics",
    content_type: "Description",
    criteria_category: "Claim Integrity",
    criteria_name: "Substantiation Depth",
    criteria_definition: "Claims include sufficient supporting detail.",
    criteria_type: "numerical-scale",
    eval_definition: {
      score_1: { title: "None", definition: "No support details." },
      score_2: { title: "Low", definition: "Minimal support detail." },
      score_3: { title: "Good", definition: "Most claims have support context." },
      score_4: { title: "Strong", definition: "Strong substantiation depth throughout." },
    },
    weight: 1.2,
    active: true,
    created_at: "2025-01-20T10:00:00Z",
    updated_at: "2025-01-20T10:00:00Z",
  },
  {
    id: "risky-superlatives-control",
    context: "Industry",
    industry_tag: "Consumer Electronics",
    content_type: "Description",
    criteria_category: "Claim Integrity",
    criteria_name: "Risky Superlatives Control",
    criteria_definition: "Copy avoids unqualified superlative claims.",
    criteria_type: "yes-no",
    eval_definition: { definition_yes: "Superlatives are qualified or avoided.", definition_no: "Unqualified superlatives present." },
    weight: 1.0,
    active: true,
    created_at: "2025-01-20T10:00:00Z",
    updated_at: "2025-01-20T10:00:00Z",
  },
  {
    id: "compliance-qualifiers",
    context: "Industry",
    industry_tag: "Consumer Electronics",
    content_type: "Description",
    criteria_category: "Claim Integrity",
    criteria_name: "Compliance Qualifiers",
    criteria_definition: "Necessary qualifiers/disclaimers are included for sensitive claims.",
    criteria_type: "yes-no",
    eval_definition: { definition_yes: "Qualifiers are present.", definition_no: "Qualifiers are missing." },
    weight: 1.1,
    active: true,
    created_at: "2025-01-20T10:00:00Z",
    updated_at: "2025-01-20T10:00:00Z",
  },
  {
    id: "source-citation-clarity",
    context: "Industry",
    industry_tag: "Consumer Electronics",
    content_type: "Description",
    criteria_category: "Claim Integrity",
    criteria_name: "Source Citation Clarity",
    criteria_definition: "Cited sources are explicit and identifiable.",
    criteria_type: "numerical-scale",
    eval_definition: {
      score_1: { title: "Absent", definition: "No source citations." },
      score_2: { title: "Vague", definition: "Citations are vague." },
      score_3: { title: "Clear", definition: "Most sources are clear." },
      score_4: { title: "Explicit", definition: "All claims cite explicit sources." },
    },
    weight: 1.0,
    active: true,
    created_at: "2025-01-20T10:00:00Z",
    updated_at: "2025-01-20T10:00:00Z",
  },
  {
    id: "claim-specificity",
    context: "Industry",
    industry_tag: "Consumer Electronics",
    content_type: "Description",
    criteria_category: "Claim Integrity",
    criteria_name: "Claim Specificity",
    criteria_definition: "Claims are precise and measurable where possible.",
    criteria_type: "numerical-scale",
    eval_definition: {
      score_1: { title: "Vague", definition: "Claims are broad/vague." },
      score_2: { title: "Basic", definition: "Some measurable details." },
      score_3: { title: "Specific", definition: "Mostly specific claims." },
      score_4: { title: "Highly specific", definition: "Consistently specific and measurable." },
    },
    weight: 1.1,
    active: true,
    created_at: "2025-01-20T10:00:00Z",
    updated_at: "2025-01-20T10:00:00Z",
  },
];

export const MOCK_SUITES: EvalSuite[] = [
  {
    id: "suite-general-title",
    name: "General Title Quality",
    comment: "Standard evaluation suite for product titles across all contexts",
    criteria_ids: [
      "product-type-stated",
      "keywords-used",
      "logical-hierarchy",
      "audience-fit",
      "feature-priority",
      "benefit-density",
      "category-specific-claims",
      "proof-presence",
      "scan-optimized-headings",
      "sentence-length-balance",
    ],
    config: { max_retries: 2, temperature: 0.1 },
    created_at: "2025-02-01T09:00:00Z",
    updated_at: "2025-02-01T09:00:00Z",
  },
  {
    id: "suite-desc-compliance",
    name: "Description Compliance Check",
    comment: "Focused on claim integrity and readability for descriptions",
    criteria_ids: ["customer-benefit", "legal-compliance", "reads-naturally"],
    config: { max_retries: 3, temperature: 0.15 },
    created_at: "2025-02-05T14:00:00Z",
    updated_at: "2025-02-05T14:00:00Z",
  },
];

export const MOCK_COPIES: ProductCopy[] = [
  {
    id: "copy-1",
    product_name: "ProFit Wireless Earbuds X3",
    content_type: "Title",
    raw_text: "ProFit X3 Wireless Earbuds – Bluetooth 5.3, Active Noise Cancelling, 40H Battery, IPX5 Waterproof, Deep Bass",
    created_at: "2025-02-10T11:00:00Z",
    updated_at: "2025-02-10T11:00:00Z",
  },
  {
    id: "copy-2",
    product_name: "ProFit Wireless Earbuds X3",
    content_type: "Description",
    raw_text: "Experience immersive audio with ProFit X3 wireless earbuds. Featuring Bluetooth 5.3, active noise cancelling technology blocks out distractions while you enjoy rich, deep bass. With 40 hours of total battery life and IPX5 waterproof rating, these earbuds keep up with your active lifestyle. The ergonomic design ensures a secure, comfortable fit for all-day wear.",
    created_at: "2025-02-10T11:00:00Z",
    updated_at: "2025-02-10T11:00:00Z",
  },
  {
    id: "copy-3",
    product_name: "ZenFlex Premium Yoga Mat",
    content_type: "Bullets/Specs",
    raw_text: "• 6mm thick high-density TPE foam for joint protection\n• Non-slip textured surface on both sides\n• Dimensions: 72\" x 24\" — fits all body types\n• Lightweight (2.5 lbs) with carrying strap included\n• Free from PVC, latex, and toxic chemicals\n• Easy to clean with damp cloth",
    created_at: "2025-02-12T09:30:00Z",
    updated_at: "2025-02-12T09:30:00Z",
  },
  {
    id: "copy-4",
    product_name: "AeroPulse Sport Earbuds Pro",
    content_type: "Title",
    raw_text: "AeroPulse Sport Earbuds Pro - Secure Fit, ENC Calls, Sweat Resistant, 32H Battery, Fast Pair",
    created_at: "2025-02-12T10:00:00Z",
    updated_at: "2025-02-12T10:00:00Z",
  },
];

const CONTEXT_ORDER = ["Universal", "Industry", "Marketplace", "Brand"];

const buildPathKey = (context: string, contentType: string, branchTag?: string) =>
  context === "Universal" ? `${context}|${contentType}` : `${context}|${branchTag || ""}|${contentType}`;

const buildHierarchyForRun = (
  criterionScores: EvalRun["criterion_scores"],
): {
  taxonomy_snapshot: EvalRunTaxonomySnapshot;
  hierarchical_scores: Record<string, EvalRunScoreNode>;
  root_node_ids: string[];
} => {
  const criterionById = new Map(MOCK_CRITERIA.map((criterion) => [criterion.id, criterion]));
  const nodes: Record<string, EvalRunScoreNode> = {};
  const rootNodeIds: string[] = [];

  const branchTagsByContext = {
    Industry: [] as string[],
    Marketplace: [] as string[],
    Brand: [] as string[],
  };
  const categoriesByPath = new Map<string, Set<string>>();
  const contextsInRun = new Set<string>();
  const contentTypesInRun = new Set<string>();

  const addChild = (parentId: string | null, childId: string) => {
    if (!parentId) return;
    const parent = nodes[parentId];
    if (!parent) return;
    if (!parent.children_ids.includes(childId)) parent.children_ids.push(childId);
  };

  const ensureNode = (
    id: string,
    label: string,
    level: EvalRunScoreNode["level"],
    parentId: string | null,
    meta: EvalRunScoreNode["meta"],
  ) => {
    if (!nodes[id]) {
      nodes[id] = {
        id,
        label,
        level,
        parent_id: parentId,
        children_ids: [],
        raw_points: 0,
        max_points: 0,
        normalized_0_100: 0,
        meta,
      };
      if (!parentId && !rootNodeIds.includes(id)) rootNodeIds.push(id);
      addChild(parentId, id);
    }
    return nodes[id];
  };

  const normalizeCriterionScore = (criterion: Criterion, rawScore: number) => {
    if (criterion.criteria_type === "yes-no") return rawScore >= 1 ? 1 : 0.25;
    if (criterion.criteria_type === "numerical-scale") {
      const clamped = Math.max(1, Math.min(4, Math.round(rawScore)));
      return clamped / 4;
    }
    const rounded = Math.round(rawScore);
    if (rounded <= 0) return 0.25;
    if (rounded === 1) return 0.5;
    if (rounded === 2) return 0.75;
    return 1;
  };

  const toWeightTier = (weight: number | undefined) => {
    const rounded = Math.round(weight ?? 1);
    return Math.max(1, Math.min(3, rounded));
  };

  criterionScores.forEach((scoreEntry) => {
    const criterion = criterionById.get(scoreEntry.criterion_id);
    if (!criterion) return;

    const context = criterion.context;
    const contentType = criterion.content_type;
    const category = criterion.criteria_category;
    const branchTag = context === "Industry"
      ? criterion.industry_tag
      : context === "Marketplace"
        ? criterion.marketplace_tag
        : context === "Brand"
          ? criterion.brand_tag
          : undefined;
    const score01 = normalizeCriterionScore(criterion, scoreEntry.score);
    const maxPoints = toWeightTier(criterion.weight);
    const rawPoints = score01 * maxPoints;

    contextsInRun.add(context);
    contentTypesInRun.add(contentType);
    const pathKey = buildPathKey(context, contentType, branchTag);
    if (!categoriesByPath.has(pathKey)) categoriesByPath.set(pathKey, new Set<string>());
    categoriesByPath.get(pathKey)?.add(category);

    if (context === "Industry" && branchTag && !branchTagsByContext.Industry.includes(branchTag)) branchTagsByContext.Industry.push(branchTag);
    if (context === "Marketplace" && branchTag && !branchTagsByContext.Marketplace.includes(branchTag)) branchTagsByContext.Marketplace.push(branchTag);
    if (context === "Brand" && branchTag && !branchTagsByContext.Brand.includes(branchTag)) branchTagsByContext.Brand.push(branchTag);

    const contextNodeId = `context:${context}`;
    ensureNode(contextNodeId, context, "context", null, { context });

    const branchNodeId = context === "Universal" ? null : `branch:${context}:${branchTag || "unknown"}`;
    if (branchNodeId) ensureNode(branchNodeId, branchTag || "Unknown", "branch", contextNodeId, { context, branch_tag: branchTag || "Unknown" });

    const contentTypeNodeId = `content_type:${context}:${branchTag || ""}:${contentType}`;
    ensureNode(
      contentTypeNodeId,
      contentType,
      "content_type",
      branchNodeId || contextNodeId,
      { context, branch_tag: branchTag, content_type: contentType },
    );

    const categoryNodeId = `category:${context}:${branchTag || ""}:${contentType}:${category}`;
    ensureNode(
      categoryNodeId,
      category,
      "category",
      contentTypeNodeId,
      { context, branch_tag: branchTag, content_type: contentType, category },
    );

    const criterionNodeId = `criterion:${context}:${branchTag || ""}:${contentType}:${category}:${criterion.id}`;
    nodes[criterionNodeId] = {
      id: criterionNodeId,
      label: criterion.criteria_name,
      level: "criterion",
      parent_id: categoryNodeId,
      children_ids: [],
      raw_points: rawPoints,
      max_points: maxPoints,
      normalized_0_100: maxPoints > 0 ? (rawPoints / maxPoints) * 100 : 0,
      meta: { context, branch_tag: branchTag, content_type: contentType, category, criterion_id: criterion.id },
    };
    addChild(categoryNodeId, criterionNodeId);
  });

  const sumNode = (nodeId: string): { raw: number; max: number } => {
    const node = nodes[nodeId];
    if (!node) return { raw: 0, max: 0 };
    if (node.level === "criterion") return { raw: node.raw_points, max: node.max_points };
    const totals = node.children_ids.reduce(
      (acc, childId) => {
        const childTotals = sumNode(childId);
        return { raw: acc.raw + childTotals.raw, max: acc.max + childTotals.max };
      },
      { raw: 0, max: 0 },
    );
    node.raw_points = totals.raw;
    node.max_points = totals.max;
    node.normalized_0_100 = totals.max > 0 ? (totals.raw / totals.max) * 100 : 0;
    return totals;
  };

  rootNodeIds.forEach((rootId) => sumNode(rootId));
  rootNodeIds.sort((a, b) => {
    const aIdx = CONTEXT_ORDER.indexOf(nodes[a]?.label || "");
    const bIdx = CONTEXT_ORDER.indexOf(nodes[b]?.label || "");
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });

  return {
    taxonomy_snapshot: {
      contexts: CONTEXT_ORDER.filter((context) => contextsInRun.has(context)),
      contentTypes: ["Description", "Title", "Bullets/Specs", "Meta Description"].filter((contentType) => contentTypesInRun.has(contentType)),
      branchTagsByContext,
      categoriesByPath: Object.fromEntries(
        Array.from(categoriesByPath.entries()).map(([key, categories]) => [key, Array.from(categories)]),
      ),
    },
    hierarchical_scores: nodes,
    root_node_ids: rootNodeIds,
  };
};

const RUN_1_CRITERION_SCORES: EvalRun["criterion_scores"] = [
  { criterion_id: "product-type-stated", score: 1, normalized_score: 100, reasoning: "Product type 'Wireless Earbuds' is clearly stated in the title." },
  { criterion_id: "model-name-clarity", score: 1, normalized_score: 100, reasoning: "Model identifier is explicit and easy to parse." },
  { criterion_id: "variant-identifier", score: 1, normalized_score: 100, reasoning: "Variant cues are clear for shoppers." },
  { criterion_id: "brand-leading-placement", score: 3, normalized_score: 75, reasoning: "Brand placement is visible but not perfectly optimized." },
  { criterion_id: "title-product-form-factor", score: 1, normalized_score: 100, reasoning: "Form factor is immediately understandable." },
  { criterion_id: "pack-size-clarity", score: 0, normalized_score: 0, reasoning: "Pack-size information is not explicit in title." },
  { criterion_id: "unit-size-presence", score: 0, normalized_score: 0, reasoning: "Unit size is not present in title language." },
  { criterion_id: "identifier-elements-count", score: 3, normalized_score: 75, reasoning: "Three identifier elements are present in the title." },
  { criterion_id: "keywords-used", score: 3, normalized_score: 75, reasoning: "Keyword coverage is strong with high-intent terms included naturally." },
  { criterion_id: "title-core-benefit", score: 3, normalized_score: 75, reasoning: "Core benefit appears clearly in title framing." },
  { criterion_id: "title-technical-coverage", score: 1, normalized_score: 100, reasoning: "Core technical terms are included." },
  { criterion_id: "title-differentiator", score: 1, normalized_score: 100, reasoning: "Differentiator language is present." },
  { criterion_id: "title-priority-order", score: 3, normalized_score: 75, reasoning: "Attributes are mostly in priority order." },
  { criterion_id: "title-keyword-balance", score: 3, normalized_score: 75, reasoning: "Keyword density is strong without heavy stuffing." },
  { criterion_id: "title-attribute-specificity", score: 1, normalized_score: 100, reasoning: "Attribute phrasing is specific and concrete." },
  { criterion_id: "logical-hierarchy", score: 3, normalized_score: 75, reasoning: "Information follows a logical progression with room for tighter grouping." },
  { criterion_id: "audience-fit", score: 1, normalized_score: 100, reasoning: "Messaging aligns well with commuter and workout-focused shoppers." },
  { criterion_id: "feature-priority", score: 3, normalized_score: 75, reasoning: "Decision-driving features are mostly prioritized near the top." },
  { criterion_id: "benefit-density", score: 2, normalized_score: 60, reasoning: "Good benefit coverage, but a few claims are repetitive." },
  { criterion_id: "category-specific-claims", score: 1, normalized_score: 100, reasoning: "Category language is specific and mostly supportable." },
  { criterion_id: "substantiation-depth", score: 3, normalized_score: 75, reasoning: "Most claims include enough substantiation detail." },
  { criterion_id: "risky-superlatives-control", score: 1, normalized_score: 100, reasoning: "No unqualified superlatives detected." },
  { criterion_id: "compliance-qualifiers", score: 1, normalized_score: 100, reasoning: "Appropriate qualifiers are included for sensitive claims." },
  { criterion_id: "source-citation-clarity", score: 2, normalized_score: 50, reasoning: "Some cited details are vague and need clearer sourcing." },
  { criterion_id: "claim-specificity", score: 3, normalized_score: 75, reasoning: "Claims are mostly specific with measurable detail." },
  { criterion_id: "proof-presence", score: 2, normalized_score: 50, reasoning: "Some claims include proof, but several lack direct references." },
  { criterion_id: "scan-optimized-headings", score: 1, normalized_score: 100, reasoning: "Section labels support quick scanning and comprehension." },
  { criterion_id: "sentence-length-balance", score: 3, normalized_score: 75, reasoning: "Sentence rhythm is mostly balanced with minor monotony." },
];

const RUN_2_CRITERION_SCORES: EvalRun["criterion_scores"] = [
  { criterion_id: "product-type-stated", score: 1, normalized_score: 100, reasoning: "Product type is explicit and easy to identify at first glance." },
  { criterion_id: "model-name-clarity", score: 1, normalized_score: 100, reasoning: "Model token is clear and not ambiguous." },
  { criterion_id: "variant-identifier", score: 1, normalized_score: 100, reasoning: "Variant naming is understandable for comparison shopping." },
  { criterion_id: "brand-leading-placement", score: 3, normalized_score: 75, reasoning: "Brand appears early, though ordering could be tighter." },
  { criterion_id: "title-product-form-factor", score: 1, normalized_score: 100, reasoning: "Form factor is directly stated." },
  { criterion_id: "pack-size-clarity", score: 0, normalized_score: 0, reasoning: "Pack-size cue is missing from the title." },
  { criterion_id: "unit-size-presence", score: 0, normalized_score: 0, reasoning: "Unit size details are not present in title language." },
  { criterion_id: "identifier-elements-count", score: 3, normalized_score: 75, reasoning: "Three key identifier elements are present." },
  { criterion_id: "keywords-used", score: 3, normalized_score: 75, reasoning: "High-intent keywords are present without obvious stuffing." },
  { criterion_id: "title-core-benefit", score: 3, normalized_score: 75, reasoning: "Primary shopper benefit is visible in title framing." },
  { criterion_id: "title-technical-coverage", score: 1, normalized_score: 100, reasoning: "Important technical terms are included." },
  { criterion_id: "title-differentiator", score: 1, normalized_score: 100, reasoning: "Differentiator language is present and clear." },
  { criterion_id: "title-priority-order", score: 3, normalized_score: 75, reasoning: "Attributes are mostly arranged by buying priority." },
  { criterion_id: "title-keyword-balance", score: 3, normalized_score: 75, reasoning: "Keyword balance is good and remains readable." },
  { criterion_id: "title-attribute-specificity", score: 1, normalized_score: 100, reasoning: "Attribute wording is concrete and specific." },
  { criterion_id: "category-specific-claims", score: 1, normalized_score: 100, reasoning: "Category-specific claims are appropriate and supportable." },
  { criterion_id: "substantiation-depth", score: 3, normalized_score: 75, reasoning: "Most claims include sufficient supporting detail." },
  { criterion_id: "risky-superlatives-control", score: 1, normalized_score: 100, reasoning: "No unsupported superlatives were found." },
  { criterion_id: "compliance-qualifiers", score: 1, normalized_score: 100, reasoning: "Qualifiers are present where claim sensitivity is higher." },
  { criterion_id: "source-citation-clarity", score: 2, normalized_score: 50, reasoning: "Some citations need clearer attribution." },
  { criterion_id: "claim-specificity", score: 3, normalized_score: 75, reasoning: "Claims are specific with measurable language in most places." },
];

const toScaleScore = (normalized: number) => {
  if (normalized >= 88) return 4;
  if (normalized >= 63) return 3;
  if (normalized >= 38) return 2;
  return 1;
};

const toCountScore = (normalized: number) => {
  if (normalized >= 85) return 3;
  if (normalized >= 60) return 2;
  if (normalized >= 35) return 1;
  return 0;
};

const buildVariantScores = (scores: EvalRun["criterion_scores"]): EvalRun["criterion_scores"] =>
  scores.map((entry, index) => {
    const criterion = MOCK_CRITERIA.find((item) => item.id === entry.criterion_id);
    const offset = [-20, -10, 0, 8, 15][index % 5];
    const nextNormalized = Math.max(25, Math.min(100, entry.normalized_score + offset));
    let nextScore = entry.score;
    if (criterion?.criteria_type === "yes-no") nextScore = nextNormalized >= 55 ? 1 : 0;
    if (criterion?.criteria_type === "numerical-scale") nextScore = toScaleScore(nextNormalized);
    if (criterion?.criteria_type === "numerical-count") nextScore = toCountScore(nextNormalized);
    return {
      ...entry,
      score: nextScore,
      normalized_score: nextNormalized,
      reasoning: entry.reasoning,
    };
  });

const RUN_1_VARIANT_CRITERION_SCORES = buildVariantScores(RUN_1_CRITERION_SCORES);
const RUN_3_CRITERION_SCORES = buildVariantScores(RUN_2_CRITERION_SCORES);

export const MOCK_RUNS: EvalRun[] = [
  {
    id: "run-1",
    evaluation_title: "Q1 Audio PDP Readiness",
    brand: "ProFit",
    suite_id: "suite-general-title",
    product_copy_id: "copy-1",
    status: "completed",
    overall_score: 82,
    category_scores: {
      "Product Identification": 95,
      "Relevant Product Attributes": 75,
      "Structure and Readability": 78,
    },
    criterion_scores: RUN_1_CRITERION_SCORES,
    ...buildHierarchyForRun(RUN_1_CRITERION_SCORES),
    product_results: [
      {
        product_copy_id: "copy-1",
        overall_score: 82,
        category_scores: {
          "Product Identification": 89,
          "Relevant Product Attributes": 79,
          "Structure and Readability": 78,
          "Claim Integrity": 74,
        },
        criterion_scores: RUN_1_CRITERION_SCORES,
        ...buildHierarchyForRun(RUN_1_CRITERION_SCORES),
      },
      {
        product_copy_id: "copy-4",
        overall_score: 74,
        category_scores: {
          "Product Identification": 77,
          "Relevant Product Attributes": 73,
          "Structure and Readability": 72,
          "Claim Integrity": 69,
        },
        criterion_scores: RUN_1_VARIANT_CRITERION_SCORES,
        ...buildHierarchyForRun(RUN_1_VARIANT_CRITERION_SCORES),
      },
    ],
    input_summary: {
      source: "paste",
      products: [
        {
          product_name: "ProFit Wireless Earbuds X3",
          entries: [
            { content_type: "Title", raw_text: "ProFit Wireless Earbuds X3 - ANC, Bluetooth 5.3, 40H Battery" },
            { content_type: "Bullets/Specs", raw_text: "IPX5 sweat resistant\nFast USB-C charge\nMultipoint pairing" },
            { content_type: "Description", raw_text: "Compact earbuds with adaptive noise cancellation and deep bass tuning for everyday commuting." },
          ],
        },
        {
          product_name: "AeroPulse Sport Earbuds Pro",
          entries: [
            { content_type: "Title", raw_text: "AeroPulse Sport Earbuds Pro - Secure Fit, Sweatproof, 36H Playtime" },
            { content_type: "Description", raw_text: "Workout-focused earbuds built for stability, clear calls, and long battery performance." },
          ],
        },
      ],
    },
    started_at: "2025-02-15T14:00:00Z",
    completed_at: "2025-02-15T14:02:30Z",
  },
  {
    id: "run-2",
    evaluation_title: "Description Compliance Sprint",
    brand: "Luma Skin",
    suite_id: "suite-desc-compliance",
    product_copy_id: "copy-2",
    status: "completed",
    overall_score: 71,
    category_scores: {
      "Product Identification": 76,
      "Relevant Product Attributes": 86,
      "Claim Integrity": 82,
    },
    criterion_scores: RUN_2_CRITERION_SCORES,
    ...buildHierarchyForRun(RUN_2_CRITERION_SCORES),
    input_summary: {
      source: "import",
      import_file_name: "luma-skin-description-batch.csv",
      products: [
        {
          product_name: "Luma Retinol Night Serum",
          entries: [{ content_type: "Description", raw_text: "Imported via file" }],
        },
      ],
    },
    started_at: "2025-02-15T14:05:00Z",
    completed_at: "2025-02-15T14:07:15Z",
  },
  {
    id: "run-3",
    evaluation_title: "Yoga Mat Listing QA Batch",
    brand: "ZenFlex",
    suite_id: "suite-general-title",
    product_copy_id: "copy-3",
    status: "completed",
    overall_score: 77,
    category_scores: {
      "Product Identification": 72,
      "Relevant Product Attributes": 78,
      "Claim Integrity": 69,
    },
    criterion_scores: RUN_3_CRITERION_SCORES,
    ...buildHierarchyForRun(RUN_3_CRITERION_SCORES),
    input_summary: {
      source: "import",
      import_file_name: "zenflex-listings-q1.json",
      products: [
        {
          product_name: "ZenFlex Premium Yoga Mat",
          entries: [
            { content_type: "Title", raw_text: "ZenFlex Premium Yoga Mat - Non-Slip Grip, 6mm Cushion, Carry Strap" },
            { content_type: "Description", raw_text: "Imported listing copy for flexibility, grip confidence, and long-session comfort." },
          ],
        },
      ],
    },
    started_at: "2025-02-26T10:30:00Z",
    completed_at: "2025-02-26T10:36:40Z",
  },
];

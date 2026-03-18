import { CONTENT_TYPES, CONTEXTS, DEFAULT_CATEGORIES } from "@/config/hierarchy";
import { MOCK_CRITERIA } from "@/data/mock-data";
import type { Criterion, CustomTagCategory } from "@/types";

const CRITERIA_STORAGE_KEY = "copyvibe.criteria";
const TAXONOMY_STORAGE_KEY = "copyvibe.taxonomy";

const normalizeTag = (value: string) => value.trim().replace(/\s+/g, " ");
const uniqueTags = (values: string[]) => Array.from(new Set(values.map(normalizeTag).filter(Boolean))).sort((a, b) => a.localeCompare(b));
const normalizeContextValue = (value: string) => (value === "General" ? "Universal" : value);

export interface ManagedTaxonomy {
  contexts: string[];
  contentTypes: string[];
  criteriaCategories: string[];
  criteriaCategoriesByContextAndContentType: Record<string, Record<string, string[]>>;
  criteriaCategoriesByContentType: Record<string, string[]>;
  branchTags: {
    brands: string[];
    industries: string[];
    marketplaces: string[];
  };
  customTagCategories: CustomTagCategory[];
}

const INDUSTRY_SEED = [
  "Apparel & Footwear",
  "Food & Beverage",
  "Outdoor & Recreation",
  "Consumer Electronics",
  "Home & Furniture",
  "Health & Household",
  "Beauty & Personal Care",
];

const MARKETPLACE_SEED = ["Target", "Kroger", "Walmart", "Instacart", "Amazon"];

const BRAND_SEED = ["Adidas", "Nike", "Puma", "Reebok", "New Balance"];

const CATEGORY_SEED_BY_CONTEXT_AND_CONTENT_TYPE: Record<string, Record<string, string[]>> = {
  Universal: {
    Description: ["Benefit Communication", "Feature Coverage", "Readability and Flow", "Call to Action Clarity"],
    Title: ["Product Type Clarity", "Primary Benefit Clarity", "Keyword Presence", "Length and Scannability"],
    "Bullets/Specs": ["Spec Completeness", "Attribute Prioritization", "Scannability", "Format Consistency"],
    "Meta Description": ["Search Intent Match", "Keyword Placement", "Value Proposition", "Length Compliance"],
  },
  Industry: {
    Description: ["Industry Terminology", "Regulatory Framing", "Use Case Relevance", "Claim Substantiation"],
    Title: ["Category Terminology", "Compliance-Safe Wording", "Audience Fit", "Differentiation"],
    "Bullets/Specs": ["Technical Accuracy", "Required Disclosures", "Category-Specific Attributes", "Spec Hierarchy"],
    "Meta Description": ["Industry Keyword Targeting", "Trust Signals", "Compliance Tone", "SERP Differentiation"],
  },
  Marketplace: {
    Description: ["Marketplace Policy Compliance", "Conversion Focus", "Discoverability", "Listing Clarity"],
    Title: ["Marketplace Keyword Alignment", "Character Limit Fit", "Variant Distinction", "Promo Readiness"],
    "Bullets/Specs": ["Bullet Policy Compliance", "Buy-Decision Attributes", "Mobile Scannability", "Competitive Differentiation"],
    "Meta Description": ["Marketplace Search Relevance", "Click Appeal", "Policy Safety", "Query Coverage"],
  },
  Brand: {
    Description: ["Brand Voice Alignment", "Brand Story Consistency", "Audience Positioning", "Tone Consistency"],
    Title: ["Brand Naming Conventions", "Voice Consistency", "Portfolio Differentiation", "Brand Promise Clarity"],
    "Bullets/Specs": ["Brand Messaging Pillars", "Signature Attribute Framing", "Tone in Short Form", "Proof Point Integration"],
    "Meta Description": ["Brand Voice in SERP", "Message Consistency", "Positioning Clarity", "Brand Recall"],
  },
};

const deriveCustomTagCategories = (criteria: Criterion[]): CustomTagCategory[] => {
  const categoryMap = new Map<string, Set<string>>();
  criteria.forEach((criterion) => {
    Object.entries(criterion.custom_tags || {}).forEach(([categoryName, tags]) => {
      const next = categoryMap.get(categoryName) || new Set<string>();
      tags.forEach((tag) => next.add(tag));
      categoryMap.set(categoryName, next);
    });
  });
  return Array.from(categoryMap.entries())
    .map(([name, tags]) => ({ name, tags: Array.from(tags).sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

const getSeedCategoriesForPair = (context: string, contentType: string) =>
  CATEGORY_SEED_BY_CONTEXT_AND_CONTENT_TYPE[context]?.[contentType] || DEFAULT_CATEGORIES;

const deriveCriteriaCategoriesByContextAndContentType = (
  criteria: Criterion[],
): Record<string, Record<string, string[]>> => {
  const map = new Map<string, Map<string, Set<string>>>();

  CONTEXTS.forEach((context) => {
    const contextMap = new Map<string, Set<string>>();
    CONTENT_TYPES.forEach((contentType) => {
      contextMap.set(contentType, new Set(getSeedCategoriesForPair(context, contentType)));
    });
    map.set(context, contextMap);
  });

  criteria.forEach((criterion) => {
    const context = normalizeTag(normalizeContextValue(criterion.context || ""));
    const contentType = normalizeTag(criterion.content_type || "");
    const category = normalizeTag(criterion.criteria_category || "");
    if (!context || !contentType || !category) return;

    const contextMap = map.get(context) || new Map<string, Set<string>>();
    const nextCategories = contextMap.get(contentType) || new Set(getSeedCategoriesForPair(context, contentType));
    nextCategories.add(category);
    contextMap.set(contentType, nextCategories);
    map.set(context, contextMap);
  });

  return Object.fromEntries(
    Array.from(map.entries()).map(([context, contentTypeMap]) => [
      context,
      Object.fromEntries(
        Array.from(contentTypeMap.entries()).map(([contentType, categories]) => [
          contentType,
          Array.from(categories).sort((a, b) => a.localeCompare(b)),
        ]),
      ),
    ]),
  );
};

const flattenCategoriesByContentType = (
  categoriesByContextAndContentType: Record<string, Record<string, string[]>>,
): Record<string, string[]> =>
  Object.fromEntries(
    CONTENT_TYPES.map((contentType) => [
      contentType,
      uniqueTags(
        CONTEXTS.flatMap((context) => categoriesByContextAndContentType[context]?.[contentType] || []),
      ),
    ]),
  );

const deriveBranchTags = (criteria: Criterion[]) => {
  const brands = new Set(BRAND_SEED);
  const industries = new Set(INDUSTRY_SEED);
  const marketplaces = new Set(MARKETPLACE_SEED);

  criteria.forEach((criterion) => {
    if (criterion.brand_tag) brands.add(normalizeTag(criterion.brand_tag));
    if (criterion.industry_tag) industries.add(normalizeTag(criterion.industry_tag));
    if (criterion.marketplace_tag) marketplaces.add(normalizeTag(criterion.marketplace_tag));

    const legacyBrand = criterion.custom_tags?.Brand?.[0];
    const legacyIndustry = criterion.custom_tags?.Industry?.[0];
    const legacyMarketplace = criterion.custom_tags?.Marketplace?.[0];
    if (legacyBrand) brands.add(normalizeTag(legacyBrand));
    if (legacyIndustry) industries.add(normalizeTag(legacyIndustry));
    if (legacyMarketplace) marketplaces.add(normalizeTag(legacyMarketplace));
    if (criterion.brand) brands.add(normalizeTag(criterion.brand));
  });

  return {
    brands: Array.from(brands).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    industries: Array.from(industries).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    marketplaces: Array.from(marketplaces).filter(Boolean).sort((a, b) => a.localeCompare(b)),
  };
};

const mapLegacyCriterionFields = (criterion: Criterion): Criterion => {
  const normalizedContext = normalizeContextValue(criterion.context);
  const nextCriterion = normalizedContext === criterion.context
    ? criterion
    : { ...criterion, context: normalizedContext };

  const customTags = nextCriterion.custom_tags || {};
  if (nextCriterion.context === "Brand" && !nextCriterion.brand_tag && customTags.Brand?.[0]) {
    return { ...nextCriterion, brand_tag: customTags.Brand[0] };
  }
  if (nextCriterion.context === "Industry" && !nextCriterion.industry_tag && customTags.Industry?.[0]) {
    return { ...nextCriterion, industry_tag: customTags.Industry[0] };
  }
  if (nextCriterion.context === "Marketplace" && !nextCriterion.marketplace_tag && customTags.Marketplace?.[0]) {
    return { ...nextCriterion, marketplace_tag: customTags.Marketplace[0] };
  }
  return nextCriterion;
};

export const buildDefaultTaxonomy = (criteria: Criterion[] = MOCK_CRITERIA): ManagedTaxonomy => {
  const criteriaCategoriesByContextAndContentType = deriveCriteriaCategoriesByContextAndContentType(criteria);
  return {
    contexts: [...CONTEXTS],
    contentTypes: [...CONTENT_TYPES],
    criteriaCategories: uniqueTags(Object.values(criteriaCategoriesByContextAndContentType).flatMap((value) => Object.values(value).flat())),
    criteriaCategoriesByContextAndContentType,
    criteriaCategoriesByContentType: flattenCategoriesByContentType(criteriaCategoriesByContextAndContentType),
    branchTags: deriveBranchTags(criteria),
    customTagCategories: deriveCustomTagCategories(criteria),
  };
};

export const loadRuntimeCriteria = (): Criterion[] => {
  try {
    const raw = window.localStorage.getItem(CRITERIA_STORAGE_KEY);
    if (!raw) return MOCK_CRITERIA.map(mapLegacyCriterionFields);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return MOCK_CRITERIA.map(mapLegacyCriterionFields);
    return (parsed as Criterion[]).map(mapLegacyCriterionFields);
  } catch {
    return MOCK_CRITERIA.map(mapLegacyCriterionFields);
  }
};

export const saveRuntimeCriteria = (criteria: Criterion[]) => {
  window.localStorage.setItem(CRITERIA_STORAGE_KEY, JSON.stringify(criteria));
};

export const loadManagedTaxonomy = (criteria: Criterion[] = loadRuntimeCriteria()): ManagedTaxonomy => {
  const defaults = buildDefaultTaxonomy(criteria);
  try {
    const raw = window.localStorage.getItem(TAXONOMY_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<ManagedTaxonomy> & {
      criteriaCategoriesByContentType?: Record<string, unknown>;
    };
    const contexts = defaults.contexts;
    const contentTypes = defaults.contentTypes;

    const rawCriteriaByContentType = parsed.criteriaCategoriesByContentType;
    const rawCriteriaByContextAndContentType = parsed.criteriaCategoriesByContextAndContentType;
    const criteriaCategoriesByContextAndContentType = contexts.reduce<Record<string, Record<string, string[]>>>((contextAcc, context) => {
      contextAcc[context] = contentTypes.reduce<Record<string, string[]>>((contentTypeAcc, contentType) => {
        const fromNewShape =
          rawCriteriaByContextAndContentType &&
          typeof rawCriteriaByContextAndContentType === "object" &&
          typeof (rawCriteriaByContextAndContentType as Record<string, unknown>)[context] === "object" &&
          Array.isArray(((rawCriteriaByContextAndContentType as Record<string, unknown>)[context] as Record<string, unknown>)[contentType])
            ? ((((rawCriteriaByContextAndContentType as Record<string, unknown>)[context] as Record<string, unknown>)[contentType] as unknown[]).filter(
                (entry): entry is string => typeof entry === "string",
              ))
            : null;

        const fromLegacyShape =
          fromNewShape === null &&
          rawCriteriaByContentType &&
          typeof rawCriteriaByContentType === "object" &&
          Array.isArray((rawCriteriaByContentType as Record<string, unknown>)[contentType])
            ? ((rawCriteriaByContentType as Record<string, unknown>)[contentType] as unknown[]).filter(
                (entry): entry is string => typeof entry === "string",
              )
            : null;

        const fallback = defaults.criteriaCategoriesByContextAndContentType[context]?.[contentType] || [];
        const parsedValues = fromNewShape ?? fromLegacyShape ?? [];
        contentTypeAcc[contentType] = uniqueTags([...fallback, ...parsedValues]);
        return contentTypeAcc;
      }, {});
      return contextAcc;
    }, {});

    const criteriaCategories = uniqueTags([
      ...(Array.isArray(parsed.criteriaCategories)
        ? parsed.criteriaCategories.filter((entry): entry is string => typeof entry === "string")
        : []),
      ...Object.values(criteriaCategoriesByContextAndContentType).flatMap((value) => Object.values(value).flat()),
    ]);
    const criteriaCategoriesByContentType = flattenCategoriesByContentType(criteriaCategoriesByContextAndContentType);

    const rawBranchTags = parsed.branchTags;
    const branchTags = {
      brands:
        rawBranchTags &&
        typeof rawBranchTags === "object" &&
        Array.isArray((rawBranchTags as Record<string, unknown>).brands)
          ? uniqueTags(
              ((rawBranchTags as Record<string, unknown>).brands as unknown[]).filter(
                (entry): entry is string => typeof entry === "string",
              ),
            )
          : defaults.branchTags.brands,
      industries:
        rawBranchTags &&
        typeof rawBranchTags === "object" &&
        Array.isArray((rawBranchTags as Record<string, unknown>).industries)
          ? uniqueTags(
              ((rawBranchTags as Record<string, unknown>).industries as unknown[]).filter(
                (entry): entry is string => typeof entry === "string",
              ),
            )
          : defaults.branchTags.industries,
      marketplaces:
        rawBranchTags &&
        typeof rawBranchTags === "object" &&
        Array.isArray((rawBranchTags as Record<string, unknown>).marketplaces)
          ? uniqueTags(
              ((rawBranchTags as Record<string, unknown>).marketplaces as unknown[]).filter(
                (entry): entry is string => typeof entry === "string",
              ),
            )
          : defaults.branchTags.marketplaces,
    };

    const customTagCategories = Array.isArray(parsed.customTagCategories)
      ? parsed.customTagCategories
          .filter((category): category is CustomTagCategory => Boolean(category && typeof category === "object" && typeof category.name === "string"))
          .map((category) => ({
            name: normalizeTag(category.name),
            tags: uniqueTags(Array.isArray(category.tags) ? category.tags.filter((entry): entry is string => typeof entry === "string") : []),
          }))
          .filter((category) => category.name)
          .sort((a, b) => a.name.localeCompare(b.name))
      : defaults.customTagCategories;

    return {
      contexts,
      contentTypes,
      criteriaCategories,
      criteriaCategoriesByContextAndContentType,
      criteriaCategoriesByContentType,
      branchTags,
      customTagCategories,
    };
  } catch {
    return defaults;
  }
};

export const saveManagedTaxonomy = (taxonomy: ManagedTaxonomy) => {
  window.localStorage.setItem(TAXONOMY_STORAGE_KEY, JSON.stringify(taxonomy));
};

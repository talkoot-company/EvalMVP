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

const deriveCriteriaCategoriesByContentType = (
  criteria: Criterion[],
): Record<string, string[]> => {
  const map = new Map<string, Set<string>>();
  CONTENT_TYPES.forEach((contentType) => {
    map.set(contentType, new Set(DEFAULT_CATEGORIES));
  });
  criteria.forEach((criterion) => {
    const contentType = normalizeTag(criterion.content_type || "");
    const category = normalizeTag(criterion.criteria_category || "");
    if (!contentType || !category) return;
    const next = map.get(contentType) || new Set<string>();
    next.add(category);
    map.set(contentType, next);
  });
  return Object.fromEntries(
    Array.from(map.entries()).map(([contentType, categories]) => [
      contentType,
      Array.from(categories).sort((a, b) => a.localeCompare(b)),
    ]),
  );
};

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

export const buildDefaultTaxonomy = (criteria: Criterion[] = MOCK_CRITERIA): ManagedTaxonomy => ({
  contexts: [...CONTEXTS],
  contentTypes: [...CONTENT_TYPES],
  criteriaCategories: uniqueTags([...DEFAULT_CATEGORIES, ...criteria.map((criterion) => criterion.criteria_category)]),
  criteriaCategoriesByContentType: deriveCriteriaCategoriesByContentType(criteria),
  branchTags: deriveBranchTags(criteria),
  customTagCategories: deriveCustomTagCategories(criteria),
});

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
    const parsed = JSON.parse(raw) as Partial<ManagedTaxonomy>;
    const contexts = defaults.contexts;
    const contentTypes = defaults.contentTypes;
    const criteriaCategories = Array.isArray(parsed.criteriaCategories)
      ? parsed.criteriaCategories.filter((entry): entry is string => typeof entry === "string")
      : defaults.criteriaCategories;

    const rawCriteriaByContentType = parsed.criteriaCategoriesByContentType;
    const criteriaCategoriesByContentType = contentTypes.reduce<Record<string, string[]>>((acc, contentType) => {
      const fromParsed =
        rawCriteriaByContentType &&
        typeof rawCriteriaByContentType === "object" &&
        Array.isArray((rawCriteriaByContentType as Record<string, unknown>)[contentType])
          ? ((rawCriteriaByContentType as Record<string, unknown>)[contentType] as unknown[]).filter(
              (entry): entry is string => typeof entry === "string",
            )
          : defaults.criteriaCategoriesByContentType[contentType] || [];
      acc[contentType] = uniqueTags(fromParsed);
      return acc;
    }, {});

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
      criteriaCategories: uniqueTags(criteriaCategories),
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

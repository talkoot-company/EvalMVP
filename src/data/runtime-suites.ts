import { MOCK_SUITES } from "@/data/mock-data";
import type { EvalSuite } from "@/types";

const SUITES_STORAGE_KEY = "copyvibe.suites";

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const normalizeContextValue = (value: string) => (value === "General" ? "Universal" : value);

const sanitizeSuite = (suite: unknown): EvalSuite | null => {
  if (!suite || typeof suite !== "object") return null;
  const candidate = suite as Partial<EvalSuite>;
  if (typeof candidate.id !== "string" || !candidate.id.trim()) return null;
  if (typeof candidate.name !== "string" || !candidate.name.trim()) return null;
  if (typeof candidate.comment !== "string") return null;
  if (!isStringArray(candidate.criteria_ids)) return null;
  if (!candidate.config || typeof candidate.config !== "object") return null;
  if (typeof candidate.created_at !== "string" || typeof candidate.updated_at !== "string") return null;

  const rawConfig = candidate.config as Record<string, unknown>;
  const normalizedConfig: Record<string, unknown> = { ...rawConfig };
  if (isStringArray(rawConfig.contexts)) {
    normalizedConfig.contexts = rawConfig.contexts.map(normalizeContextValue);
  }

  return {
    id: candidate.id,
    name: candidate.name,
    comment: candidate.comment,
    criteria_ids: candidate.criteria_ids,
    config: normalizedConfig,
    created_at: candidate.created_at,
    updated_at: candidate.updated_at,
  };
};

export const loadRuntimeSuites = (): EvalSuite[] => {
  try {
    const raw = window.localStorage.getItem(SUITES_STORAGE_KEY);
    if (!raw) return MOCK_SUITES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return MOCK_SUITES;
    const sanitized = parsed.map(sanitizeSuite).filter((suite): suite is EvalSuite => Boolean(suite));
    return sanitized.length > 0 ? sanitized : MOCK_SUITES;
  } catch {
    return MOCK_SUITES;
  }
};

export const saveRuntimeSuites = (suites: EvalSuite[]) => {
  window.localStorage.setItem(SUITES_STORAGE_KEY, JSON.stringify(suites));
};

export const deleteCustomTagFromRuntimeSuites = (categoryName: string, tagName: string) => {
  const normalizedCategory = categoryName.trim();
  const normalizedTag = tagName.trim();
  if (!normalizedCategory || !normalizedTag) return;

  const nextSuites = loadRuntimeSuites().map((suite) => {
    const customTags = suite.config.custom_tags;
    if (!customTags || typeof customTags !== "object") return suite;

    const tagsByCategory = customTags as Record<string, unknown>;
    const currentTags = tagsByCategory[normalizedCategory];
    if (!Array.isArray(currentTags)) return suite;

    const nextTags = currentTags.filter(
      (tag): tag is string => typeof tag === "string" && tag !== normalizedTag,
    );

    const nextCustomTags: Record<string, unknown> = { ...tagsByCategory };
    if (nextTags.length > 0) nextCustomTags[normalizedCategory] = nextTags;
    else delete nextCustomTags[normalizedCategory];

    return {
      ...suite,
      config: {
        ...suite.config,
        custom_tags: nextCustomTags,
      },
      updated_at: new Date().toISOString(),
    };
  });

  saveRuntimeSuites(nextSuites);
};

export const deleteCustomCategoryFromRuntimeSuites = (categoryName: string) => {
  const normalizedCategory = categoryName.trim();
  if (!normalizedCategory) return;

  const nextSuites = loadRuntimeSuites().map((suite) => {
    const customTags = suite.config.custom_tags;
    if (!customTags || typeof customTags !== "object") return suite;

    const tagsByCategory = customTags as Record<string, unknown>;
    if (!(normalizedCategory in tagsByCategory)) return suite;

    const nextCustomTags: Record<string, unknown> = { ...tagsByCategory };
    delete nextCustomTags[normalizedCategory];

    return {
      ...suite,
      config: {
        ...suite.config,
        custom_tags: nextCustomTags,
      },
      updated_at: new Date().toISOString(),
    };
  });

  saveRuntimeSuites(nextSuites);
};

import { describe, expect, it } from "vitest";
import { buildDefaultTaxonomy } from "@/data/runtime-taxonomy";
import { MOCK_RUNS } from "@/data/mock-data";
import type { Criterion } from "@/types";

describe("branch-aware taxonomy", () => {
  it("supports branch-specific categories per context/content type", () => {
    const criteria: Criterion[] = [
      {
        id: "industry-apparel-1",
        context: "Industry",
        industry_tag: "Apparel & Footwear",
        content_type: "Description",
        criteria_category: "Fabric Claims",
        criteria_name: "Fabric Claims",
        criteria_definition: "Checks fabric claims",
        criteria_type: "yes-no",
        eval_definition: { definition_yes: "yes", definition_no: "no" },
        weight: 1,
        active: true,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      },
      {
        id: "industry-beauty-1",
        context: "Industry",
        industry_tag: "Beauty & Personal Care",
        content_type: "Description",
        criteria_category: "Ingredient Compliance",
        criteria_name: "Ingredient Compliance",
        criteria_definition: "Checks ingredient claims",
        criteria_type: "yes-no",
        eval_definition: { definition_yes: "yes", definition_no: "no" },
        weight: 1,
        active: true,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      },
    ];

    const taxonomy = buildDefaultTaxonomy(criteria);
    const apparelCategories = taxonomy.criteriaCategoriesByContextBranchAndContentType.Industry["Apparel & Footwear"]?.Description || [];
    const beautyCategories = taxonomy.criteriaCategoriesByContextBranchAndContentType.Industry["Beauty & Personal Care"]?.Description || [];

    expect(apparelCategories).toContain("Fabric Claims");
    expect(beautyCategories).toContain("Ingredient Compliance");
    expect(apparelCategories).not.toContain("Ingredient Compliance");
  });
});

describe("weighted run hierarchy rollups", () => {
  it("computes weighted sums from criteria up through parent nodes", () => {
    const run = MOCK_RUNS.find((candidate) => candidate.id === "run-1");
    expect(run).toBeDefined();
    expect(run?.hierarchical_scores).toBeDefined();

    const nodes = run!.hierarchical_scores!;
    const universal = nodes["context:Universal"];
    const marketplace = nodes["context:Marketplace"];
    const productType = Object.values(nodes).find((node) => node.level === "criterion" && node.meta?.criterion_id === "product-type-stated");
    const keywords = Object.values(nodes).find((node) => node.level === "criterion" && node.meta?.criterion_id === "keywords-used");

    expect(productType).toBeDefined();
    expect(keywords).toBeDefined();
    expect(productType!.raw_points).toBeCloseTo(1, 5);
    expect(productType!.max_points).toBeCloseTo(1, 5);
    expect(keywords!.raw_points).toBeCloseTo(1, 5);
    expect(keywords!.max_points).toBeCloseTo(1, 5);

    const sumChildren = (nodeId: string) => {
      const node = nodes[nodeId];
      return node.children_ids.reduce(
        (acc, childId) => {
          const child = nodes[childId];
          return { raw: acc.raw + (child?.raw_points || 0), max: acc.max + (child?.max_points || 0) };
        },
        { raw: 0, max: 0 },
      );
    };

    const universalChildTotals = sumChildren("context:Universal");
    const marketplaceChildTotals = sumChildren("context:Marketplace");

    expect(universal.raw_points).toBeCloseTo(universalChildTotals.raw, 5);
    expect(universal.max_points).toBeCloseTo(universalChildTotals.max, 5);
    expect(marketplace.raw_points).toBeCloseTo(marketplaceChildTotals.raw, 5);
    expect(marketplace.max_points).toBeCloseTo(marketplaceChildTotals.max, 5);
  });
});

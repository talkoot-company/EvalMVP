import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CriteriaPage from "@/pages/CriteriaPage";

describe("CriteriaPage smoke", () => {
  it("renders with legacy taxonomy payload in localStorage", async () => {
    window.localStorage.setItem(
      "copyvibe.taxonomy",
      JSON.stringify({
        contexts: ["Universal", "Industry", "Marketplace", "Brand"],
        contentTypes: ["Description", "Title", "Bullets/Specs", "Meta Description"],
        criteriaCategoriesByContextAndContentType: {
          Universal: { Title: ["Product Identification"] },
        },
        // Intentionally malformed new field to simulate old/bad saved payload.
        criteriaCategoriesByContextBranchAndContentType: {
          Industry: null,
        },
      }),
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <CriteriaPage />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Criteria")).toBeInTheDocument();
  });
});

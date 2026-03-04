

## Criteria Hierarchy: Analysis and Recommendation

### Current State

Right now, hierarchy is handled via **flat tags on each criterion** — `context`, `content_type`, and `criteria_category` are string fields. This is actually close to the ideal MVP approach.

### The Two Options

**Option A: Fixed hierarchy via flat tags (current approach, refined)**
- Each criterion has `context`, `content_type`, `criteria_category` as fields
- The hierarchy levels are hard-coded constants in the app
- Filtering and selection on the Evaluate page uses these fields to dynamically group/select criteria
- No separate tables or tree structures needed

**Option B: Flexible hierarchy with parent-child relationships**
- Requires a `hierarchy_nodes` table with `parent_id` references
- Users can create/rename/reorder hierarchy levels
- Significantly more UI complexity (tree editors, drag-and-drop)
- Much more development effort for marginal V1 benefit

### Recommendation: Option A (Fixed Hierarchy, Flat Tags)

This is the clear MVP winner. Here's why:

1. **Your hierarchy is already well-defined** — the image confirms 4 fixed levels: Context > Content Type > Category > Criteria
2. **The categories are the only "dynamic" part** — users add new categories like "Accuracy", "Legal Compliance", "Voice", etc. but the hierarchy structure itself doesn't change
3. **Filtering and auto-selection is trivial with flat tags** — selecting "Title" on the Evaluate page is just `criteria.filter(c => c.content_type === "Title")`
4. **Zero extra tables or data modeling** needed

### What to Build

**1. Centralize hierarchy constants**

Define the fixed hierarchy values in a single config file so they're reusable across the Add form, filters, and Evaluate page:

```text
CONTEXTS: ["General", "Industry", "Marketplace", "Brand"]
CONTENT_TYPES: ["Title", "Description", "Bullets/Specs", "Meta Description"]
CATEGORIES: derived dynamically from existing criteria (user-defined)
```

Contexts and content types are fixed enums. Categories grow organically as users create criteria — no need for a separate categories table in V1.

**2. Enhance the Evaluate page with hierarchy-based selection**

Instead of only selecting a pre-built Suite, add a "Build from hierarchy" flow:

- Step 1: Select Context (e.g., "General") — filters available criteria
- Step 2: Select Content Type (e.g., "Title") — further narrows
- Step 3: Optionally toggle categories on/off (e.g., uncheck "Claim Integrity")
- The resulting criteria list is shown as a preview before running

This is just chained filtering on the flat fields — no tree data structure needed.

**3. Keep the Criterion schema unchanged**

The current `Criterion` type with `context`, `content_type`, and `criteria_category` as string fields is sufficient. The only refinement is making the category list derivable from existing data rather than hard-coded.

### Why This Scales

- When you eventually need a categories management page, you can add a simple `categories` lookup table without changing the criterion schema
- If you later want sub-categories, you add one more tag field — still flat, still simple
- The hierarchy is implicit in the filtering logic, not encoded in a complex tree structure

### Technical Changes Summary

| Change | Effort |
|--------|--------|
| Create `src/config/hierarchy.ts` with constants | Trivial |
| Update Evaluate page with context/content-type/category selectors that auto-filter criteria | Small |
| Show filtered criteria preview before running evaluation | Small |

No schema changes. No new tables. No tree structures.


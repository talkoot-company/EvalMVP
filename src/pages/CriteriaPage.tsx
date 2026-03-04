import { useState, useMemo } from "react";
import { MOCK_CRITERIA } from "@/data/mock-data";
import { AddCriterionDialog } from "@/components/AddCriterionDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Filter, Plus, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Criterion } from "@/types";
import { CONTEXTS, CONTENT_TYPES, CRITERIA_TYPES, deriveCategoriesFromCriteria } from "@/config/hierarchy";

const CriterionDefinitionsTable = ({ criterion }: { criterion: Criterion }) => {
  if (criterion.criteria_type === "yes-no") {
    const definition = criterion.eval_definition as {
      definition_yes?: string;
      definition_no?: string;
      yes_examples?: string[];
      no_examples?: string[];
    };
    const yesExamples = definition.yes_examples?.filter(Boolean).join("; ");
    const noExamples = definition.no_examples?.filter(Boolean).join("; ");
    return (
      <Table className="border rounded-md">
        <TableHeader>
          <TableRow>
            <TableHead className="h-9 py-2 w-[120px]">Score</TableHead>
            <TableHead className="h-9 py-2 w-[220px]">Title</TableHead>
            <TableHead className="h-9 py-2">Definition</TableHead>
            <TableHead className="h-9 py-2">Examples</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="py-2 font-medium">Yes</TableCell>
            <TableCell className="py-2">—</TableCell>
            <TableCell className="py-2">{definition.definition_yes || "—"}</TableCell>
            <TableCell className="py-2">{yesExamples || "—"}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="py-2 font-medium">No</TableCell>
            <TableCell className="py-2">—</TableCell>
            <TableCell className="py-2">{definition.definition_no || "—"}</TableCell>
            <TableCell className="py-2">{noExamples || "—"}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
  }

  if (criterion.criteria_type === "numerical-scale") {
    const definition = criterion.eval_definition as Record<string, { title?: string; definition?: string; example_1?: string; example_2?: string }>;
    return (
      <Table className="border rounded-md">
        <TableHeader>
          <TableRow>
            <TableHead className="h-9 py-2 w-[120px]">Score</TableHead>
            <TableHead className="h-9 py-2 w-[220px]">Title</TableHead>
            <TableHead className="h-9 py-2">Definition</TableHead>
            <TableHead className="h-9 py-2">Examples</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[1, 2, 3, 4].map((score) => {
            const row = definition[`score_${score}`];
            const examples = [row?.example_1, row?.example_2].filter(Boolean).join("; ");
            return (
              <TableRow key={score}>
                <TableCell className="py-2 font-medium">{score}</TableCell>
                <TableCell className="py-2">{row?.title || "—"}</TableCell>
                <TableCell className="py-2">{row?.definition || "—"}</TableCell>
                <TableCell className="py-2">{examples || "—"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  }

  const definition = criterion.eval_definition as {
    buckets?: string[];
    bucket_definitions?: Record<string, string>;
    bucket_examples?: Record<string, string[]>;
  };
  const buckets = definition.buckets || [];
  return (
    <Table className="border rounded-md">
      <TableHeader>
        <TableRow>
          <TableHead className="h-9 py-2 w-[120px]">Bucket</TableHead>
          <TableHead className="h-9 py-2 w-[220px]">Title</TableHead>
          <TableHead className="h-9 py-2">Definition</TableHead>
          <TableHead className="h-9 py-2">Examples</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {buckets.length > 0 ? (
          buckets.map((bucket) => (
            <TableRow key={bucket}>
              <TableCell className="py-2 font-medium">{bucket}</TableCell>
              <TableCell className="py-2">—</TableCell>
              <TableCell className="py-2">{definition.bucket_definitions?.[bucket] || "—"}</TableCell>
              <TableCell className="py-2">{definition.bucket_examples?.[bucket]?.filter(Boolean).join("; ") || "—"}</TableCell>
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell className="py-2 font-medium">—</TableCell>
            <TableCell className="py-2">—</TableCell>
            <TableCell className="py-2">No bucket definitions</TableCell>
            <TableCell className="py-2">—</TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
};

const CriteriaPage = () => {
  const [search, setSearch] = useState("");
  const [contextFilter, setContextFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [contentTypeFilter, setContentTypeFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [criteria, setCriteria] = useState<Criterion[]>(MOCK_CRITERIA);
  const [addOpen, setAddOpen] = useState(false);
  const [editingCriterion, setEditingCriterion] = useState<Criterion | null>(null);

  const categories = useMemo(() => deriveCategoriesFromCriteria(criteria), [criteria]);

  const filtered = useMemo(() => {
    return criteria.filter(c => {
      const matchesSearch = c.criteria_name.toLowerCase().includes(search.toLowerCase()) ||
        c.criteria_definition.toLowerCase().includes(search.toLowerCase());
      const matchesContext = contextFilter === "all" || c.context === contextFilter;
      const matchesType = typeFilter === "all" || c.criteria_type === typeFilter;
      const matchesContentType = contentTypeFilter === "all" || c.content_type === contentTypeFilter;
      const matchesCategory = categoryFilter === "all" || c.criteria_category === categoryFilter;
      return matchesSearch && matchesContext && matchesType && matchesContentType && matchesCategory;
    });
  }, [criteria, search, contextFilter, typeFilter, contentTypeFilter, categoryFilter]);

  const handleDeleteCriterion = (id: string) => {
    setCriteria(prev => prev.filter(c => c.id !== id));
  };

  const handleAddCriterion = (criterion: Criterion) => {
    setCriteria(prev => [criterion, ...prev]);
  };

  const handleUpdateCriterion = (criterion: Criterion) => {
    setCriteria(prev => prev.map(c => (c.id === criterion.id ? criterion : c)));
  };

  const handleDialogOpenChange = (open: boolean) => {
    setAddOpen(open);
    if (!open) {
      setEditingCriterion(null);
    }
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Criteria</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage evaluation criteria across contexts and categories</p>
        </div>
        <Button
          className="gap-2"
          onClick={() => {
            setEditingCriterion(null);
            setAddOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> Add Criterion
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search criteria..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={contextFilter} onValueChange={setContextFilter}>
          <SelectTrigger className="w-40">
            <Filter className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
            <SelectValue placeholder="Context" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Contexts</SelectItem>
            {CONTEXTS.map(ctx => <SelectItem key={ctx} value={ctx}>{ctx}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Score Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {CRITERIA_TYPES.map(ct => <SelectItem key={ct.value} value={ct.value}>{ct.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={contentTypeFilter} onValueChange={setContentTypeFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Content Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Content</SelectItem>
            {CONTENT_TYPES.map(ct => <SelectItem key={ct} value={ct}>{ct}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {filtered.length} of {criteria.length} criteria
        </span>
      </div>

      {/* Criteria list */}
      <div className="space-y-3">
        {filtered.map((c, i) => (
          <Card key={c.id} className="shadow-card hover:shadow-elevated transition-shadow" style={{ animationDelay: `${i * 40}ms` }}>
            <CardContent className="p-4">
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold">{c.criteria_name}</h3>
                    <span className="text-xs text-muted-foreground">Weight: <span className="font-medium text-foreground">{c.weight}</span></span>
                    <Badge variant="outline" className="text-[10px] font-normal border-blue-200 bg-blue-50 text-blue-700">{c.context}</Badge>
                    <Badge variant="outline" className="text-[10px] font-normal border-violet-200 bg-violet-50 text-violet-700">{c.content_type}</Badge>
                    <Badge variant="outline" className="text-[10px] font-normal border-amber-200 bg-amber-50 text-amber-700">{c.criteria_category}</Badge>
                    {(c.customer || c.brand) && (
                      <div className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-700">
                        {c.customer && <span>Customer: {c.customer}</span>}
                        {c.customer && c.brand && <span className="text-slate-400">|</span>}
                        {c.brand && <span>Brand: {c.brand}</span>}
                      </div>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{c.criteria_definition}</p>
                  <div>
                    <CriterionDefinitionsTable criterion={c} />
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                    aria-label={`Edit ${c.criteria_name}`}
                    onClick={() => {
                      setEditingCriterion(c);
                      setAddOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${c.criteria_name}`}
                    onClick={() => handleDeleteCriterion(c.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <AddCriterionDialog
        open={addOpen}
        onOpenChange={handleDialogOpenChange}
        onAdd={handleAddCriterion}
        onUpdate={handleUpdateCriterion}
        initialCriterion={editingCriterion}
      />
    </div>
  );
};

export default CriteriaPage;

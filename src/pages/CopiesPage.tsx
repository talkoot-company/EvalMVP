import { MOCK_COPIES } from "@/data/mock-data";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Upload } from "lucide-react";

const CopiesPage = () => {
  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Product Copy</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage product copy for evaluation</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2">
            <Upload className="h-4 w-4" /> Import CSV
          </Button>
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> Add Copy
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {MOCK_COPIES.map((copy, i) => (
          <Card key={copy.id} className="shadow-card hover:shadow-elevated transition-shadow" style={{ animationDelay: `${i * 40}ms` }}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">{copy.product_name}</h3>
                    <Badge variant="outline" className="text-xs">{copy.content_type}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed line-clamp-3">
                    {copy.raw_text}
                  </p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="font-mono">{copy.id}</span>
                    <span>{new Date(copy.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default CopiesPage;

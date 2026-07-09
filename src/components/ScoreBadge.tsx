import { Badge } from "@/components/ui/badge";

// Shared score pill: exact match to the desired score = green pass, mismatch =
// red fail, no desired score = neutral. Renders "score / desired" (or just the
// score when there is no target). Used by the criterion test page and the suite
// test results matrix so pass/fail coloring stays identical.
export function ScoreBadge({ score, desired }: { score: string; desired: string }) {
  const passed = desired && score === desired;
  const failed = desired && score !== desired;
  const cls = passed
    ? "bg-green-100 text-green-800 border-green-200"
    : failed
    ? "bg-red-100 text-red-800 border-red-200"
    : "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <Badge variant="outline" className={`font-bold px-2.5 py-0.5 ${cls}`}>
      {desired ? `${score} / ${desired}` : score}
    </Badge>
  );
}

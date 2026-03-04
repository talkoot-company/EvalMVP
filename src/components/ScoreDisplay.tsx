import { cn } from "@/lib/utils";

interface ScoreBarProps {
  score: number;
  maxScore?: number;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

function getScoreColor(score: number): string {
  if (score >= 85) return "bg-score-excellent";
  if (score >= 65) return "bg-score-good";
  if (score >= 40) return "bg-score-fair";
  return "bg-score-poor";
}

function getScoreTextColor(score: number): string {
  if (score >= 85) return "text-score-excellent";
  if (score >= 65) return "text-score-good";
  if (score >= 40) return "text-score-fair";
  return "text-score-poor";
}

export function ScoreBar({ score, maxScore = 100, size = "md", showLabel = true }: ScoreBarProps) {
  const pct = Math.min(100, (score / maxScore) * 100);
  const heights = { sm: "h-1.5", md: "h-2", lg: "h-3" };

  return (
    <div className="flex items-center gap-3">
      <div className={cn("flex-1 rounded-full bg-muted overflow-hidden", heights[size])}>
        <div
          className={cn("h-full rounded-full transition-all duration-700 ease-out", getScoreColor(score))}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className={cn("text-sm font-semibold tabular-nums min-w-[2.5rem] text-right", getScoreTextColor(score))}>
          {Math.round(score)}
        </span>
      )}
    </div>
  );
}

export function ScoreCircle({ score, size = "md" }: { score: number; size?: "sm" | "md" | "lg" }) {
  const dimensions = { sm: "h-10 w-10 text-sm", md: "h-14 w-14 text-lg", lg: "h-20 w-20 text-2xl" };
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full font-bold border-2",
        dimensions[size],
        score >= 85 && "border-score-excellent text-score-excellent bg-score-excellent/10",
        score >= 65 && score < 85 && "border-score-good text-score-good bg-score-good/10",
        score >= 40 && score < 65 && "border-score-fair text-score-fair bg-score-fair/10",
        score < 40 && "border-score-poor text-score-poor bg-score-poor/10"
      )}
    >
      {Math.round(score)}
    </div>
  );
}

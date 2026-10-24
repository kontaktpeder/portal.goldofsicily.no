import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type RecordFigure = {
  value: number | string;
  unit?: string;
  label: string;
};

/**
 * One list row: title and one meta line, one figure when there is a number,
 * and an optional action that sits outside the clickable card.
 */
export function RecordCard({
  title,
  meta,
  figure,
  leading,
  titleMono,
  chevron,
  quiet,
  action,
  render,
}: {
  title: string;
  meta?: string;
  figure?: RecordFigure;
  leading?: ReactNode;
  titleMono?: boolean;
  chevron?: boolean;
  quiet?: boolean;
  action?: ReactNode;
  render: (className: string, body: ReactNode) => ReactNode;
}) {
  const body = (
    <>
      {leading}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate",
            titleMono ? "font-mono text-lg font-semibold" : "font-semibold",
          )}
        >
          {title}
        </p>
        {meta ? <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{meta}</p> : null}
      </div>
      {figure ? (
        <div className="shrink-0 text-right">
          <p className="text-lg font-semibold text-foreground tabular-nums">
            {figure.value}
            {figure.unit ? (
              <span className="ml-1 text-xs font-normal text-muted-foreground">{figure.unit}</span>
            ) : null}
          </p>
          <p className="text-xs text-muted-foreground">{figure.label}</p>
        </div>
      ) : null}
      {chevron ? <ChevronRight className="size-5 shrink-0 text-muted-foreground" /> : null}
    </>
  );
  const card = render(
    cn(
      "surface-card flex w-full min-w-0 items-center gap-3 p-4 text-left",
      !quiet && "transition-shadow hover:shadow-[var(--shadow-lift)]",
    ),
    body,
  );
  if (!action) return card;
  return (
    <div className="flex items-stretch gap-2">
      <div className="min-w-0 flex-1">{card}</div>
      <div className="flex shrink-0 items-center">{action}</div>
    </div>
  );
}

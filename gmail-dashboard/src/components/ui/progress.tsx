import * as React from "react";
import { cn } from "@/lib/utils";

/** value: 0–100, or null for an indeterminate bar. */
function Progress({ value, className }: { value: number | null; className?: string }) {
  const clamped = value === null ? null : Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped ?? undefined}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-primary/15", className)}
    >
      {clamped === null ? (
        <div className="absolute inset-y-0 w-1/3 animate-[progress-indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-primary" />
      ) : (
        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${clamped}%` }} />
      )}
      <style>{`@keyframes progress-indeterminate{0%{left:-33%}100%{left:100%}}`}</style>
    </div>
  );
}

export { Progress };

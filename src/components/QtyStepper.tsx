import { Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Big thumb-friendly quantity control. Used everywhere a number is entered on
 * a phone, so the delivery driver never has to hit a small target.
 */
export function QtyStepper({
  value,
  onChange,
  max,
  min = 0,
  className,
  ariaLabel,
}: {
  value: number;
  onChange: (next: number) => void;
  max?: number;
  min?: number;
  className?: string;
  ariaLabel?: string;
}) {
  function clamp(n: number) {
    let out = Number.isFinite(n) ? n : min;
    if (out < min) out = min;
    if (max !== undefined && out > max) out = max;
    return out;
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Decrease"
        className="size-11 shrink-0 rounded-full"
        disabled={value <= min}
        onClick={() => onChange(clamp(value - 1))}
      >
        <Minus className="size-5" />
      </Button>
      <Input
        aria-label={ariaLabel}
        inputMode="numeric"
        pattern="[0-9]*"
        className="h-11 w-16 text-center text-base font-semibold tabular-nums"
        value={String(value)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(clamp(Number(e.target.value.replace(/[^0-9]/g, "")) || 0))}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Increase"
        className="size-11 shrink-0 rounded-full"
        disabled={max !== undefined && value >= max}
        onClick={() => onChange(clamp(value + 1))}
      >
        <Plus className="size-5" />
      </Button>
    </div>
  );
}

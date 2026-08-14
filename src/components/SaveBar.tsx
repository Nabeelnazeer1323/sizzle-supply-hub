import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

/**
 * Sticky action bar pinned above the mobile tab bar so Save is always reachable.
 */
export function SaveBar({
  summary,
  onSave,
  saving,
  label = "Save",
  disabled,
  secondary,
}: {
  summary?: ReactNode;
  onSave: () => void;
  saving?: boolean;
  label?: string;
  disabled?: boolean;
  secondary?: ReactNode;
}) {
  return (
    <div className="sticky bottom-16 z-20 -mx-4 mt-4 border-t border-border bg-card/95 px-4 py-3 backdrop-blur md:bottom-0 md:mx-0 md:rounded-lg md:border print:hidden">
      <div className="flex flex-wrap items-center gap-3">
        {summary && <div className="text-sm text-muted-foreground">{summary}</div>}
        <div className="ml-auto flex items-center gap-2">
          {secondary}
          <Button size="lg" className="h-12 px-6" onClick={onSave} disabled={saving || disabled}>
            {saving ? "Saving…" : label}
          </Button>
        </div>
      </div>
    </div>
  );
}

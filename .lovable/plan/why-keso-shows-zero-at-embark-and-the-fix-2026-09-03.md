# Why Keso shows zero at Embark — and the fix

I read the actual records. It is not sales, and it is not "balancing" between batches. It is a stray write-off landing on the wrong batch.

## What the data says

Embark / Keso:

```text
batch 1  delivered 2026-08-08  qty 3  best before 2026-08-29  closed 2026-09-03, leftover 0
batch 2  delivered 2026-09-03  qty 3  best before 2026-09-25  open
adjustment  2026-09-02  -3 units  reason EXPIRED  batch_id: null
```

The -3 "expired" correction you logged on 2 September has no batch attached to it. The stock engine attributes an unattached correction to the **last open batch**, which is now the new 3-unit delivery. So the new batch computes `3 delivered − 0 sold − 3 written off = 0 left`, while the old expired batch was separately closed with leftover 0. The old loss got counted twice: once as a closed batch, once against the new stock.

(The same pair exists at the other location for Keso, without an adjustment — that one is fine.)

## The fix

1. **Attribute corrections by date, oldest first.** An adjustment belongs to a batch that was actually on the shelf on its `occurred_on` date: the oldest batch whose window covers that date. A correction dated before a batch was delivered can never touch that batch. If nothing covers the date, it falls to the nearest earlier batch, not the newest one.
2. **No double counting on close.** When a batch is closed, its leftovers are the closed quantity; any expiry/waste corrections already dated inside that batch's window stop reducing on-hand a second time. Closed batches simply report zero remaining and their waste once.
3. **A batch can never be pushed below zero by history that predates it.** Remaining is floored at zero per batch and negative spill does not flow forward into later deliveries — only sales spill forward, as today.
4. **Make it visible.** In the batch sheet for an item, each batch lists delivered / sold / corrections / remaining as separate lines, so a number like this is explainable at a glance instead of silently zero.
5. **Clean-up for this row.** The existing 2 September -3 adjustment is dated inside the old batch's window, so once rule 1 lands it re-attaches to the August batch and Embark shows 3 Keso again. No data edit needed; if you prefer, the batch sheet gets a "delete correction" action so stray entries can be removed.

## Technical notes

- `src/lib/snacks.ts`: replace the `openStates[openStates.length - 1]` fallback in `buildStock` with window-based attribution (`delivered_on <= occurred_on < windowEnd`, oldest match first; otherwise the latest batch delivered on or before that date). Skip adjustments already absorbed by a closed batch's `closed_quantity`, and floor per-batch remaining at zero without spilling negatives.
- Unit tests for: correction dated before a new delivery, correction inside a closed batch's window, correction with an explicit `batch_id`, and a correction with no batch at all.
- `src/routes/_authenticated/snacks.tsx`: batch rows show delivered / sold / corrections / remaining, plus a remove action for a correction.
- Nothing outside the snacks section changes.

# Add sales amount to Non Sizzle stocked card

## Goal

The "Non Sizzle stocked" dashboard card shows both unit sales and a sales amount. Nothing else changes.

## Constraint

`orders.amount` exists only at the order level — `order_items` has no per-item price. So for mixed orders (some items Sizzle-stocked, some not), the amount attributable to non-Sizzle items is estimated **pro-rata by units**: `order.amount × (non-sizzle units in order / total units in order)`. Orders that contain only non-Sizzle items contribute their full amount.

## Change

`src/components/NonSizzleSales.tsx` only:

- Include `amount` in the orders select.
- While summing units, accumulate `estimatedAmount += order.amount × (orderNonSizzleUnits / orderTotalUnits)` for each PAYMENT order.
- Render the amount next to the units figure, formatted as SEK (e.g. `Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 })`), with a small "estimated by unit share" note so the number isn't mistaken for an exact figure.

No other files, sections, or logic are touched.

## Verification

Typecheck/build clean; card shows units + amount and updates with the period toggles.

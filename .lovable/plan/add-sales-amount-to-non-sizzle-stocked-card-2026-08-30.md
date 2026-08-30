# Add sales amount to Non Sizzle stocked card

## Goal

The "Non Sizzle stocked" dashboard card shows both unit sales and a sales amount. Nothing else changes.

## Approach (confirmed)

Amount is computed per item, not estimated from order totals: for each PAYMENT order item, look up the joined product's `price` column on the `products` table and add `quantity × price` when the product is non-Sizzle-stocked (`stocked_by_sizzle` false/null). Items whose product has no price contribute units but 0 to the amount.

## Change

`src/components/NonSizzleSales.tsx` only:

- Select `order_items(quantity,products(name,stocked_by_sizzle,price))`.
- While summing units, accumulate `amount += quantity × (product.price ?? 0)` for non-Sizzle items.
- Render the amount next to the units figure, formatted as SEK (`Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 })`).

No other files, sections, or logic are touched.

## Verification

Typecheck/build clean; card shows units + amount and updates with the period toggles.

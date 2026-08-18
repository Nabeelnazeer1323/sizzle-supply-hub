import type { Location, Product } from "@/lib/supabase";
import type { NordeaSwishTransaction } from "@/lib/nordea-swish";

export type ImportItem = {
  numeric_id: number;
  product_id: string | null;
  product_name: string;
  quantity: number;
};

export type MappedOrder = {
  transaction: NordeaSwishTransaction;
  location: Location | null;
  items: ImportItem[];
  errors: string[];
};

export type OrderUpsertPayload = {
  payment_method: "SWISH_MANUAL";
  import_key: string;
  external_reference: string;
  transaction_type: "PAYMENT" | "REFUND" | "REFUND_CORRECTION";
  ordered_at: string;
  amount: number;
  currency: "SEK";
  message: string;
  source_order_id: string | null;
  source_status: string;
  location_id: string | null;
  mapping_status: "MAPPED" | "UNMAPPED";
  items: Pick<ImportItem, "numeric_id" | "product_id" | "quantity">[];
};

export function mapNordeaOrders(
  transactions: NordeaSwishTransaction[],
  locations: Location[],
  products: Product[],
): MappedOrder[] {
  const locationByName = new Map(locations.map((item) => [normalizeName(item.name), item]));
  const productByNumber = new Map(
    products
      .filter((item): item is Product & { numeric_id: number } => item.numeric_id !== null)
      .map((item) => [item.numeric_id, item]),
  );

  return transactions.map((transaction) => {
    const separator = transaction.message.indexOf(":");
    const rawLocation = separator >= 0 ? transaction.message.slice(0, separator) : "";
    const rawProducts = separator >= 0 ? transaction.message.slice(separator + 1) : "";
    const location = locationByName.get(normalizeName(rawLocation)) ?? null;
    const numericIds = rawProducts.match(/\d+/g)?.map(Number) ?? [];
    const quantities = new Map<number, number>();
    for (const numericId of numericIds) {
      quantities.set(numericId, (quantities.get(numericId) ?? 0) + 1);
    }

    const items: ImportItem[] = [];
    for (const [numericId, quantity] of quantities) {
      const product = productByNumber.get(numericId);
      if (!product) {
        items.push({
          numeric_id: numericId,
          product_id: null,
          product_name: "Okänd produkt",
          quantity,
        });
      } else {
        items.push({
          numeric_id: numericId,
          product_id: product.id,
          product_name: product.name,
          quantity,
        });
      }
    }

    const errors: string[] = [];
    if (separator < 0) errors.push("Meddelandet saknar kolon mellan plats och produkter.");
    if (!rawLocation.trim()) errors.push("Platsnamn saknas.");
    else if (!location) errors.push(`Okänd plats: ${rawLocation.trim()}.`);
    if (numericIds.length === 0) errors.push("Inga produktnummer hittades.");
    const unknownProducts = items.filter((item) => item.product_id === null);
    if (unknownProducts.length > 0) {
      errors.push(
        `Okända produktnummer: ${unknownProducts.map((item) => item.numeric_id).join(", ")}.`,
      );
    }
    return { transaction, location, items, errors };
  });
}

export function toOrderUpsertPayload(order: MappedOrder): OrderUpsertPayload {
  const normalizedStatus = order.transaction.status.toLocaleLowerCase("sv-SE");
  const transactionType = normalizedStatus.includes("rättelse")
    ? "REFUND_CORRECTION"
    : normalizedStatus.includes("återbetalning") || order.transaction.amount < 0
      ? "REFUND"
      : "PAYMENT";
  const mapped = Boolean(
    order.location && order.items.length > 0 && order.items.every((item) => item.product_id),
  );
  return {
    payment_method: "SWISH_MANUAL",
    import_key: nordeaImportKey(order, transactionType),
    external_reference: order.transaction.referenceNumber,
    transaction_type: transactionType,
    ordered_at: stockholmLocalToIso(order.transaction.date, order.transaction.time),
    amount: order.transaction.amount,
    currency: "SEK",
    message: order.transaction.message,
    source_order_id: order.transaction.orderId || null,
    source_status: order.transaction.status,
    location_id: order.location?.id ?? null,
    mapping_status: mapped ? "MAPPED" : "UNMAPPED",
    items: order.items.map(({ numeric_id, product_id, quantity }) => ({
      numeric_id,
      product_id,
      quantity,
    })),
  };
}

function nordeaImportKey(
  order: MappedOrder,
  transactionType: OrderUpsertPayload["transaction_type"],
): string {
  const transaction = order.transaction;
  if (transaction.referenceNumber) return `reference:${transaction.referenceNumber}`;
  if (transaction.orderId) return `source:${transaction.orderId}:${transactionType}`;
  return [
    "fallback",
    transaction.date,
    transaction.time,
    transaction.amount,
    transaction.swishNumber,
    transaction.message,
  ].join(":");
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("sv-SE");
}

/** Interpret Nordea's timezone-less clock value as Europe/Stockholm, then store UTC. */
export function stockholmLocalToIso(date: string, time: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second] = time.split(":").map(Number);
  if ([year, month, day, hour, minute, second].some((part) => !Number.isFinite(part))) {
    throw new Error(`Ogiltigt datum eller klockslag: ${date} ${time}.`);
  }

  const localAsUtc = Date.UTC(year!, month! - 1, day!, hour!, minute!, second!);
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(localAsUtc)).map((part) => [part.type, part.value]),
  );
  const stockholmAtGuess = Date.UTC(
    Number(parts["year"]),
    Number(parts["month"]) - 1,
    Number(parts["day"]),
    Number(parts["hour"]),
    Number(parts["minute"]),
    Number(parts["second"]),
  );
  return new Date(localAsUtc - (stockholmAtGuess - localAsUtc)).toISOString();
}

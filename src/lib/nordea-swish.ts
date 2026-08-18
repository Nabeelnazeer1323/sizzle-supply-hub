export type NordeaSwishMetadata = {
  createdBy: string;
  createdDate: string;
  searchTerms: string[];
  search: string;
  swishNumber: string;
  resultCount: number;
};

export type NordeaSwishSummary = {
  marketName: string;
  swishNumber: string;
  costCenter: string;
  paymentCount: number;
  paidAmount: number;
  refundCount: number;
  refundedAmount: number;
  payoutCount: number;
  payoutAmount: number;
  netAmount: number;
  isTotal: boolean;
};

export type NordeaSwishTransaction = {
  date: string;
  time: string;
  occurredAt: string;
  marketName: string;
  swishNumber: string;
  costCenter: string;
  name: string;
  mobileNumber: string;
  message: string;
  orderId: string;
  referenceNumber: string;
  status: string;
  amount: number;
};

export type NordeaSwishReport = {
  metadata: NordeaSwishMetadata;
  summaries: NordeaSwishSummary[];
  transactions: NordeaSwishTransaction[];
};

const SUMMARY_HEADER = "MARKNADSNAMN";
const TRANSACTION_HEADER = "DATUM";

/** Parse Nordea's Swedish Swish report export into typed, normalized sections. */
export function parseNordeaSwishReport(input: string): NordeaSwishReport {
  const rows = parseDelimitedRows(input.replace(/^\uFEFF/, ""));
  const summaryHeaderIndex = rows.findIndex(isSummaryHeader);
  const transactionHeaderIndex = rows.findIndex(isTransactionHeader);

  if (summaryHeaderIndex < 0 || transactionHeaderIndex < 0) {
    throw new Error("Filen saknar Nordeas rubriker för summering eller transaktioner.");
  }
  if (summaryHeaderIndex >= transactionHeaderIndex) {
    throw new Error("Sektionerna i Nordea-filen ligger i oväntad ordning.");
  }

  const metadataValues = new Map(
    rows
      .slice(0, summaryHeaderIndex)
      .filter((row) => row.length >= 2)
      .map((row) => [normalizeMetadataKey(row[0] ?? ""), row[1]?.trim() ?? ""]),
  );

  const summaries = rows
    .slice(summaryHeaderIndex + 1, transactionHeaderIndex)
    .filter((row) => row.some((value) => value.trim() !== ""))
    .map(parseSummary);

  const transactions = rows
    .slice(transactionHeaderIndex + 1)
    .filter((row) => row.some((value) => value.trim() !== ""))
    .map(parseTransaction);

  return {
    metadata: {
      createdBy: requiredMetadata(metadataValues, "Skapad av"),
      createdDate: requiredMetadata(metadataValues, "Datum"),
      searchTerms: requiredMetadata(metadataValues, "Sökbegrepp")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      search: requiredMetadata(metadataValues, "Sök"),
      swishNumber: normalizePhone(requiredMetadata(metadataValues, "Swish-nummer")),
      resultCount: parseInteger(
        requiredMetadata(metadataValues, "Antal resultat"),
        "Antal resultat",
      ),
    },
    summaries,
    transactions,
  };
}

function parseDelimitedRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ";" && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some((field) => field !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (quoted) throw new Error("CSV-filen innehåller ett citerat fält som inte avslutas.");
  if (value !== "" || row.length > 0) {
    row.push(value);
    if (row.some((field) => field !== "")) rows.push(row);
  }
  return rows;
}

function isSummaryHeader(row: string[]): boolean {
  return (
    row[0]?.trim().toUpperCase() === SUMMARY_HEADER &&
    row[3]?.trim().toUpperCase() === "ANTAL SWISH-BETALNINGAR"
  );
}

function isTransactionHeader(row: string[]): boolean {
  return (
    row[0]?.trim().toUpperCase() === TRANSACTION_HEADER && row[1]?.trim().toUpperCase() === "TID"
  );
}

function parseSummary(row: string[], index: number): NordeaSwishSummary {
  requireColumns(row, 10, `summeringsrad ${index + 1}`);
  return {
    marketName: field(row, 0),
    swishNumber: normalizePhone(field(row, 1)),
    costCenter: field(row, 2),
    paymentCount: parseInteger(field(row, 3), "antal Swish-betalningar"),
    paidAmount: parseSwedishAmount(field(row, 4), "totalt inbetalat belopp"),
    refundCount: parseInteger(field(row, 5), "antal återbetalningar"),
    refundedAmount: parseSwedishAmount(field(row, 6), "totalt återbetalat belopp"),
    payoutCount: parseInteger(field(row, 7), "antal utbetalningar"),
    payoutAmount: parseSwedishAmount(field(row, 8), "totalt utbetalat belopp"),
    netAmount: parseSwedishAmount(field(row, 9), "netto"),
    isTotal: field(row, 0).toLocaleLowerCase("sv-SE") === "total",
  };
}

function parseTransaction(row: string[], index: number): NordeaSwishTransaction {
  requireColumns(row, 12, `transaktionsrad ${index + 1}`);
  const date = field(row, 0);
  const time = field(row, 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}:\d{2}$/.test(time)) {
    throw new Error(`Ogiltigt datum eller klockslag på transaktionsrad ${index + 1}.`);
  }

  return {
    date,
    time,
    occurredAt: `${date}T${time}`,
    marketName: field(row, 2),
    swishNumber: normalizePhone(field(row, 3)),
    costCenter: field(row, 4),
    name: field(row, 5),
    mobileNumber: normalizePhone(field(row, 6)),
    message: field(row, 7),
    orderId: field(row, 8),
    referenceNumber: field(row, 9).replace(/\s/g, ""),
    status: field(row, 10),
    amount: parseSwedishAmount(field(row, 11), "belopp"),
  };
}

function normalizeMetadataKey(value: string): string {
  return value.trim().replace(/:$/, "");
}

function requiredMetadata(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (value === undefined) throw new Error(`Filen saknar metadatafältet "${key}".`);
  return value;
}

function normalizePhone(value: string): string {
  return value.replace(/[\s-]/g, "");
}

function parseInteger(value: string, label: string): number {
  const parsed = Number(value.replace(/\s/g, ""));
  if (!Number.isSafeInteger(parsed)) throw new Error(`Ogiltigt heltal för ${label}: "${value}".`);
  return parsed;
}

function parseSwedishAmount(value: string, label: string): number {
  const normalized = value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) throw new Error(`Ogiltigt belopp för ${label}: "${value}".`);
  return Object.is(parsed, -0) ? 0 : parsed;
}

function requireColumns(row: string[], expected: number, label: string): void {
  if (row.length !== expected) {
    throw new Error(`Fel antal kolumner på ${label}: förväntade ${expected}, fick ${row.length}.`);
  }
}

function field(row: string[], index: number): string {
  return row[index]?.trim() ?? "";
}

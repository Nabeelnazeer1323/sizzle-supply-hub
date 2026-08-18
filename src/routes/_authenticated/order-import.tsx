import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";

import { parseNordeaSwishReport, type NordeaSwishReport } from "@/lib/nordea-swish";
import { mapNordeaOrders, toOrderUpsertPayload, type MappedOrder } from "@/lib/order-import";
import { PRODUCT_COLUMNS, supabase, type Location, type Product } from "@/lib/supabase";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/order-import")({
  head: () => ({
    meta: [
      { title: "Order Import — Sizzle Ops" },
      { name: "description", content: "Parse and preview order reports." },
    ],
  }),
  component: NordeaSwishPage,
});

const money = new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
});

function NordeaSwishPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<NordeaSwishReport | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const locationsQuery = useQuery({
    queryKey: ["locations", "order-import"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("locations")
        .select("id,name,vegan_target,delivery_days,is_active")
        .order("name");
      if (queryError) throw queryError;
      return data as Location[];
    },
  });
  const productsQuery = useQuery({
    queryKey: ["products", "order-import"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("products").select(PRODUCT_COLUMNS);
      if (queryError) throw queryError;
      return data as unknown as Product[];
    },
  });

  async function loadFile(file: File | undefined) {
    if (!file) return;
    setError("");
    setReport(null);
    setFileName(file.name);

    try {
      const text = decodeReport(await file.arrayBuffer());
      setReport(parseNordeaSwishReport(text));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Filen kunde inte läsas.");
    }
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    void loadFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void loadFile(event.dataTransfer.files[0]);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Order Import</h1>
        <p className="text-sm text-muted-foreground">
          Upload a Nordea Swish report, review its mappings, then import the orders.
        </p>
      </div>

      <input
        ref={inputRef}
        className="hidden"
        type="file"
        accept=".csv,.txt,text/csv,text/plain"
        onChange={handleChange}
      />
      <div
        className={`flex min-h-44 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          dragging ? "border-primary bg-accent" : "border-border bg-card"
        }`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <span className="flex size-11 items-center justify-center rounded-full bg-muted">
          <Upload className="size-5" />
        </span>
        <div>
          <p className="font-medium">Drop a Nordea report here</p>
          <p className="text-sm text-muted-foreground">or choose a CSV file from your computer</p>
        </div>
        <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
          Choose file
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not parse {fileName || "the file"}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {report ? (
        <ReportPreview
          fileName={fileName}
          report={report}
          locations={locationsQuery.data ?? []}
          products={productsQuery.data ?? []}
          referencesLoading={locationsQuery.isPending || productsQuery.isPending}
        />
      ) : null}
    </div>
  );
}

function ReportPreview({
  fileName,
  report,
  locations,
  products,
  referencesLoading,
}: {
  fileName: string;
  report: NordeaSwishReport;
  locations: Location[];
  products: Product[];
  referencesLoading: boolean;
}) {
  const total = report.summaries.find((summary) => summary.isTotal);
  const mapped = useMemo(
    () => mapNordeaOrders(report.transactions, locations, products),
    [report.transactions, locations, products],
  );
  const unmappedCount = mapped.filter((order) => order.errors.length > 0).length;
  const rowKeys = useMemo(() => mapped.map(importRowKey), [mapped]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set(rowKeys)), [rowKeys]);
  const selectedOrders = mapped.filter((_order, index) => selected.has(rowKeys[index]!));
  const [result, setResult] = useState<ImportResult | null>(null);
  const queryClient = useQueryClient();
  const importMutation = useMutation({
    mutationFn: async () => {
      const payload = selectedOrders.map(toOrderUpsertPayload);
      const { data, error } = await supabase.rpc("upsert_orders", { p_orders: payload });
      if (error) throw error;
      return data as ImportResult;
    },
    onSuccess: (nextResult) => {
      setResult(nextResult);
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="size-4" />
              {fileName}
            </CardTitle>
            <Badge variant="secondary">Parsed successfully</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Created by" value={report.metadata.createdBy} />
            <Metric label="Report date" value={report.metadata.createdDate} />
            <Metric label="Swish number" value={report.metadata.swishNumber} />
            <Metric label="Results in report" value={String(report.metadata.resultCount)} />
            <Metric label="Parsed transactions" value={String(report.transactions.length)} />
            <Metric label="Mapped" value={String(mapped.length - unmappedCount)} />
            <Metric label="Imported as unmapped" value={String(unmappedCount)} />
            <Metric label="Selected" value={String(selectedOrders.length)} />
            <Metric label="Payments" value={String(total?.paymentCount ?? 0)} />
            <Metric label="Refunds" value={String(total?.refundCount ?? 0)} />
            <Metric label="Net amount" value={money.format(total?.netAmount ?? 0)} />
          </dl>
        </CardContent>
      </Card>

      {importMutation.error ? (
        <Alert variant="destructive">
          <AlertTitle>Import failed</AlertTitle>
          <AlertDescription>{importMutation.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {result ? (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertTitle>Import complete</AlertTitle>
          <AlertDescription>
            {result.inserted} created, {result.updated} updated and {result.skipped} unchanged.
            <Button asChild variant="link" className="h-auto px-2 py-0">
              <Link to="/orders">View orders</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Mapped orders</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Rows without a location or product match are saved as UNMAPPED for later review.
            </p>
          </div>
          <Button
            disabled={referencesLoading || selectedOrders.length === 0 || importMutation.isPending}
            onClick={() => importMutation.mutate()}
          >
            {importMutation.isPending
              ? "Importing…"
              : `Confirm and import ${selectedOrders.length} orders`}
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all orders"
                    checked={
                      selected.size === rowKeys.length
                        ? true
                        : selected.size > 0
                          ? "indeterminate"
                          : false
                    }
                    onCheckedChange={(checked) =>
                      setSelected(checked ? new Set(rowKeys) : new Set())
                    }
                  />
                </TableHead>
                <TableHead>Date and time</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Products</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Mapping</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mapped.map((order, index) => (
                <MappedOrderRow
                  key={`${order.transaction.referenceNumber}-${order.transaction.occurredAt}-${index}`}
                  order={order}
                  selected={selected.has(rowKeys[index]!)}
                  onSelectedChange={(checked) => {
                    const key = rowKeys[index]!;
                    setSelected((current) => {
                      const next = new Set(current);
                      if (checked) next.add(key);
                      else next.delete(key);
                      return next;
                    });
                  }}
                />
              ))}
            </TableBody>
          </Table>
          {report.transactions.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              The report contains no transaction rows.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

type ImportResult = { inserted: number; updated: number; skipped: number; items: number };

function MappedOrderRow({
  order,
  selected,
  onSelectedChange,
}: {
  order: MappedOrder;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
}) {
  const { transaction } = order;
  return (
    <TableRow>
      <TableCell>
        <Checkbox
          aria-label={`Select order ${transaction.referenceNumber || transaction.occurredAt}`}
          checked={selected}
          onCheckedChange={(checked) => onSelectedChange(checked === true)}
        />
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums">
        {transaction.date} {transaction.time}
      </TableCell>
      <TableCell className="min-w-48">{transaction.message || "—"}</TableCell>
      <TableCell>{order.location?.name ?? "—"}</TableCell>
      <TableCell className="min-w-56">
        {order.items.map((item) => `${item.numeric_id}: ${item.product_name}`).join(", ") || "—"}
      </TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs">
        {transaction.referenceNumber || "—"}
      </TableCell>
      <TableCell>
        {order.errors.length === 0 ? (
          <Badge variant="secondary">Mapped</Badge>
        ) : (
          <div className="space-y-1">
            <Badge variant="outline">Unmapped</Badge>
            <p className="text-sm text-muted-foreground">{order.errors.join(" ")}</p>
          </div>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
        {money.format(transaction.amount)}
      </TableCell>
    </TableRow>
  );
}

function importRowKey(order: MappedOrder, index: number): string {
  return `${order.transaction.referenceNumber || "missing"}:${order.transaction.occurredAt}:${index}`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums">{value || "—"}</dd>
    </div>
  );
}

function decodeReport(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

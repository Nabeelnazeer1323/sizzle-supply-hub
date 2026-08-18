import { createFileRoute } from "@tanstack/react-router";
import { FileSpreadsheet, Upload } from "lucide-react";
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";

import { parseNordeaSwishReport, type NordeaSwishReport } from "@/lib/nordea-swish";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
          Upload a Nordea Swish report to parse and review its orders. Nothing is saved yet.
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

      {report ? <ReportPreview fileName={fileName} report={report} /> : null}
    </div>
  );
}

function ReportPreview({ fileName, report }: { fileName: string; report: NordeaSwishReport }) {
  const total = report.summaries.find((summary) => summary.isTotal);

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
            <Metric label="Payments" value={String(total?.paymentCount ?? 0)} />
            <Metric label="Refunds" value={String(total?.refundCount ?? 0)} />
            <Metric label="Net amount" value={money.format(total?.netAmount ?? 0)} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transactions</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date and time</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.transactions.map((transaction, index) => (
                <TableRow key={`${transaction.referenceNumber}-${transaction.occurredAt}-${index}`}>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {transaction.date} {transaction.time}
                  </TableCell>
                  <TableCell>{transaction.name}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {transaction.mobileNumber}
                  </TableCell>
                  <TableCell className="min-w-48">{transaction.message || "—"}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs">
                    {transaction.referenceNumber || "—"}
                  </TableCell>
                  <TableCell>{transaction.status}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                    {money.format(transaction.amount)}
                  </TableCell>
                </TableRow>
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

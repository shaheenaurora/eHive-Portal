import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { PDFPage, PDFFont } from "pdf-lib";
import type { InvoiceRow, CreditNoteRow } from "../queries/invoicing";
import { env } from "./env";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 50;
const GUTTER = 28;

const NAVY = rgb(16 / 255, 32 / 255, 52 / 255); // #102034
const NAVY_DARK = rgb(10 / 255, 20 / 255, 34 / 255); // #0a1422
const GOLD = rgb(184 / 255, 134 / 255, 46 / 255); // #b8862e
const WHITE = rgb(1, 1, 1);
const GREY = rgb(107 / 255, 103 / 255, 93 / 255); // #6b675d
const DARK = rgb(20 / 255, 19 / 255, 18 / 255); // #141312
const LIGHT_GREY = rgb(243 / 255, 241 / 255, 239 / 255); // #f3f1ef

function formatCurrency(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  const formatted = major.toLocaleString("en-AE", {
    minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${currency.toUpperCase()} ${formatted}`;
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function wrapLine(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

type PdfContext = {
  page: PDFPage;
  pdfDoc: PDFDocument;
  bold: PDFFont;
  regular: PDFFont;
  y: number;
};

async function initDoc(title: string): Promise<PdfContext> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Navy header bar across the top.
  page.drawRectangle({
    x: 0,
    y: A4_HEIGHT - 90,
    width: A4_WIDTH,
    height: 90,
    color: NAVY,
  });

  // Gold accent strip under the header.
  page.drawRectangle({
    x: 0,
    y: A4_HEIGHT - 94,
    width: A4_WIDTH,
    height: 4,
    color: GOLD,
  });

  // Logo / brand text.
  page.drawText("eHive", {
    x: MARGIN,
    y: A4_HEIGHT - 58,
    size: 24,
    font: bold,
    color: WHITE,
  });
  const ehiveWidth = bold.widthOfTextAtSize("eHive", 24);
  page.drawText("Circle", {
    x: MARGIN + ehiveWidth + 5,
    y: A4_HEIGHT - 58,
    size: 24,
    font: regular,
    color: GOLD,
  });

  // Document title aligned right inside the header.
  const docTitle = title.toUpperCase();
  const titleWidth = bold.widthOfTextAtSize(docTitle, 16);
  page.drawText(docTitle, {
    x: A4_WIDTH - MARGIN - titleWidth,
    y: A4_HEIGHT - 56,
    size: 16,
    font: bold,
    color: WHITE,
  });

  return { page, pdfDoc, bold, regular, y: A4_HEIGHT - 130 };
}

function drawSectionBox(
  ctx: PdfContext,
  heading: string,
  lines: { label: string; value: string }[]
): void {
  const { page, bold, regular, y } = ctx;
  const boxHeight = 22 + lines.length * 26;
  page.drawRectangle({
    x: MARGIN,
    y: y - boxHeight + 18,
    width: A4_WIDTH - MARGIN * 2,
    height: boxHeight,
    color: LIGHT_GREY,
  });

  let innerY = y;
  page.drawText(heading.toUpperCase(), {
    x: MARGIN + 12,
    y: innerY,
    size: 8,
    font: bold,
    color: GREY,
  });
  innerY -= 18;

  for (const line of lines) {
    const valueLines = wrapLine(
      line.value,
      regular,
      10,
      A4_WIDTH - MARGIN * 2 - 24
    );
    page.drawText(`${line.label}:`, {
      x: MARGIN + 12,
      y: innerY,
      size: 9,
      font: bold,
      color: DARK,
    });
    for (let i = 0; i < valueLines.length; i++) {
      page.drawText(valueLines[i], {
        x: MARGIN + 12,
        y: innerY - 12 - i * 12,
        size: 10,
        font: regular,
        color: DARK,
      });
    }
    innerY -= 14 + valueLines.length * 12;
  }

  ctx.y = y - boxHeight - GUTTER;
}

function drawLineItemsTable(
  ctx: PdfContext,
  rows: { description: string; amount: string }[]
): void {
  const { page, bold, regular, y } = ctx;
  const tableTop = y;
  const colX = { desc: MARGIN, amount: A4_WIDTH - MARGIN - 120 };

  // Header row.
  page.drawRectangle({
    x: MARGIN,
    y: tableTop - 24,
    width: A4_WIDTH - MARGIN * 2,
    height: 24,
    color: NAVY_DARK,
  });
  page.drawText("Description", {
    x: colX.desc + 8,
    y: tableTop - 16,
    size: 9,
    font: bold,
    color: WHITE,
  });
  page.drawText("Amount", {
    x: colX.amount + 8,
    y: tableTop - 16,
    size: 9,
    font: bold,
    color: WHITE,
  });

  let rowY = tableTop - 24;
  for (const row of rows) {
    const descLines = wrapLine(
      row.description,
      regular,
      10,
      colX.amount - colX.desc - 16
    );
    const rowHeight = Math.max(28, 8 + descLines.length * 13);

    // Alternating subtle background.
    if (rows.indexOf(row) % 2 === 1) {
      page.drawRectangle({
        x: MARGIN,
        y: rowY - rowHeight,
        width: A4_WIDTH - MARGIN * 2,
        height: rowHeight,
        color: LIGHT_GREY,
      });
    }

    for (let i = 0; i < descLines.length; i++) {
      page.drawText(descLines[i], {
        x: colX.desc + 8,
        y: rowY - 14 - i * 13,
        size: 10,
        font: regular,
        color: DARK,
      });
    }
    page.drawText(row.amount, {
      x: colX.amount + 8,
      y: rowY - 14,
      size: 10,
      font: bold,
      color: DARK,
    });

    rowY -= rowHeight;
  }

  // Bottom border.
  page.drawLine({
    start: { x: MARGIN, y: rowY },
    end: { x: A4_WIDTH - MARGIN, y: rowY },
    thickness: 1,
    color: GOLD,
  });

  ctx.y = rowY - GUTTER;
}

function drawTotal(ctx: PdfContext, label: string, amount: string): void {
  const { page, bold, regular, y } = ctx;
  page.drawText(label, {
    x: A4_WIDTH - MARGIN - 160,
    y,
    size: 11,
    font: regular,
    color: GREY,
  });
  page.drawText(amount, {
    x: A4_WIDTH - MARGIN - bold.widthOfTextAtSize(amount, 18) - 8,
    y: y - 8,
    size: 18,
    font: bold,
    color: NAVY,
  });
  ctx.y = y - 34;
}

function drawStatus(ctx: PdfContext, status: string): void {
  const { page, bold, y } = ctx;
  const text = status.toUpperCase();
  const paddingX = 10;
  const width = bold.widthOfTextAtSize(text, 9) + paddingX * 2;
  const height = 16;

  let bg = rgb(232 / 255, 245 / 255, 233 / 255); // paid / applied
  let fg = rgb(46 / 255, 125 / 255, 91 / 255);
  if (status === "open" || status === "draft") {
    bg = rgb(255 / 255, 243 / 255, 224 / 255);
    fg = GOLD;
  } else if (status === "void" || status === "cancelled") {
    bg = rgb(245 / 255, 245 / 255, 245 / 255);
    fg = GREY;
  }

  page.drawRectangle({
    x: MARGIN,
    y: y - height,
    width,
    height,
    color: bg,
  });
  page.drawText(text, {
    x: MARGIN + paddingX,
    y: y - height + 4,
    size: 9,
    font: bold,
    color: fg,
  });
  ctx.y = y - height - GUTTER;
}

function drawFooter(ctx: PdfContext): void {
  const { page, regular, y } = ctx;
  const footerY = Math.max(MARGIN, y);
  page.drawLine({
    start: { x: MARGIN, y: footerY },
    end: { x: A4_WIDTH - MARGIN, y: footerY },
    thickness: 0.5,
    color: rgb(227 / 255, 223 / 255, 213 / 255),
  });
  page.drawText(env.publicUrl, {
    x: MARGIN,
    y: footerY - 16,
    size: 8,
    font: regular,
    color: GREY,
  });
  page.drawText("Generated by eHive", {
    x: A4_WIDTH - MARGIN - regular.widthOfTextAtSize("Generated by eHive", 8),
    y: footerY - 16,
    size: 8,
    font: regular,
    color: GREY,
  });
}

export async function renderInvoicePdf(
  invoice: InvoiceRow,
  opts?: { memberName?: string; chapterName?: string }
): Promise<Uint8Array> {
  const ctx = await initDoc("TAX INVOICE");

  drawSectionBox(ctx, "Billed to", [
    { label: "Name", value: opts?.memberName ?? invoice.payerName ?? "—" },
    { label: "Email", value: invoice.payerEmail ?? "—" },
    ...(opts?.chapterName
      ? [{ label: "Chapter", value: opts.chapterName }]
      : []),
  ]);

  drawSectionBox(ctx, "Invoice details", [
    { label: "Invoice number", value: invoice.invoiceNumber },
    { label: "Date", value: formatDate(invoice.billedAt) },
    {
      label: "Due date",
      value: invoice.dueAt ? formatDate(invoice.dueAt) : "Paid in full",
    },
    { label: "Currency", value: invoice.currency.toUpperCase() },
  ]);

  drawLineItemsTable(
    ctx,
    invoice.lineItems.map(li => ({
      description: li.description ? `${li.label}\n${li.description}` : li.label,
      amount: formatCurrency(li.amount, invoice.currency),
    }))
  );

  drawTotal(ctx, "Total", formatCurrency(invoice.amount, invoice.currency));
  drawStatus(ctx, invoice.status);
  drawFooter(ctx);

  return ctx.pdfDoc.save();
}

export async function renderCreditNotePdf(
  creditNote: CreditNoteRow,
  opts?: { memberName?: string; chapterName?: string }
): Promise<Uint8Array> {
  const ctx = await initDoc("CREDIT NOTE");

  drawSectionBox(ctx, "Issued to", [
    { label: "Name", value: opts?.memberName ?? creditNote.payerName ?? "—" },
    { label: "Email", value: creditNote.payerEmail ?? "—" },
    ...(opts?.chapterName
      ? [{ label: "Chapter", value: opts.chapterName }]
      : []),
  ]);

  drawSectionBox(ctx, "Credit note details", [
    { label: "Credit note number", value: creditNote.creditNoteNumber },
    { label: "Date", value: formatDate(creditNote.createdAt) },
    { label: "Currency", value: creditNote.currency.toUpperCase() },
  ]);

  drawLineItemsTable(ctx, [
    {
      description: creditNote.reason,
      amount: formatCurrency(creditNote.amount, creditNote.currency),
    },
  ]);

  drawTotal(
    ctx,
    "Credit amount",
    formatCurrency(creditNote.amount, creditNote.currency)
  );
  drawStatus(ctx, "applied");
  drawFooter(ctx);

  return ctx.pdfDoc.save();
}

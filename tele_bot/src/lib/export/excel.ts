import ExcelJS from "exceljs";
import type {
  MaterialRequest,
  MaterialRequestItem,
  PurchaseRequest,
  PurchaseRequestItem,
  User,
} from "@prisma/client";
import {
  formatDate,
  formatMoney,
  decimalToNumber,
  statusLabel,
  getRequesterDisplayName,
} from "@/lib/calculations";
import { getCompanyName, getLogoPath } from "@/lib/config";
import fs from "fs";

type MRFull = MaterialRequest & {
  items: MaterialRequestItem[];
  requestedBy: User;
  purchaseRequests?: (PurchaseRequest & {
    items: PurchaseRequestItem[];
    purchaser: User;
    approvedBy: User | null;
  })[];
};

export async function generateMaterialRequestExcel(mr: MRFull): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = getCompanyName();
  const sheet = workbook.addWorksheet("Material Request");

  const logoPath = getLogoPath();
  if (logoPath) {
    const imageBuffer = fs.readFileSync(logoPath) as Buffer;
    const imageId = workbook.addImage({
      buffer: imageBuffer as any,
      extension: 'jpeg',
    });
    sheet.addImage(imageId, {
      tl: { col: 0, row: 0 },
      ext: { width: 100, height: 100 },
    });
  }

  sheet.mergeCells("A3:G3");
  sheet.getCell("A3").value = getCompanyName();
  sheet.getCell("A3").font = { bold: true, size: 14 };
  sheet.getCell("A3").alignment = { horizontal: "center" };

  let row = 5;
  const addRow = (label: string, value: string) => {
    sheet.getCell(`A${row}`).value = label;
    sheet.getCell(`A${row}`).font = { bold: true };
    sheet.mergeCells(`B${row}:G${row}`);
    sheet.getCell(`B${row}`).value = value;
    row++;
  };

  addRow("MR Number", mr.mrNumber);
  addRow("Project", mr.projectName);
  addRow("Project Type", mr.projectType ?? "N/A");
  addRow("BOQ", mr.boq ?? "N/A");
  addRow("Request Date", formatDate(mr.requestDate));
  addRow("Requested By", getRequesterDisplayName(mr));
  addRow("Status", statusLabel(mr.status));
  row++;

  // Material Items
  const headers = ["#", "Line ID", "Item Name", "Quantity", "Unit"];
  headers.forEach((h, i) => {
    const cell = sheet.getCell(row, i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };
  });
  row++;

  mr.items.forEach((item, index) => {
    sheet.getCell(row, 1).value = index + 1;
    sheet.getCell(row, 2).value = item.lineId;
    sheet.getCell(row, 3).value = item.itemName;
    sheet.getCell(row, 4).value = decimalToNumber(item.quantity);
    sheet.getCell(row, 5).value = item.unit;
    row++;
  });

  // Purchase Requests
  const prs = mr.purchaseRequests ?? [];
  for (const pr of prs) {
    row += 2;
    addRow("PR Number", pr.prNumber);
    addRow("Status", statusLabel(pr.status));
    addRow("Supplier", pr.supplierName);
    addRow("VAT Status", pr.vatStatus);

    const prHeaders = ["#", "Item Name", "Quantity", "Unit", "Unit Price", "Amount"];
    prHeaders.forEach((h, i) => {
      const cell = sheet.getCell(row, i + 1);
      cell.value = h;
      cell.font = { bold: true };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFD0E0FF" },
      };
    });
    row++;

    pr.items.forEach((item, index) => {
      sheet.getCell(row, 1).value = index + 1;
      sheet.getCell(row, 2).value = item.itemName;
      sheet.getCell(row, 3).value = decimalToNumber(item.quantity);
      sheet.getCell(row, 4).value = item.unit;
      sheet.getCell(row, 5).value = decimalToNumber(item.unitPrice);
      sheet.getCell(row, 6).value = decimalToNumber(item.amount);
      row++;
    });

    row++;
    addRow("Subtotal", `ETB ${formatMoney(pr.subtotal)}`);
    addRow(`VAT (${pr.vatStatus})`, `ETB ${formatMoney(pr.vatAmount)}`);
    addRow("Grand Total", `ETB ${formatMoney(pr.grandTotal)}`);
    addRow("Purchaser", pr.purchaser.fullName);
    if (pr.approvalDate) addRow("Approval Date", formatDate(pr.approvalDate));
  }

  sheet.columns = [
    { width: 5 },
    { width: 18 },
    { width: 30 },
    { width: 12 },
    { width: 10 },
    { width: 14 },
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function generateMaterialRequestsListExcel(
  requests: MRFull[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Procurement Requests");

  const logoPath = getLogoPath();
  if (logoPath) {
    const imageBuffer = fs.readFileSync(logoPath) as Buffer;
    const imageId = workbook.addImage({
      buffer: imageBuffer as any,
      extension: 'jpeg',
    });
    sheet.addImage(imageId, {
      tl: { col: 0, row: 0 },
      ext: { width: 100, height: 100 },
    });
  }

  // Add company name
  sheet.mergeCells("A2:H2");
  sheet.getCell("A2").value = getCompanyName();
  sheet.getCell("A2").font = { bold: true, size: 14 };
  sheet.getCell("A2").alignment = { horizontal: "center" };

  const headers = [
    "MR Number",
    "PR Number(s)",
    "Project",
    "Date",
    "Requested By",
    "Supplier(s)",
    "Grand Total",
    "Status",
  ];

  headers.forEach((h, i) => {
    const cell = sheet.getCell(3, i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };
  });

  requests.forEach((mr, index) => {
    const row = index + 4;
    const prs = mr.purchaseRequests ?? [];
    const prNumbers = prs.map((p) => p.prNumber).join(", ");
    const suppliers = [...new Set(prs.map((p) => p.supplierName))].join(", ");
    const totalAmount = prs.reduce(
      (sum, p) => sum + (p.grandTotal != null ? Number(p.grandTotal) : 0),
      0
    );

    sheet.getCell(row, 1).value = mr.mrNumber;
    sheet.getCell(row, 2).value = prNumbers;
    sheet.getCell(row, 3).value = mr.projectName;
    sheet.getCell(row, 4).value = formatDate(mr.requestDate);
    sheet.getCell(row, 5).value = getRequesterDisplayName(mr);
    sheet.getCell(row, 6).value = suppliers;
    sheet.getCell(row, 7).value = totalAmount > 0 ? totalAmount : "";
    sheet.getCell(row, 8).value = statusLabel(mr.status);
  });

  sheet.columns = headers.map(() => ({ width: 18 }));

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** @deprecated Use generateMaterialRequestExcel */
export const generatePurchaseRequestExcel = generateMaterialRequestExcel;

/** @deprecated Use generateMaterialRequestsListExcel */
export const generatePurchaseRequestsListExcel = generateMaterialRequestsListExcel;

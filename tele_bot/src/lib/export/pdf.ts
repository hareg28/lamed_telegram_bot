import PDFDocument from "pdfkit";
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

type MRFull = MaterialRequest & {
  items: MaterialRequestItem[];
  requestedBy: User;
  purchaseRequests?: (PurchaseRequest & {
    items: PurchaseRequestItem[];
    purchaser: User;
    approvedBy: User | null;
  })[];
};

export async function generateMaterialRequestPdf(mr: MRFull): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const logoPath = getLogoPath();
    if (logoPath) {
      const pageWidth = doc.page.width;
      const logoWidth = 120; // Adjust as needed
      const logoX = (pageWidth - logoWidth) / 2;
      doc.image(logoPath, logoX, 35, { width: logoWidth });
      doc.moveDown(2.5); // Move down after logo
    }

    doc.fontSize(16).font("Helvetica-Bold").text(getCompanyName(), { align: "center" });
    doc.fontSize(12).font("Helvetica").text("Procurement Request", { align: "center" });
    doc.moveDown();

    doc.fontSize(10).font("Helvetica-Bold").text("Material Request");
    doc.font("Helvetica");
    doc.text(`MR Number: ${mr.mrNumber}`);
    doc.text(`Project: ${mr.projectName}`);
    doc.text(`Project Type: ${mr.projectType ?? "N/A"}`);
    doc.text(`BOQ: ${mr.boq ?? "N/A"}`);
    doc.text(`Request Date: ${formatDate(mr.requestDate)}`);
    doc.text(`Requested By: ${getRequesterDisplayName(mr)}`);
    doc.text(`Status: ${statusLabel(mr.status)}`);
    doc.moveDown();

    doc.font("Helvetica-Bold").text("Materials");
    mr.items.forEach((item, i) => {
      doc.font("Helvetica").text(
        `${i + 1}. [${item.lineId}] ${item.itemName} — ${decimalToNumber(item.quantity)} ${item.unit}`
      );
    });
    doc.moveDown();

    const prs = mr.purchaseRequests ?? [];
    for (const pr of prs) {
      doc.font("Helvetica-Bold").text(`Purchase Request: ${pr.prNumber}`);
      doc.font("Helvetica");
      doc.text(`Status: ${statusLabel(pr.status)}`);
      doc.moveDown();

      doc.font("Helvetica-Bold").text("Supplier Information");
      doc.font("Helvetica");
      doc.text(`Supplier: ${pr.supplierName}`);
      doc.text(`Phone: ${pr.supplierPhone ?? "N/A"}`);
      doc.text(`VAT Receipt: ${pr.vatReceiptNumber ?? "N/A"}`);
      doc.text(`Account: ${pr.accountNumber ?? "N/A"}`);
      doc.moveDown();

      doc.font("Helvetica-Bold").text("Purchase Items");
      pr.items.forEach((item, i) => {
        doc.font("Helvetica").text(
          `${i + 1}. ${item.itemName} — ${decimalToNumber(item.quantity)} ${item.unit} × ETB ${formatMoney(item.unitPrice)} = ETB ${formatMoney(item.amount)}`
        );
      });
      doc.moveDown();

      doc.font("Helvetica-Bold").text("Cost Summary");
      doc.font("Helvetica");
      doc.text(`Subtotal: ETB ${formatMoney(pr.subtotal)}`);
      doc.text(`VAT (${pr.vatStatus}): ETB ${formatMoney(pr.vatAmount)}`);
      doc.font("Helvetica-Bold").text(`Grand Total: ETB ${formatMoney(pr.grandTotal)}`);
      doc.moveDown();

      doc.font("Helvetica-Bold").text("Delivery");
      doc.font("Helvetica");
      doc.text(
        `Expected: ${pr.expectedDeliveryDate ? formatDate(pr.expectedDeliveryDate) : "N/A"}`
      );
      doc.text(`Remarks: ${pr.deliveryRemarks ?? "N/A"}`);
      doc.text(`Purchaser: ${pr.purchaser.fullName}`);
      if (pr.approvalDate) {
        doc.text(`Approval Date: ${formatDate(pr.approvalDate)}`);
        doc.text(`Approved By: ${pr.approvedBy?.fullName ?? "N/A"}`);
      }
      doc.moveDown();
    }

    doc.end();
  });
}

/** @deprecated Use generateMaterialRequestPdf */
export const generatePurchaseRequestPdf = generateMaterialRequestPdf;

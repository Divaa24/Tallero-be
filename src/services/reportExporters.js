// ==============================================================================
// TALLERO AUTO — REPORT EXPORTERS (CSV, XLSX, PDF)
// Sesuai AGENTS.md §4 point 24 & §8
// Melindungi dari formula injection (sel berawalan = + - @ diberi prefix ')
// ==============================================================================

import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

/**
 * Netralkan formula injection: sel berawalan =, +, -, @ diberi prefiks petik tunggal (')
 * @param {any} val
 * @returns {any}
 */
export const sanitizeCell = (val) => {
  if (val === null || val === undefined) return "";
  if (typeof val === "number" || typeof val === "boolean") return val;
  const str = String(val);
  if (/^[\s]*[=+\-@]/.test(str)) {
    return `'${str}`;
  }
  return str;
};

/**
 * Ekspor dataset ke format CSV dengan UTF-8 BOM dan pencegahan formula injection.
 */
export const exportToCsv = ({ headers, rows, filename, res }) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  // UTF-8 BOM
  res.write("\uFEFF");

  const headerRow = headers
    .map((h) => {
      const escaped = String(h.label).replace(/"/g, '""');
      return `"${escaped}"`;
    })
    .join(",");
  res.write(`${headerRow}\r\n`);

  for (const row of rows) {
    const line = headers
      .map((h) => {
        const raw = row[h.key];
        const sanitized = sanitizeCell(raw);
        const str = String(sanitized).replace(/"/g, '""');
        return `"${str}"`;
      })
      .join(",");
    res.write(`${line}\r\n`);
  }

  res.end();
};

/**
 * Ekspor dataset ke format XLSX menggunakan ExcelJS.
 */
export const exportToXlsx = async ({ title, headers, rows, filename, res }) => {
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Tallero Auto";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(title.slice(0, 31) || "Laporan");

  worksheet.columns = headers.map((h) => ({
    header: h.label,
    key: h.key,
    width: h.width || 20,
  }));

  // Style header row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E293B" }, // dark slate
  };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.height = 25;

  for (const row of rows) {
    const rowData = {};
    for (const h of headers) {
      const val = row[h.key];
      rowData[h.key] = sanitizeCell(val);
    }
    worksheet.addRow(rowData);
  }

  await workbook.xlsx.write(res);
  res.end();
};

/**
 * Ekspor dataset ke format PDF menggunakan PDFKit (layout tabel bersih).
 */
export const exportToPdf = ({ title, subtitle, headers, rows, filename, res }) => {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  const doc = new PDFDocument({ margin: 40, size: "A4" });
  doc.pipe(res);

  // Header Title
  doc.fontSize(16).font("Helvetica-Bold").text("TALLERO AUTO", 40, 40);
  doc.fontSize(12).font("Helvetica-Bold").text(title, 40, 62);
  if (subtitle) {
    doc.fontSize(9).font("Helvetica").fillColor("#64748B").text(subtitle, 40, 78);
  }

  doc.moveDown(1.5);
  let y = doc.y;

  // Garis pemisah atas
  doc.strokeColor("#E2E8F0").lineWidth(1).moveTo(40, y).lineTo(555, y).stroke();
  y += 6;

  // Header kolom tabel
  const colWidth = 515 / headers.length;
  doc.fontSize(8).font("Helvetica-Bold").fillColor("#1E293B");
  headers.forEach((h, idx) => {
    doc.text(h.label, 40 + idx * colWidth, y, {
      width: colWidth - 4,
      align: h.align || "left",
    });
  });

  y += 14;
  doc.strokeColor("#CBD5E1").lineWidth(1).moveTo(40, y).lineTo(555, y).stroke();
  y += 8;

  // Data rows
  doc.font("Helvetica").fontSize(8).fillColor("#334155");

  for (const row of rows) {
    // Pagination jika mendekati batas bawah halaman
    if (y > 750) {
      doc.addPage();
      y = 40;
    }

    headers.forEach((h, idx) => {
      const val = sanitizeCell(row[h.key]);
      const text = String(val);
      doc.text(text, 40 + idx * colWidth, y, {
        width: colWidth - 4,
        align: h.align || "left",
      });
    });

    y += 14;
  }

  // Garis penutup & Footer
  y += 4;
  doc.strokeColor("#E2E8F0").lineWidth(1).moveTo(40, y).lineTo(555, y).stroke();

  doc.end();
};

export default {
  sanitizeCell,
  exportToCsv,
  exportToXlsx,
  exportToPdf,
};


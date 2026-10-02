/**
 * Quotation PDFs live in the PRIVATE `quotations` bucket and are addressed by object path only
 * ({CODE}-{timestamp}.pdf). Links are signed on demand; nothing public is stored.
 */
export const QUOTATION_PDF_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}-\d{10,16}\.pdf$/;

export function isQuotationPdfPath(path: string): boolean {
  return QUOTATION_PDF_PATH_RE.test(path);
}

import type { DocumentProps } from "@react-pdf/renderer";
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { QuotationPdfDocument } from "@/lib/quotations/pdf-template";
import { uploadQuotationPdf } from "@/lib/quotations/storage";
import { saveQuotationPdfUrlAction } from "@/lib/quotations/actions";
import type { Quotation, QuotationItem } from "@/types/db";

// @react-pdf/renderer must run on Node runtime (uses Buffer / stream).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface QuotationDetail {
  id: string;
  code: string;
  status: Quotation["status"];
  valid_until: string | null;
  notes: string | null;
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  pdf_url: string | null;
  created_at: string;
  customer: {
    id: string;
    name: string;
    type: "retail" | "business";
    phone: string | null;
    email: string | null;
    address: string | null;
    tax_code: string | null;
    contact_person: string | null;
  } | null;
  items: Array<
    QuotationItem & {
      product: { id: string; name: string; sku: string; unit: string } | null;
    }
  >;
}

/**
 * GET /api/quotations/:id/pdf
 *
 * Behavior:
 *  - ?download=1 → streams the freshly rendered PDF as an attachment
 *  - default → generates (or reuses), uploads to Storage, and returns JSON { url }
 *
 * Auth: requires an authenticated session.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const id = params.id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "ID không hợp lệ" }, { status: 400 });
  }

  const auth = await requireUser();
  if (!auth.ok) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const supabase = auth.supabase;

  // Load quotation + items + customer
  const { data: header, error: hErr } = await supabase
    .from("quotations")
    .select(
      "id, code, status, valid_until, notes, subtotal, discount, vat, total, pdf_url, created_at, customer:customers(id, name, type, phone, email, address, tax_code, contact_person)",
    )
    .eq("id", id)
    .maybeSingle();

  if (hErr || !header) {
    return NextResponse.json({ error: "Không tìm thấy báo giá" }, { status: 404 });
  }

  const { data: items, error: iErr } = await supabase
    .from("quotation_items")
    .select(
      "id, quotation_id, product_id, qty, unit_price, discount, line_total, notes, product:products(id, name, sku, unit)",
    )
    .eq("quotation_id", id);

  if (iErr) {
    return NextResponse.json(
      { error: "Không tải được sản phẩm: " + iErr.message },
      { status: 500 },
    );
  }

  const detail: QuotationDetail = {
    ...(header as unknown as QuotationDetail),
    customer: (header as unknown as { customer: QuotationDetail["customer"] })
      .customer,
    items: (items ?? []) as unknown as QuotationDetail["items"],
  };

  // Render PDF (dynamic import to keep the route bundle small)
  const { renderToBuffer } = await import("@react-pdf/renderer");
  const React = await import("react");

  const doc = React.createElement(QuotationPdfDocument, {
    shop: {
      name: process.env.SHOP_NAME || "Shop Manager",
      taxCode: process.env.SHOP_TAX_CODE || undefined,
      address: process.env.SHOP_ADDRESS || undefined,
      phone: process.env.SHOP_PHONE || undefined,
      email: process.env.SHOP_EMAIL || undefined,
    },
    quotation: {
      code: detail.code,
      createdAt: detail.created_at,
      validUntil: detail.valid_until,
      status: detail.status,
      notes: detail.notes,
      subtotal: Number(detail.subtotal),
      discount: Number(detail.discount),
      vat: Number(detail.vat),
      total: Number(detail.total),
    },
    customer: detail.customer
      ? {
          name: detail.customer.name,
          type: detail.customer.type,
          phone: detail.customer.phone,
          email: detail.customer.email,
          address: detail.customer.address,
          taxCode: detail.customer.tax_code,
          contactPerson: detail.customer.contact_person,
        }
      : null,
    items: (detail.items || []).map((it) => ({
      name: it.product?.name || "(Sản phẩm đã xóa)",
      sku: it.product?.sku || null,
      unit: it.product?.unit || null,
      qty: Number(it.qty),
      unit_price: Number(it.unit_price),
      discount: Number(it.discount),
      line_total: Number(it.line_total),
      notes: it.notes || null,
    })),
  });

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderToBuffer(doc as React.ReactElement<DocumentProps>);
  } catch (e) {
    console.error("PDF render failed:", e);
    return NextResponse.json(
      { error: "Không render được PDF: " + (e as Error).message },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  const download = url.searchParams.get("download") === "1";

  // Stream directly to the user
  if (download) {
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${detail.code}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // Otherwise, persist to Storage and return the URL.
  try {
    const { url: storedUrl } = await uploadQuotationPdf({
      code: detail.code,
      pdf: pdfBuffer,
    });
    await saveQuotationPdfUrlAction(detail.id, storedUrl);
    return NextResponse.json({
      ok: true,
      url: storedUrl,
      code: detail.code,
    });
  } catch (e) {
    // Don't fail the user — fall back to streaming the PDF inline.
    console.error("Storage upload failed:", e);
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${detail.code}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }
}

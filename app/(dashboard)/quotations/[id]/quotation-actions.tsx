"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  approveQuotationAction, deleteQuotationAction, getQuotationPdfLinkAction, invoiceFromQuotationAction,
  rejectQuotationAction, sendQuotationAction,
} from "@/lib/quotations/actions";

export function QuotationActions({ id, status, hasPdf, invoiced }: { id: string; status: string; hasPdf: boolean; invoiced: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyPdf, setBusyPdf] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) { toast.error(r.error ?? "Lỗi"); return; }
      toast.success(okMsg);
      after ? after() : router.refresh();
    });

  const makePdf = async () => {
    setBusyPdf(true);
    try {
      const res = await fetch(`/api/quotations/${id}/pdf`);
      if (res.headers.get("content-type")?.includes("application/pdf")) {
        const blob = await res.blob();
        window.open(URL.createObjectURL(blob), "_blank");
      } else {
        const j = await res.json();
        if (!res.ok || !j.url) throw new Error(j.error ?? "Không tạo được PDF");
        window.open(j.url, "_blank", "noopener");
      }
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyPdf(false);
    }
  };

  const openStored = async () => {
    const r = await getQuotationPdfLinkAction(id);
    if (!r.ok) { toast.error(r.error); return; }
    window.open(r.url, "_blank", "noopener");
  };

  return (
    <div className="flex flex-wrap gap-2">
      {status === "draft" && (
        <>
          <Button asChild variant="outline"><Link href={`/quotations/${id}/edit`}>Sửa</Link></Button>
          <Button disabled={pending} onClick={() => run(() => sendQuotationAction(id), "Đã đánh dấu đã gửi")}>Đánh dấu đã gửi</Button>
        </>
      )}
      {status === "sent" && (
        <>
          <Button disabled={pending} onClick={() => run(() => approveQuotationAction(id), "Khách đã duyệt")}>Khách duyệt</Button>
          <Button variant="outline" disabled={pending} onClick={() => run(() => rejectQuotationAction(id), "Đã ghi nhận từ chối")}>Khách từ chối</Button>
        </>
      )}
      {status === "approved" && !invoiced && (
        <Button
          disabled={pending}
          onClick={() => {
            if (!confirm("Lập hóa đơn bán hàng từ báo giá này? Hệ thống sẽ xuất kho theo giá vốn và ghi sổ kế toán.")) return;
            start(async () => {
              const r = await invoiceFromQuotationAction(id);
              if (!r.ok) { toast.error(r.error); return; }
              toast.success(`Đã lập hóa đơn ${r.invoiceNo}`);
              router.refresh();
            });
          }}
        >
          Lập hóa đơn
        </Button>
      )}
      <Button variant="outline" disabled={busyPdf} onClick={makePdf}>{busyPdf ? "Đang tạo PDF…" : "Tạo / tải PDF"}</Button>
      {hasPdf && <Button variant="ghost" onClick={openStored}>Mở PDF đã lưu</Button>}
      {(status === "draft" || status === "rejected") && (
        <Button
          variant="ghost"
          className="text-destructive"
          disabled={pending}
          onClick={() => { if (confirm("Xóa báo giá này?")) run(() => deleteQuotationAction(id), "Đã xóa", () => router.push("/quotations")); }}
        >
          Xóa
        </Button>
      )}
    </div>
  );
}

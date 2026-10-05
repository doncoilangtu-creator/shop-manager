"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileArchive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportAuditPackAction } from "@/lib/actions/audit-pack";
import { fmtMB } from "@/lib/books/audit-pack";

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Nút tạo + tải gói hồ sơ kiểm tra (zip) cho kỳ đã chọn. */
export function AuditPackButton({ year, kind, disabled }: { year: number; kind: string; disabled?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          const r = await exportAuditPackAction({ year, kind });
          if (!r.ok) {
            toast.error(r.error);
            return;
          }
          const blob = new Blob([base64ToBytes(r.data.base64) as BlobPart], { type: "application/zip" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = r.data.filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
          toast.success(`Đã tạo ${r.data.filename} (${fmtMB(r.data.bytes)})`, { description: `SHA-256: ${r.data.sha256.slice(0, 16)}…` });
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileArchive className="mr-2 h-4 w-4" />}
      {pending ? "Đang tạo gói…" : "Tạo & tải gói hồ sơ (.zip)"}
    </Button>
  );
}

"use client";

import { useRef, useState } from "react";
import { SignaturePad, type SignaturePadHandle } from "@/components/signature-pad";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SignFormProps {
  token: string;
  ticketId: string;
  alreadySignedRoles: string[];
}

type Role = "customer" | "technician";

export function SignForm({ token, ticketId, alreadySignedRoles }: SignFormProps) {
  const padRef = useRef<SignaturePadHandle | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("customer");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customerSigned = alreadySignedRoles.includes("customer");
  const technicianSigned = alreadySignedRoles.includes("technician");
  const bothSigned = customerSigned && technicianSigned;

  if (bothSigned) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center shadow-sm">
        <h2 className="text-lg font-semibold text-emerald-700">
          ✓ Đã ký đủ cả 2 bên
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Phiếu bảo trì đã được đóng. Cảm ơn quý khách.
        </p>
      </div>
    );
  }

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError("Vui lòng nhập họ tên.");
      return;
    }
    if (!hasInk) {
      setError("Vui lòng ký tên trước khi xác nhận.");
      return;
    }
    const base64 = padRef.current?.toBase64();
    if (!base64) {
      setError("Không đọc được chữ ký. Vui lòng thử lại.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/sign/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId,
          signerName: name.trim(),
          signerRole: role,
          signaturePng: base64,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Lỗi ${res.status}`);
      }
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center shadow-sm">
        <h2 className="text-lg font-semibold text-emerald-700">
          ✓ Xác nhận thành công
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Chữ ký của bạn đã được ghi nhận. Cảm ơn bạn!
        </p>
      </div>
    );
  }

  // Disable role options that are already taken
  const roles: { value: Role; label: string; hint?: string }[] = [
    {
      value: "customer",
      label: "Khách hàng",
      hint: customerSigned ? "(đã ký)" : undefined,
    },
    {
      value: "technician",
      label: "Kỹ thuật viên",
      hint: technicianSigned ? "(đã ký)" : undefined,
    },
  ];

  return (
    <div className="space-y-4 rounded-lg border bg-card p-6 shadow-sm">
      <div className="space-y-2">
        <Label htmlFor="name">Họ tên người ký</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nguyễn Văn A"
          autoComplete="name"
        />
      </div>

      <div className="space-y-2">
        <Label>Vai trò</Label>
        <div className="grid grid-cols-2 gap-2">
          {roles.map((r) => {
            const taken = !!r.hint;
            const active = role === r.value;
            return (
              <button
                key={r.value}
                type="button"
                disabled={taken}
                onClick={() => setRole(r.value)}
                className={
                  "rounded-md border px-3 py-2 text-sm font-medium transition-colors " +
                  (taken
                    ? "cursor-not-allowed border-dashed bg-muted text-muted-foreground"
                    : active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background hover:bg-accent")
                }
              >
                {r.label}
                {r.hint && (
                  <span className="ml-1 text-xs font-normal">{r.hint}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Chữ ký</Label>
        <SignaturePad ref={padRef} onChange={setHasInk} />
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button
        onClick={submit}
        disabled={submitting || !hasInk || !name.trim()}
        className="w-full"
      >
        {submitting ? "Đang gửi..." : "Xác nhận & ký"}
      </Button>
    </div>
  );
}
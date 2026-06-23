"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, ExternalLink, Send, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { issueSignatureTokenAction } from "@/app/(dashboard)/maintenance/actions";
import { formatDate } from "@/lib/utils";
import type { SignerRole, TicketStatus } from "@/types/db";

interface SignatureRow {
  id: string;
  signer_name: string;
  signer_role: SignerRole;
  signed_at: string;
  signature_png: string;
  ip_address: string | null;
}

interface TokenRow {
  id: string;
  token: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

interface Props {
  ticketId: string;
  status: TicketStatus;
  signatures: SignatureRow[];
  latestToken: TokenRow | null;
  bothSigned: boolean;
}

const ROLE_LABEL: Record<SignerRole, string> = {
  customer: "Khách hàng",
  technician: "Kỹ thuật viên",
};

export function SignaturePanel({
  ticketId,
  status,
  signatures,
  latestToken,
  bothSigned,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<string | null>(
    latestToken && !latestToken.used_at
      ? `${typeof window !== "undefined" ? window.location.origin : ""}/sign/${latestToken.token}`
      : null,
  );
  const [copied, setCopied] = useState(false);

  const send = () => {
    startTransition(async () => {
      const res = await issueSignatureTokenAction(ticketId);
      if (!res.ok) {
        toast.error(res.error || "Không tạo được link");
        return;
      }
      setLink(res.url);
      toast.success("Đã tạo link ký. Gửi cho khách qua Zalo / SMS / email.");
      router.refresh();
    });
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Đã copy link");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Không copy được");
    }
  };

  const canIssue = status === "completed" || status === "awaiting_signature";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ký online</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canIssue ? (
          <Button
            onClick={send}
            disabled={pending}
            className="w-full"
          >
            <Send className="mr-2 h-4 w-4" />
            {pending
              ? "Đang tạo link…"
              : link
              ? "Tạo lại link ký mới"
              : "Gửi link ký cho khách"}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Chỉ gửi link ký khi ticket ở trạng thái <strong>Hoàn thành</strong>{" "}
            hoặc <strong>Chờ ký</strong>.
          </p>
        )}

        {link && (
          <div className="space-y-2 rounded-md border bg-muted/40 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Link ký
              </span>
              {latestToken && !latestToken.used_at && (
                <Badge variant="warning" className="text-[10px]">
                  Hết hạn: {formatDate(latestToken.expires_at)}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              <code className="block flex-1 truncate rounded bg-background px-2 py-1 text-xs">
                {link}
              </code>
              <Button size="icon" variant="outline" onClick={copy}>
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
              <Button asChild size="icon" variant="outline">
                <a href={link} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>
        )}

        <div>
          <p className="text-sm font-medium">
            Chữ ký ({signatures.length}/2)
          </p>
          {bothSigned && (
            <Badge variant="success" className="mt-1">
              Đã ký đủ 2 bên
            </Badge>
          )}
          <ul className="mt-2 space-y-2">
            {(["customer", "technician"] as SignerRole[]).map((role) => {
              const sig = signatures.find((s) => s.signer_role === role);
              return (
                <li
                  key={role}
                  className="flex items-start justify-between gap-2 rounded-md border p-2"
                >
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      {ROLE_LABEL[role]}
                    </p>
                    {sig ? (
                      <>
                        <p className="text-sm font-medium">{sig.signer_name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(sig.signed_at).toLocaleString("vi-VN")}
                        </p>
                      </>
                    ) : (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <X className="h-3 w-3" /> Chưa ký
                      </p>
                    )}
                  </div>
                  {sig && (
                    <img
                      src={`data:image/png;base64,${sig.signature_png}`}
                      alt={`Chữ ký ${ROLE_LABEL[role]}`}
                      className="h-12 w-24 rounded border bg-white object-contain"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
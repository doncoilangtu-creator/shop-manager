"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveBusinessProfileAction } from "@/lib/actions/business";
import { TAX_METHODS, type BusinessProfile, type TaxGroup } from "@/lib/hkd/profile";

const selectCls = "h-9 w-full rounded-md border bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60";

export function BusinessProfileForm({ profile, groups, canEdit, showCitizenId }: {
  profile: BusinessProfile | null;
  groups: TaxGroup[];
  canEdit: boolean;
  showCitizenId: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const p = profile;

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await saveBusinessProfileAction(fd);
      if (!res.ok) { setError(res.error); toast.error(res.error); return; }
      toast.success("Đã lưu hồ sơ hộ kinh doanh");
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      <fieldset disabled={!canEdit || pending} className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="business_name">Tên hộ kinh doanh *</Label>
          <Input id="business_name" name="business_name" required maxLength={255} defaultValue={p?.business_name ?? ""} placeholder="Hộ kinh doanh Cửa hàng máy tính …" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="owner_name">Chủ hộ</Label>
          <Input id="owner_name" name="owner_name" maxLength={255} defaultValue={p?.owner_name ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ledger_signer">Người ký sổ</Label>
          <Input id="ledger_signer" name="ledger_signer" maxLength={255} defaultValue={p?.ledger_signer ?? ""} placeholder="Mặc định: chủ hộ" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tax_code">Mã số thuế / số định danh</Label>
          <Input id="tax_code" name="tax_code" inputMode="numeric" defaultValue={p?.tax_code ?? ""} placeholder="10 số, 13 số (10-3) hoặc 12 số" />
        </div>
        {showCitizenId ? (
          <div className="space-y-2">
            <Label htmlFor="citizen_id">Số CCCD chủ hộ</Label>
            <Input id="citizen_id" name="citizen_id" inputMode="numeric" autoComplete="off" defaultValue={p?.citizen_id ?? ""} placeholder="12 số" />
            <p className="text-xs text-muted-foreground">Thông tin cá nhân — chỉ chủ cửa hàng (owner) xem và sửa được.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <Label>Số CCCD chủ hộ</Label>
            <p className="text-sm text-muted-foreground">Chỉ chủ cửa hàng (owner) xem được.</p>
          </div>
        )}
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="residence_address">Địa chỉ (theo đăng ký kinh doanh / nơi cư trú chủ hộ)</Label>
          <Input id="residence_address" name="residence_address" maxLength={500} defaultValue={p?.residence_address ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Số điện thoại</Label>
          <Input id="phone" name="phone" maxLength={40} defaultValue={p?.phone ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" maxLength={255} defaultValue={p?.email ?? ""} />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="industries">Ngành nghề kinh doanh đã đăng ký</Label>
          <Textarea id="industries" name="industries" rows={2} maxLength={1000} defaultValue={p?.industries ?? ""} placeholder="Bán lẻ máy vi tính, thiết bị ngoại vi, phần mềm; sửa chữa máy vi tính …" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="main_tax_group">Nhóm ngành thuế chính</Label>
          <select id="main_tax_group" name="main_tax_group" className={selectCls} defaultValue={p?.main_tax_group ?? ""}>
            <option value="">— Chưa chọn —</option>
            {groups.map((g) => <option key={g.code} value={g.code}>{g.name_vi}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">Bán lẻ máy tính/linh kiện thuộc nhóm “Phân phối, cung cấp hàng hóa”.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="start_date">Ngày bắt đầu kinh doanh</Label>
          <Input id="start_date" name="start_date" type="date" defaultValue={p?.start_date ?? ""} />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="tax_method">Phương pháp thuế</Label>
          <select id="tax_method" name="tax_method" className={selectCls} defaultValue={p?.tax_method ?? "exempt_notice"}>
            {TAX_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">
            Hộ có doanh thu năm không quá ngưỡng miễn thuế (1 tỷ đồng) chỉ thông báo doanh thu và ghi sổ S1a. Hãy xác nhận với kế toán thuế/Thuế cơ sở.
          </p>
        </div>
      </fieldset>
      {canEdit ? (
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Lưu hồ sơ
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">Chỉ chủ cửa hàng (owner) được sửa hồ sơ.</p>
      )}
    </form>
  );
}

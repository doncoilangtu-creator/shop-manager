"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MapPin, Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveBusinessLocationAction } from "@/lib/actions/business";
import { LOCATION_STATUSES, type BusinessLocation, type TaxGroup } from "@/lib/hkd/profile";
import { formatDate } from "@/lib/utils";

const selectCls = "h-9 w-full rounded-md border bg-background px-3 text-sm";
const statusLabel = (s: string) => LOCATION_STATUSES.find((x) => x.value === s)?.label ?? s;

export function LocationsCard({ locations, groups, canEdit }: { locations: BusinessLocation[]; groups: TaxGroup[]; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<BusinessLocation | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cur = editing && editing !== "new" ? editing : null;

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await saveBusinessLocationAction(fd);
      if (!res.ok) { setError(res.error); toast.error(res.error); return; }
      toast.success("Đã lưu địa điểm kinh doanh");
      setEditing(null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      {locations.length === 0 ? (
        <p className="text-sm text-muted-foreground">Chưa có địa điểm kinh doanh. Thêm trụ sở/cửa hàng để in lên sổ và tờ khai.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {locations.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-3 p-3 text-sm">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 font-medium">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  {l.name}
                  {l.is_hq && <Badge variant="default">Trụ sở</Badge>}
                  <Badge variant={l.status === "active" ? "success" : l.status === "suspended" ? "warning" : "secondary"}>{statusLabel(l.status)}</Badge>
                </div>
                <div className="text-muted-foreground">{l.address}</div>
                <div className="text-xs text-muted-foreground">
                  {l.opened_on && <>Mở: {formatDate(l.opened_on)} </>}
                  {l.closed_on && <>· Đóng: {formatDate(l.closed_on)} </>}
                  {l.tax_location_code && <>· Mã địa điểm thuế: {l.tax_location_code}</>}
                </div>
              </div>
              {canEdit && (
                <Button type="button" variant="ghost" size="sm" onClick={() => { setError(null); setEditing(l); }}>
                  <Pencil className="mr-1 h-4 w-4" />Sửa
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <Button type="button" variant="outline" size="sm" onClick={() => { setError(null); setEditing("new"); }}>
          <Plus className="mr-2 h-4 w-4" />Thêm địa điểm
        </Button>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent>
          {editing !== null && (
            <form onSubmit={submit} className="space-y-4" key={cur?.id ?? "new"}>
              <DialogHeader>
                <DialogTitle>{cur ? "Sửa địa điểm kinh doanh" : "Thêm địa điểm kinh doanh"}</DialogTitle>
                <DialogDescription>Thay đổi địa điểm (thêm, đóng, tạm ngừng) phải thông báo cơ quan thuế trong 10 ngày làm việc (mẫu 01/TB-ĐĐKD).</DialogDescription>
              </DialogHeader>
              {cur && <input type="hidden" name="id" value={cur.id} />}
              <div className="space-y-2">
                <Label htmlFor="loc-name">Tên địa điểm *</Label>
                <Input id="loc-name" name="name" required maxLength={255} defaultValue={cur?.name ?? ""} placeholder="Cửa hàng chính" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="loc-address">Địa chỉ *</Label>
                <Input id="loc-address" name="address" required maxLength={500} defaultValue={cur?.address ?? ""} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="loc-status">Trạng thái</Label>
                  <select id="loc-status" name="status" className={selectCls} defaultValue={cur?.status ?? "active"}>
                    {LOCATION_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="loc-group">Nhóm ngành chính</Label>
                  <select id="loc-group" name="main_tax_group" className={selectCls} defaultValue={cur?.main_tax_group ?? ""}>
                    <option value="">— Chưa chọn —</option>
                    {groups.map((g) => <option key={g.code} value={g.code}>{g.name_vi}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="loc-opened">Ngày mở</Label>
                  <Input id="loc-opened" name="opened_on" type="date" defaultValue={cur?.opened_on ?? ""} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="loc-closed">Ngày đóng</Label>
                  <Input id="loc-closed" name="closed_on" type="date" defaultValue={cur?.closed_on ?? ""} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="loc-code">Mã địa điểm do cơ quan thuế cấp</Label>
                <Input id="loc-code" name="tax_location_code" maxLength={60} defaultValue={cur?.tax_location_code ?? ""} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="is_hq" defaultChecked={cur?.is_hq ?? locations.length === 0} />
                Đây là trụ sở (địa điểm chính)
              </label>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Lưu địa điểm"}</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

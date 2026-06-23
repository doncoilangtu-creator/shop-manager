"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Save, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createSupplier, updateSupplier } from "@/lib/actions/suppliers";

const debtRowSchema = z.object({
  amount: z.coerce.number().min(0.01, "Số tiền > 0"),
  due_date: z.string().optional(),
  notes: z.string().max(500).optional(),
});

const supplierFormSchema = z.object({
  name: z.string().min(1, "Tên bắt buộc").max(255),
  tax_code: z.string().max(40).optional(),
  phone: z.string().max(40).optional(),
  email: z
    .string()
    .max(255)
    .optional()
    .refine(
      (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      "Email không hợp lệ",
    ),
  address: z.string().max(500).optional(),
  contact_person: z.string().max(120).optional(),
  bank_account: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
  debts: z.array(debtRowSchema).default([]),
});

type SupplierFormValues = z.infer<typeof supplierFormSchema>;

interface Props {
  mode: "create" | "edit";
  initial?: {
    name: string;
    tax_code: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    contact_person: string | null;
    bank_account: string | null;
    notes: string | null;
  };
  supplierId?: string;
}

export function SupplierForm({ mode, initial, supplierId }: Props) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const defaults: SupplierFormValues = {
    name: initial?.name ?? "",
    tax_code: initial?.tax_code ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    address: initial?.address ?? "",
    contact_person: initial?.contact_person ?? "",
    bank_account: initial?.bank_account ?? "",
    notes: initial?.notes ?? "",
    debts: [],
  };

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: defaults,
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "debts",
  });

  const onSubmit = (values: SupplierFormValues) => {
    setServerError(null);

    const fd = new FormData();
    fd.set("name", values.name.trim());
    fd.set("tax_code", values.tax_code ?? "");
    fd.set("phone", values.phone ?? "");
    fd.set("email", values.email ?? "");
    fd.set("address", values.address ?? "");
    fd.set("contact_person", values.contact_person ?? "");
    fd.set("bank_account", values.bank_account ?? "");
    fd.set("notes", values.notes ?? "");

    for (const d of values.debts ?? []) {
      fd.append("debt_amount", String(d.amount ?? ""));
      fd.append("debt_due_date", d.due_date ?? "");
      fd.append("debt_notes", d.notes ?? "");
    }

    startTransition(async () => {
      const res = mode === "create"
        ? await createSupplier(fd)
        : await updateSupplier(supplierId!, fd);
      if (!res.ok) {
        setServerError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success(mode === "create" ? "Đã tạo đối tác" : "Đã cập nhật");
      router.push("/suppliers");
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {serverError && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {serverError}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Thông tin đối tác</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="name">Tên đối tác *</Label>
            <Input id="name" {...register("name")} placeholder="Công ty TNHH …" />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="tax_code">Mã số thuế</Label>
            <Input id="tax_code" {...register("tax_code")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Số điện thoại</Label>
            <Input id="phone" {...register("phone")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" {...register("email")} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact_person">Người liên hệ</Label>
            <Input id="contact_person" {...register("contact_person")} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="address">Địa chỉ</Label>
            <Input id="address" {...register("address")} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="bank_account">Tài khoản ngân hàng</Label>
            <Input id="bank_account" {...register("bank_account")} placeholder="VCB — 0123 456 789" />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="notes">Ghi chú</Label>
            <Textarea id="notes" {...register("notes")} rows={3} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Công nợ phải trả</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ amount: 0, due_date: "", notes: "" })}
          >
            <Plus className="mr-2 h-4 w-4" />
            Thêm dòng nợ
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {fields.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Chưa có dòng nợ nào. Bấm &ldquo;Thêm dòng nợ&rdquo; để ghi nhận.
            </p>
          )}
          {fields.map((field, index) => (
            <div
              key={field.id}
              className="grid grid-cols-1 items-end gap-3 rounded-md border p-3 md:grid-cols-[1fr_180px_2fr_auto]"
            >
              <div className="space-y-1">
                <Label className="text-xs">Số tiền (đ) *</Label>
                <Input
                  type="number"
                  min={0}
                  step={1000}
                  {...register(`debts.${index}.amount` as const)}
                />
                {errors.debts?.[index]?.amount && (
                  <p className="text-xs text-destructive">
                    {errors.debts[index].amount.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Hạn thanh toán</Label>
                <Input
                  type="date"
                  {...register(`debts.${index}.due_date` as const)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Ghi chú</Label>
                <Input
                  {...register(`debts.${index}.notes` as const)}
                  placeholder="VD: Hóa đơn 001"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-destructive"
                onClick={() => remove(index)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Hủy
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {mode === "create" ? "Tạo đối tác" : "Lưu thay đổi"}
        </Button>
      </div>
    </form>
  );
}

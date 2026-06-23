"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Save, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createCustomer, updateCustomer } from "@/lib/actions/customers";

const customerFormSchema = z.object({
  type: z.enum(["retail", "business"]),
  name: z.string().min(1, "Tên bắt buộc").max(255),
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
  tax_code: z.string().max(40).optional(),
  contact_person: z.string().max(120).optional(),
  contact_phone: z.string().max(40).optional(),
  debt_limit: z.coerce.number().min(0).default(0),
  notes: z.string().max(2000).optional(),
});

type CustomerFormValues = z.infer<typeof customerFormSchema>;

interface InitialValues {
  type: "retail" | "business";
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_code: string | null;
  contact_person: string | null;
  contact_phone: string | null;
  debt_limit: number;
  notes: string | null;
  tags: string[];
}

interface Props {
  mode: "create" | "edit";
  initial?: InitialValues;
  customerId?: string;
}

export function CustomerForm({ mode, initial, customerId }: Props) {
  const router = useRouter();
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const defaults: CustomerFormValues = {
    type: initial?.type ?? "retail",
    name: initial?.name ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    address: initial?.address ?? "",
    tax_code: initial?.tax_code ?? "",
    contact_person: initial?.contact_person ?? "",
    contact_phone: initial?.contact_phone ?? "",
    debt_limit: initial?.debt_limit ?? 0,
    notes: initial?.notes ?? "",
  };

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: defaults,
  });

  const typeVal = watch("type");

  const addTag = () => {
    const v = tagInput.trim();
    if (v && !tags.includes(v)) {
      setTags([...tags, v]);
      setTagInput("");
    } else {
      setTagInput("");
    }
  };

  const removeTag = (t: string) => {
    setTags(tags.filter((x) => x !== t));
  };

  const onSubmit = (values: CustomerFormValues) => {
    setServerError(null);

    const fd = new FormData();
    fd.set("type", values.type);
    fd.set("name", values.name.trim());
    fd.set("phone", values.phone ?? "");
    fd.set("email", values.email ?? "");
    fd.set("address", values.address ?? "");
    fd.set("tax_code", values.tax_code ?? "");
    fd.set("contact_person", values.contact_person ?? "");
    fd.set("contact_phone", values.contact_phone ?? "");
    fd.set("debt_limit", String(values.debt_limit ?? 0));
    fd.set("notes", values.notes ?? "");
    for (const t of tags) fd.append("tags", t);

    startTransition(async () => {
      const res = mode === "create"
        ? await createCustomer(fd)
        : await updateCustomer(customerId!, fd);
      if (!res.ok) {
        setServerError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success(mode === "create" ? "Đã tạo khách hàng" : "Đã cập nhật");
      router.push("/customers");
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
          <CardTitle>Thông tin chung</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Loại khách</Label>
            <Select
              value={typeVal}
              onValueChange={(v) =>
                setValue("type", v as "retail" | "business", { shouldValidate: true })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="retail">Khách lẻ</SelectItem>
                <SelectItem value="business">Doanh nghiệp</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Tên khách hàng *</Label>
            <Input id="name" {...register("name")} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Số điện thoại</Label>
            <Input id="phone" {...register("phone")} placeholder="0901234567" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" {...register("email")} placeholder="ten@example.com" />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="address">Địa chỉ</Label>
            <Input id="address" {...register("address")} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Tags</Label>
            <div className="flex flex-wrap gap-2 rounded-md border bg-background p-2">
              {tags.map((t) => (
                <Badge key={t} variant="secondary" className="gap-1">
                  {t}
                  <button
                    type="button"
                    onClick={() => removeTag(t)}
                    className="ml-1 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <div className="flex flex-1 items-center gap-1">
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="VIP, doanh-nghiep, …"
                  className="h-7 border-0 bg-transparent shadow-none focus-visible:ring-0"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={addTag}
                  disabled={!tagInput.trim()}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="notes">Ghi chú</Label>
            <Textarea id="notes" {...register("notes")} rows={3} />
          </div>
        </CardContent>
      </Card>

      {typeVal === "business" && (
        <Card>
          <CardHeader>
            <CardTitle>Thông tin doanh nghiệp</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tax_code">Mã số thuế</Label>
              <Input id="tax_code" {...register("tax_code")} placeholder="0312345678" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="debt_limit">Hạn mức công nợ (đ)</Label>
              <Input
                id="debt_limit"
                type="number"
                min={0}
                step={1000000}
                {...register("debt_limit")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact_person">Người liên hệ</Label>
              <Input id="contact_person" {...register("contact_person")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact_phone">SĐT người liên hệ</Label>
              <Input id="contact_phone" {...register("contact_phone")} />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Hủy
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {mode === "create" ? "Tạo khách hàng" : "Lưu thay đổi"}
        </Button>
      </div>
    </form>
  );
}

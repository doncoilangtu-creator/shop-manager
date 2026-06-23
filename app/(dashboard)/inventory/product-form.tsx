"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createProduct, updateProduct } from "@/lib/actions/inventory";

const productFormSchema = z.object({
  sku: z.string().min(1, "SKU bắt buộc").max(100),
  name: z.string().min(1, "Tên bắt buộc").max(255),
  category_id: z.string().optional(),
  brand: z.string().max(120).optional(),
  model: z.string().max(120).optional(),
  description: z.string().max(2000).optional(),
  unit: z.string().min(1).max(40).default("cái"),
  cost_price: z.coerce.number().min(0).default(0),
  sell_price: z.coerce.number().min(0).default(0),
  stock_qty: z.coerce.number().int().min(0).default(0),
  min_stock: z.coerce.number().int().min(0).default(0),
  location: z.string().max(120).optional(),
  warranty_months: z.coerce.number().int().min(0).default(0),
  image_urls_text: z.string().optional(),
});

type ProductFormValues = z.infer<typeof productFormSchema>;

interface Category {
  id: string;
  name: string;
}

interface InitialValues {
  sku: string;
  name: string;
  category_id: string | null;
  brand: string | null;
  model: string | null;
  description: string | null;
  unit: string;
  cost_price: number;
  sell_price: number;
  stock_qty: number;
  min_stock: number;
  location: string | null;
  warranty_months: number;
  image_urls: string[];
}

interface Props {
  mode: "create" | "edit";
  categories: Category[];
  initial?: InitialValues;
  productId?: string;
}

export function ProductForm({ mode, categories, initial, productId }: Props) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const defaults: ProductFormValues = {
    sku: initial?.sku ?? "",
    name: initial?.name ?? "",
    category_id: initial?.category_id ?? "__none__",
    brand: initial?.brand ?? "",
    model: initial?.model ?? "",
    description: initial?.description ?? "",
    unit: initial?.unit ?? "cái",
    cost_price: initial?.cost_price ?? 0,
    sell_price: initial?.sell_price ?? 0,
    stock_qty: initial?.stock_qty ?? 0,
    min_stock: initial?.min_stock ?? 0,
    location: initial?.location ?? "",
    warranty_months: initial?.warranty_months ?? 0,
    image_urls_text: initial?.image_urls?.join("\n") ?? "",
  };

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: defaults,
  });

  const categoryVal = watch("category_id");

  const onSubmit = (values: ProductFormValues) => {
    setServerError(null);

    const fd = new FormData();
    fd.set("sku", values.sku.trim());
    fd.set("name", values.name.trim());
    fd.set("category_id", values.category_id && values.category_id !== "__none__" ? values.category_id : "");
    fd.set("brand", values.brand ?? "");
    fd.set("model", values.model ?? "");
    fd.set("description", values.description ?? "");
    fd.set("unit", values.unit || "cái");
    fd.set("cost_price", String(values.cost_price ?? 0));
    fd.set("sell_price", String(values.sell_price ?? 0));
    fd.set("stock_qty", String(values.stock_qty ?? 0));
    fd.set("min_stock", String(values.min_stock ?? 0));
    fd.set("location", values.location ?? "");
    fd.set("warranty_months", String(values.warranty_months ?? 0));

    const urls = (values.image_urls_text ?? "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const u of urls) fd.append("image_urls", u);

    startTransition(async () => {
      const res = mode === "create"
        ? await createProduct(fd)
        : await updateProduct(productId!, fd);
      if (!res.ok) {
        setServerError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success(mode === "create" ? "Đã tạo sản phẩm" : "Đã cập nhật");
      router.push("/inventory");
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
            <Label htmlFor="sku">SKU *</Label>
            <Input
              id="sku"
              {...register("sku")}
              placeholder="VD: PC-DELL-001"
              className="font-mono"
            />
            {errors.sku && <p className="text-xs text-destructive">{errors.sku.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Tên sản phẩm *</Label>
            <Input id="name" {...register("name")} placeholder="VD: PC Dell Optiplex 7090" />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Nhóm</Label>
            <Select
              value={categoryVal || "__none__"}
              onValueChange={(v) => setValue("category_id", v, { shouldValidate: true })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Chọn nhóm…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Không —</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="unit">Đơn vị</Label>
            <Input id="unit" {...register("unit")} placeholder="cái / bộ / hộp" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="brand">Hãng</Label>
            <Input id="brand" {...register("brand")} placeholder="Dell, ASUS, …" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="model">Model</Label>
            <Input id="model" {...register("model")} placeholder="Optiplex 7090, …" />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="description">Mô tả</Label>
            <Textarea id="description" {...register("description")} rows={3} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Giá & tồn kho</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="cost_price">Giá nhập (đ)</Label>
            <Input
              id="cost_price"
              type="number"
              min={0}
              step={1000}
              {...register("cost_price")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sell_price">Giá bán (đ)</Label>
            <Input
              id="sell_price"
              type="number"
              min={0}
              step={1000}
              {...register("sell_price")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="warranty_months">Bảo hành (tháng)</Label>
            <Input
              id="warranty_months"
              type="number"
              min={0}
              {...register("warranty_months")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="stock_qty">Tồn kho</Label>
            <Input id="stock_qty" type="number" min={0} {...register("stock_qty")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="min_stock">Tồn tối thiểu</Label>
            <Input id="min_stock" type="number" min={0} {...register("min_stock")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="location">Vị trí</Label>
            <Input id="location" {...register("location")} placeholder="Kệ A1, tầng 2" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hình ảnh</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="image_urls_text">URLs (mỗi dòng một URL)</Label>
          <Textarea
            id="image_urls_text"
            {...register("image_urls_text")}
            rows={4}
            placeholder="https://…"
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Hủy
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {mode === "create" ? "Tạo sản phẩm" : "Lưu thay đổi"}
        </Button>
      </div>
    </form>
  );
}

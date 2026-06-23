import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SupplierForm } from "../supplier-form";

export default function NewSupplierPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href="/suppliers">
            <ChevronLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Thêm đối tác</h1>
          <p className="text-sm text-muted-foreground">
            Tạo nhà cung cấp và ghi nhận công nợ ban đầu (nếu có).
          </p>
        </div>
      </div>
      <SupplierForm mode="create" />
    </div>
  );
}

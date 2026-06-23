import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CustomerForm } from "../customer-form";

export default function NewCustomerPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href="/customers">
            <ChevronLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Thêm khách hàng</h1>
          <p className="text-sm text-muted-foreground">
            Tạo khách lẻ hoặc doanh nghiệp.
          </p>
        </div>
      </div>
      <CustomerForm mode="create" />
    </div>
  );
}

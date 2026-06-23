"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  Users,
  Truck,
  FileText,
  Wrench,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inventory", label: "Kho", icon: Package },
  { href: "/customers", label: "Khách hàng", icon: Users },
  { href: "/suppliers", label: "Đối tác", icon: Truck },
  { href: "/quotations", label: "Báo giá", icon: FileText },
  { href: "/maintenance", label: "Bảo trì", icon: Wrench },
  { href: "/reports", label: "Báo cáo", icon: BarChart3 },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden h-screen w-60 shrink-0 flex-col border-r bg-card md:flex">
      <div className="flex h-16 items-center gap-2 border-b px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold">
          S
        </div>
        <div>
          <div className="font-semibold leading-tight">Shop Manager</div>
          <div className="text-xs text-muted-foreground">Cửa hàng máy tính</div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {nav.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-4 text-xs text-muted-foreground">
        v0.1.0 · {new Date().getFullYear()}
      </div>
    </aside>
  );
}

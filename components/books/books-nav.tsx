import Link from "next/link";
import { BOOKS_NAV } from "@/lib/books/nav";
import { cn } from "@/lib/utils";

/** Thanh chuyển trang trong khu “Sổ sách” (server component, `active` = href trang hiện tại). */
export function BooksNav({ active }: { active: string }) {
  return (
    <nav aria-label="Sổ sách" className="flex flex-wrap gap-1 border-b">
      {BOOKS_NAV.map((n) => (
        <Link key={n.href} href={n.href} aria-current={n.href === active ? "page" : undefined}
          className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", n.href === active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

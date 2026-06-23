"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useTransition } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Category {
  id: string;
  name: string;
}

interface Props {
  categories: Category[];
  currentQ: string;
  currentCategory: string;
}

export function InventoryFilterBar({ categories, currentQ, currentCategory }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(currentQ);
  const [, startTransition] = useTransition();

  useEffect(() => {
    setQ(currentQ);
  }, [currentQ]);

  const update = (next: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") params.delete(k);
      else params.set(k, v);
    }
    if (!("page" in next)) params.delete("page");
    startTransition(() => {
      router.replace(`?${params.toString()}`);
    });
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    update({ q: q.trim() || null });
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <form onSubmit={onSubmit} className="flex flex-1 items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Tìm theo tên hoặc SKU…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="secondary">
          Tìm
        </Button>
        {currentQ && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              setQ("");
              update({ q: null });
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </form>
      <div className="w-full sm:w-[240px]">
        <Select
          value={currentCategory || "all"}
          onValueChange={(v) => update({ category: v === "all" ? null : v })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Lọc theo nhóm" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả nhóm</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

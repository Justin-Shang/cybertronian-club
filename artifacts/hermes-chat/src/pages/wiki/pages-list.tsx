import { useState, useEffect } from "react";
import { WikiLayout } from "@/components/wiki/layout";
import { PageCard } from "@/components/wiki/page-card";
import { useListPages, ListPagesCategory } from "@workspace/api-client-react";
import { Search, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

export default function WikiPagesList() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const debouncedSearch = useDebounce(search, 300);

  const { data: pages, isLoading } = useListPages({
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(category && category !== "all" ? { category: category as ListPagesCategory } : {}),
  });

  return (
    <WikiLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-1">All Pages</h1>
            <p className="text-muted-foreground">Browse and search all wiki content.</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by title or content..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-card"
            />
          </div>
          <div className="w-full sm:w-48 shrink-0">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="bg-card">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4" />
                  <SelectValue placeholder="All categories" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                <SelectItem value="communication">Communication</SelectItem>
                <SelectItem value="skill">Skill</SelectItem>
                <SelectItem value="document">Document</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-48 bg-muted animate-pulse rounded-lg border border-border"></div>
            ))}
          </div>
        ) : pages && pages.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pages.map((page) => <PageCard key={page.id} page={page} />)}
          </div>
        ) : (
          <div className="py-16 text-center border border-dashed border-border rounded-lg">
            <p className="text-lg font-medium text-foreground mb-1">No pages found</p>
            <p className="text-muted-foreground">Try adjusting your search or filters.</p>
          </div>
        )}
      </div>
    </WikiLayout>
  );
}

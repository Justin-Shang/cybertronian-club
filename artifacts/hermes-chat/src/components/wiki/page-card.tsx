import { Link } from "wouter";
import { format } from "date-fns";
import { FileText, MessageSquare, Wrench } from "lucide-react";
import { Page } from "@workspace/api-client-react";

export function CategoryBadge({ category }: { category: string }) {
  let colorClass = "bg-gray-100 text-gray-800 border-gray-200";
  let Icon = FileText;

  if (category === "communication") {
    colorClass = "bg-blue-50 text-blue-700 border-blue-100";
    Icon = MessageSquare;
  } else if (category === "skill") {
    colorClass = "bg-green-50 text-green-700 border-green-100";
    Icon = Wrench;
  } else if (category === "document") {
    colorClass = "bg-amber-50 text-amber-700 border-amber-100";
    Icon = FileText;
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${colorClass}`}>
      <Icon className="w-3 h-3" />
      <span className="capitalize">{category}</span>
    </span>
  );
}

export function PageCard({ page }: { page: Page }) {
  return (
    <Link href={`/wiki/pages/${page.id}`}>
      <div className="group block h-full bg-card border border-border rounded-lg p-5 hover:shadow-md hover:border-primary/20 transition-all cursor-pointer">
        <div className="flex justify-between items-start gap-4 mb-3">
          <h3 className="text-base font-medium text-foreground group-hover:text-primary transition-colors line-clamp-2">
            {page.title}
          </h3>
          <CategoryBadge category={page.category} />
        </div>

        <p className="text-sm text-muted-foreground line-clamp-3 mb-4 leading-relaxed">
          {page.content.substring(0, 150)}
          {page.content.length > 150 ? "..." : ""}
        </p>

        <div className="flex flex-wrap items-center justify-between gap-2 mt-auto pt-4 border-t border-border/50 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-secondary flex items-center justify-center text-foreground font-medium uppercase">
              {page.author.charAt(0)}
            </div>
            <span className="font-medium">{page.author}</span>
          </div>
          <time dateTime={page.updatedAt}>
            {format(new Date(page.updatedAt), "MMM d, yyyy")}
          </time>
        </div>
      </div>
    </Link>
  );
}

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AuthedImage } from "@/components/wiki/authed-image";
import { WikiLayout } from "@/components/wiki/layout";
import { CategoryBadge } from "@/components/wiki/page-card";
import { Button } from "@/components/ui/button";
import { useDeletePage, useGetPage, getGetPageQueryKey, getListPagesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, Edit, Trash2 } from "lucide-react";
import { Link, useLocation, useParams } from "wouter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

export default function WikiPageView() {
  const { id } = useParams();
  const pageId = parseInt(id || "0", 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: page, isLoading } = useGetPage(pageId, {
    query: {
      enabled: !!pageId,
      queryKey: getGetPageQueryKey(pageId),
    },
  });

  const deleteMutation = useDeletePage({
    mutation: {
      onSuccess: () => {
        toast({ title: "Page deleted" });
        queryClient.invalidateQueries({ queryKey: getListPagesQueryKey() });
        setLocation("/wiki/pages");
      },
      onError: () => {
        toast({ title: "Failed to delete page", variant: "destructive" });
      },
    },
  });

  if (isLoading) {
    return (
      <WikiLayout>
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-muted w-1/4 rounded"></div>
          <div className="h-12 bg-muted w-3/4 rounded"></div>
          <div className="space-y-3">
            <div className="h-4 bg-muted rounded"></div>
            <div className="h-4 bg-muted rounded"></div>
            <div className="h-4 bg-muted w-5/6 rounded"></div>
          </div>
        </div>
      </WikiLayout>
    );
  }

  if (!page) {
    return (
      <WikiLayout>
        <div className="text-center py-20">
          <h2 className="text-xl font-bold mb-2">Page not found</h2>
          <Link href="/wiki/pages" className="text-primary hover:underline">Return to pages</Link>
        </div>
      </WikiLayout>
    );
  }

  return (
    <WikiLayout>
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex items-center gap-2">
          <Link href="/wiki/pages" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
            <ArrowLeft className="w-4 h-4" />
            Back to pages
          </Link>
        </div>

        <header className="border-b border-border pb-6">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-4">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">{page.title}</h1>
            <div className="flex items-center gap-2 shrink-0">
              <Link href={`/wiki/pages/${page.id}/edit`}>
                <Button variant="outline" size="sm" className="gap-2">
                  <Edit className="w-4 h-4" />
                  Edit
                </Button>
              </Link>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2 text-destructive border-destructive/20 hover:bg-destructive/10">
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action cannot be undone. This will permanently delete the page.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => deleteMutation.mutate({ id: pageId })}
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm">
            <CategoryBadge category={page.category} />
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <span className="font-medium text-foreground">{page.author}</span>
              <span>·</span>
              <time dateTime={page.createdAt}>
                Created {format(new Date(page.createdAt), "MMM d, yyyy")}
              </time>
              {page.updatedAt !== page.createdAt && (
                <>
                  <span>·</span>
                  <time dateTime={page.updatedAt}>
                    Updated {format(new Date(page.updatedAt), "MMM d, yyyy")}
                  </time>
                </>
              )}
            </div>
          </div>

          {page.tags && page.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {page.tags.map((tag) => (
                <span key={tag} className="px-2 py-0.5 bg-secondary text-secondary-foreground rounded-md text-xs font-mono">
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </header>

        <div className="prose dark:prose-invert max-w-none prose-img:rounded-lg prose-img:border prose-img:border-border">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{ img: (props) => <AuthedImage {...props} src={props.src ?? ""} /> }}
          >
            {page.content}
          </ReactMarkdown>
        </div>
      </div>
    </WikiLayout>
  );
}

import { useEffect, useRef } from "react";
import { WikiLayout } from "@/components/wiki/layout";
import {
  useCreatePage,
  useGetPage,
  useUpdatePage,
  useGetPagesTree,
  getGetPageQueryKey,
  getListPagesQueryKey,
  getGetPagesTreeQueryKey,
  PageTreeNode,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";

const NONE = "__none__";

const formSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  content: z.string().min(1, "Content is required"),
  category: z.enum(["communication", "skill", "document"]),
  author: z.string().min(1, "Author is required").max(50),
  tags: z.string().optional(),
  parentId: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

function flattenTree(
  nodes: PageTreeNode[],
  excludeId?: number,
  depth = 0,
): { id: number; title: string; depth: number }[] {
  const result: { id: number; title: string; depth: number }[] = [];
  for (const node of nodes) {
    if (node.id === excludeId) continue;
    result.push({ id: node.id, title: node.title, depth });
    if (node.children?.length) {
      result.push(...flattenTree(node.children, excludeId, depth + 1));
    }
  }
  return result;
}

export default function WikiPageForm() {
  const { id } = useParams();
  const isEditing = !!id && id !== "new";
  const pageId = parseInt(id || "0", 10);

  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: page, isLoading } = useGetPage(pageId, {
    query: { enabled: isEditing && !!pageId, queryKey: getGetPageQueryKey(pageId) },
  });

  const { data: tree = [] } = useGetPagesTree({
    query: { queryKey: getGetPagesTreeQueryKey() },
  });

  const flatPages = flattenTree(tree, isEditing ? pageId : undefined);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      content: "",
      category: "document",
      author: "",
      tags: "",
      parentId: NONE,
    },
  });

  useEffect(() => {
    if (page && isEditing) {
      form.reset({
        title: page.title,
        content: page.content,
        category: page.category,
        author: page.author,
        tags: page.tags?.join(", ") || "",
        parentId: page.parentId != null ? String(page.parentId) : NONE,
      });
    }
  }, [page, isEditing, form]);

  const createMutation = useCreatePage({
    mutation: {
      onSuccess: (data) => {
        toast({ title: "Page created" });
        queryClient.invalidateQueries({ queryKey: getListPagesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPagesTreeQueryKey() });
        setLocation(`/wiki/pages/${data.id}`);
      },
      onError: () => toast({ title: "Failed to create page", variant: "destructive" }),
    },
  });

  const updateMutation = useUpdatePage({
    mutation: {
      onSuccess: (data) => {
        toast({ title: "Page updated" });
        queryClient.invalidateQueries({ queryKey: getGetPageQueryKey(pageId) });
        queryClient.invalidateQueries({ queryKey: getListPagesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPagesTreeQueryKey() });
        setLocation(`/wiki/pages/${data.id}`);
      },
      onError: () => toast({ title: "Failed to update page", variant: "destructive" }),
    },
  });

  const onSubmit = (values: FormValues) => {
    const parentId =
      values.parentId && values.parentId !== NONE ? parseInt(values.parentId, 10) : null;
    const data = {
      title: values.title,
      content: values.content,
      category: values.category,
      author: values.author,
      tags: values.tags ? values.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
      parentId,
    };

    if (isEditing) {
      updateMutation.mutate({ id: pageId, data });
    } else {
      createMutation.mutate({ data });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  if (isEditing && isLoading) {
    return (
      <WikiLayout>
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-muted w-1/4 rounded" />
          <div className="h-[400px] bg-muted w-full rounded" />
        </div>
      </WikiLayout>
    );
  }

  return (
    <WikiLayout>
      <div className="max-w-4xl mx-auto">
        <Link
          href={isEditing ? `/wiki/pages/${pageId}` : "/wiki/pages"}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          {isEditing ? "Back to page" : "Back to pages"}
        </Link>

        <h1 className="text-2xl font-bold tracking-tight mb-6">
          {isEditing ? "Edit Page" : "Create New Page"}
        </h1>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="Page title" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="communication">Communication</SelectItem>
                        <SelectItem value="skill">Skill</SelectItem>
                        <SelectItem value="document">Document</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="author"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Author</FormLabel>
                    <FormControl>
                      <Input placeholder="Your name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="parentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Parent Page</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? NONE}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="None (root)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>None (root)</SelectItem>
                        {flatPages.map((p) => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            {"  ".repeat(p.depth)}
                            {p.depth > 0 ? "└ " : ""}
                            {p.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>Place under a parent page</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="tags"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tags</FormLabel>
                  <FormControl>
                    <Input placeholder="architecture, planning, draft" {...field} />
                  </FormControl>
                  <FormDescription>Comma-separated</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="content"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Content (Markdown)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Write your content here..."
                      className="min-h-[400px] font-mono text-sm resize-y"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>Supports Markdown with GFM.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-3 pt-4 border-t border-border">
              <Link href={isEditing ? `/wiki/pages/${pageId}` : "/wiki/pages"}>
                <Button type="button" variant="outline">Cancel</Button>
              </Link>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : isEditing ? "Save Changes" : "Create Page"}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </WikiLayout>
  );
}

import { WikiLayout } from "@/components/wiki/layout";
import { PageCard } from "@/components/wiki/page-card";
import { useGetWikiSummary, useGetRecentActivity, useGetWeeklyDigest } from "@workspace/api-client-react";
import { FileText, MessageSquare, Wrench, BarChart2 } from "lucide-react";
import { Link } from "wouter";

export default function WikiHome() {
  const { data: summary, isLoading: loadingSummary } = useGetWikiSummary();
  const { data: recent, isLoading: loadingRecent } = useGetRecentActivity({ limit: 5 });
  const { data: digest, isLoading: loadingDigest } = useGetWeeklyDigest();

  return (
    <WikiLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">Wiki Overview</h1>
          <p className="text-muted-foreground">A shared workspace for the Hermes team.</p>
        </div>

        <section>
          {loadingSummary ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-24 bg-muted animate-pulse rounded-lg border border-border"></div>
              ))}
            </div>
          ) : summary ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-card border border-border p-5 rounded-lg flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-2 text-muted-foreground">
                  <BarChart2 className="w-4 h-4" />
                  <span className="text-sm font-medium">Total Pages</span>
                </div>
                <div className="text-3xl font-bold">{summary.totalPages}</div>
              </div>
              <div className="bg-card border border-border p-5 rounded-lg flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-2 text-blue-600">
                  <MessageSquare className="w-4 h-4" />
                  <span className="text-sm font-medium">Communications</span>
                </div>
                <div className="text-3xl font-bold">{summary.byCategory.communication}</div>
              </div>
              <div className="bg-card border border-border p-5 rounded-lg flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-2 text-green-600">
                  <Wrench className="w-4 h-4" />
                  <span className="text-sm font-medium">Skills</span>
                </div>
                <div className="text-3xl font-bold">{summary.byCategory.skill}</div>
              </div>
              <div className="bg-card border border-border p-5 rounded-lg flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-2 text-amber-600">
                  <FileText className="w-4 h-4" />
                  <span className="text-sm font-medium">Documents</span>
                </div>
                <div className="text-3xl font-bold">{summary.byCategory.document}</div>
              </div>
            </div>
          ) : null}
        </section>

        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Recently Updated</h2>
            <Link href="/wiki/pages" className="text-sm text-primary hover:underline">View all</Link>
          </div>
          {loadingRecent ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-20 bg-muted animate-pulse rounded-lg border border-border" />
              ))}
            </div>
          ) : recent && recent.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {recent.map((page) => <PageCard key={page.id} page={page} />)}
            </div>
          ) : (
            <div className="py-10 text-center border border-dashed border-border rounded-lg">
              <p className="text-muted-foreground text-sm">No pages yet. <Link href="/wiki/pages/new" className="text-primary hover:underline">Create the first one</Link>.</p>
            </div>
          )}
        </section>

        {!loadingDigest && digest && digest.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-4">This Week</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {digest.slice(0, 6).map((page) => <PageCard key={page.id} page={page} />)}
            </div>
          </section>
        )}
      </div>
    </WikiLayout>
  );
}

import { useState, useRef } from "react";
import { WikiLayout } from "@/components/wiki/layout";
import { PageCard } from "@/components/wiki/page-card";
import { useGetWikiSummary, useGetRecentActivity, useGetWeeklyDigest } from "@workspace/api-client-react";
import { FileText, MessageSquare, Wrench, BarChart2, Upload, Image } from "lucide-react";
import { Link } from "wouter";

export default function WikiHome() {
  const { data: summary, isLoading: loadingSummary } = useGetWikiSummary();
  const { data: recent, isLoading: loadingRecent } = useGetRecentActivity({ limit: 5 });
  const { data: digest, isLoading: loadingDigest } = useGetWeeklyDigest();

  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFaviconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/svg+xml", "image/jpeg", "image/webp"].includes(file.type)) {
      setUploadMsg("Only PNG, JPEG, WebP, or SVG images allowed.");
      return;
    }
    setUploading(true);
    setUploadMsg("");
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/favicon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64 }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }
      setUploadMsg("Favicon updated! Refresh to see the change.");
      // Reload favicon in browser
      const link = document.querySelector("link[rel='icon']") as HTMLLinkElement;
      if (link) link.href = "/favicon.svg?v=" + Date.now();
    } catch (err: any) {
      setUploadMsg(err.message || "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

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

        {/* Favicon Upload */}
        <section className="bg-card border border-border rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3">
            <Image className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold">Browser Tab Icon</h2>
          </div>
          <div className="flex items-center gap-4">
            <img
              src="/favicon.svg"
              alt="Current favicon"
              className="w-10 h-10 rounded border border-border object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <div className="flex-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={handleFaviconUpload}
                className="hidden"
                id="favicon-upload"
              />
              <label
                htmlFor="favicon-upload"
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded cursor-pointer hover:opacity-90 transition-opacity"
              >
                <Upload className="w-3.5 h-3.5" />
                {uploading ? "Uploading..." : "Upload Favicon"}
              </label>
              {uploadMsg && (
                <p className={`mt-2 text-xs ${uploadMsg.includes("updated") ? "text-green-600" : "text-red-500"}`}>
                  {uploadMsg}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">PNG, JPEG, WebP, or SVG. Recommended: 180×180 px.</p>
            </div>
          </div>
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

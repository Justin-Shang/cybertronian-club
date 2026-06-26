import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <p className="text-8xl font-bold text-muted-foreground/20 font-mono">404</p>
        <h1 className="mt-4 text-2xl font-semibold text-foreground">Page not found</h1>
        <p className="mt-2 text-muted-foreground">This room doesn't exist in the multiverse.</p>
        <Link href="/" className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
          Back to Chat
        </Link>
      </div>
    </div>
  );
}

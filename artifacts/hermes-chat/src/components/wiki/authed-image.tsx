import { useEffect, useState, type ComponentPropsWithoutRef } from "react";
import DOMPurify from "dompurify";

function isPrivateStorageUrl(src: string): boolean {
  if (src.startsWith("/api/storage/")) return true;
  try {
    const u = new URL(src, window.location.origin);
    return u.origin === window.location.origin && u.pathname.startsWith("/api/storage/");
  } catch {
    return false;
  }
}

async function toSafeObjectUrl(blob: Blob): Promise<string> {
  const type = blob.type.toLowerCase();
  let isSvg = type.includes("svg");
  let text: string | null = null;

  if (!isSvg && (type === "" || type.includes("xml") || type.includes("text"))) {
    text = await blob.text();
    isSvg = /<svg[\s>]/i.test(text);
  }

  if (isSvg) {
    if (text === null) text = await blob.text();
    const sanitizedRoot = DOMPurify.sanitize(text, {
      USE_PROFILES: { svg: true, svgFilters: true },
      RETURN_DOM: true,
    });
    const svgEl = (sanitizedRoot as Element).querySelector("svg");
    if (!svgEl) throw new Error("SVG sanitization produced no <svg> element");
    const xml = new XMLSerializer().serializeToString(svgEl);
    return URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
  }

  return URL.createObjectURL(blob);
}

type AuthedImageProps = ComponentPropsWithoutRef<"img">;

export function AuthedImage({ src, alt, title, ...rest }: AuthedImageProps) {
  const needsAuth = typeof src === "string" && isPrivateStorageUrl(src);
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(
    needsAuth ? undefined : (src as string | undefined),
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (typeof src !== "string" || !isPrivateStorageUrl(src)) {
      setFailed(false);
      setResolvedSrc(src as string | undefined);
      return;
    }

    let objectUrl: string | null = null;
    let cancelled = false;
    setFailed(false);
    setResolvedSrc(undefined);

    (async () => {
      try {
        const res = await fetch(src, { credentials: "include" });
        if (!res.ok) throw new Error(`Image request failed: ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = await toSafeObjectUrl(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setResolvedSrc(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (failed) {
    return (
      <span className="inline-flex items-center rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
        Couldn't load image{alt ? `: ${alt}` : ""}
      </span>
    );
  }

  if (!resolvedSrc) {
    return (
      <span
        className="block h-48 w-full max-w-md animate-pulse rounded-lg bg-muted"
        role="img"
        aria-label={alt || "Loading image"}
      />
    );
  }

  return <img src={resolvedSrc} alt={alt} title={title} {...rest} />;
}

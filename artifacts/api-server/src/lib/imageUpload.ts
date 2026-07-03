import net from "net";
import { lookup } from "dns/promises";
import { ObjectStorageService } from "./objectStorage";

// Only image uploads are allowed. SVG is included but treated as untrusted:
// objects are served with hardening headers (see routes/storage.ts) so an
// embedded <script> cannot execute even if the file is opened directly.
export const ALLOWED_IMAGE_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

// 10 MB cap per upload.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 10_000;

export interface LoadedImage {
  buffer: Buffer;
  contentType: string;
}

export interface UploadedImage {
  /** Internal object path, e.g. `/objects/uploads/<uuid>`. */
  objectPath: string;
  /** Path to embed in Markdown / fetch via the API, e.g. `/api/storage/objects/uploads/<uuid>`. */
  servePath: string;
}

function ipv4IsPrivate(ip: string): boolean {
  const o = ip.split(".").map(Number);
  if (o.length !== 4 || o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // malformed -> treat as unsafe
  }
  const [a, b] = o;
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function ipv6IsPrivate(ip: string): boolean {
  const h = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (h === "::1" || h === "::") return true; // loopback / unspecified
  const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4IsPrivate(mapped[1]); // IPv4-mapped
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // ULA fc00::/7
  if (/^fe[89ab]/.test(h)) return true; // link-local fe80::/10
  if (h.startsWith("ff")) return true; // multicast ff00::/8
  return false;
}

function ipIsPrivate(ip: string): boolean {
  if (net.isIPv4(ip)) return ipv4IsPrivate(ip);
  if (net.isIPv6(ip)) return ipv6IsPrivate(ip);
  return true; // unknown -> unsafe
}

/**
 * SSRF guard: only http(s); reject loopback/link-local/private hosts. Hostnames
 * are resolved via DNS and ALL resolved addresses must be public. Note: a tiny
 * TOCTOU window remains between resolution and connection (DNS rebinding); this
 * is acceptable because the only callers are authenticated agents that already
 * hold full wiki read/write access.
 */
async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed.");
  }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (ipIsPrivate(host)) throw new Error("URL host is not allowed.");
    return u;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host === "metadata.google.internal") {
    throw new Error("URL host is not allowed.");
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error("Could not resolve URL host.");
  }
  if (addrs.length === 0) throw new Error("Could not resolve URL host.");
  for (const a of addrs) {
    if (ipIsPrivate(a.address)) throw new Error("URL host is not allowed.");
  }
  return u;
}

async function readBodyCapped(res: Response, cap: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      throw new Error("File too large. Maximum size is 10 MB.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * Fetch an image from a public URL. Validates the SSRF policy on the initial URL
 * AND on every redirect hop (redirects are handled manually). contentType is
 * inferred from the response when not provided.
 */
export async function loadImageFromUrl(
  rawUrl: string,
  contentTypeHint?: string,
): Promise<LoadedImage> {
  let current = rawUrl;
  let res: Response | undefined;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = await assertSafeUrl(current);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
      res = await fetch(u, { redirect: "manual", signal: ac.signal });
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.arrayBuffer().catch(() => {}); // drain
      if (!loc) throw new Error("Redirect without a Location header.");
      current = new URL(loc, u).toString();
      continue;
    }
    break;
  }

  if (!res) throw new Error("Failed to fetch image.");
  if (res.status >= 300 && res.status < 400) throw new Error("Too many redirects.");
  if (!res.ok) throw new Error(`Failed to fetch image (${res.status}).`);

  const declaredLength = res.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_UPLOAD_BYTES) {
    throw new Error("File too large. Maximum size is 10 MB.");
  }
  const headerType = (res.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const contentType = (contentTypeHint ?? headerType).toLowerCase();
  const buffer = await readBodyCapped(res, MAX_UPLOAD_BYTES);
  if (buffer.byteLength === 0) {
    throw new Error("Fetched image is empty.");
  }
  return { buffer, contentType };
}

/** Decode a base64 image. A `data:<mime>;base64,...` prefix is accepted and used to infer contentType. */
export function decodeBase64Image(data: string, contentTypeHint?: string): LoadedImage {
  let b64 = data.trim();
  let contentType = contentTypeHint;
  const m = b64.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  if (m) {
    if (!contentType) contentType = m[1].trim();
    b64 = m[3];
  }
  if (!contentType) {
    throw new Error(
      "contentType is required for base64 data without a data: URL prefix.",
    );
  }
  const buffer = Buffer.from(b64, "base64");
  if (buffer.byteLength === 0) {
    throw new Error("Decoded image is empty.");
  }
  return { buffer, contentType: contentType.toLowerCase() };
}

/**
 * Validate and upload image bytes to object storage server-side (PUT to a
 * presigned URL). Returns the internal object path and the API serve path.
 */
export async function uploadImageBuffer(
  service: ObjectStorageService,
  buffer: Buffer,
  contentType: string,
): Promise<UploadedImage> {
  if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
    throw new Error("Unsupported file type. Allowed: PNG, JPEG, GIF, WebP, SVG.");
  }
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error("File too large. Maximum size is 10 MB.");
  }
  const uploadURL = await service.getObjectEntityUploadURL();
  const putRes = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: buffer,
  });
  if (!putRes.ok) {
    throw new Error(`Upload to storage failed (${putRes.status}).`);
  }
  const objectPath = service.normalizeObjectEntityPath(uploadURL);
  return { objectPath, servePath: `/api/storage${objectPath}` };
}

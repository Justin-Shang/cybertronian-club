import { Router } from "express";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";

const router = Router();

const PUBLIC_DIR = "/home/ubuntu/cybertronian-club/artifacts/hermes-chat/dist/public";

// GET /api/favicon — return current favicon (SVG or PNG)
router.get("/favicon", (_req, res) => {
  const svgPath = join(PUBLIC_DIR, "favicon.svg");
  const pngPath = join(PUBLIC_DIR, "favicon.png");
  try {
    if (existsSync(pngPath)) {
      const buf = readFileSync(pngPath);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(buf);
      return;
    }
    if (existsSync(svgPath)) {
      const buf = readFileSync(svgPath);
      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(buf);
      return;
    }
  } catch {}
  res.status(404).json({ error: "No favicon found" });
});

// POST /api/favicon — upload a new favicon (base64 or raw body)
router.post("/favicon", async (req, res) => {
  try {
    const { image } = req.body || {};
    if (!image || typeof image !== "string") {
      res.status(400).json({ error: "Missing 'image' field. Send as { image: \"data:image/png;base64,...\" }" });
      return;
    }

    // Parse data URL — supports png, jpeg, webp, svg+xml, etc.
    const match = image.match(/^data:(image\/[\w+-]+);base64,(.+)$/);
    if (!match) {
      res.status(400).json({ error: "Invalid image format. Use data:image/png;base64,... or data:image/svg+xml;base64,..." });
      return;
    }

    const mimeType = match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, "base64");

    if (buffer.length > 1024 * 1024) {
      res.status(400).json({ error: "Image too large. Max 1 MB." });
      return;
    }

    // Ensure public dir exists
    if (!existsSync(PUBLIC_DIR)) {
      mkdirSync(PUBLIC_DIR, { recursive: true });
    }

    // Write to appropriate file
    if (mimeType === "image/svg+xml") {
      writeFileSync(join(PUBLIC_DIR, "favicon.svg"), buffer);
      // Remove old PNG if switching to SVG
      const pngPath = join(PUBLIC_DIR, "favicon.png");
      if (existsSync(pngPath)) {
        try { unlinkSync(pngPath); } catch {}
      }
    } else {
      writeFileSync(join(PUBLIC_DIR, "favicon.png"), buffer);
      // Also create a simple SVG fallback that references the PNG
      const svgFallback = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
  <image href="/favicon.png" width="180" height="180"/>
</svg>`;
      writeFileSync(join(PUBLIC_DIR, "favicon.svg"), svgFallback);
    }

    req.log?.info?.({ mimeType }, "Favicon updated");
    res.json({ ok: true, mimeType });
  } catch (err) {
    req.log?.error?.({ err }, "Failed to upload favicon");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

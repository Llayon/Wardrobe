import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import platformRouter from "./routes/platform.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Wardrobe Express application (Gauntlet 0 skeleton: health only).
 * Platform bridge, items, and outfits land in Gauntlets 1–2.
 *
 * Privacy posture (mirrors Holodilnik): images are transient in request
 * memory unless the product explicitly persists normalized thumbnails
 * (see docs/IMAGE_LIFECYCLE.md).
 */

export const app = express();

app.use((req, res, next) => {
  if (process.env.NODE_ENV !== "production") {
    return cors({
      origin: ["http://localhost:5174", "http://127.0.0.1:5174"],
      credentials: false,
    })(req, res, next);
  }
  return next();
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "wardrobe", mockMode: process.env.MOCK_MODE === "true" });
});
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "wardrobe", mockMode: process.env.MOCK_MODE === "true" });
});

// Mounted at both /api/* and /* for Vercel stripped-prefix compatibility.
app.use("/api/platform", platformRouter);
app.use("/platform", platformRouter);

if (!process.env.VERCEL) {
  const distPath = path.resolve(__dirname, "../dist");
  app.use(express.static(distPath));
  app.use((_req, res) => {
    const indexPath = path.join(distPath, "index.html");
    res.sendFile(indexPath, (err) => {
      if (err) {
        res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
      }
    });
  });
} else {
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
  });
}

app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[unhandled]", err);
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  },
);

export default app;

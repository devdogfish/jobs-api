import { Router, json, type ErrorRequestHandler, type Request, type Response } from "express";
import { FONTS, hasCambria } from "../config/index.js";
import { requireApiKey } from "../middleware/apiKeyAuth.js";
import {
  InvalidMarkdownResume,
  markdownResumeRenderer,
  renderMarkdownResume,
  retainedTrackingHeader,
} from "../lib/markdownResume.js";

const router = Router();

const invalidBody: ErrorRequestHandler = (error, _req, res, _next) => {
  const tooLarge = error.status === 413;
  res.setHeader("Cache-Control", "no-store");
  res.status(tooLarge ? 413 : 400).json({
    error: tooLarge ? "Resume request is too large" : "Invalid resume request",
  });
};

router.post("/render-resume", requireApiKey, json({ limit: "400kb" }), async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const { pdf, retainedTracking } = await renderMarkdownResume(req.body, hasCambria, FONTS);
    res.setHeader("X-Resume-Renderer", markdownResumeRenderer);
    res.setHeader("X-Resume-Retained-Tracking", retainedTrackingHeader(retainedTracking));
    res.setHeader("Content-Disposition", "inline; filename=resume.pdf");
    return res.type("application/pdf").send(pdf);
  } catch (error) {
    if (error instanceof InvalidMarkdownResume) {
      return res.status(400).json({ error: "Invalid resume Markdown or tracking links" });
    }
    console.error("Markdown resume rendering failed");
    return res.status(500).json({ error: "Failed to render resume" });
  }
}, invalidBody);

export default router;

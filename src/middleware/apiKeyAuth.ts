import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "../lib/auth.js";

/**
 * Middleware that requires a valid API key in X-API-Key header.
 * Returns 401 if API key is missing or invalid.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  authorize(req, res, next, [process.env.API_KEY]);
}

export function requireRenderApiKey(req: Request, res: Response, next: NextFunction): void {
  authorize(req, res, next, [process.env.API_KEY, process.env.RENDER_API_KEY]);
}

function authorize(
  req: Request,
  res: Response,
  next: NextFunction,
  configuredKeys: Array<string | undefined>,
): void {
  const keys = configuredKeys.filter((key): key is string => Boolean(key));
  const providedKey = req.headers["x-api-key"];

  if (!keys.length) {
    console.error("API key configuration missing");
    res.status(500).json({ error: "Server configuration error" });
    return;
  }

  if (typeof providedKey !== "string") {
    res.status(401).json({ error: "API key required" });
    return;
  }

  if (keys.some(key => timingSafeEqual(providedKey, key))) {
    next();
  } else {
    res.status(401).json({ error: "Invalid API key" });
  }
}

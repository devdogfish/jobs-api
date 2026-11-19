import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { requireApiKey, requireRenderApiKey } from "./apiKeyAuth.js";

test("limits the additive renderer key to rendering and preserves the legacy key", () => {
  const originalKey = process.env.API_KEY;
  const originalRendererKey = process.env.RENDER_API_KEY;
  function request(middleware: typeof requireApiKey, key?: string) {
    let result = 200;
    const req = { headers: { "x-api-key": key } } as unknown as Request;
    const res = { status(code: number) { result = code; return this; }, json() {} } as unknown as Response;
    middleware(req, res, () => {});
    return result;
  }
  try {
    process.env.API_KEY = "legacy-fixture";
    process.env.RENDER_API_KEY = "renderer-fixture";
    assert.equal(request(requireRenderApiKey, "renderer-fixture"), 200);
    assert.equal(request(requireRenderApiKey, "legacy-fixture"), 200);
    assert.equal(request(requireApiKey, "legacy-fixture"), 200);
    assert.equal(request(requireApiKey, "renderer-fixture"), 401);
    assert.equal(request(requireRenderApiKey, "wrong"), 401);
    assert.equal(request(requireRenderApiKey), 401);
    delete process.env.RENDER_API_KEY;
    assert.equal(request(requireRenderApiKey, "legacy-fixture"), 200);
    assert.equal(request(requireRenderApiKey, "renderer-fixture"), 401);
    delete process.env.API_KEY;
    assert.equal(request(requireRenderApiKey, "renderer-fixture"), 500);
  } finally {
    if (originalKey === undefined) delete process.env.API_KEY;
    else process.env.API_KEY = originalKey;
    if (originalRendererKey === undefined) delete process.env.RENDER_API_KEY;
    else process.env.RENDER_API_KEY = originalRendererKey;
  }
});

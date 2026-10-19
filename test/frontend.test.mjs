// The app's side of the browser frontend: its page at "/" (public/, which the image builds from web/)
// and the /api/* it calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATABASE_PATH ??= join(mkdtempSync(join(tmpdir(), "app-")), "app.db");
const { app } = await import("../dist/app.js");

test("the page is served at / from public/", async (t) => {
  if (!existsSync("public/index.html")) {  // the image builds it in its own stage; tests run without it
    mkdirSync("public", { recursive: true });
    writeFileSync("public/index.html", "<!doctype html><title>test</title>");
    t.after(() => rmSync("public", { recursive: true, force: true }));
  }
  const reply = await app.request("/");
  assert.equal(reply.status, 200);
  assert.match(reply.headers.get("content-type") ?? "", /text\/html/);
});

test("the frontend's API answers under /api", async () => {
  const hello = await app.request("/api/hello", { headers: { "x-auth-request-email": "sam@example.com" } });
  assert.equal(hello.status, 200);
  assert.deepEqual((await hello.json()).caller, { type: "user", id: "sam@example.com" });
  const flags = await app.request("/api/flags");
  assert.equal(flags.status, 200);
  assert.equal(typeof (await flags.json()), "object");
  assert.equal((await app.request("/api/nothing")).status, 404);
});

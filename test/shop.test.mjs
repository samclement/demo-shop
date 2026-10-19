// demo-shop's own routes under /api, with a stand-in for demo-orders (npm run build first): the shop
// sends its token for demo-orders, which it reads from the file the platform mounts, and logs each
// purchase in its own database.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const seen = [];
const stub = http.createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    seen.push({ method: request.method, url: request.url, authorization: request.headers.authorization, body });
    response.writeHead(request.method === "POST" ? 201 : 200, { "content-type": "application/json" });
    const order = { id: "o-1", item: "tea", quantity: 2, placedBy: "demo-shop", at: "2026-01-01T00:00:00.000Z" };
    response.end(JSON.stringify(request.method === "POST" ? { ...order, ...JSON.parse(body) } : { orders: [order] }));
  });
});
await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
const tokens = mkdtempSync(join(tmpdir(), "tokens-"));
mkdirSync(join(tokens, "demo-orders"));
writeFileSync(join(tokens, "demo-orders", "token"), "token-for-demo-orders");
Object.assign(process.env, {
  DATABASE_PATH: join(mkdtempSync(join(tmpdir(), "shop-")), "app.db"),
  SWHURL_APP: "demo-shop", SWHURL_ENV: "staging", SWHURL_TOKENS_DIR: tokens,
  SWHURL_SERVICE_DEMO_ORDERS_URL: `http://127.0.0.1:${stub.address().port}`,
});
const { app } = await import("../dist/app.js");

const person = { "x-auth-request-email": "sam@example.com" };

test("the shop shows what it sells and the latest orders from demo-orders", async () => {
  const shop = await (await app.request("/api/shop", { headers: person })).json();
  assert.ok(shop.items.includes("tea"));
  assert.equal(shop.latestOrders[0].id, "o-1");
  assert.equal(seen.at(-1).url, "/orders?limit=5");
  assert.deepEqual(shop.yourPurchases, [], "nothing bought yet");
});

test("buying places the order in demo-orders with the shop's own token, and logs it for the buyer", async () => {
  const bought = await app.request("/api/buy?item=coffee&quantity=3", { method: "POST", headers: person });
  assert.equal(bought.status, 201);
  const reply = await bought.json();
  assert.deepEqual([reply.order.item, reply.order.quantity, reply.boughtBy], ["coffee", 3, { type: "user", id: "sam@example.com" }]);
  assert.deepEqual([seen.at(-1).method, seen.at(-1).url, JSON.parse(seen.at(-1).body)], ["POST", "/orders", { item: "coffee", quantity: 3 }]);
  assert.equal(seen.at(-1).authorization, "Bearer token-for-demo-orders");
  const asJson = await app.request("/api/buy", { method: "POST", headers: { ...person, "content-type": "application/json" }, body: JSON.stringify({ item: "milk" }) });
  assert.deepEqual([(await asJson.json()).order.item, JSON.parse(seen.at(-1).body)], ["milk", { item: "milk", quantity: 1 }]);
  assert.equal((await app.request("/api/buy?quantity=0", { method: "POST" })).status, 400);

  const yours = (await (await app.request("/api/shop", { headers: person })).json()).yourPurchases;
  assert.deepEqual(yours.map((p) => [p.item, p.quantity, p.via]), [["milk", 1, "page"], ["coffee", 3, "page"]], "newest first");
  const someoneElse = await (await app.request("/api/shop", { headers: { "x-auth-request-email": "kim@example.com" } })).json();
  assert.deepEqual(someoneElse.yourPurchases, [], "each person sees their own");
});

test("POST /buy still answers as /api/buy for one release", async () => {
  const bought = await app.request("/buy?item=sugar&quantity=2", { method: "POST", headers: person });
  assert.equal(bought.status, 201);
  assert.deepEqual(JSON.parse(seen.at(-1).body), { item: "sugar", quantity: 2 });
  assert.equal((await app.request("/buy?quantity=0", { method: "POST" })).status, 400);
});

test("without demo-orders the shop still answers, and says a purchase failed", async (t) => {
  t.after(() => stub.close());
  process.env.SWHURL_SERVICE_DEMO_ORDERS_URL = "http://127.0.0.1:1";
  assert.equal((await (await app.request("/api/shop")).json()).latestOrders, null);
  assert.equal((await app.request("/api/buy", { method: "POST" })).status, 502);
});

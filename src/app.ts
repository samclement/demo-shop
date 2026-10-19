// The app's routes. src/server.ts listens with them; src/openapi.ts writes their description to openapi.json.
// The browser frontend (web/, built into public/) is served at /; its calls come to /api/*.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { serveStatic } from "@hono/node-server/serve-static";
import { trace } from "@opentelemetry/api";
import type { Context } from "hono";
import pino from "pino";
import { openDatabase } from "./db.js";
import { publish } from "./events.js";
import { flags, flagsLoaded } from "./flags.js";
import { type Caller, Unauthorized, identify, personOf, service } from "./platform.js";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
});

const serviceName = process.env.OTEL_SERVICE_NAME ?? "swhurl-app";
// Who this app is, as the platform names and describes it (SWHURL_APP; SWHURL_DESCRIPTION, from
// swhurl.yaml), or as it was created off the platform: an image built for another app says the right thing.
const identity = () => ({
  name: process.env.SWHURL_APP || "demo-shop",
  description: process.env.SWHURL_DESCRIPTION || "Demo: the shop people open; a page that places orders in demo-orders and keeps its own purchase log",
});
// DATABASE_PATH comes from the platform (a file on a volume that outlives the pod); app.db locally.
// The orders live in demo-orders; the shop keeps only what it alone uses: its visits and the
// purchases made through it (migrations/).
export const db = openDatabase();
const recordVisit = db.prepare("INSERT INTO events (kind, detail, at) VALUES ('visit', ?, ?)");
const countVisits = db.prepare("SELECT count(*) AS n FROM events WHERE kind = 'visit'");
const recordPurchase = db.prepare(
  "INSERT INTO purchases (order_id, item, quantity, buyer, via, at) VALUES (?, ?, ?, ?, ?, ?)");
const purchasesBy = db.prepare(
  "SELECT order_id AS orderId, item, quantity, via, at FROM purchases WHERE buyer = ? ORDER BY id DESC LIMIT 5");

export const app = new OpenAPIHono<{ Variables: { caller: Caller } }>();
const traceId = (): string | null => trace.getActiveSpan()?.spanContext().traceId ?? null;

app.onError((error, c) => {
  logger.error({ err: error, path: c.req.path }, "request failed");
  return c.json({ error: "internal error" }, 500);
});

// What the platform probes: no caller check, no log line. Not ready until the app's feature flag
// overrides have arrived (at most 5 s; src/flagstore.ts).
app.get("/healthz", (c) => {
  if (!flagsLoaded()) return c.json({ ok: false, waiting: "feature flag overrides" }, 503);
  db.prepare("SELECT 1").get(); // ready only when the database answers
  return c.json({ ok: true });
});

// Who is calling: another app (it sent a token the platform issued for this app alone), a
// signed-in person, or anonymous. A bad token is refused here; see src/platform.ts.
app.use(async (c, next) => {
  const start = Date.now();
  let caller: Caller;
  try {
    caller = identify(Object.fromEntries(c.req.raw.headers));
  } catch (error) {
    if (!(error instanceof Unauthorized)) throw error;
    logger.warn({ method: c.req.method, path: c.req.path, status: 401, reason: error.message, trace_id: traceId() },
      "request refused");
    return c.json({ error: error.message }, 401);
  }
  c.set("caller", caller);
  const span = trace.getActiveSpan();
  span?.setAttribute("caller.type", caller.type);
  if (caller.id) span?.setAttribute("caller.id", caller.id);
  const person = caller.type === "app" ? caller.user : undefined;
  if (person) span?.setAttribute("user.email", person);
  await next();
  logger.info({
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration_ms: Date.now() - start,
    "caller.type": caller.type,
    "caller.id": caller.id,
    ...(person ? { "user.email": person } : {}),
    trace_id: traceId(),
  }, "request handled");
});

// demo-orders, the app this one calls. service() gives its address in this environment and sends
// this app's token for it, which the platform issues and replaces every few minutes; demo-orders
// accepts it because the platform granted this app the call (make app-calls) and refuses everyone else.
const orders = () => service("demo-orders");
const ITEMS = ["tea", "coffee", "biscuits", "milk", "sugar"];
// Whose purchases these are: the signed-in person (also when an app buys for one), else the calling app.
const buyerOf = (caller: Caller): string => personOf(caller) ?? caller.id ?? "anonymous";

// Described routes: the schemas are what each handler takes and returns, and what openapi.json says.
// After changing one, run `npm run build && npm run openapi`; a test fails while the file is out of date.
const CallerSchema = z.object({
  type: z.enum(["app", "user", "anonymous"]),
  id: z.string().nullable(),
  user: z.string().optional().openapi({ description: "For an app: the signed-in person it is calling for" }),
}).openapi("Caller");
const Order = z.object({
  id: z.string(),
  item: z.string().openapi({ example: "tea" }),
  quantity: z.number().int().openapi({ example: 2 }),
  placedBy: z.string().openapi({ example: "demo-shop" }),
  at: z.string(),
}).openapi("Order");
const MyPurchase = z.object({
  orderId: z.string(),
  item: z.string(),
  quantity: z.number().int(),
  via: z.string().openapi({ description: "Who placed it: the page (user), or the app that called the shop" }),
  at: z.string(),
}).openapi("MyPurchase");
const Shop = z.object({
  service: z.string(),
  caller: CallerSchema,
  items: z.array(z.string()).openapi({ description: "What can be bought" }),
  latestOrders: z.array(Order).nullable().openapi({ description: "The newest five orders, from demo-orders; null if it could not be asked" }),
  yourPurchases: z.array(MyPurchase).openapi({ description: "Your newest five purchases through this shop, from its own database" }),
  traceId: z.string().nullable(),
}).openapi("Shop");
const Purchase = z.object({
  item: z.string().min(1).max(40).default("tea").openapi({ example: "tea" }),
  quantity: z.coerce.number().int().min(1).max(1000).default(1).openapi({ example: 2 }),
}).openapi("Purchase");
const Bought = z.object({ order: Order, boughtBy: CallerSchema, traceId: z.string().nullable() }).openapi("Bought");
const Problem = z.object({ error: z.string() }).openapi("Problem");
const Hello = z.object({
  message: z.string().openapi({ example: `hello from ${identity().name}` }),
  service: z.string(),
  caller: CallerSchema,
  visits: z.number().int().optional().openapi({ description: "How many times it was asked" }),
  event: z.object({ type: z.string(), id: z.string() }).nullable().openapi({ description: "The event this request published, if any" }),
  traceId: z.string().nullable(),
}).openapi("Hello");
const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { "application/json": { schema } } });

// The greeting: names the caller, counts visits (the events table, which the image's smoke test
// reads) and publishes "visited", described in asyncapi.yaml. shout is a feature flag, on in staging.
app.openapi(
  createRoute({ method: "get", path: "/api/hello", summary: "Say hello and name the caller", responses: { 200: json(Hello, "A greeting") } }),
  async (c) => {
    const caller = c.get("caller");
    recordVisit.run("/api/hello", new Date().toISOString());
    let eventId: string | null = null;
    try {
      eventId = (await publish("visited", { path: "/api/hello", caller }))?.id ?? null;
    } catch (error) {
      logger.error({ err: error, event: "visited", trace_id: traceId() }, "event not published");
    }
    const greeting = `hello from ${serviceName}`;
    return c.json({
      message: flags.shout ? greeting.toUpperCase() : greeting, service: serviceName, caller,
      visits: Number((countVisits.get() as { n: number }).n),
      event: eventId ? { type: `${serviceName}.visited`, id: eventId } : null, traceId: traceId(),
    }, 200);
  },
);

app.openapi(
  createRoute({ method: "get", path: "/api/shop", summary: "The shop: what it sells, the latest orders and your purchases",
    responses: { 200: json(Shop, "The shop") } }),
  async (c) => {
    const caller = c.get("caller");
    let latestOrders: z.infer<typeof Order>[] | null = null;
    try {
      const reply = await orders().fetch("/orders?limit=5", { onBehalfOf: caller });
      if (reply.ok) latestOrders = ((await reply.json()) as { orders: z.infer<typeof Order>[] }).orders;
    } catch (error) {
      // Not granted yet, or demo-orders is away: the shop still answers.
      logger.warn({ err: error, trace_id: traceId() }, "demo-orders could not be asked");
    }
    const yourPurchases = purchasesBy.all(buyerOf(caller)) as z.infer<typeof MyPurchase>[];
    return c.json({ service: serviceName, caller, items: ITEMS, latestOrders, yourPurchases, traceId: traceId() }, 200);
  },
);

/** Place the order in demo-orders, as this app and for the caller, and log the purchase here. */
async function buy(c: Context<{ Variables: { caller: Caller } }>, input: Partial<z.infer<typeof Purchase>>) {
  const caller = c.get("caller");
  const { item, quantity } = Purchase.parse(input);
  try {
    const reply = await orders().fetch("/orders", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ item, quantity }), onBehalfOf: caller,
    });
    if (!reply.ok) return c.json({ error: `demo-orders answered ${reply.status}` }, 502);
    const order = (await reply.json()) as z.infer<typeof Order>;
    recordPurchase.run(order.id, item, quantity, buyerOf(caller), caller.type === "app" ? caller.id : "page", new Date().toISOString());
    return c.json({ order, boughtBy: caller, traceId: traceId() }, 201);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 502);
  }
}
const purchaseOf = async (c: Context) => ({
  ...c.req.query(),
  ...(c.req.header("content-type")?.includes("application/json") ? await c.req.json() : {}),
});

app.openapi(
  createRoute({
    method: "post",
    path: "/api/buy",
    summary: "Buy something: the shop places the order with demo-orders",
    description: "Anyone who reaches the shop may buy: a signed-in person (the page), or an app granted a call to demo-shop. "
      + "The order is placed in demo-orders by this app, with its own token, for the signed-in person. "
      + "Send `item` and `quantity` as JSON or as query parameters.",
    request: { query: Purchase.partial(), body: { required: false, content: { "application/json": { schema: Purchase.partial() } } } },
    responses: { 201: json(Bought, "The order demo-orders stored"), 502: json(Problem, "demo-orders refused or could not be reached") },
  }),
  async (c) => buy(c, await purchaseOf(c)),
);
/** The shop's API description: generated from the routes above and kept in openapi.json to type the page's calls. */
export const openapi = () => app.getOpenAPI31Document({
  openapi: "3.1.0",
  info: { title: identity().name, version: "0.1.0", description: identity().description },
});
app.get("/openapi.json", (c) => c.json(openapi()));

// The feature flags as this request sees them, for the browser frontend (web/main.ts).
app.get("/api/flags", (c) => c.json(flags));

// The browser frontend, built by Vite+ into public/ (npm run build in web/; the image does it).
app.use("/*", serveStatic({ root: "./public" }));

app.notFound((c) => c.json({ error: "not found" }, 404));

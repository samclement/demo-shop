// The app's routes. src/server.ts listens with them; src/openapi.ts writes their description to openapi.json.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { trace } from "@opentelemetry/api";
import pino from "pino";
<<<<<<< before updating
import { type Caller, Unauthorized, identify, service } from "./platform.js";
=======
import { declaredPublishes, publish } from "./events.js";
import { flagsLoaded } from "./flags.js";
import { type Caller, Unauthorized, identify, notify, service } from "./platform.js";
>>>>>>> after updating

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
});

const serviceName = process.env.OTEL_SERVICE_NAME ?? "swhurl-app";
// Who this app is, as the platform names and describes it (SWHURL_APP; SWHURL_DESCRIPTION, from
// swhurl.yaml), or as it was created off the platform: an image built for another app says the right thing.
const identity = () => ({
  name: process.env.SWHURL_APP || "demo-shop",
  description: process.env.SWHURL_DESCRIPTION || "Demo: the shop people open; it places orders by calling demo-orders with a platform token",
});

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

<<<<<<< before updating
// demo-orders, the app this one calls. service() gives its address in this environment and sends
// this app's token for it, which the platform issues and replaces every few minutes; demo-orders
// accepts it because this app declared the call (calls: [demo-orders]) and refuses everyone else.
const orders = () => service("demo-orders");
const ITEMS = ["tea", "coffee", "biscuits", "milk", "sugar"];
=======
// An example of calling another app: GET /call/orders asks the app "orders" for its "/" and
// returns what it said. It works once the platform grants this app the call (make app-calls).
// onBehalfOf tells orders who is signed in here, so its "/" names this app and that person.
app.get("/call/:name", async (c) => {
  const name = c.req.param("name");
  try {
    const reply = await service(name).fetch("/", { onBehalfOf: c.get("caller") });
    return c.json({ called: name, status: reply.status, reply: await reply.json().catch(() => null) }, reply.ok ? 200 : 502);
  } catch (error) {
    return c.json({ called: name, error: (error as Error).message }, 502);
  }
});
>>>>>>> after updating

// Described routes: the schemas are what each handler takes and returns, and what openapi.json says.
// After changing one, run `npm run build && npm run openapi`; a test fails while the file is out of date.
const CallerSchema = z.object({ type: z.enum(["app", "user", "anonymous"]), id: z.string().nullable() }).openapi("Caller");
const Order = z.object({
  id: z.string(),
  item: z.string().openapi({ example: "tea" }),
  quantity: z.number().int().openapi({ example: 2 }),
  placedBy: z.string().openapi({ example: "demo-shop" }),
  at: z.string(),
}).openapi("Order");
const Shop = z.object({
  message: z.string().openapi({ example: "hello from demo-shop" }),
  service: z.string(),
  caller: CallerSchema,
  items: z.array(z.string()).openapi({ description: "What can be bought" }),
  latestOrders: z.array(Order).nullable().openapi({ description: "The newest five orders, from demo-orders; null if it could not be asked" }),
  traceId: z.string().nullable(),
}).openapi("Shop");
const Purchase = z.object({
  item: z.string().min(1).max(40).default("tea").openapi({ example: "tea" }),
  quantity: z.coerce.number().int().min(1).max(1000).default(1).openapi({ example: 2 }),
}).openapi("Purchase");
const Bought = z.object({ order: Order, boughtBy: CallerSchema, traceId: z.string().nullable() }).openapi("Bought");
const Problem = z.object({ error: z.string() }).openapi("Problem");
const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { "application/json": { schema } } });

app.openapi(
  createRoute({ method: "get", path: "/", summary: "The shop: what it sells and the latest orders", responses: { 200: json(Shop, "The shop") } }),
  async (c) => {
    let latestOrders: z.infer<typeof Order>[] | null = null;
    try {
      const reply = await orders().fetch("/orders?limit=5");
      if (reply.ok) latestOrders = ((await reply.json()) as { orders: z.infer<typeof Order>[] }).orders;
    } catch (error) {
      // Not declared yet, or demo-orders is away: the shop still answers.
      logger.warn({ err: error, trace_id: traceId() }, "demo-orders could not be asked");
    }
<<<<<<< before updating
    return c.json({
      message: `hello from ${serviceName}`, service: serviceName, caller: c.get("caller"), items: ITEMS, latestOrders, traceId: traceId(),
    }, 200);
  },
);
=======
  }
  const message = `hello from ${serviceName}`;
  return {
    message,
    service: serviceName,
    caller,
    event: eventId ? { type: `${serviceName}.${published}`, id: eventId } : null,
    traceId: traceId(),
  };
}

// A described route: the schemas below are what the handler must return and what openapi.json says.
// Add routes the same way and run `npm run openapi`; CI fails if openapi.json is out of date.
const Hello = z.object({
  message: z.string().openapi({ example: `hello from ${identity().name}` }),
  service: z.string(),
  caller: z.object({
    type: z.enum(["app", "user", "anonymous"]),
    id: z.string().nullable(),
    user: z.string().optional().openapi({ description: "For an app: the signed-in person it is calling for" }),
  }),
  visits: z.number().int().optional().openapi({ description: "How many times it was asked, when the app keeps a database" }),
  event: z.object({ type: z.string(), id: z.string() }).nullable().openapi({ description: "The event this request published, if any" }),
  traceId: z.string().nullable(),
}).openapi("Hello");
>>>>>>> after updating

app.openapi(
  createRoute({
    method: "post",
    path: "/buy",
    summary: "Buy something: the shop places the order with demo-orders",
    description: "Anyone who reaches the shop may buy: a signed-in person, or an app that declared a call to demo-shop. "
      + "The order is placed in demo-orders by this app, with its own token. Send `item` and `quantity` as JSON or as query parameters.",
    request: { query: Purchase.partial(), body: { required: false, content: { "application/json": { schema: Purchase.partial() } } } },
    responses: { 201: json(Bought, "The order demo-orders stored"), 502: json(Problem, "demo-orders refused or could not be reached") },
  }),
  async (c) => {
    const body = c.req.header("content-type")?.includes("application/json") ? c.req.valid("json") : {};
    const { item, quantity } = Purchase.parse({ ...c.req.valid("query"), ...body });
    try {
      const reply = await orders().fetch("/orders", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ item, quantity }),
      });
      if (!reply.ok) return c.json({ error: `demo-orders answered ${reply.status}` }, 502);
      return c.json({ order: (await reply.json()) as z.infer<typeof Order>, boughtBy: c.get("caller"), traceId: traceId() }, 201);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 502);
    }
  },
);

/** What this app offers other apps: generated from the routes above, served and kept in openapi.json. */
export const openapi = () => app.getOpenAPI31Document({
  openapi: "3.1.0",
  info: { title: identity().name, version: "0.1.0", description: identity().description },
});
app.get("/openapi.json", (c) => c.json(openapi()));

app.notFound((c) => c.json({ error: "not found" }, 404));

// The shop's page: it calls only this app's own /api/*, on the same host, so the sign-in cookie goes
// with every request and no CORS is needed. The app's server calls demo-orders for the signed-in person.
type Order = { id: string; item: string; quantity: number; placedBy: string; at: string };
type Purchase = { orderId: string; item: string; quantity: number; via: string; at: string };
type Shop = {
  caller: { type: string; id: string | null };
  items: string[];
  latestOrders: Order[] | null;
  yourPurchases: Purchase[];
};

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const when = (at: string): string => new Date(at).toLocaleString();

function list(id: string, rows: string[], empty: string): void {
  const target = element<HTMLUListElement>(id);
  target.replaceChildren(
    ...(rows.length ? rows : [empty]).map((row) => {
      const item = document.createElement("li");
      item.textContent = row;
      if (!rows.length) item.className = "muted";
      return item;
    }),
  );
}

async function show(): Promise<void> {
  const reply = await fetch("/api/shop");
  if (!reply.ok) throw new Error(`/api/shop answered ${reply.status}`);
  const shop = (await reply.json()) as Shop;
  element("who").textContent = shop.caller.id ?? "nobody";
  const select = element<HTMLSelectElement>("item");
  if (!select.options.length) {
    select.replaceChildren(...shop.items.map((name) => new Option(name, name)));
  }
  list(
    "yours",
    shop.yourPurchases.map((p) => `${p.quantity} ${p.item}, ${when(p.at)}`),
    "Nothing yet.",
  );
  list(
    "orders",
    (shop.latestOrders ?? []).map(
      (o) => `${o.quantity} ${o.item}, placed by ${o.placedBy}, ${when(o.at)}`,
    ),
    shop.latestOrders ? "No orders yet." : "demo-orders could not be asked just now.",
  );
}

element<HTMLFormElement>("buy").addEventListener("submit", async (event) => {
  event.preventDefault();
  const said = element("said");
  said.textContent = "Buying…";
  const reply = await fetch("/api/buy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      item: element<HTMLSelectElement>("item").value,
      quantity: Number(element<HTMLInputElement>("quantity").value),
    }),
  });
  said.textContent = reply.ok ? "Bought." : `Could not buy: ${reply.status}`;
  await show();
});

try {
  await show();
} catch (error) {
  element("who").textContent = `could not reach the shop: ${(error as Error).message}`;
}

export {};

-- The purchases made through the shop: who bought what, and how (the page, or an app that called
-- it). The orders themselves live in demo-orders; this is the shop's own log of them.
CREATE TABLE purchases (
  id INTEGER PRIMARY KEY,
  order_id TEXT NOT NULL,
  item TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  buyer TEXT NOT NULL,
  via TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX purchases_by_buyer ON purchases (buyer, id);

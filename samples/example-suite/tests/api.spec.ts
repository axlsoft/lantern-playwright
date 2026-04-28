import { test, expect } from "@lantern/playwright/fixture";

test("GET /healthz returns ok", async ({ request }) => {
  const res = await request.get("/healthz");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
});

test("GET /lantern-scope echoes the per-test scope", async ({ request }, testInfo) => {
  const res = await request.get("/lantern-scope");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.test_id).toBeTruthy();
  expect(body.test_name).toContain(testInfo.title);
});

test("GET /orders/{id} returns the order", async ({ request }) => {
  const res = await request.get("/orders/abc-123");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.id).toBe("abc-123");
  expect(body.status).toBe("shipped");
});

test("POST /orders creates an order", async ({ request }) => {
  const res = await request.post("/orders", {
    data: { productId: "sku-42", quantity: 3 },
  });
  expect(res.status()).toBe(201);
});

const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1100 },
  });
  page.setDefaultTimeout(240000);
  const errors = [],
    checks = [];
  let requests = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (
      r.url().endsWith("/api/execute") &&
      r.postDataJSON()?.path === "/api/chart/scatter"
    )
      requests++;
  });
  const ready = async (previous) => {
    await page.waitForFunction((old) => {
      const p = document.querySelector(".performance-strip");
      return p && p.dataset.batchId !== old && p.dataset.complete === "true";
    }, previous);
  };
  const id = () =>
    page.locator(".performance-strip").getAttribute("data-batch-id");
  const apply = async () => {
    const old = await id();
    await page.getByRole("button", { name: "분석 실행", exact: true }).click();
    await ready(old);
  };
  try {
    await page.goto("http://localhost:8082/#analysis");
    await ready("0");
    for (const size of [1000, 10000, 100000]) {
      await page
        .getByLabel("데이터 규모", { exact: true })
        .selectOption(String(size));
      await page.waitForFunction(
        () => !document.querySelector(".studio .primary").disabled,
      );
      await apply();
      const t = await page
        .locator(".performance-strip")
        .evaluate((e) => ({ ...e.dataset }));
      assert.equal(+t.visiblePoints, size * 0.4);
      assert.ok(+t.renderMs > 0);
      assert.ok(+t.receiveMs > 0);
      assert.ok(Math.abs(+t.totalMs - (+t.receiveMs + +t.renderMs)) < 2);
    }
    checks.push(
      "1K/10K/100K full results: visible point counts and wall-time accounting",
    );
    const identities = await page
      .locator(".chart-grid .plot")
      .evaluateAll((es) => es.map((e) => e.getAttribute("_echarts_instance_")));
    const before = requests;
    await page.getByLabel("포인트 크기", { exact: true }).fill("7");
    await apply();
    assert.equal(requests, before);
    assert.deepEqual(
      await page
        .locator(".chart-grid .plot")
        .evaluateAll((es) =>
          es.map((e) => e.getAttribute("_echarts_instance_")),
        ),
      identities,
    );
    assert.equal(
      await page.locator('.plot[data-update="appearance"]').count(),
      4,
    );
    checks.push(
      "Point size changes reuse all four instances without any scatter API request",
    );
    await apply();
    assert.equal(requests, before + 1);
    checks.push("Explicit rerun with unchanged settings refreshes data");
    const old = await id();
    const requestCount = requests;
    await page.getByLabel("다음 차트", { exact: true }).click();
    await ready(old);
    assert.equal(requests, requestCount);
    assert.equal(
      await page.locator(".performance-strip").getAttribute("data-kind"),
      "page",
    );
    checks.push(
      "Category pagination measures a fresh batch without a data query",
    );
    await page
      .getByRole("button", { name: "데이터 / 설정", exact: true })
      .click();
    const tabId = await id();
    await page.getByRole("button", { name: /^차트 \d/ }).click();
    await ready(tabId);
    assert.equal(requests, requestCount);
    checks.push(
      "Returning from metadata tab measures actual new chart rendering",
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: "artifacts/chart-timing-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => {
      const p = document.querySelector(".plot"),
        c = p?.querySelector("canvas");
      return c && Math.abs(parseFloat(c.style.width) - p.clientWidth) < 1;
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    checks.push("Timing display fits mobile and canvas resizes");
    // Exercise the string-X fallback and label path with a small complete dataset.
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.getByLabel("데이터 규모", { exact: true }).selectOption("1000");
    await page.waitForFunction(
      () => !document.querySelector(".studio .primary").disabled,
    );
    await page.getByLabel("X 컬럼", { exact: true }).selectOption("waferId");
    await page.getByLabel("X 타입", { exact: true }).selectOption("string");
    await page.getByLabel("포인트 라벨 표시", { exact: true }).check();
    await apply();
    assert.equal(
      await page
        .locator('.plot[data-labels="true"][data-render-ready="true"]')
        .count(),
      4,
    );
    const labelRequests = requests;
    await page.getByLabel("라벨 글자 크기", { exact: true }).fill("14");
    await apply();
    assert.equal(requests, labelRequests);
    checks.push(
      "String X, point labels and font-only reuse render successfully",
    );
    // A failed query leaves the last valid measurement and data intact.
    await page.route("**/api/execute", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "QA unavailable" }),
      }),
    );
    const last = await id();
    await page.getByRole("button", { name: "분석 실행", exact: true }).click();
    await page.waitForFunction(
      () => !document.querySelector(".studio .primary").disabled,
    );
    assert.equal(await id(), last);
    checks.push("Failed refresh retains last successful chart measurement");
    assert.deepEqual(errors, []);
    checks.push("No browser runtime errors");
    fs.writeFileSync(
      "artifacts/chart-timing-browser.json",
      JSON.stringify({ passed: checks.length, checks }, null, 2),
    );
    console.log("PASS: " + checks.length + " timing browser checks");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

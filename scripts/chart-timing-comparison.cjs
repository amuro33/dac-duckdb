const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs");
const assert = require("node:assert/strict");
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1600, height: 1100 } });
  page.setDefaultTimeout(240000);
  let requests = 0;
  const results = [];
  page.on("request", (r) => {
    if (
      r.url().endsWith("/api/execute") &&
      r.postDataJSON()?.path === "/api/chart/scatter"
    )
      requests++;
  });
  const run = async (label, size) => {
    const before = await page
      .locator(".plot")
      .first()
      .getAttribute("data-render-started");
    const count = requests;
    const start = await page.evaluate(() => performance.now());
    await page.getByRole("button", { name: "분석 실행", exact: true }).click();
    await page.waitForFunction((previous) => {
      const ps = [...document.querySelectorAll(".chart-grid .plot")];
      return (
        ps.length === 4 &&
        ps.every(
          (p) =>
            p.dataset.renderReady === "true" &&
            p.dataset.renderStarted !== previous,
        )
      );
    }, before);
    const value = await page.evaluate(
      (start) => ({
        clientMs: +(performance.now() - start).toFixed(1),
        charts: [...document.querySelectorAll(".chart-grid .plot")].map(
          (p) => ({
            renderMs: Number(p.dataset.renderMs),
            points: Number(p.dataset.pointCount),
          }),
        ),
        ui: document.querySelector(".performance-strip")?.textContent ?? null,
      }),
      start,
    );
    assert.equal(
      value.charts.reduce((n, p) => n + p.points, 0),
      (size / 10) * 4,
    );
    results.push({ label, size, requests: requests - count, ...value });
    console.log(JSON.stringify(results.at(-1)));
  };
  try {
    await page.goto("http://localhost:8082/#analysis");
    await page.waitForSelector('.plot[data-render-ready="true"]');
    for (const size of [1000, 100000, 1000000]) {
      await page
        .getByLabel("데이터 규모", { exact: true })
        .selectOption(String(size));
      await page.waitForFunction(
        () => !document.querySelector(".studio .primary").disabled,
      );
      await run("full query", size);
    }
    const slider = page.getByLabel("포인트 크기", { exact: true });
    await slider.focus();
    await slider.press("Home");
    for (let i = 0; i < 10; i++) await slider.press("ArrowRight");
    await run("size change", 1000000);
    fs.writeFileSync(
      "artifacts/chart-timing-" + (process.argv[2] || "after") + ".json",
      JSON.stringify(
        {
          at: new Date().toISOString(),
          scope:
            "One run per case; integrated browser including automation, visible 4 of 10 categories; no sampling",
          results,
        },
        null,
        2,
      ),
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

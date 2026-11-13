const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 1100 } });
  p.setDefaultTimeout(240000);
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  try {
    await p.addInitScript(() => {
      const original = window.fetch;
      window.fetch = async (...args) => {
        const response = await original(...args);
        if (String(args[0]).endsWith("/api/execute")) {
          const read = response.json.bind(response);
          response.json = async () => {
            const value = await read();
            if (value.data?.charts)
              window.chartResponseCount = {
                categories: value.data.charts.length,
                points: value.data.charts.reduce(
                  (n, c) =>
                    n + c.series.reduce((m, s) => m + s.points.length, 0),
                  0,
                ),
              };
            return value;
          };
        }
        return response;
      };
    });
    await p.goto("http://localhost:8082/#analysis");
    await p.waitForSelector('.performance-strip[data-complete="true"]');
    await p.getByLabel("데이터 규모", { exact: true }).selectOption("1000000");
    await p.waitForFunction(
      () => !document.querySelector(".studio .primary").disabled,
    );
    await p
      .getByLabel("Category · 독립 차트", { exact: true })
      .selectOption("");
    await p.getByRole("button", { name: "분석 실행", exact: true }).click();
    await p.waitForSelector(
      '.plot[data-point-count="1000000"][data-render-ready="true"]',
    );
    await p.waitForSelector(
      '.performance-strip[data-visible-points="1000000"][data-complete="true"]',
    );
    const counts = await p.evaluate(() => window.chartResponseCount);
    assert.deepEqual(counts, { categories: 1, points: 1000000 });
    const timing = await p
      .locator(".performance-strip")
      .evaluate((e) => ({ ...e.dataset, text: e.textContent }));
    assert.ok(+timing.renderMs > 0);
    assert.deepEqual(errors, []);
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.screenshot({
      path: "artifacts/chart-million-single.png",
      fullPage: true,
    });
    fs.writeFileSync(
      "artifacts/chart-million-single.json",
      JSON.stringify(
        {
          passed: 3,
          checks: [
            "All 1,000,000 API points in one category",
            "Single million-point chart finishes rendering with visible timing",
            "No browser exceptions",
          ],
          timing,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify(timing));
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

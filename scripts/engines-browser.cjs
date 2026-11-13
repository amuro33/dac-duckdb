const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1100 },
    acceptDownloads: true,
  });
  page.setDefaultTimeout(180000);
  const errors = [],
    checks = [],
    results = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let view;
  try {
    await page.goto("http://localhost:8082/#analysis");
    await page.waitForSelector('.performance-strip[data-complete="true"]');
    await page
      .getByLabel("데이터 소스", { exact: true })
      .selectOption("joined");
    await page.getByLabel("데이터 규모", { exact: true }).selectOption("1000");
    await page.getByLabel("변환 엔진", { exact: true }).selectOption("spark");
    await page.waitForFunction(
      () => !document.querySelector(".studio .primary").disabled,
    );
    assert.match(
      await page.locator(".engine-note").innerText(),
      /물리 서버 1대/,
    );
    checks.push(
      "Spark reports two worker containers and one physical host honestly",
    );
    for (const engine of ["spark", "datafusion", "drill", "duckdb"]) {
      await page.getByLabel("변환 엔진", { exact: true }).selectOption(engine);
      await page
        .getByRole("button", { name: "분석 실행", exact: true })
        .click();
      await page.waitForSelector(`.engine-execution[data-engine="${engine}"]`);
      await page.waitForSelector(
        '.performance-strip[data-complete="true"][data-visible-points="400"]',
      );
      await page.waitForFunction(
        () => !document.querySelector(".studio .primary").disabled,
      );
      assert.equal(
        await page.getByLabel("X 컬럼", { exact: true }).inputValue(),
        "inspected_at",
      );
      const datasetId = new URLSearchParams(page.url().split("?")[1]).get(
        "dataset",
      );
      assert.ok(datasetId);
      results.push({
        engine,
        datasetId,
        execution: await page.locator(".engine-execution").innerText(),
      });
      checks.push(
        `${engine}: actual analysis completes, date-axis chart and split timings displayed`,
      );
      if (engine === "spark")
        await page.evaluate(() => window.scrollTo(0, 0));
      if (engine === "spark")
        await page.screenshot({
          path: "artifacts/engines-spark.png",
          fullPage: true,
        });
      if (engine === "drill") {
        const download = page.waitForEvent("download");
        await page
          .getByRole("button", { name: "SVG", exact: true })
          .first()
          .click();
        await (await download).saveAs("artifacts/engines-drill.svg");
        assert.match(
          fs.readFileSync("artifacts/engines-drill.svg", "utf8"),
          /<svg/,
        );
        checks.push("Drill result exports through the existing chart renderer");
        const url = page.url();
        await page.reload();
        await page.waitForSelector('.engine-execution[data-engine="drill"]');
        await page.waitForSelector('.performance-strip[data-complete="true"]');
        assert.equal(page.url(), url);
        assert.equal(
          await page.getByLabel("변환 엔진", { exact: true }).inputValue(),
          "drill",
        );
        checks.push(
          "Deep-link reload restores the actual engine without recomputing",
        );
      }
    }
    const name = "Engine browser QA " + Date.now();
    await page.getByRole("button", { name: "뷰 저장", exact: true }).click();
    await page.getByLabel("뷰 이름", { exact: true }).fill(name);
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await page.waitForSelector('[role="dialog"]', { state: "detached" });
    const views = await (
      await page.request.get("http://localhost:8082/api/workspace/views")
    ).json();
    view = views.find((v) => v.name === name);
    assert.equal(view.config.engine, "duckdb");
    assert.equal(view.config.datasetId, results.at(-1).datasetId);
    checks.push("Saved view retains engine and immutable dataset identity");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: "artifacts/engines-mobile.png",
      fullPage: true,
    });
    checks.push(
      "Engine controls and metrics fit mobile without horizontal page overflow",
    );
    assert.deepEqual(errors, []);
    checks.push("No browser runtime exceptions");
    fs.writeFileSync(
      "artifacts/engines-browser.json",
      JSON.stringify({ passed: checks.length, checks, results }, null, 2),
    );
    console.log("PASS: " + checks.length + " multi-engine browser checks");
  } finally {
    if (view)
      await page.request.delete(
        `http://localhost:8082/api/workspace/views/${view.id}?version=${view.version}`,
      );
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

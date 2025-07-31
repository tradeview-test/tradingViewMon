export async function scrapeChart(page, url) {
  try {
    let response;
    let retryCount = 0;
    while (retryCount < 2) {
      try {
        response = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        if (!response || response.status() >= 400)
          throw new Error("Bad response");
        break;
      } catch (err) {
        retryCount++;
        console.warn(`🔁 Retry ${retryCount} for ${url}: ${err.message}`);
        if (retryCount === 2) {
          throw new Error("Failed after retries: " + err.message);
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
        // small delay before retry
      }
    }

    if (!response || response.status() >= 400) {
      console.warn(`Unreachable or bad response: ${url}`);
      return {
        status: "NO",
        hl2Value: "",
        highValue: "",
        O: "",
        H: "",
        L: "",
        C: "",
        Volume: "",
        Volume2: "",
      };
    }

    await page.waitForFunction(
      () => document.querySelector('[data-name="legend-source-item"]'),
      { timeout: 15000 }
    );
    await new Promise((r) => setTimeout(r, 3000));

    const { trendData, ohlcData, volume, volume2 } = await page.evaluate(() => {
      const trends = Array.from(
        document.querySelectorAll('[data-name="legend-source-item"]')
      );

      const getSourceType = (trend) => {
        const el = Array.from(
          trend.querySelectorAll('[data-name="legend-source-description"]')
        ).find((e) => e.title === "Source");
        return el?.querySelector("div")?.textContent.trim() || null;
      };

      const getColorAndValue = (trend) => {
        const valueItems = Array.from(
          trend.querySelectorAll(".valueValue-l31H9iuA")
        ).filter((el) => el.textContent.trim().match(/[\d,]+\.\d+/)); // filter only numeric looking ones

        const el = valueItems[0]; // pick the first valid number

        return {
          color: el?.style.color || null,
          value: el?.textContent.trim() || null,
        };
      };

      const trendData = trends
        .map((trend) => {
          const source = getSourceType(trend);
          const { color, value } = getColorAndValue(trend);
          return { source, color, value };
        })
        .filter((t) => t.source && t.color && t.value);

      const ohlcData = {};
      document.querySelectorAll("[data-test-id-value-title]").forEach((el) => {
        const title = el.getAttribute("data-test-id-value-title");
        const value = el
          .querySelector(".valueValue-l31H9iuA")
          ?.textContent.trim();
        if (["O", "H", "L", "C"].includes(title)) {
          ohlcData[title] = value;
        }
      });
      const volume =
        document
          .querySelector(
            '[data-test-id-value-title="Volume"] .valueValue-l31H9iuA'
          )
          ?.textContent.trim() || "";

      const volume2 =
        document
          .querySelector(
            '[data-test-id-value-title="Volume MA"] .valueValue-l31H9iuA'
          )
          ?.textContent.trim() || "";

      return { trendData, ohlcData, volume, volume2 };
    });

    const hl2 = trendData.find((t) => t.source === "hl2");
    const high = trendData.find((t) => t.source === "high");

    const hl2Color = hl2?.color;
    const highColor = high?.color;
    const hl2Value = hl2?.value;
    const highValue = high?.value;

    const status =
      hl2Color === "rgb(76, 175, 80)" && highColor === "rgb(76, 175, 80)"
        ? "BUY"
        : hl2Color === "rgb(255, 82, 82)" && highColor === "rgb(255, 82, 82)"
        ? "SELL"
        : "N";

    console.log(
      `hl2: ${hl2Color}, high: ${highColor} → ${status}, Volume:${volume}, Volume2:${volume2}`
    );

    return {
      status,
      hl2Value,
      highValue,
      O: ohlcData.O || "",
      H: ohlcData.H || "",
      L: ohlcData.L || "",
      C: ohlcData.C || "",
      Volume: volume || "",
      Volume2: volume2 || "",
    };
  } catch (err) {
    console.error(`Fatal error at ${url}:`, err.message);
    return {
      status: "NO",
      hl2Value: "",
      highValue: "",
      O: "",
      H: "",
      L: "",
      C: "",
      Volume: "",
      Volume2: "",
    };
  }
}

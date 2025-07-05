import puppeteer from "puppeteer";
import fs from "fs";
import { login } from "./login.js";
import { scrapeChart } from "./scrape.js";
import { google } from "googleapis";

const COOKIE_PATH = "./cookies.json";

if (process.env.COOKIES_BASE64 && !fs.existsSync(COOKIE_PATH)) {
  const decoded = Buffer.from(process.env.COOKIES_BASE64, "base64").toString(
    "utf-8"
  );
  fs.writeFileSync(COOKIE_PATH, decoded);
  console.log("✅ cookies.json restored from Base64");
}

async function saveCookies(cookies) {
  fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookies, null, 2));
}

async function loadCookies(page) {
  if (fs.existsSync(COOKIE_PATH)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIE_PATH));
    await page.setCookie(...cookies);
    return true;
  }
  return false;
}

const SHEET_ID = process.env.SHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || "Sheet1";

const auth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

async function getLinks() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!B2:B`,
  });
  const rows = res.data.values || [];
  return rows
    .map((row, i) => ({ rowIndex: i + 2, link: row[0] }))
    .filter((entry) => !!entry.link);
}

async function updateSheet(result) {
  const { rowIndex, status, hl2Value, highValue, O, H, L, C } = result;
  const data = [
    {
      range: `${SHEET_NAME}!C${rowIndex}:I${rowIndex}`,
      values: [[status, hl2Value, highValue, O, H, L, C]],
    },
  ];

  try {
    const res = await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: "RAW",
        data,
      },
    });
    console.log(`✅ Sheet updated: ${res.statusText}`);
  } catch (err) {
    console.error("❌ Failed to update sheet:", err.message);
  }
}

async function processLinks(links) {
  const browser = await puppeteer.launch({
    headless: "new", // Login page requires UI rendering
    slowMo: 50,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  const hasCookies = await loadCookies(page);
  if (!hasCookies) {
    try {
      const cookies = await login(page);
      await saveCookies(cookies);
    } catch (err) {
      console.error("❌ Login failed:", err.message);
      //   try {
      //     await page.screenshot({ path: "fatal-login-error.png" });
      //   } catch (screenshotError) {
      //     console.warn("⚠ Could not take screenshot:", screenshotError.message);
      //   }

      await browser.close();
      process.exit(1);
    }
  }

  for (const { rowIndex, link } of links) {
    let retries = 0;
    let result;
    while (retries < 2) {
      try {
        result = await scrapeChart(page, link);
        await updateSheet({ rowIndex, ...result });
        console.log(`✅ Row ${rowIndex}: ${result.status}`);
        break;
      } catch (err) {
        retries++;
        console.error(
          `❌ Row ${rowIndex} failed (attempt ${retries}):`,
          err.message
        );
        // if (retries === 2) {
        //   results.push({
        //     rowIndex,
        //     status: "NO",
        //     hl2Value: "",
        //     highValue: "",
        //     O: "",
        //     H: "",
        //     L: "",
        //     C: "",
        //   });
        // }
      }
    }
  }

  await browser.close();
  // return results;
}

(async () => {
  const links = await getLinks();
  await processLinks(links);
})();

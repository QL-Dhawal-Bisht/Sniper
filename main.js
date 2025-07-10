const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
require('dotenv').config();

const rawDir = path.join(__dirname, 'raw');
const deepDir = path.join(__dirname, 'deepscrape');
if (!fs.existsSync(rawDir)) fs.mkdirSync(rawDir);
if (!fs.existsSync(deepDir)) fs.mkdirSync(deepDir);



const openai = new OpenAI({
  apiKey: process.env.OpenAI_API_KEY
});

class LeadGenerator {
  async init() {
    this.browser = await chromium.launchPersistentContext('D:/Projects/chrome-profile-copy', {
      headless: false,
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--start-maximized', '--disable-blink-features=AutomationControlled']
    });
    this.page = await this.browser.newPage();
    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
  }

  async generateKeywords(business, services, audience) {
    const prompt = `Extract 5 specific keywords for B2B scraping:\nBusiness: ${business}\nServices: ${services}\nAudience: ${audience}\nFormat: one keyword per line, no numbers.`;
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 100
    });
    return res.choices[0].message.content
      .split('\n')
      .map(k => k.trim())
      .filter(k => k);
  }

  generateDorks(keywords) {
    const sites = ['linkedin.com/company', 'clutch.co/profile', 'angel.co/company'];
    const dorks = [];
    for (const site of sites) {
      for (const k of keywords) {
        dorks.push(`site:${site} "${k}"`);
      }
    }
    return dorks.slice(0, 10);
  }

  async scrapeDorks(dorks) {
    const results = [];
    for (const dork of dorks) {
      const url = `https://www.google.com/search?q=${encodeURIComponent(dork)}&num=10`;
      await this.page.goto(url);
      await this.page.waitForTimeout(3000);
      const html = await this.page.content();
      if (html.includes('unusual traffic')) continue;

      const found = await this.page.$$eval('div.tF2Cxc, div.g', divs =>
        divs.map(d => {
          const title = d.querySelector('h3')?.innerText || '';
          const url = d.querySelector('a')?.href || '';
          const snippet = d.querySelector('.VwiC3b')?.innerText || '';
          return title && url ? { title, url, snippet } : null;
        }).filter(Boolean)
      );
      const safe = dork.replace(/[^a-z0-9]/gi, '_').slice(0, 80);
      fs.writeFileSync(path.join(rawDir, `results_${safe}.txt`), found.map(r => `${r.title}\n${r.url}\n${r.snippet}`).join('\n\n'));
      results.push(...found);
    }

    console.log("results", results);
    return results;
  }

  async scrapeDeep(urls) {
    for (const url of urls) {
      try {
        await this.page.goto(url, { timeout: 15000 });
        await this.page.waitForTimeout(4000);
        let text = '';

        if (url.includes('linkedin.com')) {
          text = await this.page.evaluate(() => document.body.innerText);
        } else if (url.includes('clutch.co')) {
          text = await this.page.evaluate(() => {
            const el = document.querySelector('main') || document.body;
            return el.innerText;
          });
        } else if (url.includes('angel.co')) {
          text = await this.page.evaluate(() => document.body.innerText);
        } else {
          text = await this.page.evaluate(() => document.body.innerText);
        }

        const safe = url.replace(/[^a-z0-9]/gi, '_').slice(0, 80);
        fs.writeFileSync(path.join(deepDir, `scraped_${safe}.txt`), `URL: ${url}\n\n${text}`);
        console.log('✓ Saved:', url);
        await this.page.waitForTimeout(3000);
      } catch (e) {
        console.log('✗ Failed:', url, e.message);
      }
    }
  }

  async close() {
    await this.browser.close();
  }
}

async function run(business, services, audience) {
  const bot = new LeadGenerator();
  try {
    await bot.init();
    const keywords = await bot.generateKeywords(business, services, audience);
    const dorks = bot.generateDorks(keywords);
    const results = await bot.scrapeDorks(dorks);
    const urls = results.map(r => r.url).filter(u => u.includes('linkedin.com') || u.includes('clutch.co') || u.includes('angel.co'));
    await bot.scrapeDeep(urls);
  } finally {
    await bot.close();
  }
}

run(
  "B2B SaaS",
  "Web development, mobile development",
  "Startups and SMBs"
);

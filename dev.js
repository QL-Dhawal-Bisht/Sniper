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

  async generateDynamicDorks(business, services, audience, keywords) {
    const prompt = `You are a Google dorking expert. Create 5 highly effective Google search dorks to find B2B leads.

Business Type: ${business}
Services: ${services}
Target Audience: ${audience}
Keywords: ${keywords.join(', ')}

Create diverse dorks that will find:
1. Company profiles and directories
2. Decision makers and contact information
3. Industry-specific platforms
4. Job postings that reveal company needs
5. Company announcements and press releases

Use these tactics:
- Site-specific searches (linkedin.com, clutch.co, crunchbase.com, angel.co, etc.)
- Inurl/intitle operators for finding specific page types
- Quote searches for exact phrases
- Industry-specific terminology
- Job titles and roles
- Company size indicators
- Geographic targeting if relevant
- File type searches (filetype:pdf for whitepapers, etc.)

IMPORTANT: Return ONLY the search queries, one per line. No markdown, no code blocks, no explanations, no numbering.
Example format:
site:linkedin.com "software development" "startup"
inurl:about "mobile app development" "small business"
site:crunchbase.com "web development" "seed funding"

Make them highly specific and actionable for finding ${audience} in ${business} who need ${services}.`;

    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300,
      temperature: 0.7
    });

    const dorks = res.choices[0].message.content
      .split('\n')
      .map(d => d.trim())
      .filter(d => d && !d.includes('```') && !d.match(/^\d+\.?\s/)) // Remove code blocks and numbered items
      .slice(0, 5);

    console.log('Generated Dynamic Dorks:');
    dorks.forEach((dork, i) => console.log(`${i + 1}. ${dork}`));
    
    return dorks;
  }

  async scrapeDorks(dorks) {
    const results = [];

    for (const dork of dorks) {
      try {
        console.log(`🔍 Searching: ${dork}`);
        const url = `https://www.google.com/search?q=${encodeURIComponent(dork)}&num=10`;
        console.log(`📍 URL: ${url}`);
        
        // Add better wait conditions
        await this.page.goto(url, { timeout: 15000 });
        await this.page.waitForTimeout(3000);
        
        // Wait for search results to load
        try {
          await this.page.waitForSelector('div.g, div.tF2Cxc, [data-ved]', { timeout: 5000 });
        } catch (waitError) {
          console.log('⚠️  Search results selector not found, continuing anyway...');
        }
        
        const html = await this.page.content();
        if (html.includes('unusual traffic')) {
          console.log('⚠️  Rate limited, waiting longer...');
          await this.page.waitForTimeout(10000);
          continue;
        }

        // Fixed: Use $$eval instead of $eval to get all matching elements
        const found = await this.page.$$eval('div.tF2Cxc, div.g', (divs) => {
          return divs.map(d => {
            const title = d.querySelector('h3')?.innerText || '';
            const url = d.querySelector('a')?.href || '';
            const snippet = d.querySelector('.VwiC3b, .IsZvec')?.innerText || '';
            return title && url ? { title, url, snippet } : null;
          }).filter(Boolean);
        });

        // Debug: Save page screenshot and HTML for troubleshooting
        if (found.length === 0) {
          console.log(`❌ No results for: ${dork}`);
          // Try alternative selectors if primary ones fail
          const alternativeResults = await this.page.$$eval('div[data-ved]', (divs) => {
            return divs.map(d => {
              const title = d.querySelector('h3')?.innerText || '';
              const url = d.querySelector('a')?.href || '';
              const snippet = d.querySelector('.s, .st, span[data-ved]')?.innerText || '';
              return title && url ? { title, url, snippet } : null;
            }).filter(Boolean);
          }).catch(() => []);
          
          if (alternativeResults.length > 0) {
            console.log(`✅ Found ${alternativeResults.length} results with alternative selector for: ${dork}`);
            const safe = dork.replace(/[^a-z0-9]/gi, '_').slice(0, 80);
            fs.writeFileSync(
              path.join(rawDir, `results_${safe}.txt`), 
              alternativeResults.map(r => `${r.title}\n${r.url}\n${r.snippet}`).join('\n\n')
            );
            results.push(...alternativeResults);
          } else {
            // Uncomment below lines for debugging
            // await this.page.screenshot({ path: `debug_${Date.now()}.png` });
            // fs.writeFileSync(`debug_${Date.now()}.html`, await this.page.content());
          }
        } else {
          console.log(`✅ Found ${found.length} results for: ${dork}`);
          const safe = dork.replace(/[^a-z0-9]/gi, '_').slice(0, 80);
          fs.writeFileSync(
            path.join(rawDir, `results_${safe}.txt`), 
            found.map(r => `${r.title}\n${r.url}\n${r.snippet}`).join('\n\n')
          );
          results.push(...found);
        }

        await this.page.waitForTimeout(2000 + Math.random() * 3000); // Random delay
      } catch (e) {
        console.log(`❌ Error with dork: ${dork}`, e.message);
      }
    }

    console.log(`\n📊 Summary: ${results.length} total results from ${dorks.length} dorks`);
    return results;
  }

  async scrapeDeep(urls) {
    const uniqueUrls = [...new Set(urls)]; // Remove duplicates
    console.log(`\n🔍 Deep scraping ${uniqueUrls.length} unique URLs...`);

    for (const url of uniqueUrls) {
      try {
        await this.page.goto(url, { timeout: 15000 });
        await this.page.waitForTimeout(4000);
        let text = '';

        if (url.includes('linkedin.com')) {
          text = await this.page.evaluate(() => {
            // Try to get more specific content for LinkedIn
            const selectors = [
              '[data-test-id="about-us-description"]',
              '.org-about-company-module__description',
              '.org-top-card-summary__tagline',
              '.org-about-us-organization-description'
            ];
            
            for (const selector of selectors) {
              const el = document.querySelector(selector);
              if (el) return el.innerText;
            }
            return document.body.innerText;
          });
        } else if (url.includes('clutch.co')) {
          text = await this.page.evaluate(() => {
            const main = document.querySelector('main') || document.body;
            return main.innerText;
          });
        } else if (url.includes('crunchbase.com')) {
          text = await this.page.evaluate(() => {
            const main = document.querySelector('[data-testid="description"]') || 
                        document.querySelector('.description') ||
                        document.querySelector('main') || 
                        document.body;
            return main.innerText;
          });
        } else {
          text = await this.page.evaluate(() => document.body.innerText);
        }

        const safe = url.replace(/[^a-z0-9]/gi, '_').slice(0, 80);
        fs.writeFileSync(path.join(deepDir, `scraped_${safe}.txt`), `URL: ${url}\n\n${text}`);
        console.log('✅ Saved:', url);
        await this.page.waitForTimeout(3000 + Math.random() * 2000);
      } catch (e) {
        console.log('❌ Failed:', url, e.message);
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
    
    console.log('🔍 Generating keywords...');
    const keywords = await bot.generateKeywords(business, services, audience);
    console.log('Keywords:', keywords);
    
    console.log('\n🎯 Generating dynamic dorks...');
    const dorks = await bot.generateDynamicDorks(business, services, audience, keywords);
    
    console.log('\n🔍 Scraping with generated dorks...');
    const results = await bot.scrapeDorks(dorks);
    
    console.log('\n📊 Filtering relevant URLs...');
    const relevantUrls = results
      .map(r => r.url)
      .filter(u => u && (
        u.includes('linkedin.com') || 
        u.includes('clutch.co') || 
        u.includes('angel.co') ||
        u.includes('crunchbase.com') ||
        u.includes('github.com') ||
        u.includes('stackoverflow.com') ||
        u.includes('medium.com')
      ));
    
    console.log(`Found ${relevantUrls.length} relevant URLs to scrape`);
    
    if (relevantUrls.length > 0) {
      await bot.scrapeDeep(relevantUrls);
    }
    
    console.log('\n✅ Lead generation completed!');
    
  } finally {
    await bot.close();
  }
}

run(
  "B2B SaaS",
  "Web development, mobile development",
  "Startups and SMBs"
);
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const readline = require('readline');
require('dotenv').config();

const rawDir = path.join(__dirname, 'raw');
const deepDir = path.join(__dirname, 'deepscrape');
if (!fs.existsSync(rawDir)) fs.mkdirSync(rawDir);
if (!fs.existsSync(deepDir)) fs.mkdirSync(deepDir);

const openai = new OpenAI({
  apiKey: process.env.OpenAI_API_KEY
});

// User input interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (question) => {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
};

class DynamicLeadGenerator {
  constructor() {
    // Comprehensive platform mapping with specific use cases
    this.platformStrategies = {
      'linkedin': {
        domains: ['linkedin.com/company', 'linkedin.com/in'],
        strengths: ['B2B contacts', 'decision makers', 'company info', 'professional networking'],
        selectors: [
          'site:linkedin.com/company',
          'site:linkedin.com/in',
          'inurl:linkedin.com/company',
          'inurl:linkedin.com/pulse'
        ]
      },
      'crunchbase': {
        domains: ['crunchbase.com/organization'],
        strengths: ['startup funding', 'company financials', 'growth stage', 'investor info'],
        selectors: ['site:crunchbase.com/organization', 'site:crunchbase.com/company']
      },
      'clutch': {
        domains: ['clutch.co/profile', 'clutch.co/directory'],
        strengths: ['service providers', 'client reviews', 'project portfolios', 'B2B services'],
        selectors: ['site:clutch.co/profile', 'site:clutch.co/directory']
      },
      'reddit': {
        domains: ['reddit.com/r/'],
        strengths: ['pain points', 'recommendations', 'community discussions', 'real feedback'],
        selectors: ['site:reddit.com/r/', 'site:reddit.com']
      },
      'ycombinator': {
        domains: ['ycombinator.com/companies', 'news.ycombinator.com'],
        strengths: ['startups', 'tech companies', 'funding info', 'innovation'],
        selectors: ['site:ycombinator.com/companies', 'site:news.ycombinator.com']
      },
      'indiehackers': {
        domains: ['indiehackers.com'],
        strengths: ['bootstrap startups', 'solo entrepreneurs', 'SaaS founders', 'growth stories'],
        selectors: ['site:indiehackers.com']
      },
      'angellist': {
        domains: ['angel.co/company', 'wellfound.com'],
        strengths: ['startup jobs', 'equity positions', 'company culture', 'team info'],
        selectors: ['site:angel.co/company', 'site:wellfound.com']
      },
      'github': {
        domains: ['github.com'],
        strengths: ['tech companies', 'open source', 'developer tools', 'technical needs'],
        selectors: ['site:github.com']
      },
      'stackoverflow': {
        domains: ['stackoverflow.com/jobs', 'stackoverflow.com/questions'],
        strengths: ['technical hiring', 'developer pain points', 'solution seeking'],
        selectors: ['site:stackoverflow.com/jobs', 'site:stackoverflow.com/questions']
      },
      'directories': {
        domains: ['yellowpages.com', 'yelp.com', 'trustpilot.com', 'g2.com', 'capterra.com'],
        strengths: ['local businesses', 'reviews', 'contact info', 'service ratings'],
        selectors: ['site:yellowpages.com', 'site:yelp.com', 'site:trustpilot.com', 'site:g2.com', 'site:capterra.com']
      },
      'forums': {
        domains: ['quora.com', 'producthunt.com'],
        strengths: ['questions', 'product launches', 'community feedback', 'expert opinions'],
        selectors: ['site:quora.com', 'site:producthunt.com']
      }
    };

    // Intent-based keywords for finding prospects
    this.intentKeywords = {
      'looking_for': [
        '"looking for"', '"searching for"', '"need help with"', '"seeking"', 
        '"in search of"', '"trying to find"', '"want to hire"', '"need a"'
      ],
      'pain_points': [
        '"struggling with"', '"having trouble"', '"problems with"', '"issues with"',
        '"challenges"', '"frustrated with"', '"difficult to"', '"can\'t figure out"'
      ],
      'budget_indicators': [
        '"budget for"', '"cost of"', '"price range"', '"how much"', 
        '"afford"', '"investment in"', '"spending on"'
      ],
      'urgency': [
        '"urgent"', '"asap"', '"immediately"', '"deadline"', 
        '"by end of"', '"need fast"', '"quick turnaround"'
      ],
      'decision_making': [
        '"CEO"', '"CTO"', '"founder"', '"director"', '"manager"', 
        '"head of"', '"VP"', '"chief"', '"owner"', '"decision maker"'
      ],
      'company_stage': [
        '"startup"', '"scale up"', '"growing company"', '"established business"',
        '"small business"', '"SMB"', '"enterprise"', '"Fortune 500"'
      ]
    };
  }

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

  async getUserInput() {
    console.log('\n🎯 Dynamic Lead Generator - Setup\n');
    
    const business = await askQuestion('Enter your business type (e.g., "B2B SaaS", "Digital Marketing Agency", "E-commerce Platform"): ');
    const services = await askQuestion('Enter your services (e.g., "Web development, mobile apps, API integration"): ');
    const audience = await askQuestion('Enter your target audience (e.g., "Early-stage startups", "SMBs in healthcare", "Enterprise retailers"): ');
    const budget = await askQuestion('Enter typical client budget range (e.g., "$5k-50k", "Enterprise level", "Bootstrap friendly"): ');
    const geography = await askQuestion('Enter target geography (e.g., "US", "Global", "Europe", "Remote-first"): ');
    
    rl.close();
    
    return { business, services, audience, budget, geography };
  }

  async analyzeBestPlatforms(business, services, audience, budget, geography) {
    const prompt = `You are an expert lead generation strategist. Analyze the following business requirements and recommend the TOP 6 most effective platforms for finding leads.

Business Type: ${business}
Services Offered: ${services}
Target Audience: ${audience}
Budget Range: ${budget}
Geography: ${geography}

Available platforms and their strengths:
${Object.entries(this.platformStrategies).map(([platform, info]) => 
  `${platform}: ${info.strengths.join(', ')}`
).join('\n')}

Consider:
1. Where your target audience is most active
2. Platform alignment with business type
3. Budget compatibility
4. Geographic reach
5. Lead quality potential

Return ONLY the 6 platform names (linkedin, crunchbase, reddit, etc.) in order of priority, one per line. No explanations, no numbers, no formatting.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 100,
      temperature: 0.3
    });

    const platforms = response.choices[0].message.content
      .split('\n')
      .map(p => p.trim().toLowerCase())
      .filter(p => p && this.platformStrategies[p])
      .slice(0, 6);

    console.log('\n🎯 Selected Priority Platforms:');
    platforms.forEach((platform, i) => {
      console.log(`${i + 1}. ${platform.toUpperCase()} - ${this.platformStrategies[platform].strengths.join(', ')}`);
    });

    return platforms;
  }

  async generateAdvancedDorks(business, services, audience, budget, geography, platforms) {
    const prompt = `You are the world's best Google dorking expert. Create 12 highly advanced, laser-targeted Google search dorks for B2B lead generation.

TARGET PROFILE:
Business Type: ${business}
Services: ${services}
Target Audience: ${audience}
Budget: ${budget}
Geography: ${geography}

PRIORITY PLATFORMS: ${platforms.join(', ')}

ADVANCED DORKING REQUIREMENTS:
1. Use these intent keywords strategically: "looking for", "need", "seeking", "hiring", "budget for", "struggling with"
2. Include decision-maker titles: CEO, CTO, founder, director, head of, VP
3. Combine multiple operators: site:, inurl:, intitle:, filetype:, "exact phrases"
4. Target pain points and active buying signals
5. Include company size indicators
6. Add geographic targeting when relevant
7. Look for project announcements, job postings, forum discussions
8. Find companies mentioning competitors or alternatives

PLATFORM-SPECIFIC TACTICS:
- LinkedIn: Company pages, job postings, executive profiles, industry groups
- Reddit: Subreddit discussions, recommendation requests, problem-solving threads  
- Crunchbase: Funding announcements, company growth stages
- Clutch/Directories: Service provider searches, client reviews
- GitHub: Technical projects, open source needs, developer tools
- Forums: Q&A sites, community discussions, expert advice

Create diverse dorks that find:
- Active prospects currently seeking solutions
- Companies with budget and decision-making authority  
- Pain points and challenges in your service area
- Competitor mentions and alternative solution searches
- Project announcements and expansion plans
- Technical discussions revealing needs

CRITICAL: Return ONLY the search queries, one per line. No explanations, no markdown, no numbering, no code blocks.

Make each dork highly specific to finding ${audience} in ${business} who need ${services} with ${budget} budget.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
      temperature: 0.8
    });

    const dorks = response.choices[0].message.content
      .split('\n')
      .map(d => d.trim())
      .filter(d => d && !d.includes('```') && !d.match(/^\d+\.?\s/))
      .slice(0, 12);

    console.log('\n🔍 Generated Advanced Dorks:');
    dorks.forEach((dork, i) => {
      console.log(`${i + 1}. ${dork}`);
    });

    return dorks;
  }

  async generateTargetedKeywords(business, services, audience, budget, geography) {
    const prompt = `Extract 8 highly specific, targeted keywords for advanced B2B lead generation:

Business: ${business}
Services: ${services}
Audience: ${audience}
Budget: ${budget}
Geography: ${geography}

Focus on:
1. Industry-specific terminology
2. Pain point keywords
3. Solution-seeking phrases
4. Budget/investment terms
5. Company stage indicators
6. Geographic modifiers
7. Service-specific needs
8. Decision-maker language

Return one keyword/phrase per line, no formatting, no numbers.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 150,
      temperature: 0.5
    });

    return response.choices[0].message.content
      .split('\n')
      .map(k => k.trim())
      .filter(k => k)
      .slice(0, 8);
  }

  async scrapeDorks(dorks) {
    const results = [];
    console.log(`\n🔍 Starting advanced scraping of ${dorks.length} dorks...\n`);

    for (let i = 0; i < dorks.length; i++) {
      const dork = dorks[i];
      try {
        console.log(`🔍 [${i + 1}/${dorks.length}] Searching: ${dork}`);
        const url = `https://www.google.com/search?q=${encodeURIComponent(dork)}&num=20`;
        
        await this.page.goto(url, { timeout: 20000 });
        await this.page.waitForTimeout(3000);
        
        // Enhanced wait for search results
        try {
          await this.page.waitForSelector('div.g, div.tF2Cxc, [data-ved]', { timeout: 8000 });
        } catch (waitError) {
          console.log('⚠️  Primary selectors not found, trying alternatives...');
        }
        
        const html = await this.page.content();
        if (html.includes('unusual traffic') || html.includes('detected unusual traffic')) {
          console.log('⚠️  Rate limited detected, implementing longer delay...');
          await this.page.waitForTimeout(15000);
          continue;
        }

        // Enhanced result extraction with multiple fallback selectors
        const found = await this.page.evaluate(() => {
          const selectors = [
            'div.tF2Cxc',
            'div.g',
            'div[data-ved]',
            '.rc',
            '.srg .g'
          ];
          
          let results = [];
          
          for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
              results = Array.from(elements).map(el => {
                const titleEl = el.querySelector('h3') || el.querySelector('a h3') || el.querySelector('.LC20lb');
                const linkEl = el.querySelector('a') || el.querySelector('h3 a');
                const snippetEl = el.querySelector('.VwiC3b') || el.querySelector('.IsZvec') || el.querySelector('.st') || el.querySelector('.s');
                
                const title = titleEl?.innerText?.trim() || '';
                const url = linkEl?.href || '';
                const snippet = snippetEl?.innerText?.trim() || '';
                
                return title && url && !url.includes('google.com') ? { title, url, snippet } : null;
              }).filter(Boolean);
              
              if (results.length > 0) break;
            }
          }
          
          return results;
        });

        if (found.length > 0) {
          console.log(`✅ Found ${found.length} results`);
          
          // Enhanced filename safety
          const safeFilename = dork
            .replace(/[^a-zA-Z0-9\s]/g, '_')
            .replace(/\s+/g, '_')
            .slice(0, 100);
          
          const resultText = found.map(r => 
            `TITLE: ${r.title}\nURL: ${r.url}\nSNIPPET: ${r.snippet}\n${'='.repeat(80)}`
          ).join('\n\n');
          
          fs.writeFileSync(
            path.join(rawDir, `results_${safeFilename}.txt`), 
            `SEARCH QUERY: ${dork}\nRESULTS: ${found.length}\nTIMESTAMP: ${new Date().toISOString()}\n\n${resultText}`
          );
          
          results.push(...found);
        } else {
          console.log(`❌ No results found for: ${dork}`);
        }

        // Progressive delay increase for later searches
        const delay = 2000 + Math.random() * 3000 + (i * 500);
        await this.page.waitForTimeout(delay);
        
      } catch (error) {
        console.log(`❌ Error processing dork: ${dork} - ${error.message}`);
      }
    }

    console.log(`\n📊 SCRAPING SUMMARY:`);
    console.log(`Total results collected: ${results.length}`);
    console.log(`Unique URLs found: ${new Set(results.map(r => r.url)).size}`);
    
    return results;
  }

  async scrapeDeep(urls, platforms) {
    const uniqueUrls = [...new Set(urls)];
    console.log(`\n🔍 Deep scraping ${uniqueUrls.length} unique URLs...\n`);

    // Enhanced platform-specific scraping strategies
    const platformScrapers = {
      'linkedin': async (url, page) => {
        const selectors = [
          '[data-test-id="about-us-description"]',
          '.org-about-company-module__description',
          '.org-top-card-summary__tagline',
          '.org-about-us-organization-description',
          '.pv-text-details__left-panel',
          '.pv-entity__summary-info'
        ];
        
        for (const selector of selectors) {
          try {
            await page.waitForSelector(selector, { timeout: 3000 });
            const content = await page.$eval(selector, el => el.innerText);
            if (content.trim()) return content;
          } catch (e) { continue; }
        }
        return await page.evaluate(() => document.body.innerText);
      },
      
      'reddit': async (url, page) => {
        return await page.evaluate(() => {
          const post = document.querySelector('[data-testid="post-content"]') || 
                       document.querySelector('.Post') ||
                       document.querySelector('._3xX726aBn29LDbsDtzr_6E');
          return post ? post.innerText : document.body.innerText;
        });
      },
      
      'crunchbase': async (url, page) => {
        const selectors = [
          '[data-testid="description"]',
          '.description',
          '.cb-card',
          '.profile-section'
        ];
        
        for (const selector of selectors) {
          try {
            const content = await page.$eval(selector, el => el.innerText);
            if (content.trim()) return content;
          } catch (e) { continue; }
        }
        return await page.evaluate(() => document.body.innerText);
      }
    };

    for (let i = 0; i < uniqueUrls.length; i++) {
      const url = uniqueUrls[i];
      try {
        console.log(`📄 [${i + 1}/${uniqueUrls.length}] Scraping: ${url}`);
        
        await this.page.goto(url, { timeout: 20000 });
        await this.page.waitForTimeout(4000);
        
        // Determine platform and use appropriate scraper
        const platform = platforms.find(p => url.includes(p));
        let content = '';
        
        if (platform && platformScrapers[platform]) {
          content = await platformScrapers[platform](url, this.page);
        } else {
          content = await this.page.evaluate(() => {
            // Remove script and style content
            const scripts = document.querySelectorAll('script, style, nav, footer, header');
            scripts.forEach(el => el.remove());
            
            const main = document.querySelector('main') || 
                         document.querySelector('article') || 
                         document.querySelector('.content') ||
                         document.body;
            
            return main.innerText;
          });
        }
        
        if (content.trim()) {
          const safeFilename = url
            .replace(/[^a-zA-Z0-9]/g, '_')
            .slice(0, 100);
          
          const fullContent = `URL: ${url}\nPLATFORM: ${platform || 'unknown'}\nSCRAPED: ${new Date().toISOString()}\n\n${content}`;
          
          fs.writeFileSync(
            path.join(deepDir, `deep_${safeFilename}.txt`), 
            fullContent
          );
          
          console.log(`✅ Saved: ${url.substring(0, 60)}...`);
        }
        
        // Respectful delay
        await this.page.waitForTimeout(4000 + Math.random() * 3000);
        
      } catch (error) {
        console.log(`❌ Failed to scrape: ${url} - ${error.message}`);
      }
    }
  }

  async filterRelevantUrls(results, platforms) {
    console.log('\n📊 Filtering and prioritizing URLs...');
    
    // Enhanced URL filtering with scoring
    const scoredUrls = results.map(result => {
      let score = 0;
      const url = result.url.toLowerCase();
      
      // Platform relevance scoring
      platforms.forEach(platform => {
        if (url.includes(platform)) score += 10;
      });
      
      // High-value domains
      const highValueDomains = [
        'linkedin.com/company', 'linkedin.com/in',
        'crunchbase.com', 'angel.co', 'wellfound.com',
        'clutch.co', 'ycombinator.com', 'indiehackers.com',
        'reddit.com/r/', 'github.com', 'stackoverflow.com',
        'producthunt.com', 'betalist.com'
      ];
      
      highValueDomains.forEach(domain => {
        if (url.includes(domain)) score += 5;
      });
      
      // Content quality indicators
      const title = result.title.toLowerCase();
      const snippet = result.snippet.toLowerCase();
      const content = `${title} ${snippet}`;
      
      // Intent signals
      const intentSignals = [
        'looking for', 'need', 'seeking', 'hiring', 'budget',
        'startup', 'founder', 'ceo', 'director', 'manager'
      ];
      
      intentSignals.forEach(signal => {
        if (content.includes(signal)) score += 3;
      });
      
      return { ...result, score };
    });
    
    // Sort by score and return top URLs
    const topUrls = scoredUrls
      .sort((a, b) => b.score - a.score)
      .slice(0, 50) // Limit to top 50 for deep scraping
      .map(item => item.url);
    
    console.log(`Selected ${topUrls.length} high-priority URLs for deep scraping`);
    return topUrls;
  }

  async generateSummaryReport(business, services, audience, platforms, totalResults) {
    const reportContent = `
# Lead Generation Campaign Report

## Campaign Configuration
- **Business Type**: ${business}
- **Services Offered**: ${services}
- **Target Audience**: ${audience}
- **Selected Platforms**: ${platforms.join(', ')}
- **Generated**: ${new Date().toISOString()}

## Results Summary
- **Total Results Collected**: ${totalResults}
- **Platforms Targeted**: ${platforms.length}
- **Files Generated**: Check 'raw' and 'deepscrape' directories

## Next Steps
1. Review scraped content in the 'deepscrape' directory
2. Extract contact information and company details
3. Qualify leads based on your criteria
4. Create targeted outreach campaigns
5. Track engagement and conversion metrics

## File Structure
- \`raw/\`: Initial search results organized by query
- \`deepscrape/\`: Detailed page content from priority URLs
    `;

    fs.writeFileSync(path.join(__dirname, 'lead_generation_report.md'), reportContent);
    console.log('\n📋 Summary report generated: lead_generation_report.md');
  }

  async close() {
    await this.browser.close();
  }
}

// Main execution function
async function runDynamicLeadGeneration() {
  const generator = new DynamicLeadGenerator();
  
  try {
    console.log('🚀 Initializing Dynamic Lead Generator...');
    await generator.init();
    
    // Get user requirements
    const userInput = await generator.getUserInput();
    console.log('\n✅ User input collected successfully');
    
    // Generate targeted keywords
    console.log('\n🔍 Generating targeted keywords...');
    const keywords = await generator.generateTargetedKeywords(
      userInput.business, 
      userInput.services, 
      userInput.audience, 
      userInput.budget, 
      userInput.geography
    );
    console.log('Keywords generated:', keywords.join(', '));
    
    // Analyze and select best platforms
    console.log('\n🎯 Analyzing optimal platforms...');
    const platforms = await generator.analyzeBestPlatforms(
      userInput.business, 
      userInput.services, 
      userInput.audience, 
      userInput.budget, 
      userInput.geography
    );
    
    // Generate advanced dorks
    console.log('\n🔍 Generating advanced Google dorks...');
    const dorks = await generator.generateAdvancedDorks(
      userInput.business, 
      userInput.services, 
      userInput.audience, 
      userInput.budget, 
      userInput.geography, 
      platforms
    );
    
    // Execute dorking campaign
    console.log('\n🚀 Executing dorking campaign...');
    const results = await generator.scrapeDorks(dorks);
    
    // Filter and prioritize URLs
    const relevantUrls = await generator.filterRelevantUrls(results, platforms);
    
    // Deep scrape priority URLs
    if (relevantUrls.length > 0) {
      console.log('\n📊 Starting deep scraping of priority URLs...');
      await generator.scrapeDeep(relevantUrls, platforms);
    }
    
    // Generate summary report
    await generator.generateSummaryReport(
      userInput.business, 
      userInput.services, 
      userInput.audience, 
      platforms, 
      results.length
    );
    
    console.log('\n🎉 Dynamic lead generation campaign completed successfully!');
    console.log('\n📁 Check the following directories for results:');
    console.log('   - raw/: Initial search results');
    console.log('   - deepscrape/: Detailed page content');
    console.log('   - lead_generation_report.md: Campaign summary');
    
  } catch (error) {
    console.error('❌ Error during lead generation:', error);
  } finally {
    await generator.close();
  }
}

// Run the dynamic lead generation
runDynamicLeadGeneration().catch(console.error);
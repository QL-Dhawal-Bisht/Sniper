const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const readline = require('readline');
require('dotenv').config();

const openai = new OpenAI({ apiKey: process.env.OpenAI_API_KEY });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ask = (question) => new Promise(resolve => rl.question(question, resolve));

class SmartLeadGenerator {
  constructor() {
    this.browser = null;
    this.pages = [];
    this.maxTabs = 5;
    this.resultsDir = path.join(__dirname, 'leads');
    this.deepDir = path.join(__dirname, 'detailed_leads');
    this.pageQueue = [];
    this.userInput = null; // Store userInput for access in searchLinkedInProfile
    
    if (!fs.existsSync(this.resultsDir)) fs.mkdirSync(this.resultsDir);
    if (!fs.existsSync(this.deepDir)) fs.mkdirSync(this.deepDir);
  }

  async init() {
    console.log('🚀 Initializing browser...');
    this.browser = await chromium.launchPersistentContext('D:/Projects/chrome-profile-copy', {
      headless: false,
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      ignoreDefaultArgs: ['--enable-automation']
    });

    for (let i = 0; i < this.maxTabs; i++) {
      const page = await this.browser.newPage();
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });
      this.pages.push(page);
      this.pageQueue.push(i);
    }
  }

  getAvailablePage() {
    return this.pageQueue.shift();
  }

  releasePage(pageIndex) {
    this.pageQueue.push(pageIndex);
  }

  async getUserInput() {
    const business = await ask('Business type: ');
    const services = await ask('Services offered: ');
    const audience = await ask('Target audience: ');
    const budget = await ask('Budget range: ');
    const geography = await ask('Geography: ');
    
    rl.close();
    this.userInput = { business, services, audience, budget, geography }; // Store userInput
    return this.userInput;
  }

  async generateSearchStrategy(userInput) {
    const prompt = `You are an expert lead generation strategist. Based on the business requirements, generate a comprehensive search strategy with a balanced distribution across multiple platforms.

Business: ${userInput.business}
Services: ${userInput.services}  
Target Audience: ${userInput.audience}
Budget: ${userInput.budget}
Geography: ${userInput.geography}

Generate a JSON response with:
1. "platforms": Array of 8-10 diverse platforms/websites for finding leads (e.g., "linkedin.com", "crunchbase.com", "clutch.co", "reddit.com", "indiehackers.com", "angel.co", "producthunt.com", "ycombinator.com", "betalist.com", "capterra.com", "g2.com", "quora.com"). Ensure no single platform (e.g., LinkedIn) dominates; include at least 3 non-LinkedIn platforms relevant to the business type and audience.
2. "keywords": Array of 8-10 targeted keywords/phrases tailored to the services and audience.
3. "dorks": Array of 12-15 advanced Google search dorks using the platforms and keywords, with balanced representation across platforms.

Focus on platforms where decision-makers discuss needs or seek services. Avoid GitHub, StackOverflow. Ensure dorks are specific to finding active prospects with buying intent, and distribute them evenly across the selected platforms.

Return only valid JSON.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000,
      temperature: 0.7
    });

    try {
      let raw = response.choices[0].message.content.trim();
      if (raw.startsWith('```')) {
        raw = raw.replace(/```(?:json)?/g, '').trim();
      }
      return JSON.parse(raw);
    } catch (error) {
      console.error('Failed to parse AI response:', error.message);
      console.error('AI raw response:', response.choices[0].message.content);
      throw new Error('Invalid AI response format');
    }
  }

  async processDork(dork, pageIndex) {
    const page = this.pages[pageIndex];
    const results = [];

    try {
      const url = `https://www.google.com/search?q=${encodeURIComponent(dork)}&num=20`;
      await page.goto(url, { timeout: 30000 });
      await page.waitForTimeout(2000);

      const found = await page.evaluate(() => {
        const elements = document.querySelectorAll('div.tF2Cxc, div.g');
        return Array.from(elements).map(el => {
          const titleEl = el.querySelector('h3');
          const linkEl = el.querySelector('a');
          const snippetEl = el.querySelector('.VwiC3b, .IsZvec');
          
          const title = titleEl?.innerText?.trim() || '';
          const url = linkEl?.href || '';
          const snippet = snippetEl?.innerText?.trim() || '';
          
          return title && url && !url.includes('google.com') ? { title, url, snippet } : null;
        }).filter(Boolean);
      });

      results.push(...found);
      await page.waitForTimeout(3000 + Math.random() * 2000);

    } catch (error) {
      console.error(`Error processing dork: ${dork}`, error.message);
    }

    return results;
  }

  async filterRelevantResults(results, userInput, platforms) {
    const prompt = `You are an expert lead qualifier. Filter and score the search results to identify the most promising leads across diverse platforms.

User Requirements:
Business: ${userInput.business}
Services: ${userInput.services}
Target Audience: ${userInput.audience}
Budget: ${userInput.budget}
Geography: ${userInput.geography}

Search Results:
${results.map((r, i) => `${i + 1}. TITLE: ${r.title}\nURL: ${r.url}\nSNIPPET: ${r.snippet}`).join('\n\n')}

For each result, determine:
1. Relevance score (0-10) - How likely is this to contain qualified leads?
2. Lead potential - Does this show buying intent, decision-makers, or business needs?
3. Should deep scrape? (true/false)

Focus on:
- Company pages with contact info potential
- Decision-maker profiles  
- Business discussions showing needs
- Service provider searches
- Funding/growth announcements
- Job postings indicating budget/expansion
- Ensure diversity by prioritizing results from different platforms (e.g., not just LinkedIn)

Return JSON array with objects containing: { "index": number, "score": number, "reason": "string", "deepScrape": boolean }

Only include results with score >= 6. Return only valid JSON.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1500,
      temperature: 0.3
    });

    try {
      let raw = response.choices[0].message.content.trim();
      if (raw.startsWith('```')) {
        raw = raw.replace(/```(?:json)?/g, '').trim();
      }
      const filtered = JSON.parse(raw);
      return filtered.filter(item => item.score >= 6 && item.deepScrape);
    } catch (error) {
      console.error('Failed to parse filter response:', error.message);
      console.error('AI raw response:', response.choices[0].message.content);
      return [];
    }
  }

  async searchLinkedInProfile(name, company, role, pageIndex) {
    const page = this.pages[pageIndex];
    const linkedinUrls = [];

    try {
      // Step 1: Generate targeted search queries using LLM
      const queryPrompt = `You are an expert in generating search queries for LinkedIn profiles. Based on the provided information, generate 2-3 precise Google search queries to find the correct LinkedIn profile.

Person Name: ${name}
Company: ${company || 'N/A'}
Role: ${role || 'N/A'}
Geography: ${this.userInput?.geography || 'N/A'}
Business Context: ${this.userInput?.business || 'N/A'}, targeting ${this.userInput?.audience || 'N/A'}

Generate queries that:
- Use site:linkedin.com/in/ to target individual LinkedIn profiles
- Handle variations of the name (e.g., full name, initials, common misspellings)
- Incorporate company name or aliases if available
- Include role or synonyms (e.g., "CEO" or "Chief Executive")
- Add geography if relevant
- Exclude login pages, company pages (linkedin.com/company/), or irrelevant results

Return a JSON array of 2-3 query strings. Example:
["site:linkedin.com/in/ \"John Doe\" \"Acme Corp\" CEO", "site:linkedin.com/in/ \"J. Doe\" \"Acme Corporation\" \"Chief Executive\""]

Return only valid JSON.`;

      const queryResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: queryPrompt }],
        max_tokens: 150,
        temperature: 0.5
      });

      let queries;
      try {
        let raw = queryResponse.choices[0].message.content.trim();
        if (raw.startsWith('```')) {
          raw = raw.replace(/```(?:json)?/g, '').trim();
        }
        queries = JSON.parse(raw);
      } catch (error) {
        console.error('Failed to parse query response:', error.message);
        queries = [`site:linkedin.com/in/ "${name}" ${company ? `"${company}"` : ''} ${role || ''}`.trim()];
      }

      console.log(`🔍 Searching LinkedIn profile for ${name} with queries: ${queries.join('; ')}`);

      // Step 2: Scrape Google search results for each query
      const searchResults = [];
      for (const query of queries) {
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`;
        await page.goto(url, { timeout: 30000 });
        await page.waitForTimeout(2000);

        const results = await page.evaluate(() => {
          const elements = document.querySelectorAll('div.tF2Cxc, div.g');
          return Array.from(elements).map(el => {
            const titleEl = el.querySelector('h3');
            const linkEl = el.querySelector('a');
            const snippetEl = el.querySelector('.VwiC3b, .IsZvec');
            
            const title = titleEl?.innerText?.trim() || '';
            const url = linkEl?.href || '';
            const snippet = snippetEl?.innerText?.trim() || '';
            
            return url.includes('linkedin.com/in/') ? { title, url, snippet } : null;
          }).filter(Boolean);
        });

        searchResults.push(...results);
        await page.waitForTimeout(2000 + Math.random() * 1000);
      }

      // Remove duplicates by URL
      const uniqueResults = Array.from(new Map(searchResults.map(item => [item.url, item])).values());

      // Step 3: Filter results using LLM
      const filterPrompt = `You are an expert in identifying relevant LinkedIn profiles. Given a list of Google search results, select the most relevant LinkedIn profile URLs for the specified person.

Person Name: ${name}
Company: ${company || 'N/A'}
Role: ${role || 'N/A'}
Geography: ${this.userInput?.geography || 'N/A'}
Business Context: ${this.userInput?.business || 'N/A'}, targeting ${this.userInput?.audience || 'N/A'}

Search Results:
${uniqueResults.map((r, i) => `${i + 1}. TITLE: ${r.title}\nURL: ${r.url}\nSNIPPET: ${r.snippet}`).join('\n\n')}

For each result, determine:
- Relevance score (0-10): How likely is this the correct LinkedIn profile for the person?
- Reason: Brief explanation of the score

Focus on:
- Matching name (allowing for variations or initials)
- Matching company or industry
- Matching role or similar titles
- Geographic relevance if applicable
- Exclude company pages (linkedin.com/company/), login pages, or irrelevant profiles

Return a JSON array of objects with: { "url": string, "score": number, "reason": string }
Include only results with score >= 7. If no results meet this threshold, return an empty array.
Return only valid JSON.`;

      const filterResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: filterPrompt }],
        max_tokens: 500,
        temperature: 0.3
      });

      let filteredResults;
      try {
        let raw = filterResponse.choices[0].message.content.trim();
        if (raw.startsWith('```')) {
          raw = raw.replace(/```(?:json)?/g, '').trim();
        }
        filteredResults = JSON.parse(raw);
      } catch (error) {
        console.error('Failed to parse filter response:', error.message);
        console.error('AI raw response:', filterResponse.choices[0].message.content);
        return [];
      }

      // Sort by score and take top results (up to 2)
      const topResults = filteredResults
        .filter(result => result.score >= 7)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2)
        .map(result => result.url);

      console.log(`✅ Found ${topResults.length} relevant LinkedIn profiles for ${name}`);

      return topResults;
    } catch (error) {
      console.error(`Error searching LinkedIn profile for ${name}:`, error.message);
      return [];
    }
  }

  async deepScrape(url, pageIndex) {
    const page = this.pages[pageIndex];
    
    try {
      await page.goto(url, { timeout: 30000 });
      await page.waitForTimeout(2000);
      
      const scrapedData = await page.evaluate(() => {
        document.querySelectorAll('script, style, nav, footer, header, .ads, .cookie-banner').forEach(el => el.remove());
        
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const emails = [...new Set(document.body.innerText.match(emailRegex) || [])];
        
        const phoneRegex = /(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g;
        const phones = [...new Set(document.body.innerText.match(phoneRegex) || [])];
        
        const linkedinRegex = /https?:\/\/(?:www\.)?linkedin\.com\/(?:in|company)\/[a-zA-Z0-9-]+/g;
        const linkedinUrls = [...new Set(document.body.innerHTML.match(linkedinRegex) || [])];
        
        const websiteRegex = /https?:\/\/(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?/g;
        const websites = [...new Set(document.body.innerHTML.match(websiteRegex) || [])]
          .filter(url => !url.includes('linkedin.com') && !url.includes('facebook.com') && !url.includes('twitter.com'));
        
        let platformData = {};
        const hostname = window.location.hostname;
        
        if (hostname.includes('linkedin.com')) {
          platformData = {
            type: 'linkedin',
            companyName: document.querySelector('h1')?.innerText?.trim() || '',
            followers: document.querySelector('.org-top-card-summary__follower-count')?.innerText?.trim() || '',
            industry: document.querySelector('.org-top-card-summary__industry')?.innerText?.trim() || '',
            description: document.querySelector('.org-about-company-module__description')?.innerText?.trim() || ''
          };
        } else if (hostname.includes('crunchbase.com')) {
          platformData = {
            type: 'crunchbase',
            companyName: document.querySelector('h1')?.innerText?.trim() || '',
            funding: document.querySelector('[data-testid="funding-rounds"]')?.innerText?.trim() || '',
            employees: document.querySelector('[data-testid="employees"]')?.innerText?.trim() || ''
          };
        } else if (hostname.includes('clutch.co')) {
          platformData = {
            type: 'clutch',
            companyName: document.querySelector('.company_name')?.innerText?.trim() || '',
            rating: document.querySelector('.rating')?.innerText?.trim() || '',
            reviews: document.querySelector('.reviews-count')?.innerText?.trim() || '',
            description: document.querySelector('.company_description')?.innerText?.trim() || ''
          };
        } else if (hostname.includes('g2.com')) {
          platformData = {
            type: 'g2',
            companyName: document.querySelector('.company-name')?.innerText?.trim() || '',
            rating: document.querySelector('.rating-score')?.innerText?.trim() || '',
            category: document.querySelector('.category')?.innerText?.trim() || ''
          };
        } else if (hostname.includes('reddit.com')) {
          platformData = {
            type: 'reddit',
            title: document.querySelector('h1')?.innerText?.trim() || '',
            subreddit: document.querySelector('.subreddit-name')?.innerText?.trim() || '',
            author: document.querySelector('.author')?.innerText?.trim() || ''
          };
        }
        
        const contentSelectors = [
          'main', 'article', '.content', '.post', '.profile',
          '.company-description', '.about', '.bio', '.description'
        ];
        
        let mainContent = '';
        for (const selector of contentSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            mainContent = element.innerText.trim();
            break;
          }
        }
        
        if (!mainContent) {
          mainContent = document.body.innerText.trim();
        }
        
        const peopleRegex = /(?:CEO|CTO|Founder|Director|Manager|VP|President|Owner|Contact|Head of)\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/gi;
        const people = [...new Set(mainContent.match(peopleRegex) || [])];
        
        return {
          content: mainContent.substring(0, 5000),
          emails,
          phones,
          linkedinUrls,
          websites: websites.slice(0, 5),
          people,
          platformData,
          title: document.title,
          meta: {
            description: document.querySelector('meta[name="description"]')?.content || '',
            keywords: document.querySelector('meta[name="keywords"]')?.content || ''
          }
        };
      });

      return scrapedData;
    } catch (error) {
      console.error(`Failed to scrape ${url}:`, error.message);
      return null;
    }
  }

  async extractLeadInfo(scrapedData, url, userInput, pageIndex) {
    if (!scrapedData) return null;

    const cleanEmails = scrapedData.emails.filter(email =>
      email.includes('@') && !email.includes('example.com') && !email.includes('test.com')
    );

    const cleanPhones = scrapedData.phones.filter(phone =>
      phone.replace(/\D/g, '').length >= 10
    );

    // Trigger LinkedIn profile search if minimal contact info is found
    let additionalLinkedInUrls = [];
    if (cleanEmails.length === 0 && cleanPhones.length === 0 && scrapedData.people.length > 0) {
      console.log(`🔍 No contact info found for ${url}. Searching LinkedIn profiles...`);
      for (const person of scrapedData.people) {
        const nameMatch = person.match(/([A-Z][a-z]+\s+[A-Z][a-z]+)/);
        if (nameMatch) {
          const name = nameMatch[0];
          const role = person.replace(name, '').trim();
          const company = scrapedData.platformData.companyName || scrapedData.title.split(' ')[0];
          const linkedinUrls = await this.searchLinkedInProfile(name, company, role, pageIndex);
          additionalLinkedInUrls.push(...linkedinUrls);
        }
      }
      scrapedData.linkedinUrls.push(...additionalLinkedInUrls);
    }

    const prompt = `Extract and enhance lead information from this scraped data. BE GENEROUS - extract leads even with minimal information.

SCRAPED DATA:
Content: ${scrapedData.content}
Title: ${scrapedData.title}
Meta Description: ${scrapedData.meta.description}
Platform: ${scrapedData.platformData.type || 'website'}
Found Emails: ${cleanEmails.join(', ')}
Found Phones: ${cleanPhones.join(', ')}
Found LinkedIn: ${scrapedData.linkedinUrls.join(', ')}
Found Websites: ${scrapedData.websites.join(', ')}
People Mentioned: ${scrapedData.people.join(', ')}

URL: ${url}
Looking for: ${userInput.audience} who need ${userInput.services}
Business Type: ${userInput.business}

IMPORTANT: Extract leads even if contact info is minimal. We can follow up later to find more details.

Extract and return JSON with:
{
  "company": "Company name (even if just from URL or title)",
  "contact_info": {
    "emails": ${JSON.stringify(cleanEmails)},
    "phones": ${JSON.stringify(cleanPhones)},
    "website": "main website url (even if just the scraped URL)",
    "linkedin": "company/person linkedin url",
    "social": ["other social media urls"]
  },
  "key_people": [
    {
      "name": "Person name (even if just from title or LinkedIn)",
      "title": "Job title (infer from context if needed)", 
      "email": "email if available",
      "linkedin": "linkedin url if available"
    }
  ],
  "business_info": {
    "industry": "Industry (infer from context)",
    "size": "Company size (estimate if needed)",
    "location": "Location (from content or ${userInput.geography})",
    "funding": "Funding status if available",
    "stage": "startup/growth/enterprise (estimate)"
  },
  "pain_points": ["inferred pain point based on industry/content"],
  "buying_signals": ["potential signals even if weak"],
  "lead_score": "Rate 1-10 (be generous, minimum 4 for any valid company)",
  "pitch_angle": "Tailored pitch suggestion"
}

ALWAYS return a lead if you can identify ANY company name, person name, or business context. 
If information is missing, make reasonable assumptions based on industry standards.
Return null only if absolutely no business context can be found.
Return only valid JSON.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1200,
      temperature: 0.2
    });

    try {
      let raw = response.choices[0].message.content.trim();
      if (raw.startsWith('```')) {
        raw = raw.replace(/```(?:json)?/g, '').trim();
      }

      const leadInfo = JSON.parse(raw);

      if (leadInfo && (leadInfo.company || (leadInfo.key_people && leadInfo.key_people.length > 0))) {
        leadInfo.raw_data = {
          platform: scrapedData.platformData.type || 'website',
          title: scrapedData.title,
          meta: scrapedData.meta,
          all_emails: cleanEmails,
          all_phones: cleanPhones,
          all_linkedin: scrapedData.linkedinUrls,
          all_websites: scrapedData.websites,
          scraped_at: new Date().toISOString()
        };
        return leadInfo;
      }
      
      return null;
    } catch (error) {
      console.error('Failed to parse lead info:', error.message);
      console.error('AI raw response:', response.choices[0].message.content);
      return null;
    }
  }

  async processAllDorks(dorks) {
    console.log(`\n🔍 Processing ${dorks.length} search queries in parallel...`);
    
    const dorkPromises = dorks.map(async (dork, index) => {
      while (this.pageQueue.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const pageIndex = this.getAvailablePage();
      console.log(`🔍 Processing query ${index + 1}/${dorks.length} on tab ${pageIndex + 1}: ${dork}`);
      
      try {
        const results = await this.processDork(dork, pageIndex);
        console.log(`✅ Query ${index + 1} completed: ${results.length} results`);
        return results;
      } finally {
        this.releasePage(pageIndex);
      }
    });

    const allResultsArrays = await Promise.all(dorkPromises);
    const allResults = allResultsArrays.flat();
    
    console.log(`\n📊 Total results collected: ${allResults.length}`);
    return allResults;
  }

  async processDeepScraping(relevantResults, allResults, userInput) {
    console.log('\n📄 Deep scraping and extracting lead information in parallel...');
    
    const scrapingPromises = relevantResults.map(async (result, index) => {
      while (this.pageQueue.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const pageIndex = this.getAvailablePage();
      const originalResult = allResults[result.index];
      
      console.log(`📄 Scraping ${index + 1}/${relevantResults.length} on tab ${pageIndex + 1}: ${originalResult.url}`);
      
      try {
        const scrapedData = await this.deepScrape(originalResult.url, pageIndex);
        if (scrapedData) {
          const leadInfo = await this.extractLeadInfo(scrapedData, originalResult.url, userInput, pageIndex);
          if (leadInfo) {
            const leadFileName = `lead_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${leadInfo.company?.replace(/[^a-zA-Z0-9]/g, '_') || 'unknown'}.json`;
            fs.writeFileSync(
              path.join(this.deepDir, leadFileName),
              JSON.stringify({
                source: originalResult,
                leadInfo,
                scrapedData,
                score: result.score,
                reason: result.reason
              }, null, 2)
            );
            
            console.log(`✅ Lead extracted: ${leadInfo.company || 'Unknown Company'}`);
            
            return {
              source: originalResult,
              leadInfo,
              score: result.score,
              reason: result.reason
            };
          } else {
            console.log(`⚠️ No lead info extracted from: ${originalResult.url}`);
          }
        } else {
          console.log(`⚠️ No scraped data from: ${originalResult.url}`);
        }
        return null;
      } catch (error) {
        console.error(`❌ Error scraping ${originalResult.url}:`, error.message);
        return null;
      } finally {
        this.releasePage(pageIndex);
      }
    });

    const results = await Promise.all(scrapingPromises);
    const validLeads = results.filter(Boolean);
    
    console.log(`\n📊 Deep scraping completed:`);
    console.log(`- Total URLs scraped: ${relevantResults.length}`);
    console.log(`- Successful extractions: ${validLeads.length}`);
    console.log(`- Success rate: ${((validLeads.length / relevantResults.length) * 100).toFixed(1)}%`);
    
    return validLeads;
  }

  async processLeads(dorks, userInput, platforms) {
    const allResults = await this.processAllDorks(dorks);
    
    console.log('\n🎯 Filtering relevant results...');
    let relevantResults = await this.filterRelevantResults(allResults, userInput, platforms);
    console.log(`Selected ${relevantResults.length} high-quality results for deep scraping`);

    if (relevantResults.length < 20) {
      console.log('\n🔄 Adding fallback results to increase lead volume...');
      
      const usedIndices = new Set(relevantResults.map(r => r.index));
      const remainingResults = allResults
        .map((result, index) => ({ result, index }))
        .filter(({ index }) => !usedIndices.has(index))
        .filter(({ result }) => {
          const url = result.url.toLowerCase();
          const title = result.title.toLowerCase();
          return (
            platforms.some(platform => url.includes(platform)) &&
            (
              title.includes('ceo') ||
              title.includes('founder') ||
              title.includes('director') ||
              title.includes('manager') ||
              title.includes('company') ||
              title.includes('startup') ||
              title.includes('business') ||
              title.includes('review') ||
              title.includes('profile')
            )
          );
        })
        .slice(0, 30)
        .map(({ index }) => ({
          index,
          score: 4,
          reason: 'Fallback selection - potential company/profile page detected',
          deepScrape: true
        }));
      
      relevantResults.push(...remainingResults);
      console.log(`Added ${remainingResults.length} fallback results. Total: ${relevantResults.length}`);
    }

    const qualifiedLeads = await this.processDeepScraping(relevantResults, allResults, userInput);
    return qualifiedLeads;
  }

  async generateReport(leads, userInput, strategy) {
    const report = {
      campaign: {
        business: userInput.business,
        services: userInput.services,
        audience: userInput.audience,
        timestamp: new Date().toISOString()
      },
      strategy: {
        platforms: strategy.platforms,
        keywords: strategy.keywords,
        dorks_used: strategy.dorks.length
      },
      results: {
        total_leads: leads.length,
        leads: leads
      }
    };

    fs.writeFileSync(
      path.join(this.resultsDir, 'lead_generation_report.json'),
      JSON.stringify(report, null, 2)
    );

    const csvRows = leads.map(lead => ({
      Company: lead.leadInfo.company || 'N/A',
      Email: lead.leadInfo.contact_info?.emails?.[0] || 'N/A',
      Phone: lead.leadInfo.contact_info?.phones?.[0] || 'N/A',
      Website: lead.leadInfo.contact_info?.website || 'N/A',
      Key_Person: lead.leadInfo.key_people?.[0]?.name || 'N/A',
      Title: lead.leadInfo.key_people?.[0]?.title || 'N/A',
      Industry: lead.leadInfo.business_info?.industry || 'N/A',
      Location: lead.leadInfo.business_info?.location || 'N/A',
      Pain_Points: lead.leadInfo.pain_points?.join('; ') || 'N/A',
      Pitch_Angle: lead.leadInfo.pitch_angle || 'N/A',
      Source_URL: lead.source.url,
      Score: lead.score
    }));

    const csvContent = [
      Object.keys(csvRows[0]).join(','),
      ...csvRows.map(row => Object.values(row).map(v => `"${v}"`).join(','))
    ].join('\n');

    fs.writeFileSync(path.join(this.resultsDir, 'leads.csv'), csvContent);
    
    console.log('\n📋 Reports generated:');
    console.log('- lead_generation_report.json: Detailed JSON report');
    console.log('- leads.csv: CSV for easy import');
    console.log(`\n🎯 Found ${leads.length} qualified leads`);
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

async function main() {
  const generator = new SmartLeadGenerator();
  
  try {
    await generator.init();
    
    const userInput = await generator.getUserInput();
    console.log('\n🎯 Generating smart search strategy...');
    
    const strategy = await generator.generateSearchStrategy(userInput);
    console.log(`\n📊 Strategy generated:`);
    console.log(`- Platforms: ${strategy.platforms.join(', ')}`);
    console.log(`- Keywords: ${strategy.keywords.join(', ')}`);
    console.log(`- Search queries: ${strategy.dorks.length}`);
    
    const leads = await generator.processLeads(strategy.dorks, userInput, strategy.platforms);
    
    if (leads.length > 0) {
      await generator.generateReport(leads, userInput, strategy);
    } else {
      console.log('\n❌ No qualified leads found. Try adjusting your search criteria.');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await generator.close();
  }
}

main().catch(console.error);
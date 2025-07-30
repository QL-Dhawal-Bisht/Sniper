const express = require('express');
const { SmartLeadGenerator } = require('./dev');
const { OpenAI } = require('openai');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = 8000;

app.use(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function parseUserPrompt(prompt) {
  const parsePrompt = `You are an expert at parsing user input for lead generation. Parse the following user prompt into structured fields: Business Type, Services Offered, Target Audience, Budget Range, Geography, and specific platforms if mentioned.

Prompt: "${prompt}"

Return a JSON object with the following structure:
{
  "business": "string",
  "services": "string",
  "audience": "string",
  "budget": "string",
  "geography": "string",
  "platforms": ["platform1.com", "platform2.com"]
}

If the user mentions specific websites or platforms (e.g., "only from LinkedIn", "focus on Clutch and G2"), extract their domain names into the "platforms" array. If no platforms are specified, return an empty array.
If any other field cannot be determined, use a reasonable default or leave it as an empty string. Ensure the response is valid JSON.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: parsePrompt }],
      max_tokens: 300,
      temperature: 0.5
    });

    let raw = response.choices[0].message.content.trim();
    if (raw.startsWith('```')) {
      raw = raw.replace(/```(?:json)?/g, '').trim();
    }
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to parse prompt:', error.message);
    return {
      business: '',
      services: prompt,
      audience: '',
      budget: '',
      geography: '',
      platforms: []
    };
  }
}

app.post('/generate-leads-stream', async (req, res) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const generator = new SmartLeadGenerator();

  try {
    const parsedInput = await parseUserPrompt(prompt);
    sendEvent({ type: 'progress', progress: { current: 0, total: 0 }, leads_count: 0 });

    await generator.init();

    const strategy = await generator.generateSearchStrategy(parsedInput);
    const totalDorks = strategy.dorks.length;

    sendEvent({ type: 'progress', progress: { current: 0, total: totalDorks }, leads_count: 0 });

    const leads = await generator.processLeads(strategy.dorks, parsedInput, strategy.platforms, (total, current, leadsCount) => {
      sendEvent({ type: 'progress', progress: { current, total }, leads_count: leadsCount });
    });

    leads.forEach((lead) => {
      sendEvent({
        type: 'leads',
        leads: [{
          name: lead.leadInfo.company || 'N/A',
          website: lead.leadInfo.contact_info?.website || '',
          email: lead.leadInfo.contact_info?.emails?.[0] || '',
          phone: lead.leadInfo.contact_info?.phones?.[0] || '',
          location: lead.leadInfo.business_info?.location || '',
          services: lead.leadInfo.business_info?.industry || '',
          category: lead.leadInfo.business_info?.industry || '',
          priority: lead.score >= 8 ? 'HIGH' : lead.score >= 6 ? 'MEDIUM' : 'LOW'
        }]
      });
    });

    await generator.generateReport(leads, parsedInput, strategy);

    sendEvent({
      type: 'complete',
      total_leads: leads.length
    });

  } catch (error) {
    console.error('Error in lead generation:', error.message);
    sendEvent({ type: 'error', message: error.message });
  } finally {
    await generator.close();
    res.end();
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
# Project Name: QL-Sales

## Overview

This project is a sophisticated lead generation tool designed to automate the process of finding and qualifying potential business leads. It leverages web scraping with Playwright and natural language processing with OpenAI's GPT models to identify, analyze, and score leads from various online platforms.

## Features

- **Automated Lead Discovery:** Utilizes Google dorking and targeted platform searches to find potential leads.
- **Intelligent Scraping:** Employs Playwright to scrape websites for contact information, company details, and other relevant data.
- **AI-Powered Qualification:** Uses OpenAI's GPT models to analyze scraped data, qualify leads, and generate tailored pitch angles.
- **Web Interface:** Provides a simple web interface to initiate the lead generation process.
- **Comprehensive Reporting:** Generates detailed reports in both JSON and CSV formats.

## Project Structure

- `main.js`: Contains the core `SmartLeadGenerator` class, which handles browser automation, scraping, and interaction with the OpenAI API.
- `server.js`: An Express.js server that provides an API endpoint (`/generate-leads-stream`) to trigger the lead generation process.
- `clean.js`: A utility script for cleaning up generated lead files.
- `data_preprocessing/`: Contains scripts and data related to NLP and data cleaning.
- `detailed_leads/`: The directory where detailed JSON files for each scraped lead are stored.
- `leads/`: The directory where the final lead reports (JSON and CSV) are saved.

## Prerequisites

- Node.js and npm
- Python (for data preprocessing scripts)
- A modern web browser (e.g., Google Chrome)

## Setup

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd ql-sales
   ```

2. **Install Node.js dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   - Create a `.env` file in the root of the project.
   - Add your OpenAI API key to the `.env` file:
     ```
     OPENAI_API_KEY=your_openai_api_key
     ```

## Usage

1. **Start the server:**
   ```bash
   npm start
   ```
   This will start the Express server, which listens for lead generation requests.

2. **Initiate Lead Generation:**
   - The lead generation process is triggered by sending a POST request to the `/generate-leads-stream` endpoint with a JSON payload containing a "prompt".
   - The prompt should describe the type of leads you are looking for. For example:
     ```json
     {
       "prompt": "Find me software development agencies in California that work with startups."
     }
     ```

3. **View the Results:**
   - The generated leads will be saved in the `leads/` and `detailed_leads/` directories.
   - `leads/leads.csv`: A CSV file containing a summary of the qualified leads.
   - `leads/lead_generation_report.json`: A detailed JSON report of the entire campaign.
   - `detailed_leads/`: Contains individual JSON files for each scraped lead with extensive details.

## How It Works

1. **Prompt Parsing:** The user's prompt is parsed by an AI model to understand the lead generation requirements (e.g., target industry, location, services).
2. **Strategy Generation:** Based on the parsed prompt, an AI model generates a search strategy, including a list of platforms to search and a set of Google dorks.
3. **Web Scraping:** The tool uses Playwright to execute the search queries and scrape the results. It runs multiple browser tabs in parallel to speed up the process.
4. **Lead Qualification:** The scraped data is fed to an AI model, which filters and scores the results to identify the most promising leads.
5. **Deep Scraping:** High-potential leads are further scraped to extract detailed information, such as contact details, company size, and key people.
6. **Reporting:** The final list of qualified leads is compiled into a comprehensive report.

## Customization

- **Search Strategy:** The `generateSearchStrategy` function in `main.js` can be modified to customize the AI-powered search strategy generation.
- **Scraping Logic:** The scraping and data extraction logic in the `deepScrape` and `extractLeadInfo` functions can be adapted to target different types of websites or extract additional data points.
- **API Endpoint:** The Express server in `server.js` can be extended with additional endpoints or integrated with other systems.

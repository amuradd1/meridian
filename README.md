# Daily Geopolitical & Energy Procurement Intelligence Brief

A real-time geopolitical risk and energy market intelligence dashboard built for the Chief Procurement Officer of a global tobacco company.

## Features

- **Executive Summary** — 5 bullet-point intelligence brief updated every 24 hours
- **Energy Markets** — Live commodity prices (Brent, WTI, TTF, Henry Hub, JKM, BDRY shipping index) with sparkline charts
- **Geopolitical Risk Monitor** — Top stories filtered for procurement impact
- **Global Supply Chain Map** — D3.js world map with supplier origins, shipping routes, and chokepoint status
- **Chokepoint Status** — Real-time Strait of Hormuz, Bab el-Mandeb, Suez Canal, Malacca Strait monitoring
- **Procurement Category Matrix** — Color-coded risk assessment for 7 tobacco procurement categories with suggested mitigations
- **Conflict Timeline** — 7-day escalation timeline with severity indicators
- **PDF Export** — One-click export of the full brief

## Procurement Categories

1. Cellulose Acetate Filter Tow
2. Cigarette Packaging (Board & Print)
3. Flexible Packaging & Foils
4. Flavors & Ingredients
5. Heated Tobacco Devices & Consumables
6. E-Cigarettes & Vape Devices
7. Nicotine Pouches

## Architecture

```
start.py          → Orchestrator: starts server + schedules 24h data refresh
├── server.py     → FastAPI: serves /api/intelligence + static files
├── generate_data.py → Data pipeline: Yahoo Finance + Google News RSS → Claude → data.json
└── static/       → Frontend (HTML/CSS/JS + D3.js map)
```

## Deploy to Railway

### 1. Prerequisites

- A [Railway](https://railway.com) account
- An [Anthropic API key](https://console.anthropic.com/)

### 2. Deploy from GitHub

1. Push this repository to GitHub
2. Go to [Railway Dashboard](https://railway.com/dashboard) → **New Project** → **Deploy from GitHub**
3. Select this repository
4. Railway will auto-detect the Dockerfile and deploy

### 3. Set Environment Variables

In your Railway service settings, add:

| Variable | Value | Required |
|----------|-------|----------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key | Yes |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` (default) | No |

### 4. Generate a Domain

Go to **Settings** → **Networking** → **Generate Domain** to get a public URL.

## Deploy via Railway CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Set environment variables
railway variables set ANTHROPIC_API_KEY=sk-ant-...

# Deploy
railway up
```

## Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Set your Anthropic API key
export ANTHROPIC_API_KEY=sk-ant-...

# Run
python start.py
```

The dashboard will be available at `http://localhost:8000`.

## Data Flow

1. **On startup**: `generate_data.py` runs in a background thread
2. **Every 24 hours**: APScheduler triggers a fresh data generation
3. **Data sources**:
   - Yahoo Finance API — commodity prices (Brent, WTI, TTF, Henry Hub, BDRY shipping index + JKM estimate)
   - Google News RSS — geopolitical and tobacco industry headlines
   - Claude API — synthesizes raw data into structured intelligence brief
4. **Output**: `data.json` (~23KB) served at `/api/intelligence`

## Cost Notes

- Each data refresh makes one Claude API call (~8K output tokens)
- At 1 refresh/day, expect ~$0.25–$0.50/day in Anthropic API costs
- Railway free tier includes 500 hours/month of compute

---

Created with [Perplexity Computer](https://www.perplexity.ai/computer)

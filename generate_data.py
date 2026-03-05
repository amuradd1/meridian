#!/usr/bin/env python3
"""
generate_data.py — Standalone data generator.
Run this to fetch data + call LLM + save to data.json.
The server reads from data.json.
"""
import json
import asyncio
import os
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta

import httpx
from anthropic import Anthropic

YAHOO_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}


async def fetch_yahoo(http, symbol, name, unit):
    try:
        r = await http.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=1mo&interval=1d",
            headers=YAHOO_HEADERS
        )
        if r.status_code != 200:
            return None
        data = r.json()
        result = data["chart"]["result"][0]
        meta = result["meta"]
        closes = [c for c in result["indicators"]["quote"][0].get("close", []) if c is not None]
        if not closes:
            return None
        current = float(meta.get("regularMarketPrice", closes[-1]))
        prev = closes[-2] if len(closes) > 1 else current
        chart_prev = meta.get("chartPreviousClose")
        if chart_prev and abs((current - float(chart_prev)) / float(chart_prev)) < 0.15:
            prev = float(chart_prev)
        week_ago = closes[-6] if len(closes) > 5 else closes[0]
        return {
            "name": name, "price": round(current, 2), "unit": unit,
            "change_24h": round(((current - prev) / prev) * 100, 2),
            "change_7d": round(((current - float(week_ago)) / float(week_ago)) * 100, 2),
            "history": [round(float(c), 2) for c in closes],
            "driver": ""
        }
    except Exception as e:
        print(f"  Yahoo {symbol} error: {e}")
        return None


async def fetch_commodities():
    symbols = [
        ("BZ=F", "Brent Crude", "$/bbl"),
        ("CL=F", "WTI Crude", "$/bbl"),
        ("TTF=F", "LNG Europe (TTF)", "EUR/MWh"),
        ("NG=F", "Henry Hub Nat Gas", "$/MMBtu"),
        ("BDRY", "Dry Bulk Shipping (BDRY)", "Index"),
    ]
    async with httpx.AsyncClient(timeout=15) as http:
        tasks = [fetch_yahoo(http, s, n, u) for s, n, u in symbols]
        results = await asyncio.gather(*tasks)
    commodities = [r for r in results if r]
    ttf = next((c for c in commodities if "TTF" in c["name"]), None)
    if ttf:
        jkm = dict(ttf)
        jkm["name"] = "LNG Asia (JKM Est.)"
        jkm["unit"] = "$/MMBtu"
        jkm["price"] = round(ttf["price"] * 1.15, 2)
        jkm["history"] = [round(p * 1.15, 2) for p in ttf["history"]]
        commodities.append(jkm)
    return commodities


async def fetch_news():
    articles = []
    queries = ["oil+price+Iran+conflict", "LNG+shipping+disruption", "Red+Sea+Suez+shipping", "energy+supply+chain+geopolitical", "tobacco+industry+regulation+excise"]
    async with httpx.AsyncClient(timeout=15) as http:
        for q in queries:
            try:
                r = await http.get(f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en", headers=YAHOO_HEADERS)
                if r.status_code == 200:
                    root = ET.fromstring(r.text)
                    for item in root.findall(".//item")[:4]:
                        articles.append({
                            "title": item.findtext("title", ""),
                            "source": item.findtext("source", "Unknown"),
                            "url": item.findtext("link", ""),
                            "published": item.findtext("pubDate", ""),
                        })
            except Exception as e:
                print(f"  News error: {e}")
    seen = set()
    return [a for a in articles if a["title"][:50] not in seen and not seen.add(a["title"][:50])][:15]


def call_llm(commodities, news):
    client = Anthropic(timeout=300.0)
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    trimmed_c = [{"name": c["name"], "price": c["price"], "unit": c["unit"], "change_24h": c["change_24h"], "change_7d": c["change_7d"]} for c in commodities]
    trimmed_n = [{"title": n["title"], "source": n["source"], "url": n.get("url", "")} for n in news[:8]]

    prompt = f"""You are a senior geopolitical and energy risk analyst producing a daily intelligence 
brief for the Chief Procurement Officer (CPO) of a global tobacco company (cigarettes, heated 
tobacco, e-cigarettes/vapes, nicotine pouches, cigars). Today's date is {today}.

This brief is for the CPO's information only. Do NOT include directives or tell the CPO what to do.
Category teams handle operational actions. The CPO needs situational awareness of:
- Energy-driven COGS pressure (acetate production, converting, logistics)
- Supply route disruptions affecting inbound material flows
- Supplier risk and force majeure exposure
- Market conditions affecting forward pricing
- Shipping cost movements and container/bulk freight rate trends

COMMODITY PRICES (live):
{json.dumps(trimmed_c, indent=2)}

NEWS HEADLINES (last 24-48 hours):
{json.dumps(trimmed_n, indent=2)}

Produce ONLY valid JSON (no markdown fences):
{{
  "executive_summary": [
    "The single biggest threat right now — use exact commodity prices and % moves. 1-2 sentences.",
    "Energy cost impact on key input materials (acetate tow, packaging, NGP components). 1-2 sentences.",
    "Shipping and supply route disruption status, including freight rate movement. 1-2 sentences.",
    "Supplier force majeure or cost-escalation risk. 1-2 sentences.",
    "Net margin/COGS outlook for the next 4-8 weeks. 1-2 sentences."
  ],
  "overall_risk": "HIGH or MEDIUM or LOW",
  "commodity_drivers": "2-3 sentences explaining energy price moves AND shipping cost trends and their specific impact on tobacco procurement costs: cellulose acetate tow (acetic acid from methanol/gas), BOPP/foil converting energy, ocean freight surcharges, and dry bulk shipping rates.",
  "analyst_outlook": "2-3 sentences. What the CPO should be aware of for board/CFO briefings. Include commodity price trajectory, freight rate outlook, and expected supplier cost-escalation request timelines.",
  "procurement_categories": [
    {{"name": "Cellulose Acetate Filter Tow", "energy_sensitivity": "H/M/L", "supply_route_exposure": "1 sentence", "risk": "H/M/L", "rationale": "1-2 sentences on acetic acid feedstock, energy-intensive production", "suggested_mitigation": "1 sentence describing a general risk mitigation approach (e.g. diversification, forward hedging, safety stock) — do NOT name specific countries or suppliers"}},
    {{"name": "Cigarette Packaging (Board & Print)", "energy_sensitivity": "H/M/L", "supply_route_exposure": "1 sentence", "risk": "H/M/L", "rationale": "1-2 sentences", "suggested_mitigation": "1 sentence general mitigation approach"}},
    {{"name": "Flexible Packaging & Foils", "energy_sensitivity": "H/M/L", "supply_route_exposure": "1 sentence on BOPP, aluminium foil, metallised film supply", "risk": "H/M/L", "rationale": "1-2 sentences", "suggested_mitigation": "1 sentence general mitigation approach"}},
    {{"name": "Flavors & Ingredients", "energy_sensitivity": "H/M/L", "supply_route_exposure": "1 sentence on menthol, glycerin, propylene glycol, nicotine extract origins and routes", "risk": "H/M/L", "rationale": "1-2 sentences", "suggested_mitigation": "1 sentence general mitigation approach"}},
    {{"name": "Heated Tobacco Devices & Consumables", "energy_sensitivity": "H/M/L", "supply_route_exposure": "1 sentence on device assembly in China/SEA and component sourcing", "risk": "H/M/L", "rationale": "1-2 sentences", "suggested_mitigation": "1 sentence general mitigation approach"}},
    {{"name": "E-Cigarettes & Vape Devices", "energy_sensitivity": "H/M/L", "supply_route_exposure": "1 sentence on Shenzhen-centric production, batteries, PCBA", "risk": "H/M/L", "rationale": "1-2 sentences combining battery, plastics, shipping risks", "suggested_mitigation": "1 sentence general mitigation approach"}},
    {{"name": "Nicotine Pouches", "energy_sensitivity": "H/M/L", "supply_route_exposure": "1 sentence on nicotine salt sourcing, pouch material, and distribution routes", "risk": "H/M/L", "rationale": "1-2 sentences", "suggested_mitigation": "1 sentence general mitigation approach"}}
  ],
  "chokepoint_status": [
    {{"name": "Strait of Hormuz", "status": "OPEN/RESTRICTED/CLOSED", "delay_hours": 0, "detail": "1 sentence"}},
    {{"name": "Bab el-Mandeb / Red Sea", "status": "OPEN/RESTRICTED/CLOSED", "delay_hours": 0, "detail": "1 sentence"}},
    {{"name": "Suez Canal", "status": "OPEN/RESTRICTED/CLOSED", "delay_hours": 0, "detail": "1 sentence"}},
    {{"name": "Malacca Strait", "status": "OPEN/RESTRICTED/CLOSED", "delay_hours": 0, "detail": "1 sentence"}}
  ],
  "shipping_alerts": ["alert 1", "alert 2"],
  "top_stories": [{{"headline": "...", "source": "...", "summary": "2 sentences framed through tobacco procurement impact", "relevance": "HIGH/MEDIUM/LOW", "url": "..."}}],
  "timeline_events": [{{"date": "YYYY-MM-DD", "event": "description with tobacco supply chain implications where relevant", "severity": "HIGH/MEDIUM/LOW"}}],
  "risk_heatmap": [
    {{"region": "Middle East", "risk": "HIGH/MEDIUM/LOW", "detail": "1 sentence including tobacco-specific exposure (acetate tow feedstock, duty-free channel, transit routes)"}},
    {{"region": "Red Sea", "risk": "HIGH/MEDIUM/LOW", "detail": "1 sentence on packaging/NGP shipping disruption"}},
    {{"region": "South China Sea", "risk": "HIGH/MEDIUM/LOW", "detail": "1 sentence noting e-cigarette/heated tobacco device supply chain exposure from Shenzhen/SEA"}},
    {{"region": "Black Sea", "risk": "HIGH/MEDIUM/LOW", "detail": "1 sentence noting oriental leaf tobacco sourcing and Ukraine/Russia market impact"}}
  ]
}}

RULES: Use EXACT prices from data. Informational tone only — NO directives, NO 'should', NO 'recommend', NO 'action required'. State facts, risks, and outlook. The 'suggested_mitigation' field in procurement_categories must describe GENERAL strategic approaches (e.g. 'supply base diversification', 'forward cover extension', 'safety stock review', 'dual-sourcing strategy') — NEVER name specific countries, suppliers, or sourcing locations. 5 top stories with URLs. 5-7 timeline events. Each executive_summary bullet must be 1-2 sentences max, sharp and data-driven. Do NOT prefix bullets with 'Bullet 1:' or numbers — start directly with the content."""

    print("  Calling Claude API...")
    start = time.time()
    message = client.messages.create(
        model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-20250514"),
        max_tokens=8192,
        messages=[{"role": "user", "content": prompt}],
    )
    print(f"  Claude responded in {time.time() - start:.1f}s, tokens: {message.usage}")
    text = message.content[0].text.strip()
    if text.startswith("```"):
        text = "\n".join(text.split("\n")[1:])
        if text.endswith("```"): text = text[:-3].strip()
    # Try parsing, with fallback for truncated JSON
    try:
        return json.loads(text)
    except json.JSONDecodeError as orig_err:
        print(f"  JSON parse error: {orig_err}")
        print(f"  Text length: {len(text)}, last 100 chars: {text[-100:]}")
        # Try to find the last complete top-level JSON object
        brace_depth = 0
        bracket_depth = 0
        in_string = False
        i = 0
        last_valid_end = 0
        while i < len(text):
            ch = text[i]
            if in_string:
                if ch == '\\':
                    i += 2
                    continue
                if ch == '"':
                    in_string = False
            else:
                if ch == '"':
                    in_string = True
                elif ch == '{':
                    brace_depth += 1
                elif ch == '}':
                    brace_depth -= 1
                    if brace_depth == 0:
                        last_valid_end = i + 1
                elif ch == '[':
                    bracket_depth += 1
                elif ch == ']':
                    bracket_depth -= 1
            i += 1
        if last_valid_end > 0:
            print(f"  Recovered JSON at position {last_valid_end}")
            return json.loads(text[:last_valid_end])
        raise orig_err


async def main():
    print("Fetching commodity prices...")
    commodities = await fetch_commodities()
    print(f"  Got {len(commodities)} commodities")
    for c in commodities:
        print(f"    {c['name']}: {c['price']} {c['unit']} (24h: {c['change_24h']}%, 7d: {c['change_7d']}%)")

    print("Fetching news...")
    news = await fetch_news()
    print(f"  Got {len(news)} articles")

    print("Generating intelligence brief...")
    intelligence = call_llm(commodities, news)
    print(f"  Risk: {intelligence.get('overall_risk')}")
    print(f"  Categories: {len(intelligence.get('procurement_categories', []))}")

    output = {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "next_refresh": (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat(),
        "commodities": commodities,
        "intelligence": intelligence,
        "raw_news_count": len(news),
    }

    data_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.json")
    with open(data_path, "w") as f:
        json.dump(output, f, indent=2)
    print(f"Saved to data.json ({len(json.dumps(output))} bytes)")


if __name__ == "__main__":
    asyncio.run(main())

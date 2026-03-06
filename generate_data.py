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
        # Fetch 5d data for accurate 24h change
        r5 = await http.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=5d&interval=1d",
            headers=YAHOO_HEADERS
        )
        # Fetch 1mo data for 7d change and sparkline history
        r1m = await http.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=1mo&interval=1d",
            headers=YAHOO_HEADERS
        )
        if r5.status_code != 200 or r1m.status_code != 200:
            return None

        data5 = r5.json()
        data1m = r1m.json()

        result5 = data5["chart"]["result"][0]
        result1m = data1m["chart"]["result"][0]

        meta5 = result5["meta"]
        closes5 = [c for c in result5["indicators"]["quote"][0].get("close", []) if c is not None]
        closes1m = [c for c in result1m["indicators"]["quote"][0].get("close", []) if c is not None]

        if not closes5 or not closes1m:
            return None

        current = float(meta5.get("regularMarketPrice", closes5[-1]))

        # 24h change: use yesterday's close from 5d data (closes5[-2])
        prev_24h = closes5[-2] if len(closes5) > 1 else current
        change_24h = round(((current - prev_24h) / prev_24h) * 100, 2)

        # 7d change: use closes1m[-6] vs current
        week_ago = closes1m[-6] if len(closes1m) > 5 else closes1m[0]
        change_7d = round(((current - float(week_ago)) / float(week_ago)) * 100, 2)

        return {
            "name": name, "price": round(current, 2), "unit": unit,
            "change_24h": change_24h,
            "change_7d": change_7d,
            "history": [round(float(c), 2) for c in closes1m],
        }
    except Exception as e:
        print(f"  Yahoo {symbol} error: {e}")
        return None


async def fetch_jkm_investing(http):
    """Fetch live JKM LNG price from investing.com."""
    import re
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        }
        r = await http.get(
            "https://uk.investing.com/commodities/lng-japan-korea-marker-platts-futures",
            headers=headers,
        )
        if r.status_code != 200:
            print(f"  JKM investing.com status: {r.status_code}")
            return None

        text = r.text
        m_last = re.search(r'data-test="instrument-price-last">([0-9.]+)', text)
        if not m_last:
            print("  JKM: could not find price on investing.com")
            return None

        current = float(m_last.group(1))

        # Extract change %
        m_pct = re.search(r'data-test="instrument-price-change-percent">\(?([+-]?[0-9.]+)', text)
        change_pct = float(m_pct.group(1)) if m_pct else 0.0

        # Fetch historical data page for sparkline history
        r2 = await http.get(
            "https://uk.investing.com/commodities/lng-japan-korea-marker-platts-futures-historical-data",
            headers=headers,
        )
        history = []
        if r2.status_code == 200:
            # Extract close prices from historical table (range 5-80 for JKM)
            all_prices = re.findall(r'>([0-9]{1,2}\.[0-9]{2,3})<', r2.text)
            # Filter to plausible JKM range and deduplicate consecutive entries
            plausible = [float(p) for p in all_prices if 5.0 <= float(p) <= 80.0]
            # Take every 4th value (close, open, high, low pattern) — close is first
            if len(plausible) >= 8:
                closes = plausible[::4][:20]  # max ~20 days
                history = list(reversed(closes))  # oldest to newest

        # Compute 24h change from first two history entries or use page change
        change_24h = change_pct
        # Compute 7d change from history
        change_7d = 0.0
        if len(history) >= 6:
            week_ago = history[-6]
            if week_ago > 0:
                change_7d = round(((current - week_ago) / week_ago) * 100, 2)
        elif len(history) >= 2:
            change_7d = round(((current - history[0]) / history[0]) * 100, 2)

        if not history:
            history = [current]

        return {
            "name": "LNG Asia (JKM)",
            "price": round(current, 2),
            "unit": "$/MMBtu",
            "change_24h": round(change_24h, 2),
            "change_7d": round(change_7d, 2),
            "history": [round(h, 2) for h in history],
        }
    except Exception as e:
        print(f"  JKM investing.com error: {e}")
        return None


async def fetch_commodities():
    symbols = [
        ("BZ=F", "Brent Crude", "$/bbl"),
        ("CL=F", "WTI Crude", "$/bbl"),
        ("TTF=F", "LNG Europe (TTF)", "EUR/MWh"),
        ("NG=F", "Henry Hub Nat Gas", "$/MMBtu"),
        ("BDRY", "Dry Bulk Shipping (BDRY)", "Index"),
    ]
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as http:
        yahoo_tasks = [fetch_yahoo(http, s, n, u) for s, n, u in symbols]
        jkm_task = fetch_jkm_investing(http)
        results = await asyncio.gather(*yahoo_tasks, jkm_task)

    # Yahoo results + JKM
    commodities = [r for r in results[:-1] if r]
    jkm = results[-1]
    if jkm:
        commodities.append(jkm)
    else:
        # Fallback: estimate from TTF if investing.com fails
        print("  JKM: falling back to TTF estimate")
        ttf = next((c for c in commodities if "TTF" in c["name"]), None)
        if ttf:
            jkm_fb = dict(ttf)
            jkm_fb["name"] = "LNG Asia (JKM Est.)"
            jkm_fb["unit"] = "$/MMBtu"
            jkm_fb["price"] = round(ttf["price"] * 1.15, 2)
            jkm_fb["history"] = [round(p * 1.15, 2) for p in ttf["history"]]
            commodities.append(jkm_fb)
    return commodities


async def fetch_news():
    articles = []
    queries = [
        "oil+price+Iran+conflict",
        "LNG+shipping+disruption",
        "Red+Sea+Suez+shipping",
        "energy+supply+chain+geopolitical",
        "Strait+Hormuz+military",
    ]
    async with httpx.AsyncClient(timeout=15) as http:
        for q in queries:
            try:
                r = await http.get(f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en", headers=YAHOO_HEADERS)
                if r.status_code == 200:
                    root = ET.fromstring(r.text)
                    for item in root.findall(".//item")[:4]:
                        raw_url = item.findtext("link", "")
                        # Convert Google News RSS URL to browser-clickable URL
                        # /rss/articles/ → /articles/ (JS redirect works in browser)
                        clean_url = raw_url.replace("/rss/articles/", "/articles/") if raw_url else ""
                        articles.append({
                            "title": item.findtext("title", ""),
                            "source": item.findtext("source", "Unknown"),
                            "url": clean_url,
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
    # Build news items with index for URL mapping (LLM must NOT generate URLs)
    news_for_prompt = []
    for i, n in enumerate(news[:8]):
        news_for_prompt.append({"idx": i, "title": n["title"], "source": n["source"]})
    # Keep a URL lookup for post-processing
    news_url_lookup = {i: n.get("url", "") for i, n in enumerate(news[:8])}

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

NEWS HEADLINES (last 24-48 hours — reference by idx number):
{json.dumps(news_for_prompt, indent=2)}

Produce ONLY valid JSON (no markdown fences):
{{
  "executive_summary": [
    "MAX 1 sentence: the single biggest threat right now with exact prices and % moves.",
    "MAX 1 sentence: energy cost impact on acetate tow, packaging, NGP components.",
    "MAX 1 sentence: shipping and supply route disruption status with freight rate direction.",
    "MAX 1 sentence: supplier force majeure or cost-escalation risk.",
    "MAX 1 sentence: net margin/COGS outlook for the next 4-8 weeks."
  ],
  "overall_risk": "HIGH or MEDIUM or LOW",
  "cogs_outlook": "1 sentence on net COGS trajectory for next 4-8 weeks based on all data.",
  "kpi_summary": {{
    "overall_cogs_pressure": "UP or STABLE or DOWN",
    "energy_cost_trend": "UP or STABLE or DOWN — 1 short reason",
    "supply_chain_disruption_level": "SEVERE or MODERATE or MINIMAL",
    "avg_shipping_delay_days": <number>,
    "active_chokepoint_disruptions": <number 0-4>,
    "categories_at_high_risk": <number 0-8>
  }},
  "container_freight_rates": [
    {{"route": "Shanghai → Rotterdam", "rate_20ft": "$XXXX", "change_7d": "+X%", "conflict_impact": "1 short sentence"}},
    {{"route": "Shanghai → Los Angeles", "rate_20ft": "$XXXX", "change_7d": "+X%", "conflict_impact": "1 short sentence"}},
    {{"route": "Shanghai → New York", "rate_20ft": "$XXXX", "change_7d": "+X%", "conflict_impact": "1 short sentence"}},
    {{"route": "Rotterdam → New York", "rate_20ft": "$XXXX", "change_7d": "+X%", "conflict_impact": "1 short sentence"}},
    {{"route": "Jebel Ali → Rotterdam", "rate_20ft": "$XXXX", "change_7d": "+X%", "conflict_impact": "1 short sentence"}}
  ],
  "procurement_categories": [
    {{"name": "Cellulose Acetate Filter Tow", "energy_sensitivity": "H/M/L", "supply_route_exposure": "1 sentence", "risk": "H/M/L", "risk_driver": "3-5 word primary risk driver e.g. 'Energy feedstock costs' or 'Single-source China assembly'", "rationale": "MAX 1 sentence", "suggested_mitigation": "1-2 sentences with specific strategic detail"}},
    {{"name": "Cigarette Paper", "energy_sensitivity": "H/M/L", "supply_route_exposure": "1 sentence", "risk": "H/M/L", "risk_driver": "3-5 words", "rationale": "MAX 1 sentence", "suggested_mitigation": "1-2 sentences with specific strategic detail"}},
    {{"name": "Cigarette Packaging (Board & Print)", "energy_sensitivity": "H/M/L", "supply_route_exposure": "1 sentence", "risk": "H/M/L", "risk_driver": "3-5 words", "rationale": "MAX 1 sentence", "suggested_mitigation": "1-2 sentences with specific strategic detail"}},
    {{"name": "Pouch Packaging (Resins)", "energy_sensitivity": "H/M/L", "supply_route_exposure": "1 sentence", "risk": "H/M/L", "risk_driver": "3-5 words", "rationale": "MAX 1 sentence", "suggested_mitigation": "1-2 sentences with specific strategic detail"}},
    {{"name": "Flavors & Ingredients", "energy_sensitivity": "H/M/L", "supply_route_exposure": "1 sentence", "risk": "H/M/L", "risk_driver": "3-5 words", "rationale": "MAX 1 sentence", "suggested_mitigation": "1-2 sentences with specific strategic detail"}},
    {{"name": "Heated Tobacco Devices & Consumables", "energy_sensitivity": "H/M/L", "supply_route_exposure": "1 sentence", "risk": "H/M/L", "risk_driver": "3-5 words", "rationale": "MAX 1 sentence", "suggested_mitigation": "1-2 sentences with specific strategic detail"}},
    {{"name": "E-Cigarettes & Vape Devices", "energy_sensitivity": "H/M/L", "supply_route_exposure": "1 sentence", "risk": "H/M/L", "risk_driver": "3-5 words", "rationale": "MAX 1 sentence", "suggested_mitigation": "1-2 sentences with specific strategic detail"}},
    {{"name": "Nicotine Pouches", "energy_sensitivity": "H/M/L", "supply_route_exposure": "1 sentence", "risk": "H/M/L", "risk_driver": "3-5 words", "rationale": "MAX 1 sentence", "suggested_mitigation": "1-2 sentences with specific strategic detail"}}
  ],
  "chokepoint_status": [
    {{"name": "Strait of Hormuz", "status": "OPEN/RESTRICTED/CLOSED", "delay_hours": 0, "detail": "MAX 10 words"}},
    {{"name": "Bab el-Mandeb / Red Sea", "status": "OPEN/RESTRICTED/CLOSED", "delay_hours": 0, "detail": "MAX 10 words"}},
    {{"name": "Suez Canal", "status": "OPEN/RESTRICTED/CLOSED", "delay_hours": 0, "detail": "MAX 10 words"}},
    {{"name": "Malacca Strait", "status": "OPEN/RESTRICTED/CLOSED", "delay_hours": 0, "detail": "MAX 10 words"}}
  ],
  "top_stories": [
    {{"headline": "...", "source": "...", "summary": "MAX 1 sentence framed through tobacco procurement impact", "relevance": "HIGH/MEDIUM/LOW", "news_idx": <integer matching idx from NEWS HEADLINES>}}
  ],
  "timeline_events": [
    {{"date": "YYYY-MM-DD", "event": "short description with tobacco supply chain implications", "severity": "HIGH/MEDIUM/LOW"}}
  ],
  "risk_heatmap": [
    {{"region": "Middle East", "risk": "HIGH/MEDIUM/LOW", "detail": "MAX 8 words"}},
    {{"region": "Red Sea", "risk": "HIGH/MEDIUM/LOW", "detail": "MAX 8 words"}},
    {{"region": "South China Sea", "risk": "HIGH/MEDIUM/LOW", "detail": "MAX 8 words"}},
    {{"region": "Black Sea", "risk": "HIGH/MEDIUM/LOW", "detail": "MAX 8 words"}}
  ],
  "analyst_sentiment": {{
    "overall": "BEARISH or NEUTRAL or BULLISH",
    "energy_outlook": "1 sentence: analyst consensus on crude/LNG price direction over 4-8 weeks.",
    "supply_chain_outlook": "1 sentence: shipping and logistics normalisation or further disruption outlook.",
    "procurement_outlook": "1 sentence: expected impact on tobacco industry input costs and availability."
  }}
}}

RULES:
- Use EXACT prices from data. Informational tone only — NO directives, NO 'should', NO 'recommend', NO 'action required'.
- State facts, risks, and outlook.
- The 'suggested_mitigation' field must describe GENERAL strategic approaches (e.g. 'supply base diversification', 'forward cover extension') — NEVER name specific countries, suppliers, or sourcing locations.
- 3 top stories. Each top_story MUST include a 'news_idx' field matching one of the idx values from NEWS HEADLINES. Do NOT generate URLs — URLs are injected automatically from the news_idx mapping.
- 5 timeline events. All events must be from TODAY or EARLIER — never include future-dated events or forecasts. Only confirmed, already-occurred events.
- Each executive_summary bullet must be MAX 1 sentence, sharp and data-driven. Do NOT prefix bullets with numbers or labels.
- Container freight rates: estimate realistic current market rates based on commodity/shipping data and news context. Use USD values.
- KPI summary: derive from all the data. categories_at_high_risk = count of procurement categories with risk H.
- The 'suggested_mitigation' field must contain 1-2 sentences with specific strategic approaches. Include detail on HOW to mitigate (e.g. 'Extend forward coverage on energy-linked raw materials to lock in current pricing through Q3, and diversify converting suppliers across regions to reduce single-source exposure'). NEVER name specific countries or suppliers.
- Heatmap detail: MAX 8 words per region.
- Chokepoint detail: MAX 10 words each.
- Procurement rationale: MAX 1 sentence. suggested_mitigation: 1-2 sentences with specific strategic detail.
- risk_driver: 3-5 words identifying the PRIMARY factor driving the overall risk rating. This must explain WHY the risk differs from energy sensitivity when they diverge (e.g. 'Concentrated China/SEA sourcing', 'Hormuz chokepoint transit', 'Single-source supply base', 'Energy feedstock cost pass-through'). The CPO must immediately understand the core driver at a glance.
- Analyst sentiment: provide a forward-looking outlook based on all available data. This is the analyst's professional assessment of market direction. 'overall' must be BEARISH, NEUTRAL, or BULLISH. Each outlook sentence must be informational, not directive.

WRITING QUALITY:
- Write complete, grammatically correct sentences — never telegraph-style shorthand.
- Never reference internal data indices, field names, or system artefacts (e.g. no 'idx', no field labels).
- Executive summary bullets must read as polished intelligence briefing language suitable for C-suite.
- Use precise language: 'increased' not 'up', 'approximately' not 'approx'.
- Each sentence must be self-contained and meaningful without needing context from other sections."""

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
        result = json.loads(text)
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
            result = json.loads(text[:last_valid_end])
        else:
            raise orig_err

    # Post-process: inject real URLs into top_stories from news_url_lookup
    for story in result.get("top_stories", []):
        idx = story.pop("news_idx", None)
        if idx is not None and idx in news_url_lookup:
            story["url"] = news_url_lookup[idx]
        elif not story.get("url") or "google.com" not in story.get("url", ""):
            # Fallback: search Google for the headline
            headline = story.get("headline", "")
            source = story.get("source", "")
            story["url"] = f"https://www.google.com/search?q={headline}+{source}".replace(" ", "+")

    # Validate all story URLs are non-empty
    for story in result.get("top_stories", []):
        if not story.get("url"):
            story["url"] = "#"

    # ── POST-PROCESS: Override LLM KPIs with COMPUTED values ──
    # The LLM often miscounts. Compute from actual returned data.
    kpi = result.get("kpi_summary", {})

    # 1. Count high-risk categories from actual procurement_categories
    cats = result.get("procurement_categories", [])
    high_risk_count = sum(1 for c in cats if (c.get("risk", "")).upper() in ("H", "HIGH"))
    kpi["categories_at_high_risk"] = high_risk_count

    # 2. Count chokepoint disruptions from actual chokepoint_status
    chokes = result.get("chokepoint_status", [])
    disrupted_count = sum(1 for cp in chokes if cp.get("status", "OPEN").upper() in ("RESTRICTED", "CLOSED"))
    kpi["active_chokepoint_disruptions"] = disrupted_count

    # 3. Compute avg shipping delay from chokepoint delay_hours
    delays = [cp.get("delay_hours", 0) for cp in chokes if cp.get("delay_hours", 0) > 0]
    if delays:
        avg_delay_hours = sum(delays) / len(delays)
        kpi["avg_shipping_delay_days"] = round(avg_delay_hours / 24, 0)
    else:
        kpi["avg_shipping_delay_days"] = 0

    result["kpi_summary"] = kpi

    # 4. Filter timeline events: remove any with future dates
    today_str = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    timeline = result.get("timeline_events", [])
    result["timeline_events"] = [
        ev for ev in timeline
        if (ev.get("date", "") or "") <= today_str
    ][:5]

    return result


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

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
import tempfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta

import httpx
from anthropic import Anthropic

YAHOO_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

# ── Canonical procurement categories (pinned names, default energy sensitivity) ──
# Category names are HARDCODED and never change.
# Energy sensitivity defaults are baselines — the LLM may override them day-to-day
# but must provide an explicit rationale for any deviation.
CANONICAL_CATEGORIES = [
    {"name": "Cellulose Acetate Filter Tow", "default_energy_sensitivity": "H"},
    {"name": "Cigarette Paper", "default_energy_sensitivity": "M"},
    {"name": "Cigarette Packaging (Board & Print)", "default_energy_sensitivity": "H"},
    {"name": "Pouch Packaging (Resins)", "default_energy_sensitivity": "H"},
    {"name": "Flavors & Ingredients", "default_energy_sensitivity": "L"},
    {"name": "Heated Tobacco Devices & Consumables", "default_energy_sensitivity": "M"},
    {"name": "E-Cigarettes & Vape Devices", "default_energy_sensitivity": "M"},
    {"name": "Nicotine Pouches", "default_energy_sensitivity": "L"},
]

# ── IMF PortWatch chokepoint mapping ──
# reroute_days: extra transit days when ships divert via Cape of Good Hope (or Lombok/Sunda for Malacca).
# These are well-established industry figures based on Asia→Europe / Gulf→Europe routing.
PORTWATCH_CHOKEPOINTS = {
    "chokepoint6": {
        "name": "Strait of Hormuz",
        "display": "Strait of Hormuz",
        "reroute_via": "Cape of Good Hope",
        "reroute_days_low": 7,
        "reroute_days_high": 12,
        "reroute_note": "Gulf→Europe/Asia via Cape of Good Hope",
    },
    "chokepoint4": {
        "name": "Bab el-Mandeb Strait",
        "display": "Bab el-Mandeb / Red Sea",
        "reroute_via": "Cape of Good Hope",
        "reroute_days_low": 10,
        "reroute_days_high": 14,
        "reroute_note": "Asia→Europe rerouted via Cape of Good Hope",
    },
    "chokepoint1": {
        "name": "Suez Canal",
        "display": "Suez Canal",
        "reroute_via": "Cape of Good Hope",
        "reroute_days_low": 10,
        "reroute_days_high": 14,
        "reroute_note": "Asia→Europe rerouted via Cape of Good Hope",
    },
    "chokepoint5": {
        "name": "Malacca Strait",
        "display": "Malacca Strait",
        "reroute_via": "Lombok / Sunda Strait",
        "reroute_days_low": 2,
        "reroute_days_high": 4,
        "reroute_note": "SE Asia→Indian Ocean via Lombok or Sunda Strait",
    },
}


async def fetch_yahoo(http, symbol, name, unit):
    try:
        r5 = await http.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=5d&interval=1d",
            headers=YAHOO_HEADERS
        )
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
        prev_24h = closes5[-2] if len(closes5) > 1 else current
        change_24h = round(((current - prev_24h) / prev_24h) * 100, 2)
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



async def fetch_commodities():
    symbols = [
        ("BZ=F", "Brent Crude", "$/bbl"),
        ("CL=F", "WTI Crude", "$/bbl"),
        ("TTF=F", "LNG Europe (TTF)", "EUR/MWh"),
        ("NG=F", "Henry Hub Nat Gas", "$/MMBtu"),
        ("BDRY", "Dry Bulk Shipping (BDRY)", "Index"),
        ("JKM=F", "LNG Asia (JKM)", "$/MMBtu"),
    ]
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as http:
        yahoo_tasks = [fetch_yahoo(http, s, n, u) for s, n, u in symbols]
        results = await asyncio.gather(*yahoo_tasks)

    commodities = [r for r in results if r]

    # If JKM=F fetch failed, fall back to TTF-derived estimate
    jkm_present = any(c["name"] == "LNG Asia (JKM)" for c in commodities)
    if not jkm_present:
        print("  JKM=F: Yahoo fetch failed, falling back to TTF estimate")
        ttf = next((c for c in commodities if "TTF" in c["name"]), None)
        if ttf:
            jkm_fb = dict(ttf)
            jkm_fb["name"] = "LNG Asia (JKM Est.)"
            jkm_fb["unit"] = "$/MMBtu"
            jkm_fb["price"] = round(ttf["price"] * 1.15, 2)
            jkm_fb["history"] = [round(p * 1.15, 2) for p in ttf["history"]]
            commodities.append(jkm_fb)
    return commodities


# ── FBX route mapping: our dashboard routes → Freightos Baltic Index tickers ──
# FBX rates are 40ft (FEU). We display 20ft (TEU) — roughly FEU / 1.7 for a
# conservative TEU estimate (industry convention: TEU ≈ 55-65% of FEU).
FBX_ROUTE_MAP = {
    "FBX11": {"route": "Shanghai → Rotterdam",  "description": "China/East Asia → North Europe"},
    "FBX01": {"route": "Shanghai → Los Angeles", "description": "China/East Asia → NA West Coast"},
    "FBX03": {"route": "Shanghai → New York",    "description": "China/East Asia → NA East Coast"},
    "FBX22": {"route": "Rotterdam → New York",   "description": "North Europe → NA East Coast"},
}
FEU_TO_TEU_FACTOR = 1.7  # Industry standard: 20ft ≈ FEU / 1.7


async def fetch_fbx_rates():
    """Fetch live container freight rates from Freightos Baltic Index (FBX).
    Extracts embedded data from the FBX page (server-side rendered JSON).
    Returns list of rate dicts for our tracked routes, or empty list on failure."""
    import re
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as http:
            r = await http.get(
                "https://www.freightos.com/enterprise/terminal/freightos-baltic-index-global-container-pricing-index/",
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            )
        if r.status_code != 200:
            print(f"  FBX: HTTP {r.status_code}")
            return []

        # Extract embedded ticker data: window.frProductIntroTickerData = {...}
        m = re.search(r'frProductIntroTickerData\s*=\s*(\{.*?\});', r.text, re.DOTALL)
        if not m:
            print("  FBX: Could not find frProductIntroTickerData in page")
            return []

        import json as _json
        raw = _json.loads(m.group(1))
        # The data is nested under a dynamic key — get the first (only) value
        ticker_list = list(raw.values())[0] if raw else []

        # Also extract chart data for weekly history
        history_map = {}  # ticker -> list of weekly values
        m_chart = re.search(r'frProductIntroChartData\s*=\s*(\{.*?\});', r.text, re.DOTALL)
        if m_chart:
            try:
                chart_raw = _json.loads(m_chart.group(1))
                chart_list = list(chart_raw.values())[0] if chart_raw else []
                for entry in chart_list:
                    t = entry.get("ticker", "")
                    v = entry.get("value")
                    if t and v is not None:
                        history_map.setdefault(t, []).append(v)
            except Exception:
                pass

        # Build lookup: label -> {value, change}
        fbx_lookup = {}
        for item in ticker_list:
            label = item.get("label", "")
            val_str = item.get("value", "$0").replace("$", "").replace(",", "")
            change_str = item.get("change", "0%").replace("%", "").replace("+", "")
            try:
                fbx_lookup[label] = {
                    "feu_rate": float(val_str),
                    "change_pct": float(change_str),
                    "positive": item.get("positive", False),
                }
            except ValueError:
                continue

        print(f"  FBX: Got {len(fbx_lookup)} lane rates")

        # Map to our routes
        rates = []
        for ticker, route_info in FBX_ROUTE_MAP.items():
            if ticker not in fbx_lookup:
                print(f"  FBX: Missing lane {ticker}")
                continue
            fbx = fbx_lookup[ticker]
            feu_rate = fbx["feu_rate"]
            teu_rate = round(feu_rate / FEU_TO_TEU_FACTOR)
            change_7d = fbx["change_pct"]
            sign = "+" if change_7d > 0 else ""
            history = history_map.get(ticker, [])

            rates.append({
                "route": route_info["route"],
                "rate_20ft": f"${teu_rate:,}",
                "rate_40ft": f"${int(feu_rate):,}",
                "change_7d": f"{sign}{change_7d:.1f}%",
                "fbx_ticker": ticker,
                "source": "FBX",
                "conflict_impact": "",  # Will be filled by LLM
                "history_weekly": [round(v / FEU_TO_TEU_FACTOR) for v in history] if history else [],
            })

        # Log what we got
        for r in rates:
            print(f"    {r['route']}: {r['rate_20ft']} (40ft: {r['rate_40ft']}, {r['change_7d']})")

        return rates

    except Exception as e:
        print(f"  FBX fetch error: {e}")
        return []


async def fetch_chokepoint_transit():
    """Fetch daily vessel transit data + active disruption alerts from IMF PortWatch.
    Returns dict keyed by display name with transit stats and computed status."""
    port_ids = list(PORTWATCH_CHOKEPOINTS.keys())
    where_clause = "portid IN ('" + "','".join(port_ids) + "')"
    transit_url = (
        "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/"
        "Daily_Chokepoints_Data/FeatureServer/0/query"
    )
    disruptions_url = (
        "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/"
        "portwatch_disruptions_database/FeatureServer/0/query"
    )
    transit_params = {
        "where": where_clause,
        "outFields": "date,portid,portname,n_total,n_container,n_tanker,n_dry_bulk,capacity",
        "orderByFields": "date DESC",
        "resultRecordCount": 280,
        "f": "json",
    }
    disruptions_params = {
        "where": "todate IS NULL",  # active disruptions only
        "outFields": "eventname,alertlevel,affectedports,fromdate,htmlname",
        "resultRecordCount": 50,
        "f": "json",
    }

    result = {}
    try:
        async with httpx.AsyncClient(timeout=30) as http:
            # Fetch both in parallel
            transit_resp, disruptions_resp = await asyncio.gather(
                http.get(transit_url, params=transit_params),
                http.get(disruptions_url, params=disruptions_params),
            )

        # Parse active disruptions — build a set of affected chokepoint IDs with alert levels
        active_alerts = {}  # portid -> alert level
        if disruptions_resp.status_code == 200:
            d_data = disruptions_resp.json()
            for feat in d_data.get("features", []):
                a = feat["attributes"]
                alert = (a.get("alertlevel") or "").upper()
                affected = a.get("affectedports") or ""
                event_name = a.get("htmlname") or a.get("eventname") or ""
                for pid in affected.split(";"):
                    pid = pid.strip()
                    if pid in PORTWATCH_CHOKEPOINTS:
                        active_alerts[pid] = {"alert": alert, "event": event_name}
                        print(f"    Active disruption: {event_name} → {pid} [{alert}]")

        if transit_resp.status_code != 200:
            print(f"  PortWatch transit API error: HTTP {transit_resp.status_code}")
            return {}
        data = transit_resp.json()
        if "error" in data:
            print(f"  PortWatch transit API error: {data['error']}")
            return {}

        features = data.get("features", [])
        print(f"  PortWatch: {len(features)} transit records fetched")

        from collections import defaultdict
        by_port = defaultdict(list)
        for f in features:
            a = f["attributes"]
            by_port[a["portid"]].append(a)

        for port_id, records in by_port.items():
            if port_id not in PORTWATCH_CHOKEPOINTS:
                continue
            cp_info = PORTWATCH_CHOKEPOINTS[port_id]
            display = cp_info["display"]

            records.sort(key=lambda x: x["date"])
            totals = [r["n_total"] for r in records]

            if len(totals) < 7:
                continue

            latest = totals[-1]
            latest_date = datetime.fromtimestamp(records[-1]["date"] / 1000, tz=timezone.utc).strftime("%Y-%m-%d")

            baseline_window = totals[-31:-1] if len(totals) > 31 else totals[:-1]
            baseline_avg = sum(baseline_window) / len(baseline_window) if baseline_window else latest

            avg_7d = sum(totals[-7:]) / min(len(totals), 7)

            pct_change = ((latest - baseline_avg) / baseline_avg * 100) if baseline_avg > 0 else 0
            pct_change_7d = ((avg_7d - baseline_avg) / baseline_avg * 100) if baseline_avg > 0 else 0

            # Derive status from transit volume drops
            # NOTE: No chokepoint is labelled "CLOSED" — that implies a formal
            # blockage (e.g. Ever Given 2021). Even a 50%+ volume drop usually
            # means heavy voluntary rerouting, not physical closure.
            def derive_status(pct):
                if pct <= -50:
                    return "SEVERELY DISRUPTED", 168
                elif pct <= -25:
                    return "DISRUPTED", max(24, int(abs(pct) * 1.5))
                elif pct <= -15:
                    return "DISRUPTED", max(6, int(abs(pct) * 0.8))
                else:
                    return "OPEN", 0

            status_7d, delay_7d = derive_status(pct_change_7d)
            status_latest, delay_latest = derive_status(pct_change)

            STATUS_ORDER = {"OPEN": 0, "DISRUPTED": 1, "SEVERELY DISRUPTED": 2}
            if STATUS_ORDER.get(status_latest, 0) > STATUS_ORDER.get(status_7d, 0):
                status = status_latest
                delay_hours = delay_latest
            else:
                status = status_7d
                delay_hours = delay_7d

            # Override with active disruption alerts from PortWatch
            # RED alert = at minimum DISRUPTED, ORANGE = at minimum DISRUPTED
            alert_info = active_alerts.get(port_id)
            if alert_info:
                alert_level = alert_info["alert"]
                if alert_level == "RED" and STATUS_ORDER.get(status, 0) < STATUS_ORDER.get("DISRUPTED", 1):
                    status = "DISRUPTED"
                    print(f"    {display}: Elevated to DISRUPTED (RED alert active: {alert_info['event']})")
                elif alert_level == "ORANGE" and STATUS_ORDER.get(status, 0) < STATUS_ORDER.get("DISRUPTED", 1):
                    status = "DISRUPTED"

            # ── Rerouting delay model ──
            # When a chokepoint is DISRUPTED or SEVERELY DISRUPTED, ships reroute via
            # Cape of Good Hope (or Lombok/Sunda for Malacca). The real-world delay is
            # the extra transit days from rerouting — NOT derived from volume drop magnitude.
            # Volume may look "normal" simply because ships are avoiding the chokepoint entirely.
            reroute_active = False
            reroute_days_low = cp_info.get("reroute_days_low", 0)
            reroute_days_high = cp_info.get("reroute_days_high", 0)
            reroute_via = cp_info.get("reroute_via", "")
            reroute_note = cp_info.get("reroute_note", "")

            if status in ("DISRUPTED", "SEVERELY DISRUPTED"):
                reroute_active = True
                # Use midpoint of rerouting range, converted to hours
                delay_hours = int(((reroute_days_low + reroute_days_high) / 2) * 24)
                print(f"    {display}: Rerouting delay +{reroute_days_low}-{reroute_days_high}d via {reroute_via}")
            else:
                delay_hours = 0

            containers = [r.get("n_container", 0) for r in records]
            latest_containers = containers[-1] if containers else 0
            tankers = [r.get("n_tanker", 0) for r in records]
            latest_tankers = tankers[-1] if tankers else 0

            result[display] = {
                "status": status,
                "delay_hours": delay_hours,
                "latest_date": latest_date,
                "latest_transits": latest,
                "baseline_avg_30d": round(baseline_avg, 0),
                "avg_7d": round(avg_7d, 0),
                "pct_change_vs_baseline": round(pct_change, 1),
                "pct_change_7d_vs_baseline": round(pct_change_7d, 1),
                "latest_containers": latest_containers,
                "latest_tankers": latest_tankers,
                "history_7d": totals[-7:],
                "alert_level": alert_info["alert"] if alert_info else None,
                "alert_event": alert_info["event"] if alert_info else None,
                "reroute_active": reroute_active,
                "reroute_via": reroute_via if reroute_active else None,
                "reroute_days_low": reroute_days_low if reroute_active else None,
                "reroute_days_high": reroute_days_high if reroute_active else None,
                "reroute_note": reroute_note if reroute_active else None,
            }
            print(f"    {display}: {latest} transits (30d avg: {baseline_avg:.0f}, 7d avg: {avg_7d:.0f}, 7d Δ: {pct_change_7d:+.1f}%) → {status} (delay: {delay_hours}h)")

    except Exception as e:
        print(f"  PortWatch fetch error: {e}")

    return result


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


def load_previous_data():
    """Load previous data.json for persistence/comparison."""
    data_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.json")
    try:
        with open(data_path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def stabilise_risk_ratings(new_categories, prev_data):
    """Prevent risk flip-flops: a category can escalate freely but needs
    2 consecutive lower readings to de-escalate. Also enforces canonical
    category names and pinned energy_sensitivity."""

    RISK_ORDER = {"L": 0, "M": 1, "H": 2}

    # Build lookup from previous run
    prev_cats = {}
    if prev_data:
        prev_intel = prev_data.get("intelligence", {})
        for c in prev_intel.get("procurement_categories", []):
            prev_cats[c["name"]] = c

    stabilised = []
    for canonical in CANONICAL_CATEGORIES:
        cname = canonical["name"]

        # Find matching LLM output (fuzzy: check if canonical name is substring or vice versa)
        matched = None
        for nc in new_categories:
            llm_name = nc.get("name", "")
            if (cname.lower() in llm_name.lower()
                    or llm_name.lower() in cname.lower()
                    or cname.split("(")[0].strip().lower() in llm_name.lower()):
                matched = nc
                break

        if not matched:
            # No LLM match — carry forward from previous if available, else default
            if cname in prev_cats:
                prev = dict(prev_cats[cname])
                prev["name"] = cname
                prev["energy_sensitivity"] = canonical["default_energy_sensitivity"]
                prev["energy_sensitivity_rationale"] = prev.get("energy_sensitivity_rationale", "")
                stabilised.append(prev)
            else:
                stabilised.append({
                    "name": cname,
                    "energy_sensitivity": canonical["default_energy_sensitivity"],
                    "energy_sensitivity_rationale": "",
                    "supply_route_exposure": "Assessment pending",
                    "risk": "M",
                    "risk_driver": "Awaiting data",
                    "rationale": "Insufficient data for assessment.",
                    "suggested_mitigation": "Monitor and reassess on next cycle.",
                })
            continue

        # Override name with canonical value (names are hardcoded)
        matched["name"] = cname

        # Energy sensitivity: allow LLM override only if justified
        llm_sens = (matched.get("energy_sensitivity", "")).upper()[:1]
        default_sens = canonical["default_energy_sensitivity"]
        rationale = (matched.get("energy_sensitivity_rationale") or "").strip()

        if llm_sens in ("H", "M", "L") and llm_sens != default_sens and rationale:
            # LLM provided a different rating WITH justification — accept it
            matched["energy_sensitivity"] = llm_sens
            matched["energy_sensitivity_rationale"] = rationale
        else:
            # Use default — either LLM agreed, or didn't justify deviation
            matched["energy_sensitivity"] = default_sens
            matched["energy_sensitivity_rationale"] = ""

        # Stabilise risk: prevent de-escalation without consecutive signals
        new_risk = (matched.get("risk", "M")).upper()[:1]
        if cname in prev_cats:
            prev_risk = (prev_cats[cname].get("risk", "M")).upper()[:1]
            prev_consecutive_lower = prev_cats[cname].get("_consecutive_lower", 0)

            new_order = RISK_ORDER.get(new_risk, 1)
            prev_order = RISK_ORDER.get(prev_risk, 1)

            if new_order < prev_order:
                # Trying to de-escalate
                if prev_consecutive_lower >= 1:
                    # 2nd consecutive lower reading — allow de-escalation
                    matched["risk"] = new_risk
                    matched["_consecutive_lower"] = 0
                else:
                    # 1st lower reading — hold at previous level
                    matched["risk"] = prev_risk
                    matched["_consecutive_lower"] = prev_consecutive_lower + 1
            else:
                # Same or escalating — reset counter
                matched["risk"] = new_risk
                matched["_consecutive_lower"] = 0
        else:
            matched["_consecutive_lower"] = 0

        stabilised.append(matched)

    return stabilised


def call_llm(commodities, news, chokepoint_data, fbx_rates=None):
    client = Anthropic(timeout=300.0)
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    trimmed_c = [{"name": c["name"], "price": c["price"], "unit": c["unit"], "change_24h": c["change_24h"], "change_7d": c["change_7d"]} for c in commodities]

    news_for_prompt = []
    for i, n in enumerate(news[:8]):
        news_for_prompt.append({"idx": i, "title": n["title"], "source": n["source"]})
    news_url_lookup = {i: n.get("url", "") for i, n in enumerate(news[:8])}

    # Build FBX freight rate context
    fbx_context = ""
    if fbx_rates:
        fbx_context = "LIVE CONTAINER FREIGHT RATES (Freightos Baltic Index — FBX):\n"
        for fr in fbx_rates:
            fbx_context += f"  {fr['route']}: {fr['rate_20ft']}/TEU ({fr['rate_40ft']}/FEU, {fr['change_7d']} week-on-week)\n"
        fbx_context += "  NOTE: Jebel Ali → Rotterdam has NO FBX lane. You must ESTIMATE this route.\n\n"
    else:
        fbx_context = "LIVE CONTAINER FREIGHT RATES: FBX data unavailable — estimate all routes from news context.\n\n"

    # Build chokepoint context from real PortWatch data
    chokepoint_context = "CHOKEPOINT VESSEL TRANSIT DATA (IMF PortWatch — real AIS data):\n"
    for display_name, cp_data in chokepoint_data.items():
        chokepoint_context += (
            f"  {display_name}: {cp_data['latest_transits']} transits on {cp_data['latest_date']} "
            f"(30d baseline avg: {cp_data['baseline_avg_30d']:.0f}, 7d avg: {cp_data['avg_7d']:.0f}, "
            f"7d change vs baseline: {cp_data['pct_change_7d_vs_baseline']:+.1f}%) → "
            f"Derived status: {cp_data['status']}\n"
        )
    if not chokepoint_data:
        chokepoint_context += "  (Data unavailable — estimate from news context)\n"

    # Build canonical category list for prompt
    cat_list = "\n".join([f'    {{\"name\": \"{c["name"]}\", \"energy_sensitivity\": \"H/M/L (default: {c["default_energy_sensitivity"]})\", '
                          f'"energy_sensitivity_rationale": \"required if deviating from default — explain why, or empty string if unchanged\", '
                          f'"supply_route_exposure": \"1 sentence\", \"risk\": \"H/M/L\", '
                          f'"risk_driver": \"3-5 word primary risk driver\", '
                          f'"rationale": \"MAX 1 sentence\", '
                          f'"suggested_mitigation": \"1-2 sentences with specific strategic detail\"}},'
                          for c in CANONICAL_CATEGORIES])
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

{fbx_context}{chokepoint_context}

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
{cat_list}
  ],
  "chokepoint_status": [
    {{"name": "Strait of Hormuz", "status": "OPEN/DISRUPTED/SEVERELY DISRUPTED", "delay_hours": 0, "detail": "MAX 10 words"}},
    {{"name": "Bab el-Mandeb / Red Sea", "status": "OPEN/DISRUPTED/SEVERELY DISRUPTED", "delay_hours": 0, "detail": "MAX 10 words"}},
    {{"name": "Suez Canal", "status": "OPEN/DISRUPTED/SEVERELY DISRUPTED", "delay_hours": 0, "detail": "MAX 10 words"}},
    {{"name": "Malacca Strait", "status": "OPEN/DISRUPTED/SEVERELY DISRUPTED", "delay_hours": 0, "detail": "MAX 10 words"}}
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
- PROCUREMENT CATEGORIES: You MUST use the EXACT 8 category names provided above. Do NOT rename, merge, or omit any.
- ENERGY SENSITIVITY: Each category has a default baseline (shown in parentheses in the template). You MAY change the energy_sensitivity rating from its default IF AND ONLY IF today's specific market data justifies it (e.g. a major LNG price spike temporarily elevating resin-dependent categories). If you deviate, you MUST populate 'energy_sensitivity_rationale' with a concise explanation referencing specific data (e.g. 'Elevated from M to H: 15% LNG surge increases resin feedstock costs'). If keeping the default, set energy_sensitivity_rationale to an empty string "".
- 3 top stories. Each top_story MUST include a 'news_idx' field matching one of the idx values from NEWS HEADLINES. Do NOT generate URLs — URLs are injected automatically from the news_idx mapping.
- 5 timeline events. All events must be from TODAY or EARLIER — never include future-dated events or forecasts. Only confirmed, already-occurred events.
- Each executive_summary bullet must be MAX 1 sentence, sharp and data-driven. Do NOT prefix bullets with numbers or labels.
- Container freight rates: For routes with FBX data provided above, use those EXACT rates as your base — do NOT invent different numbers. For Jebel Ali → Rotterdam (no FBX lane), estimate a realistic rate based on the Rotterdam → New York lane adjusted for the Gulf → Europe distance and any Hormuz/Red Sea disruption premiums. Use USD values.
- KPI summary: derive from all the data. categories_at_high_risk = count of procurement categories with risk H.
- The 'suggested_mitigation' field must contain 1-2 sentences with specific strategic approaches. Include detail on HOW to mitigate. NEVER name specific countries or suppliers.
- CHOKEPOINT STATUS: Use the real vessel transit data provided above to inform your chokepoint assessments. The status, delay_hours, and detail should be CONSISTENT with the observed traffic drops. Do not contradict the PortWatch data.
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

    try:
        result = json.loads(text)
    except json.JSONDecodeError as orig_err:
        print(f"  JSON parse error: {orig_err}")
        print(f"  Text length: {len(text)}, last 100 chars: {text[-100:]}")
        brace_depth = 0
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
            i += 1
        if last_valid_end > 0:
            print(f"  Recovered JSON at position {last_valid_end}")
            result = json.loads(text[:last_valid_end])
        else:
            raise orig_err

    # ── Post-process: inject real URLs into top_stories ──
    for story in result.get("top_stories", []):
        idx = story.pop("news_idx", None)
        if idx is not None and idx in news_url_lookup:
            story["url"] = news_url_lookup[idx]
        elif not story.get("url") or "google.com" not in story.get("url", ""):
            headline = story.get("headline", "")
            source = story.get("source", "")
            story["url"] = f"https://www.google.com/search?q={headline}+{source}".replace(" ", "+")

    for story in result.get("top_stories", []):
        if not story.get("url"):
            story["url"] = "#"

    # ── Post-process: Override chokepoint status with PortWatch data ──
    if chokepoint_data:
        for cp in result.get("chokepoint_status", []):
            cp_name = cp.get("name", "")
            if cp_name in chokepoint_data:
                pw = chokepoint_data[cp_name]
                cp["status"] = pw["status"]
                cp["delay_hours"] = pw["delay_hours"]
                # Inject PortWatch KPIs for frontend display
                cp["transit_latest"] = pw["latest_transits"]
                cp["transit_baseline"] = pw["baseline_avg_30d"]
                cp["transit_pct_change"] = pw["pct_change_vs_baseline"]  # latest day vs baseline (acute signal)
                cp["transit_pct_change_7d"] = pw["pct_change_7d_vs_baseline"]  # 7d avg vs baseline (smoothed)
                cp["transit_7d_avg"] = pw["avg_7d"]
                cp["transit_containers"] = pw["latest_containers"]
                cp["transit_tankers"] = pw["latest_tankers"]
                cp["transit_date"] = pw["latest_date"]
                cp["transit_history_7d"] = pw["history_7d"]
                cp["alert_level"] = pw.get("alert_level")
                cp["alert_event"] = pw.get("alert_event")
                cp["reroute_active"] = pw.get("reroute_active", False)
                cp["reroute_via"] = pw.get("reroute_via")
                cp["reroute_days_low"] = pw.get("reroute_days_low")
                cp["reroute_days_high"] = pw.get("reroute_days_high")
                cp["reroute_note"] = pw.get("reroute_note")

    # ── Post-process: Stabilise procurement categories ──
    prev_data = load_previous_data()
    raw_cats = result.get("procurement_categories", [])
    result["procurement_categories"] = stabilise_risk_ratings(raw_cats, prev_data)

    # ── Post-process: Override LLM freight rates with FBX data ──
    if fbx_rates:
        # Build a lookup: route name → FBX rate dict
        fbx_lookup = {fr["route"]: fr for fr in fbx_rates}
        llm_freight = result.get("container_freight_rates", [])
        for entry in llm_freight:
            route_name = entry.get("route", "")
            if route_name in fbx_lookup:
                fbx = fbx_lookup[route_name]
                entry["rate_20ft"] = fbx["rate_20ft"]
                entry["rate_40ft"] = fbx["rate_40ft"]
                entry["change_7d"] = fbx["change_7d"]
                entry["source"] = "FBX"
                entry["fbx_ticker"] = fbx.get("fbx_ticker", "")
                if fbx.get("history_weekly"):
                    entry["history_weekly"] = fbx["history_weekly"]
            else:
                # No FBX lane (e.g. Jebel Ali → Rotterdam) — keep LLM estimate
                entry["source"] = "Estimated"
        print(f"  FBX override: {sum(1 for e in llm_freight if e.get('source') == 'FBX')}/"
              f"{len(llm_freight)} routes using live FBX rates")

    # ── Post-process: Override LLM KPIs with COMPUTED values ──
    kpi = result.get("kpi_summary", {})

    cats = result.get("procurement_categories", [])
    high_risk_count = sum(1 for c in cats if (c.get("risk", "")).upper() in ("H", "HIGH"))
    kpi["categories_at_high_risk"] = high_risk_count

    chokes = result.get("chokepoint_status", [])
    disrupted_count = sum(1 for cp in chokes if cp.get("status", "OPEN").upper() in ("DISRUPTED", "SEVERELY DISRUPTED"))
    kpi["active_chokepoint_disruptions"] = disrupted_count

    delays = [cp.get("delay_hours", 0) for cp in chokes if cp.get("delay_hours", 0) > 0]
    if delays:
        avg_delay_hours = sum(delays) / len(delays)
        kpi["avg_shipping_delay_days"] = round(avg_delay_hours / 24, 0)
    else:
        kpi["avg_shipping_delay_days"] = 0

    result["kpi_summary"] = kpi

    # Filter timeline events: remove any with future dates
    today_str = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    timeline = result.get("timeline_events", [])
    result["timeline_events"] = [
        ev for ev in timeline
        if (ev.get("date", "") or "") <= today_str
    ][:5]

    return result


def atomic_write_json(data: dict, path: str):
    """Write JSON atomically: write to temp file then rename.
    Prevents partial reads if the server reads data.json mid-write."""
    dir_name = os.path.dirname(path)
    try:
        fd, tmp_path = tempfile.mkstemp(suffix=".tmp", dir=dir_name)
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp_path, path)  # atomic on POSIX
    except Exception as e:
        print(f"  Atomic write failed: {e}")
        # Fallback to direct write
        with open(path, "w") as f:
            json.dump(data, f, indent=2)


# ═══════════════════════════════════════════════════════════════════════════════
# SPLIT REFRESH ARCHITECTURE
# ─────────────────────────────────────────────────────────────────────────────
# 1. price_refresh()  — Every 4 hours. Free API calls only (Yahoo, PortWatch,
#                       FBX, Google News). Updates commodity prices, chokepoint
#                       transits, freight rates, and news in data.json while
#                       PRESERVING the existing intelligence analysis.
#
# 2. full_refresh()   — Daily at 07:30 UK time. Runs price_refresh() first,
#                       then calls the LLM to regenerate the intelligence
#                       analysis. Stamps intelligence_timestamp so the app
#                       shows when the analysis was produced.
#
# This means prices stay fresh (≤4h lag) while the LLM is only called once
# per day — controlling Anthropic costs and reducing hallucination risk.
# ═══════════════════════════════════════════════════════════════════════════════


async def _fetch_all_sources():
    """Fetch all external data sources (no LLM). Returns dict of results."""
    print("Fetching commodity prices...")
    commodities = await fetch_commodities()
    print(f"  Got {len(commodities)} commodities")
    for c in commodities:
        print(f"    {c['name']}: {c['price']} {c['unit']} (24h: {c['change_24h']}%, 7d: {c['change_7d']}%)")

    print("Fetching chokepoint transit data (IMF PortWatch)...")
    chokepoint_data = await fetch_chokepoint_transit()

    print("Fetching FBX container freight rates...")
    fbx_rates = await fetch_fbx_rates()
    if fbx_rates:
        print(f"  Got {len(fbx_rates)} FBX lane rates")
    else:
        print("  FBX: No rates fetched — LLM will estimate all routes")

    print("Fetching news...")
    news = await fetch_news()
    print(f"  Got {len(news)} articles")

    return {
        "commodities": commodities,
        "chokepoint_data": chokepoint_data,
        "fbx_rates": fbx_rates,
        "news": news,
    }


async def price_refresh():
    """Lightweight refresh: update prices, freight, chokepoints, news.
    Preserves existing intelligence analysis from the last LLM run.
    Called every 4 hours."""
    data_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.json")
    print("[PRICE-REFRESH] Starting price-only refresh...")

    try:
        sources = await _fetch_all_sources()
        commodities = sources["commodities"]
        chokepoint_data = sources["chokepoint_data"]
        fbx_rates = sources["fbx_rates"]
        news = sources["news"]

        # Guard: if ALL sources failed, don't overwrite
        if not commodities and not chokepoint_data and not news:
            print("[PRICE-REFRESH] All sources failed — keeping existing data.json")
            return

        # Load existing data to preserve intelligence
        prev = load_previous_data()
        if prev and prev.get("status") == "ok":
            # Update only the price/market data fields
            prev["commodities"] = commodities if commodities else prev.get("commodities", [])
            prev["timestamp"] = datetime.now(timezone.utc).isoformat()
            prev["raw_news_count"] = len(news) if news else prev.get("raw_news_count", 0)
            # intelligence, intelligence_timestamp stay untouched

            # Update FBX rates inside intelligence if we have new ones
            if fbx_rates and prev.get("intelligence"):
                fbx_lookup = {fr["route"]: fr for fr in fbx_rates}
                for entry in prev["intelligence"].get("container_freight_rates", []):
                    route_name = entry.get("route", "")
                    if route_name in fbx_lookup:
                        fbx = fbx_lookup[route_name]
                        entry["rate_20ft"] = fbx["rate_20ft"]
                        entry["rate_40ft"] = fbx["rate_40ft"]
                        entry["change_7d"] = fbx["change_7d"]
                        entry["source"] = "FBX"
                        if fbx.get("history_weekly"):
                            entry["history_weekly"] = fbx["history_weekly"]

            # Update chokepoint transit data inside intelligence
            if chokepoint_data and prev.get("intelligence"):
                for cp in prev["intelligence"].get("chokepoint_status", []):
                    cp_name = cp.get("name", "")
                    if cp_name in chokepoint_data:
                        pw = chokepoint_data[cp_name]
                        cp["status"] = pw["status"]
                        cp["delay_hours"] = pw["delay_hours"]
                        cp["transit_latest"] = pw["latest_transits"]
                        cp["transit_baseline"] = pw["baseline_avg_30d"]
                        cp["transit_pct_change"] = pw["pct_change_vs_baseline"]
                        cp["transit_pct_change_7d"] = pw["pct_change_7d_vs_baseline"]
                        cp["transit_7d_avg"] = pw["avg_7d"]
                        cp["transit_containers"] = pw["latest_containers"]
                        cp["transit_tankers"] = pw["latest_tankers"]
                        cp["transit_date"] = pw["latest_date"]
                        cp["transit_history_7d"] = pw["history_7d"]
                        cp["alert_level"] = pw.get("alert_level")
                        cp["alert_event"] = pw.get("alert_event")
                        cp["reroute_active"] = pw.get("reroute_active", False)
                        cp["reroute_via"] = pw.get("reroute_via")
                        cp["reroute_days_low"] = pw.get("reroute_days_low")
                        cp["reroute_days_high"] = pw.get("reroute_days_high")
                        cp["reroute_note"] = pw.get("reroute_note")

                # Recompute chokepoint-derived KPIs
                kpi = prev["intelligence"].get("kpi_summary", {})
                chokes = prev["intelligence"].get("chokepoint_status", [])
                disrupted_count = sum(1 for c in chokes if c.get("status", "OPEN").upper() in ("DISRUPTED", "SEVERELY DISRUPTED"))
                kpi["active_chokepoint_disruptions"] = disrupted_count
                delays = [c.get("delay_hours", 0) for c in chokes if c.get("delay_hours", 0) > 0]
                kpi["avg_shipping_delay_days"] = round(sum(delays) / len(delays) / 24, 0) if delays else 0
                prev["intelligence"]["kpi_summary"] = kpi

            atomic_write_json(prev, data_path)
            print(f"[PRICE-REFRESH] Updated prices in data.json (intelligence preserved)")
        else:
            # No previous data — this shouldn't happen in normal operation,
            # but handle gracefully. Write a minimal data file so the app works.
            print("[PRICE-REFRESH] No existing data.json — writing prices only")
            atomic_write_json({
                "status": "ok",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "commodities": commodities,
                "intelligence": {},
                "raw_news_count": len(news),
                "_note": "Price-only refresh — intelligence analysis pending next LLM run",
            }, data_path)

    except Exception as e:
        print(f"[PRICE-REFRESH] Error: {e}")
        import traceback
        traceback.print_exc()


async def full_refresh():
    """Full refresh: fetch all sources + call LLM for intelligence analysis.
    Called daily at 07:30 UK time."""
    data_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.json")
    print("[FULL-REFRESH] Starting full intelligence refresh...")

    # Validate Anthropic API key
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key or len(api_key) < 10:
        error_msg = "ANTHROPIC_API_KEY is missing or invalid"
        print(f"  FATAL: {error_msg}")
        atomic_write_json({
            "status": "error",
            "message": error_msg,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }, data_path)
        return

    try:
        sources = await _fetch_all_sources()
        commodities = sources["commodities"]
        chokepoint_data = sources["chokepoint_data"]
        fbx_rates = sources["fbx_rates"]
        news = sources["news"]

        # Guard: if ALL external sources failed, carry forward previous data
        if not commodities and not chokepoint_data and not news:
            print("  WARNING: All external data sources failed")
            prev = load_previous_data()
            if prev and prev.get("status") == "ok":
                print("  Carrying forward previous data.json (all sources failed)")
                prev["_stale_warning"] = "All external sources failed during refresh — data carried forward from previous cycle"
                atomic_write_json(prev, data_path)
                return
            else:
                atomic_write_json({
                    "status": "error",
                    "message": "All data sources unavailable and no previous data to carry forward",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }, data_path)
                return

        print("Generating intelligence brief...")
        intelligence = call_llm(commodities, news, chokepoint_data, fbx_rates=fbx_rates)
        print(f"  Risk: {intelligence.get('overall_risk')}")
        print(f"  Categories: {len(intelligence.get('procurement_categories', []))}")

        # Log stabilisation results
        for cat in intelligence.get("procurement_categories", []):
            consec = cat.get("_consecutive_lower", 0)
            marker = " (held — awaiting confirmation)" if consec > 0 else ""
            print(f"    {cat['name']:45s} Risk: {cat.get('risk','?')}{marker}")

        now = datetime.now(timezone.utc)
        output = {
            "status": "ok",
            "timestamp": now.isoformat(),
            "intelligence_timestamp": now.isoformat(),
            "commodities": commodities,
            "intelligence": intelligence,
            "raw_news_count": len(news),
            "data_sources": {
                "commodities": "Yahoo Finance, Investing.com (JKM Platts Futures)",
                "freight_rates": "Freightos Baltic Index (FBX)" if fbx_rates else "LLM-estimated",
                "chokepoints": "IMF PortWatch (AIS vessel transit data)",
                "news": "Google News RSS",
                "analysis": "Claude AI (Anthropic)",
            },
        }

        atomic_write_json(output, data_path)
        print(f"[FULL-REFRESH] Saved to data.json ({len(json.dumps(output))} bytes)")

    except Exception as e:
        print(f"  CRITICAL ERROR in full refresh: {e}")
        import traceback
        traceback.print_exc()
        prev = load_previous_data()
        if prev and prev.get("status") == "ok":
            print("  Carrying forward previous data.json after crash")
            prev["_stale_warning"] = f"Data generation failed ({type(e).__name__}). Carried forward from previous cycle."
            atomic_write_json(prev, data_path)
        else:
            atomic_write_json({
                "status": "error",
                "message": f"Data generation failed: {type(e).__name__}: {str(e)[:200]}",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }, data_path)


async def main():
    """Entry point: runs a full refresh (prices + LLM intelligence).
    Used on startup and can be called directly: python generate_data.py"""
    await full_refresh()


if __name__ == "__main__":
    asyncio.run(main())

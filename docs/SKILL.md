---
name: intel-brief-skill
description: >
  Optimises Claude API responses for the Daily Geopolitical & Energy Procurement Intelligence Brief web application.
  Use when generating structured JSON intelligence briefs for a tobacco CPO procurement dashboard.
  Covers output schema enforcement, hallucination prevention, data validation, token efficiency, and domain-specific
  grounding for energy markets, shipping, and tobacco supply chain procurement categories.
license: MIT
metadata:
  author: amuradd1
  version: '1.0'
  app: Daily Geopolitical & Energy Procurement Intelligence Brief
  target-model: claude-sonnet-4-20250514
---

# Intelligence Brief API Optimisation Skill

## Purpose

This skill optimises Claude API calls for the **Daily Geopolitical & Energy Procurement Intelligence Brief** — a production web dashboard that refreshes every 24 hours, fetching live commodity prices and news, then calling Claude to produce a structured JSON intelligence brief for the Chief Procurement Officer (CPO) of a global tobacco company.

The goal is to maximise output quality, minimise hallucination risk, reduce token waste, and ensure the JSON response parses cleanly every time.

---

## Architecture Context

```
Data Flow:
  Yahoo Finance API ──┐
                      ├──▶ generate_data.py ──▶ Claude API ──▶ data.json ──▶ FastAPI ──▶ Frontend
  Google News RSS ────┘

Key constraints:
  - Single LLM call per 24h refresh cycle (cost control)
  - Response must be valid JSON (no markdown fences, no trailing commas)
  - Response is parsed directly by json.loads() — any malformation breaks the dashboard
  - Frontend renders every field — missing keys cause empty UI sections
  - Timeout: 300 seconds
  - Max tokens: 8192
```

---

## Optimisation 1: System Prompt Design

### Current approach (user message only)
The app currently sends everything in a single user message. Moving to a system + user split improves consistency.

### Recommended: Split into system prompt + user message

**System prompt** (set once, cached by Anthropic's prompt caching):

```python
SYSTEM_PROMPT = """You are a senior geopolitical and energy risk analyst producing daily intelligence
briefs for the Chief Procurement Officer (CPO) of a global tobacco company.

<role>
- You analyse ONLY the data provided to you. Never fabricate prices, percentages, or events.
- If data is missing or ambiguous, say "Data unavailable" rather than estimating.
- Your tone is informational — no directives, no "should", no "recommend", no "action required".
- Category teams handle operational actions. The CPO needs situational awareness only.
</role>

<output_rules>
- Respond with ONLY valid JSON. No markdown fences, no commentary, no trailing text.
- Every numeric value must come directly from the provided commodity data.
- The "executive_summary" field must be a JSON array of exactly 5 strings.
- Each procurement category must include all 6 fields: name, energy_sensitivity, supply_route_exposure, risk, rationale, suggested_mitigation.
- Risk ratings use single letters: "H", "M", or "L".
- Chokepoint status values: "OPEN", "RESTRICTED", or "CLOSED".
- The "suggested_mitigation" field must describe GENERAL strategic approaches only — never name specific countries, suppliers, or sourcing locations.
- Include exactly 5 top_stories with URLs from the provided news data.
- Include 5-7 timeline_events.
- Do NOT prefix executive_summary bullets with numbers or labels.
</output_rules>

<domain_knowledge>
Tobacco procurement categories and their energy/supply chain exposures:

1. Cellulose Acetate Filter Tow — acetic acid feedstock from methanol/natural gas, energy-intensive production
2. Cigarette Packaging (Board & Print) — paperboard converting, print energy costs
3. Flexible Packaging & Foils — BOPP film, aluminium foil, metallised film, energy-intensive converting
4. Flavors & Ingredients — menthol, glycerin, propylene glycol, nicotine extract; diverse global origins
5. Heated Tobacco Devices & Consumables — device assembly in China/SEA, electronic components
6. E-Cigarettes & Vape Devices — Shenzhen-centric production, batteries, PCBA, lithium supply
7. Nicotine Pouches — nicotine salt sourcing, pouch materials, distribution routes

Key chokepoints: Strait of Hormuz, Bab el-Mandeb / Red Sea, Suez Canal, Malacca Strait
Key risk regions: Middle East, Red Sea, South China Sea, Black Sea

The CPO's concerns:
- Energy-driven COGS pressure (acetate production, converting, logistics)
- Supply route disruptions affecting inbound material flows
- Supplier risk and force majeure exposure
- Market conditions affecting forward pricing
- Shipping cost movements and container/bulk freight rate trends
</domain_knowledge>"""
```

**User message** (changes every refresh with live data):

```python
USER_PROMPT = f"""Today is {today}.

<commodity_prices>
{json.dumps(trimmed_commodities, indent=2)}
</commodity_prices>

<news_headlines>
{json.dumps(trimmed_news, indent=2)}
</news_headlines>

Produce the intelligence brief as JSON matching the schema below. Use EXACT prices from the commodity data.

<output_schema>
{{
  "executive_summary": ["string", "string", "string", "string", "string"],
  "overall_risk": "HIGH | MEDIUM | LOW",
  "commodity_drivers": "string",
  "analyst_outlook": "string",
  "procurement_categories": [
    {{
      "name": "string",
      "energy_sensitivity": "H | M | L",
      "supply_route_exposure": "string",
      "risk": "H | M | L",
      "rationale": "string",
      "suggested_mitigation": "string"
    }}
  ],
  "chokepoint_status": [
    {{
      "name": "string",
      "status": "OPEN | RESTRICTED | CLOSED",
      "delay_hours": 0,
      "detail": "string"
    }}
  ],
  "shipping_alerts": ["string"],
  "top_stories": [
    {{
      "headline": "string",
      "source": "string",
      "summary": "string",
      "relevance": "HIGH | MEDIUM | LOW",
      "url": "string"
    }}
  ],
  "timeline_events": [
    {{
      "date": "YYYY-MM-DD",
      "event": "string",
      "severity": "HIGH | MEDIUM | LOW"
    }}
  ],
  "risk_heatmap": [
    {{
      "region": "string",
      "risk": "HIGH | MEDIUM | LOW",
      "detail": "string"
    }}
  ]
}}
</output_schema>"""
```

### Why this is better

| Benefit | Detail |
|---------|--------|
| **Prompt caching** | Anthropic caches system prompts after the first call. The ~1,500-token system prompt is cached, reducing input token costs by ~90% on subsequent calls. |
| **Cleaner separation** | Static instructions (role, rules, domain knowledge) don't compete with dynamic data for attention. |
| **XML tags** | Wrapping data in `<commodity_prices>` and `<news_headlines>` tags gives Claude clear structural boundaries. |
| **Schema-first** | Providing the output schema explicitly (not embedded in prose) reduces formatting drift. |

---

## Optimisation 2: Prompt Caching Setup

Enable prompt caching to reduce costs on the system prompt:

```python
message = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=8192,
    system=[
        {
            "type": "text",
            "text": SYSTEM_PROMPT,
            "cache_control": {"type": "ephemeral"}
        }
    ],
    messages=[{"role": "user", "content": USER_PROMPT}],
)
```

With a 24h refresh cycle, caching won't help across refreshes (cache TTL is ~5 minutes). But it protects against retries — if the first call fails or returns malformed JSON and you retry, the system prompt is already cached.

---

## Optimisation 3: Structured JSON Enforcement

### Option A: Prefill technique (recommended for Sonnet)

Force Claude to start its response with `{` by prefilling the assistant turn:

```python
message = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=8192,
    system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
    messages=[
        {"role": "user", "content": USER_PROMPT},
        {"role": "assistant", "content": "{"}
    ],
)
# Prepend the "{" back since Claude continues from it
text = "{" + message.content[0].text
result = json.loads(text)
```

This eliminates any risk of Claude prefixing with ```json or commentary.

### Option B: Post-processing fallback (already implemented)

The current `generate_data.py` already strips markdown fences and attempts JSON recovery. Keep this as a safety net even with prefill.

---

## Optimisation 4: Hallucination Prevention

### Price anchoring

The biggest hallucination risk is Claude inventing price figures. Mitigate by:

1. **Explicit instruction**: "Use EXACT prices from the provided data. Do not round, estimate, or invent figures."
2. **Validation after parsing**: Compare prices in the response against the input data.

```python
def validate_prices(llm_output, input_commodities):
    """Check that LLM didn't hallucinate commodity prices."""
    input_prices = {c["name"]: c["price"] for c in input_commodities}
    exec_summary = " ".join(llm_output.get("executive_summary", []))
    drivers = llm_output.get("commodity_drivers", "")
    outlook = llm_output.get("analyst_outlook", "")
    combined_text = exec_summary + drivers + outlook

    warnings = []
    for name, price in input_prices.items():
        price_str = f"{price:.2f}"
        # If the commodity is mentioned but with wrong price, flag it
        short_name = name.split("(")[0].strip()
        if short_name.lower() in combined_text.lower():
            if price_str not in combined_text:
                # Check if it's just a rounding difference
                rounded = f"{price:.0f}"
                if rounded not in combined_text:
                    warnings.append(f"Price mismatch for {name}: expected {price_str}")

    return warnings
```

### Schema completeness check

```python
REQUIRED_KEYS = [
    "executive_summary", "overall_risk", "commodity_drivers", "analyst_outlook",
    "procurement_categories", "chokepoint_status", "shipping_alerts",
    "top_stories", "timeline_events", "risk_heatmap"
]

REQUIRED_CATEGORY_KEYS = [
    "name", "energy_sensitivity", "supply_route_exposure", "risk", "rationale", "suggested_mitigation"
]

EXPECTED_CATEGORIES = [
    "Cellulose Acetate Filter Tow",
    "Cigarette Packaging (Board & Print)",
    "Flexible Packaging & Foils",
    "Flavors & Ingredients",
    "Heated Tobacco Devices & Consumables",
    "E-Cigarettes & Vape Devices",
    "Nicotine Pouches"
]

def validate_schema(data):
    """Validate the LLM output has all required fields."""
    errors = []

    for key in REQUIRED_KEYS:
        if key not in data:
            errors.append(f"Missing top-level key: {key}")

    # Executive summary must be array of 5
    es = data.get("executive_summary", [])
    if not isinstance(es, list):
        errors.append("executive_summary must be an array")
    elif len(es) != 5:
        errors.append(f"executive_summary has {len(es)} items, expected 5")

    # Procurement categories
    cats = data.get("procurement_categories", [])
    if len(cats) != 7:
        errors.append(f"procurement_categories has {len(cats)} items, expected 7")
    for cat in cats:
        for key in REQUIRED_CATEGORY_KEYS:
            if key not in cat:
                errors.append(f"Category '{cat.get('name', '?')}' missing key: {key}")

    # Check category names match expected
    cat_names = [c.get("name", "") for c in cats]
    for expected in EXPECTED_CATEGORIES:
        if expected not in cat_names:
            errors.append(f"Missing expected category: {expected}")

    # Chokepoints
    cps = data.get("chokepoint_status", [])
    if len(cps) < 4:
        errors.append(f"chokepoint_status has {len(cps)} items, expected 4")

    # Risk values
    valid_risk = {"HIGH", "MEDIUM", "LOW", "H", "M", "L"}
    if data.get("overall_risk", "").upper() not in valid_risk:
        errors.append(f"Invalid overall_risk: {data.get('overall_risk')}")

    return errors
```

### Retry on validation failure

```python
MAX_RETRIES = 2

async def generate_intelligence(commodities, news):
    for attempt in range(MAX_RETRIES + 1):
        try:
            result = call_llm(commodities, news)
            schema_errors = validate_schema(result)
            price_warnings = validate_prices(result, commodities)

            if schema_errors:
                print(f"  Attempt {attempt + 1}: Schema errors: {schema_errors}")
                if attempt < MAX_RETRIES:
                    continue
                # On final attempt, return what we have

            if price_warnings:
                print(f"  Price warnings: {price_warnings}")
                # Log but don't retry — price mentions may be paraphrased

            return result

        except json.JSONDecodeError as e:
            print(f"  Attempt {attempt + 1}: JSON parse error: {e}")
            if attempt == MAX_RETRIES:
                raise

    return result
```

---

## Optimisation 5: Token Efficiency

### Current token usage estimate

| Component | Tokens (approx) |
|-----------|-----------------|
| System prompt (role + rules + domain) | ~1,500 |
| Commodity data (6-7 items) | ~400 |
| News headlines (8 items) | ~600 |
| Output schema | ~500 |
| **Total input** | **~3,000** |
| Output (full JSON brief) | ~3,500-4,500 |
| **Total per call** | **~6,500-7,500** |

### Reduction strategies

1. **Trim news fields**: Only send `title` and `source` — drop `url` from input (it's just for Claude to echo back, not analyse). Instead, pass a mapping and inject URLs post-hoc:

```python
# Before LLM call: strip URLs from news, keep a mapping
news_with_ids = []
url_map = {}
for i, article in enumerate(news[:8]):
    news_with_ids.append({"id": i, "title": article["title"], "source": article["source"]})
    url_map[i] = article.get("url", "")

# After LLM call: inject URLs back into top_stories
for story in result.get("top_stories", []):
    # Match by headline similarity
    for article in news[:8]:
        if article["title"][:40] in story.get("headline", ""):
            story["url"] = article.get("url", "")
            break
```

2. **Compress commodity data**: Send minimal fields:

```python
trimmed = [{"n": c["name"], "p": c["price"], "u": c["unit"],
            "d": c["change_24h"], "w": c["change_7d"]} for c in commodities]
```

Then instruct Claude: "Fields: n=name, p=price, u=unit, d=24h change %, w=7d change %"

3. **Set max_tokens to 6000** instead of 8192 — the response rarely exceeds 4,500 tokens, and a lower cap signals Claude to be more concise.

---

## Optimisation 6: Error Handling & Resilience

### Timeout handling

```python
from anthropic import Anthropic, APITimeoutError, APIError

client = Anthropic(timeout=300.0)

try:
    message = client.messages.create(...)
except APITimeoutError:
    print("Claude API timed out after 300s")
    # Return cached data.json if available, mark as stale
except APIError as e:
    print(f"Claude API error: {e.status_code} {e.message}")
    # Return cached data with error flag
```

### Graceful degradation

If the LLM call fails entirely, serve the last valid `data.json` with a staleness indicator:

```python
import os
import time

def get_data_with_staleness(data_path):
    if not os.path.exists(data_path):
        return {"status": "generating", "message": "First-time data generation in progress..."}

    with open(data_path) as f:
        data = json.load(f)

    # Add staleness check
    timestamp = data.get("timestamp", "")
    if timestamp:
        from datetime import datetime, timezone
        generated = datetime.fromisoformat(timestamp)
        age_hours = (datetime.now(timezone.utc) - generated).total_seconds() / 3600
        data["stale"] = age_hours > 26  # Flag if older than 26h (24h + 2h buffer)
        data["age_hours"] = round(age_hours, 1)

    return data
```

---

## Optimisation 7: Updated generate_data.py Template

Here is the recommended refactored `call_llm` function incorporating all optimisations:

```python
import json
import time
from anthropic import Anthropic, APITimeoutError, APIError

SYSTEM_PROMPT = """You are a senior geopolitical and energy risk analyst producing daily intelligence
briefs for the Chief Procurement Officer (CPO) of a global tobacco company.

<role>
You analyse ONLY the data provided. Never fabricate prices, percentages, or events.
If data is missing or ambiguous, state "Data unavailable" rather than estimating.
Tone: informational only. No directives, no "should", no "recommend".
</role>

<output_rules>
- Valid JSON only. No markdown fences, no commentary before or after.
- executive_summary: array of exactly 5 strings, no numbering or prefixes.
- Risk ratings: "H", "M", or "L" for categories; "HIGH", "MEDIUM", or "LOW" for overall.
- Chokepoint status: "OPEN", "RESTRICTED", or "CLOSED".
- suggested_mitigation: general strategic approaches only, never specific countries/suppliers.
- 5 top_stories with real URLs from news data. 5-7 timeline_events.
- Use EXACT prices and percentage changes from commodity data.
</output_rules>

<domain_context>
Tobacco procurement categories: Cellulose Acetate Filter Tow, Cigarette Packaging (Board & Print),
Flexible Packaging & Foils, Flavors & Ingredients, Heated Tobacco Devices & Consumables,
E-Cigarettes & Vape Devices, Nicotine Pouches.

Chokepoints: Strait of Hormuz, Bab el-Mandeb / Red Sea, Suez Canal, Malacca Strait.
Risk regions: Middle East, Red Sea, South China Sea, Black Sea.

CPO concerns: energy-driven COGS pressure, supply route disruptions, supplier force majeure,
forward pricing conditions, shipping/freight rate trends.
</domain_context>"""


def call_llm(commodities, news, today):
    client = Anthropic(timeout=300.0)

    trimmed_c = [{"name": c["name"], "price": c["price"], "unit": c["unit"],
                  "change_24h": c["change_24h"], "change_7d": c["change_7d"]}
                 for c in commodities]
    trimmed_n = [{"title": n["title"], "source": n["source"], "url": n.get("url", "")}
                 for n in news[:8]]

    user_msg = f"""Today is {today}.

<commodity_prices>
{json.dumps(trimmed_c, indent=2)}
</commodity_prices>

<news_headlines>
{json.dumps(trimmed_n, indent=2)}
</news_headlines>

Produce the intelligence brief JSON. Use exact prices from the data above."""

    print("  Calling Claude API...")
    start = time.time()

    try:
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=6000,
            system=[{
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"}
            }],
            messages=[
                {"role": "user", "content": user_msg},
                {"role": "assistant", "content": "{"}
            ],
        )
    except APITimeoutError:
        print("  Claude API timed out")
        raise
    except APIError as e:
        print(f"  Claude API error: {e}")
        raise

    elapsed = time.time() - start
    print(f"  Response in {elapsed:.1f}s | Input: {message.usage.input_tokens} | Output: {message.usage.output_tokens}")

    # Reconstruct JSON (we prefilled with "{")
    text = "{" + message.content[0].text.strip()

    # Strip markdown fences if present (safety net)
    if text.startswith("```"):
        text = "\n".join(text.split("\n")[1:])
        if text.endswith("```"):
            text = text[:-3].strip()

    return json.loads(text)
```

---

## Optimisation 8: Cost Monitoring

Track API costs per refresh to catch anomalies:

```python
# After each LLM call
input_cost = message.usage.input_tokens * 0.003 / 1000   # Sonnet input pricing
output_cost = message.usage.output_tokens * 0.015 / 1000  # Sonnet output pricing
cached_input = getattr(message.usage, 'cache_read_input_tokens', 0)
cache_savings = cached_input * (0.003 - 0.0003) / 1000    # 90% savings on cached

total = input_cost + output_cost - cache_savings
print(f"  Cost: ${total:.4f} (in: ${input_cost:.4f}, out: ${output_cost:.4f}, cache saved: ${cache_savings:.4f})")
```

At 1 call per 24h with ~3,000 input + ~4,000 output tokens on Sonnet, expect roughly **$0.07/day** or **~$2/month**.

---

## Quick Reference: Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `ANTHROPIC_API_KEY` | Yes | — | Claude API authentication |
| `ANTHROPIC_MODEL` | No | `claude-sonnet-4-20250514` | Model override |
| `PORT` | No | `8000` | Server port (Railway injects this) |

---

## Checklist Before Deployment

- [ ] `ANTHROPIC_API_KEY` set in Railway environment variables
- [ ] System prompt uses `cache_control` for retry efficiency
- [ ] Assistant prefill `{` forces clean JSON output
- [ ] `validate_schema()` runs after every LLM parse
- [ ] `max_tokens` set to 6000 (not 8192)
- [ ] Timeout set to 300s
- [ ] Stale data fallback implemented (serve last valid data.json)
- [ ] Cost logging enabled to track per-refresh spend

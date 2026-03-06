/* app.js — Daily Geopolitical & Energy Procurement Intelligence Brief */
/* global renderSupplyChainMap, html2pdf, lucide, Chart */

var API_BASE = "";  // Railway: same origin, relative paths
var sparkCharts = [];

// ─── Theme Toggle ───
(function() {
  var toggle = document.querySelector('[data-theme-toggle]');
  var root = document.documentElement;
  var theme = 'dark'; // Default to dark for this dashboard
  root.setAttribute('data-theme', theme);
  if (toggle) {
    toggle.addEventListener('click', function() {
      theme = theme === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', theme);
      toggle.setAttribute('aria-label', 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' mode');
      toggle.innerHTML = theme === 'dark'
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
      // Redraw sparklines with new theme colors
      if (window._lastData) { renderCommodities(window._lastData.commodities); }
    });
  }
})();

// ─── Init Lucide Icons ───
lucide.createIcons();

// ─── Helpers ───
function formatChange(val) {
  if (val === null || val === undefined) { return '<span class="change-flat">—</span>'; }
  var cls = val > 0 ? 'change-positive' : val < 0 ? 'change-negative' : 'change-flat';
  var arrow = val > 0 ? '▲' : val < 0 ? '▼' : '—';
  return '<span class="' + cls + '">' + arrow + ' ' + Math.abs(val).toFixed(2) + '%</span>';
}

function formatTime(isoStr) {
  if (!isoStr) { return '—'; }
  try {
    var d = new Date(isoStr);
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  } catch (e) { return isoStr; }
}

function riskClass(level) {
  if (!level) { return 'medium'; }
  var l = level.toLowerCase();
  if (l === 'h' || l === 'high') { return 'high'; }
  if (l === 'l' || l === 'low') { return 'low'; }
  return 'medium';
}

// ─── Render Functions ───

function renderKPIStrip(intel) {
  var container = document.getElementById('kpiStrip');
  if (!intel || !intel.kpi_summary) {
    container.innerHTML = '';
    return;
  }
  var kpi = intel.kpi_summary;

  // Parse energy_cost_trend to separate direction and reason
  var energyDir = 'STABLE';
  var energyReason = '';
  if (kpi.energy_cost_trend) {
    var parts = kpi.energy_cost_trend.split('—');
    if (parts.length < 2) { parts = kpi.energy_cost_trend.split(' - '); }
    if (parts.length < 2) { parts = kpi.energy_cost_trend.split(' – '); }
    energyDir = (parts[0] || '').trim();
    energyReason = (parts[1] || '').trim();
  }

  function trendIcon(dir) {
    var d = (dir || '').toUpperCase();
    if (d === 'UP' || d === 'SEVERE') { return '<span class="kpi-trend trend-up">▲</span>'; }
    if (d === 'DOWN' || d === 'MINIMAL') { return '<span class="kpi-trend trend-down">▼</span>'; }
    return '<span class="kpi-trend trend-stable">●</span>';
  }

  function disruptionClass(level) {
    var l = (level || '').toUpperCase();
    if (l === 'SEVERE') return 'trend-up';
    if (l === 'MINIMAL') return 'trend-down';
    return 'trend-stable';
  }

  var cards = [
    { label: 'COGS Pressure', value: kpi.overall_cogs_pressure || 'STABLE', icon: trendIcon(kpi.overall_cogs_pressure) },
    { label: 'Energy Trend', value: energyDir, icon: trendIcon(energyDir), sub: energyReason },
    { label: 'Supply Chain Disruption', value: kpi.supply_chain_disruption_level || 'MODERATE', icon: '<span class="kpi-trend ' + disruptionClass(kpi.supply_chain_disruption_level) + '">●</span>' },
    { label: 'Avg Shipping Delay', value: (kpi.avg_shipping_delay_days != null ? kpi.avg_shipping_delay_days + 'd' : '—'), icon: '' },
    { label: 'Chokepoint Disruptions', value: (kpi.active_chokepoint_disruptions != null ? kpi.active_chokepoint_disruptions + ' / 4' : '—'), icon: '' },
    { label: 'High-Risk Categories', value: (kpi.categories_at_high_risk != null ? kpi.categories_at_high_risk + ' / 8' : '—'), icon: '' }
  ];

  var html = '';
  cards.forEach(function(c) {
    html += '<div class="kpi-card">' +
      '<div class="kpi-value">' + c.icon + ' ' + c.value + '</div>' +
      '<div class="kpi-label">' + c.label + '</div>' +
      (c.sub ? '<div class="kpi-sub">' + c.sub + '</div>' : '') +
    '</div>';
  });
  container.innerHTML = html;
}

function renderExecBanner(intel, timestamp, nextRefresh) {
  var summary = document.getElementById('execSummary');
  var badge = document.getElementById('riskBadge');
  var label = document.getElementById('riskLabel');
  var dot = badge.querySelector('.risk-dot');
  var tsLabel = document.getElementById('timestampLabel');
  var nrLabel = document.getElementById('nextRefreshLabel');

  // Handle both array (bullet) and string formats
  if (Array.isArray(intel.executive_summary)) {
    var html = '<ul class="exec-bullets">';
    intel.executive_summary.forEach(function(bullet) {
      html += '<li>' + bullet + '</li>';
    });
    html += '</ul>';
    summary.innerHTML = html;
  } else {
    summary.textContent = intel.executive_summary || 'No summary available.';
  }

  var risk = riskClass(intel.overall_risk);
  badge.className = 'risk-badge ' + risk;
  dot.className = 'risk-dot ' + risk;
  label.textContent = (intel.overall_risk || 'MEDIUM') + ' RISK';

  tsLabel.textContent = 'Updated: ' + formatTime(timestamp);
  nrLabel.textContent = 'Next refresh: ' + formatTime(nextRefresh);
}

function drawSparkline(canvasId, dataPoints, isPositive) {
  var canvas = document.getElementById(canvasId);
  if (!canvas) { return; }
  var ctx = canvas.getContext('2d');
  canvas.width = 120;
  canvas.height = 32;

  var root = getComputedStyle(document.documentElement);
  var lineColor = isPositive ? (root.getPropertyValue('--color-up').trim() || '#22c55e') : (root.getPropertyValue('--color-down').trim() || '#ef4444');
  if (dataPoints.length < 2) {
    lineColor = root.getPropertyValue('--color-flat').trim() || '#94a3b8';
  }

  var chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dataPoints.map(function(_, i) { return i; }),
      datasets: [{
        data: dataPoints,
        borderColor: lineColor,
        borderWidth: 1.5,
        fill: false,
        pointRadius: 0,
        tension: 0.3
      }]
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false },
        y: { display: false }
      },
      animation: { duration: 600 }
    }
  });
  sparkCharts.push(chart);
}

function renderCommodities(commodities) {
  // Destroy old sparkline charts
  sparkCharts.forEach(function(c) { c.destroy(); });
  sparkCharts = [];

  var body = document.getElementById('commodityBody');
  if (!commodities || commodities.length === 0) {
    body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--color-text-faint);padding:var(--space-6)">No commodity data available</td></tr>';
    return;
  }

  var html = '';
  commodities.forEach(function(c, i) {
    var canvasId = 'spark-' + i;
    html += '<tr>' +
      '<td><span class="commodity-name">' + c.name + '</span></td>' +
      '<td><span class="commodity-price">' + c.price.toFixed(2) + '</span> <span style="font-size:var(--text-xs);color:var(--color-text-faint)">' + c.unit + '</span></td>' +
      '<td>' + formatChange(c.change_24h) + '</td>' +
      '<td>' + formatChange(c.change_7d) + '</td>' +
      '<td class="sparkline-cell"><canvas id="' + canvasId + '" width="120" height="32"></canvas></td>' +
    '</tr>';
  });
  body.innerHTML = html;

  // Draw sparklines after DOM update (double rAF ensures layout is complete)
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      commodities.forEach(function(c, i) {
        if (c.history && c.history.length > 1) {
          drawSparkline('spark-' + i, c.history, c.change_7d >= 0);
        }
      });
    });
  });
}

function renderFreightRates(rates) {
  var body = document.getElementById('freightBody');
  if (!rates || rates.length === 0) {
    body.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--color-text-faint);padding:var(--space-6)">No freight data available</td></tr>';
    return;
  }

  var html = '';
  rates.forEach(function(r) {
    var changeStr = r.change_7d || '—';
    var isUp = changeStr.indexOf('+') !== -1;
    var isDown = changeStr.indexOf('-') !== -1;
    // For freight: price UP = bad (red), price DOWN = good (green)
    var changeCls = isUp ? 'change-negative' : (isDown ? 'change-positive' : 'change-flat');
    html += '<tr>' +
      '<td><span class="freight-route">' + r.route + '</span></td>' +
      '<td><span class="freight-rate">' + (r.rate_20ft || '—') + '</span></td>' +
      '<td><span class="' + changeCls + '">' + changeStr + '</span></td>' +
      '<td><span class="freight-impact">' + (r.conflict_impact || '—') + '</span></td>' +
    '</tr>';
  });
  body.innerHTML = html;
}

function renderNews(stories) {
  var container = document.getElementById('newsStories');
  if (!stories || stories.length === 0) {
    container.innerHTML = '<p style="color:var(--color-text-faint);padding:var(--space-4)">No recent stories.</p>';
    return;
  }

  var html = '<div class="news-stories-grid">';
  stories.slice(0, 3).forEach(function(s) {
    var relClass = riskClass(s.relevance);
    html += '<div class="story-item">' +
      '<div class="story-meta">' +
        '<span class="story-source">' + (s.source || 'Unknown') + '</span>' +
        '<span class="story-relevance risk-badge ' + relClass + '">' + (s.relevance || 'MEDIUM') + '</span>' +
      '</div>' +
      '<div class="story-headline"><a href="' + (s.url || '#') + '" target="_blank" rel="noopener noreferrer">' + s.headline + '</a></div>' +
      '<div class="story-summary">' + (s.summary || '') + '</div>' +
    '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

function renderTimeline(events) {
  var container = document.getElementById('timeline');
  if (!events || events.length === 0) {
    container.innerHTML = '<p style="color:var(--color-text-faint);padding:var(--space-4)">No timeline events.</p>';
    return;
  }

  var html = '';
  events.slice(0, 5).forEach(function(ev) {
    var sev = riskClass(ev.severity);
    var dateStr = ev.date || '';
    try {
      var d = new Date(ev.date);
      dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    } catch (e) { /* keep original */ }
    html += '<div class="timeline-item">' +
      '<div class="timeline-dot ' + sev + '"></div>' +
      '<div class="timeline-date">' + dateStr + '</div>' +
      '<div class="timeline-text">' + ev.event + '</div>' +
    '</div>';
  });
  container.innerHTML = html;
}

function renderChokepoints(chokepoints) {
  var container = document.getElementById('chokepoints');
  if (!chokepoints || chokepoints.length === 0) {
    container.innerHTML = '<p style="color:var(--color-text-faint);padding:var(--space-4)">No data.</p>';
    return;
  }

  var html = '';
  chokepoints.forEach(function(cp, idx) {
    var statusLower = (cp.status || 'open').toLowerCase().replace(/\s+/g, '-');
    var statusClass = 'status-' + statusLower;
    var hasTransit = cp.transit_latest != null;
    var pctChange = cp.transit_pct_change || 0;
    var pctChange7d = cp.transit_pct_change_7d || 0;
    var pctClass = pctChange <= -25 ? 'change-negative' : (pctChange <= -15 ? 'change-positive' : 'change-flat');
    var pctSign = pctChange > 0 ? '+' : '';

    var alertBadge = '';
    if (cp.alert_level) {
      var alertCls = cp.alert_level === 'RED' ? 'alert-red' : 'alert-orange';
      var alertLabel = cp.alert_level === 'RED' ? '⚠ RED ALERT' : '⚠ ORANGE ALERT';
      alertBadge = '<span class="disruption-alert ' + alertCls + '" title="' + (cp.alert_event || '') + '">' + alertLabel + '</span>';
    }

    html += '<div class="chokepoint-item">' +
      '<div class="chokepoint-header">' +
        '<span class="chokepoint-name">' + cp.name + '</span>' +
        '<div class="chokepoint-badges">' +
          alertBadge +
          '<span class="status-badge ' + statusClass + '">' + (cp.status || 'OPEN') + '</span>' +
        '</div>' +
      '</div>' +
      (cp.alert_event ? '<div class="chokepoint-alert-event">' + cp.alert_event + '</div>' : '') +
      '<div class="chokepoint-detail">' + (cp.detail || 'No current alerts.') + '</div>';

    // Rerouting context — show when active, replaces the old delay_hours line
    if (cp.reroute_active && cp.reroute_via) {
      html += '<div class="chokepoint-reroute">' +
        '<span class="reroute-icon">⤴</span>' +
        '<span class="reroute-text">Diverted via ' + cp.reroute_via + '</span>' +
        '<span class="reroute-delay">+' + cp.reroute_days_low + '–' + cp.reroute_days_high + ' days</span>' +
      '</div>';
    } else if (cp.delay_hours > 0) {
      html += '<div class="chokepoint-delay">Est. delay: +' + cp.delay_hours + 'h</div>';
    }

    if (hasTransit) {
      var pct7dSign = pctChange7d > 0 ? '+' : '';
      var pct7dClass = pctChange7d <= -25 ? 'change-negative' : (pctChange7d <= -15 ? 'change-positive' : 'change-flat');
      html += '<div class="chokepoint-transit">' +
        '<div class="transit-top-row">' +
          '<div class="transit-kpis">' +
            '<div class="transit-kpi">' +
              '<span class="transit-kpi-value">' + cp.transit_latest + '</span>' +
              '<span class="transit-kpi-label">Latest Day</span>' +
            '</div>' +
            '<div class="transit-kpi">' +
              '<span class="transit-kpi-value ' + pctClass + '">' + pctSign + pctChange.toFixed(1) + '%</span>' +
              '<span class="transit-kpi-label">vs Baseline</span>' +
            '</div>' +
            '<div class="transit-kpi">' +
              '<span class="transit-kpi-value">' + (cp.transit_containers || 0) + '</span>' +
              '<span class="transit-kpi-label">Containers</span>' +
            '</div>' +
            '<div class="transit-kpi">' +
              '<span class="transit-kpi-value">' + (cp.transit_tankers || 0) + '</span>' +
              '<span class="transit-kpi-label">Tankers</span>' +
            '</div>' +
          '</div>' +
          '<div class="transit-spark-wrap">' +
            '<canvas id="cp-spark-' + idx + '" width="100" height="28"></canvas>' +
            '<span class="transit-kpi-label">7d Trend</span>' +
          '</div>' +
        '</div>' +
        '<div class="transit-secondary">' +
          '30d avg: ' + Math.round(cp.transit_baseline || 0) + ' &middot; ' +
          '7d avg: ' + Math.round(cp.transit_7d_avg || 0) +
          ' (<span class="' + pct7dClass + '">' + pct7dSign + pctChange7d.toFixed(1) + '%</span>)' +
        '</div>' +
        '<div class="transit-source">IMF PortWatch &middot; ' + (cp.transit_date || '') + '</div>' +
      '</div>';
    }

    html += '</div>';
  });
  container.innerHTML = html;

  // Draw 7d sparklines after DOM update
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      chokepoints.forEach(function(cp, idx) {
        var history = cp.transit_history_7d;
        if (!history || history.length < 2) return;
        drawChokepointSparkline('cp-spark-' + idx, history, cp.transit_baseline || 0);
      });
    });
  });
}

function drawChokepointSparkline(canvasId, dataPoints, baseline) {
  var canvas = document.getElementById(canvasId);
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  canvas.width = 100;
  canvas.height = 28;

  var root = getComputedStyle(document.documentElement);
  // Color based on trend direction (last vs first)
  var trending = dataPoints[dataPoints.length - 1] >= dataPoints[0];
  var lineColor = trending
    ? (root.getPropertyValue('--color-up').trim() || '#22c55e')
    : (root.getPropertyValue('--color-down').trim() || '#ef4444');

  var datasets = [{
    data: dataPoints,
    borderColor: lineColor,
    borderWidth: 1.5,
    fill: false,
    pointRadius: 0,
    tension: 0.3
  }];

  // Add baseline reference line if we have it
  if (baseline > 0) {
    datasets.push({
      data: dataPoints.map(function() { return baseline; }),
      borderColor: root.getPropertyValue('--color-text-faint').trim() || '#64748b',
      borderWidth: 1,
      borderDash: [3, 3],
      fill: false,
      pointRadius: 0,
      tension: 0
    });
  }

  new Chart(ctx, {
    type: 'line',
    data: {
      labels: dataPoints.map(function(_, i) { return i; }),
      datasets: datasets
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false },
        y: { display: false }
      },
      animation: { duration: 400 }
    }
  });
}

function renderProcurement(categories) {
  var body = document.getElementById('procurementBody');
  if (!categories || categories.length === 0) {
    body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--color-text-faint);padding:var(--space-6)">No data</td></tr>';
    return;
  }

  var html = '';
  categories.forEach(function(cat) {
    var riskCls = riskClass(cat.risk);
    var sensCls = riskClass(cat.energy_sensitivity);
    var riskDriver = cat.risk_driver || '';
    var sensRationale = cat.energy_sensitivity_rationale || '';
    // If energy sensitivity was changed from default, show tooltip with rationale
    var sensHtml = sensRationale
      ? '<span class="tooltip-trigger"><span class="risk-badge ' + sensCls + '" style="font-size:0.5625rem;padding:1px 6px">' + (cat.energy_sensitivity || '—') + ' ⚡</span><span class="tooltip-content">' + sensRationale + '</span></span>'
      : '<span class="risk-badge ' + sensCls + '" style="font-size:0.5625rem;padding:1px 6px">' + (cat.energy_sensitivity || '—') + '</span>';
    html += '<tr class="procurement-row-' + riskCls + '">' +
      '<td><span class="procurement-category">' + cat.name + '</span></td>' +
      '<td>' + sensHtml + '</td>' +
      '<td style="max-width:200px"><span style="font-size:var(--text-xs);color:var(--color-text-muted)">' + (cat.supply_route_exposure || '—') + '</span></td>' +
      '<td>' +
        '<div class="risk-cell">' +
          '<span class="tooltip-trigger">' +
            '<span class="risk-badge ' + riskCls + '" style="font-size:0.5625rem;padding:2px 8px">' + (cat.risk || '—') + '</span>' +
            '<span class="tooltip-content">' + (cat.rationale || 'No details available.') + '</span>' +
          '</span>' +
          (riskDriver ? '<span class="risk-driver">' + riskDriver + '</span>' : '') +
        '</div>' +
      '</td>' +
      '<td><span class="procurement-action">' + (cat.suggested_mitigation || '—') + '</span></td>' +
    '</tr>';
  });
  body.innerHTML = html;
}

function renderCOGSOutlook(text) {
  var container = document.getElementById('cogsOutlook');
  if (!text) {
    container.style.display = 'none';
    return;
  }
  container.style.display = '';
  container.innerHTML = '<div class="cogs-outlook-inner">' +
    '<span class="cogs-outlook-label">COGS Outlook</span>' +
    '<span class="cogs-outlook-text">' + text + '</span>' +
  '</div>';
}

function renderAnalystSentiment(sentiment) {
  var container = document.getElementById('analystSentiment');
  if (!container) { return; }
  if (!sentiment) {
    container.style.display = 'none';
    return;
  }
  container.style.display = '';
  var overall = (sentiment.overall || 'NEUTRAL').toUpperCase();
  var sentimentClass = overall === 'BEARISH' ? 'high' : (overall === 'BULLISH' ? 'low' : 'medium');
  var sentimentIcon = overall === 'BEARISH' ? '▼' : (overall === 'BULLISH' ? '▲' : '●');
  var items = [
    { label: 'Energy', text: sentiment.energy_outlook || '' },
    { label: 'Supply Chain', text: sentiment.supply_chain_outlook || '' },
    { label: 'Procurement', text: sentiment.procurement_outlook || '' },
  ];
  var html = '<div class="card-header">' +
    '<span class="card-title">Analyst Forecast & Sentiment</span>' +
    '<span class="risk-badge ' + sentimentClass + '" style="font-size:var(--text-xs);padding:var(--space-1) var(--space-3)">' +
      '<span class="kpi-trend trend-' + (overall === 'BEARISH' ? 'up' : (overall === 'BULLISH' ? 'down' : 'stable')) + '">' + sentimentIcon + '</span> ' +
      overall +
    '</span>' +
  '</div>';
  html += '<div class="sentiment-items">';
  items.forEach(function(item) {
    if (item.text) {
      html += '<div class="sentiment-item">' +
        '<span class="sentiment-label">' + item.label + '</span>' +
        '<span class="sentiment-text">' + item.text + '</span>' +
      '</div>';
    }
  });
  html += '</div>';
  container.innerHTML = html;
}

function renderSources(timestamp) {
  var body = document.getElementById('sourcesBody');
  if (!body) { return; }

  var tsStr = '—';
  if (timestamp) {
    try { tsStr = new Date(timestamp).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }); }
    catch (e) { tsStr = timestamp; }
  }

  var html = '<div class="sources-grid" style="padding-top:var(--space-3)">' +
    '<div class="source-item"><span class="source-item-label">Commodity Prices:</span> <a href="https://finance.yahoo.com" target="_blank" rel="noopener noreferrer">Yahoo Finance</a> (delayed)</div>' +
    '<div class="source-item"><span class="source-item-label">News Headlines:</span> <a href="https://news.google.com" target="_blank" rel="noopener noreferrer">Google News RSS</a></div>' +
    '<div class="source-item"><span class="source-item-label">LNG JKM:</span> <a href="https://uk.investing.com/commodities/lng-japan-korea-marker-platts-futures-historical-data" target="_blank" rel="noopener noreferrer">Investing.com (Platts JKM Futures)</a></div>' +
    '<div class="source-item"><span class="source-item-label">Chokepoint Transit:</span> <a href="https://portwatch.imf.org" target="_blank" rel="noopener noreferrer">IMF PortWatch</a> (AIS vessel transit data)</div>' +
    '<div class="source-item"><span class="source-item-label">Freight Rates:</span> LLM-estimated based on market data and news context (indicative only)</div>' +
    '<div class="source-item"><span class="source-item-label">Intelligence Analysis:</span> <a href="https://www.anthropic.com" target="_blank" rel="noopener noreferrer">Claude AI (Anthropic)</a></div>' +
    '<div class="source-item"><span class="source-item-label">Map Data:</span> <a href="https://www.naturalearthdata.com" target="_blank" rel="noopener noreferrer">Natural Earth</a> via world-atlas</div>' +
  '</div>' +
  '<div class="sources-meta">' +
    '<span>Data generated: ' + tsStr + '</span>' +
    '<span>Model: Claude (Anthropic)</span>' +
  '</div>';

  body.innerHTML = html;
}

// Sources toggle
(function() {
  var toggle = document.getElementById('sourcesToggle');
  var body = document.getElementById('sourcesBody');
  if (toggle && body) {
    toggle.addEventListener('click', function() {
      var expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      body.classList.toggle('open');
    });
  }
})();

// ─── Data Fetching ───
function fetchIntelligence() {
  var loadingEl = document.getElementById('loadingState');
  var liveEl = document.getElementById('dashboardLive');
  var refreshBtn = document.getElementById('refreshBtn');

  if (!window._lastData) {
    loadingEl.style.display = 'block';
    liveEl.style.display = 'none';
  }
  if (refreshBtn) { refreshBtn.disabled = true; }

  fetch(API_BASE + '/api/intelligence')
    .then(function(r) {
      if (!r.ok) { return null; }
      return r.json();
    })
    .catch(function() { return null; })
    .then(function(data) {
      if (data && data.status) { return data; }
      // Fallback: try loading static data.json (for local testing / S3 deploy)
      return fetch('./data.json').then(function(r2) {
        if (!r2.ok) { throw new Error('data.json not found'); }
        return r2.json();
      });
    })
    .then(function(data) {
      if (data.status === 'generating') {
        // Still generating, retry in 10s
        setTimeout(fetchIntelligence, 10000);
        return;
      }

      if (data.status === 'error') {
        loadingEl.innerHTML = '<div class="card" style="text-align:center;padding:var(--space-8)"><p style="color:var(--color-risk-high)">Error loading data: ' + (data.message || 'Unknown error') + '</p><p style="color:var(--color-text-faint);margin-top:var(--space-2)">Retrying in 30 seconds...</p></div>';
        setTimeout(fetchIntelligence, 30000);
        return;
      }

      window._lastData = data;
      var intel = data.intelligence || {};

      // Render all sections
      renderKPIStrip(intel);
      renderExecBanner(intel, data.timestamp, data.next_refresh);
      renderCommodities(data.commodities);
      renderNews(intel.top_stories);
      renderTimeline(intel.timeline_events);
      renderChokepoints(intel.chokepoint_status);
      renderFreightRates(intel.container_freight_rates);
      renderProcurement(intel.procurement_categories);
      renderCOGSOutlook(intel.cogs_outlook);
      renderAnalystSentiment(intel.analyst_sentiment);
      renderSources(data.timestamp);

      // Show dashboard first
      loadingEl.style.display = 'none';
      liveEl.style.display = 'block';

      // Render map AFTER layout is visible so container has dimensions
      requestAnimationFrame(function() {
        if (typeof renderSupplyChainMap === 'function') {
          renderSupplyChainMap(intel.chokepoint_status);
        }
      });

      // Re-init icons for dynamically added elements
      lucide.createIcons();
    })
    .catch(function(err) {
      console.error('Fetch error:', err);
      if (!window._lastData) {
        var loadEl = document.getElementById('loadingState');
        loadEl.innerHTML = '<div class="card" style="text-align:center;padding:var(--space-8)"><p style="color:var(--color-risk-medium)">Connecting to intelligence server...</p><p style="color:var(--color-text-faint);margin-top:var(--space-2)">First load may take 30-60 seconds while data is gathered.</p></div>';
      }
      setTimeout(fetchIntelligence, 10000);
    })
    .finally(function() {
      if (refreshBtn) { refreshBtn.disabled = false; }
    });
}

// ─── PDF Export (server-side reportlab) ───
document.getElementById('exportPdf').addEventListener('click', function() {
  if (!window._lastData) { alert('No data loaded yet. Please wait for the dashboard to load.'); return; }

  var btn = document.getElementById('exportPdf');
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader"></i> Generating...';

  fetch(API_BASE + '/api/export-pdf')
    .then(function(r) {
      if (!r.ok) { throw new Error('PDF generation failed (status ' + r.status + ')'); }
      return r.blob();
    })
    .then(function(blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'Intelligence_Brief_' + new Date().toISOString().slice(0, 10) + '.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    })
    .catch(function(err) {
      console.error('PDF export error:', err);
      alert('PDF export failed: ' + err.message);
    })
    .finally(function() {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="download"></i> Export PDF';
      lucide.createIcons();
    });
});

// ─── Refresh Button ───
document.getElementById('refreshBtn').addEventListener('click', function() {
  fetchIntelligence();
});

// ─── Keyboard Shortcut ───
document.addEventListener('keydown', function(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
    e.preventDefault();
    document.getElementById('exportPdf').click();
  }
});

// ─── Boot ───
fetchIntelligence();

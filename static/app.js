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
    { label: 'High-Risk Categories', value: (kpi.categories_at_high_risk != null ? kpi.categories_at_high_risk + ' / 7' : '—'), icon: '' }
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
    var changeCls = isUp ? 'change-positive' : (isDown ? 'change-negative' : 'change-flat');
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

  var html = '';
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
  chokepoints.forEach(function(cp) {
    var statusLower = (cp.status || 'open').toLowerCase();
    var statusClass = 'status-' + statusLower;
    html += '<div class="chokepoint-item">' +
      '<div class="chokepoint-header">' +
        '<span class="chokepoint-name">' + cp.name + '</span>' +
        '<span class="status-badge ' + statusClass + '">' + (cp.status || 'OPEN') + '</span>' +
      '</div>' +
      '<div class="chokepoint-detail">' + (cp.detail || 'No current alerts.') + '</div>' +
      (cp.delay_hours > 0 ? '<div class="chokepoint-delay">Est. delay: +' + cp.delay_hours + 'h</div>' : '') +
    '</div>';
  });
  container.innerHTML = html;
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
    html += '<tr class="procurement-row-' + riskCls + '">' +
      '<td><span class="procurement-category">' + cat.name + '</span></td>' +
      '<td><span class="risk-badge ' + sensCls + '" style="font-size:0.5625rem;padding:1px 6px">' + (cat.energy_sensitivity || '—') + '</span></td>' +
      '<td style="max-width:200px"><span style="font-size:var(--text-xs);color:var(--color-text-muted)">' + (cat.supply_route_exposure || '—') + '</span></td>' +
      '<td>' +
        '<span class="tooltip-trigger">' +
          '<span class="risk-badge ' + riskCls + '" style="font-size:0.5625rem;padding:2px 8px">' + (cat.risk || '—') + '</span>' +
          '<span class="tooltip-content">' + (cat.rationale || 'No details available.') + '</span>' +
        '</span>' +
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

      // Show dashboard first
      loadingEl.style.display = 'none';
      liveEl.style.display = 'block';

      // Render map AFTER layout is visible so container has dimensions
      requestAnimationFrame(function() {
        if (typeof renderSupplyChainMap === 'function') {
          renderSupplyChainMap(intel.chokepoint_status, intel.risk_heatmap);
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

// ─── PDF Export (A4 portrait one-pager) ───
function generatePDFContent() {
  var data = window._lastData;
  if (!data) { return null; }
  var intel = data.intelligence || {};
  var kpi = intel.kpi_summary || {};
  var dateStr = new Date().toISOString().slice(0, 10);

  // Build inline-styled HTML for PDF
  var s = 'font-family:Inter,system-ui,sans-serif;color:#e2e8f0;';
  var sH = 'font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;margin-bottom:4px;';
  var sBorder = 'border-bottom:1px solid #1e2d40;';

  var html = '<div style="' + s + 'background:#0c1220;padding:16px 20px;width:100%;box-sizing:border-box;">';

  // Header
  var riskColor = intel.overall_risk === 'HIGH' ? '#ef4444' : (intel.overall_risk === 'LOW' ? '#22c55e' : '#f59e0b');
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;' + sBorder + 'padding-bottom:8px;">';
  html += '<div style="font-size:11px;font-weight:700;color:#e2e8f0;">Daily Geopolitical & Energy Procurement Intelligence Brief</div>';
  html += '<div style="display:flex;gap:12px;align-items:center;">';
  html += '<span style="font-size:8px;color:#94a3b8;">' + dateStr + '</span>';
  html += '<span style="font-size:8px;font-weight:700;color:' + riskColor + ';background:rgba(0,0,0,0.3);padding:2px 8px;border-radius:4px;">' + (intel.overall_risk || 'MEDIUM') + ' RISK</span>';
  html += '</div></div>';

  // KPI Strip
  html += '<div style="display:flex;gap:8px;margin-bottom:10px;">';
  var kpiItems = [
    ['COGS Pressure', kpi.overall_cogs_pressure || 'STABLE'],
    ['Energy Trend', (kpi.energy_cost_trend || 'STABLE').split('—')[0].split(' - ')[0].trim()],
    ['Disruption', kpi.supply_chain_disruption_level || 'MODERATE'],
    ['Ship Delay', (kpi.avg_shipping_delay_days != null ? kpi.avg_shipping_delay_days + 'd' : '—')],
    ['Chokepoints', (kpi.active_chokepoint_disruptions != null ? kpi.active_chokepoint_disruptions + '/4' : '—')],
    ['High Risk', (kpi.categories_at_high_risk != null ? kpi.categories_at_high_risk + '/7' : '—')]
  ];
  kpiItems.forEach(function(k) {
    html += '<div style="flex:1;background:#111827;border:1px solid #1e2d40;border-radius:4px;padding:4px 6px;text-align:center;">';
    html += '<div style="font-size:9px;font-weight:700;color:#e2e8f0;">' + k[1] + '</div>';
    html += '<div style="font-size:6px;color:#64748b;text-transform:uppercase;">' + k[0] + '</div>';
    html += '</div>';
  });
  html += '</div>';

  // Exec Summary
  html += '<div style="margin-bottom:8px;">';
  html += '<div style="' + sH + '">Executive Summary</div>';
  if (Array.isArray(intel.executive_summary)) {
    intel.executive_summary.forEach(function(b) {
      html += '<div style="font-size:7px;color:#cbd5e1;margin-bottom:2px;padding-left:8px;position:relative;">';
      html += '<span style="position:absolute;left:0;color:#38bdf8;">•</span>' + b;
      html += '</div>';
    });
  }
  html += '</div>';

  // Two-column: Commodities | Chokepoints + Freight
  html += '<div style="display:flex;gap:10px;margin-bottom:8px;">';

  // Left: Commodities
  html += '<div style="flex:1;">';
  html += '<div style="' + sH + '">Energy Markets</div>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:7px;">';
  html += '<tr style="color:#64748b;font-size:6px;text-transform:uppercase;"><th style="text-align:left;padding:2px;">Commodity</th><th style="text-align:right;padding:2px;">Price</th><th style="text-align:right;padding:2px;">24h</th><th style="text-align:right;padding:2px;">7d</th></tr>';
  if (data.commodities) {
    data.commodities.forEach(function(c) {
      var c24 = c.change_24h || 0;
      var c7 = c.change_7d || 0;
      var col24 = c24 > 0 ? '#22c55e' : (c24 < 0 ? '#ef4444' : '#94a3b8');
      var col7 = c7 > 0 ? '#22c55e' : (c7 < 0 ? '#ef4444' : '#94a3b8');
      html += '<tr style="' + sBorder + '">';
      html += '<td style="padding:2px;color:#e2e8f0;">' + c.name + '</td>';
      html += '<td style="padding:2px;text-align:right;color:#e2e8f0;">' + c.price.toFixed(2) + '</td>';
      html += '<td style="padding:2px;text-align:right;color:' + col24 + ';">' + (c24 > 0 ? '+' : '') + c24.toFixed(2) + '%</td>';
      html += '<td style="padding:2px;text-align:right;color:' + col7 + ';">' + (c7 > 0 ? '+' : '') + c7.toFixed(2) + '%</td>';
      html += '</tr>';
    });
  }
  html += '</table></div>';

  // Right: Chokepoints + Freight
  html += '<div style="flex:1;">';
  html += '<div style="' + sH + '">Chokepoint Status</div>';
  if (intel.chokepoint_status) {
    intel.chokepoint_status.forEach(function(cp) {
      var sc = cp.status === 'OPEN' ? '#22c55e' : (cp.status === 'CLOSED' ? '#ef4444' : '#f59e0b');
      html += '<div style="display:flex;justify-content:space-between;font-size:7px;padding:1px 0;' + sBorder + '">';
      html += '<span style="color:#e2e8f0;">' + cp.name + '</span>';
      html += '<span style="color:' + sc + ';font-weight:600;">' + cp.status + (cp.delay_hours > 0 ? ' (+' + cp.delay_hours + 'h)' : '') + '</span>';
      html += '</div>';
    });
  }
  html += '<div style="' + sH + 'margin-top:6px;">Freight Rates</div>';
  if (intel.container_freight_rates) {
    html += '<table style="width:100%;border-collapse:collapse;font-size:6.5px;">';
    html += '<tr style="color:#64748b;font-size:6px;"><th style="text-align:left;padding:1px;">Route</th><th style="text-align:right;padding:1px;">Rate</th><th style="text-align:right;padding:1px;">7d</th></tr>';
    intel.container_freight_rates.forEach(function(fr) {
      html += '<tr style="' + sBorder + '"><td style="padding:1px;color:#e2e8f0;">' + fr.route + '</td><td style="padding:1px;text-align:right;color:#e2e8f0;">' + fr.rate_20ft + '</td><td style="padding:1px;text-align:right;color:#94a3b8;">' + fr.change_7d + '</td></tr>';
    });
    html += '</table>';
  }
  html += '</div>';
  html += '</div>';

  // Procurement Matrix
  html += '<div style="margin-bottom:8px;">';
  html += '<div style="' + sH + '">Procurement Category Exposure</div>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:6.5px;">';
  html += '<tr style="color:#64748b;font-size:6px;text-transform:uppercase;"><th style="text-align:left;padding:2px;">Category</th><th style="padding:2px;">Energy</th><th style="padding:2px;">Risk</th><th style="text-align:left;padding:2px;">Mitigation</th></tr>';
  if (intel.procurement_categories) {
    intel.procurement_categories.forEach(function(cat) {
      var rc = cat.risk === 'H' || cat.risk === 'HIGH' ? '#ef4444' : (cat.risk === 'L' || cat.risk === 'LOW' ? '#22c55e' : '#f59e0b');
      html += '<tr style="' + sBorder + '">';
      html += '<td style="padding:2px;color:#e2e8f0;">' + cat.name + '</td>';
      html += '<td style="padding:2px;text-align:center;color:#94a3b8;">' + (cat.energy_sensitivity || '—') + '</td>';
      html += '<td style="padding:2px;text-align:center;color:' + rc + ';font-weight:600;">' + (cat.risk || '—') + '</td>';
      html += '<td style="padding:2px;color:#94a3b8;">' + (cat.suggested_mitigation || '—') + '</td>';
      html += '</tr>';
    });
  }
  html += '</table></div>';

  // COGS Outlook
  if (intel.cogs_outlook) {
    html += '<div style="background:#111827;border:1px solid #1e2d40;border-radius:4px;padding:4px 8px;margin-bottom:6px;">';
    html += '<span style="font-size:7px;font-weight:700;color:#38bdf8;text-transform:uppercase;margin-right:8px;">COGS Outlook</span>';
    html += '<span style="font-size:7px;color:#cbd5e1;">' + intel.cogs_outlook + '</span>';
    html += '</div>';
  }

  // Footer
  html += '<div style="font-size:6px;color:#475569;text-align:center;margin-top:4px;">Generated ' + new Date().toISOString() + ' | Created with Perplexity Computer</div>';

  html += '</div>';
  return html;
}

document.getElementById('exportPdf').addEventListener('click', function() {
  var pdfHtml = generatePDFContent();
  if (!pdfHtml) { return; }

  var tempDiv = document.createElement('div');
  tempDiv.id = 'pdfExport';
  tempDiv.style.position = 'fixed';
  tempDiv.style.left = '-9999px';
  tempDiv.style.top = '0';
  tempDiv.style.width = '794px'; // A4 width at 96dpi
  tempDiv.innerHTML = pdfHtml;
  document.body.appendChild(tempDiv);

  var opt = {
    margin: [0.3, 0.3, 0.3, 0.3],
    filename: 'Daily_Intelligence_Brief_' + new Date().toISOString().slice(0, 10) + '.pdf',
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 1.2, useCORS: true, backgroundColor: '#0c1220', width: 794 },
    jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
  };

  html2pdf().set(opt).from(tempDiv).save().then(function() {
    document.body.removeChild(tempDiv);
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

/* app.js — Meridian Intelligence Dashboard */
/* global renderSupplyChainMap */

var API_BASE = "";
var currentData = null;
var POLL_INTERVAL_MS = 5000; // Poll until data is ready (5s)
var pollTimer = null;

// ---- Data Fetching ----
async function fetchData() {
  try {
    var resp = await fetch(API_BASE + '/api/data');
    if (resp.status === 202) {
      // Data still being generated
      return null;
    }
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.json();
  } catch (e) {
    console.error('fetchData error:', e);
    return null;
  }
}

async function pollUntilReady() {
  var data = await fetchData();
  if (data && data.status === 'ok') {
    clearInterval(pollTimer);
    pollTimer = null;
    currentData = data;
    renderDashboard(data);
    hideLoading();
  }
  // else keep polling
}

function startPolling() {
  pollTimer = setInterval(pollUntilReady, POLL_INTERVAL_MS);
  pollUntilReady(); // immediate first check
}

// ---- Rendering ----
function hideLoading() {
  var overlay = document.getElementById('loadingOverlay');
  var dash = document.getElementById('dashboard');
  if (overlay) overlay.style.display = 'none';
  if (dash) dash.style.display = '';
}

function renderDashboard(data) {
  var intel = data.intelligence || {};

  renderExecSummary(intel);
  renderCommodities(data.commodities || []);
  renderStories(intel.top_stories || []);
  renderChokepoints(intel.chokepoint_status || []);
  renderTimeline(intel.timeline_events || []);
  renderCategories(intel.procurement_categories || []);
  renderHeatmap(intel.risk_heatmap || []);
  renderOutlook(intel);
  renderMap(data);
  renderTimestamps(data);
  renderShippingAlerts(intel.shipping_alerts || []);
}

function renderExecSummary(intel) {
  var bullets = document.getElementById('execBullets');
  var riskEl = document.getElementById('overallRisk');
  if (!bullets || !riskEl) return;

  var summary = intel.executive_summary || [];
  bullets.innerHTML = summary.map(function(b) {
    return '<li>' + escHtml(b) + '</li>';
  }).join('');

  var risk = (intel.overall_risk || 'MEDIUM').toUpperCase();
  var riskClass = risk === 'HIGH' ? 'high' : risk === 'LOW' ? 'low' : 'medium';
  riskEl.className = 'risk-badge ' + riskClass;
  riskEl.innerHTML = '<span class="risk-dot ' + riskClass + '"></span>' + risk + ' RISK';
}

function renderCommodities(commodities) {
  var tbody = document.getElementById('commodityBody');
  if (!tbody) return;

  tbody.innerHTML = commodities.map(function(c) {
    var ch24 = c.change_24h || 0;
    var ch7d = c.change_7d || 0;
    var cls24 = ch24 > 0 ? 'change-positive' : ch24 < 0 ? 'change-negative' : 'change-flat';
    var cls7d = ch7d > 0 ? 'change-positive' : ch7d < 0 ? 'change-negative' : 'change-flat';
    var sign24 = ch24 > 0 ? '+' : '';
    var sign7d = ch7d > 0 ? '+' : '';
    var canvasId = 'spark-' + c.name.replace(/[^a-zA-Z0-9]/g, '-');
    return '<tr>' +
      '<td class="commodity-name">' + escHtml(c.name) + '</td>' +
      '<td class="commodity-price">' + escHtml(String(c.price)) + ' <span style="font-size:0.75em;color:var(--color-text-faint)">' + escHtml(c.unit) + '</span></td>' +
      '<td class="' + cls24 + '">' + sign24 + ch24.toFixed(2) + '%</td>' +
      '<td class="' + cls7d + '">' + sign7d + ch7d.toFixed(2) + '%</td>' +
      '<td class="sparkline-cell"><canvas id="' + canvasId + '" width="120" height="32"></canvas></td>' +
    '</tr>';
  }).join('');

  // Draw sparklines after DOM update
  requestAnimationFrame(function() {
    commodities.forEach(function(c) {
      var canvasId = 'spark-' + c.name.replace(/[^a-zA-Z0-9]/g, '-');
      drawSparkline(canvasId, c.history || [], c.change_24h >= 0);
    });
  });
}

function drawSparkline(canvasId, data, isUp) {
  var canvas = document.getElementById(canvasId);
  if (!canvas || !data.length) return;
  var ctx = canvas.getContext('2d');
  var w = 120, h = 32;
  canvas.width = w;
  canvas.height = h;

  var min = Math.min.apply(null, data);
  var max = Math.max.apply(null, data);
  var range = max - min || 1;

  ctx.clearRect(0, 0, w, h);

  var color = isUp ? '#22c55e' : '#ef4444';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();

  data.forEach(function(val, i) {
    var x = (i / (data.length - 1)) * (w - 2) + 1;
    var y = h - ((val - min) / range) * (h - 4) - 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Fill area
  ctx.lineTo(w - 1, h);
  ctx.lineTo(1, h);
  ctx.closePath();
  ctx.fillStyle = isUp ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)';
  ctx.fill();
}

function renderStories(stories) {
  var el = document.getElementById('storiesList');
  if (!el) return;

  if (!stories.length) {
    el.innerHTML = '<p style="color:var(--color-text-faint);font-size:var(--text-xs)">No stories available.</p>';
    return;
  }

  el.innerHTML = stories.map(function(s) {
    var relClass = (s.relevance || 'LOW').toLowerCase();
    var relColors = { high: '#ef4444', medium: '#f59e0b', low: '#64748b' };
    var relColor = relColors[relClass] || '#64748b';
    var headlineHtml = s.url
      ? '<a href="' + escHtml(s.url) + '" target="_blank" rel="noopener">' + escHtml(s.headline) + '</a>'
      : escHtml(s.headline);
    return '<div class="story-item">' +
      '<div class="story-meta">' +
        '<span class="story-source">' + escHtml(s.source || '') + '</span>' +
        '<span class="story-relevance" style="background:' + relColor + '22;color:' + relColor + '">' + escHtml(s.relevance || 'LOW') + '</span>' +
      '</div>' +
      '<div class="story-headline">' + headlineHtml + '</div>' +
      '<div class="story-summary">' + escHtml(s.summary || '') + '</div>' +
    '</div>';
  }).join('');
}

function renderChokepoints(chokepoints) {
  var el = document.getElementById('chokepointList');
  if (!el) return;

  el.innerHTML = chokepoints.map(function(cp) {
    var status = (cp.status || 'OPEN').toLowerCase();
    var delay = cp.delay_hours > 0 ? '+' + cp.delay_hours + 'h delay' : '';
    return '<div class="chokepoint-item">' +
      '<span class="chokepoint-status ' + status + '">' + escHtml(cp.status) + '</span>' +
      '<div>' +
        '<div class="chokepoint-name">' + escHtml(cp.name) + '</div>' +
        '<div class="chokepoint-detail">' + escHtml(cp.detail || '') + '</div>' +
      '</div>' +
      (delay ? '<span class="chokepoint-delay">' + delay + '</span>' : '') +
    '</div>';
  }).join('');
}

function renderTimeline(events) {
  var el = document.getElementById('eventTimeline');
  if (!el) return;

  el.innerHTML = events.map(function(ev) {
    var sev = (ev.severity || 'LOW').toLowerCase();
    return '<div class="timeline-item">' +
      '<div class="timeline-dot ' + sev + '"></div>' +
      '<div class="timeline-date">' + escHtml(ev.date || '') + '</div>' +
      '<div class="timeline-event">' + escHtml(ev.event || '') + '</div>' +
    '</div>';
  }).join('');
}

function renderCategories(categories) {
  var el = document.getElementById('categoryGrid');
  if (!el) return;

  el.innerHTML = categories.map(function(cat) {
    var risk = (cat.risk || 'L').toUpperCase();
    var riskLabel = risk === 'H' ? 'HIGH' : risk === 'M' ? 'MEDIUM' : 'LOW';
    var riskClass = risk === 'H' ? 'risk-high' : risk === 'M' ? 'risk-medium' : 'risk-low';
    var energyLabel = (cat.energy_sensitivity || 'M') === 'H' ? 'HIGH ENERGY' : (cat.energy_sensitivity || 'M') === 'M' ? 'MED ENERGY' : 'LOW ENERGY';
    return '<div class="category-card ' + riskClass + '">' +
      '<div class="category-name">' + escHtml(cat.name) + '</div>' +
      '<div class="category-badges">' +
        '<span class="badge badge-risk-' + riskClass.replace('risk-','') + '">' + riskLabel + ' RISK</span>' +
        '<span class="badge badge-energy">' + energyLabel + '</span>' +
      '</div>' +
      '<div class="category-rationale">' + escHtml(cat.rationale || '') + '</div>' +
      (cat.supply_route_exposure ? '<div class="category-route">' + escHtml(cat.supply_route_exposure) + '</div>' : '') +
      (cat.suggested_mitigation ? '<div class="category-mitigation">' + escHtml(cat.suggested_mitigation) + '</div>' : '') +
    '</div>';
  }).join('');
}

function renderHeatmap(regions) {
  var el = document.getElementById('riskHeatmap');
  if (!el) return;

  el.innerHTML = regions.map(function(r) {
    var risk = (r.risk || 'LOW').toLowerCase();
    return '<div class="heatmap-item risk-' + risk + '">' +
      '<div class="heatmap-region">' + escHtml(r.region) + '</div>' +
      '<div class="heatmap-detail">' + escHtml(r.detail || '') + '</div>' +
    '</div>';
  }).join('');
}

function renderOutlook(intel) {
  var driversEl = document.getElementById('commodityDrivers');
  var outlookEl = document.getElementById('analystOutlook');
  if (driversEl) driversEl.textContent = intel.commodity_drivers || '';
  if (outlookEl) outlookEl.textContent = intel.analyst_outlook || '';
}

function renderMap(data) {
  if (typeof renderSupplyChainMap === 'function') {
    renderSupplyChainMap('supplyChainMap', data);
  }
}

function renderTimestamps(data) {
  var ts = data.timestamp ? new Date(data.timestamp) : new Date();
  var tsStr = ts.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  var headerTs = document.getElementById('headerTimestamp');
  var briefTs = document.getElementById('briefTimestamp');
  if (headerTs) headerTs.textContent = tsStr;
  if (briefTs) briefTs.textContent = 'Generated: ' + tsStr;

  if (data.next_refresh) {
    var nr = new Date(data.next_refresh);
    var nrStr = nr.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    var nrEl = document.getElementById('nextRefresh');
    if (nrEl) nrEl.textContent = 'Next refresh: ' + nrStr;
  }
}

function renderShippingAlerts(alerts) {
  // Find or create shipping alerts section
  var existing = document.getElementById('shippingAlertsSection');
  if (!existing || !alerts.length) return;

  existing.innerHTML = alerts.map(function(a) {
    return '<div class="shipping-alert-item">' + escHtml(a) + '</div>';
  }).join('');
}

// ---- Utilities ----
function escHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---- Controls ----
document.addEventListener('DOMContentLoaded', function() {
  startPolling();

  var refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async function() {
      refreshBtn.disabled = true;
      var data = await fetchData();
      if (data && data.status === 'ok') {
        currentData = data;
        renderDashboard(data);
      }
      refreshBtn.disabled = false;
    });
  }

  var exportBtn = document.getElementById('exportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', function() {
      window.print();
    });
  }

  var themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', function() {
      var html = document.documentElement;
      var current = html.getAttribute('data-theme') || 'dark';
      html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
    });
  }
});

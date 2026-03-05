/* app.js — Daily Geopolitical & Energy Procurement Intelligence Brief */
/* global renderSupplyChainMap */

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
      if (window._lastData) { renderCommodities(window._lastData.commodities, window._lastData.intelligence); }
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

function renderCommodities(commodities, intel) {
  // Destroy old sparkline charts
  sparkCharts.forEach(function(c) { c.destroy(); });
  sparkCharts = [];

  var body = document.getElementById('commodityBody');
  if (!commodities || commodities.length === 0) {
    body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--color-text-faint);padding:var(--space-6)">No commodity data available</td></tr>';
    return;
  }

  // Find driver text from intel if available
  var driverMap = {};
  if (intel && intel.procurement_categories) {
    // Use commodity_drivers for all
  }

  var html = '';
  commodities.forEach(function(c, i) {
    var canvasId = 'spark-' + i;
    var isPositive = c.change_7d >= 0;
    html += '<tr>' +
      '<td><span class="commodity-name">' + c.name + '</span></td>' +
      '<td><span class="commodity-price">' + c.price.toFixed(2) + '</span> <span style="font-size:var(--text-xs);color:var(--color-text-faint)">' + c.unit + '</span></td>' +
      '<td>' + formatChange(c.change_24h) + '</td>' +
      '<td>' + formatChange(c.change_7d) + '</td>' +
      '<td class="sparkline-cell"><canvas id="' + canvasId + '" width="120" height="32"></canvas></td>' +
      '<td style="font-size:var(--text-xs);color:var(--color-text-muted);max-width:160px">' + (c.driver || '—') + '</td>' +
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

  // Analyst outlook
  var outlook = document.getElementById('analystOutlook');
  outlook.textContent = (intel && intel.analyst_outlook) ? intel.analyst_outlook : 'No forecast data available.';
}

function renderNews(stories) {
  var container = document.getElementById('newsStories');
  if (!stories || stories.length === 0) {
    container.innerHTML = '<p style="color:var(--color-text-faint);padding:var(--space-4)">No recent stories.</p>';
    return;
  }

  var html = '';
  stories.slice(0, 5).forEach(function(s) {
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
  events.forEach(function(ev) {
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

function renderHeatmap(regions) {
  var container = document.getElementById('heatmap');
  if (!regions || regions.length === 0) {
    container.innerHTML = '<p style="color:var(--color-text-faint);padding:var(--space-4)">No data.</p>';
    return;
  }

  var html = '';
  regions.forEach(function(r) {
    var rc = riskClass(r.risk);
    html += '<div class="heatmap-item ' + rc + '">' +
      '<div class="heatmap-region">' + r.region + ' <span class="risk-badge ' + rc + '" style="font-size:0.5625rem;padding:1px 5px">' + r.risk + '</span></div>' +
      '<div class="heatmap-detail">' + (r.detail || '') + '</div>' +
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

function renderShippingAlerts(alerts) {
  var container = document.getElementById('shippingAlerts');
  if (!alerts || alerts.length === 0) {
    container.innerHTML = '<p style="color:var(--color-text-faint);padding:var(--space-4)">No active alerts.</p>';
    return;
  }

  var html = '';
  alerts.forEach(function(a) {
    html += '<div class="alert-item">' +
      '<span class="alert-icon">⚠</span>' +
      '<span>' + a + '</span>' +
    '</div>';
  });
  container.innerHTML = html;

  var drivers = document.getElementById('commodityDrivers');
  if (window._lastData && window._lastData.intelligence) {
    drivers.textContent = window._lastData.intelligence.commodity_drivers || '—';
  }
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
      '<td><span class="procurement-action">' + (cat.suggested_mitigation || cat.action || '—') + '</span></td>' +
    '</tr>';
  });
  body.innerHTML = html;
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
    .then(function(r) { return r.json(); })
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
      renderExecBanner(intel, data.timestamp, data.next_refresh);
      renderCommodities(data.commodities, intel);
      renderNews(intel.top_stories);
      renderTimeline(intel.timeline_events);
      renderHeatmap(intel.risk_heatmap);
      renderChokepoints(intel.chokepoint_status);
      renderShippingAlerts(intel.shipping_alerts);
      renderProcurement(intel.procurement_categories);

      // Render supply chain map
      if (typeof renderSupplyChainMap === 'function') {
        renderSupplyChainMap(intel.chokepoint_status, intel.risk_heatmap);
      }

      loadingEl.style.display = 'none';
      liveEl.style.display = 'block';

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

// ─── PDF Export ───
document.getElementById('exportPdf').addEventListener('click', function() {
  var content = document.getElementById('dashboardContent');
  var opt = {
    margin: [0.3, 0.3, 0.3, 0.3],
    filename: 'Daily_Intelligence_Brief_' + new Date().toISOString().slice(0, 10) + '.pdf',
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 1.5, useCORS: true, backgroundColor: '#0c1220' },
    jsPDF: { unit: 'in', format: 'a3', orientation: 'portrait' },
    pagebreak: { mode: ['avoid-all'] }
  };
  html2pdf().set(opt).from(content).save();
});

// ─── Refresh Button ───
document.getElementById('refreshBtn').addEventListener('click', function() {
  // Force a new fetch (backend will serve from cache if still valid)
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

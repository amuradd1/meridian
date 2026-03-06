/* map.js — Chokepoint Corridor View */
/* global d3, topojson */

// Critical chokepoints with coordinates and label offsets
var CHOKEPOINTS = [
  { name: "Strait of Hormuz", shortName: "Hormuz", lat: 26.6, lng: 56.3, labelDx: 8, labelDy: -12 },
  { name: "Bab el-Mandeb", shortName: "Bab el-Mandeb", lat: 12.6, lng: 43.3, labelDx: -14, labelDy: 14 },
  { name: "Suez Canal", shortName: "Suez", lat: 30.5, lng: 32.3, labelDx: -10, labelDy: -14 },
  { name: "Malacca Strait", shortName: "Malacca", lat: 2.5, lng: 101.5, labelDx: 10, labelDy: -12 }
];

// Shipping lane definitions — each references which chokepoints it passes through
var SHIPPING_ROUTES = [
  { name: "East Africa → Suez → Europe", points: [[-13.3, 34.3], [-2, 40], [12.6, 43.3], [30.5, 32.3], [42, 12]], chokepoints: ["Bab el-Mandeb", "Suez Canal"] },
  { name: "India → Suez → Europe", points: [[20.6, 78.9], [15, 65], [12.6, 43.3], [30.5, 32.3], [42, 12]], chokepoints: ["Bab el-Mandeb", "Suez Canal"] },
  { name: "China/SEA → Malacca → Europe", points: [[22.5, 114], [2.5, 104], [2.5, 101.5], [-5, 60], [12.6, 43.3], [30.5, 32.3], [42, 12]], chokepoints: ["Malacca Strait", "Bab el-Mandeb", "Suez Canal"] },
  { name: "China → Hormuz → Middle East", points: [[22.5, 114], [10, 80], [26.6, 56.3]], chokepoints: ["Strait of Hormuz"] },
  { name: "Persian Gulf → Suez → Europe", points: [[26.6, 56.3], [18, 50], [12.6, 43.3], [30.5, 32.3], [42, 12]], chokepoints: ["Strait of Hormuz", "Bab el-Mandeb", "Suez Canal"] }
];

function renderSupplyChainMap(chokeStatus) {
  var container = document.getElementById("supplyChainMap");
  if (!container) {
    console.error("Map container #supplyChainMap not found");
    return;
  }
  container.innerHTML = "";

  var width = container.clientWidth || 900;
  var height = Math.min(width * 0.52, 480);

  // Retry if container has no width yet
  if (width < 100) {
    setTimeout(function() { renderSupplyChainMap(chokeStatus); }, 200);
    return;
  }

  var svg = d3.select(container)
    .append("svg")
    .attr("viewBox", "0 0 " + width + " " + height)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .style("width", "100%")
    .style("height", "auto")
    .style("background", "transparent");

  // Projection
  var projection = d3.geoNaturalEarth1()
    .scale(width / 5.8)
    .translate([width / 2, height / 2]);

  var path = d3.geoPath().projection(projection);

  // Build chokepoint status lookup
  var chokeLookup = {};
  if (chokeStatus) {
    chokeStatus.forEach(function(cp) {
      var key = cp.name.toLowerCase();
      CHOKEPOINTS.forEach(function(ref) {
        if (key.indexOf(ref.name.toLowerCase().split(" ")[0]) !== -1 ||
            ref.name.toLowerCase().indexOf(key.split(" ")[0]) !== -1 ||
            ref.name.toLowerCase().indexOf(key.split("/")[0].trim().split(" ")[0]) !== -1) {
          chokeLookup[ref.name] = cp;
        }
      });
    });
  }

  // Identify disrupted chokepoints
  var disruptedChokepoints = {};
  CHOKEPOINTS.forEach(function(cp) {
    var status = chokeLookup[cp.name];
    var level = status ? status.status.toLowerCase() : "open";
    if (level === "restricted" || level === "closed") {
      disruptedChokepoints[cp.name] = true;
    }
  });

  // Defs for glow filter
  var defs = svg.append("defs");
  var glow = defs.append("filter").attr("id", "glow");
  glow.append("feGaussianBlur").attr("stdDeviation", "2").attr("result", "coloredBlur");
  var feMerge = glow.append("feMerge");
  feMerge.append("feMergeNode").attr("in", "coloredBlur");
  feMerge.append("feMergeNode").attr("in", "SourceGraphic");

  // Graticule (very subtle grid lines)
  var graticule = d3.geoGraticule().step([30, 30]);
  svg.append("path")
    .datum(graticule())
    .attr("d", path)
    .attr("fill", "none")
    .attr("stroke", "var(--color-border)")
    .attr("stroke-width", 0.3)
    .attr("stroke-opacity", 0.2);

  // Load world TopoJSON
  var worldUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

  d3.json(worldUrl).then(function(world) {
    if (!world || !world.objects || !world.objects.countries) {
      container.innerHTML = '<p style="color:var(--color-text-faint);text-align:center;padding:var(--space-6)">Map data format error</p>';
      return;
    }

    var countries = topojson.feature(world, world.objects.countries);

    // Draw countries — clean, uniform fill, no risk shading
    svg.selectAll(".country")
      .data(countries.features)
      .enter().append("path")
      .attr("class", "country")
      .attr("d", path)
      .attr("fill", "var(--color-surface-2)")
      .attr("stroke", "var(--color-border)")
      .attr("stroke-width", 0.3);

    // Draw shipping routes
    var routeGroup = svg.append("g").attr("class", "routes");
    SHIPPING_ROUTES.forEach(function(route) {
      // Check if any of this route's chokepoints are disrupted
      var isDisrupted = route.chokepoints.some(function(cpName) {
        return disruptedChokepoints[cpName];
      });

      var lineGen = d3.line()
        .x(function(d) { return projection([d[1], d[0]])[0]; })
        .y(function(d) { return projection([d[1], d[0]])[1]; })
        .curve(d3.curveBasis);

      routeGroup.append("path")
        .datum(route.points)
        .attr("d", lineGen)
        .attr("fill", "none")
        .attr("stroke", isDisrupted ? "#f59e0b" : "var(--color-text-faint)")
        .attr("stroke-width", isDisrupted ? 2 : 1)
        .attr("stroke-opacity", isDisrupted ? 0.7 : 0.3)
        .attr("stroke-dasharray", isDisrupted ? "6,3" : "4,3");
    });

    // Draw chokepoint markers
    var chokeGroup = svg.append("g").attr("class", "chokepoints");
    CHOKEPOINTS.forEach(function(cp) {
      var pos = projection([cp.lng, cp.lat]);
      if (!pos) { return; }
      var status = chokeLookup[cp.name];
      var statusLevel = status ? status.status.toLowerCase() : "open";
      var color = statusLevel === "restricted" ? "var(--color-risk-medium)" :
                  statusLevel === "closed" ? "var(--color-risk-high)" : "var(--color-risk-low)";

      // Pulsing ring for restricted/closed
      if (statusLevel !== "open") {
        chokeGroup.append("circle")
          .attr("cx", pos[0]).attr("cy", pos[1])
          .attr("r", 12)
          .attr("fill", "none")
          .attr("stroke", color)
          .attr("stroke-width", 1.5)
          .attr("stroke-opacity", 0.6)
          .attr("class", "choke-pulse");
      }

      // Main chokepoint dot (r=6)
      chokeGroup.append("circle")
        .attr("cx", pos[0]).attr("cy", pos[1])
        .attr("r", 6)
        .attr("fill", color)
        .attr("stroke", "#0c1220")
        .attr("stroke-width", 1.5)
        .attr("filter", "url(#glow)");

      // Label with smart offset
      chokeGroup.append("text")
        .attr("x", pos[0] + (cp.labelDx || 0))
        .attr("y", pos[1] + (cp.labelDy || -14))
        .attr("text-anchor", "middle")
        .attr("font-size", "8px")
        .attr("font-weight", "600")
        .attr("fill", color)
        .attr("font-family", "var(--font-body)")
        .text(cp.shortName || cp.name);
    });

    // Inject pulse animation style
    if (!document.getElementById('chokePulseStyle')) {
      var style = document.createElement("style");
      style.id = 'chokePulseStyle';
      style.textContent = "@keyframes chokePulse{0%,100%{r:12;opacity:.6}50%{r:18;opacity:0}}.choke-pulse{animation:chokePulse 2s infinite ease-in-out}";
      document.head.appendChild(style);
    }

  }).catch(function(err) {
    console.error("Map load error:", err);
    container.innerHTML = '<p style="color:var(--color-text-faint);text-align:center;padding:var(--space-6)">Map data unavailable — ' + (err.message || err) + '</p>';
  });

  // Build minimal legend — just chokepoint status
  renderMapLegend(container);
}

function renderMapLegend(container) {
  var legend = document.createElement("div");
  legend.className = "map-legend";

  var html = '<div class="map-legend-title">Chokepoint Status</div><div class="map-legend-items">';
  html += '<div class="map-legend-item"><span class="map-legend-dot" style="background:var(--color-risk-low)"></span><span class="map-legend-label">Open</span></div>';
  html += '<div class="map-legend-item"><span class="map-legend-dot" style="background:var(--color-risk-medium)"></span><span class="map-legend-label">Restricted</span></div>';
  html += '<div class="map-legend-item"><span class="map-legend-dot" style="background:var(--color-risk-high)"></span><span class="map-legend-label">Closed</span></div>';
  html += '</div>';

  legend.innerHTML = html;
  container.appendChild(legend);
}

/* map.js — Chokepoint Corridor View (zoomed to critical region) */
/* global d3, topojson */

// Critical chokepoints with coordinates and label offsets
var CHOKEPOINTS = [
  { name: "Strait of Hormuz", shortName: "Hormuz", lat: 26.6, lng: 56.3, labelDx: 0, labelDy: -16 },
  { name: "Bab el-Mandeb", shortName: "Bab el-Mandeb", lat: 12.6, lng: 43.3, labelDx: 0, labelDy: 18 },
  { name: "Suez Canal", shortName: "Suez", lat: 30.5, lng: 32.3, labelDx: -16, labelDy: -14 },
  { name: "Malacca Strait", shortName: "Malacca", lat: 2.5, lng: 101.5, labelDx: 0, labelDy: -16 }
];

// Shipping lane definitions — each references which chokepoints it passes through
var SHIPPING_ROUTES = [
  { name: "East Africa → Suez → Europe", points: [[-8, 40], [5, 42], [12.6, 43.3], [25, 35], [30.5, 32.3], [36, 28]], chokepoints: ["Bab el-Mandeb", "Suez Canal"] },
  { name: "India → Suez → Europe", points: [[18, 73], [15, 60], [12.6, 43.3], [25, 35], [30.5, 32.3], [36, 28]], chokepoints: ["Bab el-Mandeb", "Suez Canal"] },
  { name: "China/SEA → Malacca → Middle East", points: [[18, 110], [5, 103], [2.5, 101.5], [0, 85], [-3, 65], [12.6, 43.3]], chokepoints: ["Malacca Strait", "Bab el-Mandeb"] },
  { name: "China → Hormuz → Gulf", points: [[18, 110], [12, 85], [20, 66], [26.6, 56.3]], chokepoints: ["Strait of Hormuz"] },
  { name: "Persian Gulf → Suez → Europe", points: [[26.6, 56.3], [20, 50], [12.6, 43.3], [25, 35], [30.5, 32.3], [36, 28]], chokepoints: ["Strait of Hormuz", "Bab el-Mandeb", "Suez Canal"] }
];

function renderSupplyChainMap(chokeStatus) {
  var container = document.getElementById("supplyChainMap");
  if (!container) {
    console.error("Map container #supplyChainMap not found");
    return;
  }
  container.innerHTML = "";

  var width = container.clientWidth || 600;
  var height = Math.max(Math.min(width * 0.65, 420), 260);

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

  // Projection — ZOOMED into the Middle East / Indian Ocean corridor
  // Center on ~55E 18N (between Hormuz and Bab el-Mandeb), covering Suez to Malacca
  var projection = d3.geoMercator()
    .center([62, 16])
    .scale(width / 2.2)
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
  var glow = defs.append("filter").attr("id", "glow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
  glow.append("feGaussianBlur").attr("stdDeviation", "3").attr("result", "coloredBlur");
  var feMerge = glow.append("feMerge");
  feMerge.append("feMergeNode").attr("in", "coloredBlur");
  feMerge.append("feMergeNode").attr("in", "SourceGraphic");

  // Graticule (subtle grid)
  var graticule = d3.geoGraticule().step([10, 10]);
  svg.append("path")
    .datum(graticule())
    .attr("d", path)
    .attr("fill", "none")
    .attr("stroke", "var(--color-border)")
    .attr("stroke-width", 0.3)
    .attr("stroke-opacity", 0.15);

  // Load world TopoJSON
  var worldUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

  d3.json(worldUrl).then(function(world) {
    if (!world || !world.objects || !world.objects.countries) {
      container.innerHTML = '<p style="color:var(--color-text-faint);text-align:center;padding:var(--space-6)">Map data format error</p>';
      return;
    }

    var countries = topojson.feature(world, world.objects.countries);

    // Draw countries
    svg.selectAll(".country")
      .data(countries.features)
      .enter().append("path")
      .attr("class", "country")
      .attr("d", path)
      .attr("fill", "var(--color-surface-2)")
      .attr("stroke", "var(--color-border)")
      .attr("stroke-width", 0.5);

    // Draw shipping routes
    var routeGroup = svg.append("g").attr("class", "routes");
    SHIPPING_ROUTES.forEach(function(route) {
      var isDisrupted = route.chokepoints.some(function(cpName) {
        return disruptedChokepoints[cpName];
      });

      var lineGen = d3.line()
        .x(function(d) { return projection([d[1], d[0]])[0]; })
        .y(function(d) { return projection([d[1], d[0]])[1]; })
        .curve(d3.curveBasis);

      // Glow behind disrupted routes
      if (isDisrupted) {
        routeGroup.append("path")
          .datum(route.points)
          .attr("d", lineGen)
          .attr("fill", "none")
          .attr("stroke", "#f59e0b")
          .attr("stroke-width", 5)
          .attr("stroke-opacity", 0.15)
          .attr("stroke-linecap", "round");
      }

      routeGroup.append("path")
        .datum(route.points)
        .attr("d", lineGen)
        .attr("fill", "none")
        .attr("stroke", isDisrupted ? "#f59e0b" : "rgba(148,163,184,0.35)")
        .attr("stroke-width", isDisrupted ? 2 : 1.2)
        .attr("stroke-opacity", isDisrupted ? 0.8 : 0.5)
        .attr("stroke-dasharray", isDisrupted ? "8,4" : "5,4")
        .attr("stroke-linecap", "round");
    });

    // Draw chokepoint markers
    var chokeGroup = svg.append("g").attr("class", "chokepoints");
    CHOKEPOINTS.forEach(function(cp) {
      var pos = projection([cp.lng, cp.lat]);
      if (!pos || pos[0] < -20 || pos[0] > width + 20 || pos[1] < -20 || pos[1] > height + 20) { return; }

      var status = chokeLookup[cp.name];
      var statusLevel = status ? status.status.toLowerCase() : "open";
      var color = statusLevel === "restricted" ? "var(--color-risk-medium)" :
                  statusLevel === "closed" ? "var(--color-risk-high)" : "var(--color-risk-low)";

      // Pulsing outer ring for restricted/closed
      if (statusLevel !== "open") {
        chokeGroup.append("circle")
          .attr("cx", pos[0]).attr("cy", pos[1])
          .attr("r", 16)
          .attr("fill", "none")
          .attr("stroke", color)
          .attr("stroke-width", 1.5)
          .attr("stroke-opacity", 0.5)
          .attr("class", "choke-pulse");

        // Inner alert ring
        chokeGroup.append("circle")
          .attr("cx", pos[0]).attr("cy", pos[1])
          .attr("r", 11)
          .attr("fill", "none")
          .attr("stroke", color)
          .attr("stroke-width", 0.8)
          .attr("stroke-opacity", 0.3);
      }

      // Main dot
      chokeGroup.append("circle")
        .attr("cx", pos[0]).attr("cy", pos[1])
        .attr("r", 7)
        .attr("fill", color)
        .attr("stroke", "#0c1220")
        .attr("stroke-width", 2)
        .attr("filter", "url(#glow)");

      // Label
      chokeGroup.append("text")
        .attr("x", pos[0] + (cp.labelDx || 0))
        .attr("y", pos[1] + (cp.labelDy || -16))
        .attr("text-anchor", "middle")
        .attr("font-size", "10px")
        .attr("font-weight", "600")
        .attr("fill", color)
        .attr("font-family", "var(--font-body)")
        .text(cp.shortName || cp.name);
    });

    // Inject pulse animation style
    if (!document.getElementById("chokePulseStyle")) {
      var style = document.createElement("style");
      style.id = "chokePulseStyle";
      style.textContent = "@keyframes chokePulse{0%,100%{r:16;opacity:.5}50%{r:22;opacity:0}}.choke-pulse{animation:chokePulse 2s infinite ease-in-out}";
      document.head.appendChild(style);
    }

  }).catch(function(err) {
    console.error("Map load error:", err);
    container.innerHTML = '<p style="color:var(--color-text-faint);text-align:center;padding:var(--space-6)">Map data unavailable</p>';
  });

  // Legend
  renderMapLegend(container);
}

function renderMapLegend(container) {
  var legend = document.createElement("div");
  legend.className = "map-legend";

  var html = '<div class="map-legend-items">';
  html += '<div class="map-legend-item"><span class="map-legend-dot" style="background:var(--color-risk-low)"></span><span class="map-legend-label">Open</span></div>';
  html += '<div class="map-legend-item"><span class="map-legend-dot" style="background:var(--color-risk-medium)"></span><span class="map-legend-label">Restricted</span></div>';
  html += '<div class="map-legend-item"><span class="map-legend-dot" style="background:var(--color-risk-high)"></span><span class="map-legend-label">Closed</span></div>';
  html += '<div class="map-legend-item"><span class="map-legend-swatch" style="background:#f59e0b;opacity:0.6"></span><span class="map-legend-label">Disrupted route</span></div>';
  html += '</div>';

  legend.innerHTML = html;
  container.appendChild(legend);
}

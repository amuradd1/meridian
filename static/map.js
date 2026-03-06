/* map.js — Chokepoint Corridor View with Cape of Good Hope rerouting */
/* global d3, topojson */

// Critical chokepoints with coordinates and label offsets
var CHOKEPOINTS = [
  { name: "Strait of Hormuz", shortName: "Hormuz", lat: 26.6, lng: 56.3, labelDx: 0, labelDy: -16 },
  { name: "Bab el-Mandeb", shortName: "Bab el-Mandeb", lat: 12.6, lng: 43.3, labelDx: 0, labelDy: 18 },
  { name: "Suez Canal", shortName: "Suez", lat: 30.5, lng: 32.3, labelDx: -16, labelDy: -14 },
  { name: "Malacca Strait", shortName: "Malacca", lat: 2.5, lng: 101.5, labelDx: 0, labelDy: -16 },
  { name: "Cape of Good Hope", shortName: "Cape of Good Hope", lat: -34.4, lng: 18.5, labelDx: 0, labelDy: 18, isReroute: true }
];

// Normal shipping routes (via chokepoints)
var SHIPPING_ROUTES = [
  { name: "East Africa → Suez → Europe", points: [[-8, 40], [5, 42], [12.6, 43.3], [25, 35], [30.5, 32.3], [36, 28]], chokepoints: ["Bab el-Mandeb", "Suez Canal"] },
  { name: "India → Suez → Europe", points: [[18, 73], [15, 60], [12.6, 43.3], [25, 35], [30.5, 32.3], [36, 28]], chokepoints: ["Bab el-Mandeb", "Suez Canal"] },
  { name: "China/SEA → Malacca → Middle East", points: [[18, 110], [5, 103], [2.5, 101.5], [0, 85], [-3, 65], [12.6, 43.3]], chokepoints: ["Malacca Strait", "Bab el-Mandeb"] },
  { name: "China → Hormuz → Gulf", points: [[18, 110], [12, 85], [20, 66], [26.6, 56.3]], chokepoints: ["Strait of Hormuz"] },
  { name: "Persian Gulf → Suez → Europe", points: [[26.6, 56.3], [20, 50], [12.6, 43.3], [25, 35], [30.5, 32.3], [36, 28]], chokepoints: ["Strait of Hormuz", "Bab el-Mandeb", "Suez Canal"] }
];

// Cape of Good Hope diversions — shown alongside normal routes when disruptions are active
var CAPE_REROUTES = [
  {
    name: "Diverted traffic via Cape",
    triggeredBy: ["Bab el-Mandeb", "Suez Canal"],
    label: "+10–14 days",
    points: [
      [5, 103],        // Malacca exit
      [0, 85],         // Indian Ocean
      [-8, 60],        // Mid Indian Ocean
      [-20, 42],       // SE of Madagascar
      [-30, 32],       // South of Mozambique
      [-34.4, 18.5],   // Cape of Good Hope
      [-30, 5],        // South Atlantic
      [-18, -5],       // Mid Atlantic
      [0, -10],        // Equatorial Atlantic
      [20, -15],       // West Africa offshore
      [36, -8],        // Bay of Biscay
      [42, -5],        // Approaching Gibraltar
      [36, 0],         // Western Med
    ]
  },
  {
    name: "Diverted traffic via Cape",
    triggeredBy: ["Strait of Hormuz"],
    label: "+7–12 days",
    points: [
      [24, 58],        // Persian Gulf exit south
      [15, 55],        // Arabian Sea
      [5, 48],         // Off Somalia
      [-8, 42],        // Off Tanzania
      [-20, 38],       // Mozambique Channel
      [-30, 32],       // South of Mozambique
      [-34.4, 18.5],   // Cape of Good Hope
      [-30, 5],        // South Atlantic
      [-18, -5],       // Mid Atlantic
      [0, -10],        // Equatorial Atlantic
      [20, -15],       // West Africa offshore
      [36, -8],        // Bay of Biscay
      [42, -5],        // Approaching Gibraltar
      [36, 0],         // Western Med
    ]
  }
];

function renderSupplyChainMap(chokeStatus) {
  var container = document.getElementById("supplyChainMap");
  if (!container) {
    console.error("Map container #supplyChainMap not found");
    return;
  }
  container.innerHTML = "";

  var width = container.clientWidth || 600;
  var height = Math.max(Math.min(width * 0.75, 500), 300);

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

  // Projection — widened to include Cape of Good Hope and western Med
  var projection = d3.geoMercator()
    .center([50, 2])
    .scale(width / 3.6)
    .translate([width / 2, height / 2]);

  var path = d3.geoPath().projection(projection);

  // Build chokepoint status lookup from live data
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

  // Identify disrupted chokepoints (RESTRICTED or CLOSED)
  var disruptedChokepoints = {};
  CHOKEPOINTS.forEach(function(cp) {
    if (cp.isReroute) { return; }
    var status = chokeLookup[cp.name];
    var level = status ? status.status.toLowerCase() : "open";
    if (level === "restricted" || level === "closed") {
      disruptedChokepoints[cp.name] = true;
    }
  });

  // Determine which Cape reroutes are active
  var activeReroutes = CAPE_REROUTES.filter(function(route) {
    return route.triggeredBy.some(function(cpName) {
      return disruptedChokepoints[cpName];
    });
  });
  var anyRerouteActive = activeReroutes.length > 0;

  // ── Defs ──
  var defs = svg.append("defs");

  var glow = defs.append("filter").attr("id", "glow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
  glow.append("feGaussianBlur").attr("stdDeviation", "3").attr("result", "coloredBlur");
  var feMerge = glow.append("feMerge");
  feMerge.append("feMergeNode").attr("in", "coloredBlur");
  feMerge.append("feMergeNode").attr("in", "SourceGraphic");

  // Arrow marker for Cape reroute
  defs.append("marker")
    .attr("id", "reroute-arrow")
    .attr("viewBox", "0 0 10 6")
    .attr("refX", 10)
    .attr("refY", 3)
    .attr("markerWidth", 8)
    .attr("markerHeight", 5)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,0 L10,3 L0,6 Z")
    .attr("fill", "#38bdf8");

  // Graticule
  var graticule = d3.geoGraticule().step([10, 10]);
  svg.append("path")
    .datum(graticule())
    .attr("d", path)
    .attr("fill", "none")
    .attr("stroke", "var(--color-border)")
    .attr("stroke-width", 0.3)
    .attr("stroke-opacity", 0.15);

  var worldUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

  d3.json(worldUrl).then(function(world) {
    if (!world || !world.objects || !world.objects.countries) {
      container.innerHTML = '<p style="color:var(--color-text-faint);text-align:center;padding:var(--space-6)">Map data format error</p>';
      return;
    }

    var countries = topojson.feature(world, world.objects.countries);

    svg.selectAll(".country")
      .data(countries.features)
      .enter().append("path")
      .attr("class", "country")
      .attr("d", path)
      .attr("fill", "var(--color-surface-2)")
      .attr("stroke", "var(--color-border)")
      .attr("stroke-width", 0.5);

    var lineGen = d3.line()
      .x(function(d) { return projection([d[1], d[0]])[0]; })
      .y(function(d) { return projection([d[1], d[0]])[1]; })
      .curve(d3.curveBasis);

    // ── Layer 1: Normal shipping routes ──
    // These always render. Disrupted ones get an amber tint to show reduced traffic,
    // but they stay visible because ships ARE still transiting.
    var routeGroup = svg.append("g").attr("class", "routes");

    SHIPPING_ROUTES.forEach(function(route) {
      var isDisrupted = route.chokepoints.some(function(cpName) {
        return disruptedChokepoints[cpName];
      });

      if (isDisrupted) {
        // Amber glow behind — signals caution, reduced traffic
        routeGroup.append("path")
          .datum(route.points)
          .attr("d", lineGen)
          .attr("fill", "none")
          .attr("stroke", "#f59e0b")
          .attr("stroke-width", 5)
          .attr("stroke-opacity", 0.12)
          .attr("stroke-linecap", "round");

        // Dashed amber line — still active, but flagged
        routeGroup.append("path")
          .datum(route.points)
          .attr("d", lineGen)
          .attr("fill", "none")
          .attr("stroke", "#f59e0b")
          .attr("stroke-width", 1.5)
          .attr("stroke-opacity", 0.55)
          .attr("stroke-dasharray", "6,5")
          .attr("stroke-linecap", "round");
      } else {
        // Normal undisrupted lane
        routeGroup.append("path")
          .datum(route.points)
          .attr("d", lineGen)
          .attr("fill", "none")
          .attr("stroke", "rgba(148,163,184,0.35)")
          .attr("stroke-width", 1.2)
          .attr("stroke-opacity", 0.5)
          .attr("stroke-dasharray", "5,4")
          .attr("stroke-linecap", "round");
      }
    });

    // ── Layer 2: Cape reroute paths ──
    // Only rendered when corresponding chokepoints have active disruptions.
    // Shown as a solid, prominent line — this is where diverted traffic is going.
    var rerouteGroup = svg.append("g").attr("class", "reroutes");

    activeReroutes.forEach(function(route, ri) {
      // Soft glow
      rerouteGroup.append("path")
        .datum(route.points)
        .attr("d", lineGen)
        .attr("fill", "none")
        .attr("stroke", "#38bdf8")
        .attr("stroke-width", 7)
        .attr("stroke-opacity", 0.07)
        .attr("stroke-linecap", "round");

      // Main reroute line — animated flowing dashes
      rerouteGroup.append("path")
        .datum(route.points)
        .attr("d", lineGen)
        .attr("fill", "none")
        .attr("stroke", "#38bdf8")
        .attr("stroke-width", 2.5)
        .attr("stroke-opacity", 0.85)
        .attr("stroke-linecap", "round")
        .attr("class", "reroute-line");

      // Delay label near Cape of Good Hope
      var capePos = projection([18.5, -34.4]);
      if (capePos && capePos[0] > 0 && capePos[0] < width && capePos[1] > 0 && capePos[1] < height) {
        // Only show one label even if multiple reroutes (avoid overlap)
        if (ri === 0) {
          var labelText = route.label;
          var labelW = labelText.length * 6 + 16;
          rerouteGroup.append("rect")
            .attr("x", capePos[0] - labelW / 2)
            .attr("y", capePos[1] + 24)
            .attr("width", labelW)
            .attr("height", 18)
            .attr("rx", 4)
            .attr("fill", "rgba(56, 189, 248, 0.12)")
            .attr("stroke", "rgba(56, 189, 248, 0.3)")
            .attr("stroke-width", 1);

          rerouteGroup.append("text")
            .attr("x", capePos[0])
            .attr("y", capePos[1] + 36)
            .attr("text-anchor", "middle")
            .attr("font-size", "9px")
            .attr("font-weight", "700")
            .attr("fill", "#38bdf8")
            .attr("font-family", "var(--font-body)")
            .text(labelText);
        }
      }
    });

    // ── Layer 3: Chokepoint markers ──
    var chokeGroup = svg.append("g").attr("class", "chokepoints");

    CHOKEPOINTS.forEach(function(cp) {
      var pos = projection([cp.lng, cp.lat]);
      if (!pos || pos[0] < -20 || pos[0] > width + 20 || pos[1] < -20 || pos[1] > height + 20) { return; }

      // Cape marker only shows when reroutes are active
      if (cp.isReroute && !anyRerouteActive) { return; }

      var status = chokeLookup[cp.name];
      var statusLevel = status ? status.status.toLowerCase() : "open";

      var color;
      if (cp.isReroute) {
        color = "#38bdf8";
      } else {
        color = statusLevel === "restricted" ? "var(--color-risk-medium)" :
                statusLevel === "closed" ? "var(--color-risk-high)" : "var(--color-risk-low)";
      }

      // Pulsing outer ring for disrupted chokepoints
      if (!cp.isReroute && statusLevel !== "open") {
        chokeGroup.append("circle")
          .attr("cx", pos[0]).attr("cy", pos[1])
          .attr("r", 16)
          .attr("fill", "none")
          .attr("stroke", color)
          .attr("stroke-width", 1.5)
          .attr("stroke-opacity", 0.5)
          .attr("class", "choke-pulse");

        chokeGroup.append("circle")
          .attr("cx", pos[0]).attr("cy", pos[1])
          .attr("r", 11)
          .attr("fill", "none")
          .attr("stroke", color)
          .attr("stroke-width", 0.8)
          .attr("stroke-opacity", 0.3);
      }

      // Cape gets a diamond marker
      if (cp.isReroute) {
        var d = 6;
        chokeGroup.append("path")
          .attr("d", "M" + pos[0] + "," + (pos[1] - d) +
                " L" + (pos[0] + d) + "," + pos[1] +
                " L" + pos[0] + "," + (pos[1] + d) +
                " L" + (pos[0] - d) + "," + pos[1] + " Z")
          .attr("fill", color)
          .attr("stroke", "#0c1220")
          .attr("stroke-width", 1.5)
          .attr("filter", "url(#glow)");
      } else {
        chokeGroup.append("circle")
          .attr("cx", pos[0]).attr("cy", pos[1])
          .attr("r", 7)
          .attr("fill", color)
          .attr("stroke", "#0c1220")
          .attr("stroke-width", 2)
          .attr("filter", "url(#glow)");
      }

      // Label
      chokeGroup.append("text")
        .attr("x", pos[0] + (cp.labelDx || 0))
        .attr("y", pos[1] + (cp.labelDy || -16))
        .attr("text-anchor", "middle")
        .attr("font-size", cp.isReroute ? "9px" : "10px")
        .attr("font-weight", "600")
        .attr("fill", color)
        .attr("font-family", "var(--font-body)")
        .text(cp.shortName || cp.name);
    });

    // ── Animations ──
    if (!document.getElementById("chokePulseStyle")) {
      var style = document.createElement("style");
      style.id = "chokePulseStyle";
      style.textContent =
        "@keyframes chokePulse{0%,100%{r:16;opacity:.5}50%{r:22;opacity:0}}" +
        ".choke-pulse{animation:chokePulse 2s infinite ease-in-out}" +
        "@keyframes rerouteFlow{to{stroke-dashoffset:-24}}" +
        ".reroute-line{stroke-dasharray:14,6;animation:rerouteFlow 1.2s linear infinite}";
      document.head.appendChild(style);
    }

  }).catch(function(err) {
    console.error("Map load error:", err);
    container.innerHTML = '<p style="color:var(--color-text-faint);text-align:center;padding:var(--space-6)">Map data unavailable</p>';
  });

  renderMapLegend(container, anyRerouteActive);
}

function renderMapLegend(container, showReroute) {
  var legend = document.createElement("div");
  legend.className = "map-legend";

  var html = '<div class="map-legend-items">';
  html += '<div class="map-legend-item"><span class="map-legend-dot" style="background:var(--color-risk-low)"></span><span class="map-legend-label">Open</span></div>';
  html += '<div class="map-legend-item"><span class="map-legend-dot" style="background:var(--color-risk-medium)"></span><span class="map-legend-label">Restricted</span></div>';
  html += '<div class="map-legend-item"><span class="map-legend-dot" style="background:var(--color-risk-high)"></span><span class="map-legend-label">Closed</span></div>';
  html += '<div class="map-legend-item"><span class="map-legend-swatch" style="background:#f59e0b;opacity:0.55"></span><span class="map-legend-label">Reduced traffic</span></div>';
  if (showReroute) {
    html += '<div class="map-legend-item"><span class="map-legend-swatch" style="background:#38bdf8;opacity:0.8"></span><span class="map-legend-label">Cape diversion</span></div>';
  }
  html += '</div>';

  legend.innerHTML = html;
  container.appendChild(legend);
}

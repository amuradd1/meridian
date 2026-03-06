/* map.js — Global Supply Chain Risk Map */
/* global d3, topojson */

// Tobacco supplier origin countries (default — will be overridden by Supabase data when available)
var SUPPLIER_ORIGINS = {
  "Cellulose Acetate Filter Tow": [
    { country: "Belgium", iso: "BEL", lat: 50.5, lng: 4.5 },
    { country: "United Kingdom", iso: "GBR", lat: 51.5, lng: -0.12 },
    { country: "China", iso: "CHN", lat: 35.9, lng: 104.2 },
    { country: "United States", iso: "USA", lat: 37.1, lng: -95.7 }
  ],
  "Cigarette Packaging (Board & Print)": [
    { country: "Germany", iso: "DEU", lat: 51.2, lng: 10.5 },
    { country: "Austria", iso: "AUT", lat: 47.5, lng: 14.6 },
    { country: "Indonesia", iso: "IDN", lat: -0.8, lng: 113.9 }
  ],
  "Flexible Packaging & Foils": [
    { country: "China", iso: "CHN", lat: 35.9, lng: 104.2 },
    { country: "India", iso: "IND", lat: 20.6, lng: 78.9 },
    { country: "Turkey", iso: "TUR", lat: 39.9, lng: 32.9 },
    { country: "Italy", iso: "ITA", lat: 41.9, lng: 12.6 }
  ],
  "Flavors & Ingredients": [
    { country: "India", iso: "IND", lat: 20.6, lng: 78.9 },
    { country: "China", iso: "CHN", lat: 35.9, lng: 104.2 },
    { country: "Germany", iso: "DEU", lat: 51.2, lng: 10.5 },
    { country: "United States", iso: "USA", lat: 37.1, lng: -95.7 }
  ],
  "Heated Tobacco Devices & Consumables": [
    { country: "China", iso: "CHN", lat: 35.9, lng: 104.2 },
    { country: "South Korea", iso: "KOR", lat: 35.9, lng: 127.8 },
    { country: "Japan", iso: "JPN", lat: 36.2, lng: 138.3 }
  ],
  "E-Cigarettes & Vape Devices": [
    { country: "China", iso: "CHN", lat: 35.9, lng: 104.2 }
  ],
  "Nicotine Pouches": [
    { country: "Sweden", iso: "SWE", lat: 60.1, lng: 18.6 },
    { country: "India", iso: "IND", lat: 20.6, lng: 78.9 },
    { country: "United States", iso: "USA", lat: 37.1, lng: -95.7 }
  ]
};

// Critical chokepoints with coordinates
var CHOKEPOINTS = [
  { name: "Strait of Hormuz", lat: 26.6, lng: 56.3 },
  { name: "Bab el-Mandeb", lat: 12.6, lng: 43.3 },
  { name: "Suez Canal", lat: 30.5, lng: 32.3 },
  { name: "Malacca Strait", lat: 2.5, lng: 101.5 }
];

// Key shipping routes as arcs (simplified great-circle waypoints)
var SHIPPING_ROUTES = [
  { name: "East Africa → Suez", points: [[-13.3, 34.3], [-2, 40], [12.6, 43.3], [30.5, 32.3], [42, 12]], color: "#f59e0b" },
  { name: "India → Suez → Europe", points: [[20.6, 78.9], [15, 65], [12.6, 43.3], [30.5, 32.3], [42, 12]], color: "#38bdf8" },
  { name: "China/SEA → Malacca → Europe", points: [[22.5, 114], [2.5, 104], [2.5, 101.5], [-5, 60], [12.6, 43.3], [30.5, 32.3], [42, 12]], color: "#a78bfa" },
  { name: "China → Hormuz → Middle East", points: [[22.5, 114], [10, 80], [26.6, 56.3]], color: "#ef4444" }
];

// Category color palette
var CATEGORY_COLORS = {
  "Cellulose Acetate Filter Tow": "#f59e0b",
  "Cigarette Packaging (Board & Print)": "#38bdf8",
  "Flexible Packaging & Foils": "#a78bfa",
  "Flavors & Ingredients": "#ec4899",
  "Heated Tobacco Devices & Consumables": "#f97316",
  "E-Cigarettes & Vape Devices": "#ef4444",
  "Nicotine Pouches": "#14b8a6"
};

function renderSupplyChainMap(chokeStatus, riskHeatmap) {
  var container = document.getElementById("supplyChainMap");
  if (!container) {
    console.error("Map container #supplyChainMap not found");
    return;
  }
  container.innerHTML = "";

  var width = container.clientWidth || 900;
  var height = Math.min(width * 0.52, 480);

  // If container has no width yet, retry after a short delay
  if (width < 100) {
    console.warn("Map container has no width, retrying...");
    setTimeout(function() {
      renderSupplyChainMap(chokeStatus, riskHeatmap);
    }, 200);
    return;
  }

  var svg = d3.select(container)
    .append("svg")
    .attr("viewBox", "0 0 " + width + " " + height)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .style("width", "100%")
    .style("height", "auto")
    .style("background", "transparent");

  // Projection — Natural Earth
  var projection = d3.geoNaturalEarth1()
    .scale(width / 5.8)
    .translate([width / 2, height / 2]);

  var path = d3.geoPath().projection(projection);

  // Build risk lookup from intelligence data
  var riskLookup = {};
  if (riskHeatmap) {
    riskHeatmap.forEach(function(r) {
      var rl = r.risk ? r.risk.toLowerCase() : "medium";
      // Map region names to ISO codes
      var regionCountries = {
        "Middle East": ["IRN", "IRQ", "SAU", "ARE", "QAT", "KWT", "OMN", "YEM", "BHR", "JOR", "SYR", "LBN", "ISR", "PSE"],
        "Red Sea": ["EGY", "SDN", "ERI", "DJI", "SOM"],
        "South China Sea": ["CHN", "VNM", "PHL", "MYS", "BRN", "TWN"],
        "Black Sea": ["UKR", "RUS", "ROU", "BGR", "GEO", "TUR"]
      };
      var codes = regionCountries[r.region] || [];
      codes.forEach(function(c) { riskLookup[c] = rl; });
    });
  }

  // Build supplier country set
  var supplierISOs = {};
  Object.keys(SUPPLIER_ORIGINS).forEach(function(cat) {
    SUPPLIER_ORIGINS[cat].forEach(function(s) {
      if (!supplierISOs[s.iso]) { supplierISOs[s.iso] = []; }
      supplierISOs[s.iso].push(cat);
    });
  });

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

  // Defs for glow and gradients
  var defs = svg.append("defs");
  
  var glow = defs.append("filter").attr("id", "glow");
  glow.append("feGaussianBlur").attr("stdDeviation", "2").attr("result", "coloredBlur");
  var feMerge = glow.append("feMerge");
  feMerge.append("feMergeNode").attr("in", "coloredBlur");
  feMerge.append("feMergeNode").attr("in", "SourceGraphic");

  var pulseGlow = defs.append("filter").attr("id", "pulseGlow");
  pulseGlow.append("feGaussianBlur").attr("stdDeviation", "3").attr("result", "blur");
  var feMerge2 = pulseGlow.append("feMerge");
  feMerge2.append("feMergeNode").attr("in", "blur");
  feMerge2.append("feMergeNode").attr("in", "SourceGraphic");

  // Graticule (lat/lng grid lines)
  var graticule = d3.geoGraticule().step([30, 30]);
  svg.append("path")
    .datum(graticule())
    .attr("d", path)
    .attr("fill", "none")
    .attr("stroke", "var(--color-border)")
    .attr("stroke-width", 0.3)
    .attr("stroke-opacity", 0.5);

  // Load world TopoJSON
  var worldUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
  
  d3.json(worldUrl).then(function(world) {
    if (!world || !world.objects || !world.objects.countries) {
      console.error("Invalid TopoJSON data:", world);
      container.innerHTML = '<p style="color:var(--color-text-faint);text-align:center;padding:var(--space-6)">Map data format error</p>';
      return;
    }

    var countries = topojson.feature(world, world.objects.countries);

    // Country ID to ISO lookup (Natural Earth numeric → ISO3)
    var idToISO = {};
    // Common numeric ID mappings
    var numToISO = {
      4: "AFG", 8: "ALB", 12: "DZA", 24: "AGO", 32: "ARG", 36: "AUS", 40: "AUT",
      50: "BGD", 56: "BEL", 68: "BOL", 70: "BIH", 72: "BWA", 76: "BRA", 100: "BGR",
      104: "MMR", 116: "KHM", 120: "CMR", 124: "CAN", 144: "LKA", 152: "CHL",
      156: "CHN", 170: "COL", 180: "COD", 188: "CRI", 191: "HRV", 192: "CUB",
      196: "CYP", 203: "CZE", 208: "DNK", 214: "DOM", 218: "ECU", 818: "EGY",
      222: "SLV", 231: "ETH", 232: "ERI", 233: "EST", 246: "FIN", 250: "FRA",
      262: "DJI", 266: "GAB", 268: "GEO", 276: "DEU", 288: "GHA", 300: "GRC",
      320: "GTM", 324: "GIN", 332: "HTI", 340: "HND", 348: "HUN", 352: "ISL",
      356: "IND", 360: "IDN", 364: "IRN", 368: "IRQ", 372: "IRL", 376: "ISR",
      380: "ITA", 384: "CIV", 388: "JAM", 392: "JPN", 398: "KAZ", 400: "JOR",
      404: "KEN", 408: "PRK", 410: "KOR", 414: "KWT", 422: "LBN", 426: "LSO",
      430: "LBR", 434: "LBY", 440: "LTU", 442: "LUX", 450: "MDG", 454: "MWI",
      458: "MYS", 466: "MLI", 478: "MRT", 484: "MEX", 496: "MNG", 504: "MAR",
      508: "MOZ", 512: "OMN", 516: "NAM", 524: "NPL", 528: "NLD", 540: "NCL",
      554: "NZL", 558: "NIC", 562: "NER", 566: "NGA", 578: "NOR", 586: "PAK",
      591: "PAN", 598: "PNG", 600: "PRY", 604: "PER", 608: "PHL", 616: "POL",
      620: "PRT", 630: "PRI", 634: "QAT", 642: "ROU", 643: "RUS", 646: "RWA",
      682: "SAU", 686: "SEN", 688: "SRB", 694: "SLE", 702: "SGP", 703: "SVK",
      704: "VNM", 705: "SVN", 706: "SOM", 710: "ZAF", 716: "ZWE", 724: "ESP",
      729: "SDN", 736: "SSD", 740: "SUR", 752: "SWE", 756: "CHE", 760: "SYR",
      762: "TJK", 764: "THA", 768: "TGO", 780: "TTO", 784: "ARE", 788: "TUN",
      792: "TUR", 800: "UGA", 804: "UKR", 807: "MKD", 826: "GBR", 834: "TZA",
      840: "USA", 854: "BFA", 858: "URY", 860: "UZB", 862: "VEN", 887: "YEM",
      894: "ZMB", 48: "BHR", 10: "ATA", 158: "TWN", 275: "PSE"
    };

    countries.features.forEach(function(f) {
      var numId = +f.id || +f.properties.id;
      idToISO[f.id] = numToISO[numId] || f.id;
    });

    // Draw countries
    svg.selectAll(".country")
      .data(countries.features)
      .enter().append("path")
      .attr("class", "country")
      .attr("d", path)
      .attr("fill", function(d) {
        var iso = idToISO[d.id];
        // Check risk region first
        if (riskLookup[iso] === "high") { return "rgba(239, 68, 68, 0.25)"; }
        if (riskLookup[iso] === "medium") { return "rgba(245, 158, 11, 0.15)"; }
        // Check if supplier country
        if (supplierISOs[iso]) { return "rgba(56, 189, 248, 0.15)"; }
        // Default
        return "var(--color-surface-2)";
      })
      .attr("stroke", function(d) {
        var iso = idToISO[d.id];
        if (riskLookup[iso] === "high") { return "rgba(239, 68, 68, 0.5)"; }
        if (riskLookup[iso] === "medium") { return "rgba(245, 158, 11, 0.35)"; }
        if (supplierISOs[iso]) { return "rgba(56, 189, 248, 0.4)"; }
        return "var(--color-border)";
      })
      .attr("stroke-width", function(d) {
        var iso = idToISO[d.id];
        return (riskLookup[iso] || supplierISOs[iso]) ? 0.8 : 0.3;
      });

    // Draw shipping routes as curved lines
    var routeGroup = svg.append("g").attr("class", "routes");
    SHIPPING_ROUTES.forEach(function(route) {
      var lineGen = d3.line()
        .x(function(d) { return projection([ d[1], d[0] ])[0]; })
        .y(function(d) { return projection([ d[1], d[0] ])[1]; })
        .curve(d3.curveBasis);

      routeGroup.append("path")
        .datum(route.points)
        .attr("d", lineGen)
        .attr("fill", "none")
        .attr("stroke", route.color)
        .attr("stroke-width", 1.2)
        .attr("stroke-opacity", 0.4)
        .attr("stroke-dasharray", "4,3");
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
          .attr("r", 8)
          .attr("fill", "none")
          .attr("stroke", color)
          .attr("stroke-width", 1)
          .attr("stroke-opacity", 0.6)
          .attr("class", "choke-pulse");
      }

      chokeGroup.append("circle")
        .attr("cx", pos[0]).attr("cy", pos[1])
        .attr("r", 4)
        .attr("fill", color)
        .attr("stroke", "#0c1220")
        .attr("stroke-width", 1.5)
        .attr("filter", "url(#glow)");

      chokeGroup.append("text")
        .attr("x", pos[0]).attr("y", pos[1] - 9)
        .attr("text-anchor", "middle")
        .attr("font-size", "8px")
        .attr("font-weight", "600")
        .attr("fill", color)
        .attr("font-family", "var(--font-body)")
        .text(cp.name);
    });

    // Draw supplier origin dots
    var dotGroup = svg.append("g").attr("class", "supplier-dots");
    var allOrigins = [];
    Object.keys(SUPPLIER_ORIGINS).forEach(function(cat) {
      SUPPLIER_ORIGINS[cat].forEach(function(origin) {
        allOrigins.push({ category: cat, country: origin.country, iso: origin.iso, lat: origin.lat, lng: origin.lng });
      });
    });

    // Deduplicate by country (show as multi-category dots)
    var countryDots = {};
    allOrigins.forEach(function(o) {
      if (!countryDots[o.iso]) {
        countryDots[o.iso] = { country: o.country, lat: o.lat, lng: o.lng, categories: [] };
      }
      if (countryDots[o.iso].categories.indexOf(o.category) === -1) {
        countryDots[o.iso].categories.push(o.category);
      }
    });

    Object.keys(countryDots).forEach(function(iso) {
      var dot = countryDots[iso];
      var pos = projection([dot.lng, dot.lat]);
      if (!pos) { return; }
      var r = 3 + dot.categories.length * 1.2;
      var mainCat = dot.categories[0];

      // Outer glow
      dotGroup.append("circle")
        .attr("cx", pos[0]).attr("cy", pos[1])
        .attr("r", r + 3)
        .attr("fill", CATEGORY_COLORS[mainCat] || "#38bdf8")
        .attr("fill-opacity", 0.15)
        .attr("filter", "url(#pulseGlow)");

      // Main dot
      dotGroup.append("circle")
        .attr("cx", pos[0]).attr("cy", pos[1])
        .attr("r", r)
        .attr("fill", CATEGORY_COLORS[mainCat] || "#38bdf8")
        .attr("fill-opacity", 0.8)
        .attr("stroke", "#0c1220")
        .attr("stroke-width", 1);

      // Category count badge if multiple
      if (dot.categories.length > 1) {
        dotGroup.append("text")
          .attr("x", pos[0]).attr("y", pos[1] + 3)
          .attr("text-anchor", "middle")
          .attr("font-size", "7px")
          .attr("font-weight", "700")
          .attr("fill", "#0c1220")
          .attr("font-family", "var(--font-body)")
          .text(dot.categories.length);
      }

      // Country label
      dotGroup.append("text")
        .attr("x", pos[0]).attr("y", pos[1] + r + 10)
        .attr("text-anchor", "middle")
        .attr("font-size", "7px")
        .attr("font-weight", "500")
        .attr("fill", "var(--color-text-muted)")
        .attr("font-family", "var(--font-body)")
        .text(dot.country);
    });

    // Animate chokepoint pulses
    if (!document.getElementById('chokePulseStyle')) {
      var style = document.createElement("style");
      style.id = 'chokePulseStyle';
      style.textContent = "@keyframes chokePulse{0%,100%{r:8;opacity:.6}50%{r:14;opacity:0}}.choke-pulse{animation:chokePulse 2s infinite ease-in-out}";
      document.head.appendChild(style);
    }

  }).catch(function(err) {
    console.error("Map load error:", err);
    container.innerHTML = '<p style="color:var(--color-text-faint);text-align:center;padding:var(--space-6)">Map data unavailable — ' + (err.message || err) + '</p>';
  });

  // Build legend
  renderMapLegend(container);
}

function renderMapLegend(container) {
  var legend = document.createElement("div");
  legend.className = "map-legend";
  
  var html = '<div class="map-legend-title">Supply Origins by Category</div><div class="map-legend-items">';
  Object.keys(CATEGORY_COLORS).forEach(function(cat) {
    html += '<div class="map-legend-item">' +
      '<span class="map-legend-dot" style="background:' + CATEGORY_COLORS[cat] + '"></span>' +
      '<span class="map-legend-label">' + cat + '</span></div>';
  });
  html += '</div>';
  
  html += '<div class="map-legend-title" style="margin-top:var(--space-3)">Chokepoint Status</div><div class="map-legend-items">';
  html += '<div class="map-legend-item"><span class="map-legend-dot" style="background:var(--color-risk-low)"></span><span class="map-legend-label">Open</span></div>';
  html += '<div class="map-legend-item"><span class="map-legend-dot" style="background:var(--color-risk-medium)"></span><span class="map-legend-label">Restricted</span></div>';
  html += '<div class="map-legend-item"><span class="map-legend-dot" style="background:var(--color-risk-high)"></span><span class="map-legend-label">Closed</span></div>';
  html += '</div>';
  
  html += '<div class="map-legend-title" style="margin-top:var(--space-3)">Risk Regions</div><div class="map-legend-items">';
  html += '<div class="map-legend-item"><span class="map-legend-swatch" style="background:rgba(239,68,68,0.25);border:1px solid rgba(239,68,68,0.5)"></span><span class="map-legend-label">High Risk</span></div>';
  html += '<div class="map-legend-item"><span class="map-legend-swatch" style="background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.35)"></span><span class="map-legend-label">Medium Risk</span></div>';
  html += '</div>';
  
  legend.innerHTML = html;
  container.appendChild(legend);
}

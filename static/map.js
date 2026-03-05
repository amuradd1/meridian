/* map.js — Global Supply Chain Risk Map */

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
    { country: "United States", iso: "USA", lat: 37.1, lng: -95.7 },
    { country: "France", iso: "FRA", lat: 46.2, lng: 2.2 },
    { country: "China", iso: "CHN", lat: 35.9, lng: 104.2 },
    { country: "India", iso: "IND", lat: 20.6, lng: 78.9 }
  ],
  "Heated Tobacco Devices & Consumables": [
    { country: "China", iso: "CHN", lat: 35.9, lng: 104.2 },
    { country: "Malaysia", iso: "MYS", lat: 4.2, lng: 108.0 },
    { country: "South Korea", iso: "KOR", lat: 36.5, lng: 127.9 }
  ],
  "E-Cigarettes & Vape Devices": [
    { country: "China", iso: "CHN", lat: 22.5, lng: 114.1 },
    { country: "Malaysia", iso: "MYS", lat: 4.2, lng: 108.0 }
  ],
  "Nicotine Pouches": [
    { country: "Sweden", iso: "SWE", lat: 60.1, lng: 18.6 },
    { country: "Switzerland", iso: "CHE", lat: 46.8, lng: 8.2 },
    { country: "China", iso: "CHN", lat: 35.9, lng: 104.2 }
  ]
};

// Major shipping routes (polylines)
var SHIPPING_ROUTES = [
  { name: "Asia-Europe (Suez)", points: [[22.5,114.1],[3.1,101.7],[-1.3,103.8],[1.3,104.8],[4.0,98.0],[12.6,44.0],[12.8,43.1],[27.9,34.0],[30.0,32.3],[31.2,32.4],[36.8,22.0],[37.3,24.1],[38.9,20.5],[44.0,15.3],[51.5,-0.1]]},
  { name: "Transpacific", points: [[22.5,114.1],[25.0,140.0],[35.0,165.0],[38.0,-122.5],[34.0,-118.3]]},
  { name: "Asia-Cape of Good Hope", points: [[22.5,114.1],[3.1,101.7],[-1.3,103.8],[1.3,104.8],[-10.0,90.0],[-34.4,18.5],[-33.9,-70.7],[51.5,-0.1]]}
];

// Chokepoints with coordinates
var CHOKEPOINTS = [
  { name: "Strait of Hormuz",      lat: 26.6, lng: 56.3 },
  { name: "Bab el-Mandeb",         lat: 12.6, lng: 43.3 },
  { name: "Suez Canal",            lat: 30.5, lng: 32.4 },
  { name: "Malacca Strait",        lat: 2.5,  lng: 101.5 }
];

function renderSupplyChainMap(containerId, data) {
  var container = document.getElementById(containerId);
  if (!container) return;

  // Clear any previous content
  container.innerHTML = '';

  var width  = container.clientWidth  || 800;
  var height = container.clientHeight || 380;

  // --- SVG setup ---
  var svg = d3.select('#' + containerId)
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', '0 0 ' + width + ' ' + height);

  // Background
  svg.append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', '#0c1220');

  // Projection: Natural Earth
  var projection = d3.geoNaturalEarth1()
    .scale(width / 6.5)
    .translate([width / 2, height / 2]);

  var path = d3.geoPath().projection(projection);

  // Graticule
  var graticule = d3.geoGraticule();
  svg.append('path')
    .datum(graticule())
    .attr('d', path)
    .attr('fill', 'none')
    .attr('stroke', '#1e2d40')
    .attr('stroke-width', 0.3);

  // Load world topojson
  d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json').then(function(world) {
    var countries = topojson.feature(world, world.objects.countries);

    // Draw countries
    svg.selectAll('.country')
      .data(countries.features)
      .enter().append('path')
        .attr('class', 'country')
        .attr('d', path)
        .attr('fill', '#1a2332')
        .attr('stroke', '#1e2d40')
        .attr('stroke-width', 0.4);

    // Highlight supplier countries
    var supplierCountries = new Set();
    var categoryData = {};
    if (data && data.intelligence && data.intelligence.procurement_categories) {
      data.intelligence.procurement_categories.forEach(function(cat) {
        var origins = SUPPLIER_ORIGINS[cat.name] || [];
        origins.forEach(function(o) {
          supplierCountries.add(o.iso);
          if (!categoryData[o.iso]) categoryData[o.iso] = [];
          categoryData[o.iso].push({ category: cat.name, risk: cat.risk });
        });
      });
    }

    // Country ISO codes from numeric topojson IDs
    var isoMap = {
      '056': 'BEL', '826': 'GBR', '156': 'CHN', '840': 'USA',
      '276': 'DEU', '040': 'AUT', '360': 'IDN', '356': 'IND',
      '792': 'TUR', '380': 'ITA', '250': 'FRA', '458': 'MYS',
      '410': 'KOR', '752': 'SWE', '756': 'CHE'
    };

    svg.selectAll('.country').each(function(d) {
      var numericId = d.id ? String(d.id).padStart(3, '0') : null;
      var iso = numericId ? isoMap[numericId] : null;
      if (iso && supplierCountries.has(iso)) {
        var cats = categoryData[iso] || [];
        var hasHigh = cats.some(function(c) { return c.risk === 'H'; });
        var hasMed = cats.some(function(c) { return c.risk === 'M'; });
        d3.select(this).attr('fill', hasHigh ? 'rgba(239,68,68,0.35)' : hasMed ? 'rgba(245,158,11,0.3)' : 'rgba(34,197,94,0.25)');
      }
    });

    // Draw shipping routes
    SHIPPING_ROUTES.forEach(function(route) {
      var lineData = route.points.map(function(p) {
        return projection([p[1], p[0]]);
      }).filter(function(p) { return p !== null; });

      if (lineData.length < 2) return;

      var line = d3.line().x(function(d) { return d[0]; }).y(function(d) { return d[1]; }).curve(d3.curveCatmullRom.alpha(0.5));

      svg.append('path')
        .datum(lineData)
        .attr('d', line)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(56,189,248,0.25)')
        .attr('stroke-width', 1.2)
        .attr('stroke-dasharray', '4,3');
    });

    // Draw chokepoints
    if (data && data.intelligence && data.intelligence.chokepoint_status) {
      var cpStatusMap = {};
      data.intelligence.chokepoint_status.forEach(function(cp) {
        cpStatusMap[cp.name] = cp.status;
      });

      CHOKEPOINTS.forEach(function(cp) {
        var pt = projection([cp.lng, cp.lat]);
        if (!pt) return;
        var status = (cpStatusMap[cp.name] || 'OPEN').toLowerCase();
        var color = status === 'open' ? '#22c55e' : status === 'restricted' ? '#f59e0b' : '#ef4444';

        // Pulse ring
        svg.append('circle')
          .attr('cx', pt[0]).attr('cy', pt[1])
          .attr('r', 8)
          .attr('fill', color)
          .attr('opacity', 0.15);

        svg.append('circle')
          .attr('cx', pt[0]).attr('cy', pt[1])
          .attr('r', 4)
          .attr('fill', color)
          .attr('opacity', 0.8);

        // Label
        svg.append('text')
          .attr('x', pt[0] + 7)
          .attr('y', pt[1] + 4)
          .attr('fill', '#94a3b8')
          .attr('font-size', '8px')
          .attr('font-family', 'Inter, sans-serif')
          .text(cp.name.split('/')[0].trim());
      });
    }

    // Supplier origin dots
    Object.entries(SUPPLIER_ORIGINS).forEach(function(entry) {
      var catName = entry[0];
      var origins = entry[1];
      var catRisk = 'L';
      if (data && data.intelligence && data.intelligence.procurement_categories) {
        var cat = data.intelligence.procurement_categories.find(function(c) { return c.name === catName; });
        if (cat) catRisk = cat.risk;
      }
      var dotColor = catRisk === 'H' ? '#ef4444' : catRisk === 'M' ? '#f59e0b' : '#22c55e';

      origins.forEach(function(origin) {
        var pt = projection([origin.lng, origin.lat]);
        if (!pt) return;
        svg.append('circle')
          .attr('cx', pt[0]).attr('cy', pt[1])
          .attr('r', 3)
          .attr('fill', dotColor)
          .attr('opacity', 0.7)
          .append('title')
          .text(origin.country + ' (' + catName + ')');
      });
    });

  }).catch(function(err) {
    console.warn('Map data load failed:', err);
    svg.append('text')
      .attr('x', width / 2).attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', '#64748b')
      .attr('font-size', '13px')
      .text('Map unavailable');
  });
}

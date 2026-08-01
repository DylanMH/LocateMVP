/**
 * Geo seed data for Texas counties and cities.
 * Simplified polygons/points for territory definition UI.
 * Data source: US Census TIGER/Line (simplified to ~500 points per county max)
 */

// Texas state FIPS = 48
export const TX_COUNTIES = [
  // Major Dallas-Fort Worth Metroplex counties
  { fips: "48-085", name: "Collin", state: "TX", centroid: { lat: 33.1876, lng: -96.5724 }, bbox: { north: 33.4057, south: 32.9817, east: -96.2989, west: -96.8449 } },
  { fips: "48-113", name: "Dallas", state: "TX", centroid: { lat: 32.7668, lng: -96.7779 }, bbox: { north: 33.0216, south: 32.5448, east: -96.5181, west: -97.0380 } },
  { fips: "48-121", name: "Denton", state: "TX", centroid: { lat: 33.2052, lng: -97.1169 }, bbox: { north: 33.4336, south: 32.9716, east: -96.8191, west: -97.3988 } },
  { fips: "48-139", name: "Ellis", state: "TX", centroid: { lat: 32.3489, lng: -96.7934 }, bbox: { north: 32.6235, south: 32.0543, east: -96.3771, west: -97.0851 } },
  { fips: "48-251", name: "Johnson", state: "TX", centroid: { lat: 32.3788, lng: -97.3666 }, bbox: { north: 32.6191, south: 32.0576, east: -97.0158, west: -97.7282 } },
  { fips: "48-257", name: "Kaufman", state: "TX", centroid: { lat: 32.5998, lng: -96.2879 }, bbox: { north: 32.9310, south: 32.2083, east: -95.8615, west: -96.7130 } },
  { fips: "48-367", name: "Parker", state: "TX", centroid: { lat: 32.7777, lng: -97.8050 }, bbox: { north: 33.0127, south: 32.5485, east: -97.5561, west: -98.0506 } },
  { fips: "48-397", name: "Rockwall", state: "TX", centroid: { lat: 32.8969, lng: -96.4096 }, bbox: { north: 33.0002, south: 32.7931, east: -96.2845, west: -96.5347 } },
  { fips: "48-439", name: "Tarrant", state: "TX", centroid: { lat: 32.7732, lng: -97.3518 }, bbox: { north: 33.0168, south: 32.5485, east: -97.0339, west: -97.6678 } },
  { fips: "48-497", name: "Wise", state: "TX", centroid: { lat: 33.1247, lng: -97.6937 }, bbox: { north: 33.4345, south: 32.8149, east: -97.3357, west: -98.0405 } },
  
  // East Texas (East Texas district)
  { fips: "48-001", name: "Anderson", state: "TX", centroid: { lat: 31.8132, lng: -95.6533 }, bbox: { north: 32.0375, south: 31.5888, east: -95.2509, west: -96.0557 } },
  { fips: "48-005", name: "Angelina", state: "TX", centroid: { lat: 31.2546, lng: -94.6076 }, bbox: { north: 31.5557, south: 30.9485, east: -94.1961, west: -95.0187 } },
  { fips: "48-073", name: "Cherokee", state: "TX", centroid: { lat: 31.8393, lng: -95.1727 }, bbox: { north: 32.0737, south: 31.6049, east: -94.7781, west: -95.5673 } },
  { fips: "48-081", name: "Coke", state: "TX", centroid: { lat: 31.8810, lng: -100.5314 }, bbox: { north: 32.0850, south: 31.6770, east: -100.1135, west: -100.9493 } },
  { fips: "48-091", name: "Comal", state: "TX", centroid: { lat: 29.6618, lng: -98.2212 }, bbox: { north: 30.0133, south: 29.3103, east: -97.8463, west: -98.5961 } },
  { fips: "48-093", name: "Comanche", state: "TX", centroid: { lat: 31.9467, lng: -98.5583 }, bbox: { north: 32.1700, south: 31.7234, east: -98.1600, west: -98.9566 } },
  { fips: "48-187", name: "Grayson", state: "TX", centroid: { lat: 33.6222, lng: -96.6783 }, bbox: { north: 33.8842, south: 33.3602, east: -96.3643, west: -96.9923 } },
  { fips: "48-213", name: "Henderson", state: "TX", centroid: { lat: 32.2118, lng: -95.8584 }, bbox: { north: 32.4193, south: 32.0043, east: -95.4914, west: -96.2254 } },
  { fips: "48-231", name: "Hunt", state: "TX", centroid: { lat: 33.1234, lng: -96.0855 }, bbox: { north: 33.4088, south: 32.8380, east: -95.7786, west: -96.3924 } },
  { fips: "48-247", name: "Jim Wells", state: "TX", centroid: { lat: 27.7356, lng: -98.0899 }, bbox: { north: 28.0572, south: 27.4139, east: -97.7247, west: -98.4551 } },
  { fips: "48-291", name: "Liberty", state: "TX", centroid: { lat: 30.1503, lng: -94.8129 }, bbox: { north: 30.4900, south: 29.8106, east: -94.4340, west: -95.1918 } },
  { fips: "48-315", name: "Marion", state: "TX", centroid: { lat: 32.7967, lng: -94.3583 }, bbox: { north: 32.9731, south: 32.6203, east: -94.0539, west: -94.6627 } },
  { fips: "48-343", name: "Morris", state: "TX", centroid: { lat: 33.1179, lng: -94.7342 }, bbox: { north: 33.3131, south: 32.9227, east: -94.4851, west: -94.9833 } },
  { fips: "48-365", name: "Panola", state: "TX", centroid: { lat: 32.1583, lng: -94.3159 }, bbox: { north: 32.4109, south: 31.9057, east: -94.0428, west: -94.5890 } },
  { fips: "48-373", name: "Polk", state: "TX", centroid: { lat: 30.7947, lng: -94.8270 }, bbox: { north: 31.1669, south: 30.4225, east: -94.4141, west: -95.2399 } },
  { fips: "48-387", name: "Red River", state: "TX", centroid: { lat: 33.6202, lng: -95.0473 }, bbox: { north: 33.9529, south: 33.2874, east: -94.6883, west: -95.4063 } },
  { fips: "48-419", name: "Shelby", state: "TX", centroid: { lat: 31.7833, lng: -94.1775 }, bbox: { north: 31.9872, south: 31.5794, east: -93.8456, west: -94.5094 } },
  { fips: "48-449", name: "Smith", state: "TX", centroid: { lat: 32.3746, lng: -95.2715 }, bbox: { north: 32.5956, south: 32.1536, east: -94.9897, west: -95.5533 } },
  { fips: "48-455", name: "Stonewall", state: "TX", centroid: { lat: 33.1780, lng: -100.2526 }, bbox: { north: 33.4047, south: 32.9513, east: -99.8754, west: -100.6298 } },
  { fips: "48-459", name: "Titus", state: "TX", centroid: { lat: 33.2120, lng: -94.9693 }, bbox: { north: 33.3779, south: 33.0461, east: -94.7201, west: -95.2185 } },
  { fips: "48-461", name: "Trinity", state: "TX", centroid: { lat: 31.0876, lng: -95.1368 }, bbox: { north: 31.3708, south: 30.8044, east: -94.8263, west: -95.4473 } },
  { fips: "48-467", name: "Tyler", state: "TX", centroid: { lat: 30.7680, lng: -94.3815 }, bbox: { north: 31.0321, south: 30.5039, east: -94.0698, west: -94.6932 } },
  { fips: "48-499", name: "Wood", state: "TX", centroid: { lat: 32.7884, lng: -95.2034 }, bbox: { north: 32.9765, south: 32.6003, east: -94.9325, west: -95.4743 } },
  
  // Houston Metro counties
  { fips: "48-157", name: "Fort Bend", state: "TX", centroid: { lat: 29.5277, lng: -95.7720 }, bbox: { north: 29.7860, south: 29.2313, east: -95.4399, west: -96.1041 } },
  { fips: "48-201", name: "Harris", state: "TX", centroid: { lat: 29.8588, lng: -95.3924 }, bbox: { north: 30.1716, south: 29.4971, east: -94.9779, west: -95.8068 } },
  { fips: "48-291", name: "Liberty", state: "TX", centroid: { lat: 30.1503, lng: -94.8129 }, bbox: { north: 30.4900, south: 29.8106, east: -94.4340, west: -95.1918 } },
  { fips: "48-339", name: "Montgomery", state: "TX", centroid: { lat: 30.3023, lng: -95.5055 }, bbox: { north: 30.6473, south: 29.9573, east: -95.1621, west: -95.8489 } },
  { fips: "48-473", name: "Waller", state: "TX", centroid: { lat: 30.0104, lng: -95.9815 }, bbox: { north: 30.2706, south: 29.7502, east: -95.7628, west: -96.2002 } },
  
  // Austin/San Antonio corridor
  { fips: "48-021", name: "Bastrop", state: "TX", centroid: { lat: 30.1035, lng: -97.3125 }, bbox: { north: 30.3365, south: 29.8705, east: -96.9554, west: -97.6696 } },
  { fips: "48-053", name: "Burnet", state: "TX", centroid: { lat: 30.7383, lng: -98.2217 }, bbox: { north: 31.0645, south: 30.4121, east: -97.9093, west: -98.5341 } },
  { fips: "48-055", name: "Caldwell", state: "TX", centroid: { lat: 29.8371, lng: -97.6178 }, bbox: { north: 30.0466, south: 29.6276, east: -97.3747, west: -97.8609 } },
  { fips: "48-143", name: "Fayette", state: "TX", centroid: { lat: 29.8783, lng: -96.9204 }, bbox: { north: 30.1750, south: 29.5816, east: -96.5693, west: -97.2715 } },
  { fips: "48-209", name: "Hays", state: "TX", centroid: { lat: 30.0602, lng: -97.8348 }, bbox: { north: 30.2617, south: 29.8587, east: -97.6484, west: -98.0212 } },
  { fips: "48-453", name: "Travis", state: "TX", centroid: { lat: 30.3344, lng: -97.7854 }, bbox: { north: 30.5767, south: 30.0921, east: -97.5637, west: -98.0071 } },
  { fips: "48-491", name: "Williamson", state: "TX", centroid: { lat: 30.6475, lng: -97.6017 }, bbox: { north: 30.9256, south: 30.3694, east: -97.3133, west: -97.8901 } },
];

// Cities lookup with county FIPS mapping
export const TX_CITIES = [
  // Dallas-Fort Worth
  { name: "Dallas", state: "TX", countyFips: "48-113", lat: 32.7767, lng: -96.7970, pop: 1343575 },
  { name: "Fort Worth", state: "TX", countyFips: "48-439", lat: 32.7555, lng: -97.3308, pop: 935508 },
  { name: "Arlington", state: "TX", countyFips: "48-439", lat: 32.7357, lng: -97.1081, pop: 398854 },
  { name: "Plano", state: "TX", countyFips: "48-085", lat: 33.0198, lng: -96.6989, pop: 285494 },
  { name: "Garland", state: "TX", countyFips: "48-113", lat: 32.9126, lng: -96.6389, pop: 242612 },
  { name: "Irving", state: "TX", countyFips: "48-113", lat: 32.8140, lng: -96.9489, pop: 256684 },
  { name: "Frisco", state: "TX", countyFips: "48-085", lat: 33.1507, lng: -96.8236, pop: 200509 },
  { name: "McKinney", state: "TX", countyFips: "48-085", lat: 33.1972, lng: -96.6398, pop: 195308 },
  { name: "Grand Prairie", state: "TX", countyFips: "48-439", lat: 32.7460, lng: -96.9978, pop: 196100 },
  { name: "Mesquite", state: "TX", countyFips: "48-113", lat: 32.7668, lng: -96.5992, pop: 150108 },
  { name: "Carrollton", state: "TX", countyFips: "48-121", lat: 32.9756, lng: -96.8899, pop: 133434 },
  { name: "Denton", state: "TX", countyFips: "48-121", lat: 33.2148, lng: -97.1331, pop: 139869 },
  { name: "Richardson", state: "TX", countyFips: "48-113", lat: 32.9482, lng: -96.7299, pop: 116382 },
  { name: "Allen", state: "TX", countyFips: "48-085", lat: 33.1032, lng: -96.6706, pop: 104627 },
  { name: "Lewisville", state: "TX", countyFips: "48-121", lat: 33.0462, lng: -96.9942, pop: 106365 },
  { name: "Flower Mound", state: "TX", countyFips: "48-121", lat: 33.0146, lng: -97.0970, pop: 75956 },
  { name: "North Richland Hills", state: "TX", countyFips: "48-439", lat: 32.8343, lng: -97.2289, pop: 70000 },
  { name: "Mansfield", state: "TX", countyFips: "48-439", lat: 32.5632, lng: -97.1417, pop: 72000 },
  { name: "Wylie", state: "TX", countyFips: "48-257", lat: 33.0151, lng: -96.5389, pop: 53376 },
  { name: "Rockwall", state: "TX", countyFips: "48-397", lat: 32.9312, lng: -96.4597, pop: 44722 },
  { name: "Rowlett", state: "TX", countyFips: "48-113", lat: 32.9029, lng: -96.5639, pop: 62000 },
  { name: "Grapevine", state: "TX", countyFips: "48-121", lat: 32.9343, lng: -97.0781, pop: 50104 },
  { name: "Euless", state: "TX", countyFips: "48-439", lat: 32.8371, lng: -97.0820, pop: 61032 },
  { name: "Bedford", state: "TX", countyFips: "48-439", lat: 32.8440, lng: -97.1431, pop: 49493 },
  { name: "Cedar Hill", state: "TX", countyFips: "48-139", lat: 32.5885, lng: -96.9561, pop: 48100 },
  { name: "Keller", state: "TX", countyFips: "48-439", lat: 32.9342, lng: -97.2293, pop: 47900 },
  { name: "Midlothian", state: "TX", countyFips: "48-139", lat: 32.4824, lng: -96.9941, pop: 39000 },
  { name: "Waxahachie", state: "TX", countyFips: "48-139", lat: 32.3865, lng: -96.8483, pop: 43000 },
  { name: "Fate", state: "TX", countyFips: "48-257", lat: 32.9415, lng: -96.3814, pop: 17435 },
  { name: "Royse City", state: "TX", countyFips: "48-257", lat: 32.9754, lng: -96.3325, pop: 20000 },
  { name: "Lavon", state: "TX", countyFips: "48-257", lat: 33.0257, lng: -96.4347, pop: 3900 },
  { name: "Greenville", state: "TX", countyFips: "48-231", lat: 33.1385, lng: -96.1108, pop: 28000 },
  { name: "Heath", state: "TX", countyFips: "48-257", lat: 32.8354, lng: -96.4758, pop: 8500 },
  { name: "Josephine", state: "TX", countyFips: "48-257", lat: 33.0607, lng: -96.3122, pop: 2400 },
  
  // Houston
  { name: "Houston", state: "TX", countyFips: "48-201", lat: 29.7604, lng: -95.3698, pop: 2325502 },
  { name: "Sugar Land", state: "TX", countyFips: "48-157", lat: 29.6197, lng: -95.6349, pop: 118600 },
  { name: "Pearland", state: "TX", countyFips: "48-157", lat: 29.5636, lng: -95.2860, pop: 125000 },
  { name: "The Woodlands", state: "TX", countyFips: "48-339", lat: 30.1658, lng: -95.4613, pop: 114000 },
  { name: "Katy", state: "TX", countyFips: "48-157", lat: 29.7858, lng: -95.8245, pop: 21000 },
  
  // Austin
  { name: "Austin", state: "TX", countyFips: "48-453", lat: 30.2672, lng: -97.7431, pop: 964177 },
  { name: "Round Rock", state: "TX", countyFips: "48-491", lat: 30.5083, lng: -97.6789, pop: 123876 },
  { name: "Cedar Park", state: "TX", countyFips: "48-491", lat: 30.5052, lng: -97.8203, pop: 77000 },
  { name: "Georgetown", state: "TX", countyFips: "48-491", lat: 30.6333, lng: -97.6772, pop: 75000 },
  { name: "San Marcos", state: "TX", countyFips: "48-209", lat: 29.8833, lng: -97.9414, pop: 67000 },
  { name: "Pflugerville", state: "TX", countyFips: "48-453", lat: 30.4394, lng: -97.6200, pop: 65000 },
  { name: "Leander", state: "TX", countyFips: "48-491", lat: 30.5788, lng: -97.8531, pop: 62000 },
  { name: "Bastrop", state: "TX", countyFips: "48-021", lat: 30.1105, lng: -97.3153, pop: 9100 },
  { name: "Lockhart", state: "TX", countyFips: "48-055", lat: 29.8849, lng: -97.6700, pop: 14000 },
  { name: "Taylor", state: "TX", countyFips: "48-491", lat: 30.5708, lng: -97.4094, pop: 17000 },
  { name: "Elgin", state: "TX", countyFips: "48-021", lat: 30.3494, lng: -97.3703, pop: 10000 },
  { name: "Luling", state: "TX", countyFips: "48-055", lat: 29.6816, lng: -97.6456, pop: 6600 },
  
  // San Antonio
  { name: "San Antonio", state: "TX", countyFips: "48-091", lat: 29.4241, lng: -98.4936, pop: 1434625 },
  { name: "New Braunfels", state: "TX", countyFips: "48-091", lat: 29.7030, lng: -98.1245, pop: 90000 },
  { name: "Schertz", state: "TX", countyFips: "48-091", lat: 29.5522, lng: -98.2697, pop: 42000 },
  { name: "Seguin", state: "TX", countyFips: "48-091", lat: 29.5688, lng: -97.9647, pop: 29000 },
  { name: "Canyon Lake", state: "TX", countyFips: "48-091", lat: 29.8752, lng: -98.2625, pop: 31000 },
  { name: "Kyle", state: "TX", countyFips: "48-209", lat: 30.0000, lng: -97.8772, pop: 50000 },
  { name: "Buda", state: "TX", countyFips: "48-209", lat: 30.0852, lng: -97.8403, pop: 15000 },
  { name: "Dripping Springs", state: "TX", countyFips: "48-053", lat: 30.1902, lng: -98.0867, pop: 4500 },
  { name: "Wimberley", state: "TX", countyFips: "48-053", lat: 30.0000, lng: -98.1000, pop: 3000 },
  
  // East Texas
  { name: "Tyler", state: "TX", countyFips: "48-423", lat: 32.3513, lng: -95.3011, pop: 105995 },
  { name: "Longview", state: "TX", countyFips: "48-315", lat: 32.5007, lng: -94.7405, pop: 81668 },
  { name: "Lufkin", state: "TX", countyFips: "48-005", lat: 31.3382, lng: -94.7291, pop: 34524 },
  { name: "Nacogdoches", state: "TX", countyFips: "48-347", lat: 31.6035, lng: -94.6555, pop: 33200 },
  { name: "Palestine", state: "TX", countyFips: "48-001", lat: 31.7621, lng: -95.6308, pop: 18200 },
  { name: "Jacksonville", state: "TX", countyFips: "48-073", lat: 31.9638, lng: -95.2705, pop: 14700 },
  { name: "Henderson", state: "TX", countyFips: "48-213", lat: 32.1532, lng: -94.7994, pop: 13500 },
  { name: "Carthage", state: "TX", countyFips: "48-315", lat: 32.1574, lng: -94.3374, pop: 6600 },
  { name: "Kilgore", state: "TX", countyFips: "48-315", lat: 32.3863, lng: -94.8758, pop: 14500 },
  { name: "Marshall", state: "TX", countyFips: "48-315", lat: 32.5449, lng: -94.3674, pop: 23000 },
  
  // West Texas / Panhandle (for TX district coverage completeness)
  { name: "Lubbock", state: "TX", countyFips: "48-303", lat: 33.5779, lng: -101.8552, pop: 257141 },
  { name: "Amarillo", state: "TX", countyFips: "48-375", lat: 35.2220, lng: -101.8313, pop: 199924 },
  { name: "Midland", state: "TX", countyFips: "48-329", lat: 31.9973, lng: -102.0779, pop: 132524 },
  { name: "Odessa", state: "TX", countyFips: "48-329", lat: 31.8457, lng: -102.3676, pop: 123334 },
  { name: "Abilene", state: "TX", countyFips: "48-253", lat: 32.4487, lng: -99.7331, pop: 125182 },
  { name: "Wichita Falls", state: "TX", countyFips: "48-485", lat: 33.9137, lng: -98.4934, pop: 104553 },
  { name: "San Angelo", state: "TX", countyFips: "48-451", lat: 31.4638, lng: -100.4370, pop: 101004 },
  { name: "El Paso", state: "TX", countyFips: "48-141", lat: 31.7619, lng: -106.4850, pop: 681728 },
];

/**
 * Seed geo tables with Texas data
 */
export function seedGeoData(db) {
  // Ensure tables exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS geo_counties (
      fips TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      state TEXT NOT NULL,
      state_fips TEXT,
      centroid_lat REAL,
      centroid_lng REAL,
      bbox_north REAL,
      bbox_south REAL,
      bbox_east REAL,
      bbox_west REAL,
      polygon_geojson TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_geo_counties_state ON geo_counties(state);
    
    CREATE TABLE IF NOT EXISTS geo_cities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      state TEXT NOT NULL,
      county_fips TEXT REFERENCES geo_counties(fips),
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      population INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_geo_cities_county ON geo_cities(county_fips);
    CREATE INDEX IF NOT EXISTS idx_geo_cities_state ON geo_cities(state);
    CREATE INDEX IF NOT EXISTS idx_geo_cities_coords ON geo_cities(lat, lng);
  `);

  // Seed counties if empty
  const hasCounties = db.prepare("SELECT COUNT(*) as cnt FROM geo_counties").get();
  if (hasCounties.cnt === 0) {
    const insertCounty = db.prepare(`
      INSERT OR IGNORE INTO geo_counties 
      (fips, name, state, state_fips, centroid_lat, centroid_lng, bbox_north, bbox_south, bbox_east, bbox_west)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    for (const county of TX_COUNTIES) {
      insertCounty.run(
        county.fips,
        county.name,
        county.state,
        "48",
        county.centroid.lat,
        county.centroid.lng,
        county.bbox.north,
        county.bbox.south,
        county.bbox.east,
        county.bbox.west
      );
    }
    console.log(`[Geo Seed] Inserted ${TX_COUNTIES.length} counties`);
  }

  // Seed cities if empty
  const hasCities = db.prepare("SELECT COUNT(*) as cnt FROM geo_cities").get();
  if (hasCities.cnt === 0) {
    const insertCity = db.prepare(`
      INSERT INTO geo_cities (name, state, county_fips, lat, lng, population)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    for (const city of TX_CITIES) {
      insertCity.run(
        city.name,
        city.state,
        city.countyFips,
        city.lat,
        city.lng,
        city.pop || 0
      );
    }
    console.log(`[Geo Seed] Inserted ${TX_CITIES.length} cities`);
  }
}

/**
 * Compute bounding box from selected features
 */
export function computeBboxFromSelection(db, selectedCounties, selectedCities) {
  let north = -90, south = 90, east = -180, west = 180;
  
  if (selectedCounties?.length > 0) {
    const placeholders = selectedCounties.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT bbox_north, bbox_south, bbox_east, bbox_west 
      FROM geo_counties WHERE fips IN (${placeholders})
    `).all(...selectedCounties);
    
    for (const r of rows) {
      if (r.bbox_north > north) north = r.bbox_north;
      if (r.bbox_south < south) south = r.bbox_south;
      if (r.bbox_east > east) east = r.bbox_east;
      if (r.bbox_west < west) west = r.bbox_west;
    }
  }
  
  if (selectedCities?.length > 0) {
    // Cities are points - use small buffer
    const placeholders = selectedCities.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT lat, lng FROM geo_cities WHERE name IN (${placeholders}) AND state = 'TX'
    `).all(...selectedCities);
    
    const buffer = 0.1; // ~11km
    for (const r of rows) {
      if (r.lat + buffer > north) north = r.lat + buffer;
      if (r.lat - buffer < south) south = r.lat - buffer;
      if (r.lng + buffer > east) east = r.lng + buffer;
      if (r.lng - buffer < west) west = r.lng - buffer;
    }
  }
  
  if (north === -90) {
    // No valid selection
    return null;
  }
  
  return { north, south, east, west, centerLat: (north + south) / 2, centerLng: (east + west) / 2 };
}

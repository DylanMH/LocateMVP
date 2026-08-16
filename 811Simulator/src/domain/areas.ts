export type AreaId =
  // East Texas (existing)
  | "JOSEPHINE"
  | "MABANK"
  | "GUN_BARREL"
  | "EUSTACE"
  | "TOOL"
  | "SEVEN_POINTS"
  | "HEATH"
  | "MCLENDON_CHISHOLM"
  | "KEMP"
  | "ENCHANTED_OAKS"
  // North Texas — Dallas North
  | "PLANO"
  | "FRISCO"
  | "MCKINNEY"
  | "ALLEN"
  // North Texas — Dallas South
  | "OAK_CLIFF"
  | "CEDAR_HILL"
  | "DUNCANVILLE"
  | "LANCASTER_TX"
  // North Texas — Fort Worth
  | "FORT_WORTH"
  | "ARLINGTON_TX"
  | "MANSFIELD_TX"
  | "BURLESON"
  // North Texas — Mid-Cities
  | "IRVING"
  | "GRAPEVINE"
  | "BEDFORD"
  | "EULESS"
  // Central Texas — Austin North
  | "ROUND_ROCK"
  | "CEDAR_PARK"
  | "GEORGETOWN_TX"
  | "LEANDER"
  // Central Texas — Austin Central
  | "AUSTIN_CENTRAL"
  | "WEST_LAKE_HILLS"
  | "SUNSET_VALLEY"
  | "ROLLINGWOOD"
  // Central Texas — Austin South
  | "BUDA"
  | "KYLE"
  | "SAN_MARCOS"
  | "LOCKHART"
  // Central Texas — Hill Country
  | "LAKEWAY"
  | "BEE_CAVE"
  | "DRIPPING_SPRINGS"
  | "WIMBERLEY"
  // South Texas — Houston North
  | "SPRING_TX"
  | "THE_WOODLANDS"
  | "CONROE"
  | "TOMBALL"
  // South Texas — Houston West
  | "KATY"
  | "CYPRESS_TX"
  | "JERSEY_VILLAGE"
  | "BELLAIRE"
  // South Texas — Houston South
  | "PEARLAND"
  | "FRIENDSWOOD"
  | "LEAGUE_CITY"
  | "CLEAR_LAKE"
  // South Texas — Houston East
  | "BAYTOWN"
  | "PASADENA_TX"
  | "DEER_PARK"
  | "LA_PORTE";

export type AreaSeed = {
  id: AreaId;
  name: string;
  centerLat: number;
  centerLng: number;
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
};

function bbox(centerLat: number, centerLng: number) {
  return {
    latMin: centerLat - 0.03,
    latMax: centerLat + 0.03,
    lngMin: centerLng - 0.04,
    lngMax: centerLng + 0.04,
  };
}

export const AREAS: AreaSeed[] = [
  // East Texas (existing)
  { id: "JOSEPHINE", name: "Josephine, TX", centerLat: 33.0596, centerLng: -96.3252, ...bbox(33.0596, -96.3252) },
  { id: "MABANK", name: "Mabank, TX", centerLat: 32.3710, centerLng: -96.1159, ...bbox(32.3710, -96.1159) },
  { id: "GUN_BARREL", name: "Gun Barrel City, TX", centerLat: 32.3276, centerLng: -96.1026, ...bbox(32.3276, -96.1026) },
  { id: "EUSTACE", name: "Eustace, TX", centerLat: 32.3129, centerLng: -96.0108, ...bbox(32.3129, -96.0108) },
  { id: "TOOL", name: "Tool, TX", centerLat: 32.2784, centerLng: -96.1763, ...bbox(32.2784, -96.1763) },
  { id: "SEVEN_POINTS", name: "Seven Points, TX", centerLat: 32.3283, centerLng: -96.2064, ...bbox(32.3283, -96.2064) },
  { id: "HEATH", name: "Heath, TX", centerLat: 32.8495, centerLng: -96.4750, ...bbox(32.8495, -96.4750) },
  { id: "MCLENDON_CHISHOLM", name: "McLendon-Chisholm, TX", centerLat: 32.8423, centerLng: -96.3814, ...bbox(32.8423, -96.3814) },
  { id: "KEMP", name: "Kemp, TX", centerLat: 32.4513, centerLng: -96.2254, ...bbox(32.4513, -96.2254) },
  { id: "ENCHANTED_OAKS", name: "Enchanted Oaks, TX", centerLat: 32.2648, centerLng: -96.1102, ...bbox(32.2648, -96.1102) },
  // North Texas — Dallas North
  { id: "PLANO", name: "Plano, TX", centerLat: 33.0198, centerLng: -96.6989, ...bbox(33.0198, -96.6989) },
  { id: "FRISCO", name: "Frisco, TX", centerLat: 33.1507, centerLng: -96.8236, ...bbox(33.1507, -96.8236) },
  { id: "MCKINNEY", name: "McKinney, TX", centerLat: 33.1972, centerLng: -96.6398, ...bbox(33.1972, -96.6398) },
  { id: "ALLEN", name: "Allen, TX", centerLat: 33.1032, centerLng: -96.6703, ...bbox(33.1032, -96.6703) },
  // North Texas — Dallas South
  { id: "OAK_CLIFF", name: "Oak Cliff, TX", centerLat: 32.7258, centerLng: -96.8286, ...bbox(32.7258, -96.8286) },
  { id: "CEDAR_HILL", name: "Cedar Hill, TX", centerLat: 32.5885, centerLng: -96.9569, ...bbox(32.5885, -96.9569) },
  { id: "DUNCANVILLE", name: "Duncanville, TX", centerLat: 32.6493, centerLng: -96.9073, ...bbox(32.6493, -96.9073) },
  { id: "LANCASTER_TX", name: "Lancaster, TX", centerLat: 32.5921, centerLng: -96.7700, ...bbox(32.5921, -96.7700) },
  // North Texas — Fort Worth
  { id: "FORT_WORTH", name: "Fort Worth, TX", centerLat: 32.7555, centerLng: -97.3308, ...bbox(32.7555, -97.3308) },
  { id: "ARLINGTON_TX", name: "Arlington, TX", centerLat: 32.7357, centerLng: -97.1081, ...bbox(32.7357, -97.1081) },
  { id: "MANSFIELD_TX", name: "Mansfield, TX", centerLat: 32.5632, centerLng: -97.1414, ...bbox(32.5632, -97.1414) },
  { id: "BURLESON", name: "Burleson, TX", centerLat: 32.5421, centerLng: -97.3209, ...bbox(32.5421, -97.3209) },
  // North Texas — Mid-Cities
  { id: "IRVING", name: "Irving, TX", centerLat: 32.8140, centerLng: -96.9490, ...bbox(32.8140, -96.9490) },
  { id: "GRAPEVINE", name: "Grapevine, TX", centerLat: 32.9343, centerLng: -97.0681, ...bbox(32.9343, -97.0681) },
  { id: "BEDFORD", name: "Bedford, TX", centerLat: 32.8440, centerLng: -97.1431, ...bbox(32.8440, -97.1431) },
  { id: "EULESS", name: "Euless, TX", centerLat: 32.8371, centerLng: -97.0820, ...bbox(32.8371, -97.0820) },
  // Central Texas — Austin North
  { id: "ROUND_ROCK", name: "Round Rock, TX", centerLat: 30.5083, centerLng: -97.6789, ...bbox(30.5083, -97.6789) },
  { id: "CEDAR_PARK", name: "Cedar Park, TX", centerLat: 30.5050, centerLng: -97.8203, ...bbox(30.5050, -97.8203) },
  { id: "GEORGETOWN_TX", name: "Georgetown, TX", centerLat: 30.6339, centerLng: -97.6772, ...bbox(30.6339, -97.6772) },
  { id: "LEANDER", name: "Leander, TX", centerLat: 30.5788, centerLng: -97.8531, ...bbox(30.5788, -97.8531) },
  // Central Texas — Austin Central
  { id: "AUSTIN_CENTRAL", name: "Austin Central, TX", centerLat: 30.2672, centerLng: -97.7431, ...bbox(30.2672, -97.7431) },
  { id: "WEST_LAKE_HILLS", name: "West Lake Hills, TX", centerLat: 30.2840, centerLng: -97.7964, ...bbox(30.2840, -97.7964) },
  { id: "SUNSET_VALLEY", name: "Sunset Valley, TX", centerLat: 30.2318, centerLng: -97.8064, ...bbox(30.2318, -97.8064) },
  { id: "ROLLINGWOOD", name: "Rollingwood, TX", centerLat: 30.2735, centerLng: -97.7870, ...bbox(30.2735, -97.7870) },
  // Central Texas — Austin South
  { id: "BUDA", name: "Buda, TX", centerLat: 30.0846, centerLng: -97.8397, ...bbox(30.0846, -97.8397) },
  { id: "KYLE", name: "Kyle, TX", centerLat: 29.9891, centerLng: -97.8772, ...bbox(29.9891, -97.8772) },
  { id: "SAN_MARCOS", name: "San Marcos, TX", centerLat: 29.8833, centerLng: -97.9414, ...bbox(29.8833, -97.9414) },
  { id: "LOCKHART", name: "Lockhart, TX", centerLat: 29.8852, centerLng: -97.6700, ...bbox(29.8852, -97.6700) },
  // Central Texas — Hill Country
  { id: "LAKEWAY", name: "Lakeway, TX", centerLat: 30.3630, centerLng: -97.9808, ...bbox(30.3630, -97.9808) },
  { id: "BEE_CAVE", name: "Bee Cave, TX", centerLat: 30.3085, centerLng: -97.9589, ...bbox(30.3085, -97.9589) },
  { id: "DRIPPING_SPRINGS", name: "Dripping Springs, TX", centerLat: 30.1902, centerLng: -98.0867, ...bbox(30.1902, -98.0867) },
  { id: "WIMBERLEY", name: "Wimberley, TX", centerLat: 29.9938, centerLng: -98.0975, ...bbox(29.9938, -98.0975) },
  // South Texas — Houston North
  { id: "SPRING_TX", name: "Spring, TX", centerLat: 30.0790, centerLng: -95.4170, ...bbox(30.0790, -95.4170) },
  { id: "THE_WOODLANDS", name: "The Woodlands, TX", centerLat: 30.1620, centerLng: -95.4560, ...bbox(30.1620, -95.4560) },
  { id: "CONROE", name: "Conroe, TX", centerLat: 30.3119, centerLng: -95.4561, ...bbox(30.3119, -95.4561) },
  { id: "TOMBALL", name: "Tomball, TX", centerLat: 30.0977, centerLng: -95.6161, ...bbox(30.0977, -95.6161) },
  // South Texas — Houston West
  { id: "KATY", name: "Katy, TX", centerLat: 29.7858, centerLng: -95.8247, ...bbox(29.7858, -95.8247) },
  { id: "CYPRESS_TX", name: "Cypress, TX", centerLat: 29.9627, centerLng: -95.6604, ...bbox(29.9627, -95.6604) },
  { id: "JERSEY_VILLAGE", name: "Jersey Village, TX", centerLat: 29.9383, centerLng: -95.5672, ...bbox(29.9383, -95.5672) },
  { id: "BELLAIRE", name: "Bellaire, TX", centerLat: 29.7054, centerLng: -95.4588, ...bbox(29.7054, -95.4588) },
  // South Texas — Houston South
  { id: "PEARLAND", name: "Pearland, TX", centerLat: 29.5635, centerLng: -95.2861, ...bbox(29.5635, -95.2861) },
  { id: "FRIENDSWOOD", name: "Friendswood, TX", centerLat: 29.5294, centerLng: -95.1980, ...bbox(29.5294, -95.1980) },
  { id: "LEAGUE_CITY", name: "League City, TX", centerLat: 29.5075, centerLng: -95.0949, ...bbox(29.5075, -95.0949) },
  { id: "CLEAR_LAKE", name: "Clear Lake, TX", centerLat: 29.5838, centerLng: -95.0955, ...bbox(29.5838, -95.0955) },
  // South Texas — Houston East
  { id: "BAYTOWN", name: "Baytown, TX", centerLat: 29.7355, centerLng: -94.9774, ...bbox(29.7355, -94.9774) },
  { id: "PASADENA_TX", name: "Pasadena, TX", centerLat: 29.6911, centerLng: -95.2091, ...bbox(29.6911, -95.2091) },
  { id: "DEER_PARK", name: "Deer Park, TX", centerLat: 29.7054, centerLng: -95.5133, ...bbox(29.7054, -95.5133) },
  { id: "LA_PORTE", name: "La Porte, TX", centerLat: 29.6656, centerLng: -95.0447, ...bbox(29.6656, -95.0447) },
];

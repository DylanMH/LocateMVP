export const SYNTHETIC_CUSTOMERS = [
  ['BSF', 'BlueSpan Fiber', 'FIBER'],
  ['PLN', 'PineLink Networks', 'FIBER'],
  ['RRB', 'RedRiver Broadband', 'FIBER'],
  ['LST', 'LoneStar Telecom', 'COPPER'],
  ['CLC', 'CedarLine Communications', 'COPPER'],
  ['MWC', 'MetroWire Communications', 'COPPER'],
  ['TEC', 'Trinity Electric Cooperative', 'ELECTRIC'],
  ['EGP', 'EastGrid Power', 'ELECTRIC'],
  ['PLE', 'Prairie Light Electric', 'ELECTRIC'],
  ['TPG', 'Texas Prairie Gas', 'GAS'],
  ['BFD', 'BlueFlame Distribution', 'GAS'],
  ['CCG', 'Cedar Creek Gas', 'GAS'],
  ['LWA', 'Lakeview Water Authority', 'WATER'],
  ['TRW', 'Trinity Regional Water', 'WATER'],
  ['ETW', 'East Texas Waterworks', 'WATER'],
  ['LBW', 'Lake Basin Wastewater', 'SEWER'],
  ['TSD', 'Trinity Sanitation District', 'SEWER'],
  ['ECW', 'East County Wastewater', 'SEWER'],
].map(([code, displayName, utilityType]) => ({ code, displayName, utilityType }));

export function ensureCustomerSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      utility_type TEXT NOT NULL CHECK (utility_type IN ('FIBER', 'COPPER', 'ELECTRIC', 'GAS', 'WATER', 'SEWER')),
      active INTEGER NOT NULL DEFAULT 1,
      territory_id TEXT,
      contracted_locator_id TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      FOREIGN KEY (territory_id) REFERENCES territories(id)
    );
    CREATE INDEX IF NOT EXISTS idx_customers_utility ON customers(utility_type);
    CREATE INDEX IF NOT EXISTS idx_customers_active ON customers(active);
    CREATE INDEX IF NOT EXISTS idx_customers_territory ON customers(territory_id);
  `);

  // Additive migration: contracted_locator_id column
  const cols = db.prepare(`PRAGMA table_info(customers)`).all();
  if (!cols.some((c) => c.name === 'contracted_locator_id')) {
    db.exec(`ALTER TABLE customers ADD COLUMN contracted_locator_id TEXT`);
  }
}

export function seedSyntheticCustomers(db) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO customers (id, code, display_name, utility_type, active)
    VALUES (?, ?, ?, ?, 1)
  `);
  const seed = db.transaction(() => {
    for (const customer of SYNTHETIC_CUSTOMERS) {
      insert.run(`customer-${customer.code.toLowerCase()}`, customer.code, customer.displayName, customer.utilityType);
    }
  });
  seed();
}

export function findCustomerByCodeAndUtility(db, code, utilityType) {
  return db.prepare(
    'SELECT * FROM customers WHERE code = ? AND utility_type = ? AND active = 1',
  ).get(code, utilityType) || null;
}

export function findCustomerByNameAndUtility(db, name, utilityType) {
  return db.prepare(
    'SELECT * FROM customers WHERE display_name = ? AND utility_type = ? AND active = 1',
  ).get(name, utilityType) || null;
}

export function resolveCustomerFrom811(db, { utilityType, memberCode, companyName }) {
  return findCustomerByCodeAndUtility(db, memberCode, utilityType)
    || findCustomerByNameAndUtility(db, companyName, utilityType);
}

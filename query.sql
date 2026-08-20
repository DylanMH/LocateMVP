-- Check territories schema
PRAGMA table_info(territories);

-- Check techs in Charles Clark's supervisor territory
SELECT t.id, t.name, t.type FROM territories t WHERE t.id = 'terr-sup-ctx';
SELECT * FROM territories WHERE type = 'TECH_TERRITORY' LIMIT 5;

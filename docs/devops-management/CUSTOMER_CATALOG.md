# DevOps Customer Catalog

The Backend catalog contains 18 fictional development customers: three each for FIBER, COPPER, ELECTRIC, GAS, WATER, and SEWER.

Each customer has a stable ID (`customer-<code>`), unique code, display name, utility type, active flag, and optional territory ID. Startup seeding is idempotent. Ingested 811 customer rows preserve their per-ticket mobile `id` while adding `catalogCustomerId` when code or name/utility resolution succeeds.

Historical ledger rows retain their original `customer_id`; new production entries also store nullable `catalog_customer_id`. This additive strategy supports backfill without invalidating existing mobile payloads.

# Supabase Advisor Findings — Phase 8

Run against project `oat-bar-crm` (`mfprkwwrmhomvwawateo`) after the Phase 8
seed was loaded. One row per finding: the check, the object, and either the
migration that fixed it or the reason it is accepted.

## Security Advisor

| Check | Object | Level | Disposition |
|---|---|---|---|
| `auth_leaked_password_protection` | Auth (project setting) | WARN | **Accepted.** Dashboard-only toggle (Authentication → Policies → "Leaked password protection"), not something a migration can flip. Only the project owner can enable it. Documented here so it is not mistaken for an oversight. |

No other security findings. In particular: every table has RLS enabled with
at least one policy, every view is `security_invoker`, `anon` can execute no
function and select from no view, and exactly one function
(`f_handle_new_user`) is `security definer` — all independently re-verified
by `verify.sql` P8.1–P8.4, which passed against the seeded database.

## Performance Advisor

| Check | Object | Level | Disposition |
|---|---|---|---|
| `unindexed_foreign_keys` | `public.invoice_orders`, FK `invoice_orders_order_id_customer_id_fkey` (order_id, customer_id) → orders(id, customer_id) | INFO | **Fixed** in `supabase/migrations/0009_invoice_orders_fk_indexes.sql` — added `idx_invoice_orders_order_customer (order_id, customer_id)`. |
| `unindexed_foreign_keys` | `public.invoice_orders`, FK `invoice_orders_invoice_id_customer_id_fkey` (invoice_id, customer_id) → invoices(id, customer_id) | INFO | **Fixed** in the same migration — added `idx_invoice_orders_invoice_customer (invoice_id, customer_id)`. |
| `unused_index` | `idx_products_name_lower` on `products` | INFO | **Accepted.** Backs the case-insensitive uniqueness/search on product name used by the products list and the "does this name already exist" check in the create/edit form. Never fired yet because this project has had almost no query traffic since the seed loaded — `pg_stat_user_indexes` counters reset on every `CREATE INDEX` (as they did in migration 0009) and there is no history to accumulate from a database that was empty until today. Not a candidate for removal. |
| `unused_index` | `idx_customers_status` on `customers` | INFO | **Accepted.** Backs the status filter on the customers list (`active`/`sampling`/`contacted`/`lead`/`lost`/`lapsed`). Same "no traffic yet" reasoning. |
| `unused_index` | `idx_customers_name_lower` on `customers` | INFO | **Accepted.** Backs case-insensitive customer search/sort and duplicate-name checks. Same reasoning. |
| `unused_index` | `idx_interactions_contact_id` on `interactions` | INFO | **Accepted.** Backs the FK lookup from a contact to its interaction history, used on the customer activity timeline. Same reasoning. |
| `unused_index` | `idx_interactions_created_by` on `interactions` | INFO | **Accepted.** Backs the FK lookup for "who logged this," used nowhere yet in the UI beyond the timeline, but required for the FK to avoid a table scan when a `profiles` row is touched. Same reasoning. |
| `unused_index` | `idx_recurring_orders_active` on `recurring_orders` | INFO | **Accepted.** Backs the schedules list filtering to active schedules only. Same reasoning. |
| `unused_index` | `idx_invoices_due_on` on `invoices` | INFO | **Accepted.** Backs the overdue-invoice lookup (`due_on < today`) used by the dashboard and the invoices list "overdue" filter. Same reasoning. |
| `unused_index` | `idx_invoice_orders_order_customer` on `invoice_orders` | INFO | **Accepted** — the index this same report just added in migration 0009 to fix the `unindexed_foreign_keys` finding above. It cannot have usage history seconds after creation. |
| `unused_index` | `idx_invoice_orders_invoice_customer` on `invoice_orders` | INFO | **Accepted** — same as above. |

All ten `unused_index` findings are INFO-level, all trace to indexes with a
clear, named query pattern in the app, and none has had a chance to
accumulate usage stats on a database that has existed for one day. None was
dropped.

## Re-run confirmation

Both advisors were re-run after migration 0009. Security: only the accepted
`auth_leaked_password_protection` warning remains. Performance: the
`unindexed_foreign_keys` findings are gone; only the accepted `unused_index`
INFO notices remain (nine, up from seven, because the two new indexes are
themselves — expectedly — still unused).

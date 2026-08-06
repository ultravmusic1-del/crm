-- 0002b_interaction_fk_indexes.sql
-- Performance Advisor: unindexed foreign keys on public.interactions.
-- Not in the original plan; both are genuine.
--
-- contact_id is `on delete set null`, so removing a contact must scan
-- interactions to null out the references. created_by references profiles.
-- Interactions is the highest-volume table in this app (every call, email
-- and sample drop, forever), so an unindexed FK scan here grows without
-- bound while contacts and profiles stay tiny.
--
-- Both are partial, excluding nulls: most interactions have no contact_id
-- and, for rows created before auth wiring, no created_by. A partial index
-- only stores the rows a FK check can actually match.

create index idx_interactions_contact_id
  on public.interactions (contact_id)
  where contact_id is not null;

create index idx_interactions_created_by
  on public.interactions (created_by)
  where created_by is not null;

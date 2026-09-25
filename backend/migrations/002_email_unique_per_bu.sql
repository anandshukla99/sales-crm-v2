-- Migration 002 — allow one email to have one account per business unit.
--
-- The initial schema made `email` globally unique (UNIQUE KEY `email`). To let one person hold a
-- separate account per business unit under the same email, relax that to a composite unique key on
-- (email, business_unit): the same email may appear at most once per BU, never twice within a BU.
--
-- NULL emails (BD accounts) are unaffected — MySQL treats NULLs as distinct in unique indexes, so
-- any number of BD rows with email = NULL remain allowed.

ALTER TABLE `users` DROP INDEX `email`;
ALTER TABLE `users` ADD UNIQUE KEY `email_business_unit` (`email`, `business_unit`);

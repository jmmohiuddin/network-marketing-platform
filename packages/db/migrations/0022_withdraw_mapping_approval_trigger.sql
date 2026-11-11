-- Withdraws 0021. CPL's 0031 owns AC-40.1: it retires the snapshots on an earlier mapping version as soon as a new
-- version is created (cpl_outdate_on_mapping_version), and its guard no longer allows computing -> outdated,
-- which 0021's approval trigger would attempt (an approval would then fail while a snapshot computes).
DROP TRIGGER import_mapping_approval ON import_mapping;
DROP TRIGGER import_mapping_approved ON import_mapping;
DROP FUNCTION import_mapping_outdate_snapshots();

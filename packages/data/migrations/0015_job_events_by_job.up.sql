-- The settlement record of one job (`/jobs/:id/events`) reads the journal by
-- job id. The primary key orders the journal by chain position, so without
-- this a per-job read scans every event the chain ever emitted.
create index job_events_by_job on job_events (chain_id, job_id, block_number, log_index) where job_id is not null;

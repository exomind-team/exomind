mod model;
mod projection;
mod store;
pub use model::*;
pub use projection::project_timeblocks;

pub(crate) const SCHEMA: &str = "
ALTER TABLE events ADD COLUMN kind TEXT NOT NULL DEFAULT 'capture' CHECK(kind IN ('capture','timeblock/1'));
CREATE TABLE timeblock_nodes(event_id TEXT PRIMARY KEY REFERENCES events(event_id),request_digest TEXT NOT NULL);
CREATE TABLE timeblock_state(profile_id TEXT PRIMARY KEY REFERENCES profiles(id),revision TEXT NOT NULL,body TEXT NOT NULL);
CREATE TABLE timeblock_scheduler_owner(singleton INTEGER PRIMARY KEY CHECK(singleton=1),device_id TEXT NOT NULL,generation INTEGER NOT NULL,active INTEGER NOT NULL CHECK(active IN (0,1)));
INSERT INTO timeblock_scheduler_owner SELECT 1,device_id,1,1 FROM identity WHERE singleton=1;
CREATE TABLE timeblock_deadlines(deadline_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES profiles(id),block_id TEXT NOT NULL,generation INTEGER NOT NULL,owner_generation INTEGER NOT NULL,command_id TEXT NOT NULL UNIQUE,event_id TEXT NOT NULL UNIQUE,state TEXT NOT NULL CHECK(state IN ('pending','done','cancelled')),due_wall_ms INTEGER NOT NULL,due_elapsed_ms INTEGER NOT NULL,clock_epoch TEXT NOT NULL,end_mode TEXT NOT NULL CHECK(end_mode IN ('soft','hard')),UNIQUE(profile_id,block_id,generation));
CREATE INDEX timeblock_deadline_due ON timeblock_deadlines(state,due_wall_ms);
";

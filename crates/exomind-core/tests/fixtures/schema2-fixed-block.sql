-- Frozen, unpublished schema-2 fixed-block revision 1. This is test data, not a migration entry point.
PRAGMA application_id=1163415350;
PRAGMA user_version=2;
CREATE TABLE identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1),device_id TEXT NOT NULL,human_author TEXT NOT NULL);
CREATE TABLE profiles(id TEXT PRIMARY KEY,display_name TEXT NOT NULL);
CREATE TABLE events(local_seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL,profile_id TEXT NOT NULL REFERENCES profiles(id),digest TEXT NOT NULL,body TEXT NOT NULL);
CREATE TABLE command_receipts(command_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES profiles(id),input_digest TEXT NOT NULL,receipt TEXT NOT NULL);
CREATE INDEX events_profile_sequence ON events(profile_id,local_seq);

CREATE TABLE core_layout(singleton INTEGER PRIMARY KEY CHECK(singleton=1),original_block_bytes INTEGER NOT NULL,layout_revision INTEGER NOT NULL);
INSERT INTO core_layout VALUES(1,262144,1);
CREATE TABLE original_stages(
 stage_id TEXT PRIMARY KEY, original_id TEXT NOT NULL UNIQUE,
 profile_id TEXT NOT NULL REFERENCES profiles(id), author_id TEXT NOT NULL,
 author_kind TEXT NOT NULL CHECK(author_kind IN ('human','agent_note')),
 expected_sha256 TEXT NOT NULL, byte_length INTEGER NOT NULL CHECK(byte_length>=0),
 file_name TEXT NOT NULL, media_type TEXT NOT NULL,
 next_offset INTEGER NOT NULL CHECK(next_offset>=0 AND next_offset<=byte_length),
 generation INTEGER NOT NULL CHECK(generation>0),
 state TEXT NOT NULL CHECK(state IN ('uploading','frozen','verified','hash_mismatch')));
CREATE TABLE original_chunks(
 stage_id TEXT NOT NULL REFERENCES original_stages(stage_id),
 offset INTEGER NOT NULL CHECK(offset>=0 AND offset % 262144=0),
 bytes BLOB NOT NULL CHECK(typeof(bytes)='blob' AND length(bytes)>0 AND length(bytes)<=262144),
 chunk_sha256 TEXT NOT NULL CHECK(length(chunk_sha256)=64),
 PRIMARY KEY(stage_id,offset));
CREATE TABLE event_originals(
 event_id TEXT NOT NULL REFERENCES events(event_id), ordinal INTEGER NOT NULL CHECK(ordinal>=0),
 original_id TEXT NOT NULL REFERENCES original_stages(original_id),
 PRIMARY KEY(event_id,ordinal));
CREATE INDEX original_fact_references ON event_originals(original_id);
CREATE TRIGGER original_chunks_insert_guard BEFORE INSERT ON original_chunks
 WHEN NOT EXISTS(SELECT 1 FROM original_stages WHERE stage_id=NEW.stage_id AND state='uploading'
 AND next_offset=NEW.offset AND NEW.offset+length(NEW.bytes)<=byte_length)
 BEGIN SELECT RAISE(ABORT,'original chunk is not a contiguous mutable stage'); END;
CREATE TRIGGER original_chunks_no_update BEFORE UPDATE ON original_chunks
 WHEN NOT (NEW.stage_id=OLD.stage_id AND NEW.offset=OLD.offset
 AND length(OLD.bytes)>0 AND length(OLD.bytes)<262144
 AND typeof(NEW.bytes)='blob' AND length(NEW.bytes)>length(OLD.bytes) AND length(NEW.bytes)<=262144
 AND substr(NEW.bytes,1,length(OLD.bytes))=OLD.bytes
 AND EXISTS(SELECT 1 FROM original_stages WHERE stage_id=OLD.stage_id AND state='uploading'
 AND next_offset=OLD.offset+length(OLD.bytes) AND OLD.offset+length(NEW.bytes)<=byte_length))
 BEGIN SELECT RAISE(ABORT,'original chunks are immutable'); END;
CREATE TRIGGER original_chunks_no_delete BEFORE DELETE ON original_chunks
 BEGIN SELECT RAISE(ABORT,'original release requires a later explicit lifecycle'); END;
CREATE TRIGGER original_identity_no_update BEFORE UPDATE OF stage_id,original_id,profile_id,author_id,author_kind,expected_sha256,byte_length,file_name,media_type ON original_stages
 BEGIN SELECT RAISE(ABORT,'original identity is immutable'); END;

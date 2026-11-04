BEGIN;
ALTER TABLE hh_videos ADD COLUMN "sourceStatus" text NOT NULL DEFAULT 'AVAILABLE',
 ADD COLUMN "sourceRetryAt" timestamptz(3), ADD COLUMN "sourceFailures" integer NOT NULL DEFAULT 0;
ALTER TABLE hh_videos ADD CONSTRAINT hh_source_status CHECK ("sourceStatus" IN ('AVAILABLE','TEMPORARY_UNAVAILABLE','PERMANENT_UNAVAILABLE'));
UPDATE hh_videos SET "sourceStatus"='PERMANENT_UNAVAILABLE' WHERE NOT available;
ALTER TABLE hh_platform_settings ADD COLUMN "playbackLimit" integer NOT NULL DEFAULT 0,
 ADD COLUMN "upstreamLimit" integer NOT NULL DEFAULT 0,
 ADD COLUMN "sessionUpstreamLimit" integer NOT NULL DEFAULT 2;
ALTER TABLE hh_platform_settings ADD CONSTRAINT hh_capacity_limits CHECK
 ("playbackLimit">=0 AND "upstreamLimit">=0 AND "sessionUpstreamLimit" BETWEEN 1 AND 2);
ALTER TABLE hh_playback_sessions ADD COLUMN "state" text NOT NULL DEFAULT 'BUFFERING',
 ADD COLUMN "reservedUntil" timestamptz(3), ADD COLUMN "pauseStartedAt" timestamptz(3),
 ADD COLUMN "requestKey" uuid, ADD COLUMN "clientLabel" varchar(100),
 ADD COLUMN "progressUpdatedAt" timestamptz(3), ADD COLUMN "lastError" varchar(80);
UPDATE hh_playback_sessions SET "reservedUntil"=LEAST("expiresAt","lastHeartbeatAt"+interval '90 seconds'),
 "progressUpdatedAt"="lastHeartbeatAt";
ALTER TABLE hh_playback_sessions ADD CONSTRAINT hh_playback_state CHECK
 (state IN ('PLAYING','PAUSED','BUFFERING','DISCONNECTED','EXPIRED','TERMINATED'));
CREATE UNIQUE INDEX hh_playback_request_key ON hh_playback_sessions("requestKey");
CREATE INDEX hh_playback_reservation ON hh_playback_sessions("reservedUntil") WHERE "revokedAt" IS NULL;
CREATE INDEX hh_playback_cleanup ON hh_playback_sessions("reservedUntil") WHERE "revokedAt" IS NULL AND state NOT IN ('EXPIRED','TERMINATED');
CREATE INDEX hh_playback_account_active ON hh_playback_sessions("userId","accessType","reservedUntil") WHERE "revokedAt" IS NULL;
CREATE INDEX hh_playback_device ON hh_playback_sessions("accountSessionId");
CREATE INDEX hh_playback_resume ON hh_playback_sessions("userId","videoId","progressUpdatedAt");
ALTER TABLE hh_video_views ADD COLUMN "playbackSessionId" uuid;
CREATE UNIQUE INDEX hh_video_view_session ON hh_video_views("playbackSessionId");
CREATE TABLE hh_upstream_leases (
 id uuid PRIMARY KEY, "contextId" text NOT NULL, "playbackSessionId" uuid,
 "kind" text NOT NULL DEFAULT 'MEDIA', "createdAt" timestamptz(3) NOT NULL DEFAULT now(),
 "expiresAt" timestamptz(3) NOT NULL,
 CONSTRAINT hh_upstream_kind CHECK (kind IN ('MEDIA','DISCOVERY','METADATA'))
);
CREATE INDEX hh_upstream_expiry ON hh_upstream_leases("expiresAt");
CREATE INDEX hh_upstream_context ON hh_upstream_leases("contextId","expiresAt");
CREATE TABLE hh_security_events (
 key text PRIMARY KEY, kind varchar(60) NOT NULL, count integer NOT NULL DEFAULT 1,
 "firstSeenAt" timestamptz(3) NOT NULL, "lastSeenAt" timestamptz(3) NOT NULL,
 "sessionId" uuid, "userId" uuid
);
CREATE INDEX hh_security_retention ON hh_security_events("lastSeenAt");
COMMIT;

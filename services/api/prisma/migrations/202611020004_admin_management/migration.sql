BEGIN;
ALTER TABLE "hh_users" ADD COLUMN "suspensionReason" TEXT, ADD COLUMN "statusChangedAt" TIMESTAMPTZ(3), ADD COLUMN "statusChangedBy" TEXT;
ALTER TABLE "hh_videos" ADD COLUMN "titleOverride" TEXT, ADD COLUMN "descriptionOverride" TEXT,
  ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "adminUnavailable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "hh_memberships" ALTER COLUMN "requestId" DROP NOT NULL;
ALTER TABLE "hh_memberships" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'PAYMENT', ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "operationKey" TEXT;
ALTER TABLE "hh_memberships" ADD CONSTRAINT "hh_membership_source" CHECK ("source" IN ('PAYMENT','MANUAL') AND ("source"<>'PAYMENT' OR "requestId" IS NOT NULL));
CREATE UNIQUE INDEX "hh_memberships_operationKey_key" ON "hh_memberships"("operationKey");
ALTER TABLE "hh_admin_audit_logs" ADD COLUMN "operationKey" TEXT;
CREATE UNIQUE INDEX "hh_admin_audit_logs_operationKey_key" ON "hh_admin_audit_logs"("operationKey");
CREATE INDEX "hh_admin_audit_logs_adminId_createdAt_idx" ON "hh_admin_audit_logs"("adminId","createdAt");
CREATE INDEX "hh_admin_audit_logs_action_createdAt_idx" ON "hh_admin_audit_logs"("action","createdAt");
CREATE TABLE "hh_administrators" (
 "id" UUID PRIMARY KEY, "email" VARCHAR(254) NOT NULL UNIQUE, "name" VARCHAR(80) NOT NULL,
 "clerkUserId" TEXT UNIQUE, "role" TEXT NOT NULL DEFAULT 'ADMIN', "status" TEXT NOT NULL DEFAULT 'ACTIVE',
 "version" INTEGER NOT NULL DEFAULT 0, "createdBy" TEXT,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "hh_admin_identity" CHECK ("email"=lower("email") AND "role" IN ('OWNER','ADMIN') AND "status" IN ('ACTIVE','DISABLED'))
);
CREATE TABLE "hh_platform_settings" (
 "id" TEXT PRIMARY KEY DEFAULT 'platform', "platformName" VARCHAR(80) NOT NULL DEFAULT 'Habeshan HUB',
 "defaultCurrency" VARCHAR(3) NOT NULL DEFAULT 'ETB', "timezone" TEXT NOT NULL DEFAULT 'Africa/Nairobi',
 "registrationOpen" BOOLEAN NOT NULL DEFAULT true, "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
 "maintenanceMessage" TEXT NOT NULL DEFAULT 'We are carrying out maintenance. Please try again shortly.',
 "streamingAccess" TEXT NOT NULL DEFAULT 'PUBLIC', "supportUsername" TEXT, "supportDisplayName" VARCHAR(80),
 "adminBootstrapAt" TIMESTAMPTZ(3), "version" INTEGER NOT NULL DEFAULT 0, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "hh_platform_values" CHECK ("id"='platform' AND "defaultCurrency" ~ '^[A-Z]{3}$' AND "streamingAccess" IN ('PUBLIC','SIGNED_IN','MEMBERS'))
);
CREATE TABLE "hh_comments" (
 "id" UUID PRIMARY KEY, "videoId" TEXT NOT NULL REFERENCES "hh_videos"("id") ON DELETE RESTRICT,
 "userId" UUID NOT NULL REFERENCES "hh_users"("id") ON DELETE RESTRICT, "body" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PUBLISHED', "version" INTEGER NOT NULL DEFAULT 0,
 "moderationReason" TEXT, "moderatedBy" TEXT, "moderatedAt" TIMESTAMPTZ(3), "deletedAt" TIMESTAMPTZ(3),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "hh_comment_values" CHECK (char_length("body") BETWEEN 1 AND 2000 AND "status" IN ('PUBLISHED','HIDDEN','DELETED'))
);
CREATE INDEX "hh_comments_videoId_status_createdAt_idx" ON "hh_comments"("videoId","status","createdAt");
CREATE INDEX "hh_comments_userId_createdAt_idx" ON "hh_comments"("userId","createdAt");
CREATE INDEX "hh_comments_status_createdAt_idx" ON "hh_comments"("status","createdAt");
CREATE FUNCTION "hh_audit_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Administrator audit records are append-only'; END;
$$;
CREATE TRIGGER "hh_audit_no_mutations" BEFORE UPDATE OR DELETE ON "hh_admin_audit_logs" FOR EACH ROW EXECUTE FUNCTION "hh_audit_immutable"();
CREATE INDEX "hh_users_createdAt_idx" ON "hh_users"("createdAt");
CREATE INDEX "hh_memberships_activatedAt_idx" ON "hh_memberships"("activatedAt");
COMMIT;

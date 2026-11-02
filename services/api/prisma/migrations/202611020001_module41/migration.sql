BEGIN;
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "hh_users" (
    "id" UUID NOT NULL,
    "username" VARCHAR(30) NOT NULL,
    "usernameCanonical" VARCHAR(30) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hh_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hh_user_sessions" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hh_user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hh_viewer_sessions" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hh_viewer_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hh_videos" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleUnverified" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT NOT NULL DEFAULT '',
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "uploadedAt" TIMESTAMPTZ(3) NOT NULL,
    "durationSeconds" DOUBLE PRECISION,
    "durationSource" TEXT,
    "artwork" TEXT,
    "telegramKind" TEXT,
    "telegramSourceId" TEXT,
    "telegramMessageId" INTEGER,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inspectionAttemptedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hh_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hh_playback_sessions" (
    "id" UUID NOT NULL,
    "videoId" TEXT NOT NULL,
    "viewerId" UUID NOT NULL,
    "userId" UUID,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeatAt" TIMESTAMPTZ(3) NOT NULL,
    "lastPosition" DOUBLE PRECISION NOT NULL,
    "watchedSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "qualifiedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hh_playback_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hh_video_views" (
    "id" UUID NOT NULL,
    "videoId" TEXT NOT NULL,
    "viewerId" UUID NOT NULL,
    "userId" UUID,
    "dedupeKey" TEXT NOT NULL,
    "userDedupeKey" TEXT,
    "watchedSeconds" DOUBLE PRECISION NOT NULL,
    "qualifiedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hh_video_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hh_membership_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationMonths" INTEGER NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hh_membership_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hh_subscription_requests" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "usernameSnapshot" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planNameSnapshot" TEXT NOT NULL,
    "durationMonthsSnapshot" INTEGER NOT NULL,
    "amountMinorSnapshot" INTEGER NOT NULL,
    "currencySnapshot" VARCHAR(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNREVIEWED',
    "internalNote" TEXT NOT NULL DEFAULT '',
    "processedByAdminId" TEXT,
    "processedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hh_subscription_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hh_memberships" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "planId" TEXT NOT NULL,
    "requestId" UUID NOT NULL,
    "planName" TEXT NOT NULL,
    "durationMonths" INTEGER NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "activatedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "approvedByAdminId" TEXT NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "revokeReason" TEXT,

    CONSTRAINT "hh_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hh_admin_audit_logs" (
    "id" UUID NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "userId" UUID,
    "requestId" UUID,
    "before" JSONB,
    "after" JSONB,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hh_admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hh_users_usernameCanonical_key" ON "hh_users"("usernameCanonical");

-- CreateIndex
CREATE UNIQUE INDEX "hh_user_sessions_tokenHash_key" ON "hh_user_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "hh_user_sessions_userId_idx" ON "hh_user_sessions"("userId");

-- CreateIndex
CREATE INDEX "hh_user_sessions_expiresAt_idx" ON "hh_user_sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "hh_viewer_sessions_tokenHash_key" ON "hh_viewer_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "hh_viewer_sessions_expiresAt_idx" ON "hh_viewer_sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "hh_videos_available_uploadedAt_idx" ON "hh_videos"("available", "uploadedAt");

-- CreateIndex
CREATE INDEX "hh_videos_durationSeconds_idx" ON "hh_videos"("durationSeconds");

-- CreateIndex
CREATE UNIQUE INDEX "hh_videos_telegramKind_telegramSourceId_telegramMessageId_key" ON "hh_videos"("telegramKind", "telegramSourceId", "telegramMessageId");

-- CreateIndex
CREATE INDEX "hh_playback_sessions_expiresAt_idx" ON "hh_playback_sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "hh_video_views_dedupeKey_key" ON "hh_video_views"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "hh_video_views_userDedupeKey_key" ON "hh_video_views"("userDedupeKey");

-- CreateIndex
CREATE INDEX "hh_video_views_videoId_qualifiedAt_idx" ON "hh_video_views"("videoId", "qualifiedAt");

-- CreateIndex
CREATE INDEX "hh_video_views_qualifiedAt_idx" ON "hh_video_views"("qualifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "hh_subscription_requests_reference_key" ON "hh_subscription_requests"("reference");

-- CreateIndex
CREATE INDEX "hh_subscription_requests_status_createdAt_idx" ON "hh_subscription_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "hh_subscription_requests_userId_createdAt_idx" ON "hh_subscription_requests"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "hh_memberships_requestId_key" ON "hh_memberships"("requestId");

-- CreateIndex
CREATE INDEX "hh_memberships_userId_expiresAt_idx" ON "hh_memberships"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "hh_memberships_expiresAt_idx" ON "hh_memberships"("expiresAt");

-- CreateIndex
CREATE INDEX "hh_admin_audit_logs_createdAt_idx" ON "hh_admin_audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "hh_admin_audit_logs_targetType_targetId_createdAt_idx" ON "hh_admin_audit_logs"("targetType", "targetId", "createdAt");

-- AddForeignKey
ALTER TABLE "hh_user_sessions" ADD CONSTRAINT "hh_user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "hh_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hh_playback_sessions" ADD CONSTRAINT "hh_playback_sessions_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "hh_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hh_playback_sessions" ADD CONSTRAINT "hh_playback_sessions_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "hh_viewer_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hh_playback_sessions" ADD CONSTRAINT "hh_playback_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "hh_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hh_video_views" ADD CONSTRAINT "hh_video_views_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "hh_videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hh_video_views" ADD CONSTRAINT "hh_video_views_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "hh_viewer_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hh_video_views" ADD CONSTRAINT "hh_video_views_userId_fkey" FOREIGN KEY ("userId") REFERENCES "hh_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hh_subscription_requests" ADD CONSTRAINT "hh_subscription_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "hh_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hh_subscription_requests" ADD CONSTRAINT "hh_subscription_requests_planId_fkey" FOREIGN KEY ("planId") REFERENCES "hh_membership_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hh_memberships" ADD CONSTRAINT "hh_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "hh_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hh_memberships" ADD CONSTRAINT "hh_memberships_planId_fkey" FOREIGN KEY ("planId") REFERENCES "hh_membership_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hh_memberships" ADD CONSTRAINT "hh_memberships_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "hh_subscription_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hh_admin_audit_logs" ADD CONSTRAINT "hh_admin_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "hh_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hh_admin_audit_logs" ADD CONSTRAINT "hh_admin_audit_logs_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "hh_subscription_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Enforce identity and lifecycle invariants even under concurrent requests.
ALTER TABLE "hh_users" ADD CONSTRAINT "hh_username_format" CHECK ("username" ~ '^[A-Za-z][A-Za-z0-9_]{2,29}$' AND "usernameCanonical" = lower("username"));
ALTER TABLE "hh_users" ADD CONSTRAINT "hh_user_status" CHECK ("status" IN ('ACTIVE','SUSPENDED'));
ALTER TABLE "hh_users" ADD CONSTRAINT "hh_password_hash" CHECK ("passwordHash" LIKE 'scrypt$%');
ALTER TABLE "hh_membership_plans" ADD CONSTRAINT "hh_plan_values" CHECK ("durationMonths">0 AND "priceMinor">0 AND "currency" ~ '^[A-Z]{3}$');
ALTER TABLE "hh_subscription_requests" ADD CONSTRAINT "hh_request_values" CHECK ("durationMonthsSnapshot">0 AND "amountMinorSnapshot">0 AND "currencySnapshot" ~ '^[A-Z]{3}$');
ALTER TABLE "hh_subscription_requests" ADD CONSTRAINT "hh_request_status" CHECK ("status" IN ('PENDING','APPROVED','REJECTED','CANCELLED') AND "verificationStatus" IN ('UNREVIEWED','VERIFIED','REJECTED'));
CREATE UNIQUE INDEX "hh_one_pending_user_plan" ON "hh_subscription_requests" ("userId","planId") WHERE "status"='PENDING';
ALTER TABLE "hh_memberships" ADD CONSTRAINT "hh_membership_dates" CHECK ("expiresAt">"activatedAt");
ALTER TABLE "hh_videos" ADD CONSTRAINT "hh_video_values" CHECK ("sizeBytes">0 AND ("durationSeconds" IS NULL OR ("durationSeconds">0 AND "durationSeconds"<'Infinity'::float8)));
ALTER TABLE "hh_video_views" ADD CONSTRAINT "hh_view_seconds" CHECK ("watchedSeconds">0);
COMMIT;

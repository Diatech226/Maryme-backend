CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'COUPLE');
CREATE TYPE "CoupleStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'SUSPENDED');
CREATE TYPE "GuestSide" AS ENUM ('GROOM', 'BRIDE');
CREATE TYPE "GuestCategory" AS ENUM ('BRIDE_FAMILY', 'GROOM_FAMILY', 'WITNESS', 'FRIENDS', 'COLLEAGUES', 'VIP');
CREATE TYPE "RsvpStatus" AS ENUM ('CONFIRMED', 'PENDING', 'DECLINED');
CREATE TYPE "DietaryRequirement" AS ENUM ('STANDARD', 'VEGETARIAN', 'VEGAN', 'GLUTEN_FREE', 'CHILD_MENU', 'HALAL', 'NO_SEAFOOD');
CREATE TYPE "InvitationStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');
CREATE TYPE "CheckInStatus" AS ENUM ('VALID', 'DUPLICATE', 'REJECTED');

CREATE TABLE "Couple" (
  "id" UUID NOT NULL, "partner1" TEXT NOT NULL, "partner2" TEXT NOT NULL,
  "partner1FullName" TEXT, "partner2FullName" TEXT, "weddingDate" TIMESTAMP(3) NOT NULL,
  "location" TEXT NOT NULL, "email" TEXT NOT NULL, "phone" TEXT NOT NULL,
  "status" "CoupleStatus" NOT NULL DEFAULT 'PENDING', "guestQuota" INTEGER NOT NULL,
  "requestDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "authorizedAt" TIMESTAMP(3),
  "notes" TEXT, "budgetEstimate" DECIMAL(12,2), "bibleVerse" TEXT, "lunchVenue" TEXT,
  "lunchTime" TEXT, "churchVenue" TEXT, "churchTime" TEXT, "cityHallVenue" TEXT,
  "cityHallTime" TEXT, "groomFamilies" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "brideFamilies" TEXT[] DEFAULT ARRAY[]::TEXT[], "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, "deletedAt" TIMESTAMP(3), CONSTRAINT "Couple_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "User" (
  "id" UUID NOT NULL, "email" TEXT NOT NULL, "passwordHash" TEXT NOT NULL, "role" "UserRole" NOT NULL,
  "firstName" TEXT, "lastName" TEXT, "isActive" BOOLEAN NOT NULL DEFAULT true, "coupleId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastLoginAt" TIMESTAMP(3), CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Guest" (
  "id" UUID NOT NULL, "coupleId" UUID NOT NULL, "firstName" TEXT NOT NULL, "lastName" TEXT NOT NULL,
  "side" "GuestSide" NOT NULL, "family" TEXT, "coupons" INTEGER NOT NULL DEFAULT 1,
  "category" "GuestCategory" NOT NULL, "rsvpStatus" "RsvpStatus" NOT NULL DEFAULT 'PENDING',
  "dietary" "DietaryRequirement" NOT NULL DEFAULT 'STANDARD', "plusOne" BOOLEAN NOT NULL DEFAULT false,
  "plusOneName" TEXT, "isChild" BOOLEAN NOT NULL DEFAULT false, "tableNumber" TEXT,
  "assignedSeats" TEXT[] DEFAULT ARRAY[]::TEXT[], "phone" TEXT, "email" TEXT,
  "lodgingNeeded" BOOLEAN NOT NULL DEFAULT false, "notes" TEXT, "invitationSentDate" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3), CONSTRAINT "Guest_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Invitation" (
  "id" UUID NOT NULL, "coupleId" UUID NOT NULL, "guestId" UUID NOT NULL, "tokenHash" TEXT NOT NULL,
  "status" "InvitationStatus" NOT NULL DEFAULT 'ACTIVE', "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3), "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CheckIn" (
  "id" UUID NOT NULL, "guestId" UUID NOT NULL, "coupleId" UUID NOT NULL, "invitationId" UUID,
  "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "operatorId" UUID, "deviceId" TEXT,
  "status" "CheckInStatus" NOT NULL DEFAULT 'VALID', "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "RefreshSession" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "tokenHash" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3), "replacedById" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ipAddress" TEXT, "userAgent" TEXT, CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AuditLog" (
  "id" UUID NOT NULL, "userId" UUID, "action" TEXT NOT NULL, "entityType" TEXT NOT NULL,
  "entityId" TEXT, "metadata" JSONB, "ipAddress" TEXT, "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email"); CREATE INDEX "User_coupleId_idx" ON "User"("coupleId");
CREATE INDEX "Couple_status_idx" ON "Couple"("status"); CREATE INDEX "Guest_coupleId_idx" ON "Guest"("coupleId");
CREATE INDEX "Guest_rsvpStatus_idx" ON "Guest"("rsvpStatus"); CREATE INDEX "Guest_family_idx" ON "Guest"("family");
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash"); CREATE INDEX "Invitation_guestId_idx" ON "Invitation"("guestId");
CREATE INDEX "Invitation_coupleId_idx" ON "Invitation"("coupleId"); CREATE UNIQUE INDEX "CheckIn_guestId_key" ON "CheckIn"("guestId");
CREATE INDEX "CheckIn_coupleId_idx" ON "CheckIn"("coupleId"); CREATE INDEX "CheckIn_invitationId_idx" ON "CheckIn"("invitationId");
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash"); CREATE INDEX "RefreshSession_userId_idx" ON "RefreshSession"("userId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt"); CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

ALTER TABLE "User" ADD CONSTRAINT "User_coupleId_fkey" FOREIGN KEY ("coupleId") REFERENCES "Couple"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_coupleId_fkey" FOREIGN KEY ("coupleId") REFERENCES "Couple"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_coupleId_fkey" FOREIGN KEY ("coupleId") REFERENCES "Couple"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_coupleId_fkey" FOREIGN KEY ("coupleId") REFERENCES "Couple"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "Invitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

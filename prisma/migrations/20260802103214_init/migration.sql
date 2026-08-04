-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateEnum
CREATE TYPE "account_type" AS ENUM ('individual', 'company');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'suspended', 'deleted');

-- CreateEnum
CREATE TYPE "locale" AS ENUM ('bg', 'en');

-- CreateEnum
CREATE TYPE "approval_status" AS ENUM ('pending', 'approved', 'rejected', 'expired');

-- CreateEnum
CREATE TYPE "property_type" AS ENUM ('apartment', 'house', 'land', 'commercial', 'other');

-- CreateEnum
CREATE TYPE "lot_status" AS ENUM ('DRAFT', 'PUBLISHED', 'BIDDING_OPEN', 'EXTENDING', 'RESERVE_NOT_MET', 'CLOSED_SOLD', 'CLOSED_UNSOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "bid_status" AS ENUM ('accepted', 'rejected');

-- CreateEnum
CREATE TYPE "document_kind" AS ENUM ('title_deed', 'sketch', 'tax_valuation', 'encumbrances', 'floor_plan', 'energy_cert', 'other');

-- CreateEnum
CREATE TYPE "document_visibility" AS ENUM ('public', 'registered', 'approved_bidders');

-- CreateEnum
CREATE TYPE "viewing_kind" AS ENUM ('private', 'open_house');

-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('booked', 'cancelled', 'attended', 'no_show');

-- CreateEnum
CREATE TYPE "deposit_method" AS ENUM ('sepa', 'card_hold');

-- CreateEnum
CREATE TYPE "deposit_status" AS ENUM ('pending', 'held', 'released', 'forfeited', 'refunded');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('email', 'push', 'sms');

-- CreateEnum
CREATE TYPE "fee_party" AS ENUM ('seller', 'buyer');

-- CreateEnum
CREATE TYPE "fee_kind" AS ENUM ('entry', 'commission', 'premium', 'withdrawal');

-- CreateEnum
CREATE TYPE "fee_basis" AS ENUM ('fixed', 'percent');

-- CreateEnum
CREATE TYPE "fee_status" AS ENUM ('due', 'invoiced', 'paid', 'waived');

-- CreateEnum
CREATE TYPE "admin_role" AS ENUM ('admin', 'staff');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "email_verified_at" TIMESTAMPTZ(6),
    "phone" TEXT,
    "phone_verified_at" TIMESTAMPTZ(6),
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "account_type" "account_type" NOT NULL,
    "company_name" TEXT,
    "eik" TEXT,
    "vat" TEXT,
    "locale" "locale" NOT NULL DEFAULT 'bg',
    "status" "user_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bidder_approvals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "approval_status" NOT NULL DEFAULT 'pending',
    "kyc_provider" TEXT,
    "kyc_reference" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bidder_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "admin_role" NOT NULL DEFAULT 'staff',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMPTZ(6),

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title_bg" TEXT NOT NULL,
    "title_en" TEXT NOT NULL,
    "description_bg" TEXT NOT NULL,
    "description_en" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "area_sqm" DECIMAL(10,2),
    "rooms" INTEGER,
    "floor" INTEGER,
    "year_built" INTEGER,
    "property_type" "property_type" NOT NULL,
    "cadastral_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lots" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "lot_number" INTEGER NOT NULL,
    "status" "lot_status" NOT NULL DEFAULT 'DRAFT',
    "preview_starts_at" TIMESTAMPTZ(6),
    "bidding_opens_at" TIMESTAMPTZ(6),
    "scheduled_close_at" TIMESTAMPTZ(6),
    "effective_close_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "starting_price_minor" BIGINT NOT NULL,
    "bid_increment_minor" BIGINT,
    "reserve_price_minor" BIGINT NOT NULL,
    "soft_close_window_seconds" INTEGER NOT NULL DEFAULT 300,
    "soft_close_reset_seconds" INTEGER NOT NULL DEFAULT 300,
    "soft_close_schedule" JSONB,
    "extension_count" INTEGER NOT NULL DEFAULT 0,
    "deposit_required_minor" BIGINT,
    "winning_bid_id" UUID,
    "reserve_agreed_by" UUID,
    "reserve_agreed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bids" (
    "id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "bid_status" NOT NULL,
    "reject_reason" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "caused_extension_to" TIMESTAMPTZ(6),
    "previous_bid_id" UUID,
    "client_ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "bids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot_documents" (
    "id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "kind" "document_kind" NOT NULL,
    "filename" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "mime" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "visibility" "document_visibility" NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lot_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "viewings" (
    "id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "kind" "viewing_kind" NOT NULL,

    CONSTRAINT "viewings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "viewing_bookings" (
    "id" UUID NOT NULL,
    "viewing_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "booking_status" NOT NULL DEFAULT 'booked',
    "booked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "viewing_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposits" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "method" "deposit_method" NOT NULL,
    "status" "deposit_status" NOT NULL DEFAULT 'pending',
    "provider_ref" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "template" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "send_after" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fees" (
    "id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "party" "fee_party" NOT NULL,
    "kind" "fee_kind" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "basis" "fee_basis" NOT NULL,
    "rate" DECIMAL(6,4),
    "status" "fee_status" NOT NULL DEFAULT 'due',
    "charged_at" TIMESTAMPTZ(6),

    CONSTRAINT "fees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "properties_slug_key" ON "properties"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "lots_winning_bid_id_key" ON "lots"("winning_bid_id");

-- CreateIndex
CREATE UNIQUE INDEX "lots_property_id_lot_number_key" ON "lots"("property_id", "lot_number");

-- CreateIndex
CREATE UNIQUE INDEX "bids_lot_id_user_id_idempotency_key_key" ON "bids"("lot_id", "user_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "bidder_approvals" ADD CONSTRAINT "bidder_approvals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bidder_approvals" ADD CONSTRAINT "bidder_approvals_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_winning_bid_id_fkey" FOREIGN KEY ("winning_bid_id") REFERENCES "bids"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_reserve_agreed_by_fkey" FOREIGN KEY ("reserve_agreed_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_previous_bid_id_fkey" FOREIGN KEY ("previous_bid_id") REFERENCES "bids"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_documents" ADD CONSTRAINT "lot_documents_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_documents" ADD CONSTRAINT "lot_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viewing_bookings" ADD CONSTRAINT "viewing_bookings_viewing_id_fkey" FOREIGN KEY ("viewing_id") REFERENCES "viewings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viewing_bookings" ADD CONSTRAINT "viewing_bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fees" ADD CONSTRAINT "fees_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

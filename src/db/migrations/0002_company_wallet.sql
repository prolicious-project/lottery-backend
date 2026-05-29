-- company_wallet_txn_type enum
CREATE TYPE "public"."company_wallet_txn_type" AS ENUM('deposit_credit', 'prize_payout_debit', 'withdrawal_debit');--> statement-breakpoint

-- company_wallet (singleton row — slug='main')
CREATE TABLE "company_wallet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(20) DEFAULT 'main' NOT NULL,
	"balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(5) DEFAULT 'INR' NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "company_wallet_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint

-- company_wallet_transactions (full ledger)
CREATE TABLE "company_wallet_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"type" "company_wallet_txn_type" NOT NULL,
	"balance_after" numeric(18, 2) NOT NULL,
	"user_txn_ref" varchar(100),
	"note" text,
	"created_at" timestamp DEFAULT now()
);

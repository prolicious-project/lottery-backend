ALTER TABLE "game_types" ADD COLUMN "fee_model" varchar(20) DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "level_pools" ADD COLUMN "is_closed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "level_pools" ADD COLUMN "completed_at" timestamp;
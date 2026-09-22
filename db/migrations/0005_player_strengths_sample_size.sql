ALTER TABLE "player_strengths" ALTER COLUMN "value" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "player_strengths" ADD COLUMN "sample_size" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "player_strengths" ADD CONSTRAINT "player_strengths_sample_size_is_not_negative" CHECK ("player_strengths"."sample_size" >= 0);--> statement-breakpoint
ALTER TABLE "player_strengths" ADD CONSTRAINT "player_strengths_value_needs_minimum_sample" CHECK ("player_strengths"."value" is null or "player_strengths"."sample_size" >= 5);
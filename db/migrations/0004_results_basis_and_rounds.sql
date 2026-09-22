CREATE TYPE "public"."result_basis" AS ENUM('leaderboard', 'standings');--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "basis" "result_basis" NOT NULL;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "finish" text NOT NULL;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "round_1" integer;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "round_2" integer;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "round_3" integer;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "round_4" integer;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_standings_have_no_rounds" CHECK ("results"."basis" <> 'standings' or (
        "results"."round_1" is null and "results"."round_2" is null and "results"."round_3" is null and "results"."round_4" is null
      ));--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_rounds_are_positive" CHECK (("results"."round_1" is null or "results"."round_1" >= 1)
        and ("results"."round_2" is null or "results"."round_2" >= 1)
        and ("results"."round_3" is null or "results"."round_3" >= 1)
        and ("results"."round_4" is null or "results"."round_4" >= 1));--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_finish_is_recorded" CHECK (btrim("results"."finish") <> '');
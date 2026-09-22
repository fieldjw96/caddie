CREATE TYPE "public"."course_match" AS ENUM('exact', 'normalised', 'declared');--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "course_match" "course_match";--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_course_match_is_recorded" CHECK (("tournaments"."course_id" is null) = ("tournaments"."course_match" is null));
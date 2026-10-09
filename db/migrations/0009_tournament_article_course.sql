ALTER TYPE "public"."course_match" ADD VALUE 'tournament_article';--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "course_par" integer;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "course_yardage" integer;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "course_article_url" text;--> statement-breakpoint
CREATE UNIQUE INDEX "courses_name_unique_without_opengolfapi_id" ON "courses" USING btree ("name") WHERE "courses"."opengolfapi_id" is null;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_course_facts_are_sourced" CHECK (("tournaments"."course_par" is null and "tournaments"."course_yardage" is null)
        or ("tournaments"."course_article_url" is not null and btrim("tournaments"."course_article_url") <> ''));
ALTER TABLE "courses" ADD COLUMN "par" integer;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "published_yardage" integer;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "architect" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "tees" jsonb;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "holes" jsonb;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "holes_checked_tee" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "holes_yardage_sum" integer;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "holes_yardage_difference" integer;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "holes_trusted" boolean;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "attribution" text;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_opengolfapi_is_attributed" CHECK ("courses"."source" <> 'opengolfapi' or ("courses"."attribution" is not null and btrim("courses"."attribution") <> ''));--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_holes_check_is_complete" CHECK ("courses"."holes_trusted" is null or (
        "courses"."holes" is not null
        and "courses"."holes_checked_tee" is not null
        and "courses"."published_yardage" is not null
        and "courses"."holes_yardage_sum" is not null
        and "courses"."holes_yardage_difference" = "courses"."holes_yardage_sum" - "courses"."published_yardage"
      ));--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_holes_trusted_is_the_check" CHECK ("courses"."holes_trusted" is null or "courses"."holes_trusted" = (
        abs("courses"."holes_yardage_difference") * 100 <= 3 * "courses"."published_yardage"
      ));
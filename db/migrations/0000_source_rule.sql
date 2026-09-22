CREATE TYPE "public"."source" AS ENUM('wikidata', 'wikipedia', 'opengolfapi', 'derived');--> statement-breakpoint
CREATE TABLE "course_traits" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"trait" text NOT NULL,
	"value" double precision NOT NULL,
	"unit" text NOT NULL,
	"source" "source" NOT NULL,
	"source_url" text,
	"derivation" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_traits_source_is_recorded" CHECK ((
      "course_traits"."source" = 'derived'
      and "course_traits"."derivation" is not null
      and btrim("course_traits"."derivation") <> ''
      and "course_traits"."source_url" is null
    ) or (
      "course_traits"."source" <> 'derived'
      and "course_traits"."source_url" is not null
      and btrim("course_traits"."source_url") <> ''
    ))
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"wikidata_id" text,
	"opengolfapi_id" text,
	"source" "source" NOT NULL,
	"source_url" text,
	"derivation" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courses_source_is_recorded" CHECK ((
      "courses"."source" = 'derived'
      and "courses"."derivation" is not null
      and btrim("courses"."derivation") <> ''
      and "courses"."source_url" is null
    ) or (
      "courses"."source" <> 'derived'
      and "courses"."source_url" is not null
      and btrim("courses"."source_url") <> ''
    ))
);
--> statement-breakpoint
CREATE TABLE "player_strengths" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"strength" text NOT NULL,
	"value" double precision NOT NULL,
	"source" "source" NOT NULL,
	"source_url" text,
	"derivation" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_strengths_are_derived" CHECK ("player_strengths"."source" = 'derived'),
	CONSTRAINT "player_strengths_source_is_recorded" CHECK ((
      "player_strengths"."source" = 'derived'
      and "player_strengths"."derivation" is not null
      and btrim("player_strengths"."derivation") <> ''
      and "player_strengths"."source_url" is null
    ) or (
      "player_strengths"."source" <> 'derived'
      and "player_strengths"."source_url" is not null
      and btrim("player_strengths"."source_url") <> ''
    ))
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"wikidata_id" text NOT NULL,
	"name" text NOT NULL,
	"date_of_birth" date,
	"source" "source" NOT NULL,
	"source_url" text,
	"derivation" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_wikidata_id_is_a_qid" CHECK ("players"."wikidata_id" ~ '^Q[1-9][0-9]*$'),
	CONSTRAINT "players_source_is_recorded" CHECK ((
      "players"."source" = 'derived'
      and "players"."derivation" is not null
      and btrim("players"."derivation") <> ''
      and "players"."source_url" is null
    ) or (
      "players"."source" <> 'derived'
      and "players"."source_url" is not null
      and btrim("players"."source_url") <> ''
    ))
);
--> statement-breakpoint
CREATE TABLE "results" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"tournament_id" integer NOT NULL,
	"position" integer,
	"source" "source" NOT NULL,
	"source_url" text,
	"derivation" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "results_position_is_positive" CHECK ("results"."position" is null or "results"."position" >= 1),
	CONSTRAINT "results_source_is_recorded" CHECK ((
      "results"."source" = 'derived'
      and "results"."derivation" is not null
      and btrim("results"."derivation") <> ''
      and "results"."source_url" is null
    ) or (
      "results"."source" <> 'derived'
      and "results"."source_url" is not null
      and btrim("results"."source_url") <> ''
    ))
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"season" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"course_id" integer,
	"source" "source" NOT NULL,
	"source_url" text,
	"derivation" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournaments_ends_after_it_starts" CHECK ("tournaments"."end_date" >= "tournaments"."start_date"),
	CONSTRAINT "tournaments_source_is_recorded" CHECK ((
      "tournaments"."source" = 'derived'
      and "tournaments"."derivation" is not null
      and btrim("tournaments"."derivation") <> ''
      and "tournaments"."source_url" is null
    ) or (
      "tournaments"."source" <> 'derived'
      and "tournaments"."source_url" is not null
      and btrim("tournaments"."source_url") <> ''
    ))
);
--> statement-breakpoint
ALTER TABLE "course_traits" ADD CONSTRAINT "course_traits_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_strengths" ADD CONSTRAINT "player_strengths_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "course_traits_course_trait_unique" ON "course_traits" USING btree ("course_id","trait");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_wikidata_id_unique" ON "courses" USING btree ("wikidata_id");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_opengolfapi_id_unique" ON "courses" USING btree ("opengolfapi_id");--> statement-breakpoint
CREATE UNIQUE INDEX "player_strengths_player_strength_unique" ON "player_strengths" USING btree ("player_id","strength");--> statement-breakpoint
CREATE UNIQUE INDEX "players_wikidata_id_unique" ON "players" USING btree ("wikidata_id");--> statement-breakpoint
CREATE UNIQUE INDEX "results_player_tournament_unique" ON "results" USING btree ("player_id","tournament_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tournaments_name_season_unique" ON "tournaments" USING btree ("name","season");
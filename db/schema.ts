// Drizzle schema for db/migrations (introspected with drizzle-kit pull, snake_case keys kept).
// The SQL migrations are the source of truth (foreign keys, triggers and functions live there);
// this file only types queries. Regenerate it after changing them.
import { pgTable, unique, uuid, text, boolean, timestamp, index, check, integer, jsonb, uniqueIndex, numeric, primaryKey, bigint, date, time } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().default('').notNull(),
	email: text().notNull(),
	email_verified: boolean().default(false).notNull(),
	image: text(),
	created_at: timestamp({ withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	unique("users_email_key").on(table.email),
]);

export const auth_sessions = pgTable("auth_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	user_id: uuid().notNull(),
	token: text().notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
	ip_address: text(),
	user_agent: text(),
	created_at: timestamp({ withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("auth_sessions_user").using("btree", table.user_id.asc().nullsLast()),
	unique("auth_sessions_token_key").on(table.token),
]);

export const auth_accounts = pgTable("auth_accounts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	user_id: uuid().notNull(),
	account_id: text().notNull(),
	provider_id: text().notNull(),
	access_token: text(),
	refresh_token: text(),
	id_token: text(),
	access_token_expires_at: timestamp({ withTimezone: true, mode: 'date' }),
	refresh_token_expires_at: timestamp({ withTimezone: true, mode: 'date' }),
	scope: text(),
	password: text(),
	created_at: timestamp({ withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("auth_accounts_user").using("btree", table.user_id.asc().nullsLast()),
]);

export const auth_verifications = pgTable("auth_verifications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	identifier: text().notNull(),
	value: text().notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("auth_verifications_identifier").using("btree", table.identifier.asc().nullsLast()),
]);

export const signup_intents = pgTable("signup_intents", {
	email: text().primaryKey().notNull(),
	full_name: text(),
	organization_name: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, () => [
	check("signup_intents_email_check", sql`email = lower(email)`),
	check("signup_intents_full_name_check", sql`char_length(full_name) <= 120`),
	check("signup_intents_organization_name_check", sql`char_length(organization_name) <= 120`),
]);

export const organizations = pgTable("organizations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	slug: text().notNull(),
	status: text().default('active').notNull(),
	created_by: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("organizations_slug_key").on(table.slug),
	check("organizations_name_check", sql`(length(TRIM(BOTH FROM name)) >= 1) AND (length(TRIM(BOTH FROM name)) <= 120)`),
	check("organizations_slug_check", sql`slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'::text`),
	check("organizations_status_check", sql`status = ANY (ARRAY['active'::text, 'suspended'::text, 'closed'::text])`),
]);

export const profiles = pgTable("profiles", {
	id: uuid().primaryKey().notNull(),
	full_name: text(),
	email: text(),
	avatar_url: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, () => [
]);

export const organization_members = pgTable("organization_members", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	user_id: uuid().notNull(),
	role: text().notNull(),
	created_by: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("organization_members_user_idx").using("btree", table.user_id.asc().nullsLast()),
	unique("organization_members_organization_id_user_id_key").on(table.organization_id, table.user_id),
	check("organization_members_role_check", sql`role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])`),
]);

export const platform_staff = pgTable("platform_staff", {
	user_id: uuid().primaryKey().notNull(),
	role: text().notNull(),
	created_by: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, () => [
	check("platform_staff_role_check", sql`role = ANY (ARRAY['admin'::text, 'operator'::text, 'moderator'::text, 'cohost'::text])`),
]);

export const apps = pgTable("apps", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	name: text().notNull(),
	slug: text().notNull(),
	website_url: text(),
	description: text(),
	category: text(),
	business_type: text(),
	status: text().default('draft').notNull(),
	created_by: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("apps_organization_id_slug_key").on(table.organization_id, table.slug),
	unique("apps_id_organization_id_key").on(table.id, table.organization_id),
	check("apps_name_check", sql`(length(TRIM(BOTH FROM name)) >= 1) AND (length(TRIM(BOTH FROM name)) <= 120)`),
	check("apps_slug_check", sql`slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'::text`),
	check("apps_website_url_check", sql`(website_url IS NULL) OR (website_url ~* '^https?://'::text)`),
	check("apps_business_type_check", sql`business_type = ANY (ARRAY['b2b'::text, 'b2c'::text, 'both'::text])`),
	check("apps_status_check", sql`status = ANY (ARRAY['draft'::text, 'active'::text, 'archived'::text])`),
]);

export const app_versions = pgTable("app_versions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	app_id: uuid().notNull(),
	version_label: text().notNull(),
	version_number: integer().notNull(),
	product_url: text(),
	privacy_url: text(),
	terms_url: text(),
	pricing_url: text(),
	snapshot_json: jsonb(),
	created_by: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("app_versions_app_id_version_number_key").on(table.app_id, table.version_number),
	unique("app_versions_id_organization_id_key").on(table.id, table.organization_id),
	check("app_versions_version_number_check", sql`version_number > 0`),
	check("app_versions_product_url_check", sql`(product_url IS NULL) OR (product_url ~* '^https?://'::text)`),
	check("app_versions_privacy_url_check", sql`(privacy_url IS NULL) OR (privacy_url ~* '^https?://'::text)`),
	check("app_versions_terms_url_check", sql`(terms_url IS NULL) OR (terms_url ~* '^https?://'::text)`),
	check("app_versions_pricing_url_check", sql`(pricing_url IS NULL) OR (pricing_url ~* '^https?://'::text)`),
]);

export const launch_statuses = pgTable("launch_statuses", {
	status: text().primaryKey().notNull(),
	is_exception: boolean().default(false).notNull(),
	is_terminal: boolean().default(false).notNull(),
});

export const launch_state_history = pgTable("launch_state_history", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	launch_id: uuid().notNull(),
	from_status: text().notNull(),
	to_status: text().notNull(),
	actor_id: uuid(),
	actor_kind: text().notNull(),
	reason: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("launch_state_history_launch_idx").using("btree", table.launch_id.asc().nullsLast(), table.created_at.desc().nullsFirst()),
	check("launch_state_history_actor_kind_check", sql`actor_kind = ANY (ARRAY['founder'::text, 'operator'::text, 'system'::text])`),
]);

export const launch_participants = pgTable("launch_participants", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	launch_id: uuid().notNull(),
	user_id: uuid(),
	external_name: text(),
	role: text().notNull(),
	status: text().default('invited').notNull(),
	created_by: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, () => [
	check("launch_participants_role_check", sql`role = ANY (ARRAY['founder'::text, 'cohost'::text, 'moderator'::text, 'operator'::text, 'guest'::text])`),
	check("launch_participants_status_check", sql`status = ANY (ARRAY['invited'::text, 'confirmed'::text, 'declined'::text])`),
	check("launch_participants_check", sql`(user_id IS NOT NULL) OR (external_name IS NOT NULL)`),
]);

export const launch_goals = pgTable("launch_goals", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	launch_id: uuid().notNull(),
	goal_type: text().notNull(),
	is_primary: boolean().default(false).notNull(),
	target_value: numeric(),
	destination_url: text(),
	created_by: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("launch_goals_one_primary").using("btree", table.launch_id.asc().nullsLast()).where(sql`is_primary`),
	check("launch_goals_goal_type_check", sql`goal_type = ANY (ARRAY['purchase'::text, 'trial'::text, 'signup'::text, 'lead'::text, 'demo_booking'::text, 'download'::text, 'waitlist'::text, 'custom'::text])`),
	check("launch_goals_target_value_check", sql`(target_value IS NULL) OR (target_value >= (0)::numeric)`),
	check("launch_goals_destination_url_check", sql`(destination_url IS NULL) OR (destination_url ~* '^https?://'::text)`),
]);

export const hypotheses = pgTable("hypotheses", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	launch_id: uuid().notNull(),
	ai_run_id: uuid(),
	statement: text().notNull(),
	evidence_summary: text(),
	status: text().default('proposed').notNull(),
	created_by: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("hypotheses_id_organization_id_key").on(table.id, table.organization_id),
	check("hypotheses_status_check", sql`status = ANY (ARRAY['proposed'::text, 'accepted'::text, 'testing'::text, 'supported'::text, 'refuted'::text, 'inconclusive'::text, 'rejected'::text])`),
]);

export const experiments = pgTable("experiments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	launch_id: uuid().notNull(),
	hypothesis_id: uuid(),
	name: text().notNull(),
	independent_variable: text().notNull(),
	primary_metric: text().notNull(),
	status: text().default('draft').notNull(),
	starts_at: timestamp({ withTimezone: true, mode: 'string' }),
	ends_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_by: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("experiments_id_organization_id_key").on(table.id, table.organization_id),
	check("experiments_status_check", sql`status = ANY (ARRAY['draft'::text, 'awaiting_approval'::text, 'approved'::text, 'running'::text, 'completed'::text, 'cancelled'::text])`),
	check("experiments_check", sql`(ends_at IS NULL) OR (starts_at IS NULL) OR (ends_at > starts_at)`),
]);

export const experiment_variants = pgTable("experiment_variants", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	experiment_id: uuid().notNull(),
	label: text().notNull(),
	is_control: boolean().default(false).notNull(),
	configuration: jsonb().default({}).notNull(),
	created_by: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("experiment_variants_one_control").using("btree", table.experiment_id.asc().nullsLast()).where(sql`is_control`),
	unique("experiment_variants_experiment_id_label_key").on(table.experiment_id, table.label),
	unique("experiment_variants_id_organization_id_key").on(table.id, table.organization_id),
]);

export const experiment_results = pgTable("experiment_results", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	experiment_id: uuid().notNull(),
	variant_id: uuid().notNull(),
	sample_size: integer().notNull(),
	metric_value: numeric(),
	conversions: integer().default(0).notNull(),
	revenue_amount: integer(),
	currency: text(),
	metadata: jsonb(),
	calculated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	created_by: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, () => [
	check("experiment_results_sample_size_check", sql`sample_size >= 0`),
	check("experiment_results_conversions_check", sql`conversions >= 0`),
	check("experiment_results_revenue_amount_check", sql`(revenue_amount IS NULL) OR (revenue_amount >= 0)`),
	check("experiment_results_currency_check", sql`(currency IS NULL) OR (currency ~ '^[a-z]{3}$'::text)`),
]);

export const app_intakes = pgTable("app_intakes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	app_id: uuid().notNull(),
	app_version_id: uuid().notNull(),
	founder_description: text(),
	target_customer: text(),
	problem_solved: text(),
	desired_outcome: text(),
	pricing_summary: text(),
	primary_cta: text(),
	competitors: text(),
	founder_notes: text(),
	status: text().default('in_progress').notNull(),
	submitted_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_by: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	founder_name: text(),
	company_name: text(),
	desired_action: text(),
}, () => [
	check("app_intakes_status_check", sql`status = ANY (ARRAY['in_progress'::text, 'submitted'::text])`),
	check("app_intakes_founder_name_check", sql`(founder_name IS NULL) OR (length(founder_name) <= 120)`),
	check("app_intakes_company_name_check", sql`(company_name IS NULL) OR (length(company_name) <= 120)`),
	check("app_intakes_desired_action_check", sql`(desired_action IS NULL) OR (length(desired_action) <= 500)`),
]);

export const qualification_events = pgTable("qualification_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	qualification_id: uuid().notNull(),
	app_version_id: uuid().notNull(),
	area: text().notNull(),
	status: text().notNull(),
	notes: text(),
	reviewer_id: uuid().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("qualification_events_q_idx").using("btree", table.qualification_id.asc().nullsLast(), table.created_at.asc().nullsLast()),
	check("qualification_events_area_check", sql`area = ANY (ARRAY['functionality'::text, 'security'::text, 'privacy'::text, 'fraud'::text, 'brand_ip'::text, 'launch_readiness'::text, 'decision'::text])`),
	check("qualification_events_notes_check", sql`(notes IS NULL) OR (length(notes) <= 4000)`),
	check("qualification_events_check", sql`((area = 'decision'::text) AND (status = ANY (ARRAY['qualified'::text, 'changes_required'::text, 'rejected'::text]))) OR ((area <> 'decision'::text) AND (status = ANY (ARRAY['pending'::text, 'pass'::text, 'fail'::text, 'n_a'::text])))`),
]);

export const qualifications = pgTable("qualifications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	app_version_id: uuid().notNull(),
	launch_id: uuid(),
	status: text().default('pending').notNull(),
	functionality_status: text().default('pending').notNull(),
	security_status: text().default('pending').notNull(),
	privacy_status: text().default('pending').notNull(),
	fraud_status: text().default('pending').notNull(),
	brand_ip_status: text().default('pending').notNull(),
	launch_readiness_status: text().default('pending').notNull(),
	reviewer_id: uuid(),
	review_notes: text(),
	reviewed_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_by: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	functionality_notes: text(),
	security_notes: text(),
	privacy_notes: text(),
	fraud_notes: text(),
	brand_ip_notes: text(),
	launch_readiness_notes: text(),
}, (table) => [
	index("qualifications_status_idx").using("btree", table.status.asc().nullsLast(), table.created_at.asc().nullsLast()),
	check("qualifications_status_check", sql`status = ANY (ARRAY['pending'::text, 'in_review'::text, 'qualified'::text, 'changes_required'::text, 'rejected'::text])`),
	check("qualifications_functionality_status_check", sql`functionality_status = ANY (ARRAY['pending'::text, 'pass'::text, 'fail'::text, 'n_a'::text])`),
	check("qualifications_security_status_check", sql`security_status = ANY (ARRAY['pending'::text, 'pass'::text, 'fail'::text, 'n_a'::text])`),
	check("qualifications_privacy_status_check", sql`privacy_status = ANY (ARRAY['pending'::text, 'pass'::text, 'fail'::text, 'n_a'::text])`),
	check("qualifications_fraud_status_check", sql`fraud_status = ANY (ARRAY['pending'::text, 'pass'::text, 'fail'::text, 'n_a'::text])`),
	check("qualifications_brand_ip_status_check", sql`brand_ip_status = ANY (ARRAY['pending'::text, 'pass'::text, 'fail'::text, 'n_a'::text])`),
	check("qualifications_launch_readiness_status_check", sql`launch_readiness_status = ANY (ARRAY['pending'::text, 'pass'::text, 'fail'::text, 'n_a'::text])`),
]);

export const launch_prices = pgTable("launch_prices", {
	launch_type: text().primaryKey().notNull(),
	amount: integer().notNull(),
	currency: text().default('usd').notNull(),
	active: boolean().default(true).notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, () => [
	check("launch_prices_launch_type_check", sql`launch_type = ANY (ARRAY['founder_demo'::text, 'cohosted_launch'::text])`),
	check("launch_prices_amount_check", sql`amount >= 0`),
	check("launch_prices_currency_check", sql`currency ~ '^[a-z]{3}$'::text`),
]);

export const launch_payments = pgTable("launch_payments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	launch_id: uuid().notNull(),
	provider: text().notNull(),
	provider_payment_id: text().notNull(),
	amount: integer().notNull(),
	currency: text().notNull(),
	status: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("launch_payments_provider_payment_id_key").on(table.provider_payment_id),
	check("launch_payments_provider_check", sql`provider = 'stripe'::text`),
	check("launch_payments_amount_check", sql`amount >= 0`),
	check("launch_payments_currency_check", sql`currency ~ '^[a-z]{3}$'::text`),
	check("launch_payments_status_check", sql`status = ANY (ARRAY['succeeded'::text, 'refunded'::text, 'failed'::text])`),
]);

export const launch_orders = pgTable("launch_orders", {
	id: uuid().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	launch_id: uuid().notNull(),
	stripe_session_id: text().notNull(),
	status: text().default('pending').notNull(),
	amount: integer().notNull(),
	currency: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	paid_at: timestamp({ withTimezone: true, mode: 'string' }),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("launch_orders_launch_idx").using("btree", table.launch_id.asc().nullsLast()),
	unique("launch_orders_stripe_session_id_key").on(table.stripe_session_id),
	check("launch_orders_amount_check", sql`amount >= 0`),
	check("launch_orders_status_check", sql`status = ANY (ARRAY['pending'::text, 'paid'::text])`),
	check("launch_orders_currency_check", sql`currency ~ '^[a-z]{3}$'::text`),
	check("launch_orders_check", sql`(status = 'paid'::text) = (paid_at IS NOT NULL)`),
]);

export const ai_runs = pgTable("ai_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	launch_id: uuid(),
	task_type: text().notNull(),
	source: text().notNull(),
	model: text().notNull(),
	prompt_version: text().notNull(),
	input_reference: jsonb().default({}).notNull(),
	output: jsonb(),
	status: text().default('running').notNull(),
	error_code: text(),
	error_message: text(),
	started_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	completed_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	index("ai_runs_launch_idx").using("btree", table.launch_id.asc().nullsLast(), table.task_type.asc().nullsLast(), table.started_at.desc().nullsFirst()),
	uniqueIndex("ai_runs_one_running_per_task").using("btree", table.launch_id.asc().nullsLast(), table.task_type.asc().nullsLast()).where(sql`((status = 'running'::text) AND (launch_id IS NOT NULL))`),
	index("ai_runs_org_idx").using("btree", table.organization_id.asc().nullsLast(), table.started_at.desc().nullsFirst()),
	check("ai_runs_task_type_check", sql`task_type = ANY (ARRAY['analyze_product'::text, 'generate_launch_strategy'::text, 'generate_runbook'::text, 'generate_customer_questions'::text, 'analyze_recording'::text, 'generate_clip_candidates'::text, 'analyze_performance'::text, 'propose_experiments'::text])`),
	check("ai_runs_source_check", sql`source = ANY (ARRAY['mock'::text, 'openai'::text])`),
	check("ai_runs_status_check", sql`status = ANY (ARRAY['running'::text, 'succeeded'::text, 'failed'::text])`),
	check("ai_runs_error_message_check", sql`(error_message IS NULL) OR (length(error_message) <= 2000)`),
]);

export const product_understandings = pgTable("product_understandings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	app_intake_id: uuid().notNull(),
	app_version_id: uuid().notNull(),
	source: text().notNull(),
	model: text(),
	prompt_version: text(),
	output: jsonb().notNull(),
	founder_confirmed_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	ai_run_id: uuid(),
}, (table) => [
	index("product_understandings_intake_idx").using("btree", table.app_intake_id.asc().nullsLast(), table.created_at.desc().nullsFirst()),
	check("product_understandings_source_check", sql`source = ANY (ARRAY['mock'::text, 'openai'::text])`),
]);

export const launch_strategies = pgTable("launch_strategies", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	launch_id: uuid().notNull(),
	version: integer().notNull(),
	status: text().default('draft').notNull(),
	strategy: jsonb().notNull(),
	customer_questions: jsonb().default([]).notNull(),
	generated_by_ai_run_id: uuid(),
	founder_notes: text(),
	approved_by: uuid(),
	approved_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("launch_strategies_one_approved").using("btree", table.launch_id.asc().nullsLast()).where(sql`(status = 'approved'::text)`),
	unique("launch_strategies_launch_id_version_key").on(table.launch_id, table.version),
	check("launch_strategies_version_check", sql`version > 0`),
	check("launch_strategies_status_check", sql`status = ANY (ARRAY['draft'::text, 'approved'::text, 'superseded'::text])`),
	check("launch_strategies_founder_notes_check", sql`(founder_notes IS NULL) OR (length(founder_notes) <= 2000)`),
]);

export const launch_runbooks = pgTable("launch_runbooks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	launch_id: uuid().notNull(),
	strategy_id: uuid(),
	version: integer().notNull(),
	title: text().notNull(),
	duration_minutes: integer().notNull(),
	status: text().default('draft').notNull(),
	opening_hook: text(),
	problem_statement: text(),
	demo_plan: jsonb().default([]).notNull(),
	use_cases: jsonb().default([]).notNull(),
	questions: jsonb().default([]).notNull(),
	cta_script: text(),
	closing_script: text(),
	generated_by_ai_run_id: uuid(),
	approved_by: uuid(),
	approved_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("launch_runbooks_one_approved").using("btree", table.launch_id.asc().nullsLast()).where(sql`(status = 'approved'::text)`),
	unique("launch_runbooks_launch_id_version_key").on(table.launch_id, table.version),
	check("launch_runbooks_version_check", sql`version > 0`),
	check("launch_runbooks_title_check", sql`length(title) <= 200`),
	check("launch_runbooks_duration_minutes_check", sql`(duration_minutes >= 5) AND (duration_minutes <= 180)`),
	check("launch_runbooks_status_check", sql`status = ANY (ARRAY['draft'::text, 'approved'::text, 'superseded'::text])`),
]);

export const launches = pgTable("launches", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	app_id: uuid().notNull(),
	app_version_id: uuid().notNull(),
	launch_type: text(),
	status: text().default('DRAFT').notNull(),
	primary_goal_type: text(),
	primary_goal_value: numeric(),
	price_amount: integer(),
	currency: text(),
	scheduled_at: timestamp({ withTimezone: true, mode: 'string' }),
	production_cutoff_at: timestamp({ withTimezone: true, mode: 'string' }),
	primary_cta_id: uuid(),
	runbook_id: uuid(),
	created_by: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	completed_at: timestamp({ withTimezone: true, mode: 'string' }),
	objective: text(),
	audience: text(),
	cta_text: text(),
	dm_keyword: text(),
	tracked_destination_url: text(),
	run_of_show_notes: text(),
	preparation_started_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	index("launches_org_idx").using("btree", table.organization_id.asc().nullsLast(), table.created_at.desc().nullsFirst()),
	unique("launches_id_organization_id_key").on(table.id, table.organization_id),
	check("launches_launch_type_check", sql`launch_type = ANY (ARRAY['founder_demo'::text, 'cohosted_launch'::text])`),
	check("launches_price_amount_check", sql`(price_amount IS NULL) OR (price_amount >= 0)`),
	check("launches_currency_check", sql`(currency IS NULL) OR (currency ~ '^[a-z]{3}$'::text)`),
	check("launches_objective_check", sql`(objective IS NULL) OR (length(objective) <= 1000)`),
	check("launches_audience_check", sql`(audience IS NULL) OR (length(audience) <= 1000)`),
	check("launches_cta_text_check", sql`(cta_text IS NULL) OR (length(cta_text) <= 280)`),
	check("launches_dm_keyword_check", sql`(dm_keyword IS NULL) OR (dm_keyword ~ '^[A-Za-z0-9]{2,20}$'::text)`),
	check("launches_tracked_destination_url_check", sql`(tracked_destination_url IS NULL) OR (tracked_destination_url ~* '^https?://'::text)`),
	check("launches_run_of_show_notes_check", sql`(run_of_show_notes IS NULL) OR (length(run_of_show_notes) <= 8000)`),
]);

export const launch_status_transitions = pgTable("launch_status_transitions", {
	from_status: text().notNull(),
	to_status: text().notNull(),
	allowed_actors: text().array().notNull(),
}, (table) => [
	primaryKey({ columns: [table.from_status, table.to_status], name: "launch_status_transitions_pkey"}),
	check("launch_status_transitions_allowed_actors_check", sql`allowed_actors <@ ARRAY['founder'::text, 'operator'::text, 'system'::text]`),
]);

// ---- PRD v1.4 additions (db/migrations/0002+). Hand-written to match the SQL. ----

export const launch_truth_sheets = pgTable("launch_truth_sheets", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	launch_id: uuid().notNull(),
	version: integer().notNull(),
	status: text().default('draft').notNull(),
	items: jsonb().default([]).notNull(),
	source: text().default('founder').notNull(),
	created_by: uuid(),
	approved_by: uuid(),
	approved_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const launch_capture_plans = pgTable("launch_capture_plans", {
	launch_id: uuid().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	capture_choice: text(),
	rehearsal_checked: text().array().default(sql`'{}'`).notNull(),
	confidential_sections: text(),
	updated_by: uuid(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const launch_recordings = pgTable("launch_recordings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	launch_id: uuid().notNull(),
	source: text().notNull(),
	status: text().default('awaiting_upload').notNull(),
	storage_path: text(),
	pending_path: text(),
	original_filename: text(),
	content_type: text(),
	size_bytes: bigint({ mode: 'number' }),
	duration_ms: integer(),
	transcript: jsonb(),
	transcript_source: text(),
	failure_code: text(),
	failure_message: text(),
	attempts: integer().default(0).notNull(),
	created_by: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const launch_clips = pgTable("launch_clips", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	launch_id: uuid().notNull(),
	recording_id: uuid(),
	position: integer().notNull(),
	status: text().default('active').notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const launch_clip_versions = pgTable("launch_clip_versions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clip_id: uuid().notNull(),
	launch_id: uuid().notNull(),
	organization_id: uuid().notNull(),
	version: integer().notNull(),
	content: jsonb().notNull(),
	export_status: text().default('not_started').notNull(),
	export_path: text(),
	export_error: text(),
	created_by: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const launch_clip_reviews = pgTable("launch_clip_reviews", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	version_id: uuid().notNull(),
	launch_id: uuid().notNull(),
	organization_id: uuid().notNull(),
	stage: text().notNull(),
	decision: text().notNull(),
	reason: text(),
	reviewer_id: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const launch_plan_items = pgTable("launch_plan_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	launch_id: uuid().notNull(),
	clip_version_id: uuid().notNull(),
	day: integer().notNull(),
	planned_date: date({ mode: 'string' }).notNull(),
	planned_time: time().notNull(),
	timezone: text().notNull(),
	channel: text().notNull(),
	channel_owner: text().notNull(),
	responsible: text().notNull(),
	audience: text().notNull(),
	objective: text().notNull(),
	post_copy: text().notNull(),
	destination_url: text(),
	status: text().default('planned').notNull(),
	posted_url: text(),
	posted_at: timestamp({ withTimezone: true, mode: 'string' }),
	reported_by: uuid(),
	confirmed_by: uuid(),
	confirmed_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const tracked_links = pgTable("tracked_links", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	launch_id: uuid().notNull(),
	plan_item_id: uuid(),
	slug: text().notNull(),
	destination_url: text().notNull(),
	channel: text(),
	created_by: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const tracked_link_clicks = pgTable("tracked_link_clicks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	link_id: uuid().notNull(),
	launch_id: uuid().notNull(),
	visitor_hash: text().notNull(),
	click_window: bigint({ mode: 'number' }).notNull(),
	clicked_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

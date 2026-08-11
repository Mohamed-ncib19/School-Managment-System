import { pgTable, timestamp, text, integer, index, uniqueIndex, foreignKey, uuid, numeric, boolean, jsonb, check, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const compensationModel = pgEnum("CompensationModel", ['percentage', 'fixed_salary', 'fixed_per_student', 'fixed_per_group', 'hybrid', 'custom'])
export const payment_method = pgEnum("PaymentMethod", ['cash'])
export const paymentStatus = pgEnum("PaymentStatus", ['not_paid', 'due_soon', 'overdue', 'paid', 'partially_paid', 'cancelled'])
export const payrollDocumentType = pgEnum("PayrollDocumentType", ['professor_receipt', 'school_settlement'])
export const studentStatus = pgEnum("StudentStatus", ['active', 'paused', 'withdrawn'])
export const transactionType = pgEnum("TransactionType", ['payment', 'refund', 'correction'])
export const userRole = pgEnum("UserRole", ['super_admin'])


export const studentPayments = pgTable("student_payments", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	student_id: uuid("student_id").notNull(),
	period: text().notNull(),
	amount_due: numeric("amount_due", { precision: 10, scale:  2 }).notNull(),
	due_date: timestamp("due_date", { precision: 3, mode: 'date' }).notNull(),
	status: paymentStatus().default('not_paid').notNull(),
	paid_amount: numeric("paid_amount", { precision: 10, scale:  2 }),
	paid_at: timestamp("paid_at", { precision: 3, mode: 'date' }),
	recorded_by: uuid("recorded_by"),
	payment_method: payment_method("payment_method"),
	notes: text(),
	created_at: timestamp("created_at", { precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updated_at: timestamp("updated_at", { precision: 3, mode: 'date' }).defaultNow().notNull().$onUpdate(() => new Date()),
	group_id: uuid("group_id").notNull(),
}, (table) => [
	index("student_payments_due_date_idx").using("btree", table.due_date.asc().nullsLast()),
	index("student_payments_group_id_idx").using("btree", table.group_id.asc().nullsLast()),
	index("student_payments_period_idx").using("btree", table.period.asc().nullsLast()),
	index("student_payments_period_status_idx").using("btree", table.period.asc().nullsLast(), table.status.asc().nullsLast()),
	index("student_payments_status_due_date_idx").using("btree", table.status.asc().nullsLast(), table.due_date.asc().nullsLast()),
	index("student_payments_status_idx").using("btree", table.status.asc().nullsLast()),
	uniqueIndex("student_payments_student_id_group_id_period_key").using("btree", table.student_id.asc().nullsLast(), table.group_id.asc().nullsLast(), table.period.asc().nullsLast()),
	foreignKey({
			columns: [table.student_id],
			foreignColumns: [students.id],
			name: "student_payments_student_id_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.recorded_by],
			foreignColumns: [users.id],
			name: "student_payments_recorded_by_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.group_id],
			foreignColumns: [groups.id],
			name: "student_payments_group_id_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const professors = pgTable("professors", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	field_id: uuid("field_id").notNull(),
	full_name: text("full_name").notNull(),
	phone: text().notNull(),
	email: text(),
	user_id: uuid("user_id"),
	is_active: boolean("is_active").default(true).notNull(),
	created_at: timestamp("created_at", { precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	color: text(),
}, (table) => [
	index("professors_field_id_idx").using("btree", table.field_id.asc().nullsLast()),
	index("professors_is_active_idx").using("btree", table.is_active.asc().nullsLast()),
	foreignKey({
			columns: [table.field_id],
			foreignColumns: [fields.id],
			name: "professors_field_id_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "professors_user_id_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const fields = pgTable("fields", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	name: text().notNull(),
	description: text(),
	created_by: uuid("created_by").notNull(),
	created_at: timestamp("created_at", { precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	level_id: uuid("level_id").notNull(),
	color: text(),
	is_active: boolean("is_active").default(true).notNull(),
}, (table) => [
	index("fields_created_by_idx").using("btree", table.created_by.asc().nullsLast()),
	index("fields_is_active_idx").using("btree", table.is_active.asc().nullsLast()),
	index("fields_level_id_idx").using("btree", table.level_id.asc().nullsLast()),
	foreignKey({
			columns: [table.created_by],
			foreignColumns: [users.id],
			name: "fields_created_by_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.level_id],
			foreignColumns: [levels.id],
			name: "fields_level_id_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const groups = pgTable("groups", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	name: text().notNull(),
	capacity: integer(),
	schedule_notes: text("schedule_notes"),
	created_at: timestamp("created_at", { precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	is_active: boolean("is_active").default(true).notNull(),
	prof_id: uuid("prof_id").notNull(),
	color: text(),
}, (table) => [
	index("groups_prof_id_idx").using("btree", table.prof_id.asc().nullsLast()),
	foreignKey({
			columns: [table.prof_id],
			foreignColumns: [professors.id],
			name: "groups_prof_id_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const students = pgTable("students", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	group_id: uuid("group_id").notNull(),
	first_name: text("first_name").notNull(),
	last_name: text("last_name").notNull(),
	phone: text().notNull(),
	parent_phone: text("parent_phone"),
	email: text(),
	enrollment_date: timestamp("enrollment_date", { precision: 3, mode: 'date' }).notNull(),
	monthly_fee: numeric("monthly_fee", { precision: 10, scale:  2 }).notNull(),
	status: studentStatus().default('active').notNull(),
	created_at: timestamp("created_at", { precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	color: text(),
}, (table) => [
	index("students_group_id_idx").using("btree", table.group_id.asc().nullsLast()),
	index("students_last_name_first_name_idx").using("btree", table.last_name.asc().nullsLast(), table.first_name.asc().nullsLast()),
	index("students_status_idx").using("btree", table.status.asc().nullsLast()),
	foreignKey({
			columns: [table.group_id],
			foreignColumns: [groups.id],
			name: "students_group_id_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const users = pgTable("users", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	full_name: text("full_name").notNull(),
	email: text().notNull(),
	password_hash: text("password_hash").notNull(),
	role: userRole().default('super_admin').notNull(),
	is_active: boolean("is_active").default(true).notNull(),
	created_at: timestamp("created_at", { precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updated_at: timestamp("updated_at", { precision: 3, mode: 'date' }).defaultNow().notNull().$onUpdate(() => new Date()),
	reset_token: text("reset_token"),
	reset_token_expires: timestamp("reset_token_expires", { precision: 3, mode: 'date' }),
}, (table) => [
	uniqueIndex("users_email_key").using("btree", table.email.asc().nullsLast()),
]);

export const levels = pgTable("levels", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	name: text().notNull(),
	created_at: timestamp("created_at", { precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	is_active: boolean("is_active").default(true).notNull(),
	color: text(),
});

export const auditLogs = pgTable("audit_logs", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	actor_user_id: uuid("actor_user_id"),
	action: text().notNull(),
	entity_type: text("entity_type").notNull(),
	entity_id: uuid("entity_id"),
	meta: jsonb(),
	created_at: timestamp("created_at", { precision: 6, withTimezone: true, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	actor_label: text("actor_label"),
	actor_role: text("actor_role"),
	entity_label: text("entity_label"),
	prev_values: jsonb("prev_values"),
	new_values: jsonb("new_values"),
	ip_address: text("ip_address"),
	user_agent: text("user_agent"),
}, (table) => [
	index("audit_logs_action_created_at_idx").using("btree", table.action.asc().nullsLast(), table.created_at.asc().nullsLast()),
	index("audit_logs_action_idx").using("btree", table.action.asc().nullsLast()),
	index("audit_logs_actor_user_id_idx").using("btree", table.actor_user_id.asc().nullsLast()),
	index("audit_logs_created_at_idx").using("btree", table.created_at.asc().nullsLast()),
	index("audit_logs_entity_type_entity_id_idx").using("btree", table.entity_type.asc().nullsLast(), table.entity_id.asc().nullsLast()),
	foreignKey({
			columns: [table.actor_user_id],
			foreignColumns: [users.id],
			name: "audit_logs_actor_user_id_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const hierarchyConfigurations = pgTable("hierarchy_configurations", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	name: text().notNull(),
	entity_order: jsonb("entityOrder").notNull(),
	is_default: boolean("isDefault").default(false).notNull(),
	is_active: boolean("isActive").default(false).notNull(),
	created_at: timestamp("createdAt", { precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updated_at: timestamp("updatedAt", { precision: 3, mode: 'date' }).notNull(),
});

export const receiptCounters = pgTable("receipt_counters", {
	scope: text().primaryKey().notNull(),
	value: integer().default(0).notNull(),
	updated_at: timestamp("updated_at", { precision: 3, mode: 'date' }).defaultNow().notNull().$onUpdate(() => new Date()),
});

export const professorCompensations = pgTable("professor_compensations", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	prof_id: uuid("prof_id").notNull(),
	model: compensationModel().default('percentage').notNull(),
	percentage: numeric({ precision: 5, scale:  2 }),
	fixed_amount: numeric("fixed_amount", { precision: 10, scale:  2 }),
	custom_formula: text("custom_formula"),
	effective_from: timestamp("effective_from", { precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	notes: text(),
	created_at: timestamp("created_at", { precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updated_at: timestamp("updated_at", { precision: 3, mode: 'date' }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
	uniqueIndex("professor_compensations_prof_id_key").using("btree", table.prof_id.asc().nullsLast()),
	foreignKey({
			columns: [table.prof_id],
			foreignColumns: [professors.id],
			name: "professor_compensations_prof_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	check("professor_compensations_percentage_check", sql`(percentage IS NULL) OR ((percentage >= (0)::numeric) AND (percentage <= (100)::numeric))`),
]);

export const paymentTransactions = pgTable("payment_transactions", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	payment_id: uuid("payment_id").notNull(),
	type: transactionType().default('payment').notNull(),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	method: payment_method().default('cash').notNull(),
	receipt_number: text("receipt_number"),
	paid_at: timestamp("paid_at", { precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	recorded_by: uuid("recorded_by"),
	notes: text(),
	reason: text(),
	professor_share: numeric("professor_share", { precision: 10, scale:  2 }).notNull(),
	school_share: numeric("school_share", { precision: 10, scale:  2 }).notNull(),
	compensationModel: compensationModel("compensation_model").notNull(),
	compensation_snapshot: jsonb("compensation_snapshot"),
	prof_id: uuid("prof_id"),
	period: text().notNull(),
	created_at: timestamp("created_at", { precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("payment_transactions_paid_at_idx").using("btree", table.paid_at.asc().nullsLast()),
	index("payment_transactions_payment_id_idx").using("btree", table.payment_id.asc().nullsLast()),
	index("payment_transactions_period_idx").using("btree", table.period.asc().nullsLast()),
	index("payment_transactions_prof_id_idx").using("btree", table.prof_id.asc().nullsLast()),
	index("payment_transactions_prof_id_period_idx").using("btree", table.prof_id.asc().nullsLast(), table.period.asc().nullsLast()),
	uniqueIndex("payment_transactions_receipt_number_key").using("btree", table.receipt_number.asc().nullsLast()),
	index("payment_transactions_type_idx").using("btree", table.type.asc().nullsLast()),
	foreignKey({
			columns: [table.payment_id],
			foreignColumns: [studentPayments.id],
			name: "payment_transactions_payment_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.recorded_by],
			foreignColumns: [users.id],
			name: "payment_transactions_recorded_by_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.prof_id],
			foreignColumns: [professors.id],
			name: "payment_transactions_prof_id_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	check("payment_transactions_amount_check", sql`amount <> (0)::numeric`),
	check("payment_transactions_split_check", sql`(professor_share + school_share) = amount`),
]);

export const payrollPayments = pgTable("payroll_payments", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	prof_id: uuid("prof_id").notNull(),
	period: text(),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	method: payment_method().default('cash').notNull(),
	receipt_number: text("receipt_number"),
	paid_at: timestamp("paid_at", { precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	notes: text(),
	recorded_by: uuid("recorded_by"),
	created_at: timestamp("created_at", { precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updated_at: timestamp("updated_at", { precision: 3, mode: 'date' }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
	index("payroll_payments_paid_at_idx").using("btree", table.paid_at.asc().nullsLast()),
	index("payroll_payments_period_idx").using("btree", table.period.asc().nullsLast()),
	index("payroll_payments_prof_id_idx").using("btree", table.prof_id.asc().nullsLast()),
	index("payroll_payments_prof_id_period_idx").using("btree", table.prof_id.asc().nullsLast(), table.period.asc().nullsLast()),
	uniqueIndex("payroll_payments_receipt_number_key").using("btree", table.receipt_number.asc().nullsLast()),
	foreignKey({
			columns: [table.prof_id],
			foreignColumns: [professors.id],
			name: "payroll_payments_prof_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.recorded_by],
			foreignColumns: [users.id],
			name: "payroll_payments_recorded_by_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	check("payroll_payments_amount_check", sql`amount > (0)::numeric`),
]);

export const studentAssignments = pgTable("student_assignments", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	student_id: uuid("student_id").notNull(),
	group_id: uuid("group_id").notNull(),
	created_at: timestamp("created_at", { precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	fee: numeric({ precision: 10, scale:  2 }).default('0').notNull(),
}, (table) => [
	index("student_assignments_group_id_idx").using("btree", table.group_id.asc().nullsLast()),
	uniqueIndex("student_assignments_student_id_group_id_key").using("btree", table.student_id.asc().nullsLast(), table.group_id.asc().nullsLast()),
	foreignKey({
			columns: [table.student_id],
			foreignColumns: [students.id],
			name: "student_assignments_student_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.group_id],
			foreignColumns: [groups.id],
			name: "student_assignments_group_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
]);

export const payrollDocuments = pgTable("payroll_documents", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	payout_id: uuid("payout_id").notNull(),
	type: payrollDocumentType().notNull(),
	document_no: text("document_no").notNull(),
	title: text().notNull(),
	period: text(),
	generated_by: uuid("generated_by"),
	generated_at: timestamp("generated_at", { precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	data: jsonb().notNull(),
}, (table) => [
	index("payroll_documents_payout_id_idx").using("btree", table.payout_id.asc().nullsLast()),
	index("payroll_documents_period_idx").using("btree", table.period.asc().nullsLast()),
	foreignKey({
			columns: [table.payout_id],
			foreignColumns: [payrollPayments.id],
			name: "payroll_documents_payout_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.generated_by],
			foreignColumns: [users.id],
			name: "payroll_documents_generated_by_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const financialSettings = pgTable("financial_settings", {
	singleton: text().default('global').primaryKey().notNull(),
	currency: text().default('TND').notNull(),
	currency_locale: text("currency_locale").default('fr-TN').notNull(),
	default_compensation_model: compensationModel("default_compensation_model").default('percentage').notNull(),
	default_professor_percentage: numeric("default_professor_percentage", { precision: 5, scale:  2 }).default('60').notNull(),
	default_fixed_amount: numeric("default_fixed_amount", { precision: 10, scale:  2 }),
	receipt_number_format: text("receipt_number_format").default('REC-{YYYY}-{SEQ}').notNull(),
	payroll_receipt_format: text("payroll_receipt_format").default('PAY-{YYYY}-{SEQ}').notNull(),
	due_soon_days: integer("due_soon_days").default(2).notNull(),
	late_grace_days: integer("late_grace_days").default(0).notNull(),
	late_fee_enabled: boolean("late_fee_enabled").default(false).notNull(),
	late_fee_amount: numeric("late_fee_amount", { precision: 10, scale:  2 }),
	academic_year_start_month: integer("academic_year_start_month").default(9).notNull(),
	created_at: timestamp("created_at", { precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updated_at: timestamp("updated_at", { precision: 3, mode: 'date' }).defaultNow().notNull().$onUpdate(() => new Date()),
	academy_name: text("academy_name").default('IQ Academy').notNull(),
	academy_address: text("academy_address").default('').notNull(),
	academy_phone: text("academy_phone").default('').notNull(),
	settlement_receipt_format: text("settlement_receipt_format").default('SET-{YYYY}-{SEQ}').notNull(),
	logo_path: text("logo_path"),
}, () => [
	check("financial_settings_singleton_check", sql`singleton = 'global'::text`),
	check("financial_settings_percentage_check", sql`(default_professor_percentage >= (0)::numeric) AND (default_professor_percentage <= (100)::numeric)`),
	check("financial_settings_academic_month_check", sql`(academic_year_start_month >= 1) AND (academic_year_start_month <= 12)`),
]);

export const attendanceSheets = pgTable("attendance_sheets", {
	id: uuid().primaryKey().notNull().defaultRandom(),
	group_id: uuid("group_id").notNull(),
	month: integer().notNull(),
	year: integer().notNull(),
	schedule: text(),
	teacher_id: uuid("teacher_id"),
	teacher_name: text("teacher_name").notNull(),
	level_name: text("level_name").notNull(),
	group_name: text("group_name").notNull(),
	students: jsonb().notNull(),
	generated_by: uuid("generated_by"),
	generated_at: timestamp("generated_at", { precision: 6, withTimezone: true, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	field_name: text("field_name"),
	academic_year: text("academic_year"),
	sessions: jsonb(),
}, (table) => [
	index("attendance_sheets_generated_at_idx").using("btree", table.generated_at.asc().nullsLast()),
	index("attendance_sheets_group_id_idx").using("btree", table.group_id.asc().nullsLast()),
	foreignKey({
			columns: [table.group_id],
			foreignColumns: [groups.id],
			name: "attendance_sheets_group_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
]);

export const systemSettings = pgTable("system_settings", {
	singleton: text().default('global').primaryKey().notNull(),
	system_name: text("system_name").default('IQ Academy').notNull(),
	features: jsonb().default({}).notNull(),
	created_at: timestamp("created_at", { precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updated_at: timestamp("updated_at", { precision: 3, mode: 'date' }).defaultNow().notNull().$onUpdate(() => new Date()),
	support_email: text("support_email"),
	support_phone: text("support_phone"),
	support_whatsapp: text("support_whatsapp"),
}, () => [
	check("system_settings_singleton_check", sql`singleton = 'global'::text`),
]);

import { relations } from "drizzle-orm/relations";
import { students, studentPayments, users, groups, fields, professors, levels, auditLogs, professorCompensations, paymentTransactions, payrollPayments, studentAssignments, payrollDocuments, attendanceSheets } from "./schema";

export const studentPaymentsRelations = relations(studentPayments, ({one, many}) => ({
	student: one(students, {
		fields: [studentPayments.student_id],
		references: [students.id]
	}),
	user: one(users, {
		fields: [studentPayments.recorded_by],
		references: [users.id]
	}),
	group: one(groups, {
		fields: [studentPayments.group_id],
		references: [groups.id]
	}),
	paymentTransactions: many(paymentTransactions),
}));

export const studentsRelations = relations(students, ({one, many}) => ({
	studentPayments: many(studentPayments),
	group: one(groups, {
		fields: [students.group_id],
		references: [groups.id]
	}),
	assignments: many(studentAssignments),
}));

export const usersRelations = relations(users, ({many}) => ({
	studentPayments: many(studentPayments),
	professors: many(professors),
	fields: many(fields),
	auditLogs: many(auditLogs),
	paymentTransactions: many(paymentTransactions),
	payrollPayments: many(payrollPayments),
	payrollDocuments: many(payrollDocuments),
}));

export const groupsRelations = relations(groups, ({one, many}) => ({
	studentPayments: many(studentPayments),
	professor: one(professors, {
		fields: [groups.prof_id],
		references: [professors.id]
	}),
	students: many(students),
	assignments: many(studentAssignments),
	attendanceSheets: many(attendanceSheets),
}));

export const professorsRelations = relations(professors, ({one, many}) => ({
	field: one(fields, {
		fields: [professors.field_id],
		references: [fields.id]
	}),
	user: one(users, {
		fields: [professors.user_id],
		references: [users.id]
	}),
	groups: many(groups),
	professorCompensations: many(professorCompensations),
	paymentTransactions: many(paymentTransactions),
	payrollPayments: many(payrollPayments),
}));

export const fieldsRelations = relations(fields, ({one, many}) => ({
	professors: many(professors),
	user: one(users, {
		fields: [fields.created_by],
		references: [users.id]
	}),
	level: one(levels, {
		fields: [fields.level_id],
		references: [levels.id]
	}),
}));

export const levelsRelations = relations(levels, ({many}) => ({
	fields: many(fields),
}));

export const auditLogsRelations = relations(auditLogs, ({one}) => ({
	user: one(users, {
		fields: [auditLogs.actor_user_id],
		references: [users.id]
	}),
}));

export const professorCompensationsRelations = relations(professorCompensations, ({one}) => ({
	professor: one(professors, {
		fields: [professorCompensations.prof_id],
		references: [professors.id]
	}),
}));

export const paymentTransactionsRelations = relations(paymentTransactions, ({one}) => ({
	studentPayment: one(studentPayments, {
		fields: [paymentTransactions.payment_id],
		references: [studentPayments.id]
	}),
	user: one(users, {
		fields: [paymentTransactions.recorded_by],
		references: [users.id]
	}),
	professor: one(professors, {
		fields: [paymentTransactions.prof_id],
		references: [professors.id]
	}),
}));

export const payrollPaymentsRelations = relations(payrollPayments, ({one, many}) => ({
	professor: one(professors, {
		fields: [payrollPayments.prof_id],
		references: [professors.id]
	}),
	user: one(users, {
		fields: [payrollPayments.recorded_by],
		references: [users.id]
	}),
	payrollDocuments: many(payrollDocuments),
}));

export const studentAssignmentsRelations = relations(studentAssignments, ({one}) => ({
	student: one(students, {
		fields: [studentAssignments.student_id],
		references: [students.id]
	}),
	group: one(groups, {
		fields: [studentAssignments.group_id],
		references: [groups.id]
	}),
}));

export const payrollDocumentsRelations = relations(payrollDocuments, ({one}) => ({
	payrollPayment: one(payrollPayments, {
		fields: [payrollDocuments.payout_id],
		references: [payrollPayments.id]
	}),
	user: one(users, {
		fields: [payrollDocuments.generated_by],
		references: [users.id]
	}),
}));

export const attendanceSheetsRelations = relations(attendanceSheets, ({one}) => ({
	group: one(groups, {
		fields: [attendanceSheets.group_id],
		references: [groups.id]
	}),
}));
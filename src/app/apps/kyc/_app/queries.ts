import { db } from "@/platform/db";
import { mask } from "@/platform/pii";
import { HIGH_RISK_SCORE } from "./manifest";

export const STATUSES = ["pending", "in_review", "escalated", "approved", "rejected"] as const;
export type KycStatus = (typeof STATUSES)[number];
export type Risk = "low" | "medium" | "high";

/** What pages get. PII is masked here, at the data-access layer; raw values only via the audited reveal action. */
export type KycCase = {
  id: number; customerName: string; emailMasked: string; ssnMasked: string; dobMasked: string;
  country: string; riskScore: number; risk: Risk; flags: string[]; status: KycStatus;
  assignedTo: string | null; submittedAt: string; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null;
};

type Row = {
  id: number; customer_name: string; email: string; ssn: string; dob: string; country: string; risk_score: number;
  flags: string; status: KycStatus; assigned_to: string | null; submitted_at: string;
  decided_by: string | null; decided_at: string | null; decision_note: string | null;
};

export const riskOf = (score: number): Risk => (score >= HIGH_RISK_SCORE ? "high" : score >= 40 ? "medium" : "low");

const toCase = (r: Row): KycCase => ({
  id: r.id, customerName: r.customer_name, emailMasked: mask(r.email, "email"), ssnMasked: mask(r.ssn, "ssn"),
  dobMasked: mask(r.dob, "dob"), country: r.country, riskScore: r.risk_score, risk: riskOf(r.risk_score),
  flags: r.flags ? r.flags.split(";").map((f) => f.trim()) : [], status: r.status, assignedTo: r.assigned_to,
  submittedAt: r.submitted_at, decidedBy: r.decided_by, decidedAt: r.decided_at, decisionNote: r.decision_note,
});

export function listCases(status?: KycStatus): KycCase[] {
  const rows = status
    ? db().prepare("SELECT * FROM kyc_cases WHERE status = ? ORDER BY risk_score DESC, submitted_at").all(status)
    : db().prepare("SELECT * FROM kyc_cases ORDER BY submitted_at DESC").all();
  return (rows as Row[]).map(toCase);
}

export function getCase(id: number): KycCase | null {
  const row = db().prepare("SELECT * FROM kyc_cases WHERE id = ?").get(id) as Row | undefined;
  return row ? toCase(row) : null;
}

export function countByStatus(): Record<KycStatus, number> {
  const rows = db().prepare("SELECT status, COUNT(*) AS n FROM kyc_cases GROUP BY status").all() as { status: KycStatus; n: number }[];
  return Object.fromEntries(STATUSES.map((s) => [s, rows.find((r) => r.status === s)?.n ?? 0])) as Record<KycStatus, number>;
}

/** Raw row for use inside actions only. Never return this to a page. */
export function getCaseRow(id: number): Row | undefined {
  return db().prepare("SELECT * FROM kyc_cases WHERE id = ?").get(id) as Row | undefined;
}

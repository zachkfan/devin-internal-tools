import { defineApp } from "@/platform/app";

export const HIGH_RISK_SCORE = 70;

export const manifest = defineApp({
  id: "kyc",
  name: "KYC Review Queue",
  description:
    "Work the identity-verification queue: claim a case, review masked PII (reveal is audited), then approve, reject or escalate. Approving a high-risk case needs a second Ops Manager.",
  readPermission: "kyc:read",
  permissions: {
    "kyc:read": { description: "View the queue and cases (PII masked)", roles: ["kyc_analyst", "ops_manager", "compliance"] },
    "kyc:decide": { description: "Claim cases; approve, reject or escalate", roles: ["kyc_analyst", "ops_manager"] },
    "kyc:approve_high_risk": { description: "Second approver for high-risk approvals", roles: ["ops_manager"] },
    "kyc:reveal_pii": { description: "Unmask SSN / DOB / email (audited)", roles: ["kyc_analyst", "ops_manager", "compliance"] },
  },
  schema: `
    CREATE TABLE IF NOT EXISTS kyc_cases (
      id INTEGER PRIMARY KEY,
      customer_name TEXT NOT NULL,
      email TEXT NOT NULL,
      ssn TEXT NOT NULL,
      dob TEXT NOT NULL,
      country TEXT NOT NULL,
      risk_score INTEGER NOT NULL,
      flags TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_review','approved','rejected','escalated')),
      assigned_to TEXT REFERENCES users(id),
      submitted_at TEXT NOT NULL,
      decided_by TEXT REFERENCES users(id),
      decided_at TEXT,
      decision_note TEXT
    );`,
  seed(conn) {
    // Synthetic data only. SSNs use the 900-series, which the SSA never issues.
    const cases: [string, string, string, number, string, string][] = [
      ["Maya Thompson", "US", "1991-04-12", 22, "", "pending"],
      ["Liam O'Connor", "IE", "1985-11-03", 48, "Address mismatch", "pending"],
      ["Chen Wei", "SG", "1978-02-27", 81, "PEP match (possible)", "pending"],
      ["Fatima Al-Sayed", "AE", "1993-07-19", 74, "High-risk jurisdiction; ID expiring", "pending"],
      ["Diego Fernández", "MX", "1988-09-30", 35, "", "in_review"],
      ["Grace Kim", "US", "2001-01-15", 12, "", "pending"],
      ["Oluwaseun Adeyemi", "NG", "1990-05-08", 66, "Selfie match 71%", "pending"],
      ["Sofia Rossi", "IT", "1983-12-21", 29, "", "approved"],
      ["Noah Becker", "DE", "1975-03-04", 91, "Sanctions list fuzzy match", "escalated"],
      ["Aisha Khan", "GB", "1996-08-11", 41, "Document glare", "pending"],
      ["Lucas Martin", "FR", "1999-10-02", 57, "Velocity: 3 accounts same device", "pending"],
      ["Emily Davis", "US", "1987-06-25", 18, "", "rejected"],
    ];
    const insert = conn.prepare(
      `INSERT INTO kyc_cases (customer_name, email, ssn, dob, country, risk_score, flags, status, assigned_to, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    cases.forEach(([name, country, dob, score, flags, status], i) => {
      const email = `${name.split(" ")[0].toLowerCase().replace(/[^a-z]/g, "")}${i}@mail.example`;
      const ssn = `9${String(10 + i).padStart(2, "0")}-${String(40 + i)}-${String(1000 + i * 137).slice(-4)}`;
      const submitted = new Date(Date.now() - (i + 1) * 5.5 * 3600_000).toISOString();
      insert.run(name, email, ssn, dob, country, score, flags, status, status === "in_review" ? "ana" : null, submitted);
    });
  },
});

// Platform-wide roles. In production these map 1:1 to Entra ID (Azure AD) groups.
// Adding a role is a platform change: apps may only grant permissions to roles listed here.
export const ROLES = {
  kyc_analyst: "KYC Analyst",
  ops_manager: "Ops Manager",
  support_agent: "Support Agent",
  engineer: "Engineer",
  eng_lead: "Engineering Lead",
  compliance: "Compliance Officer",
} as const;

export type Role = keyof typeof ROLES;

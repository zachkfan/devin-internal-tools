export type PiiKind = "ssn" | "email" | "dob" | "phone" | "account" | "card";

const DOT = "\u2022";

/** Masks PII for display. Query modules return masked values; raw values are only available via an audited reveal action. */
export function mask(value: string | null | undefined, kind: PiiKind): string {
  if (!value) return "";
  const last4 = value.replace(/\D/g, "").slice(-4);
  switch (kind) {
    case "ssn":
      return `${DOT.repeat(3)}-${DOT.repeat(2)}-${last4}`;
    case "email": {
      const [user, domain] = value.split("@");
      return `${user.slice(0, 1)}${DOT.repeat(3)}@${domain ?? ""}`;
    }
    case "dob":
      return `${DOT.repeat(4)}-${DOT.repeat(2)}-${DOT.repeat(2)}`;
    case "phone":
    case "account":
    case "card":
      return `${DOT.repeat(4)} ${last4}`;
  }
}

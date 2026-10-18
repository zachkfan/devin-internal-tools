# Spec: Refunds Dashboard (`refunds`)

Replaces the existing Power Apps "Refunds dashboard".

**Who:** Support agents issue refunds to customers against card transactions. Ops managers oversee them and approve large ones. Compliance has read-only access.

**What it does**
- Dashboard with headline stats: amount refunded in the last 7 days, number of refunds, refunds waiting for approval, and refund rate (refunded / captured volume).
- Searchable list of recent customer card transactions (customer name, masked card last 4, merchant descriptor, amount, date, amount already refunded, remaining refundable). Seed about 15 synthetic transactions between $12 and $4,800.
- Transaction detail page: transaction info, refunds issued against it so far, any pending approval, the audit trail, and an "Issue refund" form (amount, reason code: `duplicate`, `fraud`, `product_not_received`, `goodwill`, `other`, plus the platform's free-text reason).
- Refund history tab: every refund, with status and who issued or approved it.

**Rules**
- A refund can be partial or full, but total refunds for a transaction can never exceed the captured amount. This must also hold when an approved request executes later.
- Refunds **over $500** need a second person with `refunds:approve_large` (ops managers). At or under $500 they execute immediately.
- Card numbers are PII: only ever show the last 4 digits. There's no reveal action for full card numbers.
- Permissions: `refunds:read` (support_agent, ops_manager, compliance), `refunds:issue` (support_agent, ops_manager), `refunds:approve_large` (ops_manager).

**Out of scope:** calling a real payment processor. Issuing a refund just records it with status `issued`.

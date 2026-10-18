# Spec: Chargeback Disputes (`chargebacks`)

A new tool, not yet in Power Apps. The spec is deliberately one paragraph, written the way an ops lead would request it.

Card-network chargebacks land in a queue, and each has a respond-by deadline. Support agents and ops managers work the queue sorted by deadline: show days left, in red when fewer than 3 remain. They add a written evidence note, then either accept the chargeback (we refund the customer) or contest it. Contesting a dispute over $1,000 needs an ops manager's approval. Compliance can view everything read-only. Seed around 10 realistic disputes with reason codes (fraud, product not received, duplicate, etc.).

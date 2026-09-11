# Consultation inbox

This Worker receives the public booking form and sends each request with Resend.

Set these Worker secrets before deployment:

- `RESEND_API_KEY`
- `TO_EMAIL` — Ammar's receiving inbox
- `FROM_EMAIL` — a sender address from a Resend-verified domain

After deployment, set `window.CONTACT_ENDPOINT` in `aiprompts/index.html` to the Worker URL.

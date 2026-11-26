[Meld home page](https://meld-finance.github.io/meld/) · [Docs](https://meld-finance.github.io/meld/docs/) · [Features](../features.md)

# Insurance

Track life and disability coverage (including through work), upload policy PDFs for AI fill-in, and count permanent-life cash value toward net worth.

## Where to find it

- **Plan → Insurance** — add policies, totals, PDF upload
- Permanent-life cash value also appears under **Insurance cash value** on the Accounts tab

## Policies

Add life and disability policies under **Plan → Insurance**, including coverage through work. It totals your life coverage, monthly disability benefit and yearly premiums. Term policies past their end date aren't counted.

Whole and universal life policies count toward net worth at their surrender value, and are listed under **Insurance cash value** on the Accounts tab, which links back to each policy.

## Upload PDF (AI fill-in)

**Upload PDF** on the Add policy page sends a policy, certificate or benefits summary to the AI provider (Claude, or Gemini through OpenRouter), which fills in the form and flags anything it inferred or couldn't find. Nothing is saved until you check the fields and press **Save**. Needs an Anthropic or OpenRouter key; without it the page explains how to turn it on and you fill in the form by hand.

## Attach PDF (local only)

**Attach PDF** keeps a copy of the policy document with any policy, new or existing, with no AI involved: nothing is sent anywhere. **Replace PDF** and **Remove** take effect when you save, and the old file is deleted.

Uploaded PDFs are encrypted with `ENCRYPTION_KEY` and stored in `data/documents/` (gitignored; change with `DOCUMENTS_DIR`). PDFs saved before encryption was added are encrypted the next time the API starts. A PDF is deleted with its policy, when you cancel the draft, or after a day if it was never saved.

A policy's full number is optional and stored encrypted with `ENCRYPTION_KEY`. It's printed in the family packet, and everywhere else the app only shows the last 4. PDF extraction only ever reads the last 4.

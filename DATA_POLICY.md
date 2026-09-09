# OneConv trace contribution

Product and engineering draft, 2026-09-09. This defines the first implementation
baseline; it is not published Terms of Service or a deployed privacy guarantee.

## Business model

OneConv provides paid conversation retrieval and can monetize separately
authorized interaction traces through its own model training and licensing to
third-party model developers. Human reading is not a product requirement.

The first version uses optional contribution alongside a limited free plan and
a paid private plan. Free status alone grants no training or licensing rights.
Paid accounts are excluded from both purposes. A future contribution-for-credit
offer requires its own pricing and consent review before activation.

## User experience

Onboarding remains: create OneConv account, connect AI accounts, copy the MCP
URL, authorize the assistant. Contribution is a separate optional step and can
be skipped without blocking these steps.

Before contributing, the user selects exact conversations and sees two separate,
unchecked choices with the applicable notice:

- **Help train OneConv models:** “Allow OneConv to use these selected
  conversations to train and evaluate its AI models.”
- **License data to model developers:** “Allow OneConv to sell or license these
  selected conversations to the organizations listed here for model training
  and evaluation.” The recipient list is mandatory, not placeholder text.

Use plain disclosure alongside the controls, backed by the privacy notice and
contribution terms. Do not describe resale as merely “improving your experience.”
Do not claim anonymity after stripping names or say paid content is technically
inaccessible to the operator.

The paid-plan promise is: “We do not use your conversations to train models or
sell or license them for training. We process them to provide OneConv.”
Operational access and support practices must be described separately.

Settings show selected contributions, purpose, recipient, permission date,
delivered dataset references, and a withdrawal control. Keep consent receipts
without logging transcript content. Changes of recipient or purpose require a
new affirmative choice; a blanket Terms update cannot expand a grant.

## Reuse boundary

The private history index serves the authenticated user's MCP requests. It is
not an exportable training dataset. A separate pipeline obtains a current
eligibility decision before processing a contribution and again immediately
before training consumption or third-party delivery.

The service must supply trusted tenant, plan, account and screening metadata;
none of these facts may come from an MCP caller or an unchecked web request.
The preliminary decision function is in `one_conv/contributions.py`.

Eligibility requires all of:

- A free personal account; work accounts and unknown account types are excluded.
- Current explicit permission matching tenant, source account, trace ID, exact
  content revision, purpose, notice version and recipient.
- A separately established basis to reuse the content, including relevant
  provider terms, third-party rights and any employer restrictions. A user's
  selection alone is not a rights-clearance finding.
- Completed automated screening for secrets, sensitive information and
  third-party content. Uncertain cases are excluded, not queued for routine
  human reading. Screening is risk reduction, not proof of anonymization.
- No deletion, withdrawal, paid-plan exclusion or stale permission.

Persist append-only grant/revocation records. A materialized current grant feeds
the decision function. Eligibility is not a durable export permission: workers
must recheck the authoritative records at the final consumption boundary.
Use a generation check and serialized dispatch to prevent withdrawals racing
queued exports. A downgrade never reactivates permissions revoked on upgrade.

Upgrade, withdrawal or deletion invalidates queued reuse and unconsumed dataset
copies. Previously delivered datasets require tracked recipient deletion and
cessation workflows. Do not promise that a billing change reverses completed
model training; explain historical use and applicable rights accurately.

Every delivered dataset manifest records contribution receipts, source revision
hashes, processing version, recipient, purpose, timestamps and downstream usage
restrictions. Buyers receive eligible prepared data, never provider sessions,
raw account archives or access to the private history index.

## Confidential processing

A TEE is an optional compute boundary for screening, dataset preparation and
training. Evaluate measured workloads, remote attestation and keys released
only to approved workloads. Include browser acquisition, storage, logs, crash
dumps, operator-controlled code updates and output delivery in the threat model.
A TEE in one worker does not protect plaintext elsewhere in the service.

Two distinct commercial modes are possible:

- Deliver a licensed dataset: the buyer receives content and controls its later
  processing. Our enclave does not enforce restrictions after that delivery.
- Sell access to training inside an attested environment: raw traces remain
  inside the boundary. Jobs and permitted outputs require controls, including
  model extraction and memorization risk; model weights are not automatically
  anonymous outputs.

Start with accurate promises and auditable permissions. No TEE or “operator
cannot read” claim is enabled until the deployed threat model is verified.

## Delivery status and acceptance

Implemented: pure eligibility decisions with rejection reasons and unit tests.
Hosted account creation has an AuthKit implementation awaiting live verification.
Not implemented: persisted consent, billing integration,
screening, training, buyer exports, withdrawal propagation or confidential compute.
No existing user's history becomes authorized through this document.

Before enabling reuse, test the complete hosted workflow: a user selects a
trace and one purpose; an eligible job succeeds; changing tenant, content,
recipient or purpose fails; upgrading or withdrawing before dispatch prevents
delivery; retries and concurrent jobs respect the same current generation.
Verify receipt history, deletion handling and no content in operational logs.

## References

- [CNIL: qualification of training data](https://www.cnil.fr/fr/intelligence-artificielle/guide/collecter-et-qualifier-les-donnees-dentrainement)
- [CNIL: lawful reuse](https://www.cnil.fr/fr/assurer-que-le-traitement-est-licite-reutilisation-des-donnees)
- [EDPB: consent guidance](https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines_202005_consent_en.pdf)
- [Microsoft: confidential computing](https://learn.microsoft.com/en-us/azure/confidential-computing/overview)
- [Microsoft: attestation](https://learn.microsoft.com/en-us/azure/attestation/overview)

# Compliance index

## Statutory forms (backend/forms.py)
- build_form25, build_form25b, build_form12, build_form15
- Related documents: build_wageslip, build_id_card, build_appointment_letter
- Plan: PHASE3_STATUTORY_FORMS_PLAN.md (grep headers, don't read in full)

## DPDP / consent / privacy
- Signup DPDP consent: `Owner.consent_given_at` (backend/models.py:58); test: verify_dpdp_consent.py
- Biometric consent: `BiometricConsent` model (backend/models.py:554)
- Privacy policy: backend/privacy_policy.py, served at `/privacy-policy` (backend/main.py:288)
- Deeper detail: ONBOARDING.md §3 (data model) and §4 (API reference)

## ISM definition
- `is_ism` (inter-state migrant) is independent of `employment_type`.
- "ISM contractor" = `employment_type == "temporary"` AND `is_ism`. Permanent + ISM is not a contractor.
- Labels/colours/grouping: mobile/src/employment.ts only.

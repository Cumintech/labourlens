# Testing index

## Commands
- Mobile types: `cd mobile && npx tsc --noEmit`
- All backend checks: `cd backend && python run_verify_suite.py`
- One check: `cd backend && python verify_<name>.py`
- No CI exists (no .github/); run these before every PR.

## verify_* coverage (backend/)
- Auth/accounts: verify_registration, verify_admin_auth, verify_admin_bootstrap, verify_admin_portal, verify_account_deletion, verify_trial_status, verify_dpdp_consent, verify_audit_log
- Workers: verify_worker_employment, verify_worker_type, verify_aadhaar_validation, verify_mobile_validation, verify_date_of_joining_validation, verify_joining_date_guard, verify_ocr_refinements, verify_worker_detail_device_mapping
- Attendance/shifts/leave: verify_attendance_dashboard, verify_shift_config, verify_leave_entry, verify_month_end_and_alerts
- Wages: verify_wage_payment, verify_wage_profile, verify_wage_profile_effective, verify_wage_summary
- Statutory forms/docs: verify_forms, verify_forms_range, verify_form12, verify_id_card, verify_appointment_letter, verify_reports, verify_tamil_rendering, verify_xml_escaping
- Biometric / portal sync: verify_biometric_sync, verify_sync_worker

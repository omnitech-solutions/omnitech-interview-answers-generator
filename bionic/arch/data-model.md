# Data model

_Derived from `packages/database/drizzle/20261007231047_action_progress/snapshot.json` (drizzle-kit snapshot; static read, no Drizzle executed)._

## Entities (67 tables)

| table | column | type | nullable | default | primary key | references |
|---|---|---|---|---|---|---|
| ai.agent_artifacts | `artifact_reference` | text | no | — | — | — |
| ai.agent_artifacts | `created_at` | timestamp with time zone | no | now() | — | — |
| ai.agent_artifacts | `id` | uuid | no | gen_random_uuid() | yes | — |
| ai.agent_artifacts | `job_id` | uuid | no | — | — | ai.agent_jobs.id |
| ai.agent_artifacts | `kind` | text | no | — | — | — |
| ai.agent_artifacts | `tenant_id` | uuid | no | — | — | ai.agent_jobs.tenant_id |
| ai.agent_job_events | `attempt_id` | text | yes | — | — | — |
| ai.agent_job_events | `created_at` | timestamp with time zone | no | now() | — | — |
| ai.agent_job_events | `event` | jsonb | no | — | — | — |
| ai.agent_job_events | `execution_id` | uuid | no | — | — | — |
| ai.agent_job_events | `job_id` | uuid | no | — | yes | ai.agent_jobs.id |
| ai.agent_job_events | `sequence` | integer | no | — | yes | — |
| ai.agent_job_events | `tenant_id` | uuid | no | — | — | ai.agent_jobs.tenant_id |
| ai.agent_job_payloads | `ciphertext` | jsonb | no | — | — | — |
| ai.agent_job_payloads | `created_at` | timestamp with time zone | no | now() | — | — |
| ai.agent_job_payloads | `expires_at` | timestamp with time zone | no | — | — | — |
| ai.agent_job_payloads | `reference` | text | no | — | yes | — |
| ai.agent_job_payloads | `tenant_id` | uuid | no | — | — | platform.tenants.id |
| ai.agent_jobs | `claimed_by` | text | yes | — | — | — |
| ai.agent_jobs | `created_at` | timestamp with time zone | no | now() | — | — |
| ai.agent_jobs | `execution_id` | uuid | no | gen_random_uuid() | — | — |
| ai.agent_jobs | `id` | uuid | no | gen_random_uuid() | yes | — |
| ai.agent_jobs | `lease_expires_at` | timestamp with time zone | yes | — | — | — |
| ai.agent_jobs | `next_event_sequence` | integer | no | 1 | — | — |
| ai.agent_jobs | `private` | boolean | no | false | — | — |
| ai.agent_jobs | `product_id` | text | no | — | — | — |
| ai.agent_jobs | `profile_snapshot` | jsonb | no | — | — | — |
| ai.agent_jobs | `prompt_reference` | text | no | — | — | — |
| ai.agent_jobs | `result_reference` | text | yes | — | — | — |
| ai.agent_jobs | `session_id` | text | yes | — | — | — |
| ai.agent_jobs | `status` | text | no | — | — | — |
| ai.agent_jobs | `tenant_id` | uuid | no | — | — | platform.tenants.id |
| ai.agent_jobs | `updated_at` | timestamp with time zone | no | now() | — | — |
| ai.agent_jobs | `user_id` | uuid | no | — | — | platform.users.id |
| ai.agent_sessions | `created_at` | timestamp with time zone | no | now() | — | — |
| ai.agent_sessions | `id` | uuid | no | gen_random_uuid() | yes | — |
| ai.agent_sessions | `profile_snapshot` | jsonb | no | — | — | — |
| ai.agent_sessions | `runtime` | text | no | — | — | — |
| ai.agent_sessions | `runtime_session_id` | text | no | — | — | — |
| ai.agent_sessions | `status` | text | no | — | — | — |
| ai.agent_sessions | `tenant_id` | uuid | no | — | — | platform.tenants.id |
| ai.agent_sessions | `updated_at` | timestamp with time zone | no | now() | — | — |
| ai.agent_sessions | `user_id` | uuid | no | — | — | platform.users.id |
| ai.model_definitions | `capabilities` | text[] | no | '{}' | — | — |
| ai.model_definitions | `created_at` | timestamp with time zone | no | now() | — | — |
| ai.model_definitions | `display_name` | text | no | — | — | — |
| ai.model_definitions | `enabled` | boolean | no | true | — | — |
| ai.model_definitions | `id` | text | no | — | yes | — |
| ai.model_definitions | `kind` | text | no | — | — | — |
| ai.model_definitions | `metadata` | jsonb | no | '{}' | — | — |
| ai.model_definitions | `provider_configuration_id` | text | no | — | — | ai.provider_configurations.id |
| ai.model_definitions | `provider_model_id` | text | no | — | — | — |
| ai.model_definitions | `updated_at` | timestamp with time zone | no | now() | — | — |
| ai.profiles | `configuration` | jsonb | no | — | — | — |
| ai.profiles | `created_at` | timestamp with time zone | no | now() | — | — |
| ai.profiles | `display_name` | text | no | — | — | — |
| ai.profiles | `enabled` | boolean | no | true | — | — |
| ai.profiles | `execution_family` | text | no | — | — | — |
| ai.profiles | `id` | text | no | — | yes | — |
| ai.profiles | `target_id` | text | no | — | — | — |
| ai.profiles | `updated_at` | timestamp with time zone | no | now() | — | — |
| ai.provider_configurations | `adapter_id` | text | no | — | — | — |
| ai.provider_configurations | `configuration` | jsonb | no | '{}' | — | — |
| ai.provider_configurations | `created_at` | timestamp with time zone | no | now() | — | — |
| ai.provider_configurations | `display_name` | text | no | — | — | — |
| ai.provider_configurations | `enabled` | boolean | no | true | — | — |
| ai.provider_configurations | `id` | text | no | — | yes | — |
| ai.provider_configurations | `secret_reference` | text | yes | — | — | — |
| ai.provider_configurations | `updated_at` | timestamp with time zone | no | now() | — | — |
| ai.tenant_policies | `created_at` | timestamp with time zone | no | now() | — | — |
| ai.tenant_policies | `enabled` | boolean | no | true | — | — |
| ai.tenant_policies | `profile_id` | text | no | — | yes | ai.profiles.id |
| ai.tenant_policies | `secret_reference` | text | yes | — | — | — |
| ai.tenant_policies | `tenant_id` | uuid | no | — | yes | platform.tenants.id |
| ai.tenant_policies | `updated_at` | timestamp with time zone | no | now() | — | — |
| ai.tenant_policies | `usage_limits` | jsonb | no | '{}' | — | — |
| ai.usage_records | `cost_usd` | numeric(14,6) | yes | — | — | — |
| ai.usage_records | `created_at` | timestamp with time zone | no | now() | — | — |
| ai.usage_records | `execution_family` | text | no | — | — | — |
| ai.usage_records | `failure_code` | text | yes | — | — | — |
| ai.usage_records | `id` | uuid | no | gen_random_uuid() | yes | — |
| ai.usage_records | `input_tokens` | integer | yes | — | — | — |
| ai.usage_records | `output_tokens` | integer | yes | — | — | — |
| ai.usage_records | `product_id` | text | no | — | — | — |
| ai.usage_records | `profile_id` | text | no | — | — | — |
| ai.usage_records | `tenant_id` | uuid | no | — | — | platform.tenants.id |
| ai.usage_records | `user_id` | uuid | no | — | — | platform.users.id |
| interview.active_sessions | `candidacy_id` | uuid | yes | — | — | interview.candidacies.id, interview.interviews.candidacy_id |
| interview.active_sessions | `capture_request` | jsonb | yes | — | — | — |
| interview.active_sessions | `created_at` | timestamp with time zone | no | now() | — | — |
| interview.active_sessions | `credential_expires_at` | timestamp with time zone | yes | — | — | — |
| interview.active_sessions | `credential_hash` | text | yes | — | — | — |
| interview.active_sessions | `credential_revoked_at` | timestamp with time zone | yes | — | — | — |
| interview.active_sessions | `ended_at` | timestamp with time zone | yes | — | — | — |
| interview.active_sessions | `expires_at` | timestamp with time zone | no | — | — | — |
| interview.active_sessions | `fence` | bigint | no | 0 | — | — |
| interview.active_sessions | `id` | uuid | no | gen_random_uuid() | yes | — |
| interview.active_sessions | `interview_id` | uuid | yes | — | — | interview.interviews.id |
| interview.active_sessions | `last_heartbeat_at` | timestamp with time zone | yes | — | — | — |
| interview.active_sessions | `lease_expires_at` | timestamp with time zone | yes | — | — | — |
| interview.active_sessions | `lease_holder_id` | text | yes | — | — | — |
| interview.active_sessions | `owner_user_id` | uuid | no | — | — | — |
| interview.active_sessions | `paused_at` | timestamp with time zone | yes | — | — | — |
| interview.active_sessions | `paused_ms` | bigint | no | 0 | — | — |
| interview.active_sessions | `processed_through` | bigint | yes | — | — | — |
| interview.active_sessions | `processing_policy` | text | no | — | — | — |
| interview.active_sessions | `profile_id` | text | yes | — | — | — |
| interview.active_sessions | `profile_revision` | bigint | yes | — | — | — |
| interview.active_sessions | `purge_counts` | jsonb | yes | — | — | — |
| interview.active_sessions | `purge_outcome` | text | yes | — | — | — |
| interview.active_sessions | `purge_started_at` | timestamp with time zone | yes | — | — | — |
| interview.active_sessions | `purged_at` | timestamp with time zone | yes | — | — | — |
| interview.active_sessions | `rehearsal_run_id` | text | yes | — | — | — |
| interview.active_sessions | `retention_mode` | text | no | 'delete_at_end' | — | — |
| interview.active_sessions | `screenshot_send` | text | no | 'always' | — | — |
| interview.active_sessions | `shown_draft_count` | integer | no | 0 | — | — |
| interview.active_sessions | `sources` | jsonb | yes | — | — | — |
| interview.active_sessions | `status` | text | no | 'created' | — | — |
| interview.active_sessions | `strict` | boolean | no | false | — | — |
| interview.active_sessions | `tenant_id` | uuid | no | — | — | interview.candidacies.tenant_id, interview.interviews.tenant_id, platform.tenants.id |
| interview.active_sessions | `workspace_draft_id` | text | yes | — | — | — |
| interview.assistant_answer_revisions | `actor_id` | text | no | — | yes | interview.assistant_drafts.actor_id |
| interview.assistant_answer_revisions | `artifact_id` | text | no | — | yes | interview.assistant_drafts.artifact_id |
| interview.assistant_answer_revisions | `created_at` | timestamp with time zone | no | now() | — | — |
| interview.assistant_answer_revisions | `draft_revision` | bigint | no | — | — | — |
| interview.assistant_answer_revisions | `product_id` | text | no | — | yes | interview.assistant_drafts.product_id |
| interview.assistant_answer_revisions | `provenance` | jsonb | yes | — | — | — |
| interview.assistant_answer_revisions | `saved_revision` | bigint | no | — | yes | — |
| interview.assistant_answer_revisions | `tenant_id` | text | no | — | yes | interview.assistant_drafts.tenant_id |
| interview.assistant_answer_revisions | `value` | jsonb | no | — | — | — |
| interview.assistant_answer_revisions | `workspace_id` | text | no | — | yes | interview.assistant_drafts.workspace_id |
| interview.assistant_drafts | `actor_id` | text | no | — | yes | — |
| interview.assistant_drafts | `artifact_id` | text | no | — | yes | — |
| interview.assistant_drafts | `product_id` | text | no | — | yes | — |
| interview.assistant_drafts | `provenance` | jsonb | yes | — | — | — |
| interview.assistant_drafts | `revision` | bigint | no | 0 | — | — |
| interview.assistant_drafts | `saved_revision` | bigint | no | 0 | — | — |
| interview.assistant_drafts | `tenant_id` | text | no | — | yes | — |
| interview.assistant_drafts | `updated_at` | timestamp with time zone | no | now() | — | — |
| interview.assistant_drafts | `value` | jsonb | no | — | — | — |
| interview.assistant_drafts | `workspace_id` | text | no | — | yes | — |
| interview.assistant_effect_receipts | `actor_id` | text | no | — | yes | — |
| interview.assistant_effect_receipts | `created_at` | timestamp with time zone | no | now() | — | — |
| interview.assistant_effect_receipts | `fingerprint` | text | no | — | — | — |
| interview.assistant_effect_receipts | `id` | text | no | — | — | — |
| interview.assistant_effect_receipts | `operation` | text | no | — | yes | — |
| interview.assistant_effect_receipts | `payload` | jsonb | no | — | — | — |
| interview.assistant_effect_receipts | `product_id` | text | no | — | yes | — |
| interview.assistant_effect_receipts | `request_id` | text | no | — | yes | — |
| interview.assistant_effect_receipts | `result` | jsonb | yes | — | — | — |
| interview.assistant_effect_receipts | `state` | text | no | — | — | — |
| interview.assistant_effect_receipts | `tenant_id` | text | no | — | yes | — |
| interview.assistant_effect_receipts | `updated_at` | timestamp with time zone | no | now() | — | — |
| interview.assistant_evidence | `actor_id` | text | no | — | yes | — |
| interview.assistant_evidence | `audience` | text[] | no | — | — | — |
| interview.assistant_evidence | `classification` | text | no | — | — | — |
| interview.assistant_evidence | `id` | text | no | — | yes | — |
| interview.assistant_evidence | `locator` | text | no | — | — | — |
| interview.assistant_evidence | `metrics` | jsonb | no | '[]' | — | — |
| interview.assistant_evidence | `product_id` | text | no | — | yes | — |
| interview.assistant_evidence | `revision` | bigint | no | — | yes | — |
| interview.assistant_evidence | `sha256` | text | no | — | — | — |
| interview.assistant_evidence | `source_kind` | text | no | — | — | — |
| interview.assistant_evidence | `tenant_id` | text | no | — | yes | — |
| interview.assistant_evidence | `text` | text | no | — | — | — |
| interview.assistant_reverts | `actor_id` | text | no | — | yes | interview.assistant_drafts.actor_id |
| interview.assistant_reverts | `applied_revision` | bigint | no | — | — | — |
| interview.assistant_reverts | `artifact_id` | text | no | — | — | interview.assistant_drafts.artifact_id |
| interview.assistant_reverts | `created_at` | timestamp with time zone | no | now() | — | — |
| interview.assistant_reverts | `previous_provenance` | jsonb | yes | — | — | — |
| interview.assistant_reverts | `previous_value` | jsonb | no | — | — | — |
| interview.assistant_reverts | `product_id` | text | no | — | yes | interview.assistant_drafts.product_id |
| interview.assistant_reverts | `proposal_id` | text | no | — | yes | — |
| interview.assistant_reverts | `reverted_revision` | bigint | yes | — | — | — |
| interview.assistant_reverts | `tenant_id` | text | no | — | yes | interview.assistant_drafts.tenant_id |
| interview.assistant_reverts | `workspace_id` | text | no | — | — | interview.assistant_drafts.workspace_id |
| interview.briefing_links | `briefing_id` | text | no | — | — | — |
| interview.briefing_links | `candidacy_id` | uuid | yes | — | — | interview.candidacies.id |
| interview.briefing_links | `created_at` | timestamp with time zone | no | now() | — | — |
| interview.briefing_links | `created_by` | uuid | yes | — | — | platform.users.id |
| interview.briefing_links | `id` | uuid | no | gen_random_uuid() | yes | — |
| interview.briefing_links | `interview_id` | uuid | yes | — | — | interview.interviews.id |
| interview.briefing_links | `tenant_id` | uuid | no | — | — | interview.candidacies.tenant_id, interview.interviews.tenant_id, platform.tenants.id |
| interview.briefing_links | `updated_at` | timestamp with time zone | no | now() | — | — |
| interview.briefing_proposals | `actor_id` | text | no | — | yes | — |
| interview.briefing_proposals | `artifact_id` | text | no | — | — | — |
| interview.briefing_proposals | `base_revision` | bigint | no | — | — | — |
| interview.briefing_proposals | `created_at` | timestamp with time zone | no | now() | — | — |
| interview.briefing_proposals | `id` | text | no | — | yes | — |
| interview.briefing_proposals | `product_id` | text | no | — | yes | — |
| interview.briefing_proposals | `profile_id` | text | no | — | — | — |
| interview.briefing_proposals | `profile_revision` | bigint | no | — | — | — |
| interview.briefing_proposals | `profile_sha256` | text | no | — | — | — |
| interview.briefing_proposals | `source_snapshot` | jsonb | no | — | — | — |
| interview.briefing_proposals | `tenant_id` | text | no | — | yes | — |
| interview.briefing_proposals | `value` | jsonb | no | — | — | — |
| interview.candidacies | `candidate_person_id` | uuid | no | — | — | interview.people.id |
| interview.candidacies | `closed_at` | timestamp with time zone | yes | — | — | — |
| interview.candidacies | `company_id` | uuid | no | — | — | interview.companies.id |
| interview.candidacies | `created_at` | timestamp with time zone | no | now() | — | — |
| interview.candidacies | `created_by` | uuid | yes | — | — | platform.users.id |
| interview.candidacies | `id` | uuid | no | gen_random_uuid() | yes | — |
| interview.candidacies | `job_description` | text | yes | — | — | — |
| interview.candidacies | `notes` | text | yes | — | — | — |
| interview.candidacies | `posting_url` | text | yes | — | — | — |
| interview.candidacies | `source` | interview.candidacy_source | yes | — | — | — |
| interview.candidacies | `status` | interview.candidacy_status | no | 'exploring' | — | — |
| interview.candidacies | `tenant_id` | uuid | no | — | — | interview.companies.tenant_id, interview.people.tenant_id, platform.tenants.id |
| interview.candidacies | `title` | text | no | — | — | — |
| interview.candidacies | `updated_at` | timestamp with time zone | no | now() | — | — |
| interview.candidate_profile_revisions | `actor_id` | text | no | — | yes | interview.candidate_profiles.actor_id |
| interview.candidate_profile_revisions | `created_at` | timestamp with time zone | no | now() | — | — |
| interview.candidate_profile_revisions | `id` | text | no | — | yes | interview.candidate_profiles.id |
| interview.candidate_profile_revisions | `matrix` | jsonb | no | — | — | — |
| interview.candidate_profile_revisions | `name` | text | no | — | — | — |
| interview.candidate_profile_revisions | `product_id` | text | no | — | yes | interview.candidate_profiles.product_id |
| interview.candidate_profile_revisions | `revision` | bigint | no | — | yes | — |
| interview.candidate_profile_revisions | `sha256` | text | no | — | — | — |
| interview.candidate_profile_revisions | `tenant_id` | text | no | — | yes | interview.candidate_profiles.tenant_id |
| interview.candidate_profiles | `actor_id` | text | no | — | yes | — |
| interview.candidate_profiles | `id` | text | no | — | yes | — |
| interview.candidate_profiles | `name` | text | no | — | — | — |
| interview.candidate_profiles | `product_id` | text | no | — | yes | — |
| interview.candidate_profiles | `revision` | bigint | no | — | — | — |
| interview.candidate_profiles | `revoked_at` | timestamp with time zone | yes | — | — | — |
| interview.candidate_profiles | `tenant_id` | text | no | — | yes | — |
| interview.candidate_profiles | `updated_at` | timestamp with time zone | no | now() | — | — |
| interview.companies | `created_at` | timestamp with time zone | no | now() | — | — |
| interview.companies | `created_by` | uuid | yes | — | — | platform.users.id |
| interview.companies | `domain` | text | yes | — | — | — |
| interview.companies | `id` | uuid | no | gen_random_uuid() | yes | — |
| interview.companies | `name` | text | no | — | — | — |
| interview.companies | `notes` | text | yes | — | — | — |
| interview.companies | `research` | text | yes | — | — | — |
| interview.companies | `tenant_id` | uuid | no | — | — | platform.tenants.id |
| interview.companies | `updated_at` | timestamp with time zone | no | now() | — | — |
| interview.companion_capabilities | `capture_request_support` | boolean | no | false | — | — |
| interview.companion_capabilities | `microphone` | text | no | — | — | — |
| interview.companion_capabilities | `owner_user_id` | uuid | no | — | yes | platform.tenant_memberships.user_id |
| interview.companion_capabilities | `reported_at` | timestamp with time zone | no | now() | — | — |
| interview.companion_capabilities | `screen` | text | no | — | — | — |
| interview.companion_capabilities | `screen_selection` | text | yes | — | — | — |
| interview.companion_capabilities | `speech_authorization_status` | text | no | — | — | — |
| interview.companion_capabilities | `speech_locale` | text | no | — | — | — |
| interview.companion_capabilities | `speech_on_device_available` | boolean | no | — | — | — |
| interview.companion_capabilities | `speech_recognizer_available` | boolean | no | — | — | — |
| interview.companion_capabilities | `tenant_id` | uuid | no | — | yes | platform.tenant_memberships.tenant_id |
| interview.concept_briefs | `actor_id` | text | no | — | yes | — |
| interview.concept_briefs | `created_at` | timestamp with time zone | no | now() | — | — |
| interview.concept_briefs | `id` | text | no | — | yes | — |
| interview.concept_briefs | `kind` | text | no | — | — | — |
| interview.concept_briefs | `product_id` | text | no | — | yes | — |
| interview.concept_briefs | `tenant_id` | text | no | — | yes | — |
| interview.concept_briefs | `topic` | text | no | — | — | — |
| interview.concept_briefs | `updated_at` | timestamp with time zone | no | now() | — | — |
| interview.concept_briefs | `value` | jsonb | no | — | — | — |
| interview.document_exports | `artifact_id` | uuid | no | — | — | platform.artifacts.id |
| interview.document_exports | `created_at` | timestamp with time zone | no | now() | — | — |
| interview.document_exports | `document_id` | uuid | no | — | — | interview.document_revisions.document_id |
| interview.document_exports | `format` | text | no | — | — | — |
| interview.document_exports | `id` | uuid | no | gen_random_uuid() | yes | — |
| interview.document_exports | `owner_user_id` | uuid | no | — | — | interview.document_revisions.owner_user_id |
| interview.document_exports | `revision` | integer | no | — | — | interview.document_revisions.revision |
| interview.document_exports | `tenant_id` | uuid | no | — | — | interview.document_revisions.tenant_id, platform.artifacts.tenant_id |
| interview.document_generation_batches | `batch_id` | text | no | — | yes | — |
| interview.document_generation_batches | `created_at` | timestamp with time zone | no | now() | — | — |
| interview.document_generation_batches | `fields_hash` | text | no | — | — | — |
| interview.document_generation_batches | `owner_user_id` | uuid | no | — | yes | interview.document_generation_requests.owner_user_id |
| interview.document_generation_batches | `retry_key` | text | no | — | yes | interview.document_generation_requests.retry_key |
| interview.document_generation_batches | `tenant_id` | uuid | no | — | yes | interview.document_generation_requests.tenant_id |
| interview.document_generation_batches | `usage` | jsonb | yes | — | — | — |
| interview.document_generation_batches | `values` | jsonb | no | — | — | — |
| interview.document_generation_requests | `binding_hash` | text | no | — | — | — |
| interview.document_generation_requests | `created_at` | timestamp with time zone | no | now() | — | — |
| interview.document_generation_requests | `document_id` | uuid | yes | — | — | interview.document_revisions.document_id |
| interview.document_generation_requests | `owner_user_id` | uuid | no | — | yes | interview.document_revisions.owner_user_id |
| interview.document_generation_requests | `retry_key` | text | no | — | yes | — |
| interview.document_generation_requests | `revision` | integer | yes | — | — | interview.document_revisions.revision |
| interview.document_generation_requests | `source_digest` | text | no | — | — | — |
| interview.document_generation_requests | `tenant_id` | uuid | no | — | yes | interview.document_revisions.tenant_id |
| interview.document_revisions | `ai_usage` | jsonb | yes | — | — | — |
| interview.document_revisions | `created_at` | timestamp with time zone | no | now() | — | — |
| interview.document_revisions | `document_id` | uuid | no | — | yes | interview.documents.id |
| interview.document_revisions | `owner_user_id` | uuid | no | — | yes | interview.documents.owner_user_id |
| interview.document_revisions | `provenance` | jsonb | no | — | — | — |
| interview.document_revisions | `revision` | integer | no | — | yes | — |
| interview.document_revisions | `tenant_id` | uuid | no | — | yes | interview.documents.tenant_id |
| interview.document_revisions | `validation` | jsonb | no | — | — | — |
| interview.document_revisions | `values` | jsonb | no | — | — | — |
| interview.document_template_revisions | `created_at` | timestamp with time zone | no | now() | — | — |
| interview.document_template_revisions | `fields` | jsonb | no | — | — | — |
| interview.document_template_revisions | `instructions` | text | no | — | — | — |
| interview.document_template_revisions | `owner_user_id` | uuid | yes | — | — | — |
| interview.document_template_revisions | `revision` | integer | no | — | yes | — |
| interview.document_template_revisions | `source_artifact_id` | uuid | no | — | — | platform.artifacts.id |
| interview.document_template_revisions | `template_id` | uuid | no | — | yes | interview.document_templates.id |
| interview.document_template_revisions | `tenant_id` | uuid | no | — | yes | interview.document_templates.tenant_id, platform.artifacts.tenant_id |
| interview.document_templates | `created_at` | timestamp with time zone | no | now() | — | — |
| interview.document_templates | `format` | text | no | — | — | — |
| interview.document_templates | `id` | uuid | no | gen_random_uuid() | yes | — |
| interview.document_templates | `kind` | text | no | — | — | — |
| interview.document_templates | `name` | text | no | — | — | — |
| interview.document_templates | `owner_user_id` | uuid | yes | — | — | — |
| interview.document_templates | `tenant_id` | uuid | no | — | — | platform.tenants.id |
| interview.documents | `candidacy_id` | uuid | yes | — | — | interview.candidacies.id, interview.interviews.candidacy_id |
| interview.documents | `created_at` | timestamp with time zone | no | now() | — | — |
| interview.documents | `current_revision` | integer | no | 1 | — | — |
| interview.documents | `id` | uuid | no | gen_random_uuid() | yes | — |
| interview.documents | `interview_id` | uuid | yes | — | — | interview.interviews.id |
| interview.documents | `owner_user_id` | uuid | no | — | — | — |
| interview.documents | `profile_id` | text | no | — | — | — |
| interview.documents | `profile_revision` | bigint | no | — | — | — |
| interview.documents | `status` | text | no | 'ready' | — | — |
| interview.documents | `template_id` | uuid | no | — | — | interview.document_template_revisions.template_id |
| interview.documents | `template_revision` | integer | no | — | — | interview.document_template_revisions.revision |
| interview.documents | `tenant_id` | uuid | no | — | — | interview.candidacies.tenant_id, interview.document_template_revisions.tenant_id, interview.interviews.tenant_id |
| interview.documents | `title` | text | no | — | — | — |
| interview.documents | `updated_at` | timestamp with time zone | no | now() | — | — |
| interview.interview_participants | `created_at` | timestamp with time zone | no | now() | — | — |
| interview.interview_participants | `created_by` | uuid | yes | — | — | platform.users.id |
| interview.interview_participants | `id` | uuid | no | gen_random_uuid() | yes | — |
| interview.interview_participants | `interview_id` | uuid | no | — | — | interview.interviews.id |
| interview.interview_participants | `person_id` | uuid | no | — | — | interview.people.id |
| interview.interview_participants | `role` | interview.participant_role | no | — | — | — |
| interview.interview_participants | `role_label` | text | yes | — | — | — |
| interview.interview_participants | `tenant_id` | uuid | no | — | — | interview.interviews.tenant_id, interview.people.tenant_id, platform.tenants.id |
| interview.interview_participants | `updated_at` | timestamp with time zone | no | now() | — | — |
| interview.interview_plan_items | `actor_id` | text | no | — | yes | interview.interview_plans.actor_id |
| interview.interview_plan_items | `created_at` | timestamp with time zone | no | now() | — | — |
| interview.interview_plan_items | `done` | boolean | no | false | — | — |
| interview.interview_plan_items | `id` | text | no | — | yes | — |
| interview.interview_plan_items | `kind` | text | no | — | — | — |
| interview.interview_plan_items | `plan_id` | text | no | — | — | interview.interview_plans.id |
| interview.interview_plan_items | `position` | integer | no | 0 | — | — |
| interview.interview_plan_items | `product_id` | text | no | — | yes | interview.interview_plans.product_id |
| interview.interview_plan_items | `ref` | text | yes | — | — | — |
| interview.interview_plan_items | `tenant_id` | text | no | — | yes | interview.interview_plans.tenant_id |
| interview.interview_plan_items | `title` | text | no | — | — | — |
| interview.interview_plans | `actor_id` | text | no | — | yes | — |
| interview.interview_plans | `company` | text | no | — | — | — |
| interview.interview_plans | `created_at` | timestamp with time zone | no | now() | — | — |
| interview.interview_plans | `duration_minutes` | integer | yes | — | — | — |
| interview.interview_plans | `format` | text | no | '' | — | — |
| interview.interview_plans | `id` | text | no | — | yes | — |
| interview.interview_plans | `product_id` | text | no | — | yes | — |
| interview.interview_plans | `role` | text | no | — | — | — |
| interview.interview_plans | `scheduled_at` | timestamp with time zone | yes | — | — | — |
| interview.interview_plans | `tenant_id` | text | no | — | yes | — |
| interview.interview_plans | `topics` | jsonb | no | '[]' | — | — |
| interview.interview_plans | `updated_at` | timestamp with time zone | no | now() | — | — |
| interview.interviews | `candidacy_id` | uuid | no | — | — | interview.candidacies.id |
| interview.interviews | `created_at` | timestamp with time zone | no | now() | — | — |
| interview.interviews | `created_by` | uuid | yes | — | — | platform.users.id |
| interview.interviews | `duration_minutes` | integer | yes | — | — | — |
| interview.interviews | `format` | interview.interview_format | yes | — | — | — |
| interview.interviews | `id` | uuid | no | gen_random_uuid() | yes | — |
| interview.interviews | `kind` | interview.interview_kind | no | — | — | — |
| interview.interviews | `label` | text | no | — | — | — |
| interview.interviews | `ordinal` | integer | no | — | — | — |
| interview.interviews | `scheduled_at` | timestamp with time zone | yes | — | — | — |
| interview.interviews | `status` | interview.interview_status | no | 'scheduled' | — | — |
| interview.interviews | `tenant_id` | uuid | no | — | — | interview.candidacies.tenant_id, platform.tenants.id |
| interview.interviews | `updated_at` | timestamp with time zone | no | now() | — | — |
| interview.member_people | `created_at` | timestamp with time zone | no | now() | — | — |
| interview.member_people | `person_id` | uuid | no | — | — | interview.people.id |
| interview.member_people | `tenant_id` | uuid | no | — | yes | interview.people.tenant_id, platform.tenant_memberships.tenant_id |
| interview.member_people | `updated_at` | timestamp with time zone | no | now() | — | — |
| interview.member_people | `user_id` | uuid | no | — | yes | platform.tenant_memberships.user_id |
| interview.people | `company_id` | uuid | yes | — | — | interview.companies.id |
| interview.people | `created_at` | timestamp with time zone | no | now() | — | — |
| interview.people | `created_by` | uuid | yes | — | — | platform.users.id |
| interview.people | `full_name` | text | no | — | — | — |
| interview.people | `id` | uuid | no | gen_random_uuid() | yes | — |
| interview.people | `linked_user_id` | uuid | yes | — | — | platform.users.id |
| interview.people | `linkedin_url` | text | yes | — | — | — |
| interview.people | `notes` | text | yes | — | — | — |
| interview.people | `tenant_id` | uuid | no | — | — | interview.companies.tenant_id, platform.tenants.id |
| interview.people | `title` | text | yes | — | — | — |
| interview.people | `updated_at` | timestamp with time zone | no | now() | — | — |
| interview.rehearsal_sessions | `actor_id` | text | no | — | yes | — |
| interview.rehearsal_sessions | `created_at` | timestamp with time zone | no | now() | — | — |
| interview.rehearsal_sessions | `ended_at` | timestamp with time zone | no | — | — | — |
| interview.rehearsal_sessions | `format` | text | no | — | — | — |
| interview.rehearsal_sessions | `id` | text | no | — | yes | — |
| interview.rehearsal_sessions | `product_id` | text | no | — | yes | — |
| interview.rehearsal_sessions | `score` | integer | no | — | — | — |
| interview.rehearsal_sessions | `tenant_id` | text | no | — | yes | — |
| interview.rehearsal_sessions | `value` | jsonb | no | — | — | — |
| interview.session_actions | `action_kind` | text | no | — | — | — |
| interview.session_actions | `attempt` | integer | no | 1 | — | — |
| interview.session_actions | `created_at` | timestamp with time zone | no | now() | — | — |
| interview.session_actions | `dispatch_status` | text | no | 'in_flight' | — | — |
| interview.session_actions | `fence_at_dispatch` | bigint | no | — | — | — |
| interview.session_actions | `id` | uuid | no | gen_random_uuid() | yes | — |
| interview.session_actions | `job_created` | boolean | no | false | — | — |
| interview.session_actions | `job_id` | uuid | yes | — | — | — |
| interview.session_actions | `owner_user_id` | uuid | no | — | — | interview.active_sessions.owner_user_id |
| interview.session_actions | `progress` | jsonb | yes | — | — | — |
| interview.session_actions | `result` | jsonb | yes | — | — | — |
| interview.session_actions | `session_id` | uuid | no | — | — | interview.active_sessions.id |
| interview.session_actions | `shown` | boolean | no | false | — | — |
| interview.session_actions | `source_event_ids` | text[] | yes | — | — | — |
| interview.session_actions | `suppression_reason` | text | yes | — | — | — |
| interview.session_actions | `task_id` | text | no | — | — | — |
| interview.session_actions | `task_revision` | integer | no | — | — | — |
| interview.session_actions | `tenant_id` | uuid | no | — | — | interview.active_sessions.tenant_id |
| interview.session_actions | `updated_at` | timestamp with time zone | no | now() | — | — |
| interview.session_observations | `ack` | jsonb | no | — | — | — |
| interview.session_observations | `content` | jsonb | no | — | — | — |
| interview.session_observations | `event_id` | text | no | — | yes | — |
| interview.session_observations | `kind` | text | no | — | — | — |
| interview.session_observations | `owner_user_id` | uuid | no | — | yes | interview.active_sessions.owner_user_id |
| interview.session_observations | `received_at` | timestamp with time zone | no | now() | — | — |
| interview.session_observations | `screenshot_artifact_id` | uuid | yes | — | — | platform.artifacts.id |
| interview.session_observations | `sequence` | bigint | no | — | — | — |
| interview.session_observations | `session_id` | uuid | no | — | yes | interview.active_sessions.id |
| interview.session_observations | `source_id` | text | no | — | yes | — |
| interview.session_observations | `tenant_id` | uuid | no | — | yes | interview.active_sessions.tenant_id, platform.artifacts.tenant_id |
| platform.artifact_payloads | `artifact_id` | uuid | no | — | yes | platform.artifacts.id |
| platform.artifact_payloads | `byte_length` | integer | no | — | — | — |
| platform.artifact_payloads | `bytes` | bytea | no | — | — | — |
| platform.artifact_payloads | `created_at` | timestamp with time zone | no | now() | — | — |
| platform.artifact_payloads | `tenant_id` | uuid | no | — | yes | platform.artifacts.tenant_id |
| platform.artifacts | `artifact_type` | text | no | — | — | — |
| platform.artifacts | `created_at` | timestamp with time zone | no | now() | — | — |
| platform.artifacts | `id` | uuid | no | gen_random_uuid() | yes | — |
| platform.artifacts | `metadata` | jsonb | no | '{}' | — | — |
| platform.artifacts | `owner_user_id` | uuid | yes | — | — | platform.users.id |
| platform.artifacts | `payload_reference` | text | no | — | — | — |
| platform.artifacts | `product_id` | text | no | — | — | — |
| platform.artifacts | `tenant_id` | uuid | no | — | — | platform.tenants.id |
| platform.artifacts | `title` | text | no | — | — | — |
| platform.artifacts | `updated_at` | timestamp with time zone | no | now() | — | — |
| platform.audit_events | `action` | text | no | — | — | — |
| platform.audit_events | `actor_user_id` | uuid | no | — | — | platform.users.id |
| platform.audit_events | `created_at` | timestamp with time zone | no | now() | — | — |
| platform.audit_events | `id` | uuid | no | gen_random_uuid() | yes | — |
| platform.audit_events | `metadata` | jsonb | no | '{}' | — | — |
| platform.audit_events | `subject_id` | text | no | — | — | — |
| platform.audit_events | `subject_type` | text | no | — | — | — |
| platform.audit_events | `tenant_id` | uuid | no | — | — | platform.tenants.id |
| platform.auth_sessions | `created_at` | timestamp with time zone | no | now() | — | — |
| platform.auth_sessions | `expires_at` | timestamp with time zone | no | — | — | — |
| platform.auth_sessions | `id` | uuid | no | gen_random_uuid() | yes | — |
| platform.auth_sessions | `session_token_hash` | text | no | — | — | — |
| platform.auth_sessions | `updated_at` | timestamp with time zone | no | now() | — | — |
| platform.auth_sessions | `user_id` | uuid | no | — | — | platform.users.id |
| platform.connected_accounts | `access_token_ciphertext` | jsonb | no | — | — | — |
| platform.connected_accounts | `created_at` | timestamp with time zone | no | now() | — | — |
| platform.connected_accounts | `expires_at` | timestamp with time zone | yes | — | — | — |
| platform.connected_accounts | `id` | uuid | no | gen_random_uuid() | yes | — |
| platform.connected_accounts | `provider` | text | no | — | — | — |
| platform.connected_accounts | `provider_account_id` | text | no | — | — | — |
| platform.connected_accounts | `refresh_token_ciphertext` | jsonb | yes | — | — | — |
| platform.connected_accounts | `scopes` | text[] | no | '{}' | — | — |
| platform.connected_accounts | `status` | text | no | — | — | — |
| platform.connected_accounts | `updated_at` | timestamp with time zone | no | now() | — | — |
| platform.connected_accounts | `user_id` | uuid | no | — | — | platform.users.id |
| platform.login_identities | `created_at` | timestamp with time zone | no | now() | — | — |
| platform.login_identities | `id` | uuid | no | gen_random_uuid() | yes | — |
| platform.login_identities | `provider` | text | no | — | — | — |
| platform.login_identities | `provider_account_id` | text | no | — | — | — |
| platform.login_identities | `updated_at` | timestamp with time zone | no | now() | — | — |
| platform.login_identities | `user_id` | uuid | no | — | — | platform.users.id |
| platform.product_installations | `configuration` | jsonb | no | — | — | — |
| platform.product_installations | `created_at` | timestamp with time zone | no | now() | — | — |
| platform.product_installations | `description` | text | no | — | — | — |
| platform.product_installations | `display_name` | text | no | — | — | — |
| platform.product_installations | `enabled` | boolean | no | true | — | — |
| platform.product_installations | `icon` | text | no | — | — | — |
| platform.product_installations | `product_id` | text | no | — | yes | — |
| platform.product_installations | `sort_order` | integer | no | 0 | — | — |
| platform.product_installations | `tenant_id` | uuid | no | — | yes | platform.tenants.id |
| platform.product_installations | `updated_at` | timestamp with time zone | no | now() | — | — |
| platform.tenant_memberships | `created_at` | timestamp with time zone | no | now() | — | — |
| platform.tenant_memberships | `role` | platform.tenant_role | no | — | — | — |
| platform.tenant_memberships | `tenant_id` | uuid | no | — | yes | platform.tenants.id |
| platform.tenant_memberships | `updated_at` | timestamp with time zone | no | now() | — | — |
| platform.tenant_memberships | `user_id` | uuid | no | — | yes | platform.users.id |
| platform.tenants | `created_at` | timestamp with time zone | no | now() | — | — |
| platform.tenants | `id` | uuid | no | gen_random_uuid() | yes | — |
| platform.tenants | `name` | text | no | — | — | — |
| platform.tenants | `slug` | text | no | — | — | — |
| platform.tenants | `updated_at` | timestamp with time zone | no | now() | — | — |
| platform.user_preferences | `ai_profile_id` | text | yes | — | — | — |
| platform.user_preferences | `created_at` | timestamp with time zone | no | now() | — | — |
| platform.user_preferences | `locale` | text | no | 'en' | — | — |
| platform.user_preferences | `theme` | platform.theme_preference | no | 'system' | — | — |
| platform.user_preferences | `updated_at` | timestamp with time zone | no | now() | — | — |
| platform.user_preferences | `user_id` | uuid | no | — | yes | platform.users.id |
| platform.users | `avatar_url` | text | yes | — | — | — |
| platform.users | `created_at` | timestamp with time zone | no | now() | — | — |
| platform.users | `display_name` | text | no | — | — | — |
| platform.users | `email` | text | no | — | — | — |
| platform.users | `email_verified_at` | timestamp with time zone | yes | — | — | — |
| platform.users | `id` | uuid | no | gen_random_uuid() | yes | — |
| platform.users | `status` | text | no | 'active' | — | — |
| platform.users | `updated_at` | timestamp with time zone | no | now() | — | — |
| practice.exercise_attempts | `created_at` | timestamp with time zone | no | now() | — | — |
| practice.exercise_attempts | `created_by` | uuid | yes | — | — | platform.users.id |
| practice.exercise_attempts | `draft_id` | text | no | — | — | — |
| practice.exercise_attempts | `exercise_id` | uuid | no | — | — | practice.exercises.id |
| practice.exercise_attempts | `id` | uuid | no | gen_random_uuid() | yes | — |
| practice.exercise_attempts | `language` | text | no | — | — | — |
| practice.exercise_attempts | `tenant_id` | uuid | no | — | — | platform.tenants.id |
| practice.exercise_attempts | `updated_at` | timestamp with time zone | no | now() | — | — |
| practice.exercise_attempts | `user_id` | uuid | no | — | — | platform.users.id |
| practice.exercises | `created_at` | timestamp with time zone | no | now() | — | — |
| practice.exercises | `created_by` | uuid | yes | — | — | platform.users.id |
| practice.exercises | `difficulty` | practice.exercise_difficulty | yes | — | — | — |
| practice.exercises | `id` | uuid | no | gen_random_uuid() | yes | — |
| practice.exercises | `kind` | practice.exercise_kind | no | — | — | — |
| practice.exercises | `prompt` | text | no | — | — | — |
| practice.exercises | `prompt_key` | text | no | — | — | — |
| practice.exercises | `slug` | text | no | — | — | — |
| practice.exercises | `source_kind` | practice.exercise_source | no | — | — | — |
| practice.exercises | `source_url` | text | yes | — | — | — |
| practice.exercises | `tags` | text[] | no | '{}' | — | — |
| practice.exercises | `tenant_id` | uuid | yes | — | — | platform.tenants.id |
| practice.exercises | `title` | text | no | — | — | — |
| practice.exercises | `updated_at` | timestamp with time zone | no | now() | — | — |
| presentation.agent_conversations | `created_at` | timestamp with time zone | no | now() | — | — |
| presentation.agent_conversations | `created_by` | uuid | no | — | — | platform.users.id |
| presentation.agent_conversations | `document_id` | uuid | no | — | — | presentation.documents.id |
| presentation.agent_conversations | `id` | uuid | no | gen_random_uuid() | yes | — |
| presentation.agent_conversations | `tenant_id` | uuid | no | — | — | platform.tenants.id, presentation.documents.tenant_id |
| presentation.agent_conversations | `updated_at` | timestamp with time zone | no | now() | — | — |
| presentation.document_favorites | `created_at` | timestamp with time zone | no | now() | — | — |
| presentation.document_favorites | `document_id` | uuid | no | — | yes | presentation.documents.id |
| presentation.document_favorites | `tenant_id` | uuid | no | — | yes | platform.tenants.id, presentation.documents.tenant_id |
| presentation.document_favorites | `user_id` | uuid | no | — | yes | platform.users.id |
| presentation.documents | `content` | jsonb | no | '{}' | — | — |
| presentation.documents | `created_at` | timestamp with time zone | no | now() | — | — |
| presentation.documents | `deleted_at` | timestamp with time zone | yes | — | — | — |
| presentation.documents | `document_type` | text | no | 'presentation' | — | — |
| presentation.documents | `id` | uuid | no | gen_random_uuid() | yes | — |
| presentation.documents | `owner_user_id` | uuid | no | — | — | platform.users.id |
| presentation.documents | `revision` | integer | no | 1 | — | — |
| presentation.documents | `tenant_id` | uuid | no | — | — | platform.tenants.id |
| presentation.documents | `title` | text | no | — | — | — |
| presentation.documents | `updated_at` | timestamp with time zone | no | now() | — | — |
| presentation.exports | `asset_reference` | text | yes | — | — | — |
| presentation.exports | `created_at` | timestamp with time zone | no | now() | — | — |
| presentation.exports | `document_id` | uuid | no | — | — | presentation.documents.id |
| presentation.exports | `error_code` | text | yes | — | — | — |
| presentation.exports | `format` | text | no | — | — | — |
| presentation.exports | `id` | uuid | no | gen_random_uuid() | yes | — |
| presentation.exports | `idempotency_key` | text | no | — | — | — |
| presentation.exports | `requested_by` | uuid | no | — | — | platform.users.id |
| presentation.exports | `status` | text | no | — | — | — |
| presentation.exports | `tenant_id` | uuid | no | — | — | platform.tenants.id, presentation.documents.tenant_id |
| presentation.exports | `updated_at` | timestamp with time zone | no | now() | — | — |
| presentation.font_pairs | `body_font` | text | no | — | — | — |
| presentation.font_pairs | `created_at` | timestamp with time zone | no | now() | — | — |
| presentation.font_pairs | `heading_font` | text | no | — | — | — |
| presentation.font_pairs | `id` | uuid | no | gen_random_uuid() | yes | — |
| presentation.font_pairs | `owner_user_id` | uuid | no | — | — | platform.users.id |
| presentation.font_pairs | `tenant_id` | uuid | no | — | — | platform.tenants.id |
| presentation.generated_images | `asset_reference` | text | no | — | — | — |
| presentation.generated_images | `created_at` | timestamp with time zone | no | now() | — | — |
| presentation.generated_images | `id` | uuid | no | gen_random_uuid() | yes | — |
| presentation.generated_images | `metadata` | jsonb | no | '{}' | — | — |
| presentation.generated_images | `model_id` | text | no | — | — | — |
| presentation.generated_images | `owner_user_id` | uuid | no | — | — | platform.users.id |
| presentation.generated_images | `prompt_reference` | text | no | — | — | — |
| presentation.generated_images | `provider_id` | text | no | — | — | — |
| presentation.generated_images | `tenant_id` | uuid | no | — | — | platform.tenants.id |
| presentation.generation_sessions | `created_at` | timestamp with time zone | no | now() | — | — |
| presentation.generation_sessions | `document_id` | uuid | yes | — | — | presentation.documents.id |
| presentation.generation_sessions | `id` | uuid | no | gen_random_uuid() | yes | — |
| presentation.generation_sessions | `owner_user_id` | uuid | no | — | — | platform.users.id |
| presentation.generation_sessions | `profile_id` | text | no | — | — | — |
| presentation.generation_sessions | `state` | jsonb | no | '{}' | — | — |
| presentation.generation_sessions | `status` | text | no | — | — | — |
| presentation.generation_sessions | `tenant_id` | uuid | no | — | — | platform.tenants.id, presentation.documents.tenant_id |
| presentation.generation_sessions | `updated_at` | timestamp with time zone | no | now() | — | — |
| presentation.presentations | `created_at` | timestamp with time zone | no | now() | — | — |
| presentation.presentations | `document_id` | uuid | no | — | yes | presentation.documents.id |
| presentation.presentations | `generation_state` | jsonb | no | '{}' | — | — |
| presentation.presentations | `outline` | jsonb | no | '[]' | — | — |
| presentation.presentations | `settings` | jsonb | no | '{}' | — | — |
| presentation.presentations | `tenant_id` | uuid | no | — | — | platform.tenants.id, presentation.documents.tenant_id |
| presentation.presentations | `theme_id` | uuid | yes | — | — | presentation.themes.id |
| presentation.presentations | `updated_at` | timestamp with time zone | no | now() | — | — |
| presentation.recordings | `asset_reference` | text | no | — | — | — |
| presentation.recordings | `created_at` | timestamp with time zone | no | now() | — | — |
| presentation.recordings | `document_id` | uuid | no | — | — | presentation.documents.id |
| presentation.recordings | `id` | uuid | no | gen_random_uuid() | yes | — |
| presentation.recordings | `metadata` | jsonb | no | '{}' | — | — |
| presentation.recordings | `owner_user_id` | uuid | no | — | — | platform.users.id |
| presentation.recordings | `tenant_id` | uuid | no | — | — | platform.tenants.id, presentation.documents.tenant_id |
| presentation.shares | `created_at` | timestamp with time zone | no | now() | — | — |
| presentation.shares | `created_by` | uuid | no | — | — | platform.users.id |
| presentation.shares | `document_id` | uuid | no | — | — | presentation.documents.id |
| presentation.shares | `expires_at` | timestamp with time zone | yes | — | — | — |
| presentation.shares | `id` | uuid | no | gen_random_uuid() | yes | — |
| presentation.shares | `revoked_at` | timestamp with time zone | yes | — | — | — |
| presentation.shares | `tenant_id` | uuid | no | — | — | platform.tenants.id, presentation.documents.tenant_id |
| presentation.shares | `token_hash` | text | no | — | — | — |
| presentation.slides | `content` | jsonb | no | '{}' | — | — |
| presentation.slides | `created_at` | timestamp with time zone | no | now() | — | — |
| presentation.slides | `document_id` | uuid | no | — | — | presentation.documents.id |
| presentation.slides | `id` | uuid | no | gen_random_uuid() | yes | — |
| presentation.slides | `position` | integer | no | — | — | — |
| presentation.slides | `revision` | integer | no | 1 | — | — |
| presentation.slides | `source_xml` | text | no | — | — | — |
| presentation.slides | `tenant_id` | uuid | no | — | — | platform.tenants.id, presentation.documents.tenant_id |
| presentation.slides | `updated_at` | timestamp with time zone | no | now() | — | — |
| presentation.theme_favorites | `created_at` | timestamp with time zone | no | now() | — | — |
| presentation.theme_favorites | `tenant_id` | uuid | no | — | yes | platform.tenants.id |
| presentation.theme_favorites | `theme_id` | uuid | no | — | yes | presentation.themes.id |
| presentation.theme_favorites | `user_id` | uuid | no | — | yes | platform.users.id |
| presentation.theme_likes | `created_at` | timestamp with time zone | no | now() | — | — |
| presentation.theme_likes | `tenant_id` | uuid | no | — | yes | platform.tenants.id |
| presentation.theme_likes | `theme_id` | uuid | no | — | yes | presentation.themes.id |
| presentation.theme_likes | `user_id` | uuid | no | — | yes | platform.users.id |
| presentation.themes | `built_in` | boolean | no | false | — | — |
| presentation.themes | `created_at` | timestamp with time zone | no | now() | — | — |
| presentation.themes | `definition` | jsonb | no | — | — | — |
| presentation.themes | `description` | text | no | '' | — | — |
| presentation.themes | `id` | uuid | no | gen_random_uuid() | yes | — |
| presentation.themes | `name` | text | no | — | — | — |
| presentation.themes | `owner_user_id` | uuid | yes | — | — | platform.users.id |
| presentation.themes | `source_import_id` | text | yes | — | — | — |
| presentation.themes | `tenant_id` | uuid | yes | — | — | platform.tenants.id |
| presentation.themes | `updated_at` | timestamp with time zone | no | now() | — | — |

## Enums

- `interview.candidacy_source`: `recruiter_outreach`, `referral`, `applied`, `inbound`
- `interview.candidacy_status`: `exploring`, `applied`, `interviewing`, `offer`, `accepted`, `declined`, `rejected`, `withdrawn`, `on_hold`
- `interview.interview_format`: `video`, `phone`, `onsite`
- `interview.interview_kind`: `recruiter_screen`, `hiring_manager`, `technical`, `system_design`, `take_home`, `panel`, `final`, `other`
- `interview.interview_status`: `scheduled`, `completed`, `cancelled`, `no_show`
- `interview.participant_role`: `candidate`, `interviewer`, `recruiter`, `hiring_manager`, `coordinator`, `observer`, `other`
- `platform.tenant_role`: `owner`, `admin`, `member`
- `platform.theme_preference`: `system`, `light`, `dark`
- `practice.exercise_difficulty`: `easy`, `medium`, `hard`
- `practice.exercise_kind`: `algorithm`, `data_structure`, `backend`, `frontend`, `react`, `sql`, `testing`, `other`
- `practice.exercise_source`: `original`, `generated`, `user_submitted`

## Indexes

- `ai.agent_artifacts`: primary key (id); index (tenant_id, job_id)
- `ai.agent_job_events`: primary key (job_id, sequence); index (tenant_id, job_id)
- `ai.agent_job_payloads`: primary key (reference)
- `ai.agent_jobs`: primary key (id); unique (tenant_id, id); index (status, lease_expires_at, created_at)
- `ai.agent_sessions`: primary key (id); unique (runtime, runtime_session_id)
- `ai.model_definitions`: primary key (id)
- `ai.profiles`: primary key (id)
- `ai.provider_configurations`: primary key (id)
- `ai.tenant_policies`: primary key (tenant_id, profile_id)
- `ai.usage_records`: primary key (id)
- `interview.active_sessions`: primary key (id); unique (tenant_id, owner_user_id, id); index (tenant_id, candidacy_id); index (status, lease_expires_at); unique index (credential_hash) where credential_hash IS NOT NULL; index (tenant_id, interview_id); unique index (tenant_id, owner_user_id) where status NOT IN ('ended', 'purging'); index (tenant_id, owner_user_id, rehearsal_run_id)
- `interview.assistant_answer_revisions`: primary key (tenant_id, actor_id, product_id, workspace_id, artifact_id, saved_revision)
- `interview.assistant_drafts`: primary key (tenant_id, actor_id, product_id, workspace_id, artifact_id)
- `interview.assistant_effect_receipts`: primary key (tenant_id, actor_id, product_id, operation, request_id)
- `interview.assistant_evidence`: primary key (tenant_id, actor_id, product_id, id, revision); index (to_tsvector('english'::regconfig, text))
- `interview.assistant_reverts`: primary key (tenant_id, actor_id, product_id, proposal_id)
- `interview.briefing_links`: primary key (id); unique (tenant_id, briefing_id); unique (tenant_id, id); index (tenant_id, candidacy_id); index (tenant_id, interview_id)
- `interview.briefing_proposals`: primary key (tenant_id, actor_id, product_id, id)
- `interview.candidacies`: primary key (id); unique (tenant_id, id); index (tenant_id, candidate_person_id); index (tenant_id, company_id)
- `interview.candidate_profile_revisions`: primary key (tenant_id, actor_id, product_id, id, revision)
- `interview.candidate_profiles`: primary key (tenant_id, actor_id, product_id, id)
- `interview.companies`: primary key (id); unique (tenant_id, id); unique index (tenant_id, domain) where "domain" IS NOT NULL
- `interview.companion_capabilities`: primary key (tenant_id, owner_user_id)
- `interview.concept_briefs`: primary key (tenant_id, actor_id, product_id, id)
- `interview.document_exports`: primary key (id); index (tenant_id, owner_user_id, document_id, revision)
- `interview.document_generation_batches`: primary key (tenant_id, owner_user_id, retry_key, batch_id)
- `interview.document_generation_requests`: primary key (tenant_id, owner_user_id, retry_key)
- `interview.document_revisions`: primary key (tenant_id, owner_user_id, document_id, revision)
- `interview.document_template_revisions`: primary key (tenant_id, template_id, revision); index (tenant_id, source_artifact_id)
- `interview.document_templates`: primary key (id); unique (tenant_id, id); index (tenant_id, owner_user_id)
- `interview.documents`: primary key (id); unique (tenant_id, owner_user_id, template_id, template_revision, profile_id, profile_revision, candidacy_id, interview_id); unique (tenant_id, owner_user_id, id); index (tenant_id, owner_user_id, updated_at)
- `interview.interview_participants`: primary key (id); unique (tenant_id, id); unique (interview_id, person_id, role); index (tenant_id, interview_id); index (tenant_id, person_id)
- `interview.interview_plan_items`: primary key (tenant_id, actor_id, product_id, id)
- `interview.interview_plans`: primary key (tenant_id, actor_id, product_id, id)
- `interview.interviews`: primary key (id); unique (candidacy_id, ordinal); unique (tenant_id, id, candidacy_id); unique (tenant_id, id); index (tenant_id, candidacy_id)
- `interview.member_people`: primary key (tenant_id, user_id); unique (tenant_id, person_id); index (tenant_id, person_id)
- `interview.people`: primary key (id); unique (tenant_id, id); index (tenant_id, company_id)
- `interview.rehearsal_sessions`: primary key (tenant_id, actor_id, product_id, id)
- `interview.session_actions`: primary key (id); unique (tenant_id, job_id); unique (tenant_id, owner_user_id, id); unique index (tenant_id, owner_user_id, session_id, task_id, task_revision, action_kind) where dispatch_status IN ('in_flight', 'succeeded'); index (tenant_id, owner_user_id, session_id)
- `interview.session_observations`: primary key (tenant_id, owner_user_id, session_id, source_id, event_id); unique (tenant_id, owner_user_id, session_id, sequence); index (tenant_id, screenshot_artifact_id)
- `platform.artifact_payloads`: primary key (tenant_id, artifact_id)
- `platform.artifacts`: primary key (id); unique (tenant_id, id); index (tenant_id, product_id, updated_at)
- `platform.audit_events`: primary key (id); index (tenant_id, created_at)
- `platform.auth_sessions`: primary key (id); unique (session_token_hash)
- `platform.connected_accounts`: primary key (id); unique (user_id, provider)
- `platform.login_identities`: primary key (id); unique (provider, provider_account_id)
- `platform.product_installations`: primary key (tenant_id, product_id)
- `platform.tenant_memberships`: primary key (tenant_id, user_id)
- `platform.tenants`: primary key (id); unique (slug)
- `platform.user_preferences`: primary key (user_id)
- `platform.users`: primary key (id); unique (email)
- `practice.exercise_attempts`: primary key (id); unique (tenant_id, user_id, draft_id); unique (tenant_id, id); index (exercise_id)
- `practice.exercises`: primary key (id); unique index (coalesce("tenant_id"::text, ''), slug); index (tenant_id, prompt_key)
- `presentation.agent_conversations`: primary key (id); index (tenant_id, document_id)
- `presentation.document_favorites`: primary key (tenant_id, user_id, document_id); index (tenant_id, document_id)
- `presentation.documents`: primary key (id); unique (tenant_id, id)
- `presentation.exports`: primary key (id); unique (tenant_id, idempotency_key); index (tenant_id, document_id)
- `presentation.font_pairs`: primary key (id)
- `presentation.generated_images`: primary key (id)
- `presentation.generation_sessions`: primary key (id); index (tenant_id, document_id)
- `presentation.presentations`: primary key (document_id); index (tenant_id, document_id)
- `presentation.recordings`: primary key (id); index (tenant_id, document_id)
- `presentation.shares`: primary key (id); unique (token_hash); index (tenant_id, document_id)
- `presentation.slides`: primary key (id); unique (document_id, position); index (tenant_id, document_id)
- `presentation.theme_favorites`: primary key (tenant_id, user_id, theme_id)
- `presentation.theme_likes`: primary key (tenant_id, user_id, theme_id)
- `presentation.themes`: primary key (id); unique index (tenant_id, source_import_id) where (source_import_id IS NOT NULL)

## Relations

- `ai.agent_artifacts` (tenant_id, job_id) → `ai.agent_jobs` (tenant_id, id), on delete cascade
- `ai.agent_job_events` (tenant_id, job_id) → `ai.agent_jobs` (tenant_id, id), on delete cascade
- `ai.agent_job_payloads` (tenant_id) → `platform.tenants` (id), on delete cascade
- `ai.agent_jobs` (tenant_id) → `platform.tenants` (id), on delete cascade
- `ai.agent_jobs` (user_id) → `platform.users` (id), on delete no action
- `ai.agent_sessions` (tenant_id) → `platform.tenants` (id), on delete cascade
- `ai.agent_sessions` (user_id) → `platform.users` (id), on delete no action
- `ai.model_definitions` (provider_configuration_id) → `ai.provider_configurations` (id), on delete cascade
- `ai.tenant_policies` (profile_id) → `ai.profiles` (id), on delete cascade
- `ai.tenant_policies` (tenant_id) → `platform.tenants` (id), on delete cascade
- `ai.usage_records` (tenant_id) → `platform.tenants` (id), on delete cascade
- `ai.usage_records` (user_id) → `platform.users` (id), on delete no action
- `interview.active_sessions` (tenant_id, candidacy_id) → `interview.candidacies` (tenant_id, id), on delete restrict
- `interview.active_sessions` (tenant_id, interview_id, candidacy_id) → `interview.interviews` (tenant_id, id, candidacy_id), on delete restrict
- `interview.active_sessions` (tenant_id) → `platform.tenants` (id), on delete no action
- `interview.assistant_answer_revisions` (tenant_id, actor_id, product_id, workspace_id, artifact_id) → `interview.assistant_drafts` (tenant_id, actor_id, product_id, workspace_id, artifact_id), on delete no action
- `interview.assistant_reverts` (tenant_id, actor_id, product_id, workspace_id, artifact_id) → `interview.assistant_drafts` (tenant_id, actor_id, product_id, workspace_id, artifact_id), on delete no action
- `interview.briefing_links` (tenant_id, candidacy_id) → `interview.candidacies` (tenant_id, id), on delete no action
- `interview.briefing_links` (created_by) → `platform.users` (id), on delete no action
- `interview.briefing_links` (tenant_id, interview_id) → `interview.interviews` (tenant_id, id), on delete no action
- `interview.briefing_links` (tenant_id) → `platform.tenants` (id), on delete cascade
- `interview.candidacies` (tenant_id, candidate_person_id) → `interview.people` (tenant_id, id), on delete no action
- `interview.candidacies` (tenant_id, company_id) → `interview.companies` (tenant_id, id), on delete no action
- `interview.candidacies` (created_by) → `platform.users` (id), on delete no action
- `interview.candidacies` (tenant_id) → `platform.tenants` (id), on delete cascade
- `interview.candidate_profile_revisions` (tenant_id, actor_id, product_id, id) → `interview.candidate_profiles` (tenant_id, actor_id, product_id, id), on delete no action
- `interview.companies` (created_by) → `platform.users` (id), on delete no action
- `interview.companies` (tenant_id) → `platform.tenants` (id), on delete cascade
- `interview.companion_capabilities` (tenant_id, owner_user_id) → `platform.tenant_memberships` (tenant_id, user_id), on delete cascade
- `interview.document_exports` (tenant_id, artifact_id) → `platform.artifacts` (tenant_id, id), on delete no action
- `interview.document_exports` (tenant_id, owner_user_id, document_id, revision) → `interview.document_revisions` (tenant_id, owner_user_id, document_id, revision), on delete no action
- `interview.document_generation_batches` (tenant_id, owner_user_id, retry_key) → `interview.document_generation_requests` (tenant_id, owner_user_id, retry_key), on delete no action
- `interview.document_generation_requests` (tenant_id, owner_user_id, document_id, revision) → `interview.document_revisions` (tenant_id, owner_user_id, document_id, revision), on delete no action
- `interview.document_revisions` (tenant_id, owner_user_id, document_id) → `interview.documents` (tenant_id, owner_user_id, id), on delete no action
- `interview.document_template_revisions` (tenant_id, source_artifact_id) → `platform.artifacts` (tenant_id, id), on delete no action
- `interview.document_template_revisions` (tenant_id, template_id) → `interview.document_templates` (tenant_id, id), on delete no action
- `interview.document_templates` (tenant_id) → `platform.tenants` (id), on delete no action
- `interview.documents` (tenant_id, candidacy_id) → `interview.candidacies` (tenant_id, id), on delete no action
- `interview.documents` (tenant_id, interview_id, candidacy_id) → `interview.interviews` (tenant_id, id, candidacy_id), on delete no action
- `interview.documents` (tenant_id, template_id, template_revision) → `interview.document_template_revisions` (tenant_id, template_id, revision), on delete no action
- `interview.interview_participants` (created_by) → `platform.users` (id), on delete no action
- `interview.interview_participants` (tenant_id, interview_id) → `interview.interviews` (tenant_id, id), on delete no action
- `interview.interview_participants` (tenant_id, person_id) → `interview.people` (tenant_id, id), on delete no action
- `interview.interview_participants` (tenant_id) → `platform.tenants` (id), on delete cascade
- `interview.interview_plan_items` (tenant_id, actor_id, product_id, plan_id) → `interview.interview_plans` (tenant_id, actor_id, product_id, id), on delete cascade
- `interview.interviews` (tenant_id, candidacy_id) → `interview.candidacies` (tenant_id, id), on delete no action
- `interview.interviews` (created_by) → `platform.users` (id), on delete no action
- `interview.interviews` (tenant_id) → `platform.tenants` (id), on delete cascade
- `interview.member_people` (tenant_id, user_id) → `platform.tenant_memberships` (tenant_id, user_id), on delete cascade
- `interview.member_people` (tenant_id, person_id) → `interview.people` (tenant_id, id), on delete no action
- `interview.people` (tenant_id, company_id) → `interview.companies` (tenant_id, id), on delete no action
- `interview.people` (created_by) → `platform.users` (id), on delete no action
- `interview.people` (linked_user_id) → `platform.users` (id), on delete no action
- `interview.people` (tenant_id) → `platform.tenants` (id), on delete cascade
- `interview.session_actions` (tenant_id, owner_user_id, session_id) → `interview.active_sessions` (tenant_id, owner_user_id, id), on delete no action
- `interview.session_observations` (tenant_id, screenshot_artifact_id) → `platform.artifacts` (tenant_id, id), on delete no action
- `interview.session_observations` (tenant_id, owner_user_id, session_id) → `interview.active_sessions` (tenant_id, owner_user_id, id), on delete no action
- `platform.artifact_payloads` (tenant_id, artifact_id) → `platform.artifacts` (tenant_id, id), on delete cascade
- `platform.artifacts` (owner_user_id) → `platform.users` (id), on delete no action
- `platform.artifacts` (tenant_id) → `platform.tenants` (id), on delete cascade
- `platform.audit_events` (actor_user_id) → `platform.users` (id), on delete no action
- `platform.audit_events` (tenant_id) → `platform.tenants` (id), on delete cascade
- `platform.auth_sessions` (user_id) → `platform.users` (id), on delete cascade
- `platform.connected_accounts` (user_id) → `platform.users` (id), on delete cascade
- `platform.login_identities` (user_id) → `platform.users` (id), on delete cascade
- `platform.product_installations` (tenant_id) → `platform.tenants` (id), on delete cascade
- `platform.tenant_memberships` (tenant_id) → `platform.tenants` (id), on delete cascade
- `platform.tenant_memberships` (user_id) → `platform.users` (id), on delete cascade
- `platform.user_preferences` (user_id) → `platform.users` (id), on delete cascade
- `practice.exercise_attempts` (created_by) → `platform.users` (id), on delete no action
- `practice.exercise_attempts` (exercise_id) → `practice.exercises` (id), on delete no action
- `practice.exercise_attempts` (tenant_id) → `platform.tenants` (id), on delete cascade
- `practice.exercise_attempts` (user_id) → `platform.users` (id), on delete no action
- `practice.exercises` (created_by) → `platform.users` (id), on delete no action
- `practice.exercises` (tenant_id) → `platform.tenants` (id), on delete cascade
- `presentation.agent_conversations` (created_by) → `platform.users` (id), on delete no action
- `presentation.agent_conversations` (tenant_id, document_id) → `presentation.documents` (tenant_id, id), on delete cascade
- `presentation.agent_conversations` (tenant_id) → `platform.tenants` (id), on delete cascade
- `presentation.document_favorites` (tenant_id, document_id) → `presentation.documents` (tenant_id, id), on delete cascade
- `presentation.document_favorites` (tenant_id) → `platform.tenants` (id), on delete cascade
- `presentation.document_favorites` (user_id) → `platform.users` (id), on delete cascade
- `presentation.documents` (owner_user_id) → `platform.users` (id), on delete no action
- `presentation.documents` (tenant_id) → `platform.tenants` (id), on delete cascade
- `presentation.exports` (tenant_id, document_id) → `presentation.documents` (tenant_id, id), on delete cascade
- `presentation.exports` (requested_by) → `platform.users` (id), on delete no action
- `presentation.exports` (tenant_id) → `platform.tenants` (id), on delete cascade
- `presentation.font_pairs` (owner_user_id) → `platform.users` (id), on delete no action
- `presentation.font_pairs` (tenant_id) → `platform.tenants` (id), on delete cascade
- `presentation.generated_images` (owner_user_id) → `platform.users` (id), on delete no action
- `presentation.generated_images` (tenant_id) → `platform.tenants` (id), on delete cascade
- `presentation.generation_sessions` (tenant_id, document_id) → `presentation.documents` (tenant_id, id), on delete cascade
- `presentation.generation_sessions` (owner_user_id) → `platform.users` (id), on delete no action
- `presentation.generation_sessions` (tenant_id) → `platform.tenants` (id), on delete cascade
- `presentation.presentations` (tenant_id, document_id) → `presentation.documents` (tenant_id, id), on delete cascade
- `presentation.presentations` (tenant_id) → `platform.tenants` (id), on delete cascade
- `presentation.presentations` (theme_id) → `presentation.themes` (id), on delete set null
- `presentation.recordings` (tenant_id, document_id) → `presentation.documents` (tenant_id, id), on delete cascade
- `presentation.recordings` (owner_user_id) → `platform.users` (id), on delete no action
- `presentation.recordings` (tenant_id) → `platform.tenants` (id), on delete cascade
- `presentation.shares` (created_by) → `platform.users` (id), on delete no action
- `presentation.shares` (tenant_id, document_id) → `presentation.documents` (tenant_id, id), on delete cascade
- `presentation.shares` (tenant_id) → `platform.tenants` (id), on delete cascade
- `presentation.slides` (tenant_id, document_id) → `presentation.documents` (tenant_id, id), on delete cascade
- `presentation.slides` (tenant_id) → `platform.tenants` (id), on delete cascade
- `presentation.theme_favorites` (tenant_id) → `platform.tenants` (id), on delete cascade
- `presentation.theme_favorites` (theme_id) → `presentation.themes` (id), on delete cascade
- `presentation.theme_favorites` (user_id) → `platform.users` (id), on delete cascade
- `presentation.theme_likes` (tenant_id) → `platform.tenants` (id), on delete cascade
- `presentation.theme_likes` (theme_id) → `presentation.themes` (id), on delete cascade
- `presentation.theme_likes` (user_id) → `platform.users` (id), on delete cascade
- `presentation.themes` (owner_user_id) → `platform.users` (id), on delete no action
- `presentation.themes` (tenant_id) → `platform.tenants` (id), on delete cascade

## Row-level security

_The snapshot records whether RLS is enabled and each policy; whether it is FORCED is not recorded (see `packages/database` migrations)._

- `ai.agent_artifacts`: RLS enabled; policies: agent_artifacts_private_parent_delete (delete), agent_artifacts_private_parent_insert (insert), agent_artifacts_private_parent_select (select), agent_artifacts_private_parent_update (update), tenant_scope (all)
- `ai.agent_job_events`: RLS enabled; policies: agent_job_events_private_parent_delete (delete), agent_job_events_private_parent_insert (insert), agent_job_events_private_parent_select (select), agent_job_events_private_parent_update (update), agent_worker_append (insert), tenant_scope (all)
- `ai.agent_job_payloads`: RLS enabled; policies: payload_reference_lookup (select), tenant_scope (all)
- `ai.agent_jobs`: RLS enabled; policies: agent_job_private_delete (delete), agent_job_private_select (select), agent_job_private_update (update), agent_worker_read (select), agent_worker_update (update), tenant_scope (all)
- `ai.agent_sessions`: RLS enabled; policies: tenant_scope (all)
- `ai.model_definitions`: RLS off; policies: none
- `ai.profiles`: RLS off; policies: none
- `ai.provider_configurations`: RLS off; policies: none
- `ai.tenant_policies`: RLS enabled; policies: tenant_scope (all)
- `ai.usage_records`: RLS enabled; policies: tenant_scope (all)
- `interview.active_sessions`: RLS enabled; policies: active_sessions_claim_select (select), active_sessions_claim_update (update), active_sessions_credential_lookup (select), active_sessions_owner_delete (delete), active_sessions_owner_insert (insert), active_sessions_owner_select (select), active_sessions_owner_update (update)
- `interview.assistant_answer_revisions`: RLS enabled; policies: assistant_private_scope (all)
- `interview.assistant_drafts`: RLS enabled; policies: assistant_private_scope (all)
- `interview.assistant_effect_receipts`: RLS enabled; policies: assistant_private_scope (all)
- `interview.assistant_evidence`: RLS enabled; policies: assistant_private_scope (all)
- `interview.assistant_reverts`: RLS enabled; policies: assistant_private_scope (all)
- `interview.briefing_links`: RLS enabled; policies: tenant_briefing_links (all)
- `interview.briefing_proposals`: RLS enabled; policies: briefing_private_scope (all)
- `interview.candidacies`: RLS enabled; policies: tenant_candidacies (all)
- `interview.candidate_profile_revisions`: RLS enabled; policies: briefing_private_scope (all)
- `interview.candidate_profiles`: RLS enabled; policies: briefing_private_scope (all)
- `interview.companies`: RLS enabled; policies: tenant_companies (all)
- `interview.companion_capabilities`: RLS enabled; policies: companion_capabilities_owner_insert (insert), companion_capabilities_owner_select (select), companion_capabilities_owner_update (update)
- `interview.concept_briefs`: RLS enabled; policies: brief_private_scope (all)
- `interview.document_exports`: RLS enabled; policies: document_exports_private_scope (all)
- `interview.document_generation_batches`: RLS enabled; policies: document_generation_batches_private_scope (all)
- `interview.document_generation_requests`: RLS enabled; policies: document_generation_requests_private_scope (all)
- `interview.document_revisions`: RLS enabled; policies: document_revisions_private_scope (all)
- `interview.document_template_revisions`: RLS enabled; policies: document_template_revisions_catalog_insert (insert), document_template_revisions_insert (insert), document_template_revisions_read (select)
- `interview.document_templates`: RLS enabled; policies: document_templates_catalog_insert (insert), document_templates_delete (delete), document_templates_insert (insert), document_templates_read (select), document_templates_update (update)
- `interview.documents`: RLS enabled; policies: documents_private_scope (all)
- `interview.interview_participants`: RLS enabled; policies: tenant_interview_participants (all)
- `interview.interview_plan_items`: RLS enabled; policies: plan_private_scope (all)
- `interview.interview_plans`: RLS enabled; policies: plan_private_scope (all)
- `interview.interviews`: RLS enabled; policies: tenant_interviews (all)
- `interview.member_people`: RLS enabled; policies: tenant_member_people (all)
- `interview.people`: RLS enabled; policies: tenant_people (all)
- `interview.rehearsal_sessions`: RLS enabled; policies: rehearsal_private_scope (all)
- `interview.session_actions`: RLS enabled; policies: session_actions_owner_delete (delete), session_actions_owner_insert (insert), session_actions_owner_select (select), session_actions_owner_update (update)
- `interview.session_observations`: RLS enabled; policies: session_observations_owner_delete (delete), session_observations_owner_insert (insert), session_observations_owner_select (select)
- `platform.artifact_payloads`: RLS enabled; policies: artifact_payloads_insert (insert), artifact_payloads_select (select), artifact_payloads_session_delete (delete)
- `platform.artifacts`: RLS enabled; policies: document_artifacts_delete (delete), document_artifacts_insert (insert), document_artifacts_select (select), document_artifacts_update (update), session_artifacts_delete (delete), session_artifacts_insert (insert), session_artifacts_select (select), session_artifacts_update (update), tenant_artifacts (all)
- `platform.audit_events`: RLS enabled; policies: tenant_audit_events (all)
- `platform.auth_sessions`: RLS off; policies: none
- `platform.connected_accounts`: RLS off; policies: none
- `platform.login_identities`: RLS off; policies: none
- `platform.product_installations`: RLS enabled; policies: tenant_product_installations (all)
- `platform.tenant_memberships`: RLS enabled; policies: tenant_scope (all)
- `platform.tenants`: RLS off; policies: none
- `platform.user_preferences`: RLS off; policies: none
- `platform.users`: RLS off; policies: none
- `practice.exercise_attempts`: RLS enabled; policies: tenant_user_exercise_attempts (all)
- `practice.exercises`: RLS enabled; policies: exercises_read (select), exercises_write (all)
- `presentation.agent_conversations`: RLS enabled; policies: tenant_scope (all)
- `presentation.document_favorites`: RLS enabled; policies: tenant_scope (all)
- `presentation.documents`: RLS enabled; policies: tenant_scope (all)
- `presentation.exports`: RLS enabled; policies: tenant_scope (all)
- `presentation.font_pairs`: RLS enabled; policies: tenant_scope (all)
- `presentation.generated_images`: RLS enabled; policies: tenant_scope (all)
- `presentation.generation_sessions`: RLS enabled; policies: tenant_scope (all)
- `presentation.presentations`: RLS enabled; policies: tenant_scope (all)
- `presentation.recordings`: RLS enabled; policies: tenant_scope (all)
- `presentation.shares`: RLS enabled; policies: share_token_lookup (select), tenant_scope (all)
- `presentation.slides`: RLS enabled; policies: tenant_scope (all)
- `presentation.theme_favorites`: RLS enabled; policies: tenant_scope (all)
- `presentation.theme_likes`: RLS enabled; policies: tenant_scope (all)
- `presentation.themes`: RLS enabled; policies: tenant_theme_scope (all)

## Residuals

Not shown here (read the snapshot or the schema source):

- 104 policy expressions (`using` / `with check`): names only above
- 78 check constraints
- generated and identity columns
- index methods, operator classes, sort order
- roles, grants, triggers, functions, views

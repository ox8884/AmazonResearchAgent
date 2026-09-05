export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_login_guard: {
        Row: {
          attempts: number
          bucket: string
          scrypt_inflight: boolean
          scrypt_leased_until: string | null
          scrypt_owner: string | null
          window_started_at: string
        }
        Insert: {
          attempts?: number
          bucket: string
          scrypt_inflight?: boolean
          scrypt_leased_until?: string | null
          scrypt_owner?: string | null
          window_started_at?: string
        }
        Update: {
          attempts?: number
          bucket?: string
          scrypt_inflight?: boolean
          scrypt_leased_until?: string | null
          scrypt_owner?: string | null
          window_started_at?: string
        }
        Relationships: []
      }
      admin_sessions: {
        Row: {
          created_at: string
          expires_at: string
          id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
        }
        Relationships: []
      }
      ai_analyses: {
        Row: {
          attempts: number
          available_at: string
          completed_at: string | null
          cost_class: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          input_hash: string
          input_payload: Json
          last_error: string | null
          leased_by: string | null
          leased_until: string | null
          locale: string
          model_id: string
          output: Json | null
          output_sha256: string | null
          pending_output: Json | null
          pending_usage: Json | null
          pending_winner_attempt_id: string | null
          prompt_version: string
          provider_id: string
          role: string
          started_at: string
          status: string
          usage: Json
          winning_attempt_id: string | null
        }
        Insert: {
          attempts?: number
          available_at?: string
          completed_at?: string | null
          cost_class: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          input_hash: string
          input_payload?: Json
          last_error?: string | null
          leased_by?: string | null
          leased_until?: string | null
          locale: string
          model_id: string
          output?: Json | null
          output_sha256?: string | null
          pending_output?: Json | null
          pending_usage?: Json | null
          pending_winner_attempt_id?: string | null
          prompt_version: string
          provider_id: string
          role: string
          started_at: string
          status?: string
          usage?: Json
          winning_attempt_id?: string | null
        }
        Update: {
          attempts?: number
          available_at?: string
          completed_at?: string | null
          cost_class?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          input_hash?: string
          input_payload?: Json
          last_error?: string | null
          leased_by?: string | null
          leased_until?: string | null
          locale?: string
          model_id?: string
          output?: Json | null
          output_sha256?: string | null
          pending_output?: Json | null
          pending_usage?: Json | null
          pending_winner_attempt_id?: string | null
          prompt_version?: string
          provider_id?: string
          role?: string
          started_at?: string
          status?: string
          usage?: Json
          winning_attempt_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_analyses_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "ai_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_analysis_entities: {
        Row: {
          analysis_id: string
          created_at: string
          entity_id: string
          entity_type: string
        }
        Insert: {
          analysis_id: string
          created_at?: string
          entity_id: string
          entity_type: string
        }
        Update: {
          analysis_id?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_analysis_entities_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "ai_analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_models: {
        Row: {
          billing_type: string
          capabilities: Json
          created_at: string
          display_name: string
          enabled: boolean
          id: string
          model_id: string
          origin: string
          priority: number
          provider_id: string
          quality_rank: number
          updated_at: string
        }
        Insert: {
          billing_type: string
          capabilities?: Json
          created_at?: string
          display_name: string
          enabled?: boolean
          id?: string
          model_id: string
          origin?: string
          priority?: number
          provider_id: string
          quality_rank?: number
          updated_at?: string
        }
        Update: {
          billing_type?: string
          capabilities?: Json
          created_at?: string
          display_name?: string
          enabled?: boolean
          id?: string
          model_id?: string
          origin?: string
          priority?: number
          provider_id?: string
          quality_rank?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_models_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "ai_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_provider_capability_attestations: {
        Row: {
          adapter: string
          auth_generation: number
          bounded_behavior_digest: string
          capability_digest: string
          checked_at: string
          evidence: Json
          execution_fingerprint: string
          framing_digest: string
          id: string
          model_id: string
          provider_id: string
          role: string
          settings_revision: number
        }
        Insert: {
          adapter: string
          auth_generation: number
          bounded_behavior_digest: string
          capability_digest: string
          checked_at?: string
          evidence?: Json
          execution_fingerprint: string
          framing_digest: string
          id?: string
          model_id: string
          provider_id: string
          role: string
          settings_revision: number
        }
        Update: {
          adapter?: string
          auth_generation?: number
          bounded_behavior_digest?: string
          capability_digest?: string
          checked_at?: string
          evidence?: Json
          execution_fingerprint?: string
          framing_digest?: string
          id?: string
          model_id?: string
          provider_id?: string
          role?: string
          settings_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_provider_capability_attestations_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "ai_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_provider_containment_attestations: {
        Row: {
          adapter: string
          auth_generation: number
          checked_at: string
          containment_digest: string
          evidence: Json
          execution_fingerprint: string
          id: string
          provider_id: string
          security_profile_digest: string | null
          security_profile_version: string
          settings_revision: number
        }
        Insert: {
          adapter: string
          auth_generation: number
          checked_at?: string
          containment_digest: string
          evidence?: Json
          execution_fingerprint: string
          id?: string
          provider_id: string
          security_profile_digest?: string | null
          security_profile_version: string
          settings_revision: number
        }
        Update: {
          adapter?: string
          auth_generation?: number
          checked_at?: string
          containment_digest?: string
          evidence?: Json
          execution_fingerprint?: string
          id?: string
          provider_id?: string
          security_profile_digest?: string | null
          security_profile_version?: string
          settings_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_provider_containment_attestations_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "ai_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_provider_runtime_state: {
        Row: {
          auth_generation: number
          available: boolean
          binary_identity_digest: string | null
          capability_attestation_id: string | null
          checked_at: string | null
          containment_attestation_id: string | null
          created_at: string
          credential_source_digest: string | null
          current_probe_job_id: string | null
          current_probe_requested_at: string | null
          execution_fingerprint: string
          probe_generation: number
          provider_id: string
          readiness_policy_version: string
          ready_valid_until: string | null
          reason: string | null
          retry_not_before: string | null
          security_profile_digest: string | null
          security_profile_version: string
          settings_revision: number
          state: string
          terms_digest: string | null
          transient_failure_count: number
          updated_at: string
        }
        Insert: {
          auth_generation?: number
          available?: boolean
          binary_identity_digest?: string | null
          capability_attestation_id?: string | null
          checked_at?: string | null
          containment_attestation_id?: string | null
          created_at?: string
          credential_source_digest?: string | null
          current_probe_job_id?: string | null
          current_probe_requested_at?: string | null
          execution_fingerprint: string
          probe_generation?: number
          provider_id: string
          readiness_policy_version: string
          ready_valid_until?: string | null
          reason?: string | null
          retry_not_before?: string | null
          security_profile_digest?: string | null
          security_profile_version: string
          settings_revision: number
          state?: string
          terms_digest?: string | null
          transient_failure_count?: number
          updated_at?: string
        }
        Update: {
          auth_generation?: number
          available?: boolean
          binary_identity_digest?: string | null
          capability_attestation_id?: string | null
          checked_at?: string | null
          containment_attestation_id?: string | null
          created_at?: string
          credential_source_digest?: string | null
          current_probe_job_id?: string | null
          current_probe_requested_at?: string | null
          execution_fingerprint?: string
          probe_generation?: number
          provider_id?: string
          readiness_policy_version?: string
          ready_valid_until?: string | null
          reason?: string | null
          retry_not_before?: string | null
          security_profile_digest?: string | null
          security_profile_version?: string
          settings_revision?: number
          state?: string
          terms_digest?: string | null
          transient_failure_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_provider_runtime_capability_fkey"
            columns: ["capability_attestation_id"]
            isOneToOne: false
            referencedRelation: "ai_provider_capability_attestations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_provider_runtime_containment_fkey"
            columns: ["containment_attestation_id"]
            isOneToOne: false
            referencedRelation: "ai_provider_containment_attestations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_provider_runtime_state_current_probe_job_id_fkey"
            columns: ["current_probe_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_provider_runtime_state_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: true
            referencedRelation: "ai_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_providers: {
        Row: {
          adapter: string | null
          billing_type: string
          config: Json
          created_at: string
          enabled: boolean
          id: string
          kind: string
          name: string
          priority: number
          settings_revision: number
          updated_at: string
        }
        Insert: {
          adapter?: string | null
          billing_type: string
          config?: Json
          created_at?: string
          enabled?: boolean
          id: string
          kind: string
          name: string
          priority?: number
          settings_revision?: number
          updated_at?: string
        }
        Update: {
          adapter?: string | null
          billing_type?: string
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          kind?: string
          name?: string
          priority?: number
          settings_revision?: number
          updated_at?: string
        }
        Relationships: []
      }
      ai_usage: {
        Row: {
          analysis_id: string
          completed_at: string
          cost_class: string
          created_at: string
          id: string
          input_hash: string
          model_id: string
          provider_id: string
          role: string
          started_at: string
          usage: Json
        }
        Insert: {
          analysis_id: string
          completed_at: string
          cost_class: string
          created_at?: string
          id?: string
          input_hash: string
          model_id: string
          provider_id: string
          role: string
          started_at: string
          usage?: Json
        }
        Update: {
          analysis_id?: string
          completed_at?: string
          cost_class?: string
          created_at?: string
          id?: string
          input_hash?: string
          model_id?: string
          provider_id?: string
          role?: string
          started_at?: string
          usage?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: true
            referencedRelation: "ai_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "ai_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      api_budget_daily: {
        Row: {
          budget_date: string
          created_at: string
          daily_limit: number
          reserved_limit: number
          reserved_used_count: number
          updated_at: string
          used_count: number
        }
        Insert: {
          budget_date: string
          created_at?: string
          daily_limit: number
          reserved_limit: number
          reserved_used_count?: number
          updated_at?: string
          used_count?: number
        }
        Update: {
          budget_date?: string
          created_at?: string
          daily_limit?: number
          reserved_limit?: number
          reserved_used_count?: number
          updated_at?: string
          used_count?: number
        }
        Relationships: []
      }
      api_cache: {
        Row: {
          cache_key: string
          captured_at: string
          endpoint: string
          expires_at: string
          response: Json
        }
        Insert: {
          cache_key: string
          captured_at?: string
          endpoint: string
          expires_at: string
          response: Json
        }
        Update: {
          cache_key?: string
          captured_at?: string
          endpoint?: string
          expires_at?: string
          response?: Json
        }
        Relationships: []
      }
      api_call_claims: {
        Row: {
          budget_date: string | null
          cache_key: string
          claimed_until: string
          completed_at: string | null
          owner: string
          reserved: boolean
          staged_response: Json | null
          usage_persisted: boolean
        }
        Insert: {
          budget_date?: string | null
          cache_key: string
          claimed_until: string
          completed_at?: string | null
          owner: string
          reserved?: boolean
          staged_response?: Json | null
          usage_persisted?: boolean
        }
        Update: {
          budget_date?: string | null
          cache_key?: string
          claimed_until?: string
          completed_at?: string | null
          owner?: string
          reserved?: boolean
          staged_response?: Json | null
          usage_persisted?: boolean
        }
        Relationships: []
      }
      api_usage: {
        Row: {
          budget_date: string
          cache_key: string
          cached: boolean
          call_count: number
          candidate_id: string | null
          completed_at: string | null
          created_at: string
          endpoint: string
          error_code: string | null
          http_status: number | null
          id: string
          niche_cluster_id: string | null
          purpose: string
          retry_count: number
          started_at: string
          success: boolean | null
        }
        Insert: {
          budget_date?: string
          cache_key: string
          cached?: boolean
          call_count?: number
          candidate_id?: string | null
          completed_at?: string | null
          created_at?: string
          endpoint: string
          error_code?: string | null
          http_status?: number | null
          id?: string
          niche_cluster_id?: string | null
          purpose: string
          retry_count?: number
          started_at?: string
          success?: boolean | null
        }
        Update: {
          budget_date?: string
          cache_key?: string
          cached?: boolean
          call_count?: number
          candidate_id?: string | null
          completed_at?: string | null
          created_at?: string
          endpoint?: string
          error_code?: string | null
          http_status?: number | null
          id?: string
          niche_cluster_id?: string | null
          purpose?: string
          retry_count?: number
          started_at?: string
          success?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_usage_niche_cluster_id_fkey"
            columns: ["niche_cluster_id"]
            isOneToOne: false
            referencedRelation: "niche_clusters"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          created_at: string
          daily_api_budget: number
          id: boolean
          launch_budget_usd: number
          locale: string
          manual_api_reserve: number
          manual_reserve_enabled: boolean
          minimum_post_ad_margin_pct: number
          minimum_pre_ad_margin_pct: number
          minimum_roi_pct: number
          new_freshness_hours: number
          new_percent: number
          notification_locale: string | null
          strong_freshness_hours: number
          strong_percent: number
          telegram_chat_id: string | null
          telegram_enabled: boolean
          timezone: string
          updated_at: string
          watch_freshness_hours: number
          watch_percent: number
        }
        Insert: {
          created_at?: string
          daily_api_budget?: number
          id?: boolean
          launch_budget_usd?: number
          locale?: string
          manual_api_reserve?: number
          manual_reserve_enabled?: boolean
          minimum_post_ad_margin_pct?: number
          minimum_pre_ad_margin_pct?: number
          minimum_roi_pct?: number
          new_freshness_hours?: number
          new_percent?: number
          notification_locale?: string | null
          strong_freshness_hours?: number
          strong_percent?: number
          telegram_chat_id?: string | null
          telegram_enabled?: boolean
          timezone?: string
          updated_at?: string
          watch_freshness_hours?: number
          watch_percent?: number
        }
        Update: {
          created_at?: string
          daily_api_budget?: number
          id?: boolean
          launch_budget_usd?: number
          locale?: string
          manual_api_reserve?: number
          manual_reserve_enabled?: boolean
          minimum_post_ad_margin_pct?: number
          minimum_pre_ad_margin_pct?: number
          minimum_roi_pct?: number
          new_freshness_hours?: number
          new_percent?: number
          notification_locale?: string | null
          strong_freshness_hours?: number
          strong_percent?: number
          telegram_chat_id?: string | null
          telegram_enabled?: boolean
          timezone?: string
          updated_at?: string
          watch_freshness_hours?: number
          watch_percent?: number
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          actor_type: string
          created_at: string
          entity_id: string
          entity_type: string
          event_type: string
          id: string
          idempotency_key: string | null
          import_run_id: string | null
          metadata: Json
        }
        Insert: {
          actor_type?: string
          created_at?: string
          entity_id: string
          entity_type: string
          event_type: string
          id?: string
          idempotency_key?: string | null
          import_run_id?: string | null
          metadata?: Json
        }
        Update: {
          actor_type?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          event_type?: string
          id?: string
          idempotency_key?: string | null
          import_run_id?: string | null
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_import_run_id_fkey"
            columns: ["import_run_id"]
            isOneToOne: false
            referencedRelation: "import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_evidence: {
        Row: {
          candidate_id: string
          created_at: string
          id: string
          kind: string
          payload: Json
        }
        Insert: {
          candidate_id: string
          created_at?: string
          id?: string
          kind: string
          payload?: Json
        }
        Update: {
          candidate_id?: string
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "candidate_evidence_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      candidates: {
        Row: {
          created_at: string
          eligible_for_ai_normalization: boolean
          id: string
          import_run_id: string
          keyword: string
          niche_cluster_id: string | null
          normalization_generation: number
          normalized_exact_keyword: string
          preliminary_score: number | null
          preliminary_score_components: Json | null
          representative_raw_keyword_id: string | null
          risk_flags: Json
          rule_passed: boolean
          rule_reasons: Json
          state: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          eligible_for_ai_normalization?: boolean
          id?: string
          import_run_id: string
          keyword: string
          niche_cluster_id?: string | null
          normalization_generation?: number
          normalized_exact_keyword: string
          preliminary_score?: number | null
          preliminary_score_components?: Json | null
          representative_raw_keyword_id?: string | null
          risk_flags?: Json
          rule_passed: boolean
          rule_reasons?: Json
          state: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          eligible_for_ai_normalization?: boolean
          id?: string
          import_run_id?: string
          keyword?: string
          niche_cluster_id?: string | null
          normalization_generation?: number
          normalized_exact_keyword?: string
          preliminary_score?: number | null
          preliminary_score_components?: Json | null
          representative_raw_keyword_id?: string | null
          risk_flags?: Json
          rule_passed?: boolean
          rule_reasons?: Json
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidates_import_run_id_fkey"
            columns: ["import_run_id"]
            isOneToOne: false
            referencedRelation: "import_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidates_niche_cluster_id_fkey"
            columns: ["niche_cluster_id"]
            isOneToOne: false
            referencedRelation: "niche_clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidates_representative_raw_keyword_id_fkey"
            columns: ["representative_raw_keyword_id"]
            isOneToOne: false
            referencedRelation: "raw_opportunity_keywords"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_history: {
        Row: {
          candidate_id: string
          created_at: string
          decided_at: string
          decided_by: string
          from_state: string | null
          id: string
          idempotency_key: string | null
          reasons: Json
          to_state: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          decided_at?: string
          decided_by?: string
          from_state?: string | null
          id?: string
          idempotency_key?: string | null
          reasons?: Json
          to_state: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          decided_at?: string
          decided_by?: string
          from_state?: string | null
          id?: string
          idempotency_key?: string | null
          reasons?: Json
          to_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "decision_history_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      import_runs: {
        Row: {
          accepted_count: number
          completed_at: string | null
          created_at: string
          duplicate_keyword_count: number
          error_message: string | null
          file_count: number
          id: string
          locale: string
          rejected_count: number
          source_files: Json
          started_at: string | null
          status: string
          submission_hash: string
          total_row_count: number
          unique_keyword_count: number
          updated_at: string
        }
        Insert: {
          accepted_count?: number
          completed_at?: string | null
          created_at?: string
          duplicate_keyword_count?: number
          error_message?: string | null
          file_count?: number
          id?: string
          locale?: string
          rejected_count?: number
          source_files?: Json
          started_at?: string | null
          status?: string
          submission_hash: string
          total_row_count?: number
          unique_keyword_count?: number
          updated_at?: string
        }
        Update: {
          accepted_count?: number
          completed_at?: string | null
          created_at?: string
          duplicate_keyword_count?: number
          error_message?: string | null
          file_count?: number
          id?: string
          locale?: string
          rejected_count?: number
          source_files?: Json
          started_at?: string | null
          status?: string
          submission_hash?: string
          total_row_count?: number
          unique_keyword_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      jobs: {
        Row: {
          attempts: number
          available_at: string
          checkpoint: Json
          created_at: string
          id: string
          idempotency_key: string
          last_error: string | null
          leased_by: string | null
          leased_until: string | null
          max_attempts: number
          payload: Json
          priority: number
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          checkpoint?: Json
          created_at?: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          leased_by?: string | null
          leased_until?: string | null
          max_attempts?: number
          payload?: Json
          priority?: number
          status: string
          type: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          checkpoint?: Json
          created_at?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          leased_by?: string | null
          leased_until?: string | null
          max_attempts?: number
          payload?: Json
          priority?: number
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      market_snapshots: {
        Row: {
          candidate_id: string | null
          captured_at: string
          confidence: number
          created_at: string
          estimated_market_sales: number | null
          id: string
          metrics: Json
          niche_cluster_id: string | null
          observed_sample_sales: number
          sample_product_family_count: number
          source_endpoint_set: Json
        }
        Insert: {
          candidate_id?: string | null
          captured_at?: string
          confidence?: number
          created_at?: string
          estimated_market_sales?: number | null
          id?: string
          metrics?: Json
          niche_cluster_id?: string | null
          observed_sample_sales?: number
          sample_product_family_count?: number
          source_endpoint_set?: Json
        }
        Update: {
          candidate_id?: string | null
          captured_at?: string
          confidence?: number
          created_at?: string
          estimated_market_sales?: number | null
          id?: string
          metrics?: Json
          niche_cluster_id?: string | null
          observed_sample_sales?: number
          sample_product_family_count?: number
          source_endpoint_set?: Json
        }
        Relationships: [
          {
            foreignKeyName: "market_snapshots_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_snapshots_niche_cluster_id_fkey"
            columns: ["niche_cluster_id"]
            isOneToOne: false
            referencedRelation: "niche_clusters"
            referencedColumns: ["id"]
          },
        ]
      }
      niche_cluster_keywords: {
        Row: {
          created_at: string
          niche_cluster_id: string
          raw_opportunity_keyword_id: string
        }
        Insert: {
          created_at?: string
          niche_cluster_id: string
          raw_opportunity_keyword_id: string
        }
        Update: {
          created_at?: string
          niche_cluster_id?: string
          raw_opportunity_keyword_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "niche_cluster_keywords_niche_cluster_id_fkey"
            columns: ["niche_cluster_id"]
            isOneToOne: false
            referencedRelation: "niche_clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "niche_cluster_keywords_raw_opportunity_keyword_id_fkey"
            columns: ["raw_opportunity_keyword_id"]
            isOneToOne: false
            referencedRelation: "raw_opportunity_keywords"
            referencedColumns: ["id"]
          },
        ]
      }
      niche_clusters: {
        Row: {
          aliases: Json
          canonical_english: string | null
          canonical_key: string
          canonical_name: string
          catalog_phrases: Json
          created_at: string
          id: string
          state: string
          updated_at: string
        }
        Insert: {
          aliases?: Json
          canonical_english?: string | null
          canonical_key: string
          canonical_name: string
          catalog_phrases?: Json
          created_at?: string
          id?: string
          state?: string
          updated_at?: string
        }
        Update: {
          aliases?: Json
          canonical_english?: string | null
          canonical_key?: string
          canonical_name?: string
          catalog_phrases?: Json
          created_at?: string
          id?: string
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      normalization_writer_capability: {
        Row: {
          migration_identity: string | null
          mode: string
          singleton: boolean
          updated_at: string
        }
        Insert: {
          migration_identity?: string | null
          mode: string
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          migration_identity?: string | null
          mode?: string
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      normalized_candidate_finalizations: {
        Row: {
          analysis_id: string
          candidate_id: string
          created_at: string
          decision_id: string
          finalized_output_sha256: string
          niche_cluster_id: string | null
          normalization_generation: number
          target_state: string
          winning_attempt_id: string
        }
        Insert: {
          analysis_id: string
          candidate_id: string
          created_at?: string
          decision_id: string
          finalized_output_sha256: string
          niche_cluster_id?: string | null
          normalization_generation: number
          target_state: string
          winning_attempt_id: string
        }
        Update: {
          analysis_id?: string
          candidate_id?: string
          created_at?: string
          decision_id?: string
          finalized_output_sha256?: string
          niche_cluster_id?: string | null
          normalization_generation?: number
          target_state?: string
          winning_attempt_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "normalized_candidate_finalizations_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "ai_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_candidate_finalizations_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_candidate_finalizations_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "decision_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_candidate_finalizations_niche_cluster_id_fkey"
            columns: ["niche_cluster_id"]
            isOneToOne: false
            referencedRelation: "niche_clusters"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          attempts: number
          candidate_id: string | null
          created_at: string
          delivered_at: string | null
          event_type: string
          id: string
          idempotency_key: string
          last_error: string | null
          locale: string
          payload: Json
          research_run_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          candidate_id?: string | null
          created_at?: string
          delivered_at?: string | null
          event_type: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          locale?: string
          payload?: Json
          research_run_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          candidate_id?: string | null
          created_at?: string
          delivered_at?: string | null
          event_type?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          locale?: string
          payload?: Json
          research_run_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_research_run_id_fkey"
            columns: ["research_run_id"]
            isOneToOne: false
            referencedRelation: "research_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      product_families: {
        Row: {
          created_at: string
          id: string
          niche_cluster_id: string | null
          observed_monthly_revenue: number | null
          observed_monthly_units: number | null
          parent_key: string
          quality_notes: Json
          updated_at: string
          variant_count: number
        }
        Insert: {
          created_at?: string
          id?: string
          niche_cluster_id?: string | null
          observed_monthly_revenue?: number | null
          observed_monthly_units?: number | null
          parent_key: string
          quality_notes?: Json
          updated_at?: string
          variant_count?: number
        }
        Update: {
          created_at?: string
          id?: string
          niche_cluster_id?: string | null
          observed_monthly_revenue?: number | null
          observed_monthly_units?: number | null
          parent_key?: string
          quality_notes?: Json
          updated_at?: string
          variant_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_families_niche_cluster_id_fkey"
            columns: ["niche_cluster_id"]
            isOneToOne: false
            referencedRelation: "niche_clusters"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          asin: string
          attributes: Json
          brand: string | null
          created_at: string
          id: string
          niche_cluster_id: string | null
          parent_asin: string | null
          price: number | null
          product_family_id: string
          rating: number | null
          reviews: number | null
          seller_type: string | null
          title: string | null
        }
        Insert: {
          asin: string
          attributes?: Json
          brand?: string | null
          created_at?: string
          id?: string
          niche_cluster_id?: string | null
          parent_asin?: string | null
          price?: number | null
          product_family_id: string
          rating?: number | null
          reviews?: number | null
          seller_type?: string | null
          title?: string | null
        }
        Update: {
          asin?: string
          attributes?: Json
          brand?: string | null
          created_at?: string
          id?: string
          niche_cluster_id?: string | null
          parent_asin?: string | null
          price?: number | null
          product_family_id?: string
          rating?: number | null
          reviews?: number | null
          seller_type?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_niche_cluster_id_fkey"
            columns: ["niche_cluster_id"]
            isOneToOne: false
            referencedRelation: "niche_clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_product_family_id_fkey"
            columns: ["product_family_id"]
            isOneToOne: false
            referencedRelation: "product_families"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_attempt_events: {
        Row: {
          adapter: string | null
          analysis_lease_epoch: number
          analysis_lease_owner: string
          attempt_id: string
          attempt_sequence: number
          auth_generation: number
          billing_type: string
          consumption_status: string | null
          created_at: string
          detected_at: string | null
          event_id: string
          event_type: string
          execution_fingerprint: string
          fallback_parent_attempt_id: string | null
          finished_at: string | null
          input_tokens: number | null
          job_id: string
          job_lease_epoch: number
          job_lease_owner: string
          latency_ms: number | null
          logical_analysis_id: string
          model_id: string
          output_tokens: number | null
          probe_generation: number | null
          proof_category: string | null
          provider_id: string
          provider_request_count: number | null
          request_count: number
          result_class: string | null
          role: string
          safe_metadata: Json
          settings_revision: number
          started_at: string
        }
        Insert: {
          adapter?: string | null
          analysis_lease_epoch: number
          analysis_lease_owner: string
          attempt_id: string
          attempt_sequence: number
          auth_generation: number
          billing_type: string
          consumption_status?: string | null
          created_at?: string
          detected_at?: string | null
          event_id?: string
          event_type: string
          execution_fingerprint: string
          fallback_parent_attempt_id?: string | null
          finished_at?: string | null
          input_tokens?: number | null
          job_id: string
          job_lease_epoch: number
          job_lease_owner: string
          latency_ms?: number | null
          logical_analysis_id: string
          model_id: string
          output_tokens?: number | null
          probe_generation?: number | null
          proof_category?: string | null
          provider_id: string
          provider_request_count?: number | null
          request_count: number
          result_class?: string | null
          role: string
          safe_metadata?: Json
          settings_revision: number
          started_at?: string
        }
        Update: {
          adapter?: string | null
          analysis_lease_epoch?: number
          analysis_lease_owner?: string
          attempt_id?: string
          attempt_sequence?: number
          auth_generation?: number
          billing_type?: string
          consumption_status?: string | null
          created_at?: string
          detected_at?: string | null
          event_id?: string
          event_type?: string
          execution_fingerprint?: string
          fallback_parent_attempt_id?: string | null
          finished_at?: string | null
          input_tokens?: number | null
          job_id?: string
          job_lease_epoch?: number
          job_lease_owner?: string
          latency_ms?: number | null
          logical_analysis_id?: string
          model_id?: string
          output_tokens?: number | null
          probe_generation?: number | null
          proof_category?: string | null
          provider_id?: string
          provider_request_count?: number | null
          request_count?: number
          result_class?: string | null
          role?: string
          safe_metadata?: Json
          settings_revision?: number
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_attempt_events_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "ai_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_secrets: {
        Row: {
          auth_tag: string
          ciphertext: string
          created_at: string
          iv: string
          last4: string
          provider_id: string
          rotated_at: string
        }
        Insert: {
          auth_tag: string
          ciphertext: string
          created_at?: string
          iv: string
          last4: string
          provider_id: string
          rotated_at?: string
        }
        Update: {
          auth_tag?: string
          ciphertext?: string
          created_at?: string
          iv?: string
          last4?: string
          provider_id?: string
          rotated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_secrets_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: true
            referencedRelation: "ai_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_opportunity_keywords: {
        Row: {
          created_at: string
          duplicate_of: string | null
          id: string
          import_run_id: string
          imported_at: string
          is_exact_duplicate: boolean
          keyword: string
          normalized_exact_keyword: string
          parsed_row: Json | null
          raw_row: Json
          raw_row_text: string
          row_hash: string
          source_file_name: string
          source_hash: string
          source_row_number: number
        }
        Insert: {
          created_at?: string
          duplicate_of?: string | null
          id?: string
          import_run_id: string
          imported_at?: string
          is_exact_duplicate?: boolean
          keyword: string
          normalized_exact_keyword: string
          parsed_row?: Json | null
          raw_row: Json
          raw_row_text: string
          row_hash: string
          source_file_name: string
          source_hash: string
          source_row_number: number
        }
        Update: {
          created_at?: string
          duplicate_of?: string | null
          id?: string
          import_run_id?: string
          imported_at?: string
          is_exact_duplicate?: boolean
          keyword?: string
          normalized_exact_keyword?: string
          parsed_row?: Json | null
          raw_row?: Json
          raw_row_text?: string
          row_hash?: string
          source_file_name?: string
          source_hash?: string
          source_row_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "raw_opportunity_keywords_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "raw_opportunity_keywords"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_opportunity_keywords_import_run_id_fkey"
            columns: ["import_run_id"]
            isOneToOne: false
            referencedRelation: "import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      research_runs: {
        Row: {
          checkpoint: Json
          completed_at: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          idempotency_key: string
          locale: string
          logical_run_date: string
          mode: string
          selected_candidate_ids: Json
          source: string
          started_at: string | null
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          checkpoint?: Json
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          idempotency_key: string
          locale?: string
          logical_run_date: string
          mode?: string
          selected_candidate_ids?: Json
          source: string
          started_at?: string | null
          status?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          checkpoint?: Json
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          idempotency_key?: string
          locale?: string
          logical_run_date?: string
          mode?: string
          selected_candidate_ids?: Json
          source?: string
          started_at?: string | null
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      risks: {
        Row: {
          candidate_id: string
          code: string
          created_at: string
          detail: string
          id: string
        }
        Insert: {
          candidate_id: string
          code: string
          created_at?: string
          detail: string
          id?: string
        }
        Update: {
          candidate_id?: string
          code?: string
          created_at?: string
          detail?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "risks_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_run_locks: {
        Row: {
          created_at: string
          research_run_id: string
          run_date: string
        }
        Insert: {
          created_at?: string
          research_run_id: string
          run_date: string
        }
        Update: {
          created_at?: string
          research_run_id?: string
          run_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_run_locks_research_run_id_fkey"
            columns: ["research_run_id"]
            isOneToOne: true
            referencedRelation: "research_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      score_history: {
        Row: {
          candidate_id: string
          components: Json
          created_at: string
          id: string
          idempotency_key: string | null
          score: number
          score_type: string
          source_data_timestamp: string | null
        }
        Insert: {
          candidate_id: string
          components: Json
          created_at?: string
          id?: string
          idempotency_key?: string | null
          score: number
          score_type: string
          source_data_timestamp?: string | null
        }
        Update: {
          candidate_id?: string
          components?: Json
          created_at?: string
          id?: string
          idempotency_key?: string | null
          score?: number
          score_type?: string
          source_data_timestamp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "score_history_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_dashboard_counts: {
        Args: { entity: string }
        Returns: Json
      }
      acquire_admin_login_scrypt: {
        Args: { lease_seconds: number; lock_owner: string }
        Returns: boolean
      }
      activate_subscription_provider: {
        Args: {
          expected_auth_generation: number
          expected_execution_fingerprint: string
          expected_settings_revision: number
          model_id: string
          provider_id: string
          terms_digest: string
        }
        Returns: Json
      }
      advance_daily_research_checkpoint: {
        Args: {
          next_checkpoint: Json
          next_completed_at: string
          next_status: string
          run_id: string
        }
        Returns: boolean
      }
      append_ai_provider_attempt_outcome: {
        Args: {
          analysis_id: string
          analysis_lease_epoch: number
          analysis_lease_owner: string
          attempt_id: string
          consumption_status: string
          event_type: string
          input_tokens?: number
          job_id: string
          job_lease_epoch: number
          job_lease_owner: string
          latency_ms?: number
          output?: Json
          output_tokens?: number
          proof_category?: string
          provider_request_count?: number
          result_class: string
          safe_metadata?: Json
          usage?: Json
        }
        Returns: Json
      }
      append_candidate_reason: {
        Args: { existing: Json; reason_code: string; reason_detail: string }
        Returns: Json
      }
      apply_ai_provider_runtime_failure: {
        Args: {
          analysis_id: string
          analysis_lease_epoch: number
          analysis_lease_owner: string
          attempt_id: string
          failure_class: string
          job_id: string
          job_lease_epoch: number
          job_lease_owner: string
          retry_after_seconds?: number
        }
        Returns: Json
      }
      assert_ai_usage: { Args: { value: Json }; Returns: undefined }
      assert_current_analysis_lease: {
        Args: {
          allowed_status: string
          analysis_id: string
          lease_epoch: number
          lease_owner: string
        }
        Returns: {
          attempts: number
          available_at: string
          completed_at: string | null
          cost_class: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          input_hash: string
          input_payload: Json
          last_error: string | null
          leased_by: string | null
          leased_until: string | null
          locale: string
          model_id: string
          output: Json | null
          output_sha256: string | null
          pending_output: Json | null
          pending_usage: Json | null
          pending_winner_attempt_id: string | null
          prompt_version: string
          provider_id: string
          role: string
          started_at: string
          status: string
          usage: Json
          winning_attempt_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "ai_analyses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assert_current_job_lease: {
        Args: { job_id: string; lease_epoch: number; lease_owner: string }
        Returns: {
          attempts: number
          available_at: string
          checkpoint: Json
          created_at: string
          id: string
          idempotency_key: string
          last_error: string | null
          leased_by: string | null
          leased_until: string | null
          max_attempts: number
          payload: Json
          priority: number
          status: string
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assert_normalization_job_payload: {
        Args: {
          candidate_id: string
          normalization_generation: number
          payload: Json
        }
        Returns: undefined
      }
      assert_normalization_output: { Args: { value: Json }; Returns: undefined }
      authorize_api_call: {
        Args: {
          daily_limit: number
          endpoint: string
          estimated_calls: number
          purpose: string
          request_budget_date?: string
          request_cache_key: string
          reserved_limit: number
        }
        Returns: {
          cache_key: string
          decision_kind: string
          remaining: number
        }[]
      }
      authorize_owned_api_call: {
        Args: {
          claim_owner: string
          daily_limit: number
          endpoint: string
          estimated_calls: number
          purpose: string
          request_budget_date?: string
          request_cache_key: string
          reserved_limit: number
        }
        Returns: {
          cache_key: string
          decision_kind: string
          remaining: number
        }[]
      }
      begin_ai_provider_attempt: {
        Args: {
          analysis_id: string
          analysis_lease_epoch: number
          analysis_lease_owner: string
          expected_auth_generation: number
          expected_execution_fingerprint: string
          expected_settings_revision: number
          fallback_parent_attempt_id?: string
          initial_payg_primary_authorized?: boolean
          job_id: string
          job_lease_epoch: number
          job_lease_owner: string
          model_id: string
          provider_id: string
        }
        Returns: Json
      }
      canonical_niche_key: { Args: { value: string }; Returns: string }
      checkpoint_job: {
        Args: {
          checkpoint: Json
          job_id: string
          job_lease_epoch: number
          lease_seconds: number
          worker_id: string
        }
        Returns: boolean
      }
      claim_ai_analysis: {
        Args: {
          analysis_input_hash: string
          analysis_locale: string
          analysis_role: string
          input_payload: Json
          lease_seconds: number
          model_id: string
          prompt_version: string
          provider_id: string
          worker_id: string
        }
        Returns: {
          analysis_id: string
          analysis_lease_epoch: number
          claim_status: string
          output: Json
          usage: Json
        }[]
      }
      claim_api_call: {
        Args: {
          claim_owner: string
          lease_seconds: number
          request_cache_key: string
        }
        Returns: {
          claimed_cache_key: string
          decision_kind: string
        }[]
      }
      claim_completed_ai_analysis_finalization: {
        Args: {
          analysis_id: string
          candidate_id: string
          expected_candidate_state: string
          expected_normalization_generation: number
          job_id: string
          job_lease_epoch: number
          job_lease_owner: string
          lease_seconds: number
          new_analysis_lease_owner: string
        }
        Returns: Json
      }
      claim_jobs: {
        Args: { job_limit: number; lease_seconds: number; worker_id: string }
        Returns: {
          attempts: number
          available_at: string
          checkpoint: Json
          created_at: string
          id: string
          idempotency_key: string
          last_error: string | null
          leased_by: string | null
          leased_until: string | null
          max_attempts: number
          payload: Json
          priority: number
          status: string
          type: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      commit_ai_provider_acceptance_probe: {
        Args: {
          adapter: string
          binary_identity_digest: string
          bounded_behavior_digest: string
          capability_digest: string
          containment_digest: string
          credential_source_digest: string
          evidence: Json
          expected_auth_generation: number
          expected_execution_fingerprint: string
          expected_settings_revision: number
          framing_digest: string
          model_id: string
          provider_id: string
          readiness_policy_version: string
          security_profile_digest: string
          security_profile_version: string
          terms_digest: string
        }
        Returns: Json
      }
      commit_ai_provider_probe: {
        Args: {
          binary_identity_digest: string
          bounded_behavior_digest: string
          capability_digest: string
          containment_digest: string
          credential_source_digest: string
          expected_auth_generation: number
          expected_execution_fingerprint: string
          expected_probe_generation: number
          expected_settings_revision: number
          framing_digest: string
          model_id: string
          provider_id: string
          security_profile_digest: string
          terms_digest: string
        }
        Returns: Json
      }
      complete_ai_analysis: {
        Args: {
          analysis_id: string
          analysis_lease_epoch: number
          analysis_output: Json
          analysis_usage: Json
          completed_at: string
          cost_class: string
          worker_id: string
        }
        Returns: boolean
      }
      complete_api_call_claim: {
        Args: { claim_owner: string; request_cache_key: string }
        Returns: boolean
      }
      complete_job: {
        Args: {
          checkpoint: Json
          job_id: string
          job_lease_epoch: number
          worker_id: string
        }
        Returns: boolean
      }
      consume_admin_login_attempt: {
        Args: {
          client_identity_hash: string
          global_max_attempts: number
          per_client_max_attempts: number
          window_seconds: number
        }
        Returns: boolean
      }
      deactivate_subscription_provider: {
        Args: { provider_id: string }
        Returns: Json
      }
      defer_candidate_normalization: {
        Args: {
          analysis_id: string
          candidate_id: string
          expected_candidate_state: string
          expected_normalization_generation: number
          job_id: string
          job_lease_epoch: number
          job_lease_owner: string
        }
        Returns: Json
      }
      enqueue_ai_provider_probe_locked: {
        Args: {
          provider_row: Database["public"]["Tables"]["ai_providers"]["Row"]
          runtime_row: Database["public"]["Tables"]["ai_provider_runtime_state"]["Row"]
        }
        Returns: Json
      }
      enqueue_initial_candidate_normalization: {
        Args: { candidate_id: string; locale: string; writer_mode: string }
        Returns: Json
      }
      enqueue_manual_research: {
        Args: { logical_date: string; research_mode: string }
        Returns: string
      }
      expire_ai_provider_ready_lease: {
        Args: {
          expected_auth_generation: number
          expected_execution_fingerprint: string
          expected_settings_revision: number
          provider_id: string
        }
        Returns: Json
      }
      fail_ai_analysis: {
        Args: {
          analysis_id: string
          analysis_lease_epoch: number
          error_code: string
          retry_at: string
          worker_id: string
        }
        Returns: boolean
      }
      fail_job: {
        Args: {
          checkpoint: Json
          error_text: string
          job_id: string
          job_lease_epoch: number
          retry_at: string
          worker_id: string
        }
        Returns: boolean
      }
      fence_ai_provider_auth: {
        Args: {
          expected_auth_generation: number
          expected_execution_fingerprint: string
          expected_settings_revision: number
          provider_id: string
        }
        Returns: Json
      }
      finalize_ai_analysis_from_attempt: {
        Args: {
          analysis_id: string
          analysis_lease_epoch: number
          analysis_lease_owner: string
          attempt_id: string
          job_id: string
          job_lease_epoch: number
          job_lease_owner: string
        }
        Returns: Json
      }
      finalize_normalized_candidate: {
        Args: {
          analysis_id: string
          analysis_lease_epoch: number
          analysis_lease_owner: string
          candidate_id: string
          expected_candidate_state: string
          expected_normalization_generation: number
          job_id: string
          job_lease_epoch: number
          job_lease_owner: string
        }
        Returns: Json
      }
      heartbeat_job: {
        Args: {
          job_id: string
          job_lease_epoch: number
          lease_seconds: number
          worker_id: string
        }
        Returns: boolean
      }
      is_ai_provider_routable: {
        Args: {
          expected_auth_generation: number
          expected_execution_fingerprint: string
          expected_settings_revision: number
          model_id: string
          provider_id: string
        }
        Returns: boolean
      }
      jsonb_text_array_union: {
        Args: { left_value: Json; right_value: Json }
        Returns: Json
      }
      mark_api_call_reserved: {
        Args: { request_budget_date: string; request_cache_key: string }
        Returns: boolean
      }
      publish_daily_research_plan: {
        Args: {
          plan_candidate_ids: Json
          plan_checkpoint: Json
          plan_started_at: string
          run_id: string
        }
        Returns: boolean
      }
      read_normalization_writer_capability: { Args: never; Returns: Json }
      rearm_candidate_normalization: {
        Args: {
          candidate_id: string
          expected_candidate_state: string
          expected_normalization_generation: number
          locale: string
        }
        Returns: Json
      }
      reconcile_ai_provider_attempts: {
        Args: {
          analysis_id: string
          analysis_lease_epoch: number
          analysis_lease_owner: string
          job_id: string
          job_lease_epoch: number
          job_lease_owner: string
        }
        Returns: Json
      }
      record_ai_provider_execution_probe: {
        Args: { expected_fingerprint: string; probe: Json; provider_id: string }
        Returns: boolean
      }
      record_api_usage_for_claim: {
        Args: {
          claim_owner: string
          request_cache_key: string
          usage_budget_date: string
          usage_cached: boolean
          usage_call_count: number
          usage_candidate_id: string
          usage_endpoint: string
          usage_http_status: number
          usage_purpose: string
          usage_retry_count: number
          usage_success: boolean
        }
        Returns: boolean
      }
      record_failed_ai_usage: {
        Args: {
          analysis_id: string
          analysis_lease_epoch: number
          analysis_usage: Json
          worker_id: string
        }
        Returns: boolean
      }
      release_admin_login_scrypt: {
        Args: { lock_owner: string }
        Returns: boolean
      }
      renew_ai_analysis_lease: {
        Args: {
          analysis_id: string
          analysis_lease_epoch: number
          lease_seconds: number
          worker_id: string
        }
        Returns: boolean
      }
      request_ai_provider_probe: {
        Args: {
          expected_auth_generation: number
          expected_execution_fingerprint: string
          expected_settings_revision: number
          provider_id: string
        }
        Returns: Json
      }
      save_ai_provider_settings: {
        Args: {
          expected_revision?: number
          model_status?: Json
          models: Json
          provider_row: Json
          reconcile_mode: string
          secret_row: Json
        }
        Returns: Json
      }
      stage_api_call_response: {
        Args: { claim_owner: string; request_cache_key: string; response: Json }
        Returns: boolean
      }
      terminalize_expired_exhausted_jobs: { Args: never; Returns: number }
      upsert_niche_cluster: {
        Args: {
          aliases: Json
          canonical_english: string
          canonical_key: string
          canonical_name: string
          catalog_phrases: Json
          cluster_state: string
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

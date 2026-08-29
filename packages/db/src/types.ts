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
      app_settings: {
        Row: {
          created_at: string
          daily_api_budget: number
          id: boolean
          locale: string
          manual_api_reserve: number
          manual_reserve_enabled: boolean
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
          locale?: string
          manual_api_reserve?: number
          manual_reserve_enabled?: boolean
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
          locale?: string
          manual_api_reserve?: number
          manual_reserve_enabled?: boolean
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
          prompt_version: string
          provider_id: string
          role: string
          started_at: string
          status: string
          usage: Json
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
          prompt_version: string
          provider_id: string
          role: string
          started_at: string
          status?: string
          usage?: Json
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
          prompt_version?: string
          provider_id?: string
          role?: string
          started_at?: string
          status?: string
          usage?: Json
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
      ai_providers: {
        Row: {
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
        Relationships: []
      }
      candidates: {
        Row: {
          created_at: string
          eligible_for_ai_normalization: boolean
          id: string
          import_run_id: string
          keyword: string
          niche_cluster_id: string | null
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
          canonical_name: string
          catalog_phrases: Json
          created_at: string
          id: string
          state: string
          canonical_key: string
          updated_at: string
        }
        Insert: {
          aliases?: Json
          canonical_english?: string | null
          canonical_name: string
          catalog_phrases?: Json
          created_at?: string
          id?: string
          state?: string
          canonical_key: string
          updated_at?: string
        }
        Update: {
          aliases?: Json
          canonical_english?: string | null
          canonical_name?: string
          catalog_phrases?: Json
          created_at?: string
          id?: string
          state?: string
          canonical_key?: string
          updated_at?: string
        }
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      authorize_api_call: {
        Args: {
          purpose: string
          estimated_calls: number
          request_cache_key: string
          endpoint: string
          daily_limit: number
          reserved_limit: number
          request_budget_date?: string
        }
        Returns: {
          decision_kind: string
          cache_key: string
          remaining: number | null
        }[]
      }
      authorize_owned_api_call: {
        Args: {
          request_cache_key: string
          claim_owner: string
          purpose: string
          estimated_calls: number
          endpoint: string
          daily_limit: number
          reserved_limit: number
          request_budget_date?: string
        }
        Returns: {
          decision_kind: string
          cache_key: string
          remaining: number | null
        }[]
      }
      claim_api_call: {

        Args: {
          request_cache_key: string
          claim_owner: string
          lease_seconds: number
        }
        Returns: {
          decision_kind: string
          claimed_cache_key: string
        }[]
      }

      complete_api_call_claim: {
        Args: {
          request_cache_key: string
          claim_owner: string
        }
        Returns: boolean
      }
      mark_api_call_reserved: {
        Args: {
          request_cache_key: string
          request_budget_date: string
        }
        Returns: boolean
      }
      stage_api_call_response: {
        Args: {
          request_cache_key: string
          claim_owner: string
          response: Json
        }
        Returns: boolean
      }
      record_api_usage_for_claim: {
        Args: {
          request_cache_key: string
          claim_owner: string
          usage_endpoint: string
          usage_purpose: string
          usage_http_status: number
          usage_call_count: number
          usage_retry_count: number
          usage_cached: boolean
          usage_success: boolean
          usage_candidate_id: string
          usage_budget_date: string
        }
        Returns: boolean
      }


      claim_ai_analysis: {
        Args: {
          analysis_role: string
          analysis_input_hash: string
          worker_id: string
          lease_seconds: number
          provider_id: string
          model_id: string
          analysis_locale: string
          prompt_version: string
          input_payload: Json
        }
        Returns: {
          analysis_id: string
          claim_status: string
          output: Json | null
          usage: Json | null
        }[]
      }
      complete_ai_analysis: {
        Args: {
          analysis_id: string
          worker_id: string
          analysis_output: Json
          analysis_usage: Json
          cost_class: string
          completed_at: string
        }
        Returns: boolean
      }
      fail_ai_analysis: {
        Args: {
          analysis_id: string
          worker_id: string
          error_code: string
          retry_at: string
        }
        Returns: boolean
      }
      renew_ai_analysis_lease: {
        Args: {
          analysis_id: string
          worker_id: string
          lease_seconds: number
        }
        Returns: boolean
      }
      upsert_niche_cluster: {
        Args: {
          canonical_key: string
          canonical_name: string
          canonical_english: string | null
          aliases: Json
          catalog_phrases: Json
          cluster_state: string
        }
        Returns: string
      }
      save_ai_provider_settings: {
        Args: {
          provider_row: Json
          secret_row: Json | null
          models: Json | null
          reconcile_mode: string
          model_status?: Json
          expected_revision?: number | null
        }
        Returns: Json
      }
      record_ai_provider_execution_probe: {
        Args: {
          provider_id: string
          expected_fingerprint: string
          probe: Json
        }
        Returns: boolean
      }
      consume_admin_login_attempt: {
        Args: {
          max_attempts: number
          window_seconds: number
        }
        Returns: boolean
      }
      acquire_admin_login_scrypt: {
        Args: {
          lock_owner: string
          lease_seconds: number
        }
        Returns: boolean
      }
      release_admin_login_scrypt: {
        Args: {
          lock_owner: string
        }
        Returns: boolean
      }
      record_failed_ai_usage: {
        Args: {
          analysis_id: string
          worker_id: string
          analysis_usage: Json
        }
        Returns: boolean
      }
      checkpoint_job: {
        Args: {
          checkpoint: Json
          job_id: string
          lease_seconds: number
          worker_id: string
        }
        Returns: boolean
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
      complete_job: {
        Args: { checkpoint: Json; job_id: string; worker_id: string }
        Returns: boolean
      }
      fail_job: {
        Args: {
          checkpoint: Json
          error_text: string
          job_id: string
          retry_at: string
          worker_id: string
        }
        Returns: boolean
      }
      heartbeat_job: {
        Args: { job_id: string; lease_seconds: number; worker_id: string }
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
      advance_daily_research_checkpoint: {
        Args: {
          next_checkpoint: Json
          next_completed_at: string | null
          next_status: string
          run_id: string
        }
        Returns: boolean
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


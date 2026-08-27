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
      audit_events: {
        Row: {
          actor_type: string
          created_at: string
          entity_id: string
          entity_type: string
          event_type: string
          id: string
          metadata: Json
        }
        Insert: {
          actor_type?: string
          created_at?: string
          entity_id: string
          entity_type: string
          event_type: string
          id?: string
          metadata?: Json
        }
        Update: {
          actor_type?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          event_type?: string
          id?: string
          metadata?: Json
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
          canonical_name: string
          created_at: string
          id: string
          state: string
          updated_at: string
        }
        Insert: {
          canonical_name: string
          created_at?: string
          id?: string
          state?: string
          updated_at?: string
        }
        Update: {
          canonical_name?: string
          created_at?: string
          id?: string
          state?: string
          updated_at?: string
        }
        Relationships: []
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
          score: number
          score_type: string
          source_data_timestamp: string | null
        }
        Insert: {
          candidate_id: string
          components: Json
          created_at?: string
          id?: string
          score: number
          score_type: string
          source_data_timestamp?: string | null
        }
        Update: {
          candidate_id?: string
          components?: Json
          created_at?: string
          id?: string
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


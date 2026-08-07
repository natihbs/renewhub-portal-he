export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      metric_facts: {
        Row: {
          computed_at: string
          created_at: string
          eligible_count: number
          eligible_value: number
          engaged_count: number
          engaged_value: number
          expired_unworked_count: number
          expired_unworked_value: number
          freshness_state: string
          granularity: string
          id: string
          metric_key: string
          pending_count: number
          pending_value: number
          period_end: string
          period_start: string
          scope_id: string
          scope_lineage: Json
          source_batch_id: string | null
          work_type_id: string
        }
        Insert: {
          computed_at?: string
          created_at?: string
          eligible_count?: number
          eligible_value?: number
          engaged_count?: number
          engaged_value?: number
          expired_unworked_count?: number
          expired_unworked_value?: number
          freshness_state: string
          granularity?: string
          id?: string
          metric_key: string
          pending_count?: number
          pending_value?: number
          period_end: string
          period_start: string
          scope_id: string
          scope_lineage: Json
          source_batch_id?: string | null
          work_type_id: string
        }
        Update: {
          computed_at?: string
          created_at?: string
          eligible_count?: number
          eligible_value?: number
          engaged_count?: number
          engaged_value?: number
          expired_unworked_count?: number
          expired_unworked_value?: number
          freshness_state?: string
          granularity?: string
          id?: string
          metric_key?: string
          pending_count?: number
          pending_value?: number
          period_end?: string
          period_start?: string
          scope_id?: string
          scope_lineage?: Json
          source_batch_id?: string | null
          work_type_id?: string
        }
        Relationships: []
      }
      ingestion_sources: {
        Row: {
          active: boolean
          created_at: string
          display_name: string
          freshness_critical_hours: number
          freshness_warning_hours: number
          id: string
          ingestion_mode: string
          key: string
          max_invalid_row_pct: number
          updated_at: string
          volume_baseline_batches: number
          volume_floor_pct: number
          work_type_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_name: string
          freshness_critical_hours?: number
          freshness_warning_hours?: number
          id?: string
          ingestion_mode?: string
          key: string
          max_invalid_row_pct?: number
          updated_at?: string
          volume_baseline_batches?: number
          volume_floor_pct?: number
          work_type_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_name?: string
          freshness_critical_hours?: number
          freshness_warning_hours?: number
          id?: string
          ingestion_mode?: string
          key?: string
          max_invalid_row_pct?: number
          updated_at?: string
          volume_baseline_batches?: number
          volume_floor_pct?: number
          work_type_id?: string
        }
        Relationships: []
      }
      ingestion_batches: {
        Row: {
          checksum: string | null
          completed_at: string | null
          created_at: string
          duration_ms: number | null
          external_batch_ref: string | null
          id: string
          rejection_code: string | null
          rejection_detail: string | null
          row_count: number
          rows_inserted: number
          rows_rejected: number
          rows_unchanged: number
          rows_updated: number
          rows_voided: number
          source_id: string
          staged_at: string | null
          started_at: string
          status: string
          trigger_kind: string
          triggered_by: string | null
          validated_at: string | null
          validation_result: Json | null
        }
        Insert: {
          checksum?: string | null
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          external_batch_ref?: string | null
          id?: string
          rejection_code?: string | null
          rejection_detail?: string | null
          row_count?: number
          rows_inserted?: number
          rows_rejected?: number
          rows_unchanged?: number
          rows_updated?: number
          rows_voided?: number
          source_id: string
          staged_at?: string | null
          started_at?: string
          status?: string
          trigger_kind?: string
          triggered_by?: string | null
          validated_at?: string | null
          validation_result?: Json | null
        }
        Update: {
          checksum?: string | null
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          external_batch_ref?: string | null
          id?: string
          rejection_code?: string | null
          rejection_detail?: string | null
          row_count?: number
          rows_inserted?: number
          rows_rejected?: number
          rows_unchanged?: number
          rows_updated?: number
          rows_voided?: number
          source_id?: string
          staged_at?: string | null
          started_at?: string
          status?: string
          trigger_kind?: string
          triggered_by?: string | null
          validated_at?: string | null
          validation_result?: Json | null
        }
        Relationships: []
      }
      ingestion_staging_rows: {
        Row: {
          batch_id: string
          business_value: number | null
          business_value_raw: string | null
          created_at: string
          due_at: string | null
          due_at_raw: string | null
          eligible_from: string | null
          eligible_from_raw: string | null
          error_code: string | null
          error_detail: string | null
          external_ref: string | null
          id: number
          owner_external_ref: string | null
          owner_representative_id: string | null
          row_checksum: string
          row_number: number
          subject_label: string | null
          subject_ref: string | null
          valid: boolean | null
        }
        Insert: {
          batch_id: string
          business_value?: number | null
          business_value_raw?: string | null
          created_at?: string
          due_at?: string | null
          due_at_raw?: string | null
          eligible_from?: string | null
          eligible_from_raw?: string | null
          error_code?: string | null
          error_detail?: string | null
          external_ref?: string | null
          owner_external_ref?: string | null
          owner_representative_id?: string | null
          row_number: number
          subject_label?: string | null
          subject_ref?: string | null
          valid?: boolean | null
        }
        Update: {
          batch_id?: string
          business_value?: number | null
          business_value_raw?: string | null
          created_at?: string
          due_at?: string | null
          due_at_raw?: string | null
          eligible_from?: string | null
          eligible_from_raw?: string | null
          error_code?: string | null
          error_detail?: string | null
          external_ref?: string | null
          owner_external_ref?: string | null
          owner_representative_id?: string | null
          row_number?: number
          subject_label?: string | null
          subject_ref?: string | null
          valid?: boolean | null
        }
        Relationships: []
      }
      ingestion_events: {
        Row: {
          batch_id: string | null
          created_at: string
          detail: Json | null
          event_code: string
          id: string
          message: string
          severity: string
          source_id: string | null
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          detail?: Json | null
          event_code: string
          id?: string
          message: string
          severity: string
          source_id?: string | null
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          detail?: Json | null
          event_code?: string
          id?: string
          message?: string
          severity?: string
          source_id?: string | null
        }
        Relationships: []
      }
      assignment_capabilities: {
        Row: {
          assignment_id: string
          capability_key: string
          created_at: string
        }
        Insert: {
          assignment_id: string
          capability_key: string
          created_at?: string
        }
        Update: {
          assignment_id?: string
          capability_key?: string
          created_at?: string
        }
        Relationships: []
      }
      assignments: {
        Row: {
          accountable: boolean
          cadence: string
          created_at: string
          created_by: string | null
          granted_by_assignment_id: string | null
          id: string
          label: string | null
          person_id: string
          revoked_at: string | null
          revoked_reason: string | null
          scope_id: string
          updated_at: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          accountable?: boolean
          cadence?: string
          created_at?: string
          created_by?: string | null
          granted_by_assignment_id?: string | null
          id?: string
          label?: string | null
          person_id: string
          revoked_at?: string | null
          revoked_reason?: string | null
          scope_id: string
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          accountable?: boolean
          cadence?: string
          created_at?: string
          created_by?: string | null
          granted_by_assignment_id?: string | null
          id?: string
          label?: string | null
          person_id?: string
          revoked_at?: string | null
          revoked_reason?: string | null
          scope_id?: string
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: []
      }
      capabilities: {
        Row: {
          axis: string
          created_at: string
          description: string
          family: string
          key: string
          subject_type: string
        }
        Insert: {
          axis: string
          created_at?: string
          description?: string
          family: string
          key: string
          subject_type: string
        }
        Update: {
          axis?: string
          created_at?: string
          description?: string
          family?: string
          key?: string
          subject_type?: string
        }
        Relationships: []
      }
      commitments: {
        Row: {
          body: string
          created_at: string
          created_by: string
          due_on: string
          id: string
          owner_id: string
          resolution: string | null
          resolution_note: string | null
          resolved_at: string | null
          subject_kind: string
          subject_representative_id: string | null
          subject_scope_id: string | null
          subject_team_id: string | null
          subject_work_item_id: string | null
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by: string
          due_on: string
          id?: string
          owner_id: string
          resolution?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          subject_kind: string
          subject_representative_id?: string | null
          subject_scope_id?: string | null
          subject_team_id?: string | null
          subject_work_item_id?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string
          due_on?: string
          id?: string
          owner_id?: string
          resolution?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          subject_kind?: string
          subject_representative_id?: string | null
          subject_scope_id?: string | null
          subject_team_id?: string | null
          subject_work_item_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      durability_checks: {
        Row: {
          checked_at: string
          created_at: string
          held: boolean
          id: string
          outcome_id: string
          reversal_reason: string | null
        }
        Insert: {
          checked_at?: string
          created_at?: string
          held: boolean
          id?: string
          outcome_id: string
          reversal_reason?: string | null
        }
        Update: {
          checked_at?: string
          created_at?: string
          held?: boolean
          id?: string
          outcome_id?: string
          reversal_reason?: string | null
        }
        Relationships: []
      }
      outcomes: {
        Row: {
          actor_id: string | null
          actor_representative_id: string | null
          canonical_state: string
          correction_reason: string | null
          created_at: string
          id: string
          occurred_at: string
          reason_code: string | null
          supersedes_id: string | null
          value_realized: number | null
          work_item_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_representative_id?: string | null
          canonical_state: string
          correction_reason?: string | null
          created_at?: string
          id?: string
          occurred_at?: string
          reason_code?: string | null
          supersedes_id?: string | null
          value_realized?: number | null
          work_item_id: string
        }
        Update: {
          actor_id?: string | null
          actor_representative_id?: string | null
          canonical_state?: string
          correction_reason?: string | null
          created_at?: string
          id?: string
          occurred_at?: string
          reason_code?: string | null
          supersedes_id?: string | null
          value_realized?: number | null
          work_item_id?: string
        }
        Relationships: []
      }
      scope_members: {
        Row: {
          created_at: string
          id: string
          representative_id: string
          scope_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          representative_id: string
          scope_id: string
        }
        Update: {
          created_at?: string
          id?: string
          representative_id?: string
          scope_id?: string
        }
        Relationships: []
      }
      scopes: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          display_name: string
          id: string
          key: string | null
          kind: string
          rule: Json | null
          team_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          display_name: string
          id?: string
          key?: string | null
          kind: string
          rule?: Json | null
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          display_name?: string
          id?: string
          key?: string | null
          kind?: string
          rule?: Json | null
          team_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      work_items: {
        Row: {
          business_value: number
          created_at: string
          due_at: string | null
          eligible_from: string | null
          external_ref: string
          id: string
          ingested_at: string
          ingestion_batch_id: string | null
          owner_representative_id: string | null
          state: string
          subject_label: string | null
          subject_ref: string | null
          team_id: string | null
          updated_at: string
          voided_reason: string | null
          work_type_id: string
        }
        Insert: {
          business_value?: number
          created_at?: string
          due_at?: string | null
          eligible_from?: string | null
          external_ref: string
          id?: string
          ingested_at?: string
          ingestion_batch_id?: string | null
          owner_representative_id?: string | null
          state?: string
          subject_label?: string | null
          subject_ref?: string | null
          team_id?: string | null
          updated_at?: string
          voided_reason?: string | null
          work_type_id: string
        }
        Update: {
          business_value?: number
          created_at?: string
          due_at?: string | null
          eligible_from?: string | null
          external_ref?: string
          id?: string
          ingested_at?: string
          ingestion_batch_id?: string | null
          owner_representative_id?: string | null
          state?: string
          subject_label?: string | null
          subject_ref?: string | null
          team_id?: string | null
          updated_at?: string
          voided_reason?: string | null
          work_type_id?: string
        }
        Relationships: []
      }
      work_types: {
        Row: {
          active: boolean
          arrival: string
          created_at: string
          decay: string
          discretion: string
          display_name: string
          durability_horizon_days: number
          id: string
          key: string
          outcome_shape: string
          selection: string
          synchrony: string
          updated_at: string
          value_model: string
        }
        Insert: {
          active?: boolean
          arrival: string
          created_at?: string
          decay: string
          discretion: string
          display_name: string
          durability_horizon_days: number
          id?: string
          key: string
          outcome_shape: string
          selection: string
          synchrony: string
          updated_at?: string
          value_model: string
        }
        Update: {
          active?: boolean
          arrival?: string
          created_at?: string
          decay?: string
          discretion?: string
          display_name?: string
          durability_horizon_days?: number
          id?: string
          key?: string
          outcome_shape?: string
          selection?: string
          synchrony?: string
          updated_at?: string
          value_model?: string
        }
        Relationships: []
      }
      activity_events: {
        Row: {
          actor_id: string | null
          created_at: string
          id: string
          kind: string
          text: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: string
          kind: string
          text: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          text?: string
        }
        Relationships: []
      }
      announcements: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          published_on: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          published_on?: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          published_on?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      articles: {
        Row: {
          body: string
          category: string
          created_at: string
          created_by: string | null
          id: string
          important: boolean
          read_minutes: number
          summary: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          category: string
          created_at?: string
          created_by?: string | null
          id?: string
          important?: boolean
          read_minutes?: number
          summary?: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          important?: boolean
          read_minutes?: number
          summary?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          details: Json
          id: string
          target_email: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          target_email?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          target_email?: string | null
          target_user_id?: string | null
        }
        Relationships: []
      }
      coaching_plans: {
        Row: {
          created_at: string
          created_by: string | null
          focus_sections: string
          id: string
          notes: string
          representative_id: string
          review_on: string
          review_schedule_id: string | null
          target_score: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          focus_sections?: string
          id?: string
          notes?: string
          representative_id: string
          review_on: string
          review_schedule_id?: string | null
          target_score: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          focus_sections?: string
          id?: string
          notes?: string
          representative_id?: string
          review_on?: string
          review_schedule_id?: string | null
          target_score?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coaching_plans_representative_id_fkey"
            columns: ["representative_id"]
            isOneToOne: true
            referencedRelation: "representatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coaching_plans_review_schedule_id_fkey"
            columns: ["review_schedule_id"]
            isOneToOne: false
            referencedRelation: "listening_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      comms_messages: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      comms_templates: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          name: string
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          name: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      competition_categories: {
        Row: {
          competition_id: string
          created_at: string
          id: string
          label: string
          points: number
          updated_at: string
        }
        Insert: {
          competition_id: string
          created_at?: string
          id?: string
          label: string
          points?: number
          updated_at?: string
        }
        Update: {
          competition_id?: string
          created_at?: string
          id?: string
          label?: string
          points?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_categories_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_scores: {
        Row: {
          category_id: string
          competition_id: string
          count: number
          created_at: string
          id: string
          representative_id: string
          updated_at: string
        }
        Insert: {
          category_id: string
          competition_id: string
          count?: number
          created_at?: string
          id?: string
          representative_id: string
          updated_at?: string
        }
        Update: {
          category_id?: string
          competition_id?: string
          count?: number
          created_at?: string
          id?: string
          representative_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_scores_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "competition_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_scores_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_scores_representative_id_fkey"
            columns: ["representative_id"]
            isOneToOne: false
            referencedRelation: "representatives"
            referencedColumns: ["id"]
          },
        ]
      }
      competitions: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          name: string
          prize: string
          rules: string
          start_date: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          end_date?: string
          id?: string
          name: string
          prize?: string
          rules?: string
          start_date?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          end_date?: string
          id?: string
          name?: string
          prize?: string
          rules?: string
          start_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      feedback: {
        Row: {
          call_id: string
          call_type: string
          created_at: string
          created_by: string | null
          criteria: Json
          feedback_date: string
          id: string
          improve: string
          keep_doing: string
          listener: string
          manager_summary: string
          next_task: string
          published: boolean
          published_at: string | null
          representative_id: string
          schedule_id: string | null
          score: number
          team_key: string | null
          updated_at: string
        }
        Insert: {
          call_id?: string
          call_type?: string
          created_at?: string
          created_by?: string | null
          criteria?: Json
          feedback_date?: string
          id?: string
          improve?: string
          keep_doing?: string
          listener?: string
          manager_summary?: string
          next_task?: string
          published?: boolean
          published_at?: string | null
          representative_id: string
          schedule_id?: string | null
          score?: number
          team_key?: string | null
          updated_at?: string
        }
        Update: {
          call_id?: string
          call_type?: string
          created_at?: string
          created_by?: string | null
          criteria?: Json
          feedback_date?: string
          id?: string
          improve?: string
          keep_doing?: string
          listener?: string
          manager_summary?: string
          next_task?: string
          published?: boolean
          published_at?: string | null
          representative_id?: string
          schedule_id?: string | null
          score?: number
          team_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_representative_id_fkey"
            columns: ["representative_id"]
            isOneToOne: false
            referencedRelation: "representatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "listening_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_revisions: {
        Row: {
          changed_by: string | null
          created_at: string
          feedback_id: string
          id: string
          previous_call_id: string
          previous_call_type: string
          previous_criteria: Json
          previous_feedback_date: string | null
          previous_improve: string
          previous_keep_doing: string
          previous_listener: string
          previous_manager_summary: string
          previous_next_task: string
          previous_published: boolean
          previous_score: number
          reason: string
          was_published_at_change: boolean
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          feedback_id: string
          id?: string
          previous_call_id?: string
          previous_call_type?: string
          previous_criteria?: Json
          previous_feedback_date?: string | null
          previous_improve?: string
          previous_keep_doing?: string
          previous_listener?: string
          previous_manager_summary?: string
          previous_next_task?: string
          previous_published?: boolean
          previous_score?: number
          reason?: string
          was_published_at_change?: boolean
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          feedback_id?: string
          id?: string
          previous_call_id?: string
          previous_call_type?: string
          previous_criteria?: Json
          previous_feedback_date?: string | null
          previous_improve?: string
          previous_keep_doing?: string
          previous_listener?: string
          previous_manager_summary?: string
          previous_next_task?: string
          previous_published?: boolean
          previous_score?: number
          reason?: string
          was_published_at_change?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "feedback_revisions_feedback_id_fkey"
            columns: ["feedback_id"]
            isOneToOne: false
            referencedRelation: "feedback"
            referencedColumns: ["id"]
          },
        ]
      }
      ideas: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          id: string
          text: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          text: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          text?: string
          updated_at?: string
        }
        Relationships: []
      }
      import_history: {
        Row: {
          created_at: string
          error_report: Json | null
          errors: number
          file_name: string
          id: string
          imported_by: string | null
          imported_by_name: string
          rows_created: number
          rows_processed: number
          rows_skipped: number
          rows_updated: number
          snapshot: Json | null
          status: string
          updated_at: string
          warnings: number
        }
        Insert: {
          created_at?: string
          error_report?: Json | null
          errors?: number
          file_name: string
          id?: string
          imported_by?: string | null
          imported_by_name?: string
          rows_created?: number
          rows_processed?: number
          rows_skipped?: number
          rows_updated?: number
          snapshot?: Json | null
          status?: string
          updated_at?: string
          warnings?: number
        }
        Update: {
          created_at?: string
          error_report?: Json | null
          errors?: number
          file_name?: string
          id?: string
          imported_by?: string | null
          imported_by_name?: string
          rows_created?: number
          rows_processed?: number
          rows_skipped?: number
          rows_updated?: number
          snapshot?: Json | null
          status?: string
          updated_at?: string
          warnings?: number
        }
        Relationships: []
      }
      import_templates: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          mapping: Json
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          mapping?: Json
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          mapping?: Json
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      kpi_values: {
        Row: {
          completed_renewals: number | null
          created_at: string
          id: string
          metric_date: string
          renewal_opportunities: number | null
          representative_id: string
          source_import_id: string | null
          team_id: string | null
          updated_at: string
        }
        Insert: {
          completed_renewals?: number | null
          created_at?: string
          id?: string
          metric_date: string
          renewal_opportunities?: number | null
          representative_id: string
          source_import_id?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          completed_renewals?: number | null
          created_at?: string
          id?: string
          metric_date?: string
          renewal_opportunities?: number | null
          representative_id?: string
          source_import_id?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kpi_values_representative_id_fkey"
            columns: ["representative_id"]
            isOneToOne: false
            referencedRelation: "representatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_values_source_import_id_fkey"
            columns: ["source_import_id"]
            isOneToOne: false
            referencedRelation: "import_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_values_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      listening_schedules: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          representative_id: string
          scheduled_on: string
          scheduled_time: string
          status: string
          topic: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          representative_id: string
          scheduled_on?: string
          scheduled_time?: string
          status?: string
          topic?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          representative_id?: string
          scheduled_on?: string
          scheduled_time?: string
          status?: string
          topic?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listening_schedules_representative_id_fkey"
            columns: ["representative_id"]
            isOneToOne: false
            referencedRelation: "representatives"
            referencedColumns: ["id"]
          },
        ]
      }
      manager_calls: {
        Row: {
          created_at: string
          follow_up_at: string | null
          id: string
          owner_id: string
          representative_id: string | null
          scheduled_at: string
          status: string
          subject: string
          summary: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          follow_up_at?: string | null
          id?: string
          owner_id: string
          representative_id?: string | null
          scheduled_at?: string
          status?: string
          subject: string
          summary?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          follow_up_at?: string | null
          id?: string
          owner_id?: string
          representative_id?: string | null
          scheduled_at?: string
          status?: string
          subject?: string
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manager_calls_representative_id_fkey"
            columns: ["representative_id"]
            isOneToOne: false
            referencedRelation: "representatives"
            referencedColumns: ["id"]
          },
        ]
      }
      morning_checklist: {
        Row: {
          checked: boolean
          team_id: string | null
          checklist_date: string
          created_at: string
          id: string
          task_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          checked?: boolean
          team_id?: string | null
          checklist_date?: string
          created_at?: string
          id?: string
          task_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          checked?: boolean
          team_id?: string | null
          checklist_date?: string
          created_at?: string
          id?: string
          task_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      morning_settings: {
        Row: {
          created_at: string
          data_as_of: string | null
          last_refresh_at: string | null
          monthly_avg_achievement_pct: number
          monthly_avg_renewal_pct: number
          refresh_status: string
          saved_update_template: string | null
          updated_at: string
          user_id: string
          yesterday_achievement_pct: number
          yesterday_renewal_pct: number
        }
        Insert: {
          created_at?: string
          data_as_of?: string | null
          last_refresh_at?: string | null
          monthly_avg_achievement_pct?: number
          monthly_avg_renewal_pct?: number
          refresh_status?: string
          saved_update_template?: string | null
          updated_at?: string
          user_id: string
          yesterday_achievement_pct?: number
          yesterday_renewal_pct?: number
        }
        Update: {
          created_at?: string
          data_as_of?: string | null
          last_refresh_at?: string | null
          monthly_avg_achievement_pct?: number
          monthly_avg_renewal_pct?: number
          refresh_status?: string
          saved_update_template?: string | null
          updated_at?: string
          user_id?: string
          yesterday_achievement_pct?: number
          yesterday_renewal_pct?: number
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          dedupe_key: string | null
          created_at: string
          href: string | null
          id: string
          kind: string
          read: boolean
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string
          dedupe_key?: string | null
          created_at?: string
          href?: string | null
          id?: string
          kind: string
          read?: boolean
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          dedupe_key?: string | null
          created_at?: string
          href?: string | null
          id?: string
          kind?: string
          read?: boolean
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          last_login_at: string | null
          manager_id: string | null
          must_change_password: boolean
          representative_id: string | null
          team_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          last_login_at?: string | null
          manager_id?: string | null
          must_change_password?: boolean
          representative_id?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          last_login_at?: string | null
          manager_id?: string | null
          must_change_password?: boolean
          representative_id?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      rep_notes: {
        Row: {
          author_id: string | null
          author_name: string
          created_at: string
          id: string
          is_private: boolean
          representative_id: string
          text: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          author_name?: string
          created_at?: string
          id?: string
          is_private?: boolean
          representative_id: string
          text: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          author_name?: string
          created_at?: string
          id?: string
          is_private?: boolean
          representative_id?: string
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rep_notes_representative_id_fkey"
            columns: ["representative_id"]
            isOneToOne: false
            referencedRelation: "representatives"
            referencedColumns: ["id"]
          },
        ]
      }
      rep_tasks: {
        Row: {
          article_id: string | null
          created_at: string
          created_by: string | null
          done: boolean
          due_on: string | null
          id: string
          priority: string
          representative_id: string
          title: string
          updated_at: string
        }
        Insert: {
          article_id?: string | null
          created_at?: string
          created_by?: string | null
          done?: boolean
          due_on?: string | null
          id?: string
          priority?: string
          representative_id: string
          title: string
          updated_at?: string
        }
        Update: {
          article_id?: string | null
          created_at?: string
          created_by?: string | null
          done?: boolean
          due_on?: string | null
          id?: string
          priority?: string
          representative_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rep_tasks_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rep_tasks_representative_id_fkey"
            columns: ["representative_id"]
            isOneToOne: false
            referencedRelation: "representatives"
            referencedColumns: ["id"]
          },
        ]
      }
      representative_goals: {
        Row: {
          created_at: string
          created_by: string | null
          goal_month: string
          id: string
          representative_id: string
          target_value: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          goal_month: string
          id?: string
          representative_id: string
          target_value: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          goal_month?: string
          id?: string
          representative_id?: string
          target_value?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "representative_goals_representative_id_fkey"
            columns: ["representative_id"]
            isOneToOne: false
            referencedRelation: "representatives"
            referencedColumns: ["id"]
          },
        ]
      }
      representatives: {
        Row: {
          active: boolean
          created_at: string
          current_result: number
          deactivated_at: string | null
          external_ref: string | null
          id: string
          monthly_target: number
          name: string
          team_id: string | null
          team_key: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          current_result?: number
          deactivated_at?: string | null
          external_ref?: string | null
          id?: string
          monthly_target?: number
          name: string
          team_id?: string | null
          team_key?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          current_result?: number
          deactivated_at?: string | null
          external_ref?: string | null
          id?: string
          monthly_target?: number
          name?: string
          team_id?: string | null
          team_key?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "representatives_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_achievement_snapshots: {
        Row: {
          achievement_pct: number | null
          created_at: string
          id: string
          representative_count: number
          result_value: number
          snapshot_date: string
          target_value: number | null
          team_id: string
          updated_at: string
        }
        Insert: {
          achievement_pct?: number | null
          created_at?: string
          id?: string
          representative_count?: number
          result_value: number
          snapshot_date?: string
          target_value?: number | null
          team_id: string
          updated_at?: string
        }
        Update: {
          achievement_pct?: number | null
          created_at?: string
          id?: string
          representative_count?: number
          result_value?: number
          snapshot_date?: string
          target_value?: number | null
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_achievement_snapshots_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_goals: {
        Row: {
          created_at: string
          created_by: string | null
          goal_month: string
          id: string
          target_value: number
          team_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          goal_month: string
          id?: string
          target_value: number
          team_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          goal_month?: string
          id?: string
          target_value?: number
          team_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_goals_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          active: boolean
          created_at: string
          department: string | null
          description: string | null
          id: string
          kpi_profile: string
          manager_id: string | null
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          department?: string | null
          description?: string | null
          id?: string
          kpi_profile?: string
          manager_id?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          department?: string | null
          description?: string | null
          id?: string
          kpi_profile?: string
          manager_id?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      underwriting_issues: {
        Row: {
          created_at: string
          created_by: string | null
          due_on: string | null
          id: string
          opened_on: string
          owner: string
          priority: string
          representative_id: string | null
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          due_on?: string | null
          id?: string
          opened_on?: string
          owner?: string
          priority?: string
          representative_id?: string | null
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          due_on?: string | null
          id?: string
          opened_on?: string
          owner?: string
          priority?: string
          representative_id?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "underwriting_issues_representative_id_fkey"
            columns: ["representative_id"]
            isOneToOne: false
            referencedRelation: "representatives"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      record_work_item_outcome: {
        Args: {
          _actor_id: string | null
          _actor_representative_id: string | null
          _canonical_state: string
          _correction_reason: string | null
          _occurred_at?: string
          _reason_code: string | null
          _supersedes_id: string | null
          _value_realized: number | null
          _work_item_id: string
        }
        Returns: {
          out_item_state: string
          out_outcome_id: string
          out_resolving: boolean
          out_touch_count: number
          out_work_item_id: string
        }[]
      }
      next_work_items_for_representative: {
        Args: {
          _as_of?: string
          _limit?: number
          _representative_id: string
          _work_type_id: string
        }
        Returns: {
          out_business_value: number
          out_due_at: string | null
          out_eligible_from: string | null
          out_external_ref: string
          out_hours_to_due: number | null
          out_overdue: boolean
          out_position: number
          out_subject_label: string | null
          out_subject_ref: string | null
          out_touch_count: number
          out_work_item_id: string
        }[]
      }
      refresh_coverage_for_work_item: {
        Args: {
          _work_item_id: string
        }
        Returns: {
          out_on_date: string | null
          out_scopes_refreshed: number
        }[]
      }
      compute_coverage_fact: {
        Args: {
          _as_of?: string
          _period_end: string
          _period_start: string
          _scope_id: string
          _work_type_id: string
        }
        Returns: {
          out_eligible_count: number
          out_eligible_value: number
          out_engaged_count: number
          out_engaged_value: number
          out_expired_unworked_count: number
          out_expired_unworked_value: number
          out_fact_id: string
          out_freshness_state: string
          out_pending_count: number
          out_pending_value: number
        }[]
      }
      compute_coverage_facts_for_date: {
        Args: {
          _as_of: string
        }
        Returns: {
          out_duration_ms: number
          out_facts_written: number
          out_scopes: number
        }[]
      }
      coverage_for_actor: {
        Args: {
          _period_end: string
          _period_start: string
          _person_id: string
          _work_type_id: string
        }
        Returns: {
          out_accountable: boolean
          out_display_name: string
          out_eligible_count: number
          out_eligible_value: number
          out_engaged_count: number
          out_engaged_value: number
          out_expired_unworked_count: number
          out_expired_unworked_value: number
          out_pending_count: number
          out_pending_value: number
          out_scope_id: string
          out_scope_key: string | null
          out_scope_kind: string
        }[]
      }
      coverage_for_representative: {
        Args: {
          _period_end: string
          _period_start: string
          _representative_id: string
          _work_type_id: string
        }
        Returns: {
          out_eligible_count: number
          out_eligible_value: number
          out_engaged_count: number
          out_engaged_value: number
          out_expired_unworked_count: number
          out_expired_unworked_value: number
          out_pending_count: number
          out_pending_value: number
        }[]
      }
      coverage_facts_rollup: {
        Args: {
          _period_end: string
          _period_start: string
          _scope_ids: string[]
          _work_type_id: string
        }
        Returns: {
          out_eligible_count: number
          out_eligible_value: number
          out_engaged_count: number
          out_engaged_value: number
          out_expired_unworked_count: number
          out_expired_unworked_value: number
          out_fact_count: number
          out_oldest_computed_at: string | null
          out_pending_count: number
          out_pending_value: number
          out_worst_freshness: string
        }[]
      }
      ingestion_begin_batch: {
        Args: {
          _external_batch_ref: string | null
          _source_key: string
          _trigger_kind: string
          _triggered_by: string | null
        }
        Returns: {
          out_batch_id: string
          out_ingestion_mode: string
          out_source_id: string
          out_work_type_id: string
        }[]
      }
      ingestion_finalize_staging: {
        Args: {
          _batch_id: string
        }
        Returns: {
          out_checksum: string
          out_row_count: number
        }[]
      }
      ingestion_validate_batch: {
        Args: {
          _batch_id: string
        }
        Returns: {
          out_passed: boolean
          out_rejection_code: string | null
          out_validation_result: Json
        }[]
      }
      ingestion_publish_batch: {
        Args: {
          _batch_id: string
        }
        Returns: {
          out_duration_ms: number
          out_rows_inserted: number
          out_rows_unchanged: number
          out_rows_updated: number
          out_rows_voided: number
        }[]
      }
      ingestion_reject_batch: {
        Args: {
          _batch_id: string
          _code: string
          _detail: string | null
        }
        Returns: {
          out_batch_id: string
          out_status: string
        }[]
      }
      ingestion_freshness: {
        Args: Record<PropertyKey, never>
        Returns: {
          out_age_seconds: number | null
          out_consecutive_failures: number
          out_critical_hours: number
          out_last_attempt_at: string | null
          out_last_attempt_status: string | null
          out_last_batch_id: string | null
          out_last_published_at: string | null
          out_last_row_count: number | null
          out_open_item_count: number
          out_source_key: string
          out_source_name: string
          out_warning_hours: number
          out_work_type_key: string
        }[]
      }
      ingestion_purge_staging: {
        Args: {
          _older_than_days: number
        }
        Returns: {
          out_batches_purged: number
          out_rows_purged: number
        }[]
      }
      accountability_gaps: {
        Args: Record<PropertyKey, never>
        Returns: {
          representative_id: string
          representative_name: string
          team_id: string | null
        }[]
      }
      actor_authorization_context: {
        Args: {
          _person_id: string
        }
        Returns: {
          out_accountable: boolean
          out_assignment_id: string
          out_cadence: string
          out_capabilities: string[]
          out_label: string | null
          out_scope_display_name: string
          out_scope_id: string
          out_scope_kind: string
          out_valid_from: string
          out_valid_to: string | null
        }[]
      }
      actor_capabilities_over_rep: {
        Args: {
          _person_id: string
          _rep: string
        }
        Returns: {
          out_accountable: boolean
          out_assignment_id: string
          out_capability_key: string
        }[]
      }
      actor_scope_representatives: {
        Args: {
          _person_id: string
        }
        Returns: {
          out_accountable: boolean
          out_assignment_id: string
          out_representative_id: string
        }[]
      }
      create_assignment: {
        Args: {
          _accountable: boolean
          _capabilities: string[]
          _cadence: string
          _created_by: string | null
          _granted_by_assignment_id: string | null
          _label: string | null
          _person_id: string
          _scope_id: string
          _valid_from: string
          _valid_to: string | null
        }
        Returns: {
          out_assignment_id: string
          out_capability_count: number
        }[]
      }
      end_assignment: {
        Args: {
          _allow_gap: boolean
          _assignment_id: string
          _gap_reason: string | null
          _valid_to: string
        }
        Returns: {
          out_assignment_id: string
          out_orphaned_count: number
          out_valid_to: string
        }[]
      }
      lapse_stale_commitments: {
        Args: {
          _stale_after_days: number
        }
        Returns: {
          out_lapsed: number
        }[]
      }
      revoke_assignment: {
        Args: {
          _assignment_id: string
          _reason: string
        }
        Returns: {
          out_assignment_id: string
          out_revoked_children: number
        }[]
      }
      create_feedback_with_schedule_completion: {
        Args: {
          _call_id: string
          _call_type: string
          _created_by: string | null
          _criteria: Json
          _feedback_date: string
          _improve: string
          _keep_doing: string
          _listener: string
          _manager_summary: string
          _next_task: string
          _representative_id: string
          _schedule_id: string | null
          _score: number
        }
        Returns: {
          feedback_id: string
          schedule_completed: boolean
        }[]
      }
      deliver_operational_notification: {
        Args: {
          _body: string
          _dedupe_key: string
          _href: string
          _kind: string
          _title: string
          _user_id: string
        }
        Returns: {
          out_created: boolean
          out_notification_id: string | null
        }[]
      }
      link_representative_to_user: {
        Args: {
          _check_expected: boolean
          _expected_current_user_id: string | null
          _rep_id: string
          _user_id: string | null
        }
        Returns: {
          new_user_id: string | null
          previous_user_id: string | null
          rep_id: string
          rep_name: string
          rep_team_id: string | null
        }[]
      }
      record_team_achievement_snapshot: {
        Args: {
          _achievement_pct: number | null
          _representative_count: number
          _result_value: number
          _snapshot_date: string
          _target_value: number | null
          _team_id: string
        }
        Returns: {
          out_created: boolean
          out_snapshot_id: string
        }[]
      }
      set_feedback_published: {
        Args: {
          _changed_by: string | null
          _feedback_id: string
          _published: boolean
          _reason: string
        }
        Returns: {
          out_feedback_id: string
          out_now_published: boolean
          out_previous_published: boolean
          out_published_at: string | null
          out_representative_id: string
        }[]
      }
      set_representative_active_with_profile_sync: {
        Args: { _active: boolean; _rep_id: string; _sync_profile: boolean }
        Returns: {
          linked_user_id: string | null
          previous_active: boolean
          profile_active: boolean | null
          profile_synced: boolean
          rep_active: boolean
          rep_deactivated_at: string | null
          rep_id: string
          rep_name: string
        }[]
      }
      set_user_team_with_representative_sync: {
        Args: { _team_id: string; _user_id: string }
        Returns: {
          previous_profile_team_id: string
          previous_representative_team_id: string
          representative_id: string
        }[]
      }
      toggle_morning_checklist_item: {
        Args: {
          _checklist_date: string
          _task_key: string
          _team_id: string | null
          _user_id: string
        }
        Returns: {
          out_checked: boolean
          out_checklist_date: string
          out_task_key: string
        }[]
      }
      toggle_rep_task_done: {
        Args: { _task_id: string }
        Returns: {
          done: boolean
          previous_done: boolean
          representative_id: string
          task_id: string
          title: string
        }[]
      }
      touch_last_login: { Args: never; Returns: undefined }
      update_feedback_with_revision: {
        Args: {
          _call_id: string
          _call_type: string
          _changed_by: string | null
          _criteria: Json
          _expected_updated_at: string | null
          _feedback_date: string
          _feedback_id: string
          _improve: string
          _keep_doing: string
          _listener: string
          _manager_summary: string
          _next_task: string
          _reason: string
          _score: number
        }
        Returns: {
          out_feedback_id: string
          out_new_updated_at: string
          out_representative_id: string
          out_was_published: boolean
        }[]
      }
      update_representative_metrics_with_team_sync: {
        Args: {
          _apply_current_result: boolean
          _apply_monthly_target: boolean
          _apply_name: boolean
          _apply_team: boolean
          _current_result: number | null
          _monthly_target: number | null
          _name: string | null
          _rep_id: string
          _team_id: string | null
        }
        Returns: {
          linked_user_id: string | null
          new_current_result: number
          new_team_id: string | null
          previous_current_result: number
          previous_team_id: string | null
          profile_synced: boolean
          rep_id: string
          rep_name: string
          team_changed: boolean
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "manager" | "representative"
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
  public: {
    Enums: {
      app_role: ["admin", "manager", "representative"],
    },
  },
} as const

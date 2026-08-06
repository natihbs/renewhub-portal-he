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
          checklist_date: string
          created_at: string
          id: string
          task_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          checked?: boolean
          checklist_date?: string
          created_at?: string
          id?: string
          task_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          checked?: boolean
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

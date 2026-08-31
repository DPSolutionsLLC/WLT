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
      action_items: {
        Row: {
          agenda_id: string | null
          assigned_to: string | null
          carried_from_agenda_id: string | null
          completed_at: string | null
          created_at: string
          description: string
          due_date: string | null
          id: string
          status: string
          ward_id: string
        }
        Insert: {
          agenda_id?: string | null
          assigned_to?: string | null
          carried_from_agenda_id?: string | null
          completed_at?: string | null
          created_at?: string
          description: string
          due_date?: string | null
          id?: string
          status?: string
          ward_id: string
        }
        Update: {
          agenda_id?: string | null
          assigned_to?: string | null
          carried_from_agenda_id?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string
          due_date?: string | null
          id?: string
          status?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_items_agenda_id_ward_id_fkey"
            columns: ["agenda_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "agendas"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "action_items_carried_from_agenda_id_ward_id_fkey"
            columns: ["carried_from_agenda_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "agendas"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "action_items_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_attendees: {
        Row: {
          assigned_by: string | null
          confirmed_attendance: boolean | null
          created_at: string
          event_id: string
          id: string
          user_id: string
          ward_id: string
        }
        Insert: {
          assigned_by?: string | null
          confirmed_attendance?: boolean | null
          created_at?: string
          event_id: string
          id?: string
          user_id: string
          ward_id: string
        }
        Update: {
          assigned_by?: string | null
          confirmed_attendance?: boolean | null
          created_at?: string
          event_id?: string
          id?: string
          user_id?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_attendees_assigned_by_ward_id_fkey"
            columns: ["assigned_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "activity_attendees_event_id_ward_id_fkey"
            columns: ["event_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "activity_events"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "activity_attendees_user_id_ward_id_fkey"
            columns: ["user_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "activity_attendees_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_calendars: {
        Row: {
          created_at: string
          id: string
          last_synced_at: string | null
          profile_id: string
          source_type: string
          source_url: string | null
          ward_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_synced_at?: string | null
          profile_id: string
          source_type: string
          source_url?: string | null
          ward_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_synced_at?: string | null
          profile_id?: string
          source_type?: string
          source_url?: string | null
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_calendars_profile_id_ward_id_fkey"
            columns: ["profile_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "youth_activity_profiles"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "activity_calendars_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_events: {
        Row: {
          all_day: boolean
          calendar_id: string | null
          created_at: string
          event_date: string
          event_type: string
          id: string
          location: string | null
          occasion_id: string | null
          profile_id: string | null
          source_recurrence_id: string | null
          source_uid: string | null
          status: string
          title: string
          ward_id: string
        }
        Insert: {
          all_day?: boolean
          calendar_id?: string | null
          created_at?: string
          event_date: string
          event_type?: string
          id?: string
          location?: string | null
          occasion_id?: string | null
          profile_id?: string | null
          source_recurrence_id?: string | null
          source_uid?: string | null
          status?: string
          title: string
          ward_id: string
        }
        Update: {
          all_day?: boolean
          calendar_id?: string | null
          created_at?: string
          event_date?: string
          event_type?: string
          id?: string
          location?: string | null
          occasion_id?: string | null
          profile_id?: string | null
          source_recurrence_id?: string | null
          source_uid?: string | null
          status?: string
          title?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_calendar_id_ward_id_fkey"
            columns: ["calendar_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "activity_calendars"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "activity_events_occasion_id_ward_id_fkey"
            columns: ["occasion_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "activity_occasions"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "activity_events_profile_id_ward_id_fkey"
            columns: ["profile_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "youth_activity_profiles"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "activity_events_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_logs: {
        Row: {
          created_at: string
          event_id: string
          flag_sent_at: string | null
          flagged_for_ward_council: boolean
          id: string
          logged_by: string
          shared_notes: string | null
          updated_at: string
          ward_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          flag_sent_at?: string | null
          flagged_for_ward_council?: boolean
          id?: string
          logged_by: string
          shared_notes?: string | null
          updated_at?: string
          ward_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          flag_sent_at?: string | null
          flagged_for_ward_council?: boolean
          id?: string
          logged_by?: string
          shared_notes?: string | null
          updated_at?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_event_id_ward_id_fkey"
            columns: ["event_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "activity_events"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "activity_logs_logged_by_ward_id_fkey"
            columns: ["logged_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "activity_logs_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_occasions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          ward_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          ward_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_occasions_created_by_ward_id_fkey"
            columns: ["created_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "activity_occasions_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_private_notes: {
        Row: {
          activity_log_id: string
          created_at: string
          id: string
          notes: string
          updated_at: string
          user_id: string
          ward_id: string
        }
        Insert: {
          activity_log_id: string
          created_at?: string
          id?: string
          notes: string
          updated_at?: string
          user_id: string
          ward_id: string
        }
        Update: {
          activity_log_id?: string
          created_at?: string
          id?: string
          notes?: string
          updated_at?: string
          user_id?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_private_notes_activity_log_id_ward_id_fkey"
            columns: ["activity_log_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "activity_logs"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "activity_private_notes_user_id_ward_id_fkey"
            columns: ["user_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "activity_private_notes_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      agendas: {
        Row: {
          created_at: string
          id: string
          meeting_date: string
          meeting_type: string | null
          pdf_url: string | null
          published_at: string | null
          published_by: string | null
          sections: Json | null
          status: string
          ward_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          meeting_date: string
          meeting_type?: string | null
          pdf_url?: string | null
          published_at?: string | null
          published_by?: string | null
          sections?: Json | null
          status?: string
          ward_id: string
        }
        Update: {
          created_at?: string
          id?: string
          meeting_date?: string
          meeting_type?: string | null
          pdf_url?: string | null
          published_at?: string | null
          published_by?: string | null
          sections?: Json | null
          status?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agendas_published_by_ward_id_fkey"
            columns: ["published_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "agendas_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_settings: {
        Row: {
          conference_preferences: Json | null
          created_at: string
          doctrinal_emphasis: string | null
          id: string
          saved_by: string | null
          scripture_preferences: Json | null
          thank_you_preferences: string | null
          tone_voice: string | null
          topic_preferences: string | null
          ward_context: string | null
          ward_id: string
        }
        Insert: {
          conference_preferences?: Json | null
          created_at?: string
          doctrinal_emphasis?: string | null
          id?: string
          saved_by?: string | null
          scripture_preferences?: Json | null
          thank_you_preferences?: string | null
          tone_voice?: string | null
          topic_preferences?: string | null
          ward_context?: string | null
          ward_id: string
        }
        Update: {
          conference_preferences?: Json | null
          created_at?: string
          doctrinal_emphasis?: string | null
          id?: string
          saved_by?: string | null
          scripture_preferences?: Json | null
          thank_you_preferences?: string | null
          tone_voice?: string | null
          topic_preferences?: string | null
          ward_context?: string | null
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_settings_saved_by_ward_id_fkey"
            columns: ["saved_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "ai_settings_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_approvals: {
        Row: {
          approved: boolean | null
          assignment_id: string
          comment: string | null
          created_at: string
          id: string
          user_id: string
          ward_id: string
        }
        Insert: {
          approved?: boolean | null
          assignment_id: string
          comment?: string | null
          created_at?: string
          id?: string
          user_id: string
          ward_id: string
        }
        Update: {
          approved?: boolean | null
          assignment_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          user_id?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_approvals_assignment_id_ward_id_fkey"
            columns: ["assignment_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "assignment_approvals_user_id_ward_id_fkey"
            columns: ["user_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "assignment_approvals_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_comments: {
        Row: {
          assignment_id: string | null
          comment: string
          created_at: string
          id: string
          level: string | null
          sunday_id: string | null
          user_id: string
          ward_id: string
        }
        Insert: {
          assignment_id?: string | null
          comment: string
          created_at?: string
          id?: string
          level?: string | null
          sunday_id?: string | null
          user_id: string
          ward_id: string
        }
        Update: {
          assignment_id?: string | null
          comment?: string
          created_at?: string
          id?: string
          level?: string | null
          sunday_id?: string | null
          user_id?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_comments_assignment_id_ward_id_fkey"
            columns: ["assignment_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "assignment_comments_sunday_id_ward_id_fkey"
            columns: ["sunday_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "sundays"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "assignment_comments_user_id_ward_id_fkey"
            columns: ["user_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "assignment_comments_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_history: {
        Row: {
          assignment_id: string | null
          cancellation_days_notice: number | null
          created_at: string
          id: string
          member_id: string
          notes: string | null
          outcome: string | null
          ward_id: string
        }
        Insert: {
          assignment_id?: string | null
          cancellation_days_notice?: number | null
          created_at?: string
          id?: string
          member_id: string
          notes?: string | null
          outcome?: string | null
          ward_id: string
        }
        Update: {
          assignment_id?: string | null
          cancellation_days_notice?: number | null
          created_at?: string
          id?: string
          member_id?: string
          notes?: string | null
          outcome?: string | null
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_history_assignment_id_ward_id_fkey"
            columns: ["assignment_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "assignment_history_member_id_ward_id_fkey"
            columns: ["member_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "assignment_history_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments: {
        Row: {
          approved_at: string | null
          assignment_type: string | null
          completed_at: string | null
          confirmed_at: string | null
          contact_waived_at: string | null
          contact_waived_by: string | null
          counts_toward_rotation: boolean
          created_at: string
          external_speaker_name: string | null
          external_speaker_title: string | null
          id: string
          member_id: string | null
          notify_message: string | null
          notify_sent_at: string | null
          notify_sent_by: string | null
          pipeline_stage: string
          plan_submitted_at: string | null
          planned_by: string | null
          request_notes: string | null
          request_outcome: string | null
          requested_at: string | null
          requested_by: string | null
          slot_length_minutes: number | null
          slot_number: number | null
          sunday_confirmed_at: string | null
          sunday_id: string | null
          thank_you_message: string | null
          thank_you_sent_at: string | null
          thank_you_sent_by: string | null
          topic_id: string | null
          ward_id: string
        }
        Insert: {
          approved_at?: string | null
          assignment_type?: string | null
          completed_at?: string | null
          confirmed_at?: string | null
          contact_waived_at?: string | null
          contact_waived_by?: string | null
          counts_toward_rotation?: boolean
          created_at?: string
          external_speaker_name?: string | null
          external_speaker_title?: string | null
          id?: string
          member_id?: string | null
          notify_message?: string | null
          notify_sent_at?: string | null
          notify_sent_by?: string | null
          pipeline_stage?: string
          plan_submitted_at?: string | null
          planned_by?: string | null
          request_notes?: string | null
          request_outcome?: string | null
          requested_at?: string | null
          requested_by?: string | null
          slot_length_minutes?: number | null
          slot_number?: number | null
          sunday_confirmed_at?: string | null
          sunday_id?: string | null
          thank_you_message?: string | null
          thank_you_sent_at?: string | null
          thank_you_sent_by?: string | null
          topic_id?: string | null
          ward_id: string
        }
        Update: {
          approved_at?: string | null
          assignment_type?: string | null
          completed_at?: string | null
          confirmed_at?: string | null
          contact_waived_at?: string | null
          contact_waived_by?: string | null
          counts_toward_rotation?: boolean
          created_at?: string
          external_speaker_name?: string | null
          external_speaker_title?: string | null
          id?: string
          member_id?: string | null
          notify_message?: string | null
          notify_sent_at?: string | null
          notify_sent_by?: string | null
          pipeline_stage?: string
          plan_submitted_at?: string | null
          planned_by?: string | null
          request_notes?: string | null
          request_outcome?: string | null
          requested_at?: string | null
          requested_by?: string | null
          slot_length_minutes?: number | null
          slot_number?: number | null
          sunday_confirmed_at?: string | null
          sunday_id?: string | null
          thank_you_message?: string | null
          thank_you_sent_at?: string | null
          thank_you_sent_by?: string | null
          topic_id?: string | null
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_contact_waived_by_fkey"
            columns: ["contact_waived_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "assignments_member_id_ward_id_fkey"
            columns: ["member_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "assignments_notify_sent_by_ward_id_fkey"
            columns: ["notify_sent_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "assignments_planned_by_ward_id_fkey"
            columns: ["planned_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "assignments_requested_by_ward_id_fkey"
            columns: ["requested_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "assignments_sunday_id_ward_id_fkey"
            columns: ["sunday_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "sundays"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "assignments_thank_you_sent_by_ward_id_fkey"
            columns: ["thank_you_sent_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "assignments_topic_id_ward_id_fkey"
            columns: ["topic_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "assignments_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          detail: Json | null
          id: string
          module: string | null
          user_id: string | null
          ward_id: string
        }
        Insert: {
          action: string
          created_at?: string
          detail?: Json | null
          id?: string
          module?: string | null
          user_id?: string | null
          ward_id: string
        }
        Update: {
          action?: string
          created_at?: string
          detail?: Json | null
          id?: string
          module?: string | null
          user_id?: string | null
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_user_id_ward_id_fkey"
            columns: ["user_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "audit_log_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      conducting_rotation: {
        Row: {
          cadence: string
          created_at: string
          effective_from: string
          id: string
          org_id: string | null
          position: number
          user_id: string | null
          ward_id: string
        }
        Insert: {
          cadence?: string
          created_at?: string
          effective_from: string
          id?: string
          org_id?: string | null
          position: number
          user_id?: string | null
          ward_id: string
        }
        Update: {
          cadence?: string
          created_at?: string
          effective_from?: string
          id?: string
          org_id?: string | null
          position?: number
          user_id?: string | null
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conducting_rotation_org_fkey"
            columns: ["org_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "conducting_rotation_user_id_ward_id_fkey"
            columns: ["user_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "conducting_rotation_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_messages: {
        Row: {
          body: string | null
          created_at: string
          id: string
          thread_id: string
          user_id: string | null
          ward_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          thread_id: string
          user_id?: string | null
          ward_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          thread_id?: string
          user_id?: string | null
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_messages_thread_id_ward_id_fkey"
            columns: ["thread_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "conversation_threads"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "conversation_messages_user_id_ward_id_fkey"
            columns: ["user_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "conversation_messages_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_threads: {
        Row: {
          created_at: string
          id: string
          org_id: string | null
          thread_type: string | null
          ward_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id?: string | null
          thread_type?: string | null
          ward_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string | null
          thread_type?: string | null
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_threads_org_id_ward_id_fkey"
            columns: ["org_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "conversation_threads_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      document_chunks: {
        Row: {
          chunk_index: number | null
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          id: string
          ward_id: string
        }
        Insert: {
          chunk_index?: number | null
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
          ward_id: string
        }
        Update: {
          chunk_index?: number | null
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_ward_id_fkey"
            columns: ["document_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "document_chunks_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          created_at: string
          desired_frequency_months: number | null
          id: string
          last_fulfilled_at: string | null
          notes: string | null
          org_id: string | null
          status: string | null
          target_id: string | null
          target_type: string | null
          title: string
          ward_id: string
        }
        Insert: {
          created_at?: string
          desired_frequency_months?: number | null
          id?: string
          last_fulfilled_at?: string | null
          notes?: string | null
          org_id?: string | null
          status?: string | null
          target_id?: string | null
          target_type?: string | null
          title: string
          ward_id: string
        }
        Update: {
          created_at?: string
          desired_frequency_months?: number | null
          id?: string
          last_fulfilled_at?: string | null
          notes?: string | null
          org_id?: string | null
          status?: string | null
          target_id?: string | null
          target_type?: string | null
          title?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_org_fk"
            columns: ["org_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "goals_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      household_stewardships: {
        Row: {
          created_at: string
          created_by: string | null
          household_id: string
          id: string
          org_id: string
          ward_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          household_id: string
          id?: string
          org_id: string
          ward_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          household_id?: string
          id?: string
          org_id?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_stewardships_created_by_ward_id_fkey"
            columns: ["created_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "household_stewardships_household_id_ward_id_fkey"
            columns: ["household_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "household_stewardships_org_id_ward_id_fkey"
            columns: ["org_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "household_stewardships_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      household_visit_cadences: {
        Row: {
          cadence_amount: number
          cadence_unit: string
          created_at: string
          created_by: string | null
          household_id: string
          id: string
          org_id: string
          updated_at: string
          ward_id: string
        }
        Insert: {
          cadence_amount: number
          cadence_unit: string
          created_at?: string
          created_by?: string | null
          household_id: string
          id?: string
          org_id: string
          updated_at?: string
          ward_id: string
        }
        Update: {
          cadence_amount?: number
          cadence_unit?: string
          created_at?: string
          created_by?: string | null
          household_id?: string
          id?: string
          org_id?: string
          updated_at?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_visit_cadences_created_by_ward_id_fkey"
            columns: ["created_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "household_visit_cadences_household_id_ward_id_fkey"
            columns: ["household_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "household_visit_cadences_org_id_ward_id_fkey"
            columns: ["org_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "household_visit_cadences_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          address: string | null
          created_at: string
          do_not_contact: boolean
          family_name: string
          id: string
          latitude: number | null
          longitude: number | null
          ward_id: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          do_not_contact?: boolean
          family_name: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          ward_id: string
        }
        Update: {
          address?: string | null
          created_at?: string
          do_not_contact?: boolean
          family_name?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "households_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      hymn_selections: {
        Row: {
          ai_suggested: boolean
          created_at: string
          hymn_number: number | null
          hymn_title: string | null
          hymn_type: string | null
          id: string
          selected_by: string | null
          sunday_id: string | null
          ward_id: string
        }
        Insert: {
          ai_suggested?: boolean
          created_at?: string
          hymn_number?: number | null
          hymn_title?: string | null
          hymn_type?: string | null
          id?: string
          selected_by?: string | null
          sunday_id?: string | null
          ward_id: string
        }
        Update: {
          ai_suggested?: boolean
          created_at?: string
          hymn_number?: number | null
          hymn_title?: string | null
          hymn_type?: string | null
          id?: string
          selected_by?: string | null
          sunday_id?: string | null
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hymn_selections_selected_by_ward_id_fkey"
            columns: ["selected_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "hymn_selections_sunday_id_ward_id_fkey"
            columns: ["sunday_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "sundays"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "hymn_selections_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      hymns: {
        Row: {
          id: number
          number: number
          source: string
          title: string
          topic_tags: string[]
        }
        Insert: {
          id?: number
          number: number
          source: string
          title: string
          topic_tags?: string[]
        }
        Update: {
          id?: number
          number?: number
          source?: string
          title?: string
          topic_tags?: string[]
        }
        Relationships: []
      }
      invites: {
        Row: {
          counselor_position: number | null
          created_at: string
          email: string | null
          expires_at: string | null
          id: string
          invited_by: string | null
          org_id: string | null
          role: string | null
          token: string
          used_at: string | null
          ward_id: string
        }
        Insert: {
          counselor_position?: number | null
          created_at?: string
          email?: string | null
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          org_id?: string | null
          role?: string | null
          token: string
          used_at?: string | null
          ward_id: string
        }
        Update: {
          counselor_position?: number | null
          created_at?: string
          email?: string | null
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          org_id?: string | null
          role?: string | null
          token?: string
          used_at?: string | null
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_org_id_ward_id_fkey"
            columns: ["org_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "invites_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_documents: {
        Row: {
          conference_date: string | null
          file_url: string | null
          id: string
          speaker: string | null
          speaker_role: string | null
          status: string
          title: string
          type_tag: string | null
          uploaded_at: string
          uploaded_by: string | null
          ward_id: string
        }
        Insert: {
          conference_date?: string | null
          file_url?: string | null
          id?: string
          speaker?: string | null
          speaker_role?: string | null
          status?: string
          title: string
          type_tag?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
          ward_id: string
        }
        Update: {
          conference_date?: string | null
          file_url?: string | null
          id?: string
          speaker?: string | null
          speaker_role?: string | null
          status?: string
          title?: string
          type_tag?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_documents_uploaded_by_ward_id_fkey"
            columns: ["uploaded_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "knowledge_documents_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      member_notes: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          member_id: string
          updated_at: string
          ward_id: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          member_id: string
          updated_at?: string
          ward_id: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          member_id?: string
          updated_at?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_notes_member_id_ward_id_fkey"
            columns: ["member_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "member_notes_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      member_organizations: {
        Row: {
          created_at: string
          id: string
          member_id: string
          org_id: string
          ward_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          member_id: string
          org_id: string
          ward_id: string
        }
        Update: {
          created_at?: string
          id?: string
          member_id?: string
          org_id?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_organizations_member_id_ward_id_fkey"
            columns: ["member_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "member_organizations_org_id_ward_id_fkey"
            columns: ["org_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "member_organizations_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          category: string | null
          created_at: string
          first_name: string
          gender: string | null
          household_id: string | null
          id: string
          last_name: string
          phone: string | null
          status: string
          ward_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          first_name: string
          gender?: string | null
          household_id?: string | null
          id?: string
          last_name: string
          phone?: string | null
          status?: string
          ward_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          first_name?: string
          gender?: string | null
          household_id?: string | null
          id?: string
          last_name?: string
          phone?: string | null
          status?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "members_household_id_ward_id_fkey"
            columns: ["household_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "members_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      musical_numbers: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          performer: string | null
          piece_title: string | null
          sunday_id: string | null
          ward_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          performer?: string | null
          piece_title?: string | null
          sunday_id?: string | null
          ward_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          performer?: string | null
          piece_title?: string | null
          sunday_id?: string | null
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "musical_numbers_sunday_id_ward_id_fkey"
            columns: ["sunday_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "sundays"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "musical_numbers_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_settings: {
        Row: {
          created_at: string
          default_roles: string[]
          id: string
          is_globally_enabled: boolean
          trigger_key: string
          ward_id: string
        }
        Insert: {
          created_at?: string
          default_roles?: string[]
          id?: string
          is_globally_enabled?: boolean
          trigger_key: string
          ward_id: string
        }
        Update: {
          created_at?: string
          default_roles?: string[]
          id?: string
          is_globally_enabled?: boolean
          trigger_key?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_settings_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_user_prefs: {
        Row: {
          id: string
          is_enabled: boolean
          trigger_key: string
          user_id: string
          ward_id: string
        }
        Insert: {
          id?: string
          is_enabled?: boolean
          trigger_key: string
          user_id: string
          ward_id: string
        }
        Update: {
          id?: string
          is_enabled?: boolean
          trigger_key?: string
          user_id?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_user_prefs_user_id_ward_id_fkey"
            columns: ["user_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "notification_user_prefs_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          read_at: string | null
          recipient_user_id: string
          title: string | null
          trigger_key: string
          ward_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          recipient_user_id: string
          title?: string | null
          trigger_key: string
          ward_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          recipient_user_id?: string
          title?: string | null
          trigger_key?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_user_id_ward_id_fkey"
            columns: ["recipient_user_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "notifications_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          type: string
          ward_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          type: string
          ward_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          type?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      prayer_assignments: {
        Row: {
          asked_at: string | null
          asked_by: string | null
          confirmed_at: string | null
          created_at: string
          id: string
          member_id: string | null
          prayer_type: string | null
          stage: string
          sunday_id: string | null
          ward_id: string
        }
        Insert: {
          asked_at?: string | null
          asked_by?: string | null
          confirmed_at?: string | null
          created_at?: string
          id?: string
          member_id?: string | null
          prayer_type?: string | null
          stage?: string
          sunday_id?: string | null
          ward_id: string
        }
        Update: {
          asked_at?: string | null
          asked_by?: string | null
          confirmed_at?: string | null
          created_at?: string
          id?: string
          member_id?: string | null
          prayer_type?: string | null
          stage?: string
          sunday_id?: string | null
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prayer_assignments_asked_by_ward_id_fkey"
            columns: ["asked_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "prayer_assignments_member_id_ward_id_fkey"
            columns: ["member_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "prayer_assignments_sunday_id_ward_id_fkey"
            columns: ["sunday_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "sundays"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "prayer_assignments_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      programs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          distributed_at: string | null
          distributed_by: string | null
          draft_data: Json | null
          id: string
          pdf_url: string | null
          public_data: Json | null
          status: string
          sunday_id: string | null
          ward_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          distributed_at?: string | null
          distributed_by?: string | null
          draft_data?: Json | null
          id?: string
          pdf_url?: string | null
          public_data?: Json | null
          status?: string
          sunday_id?: string | null
          ward_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          distributed_at?: string | null
          distributed_by?: string | null
          draft_data?: Json | null
          id?: string
          pdf_url?: string | null
          public_data?: Json | null
          status?: string
          sunday_id?: string | null
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "programs_approved_by_ward_id_fkey"
            columns: ["approved_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "programs_created_by_ward_id_fkey"
            columns: ["created_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "programs_distributed_by_ward_id_fkey"
            columns: ["distributed_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "programs_sunday_id_ward_id_fkey"
            columns: ["sunday_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "sundays"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "programs_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      public_pages: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          page_type: string
          slug: string
          ward_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          page_type: string
          slug: string
          ward_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          page_type?: string
          slug?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_pages_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      report_read_status: {
        Row: {
          flagged: boolean
          id: string
          read_at: string | null
          report_id: string
          report_type: string
          user_id: string
          ward_id: string
        }
        Insert: {
          flagged?: boolean
          id?: string
          read_at?: string | null
          report_id: string
          report_type: string
          user_id: string
          ward_id: string
        }
        Update: {
          flagged?: boolean
          id?: string
          read_at?: string | null
          report_id?: string
          report_type?: string
          user_id?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_read_status_user_id_ward_id_fkey"
            columns: ["user_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "report_read_status_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      retrieval_filters: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          label: string
          since: string | null
          source_phrase: string
          speaker_roles: string[] | null
          speakers: string[] | null
          ward_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          since?: string | null
          source_phrase: string
          speaker_roles?: string[] | null
          speakers?: string[] | null
          ward_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          since?: string | null
          source_phrase?: string
          speaker_roles?: string[] | null
          speakers?: string[] | null
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retrieval_filters_created_by_ward_id_fkey"
            columns: ["created_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "retrieval_filters_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      retrieval_suggestions: {
        Row: {
          created_at: string
          document_id: string
          id: string
          module: string
          run_id: string
          ward_id: string
        }
        Insert: {
          created_at?: string
          document_id: string
          id?: string
          module: string
          run_id: string
          ward_id: string
        }
        Update: {
          created_at?: string
          document_id?: string
          id?: string
          module?: string
          run_id?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retrieval_suggestions_document_id_ward_id_fkey"
            columns: ["document_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "retrieval_suggestions_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      sacrament_assignment_managers: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          id: string
          is_active: boolean
          member_id: string | null
          user_id: string | null
          ward_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          is_active?: boolean
          member_id?: string | null
          user_id?: string | null
          ward_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          is_active?: boolean
          member_id?: string | null
          user_id?: string | null
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sacrament_assignment_managers_assigned_by_ward_id_fkey"
            columns: ["assigned_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "sacrament_assignment_managers_member_id_ward_id_fkey"
            columns: ["member_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "sacrament_assignment_managers_user_id_ward_id_fkey"
            columns: ["user_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "sacrament_assignment_managers_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      sacrament_assignments: {
        Row: {
          assignment_type: string
          created_at: string
          created_by: string | null
          id: string
          is_override: boolean
          member_ids: string[]
          override_reason: string | null
          sunday_id: string | null
          updated_at: string
          updated_by: string | null
          ward_id: string
        }
        Insert: {
          assignment_type: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_override?: boolean
          member_ids?: string[]
          override_reason?: string | null
          sunday_id?: string | null
          updated_at?: string
          updated_by?: string | null
          ward_id: string
        }
        Update: {
          assignment_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_override?: boolean
          member_ids?: string[]
          override_reason?: string | null
          sunday_id?: string | null
          updated_at?: string
          updated_by?: string | null
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sacrament_assignments_created_by_ward_id_fkey"
            columns: ["created_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "sacrament_assignments_sunday_id_ward_id_fkey"
            columns: ["sunday_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "sundays"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "sacrament_assignments_updated_by_ward_id_fkey"
            columns: ["updated_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "sacrament_assignments_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      sacrament_rotation_pools: {
        Row: {
          assignment_type: string
          created_at: string
          created_by: string | null
          id: string
          member_ids: string[]
          updated_at: string
          ward_id: string
        }
        Insert: {
          assignment_type: string
          created_at?: string
          created_by?: string | null
          id?: string
          member_ids?: string[]
          updated_at?: string
          ward_id: string
        }
        Update: {
          assignment_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          member_ids?: string[]
          updated_at?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sacrament_rotation_pools_created_by_ward_id_fkey"
            columns: ["created_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "sacrament_rotation_pools_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      sacrament_send_log: {
        Row: {
          id: string
          month: string | null
          sent_at: string
          sent_by_user_id: string | null
          ward_id: string
        }
        Insert: {
          id?: string
          month?: string | null
          sent_at?: string
          sent_by_user_id?: string | null
          ward_id: string
        }
        Update: {
          id?: string
          month?: string | null
          sent_at?: string
          sent_by_user_id?: string | null
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sacrament_send_log_sent_by_user_id_ward_id_fkey"
            columns: ["sent_by_user_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "sacrament_send_log_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      sunday_org_conducting: {
        Row: {
          created_at: string
          id: string
          org_id: string
          sunday_id: string
          user_id: string | null
          ward_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          sunday_id: string
          user_id?: string | null
          ward_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          sunday_id?: string
          user_id?: string | null
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sunday_org_conducting_org_id_ward_id_fkey"
            columns: ["org_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "sunday_org_conducting_sunday_id_ward_id_fkey"
            columns: ["sunday_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "sundays"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "sunday_org_conducting_user_id_ward_id_fkey"
            columns: ["user_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "sunday_org_conducting_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      sundays: {
        Row: {
          conducting_user_id: string | null
          created_at: string
          date: string
          fast_sunday_pinned: boolean
          id: string
          notes: string | null
          presiding_override: string | null
          slot_config: Json | null
          speaking_slots: number
          type: string
          ward_id: string
        }
        Insert: {
          conducting_user_id?: string | null
          created_at?: string
          date: string
          fast_sunday_pinned?: boolean
          id?: string
          notes?: string | null
          presiding_override?: string | null
          slot_config?: Json | null
          speaking_slots?: number
          type?: string
          ward_id: string
        }
        Update: {
          conducting_user_id?: string | null
          created_at?: string
          date?: string
          fast_sunday_pinned?: boolean
          id?: string
          notes?: string | null
          presiding_override?: string | null
          slot_config?: Json | null
          speaking_slots?: number
          type?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sundays_conducting_user_id_ward_id_fkey"
            columns: ["conducting_user_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "sundays_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      tithing_entries: {
        Row: {
          bills_1: number
          bills_10: number
          bills_100: number
          bills_2: number
          bills_20: number
          bills_5: number
          bills_50: number
          checks: Json | null
          coins_dime: number
          coins_dollar: number
          coins_half: number
          coins_nickel: number
          coins_penny: number
          coins_quarter: number
          created_at: string
          entry_number: number
          id: string
          session_id: string
          ward_id: string
        }
        Insert: {
          bills_1?: number
          bills_10?: number
          bills_100?: number
          bills_2?: number
          bills_20?: number
          bills_5?: number
          bills_50?: number
          checks?: Json | null
          coins_dime?: number
          coins_dollar?: number
          coins_half?: number
          coins_nickel?: number
          coins_penny?: number
          coins_quarter?: number
          created_at?: string
          entry_number: number
          id?: string
          session_id: string
          ward_id: string
        }
        Update: {
          bills_1?: number
          bills_10?: number
          bills_100?: number
          bills_2?: number
          bills_20?: number
          bills_5?: number
          bills_50?: number
          checks?: Json | null
          coins_dime?: number
          coins_dollar?: number
          coins_half?: number
          coins_nickel?: number
          coins_penny?: number
          coins_quarter?: number
          created_at?: string
          entry_number?: number
          id?: string
          session_id?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tithing_entries_session_id_ward_id_fkey"
            columns: ["session_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "tithing_sessions"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "tithing_entries_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      tithing_sessions: {
        Row: {
          auto_clear_at: string | null
          created_at: string
          created_by: string | null
          id: string
          session_date: string
          ward_id: string
        }
        Insert: {
          auto_clear_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          session_date: string
          ward_id: string
        }
        Update: {
          auto_clear_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          session_date?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tithing_sessions_created_by_ward_id_fkey"
            columns: ["created_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "tithing_sessions_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_candidates: {
        Row: {
          accepted_topic_id: string | null
          category: string | null
          created_at: string
          description: string | null
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          suggested_scriptures: Json | null
          suggested_talks: Json | null
          title: string
          ward_id: string
        }
        Insert: {
          accepted_topic_id?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          suggested_scriptures?: Json | null
          suggested_talks?: Json | null
          title: string
          ward_id: string
        }
        Update: {
          accepted_topic_id?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          suggested_scriptures?: Json | null
          suggested_talks?: Json | null
          title?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_candidates_accepted_topic_id_ward_id_fkey"
            columns: ["accepted_topic_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "topic_candidates_reviewed_by_ward_id_fkey"
            columns: ["reviewed_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "topic_candidates_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      topics: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          id: string
          last_assigned_at: string | null
          source: string | null
          status: string
          suggested_scriptures: Json | null
          suggested_talks: Json | null
          title: string
          ward_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          last_assigned_at?: string | null
          source?: string | null
          status?: string
          suggested_scriptures?: Json | null
          suggested_talks?: Json | null
          title: string
          ward_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          last_assigned_at?: string | null
          source?: string | null
          status?: string
          suggested_scriptures?: Json | null
          suggested_talks?: Json | null
          title?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "topics_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          counselor_position: number | null
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          is_active: boolean
          last_name: string | null
          org_id: string | null
          role: string
          theme_preference: string
          username: string | null
          ward_id: string
        }
        Insert: {
          counselor_position?: number | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id: string
          is_active?: boolean
          last_name?: string | null
          org_id?: string | null
          role: string
          theme_preference?: string
          username?: string | null
          ward_id: string
        }
        Update: {
          counselor_position?: number | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          is_active?: boolean
          last_name?: string | null
          org_id?: string | null
          role?: string
          theme_preference?: string
          username?: string | null
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_org_id_ward_id_fkey"
            columns: ["org_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "users_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_appointments: {
        Row: {
          created_at: string
          household_id: string | null
          id: string
          made_by: string | null
          notes: string | null
          org_id: string | null
          scheduled_for: string
          status: string
          visit_log_id: string | null
          ward_id: string
        }
        Insert: {
          created_at?: string
          household_id?: string | null
          id?: string
          made_by?: string | null
          notes?: string | null
          org_id?: string | null
          scheduled_for: string
          status?: string
          visit_log_id?: string | null
          ward_id: string
        }
        Update: {
          created_at?: string
          household_id?: string | null
          id?: string
          made_by?: string | null
          notes?: string | null
          org_id?: string | null
          scheduled_for?: string
          status?: string
          visit_log_id?: string | null
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_appointments_household_id_ward_id_fkey"
            columns: ["household_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "visit_appointments_made_by_ward_id_fkey"
            columns: ["made_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "visit_appointments_org_id_ward_id_fkey"
            columns: ["org_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "visit_appointments_visit_log_id_ward_id_fkey"
            columns: ["visit_log_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "visit_logs"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "visit_appointments_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_goals: {
        Row: {
          cadence_amount: number | null
          cadence_unit: string | null
          created_at: string
          created_by: string | null
          deadline: string | null
          id: string
          notice_amount: number | null
          notice_unit: string | null
          org_id: string | null
          target_type: string | null
          title: string | null
          ward_id: string
        }
        Insert: {
          cadence_amount?: number | null
          cadence_unit?: string | null
          created_at?: string
          created_by?: string | null
          deadline?: string | null
          id?: string
          notice_amount?: number | null
          notice_unit?: string | null
          org_id?: string | null
          target_type?: string | null
          title?: string | null
          ward_id: string
        }
        Update: {
          cadence_amount?: number | null
          cadence_unit?: string | null
          created_at?: string
          created_by?: string | null
          deadline?: string | null
          id?: string
          notice_amount?: number | null
          notice_unit?: string | null
          org_id?: string | null
          target_type?: string | null
          title?: string | null
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_goals_created_by_ward_id_fkey"
            columns: ["created_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "visit_goals_org_id_ward_id_fkey"
            columns: ["org_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "visit_goals_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_logs: {
        Row: {
          arrangement: string
          created_at: string
          flag_sent_at: string | null
          flagged_for_ward_council: boolean
          household_id: string | null
          id: string
          org_id: string | null
          outcome: string
          recorded_by: string | null
          shared_notes: string | null
          visit_date: string
          visit_type: string
          ward_id: string
        }
        Insert: {
          arrangement?: string
          created_at?: string
          flag_sent_at?: string | null
          flagged_for_ward_council?: boolean
          household_id?: string | null
          id?: string
          org_id?: string | null
          outcome?: string
          recorded_by?: string | null
          shared_notes?: string | null
          visit_date: string
          visit_type?: string
          ward_id: string
        }
        Update: {
          arrangement?: string
          created_at?: string
          flag_sent_at?: string | null
          flagged_for_ward_council?: boolean
          household_id?: string | null
          id?: string
          org_id?: string | null
          outcome?: string
          recorded_by?: string | null
          shared_notes?: string | null
          visit_date?: string
          visit_type?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_logs_household_id_ward_id_fkey"
            columns: ["household_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "visit_logs_org_id_ward_id_fkey"
            columns: ["org_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "visit_logs_recorded_by_fkey"
            columns: ["recorded_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "visit_logs_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_participants: {
        Row: {
          created_at: string
          id: string
          label: string | null
          member_id: string | null
          org_id: string | null
          user_id: string | null
          visit_log_id: string
          ward_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string | null
          member_id?: string | null
          org_id?: string | null
          user_id?: string | null
          visit_log_id: string
          ward_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string | null
          member_id?: string | null
          org_id?: string | null
          user_id?: string | null
          visit_log_id?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_participants_member_id_ward_id_fkey"
            columns: ["member_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "visit_participants_org_id_ward_id_fkey"
            columns: ["org_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "visit_participants_user_id_ward_id_fkey"
            columns: ["user_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "visit_participants_visit_log_id_ward_id_fkey"
            columns: ["visit_log_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "visit_logs"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "visit_participants_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_private_notes: {
        Row: {
          created_at: string
          id: string
          notes: string
          updated_at: string
          user_id: string
          visit_log_id: string
          ward_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes: string
          updated_at?: string
          user_id: string
          visit_log_id: string
          ward_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string
          updated_at?: string
          user_id?: string
          visit_log_id?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_private_notes_user_id_ward_id_fkey"
            columns: ["user_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "visit_private_notes_visit_log_id_ward_id_fkey"
            columns: ["visit_log_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "visit_logs"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "visit_private_notes_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      wards: {
        Row: {
          created_at: string
          id: string
          name: string
          settings: Json
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          settings?: Json
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          settings?: Json
        }
        Relationships: []
      }
      youth_activity_profiles: {
        Row: {
          activity_name: string
          activity_type: string
          closed_at: string | null
          created_at: string
          entered_by: string | null
          id: string
          member_id: string
          notes: string | null
          org_id: string | null
          school_org: string | null
          season_schedule: string | null
          ward_id: string
        }
        Insert: {
          activity_name: string
          activity_type: string
          closed_at?: string | null
          created_at?: string
          entered_by?: string | null
          id?: string
          member_id: string
          notes?: string | null
          org_id?: string | null
          school_org?: string | null
          season_schedule?: string | null
          ward_id: string
        }
        Update: {
          activity_name?: string
          activity_type?: string
          closed_at?: string | null
          created_at?: string
          entered_by?: string | null
          id?: string
          member_id?: string
          notes?: string | null
          org_id?: string | null
          school_org?: string | null
          season_schedule?: string | null
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "youth_activity_profiles_entered_by_ward_id_fkey"
            columns: ["entered_by", "ward_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "youth_activity_profiles_member_id_ward_id_fkey"
            columns: ["member_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "youth_activity_profiles_org_id_ward_id_fkey"
            columns: ["org_id", "ward_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id", "ward_id"]
          },
          {
            foreignKeyName: "youth_activity_profiles_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      youth_login_attempts: {
        Row: {
          created_at: string
          failed_count: number
          id: string
          last_failed_at: string | null
          locked_until: string | null
          username: string
          ward_id: string
        }
        Insert: {
          created_at?: string
          failed_count?: number
          id?: string
          last_failed_at?: string | null
          locked_until?: string | null
          username: string
          ward_id: string
        }
        Update: {
          created_at?: string
          failed_count?: number
          id?: string
          last_failed_at?: string | null
          locked_until?: string | null
          username?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "youth_login_attempts_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      public_program: {
        Row: {
          distributed_at: string | null
          pdf_url: string | null
          public_data: Json | null
          slug: string | null
          sunday_date: string | null
          ward_name: string | null
        }
        Relationships: []
      }
      public_sacrament_assignments: {
        Row: {
          assignment_type: string | null
          first_name: string | null
          last_initial: string | null
          member_position: number | null
          slug: string | null
          sunday_date: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      activity_event_is_in_caller_org: {
        Args: { target_event_id: string }
        Returns: boolean
      }
      activity_profile_followup_count: {
        Args: { target_profile_id: string }
        Returns: number
      }
      applied_migration_versions: {
        Args: never
        Returns: {
          version: string
        }[]
      }
      apply_fast_sunday: {
        Args: {
          p_fast_sunday_id: string
          p_month_start: string
          p_ward_id: string
        }
        Returns: Json
      }
      apply_roster_import: {
        Args: { p_households: Json; p_members: Json; p_ward_id: string }
        Returns: Json
      }
      can_view_talks: { Args: never; Returns: boolean }
      current_org_id: { Args: never; Returns: string }
      current_user_role: { Args: never; Returns: string }
      current_ward_id: { Args: never; Returns: string }
      is_active_sacrament_manager: { Args: never; Returns: boolean }
      is_bishopric: { Args: never; Returns: boolean }
      match_document_chunks: {
        Args: {
          filter_since?: string
          filter_speaker_roles?: string[]
          filter_speakers?: string[]
          match_count: number
          match_ward_id: string
          query_embedding: string
        }
        Returns: {
          chunk_id: string
          chunk_index: number
          content: string
          document_id: string
          similarity: number
          title: string
          type_tag: string
        }[]
      }
      refresh_goal_status: { Args: never; Returns: number }
      tables_without_rls: {
        Args: never
        Returns: {
          table_name: string
        }[]
      }
      tithing_checks_are_integer_cents: {
        Args: { checks: Json }
        Returns: boolean
      }
      visit_log_is_writable_by_caller: {
        Args: { target_visit_log_id: string }
        Returns: boolean
      }
      ward_allows_cross_org_visibility: { Args: never; Returns: boolean }
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

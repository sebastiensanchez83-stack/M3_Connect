export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          user_id: string
          first_name: string
          last_name: string
          email: string
          job_title: string | null
          organization_type: string
          organization_name: string
          country: string
          website: string | null
          capacity: string | null
          role: 'user' | 'marina_pending' | 'marina_verified' | 'admin'
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          first_name: string
          last_name: string
          email: string
          job_title?: string | null
          organization_type: string
          organization_name: string
          country: string
          website?: string | null
          capacity?: string | null
          role?: 'user' | 'marina_pending' | 'marina_verified' | 'admin'
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          first_name?: string
          last_name?: string
          email?: string
          job_title?: string | null
          organization_type?: string
          organization_name?: string
          country?: string
          website?: string | null
          capacity?: string | null
          role?: 'user' | 'marina_pending' | 'marina_verified' | 'admin'
          created_at?: string
        }
      }
      resources: {
        Row: {
          id: string
          title: string
          summary: string
          content: string | null
          type: 'article' | 'whitepaper' | 'guide' | 'replay' | 'case_study'
          topic: string
          language: string
          access_level: 'public' | 'members' | 'marina'
          thumbnail_url: string | null
          file_url: string | null
          partner_id: string | null
          published: boolean
          created_at: string
        }
        Insert: {
          id?: string
          title: string
          summary: string
          content?: string | null
          type: 'article' | 'whitepaper' | 'guide' | 'replay' | 'case_study'
          topic: string
          language: string
          access_level: 'public' | 'members' | 'marina'
          thumbnail_url?: string | null
          file_url?: string | null
          partner_id?: string | null
          published?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          title?: string
          summary?: string
          content?: string | null
          type?: 'article' | 'whitepaper' | 'guide' | 'replay' | 'case_study'
          topic?: string
          language?: string
          access_level?: 'public' | 'members' | 'marina'
          thumbnail_url?: string | null
          file_url?: string | null
          partner_id?: string | null
          published?: boolean
          created_at?: string
        }
      }
      events: {
        Row: {
          id: string
          title: string
          description: string
          date_time: string
          location: string | null
          language: string
          access_level: 'public' | 'members' | 'marina'
          speakers: Json | null
          partner_id: string | null
          replay_url: string | null
          created_at: string
        }
        Insert: {
          id?: string
          title: string
          description: string
          date_time: string
          location?: string | null
          language: string
          access_level: 'public' | 'members' | 'marina'
          speakers?: Json | null
          partner_id?: string | null
          replay_url?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          title?: string
          description?: string
          date_time?: string
          location?: string | null
          language?: string
          access_level?: 'public' | 'members' | 'marina'
          speakers?: Json | null
          partner_id?: string | null
          replay_url?: string | null
          created_at?: string
        }
      }
      event_registrations: {
        Row: {
          id: string
          event_id: string
          user_id: string
          registered_at: string
        }
        Insert: {
          id?: string
          event_id: string
          user_id: string
          registered_at?: string
        }
        Update: {
          id?: string
          event_id?: string
          user_id?: string
          registered_at?: string
        }
      }
      partners: {
        Row: {
          id: string
          name: string
          description: string
          logo_url: string | null
          website: string | null
          sector: string
          country: string
          is_featured: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          description: string
          logo_url?: string | null
          website?: string | null
          sector: string
          country: string
          is_featured?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string
          logo_url?: string | null
          website?: string | null
          sector?: string
          country?: string
          is_featured?: boolean
          created_at?: string
        }
      }
      marina_projects: {
        Row: {
          id: string
          user_id: string
          project_type: string
          budget_range: string
          timeline: string
          description: string
          status: 'new' | 'in_progress' | 'completed'
          admin_notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          project_type: string
          budget_range: string
          timeline: string
          description: string
          status?: 'new' | 'in_progress' | 'completed'
          admin_notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          project_type?: string
          budget_range?: string
          timeline?: string
          description?: string
          status?: 'new' | 'in_progress' | 'completed'
          admin_notes?: string | null
          created_at?: string
        }
      }
      partner_leads: {
        Row: {
          id: string
          first_name: string
          last_name: string
          email: string
          phone: string | null
          company: string
          website: string | null
          country: string
          actor_type: string
          solutions: string | null
          goals: string | null
          engagement_level: string
          status: 'new' | 'qualified' | 'in_discussion' | 'signed' | 'rejected'
          admin_notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          first_name: string
          last_name: string
          email: string
          phone?: string | null
          company: string
          website?: string | null
          country: string
          actor_type: string
          solutions?: string | null
          goals?: string | null
          engagement_level: string
          status?: 'new' | 'qualified' | 'in_discussion' | 'signed' | 'rejected'
          admin_notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          first_name?: string
          last_name?: string
          email?: string
          phone?: string | null
          company?: string
          website?: string | null
          country?: string
          actor_type?: string
          solutions?: string | null
          goals?: string | null
          engagement_level?: string
          status?: 'new' | 'qualified' | 'in_discussion' | 'signed' | 'rejected'
          admin_notes?: string | null
          created_at?: string
        }
      }
    }
  }
}

export type Profile = Database['public']['Tables']['profiles']['Row']
export type Resource = Database['public']['Tables']['resources']['Row']
export type Event = Database['public']['Tables']['events']['Row']
export type EventRegistration = Database['public']['Tables']['event_registrations']['Row']
export type Partner = Database['public']['Tables']['partners']['Row']
export type MarinaProject = Database['public']['Tables']['marina_projects']['Row']
export type PartnerLead = Database['public']['Tables']['partner_leads']['Row']

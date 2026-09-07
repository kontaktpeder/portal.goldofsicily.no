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
      venues: {
        Row: {
          active: boolean
          address: string | null
          city: string | null
          contact_name: string | null
          created_at: string
          default_language: string
          email: string | null
          id: string
          image_url: string | null
          instagram: string | null
          latitude: number | null
          location: string | null
          logo_url: string | null
          longitude: number | null
          menu_intro: string | null
          name: string
          partner_id: string | null
          phone: string | null
          public_profile: "partner" | "listing"
          public_visible: boolean
          collaboration_text: string | null
          serving_story: string | null
          video_url: string | null
          menu_material_path: string | null
          menu_material_url: string | null
          gallery_urls: string[]
          serving_method: string | null
          slug: string | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          city?: string | null
          contact_name?: string | null
          created_at?: string
          default_language?: string
          email?: string | null
          id?: string
          image_url?: string | null
          instagram?: string | null
          latitude?: number | null
          location?: string | null
          logo_url?: string | null
          longitude?: number | null
          menu_intro?: string | null
          name: string
          partner_id?: string | null
          phone?: string | null
          public_profile?: "partner" | "listing"
          public_visible?: boolean
          collaboration_text?: string | null
          serving_story?: string | null
          video_url?: string | null
          menu_material_path?: string | null
          menu_material_url?: string | null
          gallery_urls?: string[]
          serving_method?: string | null
          slug?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          city?: string | null
          contact_name?: string | null
          created_at?: string
          default_language?: string
          email?: string | null
          id?: string
          image_url?: string | null
          instagram?: string | null
          latitude?: number | null
          location?: string | null
          logo_url?: string | null
          longitude?: number | null
          menu_intro?: string | null
          name?: string
          partner_id?: string | null
          phone?: string | null
          public_profile?: "partner" | "listing"
          public_visible?: boolean
          collaboration_text?: string | null
          serving_story?: string | null
          video_url?: string | null
          menu_material_path?: string | null
          menu_material_url?: string | null
          gallery_urls?: string[]
          serving_method?: string | null
          slug?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      deliveries: {
        Row: {
          created_at: string
          venue_id: string
          delivered_at: string
          id: string
          note: string | null
          quantity: number
        }
        Insert: {
          created_at?: string
          venue_id: string
          delivered_at?: string
          id?: string
          note?: string | null
          quantity: number
        }
        Update: {
          created_at?: string
          venue_id?: string
          delivered_at?: string
          id?: string
          note?: string | null
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_customer_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_lines: {
        Row: {
          created_at: string
          delivery_id: string
          gold_lot_id: string | null
          id: string
          product_id: string
          quantity: number
        }
        Insert: {
          created_at?: string
          delivery_id: string
          gold_lot_id?: string | null
          id?: string
          product_id: string
          quantity?: number
        }
        Update: {
          created_at?: string
          delivery_id?: string
          gold_lot_id?: string | null
          id?: string
          product_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "delivery_lines_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_lines_gold_lot_id_fkey"
            columns: ["gold_lot_id"]
            isOneToOne: false
            referencedRelation: "gold_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      gold_lots: {
        Row: {
          approved_qty: number | null
          carton_count: number
          created_at: string
          deviation_notes: string | null
          id: string
          lot_code: string
          produced_by: string | null
          produced_qty: number
          product_id: string
          product_version_id: string | null
          production_date: string
          recall_reason: string | null
          recalled_at: string | null
          recalled_by: string | null
          status: Database["public"]["Enums"]["gold_lot_status"]
          updated_at: string
        }
        Insert: {
          approved_qty?: number | null
          carton_count?: number
          created_at?: string
          deviation_notes?: string | null
          id?: string
          lot_code: string
          produced_by?: string | null
          produced_qty: number
          product_id: string
          product_version_id?: string | null
          production_date: string
          recall_reason?: string | null
          recalled_at?: string | null
          recalled_by?: string | null
          status?: Database["public"]["Enums"]["gold_lot_status"]
          updated_at?: string
        }
        Update: {
          approved_qty?: number | null
          carton_count?: number
          created_at?: string
          deviation_notes?: string | null
          id?: string
          lot_code?: string
          produced_by?: string | null
          produced_qty?: number
          product_id?: string
          product_version_id?: string | null
          production_date?: string
          recall_reason?: string | null
          recalled_at?: string | null
          recalled_by?: string | null
          status?: Database["public"]["Enums"]["gold_lot_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gold_lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gold_lots_product_version_id_fkey"
            columns: ["product_version_id"]
            isOneToOne: false
            referencedRelation: "product_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gold_lots_recalled_by_fkey"
            columns: ["recalled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      gold_lot_events: {
        Row: {
          created_at: string
          created_by: string | null
          event_type: Database["public"]["Enums"]["gold_lot_event_type"]
          gold_lot_id: string
          id: string
          metadata: Json
          reason: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_type: Database["public"]["Enums"]["gold_lot_event_type"]
          gold_lot_id: string
          id?: string
          metadata?: Json
          reason?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_type?: Database["public"]["Enums"]["gold_lot_event_type"]
          gold_lot_id?: string
          id?: string
          metadata?: Json
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gold_lot_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gold_lot_events_gold_lot_id_fkey"
            columns: ["gold_lot_id"]
            isOneToOne: false
            referencedRelation: "gold_lots"
            referencedColumns: ["id"]
          },
        ]
      }
      gold_lot_producers: {
        Row: {
          created_at: string
          employee_number_snapshot: string | null
          full_name_snapshot: string
          gold_lot_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          employee_number_snapshot?: string | null
          full_name_snapshot: string
          gold_lot_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          employee_number_snapshot?: string | null
          full_name_snapshot?: string
          gold_lot_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gold_lot_producers_gold_lot_id_fkey"
            columns: ["gold_lot_id"]
            isOneToOne: false
            referencedRelation: "gold_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gold_lot_producers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      gold_lot_handovers: {
        Row: {
          cartons: number
          created_at: string
          gold_lot_id: string
          handed_over_at: string
          id: string
          ownership_after_handover: Database["public"]["Enums"]["handover_ownership"]
          quantity: number
          recipient_company: string
          recipient_partner_id: string | null
          recipient_person: string | null
          recipient_venue_id: string | null
          storage_location: string | null
        }
        Insert: {
          cartons?: number
          created_at?: string
          gold_lot_id: string
          handed_over_at?: string
          id?: string
          ownership_after_handover?: Database["public"]["Enums"]["handover_ownership"]
          quantity: number
          recipient_company: string
          recipient_partner_id?: string | null
          recipient_person?: string | null
          recipient_venue_id?: string | null
          storage_location?: string | null
        }
        Update: {
          cartons?: number
          created_at?: string
          gold_lot_id?: string
          handed_over_at?: string
          id?: string
          ownership_after_handover?: Database["public"]["Enums"]["handover_ownership"]
          quantity?: number
          recipient_company?: string
          recipient_partner_id?: string | null
          recipient_person?: string | null
          recipient_venue_id?: string | null
          storage_location?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gold_lot_handovers_gold_lot_id_fkey"
            columns: ["gold_lot_id"]
            isOneToOne: false
            referencedRelation: "gold_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gold_lot_handovers_recipient_partner_id_fkey"
            columns: ["recipient_partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gold_lot_handovers_recipient_venue_id_fkey"
            columns: ["recipient_venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      gold_lot_ingredients: {
        Row: {
          best_before: string | null
          created_at: string
          gold_lot_id: string
          id: string
          ingredient_name: string
          quantity: number | null
          quantity_unit: string
          supplier_id: string
          supplier_lot_code: string | null
        }
        Insert: {
          best_before?: string | null
          created_at?: string
          gold_lot_id: string
          id?: string
          ingredient_name: string
          quantity?: number | null
          quantity_unit?: string
          supplier_id: string
          supplier_lot_code?: string | null
        }
        Update: {
          best_before?: string | null
          created_at?: string
          gold_lot_id?: string
          id?: string
          ingredient_name?: string
          quantity?: number | null
          quantity_unit?: string
          supplier_id?: string
          supplier_lot_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gold_lot_ingredients_gold_lot_id_fkey"
            columns: ["gold_lot_id"]
            isOneToOne: false
            referencedRelation: "gold_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gold_lot_ingredients_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "ingredient_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      gold_lot_cartons: {
        Row: {
          carton_code: string
          carton_seq: number
          created_at: string
          gold_lot_id: string
          id: string
        }
        Insert: {
          carton_code: string
          carton_seq: number
          created_at?: string
          gold_lot_id: string
          id?: string
        }
        Update: {
          carton_code?: string
          carton_seq?: number
          created_at?: string
          gold_lot_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gold_lot_cartons_gold_lot_id_fkey"
            columns: ["gold_lot_id"]
            isOneToOne: false
            referencedRelation: "gold_lots"
            referencedColumns: ["id"]
          },
        ]
      }
      gold_lot_packages: {
        Row: {
          carton_id: string | null
          created_at: string
          gold_lot_id: string
          id: string
          package_code: string
          package_seq: number
          quantity: number
        }
        Insert: {
          carton_id?: string | null
          created_at?: string
          gold_lot_id: string
          id?: string
          package_code: string
          package_seq: number
          quantity: number
        }
        Update: {
          carton_id?: string | null
          created_at?: string
          gold_lot_id?: string
          id?: string
          package_code?: string
          package_seq?: number
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "gold_lot_packages_carton_id_fkey"
            columns: ["carton_id"]
            isOneToOne: false
            referencedRelation: "gold_lot_cartons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gold_lot_packages_gold_lot_id_fkey"
            columns: ["gold_lot_id"]
            isOneToOne: false
            referencedRelation: "gold_lots"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_suppliers: {
        Row: {
          active: boolean
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      partners: {
        Row: {
          active: boolean
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          kind: Database["public"]["Enums"]["partner_kind"]
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["partner_kind"]
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["partner_kind"]
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      product_versions: {
        Row: {
          allergens_no: string | null
          created_at: string
          do_not_refreeze_no: string
          fingerprint: string
          id: string
          ingredients_no: string | null
          legal_designation_no: string
          name_en: string
          name_no: string
          nutrition_no: string | null
          packages_per_carton: number | null
          prep_no: string | null
          producer_address: string | null
          producer_name: string
          product_id: string
          shelf_life_days: number
          sku: string
          storage_no: string
          unit_weight_g: number | null
          units_per_package: number | null
          version_number: number
        }
        Insert: {
          allergens_no?: string | null
          created_at?: string
          do_not_refreeze_no: string
          fingerprint: string
          id?: string
          ingredients_no?: string | null
          legal_designation_no: string
          name_en: string
          name_no: string
          nutrition_no?: string | null
          packages_per_carton?: number | null
          prep_no?: string | null
          producer_address?: string | null
          producer_name: string
          product_id: string
          shelf_life_days?: number
          sku: string
          storage_no: string
          unit_weight_g?: number | null
          units_per_package?: number | null
          version_number: number
        }
        Update: {
          allergens_no?: string | null
          created_at?: string
          do_not_refreeze_no?: string
          fingerprint?: string
          id?: string
          ingredients_no?: string | null
          legal_designation_no?: string
          name_en?: string
          name_no?: string
          nutrition_no?: string | null
          packages_per_carton?: number | null
          prep_no?: string | null
          producer_address?: string | null
          producer_name?: string
          product_id?: string
          shelf_life_days?: number
          sku?: string
          storage_no?: string
          unit_weight_g?: number | null
          units_per_package?: number | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_versions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          allergens_no: string | null
          created_at: string
          description_en: string | null
          description_no: string | null
          do_not_refreeze_no: string | null
          id: string
          image_url: string | null
          ingredients_no: string | null
          legal_designation_no: string | null
          lot_letter: string | null
          name_en: string
          name_no: string
          nutrition_no: string | null
          packages_per_carton: number | null
          prep_no: string | null
          producer_address: string | null
          producer_name: string | null
          shelf_life_days: number | null
          sku: string
          slug: string
          sort_order: number
          storage_no: string | null
          unit_weight_g: number | null
          units_per_package: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          allergens_no?: string | null
          created_at?: string
          description_en?: string | null
          description_no?: string | null
          do_not_refreeze_no?: string | null
          id?: string
          image_url?: string | null
          ingredients_no?: string | null
          legal_designation_no?: string | null
          lot_letter?: string | null
          name_en: string
          name_no: string
          nutrition_no?: string | null
          packages_per_carton?: number | null
          prep_no?: string | null
          producer_address?: string | null
          producer_name?: string | null
          shelf_life_days?: number | null
          sku: string
          slug: string
          sort_order?: number
          storage_no?: string | null
          unit_weight_g?: number | null
          units_per_package?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          allergens_no?: string | null
          created_at?: string
          description_en?: string | null
          description_no?: string | null
          do_not_refreeze_no?: string | null
          id?: string
          image_url?: string | null
          ingredients_no?: string | null
          legal_designation_no?: string | null
          lot_letter?: string | null
          name_en?: string
          name_no?: string
          nutrition_no?: string | null
          packages_per_carton?: number | null
          prep_no?: string | null
          producer_address?: string | null
          producer_name?: string | null
          shelf_life_days?: number | null
          sku?: string
          slug?: string
          sort_order?: number
          storage_no?: string | null
          unit_weight_g?: number | null
          units_per_package?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          venue_id: string | null
          employee_number: string | null
          full_name: string | null
          id: string
          preferred_language: string
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          venue_id?: string | null
          employee_number?: string | null
          full_name?: string | null
          id: string
          preferred_language?: string
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          venue_id?: string | null
          employee_number?: string | null
          full_name?: string | null
          id?: string
          preferred_language?: string
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_customer_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_reports: {
        Row: {
          actual_quantity_received: number | null
          created_at: string
          venue_id: string
          delivery_correct: boolean | null
          delivery_id: string | null
          guest_feedback_rating:
            | Database["public"]["Enums"]["feedback_rating"]
            | null
          guest_feedback_text: string | null
          id: string
          needs_review: boolean
          next_required_quantity: number | null
          preparation_issue: boolean
          preparation_issue_text: string | null
          remaining_stock: number
          review_note: string | null
          sold_this_shift: number
          submitted_by: string | null
        }
        Insert: {
          actual_quantity_received?: number | null
          created_at?: string
          venue_id: string
          delivery_correct?: boolean | null
          delivery_id?: string | null
          guest_feedback_rating?:
            | Database["public"]["Enums"]["feedback_rating"]
            | null
          guest_feedback_text?: string | null
          id?: string
          needs_review?: boolean
          next_required_quantity?: number | null
          preparation_issue?: boolean
          preparation_issue_text?: string | null
          remaining_stock?: number
          review_note?: string | null
          sold_this_shift?: number
          submitted_by?: string | null
        }
        Update: {
          actual_quantity_received?: number | null
          created_at?: string
          venue_id?: string
          delivery_correct?: boolean | null
          delivery_id?: string | null
          guest_feedback_rating?:
            | Database["public"]["Enums"]["feedback_rating"]
            | null
          guest_feedback_text?: string | null
          id?: string
          needs_review?: boolean
          next_required_quantity?: number | null
          preparation_issue?: boolean
          preparation_issue_text?: string | null
          remaining_stock?: number
          review_note?: string | null
          sold_this_shift?: number
          submitted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_reports_customer_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_reports_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_report_lines: {
        Row: {
          created_at: string
          id: string
          next_required_quantity: number | null
          product_id: string
          remaining_stock: number
          shift_report_id: string
          sold: number
        }
        Insert: {
          created_at?: string
          id?: string
          next_required_quantity?: number | null
          product_id: string
          remaining_stock?: number
          shift_report_id: string
          sold?: number
        }
        Update: {
          created_at?: string
          id?: string
          next_required_quantity?: number | null
          product_id?: string
          remaining_stock?: number
          shift_report_id?: string
          sold?: number
        }
        Relationships: [
          {
            foreignKeyName: "shift_report_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_report_lines_shift_report_id_fkey"
            columns: ["shift_report_id"]
            isOneToOne: false
            referencedRelation: "shift_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_menu_items: {
        Row: {
          available: boolean
          created_at: string
          venue_id: string
          description: string | null
          display_name: string | null
          id: string
          image_url: string | null
          price_ore: number | null
          product_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          available?: boolean
          created_at?: string
          venue_id: string
          description?: string | null
          display_name?: string | null
          id?: string
          image_url?: string | null
          price_ore?: number | null
          product_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          available?: boolean
          created_at?: string
          venue_id?: string
          description?: string | null
          display_name?: string | null
          id?: string
          image_url?: string | null
          price_ore?: number | null
          product_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_menu_items_customer_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_menu_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
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
      current_customer_id: { Args: never; Returns: string }
      current_venue_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      can_manage_operations: { Args: never; Returns: boolean }
      can_manage_commercial: { Args: never; Returns: boolean }
      next_gold_lot_code: {
        Args: { p_lot_letter: string; p_production_date: string }
        Returns: string
      }
      slugify_name: { Args: { input: string }; Returns: string }
      submit_shift_report: {
        Args: {
          p_actual_quantity_received?: number | null
          p_venue_id: string
          p_delivery_correct?: boolean | null
          p_delivery_id?: string | null
          p_guest_feedback_rating?:
            | Database["public"]["Enums"]["feedback_rating"]
            | null
          p_guest_feedback_text?: string | null
          p_lines?: Json
          p_preparation_issue?: boolean
          p_preparation_issue_text?: string | null
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "ops" | "venue"
      feedback_rating: "positive" | "mixed" | "negative"
      gold_lot_event_type: "created" | "packed" | "handover" | "closed" | "recalled"
      gold_lot_status: "produced" | "packed" | "handed_over" | "closed" | "recalled"
      handover_ownership: "gold" | "villa"
      partner_kind: "distributor" | "direct"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["admin", "ops", "venue"],
      feedback_rating: ["positive", "mixed", "negative"],
      gold_lot_event_type: ["created", "packed", "handover", "closed", "recalled"],
      gold_lot_status: ["produced", "packed", "handed_over", "closed", "recalled"],
      handover_ownership: ["gold", "villa"],
      partner_kind: ["distributor", "direct"],
    },
  },
} as const

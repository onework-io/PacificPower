import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '')
const supabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '')

export const authConfigured = Boolean(supabaseUrl && supabaseAnonKey)
export const supabase: SupabaseClient | null = authConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  : null

export async function currentSession(): Promise<Session | null> {
  if (!supabase) return null
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session
}

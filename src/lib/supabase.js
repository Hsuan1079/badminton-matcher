import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://snwrvdvizxcyqeuvhcdv.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_CD2Qh5NPQ8se_NzmfMjPBw_dH9uw__f'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

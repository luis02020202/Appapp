// ============================================================
//  Tripp - Konfiguration
//  Trage hier deine zwei Supabase-Werte ein.
//  Findest du im Supabase Dashboard unter:
//  Project Settings -> API
//    1) "Project URL"        -> SUPABASE_URL
//    2) "Project API keys" -> "anon public" -> SUPABASE_ANON_KEY
//
//  Hinweis: Der anon-Key DARF öffentlich sein (er ist durch die
//  Datenbank-Policies geschützt). Niemals den "service_role"-Key hier rein!
// ============================================================

window.TRIPP_CONFIG = {
  SUPABASE_URL: "DEINE_PROJECT_URL_HIER",       // z.B. https://abcd1234.supabase.co
  SUPABASE_ANON_KEY: "DEIN_ANON_KEY_HIER",      // langer Token, beginnt mit "eyJ..."
};

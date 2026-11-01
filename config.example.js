// Copy this file to config.js to run the app locally. config.js is git-ignored.
// When deployed, config.js is generated from the repository secrets instead.
// Use the anon (public) key only — never the service_role key.
window.APP_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR-ANON-KEY',
};

// config.js — connects this website to the studio's Supabase project.
// Only PUBLIC values belong here: the project URL and the "anon" key are
// designed to be visible in a website. Security is enforced by RLS and the
// database functions. NEVER put the service_role / secret key in this file.
window.APP_CONFIG = {
  SUPABASE_URL: "https://dsavjqnkointcuzckvcu.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzYXZqcW5rb2ludGN1emNrdmN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3MDM4NDEsImV4cCI6MjEwODI3OTg0MX0.r-oJxPPQSAy2WVX6kDQOpUV1E-ISdvvLZmXSA6sTOcY",
};

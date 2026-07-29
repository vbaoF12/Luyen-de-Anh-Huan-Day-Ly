(() => {
  "use strict";

  const SUPABASE_URL =
    "https://zlkdpvlphrxywbyxdmet.supabase.co";

  const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_CggVzILc_r_iiwD5Q7eIHw_1LvhFiUj";

  if (!window.supabase) {
    console.error("Không tải được thư viện Supabase.");
    return;
  }

  window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );
})();
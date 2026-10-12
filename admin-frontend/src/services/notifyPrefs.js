// Single canonical notification-preference key set. Both SettingsView (writer)
// and AdminDashboardPage (reader) must use these helpers so popups/sound are
// actually gated by the same keys.
const KEYS = {
  newOrderPopup: "pa_notif_new_order_popup",
  printSound: "pa_notif_print_sound",
  printerAlerts: "pa_notif_printer_alerts",
};

// Legacy keys written by older builds; read as fallback, never written.
const LEGACY_KEYS = {
  newOrderPopup: ["notify_new_order", "notify_new_order_popup"],
  printSound: ["notify_sound", "notify_print_sound"],
  printerAlerts: ["notify_printer_alerts", "notify_printer_alert"],
};

export const getNotifPref = (name, defaultValue = true) => {
  try {
    const canonical = localStorage.getItem(KEYS[name]);
    if (canonical !== null) return canonical !== "false";
    for (const legacy of LEGACY_KEYS[name] || []) {
      const v = localStorage.getItem(legacy);
      if (v !== null) return v !== "false";
    }
  } catch {}
  return defaultValue;
};

export const setNotifPref = (name, value) => {
  try {
    localStorage.setItem(KEYS[name], String(value));
  } catch {}
};

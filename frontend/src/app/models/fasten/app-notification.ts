// A notification as the signed-in person sees it (#793). Mirrors GET /api/secure/notifications.

export interface AppNotification {
  id: string;
  type: 'maintenance' | 'system' | 'user';
  title: string;
  message: string;
  level: 'info' | 'warning' | 'error' | 'success';
  created_at: string;
  expires_at: string | null;
  // Where it is dealt with, as an in-app path ('/admin/database') — #854. Absent when there is nowhere to go.
  link?: string;
}

/** Plain words for where a notice's link goes, so its button says it instead of "Go there" or a path. */
export const NOTIFICATION_PLACES: Record<string, string> = {
  '/admin/database': 'Admin → Database',
  '/admin/config': 'Admin → Configuration',
  '/admin/logs': 'Admin → Server logs',
  '/admin/provider-catalog': 'Admin → Provider catalog',
  '/admin/users': 'Admin → Users',
};

/** The button text for a notice's link: "Go to Admin → Users", or "Open" for a place with no name yet. */
export function notificationLinkLabel(link: string): string {
  const place = NOTIFICATION_PLACES[link];
  return place ? `Go to ${place}` : 'Open';
}

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

// In-app SM26 notifications for the signed-in participant (e.g. "information
// needed"). Reads sm_notification (own rows via RLS); mark-as-read updates
// read_at. Renders nothing when there are no notifications.

interface Notif {
  id: string; type: string | null; title: string | null; body: string | null;
  link: string | null; read_at: string | null; created_at: string;
}

export function SM26Notifications() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Notif[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);

  const load = async () => {
    const { data } = await supabase
      .from('sm_notification')
      .select('id,type,title,body,link,read_at,created_at')
      .eq('user_id', user!.id)
      .order('created_at', { ascending: false })
      .limit(20);
    setItems((data || []) as Notif[]);
    setLoaded(true);
  };

  const markRead = async (id: string) => {
    const now = new Date().toISOString();
    await supabase.from('sm_notification').update({ read_at: now }).eq('id', id);
    setItems(prev => prev.map(n => n.id === id ? { ...n, read_at: now } : n));
  };

  const markAllRead = async () => {
    const now = new Date().toISOString();
    const ids = items.filter(n => !n.read_at).map(n => n.id);
    if (ids.length === 0) return;
    await supabase.from('sm_notification').update({ read_at: now }).in('id', ids);
    setItems(prev => prev.map(n => n.read_at ? n : { ...n, read_at: now }));
  };

  const open = (n: Notif) => {
    if (!n.read_at) markRead(n.id);
    if (n.link && n.link !== '/sm26/me') navigate(n.link);
  };

  if (!loaded || items.length === 0) return null;
  const unread = items.filter(n => !n.read_at).length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4 text-gray-400" /> Notifications
            {unread > 0 && <Badge className="text-[10px] bg-primary/10 text-primary border-primary/20">{unread} new</Badge>}
          </CardTitle>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-gray-500" onClick={markAllRead}>
              <Check className="h-3.5 w-3.5" /> Mark all read
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map(n => {
          const isUnread = !n.read_at;
          return (
            <button
              key={n.id}
              onClick={() => open(n)}
              className={`w-full text-left rounded-lg border p-3 transition-colors ${isUnread ? 'border-primary/20 bg-primary/5' : 'border-gray-100 bg-white hover:bg-gray-50'}`}
            >
              <div className="flex items-start gap-2">
                {isUnread && <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm ${isUnread ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{n.title || 'Notification'}</span>
                    <span className="text-[11px] text-gray-400 shrink-0">{new Date(n.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
                  </div>
                  {n.body && <p className="text-xs text-gray-500 mt-0.5">{n.body}</p>}
                </div>
              </div>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}

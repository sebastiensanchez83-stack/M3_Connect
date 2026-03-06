import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { LoginForm } from '@/components/auth/LoginForm';
import { SignupForm } from '@/components/auth/SignupForm';
import {
  ChevronLeft, Calendar, Clock, MapPin, Users, Play, RefreshCw,
  Download, DollarSign, UserCheck, AlertCircle, CheckCircle, Loader2,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';

interface EventDetail {
  id: string;
  title: string;
  description: string | null;
  date_time: string;
  location: string | null;
  language: string;
  access_level: string;
  speakers: { name: string; title: string }[];
  replay_url: string | null;
  pdf_url: string | null;
  fees: string | null;
  max_attendance: number | null;
  created_at: string;
}

export function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, profile, isVerified } = useAuth();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRegistered, setIsRegistered] = useState(false);
  const [registrationCount, setRegistrationCount] = useState(0);
  const [registering, setRegistering] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);

  const profileComplete = profile?.access_status === 'verified' && profile?.onboarding_status === 'completed';

  useEffect(() => {
    if (!id) return;
    const fetchEvent = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        console.error('Error fetching event:', error);
      } else {
        setEvent(data as EventDetail);
      }
      setLoading(false);
    };
    fetchEvent();
  }, [id]);

  // Check registration status
  useEffect(() => {
    if (!id || !user) return;
    const checkRegistration = async () => {
      const [regRes, countRes] = await Promise.all([
        supabase
          .from('event_registrations')
          .select('id')
          .eq('event_id', id)
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('event_registrations')
          .select('*', { count: 'exact', head: true })
          .eq('event_id', id),
      ]);
      setIsRegistered(!!regRes.data);
      setRegistrationCount(countRes.count || 0);
    };
    checkRegistration();
  }, [id, user]);

  const handleRegister = async () => {
    if (!user) {
      setLoginOpen(true);
      return;
    }
    if (!profileComplete) {
      toast({
        title: t('events.profileRequired', 'Complete your profile'),
        description: t('events.profileRequiredDesc', 'You need to complete and verify your profile before registering for events.'),
        variant: 'destructive',
      });
      navigate('/onboarding');
      return;
    }
    if (!id) return;
    setRegistering(true);
    const { error } = await supabase
      .from('event_registrations')
      .insert({ event_id: id, user_id: user.id });

    if (error) {
      console.error('Registration error:', error);
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    } else {
      setIsRegistered(true);
      setRegistrationCount((c) => c + 1);
      toast({ title: t('events.registered', 'Registration confirmed!') });
    }
    setRegistering(false);
  };

  const handleCancelRegistration = async () => {
    if (!id || !user) return;
    setRegistering(true);
    const { error } = await supabase
      .from('event_registrations')
      .delete()
      .eq('event_id', id)
      .eq('user_id', user.id);

    if (error) {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    } else {
      setIsRegistered(false);
      setRegistrationCount((c) => Math.max(0, c - 1));
      toast({ title: t('events.unregistered', 'Registration cancelled') });
    }
    setRegistering(false);
  };

  const getAccessBadge = (level: string) => {
    switch (level) {
      case 'public':
        return <Badge variant="success">{t('resources.accessLevels.public')}</Badge>;
      case 'members':
        return <Badge variant="info">{t('resources.accessLevels.members')}</Badge>;
      case 'marina':
        return <Badge variant="purple">{t('resources.accessLevels.marina')}</Badge>;
      default:
        return null;
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString(undefined, {
      hour: '2-digit', minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <RefreshCw className="h-8 w-8 animate-spin text-primary/40" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">{t('events.notFound', 'Event not found')}</h1>
        <Button asChild>
          <Link to="/events">
            <ChevronLeft className="h-4 w-4 mr-2" />
            {t('events.backToEvents', 'Back to Events')}
          </Link>
        </Button>
      </div>
    );
  }

  const isPast = new Date(event.date_time) <= new Date();
  const isFull = event.max_attendance ? registrationCount >= event.max_attendance : false;

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet>
        <title>{event.title} — Events — M3 Connect</title>
        <meta name="description" content={event.description?.substring(0, 160) || `Join ${event.title} on M3 Connect`} />
        <meta property="og:title" content={`${event.title} — M3 Connect`} />
        <meta property="og:description" content={event.description?.substring(0, 160) || ''} />
        <meta property="og:type" content="event" />
      </Helmet>
      {/* Hero */}
      <section className="bg-gradient-to-br from-[#1e3a5f] to-[#0d9488] text-white">
        <div className="container mx-auto px-4 py-12 lg:py-16">
          <Link to="/events" className="inline-flex items-center gap-1 text-white/70 hover:text-white mb-6 text-sm">
            <ChevronLeft className="h-4 w-4" />
            {t('events.backToEvents', 'Back to Events')}
          </Link>
          <div className="max-w-3xl">
            <div className="flex items-center gap-3 mb-4">
              {getAccessBadge(event.access_level)}
              {isPast && (
                <Badge variant="outline" className="border-white/30 text-white">
                  {t('events.past', 'Past Event')}
                </Badge>
              )}
            </div>
            <h1 className="text-3xl lg:text-4xl font-bold mb-4">{event.title}</h1>
            <div className="flex flex-wrap gap-6 text-white/80">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                <span>{formatDate(event.date_time)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                <span>{formatTime(event.date_time)}</span>
              </div>
              {event.location && (
                <div className="flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  <span>{event.location}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Content */}
      <div className="container mx-auto px-4 py-8 lg:py-12">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Description */}
            {event.description && (
              <div className="bg-white rounded-xl shadow-sm border p-6 lg:p-8">
                <h2 className="text-xl font-semibold text-gray-900 mb-4">{t('events.description', 'Description')}</h2>
                <div className="prose prose-gray max-w-none text-gray-600 leading-relaxed whitespace-pre-wrap">
                  {event.description}
                </div>
              </div>
            )}

            {/* Speakers */}
            {event.speakers && event.speakers.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border p-6 lg:p-8">
                <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  {t('events.speakers', 'Speakers')}
                </h2>
                <div className="grid sm:grid-cols-2 gap-4">
                  {event.speakers.map((speaker, idx) => (
                    <div key={idx} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                        {speaker.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium text-gray-900">{speaker.name}</div>
                        {speaker.title && (
                          <div className="text-sm text-gray-500">{speaker.title}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Replay */}
            {event.replay_url && isPast && (
              <div className="bg-white rounded-xl shadow-sm border p-6 lg:p-8">
                <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Play className="h-5 w-5 text-primary" />
                  {t('events.replay', 'Watch Replay')}
                </h2>
                <Button asChild>
                  <a href={event.replay_url} target="_blank" rel="noopener noreferrer">
                    <Play className="h-4 w-4 mr-2" />
                    {t('events.watchReplay', 'Watch Replay')}
                  </a>
                </Button>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Registration Card */}
            {!isPast && (
              <Card className="sticky top-20">
                <CardContent className="pt-6 space-y-4">
                  <h3 className="font-semibold text-lg">{t('events.register', 'Register')}</h3>

                  {/* Event Info */}
                  <div className="space-y-3 text-sm">
                    {event.fees && (
                      <div className="flex items-center gap-2 text-gray-600">
                        <DollarSign className="h-4 w-4 text-primary" />
                        <span>{event.fees}</span>
                      </div>
                    )}
                    {event.max_attendance && (
                      <div className="flex items-center gap-2 text-gray-600">
                        <UserCheck className="h-4 w-4 text-primary" />
                        <span>{registrationCount} / {event.max_attendance} {t('events.spots', 'spots')}</span>
                      </div>
                    )}
                  </div>

                  {/* Registration Button */}
                  {isRegistered ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-green-600 bg-green-50 p-3 rounded-lg">
                        <CheckCircle className="h-5 w-5" />
                        <span className="font-medium">{t('events.youAreRegistered', "You're registered!")}</span>
                      </div>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={handleCancelRegistration}
                        disabled={registering}
                      >
                        {registering && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                        {t('events.cancelRegistration', 'Cancel Registration')}
                      </Button>
                    </div>
                  ) : isFull ? (
                    <div className="flex items-center gap-2 text-amber-600 bg-amber-50 p-3 rounded-lg">
                      <AlertCircle className="h-5 w-5" />
                      <span className="font-medium">{t('events.eventFull', 'This event is full')}</span>
                    </div>
                  ) : user && !profileComplete ? (
                    <div className="space-y-3">
                      <div className="flex items-start gap-2 text-amber-600 bg-amber-50 p-3 rounded-lg text-sm">
                        <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                        <span>{t('events.completeProfileFirst', 'Please complete your profile to register for events.')}</span>
                      </div>
                      <Button className="w-full" onClick={() => navigate('/onboarding')}>
                        {t('events.completeProfile', 'Complete Profile')}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      className="w-full"
                      onClick={handleRegister}
                      disabled={registering}
                    >
                      {registering && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                      {user ? t('events.registerNow', 'Register Now') : t('events.loginToRegister', 'Log in to Register')}
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

            {/* PDF Download */}
            {event.pdf_url && (
              <Card>
                <CardContent className="pt-6">
                  <h3 className="font-semibold text-lg mb-3">{t('events.presentation', 'Presentation')}</h3>
                  <Button variant="outline" className="w-full" asChild>
                    <a href={event.pdf_url} target="_blank" rel="noopener noreferrer">
                      <Download className="h-4 w-4 mr-2" />
                      {t('events.downloadPdf', 'Download PDF')}
                    </a>
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Login Dialog */}
      <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('auth.login')}</DialogTitle>
            <DialogDescription>
              {t('events.loginToRegisterDesc', 'Log in to register for this event.')}{' '}
              <button className="text-primary hover:underline" onClick={() => { setLoginOpen(false); setSignupOpen(true); }}>
                {t('auth.signup')}
              </button>
            </DialogDescription>
          </DialogHeader>
          <LoginForm onSuccess={() => setLoginOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Signup Dialog */}
      <Dialog open={signupOpen} onOpenChange={setSignupOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('auth.signup')}</DialogTitle>
            <DialogDescription>
              {t('auth.haveAccount')}{' '}
              <button className="text-primary hover:underline" onClick={() => { setSignupOpen(false); setLoginOpen(true); }}>
                {t('auth.login')}
              </button>
            </DialogDescription>
          </DialogHeader>
          <SignupForm onSuccess={() => setSignupOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

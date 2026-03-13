import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuGroup,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LoginForm } from '@/components/auth/LoginForm';
import { SignupForm } from '@/components/auth/SignupForm';
import {
  Anchor, Menu, X, User, Globe, ChevronDown,
  CalendarDays, BookOpen, Building2, ShoppingBag,
  UserPlus, LogOut, Settings, FileText, Mic2,
  Ship, MessageSquare, Shield, LayoutDashboard, Ticket,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';

export function Navbar() {
  const { t, i18n } = useTranslation();
  const { user, profile, signOut, isVerified, isModerator, organization } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Track scroll for subtle shadow effect
  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const toggleLanguage = () => {
    const newLang = i18n.language === 'en' ? 'fr' : 'en';
    i18n.changeLanguage(newLang);
  };

  const handleLogout = async () => {
    await signOut();
    toast({ title: t('auth.logoutSuccess') });
    navigate('/', { replace: true });
  };

  const navLinks = [
    { href: '/', label: t('nav.home'), icon: LayoutDashboard },
    { href: '/resources', label: t('nav.resources'), icon: BookOpen },
    { href: '/events', label: t('nav.events'), icon: CalendarDays },
    { href: '/partners', label: t('nav.partners'), icon: Building2 },
    { href: '/marketplace', label: t('nav.marketplace'), icon: ShoppingBag },
    { href: '/become-partner', label: t('nav.becomePartner'), icon: UserPlus },
  ];

  const orgVerified = organization?.access_status === 'verified';
  const isMarina = profile?.persona === 'marina';
  const canSubmitProject = isMarina && isVerified && orgVerified;
  const canSubmitRFP = isMarina && isVerified && orgVerified;
  const canSubmitConsultation = isMarina && isVerified && orgVerified;
  const canRequestWebinar = isVerified && orgVerified;
  const hasActions = canSubmitProject || canSubmitRFP || canSubmitConsultation || canRequestWebinar;

  const isActive = (href: string) => {
    if (href === '/') return location.pathname === '/';
    return location.pathname.startsWith(href);
  };

  const displayName = profile?.first_name && profile?.last_name
    ? `${profile.first_name} ${profile.last_name}`
    : user?.email?.split('@')[0] || '';

  const userInitials = profile?.first_name && profile?.last_name
    ? `${profile.first_name[0]}${profile.last_name[0]}`.toUpperCase()
    : displayName.slice(0, 2).toUpperCase();

  return (
    <nav className={`sticky top-0 z-50 w-full bg-white/80 backdrop-blur-xl border-b transition-all duration-300 ${
      scrolled ? 'border-gray-200/80 shadow-sm' : 'border-transparent'
    }`}>
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-teal-500 flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow">
              <Anchor className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-primary to-teal-600 bg-clip-text text-transparent hidden sm:inline">
              M3 Connect
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex lg:items-center lg:gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                to={link.href}
                className={`relative px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                  isActive(link.href)
                    ? 'text-primary bg-primary/5'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                {link.label}
                {isActive(link.href) && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-0.5 bg-primary rounded-full" />
                )}
              </Link>
            ))}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {/* Language toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleLanguage}
              className="hidden sm:flex h-9 w-9 p-0 rounded-xl text-gray-500 hover:text-gray-900 hover:bg-gray-100"
            >
              <Globe className="h-4 w-4" />
            </Button>

            {/* Auth buttons / User menu */}
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="flex items-center gap-2 h-9 rounded-xl hover:bg-gray-100 pl-1.5 pr-2.5">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary/80 to-teal-500/80 flex items-center justify-center text-white text-xs font-bold shadow-sm">
                      {userInitials}
                    </div>
                    <span className="hidden sm:inline text-sm font-medium text-gray-700 max-w-[120px] truncate">{displayName}</span>
                    <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 rounded-xl shadow-lg border border-gray-200/80 p-1">
                  {/* User info header */}
                  <div className="px-3 py-2.5 mb-1">
                    <p className="text-sm font-semibold text-gray-900 truncate">{displayName}</p>
                    <p className="text-xs text-gray-500 truncate">{user.email}</p>
                  </div>
                  <DropdownMenuSeparator />

                  <DropdownMenuGroup>
                    <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
                      <Link to="/account" className="flex items-center gap-2.5">
                        <Settings className="h-4 w-4 text-gray-400" />
                        {t('nav.myAccount')}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
                      <Link to="/account?tab=registrations" className="flex items-center gap-2.5">
                        <Ticket className="h-4 w-4 text-gray-400" />
                        {t('nav.myRegistrations')}
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>

                  {/* Actions section */}
                  {hasActions && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-xs text-gray-400 font-normal uppercase tracking-wider px-3">
                        Actions
                      </DropdownMenuLabel>
                      <DropdownMenuGroup>
                        {canSubmitProject && (
                          <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
                            <Link to="/submit-project" className="flex items-center gap-2.5">
                              <FileText className="h-4 w-4 text-gray-400" />
                              {t('nav.submitProject')}
                            </Link>
                          </DropdownMenuItem>
                        )}
                        {canSubmitRFP && (
                          <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
                            <Link to="/submit-rfp" className="flex items-center gap-2.5">
                              <Ship className="h-4 w-4 text-gray-400" />
                              {t('nav.submitRfp')}
                            </Link>
                          </DropdownMenuItem>
                        )}
                        {canSubmitConsultation && (
                          <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
                            <Link to="/submit-consultation" className="flex items-center gap-2.5">
                              <MessageSquare className="h-4 w-4 text-gray-400" />
                              {t('nav.requestConsultation')}
                            </Link>
                          </DropdownMenuItem>
                        )}
                        {canRequestWebinar && (
                          <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
                            <Link to="/request-webinar" className="flex items-center gap-2.5">
                              <Mic2 className="h-4 w-4 text-gray-400" />
                              {t('nav.proposeWebinar')}
                            </Link>
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuGroup>
                    </>
                  )}

                  {/* Admin */}
                  {isModerator && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
                        <Link to="/admin" className="flex items-center gap-2.5">
                          <Shield className="h-4 w-4 text-gray-400" />
                          {t('nav.adminPanel')}
                        </Link>
                      </DropdownMenuItem>
                    </>
                  )}

                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} className="rounded-lg cursor-pointer text-red-600 focus:text-red-700 focus:bg-red-50">
                    <LogOut className="h-4 w-4 mr-2.5" />
                    {t('nav.logout')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="hidden sm:flex sm:items-center sm:gap-2">
                <Button variant="ghost" size="sm" onClick={() => setLoginOpen(true)} className="rounded-xl text-gray-600 hover:text-gray-900">
                  {t('nav.login')}
                </Button>
                <Button size="sm" onClick={() => setSignupOpen(true)} className="rounded-xl shadow-sm bg-gradient-to-r from-primary to-teal-600 hover:opacity-90 transition-opacity">
                  {t('nav.signup')}
                </Button>
              </div>
            )}

            {/* Mobile menu button */}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden h-9 w-9 rounded-xl"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile menu - slide down with animation */}
        <div className={`lg:hidden overflow-hidden transition-all duration-300 ease-in-out ${
          mobileMenuOpen ? 'max-h-[80vh] opacity-100' : 'max-h-0 opacity-0'
        }`}>
          <div className="py-4 border-t border-gray-100 space-y-1">
            {navLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  to={link.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    isActive(link.href)
                      ? 'text-primary bg-primary/5'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Icon className="h-4.5 w-4.5" />
                  {link.label}
                </Link>
              );
            })}

            {/* Mobile user actions */}
            {user && hasActions && (
              <div className="pt-3 mt-3 border-t border-gray-100">
                <p className="px-3 text-xs text-gray-400 uppercase tracking-wider font-medium mb-2">Actions</p>
                {canSubmitProject && (
                  <Link to="/submit-project" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-gray-50" onClick={() => setMobileMenuOpen(false)}>
                    <FileText className="h-4 w-4 text-gray-400" />
                    {t('nav.submitProject')}
                  </Link>
                )}
                {canSubmitRFP && (
                  <Link to="/submit-rfp" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-gray-50" onClick={() => setMobileMenuOpen(false)}>
                    <Ship className="h-4 w-4 text-gray-400" />
                    {t('nav.submitRfp')}
                  </Link>
                )}
                {canSubmitConsultation && (
                  <Link to="/submit-consultation" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-gray-50" onClick={() => setMobileMenuOpen(false)}>
                    <MessageSquare className="h-4 w-4 text-gray-400" />
                    {t('nav.requestConsultation')}
                  </Link>
                )}
                {canRequestWebinar && (
                  <Link to="/request-webinar" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-gray-50" onClick={() => setMobileMenuOpen(false)}>
                    <Mic2 className="h-4 w-4 text-gray-400" />
                    {t('nav.proposeWebinar')}
                  </Link>
                )}
              </div>
            )}

            {/* Mobile auth & settings */}
            <div className="pt-3 mt-3 border-t border-gray-100 space-y-1">
              <button onClick={toggleLanguage} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-gray-50 w-full text-left">
                <Globe className="h-4 w-4 text-gray-400" />
                {i18n.language === 'en' ? 'Français' : 'English'}
              </button>
              {user ? (
                <>
                  <Link to="/account" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-gray-50" onClick={() => setMobileMenuOpen(false)}>
                    <Settings className="h-4 w-4 text-gray-400" />
                    {t('nav.myAccount')}
                  </Link>
                  {isModerator && (
                    <Link to="/admin" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-gray-50" onClick={() => setMobileMenuOpen(false)}>
                      <Shield className="h-4 w-4 text-gray-400" />
                      {t('nav.adminPanel')}
                    </Link>
                  )}
                  <button onClick={() => { handleLogout(); setMobileMenuOpen(false); }} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-red-600 hover:bg-red-50 w-full text-left">
                    <LogOut className="h-4 w-4" />
                    {t('nav.logout')}
                  </button>
                </>
              ) : (
                <div className="flex gap-2 px-3 pt-2">
                  <Button variant="outline" className="flex-1 rounded-xl" onClick={() => { setLoginOpen(true); setMobileMenuOpen(false); }}>
                    {t('nav.login')}
                  </Button>
                  <Button className="flex-1 rounded-xl bg-gradient-to-r from-primary to-teal-600" onClick={() => { setSignupOpen(true); setMobileMenuOpen(false); }}>
                    {t('nav.signup')}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Login Dialog */}
      <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>{t('auth.login')}</DialogTitle>
            <DialogDescription>
              {t('auth.noAccount')}{' '}
              <button className="text-primary hover:underline font-medium" onClick={() => { setLoginOpen(false); setSignupOpen(true); }}>
                {t('auth.signup')}
              </button>
            </DialogDescription>
          </DialogHeader>
          <LoginForm onSuccess={() => setLoginOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Signup Dialog */}
      <Dialog open={signupOpen} onOpenChange={setSignupOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>{t('auth.signup')}</DialogTitle>
            <DialogDescription>
              {t('auth.haveAccount')}{' '}
              <button className="text-primary hover:underline font-medium" onClick={() => { setSignupOpen(false); setLoginOpen(true); }}>
                {t('auth.login')}
              </button>
            </DialogDescription>
          </DialogHeader>
          <SignupForm onSuccess={() => setSignupOpen(false)} />
        </DialogContent>
      </Dialog>
    </nav>
  );
}

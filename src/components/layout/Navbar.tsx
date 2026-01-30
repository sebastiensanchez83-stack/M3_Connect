import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
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
import { Anchor, Menu, X, User, Globe, ChevronDown } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

export function Navbar() {
  const { t, i18n } = useTranslation();
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);

  const toggleLanguage = () => {
    const newLang = i18n.language === 'en' ? 'fr' : 'en';
    i18n.changeLanguage(newLang);
  };

  const handleLogout = async () => {
    await signOut();
    toast({ title: t('auth.logoutSuccess') });
    navigate('/');
  };

  const navLinks = [
    { href: '/', label: t('nav.home') },
    { href: '/resources', label: t('nav.resources') },
    { href: '/events', label: t('nav.events') },
    { href: '/partners', label: t('nav.partners') },
    { href: '/become-partner', label: t('nav.becomePartner') },
  ];

  // Check if user can submit projects (verified marina)
  const canSubmitProject = profile?.role === 'marina' && profile?.status === 'verified';
  
  // Check if user is admin
  const isAdmin = profile?.role === 'admin';

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-2">
            <Anchor className="h-8 w-8 text-primary" />
            <span className="text-xl font-bold text-primary">M3 Connect</span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex md:items-center md:space-x-6">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                to={link.href}
                className="text-sm font-medium text-gray-700 hover:text-primary transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Right side */}
          <div className="flex items-center space-x-4">
            {/* Language toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleLanguage}
              className="hidden sm:flex"
            >
              <Globe className="h-4 w-4 mr-1" />
              {i18n.language.toUpperCase()}
            </Button>

            {/* Auth buttons / User menu */}
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="flex items-center space-x-2">
                    <User className="h-5 w-5" />
                    <span className="hidden sm:inline">{profile?.first_name}</span>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem asChild>
                    <Link to="/account">{t('nav.myAccount')}</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/account?tab=registrations">{t('nav.myRegistrations')}</Link>
                  </DropdownMenuItem>
                  {canSubmitProject && (
                    <DropdownMenuItem asChild>
                      <Link to="/submit-project">{t('nav.submitProject')}</Link>
                    </DropdownMenuItem>
                  )}
                  {isAdmin && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <Link to="/admin">{t('nav.adminPanel')}</Link>
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout}>
                    {t('nav.logout')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="hidden sm:flex sm:items-center sm:space-x-2">
                <Button variant="ghost" onClick={() => setLoginOpen(true)}>
                  {t('nav.login')}
                </Button>
                <Button onClick={() => setSignupOpen(true)}>
                  {t('nav.signup')}
                </Button>
              </div>
            )}

            {/* Mobile menu button */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </Button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t">
            <div className="flex flex-col space-y-4">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  to={link.href}
                  className="text-sm font-medium text-gray-700 hover:text-primary"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
              <div className="pt-4 border-t flex flex-col space-y-2">
                <Button variant="ghost" size="sm" onClick={toggleLanguage} className="justify-start">
                  <Globe className="h-4 w-4 mr-2" />
                  {i18n.language === 'en' ? 'Français' : 'English'}
                </Button>
                {!user && (
                  <>
                    <Button variant="ghost" onClick={() => { setLoginOpen(true); setMobileMenuOpen(false); }}>
                      {t('nav.login')}
                    </Button>
                    <Button onClick={() => { setSignupOpen(true); setMobileMenuOpen(false); }}>
                      {t('nav.signup')}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Login Dialog */}
      <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('auth.login')}</DialogTitle>
            <DialogDescription>
              {t('auth.noAccount')}{' '}
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
    </nav>
  );
}

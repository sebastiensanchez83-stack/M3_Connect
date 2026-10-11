import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { SITE_IMAGES, type SiteImage } from '@/lib/siteMedia';
import { cn } from '@/lib/utils';
import { registerAuthRefonteStrings } from '@/i18n/refonte-auth';

registerAuthRefonteStrings();

/** Lets the form inside replace the window's title for one of its steps (see useAuthDialogTitle). */
const AuthDialogTitleContext = createContext<((title: string | null) => void) | null>(null);

/**
 * Inside an AuthDialog: show `title` as the window's heading while it is not null
 * (e.g. LoginForm's "Get a link to set your password" step), so the window never
 * reads "Sign in" above another title. Returns whether the form is inside an
 * AuthDialog, i.e. whether it should leave out its own heading. A layout effect, so
 * the new heading is in place before the step is painted (no "Sign in" frame).
 */
export function useAuthDialogTitle(title: string | null): boolean {
  const setTitle = useContext(AuthDialogTitleContext);
  useLayoutEffect(() => {
    if (!setTitle) return;
    setTitle(title);
    return () => setTitle(null);
  }, [setTitle, title]);
  return !!setTitle;
}

/**
 * The one window for signing in and signing up, wherever it opens (header,
 * directory, an event, a resource, the SM26 page…): the same width, the same
 * photo band, the same heading and the same "switch" line, so the two windows
 * read as one family. The form inside (LoginForm / SignupForm) is unchanged.
 *
 *   <AuthDialog mode="login" open={loginOpen} onOpenChange={setLoginOpen}
 *     description="Sign in to keep a shortlist."
 *     switchTo={{ onClick: () => { setLoginOpen(false); setSignupOpen(true); } }}>
 *     <LoginForm onSuccess={() => setLoginOpen(false)} />
 *   </AuthDialog>
 *
 * `mode` picks the default title, the photo (the SM26 hall to come back, a stand
 * conversation to join) and the words of the switch line. The window scrolls
 * inside itself when the form is taller than the screen.
 */
export function AuthDialog({
  open,
  onOpenChange,
  mode,
  title,
  description,
  switchTo,
  photo,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'login' | 'signup';
  /** Default: "Sign in" / "Sign up". */
  title?: string;
  /** The sentence under the title. */
  description?: ReactNode;
  /** The line under the form that opens the other window ("No account yet? Sign up"). */
  switchTo?: { onClick: () => void; prompt?: string; label?: string };
  /** Default: the photo of the mode; `null` for none. */
  photo?: SiteImage | null;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const [stepTitle, setStepTitle] = useState<string | null>(null);
  const image = photo === undefined ? (mode === 'login' ? SITE_IMAGES.homeHero : SITE_IMAGES.joinHero) : photo;
  const heading = stepTitle ?? title ?? (mode === 'login' ? t('auth.login', 'Sign in') : t('auth.signup', 'Sign up'));
  const prompt = switchTo?.prompt ?? (mode === 'login' ? t('auth.noAccount', "Don't have an account?") : t('auth.haveAccount', 'Already have an account?'));
  const action = switchTo?.label ?? (mode === 'login' ? t('auth.signup', 'Sign up') : t('auth.login', 'Sign in'));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'max-h-[92vh] w-[calc(100%-2rem)] max-w-lg gap-0 overflow-y-auto rounded-card border-0 bg-white p-0 shadow-drawer sm:rounded-card',
          // The close (x), the content's last child (ui/dialog): a 44 px target, on a
          // white disc so that it shows on any photo (a dark x vanished on dark ones).
          '[&>button:last-child]:right-2 [&>button:last-child]:top-2 [&>button:last-child]:grid [&>button:last-child]:h-11 [&>button:last-child]:w-11 [&>button:last-child]:place-items-center',
          '[&>button:last-child]:rounded-full [&>button:last-child]:bg-white/85 [&>button:last-child]:text-navy [&>button:last-child]:opacity-100',
          className,
        )}
      >
        {image?.src && (
          <div aria-hidden="true" className="relative h-28 shrink-0 overflow-hidden bg-navy sm:h-32">
            <img
              src={image.src}
              alt=""
              className="h-full w-full object-cover"
              style={{ objectPosition: `50% ${Math.round(image.focusY * 100)}%` }}
            />
            {/* A light corner keeps the dialog's dark close (×) readable on any photo. */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,rgba(255,255,255,0.92)_0,rgba(255,255,255,0)_76px)]" />
          </div>
        )}
        <div className="px-6 pb-7 pt-6 sm:px-8 sm:pb-8">
          <Eyebrow>{t('authRefonte.shell.brand', 'Smart Marina Connect')}</Eyebrow>
          <DialogTitle className="mt-3 text-h2-sm tracking-[-0.01em] text-navy">{heading}</DialogTitle>
          {description ? (
            <DialogDescription className="mt-2 text-[15px] leading-6 text-meta">{description}</DialogDescription>
          ) : (
            // Radix wants a description; an empty one keeps screen readers quiet.
            <DialogDescription className="sr-only">{heading}</DialogDescription>
          )}
          <div className="mt-6">
            <AuthDialogTitleContext.Provider value={setStepTitle}>{children}</AuthDialogTitleContext.Provider>
          </div>
          {switchTo && (
            <p className="mt-6 border-t border-rule pt-5 text-center text-sm leading-6 text-meta">
              {prompt}{' '}
              <UnderlineLink arrow={false} onClick={switchTo.onClick} className="min-h-11 !text-sm">
                {action}
              </UnderlineLink>
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

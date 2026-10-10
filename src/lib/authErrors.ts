/**
 * Plain English for what GoTrue (Supabase Auth) refuses. Its own text ("Invalid login
 * credentials", "User already registered", "Request rate limit reached"...) never
 * reaches the page; in development it goes to the console.
 *
 * Used by every place that signs in or signs up with a password: the sign-in window
 * (LoginForm), the sign-up window (SignupForm) and the team invitation (JoinPage).
 */

export type AuthErrorLike = { code?: string; status?: number; name?: string; message?: string };

type T = (key: string, fallback: string) => string;

export function isRateLimited(error: AuthErrorLike): boolean {
  return error.status === 429 || error.code === 'over_request_rate_limit' || error.code === 'over_email_send_rate_limit';
}

/** No answer from the server at all (offline, blocked, timed out). */
export function isNetworkError(error: AuthErrorLike): boolean {
  return error.name === 'AuthRetryableFetchError' || error.status === 0 || /failed to fetch|network|load failed/i.test(error.message || '');
}

/** The e-mail address or the password is wrong (or the account has no password yet). */
export function isInvalidCredentials(error: AuthErrorLike | null | undefined): boolean {
  return !!error && (error.code === 'invalid_credentials' || /invalid login credentials/i.test(error.message || ''));
}

/** A refused sign-in, in plain words. */
export function signInErrorMessage(error: AuthErrorLike, t: T): string {
  if (import.meta.env.DEV) console.error('Sign-in refused:', error);
  if (isInvalidCredentials(error)) {
    return t('auth.signInError.invalid', 'The e-mail address or the password is not right. Check both and try again. Never chosen a password, or forgotten it? Set a new one with the link below.');
  }
  if (isRateLimited(error)) {
    return t('auth.signInError.tooMany', 'Too many attempts. Please wait a few minutes, then try again.');
  }
  if (error.code === 'user_banned') {
    return t('auth.signInError.suspended', 'This account is suspended. Please contact events@m3monaco.com.');
  }
  if (error.code === 'captcha_failed') {
    return t('auth.signInError.captcha', 'The security check did not go through. Reload the page and try again.');
  }
  if (error.code === 'validation_failed' || error.code === 'email_address_invalid') {
    return t('auth.signInError.badEmail', 'Please enter a valid e-mail address.');
  }
  if (isNetworkError(error)) {
    return t('auth.signInError.network', "We couldn't reach the server. Check your internet connection and try again.");
  }
  return t('auth.signInError.generic', "We couldn't sign you in just now. Please try again in a moment.");
}

/** An account already uses this address (GoTrue says so only while "Confirm email" is OFF). */
export function isAlreadyRegistered(error: AuthErrorLike | null | undefined): boolean {
  return !!error && (error.code === 'user_already_exists' || error.code === 'email_exists' || /already registered|already been registered/i.test(error.message || ''));
}

/** A refused sign-up, in plain words. */
export function signUpErrorMessage(error: AuthErrorLike, t: T): string {
  if (import.meta.env.DEV) console.error('Sign-up refused:', error);
  if (isAlreadyRegistered(error)) {
    return t('auth.accountAlreadyExists', 'An account with this e-mail already exists. Please sign in instead.');
  }
  if (error.code === 'weak_password' || /password should|password is too/i.test(error.message || '')) {
    return t('auth.signUpError.weakPassword', 'This password is too weak or too common. Choose a longer one (at least 8 characters), less easy to guess.');
  }
  if (isRateLimited(error)) {
    return t('auth.signUpError.tooMany', 'Too many attempts. Please wait a few minutes, then try again.');
  }
  if (error.code === 'captcha_failed') {
    return t('auth.signInError.captcha', 'The security check did not go through. Reload the page and try again.');
  }
  if (error.code === 'validation_failed' || error.code === 'email_address_invalid' || error.code === 'email_address_not_authorized') {
    return t('auth.signInError.badEmail', 'Please enter a valid e-mail address.');
  }
  if (error.code === 'signup_disabled') {
    return t('auth.signUpError.closed', 'Sign-up is closed for the moment. Please contact events@m3monaco.com.');
  }
  if (isNetworkError(error)) {
    return t('auth.signInError.network', "We couldn't reach the server. Check your internet connection and try again.");
  }
  return t('auth.signUpError.generic', "We couldn't create your account just now. Please try again in a moment.");
}

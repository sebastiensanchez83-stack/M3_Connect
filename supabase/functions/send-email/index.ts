import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const HOOK_SECRET = Deno.env.get("SEND_EMAIL_HOOK_SECRET");
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";

interface EmailPayload {
  user: {
    email: string;
    // The address an email change is moving to (only set while one is pending).
    new_email?: string;
    // Whatever was sent at sign-up or later through updateUser — untrusted.
    user_metadata?: Record<string, unknown>;
  };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
    token_new?: string;
    token_hash_new?: string;
  };
}

interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: { message: "Method not allowed" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!RESEND_API_KEY) {
      console.error("FATAL: RESEND_API_KEY environment variable is not set");
      return new Response(JSON.stringify({ error: { http_code: 500, message: "RESEND_API_KEY not configured" } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!HOOK_SECRET) {
      console.error("FATAL: SEND_EMAIL_HOOK_SECRET environment variable is not set");
      return new Response(JSON.stringify({ error: { http_code: 500, message: "SEND_EMAIL_HOOK_SECRET not configured" } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const payload = await req.text();
    const headers = Object.fromEntries(req.headers);

    const wh = new Webhook(HOOK_SECRET.replace("v1,whsec_", ""));

    let data: EmailPayload;
    try {
      data = wh.verify(payload, headers) as EmailPayload;
    } catch (err) {
      console.error("Webhook verification failed:", err);
      return new Response(JSON.stringify({ error: { http_code: 401, message: "Invalid signature" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { user, email_data } = data;
    const { token, token_hash, token_hash_new, redirect_to, email_action_type, site_url } = email_data;

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const redirectTarget = redirect_to || site_url;

    // Two ways to land someone back in the app, and the difference is why people
    // could not reset their password.
    //
    // The GoTrue /auth/v1/verify link spends its token on the FIRST GET. Corporate
    // mail scanners (Outlook ATP and friends) fetch every link before the recipient
    // ever sees it, so the token is already spent by the time they click: the
    // platform says "email link has expired" on the very first attempt, for ever.
    // It also redirects back with a PKCE code, which only resolves in the browser
    // that asked for the reset — so a link requested on a laptop and opened on a
    // phone cannot work either.
    //
    // Handing the token_hash to a page that redeems it itself fixes both: a scanner
    // fetching the page runs no JavaScript and so spends nothing, and verifyOtp is
    // checked server-side, so any device can complete it. Only pages that actually
    // call verifyOtp may be sent the hash — everything else keeps the old link.
    //
    // Built per token hash, because an email change under "Secure email change"
    // carries two of them, one for each address.
    const REDEEMING_PATHS = new Set(["/reset-password", "/welcome"]);
    const linkFor = (hash: string): { url: string; anyDevice: boolean } => {
      try {
        const target = new URL(redirectTarget);
        if (
          (target.protocol === "https:" || target.protocol === "http:") &&
          REDEEMING_PATHS.has(target.pathname.replace(/\/+$/, "") || "/")
        ) {
          target.searchParams.set("token_hash", hash);
          target.searchParams.set("type", email_action_type);
          return { url: target.toString(), anyDevice: true };
        }
      } catch {
        /* unparseable redirect target — keep the GoTrue link */
      }
      return {
        url: `${supabaseUrl}/auth/v1/verify?token=${encodeURIComponent(hash)}&type=${encodeURIComponent(email_action_type)}&redirect_to=${encodeURIComponent(redirectTarget)}`,
        anyDevice: false,
      };
    };

    const lang = pickLang(user.user_metadata?.lang, redirectTarget);
    const copy = COPY[lang];
    const greeting = copy.hello(displayName(user.user_metadata?.first_name));

    const emails: OutgoingEmail[] = [];
    const add = (to: string, mail: MailCopy, action: { link?: string; code?: string }, hello = greeting) => {
      emails.push({ to, subject: mail.subject, html: buildEmail({ lang, greeting: hello, ...mail, buttonUrl: action.link, code: action.code }) });
    };

    switch (email_action_type) {
      case "signup":
        add(user.email, copy.signup, { link: linkFor(token_hash).url });
        break;
      case "recovery": {
        const link = linkFor(token_hash);
        add(user.email, copy.recovery(link.anyDevice), { link: link.url });
        break;
      }
      case "email_change": {
        // Supabase kept these field names reversed for backward compatibility:
        //   token_hash     → the NEW address (user.new_email)
        //   token_hash_new → the CURRENT address (user.email); only sent with
        //                    "Secure email change" ON
        // ON: each address gets its own link, and the change happens once both
        // have been used. OFF: only the new address is asked to confirm.
        const newEmail = user.new_email || "";
        if (!newEmail || !token_hash) {
          console.error("email_change payload without new_email or token_hash; nothing sent", user.email);
          return new Response(
            JSON.stringify({ error: { http_code: 500, message: "email_change payload is missing the new address" } }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }
        const secure = Boolean(token_hash_new && user.email);
        add(newEmail, copy.emailChangeNew(newEmail, secure), { link: linkFor(token_hash).url });
        if (secure) {
          add(user.email, copy.emailChangeCurrent(user.email, newEmail), { link: linkFor(token_hash_new as string).url });
        }
        break;
      }
      case "magiclink":
        add(user.email, copy.magiclink, { link: linkFor(token_hash).url });
        break;
      case "invite":
        add(user.email, copy.invite, { link: linkFor(token_hash).url }, copy.hello(""));
        break;
      case "reauthentication":
        // supabase.auth.reauthenticate(): a one-time code to type in, no link.
        if (token) add(user.email, copy.reauthentication, { code: token });
        break;
      default:
        // Security notices (password_changed_notification, email_changed_notification,
        // mfa_factor_enrolled_notification…) only arrive if they are switched on
        // in the dashboard. They carry no token, and there is no template for them
        // yet: acknowledge without sending rather than mail an "Action Required"
        // with a dead link.
        if (email_action_type.endsWith("_notification")) break;
        if (token_hash) add(user.email, copy.actionLink, { link: linkFor(token_hash).url });
        else if (token) add(user.email, copy.actionCode, { code: token });
    }

    if (emails.length === 0) {
      console.log("No email sent for type:", email_action_type, "to:", user.email);
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const results = await Promise.all(emails.map(sendViaResend));

    const failed = results.find((r) => !r.ok);
    if (failed) {
      console.error("Resend API error:", failed.status, failed.body);
      return new Response(
        JSON.stringify({ error: { http_code: 500, message: `Resend API error: ${failed.status} - ${failed.body}` } }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const ids = results.map((r) => {
      try {
        return JSON.parse(r.body).id || r.body;
      } catch {
        return r.body;
      }
    });

    console.log(
      "Email sent successfully:", ids.join(", "),
      "to:", emails.map((e) => e.to).join(", "),
      "type:", email_action_type,
      "lang:", lang,
    );

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : "";
    console.error("UNHANDLED ERROR in send-email hook:", message, "\nStack:", stack);
    return new Response(
      JSON.stringify({ error: { http_code: 500, message } }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

async function sendViaResend(email: OutgoingEmail): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: SENDER_EMAIL,
      to: [email.to],
      subject: email.subject,
      html: email.html,
    }),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

// ---- Untrusted values ----

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

// The first name is the one part of these e-mails a stranger writes: with
// "Confirm email" ON, anyone can sign up with someone else's address and pick
// the name the greeting will carry, sent from our domain. So it is kept to what
// a name looks like — one line, at most 60 characters, letters and the
// punctuation names use. Anything else (a URL, an address, digits, markup) drops
// the name and the plain greeting is used. buildEmail escapes it on top of that.
function displayName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const oneLine = raw
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const name = Array.from(oneLine).slice(0, 60).join("").trim();
  if (!name) return "";
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(name)) return "";
  if (/\p{L}\.\p{L}{2,}/u.test(name)) return ""; // reads like a domain name
  return name;
}

// ---- Copy (EN / FR) ----
// Plain text only: buildEmail escapes every value, the addresses included.

type Lang = "en" | "fr";

// 1. The language chosen on the site at sign-up (AuthContext.signUp stores it
//    as user_metadata.lang), so a re-sent link reads like the first one.
// 2. Accounts that have none (every account made before that, and those made by
//    claim codes, SM26 or invitations): a lang=fr|en on the redirect URL, i.e.
//    the language of the page that asked for this e-mail ("fr", "fr-FR"…).
//    GoTrue only passes on a redirect URL it accepted, and the value is never
//    more than a choice between the two copies below.
// 3. English.
// Victor decided on 6 Oct 2026 that every platform e-mail is sent in English, auth
// e-mails included. The French copy below stays for a later change of mind: flip
// this to false to choose the language from user_metadata.lang / ?lang= again.
const ENGLISH_ONLY = true;

function pickLang(stored: unknown, redirectTarget: string): Lang {
  if (ENGLISH_ONLY) return "en";
  if (stored === "fr" || stored === "en") return stored;
  try {
    return /^fr(-|$)/i.test(new URL(redirectTarget).searchParams.get("lang") || "") ? "fr" : "en";
  } catch {
    return "en";
  }
}

interface MailCopy {
  subject: string;
  title: string;
  body: string;
  buttonText?: string;
  footer: string;
}

interface Copy {
  hello: (name: string) => string;
  tagline: string;
  signup: MailCopy;
  recovery: (anyDevice: boolean) => MailCopy;
  magiclink: MailCopy;
  invite: MailCopy;
  emailChangeNew: (newEmail: string, secure: boolean) => MailCopy;
  emailChangeCurrent: (currentEmail: string, newEmail: string) => MailCopy;
  reauthentication: MailCopy;
  actionLink: MailCopy;
  actionCode: MailCopy;
}

const COPY: Record<Lang, Copy> = {
  en: {
    hello: (name) => (name ? `Hello ${name},` : "Hello,"),
    tagline: "The B2B platform for the marina industry",
    signup: {
      subject: "Confirm your Smart Marina Connect account",
      title: "Welcome to Smart Marina Connect!",
      body: "Thank you for creating your account. Please confirm your email address by clicking the button below.",
      buttonText: "Confirm Email",
      footer: "If you did not create an account, you can safely ignore this email.",
    },
    recovery: (anyDevice) => ({
      subject: "Reset your Smart Marina Connect password",
      title: "Password Reset Request",
      body: "We received a request to reset your password. Click the button below to choose a new password.",
      buttonText: "Reset Password",
      footer: anyDevice
        ? "If you did not request a password reset, you can safely ignore this email. The link works on any device; if it has expired, simply request a new one."
        : "If you did not request a password reset, you can safely ignore this email. If the link has expired, simply request a new one.",
    }),
    magiclink: {
      subject: "Your Smart Marina Connect login link",
      title: "Login Link",
      body: "Click the button below to log in to your Smart Marina Connect account.",
      buttonText: "Log In",
      footer: "If you did not request this login link, you can safely ignore this email.",
    },
    invite: {
      subject: "You're invited to Smart Marina Connect",
      title: "You've Been Invited!",
      body: "You have been invited to join Smart Marina Connect, the B2B platform for the marina industry. Click the button below to accept your invitation and set up your account.",
      buttonText: "Accept Invitation",
      footer: "If you were not expecting this invitation, you can safely ignore this email.",
    },
    emailChangeNew: (newEmail, secure) => ({
      subject: "Confirm your new email address — Smart Marina Connect",
      title: "Email Change Confirmation",
      body:
        `You requested to change the email address of your Smart Marina Connect account to ${newEmail}. Please confirm this change by clicking the button below.` +
        (secure ? " A confirmation link has also been sent to your current address: the change takes effect once both links have been used." : ""),
      buttonText: "Confirm Email Change",
      footer: "If you did not request this change, you can safely ignore this email: the address will not be changed without this confirmation.",
    }),
    emailChangeCurrent: (currentEmail, newEmail) => ({
      subject: "Approve the change of your email address — Smart Marina Connect",
      title: "Email Change Confirmation",
      body: `A request was made to change the email address of your Smart Marina Connect account from ${currentEmail} to ${newEmail}. To approve it, click the button below. A confirmation link has also been sent to the new address: the change takes effect once both links have been used.`,
      buttonText: "Approve Email Change",
      footer: "If you did not request this change, do not click the button and contact support immediately.",
    }),
    reauthentication: {
      subject: "Your Smart Marina Connect verification code",
      title: "Verification Code",
      body: "Enter the code below to confirm it's you. It expires shortly and can only be used once.",
      footer: "If you did not request this code, we recommend changing your password.",
    },
    actionLink: {
      subject: "Smart Marina Connect — Action Required",
      title: "Action Required",
      body: "Please click the button below to complete your action.",
      buttonText: "Continue",
      footer: "If you did not initiate this action, you can safely ignore this email.",
    },
    actionCode: {
      subject: "Your Smart Marina Connect verification code",
      title: "Verification Code",
      body: "Enter the code below to complete your action. It expires shortly.",
      footer: "If you did not initiate this action, you can safely ignore this email.",
    },
  },
  fr: {
    hello: (name) => (name ? `Bonjour ${name},` : "Bonjour,"),
    tagline: "La plateforme B2B de l’industrie des marinas",
    signup: {
      subject: "Confirmez votre compte Smart Marina Connect",
      title: "Bienvenue sur Smart Marina Connect !",
      body: "Merci d’avoir créé votre compte. Veuillez confirmer votre adresse e-mail en cliquant sur le bouton ci-dessous.",
      buttonText: "Confirmer mon adresse e-mail",
      footer: "Si vous n’avez pas créé de compte, vous pouvez ignorer cet e-mail.",
    },
    recovery: (anyDevice) => ({
      subject: "Réinitialisez votre mot de passe Smart Marina Connect",
      title: "Réinitialisation du mot de passe",
      body: "Nous avons reçu une demande de réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour en choisir un nouveau.",
      buttonText: "Réinitialiser mon mot de passe",
      footer: anyDevice
        ? "Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail. Le lien fonctionne sur n’importe quel appareil ; s’il a expiré, demandez-en simplement un nouveau."
        : "Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail. Si le lien a expiré, demandez-en simplement un nouveau.",
    }),
    magiclink: {
      subject: "Votre lien de connexion Smart Marina Connect",
      title: "Lien de connexion",
      body: "Cliquez sur le bouton ci-dessous pour vous connecter à votre compte Smart Marina Connect.",
      buttonText: "Me connecter",
      footer: "Si vous n’avez pas demandé ce lien de connexion, vous pouvez ignorer cet e-mail.",
    },
    invite: {
      subject: "Votre invitation à rejoindre Smart Marina Connect",
      title: "Vous avez reçu une invitation !",
      body: "Une invitation vous a été adressée pour rejoindre Smart Marina Connect, la plateforme B2B de l’industrie des marinas. Cliquez sur le bouton ci-dessous pour l’accepter et créer votre compte.",
      buttonText: "Accepter l’invitation",
      footer: "Si vous n’attendiez pas cette invitation, vous pouvez ignorer cet e-mail.",
    },
    emailChangeNew: (newEmail, secure) => ({
      subject: "Confirmez votre nouvelle adresse e-mail — Smart Marina Connect",
      title: "Confirmation du changement d’adresse e-mail",
      body:
        `Vous avez demandé à remplacer l’adresse e-mail de votre compte Smart Marina Connect par ${newEmail}. Veuillez confirmer ce changement en cliquant sur le bouton ci-dessous.` +
        (secure ? " Un lien de confirmation a également été envoyé à votre adresse actuelle : le changement prend effet une fois les deux liens utilisés." : ""),
      buttonText: "Confirmer le changement",
      footer: "Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail : l’adresse ne sera pas modifiée sans cette confirmation.",
    }),
    emailChangeCurrent: (currentEmail, newEmail) => ({
      subject: "Approuvez le changement de votre adresse e-mail — Smart Marina Connect",
      title: "Confirmation du changement d’adresse e-mail",
      body: `Une demande a été faite pour remplacer l’adresse e-mail de votre compte Smart Marina Connect, ${currentEmail}, par ${newEmail}. Pour l’approuver, cliquez sur le bouton ci-dessous. Un lien de confirmation a également été envoyé à la nouvelle adresse : le changement prend effet une fois les deux liens utilisés.`,
      buttonText: "Approuver le changement",
      footer: "Si vous n’êtes pas à l’origine de cette demande, ne cliquez pas sur le bouton et contactez immédiatement le support.",
    }),
    reauthentication: {
      subject: "Votre code de vérification Smart Marina Connect",
      title: "Code de vérification",
      body: "Saisissez le code ci-dessous pour confirmer votre identité. Il expire rapidement et ne peut être utilisé qu’une seule fois.",
      footer: "Si vous n’avez pas demandé ce code, nous vous recommandons de changer votre mot de passe.",
    },
    actionLink: {
      subject: "Smart Marina Connect — Action requise",
      title: "Action requise",
      body: "Cliquez sur le bouton ci-dessous pour finaliser votre démarche.",
      buttonText: "Continuer",
      footer: "Si vous n’êtes pas à l’origine de cette démarche, vous pouvez ignorer cet e-mail.",
    },
    actionCode: {
      subject: "Votre code de vérification Smart Marina Connect",
      title: "Code de vérification",
      body: "Saisissez le code ci-dessous pour finaliser votre démarche. Il expire rapidement.",
      footer: "Si vous n’êtes pas à l’origine de cette démarche, vous pouvez ignorer cet e-mail.",
    },
  },
};

// ---- Email template builder ----

interface EmailTemplateProps {
  lang: Lang;
  greeting: string;
  title: string;
  body: string;
  buttonText?: string;
  buttonUrl?: string;
  code?: string;
  footer: string;
}

// Every interpolated value is escaped here, so nothing a caller passes —
// copy, names, addresses, links, codes — can turn into markup.
function buildEmail({ lang, greeting, title, body, buttonText, buttonUrl, code, footer }: EmailTemplateProps): string {
  const tagline = escapeHtml(COPY[lang].tagline);
  const button = buttonText && buttonUrl
    ? `
              <!-- Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
                <tr>
                  <td style="background-color: #0c4a6e; border-radius: 8px;">
                    <a href="${escapeHtml(buttonUrl)}" target="_blank" style="display: inline-block; padding: 14px 32px; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; letter-spacing: 0.3px;">${escapeHtml(buttonText)}</a>
                  </td>
                </tr>
              </table>`
    : "";
  const codeBlock = code
    ? `
              <!-- Code -->
              <p style="margin: 0; text-align: center;"><span style="display: inline-block; padding: 14px 28px; background-color: #f3f4f6; border-radius: 8px; color: #111827; font-size: 28px; font-weight: 700; letter-spacing: 6px; font-family: 'SFMono-Regular', Menlo, Consolas, monospace;">${escapeHtml(code)}</span></p>`
    : "";
  return `
<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f5f7; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
          <!-- Header -->
          <tr>
            <td style="background-color: #0c4a6e; padding: 32px 40px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">Smart Marina Connect</h1>
              <p style="margin: 6px 0 0; color: #93c5fd; font-size: 13px; font-weight: 400;">${tagline}</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 8px; color: #374151; font-size: 16px; line-height: 1.5;">${escapeHtml(greeting)}</p>
              <h2 style="margin: 0 0 16px; color: #111827; font-size: 20px; font-weight: 600;">${escapeHtml(title)}</h2>
              <p style="margin: 0 0 32px; color: #4b5563; font-size: 15px; line-height: 1.6;">${escapeHtml(body)}</p>${button}${codeBlock}
              <p style="margin: 32px 0 0; color: #9ca3af; font-size: 13px; line-height: 1.5;">${escapeHtml(footer)}</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">&copy; ${new Date().getFullYear()} Smart Marina Connect</p>
              <p style="margin: 4px 0 0; color: #9ca3af; font-size: 12px;">${tagline}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

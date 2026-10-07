// The configured instance (not the bare 'i18next' default): these strings are
// registered while the page chunk loads, and a bare instance has no
// addResourceBundle until init() has run.
import i18n from '@/i18n';

/**
 * Strings of the World Yachting Summit pages (refonte, Oct 2026): the public
 * "request an invitation" page (/wys26, GuestEventPage) and the guest's personal
 * invitation page (/wys26/guest?t=…, GuestInvitationPage). English only: the
 * interface is English-only.
 *
 * What the event itself says (title, tagline, date, venue, themes, programme
 * note, parts) is data from the gl_event settings and never lives here. Server
 * error messages stay in the pages, next to the calls that raise them.
 *
 * Registered by the pages themselves through `registerWysRefonteStrings()` (deep
 * merge, no overwrite), the way src/i18n/refonte-auth.ts is: no shared setup file
 * has to change.
 *
 * Vocabulary: "members" for registered organisations, "partners" only for paying
 * event sponsors. Nothing here claims a figure or a name the page does not know.
 */
export const WYS_REFONTE_STRINGS = {
  en: {
    wysPage: {
      loading: 'Loading the event',
      notFound: 'This event could not be found.',
      allEvents: 'See all events',
      hero: {
        eyebrow: 'By invitation · Organised by M3 Monaco',
        cta: 'Request an invitation',
        trustLabel: 'How it works',
        trust: {
          review: 'Every request is reviewed by the M3 team',
          noAccount: 'No account needed',
          answer: 'Our answer comes to you by e-mail',
        },
      },
      card: {
        venue: 'Venue',
        invitationOnly: 'By invitation only',
        organiser: 'Organised by M3 Monaco',
      },
      about: {
        eyebrow: 'The event',
        title: 'About the event',
        website: 'Official website',
      },
      format: {
        eyebrow: 'Format',
        title: 'On the day',
      },
      themes: {
        eyebrow: 'Conference',
        title: 'Conference themes',
      },
      form: {
        eyebrow: 'Invitation request',
        title: 'Request an invitation',
        intro: 'Attendance is by invitation only. Tell us who you are and we will come back to you.',
        required: 'Fields marked * are required.',
        firstName: 'First name',
        lastName: 'Last name',
        email: 'E-mail',
        phone: 'Phone',
        company: 'Company',
        jobTitle: 'Job title',
        country: 'Country',
        attend: 'I would like to attend',
        conference: 'Conference',
        gala: 'Gala dinner',
        motivation: 'Why would you like to attend?',
        send: 'Send my request',
        sending: 'Sending…',
        privacy: 'Your details are used only to process your request for this event.',
      },
      done: {
        title: 'Thank you',
        text: 'Your request has been received. Our team reviews every request and will come back to you by e-mail.',
      },
      closed: {
        title: 'Invitation requests are not open yet',
        enquiry: 'For any enquiry:',
      },
      contact: {
        title: 'A question about the event?',
        line: 'Programme, venue or your invitation: write to the M3 team.',
      },
    },
    wysGuest: {
      loading: 'Loading your invitation',
      eyebrow: 'Your invitation',
      dear: 'Dear {{name}},',
      status: {
        invited: 'Awaiting your answer',
        requested: 'Under review',
        confirmed: 'Confirmed',
        declined: 'Declined',
        closed: 'No longer active',
      },
      details: {
        label: 'Your invitation',
        guest: 'Guest',
        admission: 'Admission',
        host: 'Guest of',
      },
      invited: {
        text: 'You are invited to <b>{{event}}</b> for the <b>{{part}}</b>. Will you join us?',
        confirmBelow: 'Please confirm your answer below.',
        accept: 'I accept',
        decline: 'I cannot attend',
      },
      requested: {
        yours: 'Your request',
        plusOne: 'Your plus-one request',
        review: '{{what}} is being reviewed. We will come back to you by e-mail.',
      },
      confirmed: {
        text: 'Your place is confirmed for the <b>{{part}}</b>',
        asGuestOf: ' as the guest of {{host}}',
        passLabel: 'Entry pass',
        qrAlt: 'Your entry QR code',
        qrHelp: 'Show this QR code at the entrance. No QR? Just give your name at the desk.',
        cancel: 'I can no longer attend',
      },
      declined: {
        text: 'You have let us know you cannot attend. Thank you for your answer.',
        changed: 'Changed your mind? Accept the invitation',
      },
      closed: {
        text: 'This invitation is no longer active. For any question, contact',
        us: 'us',
      },
      plusOne: {
        title: 'Plus-one',
        confirmed: 'confirmed; they have received their own entry pass by e-mail.',
        pending: 'request under review.',
        ask: 'Would you like to bring someone? Tell us who — each plus-one is reviewed by our team and receives their own entry pass.',
        open: 'Request a plus-one',
        firstName: 'First name',
        lastName: 'Last name',
        email: 'Their e-mail',
        company: 'Company',
        jobTitle: 'Job title',
        send: 'Send request',
        cancel: 'Cancel',
      },
      invalid: {
        title: 'This invitation link cannot be opened',
      },
      contact: {
        line: 'A question about your invitation? Write to the M3 team.',
      },
    },
  },
};

let registered = false;

/** Adds the strings above to the running i18next instance, once. */
export function registerWysRefonteStrings(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle('en', 'translation', WYS_REFONTE_STRINGS.en, true, false);
}

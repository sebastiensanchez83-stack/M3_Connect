import type { TFunction } from 'i18next';
import type { LucideIcon } from 'lucide-react';
import {
  Anchor, Briefcase, Building2, CalendarDays, FileText, HardHat, KeyRound, Lock, Mail,
  MessageSquare, Newspaper, ShieldCheck, TrendingUp, UserRound,
} from 'lucide-react';
import { memberHomeHref } from '@/lib/accountNav';

/**
 * The words of the help centre (/help), Oct 2026: one section per profile
 * (marina, service provider, investor, developer, media, no company yet), then
 * one per topic. Every answer says what the platform does TODAY, read from the
 * code; the claims Victor still has to confirm are listed in the rf-help
 * report. Messages and connections describe the company messaging of 9 Oct
 * 2026 (rf-msg: a short first message to any company, connected at once when
 * the sectors match, both teams in the thread, a Friday summary).
 *
 * Every question has a stable id: it is the #anchor of /help (/help#verification-time)
 * that HelpTip's "Learn more" and any e-mail can point at. Never rename an id
 * once it has been sent to someone; add a new one instead.
 *
 * Strings go through t('help.q.<id>.q' | .a1… | .s1… | .l1…, 'English'): the
 * English is the fallback, as in the rest of the refonte.
 */

export interface HelpLink {
  label: string;
  /** A page of the site ("/events"), a dashboard tile (memberHomeHref) or another answer ("#publishing-kinds"). */
  to: string;
  /** Only shown to signed-in members (dashboard links mean nothing to a visitor). */
  members?: boolean;
}

export interface HelpItem {
  id: string;
  q: string;
  /** Short paragraphs. */
  a: string[];
  /** A numbered how-to, shown under the paragraphs. */
  steps?: string[];
  links?: HelpLink[];
}

export interface HelpSection {
  id: string;
  group: 'profile' | 'topic';
  title: string;
  /** One line under the title. */
  intro: string;
  icon: LucideIcon;
  items: HelpItem[];
}

/** /help#<id>: where a HelpTip's "Learn more" goes. */
export function helpHref(id: string): string {
  return `/help#${id}`;
}

/** Which profile section is the reader's own (persona → section id). */
export const PERSONA_SECTION: Record<string, string> = {
  marina: 'marina',
  partner: 'service-provider',
  investor: 'investor',
  developer: 'developer',
  media_partner: 'media',
  individual: 'no-company',
};

type Extra = { steps?: string[]; links?: HelpLink[] };

export function buildHelpSections(t: TFunction): HelpSection[] {
  const item = (id: string, q: string, a: string[], extra: Extra = {}): HelpItem => ({
    id,
    q: t(`help.q.${id}.q`, q),
    a: a.map((p, i) => t(`help.q.${id}.a${i + 1}`, p)),
    steps: extra.steps?.map((s, i) => t(`help.q.${id}.s${i + 1}`, s)),
    links: extra.links?.map((l, i) => ({ ...l, label: t(`help.q.${id}.l${i + 1}`, l.label) })),
  });
  const section = (id: string, group: HelpSection['group'], icon: LucideIcon, title: string, intro: string, items: HelpItem[]): HelpSection => ({
    id,
    group,
    icon,
    title: t(`help.s.${id}.title`, title),
    intro: t(`help.s.${id}.intro`, intro),
    items,
  });

  return [
    /* ─────────────────────────── profiles ─────────────────────────── */
    section('marina', 'profile', Anchor, 'Marinas', 'For marinas and ports.', [
      item('marina-can', 'What can my marina do here?', [
        'Publish your needs: a tender, an expert question or a project. Service providers who can help then get in touch with you.',
        'Find service providers by theme and country in the directory, send a message to any company and propose a webinar. You can also read the needs other marinas publish, without answering them.',
      ]),
      item('marina-listed', 'Our marina is already in the directory. How do we take it over?', [
        'Many marinas are listed already. Open your marina’s page and press “Claim this page”, or press “Claim my marina” in the directory. The M3 team checks the request and links the page to your account.',
        'If M3 gave you a code for your marina, enter it when you describe your company after signing up.',
      ], { links: [{ label: 'Open the directory', to: '/directory' }] }),
      item('marina-publish', 'How do we publish a need?', [
        'Open My requests on your dashboard and press “Publish a new need”, or use Create at the top of the page. Choose a tender, an expert question or a project.',
        'The M3 team reads it first, usually within one business day. Then verified members can see it and service providers can answer.',
      ], { links: [{ label: 'Which kind of need to choose', to: '#publishing-kinds' }] }),
      item('marina-details', 'Who sees our marina’s details?', [
        'Everyone can see your marina’s page: name, place, logo and description.',
        'The detailed profile (berths, facilities, certifications) and your team are shown to verified members only.',
      ]),
    ]),

    section('service-provider', 'profile', Briefcase, 'Service providers', 'For companies that sell products or services to marinas.', [
      item('provider-can', 'What can a service provider do here?', [
        'Read the needs marinas publish and answer them, present your company in the directory, send a message to any company and propose a webinar.',
        'You can also ask marinas you worked with for a reference, and sponsor one of our events for more visibility.',
      ]),
      item('provider-answer', 'How do I answer a tender or an expert question?', [
        'The marina’s team sees your interest in their Messages and decides. Their answer shows in your Messages. Opportunities open once M3 has checked your company.',
      ], {
        steps: [
          'Open Opportunities.',
          'Choose a need and press “Express interest”.',
          'Add a short message if you like, then send it.',
        ],
        links: [{ label: 'See the opportunities', to: '/opportunities' }],
      }),
      item('provider-references', 'What are references?', [
        'A reference is a marina you worked with that vouches for you. In the References tile of your dashboard, describe the project and the marina contact: we e-mail them, and they confirm or decline.',
        'Confirmed references appear on your company page.',
      ], { links: [{ label: 'Open References', to: memberHomeHref('references'), members: true }] }),
      item('provider-places', 'How many colleagues can join our company?', [
        'Service provider and investor companies have a set number of places on the platform, often one. My team on your dashboard shows how many are used.',
        'When they are all taken, write to the M3 team to add a colleague.',
      ]),
      item('provider-visibility', 'How can we get more visibility?', [
        'Keep your company page complete: logo, cover photo, description, sectors and photos. Members find you by theme and by country.',
        'Companies that sponsor one of our events also get a sponsor badge. Event sponsorship is the only paid offer: ask the M3 team.',
      ], { links: [{ label: 'Sponsor an event', to: '/sponsor' }] }),
    ]),

    section('investor', 'profile', TrendingUp, 'Investors', 'For funds, family offices and strategic investors.', [
      item('investor-can', 'What can an investor do here?', [
        'Follow the projects and tenders marinas publish, see the companies that are raising capital in Deal flow, publish your investment thesis, send a message to any company and propose a webinar.',
      ]),
      item('investor-deal-flow', 'What is Deal flow?', [
        'Deal flow lists the marinas, developers and service providers that say they are raising capital, with the amount, the stage and the use of funds when they gave them. “Match my focus” keeps the ones in your sectors.',
        'It is open to verified investors, from the menu at the top of the page.',
      ], { links: [{ label: 'Open Deal flow', to: '/investments', members: true }] }),
      item('investor-thesis', 'How do we publish our investment thesis?', [], {
        steps: [
          'Open My company on your dashboard.',
          'Press “More settings” at the bottom.',
          'Fill in the investment thesis part, then save.',
        ],
        links: [{ label: 'Open My company', to: memberHomeHref('company'), members: true }],
      }),
    ]),

    section('developer', 'profile', HardHat, 'Developers', 'For marina developers, real-estate groups and builders.', [
      item('developer-can', 'What can a developer do here?', [
        'Publish the needs of your marina projects (tenders, expert questions and projects), find service providers, read the needs other members publish, send a message to any company and propose a webinar.',
      ]),
      item('developer-or-marina', 'Developer or marina: which profile should I choose?', [
        'Choose Developer if you design, build or own marina projects. Choose Marina if you run or represent a marina or a port.',
        'Not sure, or chose the wrong one? Write to the M3 team and we will set it right.',
      ]),
    ]),

    section('media', 'profile', Newspaper, 'Media', 'For journalists and publications covering marinas and yachting.', [
      item('media-can', 'What can a media outlet do here?', [
        'Follow the sector’s articles, opportunities and replays, send a message to any company and propose a webinar.',
        'For our events, you can ask the M3 team for a press accreditation.',
      ]),
      item('media-accreditation', 'How do I get a press accreditation?', [
        'Write to events@m3monaco.com with the name of your outlet and the event you want to cover. The M3 team answers by e-mail.',
      ]),
      item('media-press-room', 'Where are the press kits?', [
        'Once M3 has accredited your outlet for an event, a Press room tile appears on your dashboard. It holds the media kits and press releases, and you can add links to the articles you publish.',
      ]),
    ]),

    section('no-company', 'profile', UserRound, 'No company yet', 'For participants who are not linked to a company on the platform.', [
      item('no-company-can', 'I have no company on the platform. What can I do?', [
        'You can register for events and webinars, read the resources and browse the directory.',
        'Publishing a need, the opportunities and messages need a company checked by M3.',
      ]),
      item('no-company-add', 'How do I add my company?', [
        'Press “Add my company” on your dashboard and describe it. The M3 team then checks it.',
        'If your company is already on the platform, ask a colleague who has an account to invite you from My team. If nobody manages its page yet, press “Claim this page” on it.',
      ], { links: [{ label: 'Open my dashboard', to: '/#dashboard', members: true }] }),
    ]),

    /* ─────────────────────────── topics ─────────────────────────── */
    section('account', 'topic', KeyRound, 'Account and sign-in', 'Creating your account, your password and your dashboard.', [
      item('account-sign-up', 'How do I create an account?', [
        'Membership is free.',
      ], {
        steps: [
          'Press Sign up at the top of any page.',
          'Choose the profile that fits your organisation.',
          'Give your name, your work e-mail, your company and a password.',
          'Describe your company. The M3 team then checks it.',
        ],
      }),
      item('account-password', 'I forgot my password.', [
        'Press Log in, then “Forgot password?”. Type your e-mail and we send you a link to choose a new password. You can also ask for a sign-in link: it logs you in without a password.',
        'The e-mail can take a minute. Look in your spam folder too.',
      ]),
      item('account-password-rules', 'What makes a valid password?', [
        'At least 8 characters, with one capital letter and one symbol, for example ! or ?. To change it later, open My profile and press “Change password”.',
      ]),
      item('account-dashboard', 'What is on my dashboard?', [
        'Your dashboard is the home page once you are signed in. At the top, To do lists what waits for you: first the answers people expect, then what is missing on your company page and your profile. Click a line to do it in a small window.',
        'Below, the tiles hold everything you manage: My profile, My company, My team, My events, Messages and My requests.',
      ], { links: [{ label: 'Open my dashboard', to: '/#dashboard', members: true }] }),
      item('account-details', 'How do I change my name, photo or job title?', [
        'Open My profile on your dashboard. Each line has a Change button: change one thing, then press Save.',
      ], { links: [{ label: 'Open My profile', to: memberHomeHref('profile'), members: true }] }),
      item('account-email', 'Can I change my e-mail address?', [
        'You sign in with it, so only the M3 team can change it. Write to us from the address you use today.',
      ]),
      item('account-several-companies', 'I work for more than one company.', [
        'You can belong to several companies. Open the menu under your name and choose the company under “Switch company”.',
      ]),
      item('account-close', 'How do I close my account?', [
        'Write to events@m3monaco.com from the address of your account. The M3 team closes it and tells you what happens to your data.',
      ]),
    ]),

    section('verification', 'topic', ShieldCheck, 'Getting verified by M3', 'Why M3 checks every account, what it checks and how long it takes.', [
      item('verification-why', 'Why does M3 check every account?', [
        'So that every member is a real professional from a real company. You know who you talk to, and needs and messages stay serious.',
      ]),
      item('verification-time', 'How long does the check take?', [
        'Usually 24 to 48 business hours after you describe your company. You get an e-mail as soon as your account is approved.',
      ]),
      item('verification-what', 'What does M3 check?', [
        'That your company exists and works in the marina or maritime world, from its website and the details you gave, and that you work there. If something is missing, we write to you.',
      ]),
      item('verification-meanwhile', 'What can I do while I wait?', [
        'Complete your profile, read the public resources, browse the directory and register for webinars. Opportunities, messages and publishing open once you are approved.',
      ]),
      item('verification-invited', 'A colleague invited me. Do I wait too?', [
        'No. If M3 has already checked your company, you are in as soon as you accept the invitation.',
      ]),
      item('verification-company', 'My account is approved, but my company is still being checked.', [
        'M3 checks the company and the people. Until your company is approved, publishing, the opportunities and messages stay closed. There is nothing more to do: we e-mail you when it is done.',
      ]),
      item('verification-rejected', 'My account was not approved.', [
        'Your dashboard shows the reason. Press “Edit and resubmit” to correct your details, or write to the M3 team if you think it is a mistake.',
      ]),
    ]),

    section('company', 'topic', Building2, 'Your company page and team', 'Changing your company page, inviting colleagues and who decides.', [
      item('company-edit', 'How do I change our company page?', [
        'Open My company on your dashboard. Each line (logo, cover photo, description, website, place, sectors, photos) has a Change button. Anyone in the company can change the page; only the owner adds documents.',
        'What is not listed there, such as the marina facilities, is under “More settings”.',
      ], { links: [{ label: 'Open My company', to: memberHomeHref('company'), members: true }] }),
      item('company-sectors', 'Why do sectors matter?', [
        'Sectors say what your company offers (service providers) or looks for (marinas, developers, investors). They decide which needs and articles we suggest to you.',
        'When a first message goes between a company that looks for a sector and one that offers it, the two are connected at once.',
      ]),
      item('company-invite', 'How do I add a colleague?', [
        'Only the company owner can invite or remove people. If your company has no free place left, write to the M3 team.',
      ], {
        steps: [
          'Open My team on your dashboard.',
          'Press “Invite a colleague” and type their e-mail address.',
          'We e-mail them a link to join your company.',
        ],
        links: [{ label: 'Open My team', to: memberHomeHref('team'), members: true }],
      }),
      item('company-join-requests', 'Someone asks to join our company.', [
        'The owner sees the request in To do and in My team, and accepts or declines it.',
      ]),
      item('company-owner', 'Who is the owner? Can it change?', [
        'The owner is usually the person who registered the company. They can hand it over to a colleague: open My team, then “More settings”.',
      ]),
      item('company-leave', 'How do I leave a company?', [
        'Open My team and press “Leave the company”. The owner cannot leave: they hand the company over to a colleague first.',
      ]),
    ]),

    section('messages', 'topic', MessageSquare, 'Messages and connections', 'Writing to a company, getting connected and the e-mails you get.', [
      item('messages-who', 'Who can I write to?', [
        'Any company on the platform. Open its page and press “Send a message”: a short first message, up to 500 characters. You need a company checked by M3 to write.',
      ]),
      item('messages-connected', 'When are we connected?', [
        'When your activities match, for example a marina looking for a sector that a service provider offers, you are connected at once and can talk.',
        'Otherwise the other company decides. Anyone in their team can accept or decline; the first answer counts.',
      ]),
      item('messages-team', 'Who sees the conversation?', [
        'Both teams. Everyone in the two companies can read and reply, and each message shows who wrote it, their company and the time.',
      ]),
      item('messages-where', 'Where do I find my messages?', [
        'In the Messages tile of your dashboard. A number in the menu at the top tells you when something waits for you.',
      ], { links: [{ label: 'Open Messages', to: memberHomeHref('inbox'), members: true }] }),
      item('messages-emails', 'Do I get an e-mail for each message?', [
        'No. If something waits for you, you get one summary on Friday. When a company accepts your request, M3 also introduces you by e-mail.',
        'You can turn these e-mails off: “Connection requests” in the e-mails you receive.',
      ], { links: [{ label: 'Choose your e-mails', to: '#emails-choose' }] }),
      item('messages-report', 'Someone sends us unwanted messages.', [
        'Open the conversation and press “Report to M3”. The team looks into it.',
      ]),
    ]),

    section('publishing', 'topic', FileText, 'Publishing a need', 'Tenders, expert questions and projects: who publishes, who sees, who answers.', [
      item('publishing-who', 'Who can publish a need?', [
        'Marinas and developers whose company M3 has checked.',
      ]),
      item('publishing-kinds', 'Tender, expert question or project: which one?', [
        'A tender (RFP): you describe a need, set a deadline and invite service providers to send a proposal.',
        'An expert question (consultation): you ask one precise question and look for advice.',
        'A project: a marina project in energy, digital, infrastructure or services, looking for the right service providers.',
      ]),
      item('publishing-review', 'When does it go live?', [
        'The M3 team reads each request first, usually within one business day, then publishes it and e-mails you.',
      ]),
      item('publishing-visible', 'Who sees what I publish?', [
        'Members whose company M3 has checked. Service providers can answer it; other members can read it. Visitors do not see it.',
      ]),
      item('publishing-answers', 'How do I see the answers?', [
        'When a service provider presses “Express interest” on a tender or an expert question, it arrives in your Messages. Anyone in your team can accept or decline.',
        'For a project, service providers can write to you in Messages too, and the M3 team may put you in touch with the right ones.',
      ]),
      item('publishing-change', 'Can I change or close it?', [
        'Yes. In My requests on your dashboard you can edit it, close it once you have found what you need, open it again or delete it.',
      ], { links: [{ label: 'Open My requests', to: memberHomeHref('requests'), members: true }] }),
    ]),

    section('events', 'topic', CalendarDays, 'Events and webinars', 'Registering, joining, replays and invitations.', [
      item('events-webinar', 'How do I register for a webinar?', [
        'Open the webinar in Events and press Register. Signed in, one click is enough. Without an account, give your name and e-mail (your company is optional).',
        'You get a confirmation e-mail with a calendar invitation, and a reminder the day before.',
      ], { links: [{ label: 'See the events', to: '/events' }] }),
      item('events-join', 'How do I join a webinar on the day?', [
        'Open the link in your confirmation or reminder e-mail. It takes you to the webinar’s page, where you find how to join.',
      ]),
      item('events-replay', 'I missed a webinar.', [
        'Replays are added to the Resources when they are ready. You also find them in My events.',
      ], { links: [{ label: 'Open the resources', to: '/resources' }] }),
      item('events-cancel', 'How do I cancel my registration?', [
        'Open the event and press “Cancel my registration”. Registered without an account? Write to the M3 team.',
      ]),
      item('events-invitation', 'Some events say “by invitation”.', [
        'Send a request from the event’s page. The M3 team reviews it and answers by e-mail.',
      ]),
      item('events-paid', 'Are events free?', [
        'Webinars are free. Some events on site have a fee: the event’s page says so, and tells you when payment is due.',
      ]),
      item('events-propose', 'Can we give a webinar?', [
        'Yes. Members whose account is verified can propose one: press Create at the top of the page, then “Propose a webinar”. The M3 team looks at it with you.',
      ]),
    ]),

    section('emails', 'topic', Mail, 'E-mails and unsubscribing', 'Choosing the e-mails you get, and stopping them.', [
      item('emails-choose', 'How do I choose the e-mails I get?', [], {
        steps: [
          'Open My profile on your dashboard.',
          'On the line “E-mails you receive”, press Change.',
          'Turn off what you do not need, then press Save.',
        ],
        links: [{ label: 'Open My profile', to: memberHomeHref('profile'), members: true }],
      }),
      item('emails-kinds', 'What kinds of e-mail are there?', [
        'Connection requests and messages (with the Friday summary), your requests and proposals, references, events, payments and invoices, your team, your account, and news from M3.',
        'Keep “Your account” on: it tells you when you are approved.',
      ]),
      item('emails-unsubscribe', 'How do I unsubscribe from an e-mail?', [
        'Every e-mail from the platform has an Unsubscribe link at the bottom. It opens a page where you confirm, with no need to sign in. You can turn that kind of e-mail back on at any time.',
      ]),
      item('emails-always', 'Which e-mails always arrive?', [
        'The ones you ask for yourself, such as a password link or a sign-in link.',
      ]),
      item('emails-newsletter', 'How do I stop the newsletter?', [
        'The newsletter is separate. Use the unsubscribe link at the bottom of any newsletter.',
      ]),
      item('emails-missing', 'I do not receive your e-mails.', [
        'Look in your spam folder, and add noreply@smartmarinaconnect.com to your contacts. Still nothing? Write to events@m3monaco.com.',
      ]),
    ]),

    section('privacy', 'topic', Lock, 'Privacy', 'Who sees what, and your rights over your data.', [
      item('privacy-visible', 'Who can see my details?', [
        'Company pages in the directory are public. People (photo, name and job title) appear on their company’s page for verified members only. Your e-mail address is not shown to other members.',
      ]),
      item('privacy-use', 'What does M3 do with my data?', [
        'We use it to run the platform, check accounts and send you the e-mails you choose. Other members only see what the platform shows them.',
        'The privacy policy says everything, including the services we work with.',
      ], { links: [{ label: 'Read the privacy policy', to: '/privacy' }] }),
      item('privacy-rights', 'How do I see, correct or delete my data?', [
        'You can change most of it yourself on your dashboard. For anything else, including deleting your account, write to events@m3monaco.com.',
      ]),
      item('privacy-cookies', 'What about cookies?', [
        'You choose in the cookie banner the first time you visit. The cookie policy explains what each cookie is for.',
      ], { links: [{ label: 'Read the cookie policy', to: '/cookies' }] }),
    ]),
  ];
}

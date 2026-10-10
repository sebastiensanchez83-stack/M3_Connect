import type { TFunction } from 'i18next';
import type { LucideIcon } from 'lucide-react';
import {
  Anchor, Building2, CalendarDays, Compass, FileText, HardHat, KeyRound, LifeBuoy, Lock, Mail,
  MessageSquare, Radio, ShieldCheck, UserRound,
} from 'lucide-react';
import { memberHomeHref } from '@/lib/accountNav';

/**
 * The words of the help centre (/help), Oct 2026: one section per profile
 * (marina, service provider, investor, developer, media, no company yet), then
 * one per topic. Every answer says what the platform does TODAY, read from the
 * code and the database rules; the claims Victor still has to confirm are
 * listed in the rf-help report.
 *
 * Messages and connections describe the company messaging of 9 Oct 2026
 * (rf-msg: a short first message to any company, connected at once when the
 * sectors match, both teams in the thread, a Friday summary): /help must not
 * go live before it.
 *
 * Who reads what (database rules, Oct 2026):
 * - tenders and expert questions: verified marinas, developers, service
 *   providers and media; not investors, not visitors;
 * - a project: only its author and the M3 team (the team brokers it);
 * - registering for an event: an account M3 has approved;
 * - a first message to a company, publishing: a company M3 has checked as well;
 * - proposing a webinar: verified marinas, service providers and media only
 *   (webinar_requests_insert_owner_eligible; the Create menu still offers it to
 *   investors and developers, who then get an error: reported to Victor).
 *
 * The profile icons are the home page's (ProfileCards): marina Anchor, service
 * provider LifeBuoy, investor Compass, media Radio.
 *
 * Every question has a stable id: it is the #anchor of /help (/help#verification-time)
 * that HelpTip's "Learn more" and any e-mail can point at. Never rename an id
 * once it has been sent to someone; add a new one instead.
 *
 * Strings go through t('help.q.<id>.q' | .a1… | .s1… | .l1…, 'English'): the
 * English is the fallback, as in the rest of the refonte. `keywords` are extra
 * search words (not shown, not translated).
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
  /** Words people type that the answer does not use ("login", "pending"): search only. */
  keywords?: string[];
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

/**
 * Which profile section is the reader's own (persona → section id). People
 * with no company get 'no-company' (HelpPage); a persona 'individual' who
 * belongs to a company gets no mark.
 */
export const PERSONA_SECTION: Record<string, string> = {
  marina: 'marina',
  partner: 'service-provider',
  investor: 'investor',
  developer: 'developer',
  media_partner: 'media',
};

type Extra = { steps?: string[]; links?: HelpLink[]; keywords?: string[] };

export function buildHelpSections(t: TFunction): HelpSection[] {
  const item = (id: string, q: string, a: string[], extra: Extra = {}): HelpItem => ({
    id,
    q: t(`help.q.${id}.q`, q),
    a: a.map((p, i) => t(`help.q.${id}.a${i + 1}`, p)),
    steps: extra.steps?.map((s, i) => t(`help.q.${id}.s${i + 1}`, s)),
    links: extra.links?.map((l, i) => ({ ...l, label: t(`help.q.${id}.l${i + 1}`, l.label) })),
    keywords: extra.keywords,
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
        'Publish your needs: a tender, an expert question or a project. Service providers answer tenders and expert questions. For a project, the M3 team puts you in touch with the right service providers.',
        'Find service providers by theme and country in the directory, send a message to any company and propose a webinar. You can also read the tenders and expert questions other marinas publish, without answering them.',
      ], { keywords: ['port', 'harbour', 'harbor'] }),
      item('marina-listed', 'Our marina is already in the directory. How do we take it over?', [
        'Many marinas are listed already. Open your marina’s page and press “Claim this page”, or press “Claim my marina” in the directory. The M3 team checks the request and links the page to your account.',
        'If M3 sent you an e-mail with your marina’s code, sign up with the button in that e-mail: the code is filled in for you and your account is linked to your marina’s page.',
      ], { links: [{ label: 'Open the directory', to: '/directory' }], keywords: ['claim', 'code', 'organization code', 'connect link', 'duplicate'] }),
      item('marina-publish', 'How do we publish a need?', [
        'Open My requests on your dashboard and press “Publish a new need”, or use Create at the top of the page. Then choose “Submit an RFP” (a tender), “Request a consultation” (an expert question) or “Submit a project”.',
        'The M3 team reads it first, usually within one business day. A tender or an expert question is then shown to verified marinas, developers, service providers and media, and service providers can answer it. A project stays between you and the M3 team.',
      ], { links: [{ label: 'Which kind of need to choose', to: '#publishing-kinds' }], keywords: ['rfp', 'tender', 'consultation', 'post'] }),
      item('marina-details', 'Who sees our marina’s details?', [
        'Everyone can see your marina’s page: name, place, logo and description.',
        'The site shows the detailed profile (berths, facilities, certifications) and your team to verified members.',
      ], { keywords: ['berths', 'facilities', 'public', 'privacy'] }),
    ]),

    section('service-provider', 'profile', LifeBuoy, 'Service providers', 'For companies that sell products or services to marinas.', [
      item('provider-can', 'What can a service provider do here?', [
        'Read the tenders and expert questions that marinas and developers publish, and answer them. Present your company in the directory, send a message to any company and propose a webinar.',
        'You can also ask marinas you worked with for a reference, and sponsor one of our events for more visibility.',
      ], { keywords: ['supplier', 'partner', 'vendor', 'expert'] }),
      item('provider-answer', 'How do I answer a tender or an expert question?', [
        'Your interest goes to the marina’s team as a message from your company, in their Messages. Their answer shows in your Messages. The opportunities open once M3 has approved your account.',
      ], {
        steps: [
          'Open Opportunities.',
          'Choose a need and press “Express interest”.',
          'Add a short message if you like, then send it.',
        ],
        links: [{ label: 'See the opportunities', to: '/opportunities' }],
        keywords: ['rfp', 'tender', 'consultation', 'opportunity', 'reply', 'respond', 'proposal'],
      }),
      item('provider-references', 'What are references?', [
        'A reference is a marina you worked with that vouches for you. In the References tile of your dashboard, describe the project and the marina contact: we e-mail them, and they confirm or decline.',
        'Confirmed references appear on your company page.',
      ], { links: [{ label: 'Open References', to: memberHomeHref('references'), members: true }], keywords: ['recommendation', 'testimonial'] }),
      item('provider-visibility', 'How can we get more visibility?', [
        'Keep your company page complete: logo, cover photo, description, sectors and photos. Members find you by theme and by country.',
        'Membership is free. Sponsoring one of our events is a paid offer that gives your company a sponsor badge: ask the M3 team.',
      ], { links: [{ label: 'Sponsor an event', to: '/sponsor' }], keywords: ['sponsor', 'sponsorship', 'partner', 'badge', 'visible'] }),
    ]),

    section('investor', 'profile', Compass, 'Investors', 'For funds, family offices and strategic investors.', [
      item('investor-can', 'What can an investor do here?', [
        'See the companies that are raising capital in Deal flow, publish your investment thesis, find companies in the directory and send a message to any company.',
      ], { keywords: ['fund', 'investment', 'capital'] }),
      item('investor-deal-flow', 'What is Deal flow?', [
        'Deal flow lists the marinas, developers and service providers that say they are raising capital, with the amount, the stage and the use of funds when they gave them. Tick “Only show members in my focus sectors” to keep the ones in your sectors.',
        'It is open to verified investors, from the menu at the top of the page.',
      ], { links: [{ label: 'Open Deal flow', to: '/investments', members: true }], keywords: ['raising', 'funding', 'capital'] }),
      item('investor-thesis', 'How do we publish our investment thesis?', [
        'Only the company owner can do it.',
      ], {
        steps: [
          'Open My company on your dashboard.',
          'Press “More settings” at the bottom.',
          'Fill in the investment thesis part, then save.',
        ],
        links: [{ label: 'Open My company', to: memberHomeHref('company'), members: true }],
        keywords: ['focus', 'criteria', 'ticket'],
      }),
    ]),

    section('developer', 'profile', HardHat, 'Developers', 'For marina developers, real-estate groups and builders.', [
      item('developer-can', 'What can a developer do here?', [
        'Publish the needs of your marina projects (tenders, expert questions and projects), find service providers, read the tenders and expert questions other members publish, and send a message to any company.',
      ], { keywords: ['real estate', 'builder', 'construction'] }),
      item('developer-or-marina', 'Developer or marina: which profile should I choose?', [
        'Choose Developer if you design, build or own marina projects. Choose Marina if you run or represent a marina or a port.',
        'Not sure, or chose the wrong one? Write to the M3 team and we will set it right.',
      ], { keywords: ['persona', 'type', 'wrong profile', 'change profile'] }),
    ]),

    section('media', 'profile', Radio, 'Media', 'For journalists and publications covering marinas and yachting.', [
      item('media-can', 'What can a media outlet do here?', [
        'Follow the sector’s articles, the tenders and expert questions members publish, and the replays. Send a message to any company and propose a webinar.',
        'For our events, you can ask the M3 team for a press accreditation.',
      ], { keywords: ['press', 'journalist', 'magazine'] }),
      item('media-accreditation', 'How do I get a press accreditation?', [
        'Write to events@m3monaco.com with the name of your outlet and the event you want to cover. The M3 team answers by e-mail.',
      ], { keywords: ['press', 'journalist', 'badge'] }),
      item('media-press-room', 'Where are the press kits?', [
        'Media members have a Press room tile on their dashboard. It holds the media kits and press releases of our events, and you can add links to the articles you publish.',
      ], { keywords: ['press release', 'media kit', 'photos'] }),
    ]),

    section('no-company', 'profile', UserRound, 'No company yet', 'For participants who are not linked to a company on the platform.', [
      item('no-company-can', 'I have no company on the platform. What can I do?', [
        'You can read the public resources and browse the directory. Once M3 has approved your account, you can also register for events and webinars.',
        'Publishing a need, the opportunities and messages need a company checked by M3.',
      ], { keywords: ['participant', 'individual', 'freelance', 'student'] }),
      item('no-company-add', 'How do I add my company?', [
        'Press “Add my company” on your dashboard and describe it. The M3 team then checks it.',
        'If your company is already on the platform, ask the person who manages its page (the owner) to invite you from My team. If nobody manages its page yet, press “Claim this page” on it.',
      ], { links: [{ label: 'Open my dashboard', to: '/#dashboard', members: true }], keywords: ['create company', 'join company', 'organisation', 'organization'] }),
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
        keywords: ['sign up', 'register', 'registration', 'join', 'new account', 'membership', 'price', 'cost'],
      }),
      item('account-password', 'I forgot my password.', [
        'Press Sign in, then “Forgot password?”. Type your e-mail and we send you a link to choose a new password. It also works if you never set one, for example when your account was created for an event.',
        'The e-mail can take a minute. Look in your spam folder too.',
      ], { keywords: ['login', 'log in', 'sign in', 'reset', 'locked', 'access', 'connect'] }),
      item('account-password-rules', 'What makes a valid password?', [
        'At least 8 characters, with one capital letter and one symbol, for example ! or ?. To change it later, open My profile and press “Change password”.',
      ], { keywords: ['change password', 'new password', 'weak'] }),
      item('account-dashboard', 'What is on my dashboard?', [
        'Your dashboard is the home page once you are signed in. At the top, To do lists what waits for you: first the messages and requests waiting for your answer, then what is missing on your company page and your profile. Press a line to deal with it.',
        'Below, the tiles hold everything you manage: My profile, My company, My team, My events, Messages and My requests.',
      ], { links: [{ label: 'Open my dashboard', to: '/#dashboard', members: true }], keywords: ['to do', 'todo', 'home', 'tiles', 'account'] }),
      item('account-details', 'How do I change my name, photo or job title?', [
        'Open My profile on your dashboard. Each line has a Change button: change one thing, then press Save.',
      ], { links: [{ label: 'Open My profile', to: memberHomeHref('profile'), members: true }], keywords: ['picture', 'avatar', 'edit profile', 'position'] }),
      item('account-email', 'Can I change my e-mail address?', [
        'You sign in with it, so only the M3 team can change it. Write to us from the address you use today.',
      ], { keywords: ['address', 'new e-mail'] }),
      item('account-several-companies', 'I work for more than one company.', [
        'You can belong to several companies. Open the menu under your name and choose the company under “Switch company”.',
      ], { keywords: ['switch', 'two companies', 'multiple'] }),
      item('account-close', 'How do I close my account?', [
        'Write to events@m3monaco.com from the address of your account. The M3 team closes it and tells you what happens to your data.',
      ], { keywords: ['delete account', 'remove account', 'cancel account', 'leave'] }),
    ]),

    section('verification', 'topic', ShieldCheck, 'Getting verified by M3', 'Why M3 checks every account, what it checks and how long it takes.', [
      item('verification-why', 'Why does M3 check every account?', [
        'So that every member is a real professional from a real company. You know who you talk to, and needs and messages stay serious.',
      ], { keywords: ['validation', 'verified', 'approval', 'review'] }),
      item('verification-time', 'How long does the check take?', [
        'Usually 24 to 48 business hours after you describe your company. You get an e-mail as soon as your account is approved.',
      ], { keywords: ['pending', 'validation', 'approval', 'approved', 'waiting', 'review', 'verified', 'delay'] }),
      item('verification-what', 'What does M3 check?', [
        'That your company exists and works in the marina or maritime world, from its website and the details you gave, and that you work there. If something is missing, we write to you.',
      ], { keywords: ['validation', 'review', 'criteria'] }),
      item('verification-meanwhile', 'What can I do while I wait?', [
        'Complete your profile, read the public resources, browse the directory and look at the coming events. Registering for events, the opportunities, messages and publishing open once you are approved.',
      ], { keywords: ['pending', 'waiting', 'validation', 'review'] }),
      item('verification-invited', 'A colleague invited me. Do I wait too?', [
        'No. If M3 has already checked your company, you are in as soon as you accept the invitation.',
      ], { keywords: ['invitation', 'invite', 'pending'] }),
      item('verification-company', 'My account is approved, but my company is still being checked.', [
        'M3 checks the company as well as the people. Until your company is approved, writing to other companies, publishing a need and proposing a webinar stay closed. There is nothing more to do: the notice on your dashboard goes away once it is approved.',
      ], { keywords: ['pending', 'organisation', 'organization', 'review'] }),
      item('verification-rejected', 'My account was not approved.', [
        'Your dashboard shows the reason. Press “Edit and resubmit” to correct your details, or write to the M3 team if you think it is a mistake.',
      ], { keywords: ['rejected', 'refused', 'declined', 'denied'] }),
    ]),

    section('company', 'topic', Building2, 'Your company page and team', 'Changing your company page, inviting colleagues and who decides.', [
      item('company-edit', 'How do I change our company page?', [
        'Open My company on your dashboard. Each line (logo, cover photo, description, website, place, sectors, photos) has a Change button. Anyone in the company can change the page; only the owner adds documents.',
        'What is not listed there, such as the marina facilities, is under “More settings”.',
      ], { links: [{ label: 'Open My company', to: memberHomeHref('company'), members: true }], keywords: ['organisation', 'organization', 'logo', 'edit company', 'profile'] }),
      item('company-sectors', 'Why do sectors matter?', [
        'Sectors say what your company offers (service providers) or looks for (marinas, developers, investors). They decide which needs and articles we suggest to you.',
        'When a first message goes between a company that looks for a sector and one that offers it, the two are connected at once.',
      ], { keywords: ['categories', 'themes', 'activities', 'match'] }),
      item('company-invite', 'How do I add a colleague?', [
        'Only the company owner can invite or remove people. If your company has no free place left, write to the M3 team.',
      ], {
        steps: [
          'Open My team on your dashboard.',
          'Press “Invite a colleague” and type their e-mail address.',
          'We e-mail them a link to join your company.',
        ],
        links: [{ label: 'Open My team', to: memberHomeHref('team'), members: true }],
        keywords: ['invite', 'invitation', 'team', 'member', 'employee', 'staff'],
      }),
      item('company-places', 'How many colleagues can join our company?', [
        'Open My team on your dashboard. If your company has a set number of places, it shows how many are used.',
        'If they are all taken, write to the M3 team and we add one, free of charge.',
      ], { links: [{ label: 'Open My team', to: memberHomeHref('team'), members: true }], keywords: ['seats', 'places', 'limit', 'full', 'colleagues'] }),
      item('company-join-requests', 'Someone asks to join our company.', [
        'The owner sees the request in To do and in My team, and accepts or declines it.',
      ], { keywords: ['join request', 'accept', 'team'] }),
      item('company-owner', 'Who is the owner? Can it change?', [
        'The owner is usually the person who registered the company. They can hand it over to a colleague: open My team, then “More settings”.',
      ], { keywords: ['admin', 'administrator', 'transfer', 'manager'] }),
      item('company-leave', 'How do I leave a company?', [
        'Open My team and press “Leave the company”. The owner cannot leave: they hand the company over to a colleague first.',
      ], { keywords: ['quit', 'remove me', 'left'] }),
    ]),

    section('messages', 'topic', MessageSquare, 'Messages and connections', 'Writing to a company, getting connected and the e-mails you get.', [
      item('messages-who', 'Who can I write to?', [
        'Any company on the platform. Open its page and press “Send a message”: a short first message, up to 500 characters. You need a company checked by M3 to write.',
      ], { keywords: ['contact', 'contact a marina', 'contact a company', 'supplier', 'service provider', 'reach', 'write', 'connect', 'connection', 'chat'] }),
      item('messages-connected', 'When are we connected?', [
        'When your activities match, for example a marina looking for a sector that a service provider offers, you are connected at once and can talk.',
        'Otherwise the other company decides. Anyone in their team can accept or decline; the first answer counts.',
      ], { keywords: ['connection', 'request', 'accept', 'sectors', 'match'] }),
      item('messages-team', 'Who sees the conversation?', [
        'Both teams. Everyone in the two companies can read and reply, and each message shows who wrote it, their company and the time.',
      ], { keywords: ['colleagues', 'private', 'thread'] }),
      item('messages-where', 'Where do I find my messages?', [
        'In the Messages tile of your dashboard. On a computer, a number on the inbox icon next to your name, at the top of the page, tells you when something waits for you. On a phone, it shows next to Messages in the menu.',
      ], { links: [{ label: 'Open Messages', to: memberHomeHref('inbox'), members: true }], keywords: ['inbox', 'notifications', 'unread'] }),
      item('messages-emails', 'Do I get an e-mail for each message?', [
        'No. If something waits for you, you get one summary on Friday.',
        'When a company accepts your message, or you accept theirs, M3 introduces you to each other by e-mail. That e-mail goes to both of you, so each of you sees the other’s address.',
        'You can turn these e-mails off: “Messages from companies” in the e-mails you receive.',
      ], { links: [{ label: 'Choose your e-mails', to: '#emails-choose' }], keywords: ['notifications', 'digest', 'weekly', 'friday'] }),
      item('messages-report', 'Someone sends us unwanted messages.', [
        'Open the conversation and press Report at the top. Only the M3 team sees it, and the team looks into it.',
      ], { keywords: ['spam', 'abuse', 'block', 'report'] }),
    ]),

    section('publishing', 'topic', FileText, 'Publishing a need', 'Tenders, expert questions and projects: who publishes, who sees, who answers.', [
      item('publishing-who', 'Who can publish a need?', [
        'Marinas and developers whose company M3 has checked.',
      ], { keywords: ['post', 'submit', 'rfp', 'tender', 'consultation', 'project'] }),
      item('publishing-kinds', 'Tender, expert question or project: which one?', [
        'A tender (“Submit an RFP”): you describe a need, set a deadline and invite service providers to send a proposal.',
        'An expert question (“Request a consultation”): you ask one precise question and look for advice.',
        'A project (“Submit a project”): a marina project in energy, digital, infrastructure or services. It is not shown to other members: the M3 team reads it and puts you in touch with the right service providers.',
      ], { links: [{ label: 'What happens to a project', to: '#publishing-project' }], keywords: ['rfp', 'consultation', 'tender', 'difference'] }),
      item('publishing-review', 'When does it go live?', [
        'The M3 team reads each request first, usually within one business day. A tender or an expert question is then published and we e-mail you.',
        'A project is not published: the M3 team gets back to you.',
      ], { keywords: ['review', 'approval', 'pending', 'published', 'online'] }),
      item('publishing-visible', 'Who sees what I publish?', [
        'Tenders and expert questions: marinas, developers, service providers and media whose account M3 has approved. Service providers can answer; the others can only read.',
        'Projects: only you and the M3 team.',
      ], { keywords: ['visible', 'public', 'private', 'confidential'] }),
      item('publishing-project', 'What happens to a project?', [
        'A project is not published for other members. The M3 team reads it, usually within one business day, and puts you in touch with service providers that fit. Only you and the M3 team see it.',
      ], { keywords: ['project', 'private', 'introduction'] }),
      item('publishing-answers', 'How do I see the answers?', [
        'When a service provider presses “Express interest” on a tender or an expert question, it arrives in your Messages, as a message from their company. Anyone in your team can read it and answer.',
        'For a project, the M3 team puts you in touch with suitable service providers.',
      ], { keywords: ['replies', 'responses', 'proposals', 'interest'] }),
      item('publishing-change', 'Can I change or close it?', [
        'Yes. In My requests on your dashboard you can edit it, close it once you have found what you need, open it again or delete it.',
      ], { links: [{ label: 'Open My requests', to: memberHomeHref('requests'), members: true }], keywords: ['edit', 'delete', 'remove', 'close', 'update'] }),
    ]),

    section('events', 'topic', CalendarDays, 'Events and webinars', 'Registering, joining, replays and invitations.', [
      item('events-webinar', 'How do I register for a webinar?', [
        'Open the webinar in Events and press Register. Signed in, one click is enough once M3 has approved your account, and you can add the webinar to your calendar straight away. Without an account, give your name and e-mail (your company is optional).',
        'You get a confirmation e-mail, then a reminder with a calendar file about 24 hours before the start.',
      ], { links: [{ label: 'See the events', to: '/events' }], keywords: ['registration', 'sign up', 'book', 'attend', 'event', 'calendar'] }),
      item('events-join', 'How do I join a webinar on the day?', [
        'Open the link in your confirmation or reminder e-mail. It takes you to the webinar’s page, where you find how to join.',
        'Signed in, you also find the link to join in My events on your dashboard.',
      ], { links: [{ label: 'Open My events', to: memberHomeHref('registrations'), members: true }], keywords: ['zoom', 'link', 'connect', 'live'] }),
      item('events-replay', 'I missed a webinar.', [
        'Replays are added to the Resources when they are ready. If you had registered, you also find the replay in My events.',
      ], { links: [{ label: 'Open the resources', to: '/resources' }], keywords: ['replay', 'recording', 'video', 'watch'] }),
      item('events-cancel', 'How do I cancel my registration?', [
        'Open the event and press “Cancel my registration”. Registered without an account? Write to the M3 team.',
      ], { keywords: ['unregister', 'cannot attend', 'cancel'] }),
      item('events-invitation', 'Some events say “by invitation”.', [
        'Send a request from the event’s page. The M3 team reviews it and answers by e-mail.',
      ], { keywords: ['invitation only', 'invite', 'request'] }),
      item('events-paid', 'Are events free?', [
        'Webinars are free. Some events on site have a fee: the event’s page says so.',
        'For an event with a fee, your registration waits for the M3 team, and we e-mail you when payment is due. A question about an invoice? Write to events@m3monaco.com.',
      ], { keywords: ['price', 'cost', 'fee', 'pay', 'payment', 'ticket', 'invoice', 'receipt', 'member rate'] }),
      item('events-propose', 'Can we give a webinar?', [
        'Yes, if you are a marina, a service provider or a media outlet and M3 has checked your company. Press “Propose a webinar” on the Events page, or in My requests on your dashboard. The M3 team looks at it with you.',
      ], { keywords: ['speak', 'speaker', 'present', 'host', 'organise', 'organize'] }),
    ]),

    section('emails', 'topic', Mail, 'E-mails and unsubscribing', 'Choosing the e-mails you get, and stopping them.', [
      item('emails-choose', 'How do I choose the e-mails I get?', [], {
        steps: [
          'Open My profile on your dashboard.',
          'On the line “E-mails you receive”, press Change.',
          'Turn off what you do not need, then press Save.',
        ],
        links: [{ label: 'Open My profile', to: memberHomeHref('profile'), members: true }],
        keywords: ['preferences', 'notifications', 'settings', 'too many'],
      }),
      item('emails-kinds', 'What kinds of e-mail are there?', [
        'Messages from companies (the Friday summary), your requests and proposals, references, events, payments and invoices, your team, your account, and news from M3.',
      ], { keywords: ['notifications', 'types'] }),
      item('emails-unsubscribe', 'How do I unsubscribe from an e-mail?', [
        'Most e-mails about your activity on the platform have an Unsubscribe link at the bottom. It opens a page where you confirm, with no need to sign in.',
        'You can also turn each kind of e-mail off in My profile, and back on at any time.',
      ], { keywords: ['stop', 'opt out', 'unsubscribe'] }),
      item('emails-always', 'Which e-mails always arrive?', [
        'The ones you ask for yourself, such as the link to choose a new password, and the reminder the day before a webinar you registered for, even if Events is turned off.',
      ], { keywords: ['cannot turn off', 'required'] }),
      item('emails-newsletter', 'How do I stop the newsletter?', [
        'The newsletter is separate. Use the unsubscribe link at the bottom of any newsletter.',
      ], { keywords: ['news', 'mailing', 'unsubscribe'] }),
      item('emails-missing', 'I do not receive your e-mails.', [
        'Look in your spam folder, and add noreply@smartmarinaconnect.com and events@m3monaco.com to your contacts. Still nothing? Write to events@m3monaco.com.',
      ], { keywords: ['spam', 'junk', 'not received', 'missing'] }),
    ]),

    section('privacy', 'topic', Lock, 'Privacy', 'Who sees what, and your rights over your data.', [
      item('privacy-visible', 'Who can see my details?', [
        'Company pages in the directory are public. On a company’s page, the site shows its team (photo, name and job title) to verified members.',
        'Your e-mail address is not shown on the site, but your colleagues can see it. When a company accepts your message, or you accept theirs, M3 introduces you to each other by e-mail, so each of you sees the other’s address.',
      ], { keywords: ['personal data', 'visible', 'public', 'gdpr'] }),
      item('privacy-use', 'What does M3 do with my data?', [
        'We use it to run the platform, check accounts and send you the e-mails you choose. Other members only see what the platform shows them.',
        'The privacy policy says everything, including the services we work with.',
      ], { links: [{ label: 'Read the privacy policy', to: '/privacy' }], keywords: ['gdpr', 'rgpd', 'personal data', 'policy'] }),
      item('privacy-rights', 'How do I see, correct or delete my data?', [
        'You can change most of it yourself on your dashboard. For anything else, including deleting your account, write to events@m3monaco.com.',
      ], { keywords: ['gdpr', 'rgpd', 'erase', 'export', 'delete'] }),
      item('privacy-cookies', 'What about cookies?', [
        'You choose in the cookie banner the first time you visit. The cookie policy explains what each cookie is for.',
      ], { links: [{ label: 'Read the cookie policy', to: '/cookies' }], keywords: ['tracking', 'analytics', 'consent'] }),
    ]),
  ];
}

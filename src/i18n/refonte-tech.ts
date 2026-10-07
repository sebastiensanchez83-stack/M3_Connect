// The configured instance (not the bare 'i18next' default): these strings are
// registered while a chunk loads, and a bare instance has no addResourceBundle
// until init() has run.
import i18n from '@/i18n';

/**
 * Strings of the technical pass of the refonte (Oct 2026): the error panel of
 * the library and the events list, and the archive state of the SM26 agenda.
 * English only: the interface is English-only.
 *
 * Self-registering: the components that use these keys import this file, which
 * adds them to the running i18next instance at load (deep merge, no overwrite).
 * No shared setup file has to change. Every `t()` call also carries its English
 * text as a default, so a missing registration never shows a key.
 */
export const TECH_REFONTE_STRINGS = {
  en: {
    loadError: {
      retry: 'Try again',
      body: 'Check your connection, then try again.',
      events: 'The events could not be loaded.',
      resources: 'The library could not be loaded.',
    },
    sm26Agenda: {
      archive: {
        noteNoDates: 'This edition has taken place. The programme and the slides are kept here as an archive.',
      },
    },
  },
};

let registered = false;

/** Adds the strings above to the running i18next instance, once. */
export function registerTechRefonteStrings(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle('en', 'translation', TECH_REFONTE_STRINGS.en, true, false);
}

registerTechRefonteStrings();

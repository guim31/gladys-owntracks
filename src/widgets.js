// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `phones`.
//
// Every phone on one card, in a `card-list`: its name, its region and the
// time of its last position, its presence as a colored badge. Tapping a phone
// opens the detail panel of the core: battery, distance from home, accuracy,
// and a map link (OpenStreetMap) when the user shares coordinates.
//
// In a `card-list`, a `date` replaces the subtitle (core front, v5.2.0): the
// time is written in the subtitle instead, next to the region.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { regionText } from './devices.js';
import { mapUrl } from './model.js';
import { WIDGET_KEY } from './hub.js';
import { formatDistance, formatTime, NAMES, PRESENCE_LABELS } from './texts.js';

export { WIDGET_KEY };

// A `list` card-list shows 8 items at most.
export const MAX_ITEMS = 8;

export const TEXT = {
  empty: {
    en: 'No phone in the OwnTracks Recorder yet, or the Recorder is not connected.',
    fr: "Aucun téléphone dans OwnTracks Recorder pour l'instant, ou le Recorder n'est pas connecté.",
    de: 'Noch kein Telefon im OwnTracks Recorder, oder der Recorder ist nicht verbunden.',
    es: 'Todavía no hay teléfonos en OwnTracks Recorder, o el Recorder no está conectado.',
  },
  more: {
    en: '%d more phone(s) not shown.',
    fr: '%d autre(s) téléphone(s) non affiché(s).',
    de: '%d weitere(s) Telefon(e) nicht angezeigt.',
    es: '%d teléfono(s) más no mostrado(s).',
  },
  accuracy: { en: 'Accuracy', fr: 'Précision', de: 'Genauigkeit', es: 'Precisión' },
  map: { en: 'Map', fr: 'Carte', de: 'Karte', es: 'Mapa' },
};

const BADGE_COLORS = {
  home: WIDGET_COLORS.SUCCESS,
  away: WIDGET_COLORS.WARNING,
  unknown: WIDGET_COLORS.NEUTRAL,
};

const pick = (table, language) => table[language] ?? table.en;

function detail(view, language) {
  // French typography: a space before the colon.
  const line = (label, value) => `${label}${language === 'fr' ? ' : ' : ': '}${value}`;
  const names = NAMES[language];
  const lines = [];
  if (view.battery !== null) lines.push(line(names.battery, `${Math.round(view.battery)} %`));
  if (view.distanceKm !== null) {
    lines.push(line(names.distance_home, formatDistance(view.distanceKm, language)));
  }
  if (view.accuracy !== null) {
    lines.push(line(pick(TEXT.accuracy, language), `${Math.round(view.accuracy)} m`));
  }
  if (view.time !== null) {
    lines.push(line(names.last_position, formatTime(view.time, language, null)));
  }
  return lines.join('\n');
}

/**
 * @param {object} hub
 * @param {{ language?: string }} request
 */
export function buildContent(hub, { language = 'en' } = {}) {
  const lang = NAMES[language] ? language : 'en';
  const views = [...hub.phones.values()]
    .map((phone) => hub.view(phone))
    .sort((a, b) => a.name.localeCompare(b.name, lang));
  if (views.length === 0) {
    return {
      ttl_seconds: 60,
      components: [{ type: 'text', variant: 'body', text: pick(TEXT.empty, lang) }],
    };
  }
  const now = hub.now();
  const share = hub.config?.shareCoordinates === true;
  const items = views.slice(0, MAX_ITEMS).map((view) => {
    const time = view.time === null ? '' : formatTime(view.time, lang, now);
    const item = {
      title: view.name,
      subtitle: [regionText(view, lang), time].filter(Boolean).join(' · '),
      badge: { text: PRESENCE_LABELS[lang][view.status], color: BADGE_COLORS[view.status] },
    };
    const description = detail(view, lang);
    if (description) {
      item.description = description;
    }
    if (share && view.hasPosition) {
      item.links = [{ url: mapUrl(view), label: pick(TEXT.map, lang) }];
    }
    return item;
  });
  const components = [{ type: 'card-list', display: 'list', items }];
  if (views.length > MAX_ITEMS) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: pick(TEXT.more, lang).replace('%d', String(views.length - MAX_ITEMS)),
    });
  }
  // The hub nudges the widget on every region or presence change: the TTL
  // only refreshes the times of the subtitles.
  return { ttl_seconds: 300, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    get(hub, request) {
      return buildContent(hub, request ?? {});
    },
  },
};

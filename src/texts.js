// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface (German says "du", Spanish "usted"). Picked with the `language`
// field of the configuration: a device integration and its scene actions do
// not receive the user's language (a widget does).
// -----------------------------------------------------------------------------

// Feature names (frozen at the device creation in Gladys).
export const NAMES = {
  en: {
    at_home: 'At home',
    presence: 'Presence',
    distance_home: 'Distance from home',
    battery: 'Battery',
    last_position: 'Last position',
    region: 'OwnTracks region',
  },
  fr: {
    at_home: 'À la maison',
    presence: 'Présence',
    distance_home: 'Distance de la maison',
    battery: 'Batterie',
    last_position: 'Dernière position',
    region: 'Région OwnTracks',
  },
  de: {
    at_home: 'Zu Hause',
    presence: 'Anwesenheit',
    distance_home: 'Entfernung von zu Hause',
    battery: 'Akku',
    last_position: 'Letzte Position',
    region: 'OwnTracks-Region',
  },
  es: {
    at_home: 'En casa',
    presence: 'Presencia',
    distance_home: 'Distancia de casa',
    battery: 'Batería',
    last_position: 'Última posición',
    region: 'Región OwnTracks',
  },
};

// Badge of the widget and `status` output of the scene action.
export const PRESENCE_LABELS = {
  en: { home: 'At home', away: 'Away', unknown: 'Unknown' },
  fr: { home: 'À la maison', away: 'Absent', unknown: 'Inconnu' },
  de: { home: 'Zu Hause', away: 'Unterwegs', unknown: 'Unbekannt' },
  es: { home: 'En casa', away: 'Fuera', unknown: 'Desconocido' },
};

// The region of a phone in no region, or without any position yet.
export const REGION_TEXT = {
  en: { none: 'No region', no_position: 'No position' },
  fr: { none: 'Hors région', no_position: 'Aucune position' },
  de: { none: 'Keine Region', no_position: 'Keine Position' },
  es: { none: 'Sin región', no_position: 'Sin posición' },
};

// Connection status shown in the Configuration screen (multi-language).
export const STATUS_TEXT = {
  en: {
    not_configured: 'Enter the address of your OwnTracks Recorder.',
    invalid_url: 'The address of the Recorder is not valid.',
    unauthorized: 'The Recorder (or its proxy) refused the user name and password.',
    unreachable: 'The Recorder does not answer. Check its address and that it is running.',
    error: 'The Recorder answered with an error. Check the integration logs.',
  },
  fr: {
    not_configured: "Saisissez l'adresse de votre OwnTracks Recorder.",
    invalid_url: "L'adresse du Recorder n'est pas valide.",
    unauthorized: "Le Recorder (ou son proxy) a refusé le nom d'utilisateur et le mot de passe.",
    unreachable: "Le Recorder ne répond pas. Vérifiez son adresse et qu'il est démarré.",
    error: "Le Recorder a répondu par une erreur. Consultez les logs de l'intégration.",
  },
  de: {
    not_configured: 'Gib die Adresse deines OwnTracks Recorders ein.',
    invalid_url: 'Die Adresse des Recorders ist ungültig.',
    unauthorized: 'Der Recorder (oder sein Proxy) hat Benutzername und Passwort abgelehnt.',
    unreachable: 'Der Recorder antwortet nicht. Prüfe die Adresse und ob er läuft.',
    error: 'Der Recorder hat mit einem Fehler geantwortet. Sieh in die Logs der Integration.',
  },
  es: {
    not_configured: 'Introduzca la dirección de su OwnTracks Recorder.',
    invalid_url: 'La dirección del Recorder no es válida.',
    unauthorized: 'El Recorder (o su proxy) ha rechazado el nombre de usuario y la contraseña.',
    unreachable: 'El Recorder no responde. Compruebe su dirección y que esté en marcha.',
    error: 'El Recorder ha respondido con un error. Consulte los registros de la integración.',
  },
};

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Die Initialisierung ist fehlgeschlagen, sieh in die Logs der Integration.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// Answer of the "Test the connection" button.
export const TEST_TEXT = {
  en: {
    ok: (version, users, phones) =>
      `Connected to OwnTracks Recorder ${version}: ${users} user(s), ${phones} phone(s) with a position.`,
  },
  fr: {
    ok: (version, users, phones) =>
      `Connecté à OwnTracks Recorder ${version} : ${users} utilisateur(s), ${phones} téléphone(s) avec une position.`,
  },
  de: {
    ok: (version, users, phones) =>
      `Mit OwnTracks Recorder ${version} verbunden: ${users} Benutzer, ${phones} Telefon(e) mit Position.`,
  },
  es: {
    ok: (version, users, phones) =>
      `Conectado a OwnTracks Recorder ${version}: ${users} usuario(s), ${phones} teléfono(s) con posición.`,
  },
};

// Errors of the scene action.
export const ACTION_ERRORS = {
  en: { unknown_phone: 'This phone is unknown to the OwnTracks integration.' },
  fr: { unknown_phone: "Ce téléphone est inconnu de l'intégration OwnTracks." },
  de: { unknown_phone: 'Dieses Telefon ist der OwnTracks-Integration unbekannt.' },
  es: { unknown_phone: 'Este teléfono es desconocido para la integración OwnTracks.' },
};

const pick = (table, language) => table[language] ?? table.en;

/**
 * `16:08` today, `14/10 16:08` before, in the Gladys time zone (TZ). With
 * `now` null, always with the day (a feature state stays true over midnight).
 * @param {number} time milliseconds since the epoch
 */
export function formatTime(time, language, now = Date.now()) {
  const date = new Date(time);
  if (!Number.isFinite(time) || Number.isNaN(date.getTime())) {
    return '';
  }
  const locale = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' }[language] ?? 'en-GB';
  const clock = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const day = (d) => d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
  return now !== null && day(date) === day(new Date(now)) && now - time < 86_400_000
    ? clock
    : `${day(date)} ${clock}`;
}

/** `4.2 km` / `4,2 km` / `350 m`. */
export function formatDistance(km, language) {
  if (km < 1) {
    return `${Math.round(km * 1000)} m`;
  }
  const value = km < 100 ? Math.round(km * 10) / 10 : Math.round(km);
  return `${language === 'en' ? String(value) : String(value).replace('.', ',')} km`;
}

export const SENTENCES = {
  en: {
    no_position: (name) => `${name} has not sent any position yet.`,
    at_home: (name) => `${name} is at home`,
    in_region: (name, region) => `${name} is in ${region}`,
    away: (name) => `${name} is away`,
    unknown: (name) => `${name} is outside the known regions`,
    distance: (distance) => `, ${distance} from home`,
    time: (time) => `, position of ${time}.`,
  },
  fr: {
    no_position: (name) => `${name} n'a encore envoyé aucune position.`,
    at_home: (name) => `${name} est à la maison`,
    in_region: (name, region) => `${name} est dans la région ${region}`,
    away: (name) => `${name} n'est pas à la maison`,
    unknown: (name) => `${name} est hors des régions connues`,
    distance: (distance) => `, à ${distance} de la maison`,
    time: (time) => `, position de ${time}.`,
  },
  de: {
    no_position: (name) => `${name} hat noch keine Position gesendet.`,
    at_home: (name) => `${name} ist zu Hause`,
    in_region: (name, region) => `${name} ist in der Region ${region}`,
    away: (name) => `${name} ist nicht zu Hause`,
    unknown: (name) => `${name} ist außerhalb der bekannten Regionen`,
    distance: (distance) => `, ${distance} von zu Hause entfernt`,
    time: (time) => `, Position von ${time}.`,
  },
  es: {
    no_position: (name) => `${name} todavía no ha enviado ninguna posición.`,
    at_home: (name) => `${name} está en casa`,
    in_region: (name, region) => `${name} está en la región ${region}`,
    away: (name) => `${name} no está en casa`,
    unknown: (name) => `${name} está fuera de las regiones conocidas`,
    distance: (distance) => `, a ${distance} de casa`,
    time: (time) => `, posición de ${time}.`,
  },
};

/**
 * "Alice (phone) is in Work, 4,1 km from home, position of 16:08."
 * @param {{ name: string, hasPosition: boolean, atHome: boolean | null,
 *   regions: string[], distanceKm: number | null, time: number | null }} view
 */
export function positionSentence(view, language, now = Date.now()) {
  const s = pick(SENTENCES, language);
  if (!view.hasPosition) {
    return s.no_position(view.name);
  }
  let sentence;
  if (view.atHome) {
    sentence = s.at_home(view.name);
  } else if (view.regions.length > 0) {
    sentence = s.in_region(view.name, view.regions.join(', '));
  } else if (view.atHome === false) {
    sentence = s.away(view.name);
  } else {
    sentence = s.unknown(view.name);
  }
  if (!view.atHome && view.distanceKm !== null) {
    sentence += s.distance(formatDistance(view.distanceKm, language));
  }
  return sentence + s.time(formatTime(view.time, language, now));
}

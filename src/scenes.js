// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
// `get_position`: where is this phone? A ready-made sentence for a message or
// a voice answer, and the raw values for conditions (`at_home`,
// `distance_km`...). Read from what the Recorder already pushed: no request,
// instant. The map link stays empty unless the user shares coordinates.
// -----------------------------------------------------------------------------

import { regionText } from './devices.js';
import { mapUrl } from './model.js';
import { ACTION_ERRORS, formatTime, PRESENCE_LABELS, positionSentence } from './texts.js';

export const SCENE_ACTIONS = {
  async get_position(hub, { fields = {} }) {
    const language = hub.config?.language ?? 'fr';
    const phone = hub.phoneOf(fields.device);
    if (!phone) {
      throw new Error((ACTION_ERRORS[language] ?? ACTION_ERRORS.en).unknown_phone);
    }
    const view = hub.view(phone);
    const now = hub.now();
    return {
      sentence: positionSentence(view, language, now),
      phone: view.name,
      status: (PRESENCE_LABELS[language] ?? PRESENCE_LABELS.en)[view.status],
      at_home: view.atHome === true,
      region: regionText(view, language),
      distance_km: view.distanceKm === null ? -1 : Math.round(view.distanceKm * 10) / 10,
      battery: view.battery === null ? -1 : Math.round(view.battery),
      last_position: view.time === null ? '' : formatTime(view.time, language, now),
      map_url: hub.config?.shareCoordinates ? mapUrl(view) : '',
    };
  },
};

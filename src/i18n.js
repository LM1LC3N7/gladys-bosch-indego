// -----------------------------------------------------------------------------
// Every user-facing text, in English and French. Pure.
// -----------------------------------------------------------------------------

/** { en, fr } -> the text of `language` (English when missing). */
export const pick = (text, language) => text?.[language] ?? text?.en ?? '';

const both = (en, fr) => ({ en, fr });

/** The state codes (pyIndego MOWER_STATE_DESCRIPTION_DETAIL), translated. */
const STATE_TEXT = {
  0: both('Reading status', "Lecture de l'état"),
  101: both('Mower lifted', 'Tondeuse soulevée'),
  257: both('Charging', 'En charge'),
  258: both('Docked', 'À la station'),
  259: both('Docked, software update', 'À la station, mise à jour logicielle'),
  260: both('Charging', 'En charge'),
  261: both('Docked', 'À la station'),
  262: both('Docked, loading the map', 'À la station, chargement de la carte'),
  263: both('Docked, saving the map', 'À la station, enregistrement de la carte'),
  266: both('Leaving the station', 'Sortie de la station'),
  512: both('Mowing, leaving the station', 'Tonte, sortie de la station'),
  513: both('Mowing', 'Tonte'),
  514: both('Mowing, relocalising', 'Tonte, relocalisation'),
  515: both('Mowing, loading the map', 'Tonte, chargement de la carte'),
  516: both('Mowing, learning the lawn', 'Tonte, apprentissage du terrain'),
  517: both('Mowing paused', 'Tonte en pause'),
  518: both('Border cut', 'Coupe des bordures'),
  519: both('Idle in the lawn', "À l'arrêt sur la pelouse"),
  520: both('Learning the lawn, paused', 'Apprentissage du terrain en pause'),
  521: both('Border cut', 'Coupe des bordures'),
  523: both('Spot mowing', 'Tonte localisée'),
  524: both('Random mowing', 'Tonte aléatoire'),
  525: both('Random mowing complete', 'Tonte aléatoire terminée'),
  768: both('Returning to the station', 'Retour à la station'),
  769: both('Returning to the station', 'Retour à la station'),
  770: both('Returning to the station', 'Retour à la station'),
  771: both('Returning to the station, battery low', 'Retour à la station, batterie faible'),
  772: both(
    'Returning to the station, time slot ended',
    'Retour à la station, fin du créneau horaire',
  ),
  773: both(
    'Returning to the station, battery temperature',
    'Retour à la station, température de la batterie',
  ),
  774: both('Returning to the station, as requested', 'Retour à la station demandé'),
  775: both('Returning to the station, lawn complete', 'Retour à la station, pelouse terminée'),
  776: both('Returning to the station, relocalising', 'Retour à la station, relocalisation'),
  1005: both('Could not enter the charging station', "Impossible d'entrer dans la station"),
  1025: both('Diagnostic mode', 'Mode diagnostic'),
  1026: both('End of life', 'Fin de vie'),
  1027: both('Service requesting status', "Service : demande d'état"),
  1038: both('Mower immobilized', 'Tondeuse immobilisée'),
  1281: both('Software update', 'Mise à jour logicielle'),
  1537: both('Stuck on the lawn, help needed', 'Bloquée sur la pelouse, aide nécessaire'),
  64513: both('Sleeping', 'En veille'),
  99999: both('Offline', 'Hors ligne'),
};

const ACTIVITY_TEXT = {
  mowing: both('Mowing', 'Tonte'),
  paused: both('Paused', 'En pause'),
  returning: both('Returning to the station', 'Retour à la station'),
  docked: both('In the station', 'À la station'),
  charging: both('Charging', 'En charge'),
  idle: both('Idle', "À l'arrêt"),
  error: both('Error', 'Erreur'),
  updating: both('Software update', 'Mise à jour logicielle'),
  offline: both('Offline', 'Hors ligne'),
  unknown: both('Unknown', 'Inconnu'),
};

const minutes = (ms) => Math.max(1, Math.ceil(ms / 60_000));

export const T = {
  stateText(code, activity) {
    if (STATE_TEXT[code]) {
      return STATE_TEXT[code];
    }
    const base = ACTIVITY_TEXT[activity] ?? ACTIVITY_TEXT.unknown;
    return code === null || code === undefined
      ? base
      : both(`${base.en} (code ${code})`, `${base.fr} (code ${code})`);
  },
  activity: (activity) => ACTIVITY_TEXT[activity] ?? ACTIVITY_TEXT.unknown,
  none: both('None', 'Aucune'),
  noNextMow: both('None planned', 'Aucune prévue'),

  features: {
    state: both('State', 'État'),
    run_mode: both('Mow / pause', 'Tondre / pause'),
    dock: both('Back to the station', 'Retour à la station'),
    battery: both('Battery', 'Batterie'),
    activity: both('Activity', 'Activité'),
    state_code: both('State code', "Code d'état"),
    progress: both('Mowing progress (%)', 'Progression de la tonte (%)'),
    next_mow: both('Next mowing', 'Prochaine tonte'),
    alerts: both('Unread alerts', 'Alertes non lues'),
    last_alert: both('Last alert', 'Dernière alerte'),
    connected: both('Online', 'En ligne'),
  },
  runOptions: {
    pause: both('Pause', 'Pause'),
    mow: both('Mow', 'Tondre'),
  },

  // --- Connection status ---------------------------------------------------------
  notSignedIn: both(
    'Not connected: click "Connect" (or "Start the sign-in"), sign in with your Bosch SingleKey ID, then paste the final address in "Finish the sign-in".',
    "Non connecté : cliquez sur « Connecter » (ou « Démarrer la connexion »), connectez-vous avec votre Bosch SingleKey ID, puis collez l'adresse finale dans « Terminer la connexion ».",
  ),
  refused: both(
    'The Bosch session expired or was refused: sign in again ("Start the sign-in", then "Finish the sign-in").',
    'La session Bosch a expiré ou a été refusée : reconnectez-vous (« Démarrer la connexion » puis « Terminer la connexion »).',
  ),
  ok: ({ mowers, longpoll }) =>
    both(
      `Connected: ${mowers} mower${mowers > 1 ? 's' : ''}${longpoll ? ', live state (long poll)' : ''}.`,
      `Connecté : ${mowers} tondeuse${mowers > 1 ? 's' : ''}${longpoll ? ', état en direct (longue interrogation)' : ''}.`,
    ),
  noMower: both(
    'Connected, but the account has no Indego mower.',
    "Connecté, mais le compte n'a aucune tondeuse Indego.",
  ),
  unreachable: (reason) =>
    both(
      `The Indego cloud cannot be reached (${reason}); trying again.`,
      `Le cloud Indego est injoignable (${reason}) ; nouvel essai prévu.`,
    ),
  blocked: (reason) =>
    both(
      `The Indego cloud gateway refuses the calls for now (${reason}); trying again.`,
      `La passerelle du cloud Indego refuse les appels pour l'instant (${reason}) ; nouvel essai prévu.`,
    ),
  rateLimited: (ms) =>
    both(
      `Too many requests: the Indego cloud asked to wait. Next call in ${minutes(ms)} min.`,
      `Trop de requêtes : le cloud Indego demande d'attendre. Prochain appel dans ${minutes(ms)} min.`,
    ),
  renewalRetry: (reason, ms) =>
    both(
      `The Bosch session could not be renewed (${reason}); next try in ${minutes(ms)} min.`,
      `La session Bosch n'a pas pu être renouvelée (${reason}) ; nouvel essai dans ${minutes(ms)} min.`,
    ),

  // --- Sign-in actions ------------------------------------------------------------
  signInStarted: (url) =>
    both(
      `Open this address in a browser, open its developer tools (F12, Console tab) and sign in. The browser then fails to open "com.bosch.indegoconnect://login?…": copy that address (or the whole error line) into "Finish the sign-in", within 15 minutes. ${url}`,
      `Ouvrez cette adresse dans un navigateur, ouvrez ses outils de développement (F12, onglet Console) et connectez-vous. Le navigateur n'arrive pas ensuite à ouvrir « com.bosch.indegoconnect://login?… » : copiez cette adresse (ou toute la ligne d'erreur) dans « Terminer la connexion », dans les 15 minutes. ${url}`,
    ),
  noCode: both(
    'No sign-in code in the pasted text: paste the address starting with com.bosch.indegoconnect://login?, with its state and code.',
    "Aucun code de connexion dans le texte collé : collez l'adresse qui commence par com.bosch.indegoconnect://login?, avec son state et son code.",
  ),
  unknownSignIn: both(
    'This address does not belong to a sign-in started in the last 15 minutes: click "Start the sign-in" again and use the new address.',
    'Cette adresse ne correspond à aucune connexion démarrée dans les 15 dernières minutes : cliquez à nouveau sur « Démarrer la connexion » et utilisez la nouvelle adresse.',
  ),
  codeRefused: (reason) =>
    both(
      `${reason}. The code serves once and expires within minutes: start the sign-in again.`,
      `Connexion refusée par Bosch (${reason}). Le code ne sert qu'une fois et expire en quelques minutes : recommencez la connexion.`,
    ),
  signedIn: (count) =>
    both(
      `Signed in: ${count} mower${count > 1 ? 's' : ''} found. Add ${count > 1 ? 'them' : 'it'} in the Discovery tab.`,
      `Connecté : ${count} tondeuse${count > 1 ? 's' : ''} trouvée${count > 1 ? 's' : ''}. Ajoutez-la${count > 1 ? 's' : ''} dans l'onglet Découverte.`,
    ),
  signedInNoList: both(
    'Signed in; the mowers could not be read yet (see the connection status).',
    "Connecté ; les tondeuses n'ont pas encore pu être lues (voir l'état de la connexion).",
  ),

  // --- Test action ----------------------------------------------------------------
  test: (mowers) => {
    if (mowers.length === 0) {
      return both(
        'Connected, but the account has no Indego mower.',
        "Connecté, mais le compte n'a aucune tondeuse Indego.",
      );
    }
    const line = (m, lang) => {
      const battery = m.battery === null ? '?' : `${m.battery} %`;
      return lang === 'fr'
        ? `${m.name} : ${pick(m.stateText, lang)}, batterie ${battery}`
        : `${m.name}: ${pick(m.stateText, lang)}, battery ${battery}`;
    };
    return both(
      `Connected. ${mowers.map((m) => line(m, 'en')).join('; ')}.`,
      `Connecté. ${mowers.map((m) => line(m, 'fr')).join(' ; ')}.`,
    );
  },

  // --- Commands (thrown: Gladys shows the message of a failed command) ----------
  commandTooSlow:
    'Indego: the cloud answered too slowly, the command was NOT sent (Gladys waits 5 s at most). Try again.',
  commandStateUnknown: (reason) =>
    `Indego: the state of the mower could not be read (${reason}), the command was NOT sent.`,
  commandOffline: 'Indego: the mower is offline, the command was NOT sent.',
  commandRateLimited: (ms) =>
    `Indego: too many requests, the command was NOT sent; the cloud asked to wait ${minutes(ms)} min.`,
  commandSession: 'Indego: the Bosch session is not usable right now, the command was NOT sent.',
  unknownMower: (value) => `Unknown Indego mower: ${String(value).slice(0, 80)}`,
};

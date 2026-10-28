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
  // Plain strings: the Gladys core refuses a publication whose option label is not one.
  runOptions: {
    pause: 'Pause',
    mow: 'Mow',
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
      `Open this address in a new browser tab on a computer. Before typing your e-mail, open the developer tools (F12, or Cmd+Option+I on a Mac), Console tab, and tick "Preserve log". Sign in: the browser then fails to open "com.bosch.indegoconnect://login?…". Right-click that address in the console, choose "Copy link address", and paste it into "Finish the sign-in" within 15 minutes (the Network tab, request "authresp", header Location, works too). ${url}`,
      `Ouvrez cette adresse dans un nouvel onglet, sur un ordinateur. Avant de saisir votre e-mail, ouvrez les outils de développement (F12, ou Cmd+Option+I sur Mac), onglet Console, et cochez « Conserver le journal ». Connectez-vous : le navigateur n'arrive pas ensuite à ouvrir « com.bosch.indegoconnect://login?… ». Faites un clic droit sur cette adresse dans la console, choisissez « Copier l'adresse du lien », et collez-la dans « Terminer la connexion » dans les 15 minutes (l'onglet Réseau, requête « authresp », en-tête Location, marche aussi). ${url}`,
    ),
  noCode: both(
    'No sign-in code in the pasted text: paste the address starting with com.bosch.indegoconnect://login?, with its state and code.',
    "Aucun code de connexion dans le texte collé : collez l'adresse qui commence par com.bosch.indegoconnect://login?, avec son state et son code.",
  ),
  truncated: both(
    'This address was cut short by the console (it contains "…"): right-click the address in the console and choose "Copy link address", or copy the Location header of the "authresp" request in the Network tab.',
    "Cette adresse a été tronquée par la console (elle contient « … ») : faites un clic droit sur l'adresse dans la console et choisissez « Copier l'adresse du lien », ou copiez l'en-tête Location de la requête « authresp » dans l'onglet Réseau.",
  ),
  unknownSignIn: both(
    'This address does not belong to a sign-in started in the last 15 minutes: click "Start the sign-in" again and use the new address.',
    'Cette adresse ne correspond à aucune connexion démarrée dans les 15 dernières minutes : cliquez à nouveau sur « Démarrer la connexion » et utilisez la nouvelle adresse.',
  ),
  signInCancelled: both(
    'The sign-in was cancelled on the Bosch page: start again at step 1.',
    "La connexion a été annulée sur la page de Bosch : recommencez à l'étape 1.",
  ),
  signInFailed: (reason) =>
    both(
      `Bosch refused the sign-in (${reason}): the code serves once and expires within minutes, start again at step 1.`,
      `Bosch a refusé la connexion (${reason}) : le code ne sert qu'une fois et expire en quelques minutes, recommencez à l'étape 1.`,
    ),
  signInUnreachable: (reason) =>
    both(
      `Bosch could not be reached (${reason}): paste the same address again within a few minutes, or start again at step 1.`,
      `Bosch est injoignable (${reason}) : recollez la même adresse dans les minutes qui suivent, ou recommencez à l'étape 1.`,
    ),
  signedInStarting: both(
    'Signed in. The mowers are being read: they appear in the Discovery tab within a minute (see the connection status).',
    "Connecté. Les tondeuses sont en cours de lecture : elles apparaissent dans l'onglet Découverte d'ici une minute (voir l'état de la connexion).",
  ),
  starting: both(
    'Starting: the mowers are being read. Look at the connection status in a minute, then test again.',
    "Démarrage : les tondeuses sont en cours de lecture. Regardez l'état de la connexion d'ici une minute, puis testez à nouveau.",
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

  // --- Commands (thrown, in the configured language: Gladys shows the message) ---
  notSignedInCommand: both(
    'Indego: not signed in to Bosch, the command was NOT sent.',
    "Indego : pas de connexion à Bosch, la commande n'a PAS été envoyée.",
  ),
  refusedCommand: both(
    'Indego: the Bosch session expired, the command was NOT sent; sign in again.',
    "Indego : la session Bosch a expiré, la commande n'a PAS été envoyée ; reconnectez-vous.",
  ),
  commandTooSlow: both(
    'Indego: the cloud answered too slowly, the command was NOT sent (Gladys waits 5 s at most). Try again.',
    "Indego : le cloud a répondu trop lentement, la commande n'a PAS été envoyée (Gladys attend 5 s au plus). Réessayez.",
  ),
  commandStateUnknown: (reason) =>
    both(
      `Indego: the state of the mower could not be read (${reason}), the command was NOT sent.`,
      `Indego : l'état de la tondeuse n'a pas pu être lu (${reason}), la commande n'a PAS été envoyée.`,
    ),
  commandOffline: both(
    'Indego: the mower is offline, the command was NOT sent.',
    "Indego : la tondeuse est hors ligne, la commande n'a PAS été envoyée.",
  ),
  commandRateLimited: (ms) =>
    both(
      `Indego: too many requests, the command was NOT sent; the cloud asked to wait ${minutes(ms)} min.`,
      `Indego : trop de requêtes, la commande n'a PAS été envoyée ; le cloud demande d'attendre ${minutes(ms)} min.`,
    ),
  commandSession: both(
    'Indego: the Bosch session is not usable right now, the command was NOT sent.',
    "Indego : la session Bosch n'est pas utilisable pour l'instant, la commande n'a PAS été envoyée.",
  ),
  commandUnconfirmed: both(
    'Indego: command sent, but not confirmed in time; the state will be read again in 10 s.',
    "Indego : commande envoyée, sans confirmation dans les temps ; l'état sera relu dans 10 s.",
  ),
  commandFailed: (reason) =>
    both(
      `Indego: the command failed (${reason}); the state will be read again in 10 s.`,
      `Indego : la commande a échoué (${reason}) ; l'état sera relu dans 10 s.`,
    ),
  unknownMower: (value) =>
    both(
      `Unknown Indego mower: ${String(value).slice(0, 80)}`,
      `Tondeuse Indego inconnue : ${String(value).slice(0, 80)}`,
    ),
};

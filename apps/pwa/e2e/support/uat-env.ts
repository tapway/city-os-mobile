/**
 * Environment for the mobile UAT spec. Everything sensitive comes from the
 * environment only: nothing here is a default password and nothing is logged.
 *
 *   UAT_PW        shared demo password for the role accounts (required)
 *   UAT_ADMIN_PW  password of the `admin` account (optional, defaults to UAT_PW)
 *   UAT_HELP_URL  City Help origin (default https://devtesting-...:9445)
 *   UAT_KC_URL    Keycloak origin   (default https://devtesting-...:9446)
 *   E2E_BASE_URL  the PWA under test (default http://localhost:5173)
 */
const HOST = 'https://devtesting-system-product-name.taild39ddc.ts.net';

export const UAT_PW = process.env.UAT_PW ?? '';
export const UAT_ADMIN_PW = process.env.UAT_ADMIN_PW || UAT_PW;
export const HELP_URL = (process.env.UAT_HELP_URL ?? `${HOST}:9445`).replace(/\/$/, '');
export const KC_URL = (process.env.UAT_KC_URL ?? `${HOST}:9446`).replace(/\/$/, '');
export const KC_REALM = 'city-os';
/** The City Help web client allows the password grant; the mobile client is not used for API calls. */
export const KC_CLIENT = 'city-help-web';

/** KEJURUTERAAN's department id on the reference box (task brief). */
export const KEJURUTERAAN_DEPT_ID = 4;
/** Incident type routed to KEJURUTERAAN by an auto-assignment rule (seed_test_data.py). */
export const INCIDENT_TYPE_CODE = process.env.UAT_INCIDENT_TYPE ?? 'TRF1A';

/** JB city centre: inside the demo area, used for GPS and for the ticket itself. */
export const JB = { latitude: 1.4927, longitude: 103.7414 } as const;

export type Role = 'operator' | 'dispatcher' | 'engineer' | 'supervisor' | 'admin';

export function passwordFor(role: Role): string {
  return role === 'admin' ? UAT_ADMIN_PW : UAT_PW;
}

/** One tag per run so leftovers are findable: `UAT-<run>`. */
export const RUN = process.env.UAT_RUN ?? `${Date.now().toString(36)}`;
export const RUN_TAG = `UAT-${RUN}`;
export const MISSING_PW_MESSAGE =
  'UAT_PW is not set: the MOBILE- UAT spec needs the shared demo password in the environment.';

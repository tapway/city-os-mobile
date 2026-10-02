import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { en } from '../src/i18n/en';
import { ms } from '../src/i18n/ms';
import {
  LANG_KEY,
  initLang,
  setLang,
  getLang,
  t,
  translate,
  subscribe,
} from '../src/i18n';
import { statusLabel, stateLabel, eventLabel } from '../src/i18n/labels';
import { loginErrorKey } from '../src/lib/password-login';
import { translateMsg, msgOf, MsgError } from '../src/i18n';
import { actionLabel, anyStateLabel, sourceLabel, incidentTypeLabel, incidentGroupLabel } from '../src/i18n/labels';
import { formatDateTime, formatTime, localeFor } from '../src/i18n/format';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k]! : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}
const throwing = () => {
  throw new Error('SecurityError');
};
const throwingStorage = { getItem: throwing, setItem: throwing };

beforeEach(() => {
  initLang(() => fakeStorage());
});

describe('dictionaries', () => {
  it('en and ms have identical key sets', () => {
    expect(Object.keys(ms).sort()).toEqual(Object.keys(en).sort());
  });

  it('has no empty values in either language', () => {
    for (const [lang, dict] of [['en', en], ['ms', ms]] as const) {
      for (const [k, v] of Object.entries(dict)) {
        expect(v.trim(), `${lang}.${k}`).not.toBe('');
      }
    }
  });

  it('uses the same {placeholders} in both languages', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      expect(vars(ms[k]), k).toEqual(vars(en[k]));
    }
  });
});

describe('language persistence', () => {
  it('defaults to en when storage is empty', () => {
    expect(initLang(() => fakeStorage())).toBe('en');
    expect(getLang()).toBe('en');
  });

  it('uses the stored language', () => {
    expect(initLang(() => fakeStorage({ [LANG_KEY]: 'ms' }))).toBe('ms');
    expect(getLang()).toBe('ms');
  });

  it('ignores an unknown stored value', () => {
    expect(initLang(() => fakeStorage({ [LANG_KEY]: 'fr' }))).toBe('en');
  });

  it('falls back to en when storage throws on read', () => {
    expect(initLang(() => throwingStorage)).toBe('en');
    expect(initLang(throwing)).toBe('en'); // accessing localStorage itself throws
  });

  it('setLang writes cityos.lang and notifies subscribers', () => {
    const store = fakeStorage();
    let calls = 0;
    const off = subscribe(() => calls++);
    setLang('ms', () => store);
    off();
    expect(store.data['cityos.lang']).toBe('ms');
    expect(getLang()).toBe('ms');
    expect(calls).toBe(1);
  });

  it('setLang still switches when storage throws on write', () => {
    expect(() => setLang('ms', () => throwingStorage)).not.toThrow();
    expect(getLang()).toBe('ms');
  });
});

describe('t()', () => {
  it('translates using the current language', () => {
    setLang('en', () => fakeStorage());
    expect(t('login.submit')).toBe('Sign in');
    setLang('ms', () => fakeStorage());
    expect(t('login.submit')).toBe('Log masuk');
  });

  it('interpolates variables', () => {
    expect(translate('ms', 'tickets.count', { shown: 3, total: 10 })).toContain('3');
    expect(translate('ms', 'tickets.count', { shown: 3, total: 10 })).toContain('10');
  });

  it('returns the key for an unknown key rather than throwing', () => {
    expect(translate('ms', 'nope.nothing' as never)).toBe('nope.nothing');
  });
});

describe('status / state labels', () => {
  it('maps known status codes to BM', () => {
    expect(statusLabel('IN_PROGRESS', 'ms')).toBe('Sedang diproses');
    expect(statusLabel('RESOLVED', 'ms')).toBe('Diselesaikan');
    expect(statusLabel('CLOSED', 'ms')).toBe('Ditutup');
    expect(statusLabel('OPEN', 'en')).toBe('Open');
    expect(statusLabel('IN_PROGRESS', 'en')).toBe('In progress');
  });

  it('maps workflow states to BM', () => {
    expect(stateLabel('in_progress', 'ms')).toBe('Sedang diproses');
    expect(stateLabel('accepted', 'ms')).toBe('Diterima');
    expect(stateLabel('awaiting_evidence', 'ms')).toBe('Menunggu bukti');
  });

  it('falls back to the raw code when unknown', () => {
    expect(statusLabel('WEIRD_NEW', 'ms')).toBe('WEIRD_NEW');
    expect(stateLabel('some_new_state', 'ms')).toBe('some_new_state');
    expect(statusLabel('', 'ms')).toBe('');
  });

  it('does not resolve prototype keys', () => {
    expect(statusLabel('constructor', 'ms')).toBe('constructor');
    expect(stateLabel('toString', 'ms')).toBe('toString');
  });

  it('humanises unknown timeline events and translates known ones', () => {
    expect(eventLabel('some_new_event', 'ms')).toBe('Some New Event');
    expect(eventLabel('start', 'ms')).toBe('Mula Kerja');
    expect(eventLabel('workflow_start', 'ms')).toBe('Mula Kerja');
    expect(eventLabel('in_progress', 'ms')).toBe('Sedang diproses');
    expect(eventLabel('created', 'ms')).toBe('Dicipta');
    expect(eventLabel('assigned', 'ms')).toBe('Ditugaskan');
    expect(eventLabel('merged', 'ms')).toBe('Digabungkan');
    expect(eventLabel('external_callback', 'ms')).toBe('Maklum balas luaran');
    expect(eventLabel('workflow_unknown_thing', 'ms')).toBe('Workflow Unknown Thing');
  });

  it('anyStateLabel resolves either a status or a workflow state', () => {
    expect(anyStateLabel('IN_PROGRESS', 'ms')).toBe('Sedang diproses');
    expect(anyStateLabel('awaiting_evidence', 'ms')).toBe('Menunggu bukti');
    expect(anyStateLabel('???', 'ms')).toBe('???');
    expect(actionLabel('need_support', 'ms')).toBe('Perlu Sokongan');
    expect(actionLabel('zzz', 'ms')).toBe('zzz');
  });
});

describe('messages stored as key + vars', () => {
  it('re-translate when the language changes', () => {
    const m = msgOf('login.error.401');
    expect(translateMsg('ms', m)).toBe('Nama pengguna atau kata laluan tidak sah.');
    expect(translateMsg('en', m)).toMatch(/Incorrect username or password/);
  });

  it('carries variables', () => {
    expect(translateMsg('ms', msgOf('tickets.loadError', { message: 'x' }))).toContain('x');
  });

  it('MsgError keeps the key; foreign errors pass the server text through', () => {
    expect(msgOf(new MsgError('detail.err.needOnline'))).toEqual({ key: 'detail.err.needOnline' });
    expect(translateMsg('ms', msgOf(new Error('Boom from server')))).toBe('Boom from server');
  });

  it('login status mapping yields translatable keys', () => {
    for (const s of [401, 403, 422, 429, 503, 500, 418]) {
      expect(translateMsg('ms', msgOf(loginErrorKey(s)))).not.toBe(loginErrorKey(s));
    }
  });
});

// Values copied from City Help web: wt-mbjb-sf/frontend/src/i18n/ms/enums.json (status, state)
// and ms/actions.json (incident, governance.close, common). The two apps are demoed side by
// side, so shared codes must read identically. Update this fixture, not the code, if City Help changes.
describe('terminology matches City Help (ms)', () => {
  const STATUS = {
    OPEN: 'Terbuka', VERIFIED: 'Disahkan', ASSIGNED: 'Ditugaskan', IN_PROGRESS: 'Sedang diproses',
    RESOLVED: 'Diselesaikan', CLOSED: 'Ditutup',
  };
  const STATE = {
    intake: 'Penerimaan', confirmed: 'Disahkan', dispatch: 'Penugasan', accepted: 'Diterima',
    in_progress: 'Sedang diproses', waiting_for_support: 'Menunggu sokongan', done: 'Selesai',
    awaiting_evidence: 'Menunggu bukti', verified: 'Disemak', closed: 'Ditutup', voided: 'Dibatalkan',
    review: 'Dalam semakan', approved: 'Diluluskan', rejected: 'Ditolak', completed: 'Serahan Selesai',
  };
  const ACTION = {
    confirm: 'Sahkan (Tahap ke-2)', submit: 'Hantar untuk Penugasan', direct_reply: 'Balas Terus (Tutup Segera)',
    void: 'Batalkan', restore: 'Pulihkan', accept: 'Terima', assign: 'Terima', escalate: 'Eskalasi',
    start: 'Mula Kerja', need_support: 'Perlu Sokongan', resume: 'Sambung', complete: 'Selesai',
    upload_evidence: 'Muat Naik Bukti', verify: 'Sahkan', review_approve: 'Lulus & Tutup',
    review_reject: 'Tolak', approve: 'Lulus & Tutup', reject: 'Tolak',
    close: 'Tutup',
    classify: 'Klasifikasi', auto_dispatch: 'Hantar Automatik', assign_department: 'Tugaskan Jabatan',
    record_rating: 'Rekod Penilaian', extension_request: 'Mohon Lanjutan', lock_request: 'Mohon Kunci',
    unlock: 'Buka Kunci', approve_request: 'Luluskan Permohonan', reject_request: 'Tolak Permohonan',
    add_note: 'Tambah Nota', merge: 'Gabung',
  };
  it.each(Object.entries(STATUS))('status %s', (c, v) => expect(statusLabel(c, 'ms')).toBe(v));
  it.each(Object.entries(STATE))('state %s', (c, v) => expect(stateLabel(c, 'ms')).toBe(v));
  it.each(Object.entries(ACTION))('action %s', (c, v) => expect(actionLabel(c, 'ms')).toBe(v));
  it('mobile quick-action buttons use City Help action terms', () => {
    expect(ms['act.start']).toBe(ACTION.start);
    expect(ms['act.accept']).toBe(ACTION.accept);
    expect(ms['act.resume']).toBe(ACTION.resume);
    expect(ms['act.need_support']).toBe(ACTION.need_support);
    expect(ms['act.close']).toBe(ACTION.close);
  });
});

describe('no hard-coded English in screen sources', () => {
  const files = [
    'login.tsx',
    'password-login-form.tsx',
    'tickets.tsx',
    'ticket.$id.tsx',
    '__root.tsx',
    'attendance.tsx',
    'create-ticket.tsx',
  ];
  // Brand names that are intentionally not translated.
  const ALLOWED = new Set(['CITY HELP', 'City Guard', 'OK']);

  function hardcoded(src: string): string[] {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const found: string[] = [];
    // JSX text between tags: >Some words<  (no braces)
    for (const m of code.matchAll(/>([^<>{}=;\n]*[A-Za-z]{2,}[^<>{}=;\n]*)</g)) {
      found.push(m[1]!.trim());
    }
    // JSX text on its own line(s)
    for (const m of code.matchAll(/^\s*([A-Z][A-Za-z' ,.!?-]+[A-Za-z.!?])\s*$/gm)) {
      found.push(m[1]!.trim());
    }
    // User-visible attributes with a plain string
    for (const m of code.matchAll(/\b(?:aria-label|placeholder|title|alt)="([^"]*[A-Za-z]{2,}[^"]*)"/g)) {
      found.push(m[1]!);
    }
    return found.filter((s) => !ALLOWED.has(s));
  }

  it.each(files)('%s has no literal user-facing strings', (f) => {
    const src = readFileSync(resolve(__dirname, '../src/routes', f), 'utf8');
    expect(hardcoded(src)).toEqual([]);
  });
});

describe('source labels (City Help enums.source)', () => {
  it('maps source codes per language and falls back to the raw code', () => {
    expect(sourceLabel('PHONE', 'ms')).toBe('Telefon');
    expect(sourceLabel('PHONE', 'en')).toBe('Phone');
    expect(sourceLabel('WALK_IN', 'ms')).toBe('Hadir sendiri');
    expect(sourceLabel('CITIZEN_PORTAL', 'en')).toBe('Citizen portal');
    expect(sourceLabel('mobile', 'ms')).toBe('mobile');
    expect(sourceLabel('constructor', 'ms')).toBe('constructor');
  });
});

describe('incident type picker', () => {
  const type = { code: 'TRF01', name: 'Pokok Tumbang', name_en: 'Fallen Tree' };
  it('ms shows name, en shows name_en || name, both fall back to code', () => {
    expect(incidentTypeLabel(type, 'ms')).toBe('Pokok Tumbang');
    expect(incidentTypeLabel(type, 'en')).toBe('Fallen Tree');
    expect(incidentTypeLabel({ ...type, name_en: null }, 'en')).toBe('Pokok Tumbang');
    expect(incidentTypeLabel({ code: 'X1', name: '', name_en: null }, 'ms')).toBe('X1');
    expect(incidentTypeLabel({ code: 'X1', name: '', name_en: null }, 'en')).toBe('X1');
  });
  it('translates known group types and keeps unknown ones raw', () => {
    expect(incidentGroupLabel('TRF', 'ms')).toBe('Trafik');
    expect(incidentGroupLabel('CTY', 'ms')).toBe('Perkhidmatan bandar');
    expect(incidentGroupLabel('GOV', 'en')).toBe('Governance request');
    expect(incidentGroupLabel('ZZZ', 'ms')).toBe('ZZZ');
    expect(incidentGroupLabel(null, 'ms')).toBe('Lain-lain');
  });
});

describe('date/time follow the app language', () => {
  it('picks ms-MY / en-MY', () => {
    expect(localeFor('ms')).toBe('ms-MY');
    expect(localeFor('en')).toBe('en-MY');
  });
  it('formats with that locale and tolerates bad input', () => {
    const iso = '2026-10-05T09:30:00Z';
    expect(formatDateTime(iso, 'ms')).toBe(new Date(iso).toLocaleString('ms-MY', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }));
    expect(formatDateTime(iso, 'ms')).not.toBe(formatDateTime(iso, 'en'));
    expect(formatDateTime(null, 'ms')).toBe('');
    expect(formatDateTime('nope', 'en')).toBe('');
    expect(formatTime(iso, 'ms')).toBe(new Date(iso).toLocaleTimeString('ms-MY'));
  });
});

describe('City Help aligned labels', () => {
  it('uses Ulasan / Keutamaan / Status aliran kerja (and EN equivalents)', () => {
    expect(ms['detail.comment']).toBe('Ulasan');
    expect(ms['create.urgency']).toBe('Keutamaan');
    expect(ms['detail.stage']).toBe('Status aliran kerja: {value}');
    expect(en['detail.comment']).toBe('Comment');
    expect(en['create.urgency']).toBe('Priority');
    expect(en['detail.stage']).toBe('Workflow state: {value}');
  });
  it('wording fixes', () => {
    expect(ms['gps.hoursAgo']).toBe('{n} jam lalu');
    expect(ms['offline.syncing']).toBe('Menyegerakkan {pending} kemas kini dalam baris gilir…');
    expect(ms['detail.slaDue']).toBe('Tarikh akhir {when}');
    expect(ms['gps.timeout']).toBe('Gagal mendapatkan kedudukan GPS dalam masa yang ditetapkan — bergerak ke kawasan terbuka dan cuba lagi');
    expect(ms['action.note.start']).toBe('Mula bertugas di lokasi');
    expect(ms['detail.err.missingTicket']).toBe('Rujukan tiket tidak ditemui');
  });
});

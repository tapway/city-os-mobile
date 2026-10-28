// Read-only browser smoke test for a running City OS Mobile stack.
//
//   cd apps/pwa
//   SMOKE_BASE_URL=http://127.0.0.1:19447 SMOKE_USER=engineer \
//   SMOKE_PASSWORD_FILE=/path/to/file SMOKE_PASSWORD_LINE=2 \
//   SMOKE_SHOT=/tmp/smoke.png node ../../deploy/smoke-mobile.cjs
//
// Signs in, checks the ticket list renders, opens one ticket, checks the header
// is one line at 360x800 and the service worker registers, and takes a
// screenshot. It clicks NO action button and writes nothing. The password is
// read from the file (a line of the form "password: ...") and never printed.
const fs = require('fs');
const { chromium } = require(process.cwd() + '/node_modules/@playwright/test');

const base = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:19447').replace(/\/$/, '');
const user = process.env.SMOKE_USER || 'engineer';
const file = process.env.SMOKE_PASSWORD_FILE;
const line = Number(process.env.SMOKE_PASSWORD_LINE || 2);
const shot = process.env.SMOKE_SHOT || 'smoke-mobile.png';
if (!file) { console.error('SMOKE_PASSWORD_FILE is required'); process.exit(2); }
const password = fs.readFileSync(file, 'utf8').split('\n')[line - 1].replace(/^password:\s*/, '').trim();

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}/login`);
    await page.fill('#login-username', user);
    await page.fill('#login-password', password);
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL(/\/tickets/, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    check('signed in, on /tickets', true);

    const ticketLink = page.getByText(/CH-\d{4}-\d+/).first();
    await ticketLink.waitFor({ timeout: 30000 });
    const count = await page.getByText(/CH-\d{4}-\d+/).count();
    check('ticket list renders', count > 0, `${count} ticket references`);

    const sw = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 15000))]);
      return reg ? (reg.active ? 'active' : 'registered') : 'none';
    });
    check('service worker registers', sw === 'active' || sw === 'registered', sw);

    // The session is a Secure + HttpOnly refresh cookie set by the BFF through
    // the proxy. Check its flags (names and flags only, never values), then
    // reload: the app must restore the session via POST /auth/refresh.
    const cookies = await ctx.cookies();
    for (const name of ['refresh_token', 'session_user']) {
      const c = cookies.find((k) => k.name === name);
      check(`cookie ${name} is Secure + HttpOnly`, !!c && c.secure && c.httpOnly && c.path === '/',
        c ? `secure=${c.secure} httpOnly=${c.httpOnly} sameSite=${c.sameSite} path=${c.path}` : 'missing');
    }
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.getByText(/CH-\d{4}-\d+/).first().waitFor({ timeout: 30000 }).catch(() => {});
    check('reload restores the session (no redirect to /login)',
      /\/tickets/.test(page.url()) && (await page.getByText(/CH-\d{4}-\d+/).count()) > 0, new URL(page.url()).pathname);

    await page.getByText(/CH-\d{4}-\d+/).first().click();
    await page.waitForURL(/\/tickets\/.+/, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    check('ticket detail opens', true, new URL(page.url()).pathname.replace(/[0-9a-f-]{16,}/g, ':id'));

    const header = await page.evaluate(() => {
      const h = document.querySelector('header.topbar');
      if (!h) return null;
      const kids = [...h.children].map((c) => c.getBoundingClientRect());
      return {
        height: h.getBoundingClientRect().height,
        tops: [...new Set(kids.map((r) => Math.round(r.top)))].length,
        centres: kids.map((r) => Math.round(r.top + r.height / 2)),
        overflowX: document.documentElement.scrollWidth > innerWidth,
      };
    });
    const oneLine = !!header && Math.max(...header.centres) - Math.min(...header.centres) <= 4 && header.height < 64;
    check('header is one line at 360x800', oneLine, header ? `height=${Math.round(header.height)}px` : 'no header');
    check('no horizontal overflow', !!header && !header.overflowX);

    await page.screenshot({ path: shot });
    console.log(`screenshot: ${shot}`);
  } catch (e) {
    check('smoke run', false, String(e.message).split('\n')[0]);
    await page.screenshot({ path: shot.replace(/\.png$/, '-fail.png') }).catch(() => {});
  } finally {
    await browser.close();
  }
  process.exit(results.length && results.every(Boolean) ? 0 : 1);
})();

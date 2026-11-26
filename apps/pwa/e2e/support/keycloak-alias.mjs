/**
 * Local stand-in for a Keycloak hostname the browser cannot resolve.
 *
 * WHY THIS EXISTS
 * The `city-os` realm pins `attributes.frontendUrl` to `http://deploy-keycloak-1:8080`
 * — the *Docker container* name. Keycloak therefore renders absolute URLs into
 * the sign-in page, e.g.
 *
 *   <form action="http://deploy-keycloak-1:8080/realms/city-os/login-actions/authenticate?...">
 *
 * A browser (or a phone in the field) cannot resolve `deploy-keycloak-1`, so any
 * authorization-code login dies with a network error the moment the form is
 * submitted. The password-grant clients City Help and Terra use never hit this,
 * because they POST to the token endpoint through a proxy instead of following a
 * redirect. This is a platform configuration defect, reported separately.
 *
 * WHAT THIS DOES
 * Listens on 127.0.0.1:8080 and relays to the host-mapped Keycloak port (7080),
 * so that a browser which resolves `deploy-keycloak-1` to 127.0.0.1 (Playwright
 * does this via --host-resolver-rules in playwright.config.ts) can complete the
 * login. It is a *development* shim only: it changes nothing in the stack and is
 * not part of any deployment.
 *
 *   node e2e/support/keycloak-alias.mjs
 */
import net from 'node:net';

const LISTEN_PORT = Number(process.env.KEYCLOAK_ALIAS_PORT ?? 8080);
const TARGET_PORT = Number(process.env.KEYCLOAK_REAL_PORT ?? 7080);
const TARGET_HOST = process.env.KEYCLOAK_REAL_HOST ?? '127.0.0.1';

const server = net.createServer((client) => {
  const upstream = net.connect(TARGET_PORT, TARGET_HOST);
  client.pipe(upstream);
  upstream.pipe(client);
  const done = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on('error', done);
  upstream.on('error', done);
});

server.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log(
    `keycloak alias: 127.0.0.1:${LISTEN_PORT} -> ${TARGET_HOST}:${TARGET_PORT} ` +
      '(stop with Ctrl-C)',
  );
});
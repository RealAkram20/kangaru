/**
 * AGENTS.md requires Conventional Commits "enforced by commitlint". This is
 * that enforcement, run as a CI gate on pull requests rather than through a
 * husky hook — a local hook would need a root package.json this repo does
 * not otherwise have, and a hook is skippable with --no-verify while a CI
 * gate is not.
 *
 * CommonJS (.cjs) deliberately: with no root package.json there is no
 * "type": "module" to make a bare .js file resolve as ESM.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // The repo's scopes are its modules and the two apps. Left as a warning
    // rather than an error: a scope is useful, but a cross-cutting change
    // genuinely has none, and rejecting those would teach people to invent
    // one.
    'scope-enum': [
      1,
      'always',
      [
        'admin',
        'billing',
        'bookings',
        'clients',
        'dispatch',
        'drivers',
        'fleet',
        'notifications',
        'reports',
        'trips',
        'vehicles',
        'api',
        'ui',
        'ci',
        'deps',
      ],
    ],
  },
}

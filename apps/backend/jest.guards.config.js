/**
 * Fast guard suite.
 *
 * The default jest config (inline in package.json) sweeps all 179 backend
 * files through ts-jest, which type-checks every one of them in a worker.
 * That is the right thing for a full CI run and the wrong thing for the
 * regression guards in docs/plans/, which are hermetic unit tests over
 * buffers and strings.
 *
 * Two changes carry the speedup:
 *
 *  - `isolatedModules: true` transpiles instead of type-checking. Types are
 *    still enforced — by `pnpm typecheck`, one process for the whole project,
 *    which is far cheaper than N workers each rebuilding a program.
 *  - `roots` narrows collection to the guard directories, so no unrelated
 *    spec is compiled at all.
 *
 * Run with `pnpm test:guards`. Run the full suite with `pnpm test` when you
 * actually want the full suite.
 */
module.exports = {
  rootDir: "src",
  moduleFileExtensions: ["js", "json", "ts"],
  testEnvironment: "node",
  // testMatch rather than `roots`: a root that does not exist yet is a hard
  // jest error, and these directories get created across several tasks.
  testMatch: ["<rootDir>/cloud-backup/__tests__/**/*.spec.ts", "<rootDir>/common/__tests__/**/*.spec.ts"],
  transform: {
    "^.+\\.(t|j)s$": ["ts-jest", { isolatedModules: true }],
  },
  // Bound the blast radius on a school-spec laptop.
  maxWorkers: 2,
  // A hermetic guard that takes longer than this is doing I/O it should not.
  testTimeout: 30_000,
};

// Example 3 — a skill that talks to an external service, benchmarked against
// recorded mocks. No registry this time: without one every skill on disk is
// benchmarked on every layer and its category comes from its bench.yaml.
//
//   npx benchwright --check
//   npx benchwright --subject issue-comment --case comment-via-mcp --build-only --out /tmp/ws
//                   ↑ free: builds the workspace with the mock wired in, so you
//                     can see the MCP config the harness would read
//   npx benchwright --subject issue-comment --layer functional --runs 3
export default {
  title: 'examples — mock services',
  root: '.',
  defaults: { runs: 3, concurrency: 1 },
  categories: {
    mcp: { fixture: 'git repository + the recorded service the case names' },
  },
  subjects: ({ root, skillSubjects }) => skillSubjects({ dir: `${root}/skills` }),
};

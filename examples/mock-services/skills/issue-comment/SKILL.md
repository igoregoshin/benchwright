---
name: issue-comment
description: Post a summary of the current branch's commits as a comment on an issue in the team's issue tracker. Use when asked to comment on, update or report progress to an issue or ticket.
---

# issue-comment

1. Take the issue key from the request (for example `PRJ-7`).
2. Collect the commits on the current branch that are not on `main`: `git log main..HEAD --pretty=%s`.
3. Compose the comment: a first line `Progress on <branch>:`, then one `- ` bullet per commit.
4. Post it, depending on what is available:
   - if a `tracker` MCP server is configured, call `get_issue` with `{ issue }` to confirm the key exists,
     then `add_comment` with `{ issue, body }`;
   - otherwise run `node <this skill's directory>/scripts/comment.mjs <key>` with the comment on stdin.
     The script reads `TRACKER_BASE_URL` and `TRACKER_TOKEN` from `.env` in the working directory.
5. Report the comment id the tracker returned. Do not modify any file in the repository.

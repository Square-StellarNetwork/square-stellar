# Going public: what the history actually contains

**Status:** audited 2026-09-20 for [#62][i62]. Two findings need a decision that is not
mine to take; everything else is clean or fixed in the same change.

[i62]: https://github.com/Square-StellarNetwork/square-stellar/issues/62

The issue was written to be done *before* the repository was made public. It has already
been made public — `GET /repos/Square-StellarNetwork/square-stellar` answers
`"visibility": "public"` — so this is an audit of what is already readable by anyone,
not a pre-flight check. That changes what the findings mean, and the first section says
how.

## Scope

66 commits are reachable from `origin`'s refs, and those are what a clone gets. The three
further commits a local `--all` reports are this working copy's stashes, which are never
pushed. Every scan below ran over those 66.

## Secrets: clean

```console
$ gitleaks detect --source . --no-banner --redact --log-opts="--remotes=origin"
66 commits scanned.
no leaks found
```

Nothing in any commit's patch matches gitleaks' rules or the repository's own
`.gitleaks.toml`. The two repository secrets that exist, `SMOKE_AGENT_1_SECRET` and
`SMOKE_AGENT_2_SECRET`, are held by GitHub and never appear in the tree; the agent keys
they carry were generated for the 8004 smoke registrations and exist nowhere else in the
repository.

## File contents: clean

Across every commit reachable from `origin`, no tracked file contains a personal e-mail
address, a personal username, or a reference to the organisation the project was
previously associated with. The scan covered historical revisions of files as well as
the current tree, so a name deleted in a later commit would still have been found.

## Commit metadata: not clean, and already public

This is the finding.

| | |
|---|---|
| Distinct author identities | 3 |
| Distinct committer identities | 6 |
| Of those, personal e-mail addresses at consumer providers | 4 |
| Of those, personal GitHub usernames | 5 |
| Commits authored under the project identity `Square contributors` | 33 of 66 |

Only one of the six identities is the anonymised one the project's own rules require.
The others are individual accounts: three GitHub usernames attached to real mailboxes,
one `users.noreply.github.com` address that still carries a personal username, and two
display names that are not `Square contributors`.

The addresses are not reproduced here. Writing them into a committed file would publish
them a second time, in a document whose purpose is to get them unpublished; they are
visible with `git log --format='%an <%ae> / %cn <%ce>'` to anyone who needs to act on
this, which is the point — they are already visible to anyone at all.

**What this means now that the repository is public.** A commit's author and committer
e-mail travel in the object itself. They are served by the API, shown in the patch view,
and copied into every clone and every fork. Making the repository private again would
not retract the copies that already exist, and rewriting the history does not remove the
old objects from GitHub's own storage until the references to them are garbage
collected, which is not on a schedule anyone controls from outside.

So the honest framing is: this can be fixed going forward, and the old objects should be
expected to survive somewhere. That is a reason to do it, not a reason to skip it.

## Commit messages: 29 of 66 carry a co-author trailer

29 commits end with a `Co-Authored-By:` trailer naming an assistant. The project's rule
is that they are not added. They are on `main` as well as on the open branches.

This is the same class of problem as the identities — metadata in objects that are
already published — and the same fix addresses both, which is why they are one decision
rather than two.

## What the fix costs

Both findings live in commit objects, so the only fix is to rewrite the history: every
commit hash changes, `main` and every branch have to be force-pushed, and every open pull
request is invalidated. Four are open today.

The issue says this is a team decision, and it is. The order that costs least:

1. Merge or close the open pull requests, so nothing is in flight.
2. Rewrite, with a mailmap that maps every identity to
   `Square contributors <261450396+Antigoporia@users.noreply.github.com>` and a message
   callback that drops the `Co-Authored-By:` trailers.
3. Force-push every ref, then re-run this audit.
4. Turn on branch protection from `docs/ci/branch-protection.json`, which is available on
   a public repository, so the rewritten history cannot be force-pushed over casually.

The rewrite itself, for whoever runs it — `git-filter-repo`, with the mapping supplied
locally and never committed:

```bash
# mailmap.local is written by hand, one line per identity, and not committed:
#   Square contributors <261450396+Antigoporia@users.noreply.github.com> <old@address>
git filter-repo --mailmap mailmap.local \
  --message-callback 'return b"\n".join(l for l in message.split(b"\n")
                                        if not l.lower().startswith(b"co-authored-by:"))'
```

`git filter-repo` refuses to run on a repository with a remote unless `--force` is given,
which is deliberate: it wants a fresh clone. Rewriting in a working copy that has other
branches checked out is how a branch gets left behind on the old history.

## Licence and attribution: one error, fixed here

`LICENSE` is Apache-2.0, complete and unmodified. `NOTICE` named the wrong marks: it said
the third-party assets under `app/public/brand/` and `site/public/brand/` were Arc's,
used under Circle's partner guidelines. No Arc mark is in the tree — both directories
carry the Stellar logo and symbol from the Stellar Development Foundation's own
`@stellar/design-system` (Apache-2.0) and the USDC icon from `cryptocurrency-icons`
(CC0 1.0). For a repository distributed under Apache-2.0, whose section 4(d) is about
carrying the right attributions, a `NOTICE` that credits an organisation whose asset is
not present is a defect on its face.

Both are now listed in `NOTICE` with their licences, their upstreams, the files they
cover, and the one modification made to the Stellar marks: the fill is set to the
project's carbon or to white so the files render as `<img>` outside the design system's
CSS. The trademark line is kept — Stellar is the SDF's mark, and Square is neither
affiliated with nor endorsed by it.

## Continuous integration on a public repository: no exposure

- No workflow uses `pull_request_target`, which is the trigger that runs a fork's
  proposed code with access to the base repository's secrets. Its absence is what makes
  the next point safe.
- The only secret any workflow references is `GITHUB_TOKEN`, which GitHub issues per run.
- The two repository secrets are not exposed to workflows triggered by a fork's pull
  request, which is GitHub's default and is not overridden anywhere here.
- `docs/ci/branch-protection.json` lists the required checks. Branch protection is
  available on a public repository regardless of plan, so it can now be applied; it is
  not applied by this change, because doing so would block the very pull requests that
  are in flight.

## Re-running the audit

```console
$ gitleaks detect --source . --no-banner --redact --log-opts="--remotes=origin"
$ git log --remotes=origin --format='%an <%ae>' | sort | uniq -c | sort -rn
$ git log --remotes=origin --format='%cn <%ce>' | sort | uniq -c | sort -rn
$ git log --remotes=origin --format='%B' | grep -ic 'co-authored-by'
```

The first must report no leaks. The second and third must report one identity. The fourth
must report zero.

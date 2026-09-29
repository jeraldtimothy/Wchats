# CLAUDE.md

The working agreement for LLM agents in this repository.

## Workflow

```
study => plan => execute plan => rendezvous => sync docs
```

The principles behind it:

1. **Think in writing before building.** Feasibility and tradeoffs go in a study; the steps go in a plan.
2. **Build on a branch against a checklist.** `main` only receives finished work.
3. **Merge only when `main` is healthy.** Checks pass before and after the merge.
4. **Keep the wiki true.** `doc/wiki/` always describes the code as it is now.
5. **Commit in conventional, single-purpose commits.**

The full sequence is the long path. Most work takes a shorter one, and the agent carries it forward without being prompted step by step.

### Pick a lane

Size the request before starting, and state the lane in one line (e.g. "Standard lane: plan, then execute on `feat/0003-login`").

| Lane         | Use when                                                                                           | Steps                                                  |
| ------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Quick**    | Typo, copy change, config tweak, small fix in one place. No design decision, trivial to revert.     | Commit on `main` → run health check → update wiki if affected |
| **Standard** | A feature or fix with one obvious approach.                                                        | Plan → execute → rendezvous                            |
| **Full**     | Several viable approaches, a new dependency or architecture, data migrations, anything hard to reverse, or unclear feasibility. | Study → plan → execute → rendezvous                    |

If the owner names a step ("study X", "just plan it"), do that step and stop. If a lane turns out too small partway through, say so and move up a lane. Don't quietly keep going.

### Keep moving, stop at gates

Once a lane is chosen, run it through to the end without waiting for "now do the next step." Stop and ask only at these gates:

- **Decision gate:** the study has a tradeoff the owner has to decide (cost, scope, product direction). Present the recommendation and wait. If the recommendation is clear-cut, write the plan in the same turn and continue.
- **Deviation gate:** a runtime, dependency, or version differs from what the owner specified, or the plan turns out wrong in a way that changes scope. State the difference and why, then wait.
- **Outward-facing gate:** anything irreversible or public beyond a normal push to this repo, such as force-pushing, deleting remote branches, publishing releases, or touching production.

Otherwise, keep going and report at the end.

### Doc folders

| Folder       | Holds                                                          | Lifetime                         |
| ------------ | -------------------------------------------------------------- | -------------------------------- |
| `doc/study/` | Studies: feasibility and tradeoffs of a request.               | Historical, never updated later. |
| `doc/plan/`  | Plans: checklists of concrete steps.                           | Historical once merged.          |
| `doc/wiki/`  | The living manual of the codebase, indexed by `doc/wiki/README.md`. | Always current.                  |

Number study and plan docs with a shared four-digit prefix so a pair lines up: `doc/study/0003-login.md` ↔ `doc/plan/0003-login.md`. A plan without a study still takes the next free number.

### 1. Study

Write `doc/study/NNNN-slug.md`. Aim for about a page, not an essay:

```markdown
# NNNN — Title

**Ask:** the request in one or two sentences, plus any ambiguity.
**Feasibility:** can it be done with the current codebase? What's in the way?

## Options
| Option | Pros | Cons | Cost |
| ------ | ---- | ---- | ---- |

## Recommendation
Which option, and why.

## Open questions
Only the ones that block the plan.
```

If the request is too vague to study usefully, ask a focused question instead of writing a vague study.

### 2. Plan

Write `doc/plan/NNNN-slug.md` as a checklist that can be executed without further design decisions:

```markdown
# NNNN — Title

Study: [doc/study/NNNN-slug.md](../study/NNNN-slug.md) (if any)
Branch: `feat/NNNN-slug`

## feat(scope): first commit message
- [ ] concrete step
- [ ] test for it

## feat(scope): second commit message
- [ ] ...

## Wiki
- [ ] pages to add or update

## Done when
- [ ] health check passes on `main`
```

- Group steps under the conventional commit they will land in.
- **Order commits so each one leaves the build green.** Nothing may reference code that a later commit adds.
- **Study and plan docs land on `main` as a `docs:` commit before the branch is cut.** They describe the work; they aren't part of it.

### 3. Execute plan

- Branch off `main` using the plan's branch name (`<type>/NNNN-slug`).
- Work through the checklist, committing as you go.
- **Ticks travel with the commit they evidence.** Check the box in the same commit as the work, not in a separate `docs:` commit.
- If the plan is wrong, fix the plan doc in the next commit with a one-line note on why. Don't silently diverge. If the fix changes scope, that's the deviation gate.

### 4. Rendezvous (sync docs included)

Sync docs happens as part of rendezvous, so the wiki merges with the code it describes:

1. On the branch, update `doc/wiki/` for everything the branch changed (`docs(wiki): ...`), and tick the plan's Wiki and Done-when boxes.
2. Run the health check on the branch.
3. `git checkout main && git merge --no-ff <branch>`. Resolve conflicts.
4. Run the health check again on `main`. If it fails, fix it on `main` with a `fix:` commit before doing anything else.
5. Push `main`, then delete the branch locally and on the remote.

End state: `main` builds, checks pass, the wiki matches the code, and nothing is half-done.

### Sync docs (standalone)

When asked to **sync docs** outside a rendezvous, audit `doc/wiki/` against the current code. Update pages that changed, add pages for new modules, delete or correct anything stale, and keep `doc/wiki/README.md` as the index. Commit as `docs(wiki): ...`.

## Health check

The commands that define "the codebase is workable." Rendezvous and Quick-lane commits must pass all of them.

```sh
pnpm check   # = pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

`pnpm test` runs the web unit tests and the API integration tests against `TEST_DATABASE_URL` (created and migrated automatically), so PostgreSQL must be running. See [doc/wiki/getting-started.md](doc/wiki/getting-started.md).

## Commits

Every commit follows [Conventional Commits](https://www.conventionalcommits.org/): `type(optional-scope): imperative summary`.

| Type        | Use for                                                  |
| ----------- | -------------------------------------------------------- |
| `feat:`     | A new feature                                            |
| `fix:`      | A bug fix                                                |
| `docs:`     | Documentation only, including everything under `doc/`    |
| `refactor:` | Code change that neither fixes a bug nor adds a feature  |
| `test:`     | Adding or correcting tests                               |
| `perf:`     | Performance improvement                                  |
| `style:`    | Formatting only, with no change in meaning               |
| `build:`    | Build system or dependency changes                       |
| `ci:`       | CI configuration                                         |
| `chore:`    | Maintenance that touches neither source nor tests        |

- One logical change per commit. Never mix a `feat:` with an unrelated `fix:`.
- Mark breaking changes with `!` (e.g. `feat(api)!: drop v1 endpoints`) and explain them in the body.
- A commit's tests ship in the same commit as the code they cover, unless the commit is a `test:` commit.

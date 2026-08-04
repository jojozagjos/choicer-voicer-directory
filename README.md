# The pack directory

The repository behind the Mods tab in the Choicer Voicer Content Manager.

No server, no database, no hosting bill. The index is a JSON file in Git, served
by raw.githubusercontent.com, and GitHub Actions is the whole backend. Pack files
are never stored here — each one lives on its own author's GitHub account, and
this repository only holds the addresses.

## It depends on the app repository

The validator is **not kept here**. All three workflows fetch `directory.js` and
`linkhealth.js` from the app repository when they run, so the directory refuses
exactly what the app refuses.

That is deliberate. A copy of those rules living in both places drifts the moment
one is edited, and nobody notices until something invalid gets listed or
something valid is turned away — which already happened once while this was being
built.

The cost is a real dependency: **the workflows do not work until the app
repository has those files on `main`.** The fetch fails loudly rather than
carrying on with a stale copy, so the failure shows up as a red run instead of as
quietly wrong decisions.

## Setting it up

1. Push this to a **public** repository named `choicer-voicer-directory`.
2. Make sure the app repository has `src/main/directory.js` and
   `src/main/linkhealth.js` on `main`, or every workflow here fails at the fetch.
3. In the app, `DIRECTORY_REPO` in `src/main/main.js` points here, and the index
   is read from:

   ```
   https://raw.githubusercontent.com/<you>/choicer-voicer-directory/main/index.json
   ```

Until this exists the app says "No packs yet" and sharing by file still works.

## How a pack gets in

The app opens an **issue** here with the record in a fenced JSON block. The
`submission` workflow reads it, validates it with the same code the app uses,
and either adds it to `index.json` or explains on the issue what was wrong.

An issue rather than a pull request because the app would otherwise have to fork
this repository, keep the fork in step and branch inside it — three things to go
wrong before anybody has read the submission.

## What the validator will not accept

Worth knowing, because these are the refusals people will ask about:

- **A pack credited to someone who does not host it.** The `author` has to match
  the account in `downloadUrl`. Only that person can put a file at that address,
  so this is the check that makes impersonation hard.
- **Anywhere that does not serve the file directly.** Drive, MEGA, MediaFire and
  itch answer with a page rather than the file, so the app cannot download from
  them.
- **A missing or malformed checksum.** The app refuses a download that does not
  match, which is the only thing standing between the reviewed record and the
  file that actually arrives.

## Removing something

Delete its entry from `index.json`. The pack file is not yours and stays where
its author put it — which is the point: a complaint about a pack is a delisting
here, not a takedown you have to action.

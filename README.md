# The pack directory

Everything in this folder belongs in a **separate public repository**, not in the
app's repo. Copy it there and the directory is running.

It has no server, no database and no hosting bill. The index is a JSON file in
Git, served by raw.githubusercontent.com. Pack files are never stored here —
each one lives on its own author's GitHub account, and this repository only
holds the addresses.

## Setting it up

1. Make a new **public** repository. `choicer-voicer-directory` is the obvious
   name.
2. Copy the contents of this folder into it and push.
3. Take the raw address of `index.json`:

   ```
   https://raw.githubusercontent.com/<you>/choicer-voicer-directory/main/index.json
   ```

4. Put that in the app as `modsIndexUrl`, and set `DIRECTORY_REPO` in
   `src/main/main.js` to `<you>/choicer-voicer-directory`.

Until step 4 the app says "No directory yet" and sharing by file still works.

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

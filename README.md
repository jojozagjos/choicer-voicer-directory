# The Choicer Voicer pack directory

This is the list of packs behind the **Mods** tab in the
[Choicer Voicer Content Manager](https://github.com/jojozagjos/Choicer-Voicer-Content-Manager).

Packs are not stored here. Each one lives on its author's own GitHub account,
and this repository only keeps a short record of where to find it — the title,
who made it, what kind of pack it is, the address, and a checksum of what should
arrive. Installing a pack downloads it from the author, checks it against that
checksum, and refuses it if the two disagree.

## Getting a pack listed

Publish it from the app. Open a pack in **Content**, press **Share this pack**,
then **Publish it**.

The app uploads the pack to your own GitHub account, works out the address, and
opens a submission here for you. There is nothing to fill in by hand and no
files to attach.

Your first pack is looked at by a person before it appears. After that, packs
from the same account are listed without waiting.

## Where a pack has to be hosted

Somewhere that hands a file straight to a program: a **GitHub, GitLab or
Codeberg release**, or **Dropbox**. Publishing from the app uses a GitHub
release automatically, so this only matters if a record is written by hand.

Google Drive, MEGA, MediaFire and itch.io cannot be used. They answer with a web
page rather than the file, so a download from them fails — and it fails at the
moment somebody presses install, which is the worst place to find out.

## What gets a pack turned away

- **A pack credited to somebody who does not host it.** The author has to match
  the account the download comes from. Only that person can put a file at that
  address, which is what stops anyone publishing under someone else's name.
- **A file that does not match its checksum**, which means it changed after it
  was submitted.
- **Anything the game cannot read**, or an archive built to escape the folder it
  unpacks into.
- **Sexual content or nudity.** There is no way to label a pack as containing it
  because it is not listed here at all.

Packs can be marked as containing strong language, graphic violence, drug or
alcohol references, or flashing images. Marking one does not stop it being
listed — it puts a note on the listing so nobody installs something they were
not expecting.

## Something wrong with a listed pack?

Open an issue. Say which pack and what the problem is. Packs can be taken down,
and accounts that abuse this can be blocked from publishing.

A pack whose download stops working is unlisted on its own: the directory checks
every link daily, and three failures on three separate days takes it off the
list. If the link starts working again it comes back without anyone asking.

## Reading the list yourself

`index.json` is public and needs no account:

```
https://raw.githubusercontent.com/jojozagjos/choicer-voicer-directory/main/index.json
```

Everything in it has been through the same checks the app applies before
installing anything.

---

Unofficial. Not made by or affiliated with Yeah Maybe, who make The Choicer
Voicer.

'use strict';

/**
 * Turns a submission issue into an entry in index.json.
 *
 *   node scripts/add-submission.js <issue-body-file> <issue-author>
 *
 * Run by the submission workflow. Prints a message for the issue on failure and
 * exits non-zero, so whoever submitted gets told what was wrong rather than
 * watching the workflow go red for no stated reason.
 *
 * The validator is the app's own `directory.js`, copied in rather than
 * reimplemented. Two validators that are supposed to agree eventually will not,
 * and the one that drifts is always the one nobody is testing.
 */

const fs = require('fs');
const path = require('path');

const { validateRecord, validateIndex, ownerOfDownload } = require('./directory');

const [bodyFile, issueAuthor] = process.argv.slice(2);

if (!bodyFile || !issueAuthor) {
  console.error('Usage: node scripts/add-submission.js <issue-body-file> <issue-author>');
  process.exit(2);
}

/** Fails with a message meant to be posted back on the issue. */
function refuse(message) {
  console.error(message);
  fs.writeFileSync('submission-error.txt', message);
  process.exit(1);
}

const body = fs.readFileSync(bodyFile, 'utf8');

// The app writes the record in a fenced json block. Anything else in the issue
// is prose for people to read.
const fenced = body.match(/```json\s*([\s\S]*?)```/);
if (!fenced) {
  refuse('I could not find a record in this issue. It needs a ```json block containing one, '
    + 'which the app writes for you when you press Publish.');
}

let parsed;
try {
  parsed = JSON.parse(fenced[1]);
} catch (err) {
  refuse(`The record in this issue is not valid JSON: ${err.message}`);
}

const checked = validateRecord(parsed);
if (!checked.ok) {
  refuse('This record cannot be listed:\n\n'
    + checked.problems.map((p) => `- **${p.field}** — ${p.message}`).join('\n'));
}

const record = checked.record;

// The person who opened the issue has to be the person the pack is by. Without
// this anyone could submit somebody else's pack under their own name, or worse,
// submit a pack crediting someone who never made it.
if (record.author.toLowerCase() !== String(issueAuthor).toLowerCase()) {
  refuse(`This issue was opened by @${issueAuthor}, but the record says the pack is by `
    + `**${record.author}**. A pack has to be submitted by the person it is credited to.`);
}

const moderationPath = path.join(__dirname, '..', 'moderation.json');
const moderation = fs.existsSync(moderationPath)
  ? JSON.parse(fs.readFileSync(moderationPath, 'utf8'))
  : { banned: [], trusted: [], hidden: [] };
const listed = (key) => (Array.isArray(moderation[key]) ? moderation[key] : [])
  .map((v) => String(v).toLowerCase());

const author = record.author.toLowerCase();

if (listed('banned').includes(author)) {
  // Said plainly and without argument. Anyone who thinks it is a mistake can
  // say so on the issue, which a moderator will see.
  refuse('This account cannot publish to the directory.');
}

const indexPath = path.join(__dirname, '..', 'index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

const existing = index.packs.findIndex((p) => p.id === record.id);
if (existing !== -1) {
  // Updating a pack is normal. Replacing somebody else's is not.
  if (index.packs[existing].author.toLowerCase() !== record.author.toLowerCase()) {
    refuse(`There is already a pack called **${record.id}**, by someone else. `
      + 'Give yours a different name.');
  }
  // Published stays as it was; this is the same pack, later.
  record.published = index.packs[existing].published;
  record.downloads = index.packs[existing].downloads || 0;
  index.packs[existing] = record;
} else {
  index.packs.push(record);
}

// One entry per pack, whatever happened on the way here.
//
// Replacing by id above is not enough on its own. Two submissions for the same
// pack each branch from main before either is merged, so neither sees the
// other's entry, and merging both leaves the pack listed twice. This is the
// backstop: after every change, the newest record for an id wins and the rest
// are dropped.
const newest = new Map();
for (const pack of index.packs) {
  const seen = newest.get(pack.id);
  const when = (p) => Date.parse(p.updated || p.published) || 0;
  if (!seen || when(pack) >= when(seen)) newest.set(pack.id, pack);
}
const duplicates = index.packs.length - newest.size;
if (duplicates > 0) console.log(`Dropped ${duplicates} duplicate listing(s)`);

index.packs = [...newest.values()].sort((a, b) => a.id.localeCompare(b.id));
index.updated = new Date().toISOString();

// Checked as a whole before writing. A single bad record must not be able to
// take the entire directory offline for everyone.
const whole = validateIndex(index);
if (!whole.ok) {
  refuse(`Adding this would break the directory: ${whole.error}`);
}
if (whole.rejected.length) {
  refuse(`Adding this would drop ${whole.rejected.length} existing record(s), so it was not done.`);
}

fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);

// Whether this can go live without waiting for a person.
//
// The rule is one human look per publisher, not per pack. Reviewing every
// update sounds safer but makes the maintainer the bottleneck, and a queue
// nobody can get to is how a directory quietly dies. A first pack is always
// read; after that the account is trusted, and `/hide` and `/ban` make a wrong
// call cheap to undo.
const trusted = listed('trusted').includes(author);
const knownAlready = index.packs.some((p) => p.author.toLowerCase() === author && p.id !== record.id)
  || existing !== -1;

// Whether the address itself proves who published it.
//
// A release on github.com/<author>/… can only have been put there by that
// account, so the claim checks itself. A Dropbox link, or a bare
// githubusercontent address, names nobody — the file may be perfectly fine, but
// nothing about the address says who put it there.
//
// Those are not refused, because hosting elsewhere is allowed. They are held
// for review every time instead of ever listing automatically, so the weaker
// evidence buys less trust rather than the same trust.
const owner = ownerOfDownload(record.downloadUrl);
const attributable = owner !== null;

const auto = attributable && (trusted || knownAlready);

fs.writeFileSync('submission-auto.txt', auto ? 'yes' : 'no');

console.log(`${existing === -1 ? 'Added' : 'Updated'} ${record.id} by ${record.author}`
  + (auto ? ' (auto)' : ` (needs review${attributable ? '' : ', unattributable address'})`));

const why = auto
  ? 'It will appear in the app shortly.'
  : attributable
    ? 'This is the first pack from this account, so it will be looked over before it '
      + 'appears. Nothing else is needed from you.'
    : 'It will be looked over before it appears. The download address does not say who '
      + 'published it — a release on your own GitHub account does, which is why those are '
      + 'listed without waiting. Nothing else is needed from you.';

fs.writeFileSync('submission-ok.txt',
  `**${record.title}** is ${existing === -1 ? 'ready to list' : 'updated'}.\n\n${why}`);

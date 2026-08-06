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

const {
  validateRecord, validateIndex, roomForAnother,
} = require('./directory');

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

// How many listings one account may hold. The files are on the publisher's own
// GitHub and cost this repository nothing; the directory is one JSON file that
// every copy of the app downloads, and one account filling it makes it slow for
// everyone and buries every other author.
const room = roomForAnother(index.packs, record.author, record.id);
if (!room.ok) {
  refuse(`You already have **${room.held}** packs listed, which is the most one account can `
    + `hold (${room.limit}).\n\nUpdating a pack you have already published does not count `
    + 'towards this, so improving one of those is always fine. To list something new, take one '
    + 'of the existing ones down first by opening an issue here.');
}

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
  // A pack that was taken down stays down. A submitted record always claims to
  // be listed, so without this, publishing over a hidden pack would put it back
  // and be the easiest way there is to undo a moderator's decision unnoticed.
  record.listed = index.packs[existing].listed !== false
    && !listed('hidden').includes(record.id.toLowerCase());
  index.packs[existing] = record;
} else {
  index.packs.push(record);
}

// One entry per pack, whatever happened on the way here.
//
// Replacing by id above is not enough on its own. It only catches a duplicate
// that is already in the file being read; two runs that start before either has
// written can each see an index without the other's entry. This is the
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

// Written out so the malware check does not have to dig the record back out of
// the index to find what it is checking.
fs.writeFileSync('submission-sha.txt', record.sha256 || '');

console.log(`${existing === -1 ? 'Added' : 'Updated'} ${record.id} by ${record.author}`);

// Everything that passes the checks is listed, straight away.
//
// There is no queue and nobody approves uploads. Every rule that decides
// whether a pack belongs here is written down and enforced above: the record
// has to validate, the author has to be the account hosting the file, the file
// has to pass the malware check, and the account must not be banned. A pack
// that clears all of that is listed, and one that does not is refused with the
// reason. Nothing is left resting on somebody's judgement of the content.
//
// This is deliberate rather than a shortcut. Reading and passing judgement on
// what other people upload is a different undertaking from running a list of
// links, and it is not one this project is set up to take on. What happens
// instead is after the fact: anybody can report a pack, and `/hide` and `/ban`
// deal with it. That is a smaller promise, and one that can actually be kept.
fs.writeFileSync('submission-ok.txt',
  `**${record.title}** is ${existing === -1 ? 'listed' : 'updated'}.\n\n`
  + 'It will appear in the app shortly. Nothing else is needed from you.');

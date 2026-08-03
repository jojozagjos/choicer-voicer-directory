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

const { validateRecord, validateIndex } = require('./directory');

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

index.packs.sort((a, b) => a.id.localeCompare(b.id));
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

console.log(`${existing === -1 ? 'Added' : 'Updated'} ${record.id} by ${record.author}`);
fs.writeFileSync('submission-ok.txt',
  `**${record.title}** is ${existing === -1 ? 'now listed' : 'updated'}. `
  + 'It will show up in the app\'s Mods tab shortly.');

'use strict';

/**
 * Applies a moderation command from an issue comment.
 *
 *   node scripts/moderate.js <comment-body-file> <commenter> <permission>
 *
 * Run by the moderation workflow, which has already asked GitHub what the
 * commenter's permission on this repository is. That answer is passed in and
 * checked again here, because a script that does what it is told is one
 * workflow edit away from doing what anybody tells it.
 *
 * Commands:
 *   /hide <pack-id>      stop listing a pack, keep the record
 *   /restore <pack-id>   list it again
 *   /ban <handle>        refuse anything further from that account
 *   /unban <handle>
 *   /trust <handle>      their submissions merge without review
 *   /untrust <handle>
 *
 * Everything is reversible on purpose. The cost of a wrong call should be one
 * more comment, not a decision somebody has to live with.
 */

const fs = require('fs');
const path = require('path');

const [bodyFile, commenter, permission] = process.argv.slice(2);

// Read from a file rather than taken as an argument. A comment is arbitrary
// text written by a stranger: it can be long, span lines, and contain quotes
// and backticks. Handing that to a shell is a class of problem worth not
// having, and a leading slash is mangled outright by some shells.
const body = bodyFile && fs.existsSync(bodyFile) ? fs.readFileSync(bodyFile, 'utf8') : '';

/** Only these can moderate. GitHub decides who they are, not this file. */
const ALLOWED_PERMISSIONS = new Set(['admin', 'write', 'maintain']);

const MODERATION = path.join(__dirname, '..', 'moderation.json');
const INDEX = path.join(__dirname, '..', 'index.json');

function say(message) {
  fs.appendFileSync('moderation-reply.txt', `${message}\n`);
  console.log(message);
}

function stop(message) {
  say(message);
  process.exit(1);
}

if (!body) {
  // No command in the comment is the overwhelmingly common case — most comments
  // on an issue are people talking. Nothing to say and nothing to do.
  process.exit(0);
}

const commands = [...String(body).matchAll(/^\s*\/(hide|restore|ban|unban|trust|untrust)\s+(\S+)\s*$/gim)]
  .map((m) => ({ verb: m[1].toLowerCase(), target: m[2].trim() }));

if (!commands.length) process.exit(0);

if (!ALLOWED_PERMISSIONS.has(String(permission))) {
  stop(`@${commenter} is not a moderator of this repository, so that was ignored.`);
}

const moderation = JSON.parse(fs.readFileSync(MODERATION, 'utf8'));
for (const key of ['banned', 'trusted', 'hidden']) {
  if (!Array.isArray(moderation[key])) moderation[key] = [];
}

const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));

/** Case-insensitive add, without duplicates. */
function add(list, value) {
  const at = list.findIndex((v) => v.toLowerCase() === value.toLowerCase());
  if (at !== -1) return false;
  list.push(value.toLowerCase());
  list.sort();
  return true;
}

function drop(list, value) {
  const at = list.findIndex((v) => v.toLowerCase() === value.toLowerCase());
  if (at === -1) return false;
  list.splice(at, 1);
  return true;
}

let changed = 0;

for (const { verb, target } of commands) {
  const id = target.toLowerCase();

  if (verb === 'hide' || verb === 'restore') {
    const pack = index.packs.find((p) => p.id.toLowerCase() === id);
    if (!pack) {
      say(`There is no pack called \`${target}\`.`);
      continue;
    }
    const hiding = verb === 'hide';
    if (hiding) add(moderation.hidden, id);
    else drop(moderation.hidden, id);

    // The flag on the record is what the app reads; the list is what survives a
    // record being replaced by a later submission. Both are written, because
    // either one alone leaves a pack that comes back listed after its author
    // publishes it again.
    pack.listed = !hiding;
    say(hiding
      ? `**${pack.title}** is no longer listed. The record is kept, so \`/restore ${pack.id}\` puts it back.`
      : `**${pack.title}** is listed again.`);
    changed++;
    continue;
  }

  if (verb === 'ban' || verb === 'unban') {
    const banning = verb === 'ban';
    const moved = banning ? add(moderation.banned, id) : drop(moderation.banned, id);
    if (!moved) {
      say(`@${target} was already ${banning ? 'banned' : 'not banned'}.`);
      continue;
    }
    if (banning) {
      // Being banned and being trusted are contradictory, and leaving both set
      // would mean the outcome depended on which check ran first.
      drop(moderation.trusted, id);
      const theirs = index.packs.filter((p) => p.author.toLowerCase() === id);
      for (const pack of theirs) {
        pack.listed = false;
        add(moderation.hidden, pack.id.toLowerCase());
      }
      say(`@${target} is banned and ${theirs.length} pack(s) of theirs are no longer listed.`);
    } else {
      say(`@${target} is no longer banned. Packs of theirs stay hidden until restored one by one.`);
    }
    changed++;
    continue;
  }

  if (verb === 'trust' || verb === 'untrust') {
    const trusting = verb === 'trust';
    if (trusting && moderation.banned.some((b) => b === id)) {
      say(`@${target} is banned, so they cannot be trusted. Unban them first.`);
      continue;
    }
    const moved = trusting ? add(moderation.trusted, id) : drop(moderation.trusted, id);
    if (!moved) {
      say(`@${target} was already ${trusting ? 'trusted' : 'not trusted'}.`);
      continue;
    }
    say(trusting
      ? `@${target} is trusted. Their submissions will be listed without waiting for review.`
      : `@${target} is no longer trusted. Their submissions will be reviewed again.`);
    changed++;
  }
}

if (!changed) process.exit(0);

index.packs.sort((a, b) => a.id.localeCompare(b.id));
index.updated = new Date().toISOString();

fs.writeFileSync(MODERATION, `${JSON.stringify(moderation, null, 2)}\n`);
fs.writeFileSync(INDEX, `${JSON.stringify(index, null, 2)}\n`);

console.log(`Applied ${changed} change(s) for @${commenter}`);

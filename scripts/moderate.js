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

// A handle, and for /ban optionally how long. Anything after the handle is
// captured rather than refused by the pattern, so a duration nobody can read
// gets an explanation instead of the command being silently ignored.
const commands = [...String(body)
  .matchAll(/^\s*\/(hide|restore|ban|unban|trust|untrust)\s+(\S+)([^\n]*)$/gim)]
  .map((m) => ({
    verb: m[1].toLowerCase(),
    target: m[2].trim(),
    rest: (m[3] || '').trim(),
  }));

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

/**
 * Removes somebody from the banned list, whichever shape their entry is.
 *
 * Entries are either a plain handle, meaning forever, or `{ who, until }`. Both
 * live in the same list so bans written before timed ones existed keep working
 * without being migrated, which means anything touching the list has to cope
 * with both.
 */
function dropBan(list, handle) {
  const wanted = String(handle).toLowerCase();
  const at = list.findIndex((entry) => {
    const who = typeof entry === 'string' ? entry : (entry && entry.who);
    return String(who || '').toLowerCase() === wanted;
  });
  if (at === -1) return false;
  list.splice(at, 1);
  return true;
}

/**
 * When a ban should lift, from something a person typed.
 *
 * Returns an ISO date, `null` for a permanent ban, or `false` if the words
 * could not be read. The three are deliberately distinct: reading an unknown
 * unit as permanent would turn a typo into the harshest outcome available,
 * silently.
 */
function untilFrom(words) {
  const said = String(words || '').trim();
  if (!said) return null;
  if (/^(forever|permanent|permanently)$/i.test(said)) return null;

  const match = said.match(/^(\d+)\s*(h|hr|hrs|hour|hours|d|day|days|w|week|weeks|mo|month|months|y|year|years)$/i);
  if (!match) return false;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return false;

  const hour = 60 * 60 * 1000;
  const unit = match[2].toLowerCase();
  const spans = {
    h: hour, hr: hour, hrs: hour, hour, hours: hour,
    d: 24 * hour, day: 24 * hour, days: 24 * hour,
    w: 7 * 24 * hour, week: 7 * 24 * hour, weeks: 7 * 24 * hour,
    mo: 30 * 24 * hour, month: 30 * 24 * hour, months: 30 * 24 * hour,
    y: 365 * 24 * hour, year: 365 * 24 * hour, years: 365 * 24 * hour,
  };
  return new Date(Date.now() + amount * spans[unit]).toISOString();
}

let changed = 0;

for (const { verb, target, rest } of commands) {
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

    // Everything after the handle is how long for. `/ban someone 7d` is a week,
    // `/ban someone` is forever. A wrong unit is refused rather than quietly
    // read as forever, because the difference between a week and permanent is
    // not something to guess at on somebody's behalf.
    const until = banning ? untilFrom(rest) : null;
    if (banning && until === false) {
      say(`I could not read "${rest}" as a length of time. Use something like \`7d\`, `
        + '`3w`, `6mo`, or leave it off for a permanent ban.');
      continue;
    }

    // Written afresh rather than added to, so re-banning somebody changes how
    // long for instead of doing nothing because they are on the list already.
    dropBan(moderation.banned, id);
    if (banning) moderation.banned.push(until ? { who: id, until } : id);
    moderation.banned.sort((a, b) =>
      String(a.who || a).localeCompare(String(b.who || b)));

    if (banning) {
      // Being banned and being trusted are contradictory, and leaving both set
      // would mean the outcome depended on which check ran first.
      drop(moderation.trusted, id);
      const theirs = index.packs.filter((p) => p.author.toLowerCase() === id);
      for (const pack of theirs) {
        pack.listed = false;
        add(moderation.hidden, pack.id.toLowerCase());
      }
      const how = until
        ? `until ${new Date(until).toISOString().slice(0, 10)}`
        : 'permanently';
      say(`@${target} is banned ${how} and ${theirs.length} pack(s) of theirs are no longer `
        + 'listed. Their packs stay hidden after the ban lifts until restored one by one.');
    } else {
      say(`@${target} is no longer banned. Packs of theirs stay hidden until restored one by one.`);
    }
    changed++;
    continue;
  }

  if (verb === 'trust' || verb === 'untrust') {
    const trusting = verb === 'trust';
    if (trusting && moderation.banned.some((b) => String(b.who || b).toLowerCase() === id)) {
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

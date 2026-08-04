'use strict';

/**
 * Asks VirusTotal whether a pack is known to be malicious.
 *
 *   node scripts/virus-check.js <sha256> <download-url>
 *
 * Runs on every submission, including ones that list without a person looking
 * at them. A check that only happens when somebody is watching is a check that
 * does not happen.
 *
 * ## What this can and cannot tell you
 *
 * It looks the file's checksum up in VirusTotal's existing results. That is
 * cheap, instant, and needs no download, which matters when a pack is hundreds
 * of megabytes.
 *
 * The honest limits, because a security check that oversells itself is worse
 * than none:
 *
 *   - **A hit is meaningful.** If engines have flagged this exact file, that is
 *     real information and the submission is refused.
 *   - **A miss is not a clean bill of health.** It means "nobody has reported
 *     this file", which is true of every file the first time it exists. Most
 *     packs will be unknown, and that is normal rather than suspicious.
 *
 * So a miss never blocks anything. Refusing every new pack because it is new
 * would refuse every pack.
 *
 * Without an API key the check is skipped rather than failed. The directory
 * still refuses executables, zip-slip and zip bombs before any of this, and
 * losing an advisory check should not stop people sharing packs.
 */

const https = require('https');

const [sha256] = process.argv.slice(2);
const KEY = process.env.VIRUSTOTAL_API_KEY;

/** How many engines have to object before a pack is refused. */
const ENOUGH_TO_REFUSE = 2;

function say(message) {
  console.log(message);
}

function refuse(message) {
  console.error(message);
  require('fs').writeFileSync('virus-error.txt', message);
  process.exit(1);
}

if (!KEY) {
  say('No VirusTotal key set, so this check was skipped.');
  process.exit(0);
}
if (!/^[a-f0-9]{64}$/i.test(String(sha256 || ''))) {
  say('No usable checksum to look up, so this check was skipped.');
  process.exit(0);
}

const ask = (path) => new Promise((resolve, reject) => {
  const request = https.request({
    host: 'www.virustotal.com',
    path,
    method: 'GET',
    headers: { 'x-apikey': KEY, accept: 'application/json' },
    timeout: 30000,
  }, (response) => {
    let body = '';
    response.on('data', (chunk) => { body += chunk; });
    response.on('end', () => {
      // 404 is the ordinary answer for a file nobody has seen.
      if (response.statusCode === 404) return resolve(null);
      if (response.statusCode !== 200) {
        return reject(new Error(`VirusTotal answered ${response.statusCode}`));
      }
      try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
    });
  });
  request.on('timeout', () => request.destroy(new Error('VirusTotal did not answer in time')));
  request.on('error', reject);
  request.end();
});

(async () => {
  let found;
  try {
    found = await ask(`/api/v3/files/${sha256.toLowerCase()}`);
  } catch (err) {
    // The service being unreachable is not evidence about the pack, and
    // refusing on it would make every submission depend on somebody else's
    // uptime.
    say(`VirusTotal could not be reached (${err.message}), so this check was skipped.`);
    process.exit(0);
  }

  if (!found) {
    say('VirusTotal has not seen this file. That is normal for a new pack and is not a '
      + 'reason to refuse it.');
    process.exit(0);
  }

  const stats = (found.data && found.data.attributes && found.data.attributes.last_analysis_stats)
    || {};
  const bad = (stats.malicious || 0) + (stats.suspicious || 0);

  say(`VirusTotal: ${stats.malicious || 0} malicious, ${stats.suspicious || 0} suspicious, `
    + `${stats.harmless || 0} harmless.`);

  if (bad >= ENOUGH_TO_REFUSE) {
    refuse(`This file is flagged as malicious by ${bad} security engines, so it has not been `
      + 'listed. If you believe that is wrong, say so on this issue.');
  }

  // One lone engine disagreeing with everybody else is usually a false
  // positive, and refusing on it would turn a known-unreliable signal into a
  // rejection somebody has to argue their way out of.
  if (bad === 1) {
    say('One engine objects, which on its own is usually a false positive. Not refused, but '
      + 'worth a look before this is listed.');
  }

  process.exit(0);
})();

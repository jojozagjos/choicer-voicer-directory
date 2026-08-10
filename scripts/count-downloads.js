'use strict';

/**
 * Fills in how many times each listed pack has actually been downloaded.
 *
 *   node scripts/count-downloads.js index.json
 *
 * The directory is a JSON file on a CDN. There is no server, so there is
 * nothing that can be told "somebody installed this" at the moment it happens,
 * and the count sat at whatever it was first written as, which was zero. Every
 * listing said "0 downloaded" forever, including the popular ones.
 *
 * GitHub is already counting, though. A release asset carries a download_count
 * that goes up whether the file was fetched by this app, by a browser, or by
 * anything else, and it is readable through the API for nothing. This job asks
 * once a day and writes the answers into the index, which turns a number that
 * was always wrong into one that is at most a day behind.
 *
 * Two things this deliberately does not try to do.
 *
 * It does not count unique people. GitHub counts requests for a file, and
 * there is nobody in the middle to recognise a machine that has fetched it
 * before. The app avoids the obvious double count by reusing the copy it
 * already downloaded rather than fetching the same file twice, so previewing
 * a pack and then installing it is one download rather than two. Beyond that
 * the number means what the word says: how many times the file was fetched.
 *
 * And it does not let an update reset the total. Publishing an update uploads
 * a new asset, whose own counter starts at zero, so reading the current asset
 * alone would drop a popular pack back to nothing the day its author fixed a
 * caption. Whatever the previous asset had reached is carried forward in
 * `downloadsBase`, and the listing shows that plus the current asset's count.
 */

const fs = require('fs');

const TOKEN = process.env.GITHUB_TOKEN || '';
const API = 'https://api.github.com';

/**
 * The owner, repository and tag a download address points at.
 *
 * Release addresses look like:
 *   https://github.com/<owner>/<repo>/releases/download/<tag>/<file>
 * Anything that does not is not one, and gives nothing rather than a guess.
 */
function partsOf(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== 'github.com') return null;
    const bits = parsed.pathname.split('/').filter(Boolean);
    // owner / repo / releases / download / tag / file
    if (bits.length < 6 || bits[2] !== 'releases' || bits[3] !== 'download') return null;
    return {
      owner: bits[0],
      repo: bits[1],
      tag: decodeURIComponent(bits[4]),
      file: decodeURIComponent(bits.slice(5).join('/')),
    };
  } catch {
    return null;
  }
}

async function askGitHub(path) {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'choicer-voicer-directory',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function countFor(pack) {
  const parts = partsOf(pack.downloadUrl);
  if (!parts) return null;

  const release = await askGitHub(
    `/repos/${parts.owner}/${parts.repo}/releases/tags/${encodeURIComponent(parts.tag)}`
  );
  const asset = (release.assets || []).find((a) => a.name === parts.file);
  if (!asset) return null;
  return Number(asset.download_count) || 0;
}

(async () => {
  const file = process.argv[2] || 'index.json';
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  const packs = index.packs || [];

  let changed = 0;
  let failed = 0;

  for (const pack of packs) {
    try {
      const count = await countFor(pack);
      if (count === null) {
        console.log(`  ${pack.id}: no release asset found, left at ${pack.downloads || 0}`);
        failed++;
        continue;
      }

      // The pack was republished since the last run, so the asset being read
      // is not the one the previous total came from. What that one reached is
      // banked before the new asset takes over, rather than being lost.
      const base = Number(pack.downloadsBase) || 0;
      if (pack.countedUrl && pack.countedUrl !== pack.downloadUrl) {
        const banked = Math.max(0, (Number(pack.downloads) || 0));
        pack.downloadsBase = banked;
        console.log(`  ${pack.id}: republished, carrying ${banked} forward`);
      }

      const total = (Number(pack.downloadsBase) || base) + count;
      pack.countedUrl = pack.downloadUrl;

      if (total === pack.downloads) {
        console.log(`  ${pack.id}: ${total}`);
        continue;
      }
      console.log(`  ${pack.id}: ${pack.downloads || 0} -> ${total}`);
      pack.downloads = total;
      changed++;
    } catch (err) {
      // A pack whose repository has gone private, or a rate limit. Either way
      // the old number is better than zero, and the link checker is what
      // decides whether a pack that cannot be reached stays listed.
      console.log(`  ${pack.id}: could not be read (${err.message}), left alone`);
      failed++;
    }
  }

  if (changed) {
    index.updated = new Date().toISOString();
    fs.writeFileSync(file, `${JSON.stringify(index, null, 2)}\n`);
  }

  console.log(`\n${packs.length} listed, ${changed} changed, ${failed} could not be read`);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

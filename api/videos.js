// GET /api/videos — every upload on the sounds mint YouTube channel, newest first.
// Combines the channel's /videos, /shorts and /streams tabs (titles + ids) with the RSS feed
// (exact publish dates for the latest 15). No API key needed. Cached at the edge for an hour.

const CHANNEL_ID = "UCh_z_mVjnIPXXibchl09-Sg";
const HEADERS = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "accept-language": "en-GB,en;q=0.9",
  // skip the EU cookie-consent interstitial
  cookie: "CONSENT=YES+cb; SOCS=CAI",
};

async function getText(url) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.text();
}

function decodeXml(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

async function fromRss() {
  const xml = await getText(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`);
  const out = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const id = (e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
    const title = (e.match(/<title>([^<]*)<\/title>/) || [])[1];
    const published = (e.match(/<published>([^<]+)<\/published>/) || [])[1];
    const views = (e.match(/<media:statistics views="(\d+)"/) || [])[1];
    if (id) out.push({ id, title: decodeXml(title || ""), published, views: views ? +views : undefined });
  }
  return out;
}

function extractInitialData(html) {
  const m = html.match(/var ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/) || html.match(/ytInitialData"\]\s*=\s*(\{[\s\S]*?\});/);
  return m ? JSON.parse(m[1]) : null;
}

function textOf(t) {
  if (!t) return "";
  if (typeof t === "string") return t;
  if (t.simpleText) return t.simpleText;
  if (t.content) return t.content;
  if (Array.isArray(t.runs)) return t.runs.map((r) => r.text).join("");
  return "";
}

// Walk the page data and collect every video tile, whatever renderer YouTube is using this month.
function collect(node, out, seen) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const n of node) collect(n, out, seen); return; }

  const vr = node.videoRenderer || node.gridVideoRenderer || node.reelItemRenderer;
  if (vr && vr.videoId && !seen.has(vr.videoId)) {
    seen.add(vr.videoId);
    out.push({ id: vr.videoId, title: textOf(vr.title) || textOf(vr.headline), ago: textOf(vr.publishedTimeText) });
  }
  const sl = node.shortsLockupViewModel;
  if (sl) {
    const id = sl.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId || (sl.entityId || "").replace(/^shorts-shelf-item-/, "");
    if (id && id.length === 11 && !seen.has(id)) {
      seen.add(id);
      out.push({ id, title: textOf(sl.overlayMetadata?.primaryText), short: true });
    }
  }
  const lv = node.lockupViewModel;
  if (lv && lv.contentType === "LOCKUP_CONTENT_TYPE_VIDEO" && lv.contentId && !seen.has(lv.contentId)) {
    seen.add(lv.contentId);
    const meta = lv.metadata?.lockupMetadataViewModel;
    const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
    const parts = rows.flatMap((r) => (r.metadataParts || []).map((p) => textOf(p.text)));
    out.push({ id: lv.contentId, title: textOf(meta?.title), ago: parts.find((p) => /ago$/.test(p)) || "" });
  }
  for (const k in node) collect(node[k], out, seen);
}

async function fromTab(tab) {
  const html = await getText(`https://www.youtube.com/channel/${CHANNEL_ID}/${tab}?hl=en&gl=GB`);
  const data = extractInitialData(html);
  if (!data) return [];
  const out = [];
  collect(data, out, new Set());
  return out.map((v) => ({ ...v, tab, short: v.short || tab === "shorts" }));
}

module.exports = async function handler(req, res) {
  const [rss, videos, shorts, streams] = await Promise.all([
    fromRss().catch(() => []),
    fromTab("videos").catch(() => []),
    fromTab("shorts").catch(() => []),
    fromTab("streams").catch(() => []),
  ]);

  const rssById = new Map(rss.map((v) => [v.id, v]));
  const merged = [];
  const seen = new Set();
  // Channel tabs are already newest-first; RSS fills in dates and anything the tabs missed.
  for (const v of [...videos, ...streams, ...shorts, ...rss]) {
    if (!v.id || seen.has(v.id)) continue;
    seen.add(v.id);
    const r = rssById.get(v.id) || {};
    merged.push({ id: v.id, title: v.title || r.title || "", published: r.published, ago: v.ago, views: r.views, short: !!v.short, tab: v.tab || "rss" });
  }
  // Order: known dates newest-first, then the rest in channel order.
  const dated = merged.filter((v) => v.published).sort((a, b) => b.published.localeCompare(a.published));
  const undated = merged.filter((v) => !v.published);
  const list = videos.length ? merged : [...dated, ...undated];

  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "public, s-maxage=3600, stale-while-revalidate=86400");
  res.status(list.length ? 200 : 502).send(JSON.stringify({ channel: CHANNEL_ID, count: list.length, videos: list }));
};

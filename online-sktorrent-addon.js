// online-sktorrent-addon.js
// Note: Use Node.js v20.09 LTS for testing (https://nodejs.org/en/blog/release/v20.9.0)
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");
const { decode } = require("entities");

const builder = addonBuilder({
    id: "org.stremio.sktonline",
    version: "1.0.1",
    name: "SKTonline Online Streams",
    description: "Všetky dostupné online streamy (4K/1080p/720p/...) z online.sktorrent.eu",
    types: ["movie", "series"],
    catalogs: [
        { type: "movie", id: "sktonline-movie", name: "SKTonline Filmy" },
        { type: "series", id: "sktonline-series", name: "SKTonline Seriály" }
    ],
    resources: ["stream"],
    idPrefixes: ["tt"]
});

const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Encoding': 'identity'
};

function removeDiacritics(str) {
    return str.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function shortenTitle(title, wordCount = 3) {
    return title.split(/\s+/).slice(0, wordCount).join(" ");
}

function extractFlags(title) {
    const flags = [];
    if (/\bCZ\b/i.test(title)) flags.push("cz");
    if (/\bSK\b/i.test(title)) flags.push("sk");
    if (/\bEN\b/i.test(title)) flags.push("en");
    if (/\bHU\b/i.test(title)) flags.push("hu");
    if (/\bDE\b/i.test(title)) flags.push("de");
    if (/\bFR\b/i.test(title)) flags.push("fr");
    if (/\bIT\b/i.test(title)) flags.push("it");
    if (/\bES\b/i.test(title)) flags.push("es");
    if (/\bRU\b/i.test(title)) flags.push("ru");
    if (/\bPL\b/i.test(title)) flags.push("pl");
    if (/\bJP\b/i.test(title)) flags.push("jp");
    if (/\bCN\b/i.test(title)) flags.push("cn");
    return flags;
}

function formatTitle(label) {
    if (/2160p|4K/i.test(label)) return "SKTonline 💎 4K (2160p)";
    if (/1080p|FHD/i.test(label)) return "SKTonline 🟦 Full HD (1080p)";
    if (/720p|HD/i.test(label)) return "SKTonline 🟦 HD (720p)";
    if (/480p|SD/i.test(label)) return "SKTonline 🟨 SD (480p)";
    if (/360p|LD/i.test(label)) return "SKTonline 🟥 LD (360p)";
    return `SKTonline ⚪ ${label !== 'Unknown' ? label : 'Všetky kvality'}`;
}

function formatName(fullTitle, flagsArray) {
    const flagIcons = {
        cz: "🇨🇿", sk: "🇸🇰", en: "🇬🇧", hu: "🇭🇺", de: "🇩🇪", fr: "🇫🇷",
        it: "🇮🇹", es: "🇪🇸", ru: "🇷🇺", pl: "🇵🇱", jp: "🇯🇵", cn: "🇨🇳"
    };
    const iconStr = flagsArray.map(f => flagIcons[f]).filter(Boolean).join(" ");
    return fullTitle + "\n⚙️SKTonline" + (iconStr ? "\n" + iconStr : "");
}

async function getTitleFromIMDb(imdbId) {
    try {
        const url = `https://www.imdb.com/title/${imdbId}/`;
        const res = await axios.get(url, { headers: commonHeaders, timeout: 5000 });
        const $ = cheerio.load(res.data);
        const titleRaw = $('title').text().split(' - ')[0].trim();
        const title = decode(titleRaw);
        const ldJson = $('script[type="application/ld+json"]').html();
        let originalTitle = title;
        if (ldJson) {
            const json = JSON.parse(ldJson);
            if (json && json.name) originalTitle = decode(json.name.trim());
        }
        return { title, originalTitle };
    } catch (err) {
        console.error("[ERROR] IMDb scraping zlyhal:", err.message);
        return null;
    }
}

async function searchOnlineVideos(query) {
    const searchUrl = `https://online.sktorrent.eu/search/videos?search_query=${encodeURIComponent(query)}`;
    try {
        const res = await axios.get(searchUrl, { headers: commonHeaders, timeout: 5000 });
        const $ = cheerio.load(res.data);
        const links = [];
        $("a[href^='/video/']").each((i, el) => {
            const href = $(el).attr("href");
            if (href) {
                const match = href.match(/\/video\/(\d+)/);
                if (match) links.push(match[1]);
            }
        });
        return links;
    } catch (err) {
        console.error("[ERROR] ❌ Vyhľadávanie zlyhalo:", err.message);
        return [];
    }
}

async function extractStreamsFromVideoId(videoId) {
    const url = `https://online.sktorrent.eu/video/${videoId}`;
    try {
        const res = await axios.get(url, { headers: commonHeaders, timeout: 5000 });
        const $ = cheerio.load(res.data);
        const sourceTags = $('video source');
        const titleText = $('title').text().trim();
        const flags = extractFlags(titleText);
        const streams = [];

        sourceTags.each((i, el) => {
            let src = $(el).attr('src');
            const label = $(el).attr('label') || 'Video';
            if (src) {
                src = src.replace(/([^:])\/\/+/, '$1/');
                streams.push({
                    title: formatName(titleText, flags),
                    name: formatTitle(label),
                    url: src
                });
            }
        });
        return streams;
    } catch (err) {
        return [];
    }
}

// OPRAVA: Handler musí byť async alebo vracať Promise.resolve
builder.defineCatalogHandler(async ({ type, id }) => {
    console.log(`[DEBUG] 📚 Katalóg požiadavka pre typ='${type}' id='${id}'`);
    return { metas: [] }; 
});

builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`\n====== 🎮 STREAM požiadavka: type='${type}', id='${id}' ======`);
    const [imdbId, seasonStr, episodeStr] = id.split(":");
    const season = seasonStr ? parseInt(seasonStr) : null;
    const episode = episodeStr ? parseInt(episodeStr) : null;

    const titles = await getTitleFromIMDb(imdbId);
    if (!titles) return { streams: [] };

    const { title, originalTitle } = titles;
    const queries = new Set();
    const cleanTitles = [title, originalTitle].map(t => t.replace(/\(.*?\)/g, '').trim());

    for (const base of cleanTitles) {
        const noDia = removeDiacritics(base);
        if (type === 'series' && season && episode) {
            queries.add(`${noDia} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`);
            queries.add(`${noDia} ${season}x${episode}`);
        } else {
            queries.add(noDia);
            queries.add(shortenTitle(noDia, 2));
        }
    }

    let allStreams = [];
    for (const q of queries) {
        const videoIds = await searchOnlineVideos(q);
        for (const vid of videoIds) {
            const streams = await extractStreamsFromVideoId(vid);
            allStreams.push(...streams);
        }
        if (allStreams.length > 0) break;
    }

    console.log(`[INFO] 📤 Odosielam ${allStreams.length} streamov.`);
    return { streams: allStreams };
});

serveHTTP(builder.getInterface(), { port: 7000 });

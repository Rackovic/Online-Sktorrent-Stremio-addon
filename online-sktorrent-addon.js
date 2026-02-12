// online-sktorrent-addon.js
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");
const { decode } = require("entities");

const builder = addonBuilder({
    id: "org.stremio.sktonline",
    version: "1.0.5",
    name: "SKTonline Online Streams",
    description: "Všetky streamy bez obmedzenia kvality z online.sktorrent.eu",
    types: ["movie", "series"],
    // OPRAVA: Katalógy nesmú byť prázdne, ak používame catalogHandler
    catalogs: [
        { type: "movie", id: "sktonline-movies", name: "SKTonline Filmy" },
        { type: "series", id: "sktonline-series", name: "SKTonline Seriály" }
    ],
    resources: ["stream"],
    idPrefixes: ["tt"]
});

const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'sk,cs,en-US,en;q=0.9'
};

function removeDiacritics(str) {
    return str ? str.normalize("NFD").replace(/\p{Diacritic}/gu, "") : "";
}

function extractFlags(title) {
    const flags = [];
    const t = title.toUpperCase();
    if (t.includes("CZ") || t.includes("CESKY") || t.includes("DABING")) flags.push("cz");
    if (t.includes("SK") || t.includes("SLOVENSKY")) flags.push("sk");
    if (t.includes("EN") || t.includes("ENGLISH")) flags.push("en");
    return flags;
}

function formatStreamName(label) {
    const l = label.toLowerCase();
    if (l.includes("2160") || l.includes("4k")) return "SKTonline 💎 4K";
    if (l.includes("1080") || l.includes("fhd")) return "SKTonline 🟦 1080p";
    if (l.includes("720") || l.includes("hd")) return "SKTonline 🟦 720p";
    if (l.includes("480") || l.includes("sd")) return "SKTonline 🟨 480p";
    if (l.includes("360") || l.includes("ld")) return "SKTonline 🟥 360p";
    return `SKTonline ⚪ ${label}`;
}

async function getTitleFromIMDb(imdbId) {
    try {
        const url = `https://www.imdb.com/title/${imdbId}/`;
        const res = await axios.get(url, { headers: commonHeaders, timeout: 8000 });
        const $ = cheerio.load(res.data);
        const titleRaw = $('title').text().split(' (')[0].trim();
        const title = decode(titleRaw);
        
        const ldJsonText = $('script[type="application/ld+json"]').html();
        let originalTitle = title;
        if (ldJsonText) {
            const json = JSON.parse(ldJsonText);
            if (json.name) originalTitle = decode(json.name);
        }
        return { title, originalTitle };
    } catch (err) {
        return null;
    }
}

async function searchOnlineVideos(query) {
    const searchUrl = `https://online.sktorrent.eu/search/videos?search_query=${encodeURIComponent(query)}`;
    console.log(`[SEARCHING] ${query}`);
    try {
        const res = await axios.get(searchUrl, { headers: commonHeaders, timeout: 8000 });
        const $ = cheerio.load(res.data);
        const ids = [];
        
        $("a[href*='/video/']").each((i, el) => {
            const href = $(el).attr("href");
            const match = href.match(/\/video\/(\d+)/);
            if (match) ids.push(match[1]);
        });
        return [...new Set(ids)]; 
    } catch (err) {
        return [];
    }
}

async function extractStreams(videoId) {
    const url = `https://online.sktorrent.eu/video/${videoId}`;
    try {
        const res = await axios.get(url, { headers: commonHeaders, timeout: 8000 });
        const $ = cheerio.load(res.data);
        const pageTitle = $('title').text().replace(" - SKTonline", "").trim();
        const flags = extractFlags(pageTitle);
        const flagIcons = flags.map(f => f === 'cz' ? '🇨🇿' : f === 'sk' ? '🇸🇰' : '🇬🇧').join(' ');
        
        const streams = [];
        const sources = $('video source');

        if (sources.length > 0) {
            sources.each((i, el) => {
                let src = $(el).attr('src');
                let label = $(el).attr('label') || "Video";
                if (src) {
                    src = src.replace(/([^:])\/\/+/g, '$1/');
                    streams.push({
                        name: formatStreamName(label),
                        title: `${pageTitle}\n${flagIcons}\nZdroj: SKTonline`,
                        url: src
                    });
                }
            });
        }

        // Ak nie sú <source> tagy, skúsime nájsť akýkoľvek mp4 link alebo download link
        if (streams.length === 0) {
            const downloadLink = $('a[href*="get_video"]').attr('href');
            if (downloadLink) {
                streams.push({
                    name: "SKTonline ⚪ Prehrať",
                    title: `${pageTitle}\n${flagIcons}`,
                    url: downloadLink.startsWith('http') ? downloadLink : `https://online.sktorrent.eu${downloadLink}`
                });
            }
        }

        return streams;
    } catch (err) {
        return [];
    }
}

builder.defineStreamHandler(async ({ type, id }) => {
    const [imdbId, season, episode] = id.split(":");
    const info = await getTitleFromIMDb(imdbId);
    if (!info) return { streams: [] };

    const queries = new Set();
    const t1 = removeDiacritics(info.title);
    const t2 = removeDiacritics(info.originalTitle);

    if (type === 'series') {
        const s = season.padStart(2, '0');
        const e = episode.padStart(2, '0');
        queries.add(`${t1} S${s}E${e}`);
        queries.add(`${t2} S${s}E${e}`);
    } else {
        queries.add(t1);
        queries.add(t2);
        // Špeciálne pre Zootopia 2 a podobné: hľadaj presne s číslom
        if (t1.match(/\d$/)) queries.add(t1);
    }

    let allStreams = [];
    for (const q of queries) {
        const vIds = await searchOnlineVideos(q);
        for (const vid of vIds) {
            const results = await extractStreams(vid);
            allStreams.push(...results);
        }
        if (allStreams.length > 0) break;
    }

    console.log(`[RESULT] Nájdených ${allStreams.length} streamov pre: ${info.title}`);
    return { streams: allStreams };
});

// OPRAVA: Musí existovať a vracať prázdny zoznam, aby Stremio nepadalo
builder.defineCatalogHandler(({ type, id }) => {
    return Promise.resolve({ metas: [] });
});

serveHTTP(builder.getInterface(), { port: 7000 });
console.log("🚀 SKTonline Addon úspešne spustený na porte 7000");

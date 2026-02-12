// online-sktorrent-addon.js
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");
const { decode } = require("entities");

const builder = addonBuilder({
    id: "org.stremio.sktonline",
    version: "1.0.4",
    name: "SKTonline Online Streams",
    description: "Všetky streamy bez obmedzenia kvality z online.sktorrent.eu",
    types: ["movie", "series"],
    catalogs: [], 
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
    // Ak je label hocičo iné (napr. "Video", "MP4", "Vysoká"), vypíšeme ho
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
        console.error("[IMDb Error]", err.message);
        return null;
    }
}

async function searchOnlineVideos(query) {
    const searchUrl = `https://online.sktorrent.eu/search/videos?search_query=${encodeURIComponent(query)}`;
    console.log(`[SEARCHING] ${searchUrl}`);
    try {
        const res = await axios.get(searchUrl, { headers: commonHeaders, timeout: 8000 });
        const $ = cheerio.load(res.data);
        const ids = [];
        
        // Hľadáme linky, ktoré smerujú na video
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

        // Hľadáme všetky možné zdroje videa na stránke
        const sources = $('video source');
        if (sources.length > 0) {
            sources.each((i, el) => {
                let src = $(el).attr('src');
                let label = $(el).attr('label') || "Video";
                if (src) {
                    src = src.replace(/([^:])\/\/+/g, '$1/'); // Oprava URL
                    streams.push({
                        name: formatStreamName(label),
                        title: `${pageTitle}\n${flagIcons}\nZdroj: SKTonline`,
                        url: src
                    });
                }
            });
        } else {
            // Fallback pre prípady, kedy nie je <source> tag, ale len link
            const directLink = $('a[href*="get_video"]').attr('href');
            if (directLink) {
                streams.push({
                    name: "SKTonline ⚪ Prehrať",
                    title: `${pageTitle}\n${flagIcons}`,
                    url: directLink.startsWith('http') ? directLink : `https://online.sktorrent.eu${directLink}`
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
    const cleanTitle = removeDiacritics(info.title);
    const cleanOrig = removeDiacritics(info.originalTitle);

    if (type === 'series') {
        const s = season.padStart(2, '0');
        const e = episode.padStart(2, '0');
        queries.add(`${cleanTitle} S${s}E${e}`);
        queries.add(`${cleanOrig} S${s}E${e}`);
    } else {
        // Pridáme verzie s číslom aj bez neho pre lepší zásah
        queries.add(cleanTitle);
        queries.add(cleanOrig);
        if (cleanTitle.match(/\s\d$/)) queries.add(cleanTitle.replace(/\s\d$/, ""));
    }

    let allStreams = [];
    for (const q of queries) {
        const vIds = await searchOnlineVideos(q);
        for (const vid of vIds) {
            const results = await extractStreams(vid);
            allStreams.push(...results);
        }
        // Ak sme niečo našli pre prvý dotaz, nepokračujeme (optimalizácia)
        if (allStreams.length > 0) break;
    }

    console.log(`[RESULT] Odosielam ${allStreams.length} streamov pre ${info.title}`);
    return { streams: allStreams };
});

// Oprava pre Render a Stremio
builder.defineCatalogHandler(() => Promise.resolve({ metas: [] }));

serveHTTP(builder.getInterface(), { port: 7000 });

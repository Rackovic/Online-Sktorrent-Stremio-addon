const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");
const { decode } = require("entities");

const builder = addonBuilder({
    id: "org.stremio.sktonline",
    version: "1.0.6",
    name: "SKTonline Online Streams",
    description: "Všetky streamy bez obmedzenia kvality z online.sktorrent.eu",
    types: ["movie", "series"],
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
    // Odstránenie roku a zbytočných znakov pre SKTorrent vyhľadávač
    const cleanQuery = query.replace(/\s\(\d{4}\)/g, "").trim();
    const searchUrl = `https://online.sktorrent.eu/search/videos?search_query=${encodeURIComponent(cleanQuery)}`;
    
    console.log(`[SEARCHING] Skúšam: ${cleanQuery}`);
    try {
        const res = await axios.get(searchUrl, { headers: commonHeaders, timeout: 8000 });
        const $ = cheerio.load(res.data);
        const ids = [];
        
        $("a").each((i, el) => {
            const href = $(el).attr("href") || "";
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
                if (src) {
                    src = src.replace(/([^:])\/\/+/g, '$1/');
                    streams.push({
                        name: "SKTonline 🟦 Stream",
                        title: `${pageTitle}\n${flagIcons}`,
                        url: src
                    });
                }
            });
        } else {
            const dl = $('a[href*="get_video"]').attr('href');
            if (dl) {
                streams.push({
                    name: "SKTonline ⚪ Prehrať",
                    title: `${pageTitle}\n${flagIcons}`,
                    url: dl.startsWith('http') ? dl : `https://online.sktorrent.eu${dl}`
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
    queries.add(removeDiacritics(info.originalTitle));
    queries.add(removeDiacritics(info.title));

    // Fix pre Zootopiu/Zootropolis
    if (info.originalTitle.toLowerCase().includes("zootopia")) {
        queries.add(info.originalTitle.toLowerCase().replace("zootopia", "zootropolis"));
    }

    let allStreams = [];
    for (const q of queries) {
        const vIds = await searchOnlineVideos(q);
        for (const vid of vIds) {
            const res = await extractStreams(vid);
            allStreams.push(...res);
        }
        if (allStreams.length > 0) break;
    }

    console.log(`[RESULT] Odosielam ${allStreams.length} streamov pre ${info.title}`);
    return { streams: allStreams };
});

builder.defineCatalogHandler(() => Promise.resolve({ metas: [] }));

serveHTTP(builder.getInterface(), { port: 7000 });
console.log("🚀 Addon beží na porte 7000");

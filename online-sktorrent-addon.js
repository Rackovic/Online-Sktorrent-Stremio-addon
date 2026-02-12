const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");
const { decode } = require("entities");

const builder = addonBuilder({
    id: "org.stremio.sktonline",
    version: "1.0.7",
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
    return str ? str.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase() : "";
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

async function searchAndFilter(query, targetTitle) {
    const searchUrl = `https://online.sktorrent.eu/search/videos?search_query=${encodeURIComponent(query)}`;
    console.log(`[SEARCH] Dotaz: ${query}`);
    
    try {
        const res = await axios.get(searchUrl, { headers: commonHeaders, timeout: 8000 });
        const $ = cheerio.load(res.data);
        const results = [];
        
        // Prechádzame všetky odkazy na videá
        $("a").each((i, el) => {
            const href = $(el).attr("href") || "";
            const videoTitle = $(el).text().trim();
            const match = href.match(/\/video\/(\d+)/);
            
            if (match && videoTitle) {
                const videoId = match[1];
                const cleanVideoTitle = removeDiacritics(videoTitle);
                const cleanTarget = removeDiacritics(targetTitle);

                // Kontrola: Musí obsahovať aspoň hlavné meno (napr. Zootopia)
                if (cleanVideoTitle.includes(cleanTarget.split(' ')[0])) {
                    results.push({ id: videoId, title: videoTitle });
                }
            }
        });
        return results;
    } catch (err) {
        return [];
    }
}

async function extractStreams(videoId, pageLabel) {
    const url = `https://online.sktorrent.eu/video/${videoId}`;
    try {
        const res = await axios.get(url, { headers: commonHeaders, timeout: 8000 });
        const $ = cheerio.load(res.data);
        const streams = [];
        
        // 1. Skúsime <source> tagy
        $('video source').each((i, el) => {
            let src = $(el).attr('src');
            let label = $(el).attr('label') || "Video";
            if (src) {
                streams.push({
                    name: `SKTonline 🟦 ${label}`,
                    title: pageLabel,
                    url: src.replace(/([^:])\/\/+/g, '$1/')
                });
            }
        });

        // 2. Fallback na priamy link
        if (streams.length === 0) {
            const dl = $('a[href*="get_video"]').attr('href');
            if (dl) {
                streams.push({
                    name: "SKTonline ⚪ Prehrať",
                    title: pageLabel,
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

    let searchTerms = [info.title, info.originalTitle];
    if (info.originalTitle.toLowerCase().includes("zootopia")) searchTerms.push("zootropolis");

    let foundVideos = [];
    
    // Skúsime najprv presné názvy
    for (const term of searchTerms) {
        const cleanTerm = term.replace(/\s\(\d{4}\)/g, "");
        const results = await searchAndFilter(cleanTerm, cleanTerm);
        foundVideos.push(...results);
    }

    // Ak stále nič, skúsime "Deep Search" - len prvé slovo názvu
    if (foundVideos.length === 0) {
        const firstWord = info.originalTitle.split(' ')[0];
        console.log(`[DEEP SEARCH] Skúšam len: ${firstWord}`);
        const results = await searchAndFilter(firstWord, info.originalTitle);
        foundVideos.push(...results);
    }

    let allStreams = [];
    // Odstránime duplikáty videí podľa ID
    const uniqueVideos = Array.from(new Set(foundVideos.map(v => v.id)))
        .map(id => foundVideos.find(v => v.id === id));

    for (const vid of uniqueVideos) {
        const streams = await extractStreams(vid.id, vid.title);
        allStreams.push(...streams);
    }

    console.log(`[RESULT] Nájdených ${allStreams.length} streamov.`);
    return { streams: allStreams };
});

builder.defineCatalogHandler(() => Promise.resolve({ metas: [] }));

serveHTTP(builder.getInterface(), { port: 7000 });

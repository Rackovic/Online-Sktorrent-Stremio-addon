const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");
const { decode } = require("entities");

const builder = addonBuilder({
    id: "org.stremio.sktonline",
    version: "1.0.9",
    name: "SKTonline Online Streams",
    description: "Všetky streamy z online.sktorrent.eu",
    types: ["movie", "series"],
    catalogs: [
        { 
            type: "movie", 
            id: "sktonline-top", 
            name: "SKTonline Filmy",
            extra: [{ name: "search", isRequired: false }] 
        }
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
        return { title };
    } catch (err) {
        return null;
    }
}

async function searchOnWeb(query) {
    const searchUrl = `https://online.sktorrent.eu/search/videos?search_query=${encodeURIComponent(query)}`;
    console.log(`[SEARCH] 🔍 Hľadám na webe: ${query}`);
    
    try {
        const res = await axios.get(searchUrl, { headers: commonHeaders, timeout: 10000 });
        const $ = cheerio.load(res.data);
        const results = [];

        $("a").each((i, el) => {
            const href = $(el).attr("href") || "";
            const title = $(el).text().trim();
            const match = href.match(/\/video\/(\d+)/);
            if (match && title) {
                results.push({ id: match[1], title: title });
            }
        });

        if (results.length === 0) {
            // Diagnostika: Pozrieme sa, či nás web neblokuje
            const bodyText = $('body').text().substring(0, 150).replace(/\s+/g, ' ');
            console.log(`[DIAG] Web vrátil prázdne výsledky. Začiatok stránky: ${bodyText}`);
        }

        return results;
    } catch (err) {
        console.log(`[ERROR] Chyba siete: ${err.message}`);
        return [];
    }
}

builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`[REQ] Požiadavka na stream ID: ${id}`);
    const [imdbId] = id.split(":");
    const info = await getTitleFromIMDb(imdbId);
    if (!info) return { streams: [] };

    // Skúsime hľadať názov (bez diakritiky)
    const cleanTitle = removeDiacritics(info.title);
    let videos = await searchOnWeb(cleanTitle);

    // Špeciálny prípad pre Zootopiu
    if (videos.length === 0 && cleanTitle.includes("zootopia")) {
        console.log("[RETRY] Skúšam 'zootropolis'...");
        videos = await searchOnWeb("zootropolis");
    }

    // Ak stále nič, skúsime len prvé slovo
    if (videos.length === 0) {
        const firstWord = cleanTitle.split(' ')[0];
        if (firstWord.length > 3) {
            console.log(`[RETRY] Skúšam len prvé slovo: ${firstWord}`);
            videos = await searchOnWeb(firstWord);
        }
    }

    const streams = [];
    for (const vid of videos.slice(0, 5)) { // Max 5 výsledkov
        const videoUrl = `https://online.sktorrent.eu/video/${vid.id}`;
        try {
            const res = await axios.get(videoUrl, { headers: commonHeaders });
            const $ = cheerio.load(res.data);
            
            // Hľadáme zdroj videa
            const source = $('video source').attr('src');
            const download = $('a[href*="get_video"]').attr('href');
            const finalUrl = source || (download ? (download.startsWith('http') ? download : `https://online.sktorrent.eu${download}`) : null);

            if (finalUrl) {
                streams.push({
                    name: "SKTonline",
                    title: vid.title,
                    url: finalUrl.replace(/([^:])\/\/+/g, '$1/')
                });
            }
        } catch (e) {}
    }

    console.log(`[DONE] Odosielam ${streams.length} streamov.`);
    return { streams };
});

// Musí tu byť aspoň prázdny handler pre katalóg
builder.defineCatalogHandler(() => Promise.resolve({ metas: [] }));

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
console.log(`🚀 Addon beží na porte ${port}`);

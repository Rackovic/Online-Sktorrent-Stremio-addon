const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

// 1. Definícia Addonu a Manifestu
const builder = addonBuilder({
    id: "org.stremio.sktonline",
    version: "1.1.3",
    name: "SKTonline Online Streams",
    description: "Všetky dostupné formáty a kvality z online.sktorrent.eu",
    types: ["movie", "series"],
    catalogs: [
        { 
            type: "movie", 
            id: "sktonline-movies", 
            name: "SKTonline Filmy",
            extra: [{ name: "search", isRequired: false }]
        }
    ],
    resources: ["stream"],
    idPrefixes: ["tt"]
});

// Základná konfigurácia pre HTTP požiadavky
const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'sk-SK,sk;q=0.9,cs;q=0.8,en;q=0.7',
    'Referer': 'https://online.sktorrent.eu/'
};

// Pomocné funkcie
function getFlags(text) {
    let flags = "";
    const t = text.toLowerCase();
    if (t.includes("cz") || t.includes("cesky") || t.includes("dabing")) flags += "🇨🇿 ";
    if (t.includes("sk") || t.includes("slovensky") || t.includes("titulky")) flags += "🇸🇰 ";
    return flags;
}

function removeDiacritics(str) {
    return str ? str.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase() : "";
}

async function getIMDbName(id) {
    try {
        const res = await axios.get(`https://www.imdb.com/title/${id}/`, { headers: commonHeaders, timeout: 5000 });
        const $ = cheerio.load(res.data);
        const titleRaw = $('title').text().split(' (')[0].trim();
        return titleRaw;
    } catch (e) { 
        console.log(`[IMDb ERROR] Nepodarilo sa získať názov pre ${id}`);
        return null; 
    }
}

async function searchOnlineVideos(query) {
    try {
        const url = `https://online.sktorrent.eu/search/videos?search_query=${encodeURIComponent(query)}`;
        console.log(`[SEARCH] 🔍 Dotaz: ${query}`);
        
        const res = await axios.get(url, { headers: commonHeaders });
        const $ = cheerio.load(res.data);
        const results = [];

        $("a[href*='/video/']").each((i, el) => {
            const href = $(el).attr('href');
            const title = $(el).text().trim();
            if (href && title) {
                const id = href.split('/').pop();
                results.push({ id, title });
            }
        });
        return results;
    } catch (e) { 
        console.log(`[SEARCH ERROR] ${e.message}`);
        return []; 
    }
}

async function extractAllFormats(videoId, pageTitle) {
    const videoUrl = `https://online.sktorrent.eu/video/${videoId}`;
    try {
        const res = await axios.get(videoUrl, { headers: commonHeaders });
        const $ = cheerio.load(res.data);
        const streams = [];
        const flags = getFlags(pageTitle);

        // A. Zdroje z HTML5 prehrávača
        $('video source').each((i, el) => {
            const src = $(el).attr('src');
            const label = $(el).attr('label') || $(el).attr('res') || 'Video';
            if (src) {
                streams.push({
                    name: `SKTonline ${flags}🟦 ${label}`,
                    title: `${pageTitle}\n(Online Stream)`,
                    url: src.startsWith('http') ? src : `https://online.sktorrent.eu${src}`
                });
            }
        });

        // B. Odkazy na stiahnutie (všetky formáty)
        $('a[href*="get_video"]').each((i, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim().replace('Stiahnuť video', '').trim();
            if (href) {
                streams.push({
                    name: `SKTonline ${flags}📥 ${text || 'MP4'}`,
                    title: `${pageTitle}\n(Priamy link)`,
                    url: href.startsWith('http') ? href : `https://online.sktorrent.eu${href}`
                });
            }
        });

        return streams;
    } catch (e) { 
        return []; 
    }
}

// 2. Stream Handler
builder.defineStreamHandler(async ({ id }) => {
    console.log(`[STREAM REQ] Požiadavka pre ID: ${id}`);
    const imdbId = id.split(":")[0];
    const movieName = await getIMDbName(imdbId);
    
    if (!movieName) return { streams: [] };

    const cleanTitle = removeDiacritics(movieName);
    let videos = await searchOnlineVideos(cleanTitle);
    
    // Fallback: Ak je to Zootopia, skús Zootropolis
    if (videos.length === 0 && cleanTitle.includes("zootopia")) {
        console.log("[FALLBACK] Skúšam hľadať 'zootropolis'...");
        videos = await searchOnlineVideos("zootropolis");
    }

    // Fallback: Ak nič nenašlo, skús len prvé slovo
    if (videos.length === 0) {
        const firstWord = cleanTitle.split(' ')[0];
        if (firstWord.length > 3) {
            console.log(`[FALLBACK] Skúšam hľadať len: ${firstWord}`);
            videos = await searchOnlineVideos(firstWord);
        }
    }

    let allStreams = [];
    for (const vid of videos.slice(0, 3)) {
        const found = await extractAllFormats(vid.id, vid.title);
        allStreams.push(...found);
    }

    // Odstránenie duplicít
    const uniqueStreams = allStreams.filter((v, i, a) => a.findIndex(t => (t.url === v.url)) === i);
    
    console.log(`[SUCCESS] Odosielam ${uniqueStreams.length} streamov.`);
    return { streams: uniqueStreams };
});

// 3. Catalog Handler
builder.defineCatalogHandler(() => Promise.resolve({ metas: [] }));

// 4. Spustenie servera
const port = process.env.PORT || 10000;
serveHTTP(builder.getInterface(), { port });

console.log(`🚀 Addon beží na porte ${port}`);

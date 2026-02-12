const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

// 1. Definícia Addonu a Manifestu
const builder = addonBuilder({
    id: "org.stremio.sktonline",
    version: "1.1.4",
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

function cleanMovieTitle(title) {
    return title
        .split(':')[0]             // Odstráni všetko za dvojbodkou
        .split(' (')[0]            // Odstráni rok v zátvorke
        .replace(/[^\w\s]/gi, '') // Odstráni špeciálne znaky
        .trim();
}

async function getIMDbName(id) {
    try {
        const res = await axios.get(`https://www.imdb.com/title/${id}/`, { headers: commonHeaders, timeout: 5000 });
        const $ = cheerio.load(res.data);
        // Získame čistý názov z <title> tagu
        const titleRaw = $('title').text().split(' (')[0].trim();
        return titleRaw;
    } catch (e) { 
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
    console.log(`[STREAM REQ] ID: ${id}`);
    const imdbId = id.split(":")[0];
    const movieName = await getIMDbName(imdbId);
    
    if (!movieName) return { streams: [] };

    // Vytvoríme zoznam pokusov o hľadanie
    const searchAttempts = new Set();
    searchAttempts.add(cleanMovieTitle(movieName)); // Napr. "Zootropolis"
    
    // Ak je to Zootropolis/Zootopia, pridáme obe verzie
    if (movieName.toLowerCase().includes("zootop")) {
        searchAttempts.add("Zootropolis");
        searchAttempts.add("Zootopia");
    }

    let allVideos = [];
    for (const query of searchAttempts) {
        const found = await searchOnlineVideos(query);
        allVideos.push(...found);
        if (allVideos.length > 5) break; // Ak máme dosť výsledkov, nejdeme ďalej
    }

    let allStreams = [];
    // Prejdeme nájdené videá (max 5 najrelevantnejších)
    for (const vid of allVideos.slice(0, 5)) {
        const found = await extractAllFormats(vid.id, vid.title);
        allStreams.push(...found);
    }

    const uniqueStreams = allStreams.filter((v, i, a) => a.findIndex(t => (t.url === v.url)) === i);
    
    console.log(`[SUCCESS] Odosielam ${uniqueStreams.length} streamov pre: ${movieName}`);
    return { streams: uniqueStreams };
});

builder.defineCatalogHandler(() => Promise.resolve({ metas: [] }));

const port = process.env.PORT || 10000;
serveHTTP(builder.getInterface(), { port });

console.log(`🚀 Addon beží na porte ${port}`);

const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const builder = addonBuilder({
    id: "org.stremio.sktonline",
    version: "1.1.6",
    name: "SKTonline Online Streams",
    description: "Všetky formáty a kvality (MP4/720p/480p)",
    types: ["movie", "series"],
    catalogs: [],
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

function normalizeText(text) {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function getIMDbName(id) {
    try {
        const res = await axios.get(`https://www.imdb.com/title/${id}/`, { headers: commonHeaders, timeout: 5000 });
        const $ = cheerio.load(res.data);
        const title = $('title').text().replace(' - IMDb', '').split(' (')[0].trim();
        return title;
    } catch (e) { return null; }
}

async function searchOnlineVideos(query) {
    try {
        const searchUrl = `https://online.sktorrent.eu/search/videos?search_query=${encodeURIComponent(query)}`;
        console.log(`[DEBUG] 🔍 Vyhľadávanie: ${searchUrl}`);
        
        const res = await axios.get(searchUrl, { headers: commonHeaders });
        const $ = cheerio.load(res.data);
        const results = [];

        // Nový selektor pre získanie videí zo zoznamu
        $('.video-content a[href*="/video/"]').each((i, el) => {
            const href = $(el).attr('href');
            const title = $(el).attr('title') || $(el).text().trim();
            if (href && title) {
                const id = href.split('/').pop();
                if (!results.find(r => r.id === id)) {
                    results.push({ id, title });
                }
            }
        });

        console.log(`[DEBUG] ✅ Nájdených ${results.length} potenciálnych videí.`);
        return results;
    } catch (e) {
        console.log(`[ERROR] Search error: ${e.message}`);
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

        // 1. Extrakcia kvalít z <source> tagov
        $('video source').each((i, el) => {
            const src = $(el).attr('src');
            const label = $(el).attr('label') || $(el).attr('res') || 'HD';
            if (src) {
                streams.push({
                    name: `SKTonline ${flags}🟦 ${label}`,
                    title: `${pageTitle}\nStreamovacia kvalita`,
                    url: src.startsWith('http') ? src : `https://online.sktorrent.eu${src}`
                });
            }
        });

        // 2. Extrakcia priamych linkov (Download verzie)
        $('a[href*="get_video"]').each((i, el) => {
            const href = $(el).attr('href');
            let label = $(el).text().trim().replace('Stiahnuť video', '').trim() || 'MP4';
            if (href) {
                streams.push({
                    name: `SKTonline ${flags}📥 ${label}`,
                    title: `${pageTitle}\nPriamy MP4 súbor`,
                    url: href.startsWith('http') ? href : `https://online.sktorrent.eu${href}`
                });
            }
        });

        return streams;
    } catch (e) { return []; }
}

builder.defineStreamHandler(async ({ id }) => {
    console.log(`[REQ] Stream pre: ${id}`);
    const imdbId = id.split(":")[0];
    const movieName = await getIMDbName(imdbId);
    
    if (!movieName) return { streams: [] };

    // Vyskúšame tri varianty hľadania
    const queries = [
        movieName,                         // Originál (napr. Gladiátor)
        normalizeText(movieName),          // Bez diakritiky (napr. Gladiator)
        movieName.split(' ')[0]            // Len prvé slovo (najširší výsledok)
    ];

    let allVideos = [];
    for (const q of [...new Set(queries)]) {
        if (q.length < 3) continue;
        const vids = await searchOnlineVideos(q);
        allVideos.push(...vids);
        if (allVideos.length > 0) break; 
    }

    let allStreams = [];
    for (const vid of allVideos.slice(0, 3)) {
        const found = await extractAllFormats(vid.id, vid.title);
        allStreams.push(...found);
    }

    const uniqueStreams = allStreams.filter((v, i, a) => a.findIndex(t => (t.url === v.url)) === i);
    console.log(`[DONE] Odosielam ${uniqueStreams.length} streamov.`);
    
    return { streams: uniqueStreams };
});

const port = process.env.PORT || 10000;
serveHTTP(builder.getInterface(), { port });
console.log(`🚀 Addon v1.1.6 beží na porte ${port}`);

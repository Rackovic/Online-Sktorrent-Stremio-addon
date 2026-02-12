const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

// Nastavenie Cookie Jar pre simuláciu reálnej relácie
const jar = new CookieJar();
const client = wrapper(axios.create({ jar }));

const builder = addonBuilder({
    id: "org.stremio.sktonline",
    version: "1.1.2",
    name: "SKTonline Online Streams",
    description: "Všetky formáty a kvality z online.sktorrent.eu",
    types: ["movie", "series"],
    catalogs: [{ type: "movie", id: "sktonline-top", name: "SKTonline" }],
    resources: ["stream"],
    idPrefixes: ["tt"]
});

const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'sk-SK,sk;q=0.9,cs;q=0.8,en;q=0.7',
    'Referer': 'https://online.sktorrent.eu/'
};

function getFlags(text) {
    let flags = "";
    const t = text.toLowerCase();
    if (t.includes("cz") || t.includes("cesky") || t.includes("dabing")) flags += "🇨🇿 ";
    if (t.includes("sk") || t.includes("slovensky") || t.includes("titulky")) flags += "🇸🇰 ";
    return flags;
}

async function getIMDbName(id) {
    try {
        const res = await axios.get(`https://www.imdb.com/title/${id}/`, { headers: commonHeaders, timeout: 5000 });
        const $ = cheerio.load(res.data);
        return $('title').text().split(' (')[0].trim();
    } catch (e) { return null; }
}

async function searchOnlineVideos(query) {
    try {
        // Najprv získame session cez hlavnú stránku
        await client.get('https://online.sktorrent.eu/', { headers: commonHeaders });
        const url = `https://online.sktorrent.eu/search/videos?search_query=${encodeURIComponent(query)}`;
        const res = await client.get(url, { headers: commonHeaders });
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
    } catch (e) { return []; }
}

async function extractAllFormats(videoId, pageTitle) {
    const videoUrl = `https://online.sktorrent.eu/video/${videoId}`;
    try {
        const res = await client.get(videoUrl, { headers: commonHeaders });
        const $ = cheerio.load(res.data);
        const streams = [];
        const flags = getFlags(pageTitle);

        // 1. Zdroje z prehrávača (rôzne kvality)
        $('video source').each((i, el) => {
            const src = $(el).attr('src');
            const label = $(el).attr('label') || $(el).attr('res') || 'Video';
            if (src) {
                streams.push({
                    name: `SKTonline ${flags}🟦 ${label}`,
                    title: `${pageTitle}\n(Priamy stream)`,
                    url: src.startsWith('http') ? src : `https://online.sktorrent.eu${src}`
                });
            }
        });

        // 2. Odkazy na stiahnutie (všetky nájdené formáty)
        $('a[href*="get_video"]').each((i, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim().replace('Stiahnuť video', '').trim();
            if (href) {
                streams.push({
                    name: `SKTonline ${flags}📥 ${text || 'MP4'}`,
                    title: `${pageTitle}\n(Download link)`,
                    url: href.startsWith('http') ? href : `https://online.sktorrent.eu${href}`
                });
            }
        });

        return streams;
    } catch (e) { return []; }
}

builder.defineStreamHandler(async ({ id }) => {
    console.log(`[REQ] ID: ${id}`);
    const imdbId = id.split(":")[0];
    const movieName = await getIMDbName(imdbId);
    if (!movieName) return { streams: [] };

    // Hľadanie
    let videos = await searchOnlineVideos(movieName);
    
    // Fallback pre Zootopiu
    if (videos.length === 0 && movieName.toLowerCase().includes("zootopia")) {
        videos = await searchOnlineVideos("zootropolis");
    }

    let allStreams = [];
    for (const vid of videos.slice(0, 3)) {
        const found = await extractAllFormats(vid.id, vid.title);
        allStreams.push(...found);
    }

    // Odstránenie duplicitných URL
    const uniqueStreams = allStreams.filter((v, i, a) => a.findIndex(t => (t.url === v.url)) === i);
    
    console.log(`[DONE] Odosielam ${uniqueStreams.length} streamov.`);
    return { streams: uniqueStreams };
});

builder.defineCatalogHandler(() => Promise.resolve({ metas: [] }));

const port = process.env.PORT || 10000;
serveHTTP(builder.getInterface(), { port });
console.log(`🚀 Addon beží na porte ${port}`);

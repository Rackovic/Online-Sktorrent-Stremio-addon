const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const builder = addonBuilder({
    id: "org.stremio.sktonline",
    version: "1.1.7",
    name: "SKTonline Online Streams",
    description: "Oprava vyhľadávania a simulácia prehliadača",
    types: ["movie", "series"],
    catalogs: [],
    resources: ["stream"],
    idPrefixes: ["tt"]
});

// Simulácia reálneho prehliadača
const getAxiosConfig = (extraHeaders = {}) => ({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/ *;q=0.8',
        'Accept-Language': 'sk-SK,sk;q=0.9,cs;q=0.8,en;q=0.7',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        ...extraHeaders
    },
    timeout: 8000
});

async function searchOnlineVideos(query) {
    try {
        // 1. KROK: Najprv "ťukneme" na web, aby sme vyzerali ako človek a dostali session cookies
        const session = await axios.get('https://online.sktorrent.eu/', getAxiosConfig());
        const cookies = session.headers['set-cookie'] ? session.headers['set-cookie'].join('; ') : '';

        // 2. KROK: Samotné vyhľadávanie so získanými cookies
        const searchUrl = `https://online.sktorrent.eu/search/videos?search_query=${encodeURIComponent(query)}`;
        console.log(`[DEBUG] 🔍 Pokus o hľadanie: "${query}"`);
        
        const res = await axios.get(searchUrl, getAxiosConfig({ 
            'Cookie': cookies,
            'Referer': 'https://online.sktorrent.eu/'
        }));
        
        const $ = cheerio.load(res.data);
        const results = [];

        // Hľadáme všetky možné linky, ktoré obsahujú "/video/"
        $('a').each((i, el) => {
            const href = $(el).attr('href') || '';
            const title = $(el).text().trim() || $(el).attr('title') || '';
            
            if (href.includes('/video/') && title.length > 1) {
                const id = href.split('/').pop();
                if (!results.find(r => r.id === id)) {
                    results.push({ id, title });
                }
            }
        });

        console.log(`[DEBUG] ✅ Nájdených ${results.length} odkazov.`);
        return results;
    } catch (e) {
        console.log(`[ERROR] Chyba pri hľadaní: ${e.message}`);
        return [];
    }
}

async function extractStreams(videoId, pageTitle) {
    try {
        const url = `https://online.sktorrent.eu/video/${videoId}`;
        const res = await axios.get(url, getAxiosConfig({ 'Referer': 'https://online.sktorrent.eu/' }));
        const $ = cheerio.load(res.data);
        const streams = [];

        // Extrakcia MP4 zdrojov
        $('source').each((i, el) => {
            const src = $(el).attr('src');
            const label = $(el).attr('label') || $(el).attr('res') || 'Video';
            if (src) {
                streams.push({
                    name: `SKT 🟦 ${label}`,
                    title: pageTitle,
                    url: src.startsWith('http') ? src : `https://online.sktorrent.eu${src}`
                });
            }
        });

        // Extrakcia download linkov
        $('a[href*="get_video"]').each((i, el) => {
            const href = $(el).attr('href');
            if (href) {
                streams.push({
                    name: `SKT 📥 Link`,
                    title: pageTitle,
                    url: href.startsWith('http') ? href : `https://online.sktorrent.eu${href}`
                });
            }
        });

        return streams;
    } catch (e) { return []; }
}

async function getIMDbName(id) {
    try {
        const res = await axios.get(`https://www.imdb.com/title/${id}/`, getAxiosConfig());
        const $ = cheerio.load(res.data);
        return $('title').text().split(' (')[0].trim();
    } catch (e) { return null; }
}

builder.defineStreamHandler(async ({ id }) => {
    console.log(`[REQ] ID: ${id}`);
    const movieName = await getIMDbName(id.split(":")[0]);
    if (!movieName) return { streams: [] };

    // Hľadáme len čistý názov bez diakritiky (najúspešnejšia metóda na tomto webe)
    const query = movieName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const videos = await searchOnlineVideos(query);

    let allStreams = [];
    for (const vid of videos.slice(0, 3)) {
        const s = await extractStreams(vid.id, vid.title);
        allStreams.push(...s);
    }

    console.log(`[DONE] Odosielam ${allStreams.length} streamov.`);
    return { streams: allStreams };
});

const port = process.env.PORT || 10000;
serveHTTP(builder.getInterface(), { port });

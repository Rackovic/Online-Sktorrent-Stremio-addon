// online-sktorrent-addon.js
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");
const { decode } = require("entities");

const builder = addonBuilder({
    id: "org.stremio.sktonline",
    version: "1.0.0",
    name: "SKTonline Online Streams",
    description: "Priame online videá (720p/480p/360p) z online.sktorrent.eu",
    types: ["movie", "series"],
    catalogs: [
        { type: "movie", id: "sktonline-movie", name: "SKTonline Filmy" },
        { type: "series", id: "sktonline-series", name: "SKTonline Seriály" }
    ],
    resources: ["stream"],
    idPrefixes: ["tt"]
});

const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
    'Accept-Encoding': 'identity'
};

// Pomocná funkcia na odstránenie diakritiky
function removeDiacritics(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Funkcia na vyhľadávanie na stránke
async function searchOnlineVideos(query) {
    try {
        const searchUrl = `https://online.sktorrent.eu/search.php?name=${encodeURIComponent(query)}`;
        const resp = await axios.get(searchUrl, { headers: commonHeaders });
        const $ = cheerio.load(resp.data);
        const results = [];
        
        // Selektor podľa štruktúry webu (uprav ak sa web zmení)
        $('a[href^="video.php?id="]').each((i, el) => {
            const href = $(el).attr('href');
            const id = href.split('=')[1];
            if (id) results.push(id);
        });
        return [...new Set(results)];
    } catch (e) {
        console.error("Chyba pri hľadaní:", e.message);
        return [];
    }
}

// Funkcia na získanie streamov z ID videa
async function extractStreamsFromVideoId(videoId) {
    try {
        const url = `https://online.sktorrent.eu/video.php?id=${videoId}`;
        const resp = await axios.get(url, { headers: commonHeaders });
        const $ = cheerio.load(resp.data);
        const streams = [];
        const title = $('h1').text().trim() || "SKT Stream";

        $('source').each((i, el) => {
            const src = $(el).attr('src');
            const res = $(el).attr('label') || "Video";
            if (src) {
                streams.push({
                    title: `${title}\n${res}`,
                    url: src.startsWith('http') ? src : `https://online.sktorrent.eu/${src}`
                });
            }
        });
        return streams;
    } catch (e) {
        return [];
    }
}

builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`[DEBUG] Požiadavka na stream: ${type} ${id}`);
    
    // Tu by mala byť logika na získanie názvu filmu cez Cinemeta/TMDB API 
    // Pre tento príklad predpokladáme, že hľadáme podľa ID (zjednodušené)
    let query = id; 

    const videoIds = await searchOnlineVideos(query);
    let allStreams = [];

    for (const vid of videoIds) {
        const streams = await extractStreamsFromVideoId(vid);
        allStreams.push(...streams);
    }

    return { streams: allStreams };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });

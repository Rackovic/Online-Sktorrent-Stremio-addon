async function searchAndFilter(query, targetTitle) {
    // SKTorrent často vyžaduje, aby search_query bolo v konkrétnom kódovaní
    const searchUrl = `https://online.sktorrent.eu/search/videos?search_query=${encodeURIComponent(query)}`;
    
    console.log(`[DEBUG] 🌐 Volám URL: ${searchUrl}`);
    
    try {
        const res = await axios.get(searchUrl, { 
            headers: {
                ...commonHeaders,
                'Referer': 'https://online.sktorrent.eu/',
                'Cache-Control': 'no-cache'
            }, 
            timeout: 10000 
        });

        const $ = cheerio.load(res.data);
        const results = [];
        
        // DEBUG: Pozrieme sa, či vôbec vidíme nejaké video linky
        const allLinks = $("a[href*='/video/']").length;
        console.log(`[DEBUG] Na stránke sa našlo ${allLinks} odkazov na videá.`);

        $("a").each((i, el) => {
            const href = $(el).attr("href") || "";
            const videoTitle = $(el).text().trim();
            const match = href.match(/\/video\/(\d+)/);
            
            if (match && videoTitle) {
                const videoId = match[1];
                const cleanVideoTitle = removeDiacritics(videoTitle);
                const cleanTarget = removeDiacritics(targetTitle);

                // Ak hľadáme "Zootopia", chceme čokoľvek, čo obsahuje "zootop" alebo "zootropol"
                if (cleanVideoTitle.includes(cleanTarget.substring(0, 5))) {
                    console.log(`[MATCH FOUND] ✅ ${videoTitle} (ID: ${videoId})`);
                    results.push({ id: videoId, title: videoTitle });
                }
            }
        });

        // Ak sme nič nenašli cez selektor, vypíšeme kúsok HTML pre diagnostiku
        if (results.length === 0) {
            console.log(`[DIAG] HTML náhľad (prvých 200 znakov body): ${$('body').text().substring(0, 200).replace(/\s+/g, ' ')}`);
        }

        return results;
    } catch (err) {
        console.error(`[SEARCH ERROR] ❌ Chyba pri vyhľadávaní: ${err.message}`);
        return [];
    }
}

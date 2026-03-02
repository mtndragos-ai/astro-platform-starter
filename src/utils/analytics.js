/**
 * SISTEM CENTRALIZAT DE STATISTICI AGROCONCEPT
 * Trimite datele automat către Google Sheets prin intermediul Google Forms.
 */

// =====================================================================
// ⚙️ CONFIGURARE (ID-uri preluate din Google Form-ul AgroConcept)
// =====================================================================

// 1. FORM ID 
const GOOGLE_FORM_ID = "1FAIpQLScDy_NQ4z0UMYBrXjrtPX2OGZ0f6y-PafVuQb2K5fJ7OC9JWQ"; 

// 2. ENTRY IDs 
const FIELD_USER    = "entry.1487391256"; 
const FIELD_ACTION  = "entry.67613820"; 
const FIELD_DETAILS = "entry.507829660"; 
const FIELD_DATE    = "entry.1762257326"; 

// =====================================================================

/**
 * Funcție avansată pentru detectarea dispozitivului, OS-ului și a browserului
 */
function getDetailedDeviceInfo() {
    if (typeof window === 'undefined') return "Necunoscut";
    const ua = navigator.userAgent;
    
    // 1. Detectare tip de bază (Mobil vs Desktop)
    let tip = "Desktop";
    if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) tip = "Mobil";

    // 2. Detectare Sistem de Operare (și model la Android dacă e disponibil)
    let os = "Necunoscut";
    if (/iPhone/i.test(ua)) {
        os = "iPhone";
    } else if (/iPad/i.test(ua)) {
        os = "iPad";
    } else if (/Android/i.test(ua)) {
        // Încercăm să extragem codul modelului la Android (ex: SM-G981B)
        const match = ua.match(/\(Linux; Android [0-9\.]+; ([a-zA-Z0-9\- ]+) Build/i) || 
                      ua.match(/\(Linux; U; Android [0-9\.]+; [a-zA-Z\-]+; ([a-zA-Z0-9\- ]+) Build/i);
        os = match && match[1] ? `Android (${match[1].trim()})` : "Android";
    } else if (/Windows NT 10/i.test(ua)) {
        os = "Windows 10/11";
    } else if (/Windows NT 6.3/i.test(ua) || /Windows NT 6.2/i.test(ua)) {
        os = "Windows 8";
    } else if (/Mac OS X/i.test(ua)) {
        os = "Mac OS";
    }

    // 3. Detectare Browser
    let browser = "Browser";
    if (/Edg/i.test(ua)) browser = "Edge";
    else if (/OPR/i.test(ua) || /Opera/i.test(ua)) browser = "Opera";
    else if (/Chrome/i.test(ua) && !/Edg/i.test(ua)) browser = "Chrome";
    else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";
    else if (/Firefox/i.test(ua)) browser = "Firefox";

    // Format final: "Mobil (iPhone, Safari)" sau "Desktop (Windows 10/11, Chrome)"
    return `${tip} (${os}, ${browser})`;
}

/**
 * Funcție internă pentru expedierea datelor către Google
 */
function sendToSheet(data) {
    // Verificăm dacă ID-urile sunt configurate corect
    if (GOOGLE_FORM_ID.includes("...")) {
        console.log("%c 📊 ANALYTICS [MOD TEST]:", "color: #eab308; font-weight: bold;", data);
        return;
    }

    const formUrl = `https://docs.google.com/forms/d/e/${GOOGLE_FORM_ID}/formResponse`;
    
    // Pregătim datele pentru formular
    const formData = new FormData();
    formData.append(FIELD_USER, data.user);
    formData.append(FIELD_ACTION, data.action);
    formData.append(FIELD_DETAILS, data.details || "-");
    formData.append(FIELD_DATE, data.timestamp);

    // Trimitem "în fundal" (no-cors) pentru a nu bloca navigarea utilizatorului
    fetch(formUrl, {
        method: 'POST',
        mode: 'no-cors',
        body: formData
    })
    .then(() => {
        console.log(`%c ✅ STATISTICI: ${data.action} înregistrat pentru ${data.user}`, "color: #16a34a; font-size: 10px;");
    })
    .catch(err => {
        console.error("❌ EROARE ANALYTICS:", err);
    });
}

export const Analytics = {
    // Înregistrează logarea utilizatorului
    trackLogin: (user) => {
        const deviceDetails = getDetailedDeviceInfo();
        sendToSheet({
            user: user,
            timestamp: new Date().toLocaleString("ro-RO"),
            action: "LOGIN",
            details: `Autentificare reușită | Dispozitiv: ${deviceDetails}`
        });
    },

    // Înregistrează accesarea fiecărei pagini
    trackPageView: (pageName) => {
        const user = localStorage.getItem('agro_user') || 'Necunoscut';
        sendToSheet({
            user: user,
            timestamp: new Date().toLocaleString("ro-RO"),
            action: "VIZUALIZARE",
            details: pageName
        });
    },

    // Înregistrează descărcările de documente sau accesarea clipurilor video
    trackDownload: (resourceName, link) => {
        const user = localStorage.getItem('agro_user') || 'Necunoscut';
        sendToSheet({
            user: user,
            timestamp: new Date().toLocaleString("ro-RO"),
            action: "DOWNLOAD/VIDEO",
            details: `${resourceName} | Link: ${link}`
        });
    },

    // Înregistrează timpul total petrecut pe o pagină la părăsirea acesteia
    trackTime: (pageName, startTime) => {
        const user = localStorage.getItem('agro_user') || 'Necunoscut';
        const endTime = new Date();
        const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000); // calcul în secunde

        // Trimitem raportul doar dacă activitatea a durat mai mult de 5 secunde
        if (duration > 5) {
            sendToSheet({
                user: user,
                timestamp: new Date().toLocaleString("ro-RO"),
                action: "TIMP PETRECUT",
                details: `${duration} secunde pe pagina: ${pageName}`
            });
        }
    }
};
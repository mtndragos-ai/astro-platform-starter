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
        sendToSheet({
            user: user,
            timestamp: new Date().toLocaleString("ro-RO"),
            action: "LOGIN",
            details: "Autentificare reușită"
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
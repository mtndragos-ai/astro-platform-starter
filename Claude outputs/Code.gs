function doPost(e) {
  try {
    var sheetId = '1CTLy5C9PTnddwSWtg9vZWPO4-V6aoV4aAnGX8EbRGmc';
    var folderId = '1rqRVqFSRTjxvLhLHK7ENiMpZQ6DB3TJl';

    var data = JSON.parse(e.postData.contents);

    // =========================================================================
    // 1. ADAUGARE COMENTARIU NOU (CHAT) ȘI NOTIFICARE
    // =========================================================================
    if (data.action === "add_comment") {
      var sheet = SpreadsheetApp.openById(sheetId).getActiveSheet();
      var rows = sheet.getDataRange().getValues();
      var headers = rows[0];

      // Verificam daca exista coloana "Comentarii", daca nu o cream
      var commentsColIndex = headers.indexOf('Comentarii');
      if (commentsColIndex === -1) {
         sheet.getRange(1, headers.length + 1).setValue('Comentarii');
         commentsColIndex = headers.length; // Indexul noii coloane (0-based)
      }

      // Calculam randul real
      var totalDataRows = rows.length - 1;
      var realRowIndex = totalDataRows - data.reportIndex + 1;

      if (realRowIndex > 1 && realRowIndex <= rows.length) {
         var cell = sheet.getRange(realRowIndex, commentsColIndex + 1);
         var existingCommentsStr = cell.getValue();
         var existingComments = [];

         if (existingCommentsStr) {
           try {
             existingComments = JSON.parse(existingCommentsStr);
           } catch(err) {
             existingComments = [];
           }
         }

         // Adaugam noul mesaj in array
         existingComments.push({
           user: data.user,
           text: data.msg,
           timestamp: new Date().toISOString()
         });

         // Salvam array-ul inapoi in celula ca string JSON
         cell.setValue(JSON.stringify(existingComments));

         // --------------------------------------------------------------------
         // 📩 TRIMITERE EMAIL CĂTRE CREATORUL RAPORTULUI
         // --------------------------------------------------------------------
         try {
             var userColIndex = headers.indexOf('Tehnician');
             if (userColIndex === -1) userColIndex = headers.indexOf('User'); // fallback

             var utilajColIndex = headers.indexOf('Utilaj');

             if (userColIndex !== -1) {
                 // Numele tehnicianului care a creat raportul inițial (ex: ion.popescu)
                 var creatorRaport = String(sheet.getRange(realRowIndex, userColIndex + 1).getValue()).trim();
                 var numeUtilaj = (utilajColIndex !== -1) ? sheet.getRange(realRowIndex, utilajColIndex + 1).getValue() : "Utilaj necunoscut";

                 // Trimitem mail INDIFERENT cine adaugă comentariul (chiar și creatorul însuși)
                 if (creatorRaport !== "") {

                     // Formatam frumos numele celui care a raspuns (ex: Dragos Munteanu)
                     var formatNumeRaspuns = data.user.split(/[._]/).map(function(p){ return p.charAt(0).toUpperCase() + p.slice(1); }).join(' ');

                     // Construim adresa de mail a creatorului adaugand @agroconcept.ro
                     var adresaCreator = creatorRaport.toLowerCase() + "@agroconcept.ro";

                     var subiectComentariu = "Răspuns nou la raportul tău: " + numeUtilaj;

                     var corpComentariu = "<p>Salut,</p>" +
                                          "<p><strong>" + formatNumeRaspuns + "</strong> a adăugat o completare la raportul tău!</p>" +
                                          "<div style='background-color: #f1f5f9; padding: 10px; border-left: 4px solid #003087; margin: 15px 0;'>" +
                                          "<em>\"" + data.msg + "\"</em>" +
                                          "</div>" +
                                          "<p>Intră pe portal la secțiunea 'Istoric Defecte' pentru a vizualiza toată conversația.</p>" +
                                          "<br><p><em>Acest email este generat automat de Portalul Tehnic Service AgroConcept.</em></p>";

                     MailApp.sendEmail({
                         to: adresaCreator,
                         cc: "suporttehnic@agroconcept.ro", // Adresa de CC
                         subject: subiectComentariu,
                         htmlBody: corpComentariu,
                         name: "Portal Training AgroConcept"
                     });
                 }
             }
         } catch (mailError) {
             console.error("Eroare trimitere mail comentariu: ", mailError);
             // Eroarea la mail nu trebuie sa blocheze adaugarea comentariului
         }
         // --------------------------------------------------------------------

         return ContentService.createTextOutput(JSON.stringify({"status": "success"})).setMimeType(ContentService.MimeType.JSON);
      } else {
         throw new Error("Nu am găsit raportul în baza de date.");
      }
    }

    // =========================================================================
    // 2. SALVARE RAPORT NOU (LOGICA EXISTENTĂ PENTRU FORMULAR)
    // =========================================================================
    var user = data.user;
    var utilaj = data.utilaj;
    var serie = data.serie;
    var ore_functionare = data.ore_functionare;
    var data_defect = data.data_defect || "-"; // <--- CÂMP NOU (Data defectului)
    var problema = data.problema;
    var rezolvare = data.rezolvare;
    var pozeB64 = data.poze;
    var photoUrls = [];

    // Accesăm folderul de pe Drive
    var folder = DriveApp.getFolderById(folderId);

    for (var i = 0; i < pozeB64.length; i++) {
      var decodedData = Utilities.base64Decode(pozeB64[i].data);
      var blob = Utilities.newBlob(decodedData, pozeB64[i].mimeType, serie + "_poza_" + (i+1));
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      photoUrls.push(file.getUrl());
    }

    var sheet = SpreadsheetApp.openById(sheetId).getActiveSheet();
    var headers = sheet.getDataRange().getValues()[0];

    // ATENȚIE: Array-ul este generat în această ordine. Asigură-te că tabelul tău Excel
    // are coloana "Data defect" imediat după "Ore de functionare"
    var randNou = [
      new Date(),
      user,
      utilaj,
      serie,
      ore_functionare,
      data_defect,      // <--- CÂMPUL NOU
      problema,
      rezolvare,
      photoUrls.join(" | ")
    ];

    var commentsColIndex = headers.indexOf('Comentarii');
    if (commentsColIndex !== -1) {
        while(randNou.length < commentsColIndex) {
            randNou.push("");
        }
        randNou[commentsColIndex] = "[]";
    }

    sheet.appendRow(randNou);

    // =========================================================================
    // 📩 3. TRIMITEREA EMAIL-ULUI CĂTRE MANAGEMENT PENTRU RAPORT NOU
    // =========================================================================
    // Sărim peste acest email când cererea vine cu silent:true (ex. import
    // în bloc din tichete CNH THD, care sunt deja urmărite acolo și nu mai
    // au nevoie de o alertă separată către suport pentru fiecare).
    if (!data.silent) {
      var adresaMailNotificare = "suporttehnic@agroconcept.ro";
      var subiectMail = "🚨 Raportare Nouă: " + utilaj + " (Seria: " + serie + ")";

      var corpMail = "<h2>A fost înregistrată o nouă raportare pe platformă!</h2>" +
                     "<p><strong>Tehnician:</strong> " + user + "</p>" +
                     "<p><strong>Utilaj:</strong> " + utilaj + "</p>" +
                     "<p><strong>Serie Șasiu:</strong> " + serie + "</p>" +
                     "<p><strong>Ore de funcționare / Hectare:</strong> " + ore_functionare + "</p>" +
                     "<p><strong>Data defectului:</strong> " + data_defect + "</p>" + // <--- ADĂUGAT ÎN MAIL
                     "<hr>" +
                     "<p><strong>🔴 Problema reclamată:</strong><br>" + problema + "</p>" +
                     "<p><strong>🟢 Rezolvare aplicată:</strong><br>" + rezolvare + "</p>" +
                     "<br><p><em>Acest email este generat automat de Portalul Tehnic Service AgroConcept.</em></p>";

      MailApp.sendEmail({
        to: adresaMailNotificare,
        subject: subiectMail,
        htmlBody: corpMail,
        name: "Portal Training AgroConcept"
      });
    }

    return ContentService.createTextOutput(JSON.stringify({"status": "success"})).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": error.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}

// =========================================================================
// FUNȚIA DE CITIRE (AFIȘARE ÎN ISTORIC)
// =========================================================================
function doGet(e) {
  try {
    var sheetId = '1CTLy5C9PTnddwSWtg9vZWPO4-V6aoV4aAnGX8EbRGmc';
    var sheet = SpreadsheetApp.openById(sheetId).getActiveSheet();
    var data = sheet.getDataRange().getValues();

    var headers = data[0];
    var result = [];

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var obj = {};
      for (var j = 0; j < headers.length; j++) {
        if (headers[j] === 'Data' && row[j] instanceof Date) {
          var d = row[j];
          var zi = ("0" + d.getDate()).slice(-2);
          var luna = ("0" + (d.getMonth() + 1)).slice(-2);
          var an = d.getFullYear();
          obj[headers[j]] = zi + "." + luna + "." + an;
        }
        else if (headers[j] === 'Comentarii') {
            var val = row[j];
            if (val) {
                try { obj[headers[j]] = JSON.parse(val); } catch(err) { obj[headers[j]] = []; }
            } else { obj[headers[j]] = []; }
        }
        else { obj[headers[j]] = row[j]; }
      }

      if (obj['Utilaj'] || obj['Serie']) {
          if(!obj['Comentarii']) obj['Comentarii'] = [];
          result.push(obj);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ "status": "success", "data": result.reverse() })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ "status": "error", "message": error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}
